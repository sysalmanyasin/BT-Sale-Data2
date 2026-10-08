import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../js/ai-center/model.js';

const briefing = (attention, extra = {}) => ({ date: '07/Oct/2026', attention, last_sales_entry: { date: '06/Oct/2026', total_sale: 410000, days_ago: 1 }, missing_sales_days: 0, ...extra });
const NOW = new Date('2026-10-07T10:00:00').getTime();

describe('findings adapter', () => {
  test('maps briefing items into the six systems with evidence from the briefing itself', () => {
    const b = briefing([
      { level: 'warn', area: 'sales', message: 'Cash DIFF Rs 12,000 on 06/Oct/2026.' },
      { level: 'warn', area: 'inventory', message: '3 product(s) that sold in the last 30 days are out of stock.' },
      { level: 'warn', area: 'credit', message: 'Possible duplicate credit entry: Ali Rs 5,000' },
      { level: 'good', area: 'target', message: 'On pace for the October 2026 target.' },
    ], { inventory: { out_of_stock_but_selling: 3, running_out_within_7_days: 1, slow_moving_90d_items: 4, slow_moving_stock_value: 99000, most_urgent: [{ name: 'Panadol', cover_days: 2 }] }, credit: { month: 'October 2026', carried_over_total: 1000, possible_duplicates: 1 } });
    const f = M.buildFindings({ briefing: b, now: NOW });
    assert.deepEqual(f.map(x => x.system).sort(), ['CASH', 'INVENTORY', 'SALES', 'STAFF']);
    const inv = f.find(x => x.system === 'INVENTORY');
    assert.equal(inv.type, 'INVENTORY'); assert.equal(inv.severity, 'warning'); assert.equal(inv.confidence, 'deterministic');
    assert.ok(inv.evidence.some(e => e.kind === 'FACT' && /Panadol/.test(e.value)));
    assert.ok(inv.related_agents.includes('Inventory'));
    assert.equal(f.find(x => x.system === 'SALES').severity, 'good');
    assert.equal(f[f.length - 1].severity, 'good', 'good items sort last');
  });
  test('no data means no findings, never invented ones', () => {
    assert.deepEqual(M.buildFindings({ now: NOW }), []);
    assert.deepEqual(M.buildFindings({ briefing: null, closing: null, strPending: null, now: NOW }), []);
  });
  test('ids are stable when only the numbers change', () => {
    const a = M.buildFindings({ briefing: briefing([{ level: 'warn', area: 'inventory', message: '3 product(s) that sold in the last 30 days are out of stock.' }]), now: NOW })[0].id;
    const b = M.buildFindings({ briefing: briefing([{ level: 'warn', area: 'inventory', message: '7 product(s) that sold in the last 30 days are out of stock.' }]), now: NOW })[0].id;
    assert.equal(a, b);
  });
  test('closing: only days BEFORE today count (today still has shifts to close)', () => {
    const closing = { incomplete_days: [{ date: '2026-10-07', missing: ['Night (pending)'] }, { date: '2026-10-05', missing: ['Evening (draft)'] }] };
    const f = M.buildFindings({ closing, now: NOW });
    assert.equal(f.length, 1); assert.equal(f[0].system, 'CLOSING'); assert.match(f[0].title, /2026-10-05/);
  });
  test('STR: pending incoming 3+ days becomes one finding with its rule stated', () => {
    const f = M.buildFindings({ strPending: { matching: 2, items: [{ str: 'STR-9', age_days: 5, stage: 'dispatched', from: 'DHA' }] }, now: NOW });
    assert.equal(f.length, 1); assert.equal(f[0].system, 'STR');
    assert.ok(f[0].evidence.some(e => e.kind === 'DETECTION'));
    assert.deepEqual(M.buildFindings({ strPending: { matching: 0, items: [] }, now: NOW }), []);
  });
  test('every evidence row uses an allowed kind', () => {
    const f = M.buildFindings({ briefing: briefing([{ level: 'warn', area: 'target', message: 'At the current pace x' }], { target: { target: 1, sold_so_far: 1, pct_done: 1, projected_month_end: 1, days_left: 1, needed_per_day: 1 } }), now: NOW });
    f.forEach(x => x.evidence.forEach(e => assert.ok(M.EVIDENCE_KINDS.includes(e.kind))));
  });
});

describe('system status', () => {
  const warn = { system: 'STR', severity: 'warning' };
  test('ATTENTION / CLEAR from real findings', () => {
    assert.equal(M.systemStatus('STR', [warn], { state: 'ready' }).status, 'ATTENTION');
    assert.equal(M.systemStatus('SALES', [warn], { state: 'ready' }).status, 'CLEAR');
  });
  test('unavailable data is DATA_UNAVAILABLE, never CLEAR', () => {
    assert.equal(M.systemStatus('STR', [], { state: 'error', reason: 'STR data is not loaded yet.' }).status, 'DATA_UNAVAILABLE');
    assert.equal(M.systemStatus('INVENTORY', [], { state: 'empty', reason: 'x' }).status, 'UNKNOWN');
  });
});

