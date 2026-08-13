// ══════════════════════════════════════════════════════════════════════
// APP RAIL — expand/collapse + per-domain sub-tabs (Aug 2026 nav redesign)
//
// The rail (index.html's #app-rail, styled in css/app-nav.css) defaults
// to expanded (208px, full labels + groups) every session — it's the
// one persistent desktop nav, so it shouldn't default to a
// hunt-for-it icon strip. A user who's explicitly collapsed it before
// (a real '0' written to localStorage, not just "never touched it")
// still gets that choice remembered and honoured.
// Purely a desktop concern; the mobile shell (.bnav) has no equivalent
// expand/collapse, it's just the 5 items + the ☰ Menu drawer trigger.
//
// Sub-tabs: each domain item (Sales/Manager/Notes & Sheets/Closing/
// Audit/Inventory/Tools) is wrapped in index.html as a .rail-group with
// a ▸ toggle and an empty .rail-subs container. _buildRailSubs() below
// fills every .rail-subs from window.BTNavSections.getTree() — the
// exact same domain->kids tree js/nav-sections.js already builds for
// the Search & All Sections drawer — so the rail never carries its own,
// separately-maintained copy of "what's under Sales" etc. Groups
// rebuild (and the one matching the current page auto-opens) on every
// EventBus 'nav:changed', so a fresh hire's staff tab, a newly-created
// Notes & Sheets pill, and so on all show up without a reload. Only
// meaningful when the rail is expanded — collapsed (icon-only) mode
// hides toggles/subs entirely via CSS, there's no room for labels.
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
    // Read the rail's actual current state rather than raw storage —
    // storage can be null (never explicitly saved either way, now that
    // expanded is the default), and computing "next" from a null read
    // used to always resolve to "expand" even when the rail was already
    // expanded and the user was trying to collapse it.
    var rail = document.getElementById('app-rail');
    var currentlyExpanded = !!(rail && rail.classList.contains('expanded'));
    var next = !currentlyExpanded;
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (_) { /* private mode etc. — just won't persist */ }
    apply(next);
  }

  function safeGet() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  // ── Sub-tabs ─────────────────────────────────────────────────────

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Renders one drawer-tree node as a rail sub-row. Nodes with their
  // own kids (Credit Ledger under Closing, Sync Center under Tools)
  // get their own link (if any) plus one further level of indented
  // children — the rail doesn't need the drawer's collapsible nesting,
  // everything under an already-open top-level group just shows flat.
  function _renderKid(k, depth) {
    if (!k) return '';
    var cls = 'rail-sub-item' + (depth > 1 ? ' rail-sub-item-l2' : '');
    var html = '';
    if (k.href) {
      var target = k.external ? ' target="_blank" rel="noopener"' : '';
      html += '<a class="' + cls + '" href="' + _esc(k.href) + '"' + target + '>' + _esc(k.label) + '</a>';
    } else if (k.label) {
      html += '<div class="rail-sub-label">' + _esc(k.label) + '</div>';
    }
    if (k.kids && k.kids.length) {
      html += k.kids.map(function (kk) { return _renderKid(kk, depth + 1); }).join('');
    }
    return html;
  }

  function _buildRailSubs() {
    if (!window.BTNavSections || typeof window.BTNavSections.getTree !== 'function') return;
    var tree = window.BTNavSections.getTree();
    document.querySelectorAll('#app-rail .rail-group[data-domain-group]').forEach(function (group) {
      var dom = group.dataset.domainGroup;
      var node = null;
      for (var i = 0; i < tree.length; i++) {
        if (tree[i] && tree[i]._domainGroup === dom) { node = tree[i]; break; }
      }
      var subsEl = group.querySelector('.rail-subs');
      if (!subsEl) return;
      var kids = (node && node.kids) ? node.kids.filter(Boolean) : [];
      group.classList.toggle('has-subs', kids.length > 0);
      subsEl.innerHTML = kids.map(function (k) { return _renderKid(k, 1); }).join('');
      // Mark the sub-row matching the current hash, if any, so a direct
      // link into a sub-page (e.g. #manager/staff) highlights correctly
      // without waiting for a click inside the rail itself.
      var hash = window.location.hash;
      subsEl.querySelectorAll('.rail-sub-item').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('href') === hash);
      });
    });
  }

  // Opens whichever group owns the page currently marked .active by
  // showPage() — doesn't close any group the user already had open by
  // hand, this is purely additive so switching pages never surprises
  // you by collapsing something you deliberately expanded.
  function _autoOpenActiveGroup() {
    var activeItem = document.querySelector('#app-rail .rail-item.active[data-domain-group]');
    var dom = activeItem ? activeItem.dataset.domainGroup : null;
    if (!dom) return;
    document.querySelectorAll('#app-rail .rail-group[data-domain-group="' + dom + '"]').forEach(function (group) {
      group.classList.add('rail-group-open');
    });
  }

  function toggleGroup(btn) {
    var group = btn.closest('.rail-group');
    if (!group) return;
    var open = group.classList.toggle('rail-group-open');
    btn.textContent = open ? '▾' : '▸';
    btn.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + (group.dataset.domainGroup || '') + ' sub-sections');
  }

  function _refresh() {
    _buildRailSubs();
    _autoOpenActiveGroup();
  }

  window.btToggleRailPin = toggle;
  window.BTAppNav = { toggleGroup: toggleGroup, refresh: _refresh };

  document.addEventListener('DOMContentLoaded', function () {
    apply(safeGet() !== '0');
    _refresh();
  });

  // Rebuild + re-open on every navigation (manager tabs, notesheets
  // pills, sync-center tabs etc. can all appear/change after their
  // first render — see js/nav-sections.js's own _SUB_GROUPS comment).
  if (window.EventBus && typeof window.EventBus.onChange === 'function') {
    window.EventBus.onChange(function (eventName) {
      if (eventName === 'nav:changed') _refresh();
    });
  }
})();
