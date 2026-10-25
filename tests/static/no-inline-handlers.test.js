// Inline event handlers (onclick="...") are being retired in favour of the delegated dispatcher in
// js/shared/dom-actions.js (data-on-click="action" data-args='[...]').
//   * index.html must contain NONE (it is fully migrated).
//   * Every action index.html references must resolve to a real window export / registered action,
//     so a typo or a removed function fails CI instead of failing silently on a tap.
//   * JS-generated HTML still has legacy inline handlers; that count is a RATCHET: it may only go down.
//     When you convert templates, lower JS_TEMPLATE_INLINE_BASELINE in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const JS_TEMPLATE_INLINE_BASELINE = 221;
const INLINE = /\son(?:click|input|change|keydown|keyup|focus|blur|submit)\s*=/g;

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const markup = indexHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

test('index.html has no inline event-handler attributes', () => {
  const hits = [...markup.matchAll(INLINE)].length;
  assert.equal(hits, 0, 'use data-on-<event>="action" (see js/shared/dom-actions.js)');
});

test('the dispatcher is loaded by index.html before the other modules and precached', () => {
  const first = indexHtml.indexOf('<script type="module" src=');
  assert.ok(indexHtml.indexOf('<script type="module" src="js/shared/dom-actions.js') === first, 'dom-actions.js must be the first module script');
  assert.ok(readFileSync(join(ROOT, 'sw.js'), 'utf8').includes('js/shared/dom-actions.js'));
});

test('every data-on-* action in index.html resolves to an exported/registered function', () => {
  const exposed = new Set(['clickElement']);
  for (const f of walk('js')) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) exposed.add(m[1]);
    for (const m of s.matchAll(/\bwindow\[\s*['"]([\w$]+)['"]\s*\]\s*=(?!=)/g)) exposed.add(m[1]);
    const ident = /(?:^|[,\s{])([A-Za-z_$][\w$]*)\s*(?::|,|\(|\n|$|\})/g;
    const blocks = [
      ...s.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g),
      ...s.matchAll(/registerActions\(\s*\{([\s\S]*?)\}\s*\)/g),
    ];
    if (/Object\.assign\(\s*window\s*,/.test(s)) blocks.push(...s.matchAll(/Object\.freeze\(\s*\{([\s\S]*?)\}\s*\)/g));
    for (const b of blocks) for (const k of b[1].matchAll(ident)) exposed.add(k[1]);
  }
  const unresolved = new Set();
  for (const m of markup.matchAll(/data-on-\w+="([^"]+)"/g)) {
    if (!exposed.has(m[1].split('.')[0])) unresolved.add(m[1]);
  }
  assert.deepEqual([...unresolved], [], 'these actions are referenced in index.html but never exported');
});

test('every data-args in index.html is a JSON array using only known tokens', () => {
  const known = new Set(['this', 'value', 'checked', 'event']);
  const bad = [];
  for (const m of markup.matchAll(/data-args='([^']*)'/g)) {
    try {
      const v = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
      if (!Array.isArray(v)) bad.push(m[1]);
      else for (const a of v) if (a && typeof a === 'object' && !known.has(a.$)) bad.push(m[1]);
    } catch { bad.push(m[1]); }
  }
  assert.deepEqual(bad, []);
});

test('JS-generated inline handlers only ever go down (convert them with act() from shared/dom-actions.js)', () => {
  let n = 0;
  for (const f of walk('js')) {
    if (f === 'js/shared/dom-actions.js') continue;
    n += (readFileSync(join(ROOT, f), 'utf8').match(INLINE) || []).length;
  }
  assert.ok(n <= JS_TEMPLATE_INLINE_BASELINE,
    `inline handlers in js/ grew to ${n} (baseline ${JS_TEMPLATE_INLINE_BASELINE}); use act() instead`);
  if (n < JS_TEMPLATE_INLINE_BASELINE) {
    assert.fail(`great — ${n} < ${JS_TEMPLATE_INLINE_BASELINE}. Lower JS_TEMPLATE_INLINE_BASELINE to ${n} in this test.`);
  }
});
