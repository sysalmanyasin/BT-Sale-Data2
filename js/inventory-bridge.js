// ══════════════════════════════════════════════════════════════════════
// INVENTORY BRIDGE  —  BT Inventory tab (July 2026)
//
// Same one-way, read-only pattern as audit-bridge.js: Pharmacy Audit
// Hub's inventory is no longer per-device Dropbox-fed — as of
// 2026-07-14 a Supabase Edge Function (sync-inventory-from-dropbox)
// owns the one Dropbox token and pulls server-side into a shared
// `inventory_products` table (see that project's
// js/repository/supabase.js, "Inventory (shared, server-synced from
// Dropbox)" section, and js/actions/legacy-actions.js). Every device —
// including this one — just reads that table. Same Supabase project,
// same anon/publishable key as audit-bridge.js (RLS, not key secrecy,
// is what actually scopes access — see that file's header note for
// the full reasoning; not repeated here).
//
// Deliberately read-only, same as audit-native.js's Assignments port:
// this app never calls triggerInventorySyncRemote() (the Edge Function
// that actually pulls from Dropbox) — that write belongs to Pharmacy
// Audit Hub's own Tools/Inventory tab. "Refresh" here only ever
// re-reads the already-synced table, never triggers a new pull.
// ══════════════════════════════════════════════════════════════════════

// Same Supabase project as audit-bridge.js — inventory_products and
// audit engagements/rounds/etc all live in the one Pharmacy Audit Hub
// project, just different tables.
const INV_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const INV_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';
const FULLDATA_CACHE_KEY = 'bt_inventory_fulldata_v1';
const FULLDATA_MIN_REFRESH_MS = 60 * 1000; // 1 min — opened deliberately, same as audit-native's full data

let _client = null;
function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _client = supabase.createClient(INV_SUPABASE_URL, INV_SUPABASE_ANON_KEY);
  return _client;
}

// Always "connected" — no manual pairing step, same as AuditBridge.isConnected().
export function isConnected() { return true; }

function _setLocal(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* best-effort */ } }
function _getLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

// Row shape matches Pharmacy Audit Hub's own _rowToInventoryProduct
// (js/repository/supabase.js) exactly, so nothing here re-derives or
// second-guesses field meaning — it's a straight read.
function _rowToProduct(row) {
  return {
    code: row.code || '',
    name: row.name || '',
    qty: row.qty || 0,
    price: row.price || 0,
    company: row.company || 'Unassigned Manufacturer',
    generic: row.generic || '',
    supplier: row.supplier || 'Unassigned Supplier',
    conversionFactor: row.conversion_factor || 1,
  };
}

// PostgREST caps a single select() at ~1000 rows by default — paginate
// with .range() so a 5,000+ item inventory doesn't silently truncate,
// same reasoning as Pharmacy Audit Hub's own fetchInventoryProducts.
async function _fetchAllProducts(client) {
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
    if (data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }
  return all.map(_rowToProduct);
}

async function _fetchLastSync(client) {
  const { data, error } = await client
    .from('inventory_sync_log')
    .select('*')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error; // caller catches — sync log is best-effort display only
  return data ? { syncedAt: data.synced_at, itemCount: data.item_count, source: data.source } : null;
}

let _fullData = null;
let _fullInFlight = null;

export function getFullData() {
  if (_fullData) return _fullData;
  try {
    const raw = _getLocal(FULLDATA_CACHE_KEY);
    if (raw) return (_fullData = JSON.parse(raw));
  } catch (e) { /* fall through */ }
  return null;
}

export async function refreshFullData(force) {
  const cached = _fullData || getFullData();
  if (!force && cached && (Date.now() - cached.fetchedAt) < FULLDATA_MIN_REFRESH_MS) return cached;
  if (_fullInFlight) return _fullInFlight; // de-dupe concurrent callers

  _fullInFlight = (async () => {
    try {
      const client = _getClient();
      if (!client) return cached;

      const products = await _fetchAllProducts(client);
      let lastSync = null;
      try { lastSync = await _fetchLastSync(client); } catch (e) { /* best-effort, table may not exist yet — ignore */ }

      const data = { products, lastSync, fetchedAt: Date.now() };
      _fullData = data;
      try { _setLocal(FULLDATA_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* best-effort — fine if too big, in-memory still works this session */ }
      if (typeof window.inventoryNativeOnRefresh === 'function') window.inventoryNativeOnRefresh();
      if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();
      return data;
    } catch (e) {
      return _fullData || cached;
    } finally {
      _fullInFlight = null;
    }
  })();
  return _fullInFlight;
}

// Bridged — see header note (same pattern as audit-bridge.js).
window.inventoryBridgeIsConnected = isConnected;
window.inventoryBridgeGetFullData = getFullData;
window.inventoryBridgeRefresh = refreshFullData;
