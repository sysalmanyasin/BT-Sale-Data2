// Inline event handlers (onclick="...") are being retired in favour of the delegated dispatcher in
// js/shared/dom-actions.js (data-on-click="action" data-args='[...]').
//   * index.html must contain NONE (it is fully migrated).
//   * Every action index.html references must resolve to a real window export / registered action,
//     so a typo or a removed function fails CI instead of failing silently on a tap.
//   * js/ (JS-generated HTML) must contain NONE either: build attributes with act() from shared/dom-actions.js.
//   * Every literal action name passed to act() must resolve too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const INLINE = /\son(?:click|input|change|keydown|keyup|focus|blur|submit)=["'\\$]/g;

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

function exposedNames() {
  const exposed = new Set(['clickElement', 'noop']);
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
    // Object.assign(window, X) where X is a named object defined elsewhere in the same file
    for (const m of s.matchAll(/Object\.assign\(\s*window\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const def = s.match(new RegExp('const\\s+' + m[1] + '\\s*=\\s*(?:Object\\.freeze\\()?\\{([\\s\\S]*?)\\}'));
      if (def) for (const k of def[1].matchAll(ident)) exposed.add(k[1]);
    }
  }
  return exposed;
}

test('every data-on-* action in index.html resolves to an exported/registered function', () => {
  const exposed = exposedNames();
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

test('js/ has no inline event-handler attributes (use act() from shared/dom-actions.js)', () => {
  const offenders = [];
  for (const f of walk('js')) {
    if (f === 'js/shared/dom-actions.js') continue;
    const n = (readFileSync(join(ROOT, f), 'utf8').match(INLINE) || []).length;
    if (n) offenders.push(`${f} (${n})`);
  }
  assert.deepEqual(offenders, []);
});

test('every literal action name passed to act() resolves to an exported/registered function', () => {
  const exposed = exposedNames();
  const unresolved = new Set();
  for (const f of walk('js')) {
    if (f === 'js/shared/dom-actions.js') continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    // act('event', 'name' ...)  |  act('event', { ...opts }, 'name' ...)
    for (const m of src.matchAll(/\bact\(\s*'\w+'\s*,\s*(?:\{[^}]*\}\s*,\s*)?'([\w.$]+)'/g)) {
      if (!exposed.has(m[1].split('.')[0])) unresolved.add(`${m[1]}  (${f})`);
    }
    // then: [['name', ...], ...]
    for (const m of src.matchAll(/then:\s*\[((?:\[[^\]]*\]\s*,?\s*)+)\]/g)) {
      for (const n of m[1].matchAll(/\[\s*'([\w.$]+)'/g)) if (!exposed.has(n[1].split('.')[0])) unresolved.add(`${n[1]}  (${f})`);
    }
  }
  assert.deepEqual([...unresolved], [], 'these act() actions are never exported on window or registered');
});

test('files that use act()/arg/registerActions import them from shared/dom-actions.js', () => {
  const bad = [];
  for (const f of walk('js')) {
    if (f === 'js/shared/dom-actions.js') continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*shared\/dom-actions\.js'/);
    const have = new Set(imp ? imp[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()) : []);
    if (src.includes('window.BTDomActions')) continue; // classic (non-module) scripts use the window shim
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/(?<![\w$.'"])act\(\s*'/.test(code) && !have.has('act')) bad.push(`${f}: act`);
    if (/(?<![\w$.'"])arg\.(self|value|checked|event)\b/.test(code) && !have.has('arg')) bad.push(`${f}: arg`);
    if (/(?<![\w$.'"])registerActions\(/.test(code) && !have.has('registerActions')) bad.push(`${f}: registerActions`);
  }
  assert.deepEqual(bad, []);
});

test('classic (non-module) scripts reach the dispatcher only through the window.BTDomActions shim', () => {
  const classic = walk('js').filter((f) => f !== 'js/shared/dom-actions.js').filter((f) => {
    const s = readFileSync(join(ROOT, f), 'utf8');
    return s.includes('window.BTDomActions');
  });
  for (const f of classic) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!/^\s*import\s/m.test(s), `${f} is loaded as a classic script in tests and must not use import`);
  }
  assert.ok(readFileSync(join(ROOT, 'js/shared/dom-actions.js'), 'utf8').includes('window.BTDomActions = Object.freeze'));
});
