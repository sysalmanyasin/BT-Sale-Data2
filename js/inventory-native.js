// ══════════════════════════════════════════════════════════════════════
// INVENTORY NATIVE  —  BT Inventory tab
//
// Read-only browser over Pharmacy Audit Hub's shared, Supabase-synced
// inventory (see inventory-bridge.js's header note) — searchable,
// groupable by Manufacturer/Supplier, paged 100 rows at a time so a
// 5,000+ SKU inventory never renders more than one page of <tr>s at
// once. Loosely modelled on Pharmacy Audit Hub's own Inventory tab
// (js/pages/inventory-pages.js + js/components/inventory-components.js)
// but true page-by-page navigation instead of "load more", and no
// selection/templates/Random Audit launch — those stay exclusively in
// Pharmacy Audit Hub itself (see audit-native.js's header note on why
// writes/actions are deliberately not ported here).
// ══════════════════════════════════════════════════════════════════════

import * as InventoryBridge from './inventory-bridge.js';

const PAGE_SIZE = 100;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtQty(v) { return (Number(v) || 0).toLocaleString('en-PK'); }
function fmtMoney(v) { return 'Rs ' + (Number(v) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }

// ── Optional column registry ────────────────────────────────────────
// The bridge (inventory-bridge.js) already maps every column on
// inventory_products; the base table only ever showed 6 of them. This
// registry is every remaining column, off by default so the table
// stays compact, toggleable per-column from the "Columns" picker.
// Grouped for the picker UI; group labels are cosmetic only.
const OPTIONAL_COLUMNS = [
  { key: 'creationDate', label: 'Created', group: 'Dates', num: false, render: p => fmtDate(p.creationDate) },
  { key: 'lastReceiveDate', label: 'Last Receive', group: 'Dates', num: false, render: p => fmtDate(p.lastReceiveDate) },
  { key: 'lastSaleDate', label: 'Last Sale', group: 'Dates', num: false, render: p => fmtDate(p.lastSaleDate) },

  { key: 'netQty30Days', label: 'Qty 30d', group: '30-Day Sales', num: true, render: p => fmtQty(p.netQty30Days) },
  { key: 'saleValueExclTax30Days', label: 'Sale (excl tax) 30d', group: '30-Day Sales', num: true, render: p => fmtMoney(p.saleValueExclTax30Days) },
  { key: 'saleValueInclTax30Days', label: 'Sale (incl tax) 30d', group: '30-Day Sales', num: true, render: p => fmtMoney(p.saleValueInclTax30Days) },

  { key: 'netQty60Days', label: 'Qty 60d', group: '60-Day Sales', num: true, render: p => fmtQty(p.netQty60Days) },
  { key: 'saleValueExclTax60Days', label: 'Sale (excl tax) 60d', group: '60-Day Sales', num: true, render: p => fmtMoney(p.saleValueExclTax60Days) },
  { key: 'saleValueInclTax60Days', label: 'Sale (incl tax) 60d', group: '60-Day Sales', num: true, render: p => fmtMoney(p.saleValueInclTax60Days) },

  { key: 'netQty90Days', label: 'Qty 90d', group: '90-Day Sales', num: true, render: p => fmtQty(p.netQty90Days) },
  { key: 'saleValueExclTax90Days', label: 'Sale (excl tax) 90d', group: '90-Day Sales', num: true, render: p => fmtMoney(p.saleValueExclTax90Days) },
  { key: 'saleValueInclTax90Days', label: 'Sale (incl tax) 90d', group: '90-Day Sales', num: true, render: p => fmtMoney(p.saleValueInclTax90Days) },

  { key: 'netQtyToday', label: 'Qty Today', group: 'Today', num: true, render: p => fmtQty(p.netQtyToday) },
  { key: 'saleValueExclTaxToday', label: 'Sale (excl tax) Today', group: 'Today', num: true, render: p => fmtMoney(p.saleValueExclTaxToday) },
  { key: 'saleValueInclTaxToday', label: 'Sale (incl tax) Today', group: 'Today', num: true, render: p => fmtMoney(p.saleValueInclTaxToday) },

  { key: 'taxPercent', label: 'Tax %', group: 'Tax', num: true, render: p => (Number(p.taxPercent) || 0).toLocaleString('en-PK') + '%' },
  { key: 'isTaxable', label: 'Taxable', group: 'Tax', num: false, render: p => (p.isTaxable ? 'Yes' : 'No') },
];
const COLUMNS_STORE_KEY = 'bt_biColumns_v1';

function repoGet(key) {
  try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
  catch (e) { return null; }
}
function repoSet(key, value) {
  try { if (window.Repository) window.Repository.setItem(key, value); else localStorage.setItem(key, value); }
  catch (e) { /* ignore */ }
}
function loadEnabledColumns() {
  try {
    const raw = repoGet(COLUMNS_STORE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    const valid = new Set(OPTIONAL_COLUMNS.map(c => c.key));
    return new Set(Array.isArray(arr) ? arr.filter(k => valid.has(k)) : []);
  } catch (e) { return new Set(); }
}
function saveEnabledColumns() {
  repoSet(COLUMNS_STORE_KEY, JSON.stringify(Array.from(biState.columns)));
}

const biState = { search: '', groupBy: 'none', page: 1, negativeOnly: false, columns: loadEnabledColumns() };
let _searchDebounce = null;

function _visibleProducts(products) {
  let list = products;
  // Negative Stock Only: qty < 0 means the POS oversold past zero (a
  // shrinkage/data-entry signal), so this is a strict "less than zero"
  // check, not "zero or below" — a 0-stock item is just sold out, not
  // an anomaly.
  if (biState.negativeOnly) list = list.filter(p => (p.qty || 0) < 0);
  const q = biState.search.toLowerCase().trim();
  if (!q) return list;
  return list.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.code || '').toLowerCase().includes(q) ||
    (p.generic || '').toLowerCase().includes(q) ||
    (p.company || '').toLowerCase().includes(q) ||
    (p.supplier || '').toLowerCase().includes(q));
}

