// NOTE: showPage, loadToolsPage, and populateTgtSel stay TRUE bare
// globals, declared outside the IIFE that wraps the rest of this file.
// ui-extras.js monkey-patches showPage directly on window
// (window.showPage = function(page){...}) to add extra behavior. This
// file itself calls showPage() internally (navigateTo(), the nav-tab
// click wiring). If showPage were IIFE-scoped, ui-extras.js's patch
// would only ever affect a window-level copy while every internal call
// here kept calling the original, unpatched version — same risk as
// auth.js's unlockApp and manager.js's loadManagerPage/switchMgrTab.
// loadToolsPage and populateTgtSel have to travel with it: showPage
// calls loadToolsPage directly, which calls populateTgtSel directly,
// and neither has any other external dependent that would otherwise
// keep it out of the IIFE.

function showPage(id) {
  try {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
    document.querySelectorAll('.ntab,.bnav-item,.bnav-sub-item').forEach(t=>t.classList.remove('active'));
    const pg = document.getElementById('page-'+id);
    if(pg) pg.classList.add('on');
    document.querySelectorAll('.ntab[data-page="'+id+'"],.bnav-item[data-page="'+id+'"],.bnav-sub-item[data-page="'+id+'"]').forEach(t=>t.classList.add('active'));
    const _saleDataPages = ['index','data','entry','report','diff'];
    const _inSaleData = _saleDataPages.indexOf(id) !== -1;
    const _subnav = document.getElementById('saledata-subnav');
    if (_subnav) _subnav.style.display = _inSaleData ? '' : 'none';
    const _bnavSub = document.getElementById('bnav-saledata-sub');
    if (_bnavSub) _bnavSub.style.display = _inSaleData ? '' : 'none';

    // ── Domain isolation (V2 plan §2) — Sales, Manager, Notes & Sheets,
    // Closing, and Audit are separate peer dashboards, not nested tabs.
    // body[data-domain] drives the CSS that hides every other domain's
    // nav tabs and re-themes the current domain's accent color (see
    // nav.css). Cover/CommandHub/Tools aren't owned by any domain, so
    // they don't set one — both stay visible from anywhere, including
    // from Cover itself, which is the only place you switch domains
    // (via its tiles) rather than by picking from a long row of
    // always-visible nav icons.
    //
    // Closing Book/Credit Ledger (native ports of the standalone
    // Closing app's own pages, live in closing-native.js), Assignments
    // (native port of Pharmacy Audit Hub's own page, live in
    // audit-native.js), and BT Inventory (native port over Pharmacy
    // Audit Hub's shared, Supabase-synced inventory, live in
    // inventory-native.js) are real embedded pages here — same as any
    // other domain, just reading through a read-only bridge
    // (closing-bridge.js / audit-bridge.js / inventory-bridge.js)
    // instead of this app's own Repository.
    const _salesDomainPages = ['dashboard'].concat(_saleDataPages);
    const _managerDomainPages = ['manager', 'manager-dashboard'];
    const _notesheetsDomainPages = ['notesheets'];
    const _closingDomainPages = ['closing-book', 'credit-ledger'];
    const _auditDomainPages = ['assignments'];
    const _inventoryDomainPages = ['inventory', 'stockledger', 'excess', 'reorder'];
    const _domain = _salesDomainPages.indexOf(id) !== -1 ? 'sales'
                  : _managerDomainPages.indexOf(id) !== -1 ? 'manager'
                  : _notesheetsDomainPages.indexOf(id) !== -1 ? 'notesheets'
                  : _closingDomainPages.indexOf(id) !== -1 ? 'closing'
                  : _auditDomainPages.indexOf(id) !== -1 ? 'audit'
                  : _inventoryDomainPages.indexOf(id) !== -1 ? 'inventory'
                  : '';
    document.body.dataset.domain = _domain;
    const _brandSub = document.getElementById('nbrand-sub-label');
    if (_brandSub) {
      _brandSub.textContent = _domain === 'sales'      ? 'Sales Dashboard'
                             : _domain === 'manager'    ? 'Manager Dashboard'
                             : _domain === 'notesheets' ? 'Notes & Sheets'
                             : _domain === 'closing'    ? 'Closing'
                             : _domain === 'audit'      ? 'Audit'
                             : _domain === 'inventory'  ? 'Inventory'
                             : 'Intelligence Centre';
    }

    if (_inSaleData) {
      document.querySelectorAll('.ntab[data-group="saledata"],.bnav-item[data-group="saledata"]').forEach(t=>t.classList.add('active'));
    }
    if (id === 'closing-book' && typeof window.clnOnShowClosingBook === 'function') window.clnOnShowClosingBook();
    if (id === 'credit-ledger' && typeof window.clnOnShowCreditLedger === 'function') window.clnOnShowCreditLedger();
    if (id === 'assignments' && typeof window.anOnShowAssignments === 'function') window.anOnShowAssignments();
    if (id === 'inventory' && typeof window.invOnShowInventory === 'function') window.invOnShowInventory();
    // Stock Ledger is fully self-contained (own Supabase panel + JSON
    // upload fallback, no dependency on this app's inventory_products
    // bridge — see index.html's comment above #page-stockledger for
    // why). init() no-ops with a console.warn if already initialized,
    // so it's safe to call on every visit rather than tracking state here.
    if (id === 'stockledger' && window.StockLedgerApp && typeof window.StockLedgerApp.init === 'function') window.StockLedgerApp.init();
    // Excess Working is downstream of Stock Ledger's own data (see
    // js/excess-working.js) — same "safe to call every visit" pattern,
    // it just re-pulls and re-renders from whatever Stock Ledger currently has.
    if (id === 'excess' && window.ExcessWorkingApp && typeof window.ExcessWorkingApp.init === 'function') window.ExcessWorkingApp.init();
    // Reorder Report is downstream of Stock Ledger's raw inventory rows
    // (see js/reorder-report.js) — same "safe to call every visit" pattern.
    if (id === 'reorder' && window.ReorderReportApp && typeof window.ReorderReportApp.init === 'function') window.ReorderReportApp.init();
    if (id==='commandhub') {
      document.querySelectorAll('.ntab[data-group="commandhub"],.bnav-item[data-group="commandhub"]').forEach(t=>t.classList.add('active'));
    }
    _curPage = id;
    // Announce navigation through EventBus so any subscriber can react
    // (closes MF-03 — _curPage was previously a silent bare `let`).
    if (typeof EventBus !== 'undefined') EventBus.notify('nav:changed', { page: id });
    // ── URL hash routing ── keep the address bar in sync with the page
    // (#manager, #dashboard, ...) so links can be bookmarked, shared, or
    // opened in a second browser tab. replaceState (not location.hash=)
    // is used so this never itself fires a 'hashchange' event — only a
    // real link click / typed URL / back-forward navigation should.
    try {
      const _newHash = '#' + id;
      if (window.location.hash !== _newHash) history.replaceState(null, '', _newHash);
    } catch(_) {}
    if(id==='cover') { if(typeof renderCoverDashboard==='function') renderCoverDashboard(); }
    if(id==='notesheets') { if(typeof renderNotesSheets==='function') renderNotesSheets(); }
    if(id==='commandhub') { if(typeof loadCommandHubPage==='function') loadCommandHubPage(); }
    if(id==='tools') { loadToolsPage(); }
    if(id==='manager') { loadManagerPage(); }
    if(id==='manager-dashboard') { if (typeof buildDashboard === 'function') buildDashboard(); }
    if(id==='report') { dsInit(); }
    if(id==='diff')   { renderDiffReport(); }
    if(id==='entry') { autoFillEntryDate(); }
    if(id==='index') {
      const k = _rcKey('index');
      if (_rc.index && _rc.index.key === k) {
        document.getElementById('idx-container').innerHTML = _rc.index.html;
      } else {
        renderIndex();
      }
    }
    if(id==='data') {
      const k = _rcKey('data');
      if (_rc.data && _rc.data.key === k) {
        const old = document.getElementById('tbl-daily');
        if (old) { const d = document.createElement('div'); d.id='tbl-daily'; d.innerHTML = _rc.data.html; old.replaceWith(d); }
      } else {
        renderDataTable();
      }
    }
  } catch(err) {
    if (typeof toast === 'function') toast('\u26a0 Page error: ' + err.message, 'e');
    console.error('[showPage] error for page "' + id + '":', err);
  }
}

