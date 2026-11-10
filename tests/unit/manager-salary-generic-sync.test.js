// ══════════════════════════════════════════════════════════════════════
// REGRESSION TEST — Generic Working → Salary "Generic" column
//
// Reported bug: Generic figures typed on the Generic sheet did not show up in
// the Salary sheet (Generic column stayed 0, Net unchanged) until Auto-Fill or
// a reload. Fixed by: refreshSalaryOnOpen() (re-pull when the Salary tab opens),
// the live-sync hook now updating the visible Generic input (#sal-gen-N) and
// only applying when both sheets show the same month, and keeping the saved
// salary row in step so payslip/reports don't read a stale 0.
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv(`<!doctype html><html><body>
  <select id="sal-month-sel"><option value="October 2026" selected>October 2026</option><option value="September 2026">September 2026</option></select>
  <select id="gen-month-sel"><option value="October 2026" selected>October 2026</option><option value="September 2026">September 2026</option></select>
  <table><tbody id="sal-tbody"></tbody><tfoot id="sal-tfoot"></tfoot></table>
  <table><tbody id="gen-tbody"></tbody><tfoot id="gen-tfoot"></tfoot></table>
</body></html>`);

const { Repository } = await import('../../js/platform/repository.js');
const { Actions } = await import('../../js/platform/actions.js');
const salaryMod = await import('../../js/manager/manager-salary.js');
const genericMod = await import('../../js/manager/manager-generic.js');

const setMonth = (id, v) => { document.getElementById(id).value = v; };

beforeEach(() => {
  resetStorage();
  Repository.setStaff([]);
  setMonth('sal-month-sel', 'October 2026');
  setMonth('gen-month-sel', 'October 2026');
  // park both modules on another month so same-month "keep unsaved edits" logic starts clean
  salaryMod.loadSalaryMonth('September 2026');
  genericMod.loadGenericMonth('September 2026');
});

describe('Generic → Salary sync', () => {
  test('refreshSalaryOnOpen() pulls Generic entered after Salary was loaded', () => {
    Actions.addEmployee({ name: 'Salman Yasin', designation: 'Manager' });
    salaryMod.loadSalaryMonth('October 2026');            // Salary loaded first, Generic still empty
    assert.equal(salaryMod._salRows_cur[0].generic, 0);

    genericMod.loadGenericMonth('October 2026');
    genericMod._genRows_cur[0].genericSale = 147066;
    genericMod.saveGenericData(true);                     // 4% = 5883

    salaryMod.refreshSalaryOnOpen();

    assert.equal(salaryMod._salRows_cur[0].generic, 5883);
    assert.equal(document.getElementById('sal-gen-0').value, '5883', 'visible Generic cell must update');
    assert.equal(document.getElementById('sal-net-0').value, '5883');
  });

  test('refreshSalaryOnOpen() also picks up a Generic edit still sitting in the autosave debounce', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('October 2026');
    genericMod.loadGenericMonth('October 2026');
    genericMod._genRows_cur[0].genericSale = 92374;
    genericMod.recalcGenRow(0);                            // schedules a debounced save, not yet in storage

    salaryMod.refreshSalaryOnOpen();                       // must flush first

    assert.equal(salaryMod._salRows_cur[0].generic, 3695);
  });

  test('live sync updates the visible Generic cell, not just Net', () => {
    Actions.addEmployee({ name: 'Dr Usama', designation: 'Pharmacist' });
    salaryMod.loadSalaryMonth('October 2026');
    genericMod.loadGenericMonth('October 2026');
    genericMod._genRows_cur[0].genericSale = 148190;
    genericMod.recalcGenRow(0);

    assert.equal(document.getElementById('sal-gen-0').value, '5928');
    assert.equal(document.getElementById('sal-net-0').value, '5928');
  });

  test('live sync is ignored when Salary and Generic show different months', () => {
    Actions.addEmployee({ name: 'Dr Usama', designation: 'Pharmacist' });
    salaryMod.loadSalaryMonth('October 2026');
    setMonth('gen-month-sel', 'September 2026');
    genericMod.loadGenericMonth('September 2026');
    genericMod._genRows_cur[0].genericSale = 148190;
    genericMod.recalcGenRow(0);

    assert.equal(salaryMod._salRows_cur[0].generic, 0, 'September Generic must not leak into October Salary');
  });

  test('opening the Salary tab only displays — it never writes salary data', async () => {
    Actions.addEmployee({ name: 'Salman Yasin', designation: 'Manager' });
    salaryMod.loadSalaryMonth('October 2026');
    salaryMod.saveSalaryData(true);                        // saved with generic 0

    genericMod.loadGenericMonth('October 2026');
    genericMod._genRows_cur[0].genericSale = 147066;
    genericMod.saveGenericData(true);

    const { mgrFlushAutosaves, mgrLoad } = await import('../../js/manager/manager-shared.js');
    salaryMod.refreshSalaryOnOpen();
    mgrFlushAutosaves();

    assert.equal(salaryMod._salRows_cur[0].generic, 5883, 'shown on screen');
    assert.equal(mgrLoad().salary['October 2026'][0].generic, 0, 'but nothing was written by merely opening the tab');
  });

  test('typing in Generic does update the saved salary row (so payslip/reports stay correct)', async () => {
    Actions.addEmployee({ name: 'Salman Yasin', designation: 'Manager' });
    salaryMod.loadSalaryMonth('October 2026');
    salaryMod.saveSalaryData(true);
    genericMod.loadGenericMonth('October 2026');
    genericMod._genRows_cur[0].genericSale = 147066;
    genericMod.recalcGenRow(0);

    const { mgrFlushAutosaves, mgrLoad } = await import('../../js/manager/manager-shared.js');
    mgrFlushAutosaves();
    assert.equal(mgrLoad().salary['October 2026'][0].generic, 5883);
  });
});