function _sortedForGroup(products) {
  const key = biState.groupBy === 'supplier' ? 'supplier' : biState.groupBy === 'company' ? 'company' : null;
  const sorted = products.slice().sort((a, b) => {
    if (key) {
      const ga = a[key] || '', gb = b[key] || '';
      if (ga !== gb) return ga.localeCompare(gb);
    }
    return (a.name || '').localeCompare(b.name || '');
  });
  return sorted;
}

// Full-group subtotal, computed against the whole filtered set (not
// just whatever slice lands on the current page), so it stays accurate
// regardless of which page a group's rows happen to fall on.
function _groupSubtotal(products, key, groupName) {
  const items = products.filter(p => (p[key] || '') === groupName);
  const totalQty = items.reduce((s, p) => s + (p.qty || 0), 0);
  const totalValue = items.reduce((s, p) => s + (p.qty || 0) * (p.price || 0), 0);
  return { count: items.length, totalQty, totalValue };
}

function _activeExtraColumns() {
  return OPTIONAL_COLUMNS.filter(c => biState.columns.has(c.key));
}

function _rowHtml(p) {
  const isNegative = (p.qty || 0) < 0;
  const extras = _activeExtraColumns().map(c =>
    `<td class="bti-extra-td" style="${c.num ? 'text-align:right;' : ''}font-size:11px;color:var(--muted);white-space:nowrap">${esc(c.render(p))}</td>`
  ).join('');
  return `<tr class="bti-row">
    <td>
      <div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.3">${esc(p.name)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">${p.code ? esc(p.code) : 'No SKU'} · ${esc(p.generic || '—')}</div>
    </td>
    <td style="text-align:right;font-weight:700;font-size:13px;color:${isNegative ? '#dc2626' : 'var(--text)'}">${isNegative ? '⚠️ ' : ''}${p.qty.toLocaleString()}</td>
    <td style="text-align:right;font-size:13px">Rs ${Number(p.price || 0).toLocaleString()}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(p.company || '—')}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(p.supplier || '—')}</td>
    <td style="text-align:right;font-size:11px;color:var(--muted)">${p.conversionFactor ?? 1}</td>
    ${extras}
  </tr>`;
}

