// ══════════════════════════════════════════════════════════════════════
// PURCHASE ORDER — pick a schedule Day + Warehouse (from PO_SCHEDULE,
// js/po-schedule-data.js, exported from the supplier ordering calendar),
// optionally narrow to one Supplier on that day, and get a ready-to-print
// buy list: the Top N items (by sale value) for each supplier, with order
// quantities computed at the 30-day, 60-day, AND 90-day level side by
// side — not one threshold picked for you.
//
// Reuses ReorderReportApp.computeAllRows() (js/reorder-report.js) for the
// actual sale-rate / demand-qty math — same engine Reorder Report itself
// runs, so a "how much to order" number here can never quietly diverge
// from what that page would say for the same item. Source rows come from
// Stock Ledger's loaded inventory (window.StockLedgerApp.getRawRows()),
// same one-load pattern as Excess Working / Reorder Report — load your
// inventory file on Stock Ledger first, then this page's numbers follow.
//
// "Order Qty @Nd" = how much to buy so stock reaches N days of cover,
// using that item's OWN N-day sale rate — i.e. demandQty30 comes from a
// computeAllRows() pass with coverDays=30 (so it's the 30-day rate times
// 30, minus current stock), demandQty60 from a coverDays=60 pass, and
// demandQty90 from a coverDays=90 pass. Three passes over the same raw
// rows (cheap — pure array math, done once per recompute, not per
// keystroke), then merged by array index (computeAllRows preserves row
// order, so a straight zip is safe) into one row carrying all three
// figures at once.
//
// Supplier-name matching: the schedule's supplier names come from a
// human-typed ordering calendar and won't always spell a name exactly
// the way Stock Ledger's item data does. Matching is done on a
// normalized key (trim, collapse whitespace, uppercase, strip trailing
// punctuation) first; if nothing matches exactly, a "contains" fallback
// (either name a substring of the other) is tried and flagged as a
// fuzzy match in the UI so it's never silently wrong.
// ══════════════════════════════════════════════════════════════════════

