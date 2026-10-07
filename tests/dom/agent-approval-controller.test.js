// The approval controller that BOTH the assistant's card and the AI Center use. Runs the REAL panel, the REAL runAgent loop,
// the REAL tools and verifiers; only the network (the model) and Supabase are stubbed.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const { LedgerActions } = await import('../../js/ledger-actions.js');
const LedgerStore = await import('../../js/ledger-store.js');
await import('../../js/agent/tools/app.js');
await import('../../js/agent/tools/verify.js');
const { setWritesEnabled } = await import('../../js/agent/core/prefs.js');
const T = await import('../../js/agent/core/telemetry.js');
const { retry } = await import('../../js/agent/core/server.js');
const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
retry.delayMs = 0;

// stubs: Supabase (chainable, kill switch OFF) + the model (a scripted queue)
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() };
window.btGetSupabaseClient = () => sb;
let script = [];
const reply = obj => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => obj });
globalThis.fetch = window.fetch = async () => reply(script.shift() || { message: { role: 'assistant', content: 'ok' } });
const toolCall = (name, args) => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c' + Math.random(), function: { name, arguments: JSON.stringify(args) } }] } });
const final = { message: { role: 'assistant', content: 'Done.' } };
const wait = (ms = 10) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const trusted = { isTrusted: true };

before(async () => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([{ id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true }]);
  cfg.DAILY.push({ Date: '02/Oct/2026', Month_Year: 'October 2026', 'Cash Sale': '10000', HBL: '5000', 'COMP SALE': '15000', Customers: '30', TOTAL: '15000', DIFF: null });
  cfg.MONTHLY.push({ Month_Year: 'October 2026', TOTAL: '15000', 'Cash Sale': '10000', 'COMP SALE': '15000', Customers: '30' });
  setWritesEnabled(true);
  mountAgentPanel();
  await wait(30);
  console.error = q;
});
const A = () => window.BTAgent;

describe('approval controller', () => {
  test('a pending approval is visible with the real preview; stale ids are refused', async () => {
    T.clear(); script = [toolCall('set_monthly_target', { month_year: 'March 2027', amount: 500000 }), final];
    const done = A().ask('set the March target to 500000');
    assert.ok(await until(() => A().approvals().length === 1));
    const p = A().approvals()[0];
    assert.equal(p.tool, 'set_monthly_target'); assert.match(p.preview.lines.join('|'), /500,000/); assert.equal(p.armed, true);
    assert.match(A().decide('ap_nope', 'approve', { gesture: trusted }).error, /no longer waiting/);
    // an untrusted (script-made) event or no event at all can NEVER approve
    assert.match(A().decide(p.id, 'approve', { gesture: { isTrusted: false } }).error, /real tap or click/);
    assert.match(A().decide(p.id, 'approve').error, /real tap or click/);
    assert.equal(A().approvals().length, 1, 'still waiting');
    assert.equal(JSON.parse(Repository.getItem('bt_targets') || '{}')['March 2027'], undefined, 'nothing written without a trusted approval');
    assert.equal(A().decide(p.id, 'approve', { gesture: trusted }).ok, true);
    await done;
    assert.equal(JSON.parse(Repository.getItem('bt_targets'))['March 2027'], 500000);
    const types = T.recent(200).reverse().map(e => e.type);
    assert.ok(types.indexOf('approval_resolved') < types.indexOf('verify_end'));
    assert.equal(T.recent(200).find(e => e.type === 'verify_end').status, 'ok');
  });

  test('rejecting needs no gesture, writes nothing, and is recorded as rejected', async () => {
    T.clear(); script = [toolCall('set_monthly_target', { month_year: 'April 2027', amount: 1 }), final];
    const done = A().ask('set the April target to 1');
    assert.ok(await until(() => A().approvals().length === 1));
    assert.equal(A().decide(A().approvals()[0].id, 'reject').ok, true);
    await done;
    assert.equal(JSON.parse(Repository.getItem('bt_targets'))['April 2027'], undefined);
    assert.equal(T.recent(100).find(e => e.type === 'approval_resolved').status, 'rejected');
    assert.equal(T.recent(100).some(e => e.type === 'verify_start'), false, 'rejected change is never verified');
  });

  test('a STRONG change needs a second confirming approval from the same controller', async () => {
    T.clear(); script = [toolCall('edit_daily_sales_field', { date: '2026-10-02', field: 'Cash Sale', value: 11000 }), final];
    const done = A().ask('fix cash sale on 2 Oct to 11000');
    assert.ok(await until(() => A().approvals().length === 1));
    const id = A().approvals()[0].id;
    assert.equal(A().approvals()[0].armed, false);
    const first = A().decide(id, 'approve', { gesture: trusted });
    assert.deepEqual([first.ok, first.needs], [false, 'confirm']);
    assert.equal(A().approvals()[0].armed, true);
    assert.equal(cfg.DAILY.find(d => d.Date === '02/Oct/2026')['Cash Sale'], '10000', 'one tap changed nothing');
    assert.equal(A().decide(id, 'approve', { gesture: trusted }).ok, true);
    await done;
    assert.equal(cfg.DAILY.find(d => d.Date === '02/Oct/2026')['Cash Sale'], '11000');
  });

  test('a DELETE needs the exact typed word; a wrong word grants nothing', async () => {
    const entry = LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 123, desc: 'to delete' });
    T.clear(); script = [toolCall('delete_ledger_entry', { entry_id: entry.id }), final];
    const done = A().ask('delete that ledger entry');
    assert.ok(await until(() => A().approvals().length === 1));
    const p = A().approvals()[0]; assert.equal(p.preview.confirmWord, 'DELETE');
    const bad = A().decide(p.id, 'approve', { gesture: trusted, typed: 'delet' });
    assert.deepEqual([bad.ok, bad.needs], [false, 'type']);
    assert.ok(LedgerStore.getEntries('jazzcash').some(e => e.id === entry.id));
    assert.equal(A().decide(p.id, 'approve', { gesture: trusted, typed: 'delete' }).ok, true);
    await done;
    assert.equal(LedgerStore.getEntries('jazzcash').some(e => e.id === entry.id), false);
    assert.equal(T.recent(100).find(e => e.type === 'verify_end').status, 'ok');
  });

  test('read-only lock: with changes locked, no approval can even exist', async () => {
    setWritesEnabled(false); T.clear();
    script = [toolCall('set_monthly_target', { month_year: 'May 2027', amount: 9 }), final];
    await A().ask('set the May target to 9');
    assert.equal(A().approvals().length, 0);
    assert.equal(JSON.parse(Repository.getItem('bt_targets'))['May 2027'], undefined);
    setWritesEnabled(true);
  });
});
