// BT INTELLIGENCE — copilot logic: prioritisation, critical elevation, prompts, structured results, drafts,
// action states, failure wording, investigation history. Pure functions: no DOM, no writes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/ai-center/copilot.js';

const F = (o) => ({ id: o.id || o.title, severity: 'warning', system: 'SALES', type: 'ANOMALY', source: 'daily_briefing', title: 't', evidence: [], recommendation: 'rec', ...o });
const NOW = new Date(2026, 9, 10, 12).getTime();

describe('prioritizeFindings', () => {
  test('warnings beat notes; larger Rs amount first within a severity; max 5 shown', () => {
    const fs = [F({ id: 'a', title: 'Note', severity: 'info' }), F({ id: 'b', title: 'Rs 50 duplicate', impact: 50 }), F({ id: 'c', title: 'Rs 111,317 rollover', system: 'STAFF', impact: 111317 }),
      ...Array.from({ length: 6 }, (_, i) => F({ id: 'x' + i, title: 'More ' + i, system: 'CLOSING' }))];
    const P = C.prioritizeFindings(fs);
    assert.equal(P.entries[0].id, 'c');
    assert.equal(P.entries[1].id, 'b');
    assert.equal(P.entries.length, 5);
    assert.equal(P.total, 9);
    assert.equal(P.hidden, 4);
    assert.ok(P.entries.every(e => e.severity !== 'info'), 'notes rank below all warnings here');
  });
  test('good findings never appear', () => {
    assert.equal(C.prioritizeFindings([F({ severity: 'good' })]).entries.length, 0);
  });
  test('inventory and STR issues merge per area; correlation is attached as co-occurrence', () => {
    const fs = [F({ id: 'i1', system: 'INVENTORY', title: '403 products out of stock, selling' }), F({ id: 'i2', system: 'INVENTORY', title: 'Reorder: 73 run out', severity: 'info' }),
      F({ id: 's1', system: 'STR', title: '5 STRs unreceived for 3+ days' })];
    const P = C.prioritizeFindings(fs);
    const inv = P.entries.find(e => e.system === 'INVENTORY');
    assert.equal(inv.related.length, 1);
    assert.equal(P.entries.filter(e => e.system === 'INVENTORY').length, 1);
    const str = P.entries.find(e => e.system === 'STR');
    assert.ok(str.linked.some(l => l.id === 'c_str_inv'));
    assert.ok(!/cause|because/i.test(str.linked[0].title));
  });
  test('impact text is honest when nothing is quantified', () => {
    assert.equal(C.impactText(F({ title: 'Closing incomplete' })), 'Impact not quantified');
    assert.equal(C.impactText(F({ title: 'Cash DIFF Rs 13,823' })), 'Rs 13,823 involved');
  });
});

describe('criticalItems', () => {
  test('error findings and pending approvals are elevated; critical first', () => {
    const items = C.criticalItems({ findings: [F({ id: 'w' }), F({ id: 'e', severity: 'error', title: 'Boom' })], approvals: [{ id: 'p1', tool: 'add_credit', preview: { title: 'Add credit' } }, { id: 'p2', tool: 'del', risk: 'critical' }] });
    assert.deepEqual(items.map(i => i.id), ['e', 'p2', 'p1']);
    assert.equal(items.find(i => i.id === 'w'), undefined);
  });
  test('nothing critical → empty (no empty banner)', () => assert.deepEqual(C.criticalItems({ findings: [F({})] }), []));
});

describe('suggestPrompts', () => {
  test('3–4 prompts, context first', () => {
    const p = C.suggestPrompts({ findings: [F({ system: 'CLOSING', title: 'x' }), F({ system: 'STR', title: 'STR fill rate 80%' })], reorderLines: 10, fillPct: 80 });
    assert.ok(p.length >= 3 && p.length <= 4);
    assert.ok(p.includes('What is blocking closing?'));
    assert.ok(p.includes('Why are transfers delayed?'));
    assert.equal(new Set(p).size, p.length);
  });
  test('an empty business still yields useful prompts', () => {
    const p = C.suggestPrompts({});
    assert.ok(p.length >= 3);
  });
  test('pending approvals are suggested first', () => assert.equal(C.suggestPrompts({ approvals: 1, findings: [F({})] })[0], 'What changes is BT proposing right now?'));
});

