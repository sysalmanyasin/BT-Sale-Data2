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

// ───────────────────────── Phase 3: finding context, typed evidence, recommendation ─────────────────────────
import { parseRecommendation, buildEvidenceItems, EVIDENCE_CLASSES, synthesisPrompt } from '../../js/agent/core/orchestrator.js';

const REC = (over = {}) => ({ needed: true, action: 'Reorder the two out-of-stock items today', why: 'Both items were selling and are at zero stock', expected_result: 'Sales of those items resume', risk: 'low', action_type: 'advice', affected: ['Panadol', 'Brufen'], evidence_from: ['inventory'], ...over });
const FINDING = { id: 'f_abc', title: 'Yesterday Rs 41,000 is 30% below the recent average', system: 'SALES', source: 'daily_briefing',
  evidence: [{ kind: 'DETECTION', label: 'Rule', value: 'below average' }, { kind: 'CALCULATION', label: 'vs recent average', value: '-30%' }, { kind: 'WEIRD', label: 'x', value: 'y' }] };

describe('parseRecommendation', () => {
  test('a data-backed recommendation keeps its fields; approval/verification/reversibility come from code, not the model', () => {
    const { rec } = parseRecommendation(REC({ approval_required: false, how_verified: 'trust me', reversible: true }), ['inventory']);
    assert.equal(rec.action_type, 'advice'); assert.equal(rec.approval_required, false); assert.equal(rec.reversible, null);
    assert.match(rec.how_verified, /nothing to verify/i); assert.match(rec.reversibility_note, /Not applicable/); assert.deepEqual(rec.evidence_from, ['inventory']);
  });
  test('a change recommendation always requires approval and defers reversibility to the tool\'s approval card', () => {
    const { rec } = parseRecommendation(REC({ action_type: 'change' }), ['inventory']);
    assert.equal(rec.approval_required, true); assert.match(rec.how_verified, /VERIFY/); assert.match(rec.reversibility_note, /approval card/);
  });
  test('unsupported advice is withheld: no why, or no grounded specialist cited', () => {
    assert.deepEqual(parseRecommendation(REC({ why: '' }), ['inventory']), { rec: null, dropped: true });
    assert.deepEqual(parseRecommendation(REC({ evidence_from: ['sales'] }), ['inventory']), { rec: null, dropped: true });
    assert.deepEqual(parseRecommendation(REC({ evidence_from: [] }), ['inventory']), { rec: null, dropped: true });
  });
  test('needed=false, empty or malformed -> no recommendation and nothing dropped', () => {
    for (const r of [{ needed: false, action: 'x' }, { needed: true }, null, 'text', 5]) assert.deepEqual(parseRecommendation(r, ['inventory']), { rec: null, dropped: false });
  });
  test('bad risk/type are normalised; cause wording in the reasoning is flagged', () => {
    const { rec } = parseRecommendation(REC({ risk: 'catastrophic', action_type: 'delete everything', why: 'Stock-outs caused the dip' }), ['inventory']);
    assert.equal(rec.risk, 'unrated'); assert.equal(rec.action_type, 'advice'); assert.equal(rec.causal_language, true);
  });
});

describe('investigating a finding', () => {
  beforeEach(() => { T.clear(); ran.length = 0; });
  test('the finding and its rule evidence reach the members and the Analyst (as app-detected, not AI)', async () => {
    const srv = makeServer();
    await runInvestigation({ question: 'Investigate this finding', plan: plan(['sales', 'inventory']), callServer: srv, finding: FINDING });
    const member = srv.calls.find(c => c.focus === 'sales').messages[0].content;
    assert.match(member, /flagged this finding/); assert.match(member, /30% below the recent average/); assert.match(member, /vs recent average: -30%/);
    const a = srv.calls.find(c => c.focus === 'analyst').messages[0].content;
    assert.match(a, /detected by the app's rules, not by AI/);
    assert.equal(evs().find(e => e.type === 'request_start').metadata.finding_id, 'f_abc');
  });
  test('onResult is called with the structured result BEFORE the answer event; finding_id is attached', async () => {
    let seenTypes = null, got = null;
    await runInvestigation({ question: 'Investigate', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ recommendation: REC() }) }), finding: FINDING,
      onResult: r => { got = r; seenTypes = types(); } });
    assert.equal(seenTypes.includes('answer'), false, 'result must be readable before the answer event fires');
    assert.equal(got.finding_id, 'f_abc'); assert.ok(got.synthesis.recommendation); assert.ok(got.text.length > 0);
  });
  test('a throwing onResult never breaks the investigation', async () => {
    const r = await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer(), onResult: () => { throw new Error('ui'); } });
    assert.ok(r.text);
  });
});

