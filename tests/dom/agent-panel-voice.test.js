// JARVIS voice INSIDE the chat sheet: real panel + real runAgent loop; only the network and the browser's speech engines are faked.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
// browser speech engines (fakes)
let rec; const spoken = []; let cancels = 0;
window.SpeechRecognition = class { constructor() { rec = this; } start() { this.started = true; } stop() { this.onend(); } };
window.speechSynthesis = { cancel: () => { cancels++; }, speak: u => spoken.push(u.text) };
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
await import('../../js/agent/tools/app.js');
const { setWritesEnabled } = await import('../../js/agent/core/prefs.js');
const V = await import('../../js/agent/ui/voice.js');
const { retry } = await import('../../js/agent/core/server.js');
const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
retry.delayMs = 0;
const chain = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()), apply: () => chain() });
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
let script = [];
const reply = obj => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => obj });
globalThis.fetch = window.fetch = async () => reply(script.shift() || { message: { role: 'assistant', content: 'ok' } });
const wait = (ms = 10) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const q = s => document.querySelector(s);

before(async () => { const e = console.error; console.error = () => {}; setWritesEnabled(false); mountAgentPanel(); await wait(30); console.error = e; });

describe('chat sheet voice', () => {
  test('mic and speaker exist because the browser supports them; sheet opens', () => {
    assert.ok(q('#ag-mic') && q('#ag-spk'));
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
    assert.equal(q('#ag-spk').getAttribute('aria-pressed'), 'false', 'spoken answers are OFF by default');
  });
  test('tap, speak: interim text fills the box, the final text is asked through the normal path, nothing speaks while the speaker is off', async () => {
    q('#ag-mic').click();
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'true'); assert.ok(rec.started);
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'who owes' }], { isFinal: false })] });
    assert.equal(q('#ag-text').value, 'who owes');
    script = [{ message: { role: 'assistant', content: 'Nobody owes anything.' } }];
    rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'who owes me money' }], { isFinal: true })] });
    rec.onend();
    assert.ok(await until(() => /Nobody owes anything/.test(q('#ag-log').textContent)));
    assert.match(q('#ag-log').textContent, /Heard: .who owes me money./);
    assert.ok([...document.querySelectorAll('.ag-user')].some(b => b.textContent.includes('who owes me money')), 'asked as a normal user message');
    assert.equal(spoken.length, 0);
    assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'false');
  });
  test('speaker on: the next answer is read aloud (plain text), shared preference is stored, toggling off stops speech', async () => {
    q('#ag-spk').click(); assert.equal(V.getVoiceOut(), true); assert.equal(q('#ag-spk').getAttribute('aria-pressed'), 'true');
    script = [{ message: { role: 'assistant', content: '**Done.** All good.' } }];
    window.BTAgent.ask('status please');
    assert.ok(await until(() => spoken.length === 1));
    assert.equal(spoken[0], 'Done. All good.');
    const c = cancels; q('#ag-spk').click(); assert.equal(V.getVoiceOut(), false); assert.ok(cancels > c);
  });
  test('an error asks nothing and says why; closing the sheet stops listening', async () => {
    const asked = [...document.querySelectorAll('.ag-user')].length;
    await until(() => !q('#ag-mic').disabled);
    q('#ag-mic').click(); rec.onerror({ error: 'not-allowed' }); rec.onend();
    assert.match(q('#ag-log').textContent, /permission was denied/i);
    assert.equal([...document.querySelectorAll('.ag-user')].length, asked);
    q('#ag-mic').click(); assert.equal(q('#ag-mic').getAttribute('aria-pressed'), 'true');
    q('.ag-x, #ag-close, [aria-label="Close"]')?.click();
  });
});
