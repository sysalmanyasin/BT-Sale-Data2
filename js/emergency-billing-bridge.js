// ══════════════════════════════════════════════════════════════════════
// EMERGENCY BILLING BRIDGE — reads/writes emergency_invoices,
// emergency_invoice_items, emergency_stock_deltas on the main Supabase
// project (wetbugzzchkghpzmowod) — the SAME project as js/supabase.js's
// bt_salesdata, NOT the separate Pharmacy Audit Hub project
// inventory-bridge.js / audit-bridge.js read from.
//
// Two decisions from the architecture doc ("Emergency Billing Domain —
// Architecture Plan", §3-§5) shape this file:
//
// 1. Stock truth ownership. inventory_products (read via the existing
//    window.inventoryBridgeGetFullData(), from inventory-bridge.js) is
//    a read-only mirror of a DIFFERENT Supabase project, itself fed by
//    Candela POS -> Dropbox on its own schedule — this app has never
//    written to it and doesn't start here. "Available to sell right
//    now" is instead computed as bridge qty minus whatever this domain
//    has already sold since that product's last real sync — see
//    getAvailableQty(). The actual oversell gate is enforced
//    server-side inside the record_emergency_sale() RPC (row-locked,
//    see supabase/migrations/20260924182923_emergency_billing.sql) —
//    this file's own getAvailableQty() is for display/UX only, not
//    the security boundary.
//
// 2. Own non-persisted client, same reasoning attendance-bridge.js and
//    inventory-bridge.js document at length: a signed-in session on
//    this project makes RLS resolve zero rows for some anon-scoped
//    reads. This bridge never touches the signed-in client.
//
// Deliberately does NOT go through Repository/Actions/EventBus —
// emergency_invoices isn't DAILY/MONTHLY/STAFF, so the config.js Proxy
// doesn't apply here, same as attendance_events. Reconciliation into
// DAILY is a separate, deliberately manual step a human performs on
// the Add Entry screen (architecture doc §7/§9) — this file never
// writes to DAILY/MONTHLY/STAFF.
// ══════════════════════════════════════════════════════════════════════

const EB_SUPABASE_URL = 'https://wetbugzzchkghpzmowod.supabase.co';
const EB_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

let _client = null;
function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _client = supabase.createClient(EB_SUPABASE_URL, EB_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _client;
}

// Always "connected" — no manual pairing step, same as
// inventoryBridge.isConnected() / AuditBridge.isConnected().
export function isConnected() { return true; }

// Reuses sync-center.js's existing permanent per-device UDID
// (window._sc_getUDID, see js/sync-center.js) rather than minting a
// second device-identity scheme — this app already has one.
function _deviceUuid() {
  try { return (typeof window._sc_getUDID === 'function') ? window._sc_getUDID() : 'unknown-device'; }
  catch (e) { return 'unknown-device'; }
}

let _lastError = null;
export function getLastError() { return _lastError; }

// ── Product search — pure client-side filter over the existing
// inventory bridge cache. No network call, no stock math here; a
// product's exact live availability is only resolved via
// getAvailableQty() once it's actually being added to the cart. ────
export function searchProducts(query, limit) {
  limit = limit || 30;
  const data = (typeof window.inventoryBridgeGetFullData === 'function') ? window.inventoryBridgeGetFullData() : null;
  const products = (data && data.products) || [];
  const q = (query || '').trim().toLowerCase();
  if (!q) return products.slice(0, limit);
  const hits = products.filter(p =>
    (p.code && p.code.toLowerCase().includes(q)) ||
    (p.name && p.name.toLowerCase().includes(q)) ||
    (p.generic && p.generic.toLowerCase().includes(q)) ||
    (p.company && p.company.toLowerCase().includes(q))
  );
  return hits.slice(0, limit);
}

// Resolves a stable "sync window" key for the currently-cached inventory
// snapshot: the real Dropbox sync-log timestamp when it's available, else
// this device's own last-fetch time. Mirrors inventory-native.js's own
// freshness-label fallback exactly (`data.lastSync ? ... : 'Synced ' +
// data.fetchedAt`) — inventory-bridge.js's _fetchLastSync() already
// anticipates inventory_sync_log being unreachable ("table may not exist
// yet — ignore") and in this deployment it consistently is, so
// data.lastSync is always null here. Returned as an ISO string either way
// since this is compared/stored against Postgres's bridge_synced_at.
function _bridgeSyncKey(data) {
  if (data.lastSync && data.lastSync.syncedAt) return data.lastSync.syncedAt;
  if (data.fetchedAt) return new Date(data.fetchedAt).toISOString();
  return null;
}

