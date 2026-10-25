// ══════════════════════════════════════════════════════════════════════
// DASHBOARD CONTROLS  —  BT Sales App  ·  Rule-Based Intelligence Plan §2
//
// One shared UI component set, built once against Sales, reused by any
// domain with a month-indexed array (Manager's payroll trend, Inventory's
// velocity-over-time once that's snapshotted). Two layers in one file:
//
//   Floor 3 (pure calc, no DOM) — resolvePreset(), sliceMonthly(),
//   getComparePeriod(). Alongside js/shared/summary-calc.js in spirit;
//   kept in this file rather than split into an ES module because every
//   current consumer (dashboard.js, and the Inventory/Manager dashboards
//   built alongside this) is a classic script, and there's nothing here
//   that needs to run outside the browser (unlike summary-calc.js, which
//   also runs in the WhatsApp briefing's Edge Function).
//
//   Floor 5 (DOM) — renderRangeBar(), attachDrilldown(). Pure
//   HTML-string + Chart.js-option generation; callers own the actual
//   chart instance and re-render.
//
// Public API: window.DashboardControls = { resolvePreset, sliceMonthly,
//   getComparePeriod, renderRangeBar, attachDrilldown, monthSortVal }
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  /* ────────────────────────────────────────────────────────────────
     FLOOR 3 — PURE CALC
  ──────────────────────────────────────────────────────────────── */

  // Sortable integer for a "Month Year" string (e.g. "July 2026"),
  // or -1 if unparseable — same convention as Analytics._monthSortVal /
  // manager-shared.js's mgrMonths(), duplicated here (not imported) for
  // the same "no cross-file coupling for one 3-line helper" reason
  // resolvePreset/sliceMonthly are pure to begin with.
  function monthSortVal(my) {
    const p = String(my || '').split(' ');
    const mi = MONTH_NAMES.indexOf(p[0]);
    const yr = parseInt(p[1], 10);
    return mi >= 0 && !isNaN(yr) ? yr * 12 + mi : -1;
  }

  const PRESETS = ['3M', '6M', '12M', '24M', 'YTD', 'ALL'];

  // rows: array of objects with a `.Month_Year` (or caller-specified
  // `monthKey`) field, ALREADY SORTED OLDEST→NEWEST (same convention as
  // the global MONTHLY array) — mirrors the exact shape dashboard.js's
  // own MONTHLY.slice(-12) calls already assume.
  function resolvePreset(rows, preset, opts) {
    opts = opts || {};
    const key = opts.monthKey || 'Month_Year';
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return [];

    switch (preset) {
      case '3M':  return list.slice(-3);
      case '6M':  return list.slice(-6);
      case '12M': return list.slice(-12);
      case '24M': return list.slice(-24);
      case 'YTD': {
        const lastYr = String(list[list.length - 1][key] || '').split(' ')[1];
        return list.filter(r => String(r[key] || '').split(' ')[1] === lastYr);
      }
      case 'ALL':
      default:
        return list.slice();
    }
  }

  // Alias — the plan names this separately (§2) for the monthly-specific
  // case; identical behavior to resolvePreset today, kept as its own
  // named entry point in case Monthly's slicing rules ever diverge from
  // a more general "any row array" preset (e.g. daily data).
  function sliceMonthly(monthly, preset) {
    return resolvePreset(monthly, preset, { monthKey: 'Month_Year' });
  }

  // The equivalent-length period immediately BEFORE the resolved slice —
  // what "Compare" overlays. For 'YTD' this is the same Jan-through-
  // current-month span of the PRIOR year (a fair like-for-like), not
  // just "the months before Jan" (which would compare partial-year data
  // against a different number of months). Returns [] if there isn't
  // enough history to compare against, rather than a misleadingly
  // short/empty-looking comparison series.
  function getComparePeriod(rows, preset, opts) {
    opts = opts || {};
    const key = opts.monthKey || 'Month_Year';
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return [];

    if (preset === 'ALL') return []; // nothing to compare "all time" against

    if (preset === 'YTD') {
      const current = resolvePreset(list, 'YTD', opts);
      if (!current.length) return [];
      const monthsIn = current.length;
      const lastYr = parseInt(String(current[current.length - 1][key] || '').split(' ')[1], 10);
      const prevYr = String(lastYr - 1);
      const prevYrMonths = list.filter(r => String(r[key] || '').split(' ')[1] === prevYr);
      // Match the same number of months (Jan..current month) from the prior year.
      return prevYrMonths.slice(0, monthsIn);
    }

    const n = { '3M': 3, '6M': 6, '12M': 12, '24M': 24 }[preset] || 0;
    if (!n) return [];
    const current = list.slice(-n);
    if (!current.length) return [];
    const firstSortVal = monthSortVal(current[0][key]);
    const before = list.filter(r => monthSortVal(r[key]) < firstSortVal);
    return before.slice(-n);
  }

  /* ────────────────────────────────────────────────────────────────
     FLOOR 5 — DOM
  ──────────────────────────────────────────────────────────────── */

  const _dcStyleId = 'dashboard-controls-styles';
  function _injectStyles() {
    if (document.getElementById(_dcStyleId)) return;
    const el = document.createElement('style');
    el.id = _dcStyleId;
    el.textContent = `
.dc-range-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
.dc-preset-btn {
  font-size:11px; font-weight:600; padding:4px 10px; border-radius:99px;
  border:1px solid var(--border); background:var(--surface); color:var(--muted);
  cursor:pointer; transition:background .15s,color .15s,border-color .15s;
}
.dc-preset-btn:hover { border-color:var(--accent); color:var(--accent); }
.dc-preset-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
.dc-compare-toggle {
  display:flex; align-items:center; gap:5px; font-size:11px; color:var(--muted);
  cursor:pointer; margin-left:auto; user-select:none;
}
.dc-compare-toggle input { accent-color:var(--accent); cursor:pointer; }
`;
    document.head.appendChild(el);
  }

  // Renders the preset pills + optional compare checkbox into `containerEl`.
  // Caller owns all state; this is a pure renderer + event wiring, same
  // contract as every other *_build*() function in this app — call it
  // again any time active/compareOn changes to re-render.
  //
  // opts: {
  //   presets: string[] (default full PRESETS list),
  //   active: string (currently selected preset),
  //   onChange: (preset) => void,
  //   compareEnabled: bool (show the compare checkbox at all),
  //   compareOn: bool (current compare state),
  //   onCompareToggle: (bool) => void,
  // }
  function renderRangeBar(containerEl, opts) {
    _injectStyles();
    if (!containerEl) return;
    opts = opts || {};
    const presets = opts.presets || PRESETS;
    const active = opts.active || '12M';
    const uid = 'dc' + Math.random().toString(36).slice(2, 8);

    window['_dcOnChange_' + uid] = opts.onChange || function () {};
    window['_dcOnCompare_' + uid] = opts.onCompareToggle || function () {};

    const btns = presets.map(p => `
      <button type="button" class="dc-preset-btn${p === active ? ' active' : ''}"
        onclick="window._dcOnChange_${uid}('${p}')">${p}</button>`).join('');

    const compareHtml = opts.compareEnabled ? `
      <label class="dc-compare-toggle">
        <input type="checkbox" ${opts.compareOn ? 'checked' : ''}
          onchange="window._dcOnCompare_${uid}(this.checked)">
        Compare vs previous period
      </label>` : '';

    containerEl.innerHTML = `<div class="dc-range-bar">${btns}${compareHtml}</div>`;
  }

  // Wires a Chart.js click handler that resolves which data-array item
  // was clicked (by index, matching the chart's own label order) and
  // invokes onPick(item). Safe to call on any Chart.js instance —
  // doesn't touch chart.data, just adds/replaces options.onClick.
  function attachDrilldown(chartInstance, dataArray, onPick) {
    if (!chartInstance || typeof onPick !== 'function') return;
    chartInstance.options.onClick = (evt, elements) => {
      if (!elements || !elements.length) return;
      const idx = elements[0].index;
      const item = dataArray[idx];
      if (item !== undefined) onPick(item);
    };
    chartInstance.update('none'); // 'none' — no animation, this is a config-only change
  }

  window.DashboardControls = {
    monthSortVal,
    resolvePreset,
    sliceMonthly,
    getComparePeriod,
    renderRangeBar,
    attachDrilldown,
  };
})();
