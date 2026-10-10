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
import { _ni, _fc2, _mgrEsc, mgrLoad, mgrSave, mgrAutosave, reconcileStaffRows, _salExtrasNet } from './manager-shared.js';
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

// Net = HO Salary − Advance + Generic, then every custom column is added (+)
// or subtracted (−) according to its own sign. Extras live on the row itself
// (see _salExtrasNet in manager-shared.js), so this works for any row from any month.
function _salNet(r) { return _ni(r.hoSal) - _ni(r.advance) + _ni(r.generic) + _salExtrasNet(r); }

// ── Custom columns ───────────────────────────────────────────────────
// Ordered, de-duplicated column definitions found across all rows.
function _salCols(rows) {
  const out = [], seen = new Set();
  (rows || []).forEach(r => (r.extras || []).forEach(e => {
    if (e && e.id && !seen.has(e.id)) { seen.add(e.id); out.push({ id: e.id, name: e.name, sign: e.sign === '-' ? '-' : '+' }); }
  }));
  return out;
}
// Make every row carry every column (same order, same name/sign), keeping amounts.
function _salNormalizeExtras(rows) {
  const cols = _salCols(rows);
  (rows || []).forEach(r => {
    const have = new Map((r.extras || []).map(e => [e.id, e]));
    r.extras = cols.map(c => ({ ...c, amount: have.has(c.id) ? _ni(have.get(c.id).amount) : 0 }));
  });
  return cols;
}

function renderSalaryTable(rows) {
  const tbody = document.getElementById('sal-tbody');
  if (!tbody) return;
  const _cols = _salNormalizeExtras(rows);
  _salRenderHeader(_cols);
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
    // Days input: use ?? not || — "Copy → Next Month" intentionally resets
    // days to 0 so the user notices and fills in the real figure for the
    // new month. `r.days||31` used to hide that reset (0 is falsy, so it
    // silently displayed 31 as if days were already filled in) and, worse,
    // disagreed with the Print report, which showed the true stored 0.
    const skipped = !!r.printSkip;
    return `<tr class="mgr-tr${skipped ? ' sal-row-skip' : ''}">
      <td class="mgr-td sal-c" style="font-size:11px;color:var(--muted);font-weight:700">${_sSrNum}</td>
      <td class="mgr-td">${_sNameCell}${skipped ? '<span class="crd-skip-badge" title="Excluded from print">Hidden from print</span>' : ''}</td>
      <td class="mgr-td" style="color:var(--t2)">${_mgrEsc(_sDesig) || '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mgr-td sal-c" style="width:88px"><input type="number" value="${r.days ?? 31}" class="mgr-inp sal-num" placeholder="31" oninput="salRowChange(${i},'days',this.value)"></td>
      <td class="mgr-td"><input type="number" value="${r.hoSal||0}" class="mgr-inp sal-num" placeholder="0" oninput="salRowChange(${i},'hoSal',this.value);recalcSalNet(${i})"></td>
      <td class="mgr-td" ${_advTitle ? 'title="'+_advTitle+'" style="position:relative"' : ''}><input type="number" value="${r.advance||0}" class="mgr-inp sal-num${_advTitle?' sal-adv-linked':''}" placeholder="0" oninput="salRowChange(${i},'advance',this.value);recalcSalNet(${i})">${_advTitle ? '<span style="position:absolute;top:2px;right:3px;font-size:9px;color:var(--accent);pointer-events:none" title="'+_advTitle+'">💳</span>' : ''}</td>
      <td class="mgr-td"><input type="number" value="${r.generic||0}" class="mgr-inp sal-num" placeholder="0" oninput="salRowChange(${i},'generic',this.value);recalcSalNet(${i})"></td>
      ${_cols.map(c => `<td class="mgr-td"><input type="number" value="${_ni(r.extras.find(e => e.id === c.id)?.amount) || 0}" class="mgr-inp sal-num" placeholder="0" oninput="salExtraChange(${i},'${c.id}',this.value);recalcSalNet(${i})"></td>`).join('')}
      <td class="mgr-td"><input type="number" id="sal-net-${i}" class="mgr-inp calc sal-num" value="${_salNet(r)}" readonly></td>
      <td class="mgr-td sal-c"><button class="crd-print-toggle${skipped ? ' is-off' : ''}" onclick="toggleSalPrintSkip(${i})" title="${skipped ? 'Excluded from print — click to include' : 'Included in print — click to exclude'}">${skipped ? '🖨🚫' : '🖨'}</button></td>
      <td class="mgr-td sal-c"><button class="mgr-del" onclick="deleteSalRow(${i})">🗑</button></td>
    </tr>`;
  }).join('');
  _salUpdateFooter(rows);
}

