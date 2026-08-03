// ══════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH — revives js/bt-search.js (dead code since commandhub.js
// was removed with the AI layer — see README "Known gaps").
//
// Adds a live search box to the top of the existing "All Sections"
// drawer (js/nav-sections.js). Typing:
//   1. Fuzzy-filters the section/sub-section tree that drawer already
//      renders (via BTSearch.score against each row's own label),
//      auto-expanding any branch that contains a match so a hit nested
//      deep (e.g. Tools > Sync Center > Logs) surfaces without the user
//      manually opening every chevron first.
//   2. Fuzzy-ranks the Staff registry (Repository.getStaff()) and shows
//      the top matches above the tree — tapping one jumps to Manager
//      and opens that employee's Staff Card directly.
//
// Classic (non-module) script — reads window.BTSearch, the bridge
// bt-search.js exposes for exactly this reason, plus this app's other
// existing globals (Repository, closeSectionsDrawer, openStaffCard).
// Must load AFTER both bt-search.js and nav-sections.js.
//
// Monkey-patches window.openSectionsDrawer purely to reset/focus the
// search box each time the drawer opens — same pattern ui-extras.js
// already uses to layer behavior onto window.showPage (see ui.js's own
// note on that). nav-sections.js itself is untouched.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Staff results ─────────────────────────────────────────────────
  function _staffItems() {
    const staff = (typeof Repository !== 'undefined' && Repository.getStaff) ? Repository.getStaff() : [];
    return staff.map((emp, i) => ({
      idx: i,
      label: emp.name || '(unnamed)',
      sub: [emp.designation, emp.active === false ? 'Inactive' : null].filter(Boolean).join(' · ') || 'Staff',
    }));
  }

  function _renderStaffResults(query) {
    const box = document.getElementById('gs-staff-results');
    if (!box) return;
    const BTSearch = window.BTSearch;
    if (!query || !BTSearch) { box.innerHTML = ''; box.style.display = 'none'; return; }
    const matches = BTSearch.filterAndRank(_staffItems(), query, ['label', 'sub']).slice(0, 6);
    if (!matches.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML =
      '<div class="gs-group-label">Staff</div>' +
      matches.map(m =>
        '<div class="recents-row" onclick="GlobalSearch._openStaff(' + m.idx + ')">' +
        '<span class="recents-icon">🧑\u200D💼</span>' +
        '<span class="recents-label">' + _esc(m.label) + '<span class="gs-sub">' + _esc(m.sub) + '</span></span>' +
        '</div>'
      ).join('');
  }

  function _openStaff(i) {
    if (typeof closeSectionsDrawer === 'function') closeSectionsDrawer();
    location.hash = '#manager';
    setTimeout(function () {
      if (typeof openStaffCard === 'function') openStaffCard(i);
    }, 60);
  }

  // ── Section-tree filtering ───────────────────────────────────────
  // Recurses the .sections-group tree nav-sections.js already rendered
  // into #sections-list. Reuses BTNavSections._toggle (nav-sections.js's
  // own expand/collapse function) to auto-open matched branches, rather
  // than duplicating its arrow/aria-label flip logic here.
  function _filterTree(query) {
    const list = document.getElementById('sections-list');
    if (!list) return;
    const BTSearch = window.BTSearch;

    function walk(groupEl) {
      const labelEl = groupEl.querySelector(':scope > .sections-row .recents-label, :scope > .sections-row .sections-sub-label');
      const ownText = labelEl ? labelEl.textContent : '';
      const ownScore = (!query || !BTSearch) ? 1 : BTSearch.score(ownText, query);
      let childMatch = false;
      groupEl.querySelectorAll(':scope > .sections-subs > .sections-group').forEach(child => {
        if (walk(child)) childMatch = true;
      });
      const matches = !query || ownScore > 0 || childMatch;
      groupEl.classList.toggle('gs-hidden', !matches);
      if (query && childMatch && !groupEl.classList.contains('sections-group-open')) {
        const toggleBtn = groupEl.querySelector(':scope > .sections-row-main .sections-toggle');
        if (toggleBtn && window.BTNavSections && typeof window.BTNavSections._toggle === 'function') {
          window.BTNavSections._toggle(toggleBtn);
        }
      }
      return matches;
    }
    list.querySelectorAll(':scope > .sections-group').forEach(walk);
  }

  function onInput(value) {
    const query = (value || '').trim();
    _filterTree(query);
    _renderStaffResults(query);
  }

  function reset() {
    const input = document.getElementById('gs-input');
    if (input) input.value = '';
    onInput('');
    // Intentionally no auto-focus here: focusing #gs-input on every
    // drawer open pops the on-screen keyboard immediately, even though
    // the user hasn't tapped the box. The box should only focus when
    // the user explicitly taps it.
  }

  window.GlobalSearch = { onInput: onInput, reset: reset, _openStaff: _openStaff };

  // Wrap openSectionsDrawer (set by nav-sections.js, which must load
  // before this file) so every open starts from a clean, focused box —
  // nav-sections.js's own _render() already re-collapses the tree fresh
  // each time, so this just layers the search reset on top of that.
  const _origOpen = window.openSectionsDrawer;
  window.openSectionsDrawer = function () {
    if (typeof _origOpen === 'function') _origOpen();
    reset();
  };
})();
