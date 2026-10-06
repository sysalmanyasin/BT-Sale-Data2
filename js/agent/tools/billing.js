// Emergency Billing domain — READ-ONLY tools over the synced emergency_invoices tables.
// There is deliberately no tool that creates, edits or refunds an invoice (refunds are hard-blocked in code and
// only ever happen on the Emergency Billing screen). Customer phone numbers are never returned.
import { registerTool } from '../core/tool-registry.js';
import { clampInt, num, rs } from './_util.js';

const pad = n => String(n).padStart(2, '0');
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

async function invoices(opts) {
  const f = window.emergencyBillingFetchInvoices;
  if (typeof f !== 'function') throw new Error('Emergency Billing is not loaded yet. Open the Emergency Billing page once, then ask again.');
  const rows = await f(opts);
  return Array.isArray(rows) ? rows : [];
}
const slim = r => ({
  invoice: r.invoice_number, billed_at: r.billed_at, staff: r.staff_name || null, net_total: rs(r.net_total),
  payment: r.payment_method || null, is_refund: !!r.is_refund, status: r.status || null, reconciled: !!r.reconciled_into_daily,
});

registerTool({
  name: 'billing_overview', domain: 'billing', risk: 'read',
  description: 'Emergency Billing summary for a day (default today) or the last N days: invoice count, total, split by payment method, refunds, and how many invoices are not yet reconciled into the daily sales entry.',
  parameters: { type: 'object', properties: {
    date: { type: 'string', description: 'last day to include, YYYY-MM-DD, default today' },
    days: { type: 'integer', description: 'how many days ending on that date, 1-31, default 1' },
  } },
  run: async ({ date, days }) => {
    const last = parseDay(date) || new Date(); const n = clampInt(days, 1, 31, 1);
    const first = new Date(last.getFullYear(), last.getMonth(), last.getDate() - (n - 1));
    const rows = await invoices({ from: startOf(first).toISOString(), to: endOf(last).toISOString() });
    const sales = rows.filter(r => !r.is_refund), refunds = rows.filter(r => r.is_refund);
    const byPay = {};
    for (const r of sales) { const k = r.payment_method || 'unknown'; byPay[k] = byPay[k] || { count: 0, total: 0 }; byPay[k].count++; byPay[k].total += num(r.net_total); }
    const open = sales.filter(r => !r.reconciled_into_daily);
    return {
      from: isoDay(first), to: isoDay(last), invoices: sales.length, total: rs(sales.reduce((s, r) => s + num(r.net_total), 0)),
      by_payment: Object.fromEntries(Object.entries(byPay).map(([k, v]) => [k, { count: v.count, total: rs(v.total) }])),
      refunds: { count: refunds.length, total: rs(refunds.reduce((s, r) => s + Math.abs(num(r.net_total)), 0)) },
      not_reconciled: { count: open.length, total: rs(open.reduce((s, r) => s + num(r.net_total), 0)) },
      note: 'Refunds are listed separately and are not part of total.',
    };
  },
});

registerTool({
  name: 'list_emergency_invoices', domain: 'billing', risk: 'read',
  description: 'List Emergency Billing invoices, newest first. Filter by date range, payment method, refunds only, or not-yet-reconciled only. No customer phone numbers are returned.',
  parameters: { type: 'object', properties: {
    from: { type: 'string', description: 'YYYY-MM-DD, default today' }, to: { type: 'string', description: 'YYYY-MM-DD, default same as from' },
    payment_method: { type: 'string' }, refunds_only: { type: 'boolean' }, unreconciled_only: { type: 'boolean' },
    limit: { type: 'integer', description: 'max rows, default 15' },
  } },
  run: async ({ from, to, payment_method, refunds_only, unreconciled_only, limit }) => {
    const a = parseDay(from) || new Date(); const b = parseDay(to) || a; const lim = clampInt(limit, 1, 40, 15);
    let rows = await invoices({ from: startOf(a).toISOString(), to: endOf(b).toISOString(), ...(payment_method ? { paymentMethod: String(payment_method) } : {}), ...(unreconciled_only ? { unreconciledOnly: true } : {}) });
    if (refunds_only) rows = rows.filter(r => r.is_refund);
    return { from: isoDay(a), to: isoDay(b), matching: rows.length, showing: Math.min(rows.length, lim), items: rows.slice(0, lim).map(slim) };
  },
});

registerTool({
  name: 'get_emergency_invoice', domain: 'billing', risk: 'read',
  description: 'One Emergency Billing invoice by its number, with its line items.',
  parameters: { type: 'object', required: ['invoice_number'], properties: { invoice_number: { type: 'string' } } },
  run: async ({ invoice_number }) => {
    const rows = await invoices({ invoiceNumber: String(invoice_number).trim() });
    if (!rows.length) return { found: false, message: 'No invoice "' + invoice_number + '".' };
    const items = await window.emergencyBillingFetchInvoiceItems(rows[0].invoice_number);
    return { found: true, ...slim(rows[0]), subtotal: rs(rows[0].subtotal), discount: rs(rows[0].discount_amount), original_invoice: rows[0].original_invoice_id || null,
      items: (Array.isArray(items) ? items : []).slice(0, 40).map(i => ({ code: i.product_code, name: i.product_name, qty: num(i.qty), unit_price: num(i.unit_price), total: rs(i.total) })) };
  },
});
