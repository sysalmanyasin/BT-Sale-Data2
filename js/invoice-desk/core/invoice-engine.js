// Pure arithmetic; currency is rounded to two decimal places.
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export function calculateInvoice(items = [], discountAmount = 0) {
 const normalized = items.map((item) => {
  const quantity = Number(item.quantity), unitPrice = money(item.unitPrice);
  return { description: String(item.description || '').trim(), quantity, unitPrice, amount: money(quantity * unitPrice) };
 });
 const subtotal = money(normalized.reduce((sum, item) => sum + item.amount, 0));
 const discount = Math.min(Math.max(0, money(discountAmount)), subtotal);
 return { items: normalized, subtotal, discount, total: money(subtotal - discount) };
}
export function formatPKR(value, currencySymbol = 'Rs. ') {
 return currencySymbol + money(value).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
