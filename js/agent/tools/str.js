// STR (stock transfer) domain — READ tools over the synced STR headers/line items.
// Stage logic is reused from str-shared.js (pure) so "awaited/dispatched/received" can never drift
// from what the STR pages show.
import { registerTool } from '../core/tool-registry.js';
import { strStage, isDispatchedFromBT, groupedLineItems, diffQty } from '../../str-shared.js';
import { clampInt, rs } from './_util.js';

async function data() {
  let d = typeof window.strBridgeGetFullData === 'function' ? window.strBridgeGetFullData() : null;
  if (!d && typeof window.strBridgeRefresh === 'function') { try { d = await window.strBridgeRefresh(false); } catch (_) { /* fall through */ } }
  if (!d || !Array.isArray(d.headers)) throw new Error('STR data is not loaded yet. Open the STR page once, then ask again.');
  return d;
}
const DAY = 86400000;
const ageDays = (h, now) => { const t = Date.parse(h.strDate || ''); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null; };
const dirLabel = h => (isDispatchedFromBT(h) ? 'out (BT dispatches)' : 'in (BT receives)');
const slimHeader = (h, now) => ({
  str: h.strNumber, date: h.strDate, age_days: ageDays(h, now), stage: strStage(h), direction: dirLabel(h),
  from: h.dispatchBranch || null, to: h.receiveBranch || null, ref: h.refNo || null, comments: h.comments || null,
});

registerTool({
  name: 'str_overview', domain: 'str', risk: 'read',
  description: 'Headline STR (stock transfer) numbers: how many are awaited, dispatched and received, split by direction (in = Bahria Town receives, out = Bahria Town dispatches), plus the oldest still-open one.',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const d = await data(); const now = Date.now();
    const count = (stage, dir) => d.headers.filter(h => strStage(h) === stage && (!dir || h.direction === dir)).length;
    const open = d.headers.filter(h => strStage(h) !== 'received').map(h => ({ h, a: ageDays(h, now) })).filter(x => x.a !== null).sort((x, y) => y.a - x.a);
    return {
      total: d.headers.length,
      awaited: { all: count('awaited'), in: count('awaited', 'in'), out: count('awaited', 'out') },
      dispatched_not_received: { all: count('dispatched'), in: count('dispatched', 'in'), out: count('dispatched', 'out') },
      received: count('received'),
      oldest_open: open.length ? { str: open[0].h.strNumber, age_days: open[0].a, stage: strStage(open[0].h) } : null,
    };
  },
});

registerTool({
  name: 'list_pending_strs', domain: 'str', risk: 'read',
  description: 'STRs not yet received (awaited or dispatched), oldest first, with age in days. Use to chase pending transfers. Filter by stage, direction or minimum age.',
  parameters: { type: 'object', properties: {
    stage: { type: 'string', enum: ['awaited', 'dispatched', 'any'], description: 'default any (both unreceived stages)' },
    direction: { type: 'string', enum: ['in', 'out', 'any'], description: 'in = BT receives, out = BT dispatches; default any' },
    min_age_days: { type: 'integer', description: 'only STRs at least this old' },
    limit: { type: 'integer', description: 'max rows, default 15' },
  } },
  run: async ({ stage = 'any', direction = 'any', min_age_days = 0, limit }) => {
    const d = await data(); const now = Date.now(); const lim = clampInt(limit, 1, 40, 15); const minA = clampInt(min_age_days, 0, 3650, 0);
    const rows = d.headers
      .filter(h => strStage(h) !== 'received' && (stage === 'any' || strStage(h) === stage) && (direction === 'any' || h.direction === direction))
      .map(h => slimHeader(h, now)).filter(r => (r.age_days ?? 0) >= minA)
      .sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
    return { matching: rows.length, showing: Math.min(rows.length, lim), items: rows.slice(0, lim) };
  },
});

registerTool({
  name: 'get_str_detail', domain: 'str', risk: 'read',
  description: 'One STR by its number (or a reference number): header, line items grouped by supplier, and any dispatched-vs-received differences in packs.',
  parameters: { type: 'object', required: ['str_number'], properties: { str_number: { type: 'string', description: 'STR number or reference, e.g. "STR-1234"' } } },
  run: async ({ str_number }) => {
    const d = await data(); const q = String(str_number).trim().toLowerCase();
    const hits = d.headers.filter(h => String(h.strNumber).toLowerCase() === q || String(h.refNo).toLowerCase() === q);
    const h = hits[0] || d.headers.find(x => String(x.strNumber).toLowerCase().includes(q));
    if (!h) return { found: false, message: 'No STR matches "' + str_number + '".' };
    const groups = groupedLineItems(d, h.strId);
    const diffs = [];
    const suppliers = groups.map(g => ({
      supplier: g.supplier,
      items: g.rows.slice(0, 25).map(r => {
        const diff = diffQty(r); if (diff) diffs.push({ product: r.productName, packs_short: diff });
        return { code: r.productCode, name: r.productName, packs_requested: r.packStrQty, packs_dispatched: r.packDispatchQty, packs_received: r.packReceiveQty };
      }),
    }));
    return { found: true, ...slimHeader(h, Date.now()), line_count: groups.reduce((s, g) => s + g.rows.length, 0), value_at_cost: rs(groups.reduce((s, g) => s + g.rows.reduce((t, r) => t + (r.dispatchQty ?? r.strQty) * r.costPrice, 0), 0)), differences: diffs.slice(0, 20), suppliers };
  },
});
