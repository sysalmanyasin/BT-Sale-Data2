import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
const server = await import('../../js/agent/core/server.js');
const { runAgent, AgentError } = await import('../../js/agent/core/agent-client.js');
const reg = await import('../../js/agent/core/tool-registry.js');
const { needsModelRoute, specialistForDomains } = await import('../../js/agent/core/specialists.js');

const enc = new TextEncoder();
const sse = (...events) => events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join('');
// Delivers the text in awkward slices so events are split across network chunks.
const streamRes = (text, slice = 7, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'text/event-stream; charset=utf-8' },
  body: new ReadableStream({ start(c) { for (let i = 0; i < text.length; i += slice) c.enqueue(enc.encode(text.slice(i, i + slice))); c.close(); } }),
});
const args = (extra = {}) => ({ messages: [{ role: 'user', content: 'hi' }], tools: [], context: {}, sensitivity: 'normal', ...extra });

beforeEach(() => { server.retry.delayMs = 0; window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }) } }); });

describe('streaming transport', () => {
  test('tokens arrive in order, split events are reassembled, done carries the message', async () => {
    const body = sse({ t: 'delta', c: 'Hel' }, { t: 'delta', c: 'lo' }, { t: 'done', message: { content: 'Hello' }, provider: 'groq', settings: { writes_killed: false } });
    globalThis.fetch = async (_u, init) => { assert.equal(JSON.parse(init.body).stream, true); return streamRes(body, 5); };
    const got = []; const r = await server.callServer(args({ onToken: t => got.push(t) }));
    assert.deepEqual(got, ['Hel', 'lo']); assert.equal(r.message.content, 'Hello'); assert.equal(r.provider, 'groq'); assert.equal(r.t, undefined);
  });
  test('without onToken the request is not streamed', async () => {
    globalThis.fetch = async (_u, init) => { assert.equal(JSON.parse(init.body).stream, undefined); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ message: { content: 'x' } }) }; };
    assert.equal((await server.callServer(args())).message.content, 'x');
  });
  test('a server that ignores streaming (plain JSON) still works', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ message: { content: 'plain' } }) });
    assert.equal((await server.callServer(args({ onToken: () => {} }))).message.content, 'plain');
  });
  test('reset events reach the caller', async () => {
    globalThis.fetch = async () => streamRes(sse({ t: 'delta', c: 'par' }, { t: 'reset' }, { t: 'delta', c: 'full' }, { t: 'done', message: { content: 'full' } }));
    const log = []; await server.callServer(args({ onToken: t => log.push(t), onReset: () => log.push('RESET') }));
    assert.deepEqual(log, ['par', 'RESET', 'full']);
  });
  test('an error event becomes an AgentError with its status, and 503 is retried once', async () => {
    let calls = 0;
    globalThis.fetch = async () => (++calls === 1 ? streamRes(sse({ t: 'error', status: 503, error: 'busy' })) : streamRes(sse({ t: 'done', message: { content: 'ok' } })));
    let resets = 0; const r = await server.callServer(args({ onToken: () => {}, onReset: () => resets++ }));
    assert.equal(r.message.content, 'ok'); assert.equal(calls, 2); assert.equal(resets, 1);
    globalThis.fetch = async () => streamRes(sse({ t: 'error', status: 403, error: 'no' }));
    await assert.rejects(server.callServer(args({ onToken: () => {} })), e => e instanceof AgentError && e.status === 403);
  });
  test('a stream that ends without done is reported as a lost connection', async () => {
    globalThis.fetch = async () => streamRes(sse({ t: 'delta', c: 'x' }));
    await assert.rejects(server.callServer(args({ onToken: () => {} })), /Connection lost/);
  });
  test('callAction posts the action and returns JSON; HTTP errors map to AgentError', async () => {
    globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); assert.equal(b.action, 'route'); return { ok: true, status: 200, json: async () => ({ domains: ['sales'] }) }; };
    assert.deepEqual((await server.callAction('route', { text: 'hi' })).domains, ['sales']);
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: 'Slow down' }) });
    await assert.rejects(server.callAction('search', { query: 'x' }), /Slow down/);
  });
});

describe('agent loop: streaming events', () => {
  beforeEach(() => { reg.clearTools(); reg.registerTool({ name: 'read_x', description: 'r', domain: 'sales', run: async () => ({ v: 1 }) }); });
  test('tokens are forwarded; narration before a tool call is reset', async () => {
    const ev = []; let step = 0;
    const r = await runAgent({ userText: 'sales today', stream: true, onEvent: e => { if (e.type === 'token' || e.type === 'reset') ev.push(e.type === 'token' ? e.text : 'RESET'); },
      callServer: async ({ onToken }) => {
        step++;
        if (step === 1) { onToken('Let me check'); return { message: { content: 'Let me check', tool_calls: [{ id: 'c', function: { name: 'read_x', arguments: '{}' } }] } }; }
        onToken('Done.'); return { message: { content: 'Done.' } };
      } });
    assert.deepEqual(ev, ['Let me check', 'RESET', 'Done.']); assert.equal(r.text, 'Done.');
  });
  test('without stream:true no token callback is passed to the transport', async () => {
    let got; await runAgent({ userText: 'sales', callServer: async a => { got = a; return { message: { content: 'ok' } }; } });
    assert.equal(got.onToken, undefined);
  });
});

