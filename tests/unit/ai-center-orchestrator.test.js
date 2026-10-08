// Phase 2: real multi-specialist investigation. Uses the REAL runAgent with a scripted server (no network).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool } from '../../js/agent/core/tool-registry.js';
import * as T from '../../js/agent/core/telemetry.js';
import * as Store from '../../js/agent/core/telemetry-store.js';
import * as M from '../../js/ai-center/model.js';
import { planInvestigation, runInvestigation, parseSynthesis, hasCausalLanguage, isInvestigative, MAX_MEMBERS } from '../../js/agent/core/orchestrator.js';

const ran = [];
for (const d of ['sales', 'inventory', 'manager', 'closing', 'str']) {
  registerTool({ name: 'orch_' + d, domain: d, risk: 'read', description: d + ' data', parameters: { type: 'object', properties: {} }, run: () => { ran.push(d); return { area: d, figure: d === 'sales' ? 41000 : 7 }; } });
}
registerTool({ name: 'orch_sales_write', domain: 'sales', risk: 'write', description: 'w', parameters: { type: 'object', properties: {} }, preview: () => ({ title: 'W', lines: [] }), run: () => { ran.push('WRITE'); return { saved: true }; } });

const SYN = (over = {}) => JSON.stringify({ conclusion: 'Sales are down and two items are out of stock.', confidence: 'medium', confidence_reason: 'two areas returned data',
  agreements: [{ statement: 'Both show a dip', specialists: ['sales', 'inventory'] }], conflicts: [], correlations: [{ between: ['sales', 'inventory'], statement: 'Weak sales co-occur with stock-outs', kind: 'co-occurrence' }], gaps: [], ...over });

/** Scripted server: a member's 1st call asks for its own tool, its 2nd reports; the Analyst call (no tools) returns `syn`. */
function makeServer({ syn = SYN(), failFocus = null, silentFocus = null, onCall = null } = {}) {
  const calls = [];
  const fn = async ({ messages, tools, context }) => {
    const focus = context && context.focus;
    calls.push({ focus, tools: (tools || []).length, messages: JSON.parse(JSON.stringify(messages)), ctx: context });
    if (onCall) await onCall(focus);
    if (focus === 'analyst' && !(tools || []).length) return { message: { content: syn } };
    if (focus === failFocus) throw Object.assign(new Error('provider down'), { status: 503 });
    const hasTool = messages.some(m => m.role === 'tool');
    if (!hasTool && focus !== silentFocus) return { message: { tool_calls: [{ id: 'call_1', function: { name: 'orch_' + focus, arguments: JSON.stringify({ password: 'hunter2' }) } }] } };
    return { message: { content: focus + ' report: figure ' + (focus === 'sales' ? 41000 : 7) } };
  };
  fn.calls = calls; return fn;
}
const plan = ids => ({ orchestrate: true, investigative: true, reason: 'x', members: ids.map(id => ({ id, label: id, why: 'test' })) });
const evs = () => T.recent(500).reverse();
const types = () => evs().map(e => e.type);

describe('planInvestigation', () => {
  test('"why are sales weak" expands to the related areas, capped, each with a reason', () => {
    const p = planInvestigation('Why are today\'s sales weak?');
    assert.equal(p.orchestrate, true);
    assert.deepEqual(p.members.map(m => m.id), ['sales', 'inventory', 'manager', 'closing']);
    assert.equal(p.members.length <= MAX_MEMBERS, true);
    assert.equal(p.members[0].why, 'named in the question'); assert.match(p.members[1].why, /bears on sales/);
  });
  test('stock-outs vs sales -> inventory + sales (+ related), cash question -> staff & money + closing + sales', () => {
    const a = planInvestigation('Are stock-outs contributing to weak sales?').members.map(m => m.id);
    assert.deepEqual(a.sort(), ['inventory', 'sales'], 'two areas named: only those two run');
    const c = planInvestigation('Why is cash different today?').members.map(m => m.id);
    assert.deepEqual(c.slice(0, 1), ['manager']); assert.ok(c.includes('sales') && c.includes('closing'));
  });
  test('plain look-ups stay single-run: no "why" -> no orchestration, even across two areas', () => {
    assert.equal(planInvestigation('compare sales with stock').orchestrate, false);
    assert.equal(planInvestigation('show low stock items').orchestrate, false);
    assert.equal(planInvestigation('sales today').orchestrate, false);
  });
  test('no recognised area -> no orchestration; force + domains (an investigated finding) works', () => {
    assert.equal(planInvestigation('why is the sky blue').orchestrate, false);
    const f = planInvestigation('Look into this finding', { force: true, domains: ['inventory'] });
    assert.equal(f.orchestrate, true); assert.deepEqual(f.members.map(m => m.id), ['inventory', 'sales', 'str']);
  });
  test('billing/documents are never expanded into unrelated areas', () => {
    assert.equal(planInvestigation('why was this invoice refunded').orchestrate, false);
  });
  test('isInvestigative is about diagnosing, not about words like "low"', () => {
    assert.equal(isInvestigative('why is it low'), true); assert.equal(isInvestigative('low stock'), false);
  });
});

