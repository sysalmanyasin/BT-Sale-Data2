// ══════════════════════════════════════════════════════════════════════
// BOOT GUARD — catches load-order mistakes loudly instead of silently
//
// index.html's dependency chain (Repository/Actions/EventBus/config's
// state arrays, all real ES modules) has to load before every classic
// `<script defer>` feature file, because those files read window.MONTHLY,
// window.Repository, window.Actions etc. as bare globals (see config.js's
// and repository.js's "TEMPORARY WINDOW BRIDGE" comments). Module and
// classic-defer scripts share one execution queue in document order, so
// today's order in index.html is correct — but nothing enforced that
// automatically, and a future edit that inserts a new classic script
// above the module block, or reorders the <head>, would fail silently:
// every consumer would just read `undefined` and produce wrong numbers
// or blank sections with no error pointing at the actual cause.
//
// This file is a classic <script defer>, placed immediately after the
// module block (js/actions.js) in index.html — so by the time it runs,
// every dependency below MUST already exist, or the load order broke.
// Same "fail loud, name the exact cause" instinct as config.js's
// _protectArray Proxy and ui-extras.js's _assertActionsAvailable.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var REQUIRED = [
    'Repository', 'Actions', 'MONTHLY', 'DAILY', 'STAFF',
    'n', 'ff', 'fc', 'computeDailyTotals', 'recomputeMonthly',
  ];

  var missing = REQUIRED.filter(function (name) {
    return typeof window[name] === 'undefined';
  });

  if (missing.length) {
    var msg = '[Architecture] BOOT ORDER BROKEN — missing on window: ' +
      missing.join(', ') + '. This means a script ran before ' +
      'config.js/repository.js/actions.js finished loading. Check ' +
      '<script> order in index.html — the module block (bt-format, ' +
      'print, bt-date, bt-search, app-context, config, event-bus, ' +
      'repository, actions) must stay above every classic <script defer> ' +
      'feature file. Every page will show wrong/blank data until this ' +
      'is fixed.';
    console.error(msg);
    try {
      // No toast() yet at this point in boot — ui.js hasn't run — so
      // this is the one place in the app a raw alert() is appropriate:
      // it's the earliest possible moment to surface a boot failure,
      // before any page has silently rendered wrong numbers.
      alert('⚠ App failed to load correctly (missing: ' + missing.join(', ') + '). ' +
        'Please reload. If this repeats, check the browser console.');
    } catch (e) {}
  }
})();
