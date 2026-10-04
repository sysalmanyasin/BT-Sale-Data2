// Agent read tools against seeded app data (real config.js / repository.js).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const cfg = await import('../../js/config.js');
const { Repository } = await import('../../js/repository.js');
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/app.js');
await import('../../js/agent/tools/sales.js');
await import('../../js/agent/tools/manager.js');
await import('../../js/agent/tools/inventory.js');
const util = await import('../../js/agent/tools/_util.js');

const run = async (name, args = {}) => JSON.parse((await reg.runTool(name, args)).text);

before(() => {
  const quiet = console.error; console.error = () => {};
  const d = (date, my, total, cash, comp) => ({ Date: date, Month_Year: my, TOTAL: String(total), 'Cash Sale': String(cash), HBL: '0', 'COMP SALE': String(comp), Customers: '10' });
  cfg.DAILY.push(
    d('01/Sep/2026', 'September 2026', 1000, 1000, 1000), d('02/Sep/2026', 'September 2026', 3000, 3000, 2900),
    d('01/Aug/2026', 'August 2026', 2000, 2000, 2000), d('02/Aug/2026', 'August 2026', 500, 500, 500), d('03/Aug/2026', 'August 2026', 9000, 9000, 9000),
  );
  cfg.MONTHLY.push(
    { Month_Year: 'August 2026', TOTAL: '11500', 'Cash Sale': '11500', 'COMP SALE': '11500', Customers: '30' },
    { Month_Year: 'September 2026', TOTAL: '4000', 'Cash Sale': '4000', 'COMP SALE': '3900', DIFF: '100', Customers: '20' },
  );
  Repository.setStaff([
    { id: 'e1', staffId: 'EMP-001', name: 'Ali Khan', designation: 'Salesman', active: true, srNum: 1, cnic: '12345-1234567-1', phone: '0300-1111111', address: 'secret street', fatherName: 'X' },
    { id: 'e2', staffId: 'EMP-002', name: 'Sara', designation: 'Cashier', active: false, srNum: null },
  ]);
  console.error = quiet;
  Repository.setItem('bt_targets', JSON.stringify({ 'September 2026': 10000 }));
});

describe('date helpers', () => {
  test('normMonth / normDay accept common forms', () => {
    assert.equal(util.normMonth('september 2026'), 'September 2026');
    assert.equal(util.normMonth('2026-09'), 'September 2026');
    assert.equal(util.normMonth('nonsense'), null);
    assert.equal(util.normDay('2026-09-05'), '05/Sep/2026');
    assert.equal(util.normDay('5 Sep 2026'), '05/Sep/2026');
    assert.equal(util.normDay('today', new Date(2026, 8, 3)), '03/Sep/2026');
  });
});

describe('sales tools', () => {
  test('summary defaults to latest month and includes target', async () => {
    const r = await run('get_sales_summary');
    assert.equal(r.month, 'September 2026');
    assert.equal(r.total_sale, 4000);
    assert.equal(r.diff, 100);
    assert.equal(r.days_entered, 2);
    assert.equal(r.avg_per_day, 2000);
    assert.equal(r.target, 10000);
  });
  test('daily sales by date and by month', async () => {
    assert.equal((await run('get_daily_sales', { date: '2026-09-02' })).total_sale, 3000);
    assert.equal((await run('get_daily_sales', { date: '09/Sep/2026' })).error, 'No entry for 09/Sep/2026');
    assert.equal((await run('get_daily_sales', { month_year: 'August 2026' })).count, 3);
  });
  test('top days orders correctly', async () => {
    const hi = await run('top_sales_days', { month_year: 'August 2026', count: 1 });
    assert.equal(hi.days[0].total_sale, 9000);
    const lo = await run('top_sales_days', { month_year: 'August 2026', order: 'lowest', count: 1 });
    assert.equal(lo.days[0].total_sale, 500);
  });
  test('compare months with same_days_only', async () => {
    const r = await run('compare_sales_months', { month_a: 'September 2026', month_b: 'August 2026', same_days_only: true });
    assert.equal(r['September 2026'].total_sale, 4000);
    assert.equal(r['August 2026'].total_sale, 2500); // Aug days 1–2 only
    assert.equal(r.difference_a_minus_b.total_sale.change, 1500);
    assert.equal(r.difference_a_minus_b.total_sale.pct, 60);
  });
  test('unknown month returns a clear error, not a crash', async () => {
    assert.match((await run('get_sales_summary', { month_year: 'Jan 1999' })).error, /No sales data/);
    assert.match((await run('get_sales_summary', { month_year: 'banana' })).error, /Could not understand/);
  });
  test('year overview', async () => {
    const r = await run('get_year_overview', { year: '2026' });
    assert.equal(r.year_total, 15500);
    assert.equal(r.best.month, 'August 2026');
  });
});

