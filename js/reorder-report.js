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
// ══════════════════════════════════════════════════════════════════════

window.ReorderReportApp = (function () {
  "use strict";
  let initialized = false;

  const WINDOW_KEY = 'bt_reorder_window_v1';
  const COVERDAYS_KEY = 'bt_reorder_coverdays_v1';
  const TOPN_KEY = 'bt_reorder_topn_v1';
  const GROUP_KEY = 'bt_reorder_group_v1';

  const WINDOWS = [30, 60, 90];

  const state = {
    tab: 'topn',            // 'topn' | 'all'
    window: 90,              // primary window: 30 | 60 | 90
    coverDays: 15,            // "less than N days stock" threshold
    topN: 50,
    search: '',
    groupBySupplier: false,
    collapsedGroups: new Set(),
    sort: { key: 'saleValueP', dir: -1 },
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
  }
  function saveWindow() { repoSet(WINDOW_KEY, String(state.window)); }
  function saveCoverDays() { repoSet(COVERDAYS_KEY, String(state.coverDays)); }
  function saveTopN() { repoSet(TOPN_KEY, String(state.topN)); }
  function saveGroup() { repoSet(GROUP_KEY, state.groupBySupplier ? '1' : '0'); }

  // ---------- CALCULATION ENGINE ----------
  function computeRows(rawRows, primaryWindow, coverDays) {
    const rows = rawRows.map(r => {
      const stock = Number(r.stock) || 0;
      const unitPrice = Number(r.unitPrice) || 0;
      const out = {
        code: r.code || '', name: r.name || '',
        supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unspecified',
        company: r.company || '',
        stock, unitPrice,
      };
      WINDOWS.forEach(w => {
        const saleQty = Number(r['netQty' + w + 'Days']) || 0;
        const saleValue = saleQty * unitPrice;
        const dailyRate = saleQty / w;
        const daysCover = dailyRate > 0 ? (stock / dailyRate) : null;
        const demandQty = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0;
        out['saleQty' + w] = saleQty;
        out['saleValue' + w] = saleValue;
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
    // Qualifies only if it actually sold something in the primary window
    // (no rate, no meaningful "days cover") AND that cover is under the
    // threshold — zero stock included on purpose, that's the most urgent case.
    return rows.filter(r => r.saleQtyP > 0 && r.daysCoverP != null && r.daysCoverP < coverDays);
  }

  function recompute() {
    state.computed = computeRows(state.rawRows, state.window, Number(state.coverDays) || 15);
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

  function topRows(rows, n) {
    return [...rows].sort((a, b) => b.saleValueP - a.saleValueP).slice(0, Math.max(1, n || 50));
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
    ];
  }

  function exportTopNExcel() {
    const rows = topRows(state.computed, state.topN);
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
    const rows = topRows(state.computed, state.topN);
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
  function windowSegHtml() {
    return `<div class="window-seg" id="rorWindowSeg">` +
      WINDOWS.map(w => `<button class="${state.window === w ? 'active' : ''}" data-action="ror-window" data-win="${w}">${w}d</button>`).join('') +
      `</div>`;
  }

  function controlsHtml(showTopN) {
    return `
      <div class="filter-row">
        <label class="field-label" style="margin:0;">Window</label>
        ${windowSegHtml()}
        <label class="field-label" style="margin:0;">Cover &lt;</label>
        <input type="number" id="rorCoverDaysInput" class="num-input" value="${state.coverDays}" min="1" step="1">
        <span class="hint">days</span>
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
        <div class="export-actions">
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
    const q = (state.search || '').toLowerCase();
    if (q) rows = rows.filter(r => (r.code || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
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
    const top = topRows(state.computed, state.topN);
    const cols = allCols();
    const { rows: shownAfterSearch, html: tableHtmlStr } = tableHtml(top, cols);
    return `
      ${statsHtml(shownAfterSearch, state.computed.length)}
      <div class="card">
        <div class="card-head"><h3>Top ${state.topN} by Sale Value</h3><span class="hint">${state.window}d window · cover under ${state.coverDays}d</span></div>
        ${controlsHtml(true)}
        ${tableHtmlStr}
      </div>`;
  }

  function renderAllFlaggedTab() {
    const cols = allCols();
    const { rows: shownAfterSearch, html: tableHtmlStr } = tableHtml(state.computed, cols);
    return `
      ${statsHtml(shownAfterSearch, state.computed.length)}
      <div class="card">
        <div class="card-head"><h3>All Flagged Items</h3><span class="hint">no Top N cap — every item under the cover threshold</span></div>
        ${controlsHtml(false)}
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
      if (btn.dataset.topnPreset) { state.topN = Number(btn.dataset.topnPreset); saveTopN(); render(); return; }
    });

    root.addEventListener('input', function (e) {
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

  return { init: init };
})();
