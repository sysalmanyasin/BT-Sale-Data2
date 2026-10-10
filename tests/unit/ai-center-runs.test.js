import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRuns } from '../../js/ai-center/model.js';
let t = 1000;
const ev = (type, o = {}) => ({ type, timestamp: (t += 100), request_id: 'r1', agent: null, tool: null, status: null, metadata: {}, ...o });

test('a complete run lists only the stages that happened, with duration and tools', () => {
  const r = buildRuns([ev('request_start', { metadata: { question: 'What is blocking closing?' } }), ev('routed', { agent: 'Closing' }), ev('specialist_start', { agent: 'Closing' }),
    ev('tool_start', { tool: 'closing_recent_days' }), ev('tool_end', { tool: 'closing_recent_days', status: 'ok', duration: 120, agent: 'Closing' }), ev('answer')])[0];
  assert.equal(r.status, 'complete'); assert.equal(r.question, 'What is blocking closing?'); assert.deepEqual(r.agents, ['Closing']);
  assert.deepEqual(r.stages.map(s => s.key), ['received', 'routed', 'working', 'answer']);
  assert.equal(r.tools.length, 1); assert.equal(r.durationMs, 500);
  assert.ok(!r.stages.some(s => s.key === 'approval' || s.key === 'verify'), 'no placeholder stages for things that did not happen');
});
test('open request: running, then awaiting approval until resolved', () => {
  const base = [ev('request_start', { metadata: { question: 'add entry' } }), ev('routed', { agent: 'Staff & money' })];
  assert.equal(buildRuns(base, 'r1')[0].status, 'running');
  const wait = buildRuns([...base, ev('approval_requested', { tool: 'add_ledger_entry', metadata: { title: 'Add entry' } })], 'r1')[0];
  assert.equal(wait.status, 'awaiting_approval'); assert.equal(wait.stages.at(-1).status, 'waiting');
  const done = buildRuns([...base, ev('approval_requested', { tool: 'add_ledger_entry' }), ev('approval_resolved', { status: 'approved' }), ev('verify_start'), ev('verify_end', { status: 'ok' }), ev('answer')])[0];
  assert.equal(done.status, 'complete'); assert.deepEqual(done.stages.filter(s => ['approval', 'verify'].includes(s.key)).map(s => s.status), ['done', 'done']);
});
test('failed, cancelled, and never-closed old runs are reported honestly', () => {
  assert.equal(buildRuns([ev('request_start'), ev('error', { metadata: { message: 'boom' } })])[0].status, 'failed');
  assert.equal(buildRuns([ev('request_start'), ev('cancelled')])[0].status, 'cancelled');
  const old = buildRuns([ev('request_start', { historical: true })])[0];
  assert.equal(old.status, 'unfinished', 'an old unclosed request must not look like it is still running');
  assert.equal(old.historical, true); assert.equal(old.durationMs, null);
});
test('events without a request id are ignored; runs are newest first', () => {
  const a = [ev('request_start', { request_id: 'a' }), ev('answer', { request_id: 'a' })], b = [ev('request_start', { request_id: 'b' }), ev('answer', { request_id: 'b' })];
  assert.deepEqual(buildRuns([...a, ...b, { type: 'tool_end', timestamp: 5, request_id: null }]).map(r => r.id), ['b', 'a']);
  assert.deepEqual(buildRuns([]), []);
});
