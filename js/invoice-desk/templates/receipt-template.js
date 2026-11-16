import { escapeHtml } from '../../shared/html.js';
import { formatPKR } from '../core/invoice-engine.js';
const e = (value) => escapeHtml(String(value ?? ''));
const dateLabel = (value) => { if (!value) return ''; const d = new Date(value + 'T00:00:00'); return Number.isNaN(d.getTime()) ? e(value) : d.toLocaleDateString('en-PK'); };
export function renderInvoiceHtml(invoice, options = {}) {
 const width = options.widthMM ? 'width:' + Number(options.widthMM) + 'mm;' : 'max-width:210mm;';
 const compact = Boolean(options.thermal);
 const rows = invoice.items.map((item) => '<tr><td>' + e(item.description) + '</td><td class="num">' + e(item.quantity) + '</td><td class="num">' + formatPKR(item.unitPrice) + '</td><td class="num">' + formatPKR(item.amount) + '</td></tr>').join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(invoice.businessName)} Invoice</title><style>
 *{box-sizing:border-box}body{margin:0;padding:12px;background:#fff;color:#111;font:${compact?'11px':'13px'} Arial,sans-serif}.invoice{margin:0 auto;${width}}
 header{text-align:center;border-bottom:1px solid #111;padding:0 0 9px;margin-bottom:10px}h1{font-size:${compact?'17px':'23px'};margin:0 0 4px}p{margin:2px 0}
 .meta{display:flex;justify-content:space-between;gap:8px;margin:8px 0}table{width:100%;border-collapse:collapse;font-size:inherit}th,td{padding:5px 2px;border-bottom:1px solid #bbb;text-align:left;vertical-align:top}th{border-bottom:1px solid #111}.num{text-align:right;white-space:nowrap}
 .totals{margin:10px 0 0 auto;width:65%;max-width:260px}.total-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.grand{font-weight:700;border-top:1px solid #111;margin-top:4px;padding-top:6px}footer{text-align:center;border-top:1px dashed #555;margin-top:14px;padding-top:8px;font-size:.9em}@media print{body{padding:0}.invoice{width:100%}}
 </style></head><body><article class="invoice"><header><h1>${e(invoice.businessName)}</h1>${invoice.address?'<p>'+e(invoice.address)+'</p>':''}${invoice.phone?'<p>'+e(invoice.phone)+'</p>':''}</header>
 <div class="meta"><span>Invoice: ${e(invoice.invoiceNumber||'DRAFT')}</span><span>Date: ${dateLabel(invoice.date)}</span></div>${invoice.customerName?'<p><strong>Customer:</strong> '+e(invoice.customerName)+'</p>':''}${invoice.cashier?'<p><strong>Cashier:</strong> '+e(invoice.cashier)+'</p>':''}
 <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="totals"><div class="total-row"><span>Subtotal</span><strong>${formatPKR(invoice.subtotal)}</strong></div><div class="total-row"><span>Discount</span><strong>${formatPKR(invoice.discount)}</strong></div><div class="total-row grand"><span>Net payable</span><strong>${formatPKR(invoice.total)}</strong></div></div><footer>${e(invoice.footer||'Thank you.')}</footer></article></body></html>`;
}
