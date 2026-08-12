// ══════════════════════════════════════════════════════════════════════
// STATUS BAR — slim, persistent readout sticky just under the top nav,
// visible on every page (not just Cover / Manager Dashboard).
//
// Shows the same two figures Cover's own hero cards already surface —
// Total Outstanding Credit and Today's live POS Sale — via the exact
// same helpers cover-dashboard.js exposes on window
// (_totalOutstandingCredits / _todaySaleBreakdown), so this bar can
// never disagree with the detail underneath it on Cover / Manager
// Dashboard. No second derivation of either figure lives here.
//
// Refresh points:
//  - once right after unlock, once data finishes its first load
//    (both wired from auth.js's unlockApp())
//  - every 30s while the tab is open (covers Ledger writes, which don't
//    fire an EventBus event today — see app-init.js's own comment on
//    that gap)
//  - on every hash change (page switch), so it's never stale when you
//    land back on Manager Dashboard right after editing something
// Classic script (not a module) — loaded after cover-dashboard.js, but
// only ever touches window.* + the DOM, so load order relative to the
// module scripts doesn't matter as long as it runs after DOMContentLoaded,
// which showStatusBar()/refreshStatusBar() always do (only ever called
// from unlockApp(), which itself only runs after auth's DOMContentLoaded
// listener fires).
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function refreshStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar || bar.style.display === 'none') return;

    try {
      const fn = window._totalOutstandingCredits;
      const credits = typeof fn === 'function' ? fn() : null;
      const el = document.getElementById('sb-credit-val');
      if (el) el.textContent = credits && credits.value ? credits.value : '—';
    } catch (e) {}

    try {
      const fn = window._todaySaleBreakdown;
      const sale = typeof fn === 'function' ? fn() : null;
      const valEl = document.getElementById('sb-sale-val');
      const lblEl = document.getElementById('sb-sale-label');
      if (valEl) valEl.textContent = sale && sale.value ? sale.value : '—';
      // _todaySaleBreakdown() relabels itself "Latest POS Sale" once the
      // most recent synced record isn't actually today's — mirror that
      // here so the pill never claims "Today's Sale" for stale data.
      if (lblEl) lblEl.textContent = (sale && /^Latest POS Sale/.test(sale.label || '')) ? 'Latest Sale' : "Today's Sale";
    } catch (e) {}

    const stamp = document.getElementById('sb-updated');
    if (stamp) stamp.textContent = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }

  function showStatusBar() {
    const bar = document.getElementById('status-bar');
    if (bar) bar.style.display = 'flex';
    refreshStatusBar();
  }

  function hideStatusBar() {
    const bar = document.getElementById('status-bar');
    if (bar) bar.style.display = 'none';
  }

  window.refreshStatusBar = refreshStatusBar;
  window.showStatusBar = showStatusBar;
  window.hideStatusBar = hideStatusBar;

  window.addEventListener('hashchange', refreshStatusBar);
  setInterval(refreshStatusBar, 30000);
})();