describe('structureInvestigation', () => {
  const f = F({ id: 'f1', system: 'STR', title: '5 STR(s) unreceived', source: 'list_pending_strs', recommendation: 'Chase the oldest', if_act: 'Nothing changes.', evidence: [{ kind: 'DETECTION', label: 'Rule', value: '3+ days' }, { kind: 'CORRELATION', label: 'Seen with', value: 'stock-outs' }], action: { href: '#str' } });
  test('not investigated: rule recommendation, honest limitation, verified vs hypothesis split', () => {
    const R = C.structureInvestigation(f, null, []);
    assert.equal(R.investigated, false);
    assert.equal(R.recommendation.source, 'rule');
    assert.equal(R.verified.length, 1);
    assert.equal(R.hypotheses.length, 1);
    assert.match(R.limitations[0], /not investigated/i);
    assert.equal(R.confidence.level, 'not rated');
  });
  test('investigated: AI recommendation, specialist failures and gaps appear as limitations', () => {
    const inv = { id: 'inv1', entries: [{ label: 'Inventory', status: 'timeout', error: 'took too long' }], stats: { ungrounded: [] }, synthesis: { confidence: 'medium', confidence_reason: 'one specialist missing', conclusion: 'c', gaps: ['No STR line detail'], evidence_items: [{ class: 'FACT', label: 'Oldest', text: '5 days', source: 'list_pending_strs' }], recommendation: { action: 'Call warehouse', why: 'w', expected_result: 'e', risk: 'low', approval_required: false } } };
    const R = C.structureInvestigation(f, { text: 't', investigation: inv }, []);
    assert.equal(R.recommendation.source, 'ai');
    assert.equal(R.confidence.level, 'medium');
    assert.ok(R.limitations.some(l => /No STR line detail/.test(l)));
    assert.ok(R.limitations.some(l => /Inventory specialist timeout/.test(l)));
    assert.equal(R.investigationId, 'inv1');
    assert.equal(R.verified.length, 2);
  });
  test('available actions include a matching prepared draft but never a write', () => {
    const R = C.structureInvestigation(f, null, [{ id: 'draft:overdue_str', kind: 'overdue_str', title: 'Overdue STR report' }, { id: 'draft:reorder', kind: 'reorder', title: 'Reorder draft' }]);
    assert.ok(R.actions.some(a => a.kind === 'draft' && a.draft === 'draft:overdue_str'));
    assert.ok(!R.actions.some(a => a.draft === 'draft:reorder'));
    assert.ok(R.actions.every(a => ['open', 'draft', 'investigate'].includes(a.kind)));
  });
});

describe('buildActionDrafts', () => {
  const raw = {
    planning: { reorder: { total_lines: 2, shown: 2, cover_days_target: 19, out_of_stock_selling: 1, low_cover: 1, lost_sales_per_day: 1200, est_value_at_sale_price: 5000,
      groups: [{ supplier: 'Al Qamar', lines: 2, urgent_lines: 2, est_value_at_sale_price: 5000, items: [{ name: 'D Stat', suggested_qty: 228, status: 'out_of_stock', in_transit: 0, cover_days: 0 }, { name: 'Diaper', suggested_qty: 79, status: 'low', in_transit: 0, cover_days: 3 }] }] } },
    strPending: { matching: 7, items: [{ str: 'STR-1', age_days: 5, stage: 'dispatched', from: 'WAREHOUSE', date: '2026-10-05' }] },
    closing: { days: [], incomplete_days: [{ date: '2026-10-08', missing: ['Night (pending)'] }, { date: '2026-10-10', missing: ['Night (pending)'] }] },
    day: { date: '09/Oct/2026', diff: -13823, cash_sale: 268466, bank_total: 260110 },
  };
  test('three drafts, each read-only with purpose, affected records, amounts, impact and a no-change note', () => {
    const d = C.buildActionDrafts(raw, NOW);
    assert.deepEqual(d.map(x => x.kind), ['reorder', 'overdue_str', 'closing_discrepancy']);
    for (const x of d) {
      assert.equal(x.writes, false);
      assert.equal(x.state, 'prepared_draft');
      ['purpose', 'affected', 'amounts', 'impact', 'text', 'note'].forEach(k => assert.ok(x[k] && String(x[k]).length > 3, x.id + '.' + k));
      assert.match(x.note, /Nothing has been changed/);
    }
    assert.match(d[0].text, /Al Qamar/);
    assert.match(d[1].text, /\+6 more not listed/);
  });
  test('closing draft ignores today (still open) and states the real cash DIFF', () => {
    const d = C.buildActionDrafts(raw, NOW).find(x => x.kind === 'closing_discrepancy');
    assert.match(d.text, /2026-10-08/);
    assert.doesNotMatch(d.text, /2026-10-10/);
    assert.match(d.text, /13,823/);
  });
  test('no data → no drafts (no empty or invented drafts)', () => {
    assert.deepEqual(C.buildActionDrafts({}, NOW), []);
    assert.deepEqual(C.buildActionDrafts({ planning: { reorder: { total_lines: 0 } }, strPending: { matching: 0, items: [] }, closing: { incomplete_days: [] }, day: { date: 'd', diff: 0 } }, NOW), []);
  });
});

