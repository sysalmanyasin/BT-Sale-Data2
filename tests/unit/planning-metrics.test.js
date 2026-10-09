import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdayForecast, reorderDraft, reorderDraftText, strFillRate, categorySpikes, inTransitByCode, parseDailyDate } from '../../js/shared/planning-metrics.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const row = (y, m0, d, total) => ({ Date: String(d).padStart(2, '0') + '/' + MON[m0] + '/' + y, TOTAL: total });

test('parseDailyDate reads dd/Mon/yyyy and rejects junk', () => {
  assert.equal(parseDailyDate('09/Oct/2026').getTime(), new Date(2026, 9, 9).getTime());
  assert.equal(parseDailyDate('nope'), null);
});

test('weekdayForecast: Fridays sell double, so the projection uses each weekday, not a flat average', () => {
  // Sep 2026: Fridays 400k, every other day 200k. Oct 1-8 entered the same way.
  const daily = [];
  for (const [m0, days] of [[8, 30], [9, 8]]) for (let d = 1; d <= days; d++) daily.push(row(2026, m0, d, new Date(2026, m0, d).getDay() === 5 ? 400000 : 200000));
  const now = new Date(2026, 9, 9, 11, 0); // Fri 9 Oct, not entered yet
  const f = weekdayForecast({ daily, now, target: 7000000, weeks: 8 });
  assert.equal(f.month, 'October 2026');
  assert.equal(f.days_entered, 8);
  assert.equal(f.today.weekday, 'Friday');
  assert.equal(f.today.entered, false);
  assert.equal(f.today.expected, 400000);
  // remaining Oct 9..31 = 23 days: Fridays 9,16,23,30 = 4 × 400k, other 19 × 200k
  assert.equal(f.remaining_days, 23);
  assert.equal(f.projected_month_end, f.sold_so_far + 4 * 400000 + 19 * 200000);
  const flat = Math.round(f.sold_so_far / 8 * 31);
  assert.notEqual(f.projected_month_end, flat, 'must differ from the naive average × days');
  assert.ok(f.vs_target && typeof f.vs_target.on_track === 'boolean');
  assert.ok(f.projected_low <= f.projected_month_end && f.projected_month_end <= f.projected_high);
});

test('weekdayForecast: zero / missing totals are "not entered", never a zero-sale day; today entered is not projected', () => {
  const daily = [row(2026, 9, 1, 100000), row(2026, 9, 2, 0), row(2026, 9, 9, 150000)];
  const f = weekdayForecast({ daily, now: new Date(2026, 9, 9, 20, 0), weeks: 8 });
  assert.equal(f.days_entered, 2);
  assert.equal(f.today.entered, true);
  assert.equal(f.remaining.some(r => r.date === '2026-10-09'), false);
  // days before today with no entry are reported as missing data, not projected as future sales
  assert.equal(f.missing_past_days, 7);
  assert.equal(f.remaining.some(r => r.date === '2026-10-02'), false);
  assert.equal(f.remaining[0].date, '2026-10-10');
});

const P = (o) => ({ code: 'C' + o.name, supplier: 'ACME', price: 100, qty: 0, netQty30Days: 0, netQty60Days: 0, netQty90Days: 0, ...o });

test('reorderDraft: blends windows, subtracts in-transit, puts out-of-stock sellers first, groups by supplier', () => {
  const products = [
    P({ name: 'A', qty: 0, netQty30Days: 30, netQty60Days: 60, netQty90Days: 90 }),            // 1/day, out of stock
    P({ name: 'B', qty: 5, netQty30Days: 60, netQty60Days: 120, netQty90Days: 180, supplier: 'ZED' }), // 2/day, 2.5 days cover
    P({ name: 'C', qty: 500, netQty30Days: 30, netQty60Days: 60, netQty90Days: 90 }),          // plenty
    P({ name: 'D', qty: 0 }),                                                                   // never sells
    P({ name: 'E', qty: 0, netQty30Days: 30, netQty60Days: 60, netQty90Days: 90 }),             // fully covered by transit
  ];
  const d = reorderDraft({ products, inTransitByCode: { CE: 100 }, coverDays: 19 });
  const names = d.groups.flatMap(g => g.items.map(i => i.name));
  assert.deepEqual(names.sort(), ['A', 'B']);
  const a = d.groups.flatMap(g => g.items).find(i => i.name === 'A');
  assert.equal(a.suggested_qty, 19);
  assert.equal(a.status, 'out_of_stock');
  assert.equal(a.lost_sales_per_day, 100);
  const b = d.groups.flatMap(g => g.items).find(i => i.name === 'B');
  assert.equal(b.suggested_qty, 33); // 2*19 - 5
  assert.equal(b.status, 'low');
  assert.equal(d.out_of_stock_selling, 1);
  assert.equal(d.groups.length, 2);
  assert.ok(reorderDraftText(d).includes('A — buy 19 [OUT]'));
});

