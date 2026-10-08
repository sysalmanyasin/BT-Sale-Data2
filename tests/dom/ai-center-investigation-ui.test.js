// Phase 3 UI: the finding modal shows a REAL orchestrated investigation honestly, and Investigate with BT starts one.
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};

const reg = await import('../../js/agent/core/tool-registry.js');
const T = await import('../../js/agent/core/telemetry.js');
const { runInvestigation, planInvestigation } = await import('../../js/agent/core/orchestrator.js');

const rd = (name, domain, run) => reg.registerTool({ name, domain, risk: 'read', description: name, parameters: { type: 'object', properties: {} }, run });
rd('daily_briefing', 'app', () => ({ date: '07/Oct/2026', last_sales_entry: { date: '06/Oct/2026', total_sale: 410000, days_ago: 1 }, missing_sales_days: 0,
  attention: [{ level: 'warn', area: 'sales', message: 'Yesterday was 30% below the recent daily average.' }], inventory: null, credit: null, needs_action: 1 }));
rd('closing_recent_days', 'closing', () => ({ days: [], incomplete_days: [] }));
rd('str_overview', 'str', () => ({ total: 0, awaited: { all: 0 }, dispatched_not_received: { all: 0 }, received: 0 }));
rd('list_pending_strs', 'str', () => ({ matching: 0, showing: 0, items: [] }));
rd('get_target_pace', 'sales', () => ({ month: 'October 2026', target: 1000000, sold_so_far: 300000, pct_done: 30, remaining: 700000, days_left: 20, needed_per_day: 35000, actual_per_day: 38000, on_track: true }));
rd('get_daily_sales', 'sales', () => ({ date: '06/Oct/2026', total_sale: 410000, diff: 0 }));
for (const d of ['sales', 'inventory', 'manager']) rd('ui_' + d, d, () => ({ area: d, n: 3 }));

const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const modal = () => (q('.aic-modal') ? q('.aic-modal').textContent : '');

const syn = (over = {}) => JSON.stringify({ conclusion: 'Sales dipped while <img src=x onerror=alert(1)> two items were out of stock.', confidence: 'medium', confidence_reason: 'two areas returned data',
  agreements: [{ statement: 'Both areas show a dip', specialists: ['sales', 'inventory'] }], conflicts: [{ statement: 'Sales says normal staffing, Staff says short', specialists: ['sales', 'inventory'] }],
  correlations: [{ between: ['sales', 'inventory'], statement: 'Stock-outs caused weak sales', kind: 'inference' }], gaps: ['Closing was not checked'],
  recommendation: { needed: true, action: 'Reorder the two out-of-stock items', why: 'They were selling and are at zero', expected_result: 'Sales of those items resume', risk: 'low', action_type: 'advice', affected: ['Panadol'], evidence_from: ['inventory'] }, ...over });
const server = ({ synText = syn(), fail = null } = {}) => async ({ messages, tools, context }) => {
  const f = context.focus;
  if (f === 'analyst' && !tools.length) return { message: { content: synText } };
  if (f === fail) throw Object.assign(new Error('provider down'), { status: 503 });
  if (!messages.some(m => m.role === 'tool')) return { message: { tool_calls: [{ id: 'c1', function: { name: 'ui_' + f, arguments: '{}' } }] } };
  return { message: { content: f + ' report' } };
};
const finding = () => ui.__test.S.snap.findings.find(f => f.system === 'SALES');
async function investigated(opts) {
  const f = finding();
  const plan = planInvestigation('Investigate', { force: true, domains: ['sales', 'inventory'] });
  let result = null;
  await runInvestigation({ question: 'Investigate this finding', plan, callServer: server(opts), finding: { id: f.id, title: f.title, system: f.system, source: f.source, evidence: f.evidence }, onResult: r => { result = r; } });
  return { f, result };
}

