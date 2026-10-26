// drive.js is an ES module. _driveAccessToken must stay ONE shared value (auth.js and sheets-*.js
// read/assign it by bare name), the drive bridges must stay exposed, and the auto-backup must be
// hooked to 'bt:app-unlocked' (auth.js dispatches it; nothing patches unlockApp any more).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
let n = 0;
async function load() {
  const dom = new JSDOM('<div id="drive-status"></div>', { url: 'https://bt.example.com/', runScripts: 'outside-only' });
  const w = dom.window;
  for (const k of ['window', 'document', 'localStorage'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true });
  globalThis.addEventListener = w.addEventListener.bind(w);
  const timers = [];
  const realST = globalThis.setTimeout, realSI = globalThis.setInterval;
  globalThis.setTimeout = (fn, ms) => { timers.push(ms); return 0; };
  globalThis.setInterval = () => 0; // drive.js starts a 5-min health interval on 'load'; don't leak it
  await import(`../../js/platform/drive.js?case=${++n}`);
  return { w, timers, restore: () => { globalThis.setTimeout = realST; globalThis.setInterval = realSI; w.close(); } };
}

test('index.html: no classic <script defer> app scripts remain; drive.js is a module', () => {
  const html = read('index.html');
  assert.match(html, /<script type="module" src="js\/platform\/drive\.js\?v=[0-9a-f]{8}"><\/script>/);
  assert.doesNotMatch(html, /<script defer src="js\//);
});

test('_driveAccessToken is one shared window value (bare writes by auth.js are seen everywhere)', async () => {
  const { w, restore } = await load();
  try {
    assert.equal(w._driveAccessToken, '');
    w.eval("_driveAccessToken = 'tok'");            // what auth.js does
    assert.equal(w._driveAccessToken, 'tok');
    assert.equal(w.eval('_driveAccessToken'), 'tok'); // what sheets-*.js does
  } finally { restore(); }
});

test('does not clobber a token already present when the module loads', async () => {
  const dom = new JSDOM('', { url: 'https://bt.example.com/', runScripts: 'outside-only' });
  dom.window._driveAccessToken = 'existing';
  const realSI = globalThis.setInterval; globalThis.setInterval = () => 0;
  for (const k of ['window', 'document', 'localStorage'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? dom.window : dom.window[k] ?? dom.window.document, configurable: true, writable: true });
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  await import(`../../js/platform/drive.js?case=${++n}`);
  assert.equal(dom.window._driveAccessToken, 'existing');
  globalThis.setInterval = realSI; dom.window.close();
});

test('all externally used drive globals are still bridged onto window', async () => {
  const { w, restore } = await load();
  try {
    for (const f of ['_driveSaveToken', 'driveLog', '_driveUpdateBadge', 'driveAuthorize', 'driveBackupNow', 'driveRunDrill',
      'driveRefreshHealth', 'driveOpenRestoreModal', 'driveCloseRestoreModal', '_driveListBackups', '_drivePreviewFile', '_driveRestoreFile'])
      assert.equal(typeof w[f], 'function', f);
    assert.equal(typeof w.DriveVerify, 'object');
  } finally { restore(); }
});

test("auto-backup is scheduled 6s after 'bt:app-unlocked' (and not before it)", async () => {
  const { w, timers, restore } = await load();
  try {
    assert.equal(timers.filter((t) => t === 6000).length, 0);
    w.dispatchEvent(new w.CustomEvent('bt:app-unlocked'));
    assert.equal(timers.filter((t) => t === 6000).length, 1);
  } finally { restore(); }
});
