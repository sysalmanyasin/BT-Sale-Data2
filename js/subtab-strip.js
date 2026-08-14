// ══════════════════════════════════════════════════════════════════════
// SUB-TAB STRIP — persistent, always-visible strip of the current
// domain's sub-sections, pinned directly above the bottom nav bar
// (mobile only — desktop already has this via the always-expanded rail's
// own accordion, see js/app-nav.js).
//
// Covers Sales, Manager, Inventory, Closing — the 4 domains with more
// than one sub-section — reusing the exact same domain->kids tree
// js/nav-sections.js already builds for the Search & All Sections
// drawer, so there's exactly one source of truth for "what are this
// domain's sub-sections," not a second hand-maintained list.
//
// Replaces the Manager page's old inline CREDIT DETAIL / WORKING pill-
// button clusters (#mgr-tabs, now display:none in css/manager.css but
// still in the DOM — js/nav-sections.js's '.mgr-tab[href]' scraper, and
// therefore this strip too, both still read them there).
//
// Renders on document.body.dataset.domain (set by showPage() in ui.js)
// rather than re-deriving page->domain mapping a second time — that
// dataset attribute is already the single, already-tested source for
// exactly this question. Called explicitly from the end of showPage()
// and on every 'hashchange' (Manager's own in-page tab switches and
// Credit Ledger's mode tabs change the hash without calling showPage()
// again).
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const _WANTED_DOMAINS = { sales: 1, manager: 1, inventory: 1, closing: 1 };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Closing's own top-level kids are just [Closing Book, Credit Ledger]
  // — but Credit Ledger has its own nested kids (Credit / Misc-Ongoing
  // mode tabs, scraped from .cl-mode-tab[href]). If the current hash
  // matches one of THOSE inner kids specifically, show that deeper level
  // instead of the shallow 2-item umbrella — same one-level-deep check
  // would also cover Tools' nested Sync Center group if Tools is ever
  // added to _WANTED_DOMAINS later.
  function _resolveKids(group, hash) {
    for (const k of group.kids) {
      if (k && Array.isArray(k.kids) && k.kids.length && k.kids.some(kk => kk && kk.href === hash)) {
        return k.kids;
      }
    }
    return group.kids;
  }

  function render() {
    const strip = document.getElementById('dynamic-subtab-strip');
    if (!strip) return;

    const domain = document.body.dataset.domain || '';
    if (!_WANTED_DOMAINS[domain]) { _hide(strip); return; }

    const tree = (window.BTNavSections && typeof window.BTNavSections.getTree === 'function')
      ? window.BTNavSections.getTree() : [];
    const group = Array.isArray(tree) ? tree.find(g => g && g._domainGroup === domain) : null;
    if (!group || !Array.isArray(group.kids) || group.kids.length < 2) { _hide(strip); return; }

    const hash = window.location.hash || '';
    const kids = _resolveKids(group, hash);
    if (!kids.length) { _hide(strip); return; }

    strip.innerHTML = kids.map(k => {
      if (!k || !k.href) return '';
      const active = k.href === hash ? ' active' : '';
      const icon = k.icon ? _esc(k.icon) + ' ' : '';
      return '<a class="bnav-sub-item' + active + '" href="' + _esc(k.href) + '">' + icon + _esc(k.label) + '</a>';
    }).join('');
    strip.style.display = '';
    document.body.classList.add('has-bnav-sub');

    const activeEl = strip.querySelector('.active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }

  function _hide(strip) {
    strip.innerHTML = '';
    strip.style.display = 'none';
    document.body.classList.remove('has-bnav-sub');
  }

  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', function () {
    // A tick after DOMContentLoaded, same defensive delay pattern used
    // elsewhere in this app (ui.js's own sub-route dispatch) — gives
    // showPage()'s very first call (which sets body.dataset.domain) a
    // moment to have actually run.
    setTimeout(render, 60);
  });

  window.BTSubtabStrip = { render: render };
})();
