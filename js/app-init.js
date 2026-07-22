// ══════════════════════════════════════════════════════════════════════
// APP INIT  (ES module)
//
// The whole app's bootstrap sequence: restore any pending offline
// entries, wire the Floor 3→5 EventBus subscribers, route to the
// right page from the URL hash / saved nav target, and do the first
// render. Called once from auth.js after a successful sign-in.
//
// THIS USED TO LIVE INSIDE manager.js, bottom of the file, with no
// connection to the Manager domain at all — a naming/scope mismatch
// left over from however the file grew over time. Pulled out into its
// own file as part of the manager.js module-split; nothing about its
// behavior changed, just its location and the fact that it's a real
// module now (nothing monkey-patches `initApp` itself, unlike
// loadManagerPage/switchMgrTab — see manager-page.js's header comment
// for that distinction).
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { EventBus } from './event-bus.js';

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
  let _routed = false;
  try {
    const rawHash = window.location.hash || '';
    if (rawHash && typeof window._routeFromHash === 'function') {
      // Delegates to the same registry ui.js's hashchange listener uses,
      // so a fresh tab opened at e.g. #manager/credit or
      // #tools/synccenter/health lands directly on that sub-section too.
      _routed = window._routeFromHash(rawHash);
    }
    if (!_routed) {
      // Fall back to the ?page= → sessionStorage handoff (e.g. PWA
      // shortcuts, post-OAuth redirect) only if the hash didn't resolve.
      const saved = sessionStorage.getItem('bt_nav_target');
      if (saved && document.getElementById('page-' + saved)) target = saved;
    }
    sessionStorage.removeItem('bt_nav_target');
  } catch (_) {}
  if (!_routed) showPage(target);
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

window.initApp = initApp;
export { initApp };
