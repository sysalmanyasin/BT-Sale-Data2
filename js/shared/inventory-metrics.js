// ══════════════════════════════════════════════════════════════════════
// INVENTORY METRICS — pure functions, no DOM / window / fetch.
// ONE definition of "not sold in N days", shared by the daily briefing, the
// slow_moving_stock tool, the Stock-Ledger rule alert and the AI Center, so the
// same number is shown everywhere. (Before this, the briefing/tool counted by
// last-sale date and the Dashboard rule counted by 90-day net quantity, which
// produced 815 items / Rs 2.83M in one place and 838 / Rs 2.92M in another.)
//
// Accepts both row shapes the app uses:
//   inventory bridge : { qty, price, lastSaleDate, netQty90Days }
//   Stock Ledger raw : { stock, unitPrice, lastSaleDate, netQty90Days }
//
// A product is "not sold in N days" when it holds stock (qty > 0) AND
//   • its last sale date is older than N days, OR
//   • it has no last sale date AND shows no net sales in the 90-day window
//     (a missing date with sales in the window is NOT treated as slow).
// Value = qty × sale price.
// ══════════════════════════════════════════════════════════════════════
const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };

export const qtyOf = r => num(r && (r.qty != null ? r.qty : r.stock));
export const priceOf = r => num(r && (r.price != null ? r.price : r.unitPrice));

export function isNotSold(row, days = 90, now = Date.now()) {
  if (!row || qtyOf(row) <= 0) return false;
  const last = row.lastSaleDate ? new Date(row.lastSaleDate).getTime() : NaN;
  if (Number.isFinite(last)) return last < now - days * 86400000;
  return num(row.netQty90Days) <= 0;
}

/** @returns {{count:number, value:number, rows:Array}} rows are the matching input rows, largest stock value first. */
export function notSoldStock(rows, days = 90, now = Date.now()) {
  const hit = (Array.isArray(rows) ? rows : []).filter(r => isNotSold(r, days, now))
    .map(r => ({ row: r, value: qtyOf(r) * priceOf(r) })).sort((a, b) => b.value - a.value);
  return { count: hit.length, value: Math.round(hit.reduce((s, x) => s + x.value, 0)), rows: hit.map(x => x.row), valued: hit };
}