describe('finding modal with a real investigation', () => {
  before(async () => { ui.onShow(); await wait(80); });
  beforeEach(() => { ui.__test.S.assess = {}; T.clear(); });

  test('shows who ran, typed evidence, confidence, conflicts, gaps and the AI recommendation', async () => {
    const { f, result } = await investigated();
    ui.__test.S.assess[f.id] = { text: result.text, at: Date.now(), investigation: result };
    ui.__test.openFinding(f);
    const m = modal();
    assert.match(m, /SPECIALISTS THAT ACTUALLY RAN \(2 of 2 returned data\)/);
    assert.match(m, /sales: 1 tool call/i); assert.match(m, /inventory: 1 tool call/i);
    assert.match(m, /Confidence: medium - two areas returned data/);
    for (const k of ['FACT', 'DETECTION', 'CORRELATION', 'AI INTERPRETATION', 'RECOMMENDATION']) assert.ok(m.includes(k), k + ' tag missing');
    assert.match(m, /CONFLICTS BETWEEN SPECIALISTS/); assert.match(m, /NOT CHECKED \/ MISSING/); assert.match(m, /Closing was not checked/);
    assert.match(m, /AI RECOMMENDATION/); assert.match(m, /Reorder the two out-of-stock items/); assert.match(m, /Not needed: advice only, nothing is changed/);
    assert.match(m, /Nothing is changed, so there is nothing to verify/);
    q('.aic-x').click();
  });
  test('a correlation whose wording claims a cause is shown as unproven, never as established', async () => {
    const { f, result } = await investigated();
    ui.__test.S.assess[f.id] = { text: result.text, at: Date.now(), investigation: result };
    ui.__test.openFinding(f);
    assert.match(modal(), /moved together, not proof of cause/); assert.match(modal(), /wording claimed a cause: unproven/);
    q('.aic-x').click();
  });
  test('model text is escaped: HTML in the conclusion is shown as text', async () => {
    const { f, result } = await investigated();
    ui.__test.S.assess[f.id] = { text: result.text, at: Date.now(), investigation: result };
    ui.__test.openFinding(f);
    assert.equal(document.querySelectorAll('.aic-modal img').length, 0); assert.match(modal(), /<img src=x onerror=alert\(1\)>/);
    q('.aic-x').click();
  });
  test('a failed specialist is shown as FAILED with its reason, and listed under "not checked"', async () => {
    const { f, result } = await investigated({ fail: 'inventory' });
    ui.__test.S.assess[f.id] = { text: result.text, at: Date.now(), investigation: result };
    ui.__test.openFinding(f);
    const m = modal();
    assert.match(m, /inventory: FAILED/i); assert.match(m, /1 of 2 returned data/); assert.match(m, /specialist failed \(provider down\): its area was not checked/);
    q('.aic-x').click();
  });
  test('a withheld recommendation says so instead of inventing one', async () => {
    const { f, result } = await investigated({ synText: syn({ recommendation: { needed: true, action: 'Do something', why: 'Because', evidence_from: ['closing'] } }) });
    ui.__test.S.assess[f.id] = { text: result.text, at: Date.now(), investigation: result };
    ui.__test.openFinding(f);
    assert.match(modal(), /Withheld: the Analyst suggested something that was not tied to data/); assert.equal(modal().includes('Do something'), false);
    q('.aic-x').click();
  });
  test('a plain Ask BT answer (no investigation) keeps the old text-only, not-rated view', () => {
    const f = finding();
    ui.__test.S.assess[f.id] = { text: 'Probably a slow day.', at: Date.now(), investigation: null };
    ui.__test.openFinding(f);
    assert.match(modal(), /Confidence not rated/); assert.match(modal(), /Probably a slow day/); assert.equal(modal().includes('SPECIALISTS THAT ACTUALLY RAN'), false);
    q('.aic-x').click();
  });
  test('the fixed-rule recommendation is still labelled as a rule, not AI', () => {
    ui.__test.openFinding(finding());
    assert.match(modal(), /fixed rule, not AI/); q('.aic-x').click();
  });
});

// The page calls the whole BTAgent surface on every render, so a stub needs all of it.
const agent = extra => ({ isBusy: () => false, writesAllowed: () => false, killed: () => false, approvals: () => [], open() {}, decide: () => ({ ok: false }), ...extra });

describe('Investigate with BT', () => {
  before(async () => { if (!ui.__test.S.snap) { ui.onShow(); await wait(80); } });
  beforeEach(() => { delete window.BTAgent; });
  after(async () => { delete window.BTAgent; await wait(50); });
  test('starts a REAL investigation: finding id/title/evidence and the owning specialists are passed to BTAgent.investigate', () => {
    let got = null;
    window.BTAgent = agent({ ask: () => { throw new Error('must not use plain ask'); }, investigate: a => { got = a; return Promise.resolve(); }, investigationFor: () => null });
    const f = finding(); ui.__test.investigate(f);
    assert.ok(got); assert.match(got.question, /Investigate this finding/); assert.deepEqual(got.domains, ['sales']);
    assert.equal(got.finding.id, f.id); assert.equal(got.finding.system, 'SALES'); assert.ok(got.finding.evidence.length > 0);
    assert.ok(got.finding.evidence.every(e => e.kind && e.label !== undefined));
    assert.equal(ui.__test.S.awaitingFor, f.id);
  });
  test('refuses (with a toast, no call) while BT is busy', () => {
    let called = false;
    window.BTAgent = agent({ isBusy: () => true, investigate: () => { called = true; }, ask: () => { called = true; } });
    ui.__test.S.awaitingFor = null; ui.__test.investigate(finding());
    assert.equal(called, false); assert.equal(ui.__test.S.awaitingFor, null);
  });
  test('older assistant without investigate(): falls back to a plain Ask BT, not a pretend investigation', () => {
    const asked = [];
    window.BTAgent = agent({ ask: t => { asked.push(t); return Promise.resolve(); } });
    ui.__test.investigate(finding());
    assert.equal(asked.length, 1); assert.match(asked[0], /Investigate this finding/);
  });
  test('the answer event attaches the stored investigation to the finding', async () => {
    const f = finding(), stored = { id: 'iv_x', finding_id: f.id, synthesis: { conclusion: 'c' } };
    window.BTAgent = agent({ investigate: () => Promise.resolve(), investigationFor: id => (id === f.id ? stored : null) });
    ui.__test.investigate(f);
    T.emit({ type: 'answer', status: 'ok', request_id: 'r1', metadata: { text: 'done' } }); await wait(20);
    assert.equal(ui.__test.S.assess[f.id].investigation, stored); assert.equal(ui.__test.S.assess[f.id].text, 'done');
  });
});
