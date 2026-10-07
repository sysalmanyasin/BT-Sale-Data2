// "What needs my attention today?" — deterministic briefing checks.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
const { loadClassicScript } = await import('../helpers/load-classic-script.js');
const { Repository } = await import('../../js/repository.js');
const { buildBriefing } = await import('../../js/agent/tools/briefing.js');
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/sales.js');
// The briefing's target pace is delegated to Analytics (one implementation), so load the real one.
loadClassicScript('js/analytics.js', window);

const day = (d, total, comp = total) => ({ Date: String(d).padStart(2, '0') + '/Oct/2026', Month_Year: 'October 2026', TOTAL: String(total), 'COMP SALE': String(comp), Customers: '10' });
const NOW = new Date(2026, 9, 8, 9, 0); // 08 Oct 2026

before(() => {
  const q = console.error; console.error = () => {};
  for (let d = 20; d <= 30; d++) cfg.DAILY.push({ Date: d + '/Sep/2026', Month_Year: 'September 2026', TOTAL: '100000', 'COMP SALE': '100000', Customers: '10' });
  [1, 2, 3, 4, 6].forEach(d => cfg.DAILY.push(day(d, 100000)));   // the 5th has no entry
  cfg.DAILY.push(day(7, 40000));                                  // yesterday: present but weak
  cfg.MONTHLY.push({ Month_Year: 'October 2026', TOTAL: String(100000 * 5 + 40000), 'COMP SALE': '640000', Customers: '60' });
  Repository.setItem('bt_targets', JSON.stringify({ 'October 2026': 4000000 }));
  window.inventoryBridgeGetFullData = () => ({ lastSync: { syncedAt: '2026-10-08T00:00:00Z' }, products: [
    { name: 'Panadol', qty: 3, price: 50, netQty30Days: 60, lastSaleDate: '2026-10-07' },
    { name: 'Gone Item', qty: 0, price: 10, netQty30Days: 12, lastSaleDate: '2026-10-05' },
    { name: 'Old Syrup', qty: 40, price: 100, netQty30Days: 0, lastSaleDate: '2025-01-01' },
    { name: 'Steady', qty: 500, price: 5, netQty30Days: 30, lastSaleDate: '2026-10-07' },
  ] });
  console.error = q;
});

