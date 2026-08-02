// ══════════════════════════════════════════════════════════════════════
// Inventory Search — standalone PWA
//
// Deliberately separate from the main app (see README): installs as its
// own home-screen icon/shortcut for one-tap access, no login screen, no
// nav chrome. Read-only against the same Supabase project + table as
// inventory-bridge.js (same anon/publishable key — RLS, not key secrecy,
// scopes access, exactly as that file's header explains).
//
// Reuses two existing modules from the main app rather than
// reimplementing them: BTFormat (js/bt-format.js) for currency, and
// BTSearch (js/bt-search.js) for fuzzy ranking — same engine that
// powers the All Sections drawer.
// ══════════════════════════════════════════════════════════════════════

import { BTFormat } from '../js/bt-format.js';
import { BTSearch } from '../js/bt-search.js';

const INV_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const INV_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';

// medicine-ai-info is deployed in the BT SALE DATA / Closing project
// (not the inventory project) — see supabase/functions/medicine-ai-info.
const AI_SUPABASE_URL = 'https://wetbugzzchkghpzmowod.supabase.co';
const AI_SUPABASE_ANON_KEY = 'sb_publishable_pPP1QowIcwHFjCGFldrevw_De11RqkD';
const AI_FUNCTION_URL = AI_SUPABASE_URL + '/functions/v1/medicine-ai-info';

const CACHE_KEY = 'inv_search_products_v1';
const MIN_REFRESH_MS = 60 * 1000;

const els = {
  input: document.getElementById('searchInput'),
  count: document.getElementById('resultCount'),
  list: document.getElementById('resultsList'),
  empty: document.getElementById('emptyState'),
  lastSyncLine: document.getElementById('lastSyncLine'),
  status: document.getElementById('statusBar'),
  refreshBtn: document.getElementById('refreshBtn'),
  backdrop: document.getElementById('sheetBackdrop'),
  sheet: document.getElementById('detailSheet'),
  sheetContent: document.getElementById('sheetContent'),
  sheetClose: document.getElementById('sheetClose'),
};

let _client = null;
function getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null;
  _client = supabase.createClient(INV_SUPABASE_URL, INV_SUPABASE_ANON_KEY);
  return _client;
}

function rowToProduct(row) {
  return {
    code: row.code || '',
    name: row.name || '',
    qty: row.qty || 0,
    price: row.price || 0,
    company: row.company || 'Unassigned Manufacturer',
    generic: row.generic || '',
    supplier: row.supplier || 'Unassigned Supplier',
    lastReceiveDate: row.last_receive_date || null,
    lastSaleDate: row.last_sale_date || null,
    netQty30Days: row.net_qty_30_days || 0,
    netQty90Days: row.net_qty_90_days || 0,
    saleValueInclTax30Days: row.sale_value_incl_tax_30_days || 0,
    taxPercent: row.tax_percent || 0,
    isTaxable: !!row.is_taxable,
  };
}

async function fetchAllProducts(client) {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('inventory_products')
      .select('*')
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all.map(rowToProduct);
}

let PRODUCTS = [];
let fetchedAt = 0;

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* best-effort */ }
}

function setStatus(msg, show) {
  els.status.textContent = msg || '';
  els.status.hidden = !show;
}

async function refresh(force) {
  if (!force && PRODUCTS.length && (Date.now() - fetchedAt) < MIN_REFRESH_MS) return;
  const client = getClient();
  if (!client) { setStatus('Supabase library still loading…', true); return; }
  els.refreshBtn.classList.add('spinning');
  setStatus('Syncing inventory…', true);
  try {
    const products = await fetchAllProducts(client);
    PRODUCTS = products;
    fetchedAt = Date.now();
    saveCache({ products, fetchedAt });
    setStatus('', false);
    els.lastSyncLine.textContent = products.length
      ? products.length.toLocaleString('en-PK') + ' products • synced just now'
      : '';
    runSearch();
  } catch (e) {
    setStatus('Sync failed — showing last saved data. ' + (e.message || ''), true);
  } finally {
    els.refreshBtn.classList.remove('spinning');
  }
}

function qtyClass(qty) {
  if (qty <= 0) return 'qty-out';
  if (qty <= 10) return 'qty-low';
  return 'qty-ok';
}

