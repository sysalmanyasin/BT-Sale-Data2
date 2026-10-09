// The BT assistant chat lives on the BT Intelligence page ONLY: the floating button elsewhere just takes you there and
// opens the chat on arrival; leaving the page closes it.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
globalThis.fetch = window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => ({ message: { role: 'assistant', content: 'ok' } }) });
const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);

describe('assistant chat is scoped to BT Intelligence', () => {
  before(async () => { const e = console.error; console.error = () => {}; mountAgentPanel(); await wait(30); console.error = e; });

  test('the floating button is labelled BT Intelligence and the old header shortcut is gone', () => {
    assert.equal(q('#ag-fab').getAttribute('aria-label'), 'Open BT Intelligence');
    assert.equal(q('#ag-center'), null);
  });

  test('away from the page: tapping the button navigates there and the chat is NOT opened in place', async () => {
    document.body.classList.remove('aic-open');
    q('#ag-fab').click();
    await wait(10);
    assert.equal(window.location.hash, '#ai-center');
    assert.equal(q('#ag-sheet').hidden, true, 'chat must not open on other pages');
  });

  test('once BT Intelligence is showing, the chat opens', async () => {
    document.body.classList.add('aic-open');
    await wait(120);
    assert.equal(q('#ag-sheet').hidden, false);
  });

  test('leaving BT Intelligence closes the chat', async () => {
    document.body.classList.remove('aic-open');
    window.dispatchEvent(new window.Event('hashchange'));
    await wait(250);
    assert.equal(q('#ag-sheet').hidden, true);
  });
});
