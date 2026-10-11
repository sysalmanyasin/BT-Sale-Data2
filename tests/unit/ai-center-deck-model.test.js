// Command Deck view-model: every number comes from the snapshot; missing sources give nulls/omitted rows, never invented values.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../js/ai-center/deck-model.js';

const NOW = Date.parse('2026-10-12T10:00:00Z');
const snap = {
  raw: {
    briefing: { month: 'October 2026', last_sales_entry: { total_sale: 509669, date: '2026-10-11' }, yesterday: { vs_recent_avg_pct: -8 },
      inventory: { out_of_stock_but_selling: 423, running_out_within_7_days: 91 }, credit: { month_net_owed: 0, staff_owing: 0, possible_duplicates: 0 } },
    pace: { pct_done: 32, target: 1600000 }, day: { diff: -13823, date: '2026-10-11' },
    closing: { days: [{ closed: 1, missing: ['Evening'] }], incomplete_days: [{ date: 'x', missing: ['Evening'] }] },
    planning: { fill: { fill_rate_pct: 90.1 }, reorder: { total_lines: 24, est_value_at_sale_price: 1807498, lost_sales_per_day: 41958, cover_days_target: 7 },
      weekday: { weekday_baseline: [{ weekday: 'Monday', avg: 230000 }, { weekday: 'Tuesday', avg: 200000 }], today: { weekday: 'Tuesday' }, projected_month_end: 5200000 },
      money: { month: 'October 2026', ledgers: [{ ledger: 'Expense', month_to_date_total: 20281, running_above_usual: [{}] }, { ledger: 'JazzCash', month_to_date_total: 432705 }] } },
    deck: { inv: { totalSkus: 1200, inStock: 777, outOfStock: 423, stockValue: 9000000, avgCoverDays: 24, notSold90: { count: 50, value: 120000 } }, audit: { engagements: 1, assigned: 10, submitted: 4, pct: 40 } },
  },
  systems: { SALES: { status: 'HEALTHY' }, INVENTORY: { status: 'STALE' } },
};

describe('deck-model', () => {
  test('six tiles carry the real numbers', () => {
    const t = Object.fromEntries(D.overviewTiles(snap).map(x => [x.id, x]));
    assert.equal(t.sales.value, 'Rs 509,669'); assert.deepEqual([t.sales.delta.pct, t.sales.delta.up], [8, false]);
    assert.equal(t.target.value, '32%'); assert.equal(t.target.progress, 32);
    assert.equal(t.diff.value, '-Rs 13,823'); assert.equal(t.diff.tone, 'cr');
    assert.equal(t.risk.value, '423'); assert.equal(t.fill.value, '90.1%');
  });
  test('no snapshot or missing sources never produce invented numbers', () => {
    assert.deepEqual(D.overviewTiles(null), []);
    const t = D.overviewTiles({ raw: {} }); assert.equal(t.length, 6); assert.ok(t.every(x => x.value === '\u2014'));
    assert.deepEqual(D.attentionRows({ raw: {} }), []); assert.equal(D.salesChart({ raw: {} }), null); assert.equal(D.inventoryPanel({ raw: {} }), null);
  });
  test('needs-attention rows: stock-outs, run-out, sales at risk, reorder lines', () => {
    const rows = D.attentionRows(snap); assert.deepEqual(rows.map(r => r.id), ['oos', 'low', 'risk', 'reo']);
    assert.equal(rows[2].big, 'Rs 41,958'); assert.match(rows[3].sub, /1,807,498/);
  });
  test('sales chart: bars scale to a round top, today is flagged', () => {
    const c = D.salesChart(snap); assert.equal(c.bars.length, 2); assert.equal(c.top, 250000); assert.equal(c.ticks[1].label, '50K');
    assert.equal(c.bars[1].today, true); assert.equal(c.bars[0].pct, Math.round(230000 / 250000 * 100));
  });
  test('inventory panel merges planning, inventory-bridge and audit-bridge numbers', () => {
    const p = D.inventoryPanel(snap), all = [...p.left, ...p.right].map(x => x.label + '=' + x.value).join('|');
    assert.match(all, /Reorder Suggestions=24 \/ 1,200/); assert.match(all, /Coverage \(Avg\.\)=24 \/ 7 days/); assert.match(all, /Audit counting=4 \/ 10/); assert.match(all, /STR \(Fill Rate\)=90.1%/);
    assert.match(all, /Not sold in 90\+ days=50 items/);
  });
  test('money panel: closing, ledgers (JazzCash first), exceptions footer', () => {
    const m = D.moneyPanel(snap); assert.equal(m.left[0].value, '1 of 3 shifts closed'); assert.equal(m.right[0].label, 'JazzCash (MTD)');
    assert.match(m.foot, /1 running above usual/);
  });
  test('inventoryStats / auditStats from the bridge caches', () => {
    const s = D.inventoryStats([{ qty: 10, price: 5, netQty30Days: 30 }, { qty: 0, price: 9 }], NOW);
    assert.deepEqual([s.totalSkus, s.inStock, s.outOfStock, s.stockValue, s.avgCoverDays], [2, 1, 1, 50, 10]);
    assert.equal(D.inventoryStats([], NOW), null);
    assert.equal(D.auditStats({ items: [{ name: 'A', assigned: 4, submitted: 1, roundState: 'counting', roundNumber: 1 }] }).pct, 25); assert.equal(D.auditStats(null), null);
  });
  test('approvals + operations strip', () => {
    assert.equal(D.approvalRows([{ id: 'a', tool: 'update_credit_limit', risk: 'high' }])[0].title, 'update credit limit');
    const o = D.opsStrip(snap, [{ id: 'supabase', status: 'HEALTHY' }]); assert.equal(o.healthy, false); assert.match(o.summary, /1 need attention/);
    assert.equal(D.opsStrip({ systems: { SALES: { status: 'HEALTHY' } } }, []).summary, 'System Healthy');
  });
});
