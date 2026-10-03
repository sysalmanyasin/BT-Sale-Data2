// The four change tools against the real stores (ledger, notes, targets,
// daily): approval gate, correct data written through Actions, and undo.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {}; // classic-script global the real app defines
const cfg = await import('../../js/config.js');
const { Repository } = await import('../../js/repository.js');
const LedgerStore = await import('../../js/ledger-store.js');
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/writes.js');
const guard = await import('../../js/agent/core/guard.js');
const undo = await import('../../js/agent/core/undo.js');

const yes = async () => true;
const opts = (approve = yes) => ({ writesEnabled: true, approve });
const call = (name, args, o = opts()) => reg.runTool(name, args, o);
const body = r => JSON.parse(r.text);

before(() => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([
    { id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true },
    { id: 'e2', staffId: 'EMP-002', name: 'Ali Raza', designation: 'Cashier', active: true },
    { id: 'e3', staffId: 'EMP-003', name: 'Sara', designation: 'Cashier', active: true },
  ]);
  cfg.DAILY.push({ Date: '02/Oct/2026', Month_Year: 'October 2026', 'Cash Sale': '10000', HBL: '5000', 'COMP SALE': '15000', Customers: '30', TOTAL: '15000', DIFF: null });
  cfg.MONTHLY.push({ Month_Year: 'October 2026', TOTAL: '15000', 'Cash Sale': '10000', 'COMP SALE': '15000', Customers: '30' });
  console.error = q;
  window.getTgts = () => JSON.parse(Repository.getItem('bt_targets') || '{}');
});

describe('guard helpers', () => {
  test('amount thresholds', () => {
    assert.equal(guard.amountChecks(100).strong, false);
    assert.equal(guard.amountChecks(25000).warnings.length, 1);
    assert.equal(guard.amountChecks(50000).strong, true);
  });
  test('date checks flag future and far-past dates', () => {
    const now = new Date(2026, 9, 3);
    assert.equal(guard.dateChecks('2026-10-03', now).warnings.length, 0);
    assert.match(guard.dateChecks('2026-10-20', now).warnings[0], /future/);
    assert.match(guard.dateChecks('2026-01-01', now).warnings[0], /past/);
  });
});

describe('add_staff_note', () => {
  test('ambiguous name is rejected before any card', async () => {
    let asked = false;
    const r = await call('add_staff_note', { staff: 'Ali', text: 'x' }, opts(async () => { asked = true; return true; }));
    assert.equal(r.ok, false); assert.equal(asked, false); assert.match(r.text, /several staff/);
  });
  test('adds the note for the right person, and undo removes it', async () => {
    const { getNotes, keyForStaff } = await import('../../js/staff-notes.js');
    const r = await call('add_staff_note', { staff: 'EMP-003', text: 'Spoke about punctuality' });
    assert.equal(r.ok, true);
    const key = keyForStaff(Repository.getStaff().find(e => e.staffId === 'EMP-003'));
    assert.equal(getNotes(key).length, 1);
    await r.undo.fn();
    assert.equal(getNotes(key).length, 0);
  });
});

describe('add_ledger_entry', () => {
  test('unknown ledger / category give guidance, nothing written', async () => {
    assert.match((await call('add_ledger_entry', { ledger_type: 'nope', category_id: 'x', amount: 5 })).text, /Unknown ledger/);
    assert.match((await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'zzz', amount: 5 })).text, /Unknown category/);
  });
  test('preview shows balance effect; approve writes via LedgerActions; undo removes', async () => {
    const before = LedgerStore.getCurrentBalance('jazzcash');
    let preview;
    const r = await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 300, date: '2026-10-03', desc: 'test' },
      opts(async req => { preview = req.preview; return true; }));
    assert.equal(r.ok, true);
    assert.match(preview.lines.join('|'), /Amount: Rs 300/);
    assert.equal(LedgerStore.getCurrentBalance('jazzcash'), before + 300);
    const id = body(r).entry_id;
    assert.ok(LedgerStore.getEntries('jazzcash').some(e => e.id === id && e.source === 'ai_assistant'));
    await r.undo.fn();
    assert.equal(LedgerStore.getCurrentBalance('jazzcash'), before);
  });
  test('reject writes nothing', async () => {
    const n = LedgerStore.getEntries('jazzcash').length;
    const r = await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 300 }, opts(async () => false));
    assert.equal(r.rejected, true); assert.equal(LedgerStore.getEntries('jazzcash').length, n);
  });
  test('large amounts and duplicates require strong confirmation', async () => {
    let p;
    await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 75000 }, opts(async req => { p = req.preview; return false; }));
    assert.equal(p.strong, true);
    const first = await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 123, date: '2026-10-03', desc: 'dup' });
    await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 123, date: '2026-10-03', desc: 'dup' }, opts(async req => { p = req.preview; return false; }));
    assert.equal(p.strong, true); assert.match(p.warnings.join(' '), /duplicate/);
    await first.undo.fn();
  });
  test('bad amount rejected in preview', async () => {
    assert.match((await call('add_ledger_entry', { ledger_type: 'jazzcash', category_id: 'credit', amount: 0 })).text, /positive/);
  });
});