function renderResults(items) {
  els.list.innerHTML = '';
  const q = els.input.value.trim();
  els.count.textContent = q ? items.length + ' found' : '';
  els.empty.hidden = !!q;
  if (!q) return;

  if (!items.length) {
    els.list.innerHTML = '<div class="empty-sub" style="text-align:center;padding:30px 0;color:var(--text-dim)">No matches.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  items.slice(0, 60).forEach(p => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-main">
        <div class="result-name">${escapeHtml(p.name)}</div>
        <div class="result-sub">${escapeHtml(p.generic || p.company)}${p.code ? ' • ' + escapeHtml(p.code) : ''}</div>
      </div>
      <div class="result-side">
        <div class="result-price">${BTFormat.currency(p.price)}</div>
        <div class="result-qty ${qtyClass(p.qty)}">${p.qty} in stock</div>
      </div>`;
    card.addEventListener('click', () => openDetail(p));
    frag.appendChild(card);
  });
  els.list.appendChild(frag);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function runSearch() {
  const q = els.input.value.trim();
  if (!q) { renderResults([]); return; }
  const ranked = BTSearch.filterAndRank(PRODUCTS, q, ['name', 'generic', 'code', 'company']);
  renderResults(ranked);
}

let debounceTimer = null;
els.input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, 120);
});

els.refreshBtn.addEventListener('click', () => refresh(true));

// ── Detail sheet ─────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (e) { return '—'; }
}

function openDetail(p) {
  els.sheetContent.innerHTML = `
    <div class="sheet-title">${escapeHtml(p.name)}</div>
    <div class="sheet-generic">${escapeHtml(p.generic || 'No generic listed')}</div>

    <div class="detail-grid">
      <div class="detail-cell">
        <div class="detail-label">Stock</div>
        <div class="detail-value ${qtyClass(p.qty)}">${p.qty}</div>
      </div>
      <div class="detail-cell">
        <div class="detail-label">Price</div>
        <div class="detail-value">${BTFormat.currency(p.price)}</div>
      </div>
    </div>

    <div class="section-title">Product</div>
    <div class="kv-row"><span>Code</span><span>${escapeHtml(p.code || '—')}</span></div>
    <div class="kv-row"><span>Company</span><span>${escapeHtml(p.company)}</span></div>
    <div class="kv-row"><span>Supplier</span><span>${escapeHtml(p.supplier)}</span></div>
    <div class="kv-row"><span>Tax</span><span>${p.isTaxable ? p.taxPercent + '%' : 'Not taxable'}</span></div>

    <div class="section-title">Movement</div>
    <div class="kv-row"><span>Last received</span><span>${fmtDate(p.lastReceiveDate)}</span></div>
    <div class="kv-row"><span>Last sold</span><span>${fmtDate(p.lastSaleDate)}</span></div>
    <div class="kv-row"><span>Net qty (30d)</span><span>${p.netQty30Days}</span></div>
    <div class="kv-row"><span>Net qty (90d)</span><span>${p.netQty90Days}</span></div>
    <div class="kv-row"><span>Sales value (30d)</span><span>${BTFormat.currency(p.saleValueInclTax30Days)}</span></div>

    <div class="ai-box">
      <div class="ai-box-head">
        <span class="label">✨ AI Medicine Info</span>
        <button id="aiAskBtn" class="ai-btn">Ask AI</button>
      </div>
      <div id="aiResult" class="ai-text"></div>
      <div id="aiDisclaimer" class="ai-disclaimer" hidden>⚠ AI-generated general reference only — always verify against the official leaflet / prescribing information before advising a patient.</div>
    </div>
  `;

  document.getElementById('aiAskBtn').addEventListener('click', (e) => askAI(p, e.target));

  els.backdrop.hidden = false;
  els.sheet.hidden = false;
}

function closeDetail() {
  els.backdrop.hidden = true;
  els.sheet.hidden = true;
}
els.sheetClose.addEventListener('click', closeDetail);
els.backdrop.addEventListener('click', closeDetail);

async function askAI(p, btn) {
  const out = document.getElementById('aiResult');
  const disclaimer = document.getElementById('aiDisclaimer');
  const isRefresh = btn.textContent === 'Refresh';
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  out.textContent = '';
  disclaimer.hidden = true;
  try {
    const res = await fetch(AI_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': AI_SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + AI_SUPABASE_ANON_KEY,
      },
      // Refresh means "ask again, don't just hand me back the same
      // cached answer" — force bypasses the server-side cache lookup.
      body: JSON.stringify({ name: p.name, generic: p.generic, company: p.company, force: isRefresh }),
    });
    const data = await res.json();
    if (!res.ok || !data.info) throw new Error(data.error || ('HTTP ' + res.status));
    out.textContent = data.info;
    disclaimer.hidden = false;
    btn.textContent = 'Refresh';
  } catch (e) {
    out.textContent = 'Could not reach AI service. ' + (e.message || '');
  } finally {
    btn.disabled = false;
    if (btn.textContent === 'Thinking…') btn.textContent = 'Ask AI';
  }
}

// ── Boot ─────────────────────────────────────────────────────────────
(function boot() {
  const cached = loadCache();
  if (cached && cached.products) {
    PRODUCTS = cached.products;
    fetchedAt = cached.fetchedAt || 0;
    els.lastSyncLine.textContent = PRODUCTS.length
      ? PRODUCTS.length.toLocaleString('en-PK') + ' products • last synced ' + new Date(fetchedAt).toLocaleTimeString('en-PK')
      : '';
  }
  window.addEventListener('load', () => refresh(false));
  // supabase-js loads via a deferred classic script; poll briefly in case module ran first
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if (typeof supabase !== 'undefined' || tries > 40) { clearInterval(t); refresh(false); }
  }, 100);
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
