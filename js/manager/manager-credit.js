// ══════════════════════════════════════════════════════════════════════
// MANAGER — STAFF CREDIT LEDGER  (ES module, split from manager.js)
//
// Per-month, per-employee advance/credit tracking: previous balance +
// dated entries + salary/less-generic deductions = net. Also owns
// "Copy to Next Month" (rolls each employee's net into next month's
// opening balance).
// ══════════════════════════════════════════════════════════════════════
import { Repository } from '../platform/repository.js';
import { STAFF } from '../platform/config.js';
import { _ni, _fc2, _mgrPopSel, mgrLoad, mgrSave, mgrAutosave, reconcileStaffRows, activeStaff, _inp } from './manager-shared.js';
import { act, arg } from '../shared/dom-actions.js';
import { withEntryIds, newEntryId, rowKey, hasCreditData, entryTombstoneKeys } from '../shared/credit-merge.js';

// ══════════════════════════════
// STAFF CREDIT LEDGER
// ══════════════════════════════
let _crdData_cur = []; // [{name, prevBal, entries:[{date,desc,amount}], salary, lessGeneric}]

function _crdData(my) {
  const data = mgrLoad();
  const stored = data.credit && data.credit[my];
  // Reconcile against the Staff Registry every load: merges accidental
  // duplicates and adds a blank row for anyone missing one. Rows that match
  // nobody in the registry are KEPT when they carry money (inactive staff,
  // renamed rows, registry not loaded yet) — dropping them here used to
  // delete their data for good on the very next save.
  const rows = reconcileStaffRows(activeStaff(), stored, e =>
    ({staffId: e.staffId, name: e.name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0}),
    { keepOrphan: hasCreditData });
  // Every entry gets a stable id (derived for legacy ones) so sync can merge entry-by-entry.
  return rows.map(r => ({ ...r, entries: withEntryIds(r.entries) }));
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
        <td class="mgr-td">${_inp('text', en.date||'', '', act('input', 'crdEntryChange', ei, eni, 'date', arg.value), 'Date')}</td>
        <td class="mgr-td">${_inp('text', en.desc||'', '', act('input', 'crdEntryChange', ei, eni, 'desc', arg.value), 'Description (credit/deduction/…)')}${en.source==='closing_app' ? ' <span title="From Closing App" style="font-size:11px;background:var(--blue,#2563eb);color:#fff;padding:1px 6px;border-radius:10px;">📱</span>' : ''}</td>
        <td class="mgr-td"><input type="number" value="${en.amount||0}" class="mgr-inp sal-num" style="font-weight:700;${_ni(en.amount)<0?'color:var(--red)':'color:var(--green)'}" placeholder="0 (negative=deduction)"${act('input', { then: [['recalcCrdEmp', ei]] }, 'crdEntryChange', ei, eni, 'amount', arg.value)}></td>
        <td class="mgr-td" style="text-align:center"><button class="mgr-del"${act('click', 'deleteCrdEntry', ei, eni)}>🗑</button></td>
      </tr>`).join('');

  container.innerHTML = `<div class="crd-table-wrap"><table class="crd-table">
    <thead><tr>
      <th class="crd-th-sr">Sr#</th><th class="crd-th-name">Staff</th>
      <th>Prev</th><th>Salary</th><th>LessGen</th><th>Net</th><th class="crd-th-print" title="Include in Print Summary/Detailed">🖨</th><th></th>
    </tr></thead>
    <tbody>
    ${rows.map(({ emp, ei, cIdx, sid, srNum }) => {
      const net = _crdNet(emp);
      const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
      const nameAttrs = cIdx >= 0 ? act('click', 'openStaffCard', cIdx) : act('click', '_toggleCrdEmpBody', ei);
      const skipped = !!emp.printSkip;
      return `
      <tr class="crd-row${skipped ? ' crd-row-skip' : ''}">
        <td class="crd-td-sr">${srNum !== 999 ? srNum : '—'}</td>
        <td class="crd-td-name">
          ${sid ? `<button class="crd-sid-pill"${act('click', { stop: true }, 'openStaffCard', cIdx)} title="Open Staff Card">${sid}</button>` : ''}
          <span class="crd-name-link"${nameAttrs}>${_crdEsc(emp.name || '(unnamed)')}</span>
          ${emp.entries.length ? `<span class="crd-entry-badge">${emp.entries.length}</span>` : ''}
          ${skipped ? '<span class="crd-skip-badge" title="Excluded from print">Hidden from print</span>' : ''}
        </td>
        <td class="crd-td-num">₨${_fc2(emp.prevBal)}</td>
        <td class="crd-td-num">₨${_fc2(emp.salary)}</td>
        <td class="crd-td-num">₨${_fc2(emp.lessGeneric)}</td>
        <td class="crd-td-num crd-td-net" style="color:${netColor}" id="crd-net-${ei}">₨${_fc2(net)}</td>
        <td class="crd-td-action">
          <button class="crd-print-toggle${skipped ? ' is-off' : ''}" id="crd-print-${ei}"${act('click', { stop: true }, 'toggleCrdPrintSkip', ei)} title="${skipped ? 'Excluded from print — click to include' : 'Included in print — click to exclude'}">${skipped ? '🖨🚫' : '🖨'}</button>
        </td>
        <td class="crd-td-action">
          <button class="crd-expand-btn" id="crd-chev-${ei}"${act('click', '_toggleCrdEmpBody', ei)} title="Quick-edit this month right here">▶</button>
        </td>
      </tr>
      <tr class="crd-body-row" id="crd-body-${ei}" style="display:none">
        <td colspan="8">
          <div class="crd-emp-fields">
            <div class="fg"><label>Previous Balance (₨)</label><input type="number" value="${emp.prevBal||0}" class="mgr-inp"${act('input', { then: [['recalcCrdEmp', ei]] }, 'crdEmpField', ei, 'prevBal', arg.value)}></div>
            <div class="fg"><label>Salary Paid (₨)</label><input type="number" value="${emp.salary||0}" class="mgr-inp"${act('input', { then: [['recalcCrdEmp', ei]] }, 'crdEmpField', ei, 'salary', arg.value)}></div>
            <div class="fg"><label>Less Generic (₨)</label><input type="number" value="${emp.lessGeneric||0}" class="mgr-inp"${act('input', { then: [['recalcCrdEmp', ei]] }, 'crdEmpField', ei, 'lessGeneric', arg.value)}></div>
          </div>
          <div style="padding:0 14px 14px">
          <table style="width:100%;border-collapse:collapse;min-width:420px;border:1px solid var(--border)">
            <thead><tr style="background:var(--accent);color:#fff">
              <th style="padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Date</th>
              <th style="padding:7px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Description</th>
              <th style="padding:7px 10px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border:1px solid rgba(255,255,255,.2)">Amount (₨)</th>
              <th style="padding:7px 10px;border:1px solid rgba(255,255,255,.2)"></th>
            </tr></thead>
            <tbody id="crd-tbody-${ei}">${entryRowsFor(emp, ei)}</tbody>
          </table>
          ${emp.entries.length === 0 ? '<p style="text-align:center;color:var(--muted);font-size:12px;padding:14px">No entries yet — tap "＋ Entry" below to add.</p>' : ''}
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-p" style="font-size:11px;padding:5px 12px"${act('click', 'addCrdEntryFocused', ei)}>💳 ＋ Entry</button>
            <button class="mgr-del" style="margin-left:auto"${act('click', 'deleteCrdEmp', ei)} title="Remove employee from this month">🗑 Remove</button>
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

let _crdLoadedMonth = null;

const _tomb = key => { try { if (window.SyncTombstones) window.SyncTombstones.markDeleted(key); } catch (_) { /* best-effort */ } };
const _crdNorm = s => (s || '').trim().toLowerCase();
const _pushIfAuto = () => {
  if (Repository.getItem('bt_auto_save') === '1' && typeof window.pushToSupabase === 'function') window.pushToSupabase();
};
const _sameEmp = (a, b) => (a.staffId && b.staffId) ? a.staffId === b.staffId : _crdNorm(a.name) === _crdNorm(b.name);

// ── SINGLE SOURCE OF TRUTH = STORAGE ────────────────────────────────────
// This sheet used to keep a whole-month copy in memory (_crdData_cur) and
// write that copy back to storage on every autosave / "Save All". Anything
// written to storage by another path in between (Quick Add, Staff Card,
// Unmatched assignment, AI assistant, a sync pull) was therefore silently
// overwritten by the stale in-memory copy — the "I saved it, synced, and it
// vanished after reload" bug. Now every edit is a tiny PATCH applied to the
// stored row (found by staffId/name, entries by id); _crdData_cur is only a
// render cache rebuilt from storage by loadCreditMonth().
function _crdStoredRow(data, my, mem) {
  if (!data.credit) data.credit = {};
  if (!Array.isArray(data.credit[my])) {
    data.credit[my] = _crdData(my).map(r => ({ ...r, entries: r.entries.map(e => ({ ...e })) }));
  }
  const rows = data.credit[my];
  let row = rows.find(r => _sameEmp(r, mem)) || rows.find(r => _crdNorm(r.name) === _crdNorm(mem.name));
  if (!row) { row = { ...mem, entries: withEntryIds(mem.entries).map(e => ({ ...e })) }; rows.push(row); }
  row.entries = withEntryIds(row.entries);
  return row;
}

function _crdPatch(ei, fn) {
  const mem = _crdData_cur[ei], my = _crdLoadedMonth;
  if (!mem || !my) return null;
  const data = mgrLoad();
  const row = _crdStoredRow(data, my, mem);
  fn(row, mem);
  mgrSave(data);                       // instant, local, durable
  mgrAutosave('credit', _pushIfAuto);  // debounce ONLY the network push (+ "✓ Saved" flash)
  return row;
}

function _crdOpenBody(ei) {
  const body = document.getElementById('crd-body-' + ei);
  const chev = document.getElementById('crd-chev-' + ei);
  if (body) body.style.display = '';
  if (chev) chev.style.transform = 'rotate(90deg)';
}

function loadCreditMonth(my) {
  if (!my) return;
  const sameMonth = my === _crdLoadedMonth;
  // Background refreshes (sync pull/push → rebuildAll → refreshManagerPage)
  // must not rebuild the table under the cursor: it would drop focus and
  // collapse the row being typed in. Nothing is lost by skipping — every
  // keystroke is already in storage and edits patch storage by row/entry id.
  const container = document.getElementById('crd-employees');
  const ae = document.activeElement;
  if (sameMonth && container && ae && container.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

  const openKeys = new Set();
  if (sameMonth) _crdData_cur.forEach((emp, ei) => {
    const b = document.getElementById('crd-body-' + ei);
    if (b && b.style.display !== 'none') openKeys.add(rowKey(emp));
  });
  _crdLoadedMonth = my;
  _crdData_cur = _crdData(my);
  window._crdData_cur = _crdData_cur; // keep the window bridge live — it's a snapshot copy otherwise
  renderCreditLedger(_crdData_cur);
  if (openKeys.size) _crdData_cur.forEach((emp, ei) => { if (openKeys.has(rowKey(emp))) _crdOpenBody(ei); });
}

function crdEmpField(ei, field, val) {
  const v = _ni(val);
  _crdPatch(ei, (row, mem) => { row[field] = v; mem[field] = v; });
}
// Per-employee, per-month flag: when true, this row is left out of both
// the Credit "Print Summary" and "Print Detailed" reports (printCreditReport /
// printCreditSummaryReport in manager-reports.js both filter on it). Purely
// a print-time filter — the row, its balance, and its entries are untouched.
function toggleCrdPrintSkip(ei) {
  const emp = _crdData_cur[ei];
  if (!emp) return;
  const next = !emp.printSkip;
  _crdPatch(ei, (row, mem) => { row.printSkip = next; mem.printSkip = next; });
  const openBody = document.querySelector('.crd-body-row:not([style*="display: none"])');
  const openEi = openBody ? openBody.id.replace('crd-body-', '') : null;
  renderCreditLedger(_crdData_cur);
  if (openEi != null) _crdOpenBody(openEi);
}
function crdEntryChange(ei, eni, field, val) {
  const mem = _crdData_cur[ei];
  const me = mem && mem.entries[eni];
  if (!me) return;
  const v = field === 'amount' ? _ni(val) : val;
  _crdPatch(ei, row => {
    let e = row.entries.find(x => x.id === me.id);
    if (!e) { e = { ...me }; row.entries.push(e); }
    e[field] = v;
  });
  me[field] = v;
}
function recalcCrdEmp(ei) {
  const el = document.getElementById('crd-net-' + ei);
  if (!el) return;
  const net = _crdNet(_crdData_cur[ei]);
  el.textContent = '₨' + _fc2(net);
  el.style.color = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--muted)';
}
function addCrdEntry(ei) {
  const today = new Date();
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = String(today.getDate()).padStart(2,'0') + '-' + ms[today.getMonth()] + '-' + today.getFullYear();
  const entry = { id: newEntryId(), date: dateStr, desc: 'credit', amount: 0 };
  _crdPatch(ei, (row, mem) => { row.entries.push({ ...entry }); mem.entries.push(entry); });
  renderCreditLedger(_crdData_cur);
  _crdOpenBody(ei); // keep the body open after re-render
}
function deleteCrdEntry(ei, eni) {
  const mem = _crdData_cur[ei];
  const me = mem && mem.entries[eni];
  if (!me) return;
  _tomb('crde:' + me.id); // delete must travel with sync, or the union merge would resurrect it
  _crdPatch(ei, (row, m) => {
    row.entries = row.entries.filter(x => x.id !== me.id);
    m.entries.splice(eni, 1);
  });
  renderCreditLedger(_crdData_cur);
  _crdOpenBody(ei);
}
function addCreditEmployee() {
  _crdData_cur.push({ name: 'New Employee', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 });
  _crdPatch(_crdData_cur.length - 1, () => {});
  renderCreditLedger(_crdData_cur);
}
function deleteCrdEmp(ei) {
  const mem = _crdData_cur[ei];
  const my = _crdLoadedMonth;
  if (!mem || !my) return;
  if (!confirm('Remove ' + mem.name + '?')) return;
  const data = mgrLoad();
  if (Array.isArray(data.credit && data.credit[my])) {
    const stored = data.credit[my].find(r => _sameEmp(r, mem));
    if (stored) entryTombstoneKeys(stored).forEach(_tomb);
    data.credit[my] = data.credit[my].filter(r => !_sameEmp(r, mem));
    mgrSave(data);
  }
  entryTombstoneKeys(mem).forEach(_tomb);
  _tomb('crdr:' + my + '|' + rowKey(mem));
  _crdData_cur.splice(ei, 1);
  renderCreditLedger(_crdData_cur);
  mgrAutosave('credit', _pushIfAuto);
}
// "Save" button / Save All & Sync. Edits are already in storage (see above),
// so this only (a) makes sure every row of the loaded month exists in
// storage — without overwriting any stored value — and (b) pushes.
function saveCreditData(silent) {
  const my = _crdLoadedMonth || document.getElementById('crd-month-sel')?.value;
  if (!my) { if (!silent && typeof toast === 'function') toast('⚠ Select a month first', 'w'); return; }
  if (my === _crdLoadedMonth && _crdData_cur.length) {
    const data = mgrLoad();
    _crdData_cur.forEach(mem => { if (hasCreditData(mem)) _crdStoredRow(data, my, mem); });
    mgrSave(data);
  }
  if (!silent && typeof toast === 'function') toast('✓ Staff Credit saved for ' + my);
  if (!silent) { if (typeof window.pushToSupabase === 'function') window.pushToSupabase(); }
  else _pushIfAuto();
}


function copyToNextMonth() {
  const sel = document.getElementById('crd-month-sel');
  const curMy = sel.value;
  if (!curMy) { toast('⚠ Select a month first', 'w'); return; }
  if (curMy !== _crdLoadedMonth) loadCreditMonth(curMy);

  // Make sure the current month's rows are in storage first
  saveCreditData(true);
  const data = mgrLoad();
  if (!data.credit) data.credit = {};

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
      const src = _crdData_cur.find(e => _sameEmp(e, existing));
      return src ? {...existing, prevBal: _crdNet(src)} : existing;
    });
    // Add any employees present in current month but not in next
    _crdData_cur.forEach(src => {
      if (!updated.find(e => _sameEmp(e, src))) {
        updated.push({staffId: src.staffId, name: src.name, prevBal: _crdNet(src), entries: [], salary: 0, lessGeneric: 0});
      }
    });
    data.credit[nextMy] = updated;
  } else {
    // Fresh next month: copy employee list, set prevBal = net, clear entries
    data.credit[nextMy] = _crdData_cur.map(e => ({
      staffId: e.staffId,
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
  if (typeof window.pushToSupabase === 'function') window.pushToSupabase();
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
//
// `my` is optional and defaults to the real current month (unchanged
// behavior for the Staff Card). Quick Add passes an explicit month so a
// credit dated into a different month than the one currently open in the
// Credit Ledger sheet lands in the *correct* month's array instead of
// whatever happens to be loaded in memory.
function _scCreditRow(name, my) {
  my = my || currentCreditMonthYear();
  const data = mgrLoad();
  if (!data.credit) data.credit = {};
  if (!data.credit[my]) data.credit[my] = [];
  const norm = s => (s || '').trim().toLowerCase();
  let emp = data.credit[my].find(e => norm(e.name) === norm(name));
  if (!emp) {
    const st = STAFF.find(s => norm(s.name) === norm(name));
    emp = { staffId: st && st.staffId, name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 };
    data.credit[my].push(emp);
  }
  // Legacy id-less entries get their stable (derived) id BEFORE any edit, so
  // editing one can't make it look like a brand-new entry to the sync merge.
  emp.entries = withEntryIds(emp.entries);
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
  _pushIfAuto();
}

function scAddCreditEntry() {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  const today = new Date();
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  emp.entries.push({ id: newEntryId(), date: String(today.getDate()).padStart(2, '0') + '-' + ms[today.getMonth()] + '-' + today.getFullYear(), desc: '', amount: 0 });
  mgrSave(data);
  _scCreditSync(my);
  renderStaffCreditCurrent(name);
  _pushIfAuto();
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
  // Local commit above is already instant (mgrSave); debounce just the
  // network push so a multi-digit amount doesn't fire one request per digit.
  mgrAutosave('credit-sc', () => {
    _pushIfAuto();
  });
}

function scDeleteCreditEntry(eni) {
  const name = document.getElementById('sc-title-name')?.textContent;
  if (!name) return;
  const { data, my, emp } = _scCreditRow(name);
  if (emp.entries[eni]) _tomb('crde:' + emp.entries[eni].id);
  emp.entries.splice(eni, 1);
  mgrSave(data);
  _scCreditSync(my);
  renderStaffCreditCurrent(name);
  _pushIfAuto();
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
      <input type="text" class="mgr-inp" value="${_crdEsc(en.date||'')}" placeholder="Date"${act('input', 'scCreditEntryChange', eni, 'date', arg.value)}>
      <input type="text" class="mgr-inp" value="${_crdEsc(en.desc||'')}" placeholder="Description"${act('input', 'scCreditEntryChange', eni, 'desc', arg.value)}>
      <input type="number" class="mgr-inp sal-num" value="${en.amount||0}" style="font-weight:700;${_ni(en.amount)<0?'color:var(--red)':'color:var(--green)'}"${act('input', 'scCreditEntryChange', eni, 'amount', arg.value)}>
      <button class="mgr-del"${act('click', 'scDeleteCreditEntry', eni)}>🗑</button>
    </div>`).join('');
  cont.innerHTML = `
    <div class="sccc-card">
      <div class="sccc-hdr">
        <span>💳 ${my}</span>
        <span class="sccc-net" id="sccc-net" style="color:${netColor}">Net: ₨${_fc2(net)}</span>
      </div>
      <div class="sccc-fields">
        <div class="fg"><label>Previous Balance (₨)</label><input type="number" class="mgr-inp" value="${emp.prevBal||0}"${act('input', 'scCreditFieldChange', 'prevBal', arg.value)}></div>
        <div class="fg"><label>Salary Paid (₨)</label><input type="number" class="mgr-inp" value="${emp.salary||0}"${act('input', 'scCreditFieldChange', 'salary', arg.value)}></div>
        <div class="fg"><label>Less Generic (₨)</label><input type="number" class="mgr-inp" value="${emp.lessGeneric||0}"${act('input', 'scCreditFieldChange', 'lessGeneric', arg.value)}></div>
      </div>
      <div class="sccc-entries">
        ${rows || '<p class="sccc-empty">No entries yet this month.</p>'}
      </div>
      <button class="btn btn-p" style="font-size:12px;padding:7px 14px"${act('click', 'scAddCreditEntry')}>💳 ＋ Add Entry</button>
    </div>`;
}

Object.assign(window, {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
  thisMonthNetFor, renderStaffCreditCurrent, scCreditFieldChange, scAddCreditEntry,
  scCreditEntryChange, scDeleteCreditEntry, currentCreditMonthYear,
  _scCreditRow, _scCreditSync, toggleCrdPrintSkip,
});

export {
  _crdData, _crdNet, _crdData_cur, renderCreditLedger, _toggleCrdEmpBody,
  addCrdEntryFocused, loadCreditMonth, crdEmpField, crdEntryChange, recalcCrdEmp,
  deleteCrdEntry, addCreditEmployee, deleteCrdEmp, saveCreditData, copyToNextMonth,
  thisMonthNetFor, renderStaffCreditCurrent, scCreditFieldChange, scAddCreditEntry,
  scCreditEntryChange, scDeleteCreditEntry, currentCreditMonthYear,
  _scCreditRow, _scCreditSync, toggleCrdPrintSkip,
};
