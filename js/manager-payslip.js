// ══════════════════════════════════════════════════════════════════════
// MANAGER — STAFF PAYSLIP  (ES module)
//
// Lives inside the Staff Card as a 3rd tab ("🧾 Payslip"), next to
// Details and Credit Ledger. Pick a month → pulls that employee's row
// from the three per-month sheets that already exist (Salary, Credit,
// Generic Working) and renders one combined slip, with:
//   🖨 Print   — funnels through print.js's Print.render, same "one
//                door" pattern every other report in the app uses.
//   📱 WhatsApp — opens wa.me with the slip pre-filled as text so the
//                manager reviews/sends it themselves (no WhatsApp
//                Business API template approval needed, unlike the
//                automated daily briefing in supabase/functions/).
//
// Reads data.salary[my] / data.credit[my] / data.generic[my] directly
// (not the *_cur live arrays those sheets use) because the Staff Card
// can be opened for ANY past month, independent of whatever month the
// Salary/Generic/Credit tabs currently have loaded.
// ══════════════════════════════════════════════════════════════════════
import { Print } from './print.js';
import { STAFF } from './config.js';
import { _ni, _fc2, mgrLoad, _mgrPopSel, mgrMonths } from './manager-shared.js';
import { _crdNet } from './manager-credit.js';
import { _genIncentive } from './manager-generic.js';
import { _salNet } from './manager-salary.js';

const _norm = s => (s || '').trim().toLowerCase();

function _slipSalaryRow(my, name) {
  const data = mgrLoad();
  const rows = (data.salary && data.salary[my]) || [];
  return rows.find(r => _norm(r.name) === _norm(name)) || { desig: '', days: 31, hoSal: 0, advance: 0, generic: 0 };
}
function _slipCreditRow(my, name) {
  const data = mgrLoad();
  const rows = (data.credit && data.credit[my]) || [];
  return rows.find(r => _norm(r.name) === _norm(name)) || { prevBal: 0, entries: [], salary: 0, lessGeneric: 0 };
}
function _slipGenericRow(my, name) {
  const data = mgrLoad();
  const rows = (data.generic && data.generic[my]) || [];
  return rows.find(r => _norm(r.name) === _norm(name)) || { genericSale: 0, extra: 0 };
}

// Pakistani numbers arrive in all sorts of shapes (03XX-XXXXXXX,
// 03XXXXXXXXX, +923XXXXXXXXX, 00923XXXXXXXXX) — wa.me needs plain
// digits, country code first, no leading 0.
function _waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('92')) return d;
  if (d.startsWith('0')) return '92' + d.slice(1);
  if (d.length === 10) return '92' + d; // e.g. "3001234567" with no leading 0
  return d;
}

let _slipCur = null; // { name, my, emp, salRow, crdRow, genRow }

function _slipEmp() {
  const i = parseInt(document.getElementById('sc-idx')?.value);
  return Number.isInteger(i) ? STAFF[i] : null;
}

function loadStaffPayslipMonth() {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  renderStaffPayslip(name);
}

