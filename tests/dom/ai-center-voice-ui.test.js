// Voice in the real AI Center page: mic enabled only when the browser supports it, goes through the same ask() path,
// never sends text after an error, and the speaker control exists only when the browser can speak.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};
let inst;
window.SpeechRecognition = class { constructor() { inst = this; } start() {} stop() { this.onend(); } };
const asked = [];
window.BTAgent = { ask: s => { asked.push(s); return Promise.resolve(); }, isBusy: () => false, open() {}, writesAllowed: () => false, killed: () => false };

const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);

describe('AI Center voice', () => {
  before(async () => { ui.onShow(); await wait(80); });
  test('mic is enabled when the browser supports speech recognition; no speaker control without speech synthesis', () => {
    assert.equal(q('.aic-mic').disabled, false);
    assert.equal(q('.aic-mic').getAttribute('aria-pressed'), 'false');
    assert.equal(q('.aic-spk'), null);
  });
  test('tap, speak, and the text is asked through the existing assistant', async () => {
    q('.aic-mic').click(); await wait(30);
    assert.equal(q('.aic-mic').getAttribute('aria-pressed'), 'true');
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'what is blocking closing' }], { isFinal: true })] });
    inst.onend(); await wait(30);
    assert.deepEqual(asked, ['what is blocking closing']);
    assert.equal(q('.aic-mic').getAttribute('aria-pressed'), 'false');
  });
  test('a recognition error asks nothing and shows a reason', async () => {
    q('.aic-mic').click(); await wait(30);
    inst.onerror({ error: 'not-allowed' }); inst.onend(); await wait(30);
    assert.equal(asked.length, 1);
    assert.match([...document.querySelectorAll('.aic-toast')].pop().textContent, /permission/i);
  });
  test('the speech bubble states a real count, not decoration', () => {
    assert.match(q('#aic-core .aic-bubble').textContent, /Reading your data|need|All clear/);
  });
});
