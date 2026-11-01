// ══════════════════════════════════════════════════════════════════════
// REORDER REPORT — the inverse of Excess Working: instead of flagging
// stock that's TOO HIGH relative to sales, this flags stock that's
// running out too soon relative to sales, ranks the shortfall by sale
// value, and tells you how much to buy.
//
// Source of the raw rows: Stock Ledger's own loaded inventory
// (js/inventory/stockledger.js exposes it live via window.StockLedgerApp.getRawRows()) —
// same one-load, one-source-of-truth pattern as Excess Working, just
// reading every row instead of only the pre-filtered excess ones, since
// "low cover" needs the full item list to judge.
//
// For each of the three sale windows already on every inventory row
// (netQty30Days / netQty60Days / netQty90Days):
//   dailyRate_w   = saleQty_w / w
//   daysCover_w   = stock / dailyRate_w        (null if nothing sold in that window)
//   demandQty_w   = max(0, dailyRate_w * coverDaysThreshold - stock)
//
// A "primary" window (30/60/90, user-selected) drives which rows qualify
// (daysCover_primary < coverDaysThreshold, and something must have sold
// in that window) and which sale value ranks the Top N. All three
// windows are still shown side-by-side in the table for comparison —
// the primary window's three columns are highlighted.
//
// 2026-07-25 update: saleValue_w now comes from the real historical
// saleValueExclTax field (qty × pack-aware, discount-adjusted price,
// VAT stripped out — computed server-side in sync.ps1), not qty ×
// current unit price. Tax-exempt products are unaffected either way
// (their inclTax and exclTax values are already identical), so this is
// a pure accuracy improvement on taxed items, not a per-product branch
// anyone needs to configure. Falls back to the old qty × unitPrice
// estimate only for rows that predate this field. demandValueP (the
// cost to buy MORE stock) intentionally still uses current unitPrice —
// that's a forward-looking purchase cost, not a historical sale value.
//
// 2026-07-29 fix: filter ORDER was backwards for the Top N tab (and for
// Cover Dashboard's "<7d cover · Top 500 by 30d value" stat, which reads
// from the same engine via getSummaryFor). It used to filter every row
// for daysCover < coverDays FIRST, then rank the survivors by sale value
// and cap at Top N — so the N cap only ever trimmed an already-filtered
// pool instead of first narrowing to "the N items that actually matter
// by sale value." Verified against Candela's own C-19 report (which
// runs the full, unfiltered item universe, ranks by 30-day Sale Amount,
// takes the top 500, and only THEN applies the <7-day filter): the old
// order flagged ~474 items against Candela's 48 for the same data,
// because it let plenty of low-value slow-movers into the flagged set
// that never would have made the top-500-by-value cut in the first
// place. Fixed by splitting the pipeline into three stages — compute
// every row's metrics (computeAllRows), rank ALL of them by sale value
// and cap at Top N (topNByValue), THEN filter that capped pool by cover
// days (lowCoverWithin) — reproduced Candela's 48-item list exactly.
// The "All Flagged" tab intentionally keeps the old unranked, uncapped
// view (every item under the cover threshold, regardless of value) —
// that's a broader diagnostic view for exploration, not meant to match
// Candela's own report, so it still runs lowCoverWithin() directly over
// computeAllRows() with no Top N stage. Only the Top N tab and
// getSummaryFor() (Candela-equivalent paths) got the ordering fix.
//
// 2026-07-30 update: saleQtyWDays / saleValueWDays (and therefore
// daysCoverWDays / demandQtyWDays / saleQtyP / saleValueP / daysCoverP /
// demandQtyP — everything the reorder decision is actually based on)
// now fold in today's live sales (netQtyToday / saleValueExclTaxToday)
// on top of the w-day historical window, instead of reflecting only
// "through yesterday." The daily rate divides by w + todayFraction
// (elapsed fraction of today) rather than plain w, so a big morning
// rush doesn't get diluted by treating today as a full day before it
// is one. See computeAllRows() for the detailed reasoning. Pure w-day
// historical numbers are still available as saleQty{w}Historical /
// saleValue{w}Historical (e.g. saleQty30Historical) on each computed
// row for anyone who needs the old "clean window" figure (e.g.
// exports), just not surfaced as a table column by default. Requires
// stockledger.js's
// normalizeSupabaseRow() to map net_qty_today /
// sale_value_excl_tax_today (added the same day) — falls back to 0 for
// any row loaded from a source that predates those fields.
//
// 2026-07-30 fix: every saleValue{w}/saleValueToday figure (and so
// saleValueP, and the export/summary totals built on it) used to
// always read the *_excl_tax field, even for taxable products — so a
// taxed item's ranking/reorder-value understated what it actually
// rings up as, while an exempt item's number happened to already be
// correct (its inclTax and exclTax fields are identical, since there's
// no tax to strip out). Now picks the field per row based on
// isTaxable: tax-exempt items (e.g. Panadol) read *_excl_tax as
// before — same number, right field name — while taxable items now
// read *_incl_tax, so their sale value matches what was actually
// charged including sales tax. Purely a field-selection change; the
// underlying qty/pack/discount math server-side is unchanged.
//
// 2026-07-30 (later) update: whether today's live sales fold into the
// w-day window is now a UI toggle ("+ Today" / "Historical Only" in
// the filter row), not fixed on. Reason: folding today in (the
// previous, only behavior) can drift from Candela's own C-19 report,
// which ranks/filters off historical windows only — "Historical Only"
// reproduces that exactly; "+ Today" (still the default) keeps the
// most current demand signal for day-to-day buying decisions. Persisted
// per-device (bt_reorder_includetoday_v1). Only affects the filtered/
// ranked math (saleQty/saleValue/daysCover/demandQty per window); the
// "Sold Today" column always shows real today's activity regardless,
// since that's an informational figure, not part of the toggle.
// getSummaryFor() (Cover Dashboard's fixed stat) is unaffected by this
// page's own toggle by design — it takes its own includeToday param,
// defaulting to true (pre-toggle behavior) same as before.
//
// 2026-07-30 (later still) — added a "Columns" dropdown (both tabs) to
// show/hide any of the table's columns, persisted per-device
// (bt_reorder_hiddencols_v1). At least one column is always kept
// visible — the checkbox for the last remaining one silently reverts
// itself rather than leaving an empty table. Excel/PDF export are
// unaffected by this and always include every column, same as before;
// added a new "Print" button that funnels through the app's one shared
// Print engine (js/lib/print.js, same one every other report uses) and
// DOES respect the current column selection — the printed table only
// contains whatever's checked in the Columns dropdown at the time.
// ══════════════════════════════════════════════════════════════════════

