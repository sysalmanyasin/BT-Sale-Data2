import { render, renderThermal } from '../../lib/print.js';
import { renderInvoiceHtml } from '../templates/receipt-template.js';
export function printInvoice(invoice, format = 'a4') {
 const filename = (invoice.businessName || 'Invoice') + '-' + (invoice.invoiceNumber || 'draft');
 if (format === '58mm' || format === '80mm') {
  const widthMM = format === '58mm' ? 58 : 80;
  renderThermal(renderInvoiceHtml(invoice, { thermal:true, widthMM }), { widthMM, filename:filename+'-'+format });
  return;
 }
 render(renderInvoiceHtml(invoice), { filename });
}
