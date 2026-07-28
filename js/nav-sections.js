// ══════════════════════════════════════════════════════════════════════
// ALL SECTIONS DRAWER  —  long-press Cover (bottom nav) OR the permanent
// ☰ button pinned to the left edge (see index.html/css/nav.css) opens a
// full directory of every section + sub-section, as opposed to
// js/nav-recents.js's drawer which only shows what's actually been
// visited. Complements the bottom tab bar + back button + recents
// drawer combo already in place.
//
// Content is read straight from the DOM every time it opens (bnav-items
// for top-level sections, plus the three known sub-tab groups: Sale
// Data's secondary row, Manager's mgr-tabs, Credit Ledger's mode tabs)
// so it can never drift out of sync with the real nav — no hardcoded
// duplicate list to maintain.
//
// Ordering: top-level rows mirror whatever order the user last dragged
// Cover's own dashboard groups into (js/cover-dashboard.js's ⠿ handles),
// via each bnav-item's existing data-domain-group attribute (already
// used by nav.css's domain-isolation rules) mapped onto Cover's group
// slugs — see _DOMAIN_TO_COVER_SLUG below. "Cover" itself always stays
// pinned first (it's the hub the drawer opens from, not a domain).
// Sub-section rows (the three groups above) are always listed in their
// fixed, original order — they're never reordered, per request.
//
// Every row just sets window.location.hash, reusing ui.js's existing
// hashchange -> _routeFromHash -> showPage routing (including its
// sub-route handling for #manager/xxx and #credit-ledger/xxx) instead
// of calling showPage()/switchMgrTab() directly — that's also what
// gives every tap here a real, back-able history entry for free.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const LONG_PRESS_MS = 500;
  // parent top-level page id -> selector for its sub-tab elements
  const _SUB_GROUPS = {
    index: '.bnav-sub-item[data-page]',
    manager: '.mgr-tab[href]',
    'credit-ledger': '.cl-mode-tab[href]',
  };
  // bnav-item's data-domain-group value -> Cover dashboard's GROUP_META
  // slug (js/cover-dashboard.js). Identical strings except notesheets/notes.
  const _DOMAIN_TO_COVER_SLUG = { sales: 'sales', manager: 'manager', notesheets: 'notes', closing: 'closing', audit: 'audit', inventory: 'inventory' };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Pages that used to live in #bnav and now live as Cover tiles instead
  // (Manager <-> Notes & Sheets "Quick Access" group) — the bnav scan
  // below can't find them anymore, so they're added back in explicitly.
  const _MOVED_TO_COVER = [
    { id: 'pdf-library',  label: 'PDF Library', icon: '📚' },
  ];

  function _buildGroups() {
    const groups = [];
    document.querySelectorAll('#bnav > .bnav-item[data-page]').forEach(el => {
      const id = el.dataset.page;
      if (id === 'recents' || !document.getElementById('page-' + id)) return;
      groups.push({
        id: id,
        label: (el.querySelector('.blabel') || {}).textContent || id,
        icon: (el.querySelector('.bicon') || {}).textContent || '📄',
        href: el.getAttribute('href'),
        domainGroup: el.dataset.domainGroup || null,
        subs: [],
      });
    });
    _MOVED_TO_COVER.forEach(m => {
      if (!document.getElementById('page-' + m.id)) return;
      groups.push({ id: m.id, label: m.label, icon: m.icon, href: '#' + m.id, domainGroup: null, subs: [] });
    });
    Object.keys(_SUB_GROUPS).forEach(parentId => {
      const g = groups.find(x => x.id === parentId);
      if (!g) return;
      const seen = new Set();
      document.querySelectorAll(_SUB_GROUPS[parentId]).forEach(el => {
        const href = el.getAttribute('href');
        const label = (el.textContent || '').trim();
        if (!href || !label || seen.has(href)) return;
        seen.add(href);
        g.subs.push({ label: label, href: href });
      });
    });

    // Mirror Cover's own drag-reordered sequence. Array.prototype.sort is
    // spec-stable (ES2019+), so groups sharing a sort key (e.g. every
    // Inventory sub-page, or every group with no domain-group at all)
    // keep their original mutual order — only whole domain clusters move.
    const coverOrder = (typeof window.btGetCoverOrder === 'function') ? window.btGetCoverOrder() : [];
    const orderIndex = slug => { const i = coverOrder.indexOf(slug); return i === -1 ? null : i; };
    groups.forEach((g, i) => {
      if (g.id === 'cover') { g._sortKey = -1; return; } // hub, always first
      const coverSlug = g.domainGroup ? _DOMAIN_TO_COVER_SLUG[g.domainGroup] : null;
      const idx = coverSlug ? orderIndex(coverSlug) : null;
      g._sortKey = idx != null ? idx : 1000 + i; // unmapped/unknown -> keep at the end, original order
    });
    groups.sort((a, b) => a._sortKey - b._sortKey);
    return groups;
  }

  function _render() {
    const list = document.getElementById('sections-list');
    if (!list) return;
    const groups = _buildGroups();
    list.innerHTML = groups.map(g => `
      <div class="sections-group">
        <div class="sections-row sections-row-main" onclick="location.hash='${_esc(g.href)}';closeSectionsDrawer();">
          <span class="recents-icon">${_esc(g.icon)}</span>
          <span class="recents-label">${_esc(g.label)}</span>
        </div>
        ${g.subs.map(s => `
          <div class="sections-row sections-row-sub" onclick="location.hash='${_esc(s.href)}';closeSectionsDrawer();">
            <span class="sections-sub-label">${_esc(s.label)}</span>
          </div>`).join('')}
      </div>`).join('');
  }

  function openSectionsDrawer() {
    _render();
    const bg = document.getElementById('sectionsbg');
    if (bg) bg.classList.add('on');
  }

  function closeSectionsDrawer() {
    const bg = document.getElementById('sectionsbg');
    if (bg) bg.classList.remove('on');
  }

  // ── long-press detection on the Cover nav item ─────────────────────
  // Tap on Cover still navigates normally (the <a href="#cover"> is
  // untouched); only a press held past LONG_PRESS_MS opens this drawer
  // instead, and the synthetic click that follows on touch devices is
  // suppressed so it doesn't also navigate to Cover underneath.
  function _wireLongPress() {
    const el = document.querySelector('.bnav-item[data-page="cover"]');
    if (!el) return;
    let timer = null;
    let fired = false;

    const start = () => {
      fired = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        fired = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
        openSectionsDrawer();
      }, LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(timer);
    const click = (e) => {
      if (fired) { e.preventDefault(); fired = false; }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchmove', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
    el.addEventListener('click', click);
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // mobile long-press-to-menu guard
  }
  _wireLongPress();

  window.openSectionsDrawer = openSectionsDrawer;
  window.closeSectionsDrawer = closeSectionsDrawer;

})();
