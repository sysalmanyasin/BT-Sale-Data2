// Audit Hub + payment-mix READ tools. Audit numbers come from the audit bridge's ai_audit_overview() aggregates
// (no auditor/customer names, no raw count rows); payments come from the existing sale-payments bridge.
// Nothing here writes, orders or changes an audit.
import { registerTool } from '../core/tool-registry.js';
import { num, rs } from './_util.js';

const DAY = 86400000;
const daysAgo = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / DAY)) : null; };

async function overview() {
  let o = typeof window.auditBridgeGetAiOverview === 'function' ? window.auditBridgeGetAiOverview() : null;
  const stale = !o || (Date.now() - (o.fetchedAt || 0)) > 2 * 60 * 1000;
  if (stale && typeof window.auditBridgeRefreshAiOverview === 'function') { try { o = (await window.auditBridgeRefreshAiOverview(false)) || o; } catch (_) { /* keep cached */ } }
  if (!o || !Array.isArray(o.engagements)) throw new Error('Audit data is not loaded yet. Open the Audit page once, then ask again.');
  return o;
}

registerTool({
  name: 'audit_overview', domain: 'inventory', risk: 'read',
  description: 'Stock-audit (Audit Hub) status: each open audit with counting progress (assigned vs submitted), latest round state, unresolved variance items, shortage and excess value in Rs and the 5 biggest variances; the last finished audit; pending variance-edit suggestions; barcode conflicts; auditor access expiring. Use for "how is the audit going", "audit variance", "shortage".',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const o = await overview();
    return {
      as_of: o.generated_at, data_age_min: Math.round((Date.now() - (o.fetchedAt || Date.now())) / 60000),
      open_audits: o.engagements.map(e => ({
        name: e.name, kind: e.scope_type, rounds: e.rounds_total, latest_round: e.latest_round,
        assigned: e.assigned, submitted: e.submitted, still_counting: e.counting,
        variance_items: e.variance_items, shortage_rs: rs(e.shortage_value), excess_rs: rs(e.excess_value),
        net_rs: rs(num(e.excess_value) - num(e.shortage_value)), biggest_variances: e.top_items || [],
      })),
      last_finished_audit: o.last_final ? { ...o.last_final, days_ago: daysAgo(o.last_final.generated_at) } : null,
      pending_variance_suggestions: o.suggestions ? { count: o.suggestions.pending, oldest_days: (o.suggestions.latest || []).length ? Math.max(...o.suggestions.latest.map(s => daysAgo(s.created_at) || 0)) : null, latest: o.suggestions.latest } : null,
      barcode_status: o.barcodes || {}, staff_access: o.staff || null,
    };
  },
});

registerTool({
  name: 'audit_expiry', domain: 'inventory', risk: 'read',
  description: 'Near-expiry stock logged in the Audit Hub: entries and units by status, by expiry month, the earliest expiry month and how many entries expire within 90 days. Use for "what is expiring", "near expiry".',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const o = await overview(); const x = o.expiry || {};
    return { as_of: o.generated_at, near_expiry_entries: x.near_entries || 0, near_expiry_units: x.near_qty || 0, earliest_month: x.earliest_month || null,
      expiring_within_90_days_entries: x.within_90_days_entries || 0, by_month: x.by_month || [], by_status: x.by_status || {} };
  },
});

registerTool({
  name: 'payment_breakdown', domain: 'sales', risk: 'read',
  description: 'Cash vs card vs credit split of sales by day (today and the last few days from the POS sync), with each share of the total and the customers who took credit. Use for "cash vs card", "payment mix", "credit sales", "who took credit".',
  parameters: { type: 'object', properties: { days: { type: 'integer', description: 'how many most-recent days, default 4' } } },
  run: async (args) => {
    let d = typeof window.salePaymentsBridgeGetFullData === 'function' ? window.salePaymentsBridgeGetFullData() : null;
    if (!d && typeof window.salePaymentsBridgeRefresh === 'function') { try { d = await window.salePaymentsBridgeRefresh(false); } catch (_) { /* fall through */ } }
    if (!d || !Array.isArray(d.paymentSummary)) throw new Error('Payment data is not loaded yet. Open the Payments page once, then ask again.');
    const n = Math.max(1, Math.min(14, parseInt(args && args.days, 10) || 4));
    const rows = [...d.paymentSummary].sort((a, b) => String(b.saleDay).localeCompare(String(a.saleDay))).slice(0, n);
    const pct = (a, t) => (t ? Math.round((a / t) * 1000) / 10 : null);
    const days = rows.map(r => ({ date: r.saleDay, cash: rs(r.cashSale), card: rs(r.cardSale), credit: rs(r.creditSale), total: rs(r.totalSale),
      cash_pct: pct(num(r.cashSale), num(r.totalSale)), card_pct: pct(num(r.cardSale), num(r.totalSale)), credit_pct: pct(num(r.creditSale), num(r.totalSale)),
      credit_customers: (d.creditByCustomer || []).filter(c => c.saleDay === r.saleDay).map(c => ({ customer: c.customerName, amount: rs(c.creditAmount), receipts: c.receiptCount })) }));
    const sum = k => rows.reduce((s, r) => s + num(r[k]), 0), tot = sum('totalSale');
    return { days, period_total: rs(tot), period_cash_pct: pct(sum('cashSale'), tot), period_card_pct: pct(sum('cardSale'), tot), period_credit_pct: pct(sum('creditSale'), tot) };
  },
});