// Inserts one <th> per custom column just before the static "Net Salary" header.
function _salRenderHeader(cols) {
  const net = document.getElementById('sal-th-net');
  if (!net) return;
  const tr = net.parentNode;
  tr.querySelectorAll('th.sal-extra-th').forEach(n => n.remove());
  const base = net.getAttribute('style') || '';
  cols.forEach(c => {
    const th = document.createElement('th');
    th.className = 'sal-extra-th';
    th.setAttribute('style', base);
    th.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:4px">'
      + '<span style="cursor:pointer" title="Rename column" onclick="salRenameColumn(\'' + c.id + '\')">' + _mgrEsc(c.name) + '</span>'
      + '<button title="' + (c.sign === '-' ? 'Subtracts from Net — click to make it Add' : 'Adds to Net — click to make it Subtract') + '" onclick="salToggleColSign(\'' + c.id + '\')"'
      + ' style="border:none;border-radius:4px;padding:0 6px;font-weight:800;font-size:12px;cursor:pointer;color:#fff;background:' + (c.sign === '-' ? '#dc2626' : '#16a34a') + '">' + (c.sign === '-' ? '−' : '+') + '</button>'
      + '<button title="Remove column" onclick="salRemoveColumn(\'' + c.id + '\')" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:11px">✕</button></div>';
    tr.insertBefore(th, net);
  });
}

let _salRows_cur = [];
let _salLoadedMonth = null;