function loadToolsPage() {
  _populatePrintSelectors();
  _tcLoadGAuthStatus();
  // Supabase sync badge
  updateGhBadge();
  // Auto-sync checkboxes
  const al=document.getElementById('auto-load'); if(al) al.checked=Repository.getItem('bt_auto_load')==='1';
  const as=document.getElementById('auto-save'); if(as) as.checked=Repository.getItem('bt_auto_save')==='1';
  // Targets
  populateTgtSel(); renderTargetList();
  // Summary
  const ds=document.getElementById('data-summary');
  if(ds) ds.innerHTML=`
    <div><strong>Total months:</strong> ${MONTHLY.length}</div>
    <div><strong>Daily records:</strong> ${DAILY.filter(d=>n(d.TOTAL)>0).length}</div>
    <div><strong>Years covered:</strong> ${years().join(', ')}</div>
    <div><strong>Cumulative total:</strong> ₨${fc(MONTHLY.reduce((s,m)=>s+n(m.TOTAL),0))}</div>
    <div><strong>Session entries:</strong> ${Repository.getPendingEntries().length}</div>
    <div><strong>Sync:</strong> Supabase (real-time)</div>`;
}

function populateTgtSel() {
  const sel=document.getElementById('tgt-sel'); if(!sel) return;
  sel.innerHTML='<option value="">Select month…</option>'+[...MONTHLY].reverse().map(m=>`<option value="${m.Month_Year}">${m.Month_Year}</option>`).join('');
}

