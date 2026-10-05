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
  const window60  = 60;
  const list      = Array.isArray(items) ? items : [];

  let totalInventoryValue = 0, negativeValue = 0, neverSold60Value = 0, deadStock60Value = 0, rawExcessValue = 0;

  list.forEach(it => {
    const stock     = Number(it.stock) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const val       = stock * unitPrice;
    totalInventoryValue += val;
    if (stock < 0) negativeValue += val;
    if (stock === 0) return;

    const packValid = _isPackValid(it.conversionFactor);
    const recDays    = _daysSince(it.lastReceiveDate, asOf);
    const saleDays    = _daysSince(it.lastSaleDate, asOf);
    const hasSale    = !!it.lastSaleDate;

    if (packValid) {
      const pack = Number(it.conversionFactor);

      if (!hasSale && recDays != null && recDays > window60) {
        const dr = _downRound(stock, pack);
        if (dr.qty > 0) neverSold60Value += dr.qty * unitPrice;
      }

      if (hasSale && saleDays != null && saleDays > window60 && recDays != null && recDays > window60) {
        const dr = _downRound(stock, pack);
        if (dr.qty > 0) deadStock60Value += dr.qty * unitPrice;
      }
    }

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
