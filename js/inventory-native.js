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

const biState = { search: '', groupBy: 'none', page: 1 };
let _searchDebounce = null;

function _visibleProducts(products) {
  const q = biState.search.toLowerCase().trim();
  if (!q) return products;
  return products.filter(p =>
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

function _rowHtml(p) {
  return `<tr class="bti-row">
    <td>
      <div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.3">${esc(p.name)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">${p.code ? esc(p.code) : 'No SKU'} · ${esc(p.generic || '—')}</div>
    </td>
    <td style="text-align:right;font-weight:700;color:var(--text);font-size:13px">${p.qty.toLocaleString()}</td>
    <td style="text-align:right;font-size:13px">Rs ${Number(p.price || 0).toLocaleString()}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(p.company || '—')}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(p.supplier || '—')}</td>
    <td style="text-align:right;font-size:11px;color:var(--muted)">${p.conversionFactor ?? 1}</td>
  </tr>`;
}

function _groupHeaderHtml(groupName, sub, continued) {
  return `<tr class="bti-group-header">
    <td colspan="6">
      <strong style="color:var(--text);font-size:12.5px">${esc(groupName)}</strong>${continued ? ' <span style="font-weight:600;color:var(--muted)">(cont.)</span>' : ''}
      <span style="color:var(--muted);font-size:11px;margin-left:8px">${sub.count} SKU${sub.count !== 1 ? 's' : ''} · ${sub.totalQty.toLocaleString()} units · Rs ${sub.totalValue.toLocaleString()}</span>
    </td>
  </tr>`;
}

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
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '📭 No inventory synced yet.'; }
    if (wrapEl) wrapEl.style.display = 'none';
    if (topPager) topPager.innerHTML = '';
    if (botPager) botPager.innerHTML = '';
    return;
  }

  const visible = _visibleProducts(data.products);
  if (!visible.length) {
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '🔍 No matching items found.'; }
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
  renderInventoryPage();
  InventoryBridge.refreshFullData(false).then(renderInventoryPage);
}
export function onBridgeRefresh() { renderInventoryPage(); }

window.biSetSearch = biSetSearch;
window.biSetGroupBy = biSetGroupBy;
window.biGoToPage = biGoToPage;
window.biRefresh = biRefresh;
window.inventoryNativeOnRefresh = onBridgeRefresh;
window.invOnShowInventory = onShowInventory;
