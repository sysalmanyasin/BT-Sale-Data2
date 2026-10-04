// Delete tools: typed confirmation, exact-target guards, correct removal, undo.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const LedgerStore = await import('../../js/ledger-store.js');
const { LedgerActions } = await import('../../js/ledger-actions.js');
const notes = await import('../../js/staff-notes.js');
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/manager.js');
await import('../../js/agent/tools/credit.js');
await import('../../js/agent/tools/deletes.js');

const typed = async () => ({ approved: true, typed: 'DELETE' });
const tapOnly = async () => true;
const opts = approve => ({ writesEnabled: true, approve });
const del = (name, args, approve = typed) => reg.runTool(name, args, opts(approve));
const body = r => JSON.parse(r.text);
const KEY = 'BT_ManagerWork_v1';
const blob = () => JSON.parse(Repository.getItem(KEY));

let ledgerId, noteId;
const dayRec = (d, total) => ({ Date: String(d).padStart(2, '0') + '/Oct/2026', Month_Year: 'October 2026', 'Cash Sale': String(total), HBL: null, 'COMP SALE': String(total), Customers: '20', TOTAL: String(total), DIFF: null });

before(() => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([{ id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true }]);
  console.error = q;
});
beforeEach(() => {
  const q = console.error; console.error = () => {};
  // ledger
  LedgerStore.getEntries('jazzcash').slice().forEach(e => LedgerActions.removeEntry(e.id));
  ledgerId = LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 300, desc: 'to delete' }).id;
  LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 700, desc: 'keep me' });
  // note
  Repository.setItem('bt_staff_notes_v1', '[]');
  noteId = notes.addNote('e1', 'delete this note').id; notes.addNote('e1', 'keep this note');
  // credit
  Repository.setItem(KEY, JSON.stringify({ other: 1, credit: { 'October 2026': [{ name: 'Ali Khan', prevBal: 0, entries: [
    { date: '01-Oct-2026', desc: 'a', amount: 1000 }, { date: '02-Oct-2026', desc: 'b', amount: 2000 }, { date: '03-Oct-2026', desc: 'c', amount: 3000 }], salary: 0, lessGeneric: 0 }] } }));
  // daily
  cfg.DAILY.splice(0, cfg.DAILY.length); cfg.MONTHLY.splice(0, cfg.MONTHLY.length);
  cfg.DAILY.push(dayRec(1, 10000), dayRec(2, 20000), { ...dayRec(1, 5000), Date: '01/Sep/2026', Month_Year: 'September 2026' });
  cfg.recomputeMonthly('October 2026'); cfg.recomputeMonthly('September 2026');
  console.error = q;
});

describe('all delete tools', () => {
  for (const n of ['delete_ledger_entry', 'delete_staff_note', 'delete_staff_credit_entry', 'delete_daily_sales_entry'])
    test(n + ' is critical and not offered while locked', () => {
      assert.equal(reg.getTool(n).risk, 'critical');
      assert.ok(!reg.getToolSchemas().some(t => t.function.name === n));
    });
});

describe('delete_ledger_entry', () => {
  test('read tool exposes ids', async () => {
    const r = body(await reg.runTool('get_ledger_entries', { ledger_type: 'jazzcash' }));
    assert.ok(r.entries.every(e => typeof e.id === 'string' && e.id));
  });
  test('unknown id is rejected before any card', async () => {
    let asked = false;
    const r = await del('delete_ledger_entry', { entry_id: 'nope' }, async () => { asked = true; return typed(); });
    assert.equal(r.ok, false); assert.equal(asked, false);
  });
  test('tap-only approval does not delete', async () => {
    const n = LedgerStore.getEntries('jazzcash').length;
    const r = await del('delete_ledger_entry', { entry_id: ledgerId }, tapOnly);
    assert.equal(r.rejected, true); assert.equal(LedgerStore.getEntries('jazzcash').length, n);
  });
  test('typed delete removes exactly that entry; undo restores it', async () => {
    const bal = LedgerStore.getCurrentBalance('jazzcash');
    let p;
    const r = await del('delete_ledger_entry', { entry_id: ledgerId }, async req => { p = req.preview; return typed(); });
    assert.equal(r.ok, true); assert.equal(p.confirmWord, 'DELETE'); assert.equal(p.strong, true);
    assert.match(p.lines.join('|'), /Amount: Rs 300/);
    assert.equal(LedgerStore.getCurrentBalance('jazzcash'), bal - 300);
    assert.ok(LedgerStore.getEntries('jazzcash').some(e => e.desc === 'keep me'));
    await r.undo.fn();
    assert.equal(LedgerStore.getCurrentBalance('jazzcash'), bal);
    assert.ok(LedgerStore.getEntries('jazzcash').some(e => e.desc === 'to delete' && e.amount === 300));
  });
});

