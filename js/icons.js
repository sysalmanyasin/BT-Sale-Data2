// ══════════════════════════════════════════════════════════════════════
// ICON LIBRARY  —  design pass, Aug 2026
//
// Replaces emoji as the icon system for the two places icons act as
// real wayfinding (not just decoration): the bottom nav bar and the
// All Sections drawer's top-level rows. Deliberately scoped to just
// those — sub-tab rows (Manager's tabs, Credit Ledger's modes, Tools'
// individual cards, etc.) keep their existing inline emoji for now;
// swapping those too is a separate follow-up, not bundled in here.
//
// Why: emoji render differently per OS/browser (a different glyph on
// Android vs iOS vs desktop Chrome), can't take the current text
// color, and don't share a visual weight with each other. These are
// plain stroke-based SVGs (Feather/Lucide-style, 24x24 viewBox,
// stroke="currentColor") so they inherit whatever color the nav
// already applies for active/inactive/domain-accent state — no CSS
// color rules needed on top of what's already there.
//
// Usage:
//   BT_ICONS[key]              -> raw <svg> markup string
//   btApplyIcons()             -> (re)runs the DOM swap below; safe to
//                                  call again after nav-sections.js
//                                  re-renders the drawer, since it
//                                  rebuilds that markup from scratch
//                                  each open (see openSectionsDrawer).
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var A = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  var BT_ICONS = {
    menu: '<svg ' + A + '><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    cover: '<svg ' + A + '><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    recents: '<svg ' + A + '><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    dashboard: '<svg ' + A + '><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    index: '<svg ' + A + '><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    manager: '<svg ' + A + '><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    'manager-dashboard': '<svg ' + A + '><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    notesheets: '<svg ' + A + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    'closing-book': '<svg ' + A + '><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    'credit-ledger': '<svg ' + A + '><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    assignments: '<svg ' + A + '><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
    inventory: '<svg ' + A + '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    stockledger: '<svg ' + A + '><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    excess: '<svg ' + A + '><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
    reorder: '<svg ' + A + '><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    'inv-health': '<svg ' + A + '><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    tools: '<svg ' + A + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    // Drawer-only umbrella groups (no 1:1 bottom-nav item of their own) —
    // reuse a related page's icon where the metaphor already fits
    // (Inventory umbrella = same box as the Inventory page, Audit
    // umbrella = same clipboard as Assignments, Notes = same doc icon
    // as Notes & Sheets), and two new ones for Closing/Reports.
    'group-inventory': '<svg ' + A + '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    'group-audit': '<svg ' + A + '><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
    'group-notes': '<svg ' + A + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    'group-closing': '<svg ' + A + '><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    'group-reports': '<svg ' + A + '><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  };

  // Swaps every top-level nav icon's inner emoji for its SVG. Idempotent
  // and safe to call repeatedly (bottom nav only needs it once on load;
  // the drawer calls it itself each time it re-renders, since
  // nav-sections.js rebuilds that markup from scratch on every open).
  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll('.bnav-item[data-page], .side-menu-btn').forEach(function (el) {
      var key = el.dataset.page || 'menu';
      var svg = BT_ICONS[key];
      var span = el.querySelector('.bicon');
      if (svg && span) span.innerHTML = svg;
    });
  }

  window.BT_ICONS = BT_ICONS;
  window.btApplyIcons = apply;
  document.addEventListener('DOMContentLoaded', function () { apply(document); });
})();
