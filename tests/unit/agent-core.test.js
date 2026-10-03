// Agent core: tool registry validation/safety, the client tool loop, and
// the safe markdown renderer. No network, no Supabase.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const reg = await import('../../js/agent/core/tool-registry.js');
const { runAgent, MAX_STEPS } = await import('../../js/agent/core/agent-client.js');
const { renderMarkdown } = await import('../../js/agent/core/markdown-lite.js');

const tc = (name, args, id = 'c1') => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

beforeEach(() => {
  reg.clearTools();
  reg.registerTool({ name: 'echo', description: 'echo', risk: 'read',
    parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, n: { type: 'integer' } } },
    run: a => ({ echoed: a.text, n: a.n ?? null }) });
  reg.registerTool({ name: 'secret_read', description: 's', risk: 'read', sensitive: true, run: () => ({ ok: 1 }) });
  reg.registerTool({ name: 'delete_all', description: 'd', risk: 'critical', run: () => { throw new Error('must never run'); } });
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
  test('write/critical tools are BLOCKED in phase 1 and never executed', async () => {
    const r = await reg.runTool('delete_all', {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'blocked');
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

  test('a write tool requested by the model is refused and the model is told', async () => {
    let call = 0, toolMsg = null;
    const callServer = async ({ messages }) => {
      if (++call === 1) return { message: { tool_calls: [tc('delete_all', {})] } };
      toolMsg = messages.at(-1); return { message: { content: 'I cannot do that yet.' } };
    };
    await runAgent({ userText: 'wipe it', callServer });
    assert.match(toolMsg.content, /not enabled/i);
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
