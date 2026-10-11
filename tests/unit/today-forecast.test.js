import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../js/shared/today-forecast.js';

describe('intraday curve + projection', () => {
  test('recordSample keeps a monotone running total and merges samples <5 min apart', () => {
    const log = {};
    assert.ok(F.recordSample(log, '2026-10-11', 600, 100000));
    assert.ok(!F.recordSample(log, '2026-10-11', 700, 90000), 'a total never drops');
    assert.ok(F.recordSample(log, '2026-10-11', 602, 110000)); assert.equal(log['2026-10-11'].length, 1);
    assert.ok(F.recordSample(log, '2026-10-11', 700, 200000)); assert.equal(log['2026-10-11'].length, 2);
    assert.ok(!F.recordSample(log, '2026-10-11', 800, 0));
  });
  const day = (d, pts) => pts.map(([m, t]) => [m, t]);
  const log = { '2026-10-08': day(0, [[600, 100], [900, 500], [1260, 1000]]), '2026-10-09': day(0, [[600, 120], [900, 600], [1260, 1200]]), '2026-10-10': day(0, [[600, 90], [900, 450], [1260, 900]]) };
  test('curveFraction is the median share done by now, null with <3 finished days', () => {
    assert.equal(F.curveFraction(log, '2026-10-11', 900), 0.5);
    assert.equal(F.curveFraction({ a: log['2026-10-08'] }, '2026-10-11', 900), null);
    const unfinished = { ...log, '2026-10-07': [[600, 10], [900, 20]] };
    assert.equal(F.curveFraction(unfinished, '2026-10-11', 900), 0.5, 'days not watched through the evening are ignored');
  });
  test('liveProjection falls back to weekday history, then blends in the learned pace', () => {
    const a = F.liveProjection({ live: 0, expected: 500000, low: 450000, high: 550000, fraction: null });
    assert.equal(a.projected, 500000); assert.match(a.basis, /weekday history$/);
    const b = F.liveProjection({ live: 300000, expected: 500000, low: 450000, high: 550000, fraction: 0.5 });
    assert.equal(b.projected, Math.round(0.5 * 600000 + 0.5 * 500000)); assert.ok(b.high - b.low < 100000, 'band tightens as the day fills');
    assert.equal(F.liveProjection({ live: 700000, expected: 500000, low: 450000, high: 550000, fraction: null }).projected, 700000, 'never below what is already sold');
  });
});

describe('the game', () => {
  test('grade thresholds', () => { assert.deepEqual(['1.9', '-2.0', '4.9', '9.9', '10.1'].map(v => F.grade(v)), ['bullseye', 'bullseye', 'hit', 'close', 'miss']); });
  test('one call per day is locked and never overwritten', () => {
    const g = {}; assert.ok(F.lockPrediction(g, 'd1', { expected: 500000, low: 450000, high: 550000 }, 540));
    assert.ok(!F.lockPrediction(g, 'd1', { expected: 999999, low: 1, high: 2 }, 600)); assert.equal(g.days.d1.expected, 500000);
    assert.ok(!F.lockPrediction(g, 'd2', { expected: 0 }, 540));
  });
  test('settle grades once; scoreboard counts streak, hits, points', () => {
    const g = { days: {} };
    for (const [d, e, fin] of [['2026-10-06', 500000, 640000], ['2026-10-07', 500000, 505000], ['2026-10-08', 500000, 525000], ['2026-10-09', 500000, 490000]]) { F.lockPrediction(g, d, { expected: e, low: 0, high: 0 }, 540); F.settleDay(g, d, fin); }
    assert.equal(F.settleDay(g, '2026-10-09', 1), null, 'already settled');
    const sb = F.scoreboard(g);
    assert.equal(sb.played, 4); assert.equal(sb.bullseyes, 2); assert.equal(sb.hits, 3); assert.equal(sb.points, 0 + 3 + 2 + 3);
    assert.equal(sb.streak, 3, 'miss on 10-06 ends the run'); assert.equal(sb.recent[0].day, '2026-10-09');
  });
  test('dayStatus and coach line', () => {
    const locked = { expected: 500000 };
    assert.equal(F.dayStatus({ live: 500000, locked, projected: 500000 }), 'reached');
    assert.equal(F.dayStatus({ live: 100, locked, projected: 600000 }), 'ahead');
    assert.equal(F.dayStatus({ live: 100, locked, projected: 495000 }), 'on_track');
    assert.equal(F.dayStatus({ live: 100, locked, projected: 400000 }), 'behind');
    assert.match(F.coachLine('reached', { live: 510000, locked, projected: 510000 }), /Forecast reached/);
  });
});
