// Agent core: tool registry validation/safety, the client tool loop, and
// the safe markdown renderer. No network, no Supabase.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const reg = await import('../../js/agent/core/tool-registry.js');
const { runAgent, MAX_STEPS } = await import('../../js/agent/core/agent-client.js');
const { renderMarkdown } = await import('../../js/agent/core/markdown-lite.js');

const state = { ran: 0, undone: 0 };
const tc = (name, args, id = 'c1') => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

beforeEach(() => {
  reg.clearTools();
  reg.registerTool({ name: 'echo', description: 'echo', risk: 'read',
    parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, n: { type: 'integer' } } },
    run: a => ({ echoed: a.text, n: a.n ?? null }) });
  reg.registerTool({ name: 'secret_read', description: 's', risk: 'read', sensitive: true, run: () => ({ ok: 1 }) });
  state.ran = 0; state.undone = 0;
  reg.registerTool({ name: 'critical_demo', description: 'd', risk: 'critical',
    preview: () => ({ title: 'Delete everything', lines: ['all of it'] }), run: () => { state.ran++; return { summary: 'deleted' }; },
    makeUndo: () => ({ label: 'restore', fn: () => { state.undone++; } }) });
  reg.registerTool({ name: 'drop_thing', description: 'd', risk: 'critical',
    preview: () => ({ title: 'Drop', lines: ['x'], confirmWord: 'DELETE' }), run: () => { state.ran++; return { summary: 'dropped' }; } });
  reg.registerTool({ name: 'add_thing', description: 'a', risk: 'write',
    parameters: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
    preview: ({ n }) => { if (n < 0) throw new Error('n must be positive'); return { title: 'Add thing', lines: ['n=' + n], warnings: n > 100 ? ['big'] : [] }; },
    run: ({ n }) => { state.ran++; return { summary: 'added ' + n }; },
    makeUndo: () => ({ label: 'remove thing', fn: () => { state.undone++; } }) });
  reg.registerTool({ name: 'boom', description: 'b', risk: 'read', run: () => { throw new Error('kaboom'); } });
  reg.registerTool({ name: 'big', description: 'b', risk: 'read', run: () => ({ blob: 'x'.repeat(20000) }) });
});

describe('tool registry', () => {
  test('rejects bad names, missing run, bad risk', () => {
    assert.throws(() => reg.registerTool({ name: 'bad name', description: 'x', run() {} }));
    assert.throws(() => reg.registerTool({ name: 'ok', description: 'x' }));
    assert.throws(() => reg.registerTool({ name: 'ok', description: 'x', run() {}, risk: 'nuclear' }));
  });
  test('schemas are OpenAI function format', () => {
    const s = reg.getToolSchemas().find(t => t.function.name === 'echo');
    assert.equal(s.type, 'function');
    assert.deepEqual(s.function.parameters.required, ['text']);
  });
  test('runs a read tool, coerces numbers, drops unknown args', async () => {
    const r = await reg.runTool('echo', { text: 'hi', n: '3', evil: 'x' });
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(r.text), { echoed: 'hi', n: 3 });
  });
  test('accepts JSON-string arguments (as models send them)', async () => {
    const r = await reg.runTool('echo', '{"text":"yo"}');
    assert.equal(JSON.parse(r.text).echoed, 'yo');
  });
  test('missing required arg and malformed JSON are reported, not thrown', async () => {
    assert.equal((await reg.runTool('echo', {})).ok, false);
    const bad = await reg.runTool('echo', '{not json');
    assert.equal(bad.ok, false);
    assert.match(bad.text, /valid JSON/);
  });
  test('change tools without preview() cannot be registered', () => {
    assert.throws(() => reg.registerTool({ name: 'x_write', description: 'x', risk: 'write', run() {} }), /preview/);
  });
  test('schemas hide change tools unless writes are unlocked', () => {
    assert.ok(!reg.getToolSchemas().some(t => t.function.name === 'critical_demo'));
    assert.ok(reg.getToolSchemas({ includeWrites: true }).some(t => t.function.name === 'add_thing'));
  });
  test('tool exceptions become error results; unknown tools are safe', async () => {
    const r = await reg.runTool('boom', {});
    assert.equal(r.ok, false); assert.match(r.text, /kaboom/);
    assert.equal((await reg.runTool('nope', {})).ok, false);
  });
  test('huge results are truncated with a hint', async () => {
    const r = await reg.runTool('big', {});
    assert.ok(r.text.length < 6300);
    assert.match(r.text, /truncated/);
  });
});

