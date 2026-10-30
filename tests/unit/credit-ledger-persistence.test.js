// Regression tests for "I saved staff credit, clicked Save All & Sync, and after reload it was gone".
// Drives the REAL manager-credit.js against jsdom + real Repository/localStorage.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><select id="crd-month-sel"></select><div id="crd-employees"></div></body></html>');
globalThis.window.toast = globalThis.toast = () => {};
globalThis.window.confirm = globalThis.confirm = () => true;
const { Repository } = await import('../../js/platform/repository.js');
const shared = await import('../../js/manager/manager-shared.js');
const credit = await import('../../js/manager/manager-credit.js');
const dirty = await import('../../js/platform/sync-dirty.js');

const OCT = 'October 2026', NOV = 'November 2026';
const sel = () => document.getElementById('crd-month-sel');
const stored = (m = OCT) => (JSON.parse(localStorage.getItem('BT_ManagerWork_v1') || '{}').credit || {})[m] || [];
const storedRow = (name, m = OCT) => stored(m).find(r => r.name === name);

function seedStaff() {
  Repository.setStaff([
    { id: 'emp_1', staffId: 'EMP-001', name: 'Salman Yasin', srNum: 1, active: true },
    { id: 'emp_2', staffId: 'EMP-002', name: 'Mian Usman', srNum: 2, active: true },
    { id: 'emp_9', staffId: 'EMP-009', name: 'Left Company', srNum: null, active: false },
  ]);
}
function openMonth(m = OCT) {
  sel().innerHTML = `<option value="${m}">${m}</option><option value="${m === OCT ? NOV : OCT}">${m === OCT ? NOV : OCT}</option>`;
  sel().value = m;
  credit.loadCreditMonth(m);
}
const idx = name => credit._crdData_cur.findIndex(r => r.name === name);

beforeEach(() => {
  resetStorage(); seedStaff();
  document.activeElement?.blur?.();
  document.getElementById('crd-employees').innerHTML = '';
  delete document.getElementById('crd-employees').dataset.marker;
});

