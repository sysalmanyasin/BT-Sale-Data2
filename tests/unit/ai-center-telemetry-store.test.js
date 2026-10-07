// Persistent activity history (spec "persistent activity history", §41/§42): real events only, redacted, bounded,
// multi-tab safe, and a restored event can never make BT look "busy".
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../js/agent/core/telemetry.js';
import * as S from '../../js/agent/core/telemetry-store.js';

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m }; };

describe('toStored: what is allowed to be persisted', () => {
  test('tool arguments, answer text and approval lines are dropped; secrets never survive', () => {
    const a = T.emit({ type: 'tool_start', tool: 'add_staff_credit_entry', request_id: 'r1', metadata: { risk: 'write', args: { staff: 'Ali', amount: 5000, password: 'x' } } });
    assert.equal(JSON.stringify(S.toStored(a)).includes('Ali'), false);
    const ans = T.emit({ type: 'answer', request_id: 'r1', metadata: { steps: 2, chars: 40, text: 'Ali owes Rs 5,000 (private)' } });
    assert.equal(JSON.stringify(S.toStored(ans)).includes('owes'), false);
    const ap = T.emit({ type: 'approval_requested', tool: 'x', metadata: { title: 'Add credit', risk: 'write', lines: ['Staff: Ali Khan'], args: { phone: '0300' }, reversible: true } });
    const st = S.toStored(ap);
    assert.equal(st.metadata.lines, undefined); assert.equal(st.metadata.args, undefined); assert.equal(st.metadata.reversible, true);
  });
  test('AI Center monitoring reads and unknown event types are not stored', () => {
    assert.equal(S.toStored(T.emit({ type: 'tool_end', source: 'ai-center', tool: 'daily_briefing' })), null);
    assert.equal(S.toStored(T.emit({ type: 'something_new', metadata: { a: 1 } })), null);
    assert.equal(S.toStored(null), null);
  });
  test('only an allow-list of metadata fields is kept, and strings are clipped', () => {
    const e = S.toStored(T.emit({ type: 'error', metadata: { message: 'x'.repeat(500), secret_token: 'abc', other: 1 } }));
    assert.deepEqual(Object.keys(e.metadata), ['message']); assert.ok(e.metadata.message.length <= 140);
  });
});

describe('saveSession / loadStored', () => {
  test('retention window and size cap', () => {
    const st = mem(), now = 1_800_000_000_000;
    const live = Array.from({ length: 400 }, (_, i) => ({ event_id: 'ev_' + i, timestamp: now - i * 1000, type: 'answer', source: 'agent', metadata: { steps: 1 } }));
    assert.equal(S.saveSession(st, 's1', live, now), S.MAX_STORED);
    st.setItem(S.KEY, JSON.stringify([{ event_id: 'old', timestamp: now - 8 * 86400000, type: 'answer', session: 'sOld' }, ...JSON.parse(st.getItem(S.KEY))]));
    assert.equal(S.loadStored(st, now).some(e => e.event_id === 'old'), false, 'older than 7 days is dropped');
  });
  test('two tabs do not overwrite each other', () => {
    const st = mem(), now = 1_800_000_000_000;
    S.saveSession(st, 'tabA', [{ event_id: 'ev_1', timestamp: now - 2000, type: 'answer', metadata: {} }], now);
    S.saveSession(st, 'tabB', [{ event_id: 'ev_1', timestamp: now - 1000, type: 'error', metadata: { message: 'x' } }], now);
    const ids = S.loadStored(st, now).map(e => e.event_id).sort();
    assert.deepEqual(ids, ['tabA:ev_1', 'tabB:ev_1']);
  });
  test('corrupt or blocked storage never throws', () => {
    const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    assert.deepEqual(S.loadStored(bad), []); assert.equal(S.saveSession(bad, 's', []), 0);
    assert.deepEqual(S.loadStored(null), []); assert.equal(S.clearStored(null), false);
  });
});

describe('startPersistence + hydrate', () => {
  beforeEach(() => T.clear());
  test('a previous session\'s events come back as history, stats span sessions, but nothing looks in progress', () => {
    const st = mem(), now = Date.now();
    // previous session: a request that never finished (tab closed), plus a finished tool call
    S.saveSession(st, 'prev', [
      { event_id: 'ev_1', timestamp: now - 60000, type: 'request_start', request_id: 'rq_old', agent: 'Sales', metadata: { question: 'old q' } },
      { event_id: 'ev_2', timestamp: now - 59000, type: 'tool_end', tool: 'get_sales_summary', status: 'ok', duration: 40, request_id: 'rq_old', metadata: { risk: 'read' } },
    ], now);
    const p = S.startPersistence({ storage: st, telemetry: T, setTimeoutFn: fn => { fn(); return 1; } });
    assert.equal(p.loaded, 2);
    assert.equal(T.liveState().open, null, 'an unfinished historical request must not look like live work');
    assert.equal(T.toolStats().get_sales_summary.calls, 1, 'tool stats include earlier sessions');
    assert.ok(T.recent(10).every(e => e.historical));
    T.emit({ type: 'answer', request_id: 'rq_new', metadata: { steps: 1 } });
    p.flush();
    const saved = S.loadStored(st).filter(e => e.session === p.sessionId);
    assert.equal(saved.length, 1, 'only this session\'s new event is added; historical events are not duplicated');
    p.stop();
  });
  test('hydrate twice does not duplicate', () => {
    const ev = [{ event_id: 'a', timestamp: 1, type: 'answer' }];
    assert.equal(T.hydrate(ev), 1); assert.equal(T.hydrate(ev), 0);
  });
});