describe('set_monthly_target', () => {
  test('sets via Actions.saveTargets, undo restores previous', async () => {
    const r1 = await call('set_monthly_target', { month_year: 'nov 2026', amount: 1000000 });
    assert.equal(r1.ok, true);
    assert.equal(window.getTgts()['November 2026'], 1000000);
    const r2 = await call('set_monthly_target', { month_year: 'November 2026', amount: 1200000 });
    assert.equal(window.getTgts()['November 2026'], 1200000);
    await r2.undo.fn();
    assert.equal(window.getTgts()['November 2026'], 1000000);
    await r1.undo.fn();
    assert.equal(window.getTgts()['November 2026'], undefined);
  });
  test('a >50% change is flagged strong', async () => {
    await call('set_monthly_target', { month_year: 'December 2026', amount: 1000 });
    let p;
    await call('set_monthly_target', { month_year: 'December 2026', amount: 9000 }, opts(async req => { p = req.preview; return false; }));
    assert.equal(p.strong, true);
  });
});

describe('targets safety', () => {
  test('corrupt stored targets: refuses to overwrite', async () => {
    Repository.setItem('bt_targets', '{not json');
    const r = await call('set_monthly_target', { month_year: 'January 2027', amount: 5 });
    assert.equal(r.ok, false); assert.match(r.text, /could not be read/);
    Repository.setItem('bt_targets', '{}');
  });
});

describe('edit_daily_sales_field', () => {
  test('is critical (strong confirm), recalculates TOTAL, undo restores', async () => {
    let p;
    const r = await call('edit_daily_sales_field', { date: '2026-10-02', field: 'cash sale', value: 12000 }, opts(async req => { p = req.preview; return true; }));
    assert.equal(r.ok, true); assert.equal(p.strong, true);
    const rec = cfg.DAILY.find(d => d.Date === '02/Oct/2026');
    assert.equal(rec['Cash Sale'], '12000');
    assert.equal(rec.TOTAL, '17000'); // 12000 cash + 5000 HBL
    await r.undo.fn();
    assert.equal(rec['Cash Sale'], '10000'); assert.equal(rec.TOTAL, '15000');
  });
  test('cannot edit computed or unknown fields, or non-existent days', async () => {
    assert.match((await call('edit_daily_sales_field', { date: '2026-10-02', field: 'TOTAL', value: 1 })).text, /cannot be edited/);
    assert.match((await call('edit_daily_sales_field', { date: '2026-10-09', field: 'Cash Sale', value: 1 })).text, /No sales entry/);
    assert.match((await call('edit_daily_sales_field', { date: '2026-10-02', field: 'Cash Sale', value: -5 })).text, /0 or more/);
  });
});

describe('undo stack', () => {
  test('runs once, then reports already undone', async () => {
    undo.clearUndo(); let n = 0;
    const item = undo.pushUndo({ tool: 't', label: 'l', fn: () => { n++; } });
    assert.equal((await undo.runUndo(item.id)).ok, true);
    assert.equal((await undo.runUndo(item.id)).ok, false);
    assert.equal(n, 1); assert.equal(undo.listUndo().length, 0);
  });
});
