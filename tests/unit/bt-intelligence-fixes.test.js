// BT Intelligence fixes: dashboard reads of big tool results, one failure rule, STALE not CLEAR,
// no false 'cleared' noise while sales loads, timing-aware 'above usual' alerts, rollover alert waits until the 10th.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js'); globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js'); globalThis.Repository = Repository;
const reg = await import('../../js/agent/core/tool-registry.js');
const M = await import('../../js/ai-center/model.js');
const { categorySpikes, reorderDraft } = await import('../../js/shared/planning-metrics.js');
const { buildBriefing } = await import('../../js/agent/tools/briefing.js');

describe('tool result cap', () => {
  before(() => {
    reg.registerTool({ name: 'big_read', domain: 'app', risk: 'read', description: 'x', parameters: { type: 'object', properties: {} },
      run: () => ({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: 'row ' + i })) }) });
  });
  test('model path is still capped, flagged as truncated, and stays valid JSON', async () => {
    const r = await reg.runTool('big_read', {});
    assert.ok(r.text.length <= reg.RESULT_CHAR_CAP); assert.match(r.text, /truncated/);
    assert.ok(JSON.parse(r.text)._truncated);
  });
  test('dashboard path gets the whole result as valid JSON', async () => {
    const r = await reg.runTool('big_read', {}, { resultCap: reg.UI_RESULT_CHAR_CAP });
    assert.equal(JSON.parse(r.text).rows.length, 2000);
  });
  test('a realistic 40-line reorder draft is bigger than the model cap but fits the dashboard cap', () => {
    const products = Array.from({ length: 900 }, (_, i) => ({ code: 'C' + i, name: 'Medicine ' + i + ' 500mg tab 10s', supplier: 'S' + (i % 12), qty: i % 3 ? 0 : 5, price: 120, netQty30Days: 30 + (i % 40), netQty60Days: 60 + (i % 70), netQty90Days: 90 + (i % 100) }));
    const len = JSON.stringify(reorderDraft({ products, limit: 40 })).length;
    assert.ok(len > reg.RESULT_CHAR_CAP, 'this is the case that used to fail: ' + len);
    assert.ok(len < reg.UI_RESULT_CHAR_CAP);
  });
});

describe('one failure rule for every health row', () => {
  test('thresholds', () => {
    assert.equal(M.failureStatus(0, 0), 'NOT_MEASURED');
    assert.equal(M.failureStatus(58, 2), 'HEALTHY');      // under 3 failures
    assert.equal(M.failureStatus(200, 5), 'HEALTHY');     // under 5%
    assert.equal(M.failureStatus(58, 8), 'WARNING');      // the screenshot: 8 of 58 used to be green
    assert.equal(M.failureStatus(47, 4), 'WARNING');      // 4 of 47 too
    assert.equal(M.failureStatus(20, 4), 'DEGRADED');
    assert.equal(M.failureStatus(10, 6), 'ERROR');
  });
  test('provider and specialist health use it', () => {
    assert.equal(M.providerHealth([{ calls: 58, failed: 8 }]).status, 'WARNING');
    assert.equal(M.specialistsHealth({ Sales: { runs: 47, failed: 4 } }, 8).status, 'WARNING');
  });
  test('WARNING is amber', () => assert.equal(M.STATUS_TONE.WARNING, 'wn'));
});

describe('STALE instead of CLEAR', () => {
  test('a CLEAR system with old data is STALE', () => {
    const s = M.applyStale({ status: 'CLEAR', reason: 'On track', warnings: 0 }, { status: 'WARNING', label: '1 day(s) since last sales entry' });
    assert.equal(s.status, 'STALE'); assert.match(s.reason, /out of date/); assert.equal(M.STATUS_TONE.STALE, 'wn');
  });
  test('fresh data and non-CLEAR statuses are untouched', () => {
    const ok = { status: 'CLEAR', reason: 'On track', warnings: 0 };
    assert.equal(M.applyStale(ok, { status: 'HEALTHY', label: 'today' }), ok);
    const att = { status: 'ATTENTION', reason: '2 findings', warnings: 2 };
    assert.equal(M.applyStale(att, { status: 'ERROR', label: 'old' }), att);
  });
});

describe('partial snapshots (sales still loading)', () => {
  test('detected from the briefing flag', () => {
    assert.equal(M.isPartialSnapshot({ raw: { briefing: { sales_data_ready: false } } }), true);
    assert.equal(M.isPartialSnapshot({ raw: { briefing: { sales_data_ready: true } } }), false);
    assert.equal(M.isPartialSnapshot(null), false);
  });
});

describe('above-usual alerts understand timing', () => {
  test('salary paid after the 10th is not a spike when it matches a normal full month', () => {
    const cur = { Salary: 100000 }, sameRange = [{ Salary: 0 }, { Salary: 0 }, { Salary: 0 }], full = [{ Salary: 98000 }, { Salary: 100000 }, { Salary: 102000 }];
    assert.equal(categorySpikes(cur, sameRange).length, 1, 'old behaviour flagged it');
    assert.equal(categorySpikes(cur, sameRange, { fullMonths: full }).length, 0);
  });
  test('a real spike or a brand-new category is still flagged', () => {
    const full = [{ Salary: 100000, Fuel: 5000 }, { Salary: 100000, Fuel: 5000 }];
    assert.equal(categorySpikes({ Salary: 190000 }, [{ Salary: 0 }], { fullMonths: full }).length, 1);
    assert.equal(categorySpikes({ Brand: 20000 }, [{}], { fullMonths: full }).length, 1);
  });
});

describe('above-usual alerts report the real baseline', () => {
  test('spikes carry the typical full-month total so the wording can be honest', () => {
    const s = categorySpikes({ Generic: 62300 }, [{ Generic: 0 }], { fullMonths: [{ Generic: 20000 }, { Generic: 22000 }] });
    assert.equal(s.length, 1);
    assert.equal(s[0].usual_same_period, 0);
    assert.equal(s[0].usual_full_month, 21000);
  });
  test('a category with no history anywhere reports a zero full-month baseline', () => {
    const s = categorySpikes({ Brand: 20000 }, [{}], { fullMonths: [{ Fuel: 5000 }] });
    assert.equal(s[0].usual_full_month, 0);
  });
});

describe('credit rollover alert waits for the 10th', () => {
  const sep = [{ name: 'A', prevBal: 0, entries: [{ date: '10-Sep-2026', desc: 'x', amount: 9000 }], salary: 0, lessGeneric: 0 }];
  const oct = [{ name: 'A', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 }];
  const level = d => { Repository.setItem('BT_ManagerWork_v1', JSON.stringify({ credit: { 'September 2026': sep, 'October 2026': oct } }));
    return buildBriefing(new Date(2026, 9, d)).attention.find(a => a.area === 'credit' && /carries nothing over/.test(a.message)); };
  test('day 9 is information, day 12 is a warning; the figures are exposed either way', () => {
    assert.equal(level(9).level, 'info');
    assert.equal(level(12).level, 'warn');
    assert.equal(buildBriefing(new Date(2026, 9, 9)).credit.unrolled_owed, 9000);
  });
});
