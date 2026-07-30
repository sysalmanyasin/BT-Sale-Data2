// ══════════════════════════════════════════════════════════════════════
// RULES ENGINE  —  BT Sales App  ·  Rule-Based Intelligence Plan, step 1
//
// aimRulesCheckAll() was already being called from dashboard-insights.js
// (_dbiBuildRuleAlerts) and manager-export.js, both defensively guarded
// with `typeof aimRulesCheckAll === 'function'` — but the function itself
// was never defined anywhere in the codebase, so every rule alert has
// been silently firing zero results. This file is that missing piece.
//
// Design (Floor 3 — pure calc, no DOM, no Repository writes):
//   aimRulesRegister(domain, id, fn, opts)
//     fn: () => alert | alert[] | null
//     Each rule reads whatever cold-callable getter it needs itself
//     (e.g. window.ReorderReportApp.getFlaggedRows()) — this engine
//     doesn't pass "domainState" in, because every domain here already
//     exposes its own cold-safe getter and there's no single shared
//     shape across Sales/Inventory/Manager worth forcing into one.
//   aimRulesCheckAll()
//     Runs every registered rule, isolated in its own try/catch (one
//     broken/missing data source can't take down every other domain's
//     alerts), flattens results, sorts by severity (red > amber > info),
//     and caps total output so a bad day in one domain can't bury the
//     dashboard in alerts.
//
// Alert shape: { domain, id, severity: 'red'|'amber'|'info', msg, cta? }
//   msg is plain text/HTML fragment (matches existing .dbi-rule-alert
//   rendering, which just does `${f.msg}` — see dashboard-insights.js).
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const _registry = []; // [{domain, id, fn}]
  const MAX_ALERTS_TOTAL = 8;     // hard ceiling across all domains
  const MAX_ALERTS_PER_RULE = 3;  // one noisy rule (e.g. 40 low-cover items) can't dominate

  const SEVERITY_RANK = { red: 0, amber: 1, info: 2 };

  function aimRulesRegister(domain, id, fn) {
    if (typeof fn !== 'function') return;
    // Replace-on-re-register rather than duplicate, so a script that
    // re-runs (hot reload during dev, or a defensive double-include)
    // doesn't double-fire the same rule.
    const existingIdx = _registry.findIndex(r => r.domain === domain && r.id === id);
    const entry = { domain, id, fn };
    if (existingIdx !== -1) _registry[existingIdx] = entry;
    else _registry.push(entry);
  }

  function aimRulesCheckAll() {
    let all = [];
    for (const { domain, id, fn } of _registry) {
      let result;
      try {
        result = fn();
      } catch (e) {
        // One domain's data not being ready yet (e.g. Stock Ledger never
        // synced) must not break every other domain's alerts.
        continue;
      }
      if (!result) continue;
      const arr = Array.isArray(result) ? result : [result];
      const capped = arr.slice(0, MAX_ALERTS_PER_RULE).map(a => ({
        domain, id,
        severity: a.severity || 'amber',
        msg: a.msg || '',
        cta: a.cta || null,
      })).filter(a => a.msg);
      all = all.concat(capped);
    }
    all.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 1) - (SEVERITY_RANK[b.severity] ?? 1));
    return all.slice(0, MAX_ALERTS_TOTAL);
  }

  window.aimRulesRegister = aimRulesRegister;
  window.aimRulesCheckAll = aimRulesCheckAll;
})();