function renderStaffPayslip(name) {
  const cont = document.getElementById('sc-slip-body');
  if (!cont) return;
  const sel = document.getElementById('sc-slip-month-sel');
  const my = sel?.value || mgrMonths()[0] || '';
  const emp = _slipEmp() || { name };
  const salRow = _slipSalaryRow(my, name);
  const crdRow = _slipCreditRow(my, name);
  const genRow = _slipGenericRow(my, name);
  const net = _salNet(salRow);
  const crdNetVal = _crdNet(crdRow);
  _slipCur = { name, my, emp, salRow, crdRow, genRow };

  const sid = emp.staffId || '';
  const netCol = net > 0 ? 'var(--green,#16a34a)' : net < 0 ? 'var(--red,#dc2626)' : 'var(--muted)';
  const crdCol = crdNetVal > 0 ? 'var(--green,#16a34a)' : crdNetVal < 0 ? 'var(--red,#dc2626)' : 'var(--muted)';
  const row = (label, val, opts) => `<div style="display:flex;justify-content:space-between;padding:5px 0;${opts?.bold?'font-weight:700':''}${opts?.top?';border-top:1px solid var(--border);margin-top:4px;padding-top:9px':''}">
    <span style="color:${opts?.bold?'var(--text)':'var(--muted)'};font-size:${opts?.bold?'13px':'12px'}">${label}</span>
    <span style="font-family:var(--mono);font-size:${opts?.bold?'14px':'12px'};color:${opts?.color||'var(--text)'}">₨${_fc2(val)}</span>
  </div>`;

  const entryRows = (crdRow.entries || []).length
    ? crdRow.entries.map(e => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:var(--t2)">
        <span>${e.date || ''} — ${e.desc || ''}</span>
        <span style="font-family:var(--mono);color:${_ni(e.amount)<0?'var(--red,#dc2626)':'var(--green,#16a34a)'}">₨${_fc2(e.amount)}</span>
      </div>`).join('')
    : '<div style="font-size:11px;color:var(--muted);padding:3px 0">No credit entries this month.</div>';

  cont.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="background:var(--accent);color:#fff;padding:12px 16px">
        <div style="font-size:14px;font-weight:700">${emp.name || name}${sid ? ' <span style="opacity:.8;font-weight:400;font-size:12px">(' + sid + ')</span>' : ''}</div>
        <div style="font-size:11px;opacity:.85">${salRow.desig || emp.designation || ''} · ${my} · ${salRow.days || 31} days</div>
      </div>
      <div style="padding:12px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px">Salary</div>
        ${row('HO Salary', salRow.hoSal)}
        ${row('Advance', salRow.advance, { color: _ni(salRow.advance) > 0 ? 'var(--red,#dc2626)' : 'var(--text)' })}
        ${row('Generic Add-on', salRow.generic)}
        <div style="font-size:10px;color:var(--muted);padding:0 0 4px">↳ Incentive (4% of ₨${_fc2(genRow.genericSale)}): ₨${_fc2(_genIncentive(genRow))} + Extra: ₨${_fc2(genRow.extra)}</div>
        ${row('Net Salary', net, { bold: true, top: true, color: netCol })}
      </div>
      <div style="padding:0 16px 14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:6px 0 2px">Credit Ledger</div>
        ${row('Previous Balance', crdRow.prevBal)}
        <div style="margin:4px 0">${entryRows}</div>
        ${row('Salary Paid (from Credit sheet)', crdRow.salary)}
        ${row('Less Generic', crdRow.lessGeneric)}
        ${row('Net Credit Balance', crdNetVal, { bold: true, top: true, color: crdCol })}
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-p" style="flex:1;font-size:12px;padding:8px" onclick="printStaffPayslip()">🖨 Print Slip</button>
      <button class="btn" style="flex:1;font-size:12px;padding:8px;background:#25D366;color:#fff;border:none" onclick="sendPayslipWhatsApp()">📱 Send via WhatsApp</button>
    </div>
    ${!emp.phone ? '<div style="font-size:11px;color:var(--muted);margin-top:6px">⚠ No phone number on file — add one in the Details tab to enable WhatsApp send.</div>' : ''}
  `;
}

// Called once when the Payslip tab is first opened for this employee —
// populates the month dropdown (same continuous month list every other
// Manager sheet uses) and renders the current month by default.
function initStaffPayslipTab(name) {
  const sel = document.getElementById('sc-slip-month-sel');
  if (!sel) return;
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const defaultMy = names[now.getMonth()] + ' ' + now.getFullYear();
  _mgrPopSel('sc-slip-month-sel', defaultMy);
  renderStaffPayslip(name);
}

function printStaffPayslip() {
  if (!_slipCur) return;
  const { name, my, emp, salRow, crdRow } = _slipCur;
  const net = _salNet(salRow);
  const crdNetVal = _crdNet(crdRow);
  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const sid = emp.staffId || '';
  const entryRows = (crdRow.entries || []).map(e => `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${e.date || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px">${e.desc || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #eee;font-size:11px;text-align:right;font-family:monospace">₨${_fc2(e.amount)}</td>
    </tr>`).join('') || `<tr><td colspan="3" style="padding:8px;text-align:center;color:#888;font-size:11px">No credit entries this month</td></tr>`;

  const line = (label, val, opts) => `<tr>
      <td style="padding:5px 8px;${opts?.bold?'font-weight:700':''}">${label}</td>
      <td style="padding:5px 8px;text-align:right;font-family:monospace;${opts?.bold?'font-weight:700':''}">₨${_fc2(val)}</td>
    </tr>`;

  Print.render(`<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">FDPP — SALARY SLIP</h2><p style="margin:4px 0 0;font-size:11px;opacity:.75">Bahria Town · ${my}</p></div>
      <div style="font-size:11px;opacity:.75">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="padding:3px 8px;font-size:12px;color:#555">Employee</td><td style="padding:3px 8px;font-size:13px;font-weight:700">${emp.name || name}${sid ? ' (' + sid + ')' : ''}</td></tr>
      <tr><td style="padding:3px 8px;font-size:12px;color:#555">Designation</td><td style="padding:3px 8px;font-size:12px">${salRow.desig || emp.designation || ''}</td></tr>
      <tr><td style="padding:3px 8px;font-size:12px;color:#555">Days</td><td style="padding:3px 8px;font-size:12px">${salRow.days || 31}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
      <thead><tr style="background:#f8fafc"><th colspan="2" style="padding:6px 8px;text-align:left;border-bottom:2px solid #000;font-size:11px">SALARY</th></tr></thead>
      <tbody>
        ${line('HO Salary', salRow.hoSal)}
        ${line('Advance', salRow.advance)}
        ${line('Generic Add-on', salRow.generic)}
        ${line('NET SALARY', net, { bold: true })}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc"><th colspan="3" style="padding:6px 8px;text-align:left;border-bottom:2px solid #000;font-size:11px">CREDIT LEDGER</th></tr></thead>
      <tbody>
        <tr><td colspan="2" style="padding:5px 8px">Previous Balance</td><td style="padding:5px 8px;text-align:right;font-family:monospace">₨${_fc2(crdRow.prevBal)}</td></tr>
        ${entryRows}
        <tr><td colspan="2" style="padding:5px 8px">Salary Paid</td><td style="padding:5px 8px;text-align:right;font-family:monospace">₨${_fc2(crdRow.salary)}</td></tr>
        <tr><td colspan="2" style="padding:5px 8px">Less Generic</td><td style="padding:5px 8px;text-align:right;font-family:monospace">₨${_fc2(crdRow.lessGeneric)}</td></tr>
        <tr><td colspan="2" style="padding:6px 8px;font-weight:700;border-top:2px solid #000">NET CREDIT BALANCE</td><td style="padding:6px 8px;text-align:right;font-family:monospace;font-weight:700;border-top:2px solid #000">₨${_fc2(crdNetVal)}</td></tr>
      </tbody>
    </table>
    <p style="font-size:10px;color:#888;margin-top:18px">This is a system-generated slip — no signature required.</p>
  </div>`);
}

function sendPayslipWhatsApp() {
  if (!_slipCur) return;
  const { name, my, emp, salRow, crdRow } = _slipCur;
  const phone = _waDigits(emp.phone);
  if (!phone) { toast('⚠ Add a phone number in the Details tab first.', 'w'); return; }
  const net = _salNet(salRow);
  const crdNetVal = _crdNet(crdRow);
  const sid = emp.staffId ? ' (' + emp.staffId + ')' : '';
  const entryLines = (crdRow.entries || []).length
    ? crdRow.entries.map(e => `• ${e.date || ''}: ${e.desc || '-'} — Rs ${_fc2(e.amount)}`).join('\n')
    : '(no entries this month)';
  const msg = [
    `🧾 *Salary Slip — ${my}*`,
    `FDPP — Bahria Town`,
    ``,
    `*${emp.name || name}*${sid}`,
    `${salRow.desig || emp.designation || ''} · Days: ${salRow.days || 31}`,
    ``,
    `HO Salary: Rs ${_fc2(salRow.hoSal)}`,
    `Advance: Rs ${_fc2(salRow.advance)}`,
    `Generic Add-on: Rs ${_fc2(salRow.generic)}`,
    `*Net Salary: Rs ${_fc2(net)}*`,
    ``,
    `💳 *Credit Ledger — ${my}*`,
    `Previous Balance: Rs ${_fc2(crdRow.prevBal)}`,
    entryLines,
    `Salary Paid: Rs ${_fc2(crdRow.salary)}`,
    `Less Generic: Rs ${_fc2(crdRow.lessGeneric)}`,
    `*Net Credit Balance: Rs ${_fc2(crdNetVal)}*`,
    ``,
    `Thank you.`,
  ].join('\n');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

Object.assign(window, {
  renderStaffPayslip, initStaffPayslipTab, loadStaffPayslipMonth,
  printStaffPayslip, sendPayslipWhatsApp,
});

export {
  renderStaffPayslip, initStaffPayslipTab, loadStaffPayslipMonth,
  printStaffPayslip, sendPayslipWhatsApp,
};
