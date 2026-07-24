// ══════════════════════════════════════════════════════════════════════
// SUMMARY CALC — Phase 4.1 (AI + CommandHub Build Plan v2)
//
// Pure functions only. No DOM, no `window`, no `localStorage`, no fetch.
// This is what lets the same file run unmodified in the browser
// (cover-dashboard.js's Phase 3.1 doughnut) and in a Deno Edge Function
// (Phase 4.2's send-daily-whatsapp-briefing) — one copy of the "closing
// total" and "inventory-health" math instead of two that can drift.
//
// Both call sites pass in already-fetched plain data (numbers / arrays)
// and get plain data back. Neither side needs to know the other exists.
// ══════════════════════════════════════════════════════════════════════

/**
 * computeInventoryHealth({ totalInventoryValue, neverSold60Value,
 * deadStock60Value, correctedExcessValue })
 *
 * Never Sold / Dead Stock / Excess / Healthy, as a value + % share of
 * total inventory value, right now. Single snapshot — no history.
 *
 * Same bucket math as Phase 3.1's Cover Dashboard doughnut
 * (cover-dashboard.js's old _renderInventoryChart, now just a Chart.js
 * wrapper around this). "Excess" is expected to be the *corrected*
 * figure (after retain-list + misc buffer) to match the "Corrected
 * Excess Stock" hero card, not the raw excess-working number.
 */
export function computeInventoryHealth(input) {
  input = input || {};
  const total   = Number(input.totalInventoryValue) || 0;
  const never   = Math.max(0, Number(input.neverSold60Value) || 0);
  const dead    = Math.max(0, Number(input.deadStock60Value) || 0);
  const excess  = Math.max(0, Number(input.correctedExcessValue) || 0);
  const healthy = Math.max(0, total - never - dead - excess);

  const pct = v => (total ? Math.round((v / total) * 1000) / 10 : 0);

  return {
    total, never, dead, excess, healthy,
    pctNever: pct(never), pctDead: pct(dead), pctExcess: pct(excess), pctHealthy: pct(healthy),
  };
}

/**
 * computeClosingTotal(shifts)
 *
 * `shifts` is the same `[{ shift, status, netSale? }]` array
 * ClosingBridge's `_summarize()` already produces per day (status is
 * one of 'pending' | 'draft' | 'closed'). Sums netSale across CLOSED
 * shifts only — draft/pending shifts have no reliable netSale yet, so
 * they're reported as still-open rather than counted as zero.
 */
export function computeClosingTotal(shifts) {
  const list    = Array.isArray(shifts) ? shifts : [];
  const closed  = list.filter(s => s && s.status === 'closed');
  const pending = list.filter(s => s && s.status !== 'closed');
  const total   = closed.reduce((sum, s) => sum + (Number(s.netSale) || 0), 0);

  return {
    total,
    closedCount: closed.length,
    pendingShifts: pending.map(s => s.shift),
    allClosed: list.length > 0 && pending.length === 0,
  };
}

// ── SKU-level bucketing (Phase 4.2) ─────────────────────────────────
// Mirrors stockledger.js's computeAll()/getCoverStats() predicates
// exactly (never-sold/dead-stock window = 60 days, excess window = 90
// days via netQty90Days, pack down-rounding). Takes ALREADY-NORMALIZED
// rows — same camelCase shape stockledger.js's normalizeSupabaseRow()
// produces from `inventory_products`: { stock, unitPrice,
// conversionFactor, lastReceiveDate, lastSaleDate, netQty90Days }.
//
// IMPORTANT — "excess" here is the RAW 100-day-excess figure, not the
// "corrected" one Cover Dashboard's doughnut shows. The correction
// (retain-list + misc buffer) lives in excess-working.js's state,
// which is stored via Repository.getItem/setItem — a thin
// localStorage wrapper, per-device, never synced anywhere a server
// can read it. There is no server-reachable "corrected excess" value
// today. Callers (the WhatsApp briefing) should label this figure
// "excess (uncorrected)" rather than implying it matches the
// dashboard number.
function _isPackValid(raw) {
  const n = Number(raw);
  return raw !== '' && raw != null && Number.isFinite(n) && n > 0;
}
function _downRound(stock, pack) {
  const p = (pack && pack > 0) ? pack : 1;
  const packs = Math.floor(stock / p);
  return { packs, qty: packs * p, loose: stock - (packs * p) };
}
function _daysSince(dateStr, asOf) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((asOf - d) / 86400000);
}