window.PurchaseOrderApp = (function () {
  "use strict";
  let initialized = false;

  const DAY_KEY = 'bt_po_day_v1';
  const WH_KEY = 'bt_po_wh_v1';
  const SUPPLIER_KEY = 'bt_po_supplier_v1';
  const TOPN_KEY = 'bt_po_topn_v1';
  const PRIMARY_KEY = 'bt_po_primary_v1';
  const INCLUDETODAY_KEY = 'bt_po_includetoday_v1';

  const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const WINDOWS = [30, 60, 90];

  const state = {
    day: '',
    warehouse: 'WH-1',
    supplier: '',       // '' = every supplier scheduled for the day/warehouse
    topN: 20,
    primary: 90,          // which window's Order Qty is the "headline" one
    includeToday: true,
    search: '',
    rawRows: [],
    dataReady: false,
    asOf: '',
    supplierIndex: null, // normalized-name -> [rawRows]
  };

  // ---------- helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
  function fmt(n) { return (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
  function money(n) { return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function say(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type); }

  function repoGet(key) {
    try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function repoSet(key, value) {
    try { if (window.Repository) window.Repository.setItem(key, value); else localStorage.setItem(key, value); }
    catch (e) { /* ignore */ }
  }

  function normalize(s) {
    return String(s || '')
      .trim()
      .toUpperCase()
      .replace(/[.,()]/g, '')
      .replace(/\s+/g, ' ');
  }

  function loadSettings() {
    const sched = window.PO_SCHEDULE || {};
    const days = DAY_ORDER.filter(d => sched[d]);
    const savedDay = repoGet(DAY_KEY);
    state.day = (savedDay && sched[savedDay]) ? savedDay : (days[0] || '');
    const savedWh = repoGet(WH_KEY);
    state.warehouse = (savedWh === 'WH-1' || savedWh === 'WH-2' || savedWh === 'ALL') ? savedWh : 'WH-1';
    state.supplier = repoGet(SUPPLIER_KEY) || '';
    const tn = parseInt(repoGet(TOPN_KEY), 10);
    state.topN = (tn && tn > 0) ? tn : 20;
    const pw = parseInt(repoGet(PRIMARY_KEY), 10);
    state.primary = WINDOWS.indexOf(pw) !== -1 ? pw : 90;
    const it = repoGet(INCLUDETODAY_KEY);
    state.includeToday = (it === null) ? true : (it === '1');
  }
  function saveDay() { repoSet(DAY_KEY, state.day); }
  function saveWh() { repoSet(WH_KEY, state.warehouse); }
  function saveSupplier() { repoSet(SUPPLIER_KEY, state.supplier); }
  function saveTopN() { repoSet(TOPN_KEY, String(state.topN)); }
  function savePrimary() { repoSet(PRIMARY_KEY, String(state.primary)); }
  function saveIncludeToday() { repoSet(INCLUDETODAY_KEY, state.includeToday ? '1' : '0'); }

  // ---------- schedule helpers ----------
  function suppliersFor(day, warehouse) {
    const sched = window.PO_SCHEDULE || {};
    const block = sched[day];
    if (!block) return [];
    if (warehouse === 'ALL') {
      const set = new Set([...(block['WH-1'] || []), ...(block['WH-2'] || [])]);
      return Array.from(set);
    }
    return (block[warehouse] || []).slice();
  }

  // ---------- data ----------
  function buildSupplierIndex(rawRows) {
    const idx = new Map();
    rawRows.forEach(r => {
      const key = normalize((r.supplier && String(r.supplier)) || r.company || '');
      if (!key) return;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(r);
    });
    return idx;
  }

  // Exact normalized match first; falls back to a "contains" match against
  // every indexed supplier key (either direction) if nothing exact is
  // found. Returns { rows, matchType, matchedName } — matchType is
  // 'exact' | 'fuzzy' | 'none'.
  function rowsForSupplier(scheduleName) {
    const key = normalize(scheduleName);
    if (!state.supplierIndex) return { rows: [], matchType: 'none', matchedName: null };
    if (state.supplierIndex.has(key)) {
      return { rows: state.supplierIndex.get(key), matchType: 'exact', matchedName: scheduleName };
    }
    let best = null;
    for (const [idxKey, rows] of state.supplierIndex.entries()) {
      if (idxKey.includes(key) || key.includes(idxKey)) {
        if (!best || rows.length > best.rows.length) best = { rows, matchType: 'fuzzy', matchedName: idxKey };
      }
    }
    return best || { rows: [], matchType: 'none', matchedName: null };
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
    state.supplierIndex = buildSupplierIndex(state.rawRows);
    if (!silent) say(state.dataReady ? ('Pulled ' + state.rawRows.length + ' items from Stock Ledger') : 'No Stock Ledger data loaded yet');
  }

  // Merges three ReorderReportApp.computeAllRows() passes (coverDays =
  // 30 / 60 / 90) so every row carries a REAL 30-day order qty (30-day
  // rate x 30 days, minus stock), a REAL 60-day order qty (60-day rate x
  // 60 days), and a REAL 90-day order qty (90-day rate x 90 days) —
  // not one cover-days threshold applied to all three windows.
  function computeThreeLevel(rawRows) {
    const RR = window.ReorderReportApp;
    if (!RR || typeof RR.computeAllRows !== 'function' || !rawRows.length) return [];
    const byWindow = {};
    WINDOWS.forEach(w => { byWindow[w] = RR.computeAllRows(rawRows, w, w, state.includeToday); });
    const base = byWindow[30];
    return base.map((row, i) => {
      const out = Object.assign({}, row);
      WINDOWS.forEach(w => {
        out['orderQty' + w] = byWindow[w][i]['demandQty' + w];
      });
      out.orderValueP = out['orderQty' + state.primary] * out.unitPrice;
      return out;
    });
  }

  // Ranks by sale value across whichever windows have data (90d first,
  // then 60d, then 30d — most stable signal wins), caps at Top N.
  function topNForSupplier(rows, n) {
    return rows
      .filter(r => r.saleQty90 > 0 || r.saleQty60 > 0 || r.saleQty30 > 0)
      .sort((a, b) => (b.saleValue90 || b.saleValue60 || b.saleValue30 || 0) - (a.saleValue90 || a.saleValue60 || a.saleValue30 || 0))
      .slice(0, Math.max(1, n || 20));
  }

  function buildSupplierGroups() {
    if (!state.dataReady || !state.day) return [];
    const names = state.supplier ? [state.supplier] : suppliersFor(state.day, state.warehouse);
    return names.map(name => {
      const match = rowsForSupplier(name);
      const computed = computeThreeLevel(match.rows);
      const top = topNForSupplier(computed, state.topN);
      if (state.search) {
        const q = state.search.toLowerCase();
        // search doesn't remove suppliers, just filters their item rows
      }
      return {
        supplierName: name,
        matchType: match.matchType,
        matchedName: match.matchedName,
        itemsAvailable: match.rows.length,
        top: state.search
          ? top.filter(r => (r.name || '').toLowerCase().includes(state.search.toLowerCase()) || (r.code || '').toLowerCase().includes(state.search.toLowerCase()))
          : top,
        totalOrderValue: top.reduce((s, r) => s + r.orderValueP, 0),
      };
    });
  }

  // ---------- render ----------
  function windowColsHtml() {
    return WINDOWS.map(w => `
      <th class="r${w === state.primary ? ' po-primary-col' : ''}">Sale ${w}d</th>
      <th class="r${w === state.primary ? ' po-primary-col' : ''}">Order Qty ${w}d</th>
    `).join('');
  }

  function rowHtml(r) {
    const cells = WINDOWS.map(w => `
      <td class="r${w === state.primary ? ' po-primary-col' : ''}">${fmt(r['saleQty' + w])}</td>
      <td class="r${w === state.primary ? ' po-primary-col' : ''}${r['orderQty' + w] > 0 ? ' po-need' : ''}">${fmt(r['orderQty' + w])}</td>
    `).join('');
    return `<tr>
      <td>${esc(r.code)}</td>
      <td class="wrap">${esc(r.name)}</td>
      <td class="r">${fmt(r.stock)}</td>
      <td class="r">${fmt(r.unitPrice)}</td>
      ${cells}
      <td class="r po-value">${money(r.orderValueP)}</td>
    </tr>`;
  }

  function groupHtml(g) {
    const badge = g.matchType === 'exact'
      ? ''
      : g.matchType === 'fuzzy'
        ? `<span class="po-badge po-badge-fuzzy" title="Matched to Stock Ledger supplier &quot;${esc(g.matchedName)}&quot; — spelling differs from the schedule">fuzzy match → ${esc(g.matchedName)}</span>`
        : `<span class="po-badge po-badge-none" title="No supplier in Stock Ledger matched this name">no stock-ledger match</span>`;
    const body = g.top.length
      ? g.top.map(rowHtml).join('')
      : `<tr><td colspan="${5 + WINDOWS.length * 2}" class="po-empty">No sold items found for this supplier${g.matchType === 'none' ? ' (name not found in Stock Ledger)' : ' in the loaded window'}.</td></tr>`;
    return `<section class="po-group" data-supplier="${esc(g.supplierName)}">
      <div class="po-group-head">
        <h3>${esc(g.supplierName)}</h3>
        ${badge}
        <span class="po-group-meta">${g.top.length} item${g.top.length === 1 ? '' : 's'} · order value ${money(g.totalOrderValue)}</span>
        <button class="btn-ghost sm" data-action="po-print-group" data-supplier="${esc(g.supplierName)}">Print PO</button>
      </div>
      <div class="po-table-wrap">
        <table class="po-tbl">
          <thead><tr>
            <th>Code</th><th>Product</th><th class="r">Stock</th><th class="r">Unit Price</th>
            ${windowColsHtml()}
            <th class="r">Order Value (${state.primary}d)</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
  }

  function daySelectHtml() {
    const sched = window.PO_SCHEDULE || {};
    const days = DAY_ORDER.filter(d => sched[d]);
    return days.map(d => `<option value="${d}"${d === state.day ? ' selected' : ''}>${d.charAt(0) + d.slice(1).toLowerCase()}</option>`).join('');
  }

  function supplierSelectHtml() {
    const opts = ['<option value="">All suppliers (' + state.warehouse + ')</option>']
      .concat(suppliersFor(state.day, state.warehouse).map(s =>
        `<option value="${esc(s)}"${s === state.supplier ? ' selected' : ''}>${esc(s)}</option>`));
    return opts.join('');
  }

  function render() {
    const root = $('#page-purchase-order');
    if (!root) return;
    const body = $('#po-body', root);
    if (!body) return;

    if (!state.dataReady) {
      body.innerHTML = `<div class="po-empty-state">
        <p>No Stock Ledger data loaded yet.</p>
        <p class="muted">Open <b>Stock Ledger</b>, load your inventory file, then come back — this page reads live from that data, same as Reorder Report.</p>
      </div>`;
      return;
    }

    const groups = buildSupplierGroups();
    const grandTotal = groups.reduce((s, g) => s + g.totalOrderValue, 0);

    body.innerHTML = `
      <div class="po-summary">
        <span><b>${state.day.charAt(0) + state.day.slice(1).toLowerCase()}</b> · ${state.warehouse === 'ALL' ? 'WH-1 + WH-2' : state.warehouse}</span>
        <span>${groups.length} supplier${groups.length === 1 ? '' : 's'} scheduled</span>
        <span>Total order value (${state.primary}d): <b>${money(grandTotal)}</b></span>
        <button class="btn-ghost sm" data-action="po-print-day">Print Full Day PO</button>
        <button class="btn-ghost sm" data-action="po-export-csv">Export CSV</button>
      </div>
      ${groups.map(groupHtml).join('') || '<p class="po-empty-state">No suppliers scheduled for this day/warehouse.</p>'}
    `;
  }

  function renderControls() {
    const root = $('#page-purchase-order');
    if (!root) return;
    const bar = $('#po-controlbar', root);
    if (!bar) return;
    bar.innerHTML = `
      <label>Day
        <select data-action="po-day">${daySelectHtml()}</select>
      </label>
      <label>Warehouse
        <select data-action="po-wh">
          <option value="WH-1"${state.warehouse === 'WH-1' ? ' selected' : ''}>WH-1</option>
          <option value="WH-2"${state.warehouse === 'WH-2' ? ' selected' : ''}>WH-2</option>
          <option value="ALL"${state.warehouse === 'ALL' ? ' selected' : ''}>Both</option>
        </select>
      </label>
      <label>Supplier
        <select data-action="po-supplier">${supplierSelectHtml()}</select>
      </label>
      <label>Top N per supplier
        <input type="number" min="1" max="200" value="${state.topN}" data-action="po-topn">
      </label>
      <label>Primary window
        <select data-action="po-primary">
          ${WINDOWS.map(w => `<option value="${w}"${w === state.primary ? ' selected' : ''}>${w}d</option>`).join('')}
        </select>
      </label>
      <label class="po-check">
        <input type="checkbox" data-action="po-includetoday"${state.includeToday ? ' checked' : ''}> + Today
      </label>
      <input type="search" placeholder="Filter items…" value="${esc(state.search)}" data-action="po-search" class="po-search">
      <button class="btn-ghost sm" data-action="po-refresh">↻ Reload from Stock Ledger</button>
      <span class="asof">${state.asOf ? 'As of ' + esc(state.asOf) : ''}</span>
    `;
  }

  // ---------- print / export ----------
  function buildPrintHtml(groups, title) {
    const grandTotal = groups.reduce((s, g) => s + g.totalOrderValue, 0);
    const sections = groups.map(g => {
      const rows = g.top.map(r => `<tr>
        <td>${esc(r.code)}</td><td>${esc(r.name)}</td>
        <td class="r">${fmt(r.stock)}</td>
        <td class="r">${fmt(r.orderQty30)}</td>
        <td class="r">${fmt(r.orderQty60)}</td>
        <td class="r">${fmt(r.orderQty90)}</td>
        <td class="r">${money(r.orderValueP)}</td>
      </tr>`).join('');
      return `<h3 style="margin:14px 0 4px">${esc(g.supplierName)} <small>(${money(g.totalOrderValue)})</small></h3>
        <table class="pr-tbl"><thead><tr>
          <th>Code</th><th>Product</th><th class="r">Stock</th>
          <th class="r">Order 30d</th><th class="r">Order 60d</th><th class="r">Order 90d</th>
          <th class="r">Value (${state.primary}d)</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="7">No items</td></tr>'}</tbody></table>`;
    }).join('');
    return `<div style="max-width:960px;margin:0 auto">
      <div class="pr-header">
        <div><h1>BAHRIA TOWN SALES IC</h1><p>${esc(title)}</p></div>
        <div class="pr-meta">Printed: ${today()} · Total ${money(grandTotal)}</div>
      </div>
      ${sections}
    </div>`;
  }

  function printDay() {
    const groups = buildSupplierGroups();
    if (!groups.length) { say('Nothing to print', 'w'); return; }
    const html = buildPrintHtml(groups, 'Purchase Order — ' + state.day.charAt(0) + state.day.slice(1).toLowerCase() + ' · ' + state.warehouse);
    if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
    else say('Print engine unavailable', 'e');
  }

  function printGroup(supplierName) {
    const groups = buildSupplierGroups().filter(g => g.supplierName === supplierName);
    if (!groups.length) { say('Nothing to print', 'w'); return; }
    const html = buildPrintHtml(groups, 'Purchase Order — ' + supplierName);
    if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
    else say('Print engine unavailable', 'e');
  }

  function exportCsv() {
    const groups = buildSupplierGroups();
    if (!groups.length) { say('Nothing to export', 'w'); return; }
    const header = ['Supplier', 'Code', 'Product', 'Stock', 'UnitPrice',
      'SaleQty30', 'OrderQty30', 'SaleQty60', 'OrderQty60', 'SaleQty90', 'OrderQty90',
      'OrderValue' + state.primary + 'd'];
    const lines = [header.join(',')];
    groups.forEach(g => {
      g.top.forEach(r => {
        const cells = [g.supplierName, r.code, r.name, r.stock, r.unitPrice,
          r.saleQty30, r.orderQty30, r.saleQty60, r.orderQty60, r.saleQty90, r.orderQty90, r.orderValueP]
          .map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"');
        lines.push(cells.join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'purchase-order-' + state.day.toLowerCase() + '-' + state.warehouse.toLowerCase() + '-' + today() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- events ----------
  function onControlChange(e) {
    const t = e.target;
    const action = t.dataset && t.dataset.action;
    if (!action) return;
    if (action === 'po-day') { state.day = t.value; state.supplier = ''; saveDay(); saveSupplier(); renderControls(); render(); }
    else if (action === 'po-wh') { state.warehouse = t.value; state.supplier = ''; saveWh(); saveSupplier(); renderControls(); render(); }
    else if (action === 'po-supplier') { state.supplier = t.value; saveSupplier(); render(); }
    else if (action === 'po-topn') { state.topN = Math.max(1, parseInt(t.value, 10) || 20); saveTopN(); render(); }
    else if (action === 'po-primary') { state.primary = parseInt(t.value, 10); savePrimary(); render(); }
    else if (action === 'po-includetoday') { state.includeToday = t.checked; saveIncludeToday(); render(); }
  }
  function onControlInput(e) {
    const t = e.target;
    if (t.dataset && t.dataset.action === 'po-search') { state.search = t.value; render(); }
  }
  function onBodyClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'po-refresh') { refreshFromStockLedger(false); renderControls(); render(); }
    else if (action === 'po-print-day') { printDay(); }
    else if (action === 'po-export-csv') { exportCsv(); }
    else if (action === 'po-print-group') { printGroup(btn.dataset.supplier); }
  }

  // ---------- init ----------
  function init() {
    const root = $('#page-purchase-order');
    if (!root) return;
    if (!initialized) {
      loadSettings();
      const bar = $('#po-controlbar', root);
      if (bar) { bar.addEventListener('change', onControlChange); bar.addEventListener('input', onControlInput); }
      const body = $('#po-body', root);
      if (body) body.addEventListener('click', onBodyClick);
      initialized = true;
    }
    refreshFromStockLedger(true);
    renderControls();
    render();
  }

  return { init: init };
})();
