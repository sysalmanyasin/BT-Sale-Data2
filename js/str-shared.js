// ══════════════════════════════════════════════════════════════════════
// STR SHARED  —  pure helpers shared by str-native.js (the STR list +
// tap-a-row detail modal) and str-report-native.js (the flattened,
// all-STRs-at-once "Report" sub-tab, Aug 2026).
//
// Both read the exact same StrBridge.getFullData() shape; this is the
// one place that turns those raw rows into stage labels, pack
// quantities, supplier-grouped line items, and filtered header lists —
// so the two pages can never drift on what "Awaited" or "pack qty"
// means. Pure functions only — no DOM, no `window` — same discipline
// as js/shared/summary-calc.js.
// ══════════════════════════════════════════════════════════════════════

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function fmtDate(v, opts) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PK', opts || { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtQty(v) { return v === null || v === undefined ? '' : (Number(v) || 0).toLocaleString('en-PK'); }
export function fmtMoney(v) { return 'Rs ' + (Number(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ── Pack qty — STR Qty/Dispatch Qty/Receive Qty are synced in loose
// units; the source system's own conversion_factor ("units per pack",
// same column excess-working.js/stockledger.js already read off
// inventory_products) turns that into whole packs: floor(loose /
// factor). A code with no reliable factor (missing, zero, non-finite)
// falls back to 1 — i.e. its "pack qty" is just its loose qty, same
// safe fallback excess-working.js uses (packUnreliable → factor = 1).
export function packFactor(data, code) {
  const f = Number(data.packFactorByCode && data.packFactorByCode[code]);
  return (f && f > 0 && Number.isFinite(f)) ? f : 1;
}
export function toPackQty(v, factor) {
  if (v === null || v === undefined) return null;
  return Math.floor((Number(v) || 0) / factor);
}

// ── Derived 3-stage lifecycle — str_status itself is only Open/Close;
// the Awaited/Dispatched/Received stages both pages filter by come
// from dispatch_status + receive_status instead (see str-bridge.js's
// _rowToHeader — both are synced verbatim from the source system).
export function strStage(h) {
  if (h.receiveStatus === 'Received') return 'received';
  if (h.dispatchStatus === 'Dispatched') return 'dispatched';
  return 'awaited';
}
export const STAGE_LABEL = { awaited: 'Awaited', dispatched: 'Dispatched', received: 'Received' };
export const STAGE_BADGE_CLASS = { awaited: 'str-badge-amber', dispatched: 'str-badge-blue', received: 'str-badge-green' };

// direction is synced straight from the source ('in' | 'out') and,
// since every STR in this table touches Bahria Town on one side or the
// other, lines up exactly with the two sub-heading counts: 'out' means
// Bahria Town is the dispatch branch, 'in' means Bahria Town is the
// receive branch.
export function isDispatchedFromBT(h) { return h.direction === 'out'; }
export function isReceivedAtBT(h) { return h.direction === 'in'; }

export function lineItemsForStr(data, strId) {
  return data.lineItems.filter(li => li.strId === strId);
}

// Shared filter engine — `filters` is a plain {search, stageFilter,
// branchFilter, dateFrom, dateTo} bag; both pages keep their own state
// object shaped exactly like this and just pass it straight through,
// so a filter tweak here (or a new filter field added to either page)
// never has to be duplicated in two places.
export function filterHeaders(data, filters) {
  let list = data.headers;
  if (filters.branchFilter === 'dispatched') list = list.filter(isDispatchedFromBT);
  else if (filters.branchFilter === 'received') list = list.filter(isReceivedAtBT);
  if (filters.stageFilter && filters.stageFilter !== 'all') list = list.filter(h => strStage(h) === filters.stageFilter);
  if (filters.dateFrom) list = list.filter(h => h.strDate && h.strDate >= filters.dateFrom);
  if (filters.dateTo) list = list.filter(h => h.strDate && h.strDate <= filters.dateTo);
  const q = (filters.search || '').toLowerCase().trim();
  if (q) {
    list = list.filter(h =>
      (h.strNumber || '').toLowerCase().includes(q) ||
      (h.refNo || '').toLowerCase().includes(q) ||
      (h.comments || '').toLowerCase().includes(q) ||
      (h.issuedBy || '').toLowerCase().includes(q) ||
      (h.dispatchedBy || '').toLowerCase().includes(q) ||
      (h.receivedBy || '').toLowerCase().includes(q) ||
      (h.dispatchBranch || '').toLowerCase().includes(q) ||
      (h.receiveBranch || '').toLowerCase().includes(q));
  }
  return list.slice().sort((a, b) => (b.strDate || '').localeCompare(a.strDate || '') || b.strId - a.strId);
}

// Groups one STR's line items by supplier (joined via
// data.supplierByCode) and sorts each group by product code ascending
// — see str-native.js's header note on why, and why that join has to
// happen client-side. Each row comes back enriched with pack* fields
// (packStrQty/packDispatchQty/packReceiveQty) alongside the raw loose
// ones, so callers never have to re-derive pack qty themselves.
export function groupedLineItems(data, strId) {
  const items = lineItemsForStr(data, strId);
  const bySupplier = new Map();
  items.forEach(li => {
    const supplier = data.supplierByCode[li.productCode] || 'Unassigned Supplier';
    const factor = packFactor(data, li.productCode);
    const enriched = {
      ...li,
      packStrQty: toPackQty(li.strQty, factor),
      packDispatchQty: toPackQty(li.dispatchQty, factor),
      packReceiveQty: toPackQty(li.receiveQty, factor),
    };
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, []);
    bySupplier.get(supplier).push(enriched);
  });
  const groups = Array.from(bySupplier.entries()).map(([supplier, rows]) => ({
    supplier,
    rows: rows.slice().sort((a, b) => (a.productCode || '').localeCompare(b.productCode || '', undefined, { numeric: true })),
  }));
  groups.sort((a, b) => a.supplier.localeCompare(b.supplier));
  return groups;
}

export function diffQty(li) {
  if (li.packDispatchQty === null || li.packReceiveQty === null) return null;
  return li.packDispatchQty - li.packReceiveQty;
}