describe('change gating (enforced in code, not prompt)', () => {
  const ok = async () => true, no = async () => false;
  test('locked: change tool never runs, even with an approver', async () => {
    const r = await reg.runTool('add_thing', { n: 1 }, { writesEnabled: false, approve: ok });
    assert.equal(r.ok, false); assert.equal(r.error, 'writes_disabled'); assert.equal(state.ran, 0);
  });
  test('unlocked but no approval channel: never runs', async () => {
    const r = await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true });
    assert.equal(r.ok, false); assert.equal(state.ran, 0);
  });
  test('human rejects: run() is never called and the model is told not to retry', async () => {
    const r = await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: no });
    assert.equal(r.ok, false); assert.equal(r.rejected, true); assert.equal(state.ran, 0);
    assert.match(r.text, /did NOT approve/);
  });
  test('approve() that throws counts as a rejection', async () => {
    const r = await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async () => { throw new Error('ui died'); } });
    assert.equal(r.rejected, true); assert.equal(state.ran, 0);
  });
  test('approved: runs once, returns undo, reports done', async () => {
    let seen;
    const r = await reg.runTool('add_thing', { n: 5 }, { writesEnabled: true, approve: async req => { seen = req; return true; } });
    assert.equal(r.ok, true); assert.equal(state.ran, 1);
    assert.equal(JSON.parse(r.text).done, true); assert.equal(JSON.parse(r.text).can_undo, true);
    assert.equal(seen.preview.title, 'Add thing'); assert.equal(seen.risk, 'write');
    await r.undo.fn(); assert.equal(state.undone, 1);
  });
  test('invalid args are caught in preview before any card is shown', async () => {
    let asked = false;
    const r = await reg.runTool('add_thing', { n: -3 }, { writesEnabled: true, approve: async () => { asked = true; return true; } });
    assert.equal(r.ok, false); assert.equal(asked, false); assert.equal(state.ran, 0);
    assert.match(r.text, /positive/);
  });
  test('critical tools always require the strong confirmation flag', async () => {
    let seen;
    await reg.runTool('critical_demo', {}, { writesEnabled: true, approve: async req => { seen = req; return false; } });
    assert.equal(seen.preview.strong, true);
  });
});

describe('typed confirmation (deletes)', () => {
  const go = verdict => reg.runTool('drop_thing', {}, { writesEnabled: true, approve: async () => verdict });
  test('a bare approve (true / {approved:true}) is NOT enough', async () => {
    for (const v of [true, { approved: true }, { approved: true, typed: '' }, { approved: true, typed: 'yes' }, { approved: true, typed: 'DELET' }]) {
      const r = await go(v); assert.equal(r.rejected, true, JSON.stringify(v));
    }
    assert.equal(state.ran, 0);
  });
  test('the exact word, any case, with surrounding spaces, is accepted', async () => {
    assert.equal((await go({ approved: true, typed: 'delete' })).ok, true);
    assert.equal((await go({ approved: true, typed: '  DELETE ' })).ok, true);
    assert.equal(state.ran, 2);
  });
  test('typed word without approved:true is rejected; the card reports confirmWord', async () => {
    assert.equal((await go({ typed: 'DELETE' })).rejected, true);
    let seen; await reg.runTool('drop_thing', {}, { writesEnabled: true, approve: async r => { seen = r; return false; } });
    assert.equal(seen.preview.confirmWord, 'DELETE');
  });
  test('tools without confirmWord still accept {approved:true}', async () => {
    assert.equal((await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async () => ({ approved: true }) })).ok, true);
  });
});

