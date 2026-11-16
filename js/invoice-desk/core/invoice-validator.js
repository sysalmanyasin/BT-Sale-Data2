import { calculateInvoice } from './invoice-engine.js';
export function validateInvoice(invoice) {
 const errors = [];
 if (!invoice || !String(invoice.businessName || '').trim()) errors.push('Business name is required.');
 if (!invoice || !String(invoice.date || '').trim()) errors.push('Invoice date is required.');
 if (!invoice || !Array.isArray(invoice.items) || invoice.items.length === 0) errors.push('Add at least one invoice item.');
 for (const [i, item] of (invoice?.items || []).entries()) {
  if (!String(item.description || '').trim()) errors.push('Item ' + (i + 1) + ': description is required.');
  if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) errors.push('Item ' + (i + 1) + ': quantity must be greater than zero.');
  if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) errors.push('Item ' + (i + 1) + ': price cannot be negative.');
 }
 const totals = calculateInvoice(invoice?.items || [], invoice?.discountAmount || 0);
 if (Number(invoice?.discountAmount || 0) < 0) errors.push('Discount cannot be negative.');
 if (Number(invoice?.discountAmount || 0) > totals.subtotal) errors.push('Discount cannot exceed the subtotal.');
 return { valid: errors.length === 0, errors, totals };
}