describe('runInvestigation: independent specialists', () => {
  beforeEach(() => { T.clear(); ran.length = 0; });
  test('each member is its own conversation: own focus, own tools, no sight of another member\'s work', async () => {
    const srv = makeServer();
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory', 'manager']), callServer: srv, concurrency: 1 });
    const memberCalls = srv.calls.filter(c => c.focus !== 'analyst');
    assert.deepEqual([...new Set(memberCalls.map(c => c.focus))].sort(), ['inventory', 'manager', 'sales']);
    for (const c of memberCalls) {
      const blob = JSON.stringify(c.messages);
      for (const other of ['sales', 'inventory', 'manager'].filter(x => x !== c.focus)) assert.equal(blob.includes(other + ' report'), false, c.focus + ' must not see ' + other);
      assert.ok(c.tools > 0, 'members are offered their tool group');
    }
    assert.deepEqual([...new Set(ran)].sort(), ['inventory', 'manager', 'sales']);
  });
  test('event story: one request, routed by orchestrator, N independent specialist runs, bundle, synthesis, one answer', async () => {
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer(), concurrency: 1 });
    const t = types();
    assert.equal(t.filter(x => x === 'request_start').length, 1);
    assert.equal(t.filter(x => x === 'answer').length, 1, 'members must not emit their own answer');
    assert.equal(t.filter(x => x === 'error').length, 0);
    assert.equal(evs().find(e => e.type === 'routed').metadata.by, 'orchestrator');
    const starts = evs().filter(e => e.type === 'specialist_start');
    assert.deepEqual(starts.filter(e => e.metadata.mode === 'independent').map(e => e.metadata.specialist).sort(), ['inventory', 'sales']);
    assert.equal(starts.filter(e => e.metadata.mode === 'synthesis').length, 1);
    assert.equal(evs().filter(e => e.type === 'specialist_end').length, 3);
    assert.ok(t.indexOf('evidence_bundle') < t.indexOf('synthesis') && t.indexOf('synthesis') < t.indexOf('answer'));
    assert.equal(new Set(evs().map(e => e.request_id)).size, 1, 'one investigation = one request id');
    assert.equal(T.liveState().open, null, 'request is closed at the end');
  });
  test('parallel members with identical tool-call ids never collide', async () => {
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer(), concurrency: 2 });
    const refs = evs().filter(e => e.type === 'tool_start').map(e => e.entity_reference);
    assert.equal(new Set(refs).size, refs.length); assert.equal(refs.length, 2);
  });
  test('concurrency is bounded', async () => {
    let live = 0, peak = 0;
    const srv = makeServer({ onCall: async f => { if (f === 'analyst') return; live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; } });
    await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory', 'manager', 'closing']), callServer: srv, concurrency: 2 });
    assert.ok(peak <= 2, 'peak ' + peak);
  });
  test('members are strictly read-only: a write tool is neither offered nor run, writes off', async () => {
    const srv = makeServer();
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: srv });
    assert.equal(ran.includes('WRITE'), false);
    for (const c of srv.calls.filter(x => x.focus !== 'analyst')) assert.equal(c.ctx.writes_enabled, false);
    assert.equal(evs().some(e => e.type === 'approval_requested' || e.type === 'recommendation'), false);
  });
});