describe('action states: never claim more than the system recorded', () => {
  test('audit row → state', () => {
    assert.equal(C.auditActionState({ change: true, status: 'approved' }), 'executed');
    assert.equal(C.auditActionState({ change: true, status: 'not applied' }), 'failed');
    assert.equal(C.auditActionState({ change: true, status: 'failed' }), 'failed');
    assert.equal(C.auditActionState({ change: true, status: 'rejected' }), 'rejected');
    assert.equal(C.auditActionState({ change: true, status: 'undone' }), 'undone');
    assert.equal(C.auditActionState({ change: true, status: 'done' }), 'failed', 'a write row without an approved+ok record is not "executed"');
    assert.equal(C.auditActionState(null), 'recommendation');
  });
  test('five distinct, labelled states', () => {
    const labels = ['recommendation', 'prepared_draft', 'pending_approval', 'executed', 'failed'].map(k => C.ACTION_STATES[k].label);
    assert.equal(new Set(labels).size, 5);
  });
});

describe('buildInvestigationHistory', () => {
  const ev = (type, o = {}) => ({ type, timestamp: 1, ...o });
  const run = (events, extra = {}) => ({ id: 'r1', question: 'Q?', status: 'complete', startedAt: 1, durationMs: 100, agents: ['Closing'], tools: [{ tool: 'closing_recent_days', status: 'ok' }], stages: [{ key: 'evidence', detail: '1 of 1 specialists returned data' }, { key: 'analysis', detail: 'confidence high' }], events, ...extra });
  test('links question, specialists, tools, evidence and confidence', () => {
    const [h] = C.buildInvestigationHistory([run([])]);
    assert.equal(h.toolCount, 1);
    assert.equal(h.confidence, 'high');
    assert.match(h.evidence, /1 of 1/);
    assert.equal(h.outcome, 'none');
  });
  test('approval pending / rejected / executed+verified / executed unverified / failed', () => {
    const w = s => ev('tool_end', { status: s, metadata: { risk: 'write' } });
    const req = ev('approval_requested', { metadata: { title: 'Add credit' } });
    assert.equal(C.buildInvestigationHistory([run([req])])[0].outcome, 'pending_approval');
    assert.equal(C.buildInvestigationHistory([run([req, ev('approval_resolved', { status: 'rejected' })])])[0].outcome, 'rejected');
    assert.equal(C.buildInvestigationHistory([run([req, ev('approval_resolved', { status: 'approved' }), w('ok'), ev('verify_end', { status: 'ok' })])])[0].outcome, 'executed');
    assert.equal(C.buildInvestigationHistory([run([req, ev('approval_resolved', { status: 'approved' }), w('ok')])])[0].outcome, 'executed_unverified');
    assert.equal(C.buildInvestigationHistory([run([req, ev('approval_resolved', { status: 'approved' }), w('error')])])[0].outcome, 'failed');
  });
  test('runs without a question are skipped; limit respected', () => {
    assert.equal(C.buildInvestigationHistory([run([], { question: '' })]).length, 0);
    assert.equal(C.buildInvestigationHistory(Array.from({ length: 12 }, () => run([])), 3).length, 3);
  });
});

describe('describeFailure', () => {
  test('timeout, permission, offline, partial, generic', () => {
    assert.equal(C.describeFailure(new Error('Request timed out')).kind, 'timeout');
    assert.equal(C.describeFailure('Read-only on this device').kind, 'permission');
    assert.equal(C.describeFailure({ message: 'Failed to fetch' }).kind, 'offline');
    assert.equal(C.describeFailure('STR data is not loaded yet').kind, 'partial');
    assert.equal(C.describeFailure('boom').kind, 'error');
  });
  test('permission errors do not offer a retry; every state says nothing was changed or what is shown', () => {
    assert.equal(C.describeFailure('forbidden').retry, false);
    assert.match(C.describeFailure('boom').text, /Nothing was changed/);
  });
});

