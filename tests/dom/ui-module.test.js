// ui.js is an ES module. showPage is monkey-patched by ui-extras.js, so ui.js's own callers
// (navigateTo, hash router) must run the PATCHED window.showPage, and ui.js must stay
// strict-mode clean (a module is always strict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function strictWindow(t) {
  const dom = new JSDOM(html, { url: 'https://bt.example.com/index.html' });
  const w = dom.window;
  const errors = [];
  w.console.error = (...a) => errors.push(a.join(' '));
  vm.createContext(w);
  w._curPage = ''; // storage.js (loaded before ui.js in the real page) defines this window property
  // Wrap in a function scope so declarations are PRIVATE like a real ES module (a bare classic script
  // would leak them to the global object and hide exactly the bug these tests are for).
  vm.runInContext('(function(){"use strict";\n' + read('js/ui/ui.js') + '\n})();', w, { filename: 'ui.js' });
  t.after(() => w.close());
  return { w, errors };
}

test('index.html loads ui.js as an ES module', () => {
  assert.match(html, /<script type="module" src="js\/ui\/ui\.js\?v=[0-9a-f]{8}"><\/script>/);
});

test('ui.js loads and routes pages under strict mode with no strict-only failures', (t) => {
  const { w, errors } = strictWindow(t);
  for (const id of ['dashboard', 'data', 'entry', 'manager', 'closing-book', 'inventory', 'str', 'cover', 'tools'])
    assert.doesNotThrow(() => w.showPage(id), id);
  assert.deepEqual(errors.filter((e) => /is not defined|Cannot assign|read only/i.test(e)), []);
  assert.equal(w._curPage, 'tools'); // _curPage is a plain window property shared with storage.js / drive.js
});

test('navigateTo() runs a showPage patched by ui-extras.js', (t) => {
  const { w } = strictWindow(t);
  const seen = [];
  const original = w.showPage;
  w.showPage = function (page) { seen.push(page); return original.call(this, page); }; // what ui-extras.js does
  w.navigateTo('cover');
  assert.deepEqual(seen, ['cover']);
});

test('the hash router runs a showPage patched by ui-extras.js', (t) => {
  const { w } = strictWindow(t);
  const seen = [];
  const original = w.showPage;
  w.showPage = function (page) { seen.push(page); return original.call(this, page); };
  assert.equal(w._routeFromHash('#dashboard'), true);
  assert.deepEqual(seen, ['dashboard']);
});

test('#pos still only routes (no sign-in-free path): it is just an alias to the billing page', (t) => {
  const { w } = strictWindow(t);
  assert.equal(w._routeFromHash('#pos'), true);
  assert.equal(w._curPage, 'emergency-billing');
});

test('every previously-global ui.js name used elsewhere is still on window', (t) => {
  const { w } = strictWindow(t);
  for (const f of ['showPage', 'navigateTo', 'rebuildDropdowns', 'rebuildAll', 'addNewMonth', 'exportCSV', 'exportJSON', 'importJSON', 'toast', '_routeFromHash'])
    assert.equal(typeof w[f], 'function', f);
});

test('source: ui.js never calls the module-local showPage directly', () => {
  const code = stripComments(read('js/ui/ui.js'));
  const calls = [...code.matchAll(/(?<![\w$.])showPage\s*\(/g)];
  assert.equal(calls.length, 1, 'only the function declaration may mention bare showPage(');
  assert.match(code, /function showPage\(/);
  assert.match(code, /window\.showPage\s*=\s*showPage;/);
});
