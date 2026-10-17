import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssSection } from '../helpers/css-section.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const css = cssSection('ai-center-command-deck.css');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('command-deck layer loads after the existing mobile and DUA styles', () => {
  const deck = html.indexOf('css/ai-center-theme.css');
  assert.ok(deck > 0, 'theme stylesheet (contains the command deck) is linked in index.html');
  assert.ok(html.indexOf('css/mobile.css') < deck);
  assert.ok(html.indexOf('css/ai-center.css') < deck, 'the base + DUA stylesheet loads before the theme');
});
test('command-deck stylesheet is precached by the service worker', () => {
  assert.match(sw, /\.\/css\/ai-center-theme\.css/);
});
test('redesign remains scoped to the Intelligence Centre and chat sheet', () => {
  assert.match(css, /\.aic-page\.aic-jarvis/);
  const selectors = [...bare.matchAll(/(?:^|\})\s*([^{}@][^{}]*)\{/g)].map(m => m[1].trim());
  const offenders = selectors
    .flatMap(s => s.split(','))
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('@') && !/^(\.aic-page\.aic-jarvis|body\.aic-open)\b/.test(s));
  assert.deepEqual(offenders, []);
});
test('does not override layout owned by the existing AI Centre stylesheets', () => {
  assert.doesNotMatch(bare, /grid-column\s*:/);
  assert.doesNotMatch(bare, /grid-row\s*:/);
  assert.doesNotMatch(bare, /grid-template-columns\s*:/);
  assert.doesNotMatch(bare, /\.aic-sh(?:\s+h2)?::before/);
});
test('mobile, reduced-motion, and touch target refinements are present', () => {
  assert.match(css, /max-width: 699px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /min-height: 44px/);
});
test('recent-run rows are start-aligned and the toast clears the chat bar', () => {
  assert.match(bare, /\.aic-runb\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(bare, /body\.aic-open #toast\s*\{[^}]*bottom:\s*calc\(132px/);
});
test('Money & Ledgers folds empty ledgers and the spike tool skips ledgers with no history', () => {
  const ui = readFileSync(new URL('../../js/ai-center/ui.js', import.meta.url), 'utf8');
  const planning = readFileSync(new URL('../../js/agent/tools/planning.js', import.meta.url), 'utf8');
  assert.match(ui, /Mo\.ledgers\.filter\(ledgerHasActivity\)/);
  assert.match(ui, /No entries this month: /);
  assert.match(planning, /hasHistory \? categorySpikes\(/);
});
