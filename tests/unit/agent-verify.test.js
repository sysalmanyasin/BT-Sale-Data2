// VERIFY step (spec §26): after a change is applied, a verifier READS it back from the app's own store.
// Runs the REAL change tools + REAL verifiers against the real stores. The negative tests tamper with the
// store after the write to prove a failed read-back is reported as "not verified" (never as success).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const LedgerStore = await import('../../js/ledger-store.js');
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/verify.js'); // registers every change tool, then attaches the verifiers
const { runAgent } = await import('../../js/agent/core/agent-client.js');
const T = await import('../../js/agent/core/telemetry.js');

const yes = async () => true;
const phases = [];
const call = (name, args, approve = yes) => reg.runTool(name, args, { writesEnabled: true, approve, onVerify: e => phases.push(e.phase + ':' + e.tool) });
const body = r => JSON.parse(r.text);

before(() => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([{ id: 'e3', staffId: 'EMP-003', name: 'Sara', designation: 'Cashier', active: true }]);
  cfg.DAILY.push({ Date: '02/Oct/2026', Month_Year: 'October 2026', 'Cash Sale': '10000', HBL: '5000', 'COMP SALE': '15000', Customers: '30', TOTAL: '15000', DIFF: null });
  cfg.DAILY.push({ Date: '03/Oct/2026', Month_Year: 'October 2026', 'Cash Sale': '9000', 'COMP SALE': '9000', Customers: '20', TOTAL: '9000', DIFF: null });
  cfg.MONTHLY.push({ Month_Year: 'October 2026', TOTAL: '24000', 'Cash Sale': '19000', 'COMP SALE': '24000', Customers: '50' });
  console.error = q;
});

describe('every change tool has a verifier', () => {
  test('every write/critical tool has a verifier', () => {
    const changeTools = reg.listTools().filter(t => t.risk === 'write' || t.risk === 'critical');
    assert.ok(changeTools.length >= 11);
    const missing = changeTools.filter(t => typeof t.verify !== 'function').map(t => t.name);
    assert.deepEqual(missing, [], 'change tools without a verifier: ' + missing.join(', '));
  });
  test('setVerifier refuses read tools and unknown tools (a verifier can never be bolted onto a read tool)', () => {
    assert.equal(reg.setVerifier('daily_briefing', () => ({ ok: true })), false);
    assert.equal(reg.setVerifier('no_such_tool', () => ({ ok: true })), false);
  });
});