test('reorderDraft: a one-month spike does not dominate (50/30/20 blend)', () => {
  const spike = P({ name: 'S', qty: 0, netQty30Days: 300, netQty60Days: 300, netQty90Days: 300 }); // 10/day last 30d, nothing before
  const d = reorderDraft({ products: [spike], coverDays: 10 });
  const it = d.groups[0].items[0];
  assert.ok(it.daily_rate < 10 && it.daily_rate > 3, 'blended rate sits between the spike and the long-run average: ' + it.daily_rate);
});

const H = (o) => ({ direction: 'in', dispatchStatus: 'Dispatched', receiveStatus: 'Received', strDate: '2026-10-08', dispatchBranch: 'WAREHOUSE', ...o });
const L = (req, disp, rec, name = 'X') => ({ productCode: name, productName: name, packStrQty: req, packDispatchQty: disp, packReceiveQty: rec });

test('strFillRate: fill, zero-dispatch, short lines, receipt accuracy and worst source', () => {
  const headers = [H({ strId: 1 }), H({ strId: 2, dispatchBranch: 'WAREHOUSE-2' }), H({ strId: 3, dispatchStatus: 'Pending', receiveStatus: 'Pending' }), H({ strId: 4, direction: 'out' })];
  const rowsByStr = new Map([
    [1, [L(10, 10, 10, 'a'), L(10, 5, 4, 'b')]],
    [2, [L(10, 0, null, 'c'), L(10, 10, 10, 'd')]],
    [3, [L(99, 0, null, 'e')]],
    [4, [L(99, 0, null, 'f')]],
  ]);
  const r = strFillRate({ headers, rowsByStr, now: new Date(2026, 9, 9), days: 7 });
  assert.equal(r.strs_counted, 2);
  assert.equal(r.lines, 4);
  assert.equal(r.fill_rate_pct, 62.5); // 25 dispatched of 40 requested
  assert.equal(r.zero_dispatch_lines, 1);
  assert.equal(r.short_lines, 1);
  assert.equal(r.awaiting_dispatch.count, 1);
  assert.equal(r.by_source[0].source, 'WAREHOUSE-2'); // 50% beats WAREHOUSE's 75%
  assert.equal(r.worst_products[0].name, 'c');
  assert.equal(r.receipt_accuracy_pct, 96); // received 24 of dispatched 25 (rows with both values)
  assert.equal(r.received_short_lines, 1);
});

test('strFillRate: nothing to measure returns null rates, not 0%', () => {
  const r = strFillRate({ headers: [], rowsByStr: new Map(), now: new Date(2026, 9, 9) });
  assert.equal(r.fill_rate_pct, null);
  assert.equal(r.lines, 0);
});

test('categorySpikes: flags only meaningful, well-above-usual categories', () => {
  const s = categorySpikes({ Extra: 86923, Fuel: 5710, Soap: 4040, New: 20000 }, [{ Extra: 30000, Fuel: 5000, Soap: 3000 }, { Extra: 40000, Fuel: 6000, Soap: 4000 }]);
  assert.deepEqual(s.map(x => x.category), ['Extra', 'New']);
  assert.equal(s[0].usual_same_period, 35000);
  assert.equal(s[1].times_usual, null);
});

test('inTransitByCode counts only inbound, dispatched, not-received STR lines, in packs', () => {
  const data = {
    headers: [{ strId: 1, direction: 'in', dispatchStatus: 'Dispatched', receiveStatus: 'Pending' }, { strId: 2, direction: 'in', dispatchStatus: 'Dispatched', receiveStatus: 'Received' }, { strId: 3, direction: 'out', dispatchStatus: 'Dispatched', receiveStatus: 'Pending' }],
    lineItems: [{ strId: 1, productCode: 'P1', dispatchQty: 25 }, { strId: 2, productCode: 'P1', dispatchQty: 99 }, { strId: 3, productCode: 'P1', dispatchQty: 99 }],
    packFactorByCode: { P1: 10 },
  };
  assert.deepEqual(inTransitByCode(data), { P1: 2 });
});
