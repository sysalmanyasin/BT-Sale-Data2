import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, clearTools, runTool } from '../../js/agent/core/tool-registry.js';
import { makeRecipe, rehydrate, loadPendingUndos, markUndone, newUndoKey } from '../../js/agent/core/undo-store.js';
import { summarizeUsage, summarizeAudit } from '../../js/agent/core/usage-stats.js';
import { runAgent } from '../../js/agent/core/agent-client.js';

let store;
beforeEach(() => {
  clearTools(); store = [];
  registerTool({ name: 'add_thing', description: 'w', domain: 'sales', risk: 'write', parameters: { type: 'object', properties: { v: { type: 'string' } } }, preview: () => ({ title: 't', lines: [] }),
    run: async a => { store.push(a.v); return { id: a.v }; },
    makeUndo: (args, out) => ({ label: 'Remove ' + out.id, fn: () => { store.splice(store.indexOf(out.id), 1); } }) });
});

describe('persistent undo', () => {
  test('runTool exposes the recipe inputs', async () => {
    const r = await runTool('add_thing', { v: 'x' }, { writesEnabled: true, approve: async () => true });
    assert.deepEqual(r.undoData, { args: { v: 'x' }, out: { id: 'x' } });
  });
  test('a stored recipe is rebuilt into a working undo after a "reload"', async () => {
    const r = await runTool('add_thing', { v: 'x' }, { writesEnabled: true, approve: async () => true });
    const recipe = JSON.parse(JSON.stringify(makeRecipe({ key: newUndoKey(), tool: 'add_thing', label: r.undo.label, ...r.undoData })));
    const h = rehydrate(recipe);
    assert.equal(h.label, 'Remove x');
    await h.fn();
    assert.deepEqual(store, []);
  });
  test('unknown tool, junk, or oversized recipes give nothing', () => {
    assert.equal(rehydrate({ tool: 'nope' }), null);
    assert.equal(rehydrate(null), null);
    assert.equal(makeRecipe({ key: 'k', tool: 'add_thing', args: {}, out: { big: 'x'.repeat(30000) } }), null);
  });
  test('runAgent puts the recipe on the audit entry of a change', async () => {
    const audits = []; let step = 0;
    await runAgent({ userText: 'sales add', writesEnabled: true, approve: async () => true, onAudit: e => audits.push(e),
      callServer: async () => (++step === 1 ? { message: { tool_calls: [{ id: 'c', function: { name: 'add_thing', arguments: '{"v":"y"}' } }] } } : { message: { content: 'ok' } }) });
    const a = audits.find(x => x.tool === 'add_thing');
    assert.equal(a.undo.tool, 'add_thing'); assert.deepEqual(a.undo.out, { id: 'y' }); assert.match(a.undo.key, /^u_/);
  });
  test('loadPendingUndos reads recent unreversed rows and skips unusable ones', async () => {
    const recipe = { key: 'k1', tool: 'add_thing', args: { v: 'z' }, out: { id: 'z' } };
    const sb = { from: () => { const q = { not: () => q, is: () => q, gte: () => q, order: () => q, limit: async () => ({ data: [{ undo: recipe, created_at: new Date().toISOString() }, { undo: { tool: 'gone' }, created_at: new Date().toISOString() }], error: null }) }; return { select: () => q }; } };
    const list = await loadPendingUndos(sb);
    assert.equal(list.length, 1); assert.equal(list[0].key, 'k1');
    assert.deepEqual(await loadPendingUndos(null), []);
  });
  test('markUndone stamps by key', async () => {
    let seen = null;
    const sb = { from: () => ({ update: v => ({ eq: (c, k) => ({ is: async () => { seen = { v, c, k }; return { error: null }; } }) }) }) };
    assert.equal(await markUndone(sb, 'k9'), true);
    assert.equal(seen.c, 'undo_key'); assert.equal(seen.k, 'k9'); assert.ok(seen.v.undone_at);
  });
});

describe('usage + audit summaries', () => {
  test('per-provider calls, failures, rate limits, latency', () => {
    const rows = [
      { kind: 'attempt', provider: 'groq', ok: true, status: 200, latency_ms: 400, created_at: '2026-10-05T10:00:00Z' },
      { kind: 'attempt', provider: 'groq', ok: false, status: 429, latency_ms: 100, error: 'groq 429', created_at: '2026-10-05T10:01:00Z' },
      { kind: 'attempt', provider: 'gemini', ok: true, status: 200, latency_ms: 800, created_at: '2026-10-05T10:02:00Z' },
      { kind: 'request', provider: 'gemini', ok: true, created_at: '2026-10-05T10:02:00Z' },
    ];
    const s = summarizeUsage(rows);
    assert.equal(s[0].provider, 'groq'); assert.equal(s[0].calls, 2); assert.equal(s[0].failed, 1); assert.equal(s[0].rateLimited, 1);
    assert.equal(s[0].avgLatencyMs, 250); assert.equal(s[1].calls, 1);
  });
  test('audit rows show approved / rejected / undone for changes', () => {
    const out = summarizeAudit([
      { tool: 'add_ledger_entry', risk: 'write', ok: true, args: { _approval: 'approved' }, created_at: 'a' },
      { tool: 'add_staff_note', risk: 'write', ok: false, args: { _approval: 'rejected' }, created_at: 'b' },
      { tool: 'add_staff_note', risk: 'write', ok: true, args: {}, undone_at: 'x', created_at: 'c' },
      { tool: 'get_daily_sales', risk: 'read', ok: true, args: {}, created_at: 'd' },
    ]);
    assert.deepEqual(out.map(x => x.status), ['approved', 'rejected', 'undone', 'done']);
  });
});
