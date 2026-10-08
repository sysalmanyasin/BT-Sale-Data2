import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastSales, anomalySignals, reorderRecommendation, rankOpportunities, evidenceBundle, learningSummary, verificationSummary } from '../../js/ai-center/manager-intelligence-v2.js';

test('forecast uses recent seven-day average', () => {
  const r = forecastSales(Array.from({length: 7}, () => ({ sale: 1000 })), 7);
  assert.equal(r.average_daily, 1000); assert.equal(r.projected, 7000);
});

test('anomaly detects a material latest-day deviation', () => {
  const r = anomalySignals([1000, 1000, 1000, 1000, 1000].map((sale, i) => ({ date: String(i), sale })).concat({ date: '6', sale: 600 }), .3);
  assert.equal(r[0].kind, 'below_baseline');
});

test('reorder recommendation is read-only and deterministic', () => {
  const r = reorderRecommendation({ name: 'A', qty: 2, netQty30Days: 30 }, { leadDays: 3, targetDays: 14, safetyDays: 2 });
  assert.equal(r.suggested_qty, 17);
});

test('opportunities rank by money impact before severity tie-breaks', () => {
  const r = rankOpportunities([{ title: 'A', money_impact: 100 }, { title: 'B', money_impact: 500 }]);
  assert.equal(r[0].title, 'B');
});

test('evidence and learning/verification summaries stay deterministic', () => {
  const e = evidenceBundle({ id: 'f1', title: 'x', evidence: [{ kind: 'FACT', label: 'a', value: 'b' }] }, { data_as_of: 1 });
  assert.equal(e.source_count, 1);
  const l = learningSummary([{ action: 'reviewed', finding_id: 'f1' }, { action: 'resolved', finding_id: 'f1' }], [{ id: 'f1' }]);
  assert.equal(l.resolution_rate, 100);
  const v = verificationSummary([{ type: 'verify_end', status: 'ok' }, { type: 'verify_end', status: 'failed' }]);
  assert.equal(v.pass_rate, 50);
});