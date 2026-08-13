// ══════════════════════════════════════════════════════════════════════
// APP RAIL — expand/collapse (Aug 2026 nav redesign)
//
// The rail (index.html's #app-rail, styled in css/app-nav.css) defaults
// to collapsed (icons only, 64px) every session unless the user has
// explicitly pinned it open before — that choice is remembered in
// localStorage so it's a one-time preference, not a per-load default.
// Purely a desktop concern; the mobile shell (.bnav) has no equivalent
// expand/collapse, it's just the 5 items + the ☰ Menu drawer trigger.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var KEY = 'bt_rail_expanded';

  function apply(expanded) {
    var rail = document.getElementById('app-rail');
    if (!rail) return;
    rail.classList.toggle('expanded', !!expanded);
    document.body.classList.toggle('rail-expanded', !!expanded);
    var btn = document.getElementById('rail-pin-btn');
    if (btn) {
      var ic = btn.querySelector('.rail-ic');
      var lb = btn.querySelector('.rail-lb');
      if (ic) ic.textContent = expanded ? '«' : '»';
      if (lb) lb.textContent = expanded ? 'Collapse' : 'Expand';
      btn.title = expanded ? 'Collapse navigation rail' : 'Expand navigation rail';
    }
  }

  function toggle() {
    var next = !(safeGet() === '1');
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (_) { /* private mode etc. — just won't persist */ }
    apply(next);
  }

  function safeGet() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  window.btToggleRailPin = toggle;

  document.addEventListener('DOMContentLoaded', function () {
    apply(safeGet() === '1');
  });
})();