describe('regression: stored month labels are FULL names (not "Sep 2026")', () => {
  test('summary works for a non-May month typed in short form', async () => {
    const r = await run('get_sales_summary', { month_year: 'Sep 2026' });
    assert.equal(r.month, 'September 2026');
    assert.equal(r.total_sale, 4000);
  });
  test('latest month is September, not May', async () => {
    cfg.MONTHLY.push({ Month_Year: 'May 2026', TOTAL: '1', 'Cash Sale': '1', 'COMP SALE': '1', Customers: '1' });
    assert.equal((await run('get_sales_summary')).month, 'September 2026');
  });
  test('case-insensitive match for legacy labels like "JULY 2022"', async () => {
    cfg.MONTHLY.push({ Month_Year: 'JULY 2022', TOTAL: '777', 'Cash Sale': '777', 'COMP SALE': '777', Customers: '1' });
    cfg.DAILY.push({ Date: '01/Jul/2022', Month_Year: 'JULY 2022', TOTAL: '777', 'Cash Sale': '777', 'COMP SALE': '777', Customers: '1' });
    const r = await run('get_sales_summary', { month_year: 'July 2022' });
    assert.equal(r.total_sale, 777);
    assert.equal(r.days_entered, 1);
  });
  test('list_sales_months returns months across the year, sorted chronologically', async () => {
    const r = await run('list_sales_months', { year: '2026' });
    const names = r.months.map(m => m.month);
    assert.ok(names.indexOf('August 2026') < names.indexOf('September 2026'));
  });
});

describe('manager tools', () => {
  test('staff list never leaks CNIC / phone / address', async () => {
    const raw = (await reg.runTool('list_staff', { active: 'all' })).text;
    assert.ok(!/12345-1234567|0300-1111111|secret street/.test(raw), 'private identity fields must not appear');
    assert.equal(JSON.parse(raw).count, 2);
  });
  test('active filter and find_staff', async () => {
    assert.equal((await run('list_staff')).count, 1);
    assert.equal((await run('find_staff', { query: 'ali' })).matches[0].staff_id, 'EMP-001');
  });
  test('ledger tools are flagged sensitive; unknown ledger is handled', async () => {
    assert.equal(reg.getTool('get_ledger_entries').sensitive, true);
    assert.match((await run('get_ledger_entries', { ledger_type: 'nope' })).error, /Unknown ledger/);
  });
});

describe('inventory tools', () => {
  const products = [
    { name: 'Panadol 500mg', generic: 'Paracetamol', company: 'GSK', qty: 3, price: 50, supplier: 'S1', netQty30Days: 60, lastSaleDate: new Date().toISOString() },
    { name: 'Old Syrup', generic: 'Zzz', company: 'ABC', qty: 40, price: 100, supplier: 'S2', netQty30Days: 0, lastSaleDate: '2025-01-01' },
    { name: 'Zero Item', generic: 'Q', company: 'ABC', qty: 0, price: 10, supplier: 'S2', netQty30Days: 5, lastSaleDate: new Date().toISOString() },
  ];
  before(() => { window.inventoryBridgeGetFullData = () => ({ products, lastSync: { syncedAt: '2026-10-03T00:00:00Z' } }); });

  test('overview counts', async () => {
    const r = await run('inventory_overview');
    assert.equal(r.products, 3); assert.equal(r.zero_stock, 1); assert.equal(r.low_stock_1_to_5, 1);
    assert.equal(r.stock_value_at_sale_price, 3 * 50 + 40 * 100);
  });
  test('search by generic and cover days', async () => {
    const r = await run('search_inventory', { query: 'paracetamol' });
    assert.equal(r.products[0].name, 'Panadol 500mg');
    assert.equal(r.products[0].cover_days, 1.5); // 3 / (60/30)
  });
  test('low cover and slow movers', async () => {
    assert.equal((await run('low_cover_items', { max_days: 5 })).items[0].name, 'Zero Item');
    const s = await run('slow_moving_stock', { days: 90 });
    assert.equal(s.items[0].name, 'Old Syrup'); assert.equal(s.total_value, 4000);
  });
  test('missing inventory data gives a helpful error', async () => {
    const keep = window.inventoryBridgeGetFullData;
    window.inventoryBridgeGetFullData = () => null;
    const r = await reg.runTool('inventory_overview', {});
    assert.equal(r.ok, false); assert.match(r.text, /not loaded/);
    window.inventoryBridgeGetFullData = keep;
  });
});