describe('forecastVariance', () => {
  test('behind pace: per-day gap, month-end gap and drivers all from tool numbers', () => {
    const V = C.forecastVariance({ target: 1000, sold_so_far: 300, needed_per_day: 50, actual_per_day: 30, days_left: 10 }, { projected_month_end: 700, projected_low: 600, projected_high: 800 }, { missing_sales_days: 2 });
    assert.equal(V.behind, true);
    assert.equal(V.perDay, -20);
    assert.equal(V.runRate, 600);
    assert.equal(V.monthEndGap, -400);
    assert.ok(V.drivers.some(d => /2 day\(s\) have no sales entry/.test(d.text)));
    assert.ok(V.drivers.some(d => d.kind === 'PREDICTION'));
  });
  test('missing pace → null', () => { assert.equal(C.forecastVariance(null), null); assert.equal(C.forecastVariance({ error: 'x' }), null); });
});

describe('snapshotTiles', () => {
  const snap = {
    errors: {}, systems: { SALES: { status: 'CLEAR', fresh: { label: '1 day(s) since last sales entry' } }, CASH: { status: 'ATTENTION', fresh: { label: 'x' } }, INVENTORY: { status: 'ATTENTION', fresh: { label: 'y' } }, STAFF: { status: 'ATTENTION', fresh: { label: 'z' } }, STR: { status: 'CLEAR', fresh: { label: 'w' } }, CLOSING: { status: 'ATTENTION', fresh: { label: 'v' } } },
    raw: {
      briefing: { last_sales_entry: { date: '09/Oct/2026', total_sale: 509669 }, yesterday: { vs_recent_avg_pct: -10 }, inventory: { out_of_stock_but_selling: 403, running_out_within_7_days: 73 }, credit: { month: 'October 2026', month_net_owed: 0, staff_owing: 0, prev_month: 'September 2026', prev_month_net_owed: 111317, carried_over_total: 0, possible_duplicates: 0 } },
      pace: { pct_done: 32, sold_so_far: 5262107, target: 16300000, needed_per_day: 501723, actual_per_day: 584679, on_track: true },
      day: { date: '09/Oct/2026', diff: -13823 }, closing: { days: [{ closed: 0 }], incomplete_days: [{ date: 'd', missing: [] }] },
      str: { dispatched_not_received: { all: 3 } }, planning: { fill: { fill_rate_pct: 89.4, window_days: 7, awaiting_dispatch: { count: 5 } }, reorder: { lost_sales_per_day: 39435 }, errors: {} },
    },
  };
  test('six tiles with comparisons, real values and freshness', () => {
    const t = C.snapshotTiles(snap, NOW);
    assert.deepEqual(t.map(x => x.id), ['sales', 'target', 'cash', 'inventory', 'staff', 'str']);
    assert.equal(t[0].label, 'LATEST SALES', 'not "today" unless the entry is today');
    assert.match(t[0].compare, /-10% vs recent average/);
    assert.equal(t[1].value, '32%');
    assert.match(t[1].compare, /on pace/);
    assert.match(t[2].value, /13,823/);
    assert.match(t[4].compare, /nothing carried over/);
    assert.equal(t[4].tone, 'wn');
    assert.match(t[5].compare, /3 dispatched, not received/);
    assert.ok(t.every(x => x.fresh));
  });
  test('"Today" label only when the entry date is today', () => {
    assert.equal(C.isToday('10/Oct/2026', NOW), true);
    assert.equal(C.isToday('2026-10-10', NOW), true);
    assert.equal(C.isToday('09/Oct/2026', NOW), false);
  });
  test('unavailable sources show a dash and the reason, never a zero', () => {
    const t = C.snapshotTiles({ errors: { briefing: 'Sales data is not loaded.' }, systems: { SALES: { status: 'DATA_UNAVAILABLE', availability: { reason: 'Sales data is not loaded.' }, fresh: { label: 'n/a' } } }, raw: { planning: { errors: {} } } }, NOW);
    assert.equal(t[0].value, '—');
    assert.match(t[0].sub, /not loaded/);
    assert.equal(t[0].available, false);
  });
  test('no snapshot → no tiles', () => assert.deepEqual(C.snapshotTiles(null), []));
});
