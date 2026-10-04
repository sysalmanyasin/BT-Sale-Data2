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
  ]);
  Repository.setItem('BT_ManagerWork_v1', JSON.stringify({ credit: { 'October 2026': [
    { name: 'Ali Khan', prevBal: 2000, entries: [{ date: '02-Oct-2026', desc: 'groceries', amount: 1500 }, { date: '03-Oct-2026', desc: 'repaid', amount: -500 }], salary: 1000, lessGeneric: 100 }] } }));
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
  console.error = quiet;
}
