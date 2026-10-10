// ══════════════════════════════════════════════════════════════════════
// REGRESSION TEST — js/manager-reports.js: printSalaryReport()
//
// Covers a real reported bug: a printed FDPP Salary Detail PDF showed
// every HO Salary/Advance/Generic/Net figure as ₨0 for every employee,
// AND included rows the on-screen sheet already had marked "Hidden from
// print" (🖨🚫 / printSkip). Root cause: the report was built straight
// off the module-level `_salRows_cur` snapshot, with no guarantee that
// snapshot was actually the current saved state for the selected month
// at the moment Print was clicked.
//
// The fix (see manager-reports.js) makes printSalaryReport() reload the
// selected month fresh from storage immediately before building the PDF,
// and warns instead of silently printing when every figure is 0. These
// tests exercise both, plus the pre-existing printSkip filter, by
// monkey-patching Print.render to capture the HTML it would have handed
// to jsPDF/html2canvas (neither of which is available under Node/jsdom).
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv(`<!doctype html><html><body>
  <select id="sal-month-sel"><option value="July 2026">July 2026</option><option value="August 2026" selected>August 2026</option></select>
  <table><tbody id="sal-tbody"></tbody><tfoot id="sal-tfoot"></tfoot></table>
</body></html>`);

// printSalaryReport() calls window.confirm(...) when every figure is 0;
// jsdom doesn't implement it, so provide a controllable stub.
let _confirmReturn = true;
globalThis.confirm = () => _confirmReturn;
window.confirm = globalThis.confirm;

const { Repository } = await import('../../js/repository.js');
const { Actions } = await import('../../js/actions.js');
const PrintMod = await import('../../js/print.js');
const salaryMod = await import('../../js/manager-salary.js');
const reportsMod = await import('../../js/manager-reports.js');

function selectMonth(my) {
  document.getElementById('sal-month-sel').value = my;
}

// Capture whatever HTML printSalaryReport() would have sent to the PDF
// engine, without needing real jsPDF/html2canvas.
function captureRenderedHtml(fn) {
  let captured = null;
  const original = PrintMod.Print.render;
  PrintMod.Print.render = (html) => { captured = html; };
  try { fn(); } finally { PrintMod.Print.render = original; }
  return captured;
}

beforeEach(() => {
  resetStorage();
  Repository.setStaff([]);
  _confirmReturn = true;
  selectMonth('August 2026');
});

describe('printSalaryReport() — stale-snapshot fix', () => {
  test('reloads the selected month from storage instead of trusting a stale in-memory snapshot', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });

    // Save real, non-zero August figures to storage.
    selectMonth('August 2026');
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 43009;
    salaryMod._salRows_cur[0].advance = 1040;
    salaryMod._salRows_cur[0].generic = 4257;
    salaryMod.saveSalaryData(true);

    // Now load a DIFFERENT month into memory — leaves _salRows_cur
    // holding blank/zeroed July rows, simulating a stale snapshot still
    // sitting in memory when the user switches back to August and hits
    // Print without this month having been (re)loaded in this session.
    salaryMod.loadSalaryMonth('July 2026');
    assert.equal(salaryMod._salRows_cur[0].hoSal, 0, 'sanity check: July should be blank');

    selectMonth('August 2026');
    const html = captureRenderedHtml(() => reportsMod.printSalaryReport());

    assert.ok(html, 'a report should have been rendered');
    assert.match(html, /43,009/, 'should show the real saved HO Salary, not a stale/blank snapshot');
    assert.match(html, /Mian Waqas/);
  });

  test('excludes rows toggled Hidden from print (🖨🚫 / printSkip)', () => {
    Actions.addEmployee({ name: 'Salman Yasin', designation: 'Manager' });
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });

    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 50000;
    salaryMod._salRows_cur[0].printSkip = true; // hide Salman Yasin from print
    salaryMod._salRows_cur[1].hoSal = 43009;
    salaryMod.saveSalaryData(true);

    const html = captureRenderedHtml(() => reportsMod.printSalaryReport());

    assert.ok(html);
    assert.doesNotMatch(html, /Salman Yasin/, 'printSkip row must not appear in the printed report');
    assert.match(html, /Mian Waqas/);
  });

  test('warns instead of silently printing an all-zero report, and respects Cancel', () => {
    Actions.addEmployee({ name: 'Dr Hamza', designation: 'Pharmacist' });
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod.saveSalaryData(true); // all figures default to 0 — nothing entered yet

    _confirmReturn = false; // user clicks Cancel
    const htmlCancelled = captureRenderedHtml(() => reportsMod.printSalaryReport());
    assert.equal(htmlCancelled, null, 'Cancelling the all-zero warning must not produce a PDF');

    _confirmReturn = true; // user clicks OK anyway
    const htmlConfirmed = captureRenderedHtml(() => reportsMod.printSalaryReport());
    assert.ok(htmlConfirmed, 'confirming should still print if the user really wants to');
  });

  test('skips the all-zero warning entirely when real figures are present', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 43009;
    salaryMod.saveSalaryData(true);

    let confirmCalled = false;
    globalThis.confirm = () => { confirmCalled = true; return true; };
    captureRenderedHtml(() => reportsMod.printSalaryReport());
    globalThis.confirm = () => _confirmReturn;

    assert.equal(confirmCalled, false, 'confirm() should not fire when figures are non-zero');
  });
});

