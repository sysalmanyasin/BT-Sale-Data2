// ══════════════════════════════════════════════════════════════════════
// MANAGER — PAGE SHELL  (classic script — deliberately NOT an ES module)
//
// Split out of the old manager.js monolith, along with manager-shared/
// -staff/-salary/-generic/-credit/-unmatched/-reports/-petty/-incentive.
// This file is what's left: tab switching, the page-load orchestrator,
// and the two "save/populate everything" cross-cutting functions that
// call into every sub-tab.
//
// WHY THIS STAYS CLASSIC, NOT A MODULE: switchMgrTab and loadManagerPage
// are monkey-patched by three other still-classic files — jazz-cash.js
// and custom-sections.js both reassign loadManagerPage (jazz-cash.js
// captures the original first, then wraps it to also call
// renderJazzCash()); notes-sheets.js reassigns switchMgrTab the same
// way. That patching relies on sloppy-mode global-function semantics:
// `window.loadManagerPage = wrapped` and the bare identifier
// `loadManagerPage` are literally the same binding in a classic script's
// global scope, so every caller — including calls made from *inside*
// this file — automatically picks up the patched version.
//
// An ES module does NOT have that property: a module's top-level
// `function loadManagerPage(){}` is scoped to the module, not to
// `window`. If this were a module, the three sibling files' patches
// would only ever update a `window.loadManagerPage` *copy* — any call
// to the bare `loadManagerPage()` identifier from inside this file (or
// any other classic script) would keep calling the original, unpatched
// version, silently breaking Jazz Cash's and Notes-Sheets' hook. staffLoad
// travels with them for the same reason (loadManagerPage calls it
// directly). Revisit this once jazz-cash.js/custom-sections.js/
// notes-sheets.js are themselves migrated to modules that import
// loadManagerPage directly instead of patching a global.
// ══════════════════════════════════════════════════════════════════════

function switchMgrTab(tab) {
  document.querySelectorAll('.mgr-tab').forEach(b => b.classList.toggle('active', b.dataset.mtab === tab));
  document.querySelectorAll('.mgr-section').forEach(s => s.style.display = 'none');
  const sec = document.getElementById('mgr-' + tab);
  if (sec) sec.style.display = '';
  // Keep the address bar as #manager/<tab> so a Manager sub-section can be
  // bookmarked or opened directly in a new tab, same as top-level pages.
  try {
    const _newHash = '#manager/' + tab;
    if (window.location.hash !== _newHash) history.replaceState(null, '', _newHash);
  } catch(_) {}
  if (tab === 'staff') renderStaffRegistry();
  if (tab === 'jazzcash' && typeof renderJazzCash === 'function') renderJazzCash();
  if (tab === 'expense' && typeof renderLedgerView === 'function') {
    renderLedgerView('ledger-expense-container', 'expense', 'Expense');
  }
  if (tab === 'custom' && typeof renderOtherSectionsManager === 'function') {
    renderOtherSectionsManager('ledger-sections-container');
  }
  if (tab === 'unmatched') renderUnmatchedTab();
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