describe('verification after a real write', () => {
  test('ledger entry: verified, reported to onVerify in order start→end, and in the model payload', async () => {
    phases.length = 0;
    const r = await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 300, date: '2026-10-03', desc: 'verify me' });
    assert.equal(r.ok, true);
    assert.equal(r.verified.ok, true);
    assert.ok(r.verified.checks.length >= 3 && r.verified.checks.every(c => c.ok));
    assert.deepEqual(phases, ['start:add_ledger_entry', 'end:add_ledger_entry']);
    assert.equal(body(r).verified, true);
    await r.undo.fn();
  });
  test('tampering after the write is caught: the change is reported NOT verified, the tool still reports what it did', async () => {
    const r = await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 450, date: '2026-10-03', desc: 'tamper' });
    // Re-run the verifier after someone removes the entry from the store.
    const id = body(r).entry_id;
    const { LedgerActions } = await import('../../js/ledger-actions.js');
    LedgerActions.removeEntry(id);
    const v = await reg.getTool('add_ledger_entry').verify({ ledger_type: 'jazzcash', category_id: 'credit', amount: 450 }, body(r));
    assert.equal(v.ok, false);
    assert.equal(v.checks[0].ok, false);
  });
  test('target: verified from the stored targets', async () => {
    const r = await call('set_monthly_target', { month_year: 'November 2026', amount: 1000000 });
    assert.equal(r.verified.ok, true);
    Repository.setItem('bt_targets', JSON.stringify({ 'November 2026': 5 }));
    const v = await reg.getTool('set_monthly_target').verify({ amount: 1000000 }, body(r));
    assert.equal(v.ok, false, 'a different stored value must fail verification');
    Repository.setItem('bt_targets', '{}');
  });
  test('edit daily field: field value AND recalculated TOTAL are both checked', async () => {
    const r = await call('edit_daily_sales_field', { date: '2026-10-02', field: 'cash sale', value: 12000 });
    assert.equal(r.verified.ok, true);
    assert.match(r.verified.checks.map(c => c.label).join('|'), /TOTAL/);
    await r.undo.fn();
  });
  test('add + delete daily sales entry', async () => {
    const add = await call('add_daily_sales_entry', { date: '2026-10-04', fields: { 'Cash Sale': 5000, 'COMP SALE': 5000, Customers: 10 } });
    assert.equal(add.ok, true); assert.equal(add.verified.ok, true);
    const del = await call('delete_daily_sales_entry', { date: '2026-10-04', expected_total: 5000 }, async () => ({ approved: true, typed: 'DELETE' }));
    assert.equal(del.ok, true); assert.equal(del.verified.ok, true);
    assert.match(del.verified.checks[0].label, /gone/);
  });
  test('staff note + credit entry + their deletes', async () => {
    const n = await call('add_staff_note', { staff: 'EMP-003', text: 'verify note' });
    assert.equal(n.verified.ok, true);
    const c = await call('add_staff_credit_entry', { staff: 'EMP-003', amount: 700, desc: 'verify credit', date: '2026-10-03' });
    assert.equal(c.ok, true); assert.equal(c.verified.ok, true);
    const dn = await call('delete_staff_note', { note_id: body(n).note_id }, async () => ({ approved: true, typed: 'DELETE' }));
    assert.equal(dn.verified.ok, true);
    const dc = await call('delete_staff_credit_entry', { staff: 'Sara', month_year: 'October 2026', entry_number: 1, expected_amount: 700 }, async () => ({ approved: true, typed: 'DELETE' }));
    assert.equal(dc.ok, true); assert.equal(dc.verified.ok, true);
  });
  test('remember_fact is verified by reading memory back (stub client): found → verified, missing → not verified', async () => {
    const rows = [];
    const sbStub = { from: () => ({
      insert: row => ({ select: async () => { const r = { id: 7, ...row }; rows.push(r); return { data: [r], error: null }; } }),
      select: () => ({ order: () => ({ limit: async () => ({ data: rows.slice(), error: null }) }) }),
    }) };
    window.btGetSupabaseClient = () => sbStub;
    const r = await call('remember_fact', { fact: 'Closing is at 10pm' });
    assert.equal(r.ok, true); assert.equal(r.verified.ok, true);
    rows.length = 0; // the row vanishes
    const v = await reg.getTool('remember_fact').verify({}, { id: 7 });
    assert.equal(v.ok, false);
    delete window.btGetSupabaseClient;
    const v2 = await reg.getTool('remember_fact').verify({}, { id: 7 });
    assert.equal(v2.ok, false, 'no client → cannot verify → not verified');
  });
  test('a verifier that throws is reported as not verified, and the applied change is not turned into a failure', async () => {
    const tool = reg.getTool('set_monthly_target'); const keep = tool.verify;
    tool.verify = () => { throw new Error('store unreadable'); };
    const r = await call('set_monthly_target', { month_year: 'December 2026', amount: 900 });
    tool.verify = keep;
    assert.equal(r.ok, true, 'the write happened');
    assert.equal(r.verified.ok, false);
    assert.match(body(r).verification_problem, /could not run/);
    await r.undo.fn();
  });
  test('rejected or blocked changes are never verified (nothing was written)', async () => {
    const r = await call('set_monthly_target', { month_year: 'February 2027', amount: 10 }, async () => false);
    assert.equal(r.rejected, true); assert.equal(r.verified, undefined);
    const r2 = await reg.runTool('set_monthly_target', { month_year: 'February 2027', amount: 10 }, { writesEnabled: false, approve: yes });
    assert.equal(r2.ok, false); assert.equal(r2.verified, undefined);
  });
});

describe('telemetry for approve → apply → verify (what the AI Center shows)', () => {
  test('runAgent emits approval_requested (rich), approval_resolved (wait time), verify_start/end in order', async () => {
    T.clear();
    let n = 0;
    const callServer = async () => (++n === 1
      ? { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'set_monthly_target', arguments: JSON.stringify({ month_year: 'January 2027', amount: 777000 }) } }] } }
      : { message: { role: 'assistant', content: 'Done.' } });
    await runAgent({ userText: 'set the January target to 777000', callServer, writesEnabled: true, approve: async () => { await new Promise(r => setTimeout(r, 15)); return true; } });
    const ev = T.recent(100).reverse();
    const types = ev.map(e => e.type);
    for (const t of ['approval_requested', 'approval_resolved', 'verify_start', 'verify_end', 'tool_end'])
      assert.ok(types.includes(t), 'missing ' + t);
    assert.ok(types.indexOf('approval_requested') < types.indexOf('approval_resolved'));
    assert.ok(types.indexOf('approval_resolved') < types.indexOf('verify_start'));
    assert.ok(types.indexOf('verify_start') < types.indexOf('verify_end'));
    assert.ok(types.indexOf('verify_end') < types.indexOf('tool_end'));
    const req = ev.find(e => e.type === 'approval_requested'), res = ev.find(e => e.type === 'approval_resolved');
    assert.ok(req.metadata.approval_id && req.metadata.approval_id === res.metadata.approval_id);
    assert.equal(req.metadata.reversible, true);
    assert.ok(req.metadata.lines.some(l => /Target/.test(l)));
    assert.match(req.metadata.question, /January target/);
    assert.ok(res.duration >= 10, 'approval wait time is measured');
    assert.equal(ev.find(e => e.type === 'verify_end').status, 'ok');
    assert.equal(ev.find(e => e.type === 'tool_end').metadata.verified, true);
    Repository.setItem('bt_targets', '{}');
  });
});
