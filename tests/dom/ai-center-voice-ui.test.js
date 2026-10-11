// Voice in the ONE chat on the real BT Intelligence page: the mic and speaker live in the docked assistant chat, the spoken
// text goes through the same ask() path as typing, and an error asks nothing and says why.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.invalidateRenderCache = () => {};
let inst;
window.SpeechRecognition = class { constructor() { inst = this; } start() {} stop() { this.onend(); } };
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
globalThis.fetch = window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => ({ message: { role: 'assistant', content: 'Nobody owes anything.' } }) });

const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const q = s => document.querySelector(s);

describe('AI Center voice (one chat)', () => {
  before(async () => { const e = console.error; console.error = () => {}; mountAgentPanel(); ui.onShow(); await wait(120); console.error = e; });
  test('the mic lives in the docked chat; the page has no second mic or input', () => {
    assert.ok(q('#aic-chat #ag-mic'), 'mic inside the chat card');
    assert.equal(document.querySelectorAll('.aic-mic, #aic-q').length, 0, 'no second voice/input control on the page');
    assert.equal(q('#ag-mic').disabled, false);
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
    assert.equal(q('#ag-spk'), null, 'no speaker control without speech synthesis');
  });
  test('tap, speak, and the text is asked through the one assistant and answered in the thread', async () => {
    q('#ag-mic').click(); await wait(30);
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'true');
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'who owes me money' }], { isFinal: true })] });
    inst.onend();
    assert.ok(await until(() => /Nobody owes anything/.test(q('#aic-chat #ag-log').textContent)));
    assert.ok([...document.querySelectorAll('#aic-chat .ag-user')].some(b => b.textContent.includes('who owes me money')));
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
  });
  test('a recognition error asks nothing and shows a reason in the chat', async () => {
    await until(() => !q('#ag-mic').disabled);
    const asked = document.querySelectorAll('#aic-chat .ag-user').length;
    q('#ag-mic').click(); await wait(30);
    inst.onerror({ error: 'not-allowed' }); inst.onend(); await wait(30);
    assert.equal(document.querySelectorAll('#aic-chat .ag-user').length, asked);
    assert.match(q('#aic-chat #ag-log').textContent, /permission was denied/i);
  });
  test('the one-line summary lives in Needs attention (no decorative speech bubble)', () => {
    assert.equal(q('#aic-core .aic-bubble'), null);
    assert.match(q('#aic-att').textContent, /NEEDS ATTENTION/);
  });
});