describe('core state comes only from real signals', () => {
  const base = { online: true, authed: true, snapshotReady: true, live: { open: null, lastClosed: null } };
  test('idle → monitoring → detecting', () => {
    assert.equal(M.deriveCoreState({ online: true, authed: true }).state, 'IDLE');
    assert.equal(M.deriveCoreState(base).state, 'READY');
    assert.equal(M.deriveCoreState({ ...base, snapshotLoading: true, snapshotReady: false }).state, 'DETECTING');
  });
  test('offline and signed-out win over everything', () => {
    assert.equal(M.deriveCoreState({ ...base, online: false }).state, 'OFFLINE');
    assert.equal(M.deriveCoreState({ ...base, authed: false }).state, 'OFFLINE');
  });
  test('request states: approval > executing > investigating/correlating > analyzing', () => {
    const open = { type: 'request_start', metadata: { question: 'why' } };
    assert.equal(M.deriveCoreState({ ...base, live: { open, pendingApproval: { tool: 'x', metadata: { title: 'T' } }, tools: [] } }).state, 'WAITING_FOR_APPROVAL');
    assert.equal(M.deriveCoreState({ ...base, live: { open, activeTool: { tool: 'add_x', metadata: { risk: 'write' } }, tools: [] } }).state, 'EXECUTING');
    assert.equal(M.deriveCoreState({ ...base, live: { open, activeTool: { tool: 'str_overview', metadata: { risk: 'read' } }, tools: [] } }).state, 'INVESTIGATING');
    assert.equal(M.deriveCoreState({ ...base, live: { open, activeTool: { tool: 'str_overview', metadata: { risk: 'read' } }, routed: { metadata: { domains: ['sales', 'str'] } }, tools: [] } }).state, 'CORRELATING');
    assert.equal(M.deriveCoreState({ ...base, live: { open, activeTool: null, tools: [1] } }).state, 'ANALYZING');
  });
  test('COMPLETE and ERROR are brief, then fall back to MONITORING', () => {
    const now = 1e12;
    assert.equal(M.deriveCoreState({ ...base, now, live: { open: null, lastClosed: { type: 'answer', timestamp: now - 3000 } } }).state, 'COMPLETE');
    assert.equal(M.deriveCoreState({ ...base, now, live: { open: null, lastClosed: { type: 'answer', timestamp: now - 60000 } } }).state, 'MONITORING');
    assert.equal(M.deriveCoreState({ ...base, now, live: { open: null, lastClosed: { type: 'error', timestamp: now - 5000, metadata: { message: 'boom' } } } }).state, 'ERROR');
  });
  test('states BT cannot truthfully report are not in the vocabulary', () => {
    assert.ok(!M.CORE_STATES.includes('RECOMMENDING'));
  });
  test('VERIFYING is reported only while a real read-back is open', () => {
    const base = { online: true, authed: true, snapshotReady: true, now: 1e12 };
    const open = { request_id: 'r1', metadata: {} };
    assert.equal(M.deriveCoreState({ ...base, live: { open, tools: [], verifying: { tool: 'add_staff_note' } } }).state, 'VERIFYING');
    assert.notEqual(M.deriveCoreState({ ...base, live: { open, tools: [], verifying: null } }).state, 'VERIFYING');
  });
});

describe('lifecycle strip', () => {
  test('nothing reached without events, except detect once data was read', () => {
    const l = M.deriveLifecycle([], true);
    assert.deepEqual(l.filter(s => s.reached).map(s => s.id), ['detect']);
    assert.deepEqual(M.deriveLifecycle([], false).filter(s => s.reached), []);
  });
  test('stages light up only from matching real events; verify only after a real verify_end', () => {
    const evs = [{ type: 'routed', metadata: { domains: ['sales', 'str'] } }, { type: 'tool_start' }, { type: 'tool_end', status: 'ok', metadata: { risk: 'read' } }, { type: 'step' }, { type: 'answer' }];
    const on = M.deriveLifecycle(evs, true).filter(s => s.reached).map(s => s.id);
    // an answer is NOT a recommendation, and two domains + a finished tool is NOT a correlation
    assert.deepEqual(on, ['detect', 'understand', 'investigate', 'reason']);
    const w = M.deriveLifecycle([{ type: 'approval_requested' }, { type: 'tool_end', status: 'ok', metadata: { risk: 'write' } }], false);
    assert.ok(w.find(s => s.id === 'act').reached); assert.ok(w.find(s => s.id === 'approve').reached);
    assert.equal(w.find(s => s.id === 'audit').reached, false, 'a successful write is not an audit record');
    assert.equal(w.find(s => s.id === 'verify').reached, false); assert.equal(w.find(s => s.id === 'verify').available, true);
    const v1 = M.deriveLifecycle([{ type: 'verify_end', status: 'ok' }], false).find(s => s.id === 'verify');
    assert.equal(v1.reached, true); assert.equal(v1.failed, false);
    assert.equal(M.deriveLifecycle([{ type: 'verify_end', status: 'failed' }], false).find(s => s.id === 'verify').failed, true);
  });
  test('recommend, correlate and audit light only from their own events; a failed audit is flagged', () => {
    const on = evs => M.deriveLifecycle(evs, false).filter(s => s.reached).map(s => s.id);
    assert.deepEqual(on([{ type: 'recommendation' }]), ['recommend']);
    assert.deepEqual(on([{ type: 'correlation' }]), ['correlate']);
    assert.deepEqual(on([{ type: 'audit', status: 'ok' }]), ['audit']);
    assert.equal(M.deriveLifecycle([{ type: 'audit', status: 'ok' }], false).find(s => s.id === 'audit').failed, false);
    assert.equal(M.deriveLifecycle([{ type: 'audit', status: 'failed' }], false).find(s => s.id === 'audit').failed, true);
  });
});

