// audit-bridge.refreshFullData: heavy IMMUTABLE columns (rounds.item_snapshot,
// final_snapshots.report) are downloaded once per id, not on every refresh
// (2026-11 egress cleanup). Mutable columns are still fetched every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const { resume } = await import('../../js/platform/hub-gate.js');
const Bridge = await import('../../js/audit/audit-bridge.js');
resume(); // hub gate starts paused every launch

const db = {
  engagements: [{ id: 'e1', name: 'Eng' }],
  rounds: [{ id: 'r1', engagement_id: 'e1', round_number: 1, state: 'locked', item_snapshot: [{ code: 'a', company: 'X' }] }],
  assignments: [{ id: 'a1', round_id: 'r1', items: [1], status: 'counting' }],
  compiled_rounds: [],
  final_snapshots: [{ id: 'f1', engagement_id: 'e1', generated_at: '2026-10-01', report: { big: true } }],
};
const log = [];
let failHeavy = false;
globalThis.supabase = {
  createClient: () => ({
    from(table) {
      const q = { table, cols: '', ids: null };
      const b = {
        select(c) { q.cols = c; return b; }, order() { return b; },
        in(_col, ids) { q.ids = ids; return b; },
        then(res, rej) {
          log.push({ ...q });
          const heavy = q.ids && /item_snapshot|report/.test(q.cols);
          if (heavy && failHeavy) return Promise.resolve({ data: null, error: new Error('boom') }).then(res, rej);
          let rows = db[table].filter(r => !q.ids || q.ids.includes(r.id));
          const cols = q.cols.split(',').map(c => c.trim());
          rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return b;
    },
  }),
};

const heavyCalls = () => log.filter(c => c.ids && /item_snapshot|report/.test(c.cols));

test('first refresh downloads each heavy column once; the base queries never select it', async () => {
  const data = await Bridge.refreshFullData(true);
  assert.deepEqual(data.rounds[0].item_snapshot, [{ code: 'a', company: 'X' }]);
  assert.deepEqual(data.finalSnapshots[0].report, { big: true });
  assert.equal(heavyCalls().length, 2);
  const base = log.filter(c => !c.ids);
  assert.ok(base.every(c => !/item_snapshot|report/.test(c.cols)), 'no heavy column in the every-time queries');
  assert.ok(base.some(c => c.table === 'assignments' && /items/.test(c.cols)), 'mutable assignments.items still fetched');
});

test('second refresh with nothing new downloads NO heavy columns, results identical', async () => {
  const before = JSON.stringify((await Bridge.refreshFullData(true)).rounds);
  log.length = 0;
  const data = await Bridge.refreshFullData(true);
  assert.equal(heavyCalls().length, 0);
  assert.equal(JSON.stringify(data.rounds), before);
});

test('a new round fetches only its own snapshot', async () => {
  db.rounds.push({ id: 'r2', engagement_id: 'e1', round_number: 2, state: 'draft', item_snapshot: [{ code: 'b' }] });
  log.length = 0;
  const data = await Bridge.refreshFullData(true);
  const calls = heavyCalls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, ['r2']);
  assert.deepEqual(data.rounds.find(r => r.id === 'r2').item_snapshot, [{ code: 'b' }]);
  assert.deepEqual(data.rounds.find(r => r.id === 'r1').item_snapshot, [{ code: 'a', company: 'X' }]);
});

test('if the heavy-column fetch fails, the last good copy is kept (never a half-empty one)', async () => {
  db.rounds.push({ id: 'r3', engagement_id: 'e1', round_number: 3, state: 'draft', item_snapshot: [] });
  failHeavy = true;
  const data = await Bridge.refreshFullData(true);
  failHeavy = false;
  assert.equal(data.rounds.some(r => r.id === 'r3'), false, 'stale-but-complete beats fresh-but-partial');
  assert.ok(data.rounds.every(r => r.item_snapshot !== null));
});
