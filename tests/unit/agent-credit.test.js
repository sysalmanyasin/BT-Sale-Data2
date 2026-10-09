// Staff credit tools against the real manager blob (BT_ManagerWork_v1).
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/credit.js');
await import('../../js/agent/tools/verify.js'); // registers the read-back verifiers

const KEY = 'BT_ManagerWork_v1';
const yes = async () => true;
const opts = (approve = yes) => ({ writesEnabled: true, approve });
const call = (n, a, o = opts()) => reg.runTool(n, a, o);
const body = r => JSON.parse(r.text);
const blob = () => JSON.parse(Repository.getItem(KEY));

const seed = () => Repository.setItem(KEY, JSON.stringify({
  somethingElse: { keep: 'me' },
  credit: {
    'September 2026': [{ name: 'Ali Khan', prevBal: 0, entries: [{ date: '10-Sep-2026', desc: 'medicine', amount: 3000 }], salary: 0, lessGeneric: 0 }],
    'October 2026': [
      { name: 'Ali Khan', prevBal: 2000, entries: [{ date: '02-Oct-2026', desc: 'groceries', amount: 1500 }, { date: '03-Oct-2026', desc: 'repaid', amount: -500 }], salary: 1000, lessGeneric: 100 },
      { name: 'Sara', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 },
    ],
  },
}));

before(() => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([
    { id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true },
    { id: 'e2', staffId: 'EMP-002', name: 'Sara', designation: 'Cashier', active: true },
    { id: 'e3', staffId: 'EMP-003', name: 'Bilal', designation: 'Cashier', active: true },
    { id: 'e4', staffId: 'EMP-004', name: 'Old Hand', designation: 'Helper', active: false },
  ]);
  console.error = q;
});
beforeEach(seed);

describe('get_staff_credit', () => {
  test('is a sensitive read tool', () => { const t = reg.getTool('get_staff_credit'); assert.equal(t.risk, 'read'); assert.equal(t.sensitive, true); });
  test('one person: opening balance, entries, deductions and net', async () => {
    const r = body(await call('get_staff_credit', { staff: 'ali', month_year: 'october 2026' }));
    assert.equal(r.opening_balance, 2000); assert.equal(r.salary_deduction, 1000);
    assert.equal(r.net_owed, 2000 + 1500 - 500 - 1000 - 100); // 1900
    assert.equal(r.entries.length, 2);
  });
  test('everyone: only non-zero nets, sorted, with total', async () => {
    const r = body(await call('get_staff_credit', { month_year: 'October 2026' }));
    assert.equal(r.people_with_balance, 1); assert.equal(r.total_net_owed, 1900);
  });
  test('missing row / bad month are explained', async () => {
    assert.equal(body(await call('get_staff_credit', { staff: 'Bilal', month_year: 'October 2026' })).found, false);
    assert.match(body(await call('get_staff_credit', { month_year: 'nope' })).error, /Use a month/);
  });
});

describe('add_staff_credit_entry', () => {
  test('preview shows month, effect and net before → after', async () => {
    let p;
    await call('add_staff_credit_entry', { staff: 'EMP-001', amount: 800, desc: 'cough syrup', date: '2026-10-05' }, opts(async r => { p = r.preview; return false; }));
    assert.equal(p.title, 'Add staff credit');
    const t = p.lines.join('|');
    assert.match(t, /Month: October 2026/); assert.match(t, /Credit taken: Rs 800/); assert.match(t, /Rs 1,900 → Rs 2,700/);
  });
  test('approved: Quick-Add entry shape, other data untouched, net updated', async () => {
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 800, desc: 'cough syrup', date: '2026-10-05' });
    assert.equal(r.ok, true);
    const b = blob();
    const row = b.credit['October 2026'].find(x => x.name === 'Ali Khan');
    assert.deepEqual(row.entries.at(-1), { date: '05-Oct-2026', desc: 'cough syrup', amount: 800 });
    assert.deepEqual(b.somethingElse, { keep: 'me' });
    assert.equal(b.credit['October 2026'].find(x => x.name === 'Sara').entries.length, 0);
    assert.equal(body(r).net_owed_now, 2700);
  });
  test('payment is stored negative and flagged when it exceeds the balance', async () => {
    let p;
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 5000, kind: 'payment', date: '2026-10-05' }, opts(async req => { p = req.preview; return true; }));
    assert.match(p.warnings.join(' '), /more than the balance owed/);
    assert.equal(blob().credit['October 2026'][0].entries.at(-1).amount, -5000);
    assert.equal(r.ok, true);
  });
  test('entry date decides the month bucket (not the current month)', async () => {
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 100, date: '2026-09-20' });
    assert.equal(body(r).month, 'September 2026');
    assert.equal(blob().credit['September 2026'][0].entries.length, 2);
  });
  test('new month row warns that last month\'s balance is not carried over; undo removes the created row', async () => {
    let p;
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 100, date: '2026-11-02' }, opts(async req => { p = req.preview; return true; }));
    assert.match(p.warnings.join(' '), /one will be created with opening balance 0/);
    assert.equal(body(r).row_created, true);
    assert.ok(blob().credit['November 2026']);
    await r.undo.fn();
    assert.equal(blob().credit['November 2026'].length, 0);
  });
  test('duplicate entry needs strong confirmation', async () => {
    let p;
    await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 1500, desc: 'groceries', date: '2026-10-02' }, opts(async req => { p = req.preview; return false; }));
    assert.equal(p.strong, true); assert.match(p.warnings.join(' '), /duplicate/);
  });
  test('large amount is strong; zero/negative amount rejected in preview', async () => {
    let p;
    await call('add_staff_credit_entry', { staff: 'Sara', amount: 60000, date: '2026-10-05' }, opts(async req => { p = req.preview; return false; }));
    assert.equal(p.strong, true);
    assert.match((await call('add_staff_credit_entry', { staff: 'Sara', amount: 0 })).text, /positive/);
  });
  test('ambiguous / unknown staff are rejected before any card', async () => {
    let asked = false;
    const o = opts(async () => { asked = true; return true; });
    assert.match((await call('add_staff_credit_entry', { staff: 'zzz', amount: 5 }, o)).text, /No staff member/);
    assert.equal(asked, false);
  });
  test('reject writes nothing; corrupt stored data refuses to overwrite', async () => {
    const before = Repository.getItem(KEY);
    await call('add_staff_credit_entry', { staff: 'Sara', amount: 10 }, opts(async () => false));
    assert.equal(Repository.getItem(KEY), before);
    Repository.setItem(KEY, '{broken');
    const r = await call('add_staff_credit_entry', { staff: 'Sara', amount: 10 });
    assert.equal(r.ok, false); assert.match(r.text, /could not be read/);
    assert.equal(Repository.getItem(KEY), '{broken');
  });
  test('undo removes exactly the added entry, keeps the row', async () => {
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 800, desc: 'x', date: '2026-10-05' });
    await r.undo.fn();
    const row = blob().credit['October 2026'][0];
    assert.equal(row.entries.length, 2); assert.equal(row.entries.at(-1).desc, 'repaid');
  });
  test('undo refuses if the entry was edited meanwhile', async () => {
    const r = await call('add_staff_credit_entry', { staff: 'Ali Khan', amount: 800, desc: 'x', date: '2026-10-05' });
    const b = blob(); b.credit['October 2026'][0].entries.at(-1).amount = 999; Repository.setItem(KEY, JSON.stringify(b));
    await assert.rejects(async () => r.undo.fn(), /already changed/);
  });
  test('UI is nudged: credit sheet sync + registry refresh + auto-save push', async () => {
    let synced = null, reg2 = 0, pushed = 0;
    window._scCreditSync = my => { synced = my; }; window.renderStaffRegistry = () => { reg2++; }; window.pushToSupabase = () => { pushed++; };
    Repository.setItem('bt_auto_save', '1');
    await call('add_staff_credit_entry', { staff: 'Sara', amount: 10, date: '2026-10-05' });
    assert.equal(synced, 'October 2026'); assert.equal(reg2, 1); assert.equal(pushed, 1);
    Repository.setItem('bt_auto_save', '0');
  });
});

