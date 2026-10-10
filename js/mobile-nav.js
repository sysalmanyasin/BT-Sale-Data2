// ══════════════════════════════════════════════════════════════════════
// MOBILE BOTTOM NAV  —  Home · AI Copilot · Alerts · More  (<= 860px only)
//
// Presentation glue only. It owns no business data:
//   • Active tab comes from the URL hash (the app's existing router).
//   • The Alerts badge comes from the 'bt:alerts-count' event that
//     js/ai-center/ui.js publishes from REAL findings + pending approvals.
//     Until a real read has finished the badge stays hidden (no guessing).
//   • "More" is the existing All Sections drawer (openSectionsDrawer).
//   • Keyboard: when the on-screen keyboard opens the bar is hidden so it
//     never covers the field or sits on top of the keyboard.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var bar = document.getElementById('bnav');
  if (!bar) return;

  function current() {
    var h = window.location.hash || '';
    if (/^#ai-center\/copilot/.test(h)) return 'copilot';
    if (/^#ai-center\/alerts/.test(h)) return 'alerts';
    if (/^#ai-center/.test(h)) return 'home';
    if (h === '' || /^#cover/.test(h)) return 'home';
    return 'more'; // every other section lives under More
  }
  function paint() {
    var cur = current();
    bar.querySelectorAll('[data-nav]').forEach(function (el) {
      var on = el.getAttribute('data-nav') === cur;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }
  // showPage() clears .active on every .bnav-item; re-apply after it runs.
  window.addEventListener('hashchange', function () { setTimeout(paint, 0); });
  var orig = window.showPage;
  if (typeof orig === 'function' && !orig.__btMobileNav) {
    var wrapped = function () { var r = orig.apply(this, arguments); paint(); return r; };
    wrapped.__btMobileNav = true; window.showPage = wrapped;
  }

  window.addEventListener('bt:alerts-count', function (e) {
    var d = (e && e.detail) || {}, a = bar.querySelector('[data-nav="alerts"]'), b = a && a.querySelector('.bbadge');
    if (!b) return;
    var n = typeof d.count === 'number' ? d.count : 0;
    b.hidden = !(n > 0); b.textContent = n > 9 ? '9+' : String(n);
    a.setAttribute('aria-label', n > 0 ? 'Alerts: ' + n + ' need action' : 'Alerts');
  });

  // Software keyboard: interactive-widget=resizes-content (index.html) already shrinks the layout on Android Chrome;
  // this adds the nav-hiding behaviour and covers browsers that only resize the visual viewport.
  var vv = window.visualViewport;
  function kb() {
    if (!vv) return;
    var open = (window.innerHeight - vv.height) > 140 && /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
    document.body.classList.toggle('kb-open', open);
    document.documentElement.style.setProperty('--vv-h', Math.round(vv.height) + 'px');
  }
  if (vv) { vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); }
  document.addEventListener('focusin', function () { setTimeout(kb, 120); });
  document.addEventListener('focusout', function () { setTimeout(kb, 120); });

  paint();
})();
