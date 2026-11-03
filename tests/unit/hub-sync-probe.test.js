// Shared inventory_sync_log probe (2026-11 egress cleanup).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLatestSyncedAt, _reset, MEMO_MS } from '../../js/platform/hub-sync-probe.js';

let calls, answer;
const client = {
  from(table) {
    assert.equal(table, 'inventory_sync_log');
    const b = {
      select(c) { assert.equal(c, 'synced_at', 'only the 1 column is read'); return b; },
      order() { return b; }, limit() { return b; },
      maybeSingle() { calls += 1; return Promise.resolve(answer()); },
    };
    return b;
  },
};
beforeEach(() => { _reset(); calls = 0; answer = () => ({ data: { synced_at: 'T1' }, error: null }); });

test('concurrent callers (e.g. every bridge on Resume) share ONE request', async () => {
  const [a, b, c] = await Promise.all([fetchLatestSyncedAt(client), fetchLatestSyncedAt(client), fetchLatestSyncedAt(client)]);
  assert.deepEqual([a, b, c], ['T1', 'T1', 'T1']);
  assert.equal(calls, 1);
});

test('a successful answer is reused for MEMO_MS, then re-read', async () => {
  const realNow = Date.now;
  try {
    let t = 1_000_000; Date.now = () => t;
    await fetchLatestSyncedAt(client); await fetchLatestSyncedAt(client);
    assert.equal(calls, 1);
    t += MEMO_MS + 1;
    answer = () => ({ data: { synced_at: 'T2' }, error: null });
    assert.equal(await fetchLatestSyncedAt(client), 'T2');
    assert.equal(calls, 2);
  } finally { Date.now = realNow; }
});

test('errors and empty answers are never cached -- the next caller retries', async () => {
  answer = () => ({ data: null, error: new Error('down') });
  await assert.rejects(fetchLatestSyncedAt(client), /down/);
  answer = () => ({ data: null, error: null });
  assert.equal(await fetchLatestSyncedAt(client), null);
  answer = () => ({ data: { synced_at: 'T3' }, error: null });
  assert.equal(await fetchLatestSyncedAt(client), 'T3');
  assert.equal(calls, 3);
});