describe('freshness and health rules', () => {
  const H = 3600000;
  test('freshness thresholds', () => {
    const now = 1e12;
    assert.equal(M.freshness(now - H, { warnMs: 26 * H, errMs: 72 * H }, now).status, 'HEALTHY');
    assert.equal(M.freshness(now - 30 * H, { warnMs: 26 * H, errMs: 72 * H }, now).status, 'WARNING');
    assert.equal(M.freshness(now - 100 * H, { warnMs: 26 * H, errMs: 72 * H }, now).status, 'ERROR');
    assert.equal(M.freshness(null, { warnMs: 1, errMs: 2 }, now).status, 'UNKNOWN');
  });
  test('provider health: no calls is UNKNOWN, not healthy', () => {
    assert.equal(M.providerHealth([]).status, 'UNKNOWN');
    assert.equal(M.providerHealth([{ calls: 10, failed: 0 }]).status, 'HEALTHY');
    assert.equal(M.providerHealth([{ calls: 10, failed: 2 }]).status, 'DEGRADED');
    assert.equal(M.providerHealth([{ calls: 10, failed: 6 }]).status, 'ERROR');
  });
  test('age labels', () => {
    assert.equal(M.ageLabel(null), 'never');
    assert.equal(M.ageLabel(1e12 - 30000, 1e12), '30 sec ago');
    assert.equal(M.ageLabel(1e12 - 5 * 60000, 1e12), '5 min ago');
  });
});

describe('forecast', () => {
  const pace = { month: 'October 2026', target: 1000000, sold_so_far: 200000, pct_done: 20, needed_per_day: 40000, actual_per_day: 30000, days_left: 20, on_track: false };
  test('numbers are copied from the pace tool, summary says behind', () => {
    const f = M.buildForecast(pace, { projected_month_end: 900000 });
    assert.ok(f.available); assert.match(f.summary, /Behind pace/); assert.equal(f.disagree, false);
  });
  test('disagreement between the two existing calculations is surfaced, not hidden', () => {
    const f = M.buildForecast({ ...pace, on_track: true }, { projected_month_end: 900000 });
    assert.equal(f.disagree, true);
  });
  test('unavailable pace is reported as unavailable', () => {
    assert.equal(M.buildForecast({ error: 'No target set for X' }, null).available, false);
    assert.equal(M.buildForecast(null, null).available, false);
  });
});

describe('timeline helpers', () => {
  test('filters', () => {
    const toolWrite = { type: 'tool_end', metadata: { risk: 'write' } }, toolRead = { type: 'tool_end', metadata: { risk: 'read' } };
    assert.ok(M.eventMatches(toolWrite, 'actions')); assert.ok(!M.eventMatches(toolRead, 'actions'));
    assert.ok(M.eventMatches(toolRead, 'tools')); assert.ok(M.eventMatches({ type: 'approval_requested' }, 'approvals'));
    assert.ok(M.eventMatches({ type: 'snapshot', source: 'ai-center' }, 'system')); assert.ok(M.eventMatches(toolRead, 'all'));
  });
  test('describeEvent covers failure text and never throws', () => {
    assert.match(M.describeEvent({ type: 'tool_end', tool: 'x', status: 'failed', duration: 5, metadata: { error: 'boom' } }), /failed: boom · 5 ms/);
    assert.doesNotThrow(() => M.describeEvent({ type: 'something_new' }));
  });
  test('diffFindings', () => {
    const d = M.diffFindings([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
    assert.deepEqual(d.added.map(x => x.id), ['c']); assert.deepEqual(d.cleared.map(x => x.id), ['a']);
  });
});
