// storage.js is an ES module. _curPage must remain a shared window property so ui.js's bare
// `_curPage = id` and getCurrentPage() stay in sync; the IDB/render-cache bridges must stay exposed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
let n = 0;
async function load() {
  const dom = new JSDOM('<input id="idx-search"><input id="data-search">', { url: 'https://bt.example.com/', runScripts: 'outside-only' });
  const w = dom.window;
  for (const k of ['window', 'document']) Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w.document, configurable: true, writable: true });
  w.MONTHLY = []; w.DAILY = [];
  globalThis.MONTHLY = w.MONTHLY; globalThis.DAILY = w.DAILY; // bare names in the module resolve on Node's global here
  await import(`../../js/platform/storage.js?case=${++n}`);
  return w;
}

test('index.html loads storage.js as an ES module', () => {
  assert.match(read('index.html'), /<script type="module" src="js\/platform\/storage\.js\?v=[0-9a-f]{8}"><\/script>/);
});
test('getCurrentPage follows a classic-script style bare assignment to _curPage', async () => {
  const w = await load();
  assert.equal(w.getCurrentPage(), '');
  w.eval("_curPage = 'data'");           // exactly what ui.js showPage() does
  assert.equal(w.getCurrentPage(), 'data');
  assert.equal(w.eval('_curPage'), 'data'); // and bare reads (drive.js, app-init.js) see it
});
test('does not clobber an already-set _curPage', async () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  dom.window._curPage = 'cover';
  for (const k of ['window', 'document']) Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window.document, configurable: true, writable: true });
  dom.window.MONTHLY = []; dom.window.DAILY = [];
  await import(`../../js/platform/storage.js?case=${++n}`);
  assert.equal(dom.window.getCurrentPage(), 'cover');
});
test('IDB + render-cache bridges are still exposed', async () => {
  const w = await load();
  for (const f of ['_rcKey', 'invalidateRenderCache', 'idbSaveData', 'idbLoadData']) assert.equal(typeof w[f], 'function', f);
  assert.equal(typeof w._rc, 'object');
});
test('_rcKey keys the index page on MONTHLY length (render cache contract)', async () => {
  const w = await load();
  globalThis.MONTHLY = [1, 2, 3]; w.document.getElementById('idx-search').value = 'abc';
  assert.equal(w._rcKey('index'), 'abc||date|3');
  assert.equal(w._rcKey('nope'), null);
});