describe('roll_credit_forward', () => {
  const seedRoll = (octRows) => Repository.setItem(KEY, JSON.stringify({ other: { keep: 'me' }, credit: {
    'September 2026': [
      { name: 'Ali Khan', prevBal: 0, entries: [{ date: '10-Sep-2026', desc: 'x', amount: 9000 }], salary: 0, lessGeneric: 0 },
      { name: 'Sara', prevBal: 0, entries: [{ date: '11-Sep-2026', desc: 'y', amount: 2000 }], salary: 500, lessGeneric: 0 },
      { name: 'Bilal', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 },
    ],
    'October 2026': octRows,
  } }));
  const zero = name => ({ name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 });

  test('fills opening balances from last month net, adds missing people, keeps everything else, verifies', async () => {
    seedRoll([zero('Ali Khan')]);
    let pv;
    const r = await call('roll_credit_forward', {}, opts(async req => { pv = req.preview; return true; }));
    assert.equal(r.ok, true, r.text);
    assert.equal(pv.strong, true);
    assert.match(pv.lines.join('|'), /From: September 2026/);
    const oct = blob().credit['October 2026'];
    assert.equal(oct.find(x => x.name === 'Ali Khan').prevBal, 9000);
    assert.equal(oct.find(x => x.name === 'Sara').prevBal, 1500);   // 2000 - 500 salary
    assert.ok(!oct.some(x => x.name === 'Bilal'), 'people owing nothing are not added to an existing sheet');
    assert.equal(blob().other.keep, 'me');
    assert.equal(r.verified.ok, true, JSON.stringify(r.verified));
    assert.equal(body(r).total, 10500);
  });
  test('undo restores the next month exactly as it was', async () => {
    seedRoll([zero('Ali Khan')]);
    const before = JSON.stringify(blob().credit['October 2026']);
    const r = await call('roll_credit_forward', {});
    await r.undo.fn();
    assert.equal(JSON.stringify(blob().credit['October 2026']), before);
  });
  test('never overwrites a different non-zero opening balance, and says so', async () => {
    seedRoll([{ ...zero('Ali Khan'), prevBal: 4000 }, zero('Sara')]);
    let pv;
    const r = await call('roll_credit_forward', { month_year: 'September 2026' }, opts(async req => { pv = req.preview; return true; }));
    assert.equal(r.ok, true);
    assert.equal(blob().credit['October 2026'].find(x => x.name === 'Ali Khan').prevBal, 4000);
    assert.match(pv.warnings.join(' '), /Ali Khan/);
  });
  test('running it again has nothing to do and changes nothing', async () => {
    seedRoll([zero('Ali Khan')]);
    await call('roll_credit_forward', {});
    const snap = Repository.getItem(KEY);
    const again = await call('roll_credit_forward', {});
    assert.equal(again.ok, false);
    assert.match(again.text, /No month needs rolling forward|Nothing to roll/);
    assert.equal(Repository.getItem(KEY), snap);
  });
  test('rejecting the card writes nothing', async () => {
    seedRoll([zero('Ali Khan')]);
    const snap = Repository.getItem(KEY);
    const r = await call('roll_credit_forward', {}, opts(async () => false));
    assert.equal(r.rejected, true);
    assert.equal(Repository.getItem(KEY), snap);
  });
});
