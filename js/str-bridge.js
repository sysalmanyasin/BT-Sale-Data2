// ══════════════════════════════════════════════════════════════════════
// STR BRIDGE  —  STR Report tab (Stock Transfer Records, August 2026)
//
// Same one-way, read-only pattern as inventory-bridge.js/audit-bridge.js:
// the Supabase Edge Function sync-inventory-from-dropbox owns the one
// Dropbox token and full-refreshes str_headers / str_line_items on every
// run from inventory.json's strLast7Days / strLineItemsLast7Days sections
// (see that function's header comment). Every device — including this
// one — just reads those two tables. Same Supabase project, same
// anon/publishable key as inventory-bridge.js.
//
// IMPORTANT: str_headers/str_line_items only ever hold a rolling
// last-7-days window — the sync fully deletes and reinserts them every
// run from whatever inventory.json currently has. There is no long-term
// STR history in this table; an STR older than ~7 days simply won't be
// here anymore. That's a property of the source export, not a bug here.
//
// Also fetches a lightweight { code -> supplier } map from
// inventory_products (same read-only client) so the STR detail report
// can group line items by supplier — str_line_items itself has no
// supplier column (it's a transfer record, not a catalog row), so this
// is a join done client-side against whatever inventory_products
// currently has for that code. A code that's since dropped from
// inventory_products falls back to "Unassigned Supplier", same default
// inventory-bridge.js uses for products that shipped without one.
// ══════════════════════════════════════════════════════════════════════

// Same Supabase project as inventory-bridge.js.
const STR_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const STR_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';
const FULLDATA_CACHE_KEY = 'bt_str_fulldata_v1';
const FULLDATA_MIN_REFRESH_MS = 60 * 1000; // 1 min — same cadence as inventory-bridge.js

// Deliberately anonymous, non-persisting client — same reasoning as
// inventory-bridge.js's _getReadClient(): RLS on these tables only
// actually resolves rows for the anon role, a signed-in client gets a
// silent 200/zero-rows. Mirror that exact working setup rather than
// re-litigating it here.
let _readClient = null;
function _getReadClient() {
  if (_readClient) return _readClient;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _readClient = supabase.createClient(STR_SUPABASE_URL, STR_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _readClient;
}

export function isConnected() { return true; }

function _setLocal(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* best-effort */ } }
function _getLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

function _rowToHeader(row) {
  return {
    strId: row.str_id,
    strNumber: row.str_number || '',
    masterStrId: row.master_str_id || '',
    refNo: row.ref_no || '',
    media: row.media || '',
    strStatus: row.str_status || '',
    strDate: row.str_date || null,
    issuedBy: row.issued_by || '',
    dispatchedDate: row.dispatched_date || null,
    dispatchStatus: row.dispatch_status || '',
    dispatchedBy: row.dispatched_by || '',
    receiveDate: row.receive_date || null,
    receiveStatus: row.receive_status || '',
    receivedBy: row.received_by || '',
    comments: row.comments || '',
    dispatchShopId: row.dispatch_shop_id ?? null,
    dispatchBranch: row.dispatch_branch || '',
    receiveShopId: row.receive_shop_id ?? null,
    receiveBranch: row.receive_branch || '',
    direction: row.direction || '',
    driverName: row.driver_name || '',
    vehicleNumber: row.vehicle_number || '',
    consignmentNo: row.consignment_no || '',
    noOfBoxes: row.no_of_boxes || '',
    weightOfShipment: row.weight_of_shipment || '',
  };
}

function _rowToLineItem(row) {
  return {
    strId: row.str_id,
    strItemId: row.str_item_id,
    productCode: row.product_code || '',
    productName: row.product_name || '',
    cartonNo: row.carton_no || '',
    strQty: Number(row.str_qty) || 0,
    dispatchQty: row.dispatch_qty === null || row.dispatch_qty === undefined ? null : Number(row.dispatch_qty),
    receiveQty: row.receive_qty === null || row.receive_qty === undefined ? null : Number(row.receive_qty),
    netDispatchQty: row.net_dispatch_qty === null || row.net_dispatch_qty === undefined ? null : Number(row.net_dispatch_qty),
    productPrice: Number(row.product_price) || 0,
    costPrice: Number(row.cost_price) || 0,
  };
}

// PostgREST caps a single select() at ~1000 rows by default — paginate
// with .range(), same reasoning as inventory-bridge.js's
// _fetchAllProducts (175 headers/1,577 line items today, comfortably
// under one page each, but this keeps it correct as that grows).
async function _fetchAllRows(client, table, mapFn, orderCol) {
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }
  return all.map(mapFn);
}

async function _fetchSupplierMap(client) {
  // Only the two columns needed — this table can be 6,000+ rows, no
  // reason to pull every column just for a code->supplier lookup.
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from('inventory_products')
      .select('code, supplier')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  const map = {};
  all.forEach(r => { if (r.code) map[r.code] = r.supplier || 'Unassigned Supplier'; });
  return map;
}

let _fullData = null;
let _fullInFlight = null;
let _lastError = null;
export function getLastError() { return _lastError; }

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
      const client = _getReadClient();
      if (!client) { _lastError = 'Supabase client library not loaded yet'; return cached; }

      const [headers, lineItems, supplierByCode] = await Promise.all([
        _fetchAllRows(client, 'str_headers', _rowToHeader, 'str_date'),
        _fetchAllRows(client, 'str_line_items', _rowToLineItem, 'str_id'),
        _fetchSupplierMap(client).catch(() => ({})), // best-effort — grouping falls back to "Unassigned Supplier" if this fails
      ]);

      _lastError = null;
      const data = { headers, lineItems, supplierByCode, fetchedAt: Date.now() };
      _fullData = data;
      try { _setLocal(FULLDATA_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* best-effort — fine if too big, in-memory still works this session */ }
      if (typeof window.strNativeOnRefresh === 'function') window.strNativeOnRefresh();
      return data;
    } catch (e) {
      _lastError = (e && (e.message || e.error_description || e.details)) || String(e);
      return _fullData || cached;
    } finally {
      _fullInFlight = null;
    }
  })();
  return _fullInFlight;
}

// Bridged — same pattern as inventory-bridge.js.
window.strBridgeIsConnected = isConnected;
window.strBridgeGetFullData = getFullData;
window.strBridgeRefresh = refreshFullData;
window.strBridgeGetLastError = getLastError;