function _groupHeaderHtml(groupName, sub, continued) {
  const colspan = 6 + _activeExtraColumns().length;
  return `<tr class="bti-group-header">
    <td colspan="${colspan}">
      <strong style="color:var(--text);font-size:12.5px">${esc(groupName)}</strong>${continued ? ' <span style="font-weight:600;color:var(--muted)">(cont.)</span>' : ''}
      <span style="color:var(--muted);font-size:11px;margin-left:8px">${sub.count} SKU${sub.count !== 1 ? 's' : ''} · ${sub.totalQty.toLocaleString()} units · Rs ${sub.totalValue.toLocaleString()}</span>
    </td>
  </tr>`;
}

// ── Column picker ────────────────────────────────────────────────────
function _columnsPanelHtml() {
  const groups = [];
  OPTIONAL_COLUMNS.forEach(c => {
    let g = groups.find(g => g.name === c.group);
    if (!g) { g = { name: c.group, cols: [] }; groups.push(g); }
    g.cols.push(c);
  });
  return groups.map(g => `
    <div class="bti-col-group">
      <div class="bti-col-group-title">${esc(g.name)}</div>
      ${g.cols.map(c => `
        <label class="bti-col-check">
          <input type="checkbox" ${biState.columns.has(c.key) ? 'checked' : ''} onchange="biToggleColumn('${c.key}', this.checked)">
          ${esc(c.label)}
        </label>`).join('')}
    </div>`).join('');
}

function _renderColumnHeaders() {
  const row = document.getElementById('bti-thead-row');
  if (!row) return;
  row.querySelectorAll('.bti-extra-th').forEach(el => el.remove());
  _activeExtraColumns().forEach(c => {
    const th = document.createElement('th');
    th.className = 'bti-extra-th' + (c.num ? ' bti-num' : '');
    th.textContent = c.label;
    row.appendChild(th);
  });
}

function biToggleColumn(key, checked) {
  if (checked) biState.columns.add(key); else biState.columns.delete(key);
  saveEnabledColumns();
  _renderColumnHeaders();
  renderInventoryPage();
}

function biToggleColumnsPanel() {
  const panel = document.getElementById('bti-columns-panel');
  if (!panel) return;
  const showing = panel.style.display !== 'none';
  if (!showing) panel.innerHTML = _columnsPanelHtml();
  panel.style.display = showing ? 'none' : 'block';
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('bti-columns-panel');
  const btn = document.getElementById('bti-columns-btn');
  if (!panel || panel.style.display === 'none') return;
  if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
  panel.style.display = 'none';
});

