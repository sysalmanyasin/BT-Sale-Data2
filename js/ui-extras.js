// ═══════════════════════════════════════════════════════════════════════
// UI EXTRAS  —  loaded last so all other scripts are available
//
//  1. Left-edge coloured tab strip  (always visible, 5 main tabs)
//  2. Floating 📊 Dashboard FAB     (draggable, Ctrl+D shortcut)
//  3. "Add New Month" → auto-creates matching target entry
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // TAB DEFINITIONS
  // ─────────────────────────────────────────────────────────────────────
  var TABS = [
    { page: 'commandhub', group: 'commandhub', icon: '🧭', label: 'Hub',       color: '#7c3aed' },
    { page: 'dashboard',  group: 'dashboard',  icon: '📊', label: 'Dashboard', color: '#2563eb' },
    { page: 'index',      group: 'saledata',   icon: '🗂️', label: 'Sales',     color: '#059669' },
    { page: 'manager',    group: 'manager',    icon: '👔', label: 'Manager',   color: '#d97706' },
    { page: 'tools',      group: 'tools',      icon: '⚙️', label: 'Tools',     color: '#64748b' },
  ];

  // Map every sub-page to its parent group colour
  var PAGE_GROUP = {
    commandhub: 'commandhub',
    dashboard:  'dashboard',
    index: 'saledata', data: 'saledata', entry: 'saledata',
    report: 'saledata', diff: 'saledata',
    manager: 'manager',
    tools:   'tools',
  };

  // ─────────────────────────────────────────────────────────────────────
  // 1. LEFT-EDGE COLOUR STRIP
  // ─────────────────────────────────────────────────────────────────────
  // A slim (8 px) vertical band fixed to the left viewport edge, divided
  // into 5 equal coloured sections — one per main tab.  The active section
  // glows white on its right edge.  Hovering expands it (CSS transition)
  // to reveal icon + label.  Clicking navigates to that tab.
  // ─────────────────────────────────────────────────────────────────────

  function _buildEdgeStrip() {
    if (document.getElementById('uex-strip')) return;

    var strip = document.createElement('div');
    strip.id = 'uex-strip';

    TABS.forEach(function (tab) {
      var seg = document.createElement('div');
      seg.className   = 'uex-seg';
      seg.dataset.group = tab.group;
      seg.dataset.page  = tab.page;
      seg.title = tab.label + '  (click to open)';
      seg.style.background = tab.color;
      seg.innerHTML =
        '<span class="uex-icon">' + tab.icon + '</span>' +
        '<span class="uex-lbl">'  + tab.label + '</span>';

      seg.addEventListener('click', function () {
        if (typeof showPage === 'function') showPage(tab.page);
      });

      strip.appendChild(seg);
    });

    document.body.appendChild(strip);
  }

  function _updateStrip(page) {
    var group = PAGE_GROUP[page] || page;
    document.querySelectorAll('.uex-seg').forEach(function (seg) {
      var active = (seg.dataset.group === group);
      seg.classList.toggle('uex-active', active);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. FLOATING DASHBOARD FAB
  // ─────────────────────────────────────────────────────────────────────
  function _buildFab() {
    if (document.getElementById('uex-fab')) return;

    // Restore last dragged position
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('bt_fab_pos') || 'null'); } catch (e) {}

    var fab = document.createElement('button');
    fab.id = 'uex-fab';
    fab.title = 'Dashboard  (Ctrl+D)';
    fab.innerHTML = '📊';

    if (saved && saved.x != null && saved.y != null) {
      fab.style.left   = saved.x + 'px';
      fab.style.top    = saved.y + 'px';
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
    }

    document.body.appendChild(fab);

    // Click → navigate (only if not dragging)
    var _dragged = false;
    fab.addEventListener('click', function () {
      if (_dragged) return;
      if (typeof showPage === 'function') showPage('dashboard');
    });

    // ── Drag (mouse) ──────────────────────────────────────────────────
    var _down = false, _ox = 0, _oy = 0;

    fab.addEventListener('mousedown', function (e) {
      _down    = true;
      _dragged = false;
      _ox = e.clientX - fab.getBoundingClientRect().left;
      _oy = e.clientY - fab.getBoundingClientRect().top;
      fab.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!_down) return;
      _dragged = true;
      fab.style.left   = (e.clientX - _ox) + 'px';
      fab.style.top    = (e.clientY - _oy) + 'px';
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', function () {
      if (!_down) return;
      _down = false;
      fab.style.transition = '';
      if (_dragged) {
        try {
          localStorage.setItem('bt_fab_pos', JSON.stringify({
            x: parseInt(fab.style.left,  10),
            y: parseInt(fab.style.top,   10),
          }));
        } catch (e) {}
      }
      // Reset _dragged after click fires
      setTimeout(function () { _dragged = false; }, 50);
    });

    // ── Touch drag (mobile) ──────────────────────────────────────────
    fab.addEventListener('touchstart', function (e) {
      _down    = true;
      _dragged = false;
      var t = e.touches[0];
      _ox = t.clientX - fab.getBoundingClientRect().left;
      _oy = t.clientY - fab.getBoundingClientRect().top;
      fab.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!_down) return;
      _dragged = true;
      var t = e.touches[0];
      fab.style.left   = (t.clientX - _ox) + 'px';
      fab.style.top    = (t.clientY - _oy) + 'px';
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!_down) return;
      _down = false;
      fab.style.transition = '';
      if (_dragged) {
        try {
          localStorage.setItem('bt_fab_pos', JSON.stringify({
            x: parseInt(fab.style.left,  10),
            y: parseInt(fab.style.top,   10),
          }));
        } catch (e) {}
      }
      if (!_dragged && typeof showPage === 'function') showPage('dashboard');
      setTimeout(function () { _dragged = false; }, 50);
    }, { passive: true });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3a. SELF-HEAL: auto-create targets for every month that's missing one
  // ─────────────────────────────────────────────────────────────────────
  // Called on load (and again when Tools tab opens).  Reads window.MONTHLY
  // (the global sales data array — loaded by data-base.js) and compares
  // every Month_Year entry against bt_targets.  Any month that exists in
  // the data but has no target gets one created, carrying the nearest
  // chronologically-previous target forward (or 0 if none exists yet).
  // ─────────────────────────────────────────────────────────────────────

  // Month sort helper — converts "July 2026" → numeric 202607
  var _MON_IDX = { January:1,February:2,March:3,April:4,May:5,June:6,
                   July:7,August:8,September:9,October:10,November:11,December:12 };
  function _mySort(my) {
    var p = (my || '').split(' ');
    return parseInt(p[1] || '0', 10) * 100 + (_MON_IDX[p[0]] || 0);
  }

  function _loadTgts() {
    var raw = '';
    try {
      raw = (window.Actions && typeof Actions.loadFeatureData === 'function')
        ? (Actions.loadFeatureData('bt_targets') || '')
        : (localStorage.getItem('bt_targets') || '');
    } catch (e) {}
    try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
  }

  function _saveTgts(tgts) {
    var json = JSON.stringify(tgts);
    try {
      if (window.Actions && typeof Actions.saveTargets === 'function') {
        Actions.saveTargets(json);
      } else {
        localStorage.setItem('bt_targets', json);
      }
    } catch (e) {}
  }

  function _refreshTargetUI() {
    var fn = window.renderTargetList || window.loadTargetList  ||
             window.initTargets      || window.buildTargetList ||
             window.refreshTargets   || window.reloadTargets;
    if (typeof fn === 'function') { try { fn(); } catch (e) {} }
  }

  function _autoHealTargets(silent) {
    // Need MONTHLY to exist and be a non-empty array
    if (!window.MONTHLY || !Array.isArray(MONTHLY) || !MONTHLY.length) return 0;

    var tgts  = _loadTgts();
    var added = 0;

    // Build a chronologically-sorted list of all known Month_Year strings
    var allMY = MONTHLY
      .map(function (m) { return (m.Month_Year || '').trim(); })
      .filter(function (my) { return my.length > 0; });

    // Deduplicate
    allMY = allMY.filter(function (v, i, a) { return a.indexOf(v) === i; });

    // Sort oldest → newest so carry-forward works correctly
    allMY.sort(function (a, b) { return _mySort(a) - _mySort(b); });

    var runningTarget = 0; // carry-forward accumulator

    allMY.forEach(function (my) {
      if (my in tgts) {
        // Already has a target — update carry-forward value
        runningTarget = tgts[my] || runningTarget;
      } else {
        // Missing — create it using the running carry-forward
        tgts[my] = runningTarget;
        added++;
      }
    });

    if (added > 0) {
      _saveTgts(tgts);
      _refreshTargetUI();

      // Also add any missing months to the tgt-sel dropdown
      var tgtSel = document.getElementById('tgt-sel');
      if (tgtSel) {
        allMY.forEach(function (my) {
          if (!Array.from(tgtSel.options).some(function (o) { return o.value === my; })) {
            var opt = document.createElement('option');
            opt.value = opt.textContent = my;
            tgtSel.appendChild(opt);
          }
        });
      }

      if (!silent && typeof toast === 'function') {
        toast('🔧 Auto-created targets for ' + added + ' missing month' + (added > 1 ? 's' : ''), 'i');
      }
    }

    return added;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3b. ADD NEW MONTH → ALSO CREATE TARGET ENTRY
  // ─────────────────────────────────────────────────────────────────────
  // The "Create Month" button calls addNewMonth() from targets.js.
  // That function creates a MONTHLY sales row but leaves the target
  // list untouched.  We wrap it: after it runs, we check whether a
  // bt_targets entry exists for the new month and create one if not,
  // carrying forward the most-recent target value as the default.
  // ─────────────────────────────────────────────────────────────────────
  function _patchAddNewMonth() {
    var orig = window.addNewMonth;
    if (!orig || orig._uexPatched) return;

    window.addNewMonth = function () {
      var result = orig.apply(this, arguments);

      // Wait for targets.js to finish, then run the full self-heal scan.
      // This covers the new month AND any other gaps that may exist.
      setTimeout(function () {
        var monEl = document.getElementById('nm-sel');
        var yrEl  = document.getElementById('nm-year');
        var mon   = monEl ? (monEl.value || '').trim() : '';
        var yr    = yrEl  ? (yrEl.value  || '').trim() : '';
        var newMY = mon && yr ? mon + ' ' + yr : '';

        // Run the full heal — it will create the new month entry + any others
        var healed = _autoHealTargets(true); // silent=true, we toast manually below

        if (newMY && typeof toast === 'function') {
          var tgts   = _loadTgts();
          var carryVal = tgts[newMY] || 0;
          toast(
            '🎯 Target for ' + newMY + ' created' +
            (carryVal ? ' (₨' + Number(carryVal).toLocaleString() + ' carried forward)' : ' — set it in Monthly Targets'),
            'i'
          );
        } else if (healed > 0 && typeof toast === 'function') {
          toast('🔧 Auto-created targets for ' + healed + ' missing month' + (healed > 1 ? 's' : ''), 'i');
        }
      }, 400);

      return result;
    };

    window.addNewMonth._uexPatched = true;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. KEYBOARD SHORTCUTS
  // ─────────────────────────────────────────────────────────────────────
  function _addKeyboard() {
    if (window._uexKbPatched) return;
    window._uexKbPatched = true;

    document.addEventListener('keydown', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.shiftKey || e.altKey)   return;

      // Skip when typing in an input / textarea / contenteditable
      var tag = document.activeElement ? document.activeElement.tagName : '';
      var ce  = document.activeElement && document.activeElement.contentEditable === 'true';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ce) return;

      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        if (typeof showPage === 'function') showPage('dashboard');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. PATCH showPage SO THE STRIP STAYS IN SYNC
  // ─────────────────────────────────────────────────────────────────────
  function _patchShowPage() {
    if (window._uexSpPatched || typeof showPage !== 'function') return;
    window._uexSpPatched = true;

    var orig = window.showPage;
    window.showPage = function (page) {
      var r = orig.apply(this, arguments);
      _updateStrip(page);
      // Self-heal targets silently whenever the Tools tab opens
      if (page === 'tools') {
        setTimeout(function () { _autoHealTargets(true); }, 600);
      }
      return r;
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. STYLES
  // ─────────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('uex-css')) return;

    var s = document.createElement('style');
    s.id = 'uex-css';
    s.textContent = [

      /* ── Edge strip container ── */
      '#uex-strip{',
        'position:fixed;left:0;top:0;width:8px;height:100vh;',
        'z-index:500;display:flex;flex-direction:column;',
        'box-shadow:2px 0 8px rgba(0,0,0,.18);',
      '}',

      /* ── Individual segment ── */
      '.uex-seg{',
        'flex:1;display:flex;align-items:center;gap:7px;',
        'padding-left:7px;overflow:hidden;white-space:nowrap;',
        'cursor:pointer;opacity:.72;',
        'transition:width .22s ease,opacity .22s ease,box-shadow .2s ease;',
        'width:8px;',
      '}',
      '.uex-seg:hover{width:88px;opacity:1;}',

      /* ── Active segment ── */
      '.uex-seg.uex-active{',
        'opacity:1;',
        'box-shadow:inset -4px 0 0 rgba(255,255,255,.75);',
        'width:10px;',           /* just slightly wider than inactive */
      '}',
      '.uex-seg.uex-active:hover{width:88px;}',

      /* ── Icon & label ── */
      '.uex-icon{font-size:13px;flex-shrink:0;pointer-events:none;line-height:1;}',
      '.uex-lbl{',
        'font-size:10px;font-weight:700;color:#fff;',
        'letter-spacing:.06em;pointer-events:none;',
        'text-shadow:0 1px 3px rgba(0,0,0,.5);',
      '}',

      /* ── Floating Dashboard FAB ── */
      '#uex-fab{',
        'position:fixed;right:18px;bottom:80px;',
        'width:34px;height:34px;border-radius:50%;',
        'background:#1d4ed8;color:#fff;border:2.5px solid rgba(255,255,255,.45);',
        'box-shadow:0 4px 18px rgba(29,78,216,.45);',
        'font-size:15px;line-height:1;cursor:pointer;',
        'z-index:600;display:flex;align-items:center;justify-content:center;',
        'user-select:none;touch-action:none;',
        'transition:transform .14s,box-shadow .14s;',
      '}',
      '#uex-fab:hover{',
        'transform:scale(1.14);',
        'box-shadow:0 6px 22px rgba(29,78,216,.6);',
      '}',
      '#uex-fab:active{transform:scale(.9)!important;}',

    ].join('');

    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────
  function _init() {
    _injectStyles();
    _buildEdgeStrip();
    _buildFab();
    _patchShowPage();
    _addKeyboard();
    _patchAddNewMonth(); // targets.js already loaded by this point

    // Detect the initially-visible page
    var visible = document.querySelector('.page:not([style*="display: none"]):not([style*="display:none"])');
    if (visible && visible.id) {
      _updateStrip(visible.id.replace('page-', ''));
    } else {
      _updateStrip('dashboard'); // sensible default
    }

    // Self-heal on startup: silently fill any months that are missing targets.
    // Delayed 2 s so MONTHLY data and Actions are fully settled before we read them.
    setTimeout(function () { _autoHealTargets(true); }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Final safety-net: re-apply patches after all scripts have settled
  window.addEventListener('load', function () {
    _patchShowPage();
    _patchAddNewMonth();
  });

})();
