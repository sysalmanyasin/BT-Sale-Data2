// The real agent loop must emit real events (and only those) for the AI Center.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool } from '../../js/agent/core/tool-registry.js';
import { runAgent } from '../../js/agent/core/agent-client.js';
import * as T from '../../js/agent/core/telemetry.js';

registerTool({ name: 'ev_read', domain: 'sales', risk: 'read', description: 'd', run: () => ({ ok: 1 }) });
registerTool({ name: 'ev_write', domain: 'sales', risk: 'write', description: 'd', parameters: { type: 'object', properties: {} }, preview: () => ({ title: 'Change X', lines: [], amount: 5 }), run: () => ({ saved: true }) });
const call = (name, id) => ({ id, function: { name, arguments: '{"password":"hunter2"}' } });
const server = steps => async () => ({ message: steps.shift() });

describe('runAgent telemetry', () => {
  beforeEach(() => T.clear());
  test('tool call → request_start, routed, step, tool_start/end (args redacted), answer', async () => {
    await runAgent({ userText: 'sales today', callServer: server([{ tool_calls: [call('ev_read', 'c1')] }, { content: 'done' }]) });
    const types = T.recent(50).reverse().map(e => e.type);
    assert.deepEqual(types, ['request_start', 'routed', 'step', 'tool_start', 'tool_end', 'step', 'answer']);
    const start = T.recent(50).find(e => e.type === 'tool_start');
    assert.equal(start.metadata.args.password, '[redacted]');
    assert.equal(T.recent(50).find(e => e.type === 'tool_end').status, 'ok');
  });
  test('approval gate emits requested + resolved, rejection never runs the tool', async () => {
    await runAgent({ userText: 'ledger entry', writesEnabled: true, approve: async () => false, callServer: server([{ tool_calls: [call('ev_write', 'c2')] }, { content: 'ok' }]) });
    const ev = T.recent(50).reverse();
    assert.ok(ev.some(e => e.type === 'approval_requested'));
    assert.equal(ev.find(e => e.type === 'approval_resolved').status, 'rejected');
    assert.equal(ev.find(e => e.type === 'tool_end').status, 'rejected');
  });
  test('server failure emits an error event and still throws', async () => {
    await assert.rejects(runAgent({ userText: 'x', callServer: async () => { throw new Error('providers down'); } }));
    assert.equal(T.recent(50)[0].type, 'error');
  });
});
