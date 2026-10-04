// Real-world name mess: "Mian Usman" vs "Mian Muhammad Usman", stray tabs/spaces,
// duplicate registry rows. Regression for the credit lookup that found nothing,
// and for adds that could have created a duplicate credit row.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/manager.js');
await import('../../js/agent/tools/credit.js');
await import('../../js/agent/tools/deletes.js');
const names = await import('../../js/agent/tools/_names.js');
const { pickSpecialist } = await import('../../js/agent/core/specialists.js');

const KEY = 'BT_ManagerWork_v1';
const yes = async () => true;
const typed = async () => ({ approved: true, typed: 'DELETE' });
const body = r => JSON.parse(r.text);
const blob = () => JSON.parse(Repository.getItem(KEY));
const read = (n, a) => reg.runTool(n, a);
const write = (n, a, approve = yes) => reg.runTool(n, a, { writesEnabled: true, approve });

const seed = () => Repository.setItem(KEY, JSON.stringify({ credit: {
  'August 2026': [{ name: 'Mian Muhammad Usman', prevBal: 0, entries: [{ date: '01-Aug-2026', desc: 'old', amount: 100 }], salary: 0, lessGeneric: 0 }],
  'September 2026': [
    { name: '\tMian Waqas', prevBal: 0, entries: [{ date: '07-Sep-2026', desc: 'a', amount: 300 }], salary: 0, lessGeneric: 0 },
    { name: 'Ali Husnain', prevBal: 0, entries: [{ date: '08-Sep-2026', desc: 'b', amount: 50 }], salary: 0, lessGeneric: 0 },
    { name: 'Mian Muhammad Usman', prevBal: 0, entries: [{ date: '05-Sep-2026', desc: 'medicine', amount: 1000 }, { date: '09-Sep-2026', desc: 'lunch', amount: 500 }], salary: 0, lessGeneric: 0 },
    { name: 'Salman Ghulam Ali', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 },
    { name: 'Shamshair Ali ', prevBal: 0, entries: [{ date: '03-Sep-2026', desc: 'c', amount: 70 }], salary: 0, lessGeneric: 0 },
  ] } }));

before(() => {
  const q = console.error; console.error = () => {};
  Repository.setStaff([ // mirrors the real registry quirks, including duplicate rows
    { id: 'a', staffId: 'EMP-002', name: 'Mian Muhammad Usman', active: true },
    { id: 'b', staffId: 'EMP-016', name: 'Mian Muhammad Usman', active: true },
    { id: 'c', staffId: 'EMP-004', name: '\tMian Waqas', active: true },
    { id: 'd', staffId: 'EMP-009', name: 'Shamshair Ali ', active: true },
    { id: 'e', staffId: 'EMP-011', name: 'Ali Husnain', active: true },
    { id: 'f', staffId: 'EMP-012', name: 'Salman Ghulam Ali', active: true },
  ]);
  console.error = q;
});
beforeEach(seed);

describe('name scoring', () => {
  test('words, not exact text', () => {
    assert.equal(names.nameScore('Mian Muhammad Usman', 'mian usman'), 2);
    assert.equal(names.nameScore('Mian Muhammad Usman', '  MIAN   MUHAMMAD USMAN '), 3);
    assert.equal(names.nameScore('\tMian Waqas', 'Waqas'), 2);
    assert.equal(names.nameScore('Shamshair Ali ', 'shamshair ali'), 3);
    assert.equal(names.nameScore('Muhammad Bilal', 'bilal'), 2);
    assert.equal(names.nameScore('Ali Husnain', 'zeeshan'), 0);
  });
  test('"Ali" is genuinely ambiguous and lists the real names', () => {
    assert.throws(() => names.resolveStaff('Ali'), /several staff.*Ali Husnain/);
  });
  test('duplicate registry rows with the same cleaned name count once', () => {
    assert.equal(names.resolveStaff('Mian Usman').name, 'Mian Muhammad Usman');
    assert.equal(names.staffCandidates('Mian Muhammad Usman').length, 1);
  });
  test('staff id still works', () => assert.equal(names.resolveStaff('EMP-009').staffId, 'EMP-009'));
});

