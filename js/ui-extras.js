// ═══════════════════════════════════════════════════════════════════════
// UI EXTRAS  —  loaded last so all other scripts are available
//
//  1. (Left-edge coloured tab strip REMOVED per request — it duplicated
//     the permanent ☰ button + "All Sections" sidebar drawer added in
//     js/nav-sections.js/index.html, which covers every page, not just
//     the 4 this strip knew about, and doesn't cost 8px of every page's
//     left edge permanently. TABS/PAGE_GROUP, _buildEdgeStrip(),
//     _updateStrip(), and #uex-strip's injected CSS all removed together
//     — nothing else in this file depended on any of them.)
//  2. (Floating 📊 Dashboard FAB removed — Ctrl+D shortcut still works)
//     [Dead _buildFab() body + its #uex-fab CSS were also removed in this
//     pass; they were never actually deleted when the FAB itself was cut.]
//  3. "Add New Month" → auto-creates matching target entry
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // 3a. SELF-HEAL: auto-create targets for every month that's missing one
  // ─────────────────────────────────────────────────────────────────────
  // Called on load (and again when Tools tab opens).  Reads window.MONTHLY
  // (the global sales data array, populated by config.js/repository.js —
  // NOT data-base.js, which was unused dead code and has been removed)
  // and compares every Month_Year entry against bt_targets.  Any month
  // that exists in
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

  // Actions is a module loaded before every classic <script defer> file
  // (see index.html load order), so by the time ui-extras.js runs,
  // window.Actions.loadFeatureData/saveTargets are guaranteed to exist.
  // There used to be a silent localStorage fallback here for the case
  // where they weren't — that fallback could never legitimately fire
  // given the load order, so if Actions/saveTargets ever really is
  // missing, it means something broke upstream (wrong load order, a
  // rename, etc.), and silently writing straight to localStorage would
  // hide that bug (bypassing Repository's stamping + EventBus notify)
  // instead of surfacing it. Fail loud instead, matching the pattern
  // config.js's _protectArray already uses for the same class of bug.
  function _assertActionsAvailable(fnName) {
    if (window.Actions && typeof Actions[fnName] === 'function') return true;
    console.error('[Architecture] ui-extras.js: Actions.' + fnName + ' unavailable — ' +
      'targets self-heal skipped this run. Check js load order in index.html.');
    try { if (typeof toast === 'function') toast('⚠ Targets sync unavailable — check console', 'e'); } catch (e) {}
    return false;
  }

  function _loadTgts() {
    if (!_assertActionsAvailable('loadFeatureData')) return {};
    var raw = '';
    try { raw = Actions.loadFeatureData('bt_targets') || ''; } catch (e) {}
    try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
  }

  function _saveTgts(tgts) {
    if (!_assertActionsAvailable('saveTargets')) return;
    try { Actions.saveTargets(JSON.stringify(tgts)); } catch (e) {}
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
  // 5. PATCH showPage — self-heal targets whenever Tools opens
  //    (used to also keep the left-edge strip's active segment in sync;
  //    that call was removed along with the strip itself)
  // ─────────────────────────────────────────────────────────────────────
  function _patchShowPage() {
    if (window._uexSpPatched || typeof showPage !== 'function') return;
    window._uexSpPatched = true;

    var orig = window.showPage;
    window.showPage = function (page) {
      var r = orig.apply(this, arguments);
      // Self-heal targets silently whenever the Tools tab opens
      if (page === 'tools') {
        setTimeout(function () { _autoHealTargets(true); }, 600);
      }
      return r;
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────
  function _init() {
    _patchShowPage();
    _addKeyboard();
    _patchAddNewMonth(); // targets.js already loaded by this point

    // Self-heal on startup: silently fill any months that are missing targets.
    // Delayed 2 s so MONTHLY data and Actions are fully settled before we read them.
    setTimeout(function () { _autoHealTargets(true); }, 2000);
  }

  // Always defer/module now — readyState is never 'loading' here.
  document.addEventListener('DOMContentLoaded', _init);

  // Final safety-net: re-apply patches after all scripts have settled
  window.addEventListener('load', function () {
    _patchShowPage();
    _patchAddNewMonth();
  });

})();