describe('agent loop', () => {
  test('returns the answer directly when no tools are requested', async () => {
    const r = await runAgent({ userText: 'hello', callServer: async () => ({ message: { content: 'Hi there' } }) });
    assert.equal(r.text, 'Hi there');
    assert.equal(r.steps, 1);
  });

  test('executes tool calls, feeds results back, then answers', async () => {
    const seen = [];
    let call = 0;
    const callServer = async ({ messages }) => {
      seen.push(messages.map(m => m.role));
      return ++call === 1
        ? { message: { content: null, tool_calls: [tc('echo', { text: 'abc' })] } }
        : { message: { content: 'Done: ' + JSON.parse(messages.at(-1).content).echoed } };
    };
    const audits = [];
    const r = await runAgent({ userText: 'go', callServer, onAudit: a => audits.push(a) });
    assert.equal(r.text, 'Done: abc');
    assert.deepEqual(seen[1].slice(-3), ['user', 'assistant', 'tool']);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].tool, 'echo');
    assert.equal(audits[0].ok, true);
  });

  test('sensitive tool flips the request to sensitivity=high for later steps', async () => {
    const levels = []; let call = 0;
    const callServer = async ({ sensitivity }) => {
      levels.push(sensitivity);
      return ++call === 1 ? { message: { tool_calls: [tc('secret_read', {})] } } : { message: { content: 'ok' } };
    };
    const r = await runAgent({ userText: 'x', callServer });
    assert.deepEqual(levels, ['normal', 'high']);
    assert.equal(r.sensitive, true);
  });

  test('locked by default: change tools are not even offered, and a forced call is refused', async () => {
    let call = 0, toolMsg = null, offered = null;
    const callServer = async ({ messages, tools }) => {
      offered = tools.map(t => t.function.name);
      if (++call === 1) return { message: { tool_calls: [tc('critical_demo', {})] } };
      toolMsg = messages.at(-1); return { message: { content: 'Locked.' } };
    };
    await runAgent({ userText: 'wipe it', callServer });
    assert.ok(!offered.includes('critical_demo'));
    assert.match(toolMsg.content, /switched off/i); assert.equal(state.ran, 0);
  });

  test('unlocked: approval flows through the loop, undo is surfaced, audit records approval', async () => {
    let call = 0; const undos = [], audits = [];
    const callServer = async () => ++call === 1
      ? { message: { tool_calls: [tc('add_thing', { n: 7 })] } } : { message: { content: 'Added.' } };
    const r = await runAgent({ userText: 'add', callServer, writesEnabled: true, approve: async () => true, onUndoable: u => undos.push(u), onAudit: a => audits.push(a) });
    assert.equal(r.text, 'Added.'); assert.equal(state.ran, 1);
    assert.equal(undos.length, 1); assert.equal(undos[0].label, 'remove thing');
    assert.equal(audits[0].risk, 'write'); assert.equal(audits[0].args._approval, 'approved');
  });

  test('rejected change is audited as rejected and never runs', async () => {
    let call = 0; const audits = [];
    const callServer = async () => ++call === 1
      ? { message: { tool_calls: [tc('add_thing', { n: 7 })] } } : { message: { content: 'OK, not doing it.' } };
    await runAgent({ userText: 'add', callServer, writesEnabled: true, approve: async () => false, onAudit: a => audits.push(a) });
    assert.equal(state.ran, 0); assert.equal(audits[0].args._approval, 'rejected');
  });

  test('at most MAX_CHANGES_PER_TURN changes are even proposed in one request', async () => {
    let call = 0, proposals = 0;
    const callServer = async () => {
      call++;
      if (call <= 7) return { message: { tool_calls: [tc('add_thing', { n: call }, 'c' + call)] } };
      return { message: { content: 'done' } };
    };
    await runAgent({ userText: 'spam', callServer, writesEnabled: true, approve: async () => { proposals++; return true; } });
    assert.equal(proposals, 5);
  });

  test('identical repeated tool calls are cut off', async () => {
    let call = 0, last = null;
    const callServer = async ({ messages }) => {
      call++; last = messages.at(-1);
      return call <= 2 ? { message: { tool_calls: [tc('echo', { text: 'same' }, 'c' + call)] } } : { message: { content: 'fine' } };
    };
    await runAgent({ userText: 'x', callServer });
    assert.match(last.content, /already made this exact call/);
  });

  test('step cap stops runaway loops', async () => {
    let n = 0;
    const callServer = async () => ({ message: { tool_calls: [tc('echo', { text: 't' + (++n) }, 'c' + n)] } });
    const r = await runAgent({ userText: 'loop', callServer });
    assert.equal(r.steps, MAX_STEPS);
    assert.match(r.text, /too many steps/);
  });

  test('server errors propagate to the caller', async () => {
    await assert.rejects(runAgent({ userText: 'x', callServer: async () => { throw new Error('503'); } }), /503/);
  });
});

describe('markdown-lite', () => {
  test('escapes raw HTML from the model', () => {
    const h = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
    assert.ok(!h.includes('<img'));
    assert.match(h, /&lt;img/);
    assert.match(h, /<strong>bold<\/strong>/);
  });
  test('renders lists and tables', () => {
    assert.match(renderMarkdown('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
    const t = renderMarkdown('| M | Total |\n|---|---|\n| Sep | 100 |');
    assert.match(t, /<th>M<\/th>/); assert.match(t, /<td>100<\/td>/);
  });
});

describe('capResult keeps oversized results parseable', () => {
  test('long arrays are halved and the result is still valid JSON', async () => {
    const { capResult } = await import('../../js/agent/core/tool-registry.js');
    const rows = Array.from({ length: 80 }, (_, i) => ({ code: 'C' + i, name: 'Product number ' + i, note: 'y'.repeat(200) }));
    const r = capResult({ total: 80, groups: [{ supplier: 'S', items: rows }] }, 6000);
    assert.ok(r.truncated); assert.ok(r.text.length <= 6000);
    const parsed = JSON.parse(r.text);
    assert.match(parsed._truncated, /truncated/);
    assert.ok(parsed.groups[0].items.length >= 1 && parsed.groups[0].items.length < 80);
    assert.equal(parsed.total, 80);
  });
  test('small results are untouched; a huge string falls back to a JSON preview', async () => {
    const { capResult } = await import('../../js/agent/core/tool-registry.js');
    assert.deepEqual(capResult({ a: 1 }), { text: '{"a":1}', truncated: false });
    const r = capResult('z'.repeat(20000), 6000);
    assert.ok(r.text.length <= 6000); assert.ok(JSON.parse(r.text).preview);
  });
});
