// Token diet + resilience: tool routing, history compaction, client retry,
// and the year filter for top sales days.
import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
const reg = await import('../../js/agent/core/tool-registry.js');
const { selectDomains, ALL_DOMAINS } = await import('../../js/agent/core/router.js');
const { runAgent, compactHistory } = await import('../../js/agent/core/agent-client.js');
await import('../../js/agent/tools/app.js');
await import('../../js/agent/tools/sales.js');
await import('../../js/agent/tools/manager.js');
await import('../../js/agent/tools/inventory.js');
await import('../../js/agent/tools/writes.js');
await import('../../js/agent/tools/credit.js');
await import('../../js/agent/tools/deletes.js');
await import('../../js/agent/tools/briefing.js');
const server = await import('../../js/agent/core/server.js');

const names = o => reg.getToolSchemas(o).map(t => t.function.name);

describe('router', () => {
  test('picks groups from keywords', () => {
    assert.deepEqual(selectDomains('Best 3 days in 2026'), ['sales']);
    assert.ok(selectDomains('What is low on stock?').includes('inventory'));
    assert.ok(selectDomains('Add Jazz cash received 10 rupees').includes('manager'));
    assert.ok(selectDomains('How much does Ali owe?').includes('manager'));
  });
  test('vague follow-up reuses the previous groups; first vague message gets everything', () => {
    assert.deepEqual(selectDomains('ok list them', ['sales']), ['sales']);
    assert.deepEqual(selectDomains('hello'), ALL_DOMAINS);
  });
  test('routed tool list is much smaller than the full list, always keeps app tools', () => {
    const all = names({ includeWrites: true });
    const sales = names({ includeWrites: true, domains: ['sales'] });
    assert.ok(sales.length < all.length * 0.6, sales.length + ' vs ' + all.length);
    for (const t of ['get_app_context', 'navigate_to', 'daily_briefing']) assert.ok(sales.includes(t), t);
    assert.ok(sales.includes('get_sales_summary') && !sales.includes('search_inventory'));
  });
  test('every tool belongs to a known group (nothing becomes unreachable)', () => {
    for (const t of reg.listTools()) assert.ok(['app', ...ALL_DOMAINS].includes(t.domain), t.name + ' → ' + t.domain);
  });
  test('the loop sends only the routed tools and reports the domains', async () => {
    let offered;
    const r = await runAgent({ userText: 'best sales days', callServer: async ({ tools }) => { offered = tools.map(t => t.function.name); return { message: { content: 'ok' } }; } });
    assert.ok(!offered.includes('search_inventory') && offered.includes('top_sales_days'));
    assert.deepEqual(r.domains, ['sales']);
  });
});

describe('history compaction', () => {
  test('drops tool calls/results of finished turns, keeps the conversation text', async () => {
    let call = 0;
    reg.registerTool({ name: 'zz_probe', description: 'p', domain: 'sales', run: () => ({ big: 'x'.repeat(3000) }) });
    const callServer = async () => ++call === 1
      ? { message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'zz_probe', arguments: '{}' } }] } }
      : { message: { content: 'Here you go.' } };
    const r = await runAgent({ userText: 'sales probe', callServer });
    assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(r.messages[1].content, 'Here you go.');
    assert.ok(JSON.stringify(r.messages).length < 200);
  });
  test('compactHistory ignores tool messages and empty assistants', () => {
    const out = compactHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: null, tool_calls: [{}] }, { role: 'tool', content: 'x' }, { role: 'assistant', content: 'b' }, { role: 'assistant', content: '  ' }]);
    assert.deepEqual(out.map(m => m.content), ['a', 'b']);
  });
});

describe('client retry on busy providers', () => {
  let calls;
  beforeEach(() => {
    calls = 0; server.retry.delayMs = 0;
    window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }) } });
  });
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  test('retries once after a 503 and succeeds', async () => {
    globalThis.fetch = async () => (++calls === 1 ? reply(503, { error: 'busy' }) : reply(200, { message: { content: 'hi' } }));
    const r = await server.callServer({ messages: [], tools: [], context: {}, sensitivity: 'normal' });
    assert.equal(r.message.content, 'hi'); assert.equal(calls, 2);
  });
  test('gives up after one retry', async () => {
    globalThis.fetch = async () => { calls++; return reply(503, { error: 'busy' }); };
    await assert.rejects(server.callServer({ messages: [], tools: [], context: {}, sensitivity: 'normal' }), /busy/);
    assert.equal(calls, 2);
  });
  test('does not retry auth errors or the daily limit', async () => {
    globalThis.fetch = async () => { calls++; return reply(403, { error: 'no' }); };
    await assert.rejects(server.callServer({ messages: [], tools: [], context: {} }));
    assert.equal(calls, 1);
    calls = 0; globalThis.fetch = async () => { calls++; return reply(429, { error: 'Daily AI request limit reached.' }); };
    await assert.rejects(server.callServer({ messages: [], tools: [], context: {} }));
    assert.equal(calls, 1);
  });
});

describe('top_sales_days by year', () => {
  before(() => {
    const d = (date, total) => ({ Date: date, Month_Year: 'X', TOTAL: String(total) });
    cfg.DAILY.push(d('11/Jan/2022', 932685), d('09/Feb/2022', 927901), d('03/Mar/2022', 901000), d('15/Mar/2022', 100), d('03/Aug/2026', 1003047), d('01/Oct/2026', 648239));
  });
  const run = async a => JSON.parse((await reg.runTool('top_sales_days', a)).text);
  test('returns the top days of that year only', async () => {
    const r = await run({ year: '2022', count: 3 });
    assert.deepEqual(r.days.map(x => x.date), ['11/Jan/2022', '09/Feb/2022', '03/Mar/2022']);
    assert.equal(r.scope, '2022');
  });
  test('lowest order and bad / empty years', async () => {
    assert.equal((await run({ year: '2022', order: 'lowest', count: 1 })).days[0].total_sale, 100);
    assert.match((await run({ year: '22' })).error, /4 digits/);
    assert.match((await run({ year: '1999' })).error, /No daily sales data/);
  });
  test('2026 returns every 2026 day it has, not other years', async () => {
    const r = await run({ year: '2026', count: 5 });
    assert.ok(r.days.every(x => x.date.endsWith('/2026')));
    assert.equal(r.days[0].total_sale, 1003047);
  });
});
