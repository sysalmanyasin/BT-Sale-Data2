// Drive backup verification: pure helpers exposed on window.DriveVerify by js/drive.js.
// Covers: sale-date parsing, summaries, backup validation, shrink guard, read-back comparison,
// restore dry-run plan, and the health traffic light used by the Tools card.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
import { loadClassicScript } from '../helpers/load-classic-script.js';

let V;
before(() => {
  installDomEnv();
  loadClassicScript('js/drive.js', window);
  V = window.DriveVerify;
});

const day = (d, m) => ({ Date: d, Month_Year: m });
const good = () => ({
  formatVersion: 2, backedUpAt: '2026-10-22T05:00:00Z',
  monthly: [{ Month_Year: 'Sep 2026' }, { Month_Year: 'Oct 2026' }],
  daily: [day('30/Sep/2026', 'Sep 2026'), day('02/Oct/2026', 'Oct 2026'), day('21/Oct/2026', 'Oct 2026')],
  staff: [{ id: 's1' }, { id: 's2' }],
  ledger: { entries: [{ id: 'l1' }] }, jazzcash: { entries: [{ id: 'j1' }, { id: 'j2' }] },
  petty: { mw_petty_Oct_2026: {} }, notes: [{ id: 'n1' }], staffNotes: [], sheetWorkbooks: { a: 1 }
});

after(() => window.close()); // stop jsdom timers so the test process can exit

test('dateKey parses DD/Mon/YYYY and ISO, rejects junk', () => {
  assert.equal(V.dateKey('21/Oct/2026'), '20261021');
  assert.equal(V.dateKey('2/Jan/2026'), '20260102');
  assert.equal(V.dateKey('2026-10-22T01:00:00Z'), '20261022');
  assert.equal(V.dateKey('nonsense'), '');
  assert.equal(V.dateKey(undefined), '');
});

test('today() is a YYYY-MM-DD string', () => assert.match(V.today(), /^\d{4}-\d{2}-\d{2}$/));

test('summarize counts everything and finds the latest sale by real date, not array order', () => {
  const p = good(); p.daily.reverse();
  const s = V.summarize(p);
  assert.deepEqual({ ...s }, { months: 2, days: 3, latest: '21/Oct/2026', staff: 2, ledger: 1, jazzcash: 2, pettyMonths: 1, notes: 1, workbooks: 1 });
  assert.equal(V.summarize(null).days, 0);
});

test('validate accepts a good backup and flags broken ones', () => {
  assert.deepEqual([...V.validate(good())], []);
  assert.ok(V.validate(null).length);
  assert.ok(V.validate({ ...good(), daily: 'x' }).some(p => /Daily/.test(p)));
  assert.ok(V.validate({ ...good(), daily: [day('', 'Oct 2026')] }).some(p => /no Date/.test(p)));
  assert.ok(V.validate({ ...good(), daily: [], monthly: [] }).some(p => /no sales data/.test(p)));
  assert.ok(V.validate({ ...good(), staff: undefined }).some(p => /Staff/.test(p)));
  const v1 = good(); delete v1.formatVersion; delete v1.staff;
  assert.deepEqual([...V.validate(v1)], [], 'old format-1 backups stay restorable');
});

test('shrink guard blocks a much smaller overwrite but allows normal growth/small edits', () => {
  const prev = { days: 100, months: 10 };
  assert.equal(V.shrunk(prev, { days: 100, months: 10 }), false);
  assert.equal(V.shrunk(prev, { days: 120, months: 11 }), false);
  assert.equal(V.shrunk(prev, { days: 99, months: 10 }), false);
  assert.equal(V.shrunk(prev, { days: 50, months: 10 }), true);
  assert.equal(V.shrunk(prev, { days: 0, months: 0 }), true);
  assert.equal(V.shrunk(null, { days: 0, months: 0 }), false);
});

test('compareSent: identical read-back passes, any drift is reported', () => {
  const s = V.summarize(good());
  assert.deepEqual([...V.compareSent(s, V.summarize(good()))], []);
  const t = V.summarize(good()); t.days = 2; t.latest = '02/Oct/2026';
  const pr = V.compareSent(s, t);
  assert.equal(pr.length, 2);
  assert.match(pr[0], /days: sent 3, read back 2/);
});

test('restorePlan is a dry run: counts only what is missing live, dedupes, never mutates', () => {
  const live = { daily: [day('21/Oct/2026', 'Oct 2026')], monthly: [{ Month_Year: 'Oct 2026' }], staff: [{ id: 's1' }],
    ledger: { entries: [{ id: 'l1' }] }, jazzcash: { entries: [] }, notes: [], staffNotes: [], targets: { a: 1 }, pettyKeys: ['mw_petty_Oct_2026'] };
  const snap = JSON.stringify(live);
  const data = { ...good(), daily: good().daily.concat(good().daily[0]), targets: { a: 9, b: 2 } };
  const p = V.restorePlan(data, live);
  assert.deepEqual({ ...p }, { months: 1, days: 2, staff: 1, ledger: 0, jazzcash: 2, pettyMonths: 0, notes: 1, targets: 1 });
  assert.equal(JSON.stringify(live), snap, 'live data untouched');
  assert.equal(V.restorePlan({}, {}).days, 0);
});

test('health light: none → amber, fresh+drill → green, stale/failed → red', () => {
  const now = Date.parse('2026-10-22T12:00:00Z'), H = 3600e3;
  const iso = ms => new Date(now - ms).toISOString();
  assert.equal(V.evaluateHealth(null, null, now).level, 'warn');
  assert.equal(V.evaluateHealth({ at: iso(2 * H), ok: true }, { at: iso(24 * H), ok: true }, now).level, 'ok');
  assert.equal(V.evaluateHealth({ at: iso(2 * H), ok: true }, null, now).level, 'warn');
  assert.equal(V.evaluateHealth({ at: iso(2 * H), ok: true }, { at: iso(9 * 24 * H), ok: true }, now).level, 'warn');
  assert.equal(V.evaluateHealth({ at: iso(30 * H), ok: true }, { at: iso(H), ok: true }, now).level, 'warn');
  assert.equal(V.evaluateHealth({ at: iso(80 * H), ok: true }, { at: iso(H), ok: true }, now).level, 'bad');
  assert.equal(V.evaluateHealth({ at: iso(H), ok: false, problems: ['days mismatch'] }, null, now).level, 'bad');
  assert.equal(V.evaluateHealth({ at: iso(H), ok: true }, { at: iso(H), ok: false, problems: ['x'] }, now).level, 'bad');
});