describe('model-assisted routing', () => {
  const ask = (userText, extra = {}) => runAgent({ userText, callServer: async a => { ask.tools = a.tools.map(t => t.function.name); ask.focus = a.context.focus; return { message: { content: 'ok' } }; }, ...extra });
  beforeEach(() => { reg.clearTools(); for (const d of ['sales', 'inventory', 'billing']) reg.registerTool({ name: 'read_' + d, description: d, domain: d, run: async () => ({}) }); });

  test('needsModelRoute only for clue-less messages', () => {
    assert.equal(needsModelRoute('what is going on with my shop lately'), true);
    assert.equal(needsModelRoute('how much stock do we have'), false);
    assert.equal(needsModelRoute('ok'), false);
    assert.equal(needsModelRoute('and what about last week', { id: 'sales', domains: ['sales'] }), false);
  });
  test('the model choice picks the specialist and its tools', async () => {
    let called = 0;
    await ask('anything unusual happening around the counter', { routeServer: async () => { called++; return ['billing']; } });
    assert.equal(called, 1); assert.equal(ask.focus, 'billing'); assert.deepEqual(ask.tools, ['read_billing']);
  });
  test('not called when keywords already decide', async () => {
    let called = 0; await ask('sales today', { routeServer: async () => { called++; return ['billing']; } });
    assert.equal(called, 0); assert.equal(ask.focus, 'sales');
  });
  test('invalid domains, errors and timeouts fall back to the keyword result', async () => {
    await ask('tell me something interesting about the shop', { routeServer: async () => ['hacking', 'sales_secret'] });
    assert.equal(ask.focus, 'general');
    await ask('tell me something interesting about the shop', { routeServer: async () => { throw new Error('down'); } });
    assert.equal(ask.focus, 'general');
    assert.equal(specialistForDomains(['sales', 'inventory', 'billing']).domains.length, 2);
    assert.equal(specialistForDomains(['x']), null);
  });
});

describe('advisory model review', () => {
  let shown;
  beforeEach(async () => {
    (await import('../../js/agent/core/auditor.js')).clearSession(); // the auditor's repeat/burst rules are real; keep tests independent
    reg.clearTools(); shown = null;
    reg.registerTool({ name: 'add_big', description: 'w', domain: 'sales', risk: 'write', parameters: { type: 'object', properties: { amount: { type: 'number' } } },
      preview: a => ({ title: 'Add', lines: ['Rs ' + a.amount], amount: a.amount }), run: async () => ({ saved: true }) });
  });
  const go = (amount, extra) => { let step = 0; return runAgent({ userText: 'sales add', writesEnabled: true, approve: async r => { shown = r.preview; return true; },
    callServer: async () => (++step === 1 ? { message: { tool_calls: [{ id: 'c', function: { name: 'add_big', arguments: JSON.stringify({ amount }) } }] } } : { message: { content: 'ok' } }), ...extra }); };

  test('a large change gets the reviewer\'s concern as an extra warning; high severity forces the strong confirm', async () => {
    let seen; await go(50000, { reviewServer: async p => { seen = p; return { concern: 'Amount has an extra zero?', severity: 'high' }; } });
    assert.ok(shown.warnings.some(w => /AI reviewer: Amount has an extra zero/.test(w))); assert.equal(shown.strong, true);
    assert.equal(seen.tool, 'add_big'); assert.equal(seen.preview.amount, 50000);
  });
  test('low severity only adds the warning', async () => {
    await go(50000, { reviewServer: async () => ({ concern: 'Slightly unusual', severity: 'low' }) });
    assert.ok(shown.warnings.some(w => /Slightly unusual/.test(w))); assert.ok(!shown.strong);
  });
  test('small changes are never sent to the reviewer', async () => {
    let called = 0; await go(500, { reviewServer: async () => { called++; return { concern: 'x' }; } });
    assert.equal(called, 0); assert.equal(shown.warnings.length, 0);
  });
  test('a failing or silent reviewer changes nothing and never blocks the card', async () => {
    await go(50000, { reviewServer: async () => { throw new Error('down'); } });
    assert.ok(shown && !shown.warnings.some(w => /AI reviewer/.test(w)));
    await go(50000, { reviewServer: async () => ({ concern: '', severity: 'low' }) });
    assert.ok(!shown.warnings.some(w => /AI reviewer/.test(w)));
  });
});

describe('regression: the preview keeps its rupee amount', () => {
  test('the reviewer / auditor receive preview.amount (it used to be dropped, disabling the hourly-total rule)', async () => {
    reg.clearTools();
    reg.registerTool({ name: 'add_amt', description: 'w', domain: 'sales', risk: 'write', parameters: { type: 'object', properties: { n: { type: 'number' } } },
      preview: a => ({ title: 't', lines: [], amount: a.n }), run: async () => ({}) });
    let got; await reg.runTool('add_amt', { n: 123456 }, { writesEnabled: true, approve: async () => true, review: async p => { got = p.preview.amount; return {}; } });
    assert.equal(got, 123456);
  });
  test('cumulative changes over Rs 200,000 now force the strong confirmation', async () => {
    const { reviewChange, recordChange, clearSession } = await import('../../js/agent/core/auditor.js');
    clearSession();
    reg.clearTools();
    reg.registerTool({ name: 'add_amt', description: 'w', domain: 'sales', risk: 'write', parameters: { type: 'object', properties: { n: { type: 'number' } } },
      preview: a => ({ title: 't', lines: [], amount: a.n }), run: async () => ({}) });
    let strong = []; const opts = { writesEnabled: true, review: reviewChange, onChanged: recordChange, approve: async r => { strong.push(r.preview.strong); return true; } };
    await reg.runTool('add_amt', { n: 150000 }, opts);
    await reg.runTool('add_amt', { n: 90000 }, opts);
    assert.deepEqual(strong, [false, true]); clearSession();
  });
});