describe('staff credit — storage is the single source of truth', () => {
  test('REGRESSION: entry added via Quick Add / Staff Card is NOT wiped by a later Save All', () => {
    openMonth();
    // another code path (Quick Add) writes straight to storage, then refreshes the sheet
    const data = shared.mgrLoad();
    data.credit = { [OCT]: credit._crdData(OCT) };
    data.credit[OCT].find(r => r.name === 'Salman Yasin').entries.push({ id: 'qa1', date: '30-Oct-2026', desc: 'quick add', amount: 1500, source: 'closing_app' });
    shared.mgrSave(data);
    credit.loadCreditMonth(OCT);
    assert.equal(credit._crdData_cur[idx('Salman Yasin')].entries.length, 1, 'sheet must show the new entry');

    // user then edits something else and hits Save All & Sync
    credit.crdEmpField(idx('Mian Usman'), 'prevBal', 300);
    credit.saveCreditData();
    shared.mgrFlushAutosaves();

    assert.equal(storedRow('Salman Yasin').entries.length, 1, 'Quick Add entry must still be stored');
    assert.equal(storedRow('Salman Yasin').entries[0].amount, 1500);
    assert.equal(storedRow('Mian Usman').prevBal, 300);
  });

  test('REGRESSION: stale in-memory copy can no longer overwrite a newer stored value', () => {
    openMonth();
    // simulate: sync pull (or another tab) changed Salman in storage while sheet kept its old in-memory copy
    // (sheet NOT re-rendered, e.g. because the user was focused in a field)
    const data = shared.mgrLoad();
    data.credit = { [OCT]: credit._crdData(OCT) };
    data.credit[OCT].find(r => r.name === 'Salman Yasin').entries.push({ id: 'remote1', date: 'd', desc: 'from other device', amount: 900 });
    shared.mgrSave(data);
    // user edits a different employee from the (stale) sheet
    credit.crdEmpField(idx('Mian Usman'), 'salary', 111);
    assert.equal(storedRow('Salman Yasin').entries.length, 1, 'untouched row keeps the newer stored data');
    assert.equal(storedRow('Mian Usman').salary, 111);
  });

  test('every keystroke lands in storage immediately (nothing waits in a timer)', () => {
    openMonth();
    credit.addCrdEntryFocused(idx('Salman Yasin'));
    const i = idx('Salman Yasin');
    credit.crdEntryChange(i, 0, 'amount', '2500');
    credit.crdEntryChange(i, 0, 'desc', 'advance');
    const e = storedRow('Salman Yasin').entries[0];
    assert.equal(e.amount, 2500);
    assert.equal(e.desc, 'advance');
    assert.ok(e.id, 'new entries carry a stable id');
  });

  test('REGRESSION: pending autosave from month A can no longer be filed under month B', () => {
    openMonth(OCT);
    credit.crdEmpField(idx('Salman Yasin'), 'prevBal', 42);   // autosave timer now pending
    sel().value = NOV; credit.loadCreditMonth(NOV);           // user switches month immediately
    shared.mgrFlushAutosaves();
    credit.saveCreditData();
    assert.equal(storedRow('Salman Yasin', OCT).prevBal, 42, 'edit stays in October');
    assert.ok(!stored(NOV).some(r => r.prevBal === 42), 'and does not leak into November');
  });

  test('rows for inactive / unmatched staff that carry money are kept, not deleted on save', () => {
    const data = shared.mgrLoad();
    data.credit = { [OCT]: [
      { staffId: 'EMP-009', name: 'Left Company', prevBal: 0, salary: 0, lessGeneric: 0, entries: [{ id: 'x', date: 'd', desc: 'old', amount: 777 }] },
      { name: 'Ghost With Nothing', prevBal: 0, salary: 0, lessGeneric: 0, entries: [] },
    ] };
    shared.mgrSave(data);
    openMonth();
    assert.ok(credit._crdData_cur.some(r => r.name === 'Left Company'), 'row with data is shown');
    assert.ok(!credit._crdData_cur.some(r => r.name === 'Ghost With Nothing'), 'empty orphan is still cleaned up');
    credit.crdEmpField(idx('Salman Yasin'), 'prevBal', 1);
    credit.saveCreditData();
    assert.equal(storedRow('Left Company').entries[0].amount, 777);
  });

  test('empty registry (not loaded yet) never wipes stored credit', () => {
    const data = shared.mgrLoad();
    data.credit = { [OCT]: [{ staffId: 'EMP-001', name: 'Salman Yasin', prevBal: 10, salary: 0, lessGeneric: 0, entries: [{ id: 'k', amount: 5, date: 'd', desc: '' }] }] };
    shared.mgrSave(data);
    Repository.setStaff([]);
    openMonth();
    credit.saveCreditData();
    assert.equal(storedRow('Salman Yasin').entries[0].amount, 5);
  });

  test('deleting an entry records a tombstone so sync cannot bring it back', async () => {
    await import('../../js/platform/sync-tombstones.js');
    openMonth();
    credit.addCrdEntryFocused(idx('Salman Yasin'));
    const id = storedRow('Salman Yasin').entries[0].id;
    credit.deleteCrdEntry(idx('Salman Yasin'), 0);
    assert.equal(storedRow('Salman Yasin').entries.length, 0);
    assert.equal(window.SyncTombstones.isDeleted('crde:' + id), true);
  });

  test('background refresh does not rebuild the table while the user is typing in it', () => {
    openMonth();
    credit.addCrdEntryFocused(idx('Salman Yasin'));
    const input = document.querySelector('#crd-employees input[type="number"]');
    input.focus();
    const before = document.getElementById('crd-employees').innerHTML;
    document.getElementById('crd-employees').dataset.marker = 'same-dom';
    credit.loadCreditMonth(OCT); // what refreshManagerPage() does after every sync
    assert.equal(document.getElementById('crd-employees').dataset.marker, 'same-dom');
    assert.equal(document.activeElement, input, 'focus is kept');
    assert.equal(document.getElementById('crd-employees').innerHTML, before);
  });

  test('refresh with no focus reloads from storage and keeps expanded rows open', () => {
    openMonth();
    credit._toggleCrdEmpBody(idx('Salman Yasin'));
    const data = shared.mgrLoad();
    data.credit = { [OCT]: credit._crdData(OCT) };
    data.credit[OCT].find(r => r.name === 'Mian Usman').prevBal = 4321; // arrived via sync
    shared.mgrSave(data);
    document.activeElement?.blur?.();
    credit.loadCreditMonth(OCT);
    assert.equal(credit._crdData_cur[idx('Mian Usman')].prevBal, 4321, 'pulled data appears');
    assert.notEqual(document.getElementById('crd-body-' + idx('Salman Yasin')).style.display, 'none', 'row stays expanded');
  });
});

describe('dirty-month tracker', () => {
  test('edits mark the exact section/month dirty; a push clears only older stamps', async () => {
    openMonth();
    credit.crdEmpField(idx('Salman Yasin'), 'prevBal', 5);
    assert.equal(dirty.isDirty('credit', OCT), true);
    assert.equal(dirty.isDirty('credit', NOV), false);
    const startedAt = Date.now();
    await new Promise(r => setTimeout(r, 5));
    credit.crdEmpField(idx('Salman Yasin'), 'prevBal', 6);   // edited after push started
    dirty.clearDirtyUpTo(startedAt);
    assert.equal(dirty.isDirty('credit', OCT), true, 'later edit must stay dirty until the next successful push');
    dirty.clearDirtyUpTo(Date.now());
    assert.equal(dirty.isDirty('credit', OCT), false);
  });
  test('merge-originated writes do not mark anything dirty', () => {
    dirty.runAsMerge(() => Repository.setItem('BT_ManagerWork_v1', JSON.stringify({ credit: { [OCT]: [{ name: 'x', entries: [] }] } })));
    assert.equal(dirty.isDirty('credit', OCT), false);
  });
});
