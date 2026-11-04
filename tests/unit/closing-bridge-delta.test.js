// closing-bridge: the Closing mirror is rebuilt from CHANGED rows only
// (2026-11 egress cleanup) instead of re-downloading everything every 15 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const { mergeClosingRows, maxIso } = await import('../../js/closing/closing-bridge.js');

const al = (ts, key = 'k', action = 'save', actor = 'a') => ({ ts, actor, key, action, changes: null });
const prev = () => ({
  settings: { s: 1 },
  sheets: { '2026-11-01_Night': { v: 1 }, '2026-11-01_Morning': { v: 1 } },
  creditLedger: [{ key: '2026-11-01_Night', n: 1 }, { key: '2026-11-01_Morning', n: 1 }],
  activityLog: [al(1), al(2)],
});

test('delta: changed rows replace by key, untouched rows stay', () => {
  const out = mergeClosingRows(prev(), {
    sheets: [{ key: '2026-11-01_Morning', data: { v: 2 } }, { key: '2026-11-02_Night', data: { v: 1 } }],
    creditLedger: [{ key: '2026-11-01_Morning', data: { key: '2026-11-01_Morning', n: 2 } }],
    settings: null, activityLog: [], tombstoneKeys: [],
  }, true);
  assert.deepEqual(Object.keys(out.sheets).sort(), ['2026-11-01_Morning', '2026-11-01_Night', '2026-11-02_Night']);
  assert.equal(out.sheets['2026-11-01_Morning'].v, 2);
  assert.equal(out.sheets['2026-11-01_Night'].v, 1);
  assert.equal(out.creditLedger.length, 2);
  assert.equal(out.creditLedger.find(r => r.key === '2026-11-01_Morning').n, 2);
  assert.deepEqual(out.settings, { s: 1 }, 'settings fall back to the previous copy when none came back');
});

test('delta: tombstones remove rows from sheets and credit ledger', () => {
  const out = mergeClosingRows(prev(), { sheets: [], creditLedger: [], settings: null, activityLog: [], tombstoneKeys: ['2026-11-01_Night'] }, true);
  assert.deepEqual(Object.keys(out.sheets), ['2026-11-01_Morning']);
  assert.deepEqual(out.creditLedger.map(r => r.key), ['2026-11-01_Morning']);
});

test('delta: a tombstoned key that also arrives in the delta stays removed', () => {
  const out = mergeClosingRows(prev(), { sheets: [{ key: 'x', data: {} }], creditLedger: [], settings: null, activityLog: [], tombstoneKeys: ['x'] }, true);
  assert.ok(!('x' in out.sheets));
});

test('delta: activity log appends only unseen entries, in ts order, without created_at', () => {
  const out = mergeClosingRows(prev(), {
    sheets: [], creditLedger: [], settings: null, tombstoneKeys: [],
    activityLog: [{ ...al(2), created_at: 'x' }, { ...al(5), created_at: 'y' }, { ...al(3), created_at: 'z' }],
  }, true);
  assert.deepEqual(out.activityLog.map(e => e.ts), [1, 2, 3, 5]);
  assert.ok(out.activityLog.every(e => !('created_at' in e)));
});

test('full: replaces everything from the whole tables', () => {
  const out = mergeClosingRows(prev(), {
    sheets: [{ key: 'a', data: { v: 9 } }], creditLedger: [{ key: 'a', data: { key: 'a' } }],
    settings: { data: { s: 2 } }, activityLog: [al(7)], tombstoneKeys: [],
  }, false);
  assert.deepEqual(Object.keys(out.sheets), ['a']);
  assert.equal(out.creditLedger.length, 1);
  assert.deepEqual(out.settings, { s: 2 });
  assert.deepEqual(out.activityLog.map(e => e.ts), [7]);
});

test('maxIso only moves forward', () => {
  assert.equal(maxIso([{ t: '2026-11-04T05:00:00Z' }], 't', '2026-11-04T06:00:00Z'), '2026-11-04T06:00:00Z');
  assert.equal(maxIso([{ t: '2026-11-04T07:00:00Z' }], 't', null), '2026-11-04T07:00:00Z');
  assert.equal(maxIso([], 't', null), null);
});