describe('salary custom columns (+ / −)', () => {
  // loadSalaryMonth() deliberately keeps in-memory edits when reloading the SAME month,
  // so park the module on another month first to start each test clean.
  beforeEach(() => { salaryMod.loadSalaryMonth('June 2026'); });

  test('net adds "+" columns and subtracts "−" columns, per row', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 40000;
    salaryMod._salRows_cur[0].advance = 1000;
    assert.ok(salaryMod.salAddColumn('Bonus', '+'));
    assert.ok(salaryMod.salAddColumn('Fine', '-'));
    const r = salaryMod._salRows_cur[0];
    r.extras.find(e => e.name === 'Bonus').amount = 2500;
    r.extras.find(e => e.name === 'Fine').amount = 700;
    assert.equal(salaryMod._salNet(r), 40000 - 1000 + 0 + 2500 - 700);
  });

  test('rejects blank and duplicate column names', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('August 2026');
    globalThis.toast = () => {}; window.toast = globalThis.toast;
    assert.equal(salaryMod.salAddColumn('  ', '+'), false);
    assert.ok(salaryMod.salAddColumn('Fine', '-'));
    assert.equal(salaryMod.salAddColumn('fine', '+'), false);
  });

  test('columns and amounts persist, and appear in the printed report with the right net', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 43009;
    salaryMod.salAddColumn('Fine', '-');
    salaryMod._salRows_cur[0].extras[0].amount = 1009;
    salaryMod.saveSalaryData(true);

    salaryMod.loadSalaryMonth('July 2026'); // switch away, then back through print
    selectMonth('August 2026');
    const html = captureRenderedHtml(() => reportsMod.printSalaryReport());
    assert.match(html, /Fine \(−\)/);
    assert.match(html, /−₨1,009/);
    assert.match(html, /₨42,000/, 'net = 43,009 − 1,009');
  });

  test('toggling a column sign flips its effect on net; removing it drops the amounts', () => {
    Actions.addEmployee({ name: 'Mian Waqas', designation: 'APM' });
    salaryMod.loadSalaryMonth('August 2026');
    salaryMod._salRows_cur[0].hoSal = 1000;
    salaryMod.salAddColumn('Adj', '+');
    salaryMod._salRows_cur[0].extras[0].amount = 100;
    assert.equal(salaryMod._salNet(salaryMod._salRows_cur[0]), 1100);
    const id = salaryMod._salRows_cur[0].extras[0].id;
    salaryMod.salToggleColSign(id);
    assert.equal(salaryMod._salNet(salaryMod._salRows_cur[0]), 900);
    globalThis.confirm = () => true;
    salaryMod.salRemoveColumn(id);
    assert.equal(salaryMod._salNet(salaryMod._salRows_cur[0]), 1000);
    assert.equal(salaryMod._salCols(salaryMod._salRows_cur).length, 0);
  });
});
