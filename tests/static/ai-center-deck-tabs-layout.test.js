import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssSection } from '../helpers/css-section.js';

const css = cssSection('ai-center-deck.css');

test('non-Overview tabs are forced to one full-width column (beats v2 "span 6")', () => {
  assert.match(css, /\.aic-main:not\(\[data-tab=overview\]\)>\*\{[^}]*grid-column:1\/-1!important/);
});

test('tile amounts never break mid-number', () => {
  assert.match(css, /\.aic-it-v[^{]*\{[^}]*overflow-wrap:normal/);
});
