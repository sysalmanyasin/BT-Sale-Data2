// ══════════════════════════════════════════════════════════════════════
// MANAGER — STAFF REGISTRY  (ES module, split from the old manager.js)
//
// Single source of truth for employees: CRUD (add/edit/toggle/delete),
// the Staff Card popup (per-employee detail view, notes, credit
// history), and propagating a new/edited employee out to the
// Salary/Generic/Credit sheets they should appear on.
//
// CRUD must always go through Repository.addStaffMember/updateStaffMember/
// removeStaffMember (Floor 1) — never raw STAFF[i] mutation. See README.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { STAFF } from './config.js';
import { _ni, _fc2 } from './manager-shared.js';
import { _salRows_cur, renderSalaryTable } from './manager-salary.js';
import { _genRows_cur, renderGenericTable } from './manager-generic.js';
import { _crdData_cur, _crdNet, renderCreditLedger, thisMonthNetFor, renderStaffCreditCurrent } from './manager-credit.js';

function staffSave() {
  Repository.saveStaff();
}

function activeStaff() {
  return STAFF.filter(e => e.active !== false)
    .sort((a, b) => (Number(a.srNum)||999) - (Number(b.srNum)||999));
}

let _staffShowInactive = false;
function staffToggleShowInactive(checked) {
  _staffShowInactive = !!checked;
  renderStaffRegistry();
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
  const toggleEl = document.getElementById('staff-show-inactive');
  if (toggleEl) toggleEl.checked = _staffShowInactive;
  if (!STAFF.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px">No employees yet — click <strong>+ Add Employee</strong></div>';
    return;
  }
  // Sort by srNum for display (STAFF array order unchanged); active-only
  // by default, matching how Salary/Generic/Credit sheets already work.
  const _srSorted = STAFF.map((emp, origIdx) => ({emp, origIdx}))
    .filter(({emp}) => _staffShowInactive || emp.active !== false)
    .sort((a, b) => (Number(a.emp.srNum)||999) - (Number(b.emp.srNum)||999));
  if (!_srSorted.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px">No active employees — check "Show inactive employees too" below, or add one.</div>';
    return;
  }
  cont.innerHTML = `<div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:1080px;border:2px solid var(--border)">
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
        <th style="padding:9px 10px;text-align:center;border:1px solid rgba(255,255,255,.2);font-size:10px;text-transform:uppercase;letter-spacing:.05em" title="This calendar month's credit balance — tap a name to add or edit">This Month</th>
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
          <button onclick="openStaffCard(${i})" style="border:none;background:none;cursor:pointer;font-weight:700;font-family:var(--mono);font-size:12px;color:${(() => { const nv = thisMonthNetFor(emp.name); return nv > 0 ? 'var(--green)' : nv < 0 ? 'var(--red)' : 'var(--muted)'; })()}" title="Tap to add/edit this month's credit">
            ₨${_fc2(thisMonthNetFor(emp.name))}
          </button>
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
  renderStaffCreditCurrent(emp.name);
  modal.classList.add('on');
  switchStaffCardTab('details');
}

function closeStaffCard() {
  const modal = document.getElementById('sc-bg');
  if (modal) modal.classList.remove('on');
}

// Calls the set-staff-login Edge Function — save the Staff Card first
// (phone number) before using this, since the function reads phone
// from bt_staff, never from this form directly.
async function setStaffLogin() {
  const i = Number(document.getElementById('sc-idx')?.value);
  const emp = STAFF[i];
  if (!emp) { toast('⚠ No Staff ID for this employee.', 'w'); return; }
  // bt_staff.id (and staff_auth_link.staff_id, which FKs to it) is the
  // internal emp.id ('emp_...'), NOT the human-readable staffId shown in
  // the form ('EMP-001') — those are different fields. Sending the
  // display staffId here would never match a row in bt_staff.
  const internalId = emp.id;
  const displaySid = document.getElementById('sc-f-staffId')?.value || internalId;
  if (!internalId) { toast('⚠ No internal ID for this employee — re-save the Staff List.', 'w'); return; }
  const phone = document.getElementById('sc-f-phone')?.value;
  if (!phone) { toast('⚠ Add a phone number and click 💾 Save Staff List first.', 'w'); return; }
  const pin = prompt('Set a 4-digit PIN for ' + displaySid + ' (used with their phone number to log into Closing App):');
  if (pin === null) return;
  if (!/^\d{4}$/.test(pin.trim())) { alert('PIN must be exactly 4 digits.'); return; }

  try {
    const { data, error } = await _sb().functions.invoke('set-staff-login', {
      body: { staffId: internalId, pin: pin.trim() },
    });
    if (error) {
      // supabase-js only gives a generic "non-2xx status code" message on
      // FunctionsHttpError — the actual reason is in the response body,
      // reachable via error.context (the raw Response object).
      let detail = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      } catch { /* body wasn't JSON or context unavailable — keep generic message */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    toast('✓ Login set for ' + displaySid + ' (phone ' + data.phone + ')');
  } catch (e) {
    alert('Could not set login: ' + (e?.message || e) +
      '\n\nMake sure you clicked 💾 Save Staff List after adding the phone number, so bt_staff has it.');
  }
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


Object.assign(window, {
  activeStaff, renderStaffRegistry, staffFieldChange, staffSrNumChange,
  staffToggleActive, staffDelete, addStaffEmployee, saveStaffRegistry, staffSave,
  openStaffCard, closeStaffCard, setStaffLogin, saveStaffCard, switchStaffCardTab,
  renderStaffCreditHistory, staffToggleShowInactive,
});

export {
  activeStaff, renderStaffRegistry, staffFieldChange, staffSrNumChange,
  staffToggleActive, staffDelete, addStaffEmployee, saveStaffRegistry, staffSave,
  openStaffCard, closeStaffCard, setStaffLogin, saveStaffCard, switchStaffCardTab,
  renderStaffCreditHistory, staffToggleShowInactive,
};