describe('daily briefing', () => {
  const b = buildBriefing(NOW);
  const has = (area, re) => b.attention.some(a => a.area === area && re.test(a.message));

  test('header facts', () => { assert.equal(b.date, '08/Oct/2026'); assert.equal(b.month, 'October 2026'); });
  test('lists missing sales days this month', () => {
    assert.equal(b.missing_sales_days, 1); // only the 5th
    assert.ok(has('sales', /05\/Oct\/2026/));
  });
  test('yesterday is compared with the recent average', () => {
    assert.equal(b.yesterday.total_sale, 40000);
    assert.ok(b.yesterday.vs_recent_avg_pct <= -30);
    assert.ok(has('sales', /below the recent daily average/));
  });
  test('early in the month the pace is information, not an alarm (same as the ntfy rule: from day 10)', () => {
    assert.equal(b.target.target, 4000000);
    assert.ok(b.target.projected_month_end < 3600000);
    assert.ok(b.attention.some(a => a.area === 'target' && a.level === 'info' && /Too early to project/.test(a.message)));
    assert.ok(!b.attention.some(a => a.area === 'target' && a.level === 'warn'));
    assert.ok(b.target.needed_per_day > 0);
  });
  test('target pace has ONE implementation: briefing numbers equal Analytics and the get_target_pace tool', async () => {
    const A = window.Analytics.getTargetPaceForMonth('October 2026', JSON.parse(Repository.getItem('bt_targets')));
    assert.equal(b.target.sold_so_far, Math.round(A.soFar));
    assert.equal(b.target.days_left, A.daysLeft);
    assert.equal(b.target.needed_per_day, Math.round(A.neededPerDay));
    assert.equal(b.target.projected_month_end, Math.round(A.actualPerDay * A.daysInMonth));
    const t = JSON.parse((await reg.runTool('get_target_pace', {})).text);
    assert.equal(b.target.days_left, t.days_left);
    assert.equal(b.target.needed_per_day, t.needed_per_day);
    assert.equal(b.target.sold_so_far, t.sold_so_far);
    // Days are counted from the last FILLED day (the 7th), not from the number of entries (6): 540000 / 7 per day.
    assert.equal(A.daysElapsed, 7);
    assert.equal(b.target.projected_month_end, Math.round(540000 / 7 * 31));
  });
  test('when the pace calculation is not loaded the briefing says so instead of recomputing it', () => {
    const keep = window.Analytics; window.Analytics = undefined;
    const x = buildBriefing(NOW);
    window.Analytics = keep;
    assert.equal(x.target, null);
    assert.ok(x.attention.some(a => a.area === 'target' && /not available/.test(a.message)));
  });
  test('inventory findings', () => {
    assert.equal(b.inventory.out_of_stock_but_selling, 1);
    assert.equal(b.inventory.running_out_within_7_days, 1);
    assert.equal(b.inventory.most_urgent[0].name, 'Panadol');
    assert.equal(b.inventory.slow_moving_stock_value, 4000);
  });
  test('warnings are sorted first and counted', () => {
    assert.equal(b.attention[0].level, 'warn');
    assert.equal(b.needs_action, b.attention.filter(a => a.level === 'warn').length);
  });
  test('no target set → informational note, not a crash', () => {
    Repository.setItem('bt_targets', '{}');
    const x = buildBriefing(NOW);
    assert.ok(x.attention.some(a => a.area === 'target' && /No sales target/.test(a.message)));
    Repository.setItem('bt_targets', JSON.stringify({ 'October 2026': 4000000 }));
  });
  test('inventory not loaded → says so', () => {
    const keep = window.inventoryBridgeGetFullData; window.inventoryBridgeGetFullData = () => null;
    const x = buildBriefing(NOW);
    assert.equal(x.inventory, null);
    assert.ok(x.attention.some(a => a.area === 'inventory' && /not loaded/.test(a.message)));
    window.inventoryBridgeGetFullData = keep;
  });
  test('registered as a read tool and runs through the registry', async () => {
    const r = await reg.runTool('daily_briefing', {});
    assert.equal(r.ok, true);
    assert.ok(JSON.parse(r.text).attention);
    assert.equal(reg.getTool('daily_briefing').risk, 'read');
  });
});

describe('briefing: alert rules shared with the ntfy briefing', () => {
  const NOW2 = new Date(2026, 9, 13, 9, 0); // 13 Oct → last filled day will be 11
  before(() => {
    const q = console.error; console.error = () => {};
    [8, 9, 10].forEach(d => cfg.DAILY.push(day(d, 100000)));
    cfg.DAILY.push({ ...day(11, 40000), DIFF: '12000' });
    cfg.MONTHLY.splice(cfg.MONTHLY.findIndex(m => m.Month_Year === 'October 2026'), 1,
      { Month_Year: 'October 2026', TOTAL: String(100000 * 8 + 40000), 'COMP SALE': '0', Customers: '90' });
    console.error = q;
  });
  const warns = (x, area) => x.attention.filter(a => a.level === 'warn' && a.area === area).map(a => a.message).join(' | ');

  test('projection below 90% of target warns once the month is past day 10', () => {
    const x = buildBriefing(NOW2);
    assert.match(warns(x, 'target'), /At the current pace/);
  });
  test('cash DIFF of Rs 10,000+ on the latest entry warns', () => {
    assert.match(warns(buildBriefing(NOW2), 'sales'), /Cash DIFF Rs 12,000 on 11\/Oct\/2026/);
  });
  test('a sale 30%+ below the same weekday last week warns', () => {
    const x = buildBriefing(NOW2);
    assert.match(warns(x, 'sales'), /60% below the same weekday last week/); // 40,000 vs 100,000 on 04/Oct
    assert.equal(x.latest_vs_last_week_pct, -60);
  });
  test('a small DIFF or a normal day does not warn', () => {
    const rec = cfg.DAILY.find(d => d.Date === '11/Oct/2026'); const keep = { ...rec };
    rec.DIFF = '9999'; rec.TOTAL = '95000';
    const x = buildBriefing(NOW2);
    assert.ok(!/Cash DIFF/.test(warns(x, 'sales')) && !/same weekday/.test(warns(x, 'sales')));
    Object.assign(rec, keep);
  });
});
