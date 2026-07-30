// ══════════════════════════════════════════════════════════════════════
// INVENTORY HEALTH DASHBOARD  —  standalone inventory tab (July 2026)
//
// Own top-level page (own nav entry), separate from Stock Ledger/Excess
// Working/Reorder Report but reads the exact same shared source those
// three already use: window.StockLedgerApp.getRawRows() (see
// stockledger.js's normalizeSupabaseRow()). Nothing here re-fetches from
// Supabase or re-derives field meaning — it calls
// window.StockLedgerApp.init() (safe/idempotent, same "call on every
// visit" pattern as excess-working.js/reorder-report.js) to make sure a
// load has been kicked off, then polls briefly for hasData() before
// rendering. This page is a pure read/aggregate layer: one row's worth
// of health classification + reorder/velocity math, a handful of
// Chart.js charts built on top of it, and a searchable table.
//
// Reorder-value-over-time is the one metric with no historical field on
// inventory_products (it's a live snapshot table, not a time series), so
// this file keeps its own small trend of "today's total reorder value"
// under a local Repository/localStorage key, one point appended per
// calendar day the page is viewed — same idea as Sync Center's local,
// best-effort trend logs elsewhere in this app.
// ══════════════════════════════════════════════════════════════════════

window.InventoryHealthDashboard = (function () {
  "use strict";

  let initialized = false;
  let pollTimer = null;
  let healthChart = null;
  let moversChart = null;
  let trendChart = null;
  let supplierChart = null;

  const NEVER_SOLD_DAYS = 90;   // matches Stock Ledger's own default
  const DEAD_STOCK_DAYS = 60;   // matches Stock Ledger's own default
  const EXCESS_COVER_DAYS = 90; // stock covers 90+ days of demand
  const REORDER_COVER_DAYS = 15; // matches Reorder Report's own default
  const TREND_KEY = 'bt_invhealth_trend_v1';
  const TREND_MAX_POINTS = 90;

  const state = {
    rows: [],          // computed per-product rows
    search: '',
    supplier: '',       // reorder-table supplier filter
    healthFilter: '',   // '', 'reorder','excess','dead','neverSold','zeroStock','healthy'
    sort: { key: 'stockValue', dir: -1 },
  };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return 'Rs ' + Math.round(n).toLocaleString('en-PK');
  }
  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-PK');
  }
  function fmtDays(n) {
    if (n == null || !isFinite(n)) return '∞';
    return Math.round(n).toLocaleString('en-PK') + 'd';
  }
  function fmtDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function daysSince(str) {
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function repoGet(key) {
    try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function repoSet(key, val) {
    try { if (window.Repository) window.Repository.setItem(key, val); else localStorage.setItem(key, val); }
    catch (e) { /* best-effort */ }
  }

  // ---------- Core per-product computation ----------
  // Same shape used by Reorder Report/Excess Working: primary daily rate
  // prefers the 30d window, falls back to 60d then 90d if 30d had no
  // sales at all (a slow mover can still have a meaningful rate over a
  // longer window even with zero sales in the last 30 days).
  function computeRow(r) {
    const stock = Number(r.stock) || 0;
    const unitPrice = Number(r.unitPrice) || 0;
    const stockValue = stock * unitPrice;

    const qty30 = Number(r.netQty30Days) || 0;
    const qty60 = Number(r.netQty60Days) || 0;
    const qty90 = Number(r.netQty90Days) || 0;
    const rate30 = qty30 / 30;
    const rate60 = qty60 / 60;
    const rate90 = qty90 / 90;
    const primaryRate = rate30 > 0 ? rate30 : (rate60 > 0 ? rate60 : rate90);

    const coverDays = primaryRate > 0 ? (stock / primaryRate) : (stock > 0 ? Infinity : 0);
    const lastSaleAge = daysSince(r.lastSaleDate);
    const lastReceiveAge = daysSince(r.lastReceiveDate);

    const valueField = r.isTaxable ? 'saleValueInclTax' : 'saleValueExclTax';
    const saleValue30 = Number(r[valueField + '30Days']) || (qty30 * unitPrice);
    const saleValue60 = Number(r[valueField + '60Days']) || (qty60 * unitPrice);
    const saleValue90 = Number(r[valueField + '90Days']) || (qty90 * unitPrice);

    const demandQty = primaryRate > 0 ? Math.max(0, Math.ceil(primaryRate * REORDER_COVER_DAYS - stock)) : 0;
    const reorderValue = demandQty * unitPrice;

    // Classification — first match wins, most urgent first.
    let flag = 'healthy';
    if (stock <= 0) flag = 'zeroStock';
    else if (!r.lastSaleDate && (lastReceiveAge == null || lastReceiveAge >= NEVER_SOLD_DAYS)) flag = 'neverSold';
    else if (lastSaleAge != null && lastSaleAge >= DEAD_STOCK_DAYS && qty90 === 0) flag = 'dead';
    else if (primaryRate > 0 && coverDays < REORDER_COVER_DAYS) flag = 'reorder';
    else if (primaryRate >= 0 && coverDays >= EXCESS_COVER_DAYS && stock > 0) flag = 'excess';

    return {
      code: r.code || '', name: r.name || '(unnamed)',
      supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unassigned',
      company: r.company || '', generic: r.generic || '',
      stock, unitPrice, stockValue,
      rate30, rate60, rate90,
      qty30, qty60, qty90,
      saleValue30, saleValue60, saleValue90,
      coverDays, demandQty, reorderValue,
      lastSaleDate: r.lastSaleDate || null, lastReceiveDate: r.lastReceiveDate || null,
      lastSaleAge, lastReceiveAge,
      flag,
    };
  }

  function computeAll() {
    const raw = window.StockLedgerApp && typeof window.StockLedgerApp.getRawRows === 'function'
      ? window.StockLedgerApp.getRawRows() : [];
    state.rows = raw.map(computeRow);
    recordTrendPoint();
  }

  function recordTrendPoint() {
    if (!state.rows.length) return;
    const totalReorderValue = state.rows.reduce((s, r) => s + (r.flag === 'reorder' ? r.reorderValue : 0), 0);
    let series = [];
    try { series = JSON.parse(repoGet(TREND_KEY) || '[]'); } catch (e) { series = []; }
    const key = todayKey();
    const idx = series.findIndex(p => p.d === key);
    if (idx >= 0) series[idx].v = totalReorderValue;
    else series.push({ d: key, v: totalReorderValue });
    if (series.length > TREND_MAX_POINTS) series = series.slice(series.length - TREND_MAX_POINTS);
    repoSet(TREND_KEY, JSON.stringify(series));
  }

  function getTrendSeries() {
    try { return JSON.parse(repoGet(TREND_KEY) || '[]'); } catch (e) { return []; }
  }

  // ---------- Aggregates ----------
  function healthCounts() {
    const c = { healthy: 0, reorder: 0, excess: 0, dead: 0, neverSold: 0, zeroStock: 0 };
    state.rows.forEach(r => { c[r.flag] = (c[r.flag] || 0) + 1; });
    return c;
  }
  function supplierList() {
    const set = new Set();
    state.rows.forEach(r => set.add(r.supplier));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  function supplierBreakdown(topN) {
    const map = {};
    state.rows.forEach(r => { map[r.supplier] = (map[r.supplier] || 0) + r.stockValue; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, topN || 8);
  }
  function movers(dir, n) {
    return state.rows.slice().sort((a, b) => dir === 'top' ? b.saleValue30 - a.saleValue30 : a.saleValue30 - b.saleValue30)
      .filter(r => dir === 'top' ? r.saleValue30 > 0 : true)
      .slice(0, n || 8);
  }

  // ---------- Rendering ----------
  function render() {
    renderKpis();
    renderHealthChart();
    renderMoversChart();
    renderTrendChart();
    renderSupplierChart();
    renderSupplierDropdown();
    renderTable();
  }

  function renderKpis() {
    const c = healthCounts();
    const totalValue = state.rows.reduce((s, r) => s + r.stockValue, 0);
    const reorderValue = state.rows.reduce((s, r) => s + (r.flag === 'reorder' ? r.reorderValue : 0), 0);
    const deadValue = state.rows.reduce((s, r) => s + (r.flag === 'dead' ? r.stockValue : 0), 0);
    const excessValue = state.rows.reduce((s, r) => s + (r.flag === 'excess' ? r.stockValue : 0), 0);
    const wrap = $('#ihd-kpis');
    if (!wrap) return;
    const card = (label, value, sub, cls) => `<div class="ihd-kpi ${cls || ''}"><div class="ihd-kpi-label">${label}</div><div class="ihd-kpi-value">${value}</div>${sub ? `<div class="ihd-kpi-sub">${sub}</div>` : ''}</div>`;
    wrap.innerHTML =
      card('Total SKUs', fmtNum(state.rows.length), c.zeroStock + ' at zero stock') +
      card('Stock Value', fmtMoney(totalValue), 'across all products') +
      card('Reorder Value', fmtMoney(reorderValue), c.reorder + ' SKUs to buy', 'warn') +
      card('Dead Stock', fmtMoney(deadValue), c.dead + ' SKUs quiet ' + DEAD_STOCK_DAYS + '+d', 'danger') +
      card('Excess Stock', fmtMoney(excessValue), c.excess + ' SKUs over ' + EXCESS_COVER_DAYS + 'd cover', 'muted');
  }

  function renderHealthChart() {
    const canvas = document.getElementById('ihd-health-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const c = healthCounts();
    if (healthChart) { healthChart.destroy(); healthChart = null; }
    healthChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Healthy', 'Reorder', 'Excess', 'Dead Stock', 'Never Sold', 'Zero Stock'],
        datasets: [{
          data: [c.healthy, c.reorder, c.excess, c.dead, c.neverSold, c.zeroStock],
          backgroundColor: ['#16a34a', '#f59e0b', '#64748b', '#dc2626', '#7c3aed', '#94a3b8'],
          borderWidth: 0,
        }],
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, cutout: '62%' },
    });
  }

  function renderMoversChart() {
    const canvas = document.getElementById('ihd-movers-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const top = movers('top', 7);
    const slow = movers('slow', 7);
    if (moversChart) { moversChart.destroy(); moversChart = null; }
    moversChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map(r => r.name.length > 18 ? r.name.slice(0, 18) + '…' : r.name),
        datasets: [{ label: 'Top Movers — 30d Sale Value', data: top.map(r => r.saleValue30), backgroundColor: '#2563eb' }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, title: { display: true, text: 'Top Movers (30d)', font: { size: 12 } } },
        scales: { x: { ticks: { callback: v => fmtMoney(v) } } },
      },
    });
    // Slow movers get their own small table instead of a second full
    // chart canvas — keeps the grid to 4 charts, and a value-sorted list
    // of near-zero movers reads better as text than as a bar next to
    // nothing.
    const slowWrap = $('#ihd-slow-movers');
    if (slowWrap) {
      slowWrap.innerHTML = slow.map(r =>
        `<div class="ihd-slow-row"><span class="ihd-slow-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="ihd-slow-val">${fmtMoney(r.saleValue30)}</span><span class="ihd-slow-cov">${fmtDays(r.coverDays)} cover</span></div>`
      ).join('') || '<div class="ihd-empty">No data</div>';
    }
  }

  function renderTrendChart() {
    const canvas = document.getElementById('ihd-trend-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const series = getTrendSeries();
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map(p => p.d.slice(5)),
        datasets: [{ label: 'Reorder Value', data: series.map(p => p.v), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: 0.25 }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: 'Reorder Value Trend (one point/day viewed)', font: { size: 12 } } },
        scales: { y: { ticks: { callback: v => fmtMoney(v) } } },
      },
    });
  }

  function renderSupplierChart() {
    const canvas = document.getElementById('ihd-supplier-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const data = supplierBreakdown(8);
    if (supplierChart) { supplierChart.destroy(); supplierChart = null; }
    supplierChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(d => d[0].length > 16 ? d[0].slice(0, 16) + '…' : d[0]),
        datasets: [{ label: 'Stock Value', data: data.map(d => d[1]), backgroundColor: '#0ea5e9' }],
      },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: 'Stock Value by Supplier (Top 8)', font: { size: 12 } } },
        scales: { y: { ticks: { callback: v => fmtMoney(v) } } },
      },
    });
  }

  function renderSupplierDropdown() {
    const sel = $('#ihd-supplier-select');
    if (!sel) return;
    const suppliers = supplierList();
    const cur = state.supplier;
    sel.innerHTML = '<option value="">All Suppliers</option>' +
      suppliers.map(s => `<option value="${esc(s)}"${s === cur ? ' selected' : ''}>${esc(s)}</option>`).join('');
  }

  function filteredRows() {
    let rows = state.rows;
    if (state.supplier) rows = rows.filter(r => r.supplier === state.supplier);
    if (state.healthFilter) rows = rows.filter(r => r.flag === state.healthFilter);
    if (state.search.trim()) {
      const q = state.search.trim();
      rows = (window.BTSearch && typeof window.BTSearch.filterAndRank === 'function')
        ? window.BTSearch.filterAndRank(rows, q, ['code', 'name', 'generic', 'company', 'supplier'])
        : rows.filter(r => ['code', 'name', 'generic', 'company', 'supplier'].some(f => String(r[f] || '').toLowerCase().includes(q.toLowerCase())));
    }
    const { key, dir } = state.sort;
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(bv);
      return dir * ((av > bv) - (av < bv));
    });
    return rows;
  }

  const FLAG_LABEL = { healthy: 'Healthy', reorder: 'Reorder', excess: 'Excess', dead: 'Dead Stock', neverSold: 'Never Sold', zeroStock: 'Zero Stock' };
  const FLAG_CLASS = { healthy: 'ok', reorder: 'warn', excess: 'muted', dead: 'danger', neverSold: 'purple', zeroStock: 'grey' };

  function renderTable() {
    const body = $('#ihd-table-body');
    const countEl = $('#ihd-table-count');
    if (!body) return;
    const rows = filteredRows();
    if (countEl) countEl.textContent = rows.length.toLocaleString() + ' of ' + state.rows.length.toLocaleString() + ' SKUs';
    if (!rows.length) { body.innerHTML = '<tr><td colspan="9" class="ihd-empty">No products match this search/filter.</td></tr>'; return; }
    const MAX_RENDER = 300; // keep the DOM light; search/filter narrows it down from there
    body.innerHTML = rows.slice(0, MAX_RENDER).map(r => `
      <tr>
        <td class="ihd-td-name"><div class="ihd-name">${esc(r.name)}</div><div class="ihd-code">${esc(r.code)}</div></td>
        <td>${esc(r.supplier)}</td>
        <td class="num">${fmtNum(r.stock)}</td>
        <td class="num">${fmtMoney(r.stockValue)}</td>
        <td class="num">${fmtDays(r.coverDays)}</td>
        <td class="num" title="30d / 60d / 90d">${fmtNum(r.qty30)} / ${fmtNum(r.qty60)} / ${fmtNum(r.qty90)}</td>
        <td><span class="ihd-flag ${FLAG_CLASS[r.flag]}">${FLAG_LABEL[r.flag]}</span></td>
        <td>${fmtDate(r.lastReceiveDate)}</td>
        <td class="num">${r.flag === 'reorder' ? fmtMoney(r.reorderValue) : '—'}</td>
      </tr>`).join('') + (rows.length > MAX_RENDER ? `<tr><td colspan="9" class="ihd-empty">…${(rows.length - MAX_RENDER).toLocaleString()} more — narrow your search to see them.</td></tr>` : '');
  }

  // ---------- Wiring ----------
  function wireControls() {
    const searchInput = $('#ihd-search');
    if (searchInput && !searchInput.dataset.wired) {
      searchInput.dataset.wired = '1';
      searchInput.addEventListener('input', e => { state.search = e.target.value; renderTable(); });
    }
    const supplierSel = $('#ihd-supplier-select');
    if (supplierSel && !supplierSel.dataset.wired) {
      supplierSel.dataset.wired = '1';
      supplierSel.addEventListener('change', e => { state.supplier = e.target.value; renderTable(); });
    }
    $$('.ihd-chip').forEach(chip => {
      if (chip.dataset.wired) return;
      chip.dataset.wired = '1';
      chip.addEventListener('click', () => {
        const f = chip.dataset.flag || '';
        state.healthFilter = (state.healthFilter === f) ? '' : f;
        $$('.ihd-chip').forEach(c => c.classList.toggle('active', c === chip && state.healthFilter === f));
        renderTable();
      });
    });
    $$('#ihd-table thead th[data-sort]').forEach(th => {
      if (th.dataset.wired) return;
      th.dataset.wired = '1';
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir *= -1; else { state.sort.key = key; state.sort.dir = -1; }
        renderTable();
      });
    });
    const refreshBtn = $('#ihd-refresh-btn');
    if (refreshBtn && !refreshBtn.dataset.wired) {
      refreshBtn.dataset.wired = '1';
      refreshBtn.addEventListener('click', () => {
        if (window.StockLedgerApp && typeof window.StockLedgerApp.init === 'function') window.StockLedgerApp.init();
        pollForData(true);
      });
    }
  }

  // ---------- Init / poll ----------
  function pollForData(forceRender) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    let tries = 0;
    pollTimer = setInterval(() => {
      tries++;
      const hasData = window.StockLedgerApp && typeof window.StockLedgerApp.hasData === 'function' && window.StockLedgerApp.hasData();
      if (hasData || tries > 30) { // ~15s max wait
        clearInterval(pollTimer); pollTimer = null;
        computeAll();
        render();
      } else if (forceRender && tries === 1) {
        render(); // show empty state immediately, fills in once data lands
      }
    }, 500);
  }

  function init() {
    if (!document.getElementById('page-inv-health')) return;
    wireControls();
    // Kick off Stock Ledger's own load (idempotent/safe to call every
    // visit — same pattern as excess-working.js / reorder-report.js).
    if (window.StockLedgerApp && typeof window.StockLedgerApp.init === 'function') window.StockLedgerApp.init();
    if (!initialized) {
      initialized = true;
      computeAll();
      render();
    }
    pollForData(false);
  }

  window.renderInventoryHealthDashboard = function () { computeAll(); render(); };

  return { init: init };
})();