// Resolves the bridge's current qty + sync timestamp for one product.
// Returns null if the inventory bridge hasn't loaded/synced yet —
// callers must treat that as "can't verify stock, block the sale",
// never as "assume unlimited stock".
//
// 2026-09-25 fix: this used to require data.lastSync.syncedAt specifically
// (the real Dropbox sync-log row) before returning anything — but that log
// is unreachable/unpopulated in this deployment (see _bridgeSyncKey above
// and inventory-native.js's matching fallback), so this returned null for
// EVERY product, always, even with a fully fresh product cache. In
// practice that meant getAvailableQty() never resolved and add-to-cart
// permanently failed with "Inventory data unavailable" regardless of how
// recently BT Inventory had synced. Falling back to the device's own
// fetchedAt keeps the real safety property intact — the row-locked
// record_emergency_sale() RPC is still the actual oversell gate, per this
// file's header note; this value only feeds the client-side display
// estimate and the "sold since this snapshot" bucketing.
function _bridgeSnapshot(productCode) {
  const data = (typeof window.inventoryBridgeGetFullData === 'function') ? window.inventoryBridgeGetFullData() : null;
  if (!data) return null;
  const syncedAt = _bridgeSyncKey(data);
  if (!syncedAt) return null;
  const product = (data.products || []).find(p => p.code === productCode);
  if (!product) return null;
  return { bridgeQty: product.qty || 0, syncedAt, product };
}

// Live-reads emergency_stock_deltas for exactly this product + this
// sync window (indexed PK lookup — cheap, one row). This is the "how
// much has THIS domain already sold since the real system last
// synced" half of availability; see the header note for why the RPC
// re-checks this itself under a row lock rather than trusting this
// read as the actual security boundary.
async function _soldSinceSync(productCode, syncedAt) {
  const client = _getClient();
  if (!client) return 0;
  const { data, error } = await client
    .from('emergency_stock_deltas')
    .select('qty_sold')
    .eq('product_code', productCode)
    .eq('bridge_synced_at', syncedAt)
    .maybeSingle();
  if (error) { _lastError = error.message || String(error); return 0; }
  return (data && data.qty_sold) || 0;
}

// Public: resolves { available, bridgeQty, syncedAt, product } for one
// product, or null if the inventory bridge isn't loaded — the billing
// screen should block adding-to-cart on null, not assume unlimited
// stock.
export async function getAvailableQty(productCode) {
  const snap = _bridgeSnapshot(productCode);
  if (!snap) return null;
  const sold = await _soldSinceSync(productCode, snap.syncedAt);
  return {
    available: Math.max(0, snap.bridgeQty - sold),
    bridgeQty: snap.bridgeQty,
    syncedAt: snap.syncedAt,
    product: snap.product,
  };
}

// ── Checkout — the one write path for a sale. Re-resolves each item's
// bridge_qty/bridge_synced_at fresh right here (never trusts values
// carried on the cart from earlier in the session — the bridge may
// have refreshed since an item was added), then calls the atomic RPC,
// which is the real oversell gate (row-locked, see the migration).
// cartItems: [{ code, name, price, qty }, ...]
// ────────────────────────────────────────────────────────────────
export async function recordSale({ staffName, customerName, customerPhone, cartItems, paymentMethod, cashReceived, discountAmount }) {
  const client = _getClient();
  if (!client) return { success: false, message: 'Supabase client not ready' };
  if (!cartItems || !cartItems.length) return { success: false, message: 'Cart is empty' };

  const items = [];
  for (const item of cartItems) {
    const snap = _bridgeSnapshot(item.code);
    if (!snap) return { success: false, message: `Inventory data unavailable for ${item.code} — refresh BT Inventory first` };
    items.push({
      product_code: item.code,
      product_name: item.name || snap.product.name || '',
      unit_price: item.price != null ? item.price : (snap.product.price || 0),
      qty: item.qty,
      bridge_qty: snap.bridgeQty,
      bridge_synced_at: snap.syncedAt,
    });
  }

  const subtotal  = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const discount  = discountAmount || 0;
  const netTotal  = Math.max(0, subtotal - discount);
  const cash      = cashReceived != null ? cashReceived : netTotal;
  const change    = paymentMethod === 'cash' ? Math.max(0, cash - netTotal) : 0;

  const { data, error } = await client.rpc('record_emergency_sale', {
    p_device_uuid: _deviceUuid(),
    p_staff_name: staffName || '',
    p_customer_name: customerName || '',
    p_customer_phone: customerPhone || '',
    p_subtotal: subtotal,
    p_discount_amount: discount,
    p_net_total: netTotal,
    p_payment_method: paymentMethod || 'cash',
    p_cash_received: cash,
    p_change_amount: change,
    p_items: items,
  });

  if (error) { _lastError = error.message || String(error); return { success: false, message: _lastError }; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.success) return { success: false, message: (row && row.message) || 'Unknown error' };

  // Same notify pattern as inventory-bridge.js: an optional native-page
  // refresh hook (defined once js/emergency-billing-native.js exists),
  // plus the shared Cover re-render.
  if (typeof window.emergencyBillingNativeOnRefresh === 'function') window.emergencyBillingNativeOnRefresh();
  if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();

  return { success: true, invoiceNumber: row.invoice_number, netTotal, change };
}

