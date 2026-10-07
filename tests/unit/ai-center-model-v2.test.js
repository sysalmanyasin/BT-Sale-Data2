// Pure-model coverage for the v11.22 AI Center work: approval view, finding guidance, correlation,
// tool intelligence, observability, specialist/realtime health, verify/retry event wording.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../js/ai-center/model.js';
import * as T from '../../js/agent/core/telemetry.js';

describe('approvalView (built only from the real proposal)', () => {
  const pending = { id: 'ap_1', tool: 'set_monthly_target', risk: 'write', armed: true, preview: { title: 'Set March target', lines: ['March 2027 target: Rs 500,000'], warnings: ['Replaces the old target'], strong: false, amount: 500000 } };
  const req = { metadata: { question: 'set the March target to 500000', specialist: 'sales', reversible: true, args: { month_year: 'March 2027', amount: 500000, password: 'x' } } };
  test('why quotes the person\'s own question; evidence is the exact preview lines', () => {
    const v = M.approvalView(pending, req);
    assert.match(v.why.text, /You asked: "set the March target to 500000"/); assert.equal(v.why.kind, 'FACT');
    assert.deepEqual(v.evidence.map(e => e.value), ['March 2027 target: Rs 500,000']);
    assert.deepEqual(v.warnings, ['Replaces the old target']);
    assert.match(v.expected, /exactly this is written/);
  });
  test('reversibility and affected records come from the tool, not from guesses', () => {
    const v = M.approvalView(pending, req);
    assert.equal(v.reversibility.ok, true);
    assert.ok(v.affected.some(a => a.label === 'month year' && a.value === 'March 2027'));
    assert.ok(v.affected.some(a => a.label === 'amount' && /500,000/.test(a.value)));
    assert.equal(M.approvalView(pending, { metadata: { args: {} } }).reversibility.ok, false);
  });
  test('gate: one tap, two taps for strong changes, typed word for deletes', () => {
    assert.equal(M.approvalView(pending, req).gate.kind, 'tap');
    assert.equal(M.approvalView({ ...pending, armed: false, preview: { ...pending.preview, strong: true } }, req).gate.kind, 'twotap');
    const d = M.approvalView({ ...pending, risk: 'critical', preview: { title: 'Delete', confirmWord: 'DELETE' } }, req);
    assert.deepEqual([d.gate.kind, d.gate.word, d.tone], ['type', 'DELETE', 'cr']);
  });
  test('works with no matching event (no invented question)', () => {
    const v = M.approvalView(pending, null);
    assert.match(v.why.text, /BT proposed this change/); assert.doesNotMatch(v.why.text, /You asked/);
  });
});