// Mirrors stockledger.js's own normalizeSupabaseRow() exactly — same
// `inventory_products` table, snake_case → camelCase. Kept here too
// (not imported from stockledger.js, which is a classic browser script
// full of DOM reads) so the Edge Function has its own dependency-free
// copy of the one mapping that matters for this calc.
export function normalizeInventoryRow(r) {
  return {
    code: r.code || '',
    name: r.name || '',
    stock: Number(r.qty) || 0,
    unitPrice: Number(r.price) || 0,
    conversionFactor: r.conversion_factor,
    lastReceiveDate: r.last_receive_date || null,
    lastSaleDate: r.last_sale_date || null,
    netQty90Days: Number(r.net_qty_90_days) || 0,
  };
}

export function computeInventoryBuckets(items, opts) {
  opts = opts || {};
  const asOf      = opts.asOf instanceof Date ? opts.asOf : new Date();
  const window60  = 60; // never-sold / dead-stock window — fixed, matches getCoverStats()
  const list      = Array.isArray(items) ? items : [];

  let totalInventoryValue = 0, negativeValue = 0, neverSold60Value = 0, deadStock60Value = 0, rawExcessValue = 0;

  list.forEach(it => {
    const stock     = Number(it.stock) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const val       = stock * unitPrice;
    totalInventoryValue += val;
    if (stock < 0) negativeValue += val;
    if (stock === 0) return; // zero stock — nothing to bucket, same as computeAll()

    const packValid = _isPackValid(it.conversionFactor);
    const recDays    = _daysSince(it.lastReceiveDate, asOf);
    const saleDays    = _daysSince(it.lastSaleDate, asOf);
    const hasSale    = !!it.lastSaleDate;

    if (packValid) {
      const pack = Number(it.conversionFactor);

      // Never sold: no sale record at all, received > window ago.
      if (!hasSale && recDays != null && recDays > window60) {
        const dr = _downRound(stock, pack);
        if (dr.qty > 0) neverSold60Value += dr.qty * unitPrice;
      }

      // Dead stock: HAS a sale history, but not within the window, AND
      // received more than that same window ago. hasSale keeps this
      // mutually exclusive with Never Sold.
      if (hasSale && saleDays != null && saleDays > window60 && recDays != null && recDays > window60) {
        const dr = _downRound(stock, pack);
        if (dr.qty > 0) deadStock60Value += dr.qty * unitPrice;
      }
    }

    // 100-day excess: netQty90Days is a trailing 90-day net-sold
    // quantity, scaled to a 100-day target. No pack rounding. Only
    // items with stock >= 4 are eligible — same as computeAll().
    const net90 = Number(it.netQty90Days) || 0;
    const dailyRate = net90 / 90;
    const target100 = dailyRate * 100;
    const excessQty = stock - target100;
    if (net90 > 0 && excessQty > 0 && stock >= 4) {
      rawExcessValue += excessQty * unitPrice;
    }
  });

  return { dataReady: list.length > 0, totalInventoryValue, negativeValue, neverSold60Value, deadStock60Value, rawExcessValue };
}

/**
 * inventoryHealthLine(health) — one plain-language sentence fragment,
 * e.g. "78% healthy, Rs. 42,300 dead stock". Used by both the AI
 * narration prompt (Phase 1's ai-memory.js style) and, in Phase 4, the
 * WhatsApp briefing's non-AI fallback line if the AI call fails.
 * NOTE: does not format currency (no `Intl`/locale assumption baked in
 * here) — callers pass already-formatted numbers or format the raw
 * `.dead`/`.excess` values themselves (browser has bt-format.js's `fc`;
 * the Edge Function should format independently, per its own header).
 */
export function inventoryHealthLine(health) {
  if (!health || !health.total) return 'no inventory data yet';
  return health.pctHealthy + '% healthy, ' + health.pctDead + '% dead stock, ' + health.pctNever + '% never sold';
}
