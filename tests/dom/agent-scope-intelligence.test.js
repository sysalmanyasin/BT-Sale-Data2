// Jarvis is ONE floating assistant on every page: the button is always there (except the Emergency Billing counter screen),
// it opens a compact panel over the current page without navigating, it knows which page you are on, it offers starter
// questions for Sales / Inventory / Cash / Audit, and an approval that is waiting stays waiting when the panel is closed
// or the page changes. Real panel, real runAgent loop, real tools; only the network and Supabase are stubbed.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body>'
  + ['index', 'inventory', 'closing-book', 'assignments', 'cover', 'emergency-billing', 'ai-center'].map(id => '<div class="page' + (id === 'index' ? ' on' : '') + '" id="page-' + id + '"></div>').join('')
  + '</body></html>');
globalThis.invalidateRenderCache = () => {};
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
await import('../../js/agent/tools/app.js');
await import('../../js/agent/tools/writes.js');
await import('../../js/agent/tools/verify.js');
const { setWritesEnabled } = await import('../../js/agent/core/prefs.js');
const { retry } = await import('../../js/agent/core/server.js');
const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
retry.delayMs = 0;
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
let script = [];
const reply = obj => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => obj });
globalThis.fetch = window.fetch = async () => reply(script.shift() || { message: { role: 'assistant', content: 'ok' } });
const toolCall = (name, args) => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c' + Math.random(), function: { name, arguments: JSON.stringify(args) } }] } });
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const q = s => document.querySelector(s);
const chips = () => [...document.querySelectorAll('#ag-chips .ag-chip')].map(b => b.textContent);
const goPage = async id => { document.querySelectorAll('.page').forEach(p => p.classList.remove('on')); q('#page-' + id).classList.add('on'); await wait(30); };

