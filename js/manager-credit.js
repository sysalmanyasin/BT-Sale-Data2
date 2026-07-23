// ══════════════════════════════════════════════════════════════════════
// MANAGER — STAFF CREDIT LEDGER  (ES module, split from manager.js)
//
// Per-month, per-employee advance/credit tracking: previous balance +
// dated entries + salary/less-generic deductions = net. Also owns
// "Copy to Next Month" (rolls each employee's net into next month's
// opening balance).
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { STAFF } from './config.js';
import { _ni, _fc2, _mgrPopSel, mgrLoad, mgrSave } from './manager-shared.js';
import { activeStaff } from './manager-staff.js';

// ══════════════════════════════
// STAFF CREDIT LEDGER
// ══════════════════════════════
let _crdData_cur = []; // [{name, prevBal, entries:[{date,desc,amount}], salary, lessGeneric}]

function _crdData(my) {
  const data = mgrLoad();
  return (data.credit && data.credit[my]) || activeStaff().map(e => ({name:e.name, prevBal:0, entries:[], salary:0, lessGeneric:0}));
}

function _crdNet(emp) {
  const totalEntries = emp.entries.reduce((s,e) => s + _ni(e.amount), 0);
  return _ni(emp.prevBal) + totalEntries - _ni(emp.salary) - _ni(emp.lessGeneric);
}

function _crdEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderCreditLedger(emps) {
  const container = document.getElementById('crd-employees');
  if (!container) return;
  const _cNorm = s => (s || '').trim().toLowerCase();
  // Order rows exactly like Staff Registry (by Sr#), so the two lists
  // always read the same way — anyone no longer in STAFF sinks to the end.
  const rows = emps.map((emp, ei) => {
    const cIdx = STAFF.findIndex(s => _cNorm(s.name) === _cNorm(emp.name));
    const cEmp = cIdx >= 0 ? STAFF[cIdx] : null;
    const srNum = cEmp && cEmp.srNum != null ? Number(cEmp.srNum) : 999;
    const sid = cEmp ? (cEmp.staffId || ('EMP-' + String(cIdx + 1).padStart(3, '0'))) : null;
    return { emp, ei, cIdx, sid, srNum };
  }).sort((a, b) => a.srNum - b.srNum);

  const entryRowsFor = (emp, ei) => emp.entries.map((en, eni) => `
      <tr class="mgr-tr">
        <td class="mgr-td">${_inp('text', en.date||'', '', `crdEntryChange(${ei},${eni},'date',this.value)`, 'Date')}</td>
        <td class="mgr-td">${_inp('text', en.desc||'', '', `crdEntryChange(${ei},${eni},'desc',this.value)`, 'Description (credit/deduction/…)')}${en.source==='closing_app' ? ' <span title="From Closing App" style="font-size:11px;background:var(--blue,#2563eb);color:#fff;padding:1px 6px;border-radius:10px;">📱</span>' : ''}</td>
        <td class="mgr-td"><input type="number" value="${en.amount||0}" class="mgr-inp sal-num" style="font-weight:700;${_ni(en.amount)<0?'color:var(--red)':'color:var(--green)'}" placeholder="0 (negative=deduction)" oninput="crdEntryChange(${ei},${eni},'amount',this.value);recalcCrdEmp(${ei})"></td>
        <td class="mgr-td" style="text-align:center"><button class="mgr-del" onclick="deleteCrdEntry(${ei},${eni})">🗑</button></td>
      </tr>`).join('');

  container.innerHTML = `<div class="crd-table-wrap"><table class="crd-table">
    <thead><tr>
      <th class="crd-th-sr">Sr#</th><th class="crd-th-name">Staff</th>
      <th>Prev</th><th>Salary</th><th>LessGen</th><th>Net</th><th></th>
    </tr></thead>
    <tbody>
    ${rows.map(({ emp, ei, cIdx, sid, srNum }) => {
      const net = _crdNet(emp);
      const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
      const nameClick = cIdx >= 0 ? `openStaffCard(${cIdx})` : `_toggleCrdEmpBody(${ei})`;
      return `
      <tr class="crd-row">
        <td class="crd-td-sr">${srNum !== 999 ? srNum : '—'}</td>
        <td class="crd-td-name">
          ${sid ? `<button class="crd-sid-pill" onclick="event.stopPropagation();openStaffCard(${cIdx})" title="Open Staff Card">${sid}</button>` : ''}
          <span class="crd-name-link" onclick="${nameClick}">${_crdEsc(emp.name || '(unnamed)')}</span>
          ${emp.entries.length ? `<span class="crd-entry-badge">${emp.entries.length}</span>` : ''}
        </td>
        <td class="crd-td-num">₨${_fc2(emp.prevBal)}</td>
        <td class="crd-td-num">₨${_fc2(emp.salary)}</td>
        <td class="crd-td-num">₨${_fc2(emp.lessGeneric)}</td>
        <td class="crd-td-num crd-td-net" style="color:${netColor}" id="crd-net-${ei}">₨${_fc2(net)}</td>
        <td class="crd-td-action">
          <button class="crd-expand-btn" id="crd-chev-${ei}" onclick="_toggleCrdEmpBody(${ei})" title="Quick-edit this month right here">▶</button>
        </td>
      </tr>
      <tr class="crd-body-row" id="crd-body-${ei}" style="display:none">
        <td colspan="7">
          <div class="crd-emp-fields">
            <div class="fg"><label>Previous Balance (₨)</label><input type="number" value="${emp.prevBal||0}" class="mgr-inp" oninput="crdEmpField(${ei},'prevBal',this.value);recalcCrdEmp(${ei})"></div>
            <div class="fg"><label>Salary Paid (₨)</label><input type="number" value="${emp.salary||0}" class="mgr-inp" oninput="crdEmpField(${ei},'salary',this.value);recalcCrdEmp(${ei})"></div>
            <div class="fg"><label>Less Generic (₨)</label><input type="number" value="${emp.lessGeneric||0}" class="mgr-inp" oninput="crdEmpField(${ei},'lessGeneric',this.value);recalcCrdEmp(${ei})"></div>
          </div>
          <div style="padding:0 14px 14px">
          <table style="width:100%;border-collapse:collapse;min-width:420px;border:1px solid var(--border)">
            <thead><tr style="background:var(--accent);color:#fff">
              <th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Date</th>
              <th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Description</th>
              <th style="padding:7px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Amount (₨)</th>
              <th style="padding:7px 10px;border:1px solid rgba(255,255,255,.2)"></th>
            </tr></thead>
            <tbody id="crd-tbody-${ei}">${entryRowsFor(emp, ei)}</tbody>
          </table>
          ${emp.entries.length === 0 ? '<p style="text-align:center;color:var(--muted);font-size:12px;padding:14px">No entries yet — tap "＋ Entry" below to add.</p>' : ''}
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-p" style="font-size:11px;padding:5px 12px" onclick="addCrdEntryFocused(${ei})">💳 ＋ Entry</button>
            <button class="mgr-del" style="margin-left:auto" onclick="deleteCrdEmp(${ei})" title="Remove employee from this month">🗑 Remove</button>
          </div>
          </div>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;
  // Nothing auto-expands anymore — every row starts collapsed regardless
  // of whether it has entries, so a month with 20 staff reads as a clean
  // 20-row table instead of a wall of open forms.
}

