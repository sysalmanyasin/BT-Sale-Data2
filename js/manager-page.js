// ══════════════════════════════════════════════════════════════════════
// MANAGER — PAGE SHELL
//
// Split out of the old manager.js monolith, along with manager-shared/
// -staff/-salary/-generic/-credit/-unmatched/-reports/-petty/-incentive.
// This file is what's left: tab switching, the page-load orchestrator,
// and the two "save/populate everything" cross-cutting functions that
// call into every sub-tab.
//
// UNTANGLED (previously the reason this file, jazz-cash.js, and
// notes-sheets.js all had to stay classic scripts): jazz-cash.js used
// to monkey-patch loadManagerPage, and notes-sheets.js used to
// monkey-patch switchMgrTab, both relying on sloppy-mode global-
// function semantics that only classic scripts have. Both patches are
// gone now — this file calls renderJazzCash()/renderNotesSheets()
// directly instead (guarded with `typeof X === 'function'`, same
// pattern already used below for renderLedgerView/
// renderOtherSectionsManager, since jazz-cash.js/notes-sheets.js don't
// export real ES bindings yet).
//
// Module-migration: with the untangling above done, this file — and
// jazz-cash.js and notes-sheets.js — are now converted to real ES
// modules, in the same pass. Repository is a real import below (was
// already called unconditionally, no `typeof` guard, so this is a
// pure correctness upgrade). switchMgrTab/loadManagerPage/
// saveAllManagerSections/populateDashWorking are called as bare
// identifiers from 9 other files (ai-bridge.js, ai-context-ui.js,
// commandhub.js/commandhub-page.js, dashboard.js, hub-actions.js,
// jazz-cash.js, notes-sheets.js, quick-add.js, ui.js) and once from an
// inline onclick in index.html — all still classic scripts/HTML, so
// all four get an explicit `window.X = X` bridge below (previously
// implicit, since classic-script top-level functions attach to
// `window` automatically; a module's don't). staffLoad has zero
// outside callers (checked via grep) so it's left unbridged.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';

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
  if (tab === 'sheets' && typeof renderNotesSheets === 'function') renderNotesSheets();
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
  if (typeof renderJazzCash === 'function') renderJazzCash();
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

// ── Window bridge ────────────────────────────────────────────────
// See header comment for exactly who calls each of these as a bare
// identifier and why they need this now that top-level function
// declarations are module-scoped instead of implicitly global.
window.switchMgrTab = switchMgrTab;
window.loadManagerPage = loadManagerPage;
window.saveAllManagerSections = saveAllManagerSections;
window.populateDashWorking = populateDashWorking;