describe('delete_staff_note', () => {
  test('get_staff_notes returns ids; delete removes only that note; undo restores the original', async () => {
    const list = body(await reg.runTool('get_staff_notes', { staff: 'EMP-001' }));
    assert.equal(list.notes.length, 2); assert.ok(list.notes.some(n => n.id === noteId));
    const r = await del('delete_staff_note', { note_id: noteId });
    assert.equal(r.ok, true);
    assert.deepEqual(notes.getNotes('e1').map(n => n.text), ['keep this note']);
    await r.undo.fn();
    assert.ok(notes.getNotes('e1').some(n => n.id === noteId && n.text === 'delete this note'));
    assert.equal(notes.getNotes('e1').length, 2);
  });
  test('unknown id and tap-only are refused', async () => {
    assert.equal((await del('delete_staff_note', { note_id: 'zzz' })).ok, false);
    assert.equal((await del('delete_staff_note', { note_id: noteId }, tapOnly)).rejected, true);
    assert.equal(notes.getNotes('e1').length, 2);
  });
});

describe('delete_staff_credit_entry', () => {
  const args = (n, amt) => ({ staff: 'Ali Khan', month_year: 'Oct 2026', entry_number: n, expected_amount: amt });
  test('get_staff_credit numbers the entries', async () => {
    const r = body(await reg.runTool('get_staff_credit', { staff: 'Ali Khan', month_year: 'October 2026' }));
    assert.deepEqual(r.entries.map(e => e.n), [1, 2, 3]);
  });
  test('wrong expected amount / out-of-range number are caught in preview', async () => {
    assert.match((await del('delete_staff_credit_entry', args(2, 999))).text, /read it again/);
    assert.match((await del('delete_staff_credit_entry', args(9, 1))).text, /does not exist/);
    assert.equal(blob().credit['October 2026'][0].entries.length, 3);
  });
  test('deletes the right entry only; undo restores it at the same position', async () => {
    const r = await del('delete_staff_credit_entry', args(2, 2000));
    assert.equal(r.ok, true);
    const row = blob().credit['October 2026'][0];
    assert.deepEqual(row.entries.map(e => e.desc), ['a', 'c']);
    assert.equal(blob().other, 1);
    assert.equal(body(r).net_owed_now, 4000);
    await r.undo.fn();
    assert.deepEqual(blob().credit['October 2026'][0].entries.map(e => e.desc), ['a', 'b', 'c']);
  });
  test('tap-only approval does not delete; corrupt data refuses', async () => {
    assert.equal((await del('delete_staff_credit_entry', args(2, 2000), tapOnly)).rejected, true);
    assert.equal(blob().credit['October 2026'][0].entries.length, 3);
    Repository.setItem(KEY, '{bad');
    assert.match((await del('delete_staff_credit_entry', args(2, 2000))).text, /could not be read/);
    assert.equal(Repository.getItem(KEY), '{bad');
  });
});

describe('delete_daily_sales_entry', () => {
  test('wrong expected total, missing day and only-day-in-month are refused', async () => {
    assert.match((await del('delete_daily_sales_entry', { date: '2026-10-02', expected_total: 1 })).text, /not Rs 1/);
    assert.match((await del('delete_daily_sales_entry', { date: '2026-10-09', expected_total: 1 })).text, /No sales entry/);
    assert.match((await del('delete_daily_sales_entry', { date: '2026-09-01', expected_total: 5000 })).text, /only day entered/);
    assert.equal(cfg.DAILY.length, 3);
  });
  test('tap-only approval does not delete', async () => {
    assert.equal((await del('delete_daily_sales_entry', { date: '2026-10-02', expected_total: 20000 }, tapOnly)).rejected, true);
    assert.equal(cfg.DAILY.length, 3);
  });
  test('typed delete removes the day and recomputes the month; undo restores both', async () => {
    let p;
    const r = await del('delete_daily_sales_entry', { date: '2026-10-02', expected_total: 20000 }, async req => { p = req.preview; return typed(); });
    assert.equal(r.ok, true);
    assert.match(p.lines.join('|'), /October 2026 total: Rs 30,000 → Rs 10,000/);
    assert.ok(!cfg.DAILY.some(d => d.Date === '02/Oct/2026'));
    assert.equal(cfg.MONTHLY.find(m => m.Month_Year === 'October 2026').TOTAL, '10000');
    await r.undo.fn();
    const back = cfg.DAILY.find(d => d.Date === '02/Oct/2026');
    assert.equal(back.TOTAL, '20000');
    assert.equal(cfg.MONTHLY.find(m => m.Month_Year === 'October 2026').TOTAL, '30000');
  });
});