// ── Refunds / partial-refunds — architecture doc §6/§8's deferred
// phase. Validated server-side against the original invoice's own
// line items (see record_emergency_refund's header note in the
// migration) — this function re-resolves each item's CURRENT
// bridge_synced_at fresh, same as recordSale, so the stock given back
// lands in whichever sync window is live right now.
// items: [{ code, name, price, qty }, ...] — qty being refunded.
// ────────────────────────────────────────────────────────────────
export async function recordRefund({ staffName, originalInvoiceNumber, items, paymentMethod, cashGiven }) {
  const client = _getClient();
  if (!client) return { success: false, message: 'Supabase client not ready' };
  if (!originalInvoiceNumber) return { success: false, message: 'Original invoice number is required' };
  if (!items || !items.length) return { success: false, message: 'No items selected to refund' };

  const rpcItems = items.map(item => {
    const snap = _bridgeSnapshot(item.code);
    return {
      product_code: item.code,
      product_name: item.name || '',
      unit_price: item.price != null ? item.price : 0,
      qty: item.qty,
      // Null when the inventory bridge hasn't loaded — the RPC just
      // skips the stock give-back for that line rather than failing
      // the whole refund; the money/audit record still goes through.
      bridge_synced_at: snap ? snap.syncedAt : null,
    };
  });

  const { data, error } = await client.rpc('record_emergency_refund', {
    p_device_uuid: _deviceUuid(),
    p_staff_name: staffName || '',
    p_original_invoice_number: originalInvoiceNumber,
    p_payment_method: paymentMethod || 'cash',
    p_cash_given: cashGiven || 0,
    p_items: rpcItems,
  });

  if (error) { _lastError = error.message || String(error); return { success: false, message: _lastError }; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.success) return { success: false, message: (row && row.message) || 'Unknown error' };

  if (typeof window.emergencyBillingNativeOnRefresh === 'function') window.emergencyBillingNativeOnRefresh();
  if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();

  return { success: true, invoiceNumber: row.invoice_number, netTotal: row.net_total };
}

// ── Reporting reads — used by the reconciliation view (architecture
// doc §7/§8 phase 6). Paginated the same way inventory-bridge.js's
// _fetchAllProducts is, in case a busy day exceeds PostgREST's
// ~1000-row default cap. ───────────────────────────────────────────
async function _fetchAllRows(client, table, queryFn) {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn(client.from(table).select('*')).range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function fetchInvoices(opts) {
  opts = opts || {};
  const client = _getClient();
  if (!client) return [];
  try {
    return await _fetchAllRows(client, 'emergency_invoices', q => {
      let qq = q.order('billed_at', { ascending: false });
      if (opts.invoiceNumber) qq = qq.eq('invoice_number', opts.invoiceNumber);
      if (opts.from) qq = qq.gte('billed_at', opts.from);
      if (opts.to) qq = qq.lte('billed_at', opts.to);
      if (opts.unreconciledOnly) qq = qq.eq('reconciled_into_daily', false);
      return qq;
    });
  } catch (e) { _lastError = e.message || String(e); return []; }
}

export async function fetchInvoiceItems(invoiceNumber) {
  const client = _getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('emergency_invoice_items')
    .select('*')
    .eq('invoice_number', invoiceNumber);
  if (error) { _lastError = error.message || String(error); return []; }
  return data || [];
}

// Marks invoices as folded into a specific day's DAILY entry — call
// only after a human has actually typed the reconciled total into Add
// Entry. Never called automatically; see architecture doc §7/§9.
export async function markReconciled(invoiceNumbers, dailyDateStr) {
  const client = _getClient();
  if (!client || !invoiceNumbers || !invoiceNumbers.length) return false;
  const { error } = await client
    .from('emergency_invoices')
    .update({ reconciled_into_daily: true, reconciled_date: dailyDateStr })
    .in('invoice_number', invoiceNumbers);
  if (error) { _lastError = error.message || String(error); return false; }
  return true;
}

// Bridged onto window — same convention as inventory-bridge.js /
// attendance-bridge.js, for the classic-script pages that will
// consume this (js/emergency-billing-native.js, Cover's signal card)
// until they're converted to modules themselves.
window.emergencyBillingIsConnected       = isConnected;
window.emergencyBillingSearch            = searchProducts;
window.emergencyBillingGetAvailable      = getAvailableQty;
window.emergencyBillingRecordSale        = recordSale;
window.emergencyBillingRecordRefund      = recordRefund;
window.emergencyBillingFetchInvoices     = fetchInvoices;
window.emergencyBillingFetchInvoiceItems = fetchInvoiceItems;
window.emergencyBillingMarkReconciled    = markReconciled;
window.emergencyBillingGetLastError      = getLastError;
