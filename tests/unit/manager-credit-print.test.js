// ══════════════════════════════════════════════════════════════════════
// REGRESSION TEST — js/manager-reports.js: printCreditReport() /
// printCreditSummaryReport()
//
// Covers a real reported bug: clicking "Print Detailed" on the Staff
// Credits sheet produced a PDF with just the header and no employee
// blocks at all — even though the on-screen sheet clearly had rows that
// weren't marked "Hidden from print". Root cause: the report trusted
// `_crdData_cur` whenever it was merely truthy, and an empty array
// (`[]`) is truthy in JS — so a print triggered against a stale or
// not-yet-populated in-memory snapshot never fell back to a fresh
// reload from storage the way the code's own comment claimed it did.
//
// The fix (see manager-reports.js) reloads the selected month via
// loadCreditMonth(my) right before building either report whenever the
// sheet is actually on screen for that month, and warns instead of
// silently printing an empty report when nothing is left to print.
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv(`<!doctype html><html><body>
  <select id="crd-month-sel"><option value="July 2026">July 2026</option><option value="August 2026" selected>August 2026</option></select>
  <div id="crd-employees"></div>
</body></html>`);

const { Repository } = await import('../../js/repository.js');
const { Actions } = await import('../../js/actions.js');
const PrintMod = await import('../../js/print.js');
const creditMod = await import('../../js/manager-credit.js');
const reportsMod = await import('../../js/manager-reports.js');

// manager-credit.js's on-screen renderer (renderCreditLedger → entryRowsFor)
// calls a couple of manager-shared.js helpers (_inp, etc.) as bare globals,
// the same way classic <script> code would — manager-shared.js bridges them
// onto `window` for that reason. installDomEnv only bridges `window` itself
// onto Node's globalThis, not everything manager-shared.js in turn hangs off
// of `window`, so mirror that last step here too (loadCreditMonth() below
// triggers this render path, same as opening the Credit Ledger tab would).
Object.assign(globalThis, { _inp: window._inp, _mgrPopSel: window._mgrPopSel, _mgrEsc: window._mgrEsc });

function selectMonth(my) {
  document.getElementById('crd-month-sel').value = my;
}

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
  selectMonth('August 2026');
});

describe('printCreditReport() / printCreditSummaryReport() — stale/empty-snapshot fix', () => {
  test('reloads from storage instead of trusting a stale in-memory snapshot (Detailed)', () => {
    Actions.addEmployee({ name: 'Mian Waqas' });

    selectMonth('August 2026');
    creditMod.loadCreditMonth('August 2026');
    creditMod._crdData_cur[0].entries = [{ date: '06-Aug', desc: 'advance', amount: 1040 }];
    creditMod.saveCreditData(true);

    // Load a different month into memory, simulating a stale snapshot
    // still sitting in _crdData_cur when the user switches back and
    // hits Print without August having been (re)loaded this session.
    creditMod.loadCreditMonth('July 2026');
    assert.equal(creditMod._crdData_cur[0].entries.length, 0, 'sanity check: July should be blank');

    selectMonth('August 2026');
    const html = captureRenderedHtml(() => reportsMod.printCreditReport());

    assert.ok(html, 'a report should have been rendered');
    assert.match(html, /Mian Waqas/);
    assert.match(html, /1,040/, 'should show the real saved entry, not a stale/blank snapshot');
  });

  test('excludes rows toggled Hidden from print, but still prints the remaining rows (Detailed)', () => {
    Actions.addEmployee({ name: 'Salman Yasin' });
    Actions.addEmployee({ name: 'Mian Waqas' });

    creditMod.loadCreditMonth('August 2026');
    creditMod._crdData_cur[0].printSkip = true; // hide Salman Yasin
    creditMod._crdData_cur[0].entries = [{ date: '05-Aug', desc: 'advance', amount: 5000 }];
    creditMod._crdData_cur[1].entries = [{ date: '06-Aug', desc: 'advance', amount: 1040 }];
    creditMod.saveCreditData(true);

    const html = captureRenderedHtml(() => reportsMod.printCreditReport());

    assert.ok(html, 'the two hidden employees still leave one visible row to print');
    assert.doesNotMatch(html, /Salman Yasin/, 'printSkip row must not appear');
    assert.match(html, /Mian Waqas/);
  });

  test('warns instead of silently printing a blank PDF when every row is hidden (Detailed)', () => {
    Actions.addEmployee({ name: 'Salman Yasin' });
    creditMod.loadCreditMonth('August 2026');
    creditMod._crdData_cur[0].printSkip = true;
    creditMod.saveCreditData(true);

    const html = captureRenderedHtml(() => reportsMod.printCreditReport());
    assert.equal(html, null, 'must not render a header-only/blank PDF — should warn and bail instead');
  });

  test('Summary report gets the same reload + guard', () => {
    Actions.addEmployee({ name: 'Mian Waqas' });
    creditMod.loadCreditMonth('August 2026');
    creditMod._crdData_cur[0].prevBal = 8646;
    creditMod.saveCreditData(true);
    creditMod.loadCreditMonth('July 2026'); // stale snapshot in memory
    selectMonth('August 2026');

    const html = captureRenderedHtml(() => reportsMod.printCreditSummaryReport());
    assert.ok(html);
    assert.match(html, /Mian Waqas/);
    assert.match(html, /8,646/);
  });
});
