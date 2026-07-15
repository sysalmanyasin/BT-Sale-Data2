// ══════════════════════════════════════════════════════════════════
// MANAGER WORK — Salary, Generic Working, Expense/Patty, Staff Credit
// ══════════════════════════════════════════════════════════════════

// NOTE: switchMgrTab, loadManagerPage, and staffLoad stay TRUE bare
// globals, declared outside the IIFE that wraps the rest of this file.
// Three different files monkey-patch these two entry points:
// custom-sections.js and jazz-cash.js both reassign loadManagerPage
// (jazz-cash.js captures the original first, then wraps it to also
// call renderJazzCash()); notes-sheets.js reassigns switchMgrTab the
// same way. If these were IIFE-scoped, each patch would only ever
// affect a window-level copy while every internal call in this file
// kept calling the original, unpatched version — same risk as
// auth.js's unlockApp. staffLoad has to travel with them since
// loadManagerPage calls it directly and it has no other external
// dependents that would otherwise keep it out of the IIFE.

function switchMgrTab(tab) {
  document.querySelectorAll('.mgr-tab').forEach(b => b.classList.toggle('active', b.dataset.mtab === tab));
  document.querySelectorAll('.mgr-section').forEach(s => s.style.display = 'none');
  const sec = document.getElementById('mgr-' + tab);
  if (sec) sec.style.display = '';
  if (tab === 'staff') renderStaffRegistry();
  if (tab === 'jazzcash' && typeof renderJazzCash === 'function') renderJazzCash();
  if (tab === 'expense' && typeof renderLedgerView === 'function') {
    renderLedgerView('ledger-expense-container', 'expense', 'Expense');
  }
  if (tab === 'custom' && typeof renderOtherSectionsManager === 'function') {
    renderOtherSectionsManager('ledger-sections-container');
  }
}

function loadManagerPage() {
  staffLoad();
  renderStaffRegistry();
  const mons = mgrMonths();
  const cur = mons[0] || '';
  _mgrPopSel('sal-month-sel', cur);
  _mgrPopSel('gen-month-sel', cur);
  _mgrPopSel('crd-month-sel', cur);
  _mgrPopSel('petty-month-sel', cur);
  _mgrPopSel('inc-month-sel', cur);
  loadSalaryMonth(cur);
  loadGenericMonth(cur);
  loadCreditMonth(cur);
  loadPettyMonth(cur);
  loadIncentiveMonth(cur);
}

function staffLoad() {
  Repository.loadStaff();
}