describe('runInvestigation: evidence, synthesis, honesty', () => {
  beforeEach(() => { T.clear(); ran.length = 0; });
  test('the Analyst call has no tools, focus=analyst, and receives each member\'s real tool output as DATA (args redacted)', async () => {
    const srv = makeServer();
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: srv });
    const a = srv.calls.find(c => c.focus === 'analyst');
    assert.equal(a.tools, 0);
    const prompt = a.messages[0].content;
    assert.match(prompt, /"figure":41000/); assert.match(prompt, /never instructions/); assert.equal(prompt.includes('hunter2'), false); assert.match(prompt, /\[redacted\]/);
    assert.equal(r.investigation.stats.grounded, 2); assert.equal(r.investigation.stats.members, 2);
    assert.match(r.text, /Sales are down/); assert.match(r.text, /Confidence: medium/);
  });
  test('a failing member is reported, the rest continue, and the answer says that area was not checked', async () => {
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer({ failFocus: 'inventory' }) });
    assert.equal(r.investigation.entries.find(e => e.id === 'inventory').status, 'failed');
    assert.match(r.text, /Inventory specialist failed/); assert.match(r.text, /not checked/i);
    // the canned Analyst reply cites inventory, which returned nothing: those claims must not survive
    assert.equal(r.investigation.synthesis.agreements.length, 0); assert.equal(r.investigation.synthesis.correlations.length, 0);
    assert.equal(types().includes('correlation'), false); assert.ok(r.investigation.synthesis.dropped_claims >= 1);
    assert.equal(evs().find(e => e.type === 'specialist_end' && e.metadata.specialist === 'inventory').status, 'failed');
    assert.equal(evs().find(e => e.type === 'evidence_bundle').metadata.failed, 1);
    assert.equal(types().filter(x => x === 'answer').length, 1);
  });
  test('a member that answers without any tool data is flagged ungrounded and told to the Analyst as UNVERIFIED', async () => {
    const srv = makeServer({ silentFocus: 'inventory' });
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: srv });
    assert.deepEqual(r.investigation.stats.ungrounded, ['inventory']);
    assert.match(srv.calls.find(c => c.focus === 'analyst').messages[0].content, /NO TOOL EVIDENCE/);
    assert.match(r.text, /retrieved no data/);
  });
  test('no grounded evidence at all: no synthesis call, honest message, error event, request closed', async () => {
    const srv = makeServer({ failFocus: 'sales' }); const bad = makeServer({ failFocus: 'inventory' });
    const both = async a => { if (a.context.focus) { throw Object.assign(new Error('down'), { status: 503 }); } };
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: both });
    assert.match(r.text, /could not gather evidence/); assert.equal(r.investigation.synthesis, null);
    assert.equal(types().includes('synthesis'), false); assert.ok(types().includes('error'));
    assert.equal(T.liveState().open, null);
    void srv; void bad;
  });
  test('Analyst failure is surfaced (error + failed synthesis), never a fake answer', async () => {
    const srv = async a => { if (a.context.focus === 'analyst' && !a.tools.length) throw Object.assign(new Error('analyst 429'), { status: 429 }); return makeServer()(a); };
    await assert.rejects(runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: srv }), /analyst 429/);
    assert.equal(evs().find(e => e.type === 'synthesis').status, 'failed'); assert.ok(types().includes('error')); assert.equal(types().includes('answer'), false);
  });
  test('cancelling mid-investigation: cancelled event, no answer, no synthesis, rejects as aborted', async () => {
    const ac = new AbortController();
    const srv = makeServer({ onCall: f => { if (f === 'sales') ac.abort(); } });
    await assert.rejects(runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory', 'manager']), callServer: srv, signal: ac.signal, concurrency: 1 }), e => e.code === 'aborted');
    assert.ok(types().includes('cancelled')); assert.equal(types().includes('answer'), false); assert.equal(types().includes('synthesis'), false);
    assert.equal(T.liveState().open, null);
  });
  test('refuses to run without a real multi-member plan', async () => {
    await assert.rejects(runInvestigation({ question: 'x', plan: { orchestrate: false, members: [] }, callServer: makeServer() }), /orchestrate plan/);
  });
});