function _paginationHtml(totalRows, totalPages) {
  if (totalRows === 0) return '';
  const start = (biState.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(biState.page * PAGE_SIZE, totalRows);
  return `<div class="bti-pagination">
    <button class="bti-page-btn" ${biState.page <= 1 ? 'disabled' : ''} onclick="biGoToPage(${biState.page - 1})">‹ Prev</button>
    <span class="bti-page-info">${start.toLocaleString()}–${end.toLocaleString()} of ${totalRows.toLocaleString()} · Page ${biState.page} of ${totalPages}</span>
    <button class="bti-page-btn" ${biState.page >= totalPages ? 'disabled' : ''} onclick="biGoToPage(${biState.page + 1})">Next ›</button>
  </div>`;
}

function renderInventoryPage() {
  _renderColumnHeaders();
  const tbody = document.getElementById('bti-table-body');
  const statusEl = document.getElementById('bti-status');
  const topPager = document.getElementById('bti-pagination-top');
  const botPager = document.getElementById('bti-pagination-bottom');
  const emptyEl = document.getElementById('bti-empty-state');
  const wrapEl = document.getElementById('bti-table-wrap');
  if (!tbody) return;

  const data = InventoryBridge.getFullData();
  if (!data) {
    if (statusEl) statusEl.textContent = '⏳ Loading from Random…';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '⏳ Loading inventory from Random…'; }
    if (wrapEl) wrapEl.style.display = 'none';
    if (topPager) topPager.innerHTML = '';
    if (botPager) botPager.innerHTML = '';
    return;
  }

  if (statusEl) {
    const syncedLabel = data.lastSync
      ? 'Last Dropbox sync ' + new Date(data.lastSync.syncedAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Synced ' + new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `${data.products.length.toLocaleString()} item(s) · ${syncedLabel}`;
  }

  if (!data.products.length) {
    const err = (typeof window.inventoryBridgeGetLastError === 'function') ? window.inventoryBridgeGetLastError() : null;
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = err ? `⚠️ Sync failed: ${err}` : '📭 No inventory synced yet.'; }
    if (wrapEl) wrapEl.style.display = 'none';
    if (topPager) topPager.innerHTML = '';
    if (botPager) botPager.innerHTML = '';
    return;
  }

  const visible = _visibleProducts(data.products);
  if (!visible.length) {
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = biState.negativeOnly
        ? '✅ No negative-stock items — nothing oversold right now.'
        : '🔍 No matching items found.';
    }
    if (wrapEl) wrapEl.style.display = 'none';
    if (topPager) topPager.innerHTML = '';
    if (botPager) botPager.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (wrapEl) wrapEl.style.display = 'block';

  const sorted = _sortedForGroup(visible);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (biState.page > totalPages) biState.page = totalPages;
  if (biState.page < 1) biState.page = 1;

  const startIdx = (biState.page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  const key = biState.groupBy === 'supplier' ? 'supplier' : biState.groupBy === 'company' ? 'company' : null;
  let html = '';
  if (key) {
    // The group a page starts mid-way through is marked "(cont.)" —
    // its header didn't begin on this page, but the group name still
    // needs to be visible for every row on screen.
    let curGroup = null;
    const firstGroupOfPage = (pageRows[0] && (pageRows[0][key] || '')) ?? null;
    const firstGroupStartsHere = startIdx === 0 || (sorted[startIdx - 1] && (sorted[startIdx - 1][key] || '')) !== firstGroupOfPage;
    pageRows.forEach((p, i) => {
      const g = p[key] || '';
      if (g !== curGroup) {
        curGroup = g;
        const sub = _groupSubtotal(sorted, key, g);
        const continued = i === 0 && !firstGroupStartsHere;
        html += _groupHeaderHtml(g || 'Unassigned', sub, continued);
      }
      html += _rowHtml(p);
    });
  } else {
    html = pageRows.map(_rowHtml).join('');
  }
  tbody.innerHTML = html;

  const pagerHtml = _paginationHtml(sorted.length, totalPages);
  if (topPager) topPager.innerHTML = pagerHtml;
  if (botPager) botPager.innerHTML = pagerHtml;
}

function biSetSearch(value) {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    biState.search = value;
    biState.page = 1;
    renderInventoryPage();
  }, 250);
}

function biSetGroupBy(mode) {
  biState.groupBy = mode;
  biState.page = 1;
  document.querySelectorAll('.bti-group-btn').forEach(b => b.classList.toggle('bti-group-btn-active', b.dataset.group === mode));
  renderInventoryPage();
}

function biToggleNegativeOnly() {
  biState.negativeOnly = !biState.negativeOnly;
  biState.page = 1;
  document.getElementById('bti-negative-toggle')?.classList.toggle('bti-group-btn-active', biState.negativeOnly);
  renderInventoryPage();
}

function biGoToPage(page) {
  biState.page = page;
  renderInventoryPage();
  document.getElementById('page-inventory')?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function biRefresh() {
  const statusEl = document.getElementById('bti-status');
  if (statusEl) statusEl.textContent = '⏳ Syncing…';
  await InventoryBridge.refreshFullData(true);
  renderInventoryPage();
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowInventory() {
  _renderColumnHeaders();
  renderInventoryPage();
  InventoryBridge.refreshFullData(false).then(renderInventoryPage);
}
export function onBridgeRefresh() { renderInventoryPage(); }

window.biSetSearch = biSetSearch;
window.biSetGroupBy = biSetGroupBy;
window.biToggleNegativeOnly = biToggleNegativeOnly;
window.biGoToPage = biGoToPage;
window.biRefresh = biRefresh;
window.biToggleColumn = biToggleColumn;
window.biToggleColumnsPanel = biToggleColumnsPanel;
window.inventoryNativeOnRefresh = onBridgeRefresh;
window.invOnShowInventory = onShowInventory;
