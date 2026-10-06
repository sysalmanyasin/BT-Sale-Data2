// Server-side kill switch: fails safe, and stops change tools mid-conversation.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getKillState, setKillState } from '../../js/agent/core/kill-switch.js';
import { runAgent } from '../../js/agent/core/agent-client.js';
import { registerTool, clearTools } from '../../js/agent/core/tool-registry.js';

const fakeSb = ({ row, error = null, updated = [{ value: true }] } = {}) => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row ?? null, error }) }) }),
    update: () => ({ eq: () => ({ select: async () => ({ data: updated, error }) }) }),
  }),
});

describe('kill switch state', () => {
  test('false means writes allowed; anything else means killed', async () => {
    assert.deepEqual(await getKillState(fakeSb({ row: { value: false } })), { killed: false, known: true });
    assert.equal((await getKillState(fakeSb({ row: { value: true } }))).killed, true);
    assert.equal((await getKillState(fakeSb({ row: { value: 'false' } }))).killed, true);
  });
  test('fails safe: no client, error or missing row → killed', async () => {
    assert.equal((await getKillState(null)).killed, true);
    assert.equal((await getKillState(fakeSb({ error: { message: 'x' } }))).killed, true);
    assert.equal((await getKillState(fakeSb({ row: null }))).killed, true);
  });
  test('setKillState reports RLS refusals (no row updated)', async () => {
    assert.equal((await setKillState(fakeSb({ updated: [] }), true)).ok, false);
    assert.equal((await setKillState(fakeSb(), true)).killed, true);
  });
});

describe('runAgent honours the kill switch', () => {
  beforeEach(() => {
    clearTools();
    registerTool({ name: 'read_x', description: 'r', domain: 'sales', run: async () => ({ v: 1 }) });
    registerTool({ name: 'add_x', description: 'w', domain: 'sales', risk: 'write', preview: () => ({ title: 't', lines: [] }), run: async () => ({ saved: true }) });
  });
  const call = (name) => ({ id: 'c1', function: { name, arguments: '{}' } });

  test('killed up-front: change tools are not offered and cannot run', async () => {
    let offered = [];
    const r = await runAgent({
      userText: 'sales add x', writesEnabled: true, writesKilled: true, approve: async () => true,
      callServer: async ({ tools }) => { offered = tools.map(t => t.function.name); return { message: { content: 'ok' } }; },
    });
    assert.deepEqual(offered, ['read_x']);
    assert.equal(r.text, 'ok');
  });
  test('server flips the switch mid-turn: the pending change is refused', async () => {
    let step = 0, ran = false, toolsSecond = null;
    clearTools();
    registerTool({ name: 'add_x', description: 'w', domain: 'sales', risk: 'write', preview: () => ({ title: 't', lines: [] }), run: async () => { ran = true; return {}; } });
    const events = [];
    await runAgent({
      userText: 'sales add x', writesEnabled: true, approve: async () => true, onEvent: e => events.push(e.type),
      callServer: async ({ tools }) => {
        step++;
        if (step === 1) return { message: { tool_calls: [call('add_x')] }, settings: { writes_killed: true } };
        toolsSecond = tools; return { message: { content: 'done' } };
      },
    });
    assert.equal(ran, false);
    assert.ok(events.includes('writes_killed'));
    assert.equal(toolsSecond.length, 0);
  });
});
