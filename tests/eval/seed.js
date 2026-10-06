// Known dataset for the evaluation suite. Every golden answer in cases.js is
// derived from these numbers, so a changed tool result is a visible regression.
export async function seedEvalData({ cfg, Repository, LedgerStore, LedgerActions, notes }) {
  const quiet = console.error; console.error = () => {};
  const day = (Date, Month_Year, total, comp = total, extra = {}) => ({ Date, Month_Year, TOTAL: String(total), 'Cash Sale': String(total), 'COMP SALE': String(comp), Customers: '10', DIFF: total === comp ? null : String(total - comp), ...extra });
  cfg.DAILY.splice(0, cfg.DAILY.length, 
    day('11/Jan/2022', 'January 2022', 932685), day('09/Feb/2022', 'February 2022', 927901), day('03/Mar/2022', 'March 2022', 901000),
    day('01/Aug/2026', 'August 2026', 2000), day('02/Aug/2026', 'August 2026', 500), day('03/Aug/2026', 'August 2026', 9000),
    day('01/Sep/2026', 'September 2026', 1000), day('02/Sep/2026', 'September 2026', 3000, 2900),
    day('01/Oct/2026', 'October 2026', 4000), day('02/Oct/2026', 'October 2026', 6000));
  const m = (Month_Year, total, comp = total, diff = null, customers = '30') => ({ Month_Year, TOTAL: String(total), 'Cash Sale': String(total), 'COMP SALE': String(comp), DIFF: diff, Customers: customers });
  cfg.MONTHLY.splice(0, cfg.MONTHLY.length, m('January 2022', 932685), m('February 2022', 927901), m('March 2022', 901000),
    m('August 2026', 11500), m('September 2026', 4000, 3900, '100', '20'), m('October 2026', 10000));
  Repository.setItem('bt_targets', JSON.stringify({ 'September 2026': 10000, 'October 2026': 20000 }));
  Repository.setStaff([
    { id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true, cnic: '12345-1234567-1', phone: '0300-0000000' },
    { id: 'e2', staffId: 'EMP-002', name: 'Sara', designation: 'Cashier', active: true },
    { id: 'e3', staffId: 'EMP-003', name: 'Bilal', designation: 'Helper', active: false },
    { id: 'e4', staffId: 'EMP-004', name: 'Mian Muhammad Usman', designation: 'Senior Salesman', active: true },
  ]);
  Repository.setItem('BT_ManagerWork_v1', JSON.stringify({ credit: { 'October 2026': [
    { name: 'Ali Khan', prevBal: 2000, entries: [{ date: '02-Oct-2026', desc: 'groceries', amount: 1500 }, { date: '03-Oct-2026', desc: 'repaid', amount: -500 }], salary: 1000, lessGeneric: 100 }],
    'September 2026': [{ name: 'Mian Muhammad Usman', prevBal: 0, entries: [{ date: '05-Sep-2026', desc: 'medicine', amount: 1000 }, { date: '09-Sep-2026', desc: 'lunch', amount: 500 }], salary: 0, lessGeneric: 0 },
      { name: '\tMian Waqas', prevBal: 0, entries: [{ date: '07-Sep-2026', desc: 'x', amount: 300 }], salary: 0, lessGeneric: 0 }] } }));
  Repository.setItem('bt_staff_notes_v1', '[]');
  notes.addNote('e1', 'first note'); notes.addNote('e1', 'second note');
  LedgerStore.getEntries('jazzcash').slice().forEach(e => LedgerActions.removeEntry(e.id));
  LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 300, desc: 'a' });
  LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 700, desc: 'b' });
  globalThis.window.inventoryBridgeGetFullData = () => ({ lastSync: { syncedAt: '2026-10-08T00:00:00Z' }, products: [
    { name: 'Panadol', generic: 'Paracetamol', qty: 3, price: 50, netQty30Days: 60, lastSaleDate: '2026-10-07' },
    { name: 'Gone Item', qty: 0, price: 10, netQty30Days: 12, lastSaleDate: '2026-10-05' },
    { name: 'Old Syrup', qty: 40, price: 100, netQty30Days: 0, lastSaleDate: '2025-01-01' },
    { name: 'Steady', qty: 500, price: 5, netQty30Days: 30, lastSaleDate: '2026-10-07' },
    { name: 'Brufen', qty: 10, price: 80, netQty30Days: 15, lastSaleDate: '2026-10-01' },
  ] });
  // STR bridge: headers are dated relative to "now" so ages are stable whenever the suite runs.
  const ago = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const hdr = (strId, strNumber, daysAgo, dispatch, receive, direction, extra = {}) => ({ strId, strNumber, strDate: ago(daysAgo), dispatchStatus: dispatch, receiveStatus: receive, direction, dispatchBranch: direction === 'out' ? 'Bahria Town' : 'Main', receiveBranch: direction === 'out' ? 'Main' : 'Bahria Town', refNo: '', comments: '', ...extra });
  globalThis.window.strBridgeGetFullData = () => ({ fetchedAt: Date.now(),
    headers: [hdr(1, 'STR-1', 20, '', '', 'in'), hdr(2, 'STR-2', 8, 'Dispatched', '', 'in'), hdr(3, 'STR-3', 3, '', '', 'out'), hdr(4, 'STR-4', 30, 'Dispatched', 'Received', 'out', { refNo: 'REF-4' })],
    lineItems: [{ strId: 4, productCode: 'P1', productName: 'Panadol', strQty: 20, dispatchQty: 20, receiveQty: 10, productPrice: 60, costPrice: 40 }],
    supplierByCode: { P1: 'GSK' }, packFactorByCode: { P1: 10 } });
  // Closing bridge: today's Night shift closed, Morning draft, Evening pending; yesterday fully closed.
  const dISO = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  globalThis.window.closingBridgeGetFullDb = () => ({ sheets: {
    [dISO(0) + '_Night']: { outNetSale: 5000 }, [dISO(0) + '_Morning']: { draft: true },
    [dISO(1) + '_Night']: { outNetSale: 4000 }, [dISO(1) + '_Morning']: { outNetSale: 6000 }, [dISO(1) + '_Evening']: { profileMode: 'final', finalNetSale: 7000 } } });
  // Emergency Billing (read-only bridge). Refunds are already reconciled so "unreconciled" is exactly EB-1.
  const nowIso = new Date().toISOString();
  const INVOICES = [
    { invoice_number: 'EB-1', billed_at: nowIso, staff_name: 'Ali', net_total: 1000, subtotal: 1000, discount_amount: 0, payment_method: 'cash', is_refund: false, status: 'completed', reconciled_into_daily: false },
    { invoice_number: 'EB-2', billed_at: nowIso, staff_name: 'Sara', net_total: 2500, subtotal: 2600, discount_amount: 100, payment_method: 'card', is_refund: false, status: 'completed', reconciled_into_daily: true },
    { invoice_number: 'EB-3', billed_at: nowIso, staff_name: 'Ali', net_total: -500, payment_method: 'cash', is_refund: true, status: 'completed', reconciled_into_daily: true, original_invoice_id: 'EB-1', customer_phone: '0300-1234567' },
  ];
  globalThis.window.emergencyBillingFetchInvoices = async o => INVOICES.filter(r => (!o.invoiceNumber || r.invoice_number === o.invoiceNumber) && (!o.unreconciledOnly || !r.reconciled_into_daily) && (!o.paymentMethod || r.payment_method === o.paymentMethod));
  globalThis.window.emergencyBillingFetchInvoiceItems = async n => (n === 'EB-2' ? [{ product_code: 'P1', product_name: 'Panadol', qty: 2, unit_price: 1300, total: 2600 }] : []);
  // Notes + sheets (a tiny fake of the two Supabase tables the documents tools read).
  Repository.setItem('bt_notes_v1', JSON.stringify([
    { id: 'n1', title: 'Delivery rider', body: 'Rider Bilal collects the evening orders at 6pm. Pay him weekly.', tags: ['delivery'], createdAt: '2026-09-01' },
    { id: 'n2', title: 'Cash drawer', body: 'Count the drawer twice before closing.', tags: [] } ]));
  const TABLES = {
    bt_sheets: [{ spreadsheet_id: 's1', title: 'Budget', updated_at: '2026-10-01', pinned: false }],
    bt_sheets_cache: [{ tab_name: 'Jan', tab_index: 0, snapshot_at: '2026-10-01', values_json: [['Item', 'Qty'], ['A', 1]] }],
  };
  globalThis.window.btGetSupabaseClient = () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }) },
    from: tbl => { const q = { select: () => q, eq: () => q, ilike: () => q, order: () => q, limit: () => q, then: (res, rej) => Promise.resolve({ data: TABLES[tbl] || [], error: null }).then(res, rej) }; return q; },
  });
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ mode: 'semantic', results: [{ source: 'note', source_id: 'n1', title: 'Delivery rider', snippet: 'Rider Bilal collects the evening orders at 6pm.', similarity: 0.82 }] }) });
  console.error = quiet;
}
