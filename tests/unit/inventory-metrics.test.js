import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isNotSold, notSoldStock, qtyOf, priceOf } from '../../js/shared/inventory-metrics.js';

const NOW = Date.parse('2026-10-09T09:00:00Z');
const daysAgo = d => new Date(NOW - d * 86400000).toISOString().slice(0, 10);

describe('not sold in N days — one definition', () => {
  test('stock + old last-sale date is not-sold; recent sale is not', () => {
    assert.equal(isNotSold({ qty: 5, lastSaleDate: daysAgo(120) }, 90, NOW), true);
    assert.equal(isNotSold({ qty: 5, lastSaleDate: daysAgo(10) }, 90, NOW), false);
  });
  test('no stock is never "not sold"', () => {
    assert.equal(isNotSold({ qty: 0, lastSaleDate: daysAgo(400) }, 90, NOW), false);
    assert.equal(isNotSold({ qty: -3, lastSaleDate: null, netQty90Days: 0 }, 90, NOW), false);
  });
  test('missing date: slow only when there are no net sales in the window', () => {
    assert.equal(isNotSold({ qty: 4, lastSaleDate: null, netQty90Days: 0 }, 90, NOW), true);
    assert.equal(isNotSold({ qty: 4, lastSaleDate: null }, 90, NOW), true);
    assert.equal(isNotSold({ qty: 4, lastSaleDate: null, netQty90Days: 12 }, 90, NOW), false);
  });
  test('both row shapes (bridge qty/price, Stock Ledger stock/unitPrice) give the same answer', () => {
    const a = [{ qty: 10, price: 100, lastSaleDate: daysAgo(200) }, { qty: 2, price: 50, lastSaleDate: daysAgo(5) }];
    const b = [{ stock: 10, unitPrice: 100, lastSaleDate: daysAgo(200) }, { stock: 2, unitPrice: 50, lastSaleDate: daysAgo(5) }];
    const ra = notSoldStock(a, 90, NOW), rb = notSoldStock(b, 90, NOW);
    assert.equal(ra.count, 1); assert.equal(ra.value, 1000);
    assert.deepEqual([rb.count, rb.value], [ra.count, ra.value]);
    assert.equal(qtyOf(b[0]), 10); assert.equal(priceOf(b[0]), 100);
  });
  test('rows come back largest stock value first; bad input is safe', () => {
    const r = notSoldStock([{ qty: 1, price: 10, lastSaleDate: daysAgo(300) }, { qty: 9, price: 10, lastSaleDate: daysAgo(300) }], 90, NOW);
    assert.equal(r.rows[0].qty, 9);
    assert.deepEqual([notSoldStock(null).count, notSoldStock(undefined).value], [0, 0]);
  });
});