describe('get_staff_credit with real names', () => {
  test('the screenshot bug: "Mian Usman" finds "Mian Muhammad Usman"', async () => {
    const r = body(await read('get_staff_credit', { staff: 'Mian Usman', month_year: 'September 2026' }));
    assert.equal(r.found, true); assert.equal(r.staff, 'Mian Muhammad Usman'); assert.equal(r.net_owed, 1500); assert.equal(r.entries.length, 2);
  });
  test('tab / trailing-space names are found and returned clean', async () => {
    assert.equal(body(await read('get_staff_credit', { staff: 'Waqas', month_year: 'September 2026' })).staff, 'Mian Waqas');
    assert.equal(body(await read('get_staff_credit', { staff: 'Shamshair Ali', month_year: 'September 2026' })).staff, 'Shamshair Ali');
    const all = body(await read('get_staff_credit', { month_year: 'September 2026' }));
    assert.ok(all.staff.every(s => s.staff === s.staff.trim()));
  });
  test('ambiguous name asks which person; unknown name lists who IS on the sheet', async () => {
    assert.match(body(await read('get_staff_credit', { staff: 'Ali', month_year: 'September 2026' })).error, /several people.*Ali Husnain/);
    const none = body(await read('get_staff_credit', { staff: 'Zeeshan', month_year: 'September 2026' }));
    assert.equal(none.found, false); assert.ok(none.names_on_sheet_this_month.includes('Mian Muhammad Usman'));
  });
  test('find_staff uses the same matching', async () => {
    const r = body(await read('find_staff', { query: 'Mian Usman' }));
    assert.equal(r.count, 1); assert.equal(r.matches[0].name, 'Mian Muhammad Usman');
  });
});

describe('writes never split a person across two spellings', () => {
  test('adding credit for "Mian Usman" appends to the EXISTING row (no duplicate row)', async () => {
    let p;
    const r = await write('add_staff_credit_entry', { staff: 'Mian Usman', amount: 200, date: '2026-09-20', desc: 'test' }, async req => { p = req.preview; return true; });
    assert.equal(r.ok, true);
    const rows = blob().credit['September 2026'];
    assert.equal(rows.length, 5);
    assert.equal(rows.filter(x => /usman/i.test(x.name)).length, 1);
    assert.equal(rows.find(x => /usman/i.test(x.name)).entries.length, 3);
    assert.match(p.lines.join('|'), /Staff: Mian Muhammad Usman/);
    assert.ok(!p.warnings.some(w => /will be created/.test(w)));
    assert.equal(body(r).net_owed_now, 1700);
    await r.undo.fn();
    assert.equal(blob().credit['September 2026'].find(x => /usman/i.test(x.name)).entries.length, 2);
  });
  test('a new month row reuses last month\'s spelling', async () => {
    const r = await write('add_staff_credit_entry', { staff: 'Mian Usman', amount: 50, date: '2026-10-02' });
    assert.equal(r.ok, true);
    assert.equal(blob().credit['October 2026'][0].name, 'Mian Muhammad Usman');
  });
  test('someone with no row anywhere still gets a new row, with the warning', async () => {
    let p;
    await write('add_staff_credit_entry', { staff: 'EMP-012', amount: 10, date: '2026-10-02' }, async req => { p = req.preview; return false; });
    assert.match(p.warnings.join(' '), /will be created/);
  });
  test('two different people matching the typed name stop the write before any card', async () => {
    let asked = false;
    const r = await write('add_staff_credit_entry', { staff: 'Ali', amount: 10 }, async () => { asked = true; return true; });
    assert.equal(r.ok, false); assert.equal(asked, false);
  });
  test('delete by partial name hits the right row and entry', async () => {
    const r = await write('delete_staff_credit_entry', { staff: 'Mian Usman', month_year: 'September 2026', entry_number: 2, expected_amount: 500 }, typed);
    assert.equal(r.ok, true);
    assert.deepEqual(blob().credit['September 2026'].find(x => /usman/i.test(x.name)).entries.map(e => e.desc), ['medicine']);
    await r.undo.fn();
    assert.equal(blob().credit['September 2026'].find(x => /usman/i.test(x.name)).entries.length, 2);
  });
});

describe('routing: a bare year is only a sales cue when nothing else matched', () => {
  test('the screenshot sentence is a staff question, not the Analyst', () => {
    assert.equal(pickSpecialist('Mian Usman Credit detail for September 2026').id, 'manager');
    assert.equal(pickSpecialist('Petty expenses in October 2026').id, 'manager');
    assert.equal(pickSpecialist('Stock in September 2026').id, 'inventory');
  });
  test('year-only and sales questions are still sales', () => {
    assert.equal(pickSpecialist('Summary of September 2026').id, 'sales');
    assert.equal(pickSpecialist('In 2022').id, 'sales');
    assert.equal(pickSpecialist('Best 3 days in 2022').id, 'sales');
  });
});
