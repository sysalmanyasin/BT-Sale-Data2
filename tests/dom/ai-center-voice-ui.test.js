// Voice in the ONE global Jarvis panel, used while BT Intelligence is open: the mic and speaker live in the panel, the spoken
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

describe('Jarvis voice while BT Intelligence is open', () => {
  before(async () => { const e = console.error; console.error = () => {}; mountAgentPanel(); ui.onShow(); await wait(120); window.BTAgent.open(); await wait(60); console.error = e; });
  test('the mic lives in the panel; the page has no second mic or input', () => {
    assert.ok(q('#ag-sheet #ag-mic'), 'mic inside the panel');
    assert.equal(document.querySelectorAll('.aic-mic, #aic-q').length, 0, 'no second voice/input control on the page');
    assert.equal(q('#ag-mic').disabled, false);
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
    assert.equal(q('#ag-spk'), null, 'no speaker control without speech synthesis');
  });
  test('tap, speak: the listening strip shows what is heard, then the text is asked through the one assistant', async () => {
    q('#ag-mic').click(); await wait(30);
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'true');
    assert.ok(q('#ag-sheet').classList.contains('ag-lis'), 'listening state is shown');
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'who owes' }], { isFinal: false })] });
    assert.equal(q('#ag-interim').textContent, 'who owes', 'live transcript');
    inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'who owes me money' }], { isFinal: true })] });
    inst.onend();
    assert.ok(await until(() => /Nobody owes anything/.test(q('#ag-log').textContent)));
    assert.ok([...document.querySelectorAll('#ag-log .ag-user')].some(b => b.textContent.includes('who owes me money')));
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
    assert.ok(!q('#ag-sheet').classList.contains('ag-lis'));
  });
  test('a recognition error asks nothing and shows a reason in the chat', async () => {
    await until(() => !q('#ag-mic').disabled);
    const asked = document.querySelectorAll('#ag-log .ag-user').length;
    q('#ag-mic').click(); await wait(30);
    inst.onerror({ error: 'not-allowed' }); inst.onend(); await wait(30);
    assert.equal(document.querySelectorAll('#ag-log .ag-user').length, asked);
    assert.match(q('#ag-log').textContent, /permission was denied/i);
  });
  test('voice settings open in the panel (replacing the old avatar settings) and say voice cannot approve', () => {
    q('#ag-vox').click();
    assert.match(q('#ag-log').textContent, /Voice settings/);
    assert.match(q('#ag-log').textContent, /Voice can never approve/);
    assert.equal(document.querySelectorAll('input[type=file]').length, 0, 'no photo upload any more');
  });
});