(function() {
'use strict';

// ── Safe guard: updateGhBadge may be called before supabase.js loads ──
// ui.js and manager.js both reference updateGhBadge(); supabase.js defines it.
// Since ui.js loads first, we define a no-op placeholder here that supabase.js
// will overwrite with the real implementation when it loads.
if (typeof updateGhBadge === 'undefined') {
  window.updateGhBadge = function() {
    // Will be replaced by the real function in supabase.js once it loads.
    // Safe to call before supabase.js is ready — just does nothing.
  };
}

// navigateTo() — alias for showPage(). Some UI snippets (e.g. dashboard's
// JazzCash "LIVE" badge) call navigateTo() instead of showPage(); previously
// this function didn't exist anywhere, so that badge silently did nothing.
function navigateTo(pageId) {
  if (typeof showPage === 'function') showPage(pageId);
}


// Registry: pageId -> function(subPath) that switches to a sub-section
// within that page once it's loaded. Add an entry here for any future
// page that has its own internal tabs and should support deep-linking.
const _PAGE_SUBROUTES = {
  manager: function(sub) {
    if (typeof switchMgrTab === 'function') switchMgrTab(sub);
  },
  'credit-ledger': function(sub) {
    if (typeof clnSwitchMode === 'function') clnSwitchMode(sub);
  },
  tools: function(sub) {
    // Sync Center is a collapsible card inside Tools; its own tabs
    // (session/devices/controls/health) are a sub-sub-route:
    // #tools/synccenter/<tab>
    const parts = sub.split('/');
    if (parts[0] !== 'synccenter') return;
    const card = document.getElementById('tc-sync-center');
    if (card && !card.classList.contains('open')) card.classList.add('open');
    if (parts[1] && typeof scSwitchTab === 'function') scSwitchTab(parts[1]);
  }
};

// Nav items (.ntab, .bnav-item, .bnav-sub-item, .mgr-tab, .cl-mode-tab,
// .sc-tab) are real <a href="#..."> links now, not JS-only buttons — the
// browser drives navigation via the hash, and _routeFromHash (below)
// reacts to it. This is what makes Ctrl/Cmd/middle-click → "open in new
// tab" work: the browser opens a fresh tab at that hash without touching
// the current tab at all.
function _routeFromHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (!raw) return false;
  const slash = raw.indexOf('/');
  const page = slash === -1 ? raw : raw.slice(0, slash);
  const sub  = slash === -1 ? '' : raw.slice(slash + 1);
  if (!page || !document.getElementById('page-' + page)) return false;
  const _already = (typeof _curPage !== 'undefined' && _curPage === page);
  const _route = _PAGE_SUBROUTES[page];
  if (!_already) {
    showPage(page);
    if (sub && _route) {
      // Sub-sections only exist in the DOM once the page's own load
      // function — triggered by showPage() above — has rendered them,
      // so give it a tick before switching to the sub-tab.
      setTimeout(() => _route(sub), 30);
    }
  } else if (sub && _route) {
    // Already on this page — just switch sub-tabs, don't re-run the
    // page's load function (that would reset dropdowns/selections).
    _route(sub);
  }
  return true;
}
window._routeFromHash = _routeFromHash;
window.addEventListener('hashchange', () => _routeFromHash(window.location.hash));

// Handle ?page= shortcuts from PWA manifest (survives OAuth redirect via sessionStorage)
(function() {
  const p = new URLSearchParams(window.location.search).get('page');
  if (!p) return;
  try { sessionStorage.setItem('bt_nav_target', p); } catch (_) {}
  history.replaceState(null, '', window.location.pathname);
})();

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
let _tTimer;
function toast(msg, type='') {
  clearTimeout(_tTimer);
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='on'+(type?' '+type:'');
  _tTimer=setTimeout(()=>el.className='',2800);
}

// ══════════════════════════════════════════
// CLOCK
// ══════════════════════════════════════════
function tickClock() {
  const el=document.getElementById('clock');
  if(el) el.textContent=new Date().toLocaleString('en-PK',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
setInterval(tickClock,30000); tickClock();

// ══════════════════════════════════════════
// SUPABASE SYNC
// ══════════════════════════════════════════

function rebuildDropdowns() {
  const yrs=years();
  ['dash-year','idx-year'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel) return;
    const val=sel.value;
    sel.innerHTML='<option value="">All Years</option>'+yrs.map(y=>`<option value="${y}">${y}</option>`).join('');
    sel.value=val;
  });
  const mons=[...months()].reverse();
  const dm=document.getElementById('data-month');
  if(dm){ const v=dm.value; dm.innerHTML='<option value="">All Months</option>'+mons.map(m=>`<option value="${m}">${m}</option>`).join(''); dm.value=v; }
  const em=document.getElementById('e-month');
  if(em){ const v=em.value; em.innerHTML='<option value="">Select…</option>'+mons.map(m=>`<option value="${m}">${m}</option>`).join(''); em.value=v; }
}

// ══════════════════════════════════════════
// REBUILD ALL
// ══════════════════════════════════════════
function rebuildAll() {
  try {
    normalizeDates();
    recomputeAllMonths(); // always re-derive MONTHLY from DAILY so dashboard & popups match Daily Data
    invalidateRenderCache();
    rebuildDropdowns();
    buildDashboard();
    if(_curPage==='index') renderIndex();
    if(_curPage==='data') renderDataTable();
    buildDateList();
    // If report tab is open and a date was already selected, re-render so fresh data shows
    if(_curPage==='report' && _selDate && _selMy) renderReport();
    if(_curPage==='diff') renderDiffReport();
  } catch(err) {
    if (typeof toast === 'function') toast('\u26a0 Rebuild error: ' + err.message, 'e');
    console.error('[rebuildAll] error:', err);
  }
}


// ══════════════════════════════════════════
// TOOLS PAGE
// ══════════════════════════════════════════


function addNewMonth() {
  const mon=document.getElementById('nm-sel').value;
  const yr=document.getElementById('nm-year').value;
  const key=mon+' '+yr;
  if(Repository.getMonthlyEntry(key)){ toast('⚠ '+key+' already exists','w'); return; }
  const blank={Month_Year:key,TOTAL:0,Customers:0};
  Actions.addOrUpdateMonth(blank);
  const stored=JSON.parse(Repository.getItem('bt_new_months')||'[]');
  stored.push(blank); Actions.saveFeatureData('bt_new_months',JSON.stringify(stored));
  rebuildAll(); toast('✓ '+key+' created');
}

// ══════════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════════
function exportCSV(type) {
  const data=type==='monthly'?MONTHLY:DAILY; if(!data.length) return;
  const keys=Object.keys(data[0]);
  const csv=[keys.join(','),...data.map(r=>keys.map(k=>{ const v=r[k]; if(v==null)return ''; if(typeof v==='string'&&(v.includes(',')||v.includes('"')))return '"'+v.replace(/"/g,'""')+'"'; return v; }).join(','))].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download='BT_'+type+'_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); toast('✓ CSV downloaded');
}

function exportJSON() {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify({monthly:MONTHLY,daily:DAILY,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}));
  a.download='BT_backup_'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); toast('✓ JSON exported');
}

function importJSON(e) {
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=ev=>{ try{
    const data=JSON.parse(ev.target.result);
    if(data.monthly) data.monthly.forEach(m=>{ if(!Repository.getMonthlyEntry(m.Month_Year)) Actions.addOrUpdateMonth(m); });
    if(data.daily)   data.daily.forEach(d=>{ if(!Repository.getDailyEntry(d.Date, d.Month_Year)) Actions.addDailyEntry(d); });
    rebuildAll(); toast('✓ Imported');
  }catch(err){toast('✕ Invalid file','e');}};
  r.readAsText(file); e.target.value='';
}

// ══════════════════════════════════════════
// DROPDOWNS  (called on rebuild)
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// DESKTOP / MOBILE VIEW TOGGLE
// ══════════════════════════════════════════
function _applyViewModeBtn(mode) {
  const btn = document.getElementById('view-mode-btn');
  if (!btn) return;
  if (mode === 'desktop') {
    btn.textContent = '📱 Mobile View';
    btn.style.background = '#2563eb'; btn.style.color = '#fff'; btn.style.border = 'none';
  } else {
    btn.textContent = '🖥️ Desktop View';
    btn.style.background = 'var(--s2)'; btn.style.color = 'var(--text)'; btn.style.border = '1px solid var(--border)';
  }
}

function toggleViewMode() {
  const cur = Repository.getItem('bt_view_mode') || 'mobile';
  const next = cur === 'desktop' ? 'mobile' : 'desktop';
  Actions.saveFeatureData('bt_view_mode', next);
  // Viewport meta changes only take effect on reload — save & reload
  window.location.reload();
}

// Init button label on page load to reflect current saved mode
(function() {
  // Always defer/module now — see note in auth.js. readyState is never
  // 'loading' here anymore. Also: the Repository.getItem call itself
  // must be inside the deferred callback too, not just the DOM update —
  // ui.js loads BEFORE repository.js in the document, so calling
  // Repository immediately here (even just to compute `mode`) throws
  // "Repository is not defined". Only code that runs after
  // DOMContentLoaded is guaranteed Repository/Actions are ready.
  document.addEventListener('DOMContentLoaded', () => {
    const mode = Repository.getItem('bt_view_mode') || 'mobile';
    _applyViewModeBtn(mode);
  });
})();

// Bridge what's used externally or from index.html. showPage/
// loadToolsPage/populateTgtSel are NOT here — they stay bare globals
// declared before this IIFE (see note above).
window.navigateTo = navigateTo;
window.rebuildDropdowns = rebuildDropdowns;
window.rebuildAll = rebuildAll;
window.addNewMonth = addNewMonth;
window.exportCSV = exportCSV;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.toast = toast;

})();
