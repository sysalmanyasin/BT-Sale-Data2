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

  test('away from the page: tapping the button navigates there and the chat stays parked (hidden), not opened in place', async () => {
    document.body.classList.remove('aic-open');
    q('#ag-fab').click();
    await wait(10);
    assert.equal(window.location.hash, '#ai-center');
    assert.equal(q('#ag-sheet').hidden, true, 'chat must not open on other pages');
    assert.equal(q('#ag-sheet').parentNode, document.body);
  });

  test('once BT Intelligence docks the chat into its page, it is visible there, and the button hides', async () => {
    document.body.classList.add('aic-open');
    const slot = document.createElement('div'); slot.id = 'slot'; document.body.append(slot);
    assert.equal(window.BTAgent.dock(slot), true);
    await wait(30);
    assert.equal(q('#ag-sheet').hidden, false);
    assert.equal(q('#ag-sheet').parentNode, slot, 'chat lives inside the page slot, not floating on the body');
    assert.ok(q('#ag-sheet').classList.contains('ag-docked'));
    assert.ok(q('#ag-fab').classList.contains('ag-hide'));
    assert.equal(q('#ag-close'), null, 'no close button: the chat is part of the page');
    // docking again (every page repaint) is harmless and does not wipe the conversation
    const before = q('#ag-log').innerHTML;
    window.BTAgent.dock(slot);
    assert.equal(q('#ag-log').innerHTML, before);
  });

  test('leaving BT Intelligence parks the chat (hidden, back on the body)', async () => {
    document.body.classList.remove('aic-open');
    window.dispatchEvent(new window.Event('hashchange'));
    await wait(250);
    assert.equal(q('#ag-sheet').hidden, true);
    assert.equal(q('#ag-sheet').parentNode, document.body);
    assert.ok(!q('#ag-fab').classList.contains('ag-hide'));
  });
});
