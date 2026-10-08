// Phase 1: every lifecycle event must correspond to something that really happened.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool } from '../../js/agent/core/tool-registry.js';
import { runAgent } from '../../js/agent/core/agent-client.js';
import * as T from '../../js/agent/core/telemetry.js';
import * as Store from '../../js/agent/core/telemetry-store.js';
import * as M from '../../js/ai-center/model.js';

registerTool({ name: 'p1_read', domain: 'sales', risk: 'read', description: 'd', run: () => ({ ok: 1 }) });
registerTool({ name: 'p1_write', domain: 'sales', risk: 'write', description: 'd', parameters: { type: 'object', properties: {} },
  preview: () => ({ title: 'Change X', lines: ['a'], amount: 5 }), run: () => ({ saved: true }), makeUndo: () => async () => {} });
const call = (name, id) => ({ id, function: { name, arguments: '{}' } });
const server = steps => async () => ({ message: steps.shift() });
const tick = () => new Promise(r => setTimeout(r, 0));
const evs = () => T.recent(100).reverse();
const types = () => evs().map(e => e.type);

describe('recommendation event', () => {
  beforeEach(() => T.clear());
  test('a proposed change emits recommendation BEFORE approval_requested, built from the real proposal', async () => {
    await runAgent({ userText: 'sales today', writesEnabled: true, approve: async () => false, callServer: server([{ tool_calls: [call('p1_write', 'c1')] }, { content: 'ok' }]) });
    const t = types();
    assert.ok(t.indexOf('recommendation') > -1);
    assert.ok(t.indexOf('recommendation') < t.indexOf('approval_requested'));
    const r = evs().find(e => e.type === 'recommendation');
    assert.equal(r.tool, 'p1_write'); assert.equal(r.metadata.kind, 'change_proposal');
    assert.equal(r.metadata.title, 'Change X'); assert.equal(r.metadata.requires_approval, true); assert.equal(r.metadata.reversible, true);
    assert.equal(r.entity_reference, evs().find(e => e.type === 'approval_requested').entity_reference, 'linked to the approval by id');
  });
  test('a plain answer or a read-only investigation emits NO recommendation', async () => {
    await runAgent({ userText: 'sales today', callServer: server([{ tool_calls: [call('p1_read', 'c1')] }, { content: 'You should restock panadol.' }]) });
    assert.equal(types().includes('recommendation'), false);
  });
  test('rejected approval: recommendation and rejection are both recorded, and the tool never runs', async () => {
    await runAgent({ userText: 'sales today', writesEnabled: true, approve: async () => false, callServer: server([{ tool_calls: [call('p1_write', 'c1')] }, { content: 'ok' }]) });
    assert.equal(evs().find(e => e.type === 'approval_resolved').status, 'rejected');
    assert.equal(evs().find(e => e.type === 'tool_end').status, 'rejected');
  });
});

describe('specialist_start / specialist_end', () => {
  beforeEach(() => T.clear());
  test('wrap exactly one real run, honestly labelled single_run, even for a multi-domain question', async () => {
    await runAgent({ userText: 'compare sales with stock', callServer: server([{ content: 'x' }]) });
    const s = evs().filter(e => e.type === 'specialist_start'), e = evs().filter(x => x.type === 'specialist_end');
    assert.equal(s.length, 1); assert.equal(e.length, 1);
    assert.equal(s[0].metadata.mode, 'single_run'); assert.ok(s[0].metadata.domains.length > 1);
    assert.equal(e[0].status, 'ok'); assert.ok(e[0].duration >= 0);
  });
  test('cancelled before the first model call: cancelled + specialist_end(cancelled), so the request is not left open', async () => {
    const ac = new AbortController(); ac.abort();
    await assert.rejects(runAgent({ userText: 'sales today', signal: ac.signal, callServer: server([{ content: 'x' }]) }));
    assert.ok(types().includes('cancelled'));
    assert.equal(evs().find(e => e.type === 'specialist_end').status, 'cancelled');
    assert.equal(T.liveState().open, null);
  });
  test('empty model response emits error and a failed specialist_end', async () => {
    await assert.rejects(runAgent({ userText: 'sales today', callServer: async () => ({}) }));
    assert.ok(types().includes('error'));
    assert.equal(evs().find(e => e.type === 'specialist_end').status, 'failed');
  });
  test('step limit emits error and a failed specialist_end', async () => {
    let n = 0;
    await runAgent({ userText: 'sales today', callServer: async () => ({ message: { tool_calls: [call('p1_read', 'c' + (++n))] } }) });
    assert.ok(evs().some(e => e.type === 'error' && e.metadata.message === 'step limit reached'));
    assert.equal(evs().find(e => e.type === 'specialist_end').status, 'failed');
  });
});