(function() {
'use strict';

const MGR_KEY = 'BT_ManagerWork_v1';

// Routed through Repository (Floor 1) instead of calling localStorage
// directly — closes the gap where drive.js and supabase.js were
// independently reading/writing this same key with their own raw
// localStorage calls (the same "many doors" pattern fixed for sales
// data, now closed for Manager Work too).
function mgrLoad() {
  try { return JSON.parse(Repository.getItem(MGR_KEY)) || {}; } catch(e) { return {}; }
}
function mgrSave(data) { Actions.saveFeatureData(MGR_KEY, JSON.stringify(data)); }

// Returns a continuous newest-first month list, so blank months do not disappear.
function mgrMonths() {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const toVal = my => {
    const p = String(my || '').split(' ');
    const mi = names.indexOf(p[0]);
    const yr = parseInt(p[1], 10);
    return mi >= 0 && !isNaN(yr) ? yr * 12 + mi : null;
  };
  const toLabel = val => names[val % 12] + ' ' + Math.floor(val / 12);
  const seen = new Set();

  months().forEach(m => seen.add(m));
  MONTHLY.forEach(m => { if (m.Month_Year) seen.add(m.Month_Year); });

  try {
    const mgr = mgrLoad();
    ['salary','generic','expense','credit'].forEach(k => Object.keys(mgr[k] || {}).forEach(m => seen.add(m)));
  } catch(e) {}
  try {
    Repository.getKeysByPrefix('mw_petty_').forEach(k => seen.add(k.slice('mw_petty_'.length)));
    Repository.getKeysByPrefix('mw_incentive_').forEach(k => seen.add(k.slice('mw_incentive_'.length)));
  } catch(e) {}
  try {
    const all = typeof _csecLoad === 'function' ? _csecLoad() : JSON.parse(Repository.getItem('mw_custom_sections_v1') || '{}');
    Object.values(all || {}).forEach(sec => Object.keys((sec && sec.months) || {}).forEach(m => seen.add(m)));
  } catch(e) {}

  const now = new Date();
  const currentVal = now.getFullYear() * 12 + now.getMonth();
  for (let delta = -1; delta <= 0; delta++) {
    const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
    seen.add(names[d.getMonth()] + ' ' + d.getFullYear());
  }

  const vals = Array.from(seen).map(toVal).filter(v => v != null && v <= currentVal);
  if (!vals.length) return [];
  const min = Math.min(...vals);
  const max = Math.min(currentVal, Math.max(...vals));
  const out = [];
  for (let v = max; v >= min; v--) out.push(toLabel(v));
  return out;
}

function _mgrPopSel(selId, current) {
  const el = document.getElementById(selId);
  if (!el) return;
  const mons = mgrMonths();
  el.innerHTML = mons.map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${m}</option>`).join('');
}



// ─── helpers ───────────────────────────────────────────────────────
function _ni(v) { return Math.round(Number(v) || 0); }
function _fc2(v) { return _ni(v).toLocaleString('en-PK'); }
function _inp(type, val, cls, oninput, ph) {
  return `<input type="${type}" value="${val}" class="mgr-inp${cls ? ' ' + cls : ''}" placeholder="${ph||''}" ${oninput ? 'oninput="' + oninput + '"' : ''}>`;
}

// ══════════════════════════════
// SALARY SHEET
// ══════════════════════════════
// ══════════════════════════════════════════════════════
// STAFF REGISTRY — single source of truth for employees
// ══════════════════════════════════════════════════════

// ── No seed list — staff is pulled from Supabase or added manually ──────────────
// Removed _STAFF_SEED to prevent duplicate employees across devices.
// On a fresh install: staff list starts empty. Either pull from Supabase
// (if configured) or add employees manually via + Add Employee.


function staffSave() {
  Repository.saveStaff();
}

function activeStaff() {
  return STAFF.filter(e => e.active !== false)
    .sort((a, b) => (Number(a.srNum)||999) - (Number(b.srNum)||999));
}

// ── Staff Registry UI ──────────────────────────────────
function renderStaffRegistry() {
  const cont = document.getElementById('staff-list');
  if (!cont) return;
  const active = STAFF.filter(e => e.active !== false).length;
  const setK = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setK('staff-k-total', STAFF.length);
  setK('staff-k-active', active);
  setK('staff-k-inactive', STAFF.length - active);
  if (!STAFF.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px">No employees yet — click <strong>+ Add Employee</strong></div>';
    return;
  }
  // Sort by srNum for display (STAFF array order unchanged)
  const _srSorted = STAFF.map((emp, origIdx) => ({emp, origIdx}))
    .sort((a, b) => (Number(a.emp.srNum)||999) - (Number(b.emp.srNum)||999));
  cont.innerHTML = `<div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:980px;border:2px solid var(--border)">
    <thead>
      <tr style="background:var(--accent);color:#fff">
        <th style="padding:9px 8px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em" title="Editable Sr# — controls row order in Salary, Generic & Credit sheets">Sr#</th>
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Staff ID</th>
        <th style="padding:9px 10px;text-align:left;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Name</th>
        <th style="padding:9px 10px;text-align:left;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Designation</th>
        <th style="padding:9px 10px;text-align:left;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Father Name</th>
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">CNIC</th>
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Blood Group</th>
        <th style="padding:9px 10px;text-align:left;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Phone</th>
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Active</th>
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Actions</th>
      </tr>
    </thead>
    <tbody>
    ${_srSorted.map(({emp, origIdx}) => {
      const i = origIdx;
      const sid = emp.staffId || ('EMP-' + String(origIdx+1).padStart(3,'0'));
      const srNum = emp.srNum != null ? emp.srNum : (origIdx + 1);
      const bg = emp.active!==false ? 'var(--surface)' : 'var(--s2)';
      return `<tr style="background:${bg}">
        <td style="padding:4px 6px;border:1px solid var(--border);text-align:center;width:48px">
          <input type="number" value="${srNum}" min="1" max="999"
            class="mgr-inp sal-num" style="width:42px;text-align:center;font-weight:700;font-size:12px;padding:2px 4px"
            title="Change Sr# to reorder in Salary/Generic/Credit sheets"
            oninput="staffSrNumChange(${i},this.value)">
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);text-align:center">
          <button onclick="openStaffCard(${i})" title="Open Staff Card"
            style="background:var(--accent);color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;font-family:monospace;letter-spacing:.02em">
            ${sid}
          </button>
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border)">
          <span onclick="openStaffCard(${i})" style="cursor:pointer;font-weight:600;color:var(--accent);text-decoration:underline dotted;text-underline-offset:3px" title="Open Staff Card">
            ${emp.name||'<em style="color:var(--muted)">(unnamed)</em>'}
          </span>
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border)">
          <input type="text" value="${(emp.designation||'').replace(/"/g,'&quot;')}" placeholder="Designation"
            class="mgr-inp" oninput="staffFieldChange(${i},'designation',this.value)">
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);color:var(--t2)">
          ${emp.fatherName||'<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);text-align:center;font-family:monospace;font-size:11px;color:var(--t2)">
          ${emp.cnic||'<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);text-align:center">
          ${emp.bloodGroup ? '<span style="background:#fef2f2;color:var(--red,#dc2626);border:1px solid #fecaca;border-radius:4px;padding:2px 10px;font-weight:700;font-size:12px">'+emp.bloodGroup+'</span>' : '<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);color:var(--t2)">
          ${emp.phone||'<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);text-align:center">
          <input type="checkbox" ${emp.active!==false?'checked':''} onchange="staffToggleActive(${i},this.checked)" title="Active/Inactive">
        </td>
        <td style="padding:7px 10px;border:1px solid var(--border);text-align:center;white-space:nowrap">
          <button class="btn btn-p" style="font-size:10px;padding:3px 10px;margin-right:4px" onclick="openStaffCard(${i})">✏ Edit</button>
          <button class="mgr-del" onclick="staffDelete(${i})" title="Remove">🗑</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
  <div style="font-size:11px;color:var(--muted);padding:8px 4px">💡 <strong>Sr#</strong> controls the row order in Salary, Generic & Credit sheets. Edit any number then click 💾 Save Staff List to apply.</div>
  </div>`;}

function staffFieldChange(i, field, val) {
  Actions.updateEmployee(i, { [field]: val });
}
function staffSrNumChange(i, val) {
  const before = Number(val) || 1;
  const updated = Actions.updateEmployee(i, { srNum: before });
  if (updated.srNum !== before && typeof toast === 'function') {
    toast('Sr# ' + before + ' is already in use — assigned Sr# ' + updated.srNum + ' instead', 'w');
  }
  // Re-render the table so the sort order updates live
  renderStaffRegistry();
}

function staffToggleActive(i, active) {
  Actions.updateEmployee(i, { active });
  renderStaffRegistry();
  _propagateStaffToSheets();
}

function staffDelete(i) {
  const staff = Repository.getStaff();
  const name = (staff[i] && staff[i].name) ? staff[i].name : 'this employee';
  if (!confirm('Remove ' + name + ' from the staff list?\n\nHistorical data will be kept — they just won\'t appear in new months.')) return;
  Actions.removeEmployee(i);
  renderStaffRegistry();
}

function addStaffEmployee() {
  const newEmp = Actions.addEmployee();
  renderStaffRegistry();
  // Immediately add to Salary/Generic/Credit sheets — previously this only
  // happened when the manager clicked "💾 Save Staff List" afterwards, so a
  // newly added employee was invisible in every sheet until that separate
  // step was remembered.
  _propagateStaffToSheets();
  setTimeout(() => openStaffCard(Repository.getStaff().length - 1), 100);
}

function saveStaffRegistry() {
  // Migrate: assign srNum to any staff missing it — goes through Actions
  // so the Proxy does not flag it as a bypass.
  const staff = Repository.getStaff();
  staff.forEach((emp, i) => {
    if (emp.srNum == null || emp.srNum === '') Actions.updateEmployee(i, { srNum: i + 1 });
  });
  // staffSave() persists the array; _propagateStaffToSheets rebuilds sheets.
  staffSave();
  _propagateStaffToSheets();
  toast('✓ Staff list saved — syncing to Supabase…');
  // ALWAYS push staff registry — it is shared config, not just local data.
  pushToSupabase();
}

// When staff list is saved, add any new employees to currently-loaded sheets
function _propagateStaffToSheets() {
  const cur = document.getElementById('sal-month-sel')?.value;
  if (!cur) return;
  const norm = s => (s||'').trim().toLowerCase();
  // Match by staffId when the row has one (added by every propagation from
  // here on); fall back to name-matching only for legacy rows that predate
  // staffId being stamped onto sheet rows. Pure name-matching was fragile —
  // a typo'd or duplicate name meant a new employee with the same display
  // name as an old one would never get a row of their own.
  const matches = (row, emp) => (row.staffId && emp.staffId) ? row.staffId === emp.staffId : norm(row.name) === norm(emp.name);

  // Salary — add missing
  activeStaff().forEach(emp => {
    if (!_salRows_cur.find(r => matches(r, emp))) {
      _salRows_cur.push({ staffId: emp.staffId, name: emp.name, desig: emp.designation, days: 31, hoSal: 0, advance: 0, generic: 0 });
    }
  });
  renderSalaryTable(_salRows_cur);

  // Generic — add missing
  activeStaff().forEach(emp => {
    if (!_genRows_cur.find(r => matches(r, emp))) {
      _genRows_cur.push({ staffId: emp.staffId, name: emp.name, desig: emp.designation, genericSale: 0, extra: 0 });
    }
  });
  renderGenericTable(_genRows_cur);

  // Credit — add missing
  activeStaff().forEach(emp => {
    if (!_crdData_cur.find(r => matches(r, emp))) {
      _crdData_cur.push({ staffId: emp.staffId, name: emp.name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 });
    }
  });
  renderCreditLedger(_crdData_cur);
}

function _salRows(my) {
  const data = mgrLoad();
  const stored = data.salary && data.salary[my];
  return stored || activeStaff().map(e => ({name:e.name, desig:e.designation, days:31, hoSal:0, advance:0, generic:0}));
}

function _salNet(r) { return _ni(r.hoSal) - _ni(r.advance) + _ni(r.generic); }

function renderSalaryTable(rows) {
  const tbody = document.getElementById('sal-tbody');
  const tfoot = document.getElementById('sal-tfoot');
  if (!tbody) return;
  // FIX 1+2: Load credit detail for advance tooltip; find staff card index
  const _salMon = document.getElementById('sal-month-sel')?.value || '';
  const _crdForAdv = _crdData(_salMon);
  const _salNorm = s => (s||'').trim().toLowerCase();
  tbody.innerHTML = rows.map((r, i) => {
    // FIX 1: Build advance tooltip from credit ledger entries
    const _crdEmp = _crdForAdv.find(c => _salNorm(c.name) === _salNorm(r.name));
    let _advTitle = '';
    if (_crdEmp && _crdEmp.entries && _crdEmp.entries.length) {
      const pos = _crdEmp.entries.filter(e => _ni(e.amount) > 0);
      if (pos.length) {
        _advTitle = 'Credit entries:\n' + pos.map(e => e.date + ': ' + (e.desc||'') + ' Rs' + _fc2(e.amount)).join('\n');
      }
    }
    // FIX 2: Clickable Staff ID in salary
    const _sIdx = STAFF.findIndex(s => _salNorm(s.name) === _salNorm(r.name));
    const _sEmp = _sIdx >= 0 ? STAFF[_sIdx] : null;
    const _sSid = _sEmp ? (_sEmp.staffId || ('EMP-' + String(_sIdx+1).padStart(3,'0'))) : null;
    const _sNameInp = _inp('text', r.name||'', '', "salRowChange("+i+",'name',this.value)", 'Name');
    const _sDesigInp = _inp('text', r.desig||'', '', "salRowChange("+i+",'desig',this.value)", 'Designation');
    const _sNameCell = _sSid
      ? '<div style="display:flex;align-items:center;gap:5px">'
        + '<button onclick="openStaffCard('+_sIdx+')" title="Open '+(r.name||'Staff')+' Card"'
        + ' style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:10px;font-weight:700;font-family:monospace;flex-shrink:0">'+_sSid+'</button>'
        + _sNameInp + '</div>'
      : _sNameInp;
    return `<tr class="mgr-tr">
      <td class="mgr-td sal-c" style="font-size:11px;color:var(--muted)">${i+1}</td>
      <td class="mgr-td">${_sNameCell}</td>
      <td class="mgr-td">${_sDesigInp}</td>
      <td class="mgr-td sal-c" style="width:60px"><input type="number" value="${r.days||31}" class="mgr-inp sal-num" placeholder="31" oninput="salRowChange(${i},'days',this.value)"></td>
      <td class="mgr-td"><input type="number" value="${r.hoSal||0}" class="mgr-inp sal-num" placeholder="0" oninput="salRowChange(${i},'hoSal',this.value);recalcSalNet(${i})"></td>
      <td class="mgr-td" ${_advTitle ? 'title="'+_advTitle+'" style="position:relative"' : ''}><input type="number" value="${r.advance||0}" class="mgr-inp sal-num${_advTitle?' sal-adv-linked':''}" placeholder="0" oninput="salRowChange(${i},'advance',this.value);recalcSalNet(${i})">${_advTitle ? '<span style="position:absolute;top:2px;right:3px;font-size:9px;color:var(--accent);pointer-events:none" title="'+_advTitle+'">💳</span>' : ''}</td>
      <td class="mgr-td"><input type="number" value="${r.generic||0}" class="mgr-inp sal-num" placeholder="0" oninput="salRowChange(${i},'generic',this.value);recalcSalNet(${i})"></td>
      <td class="mgr-td"><input type="number" id="sal-net-${i}" class="mgr-inp calc sal-num" value="${_salNet(r)}" readonly></td>
      <td class="mgr-td sal-c"><button class="mgr-del" onclick="deleteSalRow(${i})">🗑</button></td>
    </tr>`;
  }).join('');
  _salUpdateFooter(rows);
}

let _salRows_cur = [];

function loadSalaryMonth(my) {
  _salRows_cur = _salRows(my);
  const norm = s => (s||'').trim().toLowerCase();
  // Use in-memory credit data if credit tab is on the same month
  const crdSel = document.getElementById('crd-month-sel');
  const crdRows = (crdSel && crdSel.value === my && _crdData_cur.length)
    ? _crdData_cur : _crdData(my);
  // Use in-memory generic data if generic tab is on the same month
  const genSel = document.getElementById('gen-month-sel');
  const genRowsData = (genSel && genSel.value === my && _genRows_cur.length)
    ? _genRows_cur : _genRows(my);
  // Only gate advance on alreadySaved (don't overwrite manual advance edits)
  const data = mgrLoad();
  const alreadySaved = !!(data.salary && data.salary[my]);
  _salRows_cur = _salRows_cur.map(row => {
    const rName = norm(row.name);
    if (!rName) return row;
    const crd = crdRows.find(c => norm(c.name) === rName);
    const gen = genRowsData.find(g => norm(g.name) === rName);
    // Sum only positive credit entries (advances drawn by employee)
    const entryTotal = crd ? crd.entries.reduce((s,e) => { const v=_ni(e.amount); return s+(v>0?v:0); }, 0) : 0;
    return {
      ...row,
      // Advance: only auto-fill if salary not yet saved for this month
      advance: alreadySaved ? row.advance : entryTotal,
      // Generic: always pull latest Final value from Generic Working sheet
      generic: gen ? _genFinal(gen) : row.generic
    };
  });
  renderSalaryTable(_salRows_cur);
}

function salRowChange(i, field, val) {
  _salRows_cur[i][field] = field === 'name' || field === 'desig' ? val : _ni(val);
}
function recalcSalNet(i) {
  const el = document.getElementById('sal-net-' + i);
  if (el) el.value = _salNet(_salRows_cur[i]);
  _salUpdateFooter(_salRows_cur);
}
function _salUpdateFooter(rows) {
  const totalHO = rows.reduce((s,r) => s + _ni(r.hoSal), 0);
  const totalAdv = rows.reduce((s,r) => s + _ni(r.advance), 0);
  const totalGen = rows.reduce((s,r) => s + _ni(r.generic), 0);
  const totalNet = rows.reduce((s,r) => s + _salNet(r), 0);
  document.getElementById('sal-tfoot').innerHTML = `<tr class="mgr-tfoot">
    <td colspan="4" style="text-align:right;padding:7px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">TOTALS</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono)">₨${_fc2(totalHO)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono)">₨${_fc2(totalAdv)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono)">₨${_fc2(totalGen)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono);color:var(--accent)">₨${_fc2(totalNet)}</td>
    <td></td>
  </tr>`;
}
function addSalaryRow() {
  _salRows_cur.push({name:'', desig:'Salesman', days:31, hoSal:0, advance:0, generic:0});
  renderSalaryTable(_salRows_cur);
}
function deleteSalRow(i) {
  _salRows_cur.splice(i, 1);
  renderSalaryTable(_salRows_cur);
}
function saveSalaryData() {
  const my = document.getElementById('sal-month-sel').value;
  const data = mgrLoad();
  if (!data.salary) data.salary = {};
  data.salary[my] = _salRows_cur.map(r => ({...r}));
  mgrSave(data);
  toast('✓ Salary saved for ' + my);
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

// ── Auto-fill Advance from Credit sheet & Generic from Generic Working ──────
function autoFillSalaryFromSheets() {
  const my = document.getElementById('sal-month-sel').value;
  if (!my) { toast('⚠ Select a month first','w'); return; }
  // Use in-memory credit data if credit tab is on same month (unsaved changes)
  const crdSel = document.getElementById('crd-month-sel');
  const crdRows = (crdSel && crdSel.value === my && _crdData_cur.length)
    ? _crdData_cur : _crdData(my);
  // Use in-memory generic data if generic tab is on same month (unsaved changes)
  const genSel = document.getElementById('gen-month-sel');
  const genRowsData = (genSel && genSel.value === my && _genRows_cur.length)
    ? _genRows_cur : _genRows(my);
  const norm = s => (s||'').trim().toLowerCase();
  let filledAdv = 0, filledGen = 0;
  _salRows_cur = _salRows_cur.map(row => {
    const rName = norm(row.name);
    if (!rName) return row;
    // Sum only positive entries (advances/credits given to employee)
    const crd = crdRows.find(c => norm(c.name) === rName);
    let advance = row.advance;
    if (crd) {
      const entryTotal = crd.entries.reduce((s, e) => { const v=_ni(e.amount); return s+(v>0?v:0); }, 0);
      advance = entryTotal;
      filledAdv++;
    }
    // Always pull latest Final value from Generic Working sheet
    const gen = genRowsData.find(g => norm(g.name) === rName);
    let generic = row.generic;
    if (gen) {
      generic = _genFinal(gen);
      filledGen++;
    }
    return { ...row, advance, generic };
  });
  renderSalaryTable(_salRows_cur);
  toast(`⚡ Auto-filled: ${filledAdv} advance${filledAdv!==1?'s':''}, ${filledGen} generic value${filledGen!==1?'s':''} — click 💾 Save to keep`);
}

// ══════════════════════════════
// GENERIC WORKING
// ══════════════════════════════
let _genRows_cur = [];

function _genRows(my) {
  const data = mgrLoad();
  const stored = data.generic && data.generic[my];
  return stored || activeStaff().map(e => ({name:e.name, desig:e.designation, genericSale:0, extra:0}));
}

function _genIncentive(r) { return Math.round(_ni(r.genericSale) * 0.04); }
function _genFinal(r) { return _genIncentive(r) + _ni(r.extra); }

function renderGenericTable(rows) {
  const tbody = document.getElementById('gen-tbody');
  if (!tbody) return;
  const _genNorm = s => (s||'').trim().toLowerCase();
  tbody.innerHTML = rows.map((r, i) => {
    const _gIdx = STAFF.findIndex(s => _genNorm(s.name) === _genNorm(r.name));
    const _gEmp = _gIdx >= 0 ? STAFF[_gIdx] : null;
    const _gSid = _gEmp ? (_gEmp.staffId || ('EMP-' + String(_gIdx+1).padStart(3,'0'))) : null;
    const _gNameInp  = _inp('text',   r.name||'',        '', "genRowChange("+i+",'name',this.value)", 'Name');
    const _gDesigInp = _inp('text',   r.desig||'',       '', "genRowChange("+i+",'desig',this.value)", 'Designation');
    const _gSaleInp  = _inp('number', r.genericSale||0,  'sal-num', "genRowChange("+i+",'genericSale',this.value);recalcGenRow("+i+")", '0');
    const _gExtraInp = _inp('number', r.extra||0,        'sal-num', "genRowChange("+i+",'extra',this.value);recalcGenRow("+i+")", '0');
    const _gNameCell = _gSid
      ? '<div style="display:flex;align-items:center;gap:5px">'
        + '<button onclick="openStaffCard('+_gIdx+')" title="Open '+(r.name||'Staff')+' Card"'
        + ' style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:10px;font-weight:700;font-family:monospace;flex-shrink:0">'+_gSid+'</button>'
        + _gNameInp + '</div>'
      : _gNameInp;
    return `<tr class="mgr-tr">
      <td class="mgr-td sal-c" style="font-size:11px;color:var(--muted)">${i+1}</td>
      <td class="mgr-td">${_gNameCell}</td>
      <td class="mgr-td">${_gDesigInp}</td>
      <td class="mgr-td">${_gSaleInp}</td>
      <td class="mgr-td"><input type="number" id="gen-inc-${i}" class="mgr-inp calc sal-num" value="${_genIncentive(r)}" readonly></td>
      <td class="mgr-td">${_gExtraInp}</td>
      <td class="mgr-td"><input type="number" id="gen-fin-${i}" class="mgr-inp calc sal-num" value="${_genFinal(r)}" readonly></td>
      <td class="mgr-td sal-c"><button class="mgr-del" onclick="deleteGenRow(${i})">🗑</button></td>
    </tr>`;
  }).join('');
  _genUpdateFooter(rows);
}

function loadGenericMonth(my) {
  _genRows_cur = _genRows(my);
  renderGenericTable(_genRows_cur);
}
function genRowChange(i, field, val) {
  _genRows_cur[i][field] = field === 'name' || field === 'desig' ? val : _ni(val);
}
function recalcGenRow(i) {
  const inc = document.getElementById('gen-inc-' + i);
  const fin = document.getElementById('gen-fin-' + i);
  if (inc) inc.value = _genIncentive(_genRows_cur[i]);
  if (fin) fin.value = _genFinal(_genRows_cur[i]);
  _genUpdateFooter(_genRows_cur);
  // Live sync to salary sheet — update the matching employee's generic column
  _syncGenericToSalary(i);
}

function _syncGenericToSalary(genIdx) {
  const genRow = _genRows_cur[genIdx];
  if (!genRow) return;
  const norm = s => (s||'').trim().toLowerCase();
  const salIdx = _salRows_cur.findIndex(r => norm(r.name) === norm(genRow.name));
  if (salIdx === -1) return;
  const finalVal = _genFinal(genRow);
  _salRows_cur[salIdx].generic = finalVal;
  // Update the salary net cell live (no full re-render needed)
  const salGenInput = document.querySelector(`#sal-tbody tr:nth-child(${salIdx+1}) .mgr-inp:nth-child(4)`);
  // Simpler: just update the net display field
  const netEl = document.getElementById('sal-net-' + salIdx);
  if (netEl) netEl.value = _salNet(_salRows_cur[salIdx]);
  _salUpdateFooter(_salRows_cur);
}
function _genUpdateFooter(rows) {
  const totSale = rows.reduce((s,r) => s + _ni(r.genericSale), 0);
  const totInc = rows.reduce((s,r) => s + _genIncentive(r), 0);
  const totExtra = rows.reduce((s,r) => s + _ni(r.extra), 0);
  const totFin = rows.reduce((s,r) => s + _genFinal(r), 0);
  document.getElementById('gen-tfoot').innerHTML = `<tr class="mgr-tfoot">
    <td colspan="3" style="text-align:right;padding:7px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">TOTALS</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono)">₨${_fc2(totSale)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono);color:var(--green)">₨${_fc2(totInc)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono)">₨${_fc2(totExtra)}</td>
    <td class="mgr-td" style="text-align:right;font-weight:700;font-family:var(--mono);color:var(--accent)">₨${_fc2(totFin)}</td>
    <td></td>
  </tr>`;
}
function addGenericRow() {
  _genRows_cur.push({name:'', desig:'Salesman', genericSale:0, extra:0});
  renderGenericTable(_genRows_cur);
}
function deleteGenRow(i) {
  _genRows_cur.splice(i, 1);
  renderGenericTable(_genRows_cur);
}
function saveGenericData() {
  const my = document.getElementById('gen-month-sel').value;
  const data = mgrLoad();
  if (!data.generic) data.generic = {};
  data.generic[my] = _genRows_cur.map(r => ({...r}));
  mgrSave(data);
  toast('✓ Generic Working saved for ' + my);
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

// ══════════════════════════════
// EXPENSE / PATTY CASH
// ══════════════════════════════
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
        <td class="mgr-td">${_inp('text', en.desc||'', '', `crdEntryChange(${ei},${eni},'desc',this.value)`, 'Description (credit/deduction/…)')}</td>
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

// ══════════════════════════════
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
const PETTY_PFX = 'mw_petty_';
let _pettyData = { groups: [] };  // current working copy
let _pettyMonth = '';

function _pettyKey(my) { return PETTY_PFX + my; }

function loadPettyMonth(my) {
  _pettyMonth = my;
  try {
    const raw = Repository.getItem(_pettyKey(my));
    _pettyData = raw ? JSON.parse(raw) : { groups: [] };
  } catch(e) { _pettyData = { groups: [] }; }
  if (!_pettyData.groups) _pettyData.groups = [];
  renderPettyGroups();
}

function savePettyData() {
  if (!_pettyMonth) { toast('⚠ Select a month first','w'); return; }
  Actions.saveFeatureData(_pettyKey(_pettyMonth), JSON.stringify(_pettyData));
  toast('✓ Petty Detail saved');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function _pettyTotalForMonth(my) {
  try {
    const raw = Repository.getItem(_pettyKey(my));
    const data = raw ? JSON.parse(raw) : null;
    const groups = data && Array.isArray(data.groups) ? data.groups : [];
    return groups.reduce((s, g) => s + (Array.isArray(g.rows) ? g.rows.reduce((a, r) => a + _ni(r.amount), 0) : 0), 0);
  } catch(e) { return 0; }
}

function addPettyGroup() {
  _pettyData.groups.push({ period: '', rows: [{ desc: '', amount: 0 }] });
  renderPettyGroups();
  // Scroll to the new group
  setTimeout(() => {
    const gs = document.querySelectorAll('.petty-group');
    if (gs.length) gs[gs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function deletePettyGroup(gi) {
  if (!confirm('Delete this group?')) return;
  _pettyData.groups.splice(gi, 1);
  renderPettyGroups();
}

function addPettyRow(gi) {
  _pettyData.groups[gi].rows.push({ desc: '', amount: 0 });
  renderPettyGroups();
}

function deletePettyRow(gi, ri) {
  _pettyData.groups[gi].rows.splice(ri, 1);
  renderPettyGroups();
}

function pettyRowChange(gi, ri, field, val) {
  _pettyData.groups[gi].rows[ri][field] = field === 'desc' ? val : _ni(val);
  // Update sub-total live
  const sub = _pettyData.groups[gi].rows.reduce((s, r) => s + _ni(r.amount), 0);
  const el = document.getElementById('petty-sub-' + gi);
  if (el) el.textContent = '₨' + _fc2(sub);
  recalcPettyKpis();
}

function _pettyGroupTotal(g) {
  return g.rows.reduce((s, r) => s + _ni(r.amount), 0);
}

function recalcPettyKpis() {
  const gs = _pettyData.groups;
  const grand = gs.reduce((s, g) => s + _pettyGroupTotal(g), 0);
  const items = gs.reduce((s, g) => s + g.rows.length, 0);
  const kGroups = document.getElementById('petty-k-groups');
  const kItems  = document.getElementById('petty-k-items');
  const kTotal  = document.getElementById('petty-k-total');
  if (kGroups) kGroups.textContent = gs.length;
  if (kItems)  kItems.textContent  = items;
  if (kTotal)  kTotal.textContent  = '₨' + _fc2(grand);
}

function renderPettyGroups() {
  const cont = document.getElementById('petty-groups');
  if (!cont) return;
  const gs = _pettyData.groups;
  if (!gs.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;border:2px dashed var(--border);border-radius:10px">No groups yet — click <strong>＋ Add New Group</strong> to create the first sub-voucher.</div>';
    recalcPettyKpis(); return;
  }
  cont.innerHTML = gs.map((g, gi) => {
    const sub = _pettyGroupTotal(g);
    const rows = g.rows.map((r, ri) => `
      <tr class="mgr-tr">
        <td class="mgr-td" style="color:var(--muted);font-size:11px">${ri + 1}</td>
        <td class="mgr-td"><input class="mgr-inp" type="text" value="${(r.desc||'').replace(/"/g,'&quot;')}" placeholder="Description / item"
          oninput="pettyRowChange(${gi},${ri},'desc',this.value)"></td>
        <td class="mgr-td" style="width:130px"><input class="mgr-inp" type="number" value="${r.amount||''}" placeholder="0"
          oninput="pettyRowChange(${gi},${ri},'amount',this.value)" style="text-align:right"></td>
        <td class="mgr-td" style="text-align:center"><button class="mgr-del" onclick="deletePettyRow(${gi},${ri})">🗑</button></td>
      </tr>`).join('');
    return `
    <div class="petty-group" id="petty-grp-${gi}">
      <div class="petty-group-hd">
        <span style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.05em">GROUP ${gi + 1}</span>
        <input class="mgr-inp" type="text" value="${(g.period||'').replace(/"/g,'&quot;')}" placeholder="Period / Date range (e.g. 1–7 June 2026)"
          oninput="pettyRowChange_period(${gi},this.value)"
          style="flex:1;max-width:320px">
        <button class="mgr-del" onclick="deletePettyGroup(${gi})" title="Delete group" style="margin-left:auto">🗑 Group</button>
      </div>
      <div class="petty-group-body">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--s2)">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">#</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Description</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Amount (₨)</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Del</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="petty-group-foot">
        <button class="btn btn-p" style="font-size:11px;padding:5px 12px" onclick="addPettyRow(${gi})">＋ Add Item</button>
        <div style="font-family:var(--mono);font-weight:700;font-size:13px">
          Total: <span id="petty-sub-${gi}" style="color:var(--accent)">₨${_fc2(sub)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  recalcPettyKpis();
}

function pettyRowChange_period(gi, val) {
  _pettyData.groups[gi].period = val;
}

function printPettyReport() {
  const my = document.getElementById('petty-month-sel').value;
  const gs = _pettyData.groups;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const grand = gs.reduce((s,g) => s + _pettyGroupTotal(g), 0);
  const groupBlocks = gs.map((g, gi) => {
    const sub = _pettyGroupTotal(g);
    const rows = g.rows.map((r,ri) => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${ri+1}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${r.desc||'—'}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.amount)}</td>
    </tr>`).join('');
    return `
    <div style="margin-bottom:18px;border:1px solid #d1d5db;border-radius:8px;overflow:hidden">
      <div style="background:#eff6ff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:12px;color:#1e40af">Group ${gi+1} — ${g.period||'No period'}</strong>
        <span style="font-size:11px;color:#6b7280">Sub-total: <strong style="color:#1e40af">₨${_fc2(sub)}</strong></span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #d1d5db;font-size:10px">#</th>
          <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #d1d5db;font-size:10px">Description</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #d1d5db;font-size:10px">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#eff6ff">
          <td colspan="2" style="padding:6px 8px;font-weight:700;font-size:11px">Total Petty Detail:</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;font-family:monospace;color:#1e40af">₨${_fc2(sub)}</td>
        </tr></tfoot>
      </table>
    </div>`;
  }).join('');
  _mgrPrint(`<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:16px">
      <h2 style="margin:0;font-size:16px">PETTY CASH DETAIL — ${my}</h2>
      <p style="margin:4px 0 0;font-size:11px;opacity:.7">Bahria Town Fazal Din Pharma Plus · Printed: ${today}</p>
    </div>
    ${groupBlocks}
    <div style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <strong>Grand Total — All Groups</strong>
      <strong style="font-family:monospace;font-size:15px">₨${_fc2(grand)}</strong>
    </div>
  </div>`);
}

// ══════════════════════════════════════════════════════
// INCENTIVE CALCULATOR
// ══════════════════════════════════════════════════════
const INCEN_PFX = 'mw_incentive_';
let _incData = {};
let _incMonth = '';

const _INC_FIELDS = ['saleVal','genSale','pilferage','unapproved','tillShort',
                     'cashTarget','excessFine','plusFine','paperFine','panelFine','tax'];

function _incKey(my) { return INCEN_PFX + my; }

function loadIncentiveMonth(my) {
  _incMonth = my;
  try {
    const raw = Repository.getItem(_incKey(my));
    _incData = raw ? JSON.parse(raw) : {};
  } catch(e) { _incData = {}; }
  // Populate inputs
  _INC_FIELDS.forEach(f => {
    const el = document.getElementById('inc-' + f);
    if (el) el.value = _incData[f] || '';
  });
  recalcIncentive();
}

function saveIncentiveData() {
  if (!_incMonth) { toast('⚠ Select a month first','w'); return; }
  _INC_FIELDS.forEach(f => {
    const el = document.getElementById('inc-' + f);
    if (el) _incData[f] = _ni(el.value);
  });
  Actions.saveFeatureData(_incKey(_incMonth), JSON.stringify(_incData));
  toast('✓ Incentive data saved');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function recalcIncentive() {
  const g = id => _ni(document.getElementById(id)?.value);
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent='₨'+_fc2(val); };
  const setRed = (id, val) => { const el=document.getElementById(id); if(el){ el.textContent='₨'+_fc2(Math.abs(val)); el.classList.toggle('red', val>0); } };

  const saleVal    = g('inc-saleVal');
  const genSale    = g('inc-genSale');
  const pilferage  = g('inc-pilferage');
  const tillShort  = g('inc-tillShort');
  const cashTarget = g('inc-cashTarget');
  const excessFine = g('inc-excessFine');
  const plusFine   = g('inc-plusFine');
  const paperFine  = g('inc-paperFine');
  const panelFine  = g('inc-panelFine');
  const tax        = g('inc-tax');

  const saleComm   = Math.round(saleVal * 0.005);      // 0.5%
  const genInc     = Math.round(genSale * 0.045);       // 4.5%
  const totalComm  = saleComm - pilferage - tillShort;
  const totalBonus = cashTarget;
  const totalGen   = genInc - excessFine;
  const grandTotal = totalComm + totalBonus + totalGen;
  const totalLess  = plusFine + paperFine;
  const prePanel   = grandTotal - totalLess;
  const netInc     = prePanel - panelFine;
  const salmanNet  = Math.round(netInc / 2) - tax;

  set('ic-saleComm',    saleComm);
  setRed('ic-lessPilf', pilferage);
  setRed('ic-tillCheque', tillShort);
  set('ic-totalComm',   totalComm);
  set('ic-totalBonus',  totalBonus);
  set('ic-genInc',      genInc);
  setRed('ic-lessExcess', excessFine);
  set('ic-totalGen',    totalGen);
  set('ic-grandTotal',  grandTotal);
  setRed('ic-totalLess', totalLess);
  set('ic-prePanel',    prePanel);
  setRed('ic-lessPanelFine', panelFine);
  set('ic-netInc',      netInc);
  setRed('ic-taxAmt',   tax);
  set('ic-salmanNet',   salmanNet);
}

function printIncentiveReport() {
  const my = document.getElementById('inc-month-sel').value;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const g = id => _ni(document.getElementById(id)?.value);
  const fv = v => '₨'+_fc2(v);
  const saleVal=g('inc-saleVal'), genSale=g('inc-genSale'), pilferage=g('inc-pilferage'),
        tillShort=g('inc-tillShort'), cashTarget=g('inc-cashTarget'), excessFine=g('inc-excessFine'),
        plusFine=g('inc-plusFine'), paperFine=g('inc-paperFine'), panelFine=g('inc-panelFine'), tax=g('inc-tax');
  const saleComm=Math.round(saleVal*.005), genInc=Math.round(genSale*.045);
  const totalComm=saleComm-pilferage-tillShort, totalBonus=cashTarget, totalGen=genInc-excessFine;
  const grandTotal=totalComm+totalBonus+totalGen, totalLess=plusFine+paperFine;
  const prePanel=grandTotal-totalLess, netInc=prePanel-panelFine, salmanNet=Math.round(netInc/2)-tax;
  const row=(lbl,val,style='')=>`<tr><td style="padding:5px 10px;border-bottom:1px solid #f1f5f9">${lbl}</td><td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;${style}">${val}</td></tr>`;
  const sec=(hd)=>`<tr style="background:#eff6ff"><td colspan="2" style="padding:6px 10px;font-weight:700;font-size:11px;color:#1e40af">${hd}</td></tr>`;
  const tot=(lbl,val,clr='#1e40af')=>`<tr style="background:#f0fdf4"><td style="padding:6px 10px;font-weight:700">${lbl}</td><td style="padding:6px 10px;text-align:right;font-family:monospace;font-weight:700;color:${clr}">${val}</td></tr>`;
  _mgrPrint(`<div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px">
      <h2 style="margin:0;font-size:16px">INCENTIVE DETAIL — ${my}</h2>
      <p style="margin:4px 0 0;font-size:11px;opacity:.7">Printed: ${today}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${sec('Base Figures')}
      ${row('Sale Value',fv(saleVal))}${row('Generic Sale',fv(genSale))}${row('Less Pilferage',fv(pilferage),'color:#dc2626')}${row('Till Short',fv(tillShort),'color:#dc2626')}
      ${sec('Commission')}
      ${row('Sale Commission (0.5%)',fv(saleComm))}${row('Less Pilferage','-'+fv(pilferage),'color:#dc2626')}${row('Till Cheque','-'+fv(tillShort),'color:#dc2626')}
      ${tot('Total Commission',fv(totalComm))}
      ${sec('Bonus')}${tot('Cash Target Bonus',fv(totalBonus))}
      ${sec('Generic')}${row('Generic Incentive (4.5%)',fv(genInc))}${row('Less Excess Fine','-'+fv(excessFine),'color:#dc2626')}${tot('Total Generic',fv(totalGen))}
      <tr style="background:#0f172a;color:#fff"><td style="padding:8px 10px;font-weight:700;font-size:13px">🏆 Grand Total</td><td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:#fff">${fv(grandTotal)}</td></tr>
      ${sec('Deductions / Fine')}
      ${row('Plus % Fine',fv(plusFine),'color:#dc2626')}${row('Paper Fine',fv(paperFine),'color:#dc2626')}${tot('Total Deductions',fv(totalLess),'#dc2626')}
      ${row('Pre-panel Total',fv(prePanel))}${row('Panel Fine',fv(panelFine),'color:#dc2626')}
      <tr style="background:#052e16;color:#fff"><td style="padding:8px 10px;font-weight:700;font-size:13px">✅ Net Incentive</td><td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:#4ade80">${fv(netInc)}</td></tr>
      ${sec('Split (÷ 2)')}${row('Tax',fv(tax),'color:#dc2626')}${tot('Salman Net',fv(salmanNet),'#1e40af')}
    </table>
  </div>`);
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════

// ── Save All Manager Sections ──────────────────────────────────────────────
function saveAllManagerSections() {
  const monthSels = ['sal-month-sel','gen-month-sel','crd-month-sel','petty-month-sel','inc-month-sel'];
  const anyMonth = monthSels.map(id => (document.getElementById(id)||{}).value || '').find(v => v);
  if (!anyMonth) { toast('⚠ No month selected — open a tab and pick a month first','w'); return; }
  let saved = 0;
  function tryCall(fn) { try { if (typeof fn === 'function') { fn(); saved++; } } catch(e) {} }
  staffSave(); saved++; // always save staff registry
  tryCall(saveSalaryData);
  tryCall(saveGenericData);
  tryCall(saveCreditData);
  tryCall(savePettyData);
  tryCall(saveIncentiveData);
  toast('✓ All sections saved (' + saved + ')');
  // pushToSupabase is debounced — each save* call above already triggers it;
  // this call ensures a push happens even when auto-save is off.
  if (typeof pushToSupabase === 'function') pushToSupabase();
}

// ── Populate Dashboard Working Summary ─────────────────────────────────────
function populateDashWorking(mon) {
  const wEl = document.getElementById('dash-working-section');
  if (!wEl) return;
  if (!mon) { wEl.style.display = 'none'; return; }
  wEl.style.display = '';
  const mgr = JSON.parse(Repository.getItem('BT_ManagerWork_v1') || '{}');
  const salaryRows = (mgr.salary && mgr.salary[mon]) || [];
  const genericRows = (mgr.generic && mgr.generic[mon]) || [];
  const salaryTotal = salaryRows.reduce((s, r) => s + (_ni(r.hoSal) - _ni(r.advance) + _ni(r.generic)), 0);
  const genericTotal = genericRows.reduce((s, r) => s + (Math.round(_ni(r.genericSale) * 0.04) + _ni(r.extra)), 0);
  const pettyTotal = typeof _pettyTotalForMonth === 'function' ? _pettyTotalForMonth(mon) : 0;
  function fmt(v) { return (v != null && v !== '' && v !== 0) ? '₨' + _fc2(v) : '—'; }
  const el = id => document.getElementById(id);
  if (el('dw-salary'))    el('dw-salary').textContent    = fmt(salaryTotal);
  if (el('dw-generic'))   el('dw-generic').textContent   = fmt(genericTotal);
  if (el('dw-petty'))     el('dw-petty').textContent     = fmt(pettyTotal);
  if (el('dw-incentive')) {
    const inc = JSON.parse(Repository.getItem('mw_incentive_' + mon) || '{}');
    let incNet = inc.netInc;
    if (incNet == null) {
      const saleComm = Math.round(_ni(inc.saleVal) * 0.005);
      const genInc = Math.round(_ni(inc.genSale) * 0.045);
      const totalComm = saleComm - _ni(inc.pilferage) - _ni(inc.tillShort);
      const totalGen = genInc - _ni(inc.excessFine);
      incNet = totalComm + _ni(inc.cashTarget) + totalGen - _ni(inc.plusFine) - _ni(inc.paperFine) - _ni(inc.panelFine);
    }
    el('dw-incentive').textContent = fmt(incNet || '');
  }
}

// ── Staff Card Popup ────────────────────────────────────────────────────────
function openStaffCard(i) {
  const emp = STAFF[i];
  if (!emp) return;
  const modal = document.getElementById('sc-bg');
  if (!modal) return;
  document.getElementById('sc-idx').value = i;
  const sid = emp.staffId || ('EMP-' + String(i + 1).padStart(3, '0'));
  document.getElementById('sc-title-id').textContent = sid;
  document.getElementById('sc-title-name').textContent = emp.name || '(unnamed)';
  // Stable key for the Notes tab (emp.id, falling back to staffId/name for
  // older records) — set on the hidden field so switchStaffCardTab can
  // read it without needing STAFF[i] to still be in scope.
  document.getElementById('sc-notes-key').value =
    (typeof staffNotesKeyFor === 'function') ? staffNotesKeyFor(emp) : (emp.id || sid || emp.name || '');
  // Fill form fields
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('sc-f-staffId', sid);
  set('sc-f-srNum', emp.srNum != null ? emp.srNum : (i + 1));
  set('sc-f-name', emp.name);
  set('sc-f-designation', emp.designation);
  set('sc-f-fatherName', emp.fatherName);
  set('sc-f-cnic', emp.cnic);
  set('sc-f-bloodGroup', emp.bloodGroup);
  set('sc-f-phone', emp.phone);
  set('sc-f-doj', emp.doj);
  set('sc-f-address', emp.address);
  const activeEl = document.getElementById('sc-f-active');
  if (activeEl) activeEl.checked = emp.active !== false;
  // Load credit history
  renderStaffCreditHistory(emp.name);
  modal.classList.add('on');
  switchStaffCardTab('details');
}

function closeStaffCard() {
  const modal = document.getElementById('sc-bg');
  if (modal) modal.classList.remove('on');
}

function saveStaffCard() {
  const i = parseInt(document.getElementById('sc-idx').value);
  const staff = Repository.getStaff();
  if (isNaN(i) || i < 0 || i >= staff.length) return;
  const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const activeEl = document.getElementById('sc-f-active');
  const changes = {
    staffId:     get('sc-f-staffId'),
    srNum:       Number(get('sc-f-srNum')) || staff[i].srNum,
    name:        get('sc-f-name'),
    designation: get('sc-f-designation'),
    fatherName:  get('sc-f-fatherName'),
    cnic:        get('sc-f-cnic'),
    bloodGroup:  get('sc-f-bloodGroup'),
    phone:       get('sc-f-phone'),
    doj:         get('sc-f-doj'),
    address:     get('sc-f-address'),
  };
  if (activeEl) changes.active = activeEl.checked;
  const updated = Actions.updateEmployee(i, changes);
  // Update header live
  document.getElementById('sc-title-id').textContent   = updated.staffId || '';
  document.getElementById('sc-title-name').textContent  = updated.name || '(unnamed)';
  renderStaffRegistry();
  _propagateStaffToSheets();
  toast('✓ Staff details saved — click 💾 Save Staff List to persist');
}

function switchStaffCardTab(tab) {
  document.querySelectorAll('.sc-tab').forEach(b => b.classList.toggle('active', b.dataset.sctab === tab));
  document.querySelectorAll('#sc-panel-details,#sc-panel-credit,#sc-panel-notes').forEach(p => { p.style.display = 'none'; });
  const panel = document.getElementById('sc-panel-' + tab);
  if (panel) panel.style.display = '';
  if (tab === 'notes') {
    const key = document.getElementById('sc-notes-key')?.value;
    if (key && typeof renderStaffNotesPanel === 'function') renderStaffNotesPanel(key);
  }
}

function renderStaffCreditHistory(empName) {
  const cont = document.getElementById('sc-credit-history');
  if (!cont) return;
  const norm = s => (s || '').trim().toLowerCase();
  const data = mgrLoad();
  const creditData = data.credit || {};
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const months = Object.keys(creditData).sort((a, b) => {
    const pa = a.split(' '), pb = b.split(' ');
    const ya = parseInt(pa[1]) || 0, yb = parseInt(pb[1]) || 0;
    if (ya !== yb) return yb - ya;
    return monthNames.indexOf(pb[0]) - monthNames.indexOf(pa[0]);
  });
  if (!months.length) {
    cont.innerHTML = '<p style="text-align:center;color:var(--muted);padding:32px">No credit data saved yet.</p>';
    return;
  }
  let html = '';
  months.forEach(my => {
    const emps = creditData[my] || [];
    const emp = emps.find(e => norm(e.name) === norm(empName));
    if (!emp) return;
    const net = _crdNet(emp);
    const netCol = net > 0 ? 'var(--green,#16a34a)' : net < 0 ? 'var(--red,#dc2626)' : 'var(--muted)';
    const rows = (emp.entries || []).map(en => {
      const amt = _ni(en.amount);
      return `<tr>
        <td style="padding:5px 10px;border-bottom:1px solid var(--border);font-size:12px">${en.date||''}</td>
        <td style="padding:5px 10px;border-bottom:1px solid var(--border);font-size:12px">${en.desc||''}</td>
        <td style="padding:5px 10px;border-bottom:1px solid var(--border);font-size:12px;text-align:right;font-family:monospace;color:${amt<0?'var(--red,#dc2626)':'var(--green,#16a34a)'}">₨${_fc2(en.amount)}</td>
      </tr>`;
    }).join('');
    html += `<div style="margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <div style="background:var(--accent);color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <strong style="font-size:14px">${my}</strong>
        <div style="display:flex;gap:16px;font-size:12px;opacity:.9">
          <span>Prev: ₨${_fc2(emp.prevBal)}</span>
          <span>Sal: ₨${_fc2(emp.salary)}</span>
          <span style="font-weight:700;color:#fff">Net: <span style="color:${netCol==='var(--green,#16a34a)'?'#bbf7d0':'#fecaca'}">₨${_fc2(net)}</span></span>
        </div>
      </div>
      ${rows ? `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--s2)">
          <th style="padding:5px 10px;font-size:10px;text-align:left;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Date</th>
          <th style="padding:5px 10px;font-size:10px;text-align:left;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Description</th>
          <th style="padding:5px 10px;font-size:10px;text-align:right;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p style="text-align:center;color:var(--muted);font-size:12px;padding:12px">No entries for this month</p>'}
    </div>`;
  });
  cont.innerHTML = html || '<p style="text-align:center;color:var(--muted);padding:32px">No credit history found for this employee.</p>';
}

function initApp() {
  // Restore session entries — this device's own unsynced local additions,
  // saved to localStorage by data-page.js's saveEntry(). Gap-fill only:
  // never overwrites a record that's already in DAILY/MONTHLY (e.g. one
  // that arrived via a Supabase pull since this device was last open).
  // Routed entirely through Repository — loadPendingEntries() owns the
  // `newEntries` array now (closes the ghost-state gap), and
  // gapFillDaily/gapFillMonthly own the "add what's missing" restore
  // (same named operation drive.js and supabase.js's push path use).
  try {
    Repository.loadPendingEntries();
    const pending = Repository.getPendingEntries();
    if (pending.length) Repository.gapFillDaily(pending);
    const sm = Repository.getItem('bt_new_months');
    if (sm) Repository.gapFillMonthly(JSON.parse(sm));
  } catch(e){}
  rebuildDropdowns();
  // Default dashboard to latest year
  const dashYrSel = document.getElementById('dash-year');
  if (dashYrSel) {
    const yrsArr = years();
    if (yrsArr.length) dashYrSel.value = yrsArr[yrsArr.length - 1];
  }

  // ── EventBus subscribers (MF-02 fix) ────────────────────────────
  // Wire the Floor 3 → Floor 5 path. Each subscriber reacts only to
  // its own relevant events and only when its page is currently active,
  // keeping re-renders cheap and targeted.
  //
  // Registered once here in initApp(). initApp() is guarded elsewhere
  // against running twice per session (the _autoRefreshStarted pattern),
  // so subscribers won't stack. Events that should always refresh
  // regardless of the current page call rebuildAll() directly.
  _initEventBusSubscribers();

  let target = 'cover';
  try {
    const saved = sessionStorage.getItem('bt_nav_target');
    if (saved && document.getElementById('page-' + saved)) target = saved;
    sessionStorage.removeItem('bt_nav_target');
  } catch (_) {}
  showPage(target);
  renderEntryList();
  updateGhBadge();
}

// ── EventBus subscriber registration ─────────────────────────────────
// One function, called once from initApp(). Kept separate so it is easy
// to read, test, and extend without touching initApp() itself.
function _initEventBusSubscribers() {
  // Guard: only register once per page session
  if (window._ebSubscribersRegistered) return;
  window._ebSubscribersRegistered = true;

  EventBus.onChange(function(eventName, payload) {
    // ── DAILY / MONTHLY writes ─────────────────────────────────
    // Any write to the sales data should rebuild the full app so all
    // pages stay in sync (dashboard KPIs, data table, reports, diff).
    const isSalesWrite = (
      eventName === 'daily:added'    || eventName === 'daily:updated'   ||
      eventName === 'daily:deleted'  || eventName === 'daily:pulled'    ||
      eventName === 'daily:gapfilled'||
      eventName === 'monthly:added'  || eventName === 'monthly:updated' ||
      eventName === 'monthly:deleted'|| eventName === 'monthly:pulled'  ||
      eventName === 'monthly:gapfilled'
    );
    if (isSalesWrite) {
      // Debounce: if many records arrive together (e.g. bulk pull),
      // collapse into one rebuild 300ms after the last event.
      clearTimeout(window._ebRebuildTimer);
      window._ebRebuildTimer = setTimeout(function() {
        if (typeof rebuildAll === 'function') rebuildAll();
      }, 300);
      return;
    }

    // ── STAFF changes ──────────────────────────────────────────
    // Re-render the staff registry only when the manager page is visible.
    if (eventName === 'staff:changed' || eventName === 'staff:added' ||
        eventName === 'staff:updated' || eventName === 'staff:removed') {
      if (typeof _curPage !== 'undefined' && _curPage === 'manager') {
        if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      }
      return;
    }

    // ── Navigation change ──────────────────────────────────────
    // When the user switches to the dashboard, rebuild to pick up any
    // data that arrived while another page was shown.
    if (eventName === 'nav:changed' && payload && payload.page === 'dashboard') {
      if (typeof buildDashboard === 'function') buildDashboard();
      return;
    }

    // ── Data-page while open ───────────────────────────────────
    if (eventName === 'nav:changed' && payload && payload.page === 'data') {
      if (typeof renderDataTable === 'function') renderDataTable();
      return;
    }

    // ── Index page while open ──────────────────────────────────
    if (eventName === 'nav:changed' && payload && payload.page === 'index') {
      if (typeof renderIndex === 'function') renderIndex();
      return;
    }

    // ── Conflict queued ────────────────────────────────────────
    // (Already handled in conflict-ui.js — this is intentionally a
    //  no-op here so there's no double-open of the conflict modal.)

    // ── Generic feature-data changes (item:changed) ─────────────
    // Actions.saveFeatureData() fires this for every key/value write —
    // notes, sheets, targets, custom sections, jazz cash, petty cash,
    // etc. We don't know here which page needs to redraw for a given
    // key, so we only refresh the *currently visible* page's own
    // render function if it happens to depend on this data. This is
    // deliberately conservative — a full generic key→renderer map
    // would need per-feature registration, which is out of scope for
    // this pass. The important architectural point (closes MF-02 /
    // Rule 7) is that the event exists and pages CAN subscribe to it;
    // targeted re-renders can be added feature-by-feature over time.
    if (eventName === 'item:changed' && payload && payload.key) {
      if (typeof _curPage !== 'undefined' && _curPage === 'dashboard' &&
          (payload.key === 'bt_targets' || payload.key.indexOf('mw_petty_') === 0)) {
        clearTimeout(window._ebFeatureRebuildTimer);
        window._ebFeatureRebuildTimer = setTimeout(function() {
          if (typeof buildDashboard === 'function') buildDashboard();
        }, 300);
      }
    }
  });
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeMon(); closeDay(); }});

// Bridge what's used externally, from index.html, or via a same-file
// event attribute. switchMgrTab/loadManagerPage/staffLoad are NOT here
// — they stay bare globals declared before this IIFE (see note above).
window.MGR_KEY = MGR_KEY;
window.mgrLoad = mgrLoad;
window.mgrMonths = mgrMonths;
window._mgrPopSel = _mgrPopSel;
window._ni = _ni;
window._fc2 = _fc2;
window.activeStaff = activeStaff;
window.renderStaffRegistry = renderStaffRegistry;
window.staffFieldChange = staffFieldChange;
window.staffSrNumChange = staffSrNumChange;
window.staffToggleActive = staffToggleActive;
window.staffDelete = staffDelete;
window.addStaffEmployee = addStaffEmployee;
window.saveStaffRegistry = saveStaffRegistry;
window.renderSalaryTable = renderSalaryTable;
window._salRows_cur = _salRows_cur;
window.loadSalaryMonth = loadSalaryMonth;
window.salRowChange = salRowChange;
window.addSalaryRow = addSalaryRow;
window.deleteSalRow = deleteSalRow;
window.saveSalaryData = saveSalaryData;
window.autoFillSalaryFromSheets = autoFillSalaryFromSheets;
window._genRows_cur = _genRows_cur;
window.renderGenericTable = renderGenericTable;
window.loadGenericMonth = loadGenericMonth;
window.addGenericRow = addGenericRow;
window.deleteGenRow = deleteGenRow;
window.saveGenericData = saveGenericData;
window._crdData_cur = _crdData_cur;
window.renderCreditLedger = renderCreditLedger;
window._toggleCrdEmpBody = _toggleCrdEmpBody;
window.addCrdEntryFocused = addCrdEntryFocused;
window.loadCreditMonth = loadCreditMonth;
window.crdEmpField = crdEmpField;
window.crdEntryChange = crdEntryChange;
window.deleteCrdEntry = deleteCrdEntry;
window.addCreditEmployee = addCreditEmployee;
window.deleteCrdEmp = deleteCrdEmp;
window.saveCreditData = saveCreditData;
window.copyToNextMonth = copyToNextMonth;
window.printSalaryReport = printSalaryReport;
window.printManagerDashboard = printManagerDashboard;
window.printGenericReport = printGenericReport;
window.printCreditReport = printCreditReport;
window.printCreditSummaryReport = printCreditSummaryReport;
window._pettyData = _pettyData;
window._pettyMonth = _pettyMonth;
window._pettyKey = _pettyKey;
window.loadPettyMonth = loadPettyMonth;
window.savePettyData = savePettyData;
window._pettyTotalForMonth = _pettyTotalForMonth;
window.addPettyGroup = addPettyGroup;
window.deletePettyGroup = deletePettyGroup;
window.addPettyRow = addPettyRow;
window.deletePettyRow = deletePettyRow;
window.pettyRowChange = pettyRowChange;
window.renderPettyGroups = renderPettyGroups;
window.pettyRowChange_period = pettyRowChange_period;
window.printPettyReport = printPettyReport;
window.loadIncentiveMonth = loadIncentiveMonth;
window.saveIncentiveData = saveIncentiveData;
window.recalcIncentive = recalcIncentive;
window.printIncentiveReport = printIncentiveReport;
window.saveAllManagerSections = saveAllManagerSections;
window.populateDashWorking = populateDashWorking;
window.openStaffCard = openStaffCard;
window.closeStaffCard = closeStaffCard;
window.saveStaffCard = saveStaffCard;
window.switchStaffCardTab = switchStaffCardTab;
window.initApp = initApp;

})();

