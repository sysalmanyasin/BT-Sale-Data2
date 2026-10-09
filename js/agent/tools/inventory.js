// Inventory domain — READ tools over the synced product list (read-only
// bridge from the Pharmacy Audit Hub). Cover days etc. are computed here.
import { registerTool } from '../core/tool-registry.js';
import { BTSearch } from '../../bt-search.js';
import { num, rs, clampInt } from './_util.js';
import { notSoldStock, qtyOf, priceOf } from '../../shared/inventory-metrics.js';

async function products() {
  let d = typeof window.inventoryBridgeGetFullData === 'function' ? window.inventoryBridgeGetFullData() : null;
  if (!d && typeof window.inventoryBridgeRefresh === 'function') {
    try { d = await window.inventoryBridgeRefresh(false); } catch (_) { /* fall through */ }
  }
  if (!d || !Array.isArray(d.products) || !d.products.length) throw new Error('Inventory data is not loaded yet. Open the Inventory page once, then ask again.');
  return { list: d.products, syncedAt: (d.lastSync && d.lastSync.syncedAt) || null };
}
const slim = p => ({
  name: p.name, generic: p.generic || null, company: p.company || null, supplier: p.supplier || null,
  qty: num(p.qty), price: num(p.price), last_sale: p.lastSaleDate || null, sold_30d: num(p.netQty30Days),
});
const cover = p => { const per = num(p.netQty30Days) / 30; return per > 0 ? Math.round((num(p.qty) / per) * 10) / 10 : null; };

registerTool({
  name: 'inventory_overview', domain: 'inventory', risk: 'read',
  description: 'Headline inventory numbers: product count, zero-stock, negative-stock, low-stock (1–5), stock value at sale price, and when data was last synced.',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const { list, syncedAt } = await products();
    const q = p => num(p.qty);
    return {
      products: list.length, zero_stock: list.filter(p => q(p) === 0).length, negative_stock: list.filter(p => q(p) < 0).length,
      low_stock_1_to_5: list.filter(p => q(p) >= 1 && q(p) <= 5).length,
      stock_value_at_sale_price: rs(list.reduce((s, p) => s + Math.max(0, q(p)) * num(p.price), 0)),
      last_synced: syncedAt,
    };
  },
});

registerTool({
  name: 'search_inventory', domain: 'inventory', risk: 'read',
  description: 'Search products by name, generic (salt), company or code. Returns stock qty, price, supplier, 30-day sales and cover days.',
  parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'default 8, max 20' } } },
  run: async ({ query, limit }) => {
    const { list, syncedAt } = await products();
    const hits = BTSearch.filterAndRank(list, query, ['name', 'generic', 'company', 'code']).slice(0, clampInt(limit, 1, 20, 8));
    return { query, count: hits.length, last_synced: syncedAt, products: hits.map(p => ({ ...slim(p), cover_days: cover(p) })) };
  },
});

registerTool({
  name: 'low_stock_items', domain: 'inventory', risk: 'read',
  description: 'Products with stock at or below max_qty (default 5) that still have stock or recent sales, lowest first.',
  parameters: { type: 'object', properties: { max_qty: { type: 'integer' }, only_selling: { type: 'boolean', description: 'only products sold in the last 30 days' }, limit: { type: 'integer' } } },
  run: async ({ max_qty, only_selling, limit }) => {
    const { list } = await products();
    const cap = clampInt(max_qty, 0, 1000, 5);
    let rows = list.filter(p => num(p.qty) >= 0 && num(p.qty) <= cap);
    if (only_selling) rows = rows.filter(p => num(p.netQty30Days) > 0);
    rows.sort((a, b) => num(a.qty) - num(b.qty) || num(b.netQty30Days) - num(a.netQty30Days));
    return { threshold: cap, matching: rows.length, items: rows.slice(0, clampInt(limit, 1, 25, 12)).map(p => ({ ...slim(p), cover_days: cover(p) })) };
  },
});

registerTool({
  name: 'low_cover_items', domain: 'inventory', risk: 'read',
  description: 'Fast-moving products that will run out soonest: stock cover in days (stock ÷ average daily sales over 30 days), ascending. Use for "what should I reorder".',
  parameters: { type: 'object', properties: { max_days: { type: 'integer', description: 'default 15' }, limit: { type: 'integer' } } },
  run: async ({ max_days, limit }) => {
    const { list } = await products();
    const cap = clampInt(max_days, 1, 365, 15);
    const rows = list.map(p => ({ p, c: cover(p) })).filter(x => x.c !== null && x.c <= cap).sort((a, b) => a.c - b.c);
    return { max_cover_days: cap, matching: rows.length, items: rows.slice(0, clampInt(limit, 1, 25, 12)).map(x => ({ ...slim(x.p), cover_days: x.c })) };
  },
});

registerTool({
  name: 'slow_moving_stock', domain: 'inventory', risk: 'read',
  description: 'Products holding stock that have not sold for N days (default 90), ranked by stock value at sale price. Dead-stock candidates.',
  parameters: { type: 'object', properties: { days: { type: 'integer' }, limit: { type: 'integer' } } },
  run: async ({ days, limit }) => {
    const { list } = await products();
    const d = clampInt(days, 7, 1000, 90);
    const rows = notSoldStock(list, d).rows.map(p => ({ p, v: qtyOf(p) * priceOf(p) })); // already largest-value first
    return { not_sold_for_days: d, matching: rows.length, total_value: rs(rows.reduce((s, x) => s + x.v, 0)),
      items: rows.slice(0, clampInt(limit, 1, 25, 12)).map(x => ({ ...slim(x.p), stock_value: rs(x.v) })) };
  },
});