describe('audit event', () => {
  beforeEach(() => T.clear());
  const run = onAudit => runAgent({ userText: 'sales today', writesEnabled: true, approve: async () => true, onAudit,
    callServer: server([{ tool_calls: [call('p1_write', 'c1')] }, { content: 'ok' }]) });
  test('emitted only after the audit write resolves, with the real sink (cloud -> ok)', async () => {
    await run(() => Promise.resolve({ sink: 'cloud' })); await tick();
    const a = evs().find(e => e.type === 'audit');
    assert.equal(a.status, 'ok'); assert.equal(a.metadata.sink, 'cloud'); assert.equal(a.metadata.approval, 'approved'); assert.equal(a.tool, 'p1_write');
  });
  test('local_only and failed sinks are reported as such, never as ok', async () => {
    await run(() => Promise.resolve({ sink: 'local_only' })); await tick();
    assert.equal(evs().find(e => e.type === 'audit').status, 'local_only');
    T.clear();
    await run(() => Promise.resolve({ sink: 'failed', error: 'rls' })); await tick();
    const f = evs().find(e => e.type === 'audit'); assert.equal(f.status, 'failed'); assert.equal(f.metadata.error, 'rls');
    T.clear();
    await run(() => Promise.reject(new Error('boom'))); await tick();
    assert.equal(evs().find(e => e.type === 'audit').status, 'failed');
  });
  test('no audit event when the caller records nothing, and none for read tools', async () => {
    await run(() => undefined); await tick();
    assert.equal(types().includes('audit'), false);
    T.clear();
    await runAgent({ userText: 'sales today', onAudit: () => Promise.resolve({ sink: 'cloud' }), callServer: server([{ tool_calls: [call('p1_read', 'c1')] }, { content: 'ok' }]) }); await tick();
    assert.equal(types().includes('audit'), false);
  });
  test('a rejected change is still audited, with approval=rejected', async () => {
    await runAgent({ userText: 'sales today', writesEnabled: true, approve: async () => false, onAudit: () => Promise.resolve({ sink: 'cloud' }),
      callServer: server([{ tool_calls: [call('p1_write', 'c1')] }, { content: 'ok' }]) }); await tick();
    assert.equal(evs().find(e => e.type === 'audit').metadata.approval, 'rejected');
  });
});

describe('logToolCall reports what really happened', () => {
  const setup = sb => { globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } }; globalThis.window = { btGetSupabaseClient: sb }; };
  const entry = { tool: 'p1_write', risk: 'write', args: {}, ok: true, resultChars: 3 };
  test('cloud / local_only / failed', async () => {
    const { logToolCall } = await import('../../js/agent/core/audit.js');
    setup(() => ({ from: () => ({ insert: async () => ({ error: null }) }) }));
    assert.equal((await logToolCall(entry)).sink, 'cloud');
    setup(() => ({ from: () => ({ insert: async () => ({ error: { message: 'row violates RLS' } }) }) }));
    const bad = await logToolCall(entry); assert.equal(bad.sink, 'failed'); assert.match(bad.error, /RLS/);
    setup(() => ({ from: () => ({ insert: async () => { throw new Error('network'); } }) }));
    assert.equal((await logToolCall(entry)).sink, 'failed');
    setup(undefined);
    const lo = await logToolCall(entry); assert.equal(lo.sink, 'local_only'); assert.equal(lo.local, true);
  });
});

describe('persistence and redaction of the new events', () => {
  test('new types are stored slim; unknown/secret fields are dropped', () => {
    const r = Store.toStored({ event_id: 'e1', timestamp: 1, type: 'recommendation', source: 'agent', tool: 't', metadata: { kind: 'change_proposal', title: 'T', risk: 'write', requires_approval: true, reversible: true, args: { password: 'x' }, token: 'secret' } });
    assert.equal(r.metadata.kind, 'change_proposal'); assert.equal(r.metadata.args, undefined); assert.equal(JSON.stringify(r).includes('secret'), false);
    assert.equal(Store.toStored({ type: 'audit', timestamp: 1, metadata: { sink: 'cloud', ok: true, approval: 'approved', args: { a: 1 } } }).metadata.args, undefined);
    for (const t of ['specialist_start', 'specialist_end', 'undo']) assert.ok(Store.toStored({ type: t, timestamp: 1, metadata: {} }), t + ' must persist');
  });
  test('emit() redacts secret-looking keys in the new events', () => {
    T.clear();
    const e = T.emit({ type: 'recommendation', metadata: { title: 'x', api_key: 'sk-123', password: 'p' } });
    assert.equal(e.metadata.api_key, '[redacted]'); assert.equal(e.metadata.password, '[redacted]');
  });
});

describe('undo + labels', () => {
  test('describeEvent words each new event truthfully (failures are not softened)', () => {
    assert.match(M.describeEvent({ type: 'audit', status: 'failed', tool: 'x', metadata: { error: 'rls' } }), /NOT RECORDED/);
    assert.match(M.describeEvent({ type: 'audit', status: 'local_only', tool: 'x', metadata: {} }), /this device only/);
    assert.match(M.describeEvent({ type: 'undo', status: 'failed', tool: 'x', metadata: { label: 'L', error: 'gone' } }), /Undo failed/);
    assert.match(M.describeEvent({ type: 'specialist_start', metadata: { specialist: 'analyst', mode: 'single_run', domains: ['sales', 'inventory'] } }), /one run/);
    assert.match(M.describeEvent({ type: 'recommendation', tool: 't', metadata: { title: 'Change X', requires_approval: true, reversible: false } }), /not reversible/);
  });
  test('Action filter includes recommendation, audit and undo', () => {
    for (const t of ['recommendation', 'audit', 'undo']) assert.ok(M.eventMatches({ type: t }, 'actions'), t);
    for (const t of ['specialist_start', 'specialist_end']) assert.ok(M.eventMatches({ type: t }, 'agents'), t);
  });
});