describe('recommendation event + lifecycle', () => {
  beforeEach(() => T.clear());
  test('a valid recommendation emits ONE recommendation event, after synthesis and before the answer; Recommend lights, Approve/Act do not', async () => {
    const r = await runInvestigation({ question: 'Why are sales weak?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ recommendation: REC() }) }), finding: FINDING });
    const t = types();
    assert.equal(t.filter(x => x === 'recommendation').length, 1);
    assert.ok(t.indexOf('synthesis') < t.indexOf('recommendation') && t.indexOf('recommendation') < t.indexOf('answer'));
    const e = evs().find(x => x.type === 'recommendation');
    assert.equal(e.metadata.kind, 'investigation_advice'); assert.equal(e.metadata.requires_approval, false); assert.equal(e.metadata.finding_id, 'f_abc'); assert.equal(e.metadata.reversible, undefined);
    const on = M.deriveLifecycle(evs().reverse(), false).filter(s => s.reached).map(s => s.id);
    assert.ok(on.includes('recommend')); assert.equal(on.includes('approve'), false); assert.equal(on.includes('act'), false);
    assert.match(r.text, /\*\*Recommendation\*\*/); assert.match(r.text, /Approval: not needed/); assert.match(r.text, /Verification: Nothing is changed/);
    assert.match(M.describeEvent(e), /changes nothing/);
  });
  test('no recommendation event when the Analyst gave none, or when it was withheld as unsupported', async () => {
    await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer() });
    assert.equal(types().includes('recommendation'), false);
    T.clear();
    const r = await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ recommendation: REC({ evidence_from: ['closing'] }) }) }) });
    assert.equal(types().includes('recommendation'), false); assert.equal(r.investigation.synthesis.dropped_recommendation, true);
    assert.match(r.text, /recommendation was withheld/); assert.equal(evs().find(e => e.type === 'synthesis').metadata.dropped_recommendation, true);
  });
  test('a change-type recommendation says approval is required but still changes nothing by itself', async () => {
    const r = await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ recommendation: REC({ action_type: 'change' }) }) }) });
    assert.equal(evs().find(e => e.type === 'recommendation').metadata.requires_approval, true);
    assert.equal(types().includes('approval_requested'), false, 'a recommendation to change something is not itself a change request');
    assert.equal(ran.includes('WRITE'), false); assert.match(r.text, /Approval: required for any change/);
  });
  test('the recommendation persists slim: no free-form fields leak', () => {
    const s = Store.toStored({ type: 'recommendation', timestamp: 1, metadata: { kind: 'investigation_advice', title: 'T', action_type: 'advice', finding_id: 'f', why: 'secret reasoning', args: { password: 'x' } } });
    assert.equal(s.metadata.why, undefined); assert.equal(s.metadata.args, undefined); assert.equal(s.metadata.finding_id, 'f');
    assert.equal(Store.toStored({ type: 'recommendation', timestamp: 1, metadata: { reversible: true } }).metadata.reversible, true);
  });
});

describe('typed evidence', () => {
  beforeEach(() => { T.clear(); ran.length = 0; });
  test('classes are exactly the AI Center\'s evidence kinds', () => { assert.deepEqual([...EVIDENCE_CLASSES], [...M.EVIDENCE_KINDS]); });
  test('tool outputs are FACT with their tool as source; model statements are never FACT or CALCULATION', async () => {
    const r = await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer({ syn: SYN({ recommendation: REC() }) }), finding: FINDING });
    const items = r.investigation.synthesis.evidence_items;
    assert.ok(items.filter(i => i.class === 'FACT').length === 2); assert.ok(items.filter(i => i.class === 'FACT').every(i => i.origin === 'tool' && /^orch_/.test(i.source)));
    assert.ok(items.filter(i => i.origin === 'analyst').every(i => !['FACT', 'CALCULATION', 'DETECTION', 'PREDICTION'].includes(i.class)), 'analyst output must never be FACT/CALCULATION/DETECTION/PREDICTION');
    const classes = new Set(items.map(i => i.class));
    for (const c of ['FACT', 'DETECTION', 'CALCULATION', 'CORRELATION', 'AI INTERPRETATION', 'RECOMMENDATION']) assert.ok(classes.has(c), c);
    assert.equal(items.find(i => i.class === 'CORRELATION').causal, false);
  });
  test('finding rule rows keep their kind; an unknown kind becomes DETECTION, never FACT', () => {
    const it = buildEvidenceItems([], null, FINDING).filter(i => i.origin === 'finding');
    assert.deepEqual(it.map(i => i.class), ['DETECTION', 'CALCULATION', 'DETECTION']);
    assert.ok(it.every(i => /^rule: /.test(i.source)));
  });
  test('a failed member contributes no evidence items', async () => {
    const r = await runInvestigation({ question: 'Why?', plan: plan(['sales', 'inventory']), callServer: makeServer({ failFocus: 'inventory' }) });
    assert.equal(r.investigation.synthesis.evidence_items.filter(i => i.class === 'FACT' && i.specialist === 'inventory').length, 0);
  });
  test('synthesisPrompt tells the Analyst how to recommend and asks for evidence_from', () => {
    const p = synthesisPrompt('q', [], null);
    assert.match(p, /"recommendation"/); assert.match(p, /evidence_from/); assert.match(p, /needed=false/);
  });
});

describe('finding -> specialists mapping', () => {
  test('every system maps to the owning specialist; unknown -> none; returns a copy', () => {
    assert.deepEqual(M.domainsForFinding({ system: 'CASH' }), ['manager']); assert.deepEqual(M.domainsForFinding({ system: 'INVENTORY' }), ['inventory']);
    assert.deepEqual(M.domainsForFinding({ system: 'STR' }), ['str']); assert.deepEqual(M.domainsForFinding({ system: 'NOPE' }), []);
    const a = M.domainsForFinding({ system: 'SALES' }); a.push('x'); assert.deepEqual(M.domainsForFinding({ system: 'SALES' }), ['sales']);
  });
  test('a sales finding plans sales + related areas; a cash finding plans staff&money + sales + closing', () => {
    assert.deepEqual(planInvestigation('Investigate', { force: true, domains: M.domainsForFinding({ system: 'SALES' }) }).members.map(m => m.id), ['sales', 'inventory', 'manager', 'closing']);
    assert.deepEqual(planInvestigation('Investigate', { force: true, domains: M.domainsForFinding({ system: 'CASH' }) }).members.map(m => m.id), ['manager', 'sales', 'closing']);
  });
});
