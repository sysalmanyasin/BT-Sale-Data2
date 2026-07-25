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
import { _ni, _fc2, _inp, mgrLoad, mgrSave, reconcileStaffRows } from './manager-shared.js';
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

Object.assign(window, {
  _genRows, _genIncentive, _genFinal, _genRows_cur, renderGenericTable,
  loadGenericMonth, genRowChange, recalcGenRow, addGenericRow, deleteGenRow, saveGenericData,
});

export {
  _genRows, _genIncentive, _genFinal, _genRows_cur, renderGenericTable,
  loadGenericMonth, genRowChange, recalcGenRow, addGenericRow, deleteGenRow, saveGenericData,
};