function _toggleCrdEmpBody(ei) {
  const body = document.getElementById('crd-body-' + ei);
  const chev = document.getElementById('crd-chev-' + ei);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function addCrdEntryFocused(ei) {
  // Ensure body is open
  const body = document.getElementById('crd-body-' + ei);
  const chev = document.getElementById('crd-chev-' + ei);
  if (body) body.style.display = '';
  if (chev) chev.style.transform = 'rotate(90deg)';
  addCrdEntry(ei);
  // After render, focus the new amount input
  setTimeout(() => {
    const tbody = document.getElementById('crd-tbody-' + ei);
    if (!tbody) return;
    const inputs = tbody.querySelectorAll('input[type="number"]');
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }, 80);
}

function loadCreditMonth(my) {
  _crdData_cur = _crdData(my);
  window._crdData_cur = _crdData_cur; // keep the window bridge live — it's a snapshot copy otherwise (Quick Add relies on this staying current)
  renderCreditLedger(_crdData_cur);
}

function crdEmpField(ei, field, val) { _crdData_cur[ei][field] = _ni(val); }
function crdEntryChange(ei, eni, field, val) {
  _crdData_cur[ei].entries[eni][field] = field === 'amount' ? _ni(val) : val;
}
function recalcCrdEmp(ei) {
  const el = document.getElementById('crd-net-' + ei);
  if (!el) return;
  const net = _crdNet(_crdData_cur[ei]);
  el.textContent = 'Net: ₨' + _fc2(net);
  el.style.color = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
}
function addCrdEntry(ei) {
  const today = new Date();
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = String(today.getDate()).padStart(2,'0') + '-' + ms[today.getMonth()] + '-' + today.getFullYear();
  _crdData_cur[ei].entries.push({date:dateStr, desc:'credit', amount:0});
  renderCreditLedger(_crdData_cur);
  // Ensure the body stays open after re-render
  const body = document.getElementById('crd-body-' + ei);
  const chev = document.getElementById('crd-chev-' + ei);
  if (body) body.style.display = '';
  if (chev) chev.style.transform = 'rotate(90deg)';
}
function deleteCrdEntry(ei, eni) {
  _crdData_cur[ei].entries.splice(eni, 1);
  renderCreditLedger(_crdData_cur);
}
function addCreditEmployee() {
  _crdData_cur.push({name:'New Employee', prevBal:0, entries:[], salary:0, lessGeneric:0});
  renderCreditLedger(_crdData_cur);
}
function deleteCrdEmp(ei) {
  if (!confirm('Remove ' + _crdData_cur[ei].name + '?')) return;
  _crdData_cur.splice(ei, 1);
  renderCreditLedger(_crdData_cur);
}
function saveCreditData() {
  const my = document.getElementById('crd-month-sel').value;
  const data = mgrLoad();
  if (!data.credit) data.credit = {};
  data.credit[my] = _crdData_cur.map(e => ({...e, entries:[...e.entries]}));
  mgrSave(data);
  toast('✓ Staff Credit saved for ' + my);
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}


function copyToNextMonth() {
  const sel = document.getElementById('crd-month-sel');
  const curMy = sel.value;
  if (!curMy) { toast('⚠ Select a month first', 'w'); return; }

  // Save current month first
  const data = mgrLoad();
  if (!data.credit) data.credit = {};
  data.credit[curMy] = _crdData_cur.map(e => ({...e, entries:[...e.entries]}));
  mgrSave(data);

  // Compute next month string
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const parts = curMy.split(' ');       // e.g. ['June', '2026']
  const mIdx = MONTH_NAMES.indexOf(parts[0]);
  const yr   = parseInt(parts[1]);
  const nextMIdx = (mIdx + 1) % 12;
  const nextYr   = mIdx === 11 ? yr + 1 : yr;
  const nextMy   = MONTH_NAMES[nextMIdx] + ' ' + nextYr;

  // Build next month data: net of each employee becomes prevBal, entries reset
  const existingNext = data.credit[nextMy];
  if (existingNext) {
    if (!confirm(`${nextMy} already has data. Overwrite the Previous Balance values with this month's net balances? (Entries and salary fields will be kept as-is.)`)) return;
    // Merge: update prevBal only, keep existing entries/salary/lessGeneric
    const updated = existingNext.map(existing => {
      const src = _crdData_cur.find(e => e.name === existing.name);
      return src ? {...existing, prevBal: _crdNet(src)} : existing;
    });
    // Add any employees present in current month but not in next
    _crdData_cur.forEach(src => {
      if (!updated.find(e => e.name === src.name)) {
        updated.push({name: src.name, prevBal: _crdNet(src), entries: [], salary: 0, lessGeneric: 0});
      }
    });
    data.credit[nextMy] = updated;
  } else {
    // Fresh next month: copy employee list, set prevBal = net, clear entries
    data.credit[nextMy] = _crdData_cur.map(e => ({
      name: e.name,
      prevBal: _crdNet(e),
      entries: [],
      salary: 0,
      lessGeneric: 0
    }));
  }
  mgrSave(data);

  // Switch the dropdown to next month and reload
  // Repopulate selector so the new month is available even if not in MONTHLY data
  _mgrPopSel('crd-month-sel', nextMy);
  sel.value = nextMy;
  loadCreditMonth(nextMy);

  toast('✓ Copied to ' + nextMy + ' — net balances set as opening balances');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

const MONTH_NAMES_CR = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function currentCreditMonthYear() {
  const d = new Date();
  return MONTH_NAMES_CR[d.getMonth()] + ' ' + d.getFullYear();
}

// Pure read, never creates a row — used by Staff Registry's "This Month"
// column, so just browsing the registry can't spawn empty credit entries
// for people who don't have any yet.
function thisMonthNetFor(name) {
  const my = currentCreditMonthYear();
  const data = mgrLoad();
  const emps = (data.credit && data.credit[my]) || [];
  const norm = s => (s || '').trim().toLowerCase();
  const emp = emps.find(e => norm(e.name) === norm(name));
  return emp ? _crdNet(emp) : 0;
}

// The Staff Card's Credit tab is a second entry point into the exact same
// data.credit[my] structure the Credit Ledger sheet already uses — always
// resolved against the real current month, never whatever month the
// Credit Ledger page happens to have loaded. One source of truth, so
// Supabase sync doesn't need to know this second UI exists at all.
function _scCreditRow(name) {
  const my = currentCreditMonthYear();
  const data = mgrLoad();
  if (!data.credit) data.credit = {};
  if (!data.credit[my]) data.credit[my] = [];
  const norm = s => (s || '').trim().toLowerCase();
  let emp = data.credit[my].find(e => norm(e.name) === norm(name));
  if (!emp) { emp = { name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 }; data.credit[my].push(emp); }
  return { data, my, emp };
}

// If the Credit Ledger sheet happens to be sitting on this same real
// month, refresh its in-memory copy too — otherwise a later "Save" there
// would silently overwrite whatever was just entered from the Staff Card.
function _scCreditSync(my) {
  const sel = document.getElementById('crd-month-sel');
  if (sel && sel.value === my) loadCreditMonth(my);
}

function scCreditFieldChange(field, val) {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  emp[field] = _ni(val);
  mgrSave(data);
  _scCreditSync(my);
  renderStaffCreditCurrent(name);
  if (Repository.getItem('bt_auto_save') === '1' && typeof pushToSupabase === 'function') pushToSupabase();
}

function scAddCreditEntry() {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  const today = new Date();
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  emp.entries.push({ date: String(today.getDate()).padStart(2, '0') + '-' + ms[today.getMonth()] + '-' + today.getFullYear(), desc: '', amount: 0 });
  mgrSave(data);
  _scCreditSync(my);
  renderStaffCreditCurrent(name);
}

function scCreditEntryChange(eni, field, val) {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  if (!emp.entries[eni]) return;
  emp.entries[eni][field] = field === 'amount' ? _ni(val) : val;
  mgrSave(data);
  _scCreditSync(my);
  // Only nudge the net figure live while typing an amount — a full
  // re-render on every keystroke would steal focus from the input.
  const netEl = document.getElementById('sccc-net');
  if (netEl) {
    const net = _crdNet(emp);
    netEl.textContent = 'Net: ₨' + _fc2(net);
    netEl.style.color = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
  }
}

function scDeleteCreditEntry(eni) {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  emp.entries.splice(eni, 1);
  mgrSave(data);
  _scCreditSync(my);
  renderStaffCreditCurrent(name);
}

function renderStaffCreditCurrent(name) {
  const cont = document.getElementById('sc-credit-current');
  if (!cont) return;
  const my = currentCreditMonthYear();
  const data = mgrLoad();
  const emps = (data.credit && data.credit[my]) || [];
  const norm = s => (s || '').trim().toLowerCase();
  const emp = emps.find(e => norm(e.name) === norm(name)) || { prevBal: 0, entries: [], salary: 0, lessGeneric: 0 };
  const net = _crdNet(emp);
  const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
  const rows = (emp.entries || []).map((en, eni) => `
    <div class="sccc-entry-row">
      <input type="text" class="mgr-inp" value="${_crdEsc(en.date||'')}" placeholder="Date" oninput="scCreditEntryChange(${eni},'date',this.value)">
      <input type="text" class="mgr-inp" value="${_crdEsc(en.desc||'')}" placeholder="Description" oninput="scCreditEntryChange(${eni},'desc',this.value)">
      <input type="number" class="mgr-inp sal-num" value="${en.amount||0}" style="font-weight:700;${_ni(en.amount)<0?'color:var(--red)':'color:var(--green)'}" oninput="scCreditEntryChange(${eni},'amount',this.value)">
      <button class="mgr-del" onclick="scDeleteCreditEntry(${eni})">🗑</button>
    </div>`).join('');
  cont.innerHTML = `
    <div class="sccc-card">
      <div class="sccc-hdr">
        <span>💳 ${my}</span>
        <span class="sccc-net" id="sccc-net" style="color:${netColor}">Net: ₨${_fc2(net)}</span>
      </div>
      <div class="sccc-fields">
        <div class="fg"><label>Previous Balance (₨)</label><input type="number" class="mgr-inp" value="${emp.prevBal||0}" oninput="scCreditFieldChange('prevBal',this.value)"></div>
        <div class="fg"><label>Salary Paid (₨)</label><input type="number" class="mgr-inp" value="${emp.salary||0}" oninput="scCreditFieldChange('salary',this.value)"></div>
        <div class="fg"><label>Less Generic (₨)</label><input type="number" class="mgr-inp" value="${emp.lessGeneric||0}" oninput="scCreditFieldChange('lessGeneric',this.value)"></div>
      </div>
      <div class="sccc-entries">
        ${rows || '<p class="sccc-empty">No entries yet this month.</p>'}
      </div>
      <button class="btn btn-p" style="font-size:12px;padding:7px 14px" onclick="scAddCreditEntry()">💳 ＋ Add Entry</button>
    </div>`;
}

Object.assign(window, {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
  thisMonthNetFor, renderStaffCreditCurrent, scCreditFieldChange, scAddCreditEntry,
  scCreditEntryChange, scDeleteCreditEntry, currentCreditMonthYear,
});

export {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
  thisMonthNetFor, renderStaffCreditCurrent, scCreditFieldChange, scAddCreditEntry,
  scCreditEntryChange, scDeleteCreditEntry, currentCreditMonthYear,
};
