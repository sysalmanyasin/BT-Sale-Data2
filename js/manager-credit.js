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

function renderCreditLedger(emps) {
  const container = document.getElementById('crd-employees');
  if (!container) return;
  container.innerHTML = emps.map((emp, ei) => {
    const net = _crdNet(emp);
    const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
    const entryRows = emp.entries.map((en, eni) => `
      <tr class="mgr-tr">
        <td class="mgr-td">${_inp('text', en.date||'', '', `crdEntryChange(${ei},${eni},'date',this.value)`, 'Date')}</td>
        <td class="mgr-td">${_inp('text', en.desc||'', '', `crdEntryChange(${ei},${eni},'desc',this.value)`, 'Description (credit/deduction/…)')}${en.source==='closing_app' ? ' <span title="From Closing App" style="font-size:11px;background:var(--blue,#2563eb);color:#fff;padding:1px 6px;border-radius:10px;">📱</span>' : ''}</td>
        <td class="mgr-td"><input type="number" value="${en.amount||0}" class="mgr-inp sal-num" style="font-weight:700;${_ni(en.amount)<0?'color:var(--red)':'color:var(--green)'}" placeholder="0 (negative=deduction)" oninput="crdEntryChange(${ei},${eni},'amount',this.value);recalcCrdEmp(${ei})"></td>
        <td class="mgr-td" style="text-align:center"><button class="mgr-del" onclick="deleteCrdEntry(${ei},${eni})">🗑</button></td>
      </tr>`).join('');
    const _cNorm = s => (s||'').trim().toLowerCase();
    const _cIdx = STAFF.findIndex(s => _cNorm(s.name) === _cNorm(emp.name));
    const _cEmp = _cIdx >= 0 ? STAFF[_cIdx] : null;
    const _cSid = _cEmp ? (_cEmp.staffId || ('EMP-' + String(_cIdx+1).padStart(3,'0'))) : null;
    return `<div class="crd-emp" id="crd-emp-${ei}">
      <div class="crd-emp-hdr" onclick="_toggleCrdEmpBody(${ei})" title="Click to expand/collapse">
        <div class="crd-emp-name">
          <span class="crd-chevron" id="crd-chev-${ei}" style="font-size:10px;transition:transform .2s;display:inline-block">▶</span>
          ${_cSid ? '<button onclick="event.stopPropagation();openStaffCard('+_cIdx+')" title="Open '+emp.name+' Card" style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;font-weight:700;font-family:monospace">'+_cSid+'</button>' : ''}
          <span onclick="event.stopPropagation();${_cIdx>=0?'openStaffCard('+_cIdx+')':''}" style="cursor:${_cIdx>=0?'pointer':'default'};color:var(--accent);font-weight:600;${_cIdx>=0?'text-decoration:underline dotted;text-underline-offset:2px':''}">${emp.name}</span>
          <span class="crd-entry-badge">${emp.entries.length} entr${emp.entries.length===1?'y':'ies'}</span>
        </div>
        <div class="crd-emp-stats" onclick="event.stopPropagation()">
          <span class="crd-chip">Prev <strong>₨${_fc2(emp.prevBal)}</strong></span>
          <span class="crd-chip">Salary <strong>₨${_fc2(emp.salary)}</strong></span>
          <span class="crd-chip">LessGen <strong>₨${_fc2(emp.lessGeneric)}</strong></span>
          <span class="crd-emp-bal" style="color:${netColor}" id="crd-net-${ei}">Net: ₨${_fc2(net)}</span>
          <button class="btn btn-p" style="font-size:11px;padding:4px 10px" onclick="addCrdEntryFocused(${ei})">💳 + Entry</button>
          <button class="mgr-del" onclick="deleteCrdEmp(${ei})" title="Remove employee">🗑</button>
        </div>
      </div>
      <div class="crd-emp-body" id="crd-body-${ei}" style="display:none">
        <div class="crd-emp-fields">
          <div class="fg"><label>Previous Balance (₨)</label><input type="number" value="${emp.prevBal||0}" class="mgr-inp" oninput="crdEmpField(${ei},'prevBal',this.value);recalcCrdEmp(${ei})"></div>
          <div class="fg"><label>Salary Paid (₨)</label><input type="number" value="${emp.salary||0}" class="mgr-inp" oninput="crdEmpField(${ei},'salary',this.value);recalcCrdEmp(${ei})"></div>
          <div class="fg"><label>Less Generic (₨)</label><input type="number" value="${emp.lessGeneric||0}" class="mgr-inp" oninput="crdEmpField(${ei},'lessGeneric',this.value);recalcCrdEmp(${ei})"></div>
        </div>
        <div style="padding:12px 14px">
        <table style="width:100%;border-collapse:collapse;min-width:420px;border:1px solid var(--border)">
          <thead><tr style="background:var(--accent);color:#fff">
            <th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Date</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Description</th>
            <th style="padding:7px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Amount (₨)</th>
            <th style="padding:7px 10px;border:1px solid rgba(255,255,255,.2)"></th>
          </tr></thead>
          <tbody id="crd-tbody-${ei}">${entryRows}</tbody>
        </table>
        ${emp.entries.length === 0 ? '<p style="text-align:center;color:var(--muted);font-size:12px;padding:14px">No entries yet — click "💳 + Entry" to add.</p>' : ''}
        </div>
    </div>`;
  }).join('');
  // Expand cards that have entries
  emps.forEach((emp, ei) => {
    if (emp.entries.length > 0) {
      const body = document.getElementById('crd-body-' + ei);
      const chev = document.getElementById('crd-chev-' + ei);
      if (body) body.style.display = '';
      if (chev) chev.style.transform = 'rotate(90deg)';
    }
  });
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

Object.assign(window, {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
});

export {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
};
