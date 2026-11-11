// ══════════════════════════════════════════════════════════════════════
// REGRESSION TEST — HO Salary / Auto-Fill Advance / Auto-Fill Generic
//
// index.html loads manager-salary.js?v=<hash> while manager-page/-staff/-reports import it bare, so the
// browser runs TWO copies of every manager module. Each used to hold its own row array, so Save All,
// Auto-Fill and print could act on a stale copy (HO Salary back to 0, old Advance/Generic). Rows now live
// on a shared global (mgrSheetState); these tests load a second copy via a ?dup query and check both agree.
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv(`<!doctype html><html><body>
  <select id="sal-month-sel"><option value="October 2026" selected>October 2026</option></select>
  <select id="gen-month-sel"><option value="October 2026" selected>October 2026</option></select>
  <select id="crd-month-sel"><option value="October 2026" selected>October 2026</option></select>
  <table><tbody id="sal-tbody"></tbody><tfoot id="sal-tfoot"></tfoot></table>
  <table><tbody id="gen-tbody"></tbody><tfoot id="gen-tfoot"></tfoot></table>
  <div id="crd-employees"></div>
</body></html>`);
globalThis.toast = () => {};

const { Repository } = await import('../../js/platform/repository.js');
const { Actions } = await import('../../js/platform/actions.js');
const shared = await import('../../js/manager/manager-shared.js');
const salA = await import('../../js/manager/manager-salary.js');
const genA = await import('../../js/manager/manager-generic.js');
const crdA = await import('../../js/manager/manager-credit.js');
// second copies, exactly like index.html's `?v=hash` script tags next to bare imports
const salB = await import('../../js/manager/manager-salary.js?dup=1');
const genB = await import('../../js/manager/manager-generic.js?dup=1');
const crdB = await import('../../js/manager/manager-credit.js?dup=1');

beforeEach(() => {
  resetStorage();
  Repository.setStaff([]);
  Actions.addEmployee({ name: 'Salman Yasin', designation: 'Manager' });
  document.getElementById('sal-month-sel').value = 'October 2026';
  document.getElementById('gen-month-sel').value = 'October 2026';
  document.getElementById('crd-month-sel').value = 'October 2026';
  salA.loadSalaryMonth('September 2026');
  genA.loadGenericMonth('September 2026');
});

describe('duplicate module copies share one set of rows', () => {
  test('every copy sees the same Salary / Generic / Credit arrays', () => {
    assert.strictEqual(salA._salRows_cur, salB._salRows_cur);
    assert.strictEqual(genA._genRows_cur, genB._genRows_cur);
    assert.strictEqual(crdA._crdData_cur, crdB._crdData_cur);
  });

  test('HO Salary typed through one copy survives a load/save through the other', () => {
    salA.loadSalaryMonth('October 2026');
    salA.salRowChange(0, 'hoSal', 50000);
    salB.saveSalaryData(true);                        // e.g. Save All & Sync running from another copy
    assert.equal(shared.mgrLoad().salary['October 2026'][0].hoSal, 50000);
    salB.loadSalaryMonth('October 2026');             // background refresh from the other copy
    assert.equal(salA._salRows_cur[0].hoSal, 50000);
  });
});

// A credit entry as the Credit sheet / Quick Add leave it in storage.
function addCredit(amount) {
  crdA.loadCreditMonth('October 2026');
  const d = shared.mgrLoad();
  d.credit = { 'October 2026': crdA._crdData('October 2026') };
  d.credit['October 2026'][0].entries.push({ id: 'e1', date: '10-Oct-2026', desc: 'advance', amount });
  shared.mgrSave(d);
}

describe('Auto-Fill', () => {
  test('pulls Advance from the Credit ledger and Generic from the Generic sheet, then saves', () => {
    salA.loadSalaryMonth('October 2026');
    salA.salRowChange(0, 'hoSal', 50000);
    salA.saveSalaryData(true);                        // month already saved → plain load would NOT refresh Advance

    addCredit(12000);
    genA.loadGenericMonth('October 2026');
    genA._genRows_cur[0].genericSale = 147066;
    genA.recalcGenRow(0);                             // still inside the autosave debounce

    salB.autoFillSalaryFromSheets();                  // click on ⚡ Auto-Fill (other module copy)

    const row = salA._salRows_cur[0];
    assert.equal(row.hoSal, 50000, 'HO Salary must be untouched by Auto-Fill');
    assert.equal(row.advance, 12000);
    assert.equal(row.generic, 5883);
    assert.equal(document.getElementById('sal-net-0').value, String(50000 - 12000 + 5883));
    const saved = shared.mgrLoad().salary['October 2026'][0];
    assert.deepEqual([saved.hoSal, saved.advance, saved.generic], [50000, 12000, 5883], 'Auto-Fill persists its result');
  });

  test('re-running Auto-Fill after a credit entry is removed lowers Advance again', () => {
    addCredit(9000);
    salA.loadSalaryMonth('October 2026');
    salA.autoFillSalaryFromSheets();
    assert.equal(salA._salRows_cur[0].advance, 9000);
    const d = shared.mgrLoad(); d.credit['October 2026'][0].entries = []; shared.mgrSave(d);
    salA.autoFillSalaryFromSheets();
    assert.equal(salA._salRows_cur[0].advance, 0);
  });
});

describe('Generic → Salary live hook', () => {
  test('fires once per edit even with two module copies loaded', () => {
    salA.loadSalaryMonth('October 2026');
    genA.loadGenericMonth('October 2026');
    let n = 0;
    shared.mgrOn('generic-changed', () => { n++; });
    genA._genRows_cur[0].genericSale = 100000;
    genA.recalcGenRow(0);
    assert.equal(n, 1);
    assert.equal(salA._salRows_cur[0].generic, 4000);
  });
});