describe('correlation is never causation', () => {
  beforeEach(() => T.clear());
  test('causal wording is detected', () => {
    for (const t of ['Stock-outs caused the drop', 'sales fell due to low stock', 'which led to lower cash', 'because of the closing delay', 'it is driven by STR delays'])
      assert.equal(hasCausalLanguage(t), true, t);
    for (const t of ['Weak sales co-occur with stock-outs', 'The two moved together', 'a possible correlation']) assert.equal(hasCausalLanguage(t), false, t);
  });
  test('a correlation that claims a cause is kept but labelled unproven; events never say causal', async () => {
    const syn = SYN({ correlations: [{ between: ['sales', 'inventory'], statement: 'Stock-outs caused the weak sales', kind: 'inference' }] });
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn }) });
    const c = evs().find(e => e.type === 'correlation');
    assert.equal(c.metadata.causal, false); assert.equal(c.metadata.causal_language, true); assert.equal(c.metadata.evidence_class, 'AI_INTERPRETATION'); assert.equal(c.severity, 'warning');
    assert.match(r.text, /Possible correlations, not proof of cause/); assert.match(r.text, /treat as unproven/);
    assert.match(M.describeEvent(c), /not proof of cause/); assert.match(M.describeEvent(c), /unproven/);
  });
  test('correlations that cite a specialist that did not run, or only one specialist, are dropped', () => {
    const p = parseSynthesis(SYN({ correlations: [
      { between: ['sales', 'staff_ghost'], statement: 'x', kind: 'inference' }, { between: ['sales', 'sales'], statement: 'y' }, { between: ['sales'], statement: 'z' },
      { between: ['sales', 'inventory'], statement: 'ok', kind: 'bogus-kind' }] }), ['sales', 'inventory']);
    assert.equal(p.correlations.length, 1); assert.equal(p.dropped_correlations, 3); assert.equal(p.correlations[0].kind, 'co-occurrence');
  });
  test('agreements and conflicts need two distinct grounded specialists; one-source "agreements" are dropped', () => {
    const p = parseSynthesis(SYN({ agreements: [{ statement: 'solo', specialists: ['sales'] }, { statement: 'dup', specialists: ['sales', 'sales'] }, { statement: 'ok', specialists: ['sales', 'inventory'] }, { statement: 'nobody' }],
      conflicts: [{ statement: 'c-solo', specialists: ['inventory'] }] }), ['sales', 'inventory', 'manager'], ['sales', 'inventory']);
    assert.deepEqual(p.agreements.map(a => a.statement), ['ok']); assert.equal(p.conflicts.length, 0); assert.equal(p.dropped_claims, 4);
  });
  test('a claim that leans on an ungrounded specialist is dropped even though that specialist "ran"', () => {
    const p = parseSynthesis(SYN(), ['sales', 'inventory'], ['sales']);
    assert.equal(p.agreements.length, 0); assert.equal(p.correlations.length, 0); assert.equal(p.dropped_correlations, 1);
  });
  test('malformed / non-JSON synthesis is passed through as unstructured: no correlations, confidence unrated, and it says so', async () => {
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: 'Sales are weak because of stock-outs, I think.' }) });
    assert.equal(r.investigation.synthesis.structured, false); assert.equal(r.investigation.synthesis.confidence, 'unrated');
    assert.equal(types().includes('correlation'), false);
    assert.match(r.text, /did not return a structured assessment/);
    assert.equal(evs().find(e => e.type === 'synthesis').status, 'unstructured');
  });
  test('parseSynthesis tolerates a code fence, clips, caps and normalises confidence', () => {
    const p = parseSynthesis('```json\n' + SYN({ confidence: 'HIGH', gaps: Array(20).fill('g'.repeat(500)) }) + '\n```', ['sales', 'inventory']);
    assert.equal(p.structured, true); assert.equal(p.confidence, 'high'); assert.equal(p.gaps.length, 6); assert.equal(p.gaps[0].length, 200);
    assert.equal(parseSynthesis(SYN({ confidence: 'certain' }), ['sales']).confidence, 'unrated');
  });
});

describe('lifecycle, persistence, labels for investigations', () => {
  beforeEach(() => T.clear());
  test('lifecycle: understand, investigate, correlate, reason light from real events; recommend/act/audit do not', async () => {
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer() });
    const on = M.deriveLifecycle(evs().reverse(), false).filter(s => s.reached).map(s => s.id);
    assert.deepEqual(on, ['understand', 'investigate', 'correlate', 'reason']);
  });
  test('without any correlation the Correlate stage stays dark', async () => {
    await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ correlations: [] }) }) });
    assert.equal(M.deriveLifecycle(evs().reverse(), false).find(s => s.id === 'correlate').reached, false);
  });
  test('new events persist slim and redacted', () => {
    const c = Store.toStored({ type: 'correlation', timestamp: 1, metadata: { between: ['sales', 'inventory'], statement: 's', kind: 'inference', evidence_class: 'AI_INTERPRETATION', causal: true, token: 'x', args: { a: 1 } } });
    assert.equal(c.metadata.causal, false, 'persisted correlations can never be marked causal'); assert.equal(c.metadata.args, undefined); assert.equal(JSON.stringify(c).includes('"token"'), false);
    for (const t of ['evidence_bundle', 'synthesis']) assert.ok(Store.toStored({ type: t, timestamp: 1, metadata: { members: 2 } }), t);
    assert.deepEqual(Store.toStored({ type: 'routed', timestamp: 1, metadata: { members: ['sales', 'inventory'], by: 'orchestrator' } }).metadata.members, ['sales', 'inventory']);
  });
  test('describeEvent is honest about every investigation event; agents filter includes them', () => {
    assert.match(M.describeEvent({ type: 'evidence_bundle', metadata: { grounded: 1, members: 3, failed: 1, ungrounded: ['x'] } }), /1 of 3.*1 failed.*not used/);
    assert.match(M.describeEvent({ type: 'synthesis', status: 'failed', metadata: { error: 'e' } }), /could not combine/);
    assert.match(M.describeEvent({ type: 'specialist_start', metadata: { specialist: 'sales', mode: 'independent' } }), /independent/);
    for (const t of ['evidence_bundle', 'synthesis', 'correlation']) assert.ok(M.eventMatches({ type: t }, 'agents'), t);
  });
});
