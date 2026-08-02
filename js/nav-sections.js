// ══════════════════════════════════════════════════════════════════════
// ALL SECTIONS DRAWER  —  long-press Cover (bottom nav) OR the permanent
// ☰ "Menu" item pinned as the left-most entry of the bottom nav bar
// (see index.html/css/nav.css) opens a full directory of every section
// + sub-section, as opposed to js/nav-recents.js's drawer which only
// shows what's actually been visited. Complements the bottom tab bar +
// back button + recents drawer combo already in place.
//
// Every group renders collapsed by default each time the drawer opens;
// tapping a group's ▸ chevron expands/collapses just that group, while
// tapping the label/icon (when the row has a real page behind it) still
// navigates straight there, same as before.
//
// Rows can now nest arbitrarily deep (July 2026 re-org): a group can
// contain another group, which can contain another group, and so on
// (e.g. Closing > Credit Ledger > Credit/Misc-Ongoing, or Tools > Sync
// Center > its own Session/Devices/Controls/Health/Logs/Settings tabs).
// See _buildTree() below for the actual shape.
//
// Leaf/child labels, icons and hrefs are still always read straight
// from the DOM (bnav-items for top-level pages, plus the known
// sub-tab groups in _SUB_GROUPS, plus Tools' own settings cards) so
// content can never drift out of sync with the real nav — only the
// *grouping* (which id nests under which parent, and in what order)
// is a fixed, hand-authored layout here, since that's an actual design
// decision rather than something derivable from the DOM.
//
// Two rows have no real page of their own and so aren't in the DOM at
// all — the "PDF Library" tile (moved to a Cover shortcut) and the
// "Audit" external tile (an outside link, https://random.duapharma.com,
// with no bnav/hash entry) — those are hardcoded in _VIRTUAL below.
//
// Top-level ordering mirrors whatever order the user last dragged
// Cover's own dashboard groups into (js/cover-dashboard.js's ⠿ handles),
// via each group's _domainGroup mapped onto Cover's group slugs — see
// _DOMAIN_TO_COVER_SLUG. "Cover" itself always stays pinned first (it's
// the hub the drawer opens from, not a domain). Tools and PDF Library
// carry no domain mapping and so stay put at the end, in this fixed
// order, same as before.
//
// Every navigable row just sets window.location.hash, reusing ui.js's
// existing hashchange -> _routeFromHash -> showPage routing (including
// its sub-route handling for #manager/xxx, #credit-ledger/xxx,
// #notesheets/xxx and #tools/xxx) instead of calling
// showPage()/switchMgrTab() directly — that's also what gives every tap
// here a real, back-able history entry for free.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const LONG_PRESS_MS = 500;

  // parent id -> selector for its flat sub-tab elements (real <a href>
  // links already in the DOM).
  const _SUB_GROUPS = {
    index: '.bnav-sub-item[data-page]',
    manager: '.mgr-tab[href]',
    'credit-ledger': '.cl-mode-tab[href]',
    notesheets: '.ns-pill[href]',
    synccenter: '.sc-tab[href]',
  };

  // Rows with no bnav item / page of their own behind them.
  const _VIRTUAL = {
    pdfLibrary: { label: 'PDF Library', icon: '📚', href: '#pdf-library' },
    auditExternal: { label: 'Audit', icon: '🧾', href: 'https://random.duapharma.com', external: true },
    reports: [
      { label: 'Daily Check List', icon: '✅', href: 'https://reports.duapharma.com/daily_report.html', external: true },
      { label: 'Excess Stock Control', icon: '📦', href: 'https://reports.duapharma.com/excess-stock-control.html', external: true },
      { label: 'Branch Invoice Desk', icon: '🧮', href: 'https://reports.duapharma.com/invoice-desk.html', external: true },
    ],
  };

  // bnav-item's data-domain-group value (or this file's synthetic group
  // key) -> Cover dashboard's GROUP_META slug (js/cover-dashboard.js).
  const _DOMAIN_TO_COVER_SLUG = { sales: 'sales', manager: 'manager', notesheets: 'notes', closing: 'closing', audit: 'audit', inventory: 'inventory', reports: 'reports' };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _indent(depth) {
    return depth === 0 ? 8 : 42 + (depth - 1) * 20;
  }

  // Reads every top-level bnav page (id -> {label, icon, href}), keyed
  // by data-page. Skips Recents (not a real page) and anything whose
  // page element isn't in the DOM.
  function _flatFromBnav() {
    const map = {};
    document.querySelectorAll('#bnav > .bnav-item[data-page]').forEach(el => {
      const id = el.dataset.page;
      if (id === 'recents' || !document.getElementById('page-' + id)) return;
      map[id] = {
        label: (el.querySelector('.blabel') || {}).textContent || id,
        icon: (el.querySelector('.bicon') || {}).textContent || '📄',
        href: el.getAttribute('href'),
      };
    });
    return map;
  }

  // Flat list of {label, href} from a selector of real <a href> sub-tabs.
  function _domList(selector) {
    const out = [];
    const seen = new Set();
    document.querySelectorAll(selector).forEach(el => {
      const href = el.getAttribute('href');
      const label = (el.textContent || '').trim();
      if (!href || !label || seen.has(href)) return;
      seen.add(href);
      out.push({ label: label, href: href });
    });
    return out;
  }

  // Tools' settings cards (id="tc-xxx") aren't hash-routed sub-tabs like
  // the others — they're plain collapsible cards on the one Tools page —
  // so give each its own deep-link: #tools/card/<id-without-tc-> opens +
  // scrolls to that card (see ui.js's tools sub-route). Sync Center is
  // excluded here since it gets its own nested group below.
  function _toolCards() {
    const out = [];
    document.querySelectorAll('#page-tools > .tcard').forEach(el => {
      if (el.id === 'tc-sync-center') return;
      const titleEl = el.querySelector('.ttitle');
      if (!titleEl) return;
      let label = '';
      titleEl.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) label += n.textContent; });
      label = label.trim() || titleEl.textContent.trim();
      if (!label) return;
      out.push({ label: label, href: '#tools/card/' + el.id.replace(/^tc-/, '') });
    });
    return out;
  }

  function _leaf(f) {
    return f ? { label: f.label, icon: f.icon, href: f.href, kids: [] } : null;
  }

  // Every *.mgr-tab/.cl-mode-tab/.ns-pill/.sc-tab/.tcard label in this app
  // is already written as "🖐 Some Label" — the emoji lives inline in the
  // text, there's no separate icon markup to read. Rendering these
  // straight through a generic icon slot doubled it up: the same flat
  // white 📄/📁 placeholder next to a label that already has its own
  // colorful icon baked in. This pulls that leading emoji out into the
  // real icon slot instead, so it renders once, properly.
  const _LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;
  // Sale Data's own sub-tabs (Index/Daily Data/...) are the one set of
  // labels with no emoji of their own at all — curated real icons here
  // instead of every one of them falling back to the same generic 📄.
  const _CURATED_ICONS = {
    '#index': '📇', '#data': '🗓️', '#entry': '➕', '#report': '📄', '#cashdeposit': '💵', '#diff': '🧮',
  };
  function _leafFromList(item) {
    if (item.icon) return { label: item.label, icon: item.icon, href: item.href, kids: [] };
    const m = _LEADING_EMOJI_RE.exec(item.label);
    const icon = (m && m[0].trim()) ? m[0].trim() : (_CURATED_ICONS[item.href] || null);
    const label = (m && m[0].trim()) ? (item.label.slice(m[0].length).trim() || item.label) : item.label;
    return { label: label, icon: icon, href: item.href, kids: [] };
  }
  function _customGroup(domainGroup, label, icon, kids) {
    const filtered = (kids || []).filter(Boolean);
    if (!filtered.length) return null;
    return { label: label, icon: icon, href: null, kids: filtered, _domainGroup: domainGroup };
  }

  // Builds the drawer's actual row tree. This is the one place that
  // encodes the July-2026 re-org: Home folded into Sale Data, Overview
  // folded into Manager, and new collapsed umbrella groups (Inventory /
  // Closing / Audit / Notes & Sheets, plus a Sync Center group nested
  // inside Tools) each gathering what used to be separate top-level rows.
  function _buildTree() {
    const flat = _flatFromBnav();
    const groups = [];

    if (flat.cover) groups.push(_leaf(flat.cover));

    // Sale Data: Home first, then its existing Index/Daily Data/etc subs.
    if (flat.index) {
      const kids = [];
      if (flat.dashboard) kids.push(_leaf(flat.dashboard));
      _domList(_SUB_GROUPS.index).forEach(s => kids.push(_leafFromList(s)));
      groups.push({ label: flat.index.label, icon: flat.index.icon, href: flat.index.href, kids: kids, _domainGroup: 'sales' });
    }

    // Manager: Overview first, then its existing tab subs.
    if (flat.manager) {
      const kids = [];
      if (flat['manager-dashboard']) kids.push(_leaf(flat['manager-dashboard']));
      _domList(_SUB_GROUPS.manager).forEach(s => kids.push(_leafFromList(s)));
      groups.push({ label: flat.manager.label, icon: flat.manager.icon, href: flat.manager.href, kids: kids, _domainGroup: 'manager' });
    }

    // New: Inventory umbrella over the 4 former top-level inventory pages.
    groups.push(_customGroup('inventory', 'Inventory', '📦', ['inventory', 'stockledger', 'excess', 'reorder', 'purchase-order', 'inv-health'].map(id => _leaf(flat[id]))));

    // New: Closing umbrella over Closing Book + Credit Ledger (which
    // keeps its own Credit / Misc-Ongoing subs nested one level deeper).
    let creditLedger = null;
    if (flat['credit-ledger']) {
      creditLedger = {
        label: flat['credit-ledger'].label, icon: flat['credit-ledger'].icon, href: flat['credit-ledger'].href,
        kids: _domList(_SUB_GROUPS['credit-ledger']).map(_leafFromList),
      };
    }
    groups.push(_customGroup('closing', 'Closing', '🔒', [_leaf(flat['closing-book']), creditLedger]));

    // New: Audit umbrella over the external Audit link + Assignments.
    groups.push(_customGroup('audit', 'Audit', '🧾', [
      { label: _VIRTUAL.auditExternal.label, icon: _VIRTUAL.auditExternal.icon, href: _VIRTUAL.auditExternal.href, external: true, kids: [] },
      _leaf(flat.assignments),
    ]));

    // New: Notes & Sheets umbrella over its Notes/Sheets/Manage Sheets/
    // Live Data tabs. Those tabs are only in the DOM once the page has
    // rendered at least once this session — fall back to a single plain
    // row pointing at the page itself if it hasn't yet.
    const nsSubs = _domList(_SUB_GROUPS.notesheets).map(_leafFromList);
    if (nsSubs.length) {
      groups.push(_customGroup('notesheets', 'Notes & Sheets', '📑', nsSubs));
    } else if (flat.notesheets) {
      groups.push({ label: 'Notes & Sheets', icon: flat.notesheets.icon, href: flat.notesheets.href, kids: [], _domainGroup: 'notesheets' });
    }

    // New: Reports umbrella over the 3 external report links (none of
    // these have a bnav item — same "external, no page behind it"
    // pattern as Audit's own external tile above).
    groups.push(_customGroup('reports', 'Reports', '📚', _VIRTUAL.reports.map(r => ({ label: r.label, icon: r.icon, href: r.href, external: true, kids: [] }))));

    // Tools: its own Sync Center collapses into a nested group (with its
    // 6 tabs as sub-subs), followed by every other settings card.
    if (flat.tools) {
      const scSubs = _domList(_SUB_GROUPS.synccenter).map(_leafFromList);
      const kids = [];
      if (scSubs.length) kids.push({ label: 'Sync Center', icon: '🖥', href: null, kids: scSubs });
      _toolCards().forEach(c => kids.push(_leafFromList(c)));
      groups.push({ label: flat.tools.label, icon: flat.tools.icon, href: flat.tools.href, kids: kids });
    }

    if (document.getElementById('page-pdf-library')) groups.push(_leaf(_VIRTUAL.pdfLibrary));

    return groups;
  }

  // Mirror Cover's own drag-reordered sequence for top-level rows that
  // map onto one of its groups; unmapped rows (Tools, PDF Library) keep
  // their original relative order, appended after every mapped group.
  // Cover is always first and excluded from this sort (handled in _render).
  function _sortRest(rest) {
    const coverOrder = (typeof window.btGetCoverOrder === 'function') ? window.btGetCoverOrder() : [];
    const orderIndex = slug => { const i = coverOrder.indexOf(slug); return i === -1 ? null : i; };
    rest.forEach((g, i) => {
      const coverSlug = g._domainGroup ? _DOMAIN_TO_COVER_SLUG[g._domainGroup] : null;
      const idx = coverSlug ? orderIndex(coverSlug) : null;
      g._sortKey = idx != null ? idx : 1000 + i;
    });
    rest.sort((a, b) => a._sortKey - b._sortKey);
    return rest;
  }

  function _toggleGroup(el) {
    const group = el.closest('.sections-group');
    if (!group) return;
    const open = group.classList.toggle('sections-group-open');
    const btn = group.querySelector(':scope > .sections-row-main .sections-toggle');
    if (btn) {
      btn.textContent = open ? '▾' : '▸';
      btn.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + (group.dataset.label || ''));
    }
  }

  function _renderNode(node, depth) {
    if (!node) return '';
    const isGroup = !!(node.kids && node.kids.length);
    const rowClass = isGroup ? 'sections-row-main' : 'sections-row-sub';
    const labelSpan = depth === 0
      ? `<span class="recents-label">${_esc(node.label)}</span>`
      : `<span class="sections-sub-label">${_esc(node.label)}</span>`;
    const hitClick = node.href
      ? (node.external
          ? `window.open('${_esc(node.href)}','_blank');closeSectionsDrawer();`
          : `location.hash='${_esc(node.href)}';closeSectionsDrawer();`)
      : `BTNavSections._toggle(this);`;
    return `
      <div class="sections-group" data-label="${_esc(node.label)}">
        <div class="sections-row ${rowClass}" style="padding-left:${_indent(depth)}px">
          <span class="sections-nav-hit" onclick="${hitClick}">
            <span class="recents-icon${depth > 0 ? ' recents-icon-sub' : ''}">${_esc(node.icon || (isGroup ? '📁' : '📄'))}</span>
            ${labelSpan}
          </span>
          ${isGroup ? `<button type="button" class="sections-toggle" aria-label="Expand ${_esc(node.label)}" onclick="event.stopPropagation();BTNavSections._toggle(this);">▸</button>` : ''}
        </div>
        ${isGroup ? `<div class="sections-subs">${node.kids.map(k => _renderNode(k, depth + 1)).join('')}</div>` : ''}
      </div>`;
  }

  function _render() {
    const list = document.getElementById('sections-list');
    if (!list) return;
    const groups = _buildTree();
    const cover = groups.length && groups[0] && groups[0].href === '#cover' ? groups.shift() : null;
    const rest = _sortRest(groups);
    const ordered = cover ? [cover].concat(rest) : rest;
    list.innerHTML = ordered.map(g => _renderNode(g, 0)).join('');
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
  window.BTNavSections = { _toggle: _toggleGroup };

})();
