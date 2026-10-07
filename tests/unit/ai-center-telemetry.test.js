import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { emit, recent, clear, subscribe, toolStats, liveState, redact, MAX_EVENTS } from '../../js/agent/core/telemetry.js';

describe('telemetry: redaction', () => {
  test('secret-looking keys are masked, long strings clipped, depth bounded', () => {
    const r = redact({ api_key: 'sk-123', Authorization: 'Bearer x', staff: { phone: '0300', name: 'Ali' }, note: 'x'.repeat(500), n: 5 });
    assert.equal(r.api_key, '[redacted]');
    assert.equal(r.Authorization, '[redacted]');
    assert.equal(r.staff.phone, '[redacted]');
    assert.equal(r.staff.name, 'Ali');
    assert.ok(r.note.length < 200);
    assert.equal(r.n, 5);
  });
  test('emit stores redacted metadata only', () => {
    clear(); const e = emit({ type: 'tool_start', tool: 't', metadata: { args: { password: 'pw', q: 'ok' } } });
    assert.equal(e.metadata.args.password, '[redacted]');
    assert.equal(e.metadata.args.q, 'ok');
  });
});

describe('telemetry: buffer', () => {
  beforeEach(() => clear());
  test('newest first, bounded, subscribers notified, bad subscriber cannot break others', () => {
    const seen = []; const un = subscribe(() => { throw new Error('boom'); }); const un2 = subscribe(e => seen.push(e.type));
    emit({ type: 'a' }); emit({ type: 'b' });
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(recent()[0].type, 'b');
    un(); un2();
    for (let i = 0; i < MAX_EVENTS + 25; i++) emit({ type: 'x' });
    assert.equal(recent(1000).length, MAX_EVENTS);
  });
  test('emit never throws on garbage', () => { assert.doesNotThrow(() => emit(null)); assert.doesNotThrow(() => emit(undefined)); });
});

describe('telemetry: tool stats', () => {
  beforeEach(() => clear());
  test('calls, success rate (rejections excluded), average duration', () => {
    emit({ type: 'tool_end', tool: 'x', status: 'ok', duration: 10 });
    emit({ type: 'tool_end', tool: 'x', status: 'failed', duration: 30 });
    emit({ type: 'tool_end', tool: 'x', status: 'rejected' });
    const s = toolStats().x;
    assert.equal(s.calls, 3); assert.equal(s.ok, 1); assert.equal(s.failed, 1); assert.equal(s.rejected, 1);
    assert.equal(s.avgMs, 20); assert.equal(s.successRate, 50);
  });
  test('a tool that never ran has no stats (nothing is invented)', () => { assert.equal(toolStats().nothing, undefined); });
});

describe('telemetry: live state', () => {
  beforeEach(() => clear());
  test('idle when nothing happened', () => {
    const l = liveState(); assert.equal(l.open, null); assert.equal(l.activeTool, null);
  });
  test('open request, active tool, then finished', () => {
    emit({ type: 'request_start', request_id: 'r1', agent: 'Sales', metadata: { question: 'q' } });
    emit({ type: 'routed', request_id: 'r1', metadata: { domains: ['sales'] } });
    emit({ type: 'step', request_id: 'r1', metadata: { step: 1, max: 8 } });
    emit({ type: 'tool_start', request_id: 'r1', tool: 'get_sales_summary', entity_reference: 'c1' });
    let l = liveState();
    assert.equal(l.open.request_id, 'r1'); assert.equal(l.activeTool.tool, 'get_sales_summary'); assert.equal(l.steps, 1);
    emit({ type: 'tool_end', request_id: 'r1', tool: 'get_sales_summary', entity_reference: 'c1', status: 'ok', duration: 4 });
    l = liveState(); assert.equal(l.activeTool, null); assert.equal(l.tools.length, 1);
    emit({ type: 'answer', request_id: 'r1' });
    l = liveState(); assert.equal(l.open, null); assert.equal(l.lastClosed.type, 'answer');
  });
  test('pending approval is tracked until it is resolved', () => {
    emit({ type: 'request_start', request_id: 'r2' });
    emit({ type: 'approval_requested', request_id: 'r2', tool: 'add_ledger_entry' });
    assert.equal(liveState().pendingApproval.tool, 'add_ledger_entry');
    emit({ type: 'approval_resolved', request_id: 'r2', tool: 'add_ledger_entry', status: 'rejected' });
    assert.equal(liveState().pendingApproval, null);
  });
  test('monitoring reads (no request id) never look like an agent mission', () => {
    emit({ type: 'tool_start', source: 'ai-center', tool: 'daily_briefing' });
    assert.equal(liveState().open, null);
  });
});
