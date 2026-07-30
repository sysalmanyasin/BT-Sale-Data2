// ══════════════════════════════════════════════════════════════════════
// MANAGER — SALARY SHEET  (ES module, split from the old manager.js)
//
// Per-month salary table: HO Salary / Advance / Generic / Net, with
// Advance auto-pulled from the Credit ledger's positive entries and
// Generic auto-pulled from the Generic Working sheet's Final column.
//
// `_salRows_cur` is exported live (ES modules give importers a
// read-only *live* binding — always current, no manual re-sync needed
// for other modules). It is ALSO mirrored onto `window._salRows_cur`
// after every reassignment, because ai-bridge.js (still a classic
// script) reads/writes that bare global directly for the AI assistant's
// "add/edit/delete salary row" commands — a plain one-time bridge would
// go stale the moment this function re-ran (that was a real, live bug:
// the old bridge was only ever set once, at initial script load, before
// any month was loaded — same class of bug the credit ledger's
// `_crdData_cur` bridge already avoided by re-syncing on every load).
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { STAFF } from './config.js';
import { _ni, _fc2, _inp, _mgrEsc, mgrLoad, mgrSave, reconcileStaffRows } from './manager-shared.js';
import { activeStaff } from './manager-staff.js';
import { _crdData, _crdData_cur } from './manager-credit.js';
import { _genRows, _genRows_cur, _genFinal } from './manager-generic.js';

function _salRows(my) {
  const data = mgrLoad();
  const stored = data.salary && data.salary[my];
  // Reconcile against the Staff Registry every load: drops rows for
  // anyone no longer active/in the registry, merges accidental
  // duplicates, and adds a blank row for anyone missing one.
  return reconcileStaffRows(activeStaff(), stored, e =>
    ({staffId: e.staffId, name: e.name, desig: e.designation, days: 31, hoSal: 0, advance: 0, generic: 0}));
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
      _advTitle = 'Credit entries:\n' + _crdEmp.entries.map(e => e.date + ': ' + (e.desc||'') + ' Rs' + _fc2(e.amount)).join('\n');
    }
    // Sr#/ID/Name/Designation are always read live off the active Staff
    // Registry (STAFF) — never off the stored row's own name/desig/srNum —
    // so this sheet can never drift out of sync with the Registry, which
    // is the single source of truth for who staff are and what they're called.
    const _sIdx = STAFF.findIndex(s => (r.staffId && s.staffId === r.staffId) || _salNorm(s.name) === _salNorm(r.name));
    const _sEmp = _sIdx >= 0 ? STAFF[_sIdx] : null;
    const _sSid = _sEmp ? (_sEmp.staffId || ('EMP-' + String(_sIdx+1).padStart(3,'0'))) : null;
    const _sSrNum = _sEmp && _sEmp.srNum != null ? Number(_sEmp.srNum) : (i+1);
    const _sName = _sEmp ? _sEmp.name : (r.name || '');
    const _sDesig = _sEmp ? _sEmp.designation : r.desig;
    const _sNameCell = '<div style="display:flex;align-items:center;gap:5px">'
      + (_sSid
          ? '<button onclick="openStaffCard('+_sIdx+')" title="Open '+_mgrEsc(_sName||'Staff')+' Card"'
            + ' style="background:var(--accent);color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:10px;font-weight:700;font-family:monospace;flex-shrink:0">'+_sSid+'</button>'
          : '')
      + '<span style="font-weight:600">'+(_mgrEsc(_sName) || '<em style="color:var(--muted)">(unnamed)</em>')+'</span></div>';
    return `<tr class="mgr-tr">
      <td class="mgr-td sal-c" style="font-size:11px;color:var(--muted);font-weight:700">${_sSrNum}</td>
      <td class="mgr-td">${_sNameCell}</td>
      <td class="mgr-td" style="color:var(--t2)">${_mgrEsc(_sDesig) || '<span style="color:var(--muted)">—</span>'}</td>
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
    // Sum ALL credit entries (advances drawn minus deductions/repayments),
    // so this matches the same total the Credit ledger's Net already uses
    // — a negative entry there must also reduce Advance here, or the two
    // sheets drift apart the moment any deduction is logged.
    const entryTotal = crd ? crd.entries.reduce((s,e) => s + _ni(e.amount), 0) : 0;
    return {
      ...row,
      // Advance: only auto-fill if salary not yet saved for this month
      advance: alreadySaved ? row.advance : entryTotal,
      // Generic: always pull latest Final value from Generic Working sheet
      generic: gen ? _genFinal(gen) : row.generic
    };
  });
  window._salRows_cur = _salRows_cur; // keep the window bridge live (see file header note)
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
    // Sum ALL entries, signed — advances given minus deductions/repayments —
    // matching the Credit ledger's Net (see loadSalaryMonth for details).
    const crd = crdRows.find(c => norm(c.name) === rName);
    let advance = row.advance;
    if (crd) {
      const entryTotal = crd.entries.reduce((s, e) => s + _ni(e.amount), 0);
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
  window._salRows_cur = _salRows_cur; // keep the window bridge live (see file header note)
  renderSalaryTable(_salRows_cur);
  toast(`⚡ Auto-filled: ${filledAdv} advance${filledAdv!==1?'s':''}, ${filledGen} generic value${filledGen!==1?'s':''} — click 💾 Save to keep`);
}


Object.assign(window, {
  _salRows, _salRows_cur, renderSalaryTable, loadSalaryMonth, salRowChange, addSalaryRow,
  deleteSalRow, saveSalaryData, autoFillSalaryFromSheets, _salNet, _salUpdateFooter,
});

export {
  _salRows, _salRows_cur, renderSalaryTable, loadSalaryMonth, salRowChange, addSalaryRow,
  deleteSalRow, saveSalaryData, autoFillSalaryFromSheets, _salNet, _salUpdateFooter,
};