describe('Jarvis is one global assistant', () => {
  before(async () => { const e = console.error; console.error = () => {}; setWritesEnabled(false); mountAgentPanel(); await wait(30); console.error = e; });

  test('the button says Ask Jarvis, the old header shortcut is gone, and the panel starts closed', () => {
    assert.equal(q('#ag-fab').getAttribute('aria-label'), 'Ask Jarvis');
    assert.equal(q('#ag-center'), null);
    assert.equal(q('#ag-sheet').hidden, true);
    assert.equal(document.querySelectorAll('#ag-sheet').length, 1);
  });

  test('tapping the button opens the panel over the current page: no navigation, the page stays on', async () => {
    const hash = window.location.hash;
    q('#ag-fab').click(); await wait(30);
    assert.equal(q('#ag-sheet').hidden, false);
    assert.equal(window.location.hash, hash, 'did not navigate');
    assert.ok(q('#page-index').classList.contains('on'), 'the page behind is unchanged');
    assert.equal(q('#ag-sheet').parentNode, document.body, 'floats over the page');
    assert.ok(q('#ag-fab').classList.contains('ag-hide'), 'the button steps aside while the panel is open');
    assert.match(q('#ag-ctx').textContent, /Viewing\s*Sales · Sale Data/);
  });

  test('every header tool is still there, now inside one menu', () => {
    ['#ag-hist', '#ag-mem', '#ag-stats', '#ag-vox', '#ag-kill', '#ag-lock', '#ag-clear'].forEach(id => assert.ok(q('#ag-menu ' + id), id + ' missing from the menu'));
    assert.equal(q('#ag-menu').hidden, true);
    q('#ag-more').click(); assert.equal(q('#ag-menu').hidden, false); assert.equal(q('#ag-more').getAttribute('aria-expanded'), 'true');
    q('#ag-lock').click(); assert.equal(q('#ag-menu').hidden, true, 'choosing an item closes the menu');
  });

  test('starter questions follow the page: Sales, Inventory, Cash, Audit', async () => {
    assert.ok(chips().includes("How are today's sales?"));
    await goPage('inventory'); assert.match(q('#ag-ctx').textContent, /Inventory · Inventory/); assert.ok(chips().includes('What is low on stock?'));
    await goPage('closing-book'); assert.match(q('#ag-ctx').textContent, /Cash · Closing Book/); assert.ok(chips().includes('What is blocking closing?'));
    await goPage('assignments'); assert.match(q('#ag-ctx').textContent, /Audit/); assert.ok(chips().includes('What expires soon?'));
    await goPage('cover'); assert.ok(chips().includes('What needs my attention today?'), 'pages with no area get the general questions');
  });

  test('moving to another page keeps the conversation and marks the switch', async () => {
    await goPage('index');
    script = [{ message: { role: 'assistant', content: 'Sales look fine.' } }];
    q('#ag-chips .ag-chip').click();
    assert.ok(await until(() => /Sales look fine/.test(q('#ag-log').textContent)));
    await goPage('inventory');
    assert.match(q('#ag-log').textContent, /Sales look fine/, 'the chat is kept');
    assert.match(q('#ag-log .ag-divl:last-of-type').textContent, /Now viewing Inventory/);
  });

  test('closing keeps the thread; the panel and button swap back; Escape closes', async () => {
    q('#ag-close').click();
    assert.equal(q('#ag-sheet').hidden, true); assert.ok(!q('#ag-fab').classList.contains('ag-hide'));
    q('#ag-fab').click(); await wait(10);
    assert.match(q('#ag-log').textContent, /Sales look fine/);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(q('#ag-sheet').hidden, true);
  });

  test('on Emergency Billing the button is hidden so it never covers a counter-sale control', async () => {
    await goPage('emergency-billing');
    assert.ok(q('#ag-fab').classList.contains('ag-hide'));
    await goPage('index');
    assert.ok(!q('#ag-fab').classList.contains('ag-hide'));
  });

  test('BTAgent.ask from anywhere (e.g. an AI Center button) opens the panel and answers there', async () => {
    await goPage('ai-center');
    script = [{ message: { role: 'assistant', content: 'Closing needs Counter 2.' } }];
    window.BTAgent.ask('what is blocking closing');
    assert.ok(await until(() => /Counter 2/.test(q('#ag-log').textContent)));
    assert.equal(q('#ag-sheet').hidden, false);
    assert.equal(window.BTAgent.isOpen(), true);
    assert.equal(typeof window.BTAgent.dock, 'undefined', 'there is no second docked chat');
    window.BTAgent.close();
  });

  test('an approval left waiting stays waiting when the panel is closed and the page changes; the button shows an amber count', async () => {
    setWritesEnabled(true);
    await goPage('index');
    script = [toolCall('set_monthly_target', { month_year: 'March 2027', amount: 500000 }), { message: { role: 'assistant', content: 'Done.' } }];
    const done = window.BTAgent.ask('set the March target to 500000');
    assert.ok(await until(() => window.BTAgent.approvals().length === 1));
    window.BTAgent.close();
    await goPage('closing-book');
    assert.equal(window.BTAgent.approvals().length, 1, 'still pending');
    const badge = q('#ag-fab .ag-badge');
    assert.equal(badge.hidden, false); assert.ok(badge.classList.contains('ag-appr')); assert.equal(badge.textContent, '1');
    assert.equal(JSON.parse(Repository.getItem('bt_targets') || '{}')['March 2027'], undefined, 'nothing is saved while it waits');
    q('#ag-fab').click(); await wait(20);
    assert.ok(q('#ag-log .ag-card .ag-yes'), 'the approval card is waiting in the panel');
    const p = window.BTAgent.approvals()[0];
    assert.match(window.BTAgent.decide(p.id, 'approve', { gesture: { isTrusted: false } }).error, /real tap or click/, 'a script can never approve');
    assert.equal(window.BTAgent.decide(p.id, 'approve', { gesture: { isTrusted: true } }).ok, true);
    await done;
    assert.equal(JSON.parse(Repository.getItem('bt_targets'))['March 2027'], 500000);
    assert.ok(!badge.classList.contains('ag-appr'), 'the amber count clears once decided');
  });
});