function loadSalaryMonth(my) {
  // Preserve any typed-but-unsaved days/hoSal edits already applied
  // in-memory by salRowChange() before this reloads from storage — same
  // class of bug already fixed in jazz-cash.js/ledger-page.js: a
  // background Supabase pull re-triggering this for the SAME month via
  // refreshManagerPage() used to silently discard them. advance/generic
  // are intentionally left to the auto-pull logic below, unaffected.
  const _prevSalRows = (my === _salLoadedMonth) ? _salRows_cur : null;
  _salRows_cur = _salRows(my);
  const norm = s => (s||'').trim().toLowerCase();
  if (_prevSalRows) {
    _salRows_cur.forEach(r => {
      const p = _prevSalRows.find(pr => norm(pr.name) === norm(r.name));
      if (p) { r.days = p.days; r.hoSal = p.hoSal; if (p.extras) r.extras = JSON.parse(JSON.stringify(p.extras)); }
    });
  }
  _salLoadedMonth = my;
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
  mgrAutosave('salary', () => saveSalaryData(true));
}
function salExtraChange(i, id, val) {
  const r = _salRows_cur[i];
  if (!r) return;
  const e = (r.extras || []).find(x => x.id === id);
  if (e) e.amount = _ni(val);
  mgrAutosave('salary', () => saveSalaryData(true));
}
function salAddColumn(name, sign) {
  name = (name || '').trim();
  if (!name) { toast('⚠ Enter a column name', 'w'); return false; }
  if (_salCols(_salRows_cur).some(c => c.name.trim().toLowerCase() === name.toLowerCase())) { toast('⚠ A column named "' + name + '" already exists', 'w'); return false; }
  const id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const sg = sign === '-' ? '-' : '+';
  _salRows_cur.forEach(r => { (r.extras = r.extras || []).push({ id, name, sign: sg, amount: 0 }); });
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
  return true;
}
function salAddColumnFromBar() {
  const n = document.getElementById('sal-newcol-name'), s = document.getElementById('sal-newcol-sign');
  if (salAddColumn(n && n.value, s && s.value)) { if (n) n.value = ''; }
}
function _salMapCol(id, fn) {
  _salRows_cur.forEach(r => (r.extras || []).forEach(e => { if (e.id === id) fn(e); }));
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
}
function salToggleColSign(id) { _salMapCol(id, e => { e.sign = e.sign === '-' ? '+' : '-'; }); }
function salRenameColumn(id) {
  const cur = (_salCols(_salRows_cur).find(c => c.id === id) || {}).name || '';
  const nn = (prompt('Rename column:', cur) || '').trim();
  if (nn) _salMapCol(id, e => { e.name = nn; });
}
function salRemoveColumn(id) {
  const c = _salCols(_salRows_cur).find(x => x.id === id);
  if (!c) return;
  if (!confirm('Remove column "' + c.name + '" and its amounts for this month?')) return;
  _salRows_cur.forEach(r => { r.extras = (r.extras || []).filter(e => e.id !== id); });
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
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
  const _fcols = _salCols(rows);
  const extraTds = _fcols.map(c => {
    const t = rows.reduce((s,r) => s + _ni((r.extras || []).find(e => e.id === c.id)?.amount), 0);
    return `<td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono);color:${c.sign === '-' ? '#dc2626' : '#16a34a'}">${c.sign === '-' ? '−' : '+'}₨${_fc2(t)}</td>`;
  }).join('');
  document.getElementById('sal-tfoot').innerHTML = `<tr class="mgr-tfoot">
    <td colspan="4" style="text-align:right;padding:7px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">TOTALS</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono)">₨${_fc2(totalHO)}</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono)">₨${_fc2(totalAdv)}</td>
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono)">₨${_fc2(totalGen)}</td>
    ${extraTds}
    <td class="mgr-td" style="text-align:center;font-weight:700;font-family:var(--mono);color:var(--accent)">₨${_fc2(totalNet)}</td>
    <td></td>
    <td></td>
  </tr>`;
}
function addSalaryRow() {
  _salRows_cur.push({name:'', desig:'Salesman', days:31, hoSal:0, advance:0, generic:0, extras:[]});
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
}
function deleteSalRow(i) {
  _salRows_cur.splice(i, 1);
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
}
// Per-row, per-month flag: when true, this employee is left out of
// printSalaryReport() (manager-reports.js) — same pattern and same
// printSkip field name as the Staff Credit sheet's 🖨 toggle. Purely a
// print-time filter; the row and its figures are untouched on screen and
// in storage. Persists on Save / Copy → Next Month like every other
// salary field.
function toggleSalPrintSkip(i) {
  const row = _salRows_cur[i];
  if (!row) return;
  row.printSkip = !row.printSkip;
  renderSalaryTable(_salRows_cur);
  mgrAutosave('salary', () => saveSalaryData(true));
}
function saveSalaryData(silent) {
  const my = document.getElementById('sal-month-sel').value;
  const data = mgrLoad();
  if (!data.salary) data.salary = {};
  data.salary[my] = _salRows_cur.map(r => ({...r}));
  mgrSave(data);
  if (!silent) toast('✓ Salary saved for ' + my);
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
  deleteSalRow, saveSalaryData, autoFillSalaryFromSheets, _salNet, _salUpdateFooter, toggleSalPrintSkip,
  _salCols, salExtraChange, salAddColumn, salAddColumnFromBar, salToggleColSign, salRenameColumn, salRemoveColumn,
});

export {
  _salRows, _salRows_cur, renderSalaryTable, loadSalaryMonth, salRowChange, addSalaryRow,
  deleteSalRow, saveSalaryData, autoFillSalaryFromSheets, _salNet, _salUpdateFooter, toggleSalPrintSkip,
  _salCols, salExtraChange, salAddColumn, salAddColumnFromBar, salToggleColSign, salRenameColumn, salRemoveColumn,
};