describe('finding guidance (sections 11 and 44)', () => {
  const briefing = { last_sales_entry: { date: '06/Oct/2026', total_sale: 400000 }, attention: [{ level: 'warn', area: 'sales', message: 'Cash DIFF Rs 12,000 on 06/Oct/2026.' }, { level: 'warn', area: 'inventory', message: '3 products are out of stock but still selling.' }] };
  const f = M.buildFindings({ briefing, now: Date.UTC(2026, 9, 7) });
  test('every finding has a recommendation, an if-act text, related records and an audit reference', () => {
    assert.ok(f.length >= 2);
    f.forEach(x => { assert.ok(x.recommendation.length > 20); assert.ok(x.if_act.length > 10); assert.match(x.audit_reference, /^rule:daily_briefing#f_/); assert.ok(x.related_entities.some(r => r.kind === 'system')); });
  });
  test('dates mentioned by the rule become related records', () => {
    const cash = f.find(x => x.system === 'CASH');
    assert.ok(cash.related_entities.some(r => r.kind === 'date' && r.value === '06/Oct/2026'));
  });
  test('guidance is fixed rule text, never claims AI', () => {
    f.forEach(x => assert.doesNotMatch(x.recommendation + x.if_act, /\bAI (thinks|believes|predicts)\b/));
    assert.match(M.guidanceFor('CLOSING').rec, /Closing Book/);
  });
});

describe('correlate (co-occurrence only)', () => {
  const mk = (system, title, severity = 'warning') => ({ id: 'f_' + title.length, system, title, severity });
  test('two areas at once -> a CORRELATION that says it is not proof', () => {
    const c = M.correlate([mk('CASH', 'Cash DIFF Rs 5'), mk('SALES', 'Latest entry is 30% below the same weekday last week')]);
    assert.equal(c.length, 1); assert.equal(c[0].kind, 'CORRELATION'); assert.equal(c[0].confidence, 'co-occurrence');
    assert.match(c[0].why, /not evidence|not proven|Verify/i);
  });
  test('one area alone, or only healthy findings, correlate nothing', () => {
    assert.deepEqual(M.correlate([mk('CASH', 'Cash DIFF Rs 5')]), []);
    assert.deepEqual(M.correlate([mk('CASH', 'Cash DIFF', 'good'), mk('SALES', 'below the same weekday', 'good')]), []);
    assert.deepEqual(M.correlate(null), []);
  });
  test('stock and transfer rule', () => {
    const c = M.correlate([mk('STR', '3 incoming STR(s) unreceived for 3+ days'), mk('INVENTORY', '4 products out of stock but selling')]);
    assert.equal(c[0].id, 'c_str_inv');
  });
});

describe('tool intelligence (section 16)', () => {
  test('status comes from the real gates', () => {
    const w = { name: 'x', risk: 'write' }, r = { name: 'y', risk: 'read' };
    assert.equal(M.toolStatus(r, {}).status, 'AVAILABLE');
    assert.equal(M.toolStatus(w, { writesAllowed: false }).status, 'READ-ONLY');
    assert.equal(M.toolStatus(w, { writesAllowed: true }).status, 'APPROVAL');
    assert.equal(M.toolStatus(w, { writesAllowed: true, killed: true }).status, 'BLOCKED');
    assert.equal(M.toolTone('BLOCKED'), 'cr');
  });
  test('purpose is the first sentence, clipped', () => {
    assert.equal(M.toolPurpose({ description: 'Gets sales. Second sentence.' }), 'Gets sales.');
    assert.ok(M.toolPurpose({ description: 'a'.repeat(300) }).length <= 110);
    assert.equal(M.toolPurpose({}), '');
  });
});

describe('observability + health from real events', () => {
  const ev = [
    { type: 'request_start', request_id: 'a', agent: 'Sales', timestamp: 1000 }, { type: 'answer', request_id: 'a', timestamp: 4000 },
    { type: 'request_start', request_id: 'b', agent: 'Sales', timestamp: 5000 }, { type: 'error', request_id: 'b', timestamp: 5500 },
    { type: 'request_start', request_id: 'c', agent: 'Closing', timestamp: 6000 }, { type: 'answer', request_id: 'c', timestamp: 8000 },
    { type: 'approval_resolved', status: 'approved', duration: 7000, timestamp: 7000 }, { type: 'approval_resolved', status: 'rejected', duration: 3000, timestamp: 7100 },
    { type: 'retry', timestamp: 5100 }, { type: 'verify_end', status: 'ok' }, { type: 'verify_end', status: 'failed' },
  ];
  test('durations, waits, retries, verify results', () => {
    const o = M.observability(ev);
    assert.deepEqual([o.requests, o.answered, o.errors, o.retries], [3, 2, 1, 1]);
    assert.equal(o.avgInvestigationMs, 2500); assert.equal(o.maxInvestigationMs, 3000);
    assert.deepEqual([o.approvals, o.avgApprovalWaitMs, o.maxApprovalWaitMs, o.approvalsRejected], [2, 5000, 7000, 1]);
    assert.deepEqual([o.verified, o.verifyFailed], [1, 1]);
  });
  test('no events -> nulls, never made-up numbers', () => {
    const o = M.observability([]);
    assert.equal(o.avgInvestigationMs, null); assert.equal(o.avgApprovalWaitMs, null); assert.equal(o.requests, 0);
  });
  test('specialist stats and health', () => {
    const st = M.specialistStats(ev);
    assert.deepEqual([st.Sales.runs, st.Sales.failed, st.Closing.runs], [2, 1, 1]);
    assert.equal(M.specialistsHealth({}, 7).status, 'UNKNOWN');
    assert.equal(M.specialistsHealth(st, 7).status, 'DEGRADED');
    assert.equal(M.specialistsHealth({ A: { runs: 10, failed: 0 } }, 7).status, 'HEALTHY');
    assert.equal(M.specialistsHealth({ A: { runs: 2, failed: 2 } }, 7).status, 'ERROR');
  });
  test('realtime channel states', () => {
    assert.equal(M.realtimeHealth(null).status, 'UNKNOWN'); assert.equal(M.realtimeHealth('').status, 'WARNING');
    assert.equal(M.realtimeHealth('joined').status, 'HEALTHY'); assert.equal(M.realtimeHealth('joining').status, 'WARNING');
    assert.equal(M.realtimeHealth('closed').status, 'ERROR');
  });
});

describe('event wording for the new real events', () => {
  test('verify and retry are described, and filtered under the right tabs', () => {
    assert.match(M.describeEvent({ type: 'verify_start', tool: 'set_monthly_target' }), /Reading back/);
    assert.match(M.describeEvent({ type: 'verify_end', status: 'ok', tool: 't', metadata: { checks: [{ ok: true }, { ok: true }] } }), /Verified: t \(2 of 2/);
    assert.match(M.describeEvent({ type: 'verify_end', status: 'failed', tool: 't', metadata: { checks: [{ ok: true }, { ok: false }] } }), /NOT verified.*1 of 2/);
    assert.match(M.describeEvent({ type: 'verify_end', status: 'ok', tool: 't', metadata: { passed: 3, total: 3 } }), /3 of 3/); // restored (slim) form
    assert.match(M.describeEvent({ type: 'approval_resolved', status: 'approved', tool: 't', duration: 4200 }), /you took 4\.2 s/);
    assert.match(M.describeEvent({ type: 'retry', metadata: { http_status: 503 } }), /HTTP 503/);
    assert.ok(M.eventMatches({ type: 'verify_end' }, 'actions')); assert.ok(M.eventMatches({ type: 'verify_end' }, 'tools'));
    assert.ok(M.eventMatches({ type: 'retry', source: 'server' }, 'system'));
  });
  test('fmtDur', () => { assert.equal(M.fmtDur(250), '250 ms'); assert.equal(M.fmtDur(2500), '2.5 s'); assert.equal(M.fmtDur(125000), '2 min 5 s'); assert.equal(M.fmtDur(null), ''); });
});

describe('telemetry: verifying state', () => {
  test('liveState.verifying is set between verify_start and verify_end only', () => {
    T.clear();
    T.emit({ type: 'request_start', request_id: 'r', agent: 'Sales' });
    assert.equal(T.liveState().verifying, null);
    T.emit({ type: 'verify_start', request_id: 'r', tool: 'add_staff_note' });
    assert.equal(T.liveState().verifying.tool, 'add_staff_note');
    T.emit({ type: 'verify_end', request_id: 'r', tool: 'add_staff_note', status: 'ok' });
    assert.equal(T.liveState().verifying, null);
    T.clear();
  });
});

describe('approvalView: no invented amounts', () => {
  test('a missing, empty or zero amount is not shown as "Rs 0"', () => {
    for (const amount of [undefined, null, '', 0]) {
      const v = M.approvalView({ id: 'a', tool: 't', risk: 'write', preview: { title: 'x', lines: [], amount } }, { metadata: { args: {} } });
      assert.ok(!v.affected.some(a => a.label === 'amount'), 'amount ' + String(amount));
    }
  });
});
