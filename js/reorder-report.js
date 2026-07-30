// ══════════════════════════════════════════════════════════════════════
// REORDER REPORT — the inverse of Excess Working: instead of flagging
// stock that's TOO HIGH relative to sales, this flags stock that's
// running out too soon relative to sales, ranks the shortfall by sale
// value, and tells you how much to buy.
//
// Source of the raw rows: Stock Ledger's own loaded inventory
// (js/stockledger.js exposes it live via window.StockLedgerApp.getRawRows()) —
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
// Print engine (js/print.js, same one every other report uses) and
// DOES respect the current column selection — the printed table only
// contains whatever's checked in the Columns dropdown at the time.
// ══════════════════════════════════════════════════════════════════════

window.ReorderReportApp = (function () {
  "use strict";
  let initialized = false;

  const WINDOW_KEY = 'bt_reorder_window_v1';
  const COVERDAYS_KEY = 'bt_reorder_coverdays_v1';
  const TOPN_KEY = 'bt_reorder_topn_v1';
  const GROUP_KEY = 'bt_reorder_group_v1';
  const INCLUDETODAY_KEY = 'bt_reorder_includetoday_v1';
  const HIDDENCOLS_KEY = 'bt_reorder_hiddencols_v1';

  const WINDOWS = [30, 60, 90];

  const state = {
    tab: 'topn',            // 'topn' | 'all'
    window: 90,              // primary window: 30 | 60 | 90
    coverDays: 15,            // "less than N days stock" threshold
    topN: 50,
    search: '',
    groupBySupplier: false,
    includeToday: true,      // fold today's live sales into the w-day window (toggle) — see header note
    collapsedGroups: new Set(),
    sort: { key: 'saleValueP', dir: -1 },
    hiddenCols: new Set(),    // column keys currently hidden from the table AND the print view
    colsMenuOpen: false,      // transient (not persisted) — whether the Columns dropdown is open
    rawRows: [],
    computed: [],             // every qualifying row (no Top N cap)
    asOf: '',
    dataReady: false,
  };

  // ---------- helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
  function fmt(n) { return (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
  function fmtDays(v) { if (v == null) return '—'; if (!isFinite(v)) return '∞'; return (Math.round(v * 10) / 10).toLocaleString('en-PK'); }
  function todayStamp() { return new Date().toISOString().slice(0, 10); }
  function say(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type); }

  function repoGet(key) {
    try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function repoSet(key, value) {
    try { if (window.Repository) window.Repository.setItem(key, value); else localStorage.setItem(key, value); }
    catch (e) { /* ignore */ }
  }

  function loadSettings() {
    const w = parseInt(repoGet(WINDOW_KEY), 10);
    state.window = WINDOWS.indexOf(w) !== -1 ? w : 90;
    const cd = parseFloat(repoGet(COVERDAYS_KEY));
    state.coverDays = (cd && cd > 0) ? cd : 15;
    const tn = parseInt(repoGet(TOPN_KEY), 10);
    state.topN = (tn && tn > 0) ? tn : 50;
    state.groupBySupplier = repoGet(GROUP_KEY) === '1';
    const it = repoGet(INCLUDETODAY_KEY);
    state.includeToday = (it === null) ? true : (it === '1'); // default on, matches pre-toggle behavior
    const hc = repoGet(HIDDENCOLS_KEY);
    state.hiddenCols = new Set(hc ? hc.split(',').filter(Boolean) : []);
  }
  function saveWindow() { repoSet(WINDOW_KEY, String(state.window)); }
  function saveCoverDays() { repoSet(COVERDAYS_KEY, String(state.coverDays)); }
  function saveTopN() { repoSet(TOPN_KEY, String(state.topN)); }
  function saveGroup() { repoSet(GROUP_KEY, state.groupBySupplier ? '1' : '0'); }
  function saveIncludeToday() { repoSet(INCLUDETODAY_KEY, state.includeToday ? '1' : '0'); }
  function saveHiddenCols() { repoSet(HIDDENCOLS_KEY, Array.from(state.hiddenCols).join(',')); }

  // ---------- CALCULATION ENGINE ----------
  // Computes every window's metrics for every raw row, unfiltered.
  // coverDays is still needed here even though nothing gets filtered on
  // it in this function — demandQty (how much to buy to reach the
  // target cover) is computed per-row against it.
  // 2026-07-30 update: sale windows now include today's live activity,
  // not just the clean w-day historical figure. sync.ps1 / the
  // inventory sync deliberately keeps netQtyWDays / saleValueExclTaxWDays
  // ending at yesterday 23:59:59 (so those numbers stay stable no matter
  // what time of day a sync runs), and reports today's sales separately
  // as netQtyToday / saleValueExclTaxToday. Reorder Report needs the
  // opposite property — the most current demand signal, right now — so
  // it adds the two together here. They never overlap (the w-day window
  // stops at yesterday, "today" starts at today 00:00), so this is a
  // straight sum, not double-counting.
  //
  // The daily rate then divides by effectiveDays = w + todayFraction
  // (how much of today has elapsed, e.g. 0.5 at noon) instead of plain
  // w — dividing today's partial-day sales by a whole extra day would
  // understate the rate early in the day and overstate it as the day
  // goes on. This is what "daysCover"/"demandQty" are computed from, so
  // this is the fix that makes the actual buy-quantity recommendation
  // correct, not just the sale-qty/value columns.
  //
  // includeToday (toggle added after user feedback that this should be
  // switchable, not fixed on): when true, behaves exactly as described
  // above. When false, every window's saleQty/saleValue/daysCover/
  // demandQty is the clean historical figure only (today's activity
  // excluded from the fold-in, effectiveDays back to plain w) — this is
  // what matches Candela's own C-19 report, which runs off historical
  // windows only. The "Sold Today" column (saleQtyToday/saleValueToday)
  // always reflects real today's activity regardless of this toggle —
  // it's an informational figure, not part of the filtered/ranked math.
  function computeAllRows(rawRows, primaryWindow, coverDays, includeToday) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayFraction = Math.min(1, Math.max(0, (now - startOfToday) / 86400000));
    const foldToday = includeToday !== false; // default true — matches pre-toggle behavior

    const rows = rawRows.map(r => {
      const stock = Number(r.stock) || 0;
      const unitPrice = Number(r.unitPrice) || 0;
      const isTaxable = !!r.isTaxable;

      // Which historical field is the "real" sale value for this row:
      // taxable items should show the customer-facing, tax-inclusive
      // figure; tax-exempt items show the (identical either way, but
      // named correctly) tax-exclusive figure. Non-taxable rows have
      // InclTax === ExclTax anyway (see inventory-bridge.js's header
      // note), so this only changes which field name is read for
      // taxable rows — it's not a numeric change for exempt items like
      // Panadol, just the correct field for ones that do carry VAT.
      const valueField = isTaxable ? 'saleValueInclTax' : 'saleValueExclTax';

      const todayQty = Number(r.netQtyToday) || 0;
      // Same "prefer real computed value, fall back to qty × unitPrice
      // only if the field is genuinely absent" pattern as the w-day
      // windows below — undefined/null means "field predates this sync",
      // not "zero sales today". Computed regardless of includeToday —
      // it's what "Sold Today" always displays, and it's what the
      // window fold-in adds in when the toggle is on.
      const rawTodayValue = r[valueField + 'Today'];
      const todayValue = (rawTodayValue !== undefined && rawTodayValue !== null)
        ? Number(rawTodayValue)
        : todayQty * unitPrice;

      // What actually gets folded into the window math — zeroed out
      // when the toggle is off, so saleQty/saleValue below reduce to
      // the pure historical figures.
      const foldQty = foldToday ? todayQty : 0;
      const foldValue = foldToday ? todayValue : 0;

      const out = {
        code: r.code || '', name: r.name || '',
        supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unspecified',
        company: r.company || '',
        stock, unitPrice,
        saleQtyToday: todayQty,
        saleValueToday: todayValue,
        isTaxable,
        taxPercent: Number(r.taxPercent) || 0,
      };
      WINDOWS.forEach(w => {
        const historicalQty = Number(r['netQty' + w + 'Days']) || 0;
        // Prefer the real historical sale value (qty × pack-aware,
        // discount-adjusted price) computed server-side in sync.ps1,
        // reading the incl-tax field for taxable products and the
        // excl-tax field for exempt ones (see valueField above). Falls
        // back to qty × current unit price only for rows that predate
        // this field (e.g. an older cached Dropbox upload) — undefined/
        // null means "field never existed on this row", not "zero
        // sales", so it's checked explicitly rather than with a falsy
        // check (0 is a legitimate real value here).
        const rawSaleValue = r[valueField + w + 'Days'];
        const historicalValue = (rawSaleValue !== undefined && rawSaleValue !== null)
          ? Number(rawSaleValue)
          : historicalQty * unitPrice;

        const saleQty = historicalQty + foldQty;
        const saleValue = historicalValue + foldValue;
        const windowEffectiveDays = w + (foldToday ? todayFraction : 0);
        const dailyRate = saleQty / windowEffectiveDays;
        const daysCover = dailyRate > 0 ? (stock / dailyRate) : null;
        const demandQty = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0;

        out['saleQty' + w] = saleQty;
        out['saleQty' + w + 'Historical'] = historicalQty; // pre-today reference, e.g. for exports
        out['saleValue' + w] = saleValue;
        out['saleValue' + w + 'Historical'] = historicalValue;
        out['daysCover' + w] = daysCover;
        out['demandQty' + w] = demandQty;
      });
      out.saleQtyP = out['saleQty' + primaryWindow];
      out.saleValueP = out['saleValue' + primaryWindow];
      out.daysCoverP = out['daysCover' + primaryWindow];
      out.demandQtyP = out['demandQty' + primaryWindow];
      out.demandValueP = out.demandQtyP * unitPrice;
      return out;
    });
    return rows;
  }

  // Cover-days filter, applied as its own explicit stage so callers can
  // choose whether to run it before or after ranking/capping. Qualifies
  // only if it actually sold something in the primary window (no rate,
  // no meaningful "days cover") AND that cover is under the threshold —
  // zero (or negative, e.g. a backorder) stock included on purpose,
  // that's the most urgent case.
  function lowCoverWithin(rows, coverDays) {
    return rows.filter(r => r.saleQtyP > 0 && r.daysCoverP != null && r.daysCoverP < coverDays);
  }

  function recompute() {
    const coverDays = Number(state.coverDays) || 15;
    const allRows = computeAllRows(state.rawRows, state.window, coverDays, state.includeToday);
    // "All Flagged" tab: every item under the cover threshold, unranked
    // and uncapped — a broader diagnostic view, not meant to reproduce
    // Candela's own report (see header comment).
    state.computed = lowCoverWithin(allRows, coverDays);
    // "Top N" tab: Candela's own order — rank ALL items by sale value,
    // cap at Top N, THEN filter that capped pool by cover days.
    state.topNFlagged = lowCoverWithin(topNByValue(allRows, state.topN), coverDays);
  }

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
    recompute();
    if (!silent) say(state.dataReady ? ('Pulled ' + state.rawRows.length + ' items from Stock Ledger') : 'No Stock Ledger data loaded yet');
  }

  // Ranks by sale value and caps at N. Only items that actually sold in
  // the primary window are eligible to be ranked — previously this was
  // guaranteed upstream by computeRows()'s own filter; now that ranking
  // can run over the full unfiltered row set (see recompute()), the
  // guard has to live here instead.
  function topNByValue(rows, n) {
    return rows.filter(r => r.saleQtyP > 0)
      .sort((a, b) => b.saleValueP - a.saleValueP)
      .slice(0, Math.max(1, n || 50));
  }

  function sortRows(rows, sort) {
    const key = sort.key, dir = sort.dir;
    const isDaysCover = key.indexOf('daysCover') === 0;
    return [...rows].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || '')) * dir;
      }
      if (av == null) av = isDaysCover ? Infinity : 0;
      if (bv == null) bv = isDaysCover ? Infinity : 0;
      return (Number(av) - Number(bv)) * dir;
    });
  }

  // ---------- COLUMNS ----------
  const BASE_COLS = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Product Name', wrap: true },
    { key: 'supplier', label: 'Supplier' },
    { key: 'stock', label: 'Stock', num: true },
    { key: 'saleQtyToday', label: 'Sold Today', num: true },
  ];
  function windowCols(w) {
    return [
      { key: 'saleQty' + w, label: 'Sale Qty ' + w + 'd', num: true },
      { key: 'daysCover' + w, label: 'Cover ' + w + 'd', num: true, days: true },
      { key: 'demandQty' + w, label: 'Demand Qty ' + w + 'd', num: true },
    ];
  }
  function allCols() {
    return [].concat(BASE_COLS, windowCols(30), windowCols(60), windowCols(90),
      [{ key: 'saleValueP', label: 'Sale Value', num: true, strong: true }]);
  }
  function isPrimaryWinCol(c, primaryWindow) {
    return /^(saleQty|daysCover|demandQty)\d+$/.test(c.key) && c.key.endsWith(String(primaryWindow));
  }
  // Cols actually shown in the on-screen table AND fed into Print — hiding
  // a column via the Columns dropdown removes it from both in one step.
  function visibleCols(cols) {
    return cols.filter(c => !state.hiddenCols.has(c.key));
  }

  // ---------- COLUMNS DROPDOWN ----------
  function columnsMenuHtml(allColsList) {
    return `
      <div class="colmenu-wrap${state.colsMenuOpen ? ' open' : ''}" id="rorColMenuWrap">
        <button class="btn btn-sm" type="button" data-action="ror-cols-toggle">
          <span class="material-symbols-outlined">view_column</span>Columns
        </button>
        <div class="colmenu">
          ${allColsList.map(c => `
            <label>
              <input type="checkbox" data-colkey="${esc(c.key)}" ${state.hiddenCols.has(c.key) ? '' : 'checked'}>
              ${esc(c.label)}
            </label>`).join('')}
          <div class="colmenu-foot">
            <button type="button" data-action="ror-cols-all">Show all</button>
          </div>
        </div>
      </div>`;
  }

  function theadHtml(cols, sort, primaryWindow) {
    return '<tr>' + cols.map(c => {
      const arrow = sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '';
      const cls = 'sortable' + (c.num ? ' num' : '') + (isPrimaryWinCol(c, primaryWindow) ? ' win-primary' : '');
      return `<th class="${cls}" data-key="${c.key}">${esc(c.label)}<span class="arrow">${arrow}</span></th>`;
    }).join('') + '</tr>';
  }

  function rowHtml(r, cols, primaryWindow) {
    return '<tr>' + cols.map(c => {
      let v = r[c.key];
      let content = c.days ? fmtDays(v) : (c.num ? fmt(v) : esc(v));
      if (c.key === 'name') content = `${esc(v)}<div class="sub">${esc(r.company || '')}</div>`;
      if (c.key === 'saleValueP') {
        // Sale Value is tax-aware (2026-07-30 fix): incl-tax for taxable
        // products, excl-tax (no tax to add) for exempt ones — surface
        // which one this row is so it's not ambiguous at a glance.
        content += `<div class="hint" style="font-weight:400">${r.isTaxable ? 'incl. tax' : 'no tax'}</div>`;
      }
      const cls = (c.num ? 'num ' : '') + (c.strong ? 'val ' : '') + (c.wrap ? 'wrap ' : '') + (isPrimaryWinCol(c, primaryWindow) ? 'win-primary ' : '');
      return `<td class="${cls.trim()}">${content}</td>`;
    }).join('') + '</tr>';
  }

  function groupedBody(list, cols, primaryWindow) {
    const groups = new Map();
    list.forEach(r => {
      const key = r.supplier || 'Unspecified';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const groupArr = Array.from(groups.entries()).map(([supplier, items]) => ({
      supplier, items, total: items.reduce((s, r) => s + r.saleValueP, 0)
    })).sort((a, b) => b.total - a.total);
    return groupArr.map(g => {
      const collapsed = state.collapsedGroups.has(g.supplier);
      const header = `
      <tr class="group-header" data-action="ror-group-toggle" data-supplier="${esc(g.supplier)}">
        <td colspan="${cols.length}">
          <span class="material-symbols-outlined group-chev">${collapsed ? 'chevron_right' : 'expand_more'}</span>
          <span class="group-name">${esc(g.supplier)}</span>
          <span class="hint group-count">${g.items.length} item${g.items.length === 1 ? '' : 's'}</span>
          <span class="num group-total">${fmt(g.total)}</span>
        </td>
      </tr>`;
      const body = collapsed ? '' : g.items.map(r => rowHtml(r, cols, primaryWindow)).join('');
      return header + body;
    }).join('');
  }

  // ---------- EXPORTS ----------
  function exportExcelSheet(aoa, sheetName, filename) {
    if (!window.XLSX) { say('Excel library not loaded', 'e'); return; }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename);
  }

  function exportPdfTable(title, subLines, headers, rows, filename) {
    if (!window.jspdf) { say('PDF library not loaded', 'e'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const margin = 28;
    let y = 38;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(title, margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    (subLines || []).forEach(line => { doc.text(line, margin, y); y += 12; });
    doc.setTextColor(0);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [headers],
      body: rows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [26, 34, 38] },
      alternateRowStyles: { fillColor: [245, 247, 246] },
    });
    doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text('Reorder Report — Bahria Town · auto-generated, figures reflect live data at time of export.', margin, doc.internal.pageSize.getHeight() - 16);
    doc.save(filename);
  }

  function rowToAoa(r, cols, rank) {
    const line = rank != null ? [rank] : [];
    cols.forEach(c => line.push(c.days ? (r[c.key] == null ? '' : Math.round(r[c.key] * 10) / 10) : r[c.key]));
    return line;
  }
  function rowToPdf(r, cols, rank) {
    const line = rank != null ? [rank] : [];
    cols.forEach(c => line.push(c.days ? fmtDays(r[c.key]) : (c.num ? fmt(r[c.key]) : r[c.key])));
    return line;
  }

  function summaryLines() {
    return [
      'Reference date: ' + (state.asOf || '—'),
      'Window: ' + state.window + 'd  ·  Cover threshold: <' + state.coverDays + 'd  ·  Items flagged: ' + state.computed.length,
      'Sale qty/value basis: ' + (state.includeToday ? 'historical window + today (live)' : 'historical window only'),
    ];
  }

  function exportTopNExcel() {
    const rows = state.topNFlagged;
    if (!rows.length) { say('No flagged items to export yet', 'e'); return; }
    const cols = allCols();
    const aoa = [
      ['Reorder Report — Top ' + rows.length + ' by Sale Value (' + state.window + 'd window)'],
      ['Reference date', state.asOf || ''],
      ['Cover threshold (days)', state.coverDays],
      [],
      ['Rank'].concat(cols.map(c => c.label)),
    ];
    rows.forEach((r, i) => aoa.push(rowToAoa(r, cols, i + 1)));
    exportExcelSheet(aoa, 'Reorder Top ' + rows.length, 'reorder_top' + rows.length + '_' + todayStamp() + '.xlsx');
    say('Top ' + rows.length + ' reorder items exported (.xlsx)');
  }

  function exportTopNPdf() {
    const rows = state.topNFlagged;
    if (!rows.length) { say('No flagged items to export yet', 'e'); return; }
    const cols = allCols();
    const body = rows.map((r, i) => rowToPdf(r, cols, i + 1));
    exportPdfTable(
      'Reorder Report — Top ' + rows.length + ' by Sale Value',
      summaryLines(),
      ['#'].concat(cols.map(c => c.label)),
      body,
      'reorder_top' + rows.length + '_' + todayStamp() + '.pdf'
    );
    say('Top ' + rows.length + ' reorder items exported (.pdf)');
  }

  function exportAllExcel() {
    if (!state.computed.length) { say('No flagged items to export yet', 'e'); return; }
    const rows = sortRows(state.computed, { key: 'saleValueP', dir: -1 });
    const cols = allCols();
    const aoa = [
      ['Reorder Report — All Flagged (' + state.window + 'd window, cover < ' + state.coverDays + 'd)'],
      ['Reference date', state.asOf || ''],
      [],
      cols.map(c => c.label),
    ];
    rows.forEach(r => aoa.push(rowToAoa(r, cols, null)));
    exportExcelSheet(aoa, 'Reorder All Flagged', 'reorder_all_flagged_' + todayStamp() + '.xlsx');
    say('All flagged items exported (.xlsx)');
  }

  function exportAllPdf() {
    if (!state.computed.length) { say('No flagged items to export yet', 'e'); return; }
    const rows = sortRows(state.computed, { key: 'saleValueP', dir: -1 });
    const cols = allCols();
    const body = rows.map(r => rowToPdf(r, cols, null));
    exportPdfTable(
      'Reorder Report — All Flagged Items',
      summaryLines(),
      cols.map(c => c.label),
      body,
      'reorder_all_flagged_' + todayStamp() + '.pdf'
    );
    say('All flagged items exported (.pdf)');
  }

  // ---------- RENDER ----------
  // ---------- PRINT (visible columns only) ----------
  // Uses the shared Print engine (js/print.js) — same as every other
  // report in the app — instead of window.print(), so it gets the
  // standard Generating…/View/Download/Save-to-Library popup. Unlike
  // Excel/PDF export (which always include every column), this respects
  // whatever the Columns dropdown currently has checked.
  function printRowHtml(r, cols) {
    return '<tr>' + cols.map(c => {
      let v = r[c.key];
      let content = c.days ? fmtDays(v) : (c.num ? fmt(v) : esc(v));
      return `<td${c.num ? ' class="r"' : ''}>${content}</td>`;
    }).join('') + '</tr>';
  }

  function printGroupedBody(list, cols) {
    const groups = new Map();
    list.forEach(r => {
      const key = r.supplier || 'Unspecified';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const groupArr = Array.from(groups.entries()).map(([supplier, items]) => ({
      supplier, items, total: items.reduce((s, r) => s + r.saleValueP, 0)
    })).sort((a, b) => b.total - a.total);
    return groupArr.map(g => {
      const header = `<tr><td colspan="${cols.length}" style="font-weight:700;background:#f1f5f9;padding:6px 10px;">${esc(g.supplier)} <span style="font-weight:400;color:#64748b">(${g.items.length} item${g.items.length === 1 ? '' : 's'})</span></td></tr>`;
      return header + g.items.map(r => printRowHtml(r, cols)).join('');
    }).join('');
  }

  function buildPrintHtml(rows, cols, title, subLine) {
    const q = (state.search || '').trim();
    let list = rows;
    if (q) {
      list = (typeof window.BTSearch !== 'undefined')
        ? window.BTSearch.filterAndRank(list, q, ['code', 'name'])
        : list.filter(r => (r.code || '').toLowerCase().includes(q.toLowerCase()) || (r.name || '').toLowerCase().includes(q.toLowerCase()));
    }
    list = sortRows(list, state.sort);
    const today = todayStamp();
    const theadRow = '<tr>' + cols.map(c => `<th${c.num ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('') + '</tr>';
    const bodyRows = state.groupBySupplier ? printGroupedBody(list, cols) : list.map(r => printRowHtml(r, cols)).join('');
    return `<div style="max-width:960px;margin:0 auto">
      <div class="pr-header">
        <div><h1>BAHRIA TOWN SALES IC</h1><p>${esc(title)}</p></div>
        <div class="pr-meta">Printed: ${today}${subLine ? ' · ' + esc(subLine) : ''}</div>
      </div>
      <table class="pr-tbl">
        <thead>${theadRow}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
  }

  function printTopN() {
    const rows = state.topNFlagged || [];
    if (!rows.length) { say('Nothing to print', 'w'); return; }
    const cols = visibleCols(allCols());
    const html = buildPrintHtml(rows, cols, 'Reorder Report — Top ' + state.topN + ' by Sale Value',
      state.window + 'd window · cover under ' + state.coverDays + 'd');
    if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
    else say('Print engine not loaded', 'e');
  }

  function printAllFlagged() {
    const rows = state.computed || [];
    if (!rows.length) { say('Nothing to print', 'w'); return; }
    const cols = visibleCols(allCols());
    const html = buildPrintHtml(rows, cols, 'Reorder Report — All Flagged Items',
      state.window + 'd window · cover under ' + state.coverDays + 'd');
    if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
    else say('Print engine not loaded', 'e');
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
        state.window = Number(btn.dataset.win) || 90;
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
  function getSummaryFor(windowDays, coverDaysThreshold, topN, includeToday) {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return null;
    const w = WINDOWS.indexOf(windowDays) !== -1 ? windowDays : 30;
    const cd = coverDaysThreshold || 7;
    const allRows = computeAllRows(rawRows, w, cd, includeToday !== false);
    const pool = topNByValue(allRows, topN || 500);
    const shown = lowCoverWithin(pool, cd);
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
  // includeToday settings (unlike getSummaryFor, which is deliberately
  // independent of them for Cover's fixed stat). Safe to call cold —
  // same as getSummaryFor, pulls fresh from Stock Ledger rather than
  // relying on this tab having been opened this session. Returns []
  // only if Stock Ledger itself has no data loaded.
  function getFlaggedRows() {
    const SL = window.StockLedgerApp;
    const rawRows = (SL && typeof SL.hasData === 'function' && SL.hasData() && typeof SL.getRawRows === 'function')
      ? SL.getRawRows() : null;
    if (!rawRows) return [];
    const cd = Number(state.coverDays) || 15;
    const allRows = computeAllRows(rawRows, state.window, cd, state.includeToday);
    return lowCoverWithin(topNByValue(allRows, state.topN), cd);
  }

  return { init: init, getSummaryFor: getSummaryFor, getFlaggedRows: getFlaggedRows };
})();
