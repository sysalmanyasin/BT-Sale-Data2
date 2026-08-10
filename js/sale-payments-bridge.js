// ══════════════════════════════════════════════════════════════════════
// SALE PAYMENTS BRIDGE  —  BT Sale Data › Payments tab (Aug 2026)
//
// Same one-way, read-only pattern as inventory-bridge.js: Candela POS
// exports sale.ps1 → Dropbox → sync-inventory-from-dropbox Edge
// Function → Supabase. As of 2026-08-07 that same Edge Function (and
// the same inventory.json file) also carries a day-level cash/card/
// credit payment-type split and a per-customer credit breakdown,
// sourced from tblSales (Cash_amt/Card_amt/CreditAmount) rather than
// the per-product sale-value aggregates inventory-bridge.js reads —
// so they land in two new tables, sales_payment_summary and
// sales_credit_by_customer, instead of new columns on
// inventory_products. Same Supabase project, same anon/publishable
// key as inventory-bridge.js/audit-bridge.js (RLS, not key secrecy, is
// what scopes access — see audit-bridge.js's header note for the full
// reasoning, not repeated here).
//
// Both tables are a fixed "today + last 3 days" full-refresh snapshot,
// re-synced from scratch on every Candela → Dropbox → Supabase run —
// there's no older history to page back through, and no write path
// here (same "never triggers a new pull" rule as inventory-bridge.js).
// ══════════════════════════════════════════════════════════════════════

// Same Supabase project as inventory-bridge.js/audit-bridge.js —
// sales_payment_summary and sales_credit_by_customer live in the one
// Pharmacy Audit Hub project, just different tables.
const SP_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const SP_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';
const SP_FULLDATA_CACHE_KEY = 'bt_salepayments_fulldata_v1';
const SP_FULLDATA_MIN_REFRESH_MS = 60 * 1000; // 1 min — same as inventory-bridge.js's full data

let _client = null;
function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  // persistSession/autoRefreshToken/detectSessionInUrl: false — pure anon
  // client, isolated from the session inventory-bridge.js's client shares
  // via localStorage with the Google sign-in flow (same project URL).
  _client = supabase.createClient(SP_SUPABASE_URL, SP_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return _client;
}

// Always "connected" — no manual pairing step, same as InventoryBridge.isConnected().
export function isConnected() { return true; }

function _setLocal(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* best-effort */ } }
function _getLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

// Row shapes match sync-inventory-from-dropbox's own insert shape
// exactly (snake_case DB columns → camelCase here), same straight-read
// principle as inventory-bridge.js's _rowToProduct.
function _rowToSummary(row) {
  return {
    saleDay: row.sale_day || null,
    cashSale: row.cash_sale || 0,
    cardSale: row.card_sale || 0,
    creditSale: row.credit_sale || 0,
    totalSale: row.total_sale || 0,
  };
}
function _rowToCredit(row) {
  return {
    saleDay: row.sale_day || null,
    customerName: row.customer_name || '',
    creditAmount: row.credit_amount || 0,
    receiptCount: row.receipt_count || 0,
  };
}

async function _fetchSummary(client) {
  const { data, error } = await client
    .from('sales_payment_summary')
    .select('*')
    .order('sale_day', { ascending: true });
  if (error) throw error;
  return (data || []).map(_rowToSummary);
}

async function _fetchCreditByCustomer(client) {
  const { data, error } = await client
    .from('sales_credit_by_customer')
    .select('*')
    .order('sale_day', { ascending: false })
    .order('credit_amount', { ascending: false });
  if (error) throw error;
  return (data || []).map(_rowToCredit);
}

let _fullData = null;
let _fullInFlight = null;

export function getFullData() {
  if (_fullData) return _fullData;
  try {
    const raw = _getLocal(SP_FULLDATA_CACHE_KEY);
    if (raw) return (_fullData = JSON.parse(raw));
  } catch (e) { /* fall through */ }
  return null;
}

export async function refreshFullData(force) {
  const cached = _fullData || getFullData();
  if (!force && cached && (Date.now() - cached.fetchedAt) < SP_FULLDATA_MIN_REFRESH_MS) return cached;
  if (_fullInFlight) return _fullInFlight; // de-dupe concurrent callers

  _fullInFlight = (async () => {
    try {
      const client = _getClient();
      if (!client) return cached;

      const [paymentSummary, creditByCustomer] = await Promise.all([
        _fetchSummary(client),
        _fetchCreditByCustomer(client),
      ]);

      const data = { paymentSummary, creditByCustomer, fetchedAt: Date.now() };
      _fullData = data;
      try { _setLocal(SP_FULLDATA_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* best-effort */ }
      if (typeof window.salePaymentsBridgeOnRefresh === 'function') window.salePaymentsBridgeOnRefresh();
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

// Bridged — see header note (same pattern as inventory-bridge.js).
window.salePaymentsBridgeIsConnected = isConnected;
window.salePaymentsBridgeGetFullData = getFullData;
window.salePaymentsBridgeRefresh = refreshFullData;
