// ══════════════════════════════════════════════════════════════════════
// MANAGER — PRINT REPORTS  (ES module, split from manager.js)
//
// Print-friendly renderers for the Manager dashboard, Salary, Generic
// Working, and Credit ledger sections. All rendering funnels through
// `_mgrPrint`, the one function here that actually calls Print.render —
// same "single door" pattern as the rest of the app's print flow
// (see print.js's own header comment).
// ══════════════════════════════════════════════════════════════════════
import { Print } from './print.js';
import { STAFF } from './config.js';
import { _ni, _fc2 } from './manager-shared.js';
import { _crdData, _crdData_cur, _crdNet } from './manager-credit.js';
import { _genRows_cur, _genFinal, _genIncentive } from './manager-generic.js';
import { _salRows_cur, _salNet } from './manager-salary.js';

// MANAGER PRINT FUNCTIONS
// ══════════════════════════════
function _mgrPrint(html) {
  Print.render(html);
}

// The Manager Dashboard page's toolbar Print button used to call a bare
// window.print() directly from index.html — a pre-Floor-4 leftover that
// was never migrated when print.js consolidated every report behind
// Print.render()/#print-area (see print.js's header comment). Since then,
// the shared @media print rule in pages.css hides everything except
// #print-area, so that bare window.print() call printed a BLANK page —
// #print-area was empty because nothing had populated it. Fix: clone the
// already-rendered Credit Details + Working Summary sections (both are
// plain, already-computed DOM at this point — no need to recompute
// anything) into a header-wrapped report and hand it to Print.render(),
// same as every other report in the app.
function printManagerDashboard() {
  const creditEl = document.getElementById('dash-credit-section');
  const workEl = document.getElementById('dash-working-section');
  if (!creditEl || !creditEl.innerHTML.trim()) {
    toast('⚠ Manager Dashboard is still loading — try again in a moment.', 'w');
    return;
  }
  const today = new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  const workingHtml = (workEl && workEl.style.display !== 'none' && workEl.innerHTML.trim())
    ? `<div style="margin-top:14px">${workEl.innerHTML}</div>` : '';
  _mgrPrint(`<div style="max-width:900px;margin:0 auto">
    <div class="pr-header">
      <div><h1>BAHRIA TOWN SALES IC</h1><p>Manager Dashboard — Staff Credit · Jazz Cash · Patty/Expenses · Working Summary</p></div>
      <div class="pr-meta">Printed: ${today}</div>
    </div>
    ${creditEl.innerHTML}
    ${workingHtml}
  </div>`);
}

function printSalaryReport() {
  const my = document.getElementById('sal-month-sel').value;
  const rows = _salRows_cur;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const trows = rows.map((r,i) => `<tr>
    <td style="padding:5px 8px;border-bottom:1px solid #eee">${i+1}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:600">${r.name}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee">${r.desig}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">${r.days}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.hoSal)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.advance)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.generic)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;color:#1e40af">₨${_fc2(_salNet(r))}</td>
  </tr>`).join('');
  const totNet = rows.reduce((s,r) => s + _salNet(r), 0);
  _mgrPrint(`<div style="max-width:700px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">FDPP SALARY DETAIL — BAHRIA TOWN</h2><p style="margin:4px 0 0;font-size:11px;opacity:.7">${my}</p></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">#</th>
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">Name</th>
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">Designation</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Days</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">HO Salary</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Advance</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Generic</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Net Salary</th>
      </tr></thead>
      <tbody>${trows}</tbody>
      <tfoot><tr style="background:#eff6ff">
        <td colspan="7" style="padding:7px 8px;font-weight:700;font-size:11px">TOTAL</td>
        <td style="padding:7px 8px;text-align:right;font-weight:700;font-family:monospace;color:#1e40af">₨${_fc2(totNet)}</td>
      </tr></tfoot>
    </table>
  </div>`);
}

function printGenericReport() {
  const my = document.getElementById('gen-month-sel').value;
  const rows = _genRows_cur;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const trows = rows.map((r,i) => `<tr>
    <td style="padding:5px 8px;border-bottom:1px solid #eee">${i+1}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:600">${r.name}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee">${r.desig}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.genericSale)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;color:#059669">₨${_fc2(_genIncentive(r))}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.extra)}</td>
    <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;color:#1e40af">₨${_fc2(_genFinal(r))}</td>
  </tr>`).join('');
  const totFin = rows.reduce((s,r) => s + _genFinal(r), 0);
  _mgrPrint(`<div style="max-width:680px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">GENERIC WORKING — ${my}</h2><p style="margin:4px 0 0;font-size:11px;opacity:.7">4% incentive on generic sales</p></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">#</th>
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">Name</th>
        <th style="padding:7px 8px;text-align:left;border-bottom:2px solid #000;font-size:10px">Designation</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Generic Sale</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Incentive (4%)</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Extra</th>
        <th style="padding:7px 8px;text-align:right;border-bottom:2px solid #000;font-size:10px">Final</th>
      </tr></thead>
      <tbody>${trows}</tbody>
      <tfoot><tr style="background:#eff6ff">
        <td colspan="6" style="padding:7px 8px;font-weight:700;font-size:11px">TOTAL INCENTIVE</td>
        <td style="padding:7px 8px;text-align:right;font-weight:700;font-family:monospace;color:#1e40af">₨${_fc2(totFin)}</td>
      </tr></tfoot>
    </table>
  </div>`);
}

