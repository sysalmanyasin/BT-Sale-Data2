// ══════════════════════════════════════════════════════════════════════
// MANAGER — GENERIC WORKING SHEET  (ES module, split from manager.js)
//
// Per-month Generic Sale / Extra table with auto-computed Incentive
// (4% of Generic Sale) and Final (Incentive + Extra). Editing a row
// live-syncs its Final value into the matching Salary sheet row via
// `_syncGenericToSalary`, if that employee's Salary row is currently
// loaded in the DOM.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { STAFF } from './config.js';
import { _ni, _fc2, _inp, _mgrEsc, mgrLoad, mgrSave, mgrAutosave, reconcileStaffRows } from './manager-shared.js';
import { activeStaff } from './manager-staff.js';
import { _salRows_cur, _salNet, _salUpdateFooter } from './manager-salary.js';

let _genRows_cur = [];

function _genRows(my) {
  const data = mgrLoad();
  const stored = data.generic && data.generic[my];
  // Reconcile against the Staff Registry every load: drops rows for
  // anyone no longer active/in the registry, merges accidental
  // duplicates, and adds a blank row for anyone missing one.
  return reconcileStaffRows(activeStaff(), stored, e =>
    ({staffId: e.staffId, name: e.name, desig: e.designation, genericSale: 0, extra: 0}));
}

function _genIncentive(r) { return Math.round(_ni(r.genericSale) * 0.04); }
function _genFinal(r) { return _genIncentive(r) + _ni(r.extra); }

function renderGenericTable(rows) {
  const tbody = document.getElementById('gen-tbody');
  if (!tbody) return;
  const _genNorm = s => (s||'').trim().toLowerCase();
  tbody.innerHTML = rows.map((r, i) => {
    // Sr#/ID/Name/Designation are always read live off the active Staff
    // Registry (STAFF) — never off the stored row's own name/desig/srNum —
    // so this sheet can never drift out of sync with the Registry, which
    // is the single source of truth for who staff are and what they're called.
    const _gIdx = STAFF.findIndex(s => (r.staffId && s.staffId === r.staffId) || _genNorm(s.name) === _genNorm(r.name));
    const _gEmp = _gIdx >= 0 ? STAFF[_gIdx] : null;
    const _gSid = _gEmp ? (_gEmp.staffId || ('EMP-' + String(_gIdx+1).padStart(3,'0'))) : null;
    const _gSrNum = _gEmp && _gEmp.srNum != null ? Number(_gEmp.srNum) : (i+1);
    const _gName = _gEmp ? _gEmp.name : (r.name || '');
    const _gDesig = _gEmp ? _gEmp.designation : r.desig;
    const _gSaleInp  = _inp('number', r.genericSale||0,  'sal-num', "genRowChange("+i+",'genericSale',this.value);recalcGenRow("+i+")", '0');
    const _gExtraInp = _inp('number', r.extra||0,        'sal-num', "genRowChange("+i+",'extra',this.value);recalcGenRow("+i+")", '0');
    const _gNameCell = '<div style="display:flex;align-items:center;gap:5px">'
      + (_gSid
          ? '<button onclick="openStaffCard('+_gIdx+')" title="Open '+_mgrEsc(_gName||'Staff')+' Card"'
            + ' style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:10px;font-weight:700;font-family:monospace;flex-shrink:0">'+_gSid+'</button>'
          : '')
      + '<span style="font-weight:600">'+(_mgrEsc(_gName) || '<em style="color:var(--muted)">(unnamed)</em>')+'</span></div>';
    return `<tr class="mgr-tr">
      <td class="mgr-td sal-c" style="font-size:11px;color:var(--muted);font-weight:700">${_gSrNum}</td>
      <td class="mgr-td">${_gNameCell}</td>
      <td class="mgr-td" style="color:var(--t2)">${_mgrEsc(_gDesig) || '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mgr-td">${_gSaleInp}</td>
      <td class="mgr-td"><input type="number" id="gen-inc-${i}" class="mgr-inp calc sal-num" value="${_genIncentive(r)}" readonly></td>
      <td class="mgr-td">${_gExtraInp}</td>
      <td class="mgr-td"><input type="number" id="gen-fin-${i}" class="mgr-inp calc sal-num" value="${_genFinal(r)}" readonly></td>
      <td class="mgr-td sal-c"><button class="mgr-del" onclick="deleteGenRow(${i})">🗑</button></td>
    </tr>`;
  }).join('');
  _genUpdateFooter(rows);
}

let _genLoadedMonth = null;
function loadGenericMonth(my) {
  // Preserve any typed-but-unsaved genericSale/extra edits already
  // applied in-memory by genRowChange() (fires live, on every keystroke,
  // well before Save is clicked) — this function used to always replace
  // _genRows_cur wholesale from storage, silently discarding those edits
  // whenever a background Supabase pull re-triggered it via
  // refreshManagerPage() for the SAME month already open. Same class of
  // bug already fixed in jazz-cash.js/_renderTally() and
  // ledger-page.js/renderLedgerView() — only applies on a same-month
  // refresh; an actual month switch intentionally starts fresh.
  const _prevRows = (my === _genLoadedMonth) ? _genRows_cur : null;
  _genRows_cur = _genRows(my);
  if (_prevRows) {
    const _norm = s => (s||'').trim().toLowerCase();
    _genRows_cur.forEach(r => {
      const p = _prevRows.find(pr => _norm(pr.name) === _norm(r.name));
      if (p) { r.genericSale = p.genericSale; r.extra = p.extra; }
    });
  }
  _genLoadedMonth = my;
  window._genRows_cur = _genRows_cur; // keep the window bridge live — ai-bridge.js reads this bare global
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
  mgrAutosave('generic', () => saveGenericData(true));
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
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono)">₨${_fc2(totSale)}</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono);color:var(--green)">₨${_fc2(totInc)}</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono)">₨${_fc2(totExtra)}</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono);color:var(--accent)">₨${_fc2(totFin)}</td>
    <td></td>
  </tr>`;
}
function addGenericRow() {
  _genRows_cur.push({name:'', desig:'Salesman', genericSale:0, extra:0});
  renderGenericTable(_genRows_cur);
  mgrAutosave('generic', () => saveGenericData(true));
}
function deleteGenRow(i) {
  _genRows_cur.splice(i, 1);
  renderGenericTable(_genRows_cur);
  mgrAutosave('generic', () => saveGenericData(true));
}
function saveGenericData(silent) {
  const my = document.getElementById('gen-month-sel').value;
  const data = mgrLoad();
  if (!data.generic) data.generic = {};
  data.generic[my] = _genRows_cur.map(r => ({...r}));
  mgrSave(data);
  if (!silent) toast('✓ Generic Working saved for ' + my);
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

Object.assign(window, {
  _genRows, _genIncentive, _genFinal, _genRows_cur, renderGenericTable,
  loadGenericMonth, genRowChange, recalcGenRow, addGenericRow, deleteGenRow, saveGenericData,
});

export {
  _genRows, _genIncentive, _genFinal, _genRows_cur, renderGenericTable,
  loadGenericMonth, genRowChange, recalcGenRow, addGenericRow, deleteGenRow, saveGenericData,
};
