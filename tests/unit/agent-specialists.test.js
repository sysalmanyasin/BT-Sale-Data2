// Specialists + the auditor (cross-change review).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const reg = await import('../../js/agent/core/tool-registry.js');
const { pickSpecialist, SPECIALISTS } = await import('../../js/agent/core/specialists.js');
const auditor = await import('../../js/agent/core/auditor.js');
const { runAgent } = await import('../../js/agent/core/agent-client.js');

describe('specialists', () => {
  test('single domain → that specialist; two → Analyst with both; briefing → app tools only', () => {
    assert.equal(pickSpecialist('best sales days').id, 'sales');
    const a = pickSpecialist('compare sales with staff credit');
    assert.equal(a.id, 'analyst'); assert.deepEqual(a.domains.sort(), ['manager', 'sales']);
    assert.deepEqual(pickSpecialist('what needs my attention').domains, []);
  });
  test('vague follow-up keeps the previous specialist; a general previous one does not stick', () => {
    const prev = { ...SPECIALISTS.inventory, domains: ['inventory'] };
    assert.equal(pickSpecialist('and the next one?', prev).id, 'inventory');
    assert.equal(pickSpecialist('hello', { ...SPECIALISTS.general, domains: [] }).id, 'general');
  });
  test('first vague message gets every group, so no capability is ever removed', () => {
    assert.deepEqual(pickSpecialist('hmm').domains.sort(), ['inventory', 'manager', 'sales']);
  });
  test('returned specialists are copies (callers cannot mutate the shared table)', () => {
    const s = pickSpecialist('sales'); s.label = 'hacked';
    assert.equal(SPECIALISTS.sales.label, 'Sales');
  });
});

describe('auditor', () => {
  const T0 = 1_000_000_000_000, MIN = 60000;
  const rec = (tool, args, amount = 0, at = T0) => auditor.recordChange({ tool, args, preview: { amount } }, at);
  beforeEach(() => auditor.clearSession());

  test('first change is clean', () => {
    const r = auditor.reviewChange({ tool: 'add_x', args: { a: 1 }, preview: { amount: 100 } }, T0);
    assert.deepEqual(r, { warnings: [], strong: false });
  });
  test('burst: 3 changes in 10 minutes → warning + strong; older ones do not count', () => {
    rec('t1', { n: 1 }, 0, T0); rec('t2', { n: 2 }, 0, T0 + MIN); rec('t3', { n: 3 }, 0, T0 + 2 * MIN);
    const r = auditor.reviewChange({ tool: 't4', args: {}, preview: {} }, T0 + 3 * MIN);
    assert.equal(r.strong, true); assert.match(r.warnings[0], /3 changes/);
    assert.equal(auditor.reviewChange({ tool: 't4', args: {}, preview: {} }, T0 + 30 * MIN).strong, false);
  });
  test('repeat: the identical change within 30 minutes is flagged (argument order does not matter)', () => {
    rec('add_ledger_entry', { amount: 500, ledger_type: 'petty' }, 500, T0);
    const r = auditor.reviewChange({ tool: 'add_ledger_entry', args: { ledger_type: 'petty', amount: 500 }, preview: { amount: 500 } }, T0 + 5 * MIN);
    assert.equal(r.strong, true); assert.match(r.warnings.join(' '), /exact change was already made 5 min ago/);
    assert.equal(auditor.reviewChange({ tool: 'add_ledger_entry', args: { ledger_type: 'petty', amount: 501 }, preview: { amount: 501 } }, T0 + 5 * MIN).warnings.length, 0);
  });
  test('cumulative: rupees changed in the hour at/over Rs 200,000 → strong', () => {
    rec('a', { i: 1 }, 120000, T0); 
    const ok = auditor.reviewChange({ tool: 'b', args: {}, preview: { amount: 50000 } }, T0 + MIN);
    assert.equal(ok.strong, false);
    const bad = auditor.reviewChange({ tool: 'b', args: {}, preview: { amount: 90000 } }, T0 + MIN);
    assert.equal(bad.strong, true); assert.match(bad.warnings.join(' '), /Rs 210,000/);
  });
  test('clearSession (↺) resets the memory', () => {
    rec('a', { i: 1 }, 300000, T0); auditor.clearSession();
    assert.equal(auditor.reviewChange({ tool: 'a', args: { i: 1 }, preview: { amount: 1 } }, T0 + MIN).strong, false);
  });
});

describe('auditor wired into runTool / the agent loop', () => {
  beforeEach(() => {
    auditor.clearSession(); reg.clearTools();
    reg.registerTool({ name: 'add_thing', description: 'a', risk: 'write', domain: 'sales', parameters: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      preview: ({ n }) => ({ title: 'Add', lines: ['n=' + n], amount: 10 }), run: ({ n }) => ({ summary: 'ok ' + n }) });
  });
  test('review warnings are merged into the card and can force strong confirmation', async () => {
    let seen;
    await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async r => { seen = r.preview; return false; }, review: () => ({ warnings: ['Auditor: test'], strong: true }) });
    assert.equal(seen.strong, true); assert.deepEqual(seen.warnings, ['Auditor: test']);
  });
  test('a crashing auditor fails SAFE (strong confirmation), never open', async () => {
    let seen;
    await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async r => { seen = r.preview; return false; }, review: () => { throw new Error('boom'); } });
    assert.equal(seen.strong, true); assert.match(seen.warnings.join(' '), /could not run/);
  });
  test('onChanged fires only after a successful approved change', async () => {
    let n = 0;
    await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async () => false, onChanged: () => n++ });
    assert.equal(n, 0);
    await reg.runTool('add_thing', { n: 1 }, { writesEnabled: true, approve: async () => true, onChanged: () => n++ });
    assert.equal(n, 1);
  });
  test('in a real conversation: the 4th change inside 10 minutes carries the auditor warning', async () => {
    const cards = []; let call = 0;
    const callServer = async () => { call++; return call <= 4 ? { message: { tool_calls: [{ id: 'c' + call, type: 'function', function: { name: 'add_thing', arguments: JSON.stringify({ n: call }) } }] } } : { message: { content: 'done' } }; };
    await runAgent({ userText: 'add sales things', callServer, writesEnabled: true, approve: async r => { cards.push(r.preview); return true; } });
    assert.equal(cards.length, 4);
    assert.ok(!cards[0].warnings.some(w => /Auditor/.test(w)));
    assert.ok(cards[3].warnings.some(w => /Auditor: 3 changes/.test(w)));
    assert.equal(cards[3].strong, true);
  });
  test('the loop sends the specialist id to the server and returns the specialist', async () => {
    let ctx;
    const r = await runAgent({ userText: 'best sales days', callServer: async a => { ctx = a.context; return { message: { content: 'ok' } }; } });
    assert.equal(ctx.focus, 'sales'); assert.equal(r.specialist.id, 'sales');
  });
});