import { escapeHtml as esc } from '../shared/html.js';
import { $, $$, WINDOWS, computeAllRows, fmt, loadSettings, lowCoverWithin, recompute, refreshInTransitMap, saveCoverDays, saveGroup, saveHiddenCols, saveIncludeToday, saveTopN, saveWindow, say, state, topNByValue } from './reorder-data.js';
import { allCols, columnsMenuHtml, groupedBody, rowHtml, sortRows, theadHtml, visibleCols } from './reorder-table.js';
import { exportAllExcel, exportAllPdf, exportTopNExcel, exportTopNPdf, printAllFlagged, printTopN } from './reorder-export.js';
window.ReorderReportApp = (function () {
  "use strict";
  let initialized = false;

  function refreshFromStockLedger(silent) {
    const SL = window.StockLedgerApp;
    if (SL && typeof SL.hasData === 'function' && SL.hasData()) {
      state.rawRows = typeof SL.getRawRows === 'function' ? SL.getRawRows() : [];
      state.asOf = typeof SL.getAsOfLabel === 'function' ? SL.getAsOfLabel() : '';
      state.dataReady = true;
    } else {
      state.rawRows = [];
      state.dataReady = false;
    }
    refreshInTransitMap();
    // Best-effort background refresh from Supabase (str-bridge.js
    // de-dupes concurrent callers and no-ops within its own 1-min
    // cache window) — re-renders once fresher STR data lands, same
    // "don't block on it" spirit as everything else on this page.
    if (typeof window.strBridgeRefresh === 'function') {
      window.strBridgeRefresh().then(() => {
        refreshInTransitMap();
        recompute();
        render();
      }).catch(() => { /* best-effort — In Transit just stays at whatever was cached */ });
    }
    recompute();
    if (!silent) say(state.dataReady ? ('Pulled ' + state.rawRows.length + ' items from Stock Ledger') : 'No Stock Ledger data loaded yet');
  }

  function windowSegHtml() {
    return `<div class="window-seg" id="rorWindowSeg">` +
      WINDOWS.map(w => `<button class="${state.window === w ? 'active' : ''}" data-action="ror-window" data-win="${w}">${w}d</button>`).join('') +
      `</div>`;
  }

  function controlsHtml(showTopN, allColsList) {
    return `
      <div class="filter-row">
        <label class="field-label" style="margin:0;">Window</label>
        ${windowSegHtml()}
        <label class="field-label" style="margin:0;">Cover &lt;</label>
        <input type="number" id="rorCoverDaysInput" class="num-input" value="${state.coverDays}" min="1" step="1">
        <span class="hint">days</span>
        <div class="toggle-group" id="rorIncludeTodayToggle" title="Whether today's live sales are folded into the 30/60/90-day sale qty/value used for filtering and ranking">
          <button class="${state.includeToday ? 'active' : ''}" data-action="ror-include-today" data-val="1">+ Today</button>
          <button class="${!state.includeToday ? 'active' : ''}" data-action="ror-include-today" data-val="0">Historical Only</button>
        </div>
        ${showTopN ? `
        <label class="field-label" style="margin:0 0 0 8px;">Top</label>
        <input type="number" id="rorTopNInput" class="num-input" value="${state.topN}" min="1" step="1">
        <button class="btn btn-sm" data-topn-preset="10">10</button>
        <button class="btn btn-sm" data-topn-preset="20">20</button>
        <button class="btn btn-sm" data-topn-preset="50">50</button>
        <button class="btn btn-sm" data-topn-preset="100">100</button>` : ''}
      </div>
      <div class="filter-row">
        <div class="search-box"><span class="material-symbols-outlined">search</span><input type="text" id="rorSearchBox" placeholder="Search code or name…" value="${esc(state.search)}"></div>
        <div class="toggle-group" id="rorGroupToggle">
          <button class="${!state.groupBySupplier ? 'active' : ''}" data-action="ror-group" data-group="0">List</button>
          <button class="${state.groupBySupplier ? 'active' : ''}" data-action="ror-group" data-group="1">By Supplier</button>
        </div>
        ${columnsMenuHtml(allColsList)}
        <div class="export-actions">
          <button class="btn" data-action="${showTopN ? 'ror-print-topn' : 'ror-print-all'}"><span class="material-symbols-outlined">print</span>Print</button>
          <button class="btn btn-primary" data-action="${showTopN ? 'ror-export-topn-excel' : 'ror-export-all-excel'}"><span class="material-symbols-outlined">table_view</span>Excel</button>
          <button class="btn" data-action="${showTopN ? 'ror-export-topn-pdf' : 'ror-export-all-pdf'}"><span class="material-symbols-outlined">picture_as_pdf</span>PDF</button>
        </div>
      </div>`;
  }

  function statsHtml(shownRows, flaggedTotal) {
    const saleVal = shownRows.reduce((s, r) => s + r.saleValueP, 0);
    const demQty = shownRows.reduce((s, r) => s + r.demandQtyP, 0);
    const demVal = shownRows.reduce((s, r) => s + r.demandValueP, 0);
    const maxStat = Math.max(saleVal, demVal, 1);
    return `
      <div class="stat-grid">
        <div class="stat retained"><div class="stat-top"><div class="hint">Items Shown</div></div><div class="val">${shownRows.length}</div><div class="hint">of ${flaggedTotal} flagged in total</div></div>
        <div class="stat corrected"><div class="stat-top"><div class="hint">Total Sale Value</div></div><div class="val">${fmt(saleVal)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, saleVal / maxStat * 100)}%;"></div></div></div>
        <div class="stat loose"><div class="stat-top"><div class="hint">Total Reorder Qty</div></div><div class="val">${fmt(demQty)}</div><div class="hint">units, ${state.window}d window</div></div>
        <div class="stat excess"><div class="stat-top"><div class="hint">Total Reorder Value</div></div><div class="val">${fmt(demVal)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, demVal / maxStat * 100)}%;"></div></div></div>
      </div>`;
  }

  function tableHtml(rows, cols) {
    const q = (state.search || '').trim();
    if (q) {
      rows = (typeof window.BTSearch !== 'undefined')
        ? window.BTSearch.filterAndRank(rows, q, ['code', 'name'])
        : rows.filter(r => (r.code || '').toLowerCase().includes(q.toLowerCase()) || (r.name || '').toLowerCase().includes(q.toLowerCase()));
    }
    rows = sortRows(rows, state.sort);
    const body = rows.length
      ? (state.groupBySupplier ? groupedBody(rows, cols, state.window) : rows.map(r => rowHtml(r, cols, state.window)).join(''))
      : `<tr class="empty-row"><td colspan="${cols.length}" class="no-data-note">No items match.</td></tr>`;
    return { rows, html: `
      <div class="tablewrap">
        <table>
          <thead id="rorThead">${theadHtml(cols, state.sort, state.window)}</thead>
          <tbody id="rorTableBody">${body}</tbody>
        </table>
      </div>` };
  }

  function renderTopNTab() {
    const top = state.topNFlagged;
    const allC = allCols();
    const cols = visibleCols(allC);
    const { rows: shownAfterSearch, html: tableHtmlStr } = tableHtml(top, cols);
    return `
      ${statsHtml(shownAfterSearch, state.computed.length)}
      <div class="card">
        <div class="card-head"><h3>Top ${state.topN} by Sale Value</h3><span class="hint">${state.window}d window · cover under ${state.coverDays}d</span></div>
        ${controlsHtml(true, allC)}
        ${tableHtmlStr}
      </div>`;
  }

  function renderAllFlaggedTab() {
    const allC = allCols();
    const cols = visibleCols(allC);
    const { rows: shownAfterSearch, html: tableHtmlStr } = tableHtml(state.computed, cols);
    return `
      ${statsHtml(shownAfterSearch, state.computed.length)}
      <div class="card">
        <div class="card-head"><h3>All Flagged Items</h3><span class="hint">no Top N cap — every item under the cover threshold, unranked by value (broader than the Top N tab; not what Candela's own report shows)</span></div>
        ${controlsHtml(false, allC)}
        ${tableHtmlStr}
      </div>`;
  }

  function render() {
    const root = document.getElementById('page-reorder');
    if (!root) return;

    if (!state.dataReady) {
      const body = $('#ror-body', root);
      if (body) {
        body.innerHTML = `
          <div class="no-data-note">
            <strong>No Stock Ledger data loaded yet</strong>
            Reorder Report reads every item straight from the Stock Ledger page's loaded inventory.
            Load your inventory file there first (Supabase, Dropbox, or upload), then come back here.
          </div>
          <div class="reload-row" style="justify-content:center;">
            <button class="btn btn-primary" data-action="ror-goto-stockledger">Go to Stock Ledger</button>
            <button class="btn" data-action="ror-refresh">Check again</button>
          </div>`;
      }
      const asof = $('#ror-asofLine', root);
      if (asof) asof.textContent = '';
      return;
    }

    const asof = $('#ror-asofLine', root);
    if (asof) asof.textContent = 'Reference date: ' + (state.asOf || '—') + ' · ' + state.rawRows.length + ' items loaded · ' + state.computed.length + ' flagged (' + state.window + 'd window)';

    $$('.ror-tab', root).forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    const body = state.tab === 'all' ? renderAllFlaggedTab() : renderTopNTab();

    const bodyEl = $('#ror-body', root);
    if (bodyEl) bodyEl.innerHTML = `
      <div class="reload-row">
        <span class="badge">${state.tab === 'all' ? 'All Flagged' : 'Top N'}</span>
        <button class="btn btn-sm" data-action="ror-refresh"><span class="material-symbols-outlined">refresh</span>Refresh from Stock Ledger</button>
      </div>
      ${body}`;
  }

  // ---------- EVENTS ----------
  function wireOnce(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action],[data-tab],[data-topn-preset]');
      const th = e.target.closest('th.sortable');
      if (th) {
        const key = th.dataset.key;
        if (state.sort.key === key) state.sort.dir *= -1; else { state.sort.key = key; state.sort.dir = -1; }
        render();
        return;
      }
      if (!btn) return;

      const tabBtn = e.target.closest('.ror-tab');
      if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); return; }

      const action = btn.dataset.action;
      if (action === 'ror-refresh') { refreshFromStockLedger(false); render(); return; }
      if (action === 'ror-goto-stockledger') { if (typeof window.navigateTo === 'function') window.navigateTo('stockledger'); return; }
      if (action === 'ror-window') {
        state.window = Number(btn.dataset.win) || 60;
        saveWindow(); recompute(); render(); return;
      }
      if (action === 'ror-group') { state.groupBySupplier = btn.dataset.group === '1'; saveGroup(); render(); return; }
      if (action === 'ror-include-today') { state.includeToday = btn.dataset.val === '1'; saveIncludeToday(); recompute(); render(); return; }
      if (action === 'ror-group-toggle') {
        const supplier = btn.dataset.supplier || '';
        if (state.collapsedGroups.has(supplier)) state.collapsedGroups.delete(supplier);
        else state.collapsedGroups.add(supplier);
        render();
        return;
      }
      if (action === 'ror-export-topn-excel') { exportTopNExcel(); return; }
      if (action === 'ror-export-topn-pdf') { exportTopNPdf(); return; }
      if (action === 'ror-export-all-excel') { exportAllExcel(); return; }
      if (action === 'ror-export-all-pdf') { exportAllPdf(); return; }
      if (action === 'ror-print-topn') { printTopN(); return; }
      if (action === 'ror-print-all') { printAllFlagged(); return; }
      if (action === 'ror-cols-toggle') { state.colsMenuOpen = !state.colsMenuOpen; render(); return; }
      if (action === 'ror-cols-all') { state.hiddenCols.clear(); saveHiddenCols(); render(); return; }
      if (btn.dataset.topnPreset) { state.topN = Number(btn.dataset.topnPreset); saveTopN(); render(); return; }
    });

    root.addEventListener('input', function (e) {
      if (e.target.matches('[data-colkey]')) {
        const key = e.target.dataset.colkey;
        if (!e.target.checked) {
          // Keep at least one column visible — hiding the last one
          // would leave an empty, useless table.
          const stillVisible = allCols().filter(c => c.key !== key && !state.hiddenCols.has(c.key));
          if (!stillVisible.length) {
            e.target.checked = true;
            say('At least one column must stay visible', 'w');
            return;
          }
          state.hiddenCols.add(key);
        } else {
          state.hiddenCols.delete(key);
        }
        saveHiddenCols(); render();
        return;
      }
      if (e.target.id === 'rorSearchBox') { state.search = e.target.value; render(); return; }
      if (e.target.id === 'rorCoverDaysInput') {
        const v = parseFloat(e.target.value);
        state.coverDays = (v && v > 0) ? v : 15;
        saveCoverDays(); recompute(); render();
        return;
      }
      if (e.target.id === 'rorTopNInput') {
        const v = parseInt(e.target.value, 10);
        state.topN = (v && v > 0) ? v : 50;
        saveTopN(); render();
        return;
      }
    });
  }

  // ---------- INIT ----------
  function init() {
    const root = document.getElementById('page-reorder');
    if (!root) { console.error('ReorderReportApp.init(): #page-reorder not found in the DOM yet.'); return; }
    if (!initialized) {
      initialized = true;
      loadSettings();
      wireOnce(root);
    }
    refreshFromStockLedger(true);
    render();
  }

  // ── Cover Dashboard hero stats ──────────────────────────────────────
  // Safe to call cold (this page's own tab never opened this session) —
  // pulls straight from Stock Ledger and runs the exact same
  // computeAllRows()/topNByValue()/lowCoverWithin() pipeline the Top N
  // tab uses, just with whatever window/coverDays/topN the caller asks
  // for (e.g. Cover's "<7 days, Top 500 by 30d sale value" stat),
  // independent of this page's own persisted settings so visiting
  // Reorder Report and changing its controls never affects Cover's
  // fixed stat. Ranks by sale value and caps at topN FIRST, then
  // applies the cover-days filter — this is what makes the number here
  // match Candela's own C-19 report (see header comment for why the old
  // order was wrong). includeToday defaults to true (pre-toggle
  // behavior) since Cover's stat is deliberately independent of the
  // page's own Include Today toggle too — pass false explicitly if a
  // caller wants Cover's stat to match the historical-only view instead.
  // Rows for an explicit (windowDays, coverDaysThreshold, topN, includeToday)
  // combination, independent of this page's own persisted controls — same
  // pipeline as recompute()'s Top N tab (rank ALL items by sale value, cap
  // at topN, THEN filter by cover days) so a caller passing (30, 7, 500,
  // true) always gets exactly what the Top N tab shows with those same
  // filters, and exactly the rows getSummaryFor()'s stats are built from —
  // no separate re-derivation to drift out of sync.
  function getFlaggedRowsFor(windowDays, coverDaysThreshold, topN, includeToday) {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return [];
    const w = WINDOWS.indexOf(windowDays) !== -1 ? windowDays : 30;
    const cd = coverDaysThreshold || 7;
    const allRows = computeAllRows(rawRows, w, cd, includeToday !== false);
    return lowCoverWithin(topNByValue(allRows, topN || 500), cd);
  }

  // Aggregate stats for the same explicit-params rows above (e.g. Cover's
  // "<7 days, Top 500 by 30d sale value" hero stat) — now just a reduce
  // over getFlaggedRowsFor()'s own rows, so the summary and the row list
  // it's describing can never disagree.
  function getSummaryFor(windowDays, coverDaysThreshold, topN, includeToday) {
    const SL = window.StockLedgerApp;
    if (!(SL && typeof SL.hasData === 'function' && SL.hasData())) return null;
    const w = WINDOWS.indexOf(windowDays) !== -1 ? windowDays : 30;
    const cd = coverDaysThreshold || 7;
    const shown = getFlaggedRowsFor(w, cd, topN, includeToday);
    return {
      window: w,
      coverDaysThreshold: cd,
      itemsFlagged: shown.length,
      itemsShown: shown.length,
      totalSaleValue: shown.reduce((s, r) => s + r.saleValueP, 0),
      totalReorderQty: shown.reduce((s, r) => s + r.demandQtyP, 0),
      totalReorderValue: shown.reduce((s, r) => s + r.demandValueP, 0),
    };
  }

  // Rows using this page's own persisted window/coverDays/topN/
  // includeToday settings (unlike getSummaryFor/getFlaggedRowsFor, which
  // are deliberately independent of them for Cover's fixed stats). Safe to
  // call cold — pulls fresh from Stock Ledger rather than relying on this
  // tab having been opened this session. Returns [] only if Stock Ledger
  // itself has no data loaded.
  function getFlaggedRows() {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return [];
    const cd = Number(state.coverDays) || 15;
    const allRows = computeAllRows(rawRows, state.window, cd, state.includeToday);
    return lowCoverWithin(topNByValue(allRows, state.topN), cd);
  }

  // Top-selling items by sale value over a window, NOT limited to
  // reorder-flagged/low-cover items (no lowCoverWithin filter) — used by
  // Cover's Sale Velocity chart, which wants the best sellers overall,
  // "including today" by default so it always matches the Reorder
  // Report's own default view rather than the page's persisted toggle.
  function getTopSellersFor(windowDays, topN, includeToday) {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return [];
    const w = WINDOWS.indexOf(windowDays) !== -1 ? windowDays : 30;
    const allRows = computeAllRows(rawRows, w, 7, includeToday !== false);
    return topNByValue(allRows, topN || 8);
  }

  // Total flagged count for explicit (windowDays, coverDaysThreshold), with
  // NO Top N cap — the "of 449 flagged in total" half of the Reorder
  // Report's own "Items Shown: 42 of 449 flagged in total" stat, so Cover's
  // header can quote the identical two numbers.
  function getFlaggedTotalFor(windowDays, coverDaysThreshold, includeToday) {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return 0;
    const w = WINDOWS.indexOf(windowDays) !== -1 ? windowDays : 30;
    const cd = coverDaysThreshold || 7;
    const allRows = computeAllRows(rawRows, w, cd, includeToday !== false);
    return lowCoverWithin(allRows, cd).length;
  }

  return {
    init: init,
    getSummaryFor: getSummaryFor,
    getFlaggedRows: getFlaggedRows,
    getFlaggedRowsFor: getFlaggedRowsFor,
    getFlaggedTotalFor: getFlaggedTotalFor,
    getTopSellersFor: getTopSellersFor,
  };
})();
