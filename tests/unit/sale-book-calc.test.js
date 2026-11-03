// Sale Book maths (js/shared/sale-book-calc.js): column definitions, reconciliation, calendar, formatting.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRows, summarize, parseDate, monthCalendar, monthsInScope, rowsInScope, fmtAmt, fmtShort, niceScale, weekdayAverages,
} from '../../js/shared/sale-book-calc.js';

const custom = [
  { id: 'custom_Bank_Alfalah_2', label: 'Bank Alfalah 2', section: 'Banks', calcType: 'add' },
  { id: 'custom_MEDIQ', label: 'MEDIQ', section: 'Credit Clients', calcType: 'add' },
];
// Real shape (15/Oct/2026): Cash + Returns + Banks + Credit = TOTAL = 528,721
const oct15 = { Date: '15/Oct/2026', TOTAL: '528721', 'COMP SALE': 492704, 'Cash Sale': 282124, 'Cash Returns': -22830,
  'Alfala Bank': 145193, custom_Bank_Alfalah_2: 75026, 'Askari Bank': 12532, LDA: 32631, PARCO: 4045, Customers: 567, FDPP: 415, 'FDPP Con': 152 };

describe('Sale Book columns', () => {
  test('banks and credit include custom fields and reconcile to TOTAL', () => {
    const [r] = buildRows([oct15], custom);
    assert.equal(r.cash, 282124);
    assert.equal(r.cashReturns, -22830);
    assert.equal(r.banks, 145193 + 75026);
    assert.equal(r.credit, 12532 + 32631 + 4045);
    assert.equal(r.total, 528721);
    assert.equal(r.drift, 0);
    assert.equal(r.diff, 36017);          // TOTAL - COMP SALE
    assert.equal(r.day, 'Thu');
  });
  test('a positive-stored return is still negative; credit returns are netted', () => {
    const [r] = buildRows([{ Date: '01/Oct/2026', TOTAL: '90', 'Cash Sale': 100, 'Cash Returns': 20, PSO: 30, 'PSO Returns': 20 }], []);
    assert.equal(r.cashReturns, -20);
    assert.equal(r.credit, 10);
    assert.equal(r.drift, 0);
  });
  test('a deleted custom field still in the data counts under Credit Clients (TOTAL includes it)', () => {
    const [r] = buildRows([{ Date: '02/Oct/2026', TOTAL: '150', 'Cash Sale': 100, custom_NICL: 50 }], custom);
    assert.equal(r.credit, 50);
    assert.equal(r.drift, 0);
  });
  test('custom "sub" fields reduce their group', () => {
    const [r] = buildRows([{ Date: '02/Oct/2026', TOTAL: '70', 'Cash Sale': 100, custom_X: 30 }],
      [{ id: 'custom_X', label: 'X', section: 'Banks', calcType: 'sub' }]);
    assert.equal(r.banks, -30);
  });
  test('missing COMP SALE gives no difference rather than a fake one', () => {
    const [r] = buildRows([{ Date: '02/Oct/2026', TOTAL: '100', 'Cash Sale': 100 }], []);
    assert.equal(r.diff, null);
  });
  test('rows are sorted, one per date, empty days dropped; ISO dates accepted', () => {
    const rows = buildRows([{ Date: '03/Oct/2026', TOTAL: '5', 'Cash Sale': 5 }, { Date: '2026-10-01', TOTAL: '7', 'Cash Sale': 7 },
      { Date: '02/Oct/2026', TOTAL: '0' }, { Date: '03/Oct/2026', TOTAL: '9', 'Cash Sale': 9 }], []);
    assert.deepEqual(rows.map((r) => r.total), [7, 9]);
  });
});

describe('Sale Book totals and calendar', () => {
  const rows = buildRows([
    { Date: '01/Sep/2026', TOTAL: '100', 'Cash Sale': 100, Customers: 10 },
    { Date: '03/Sep/2026', TOTAL: '300', 'Cash Sale': 300, Customers: 30 },
    { Date: '01/Oct/2026', TOTAL: '200', 'Cash Sale': 200, Customers: 20 },
    { Date: '03/Oct/2026', TOTAL: '400', 'Cash Sale': 400, Customers: 40 },
  ], []);
  test('summarize adds columns and finds best / lowest day', () => {
    const t = summarize(rows);
    assert.equal(t.total, 1000); assert.equal(t.days, 4); assert.equal(t.avgDay, 250);
    assert.equal(t.avgBill, 10); assert.equal(t.best.total, 400); assert.equal(t.low.total, 100);
  });
  test('a finished month lists every day; the last month stops at its last entry', () => {
    const last = rows[rows.length - 1].ts;
    const sep = monthCalendar(rows, 2026, 8, last);
    assert.equal(sep.length, 30);
    assert.equal(sep.filter((r) => r.missing).length, 28);
    assert.equal(monthCalendar(rows, 2026, 9, last).length, 3);
  });
  test('scopes', () => {
    assert.equal(rowsInScope(rows, { type: 'month', y: 2026, m: 9 }).length, 2);
    assert.equal(rowsInScope(rows, { type: 'all' }).length, 4);
    assert.deepEqual(monthsInScope(rows, { type: 'year', y: 2026 }), [{ y: 2026, m: 8 }, { y: 2026, m: 9 }]);
  });
  test('weekday averages (0 = Sunday)', () => {
    const w = weekdayAverages(rows); assert.equal(w.length, 7);
    assert.equal(w[4], 250); // Thu: 03/Sep (300) and 01/Oct (200)
  });
});

describe('Sale Book formatting', () => {
  test('lakh grouping, zero dash, brackets', () => {
    assert.equal(fmtAmt(528721), '5,28,721');
    assert.equal(fmtAmt(17172021), '1,71,72,021');
    assert.equal(fmtAmt(999), '999');
    assert.equal(fmtAmt(0), '-');
    assert.equal(fmtAmt(-22830, { brackets: true }), '(22,830)');
  });
  test('axis helpers', () => {
    assert.equal(fmtShort(450000), '4.5L'); assert.equal(fmtShort(80000), '80K'); assert.equal(fmtShort(15000000), '1.5Cr');
    const s = niceScale(690815); assert.ok(s.max >= 690815 && s.max / s.step <= 6);
  });
  test('parseDate rejects junk', () => {
    assert.equal(parseDate('31/Foo/2026'), null); assert.equal(parseDate(''), null);
    assert.equal(parseDate('15/oct/2026').d, 15);
  });
});