function printCreditReport(myArg) {
  const sel = document.getElementById('crd-month-sel');
  const my = myArg || (sel ? sel.value : '') || (typeof BTDate !== 'undefined' ? BTDate.currentMonthYear() : '');
  // Use the on-screen working copy only if it matches the requested month; otherwise load fresh from storage (headless-safe).
  const emps = (sel && sel.value === my && _crdData_cur) ? _crdData_cur : _crdData(my);
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const empBlocks = emps.map(emp => {
    const net = _crdNet(emp);
    const erows = emp.entries.map(en => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-size:11px">${en.date}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-size:11px">${en.desc}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;text-align:right;font-family:monospace;color:${_ni(en.amount)<0?'#dc2626':'#059669'}">₨${_fc2(en.amount)}</td>
    </tr>`).join('');
    return `<div style="margin-bottom:12px;break-inside:avoid">
      <div style="display:flex;justify-content:space-between;background:#1e3a5f;color:#fff;padding:6px 10px;border-radius:6px 6px 0 0">
        <strong style="font-size:13px">${emp.name}</strong>
        <span style="font-size:12px;font-family:monospace">Net: ₨${_fc2(net)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid #e2e8f0;border-top:none">
        <tr style="background:#f8fafc"><td style="padding:4px 8px">Prev Balance</td><td style="padding:4px 8px;text-align:right;font-family:monospace">₨${_fc2(emp.prevBal)}</td><td style="padding:4px 8px">Salary Paid</td><td style="padding:4px 8px;text-align:right;font-family:monospace">₨${_fc2(emp.salary)}</td><td style="padding:4px 8px">Less Generic</td><td style="padding:4px 8px;text-align:right;font-family:monospace">₨${_fc2(emp.lessGeneric)}</td></tr>
        ${erows || '<tr><td colspan="3" style="padding:6px 8px;color:#94a3b8;text-align:center">No entries</td></tr>'}
      </table>
    </div>`;
  }).join('');
  _mgrPrint(`<div style="max-width:680px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">STAFF CREDIT LEDGER (DETAILED) — ${my}</h2></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    ${empBlocks}
  </div>`);
}

// Compact one-row-per-employee balance summary — headless-safe (works from
// anywhere, e.g. the CommandHub "Credit Balance" quick action, without the
// Staff Credit tab having ever been opened on screen).
function printCreditSummaryReport(myArg) {
  const sel = document.getElementById('crd-month-sel');
  const my = myArg || (sel ? sel.value : '') || (typeof BTDate !== 'undefined' ? BTDate.currentMonthYear() : '');
  const emps = (sel && sel.value === my && _crdData_cur) ? _crdData_cur : _crdData(my);
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const rows = emps.map(emp => {
    const net = _crdNet(emp);
    const color = net > 0 ? '#059669' : net < 0 ? '#dc2626' : '#64748b';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${emp.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(emp.prevBal)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${emp.entries.length}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:700;color:${color}">₨${_fc2(net)}</td>
    </tr>`;
  }).join('');
  const totNet = emps.reduce((s,e) => s + _crdNet(e), 0);
  _mgrPrint(`<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">STAFF CREDIT — SUMMARY</h2><p style="margin:4px 0 0;font-size:11px;opacity:.7">${my}</p></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:7px 10px;text-align:left;border-bottom:2px solid #000;font-size:10px">Employee</th>
        <th style="padding:7px 10px;text-align:right;border-bottom:2px solid #000;font-size:10px">Prev Balance</th>
        <th style="padding:7px 10px;text-align:right;border-bottom:2px solid #000;font-size:10px">Entries</th>
        <th style="padding:7px 10px;text-align:right;border-bottom:2px solid #000;font-size:10px">Net Balance</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="padding:10px;text-align:center;color:#94a3b8">No staff credit data for this month</td></tr>'}</tbody>
      <tfoot><tr style="background:#eff6ff">
        <td colspan="3" style="padding:7px 10px;font-weight:700;font-size:11px">TOTAL NET</td>
        <td style="padding:7px 10px;text-align:right;font-weight:700;font-family:monospace;color:#1e40af">₨${_fc2(totNet)}</td>
      </tr></tfoot>
    </table>
  </div>`);
}


// ══════════════════════════════════════════════════════
// PETTY CASH DETAIL
// ══════════════════════════════════════════════════════

Object.assign(window, {
  _mgrPrint, printManagerDashboard, printSalaryReport, printGenericReport,
  printCreditReport, printCreditSummaryReport,
});

export {
  _mgrPrint, printManagerDashboard, printSalaryReport, printGenericReport,
  printCreditReport, printCreditSummaryReport,
};
