// ══════════════════════════════════════════════════════════════════════
// AI CENTER — PURE MODEL
//
// Translates what BT ALREADY computes (daily_briefing, closing_recent_days,
// str_overview, get_target_pace, bridge sync stamps, agent telemetry) into
// presentation models. NO business maths lives here: every number shown is
// copied from an existing tool result. This file only:
//   • maps existing results → unified Findings / system cards
//   • derives the BT core state from REAL telemetry
//   • derives the lifecycle strip from REAL events
//   • applies freshness / health RULES to real timestamps
// No DOM, no Supabase, no app imports → unit-testable.
// ══════════════════════════════════════════════════════════════════════

export const SYSTEMS = Object.freeze(['SALES', 'CASH', 'INVENTORY', 'STAFF', 'STR', 'CLOSING']);

/** Where "open the source" goes for each system (existing hash routes only). */
export const SYSTEM_PAGE = Object.freeze({
  SALES: '#dashboard', CASH: '#diff', INVENTORY: '#inv-health', STAFF: '#manager-dashboard', STR: '#str', CLOSING: '#closing-book',
});

/** Which existing specialist(s) / tools back each system (mirrors js/agent/core/router.js + specialists.js). */
export const SYSTEM_SOURCES = Object.freeze({
  SALES:     { agents: ['Sales'],                 tools: ['get_sales_summary', 'get_daily_sales', 'get_target_pace', 'top_sales_days', 'compare_sales_months'] },
  CASH:      { agents: ['Sales', 'Staff & money'], tools: ['get_daily_sales', 'get_ledger_entries', 'get_ledger_month_totals'] },
  INVENTORY: { agents: ['Inventory'],             tools: ['inventory_overview', 'low_stock_items', 'low_cover_items', 'slow_moving_stock'] },
  STAFF:     { agents: ['Staff & money'],         tools: ['get_staff_credit', 'list_staff', 'get_staff_notes'] },
  STR:       { agents: ['Stock transfers'],       tools: ['str_overview', 'list_pending_strs', 'get_str_detail'] },
  CLOSING:   { agents: ['Closing'],               tools: ['closing_status', 'closing_recent_days'] },
});

export const EVIDENCE_KINDS = Object.freeze(['FACT', 'CALCULATION', 'DETECTION', 'CORRELATION', 'AI INTERPRETATION', 'PREDICTION', 'RECOMMENDATION']);

const digitsToHash = s => String(s || '').toLowerCase().replace(/[0-9][0-9,./]*/g, '#').replace(/\s+/g, ' ').trim();
export function stableId(system, source, message) {
  const str = system + '|' + source + '|' + digitsToHash(message);
  let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'f_' + (h >>> 0).toString(36);
}

/** Which of the six systems does one briefing item belong to? */
export function systemOfBriefingItem(item) {
  const m = String(item.message || '');
  if (/^Cash DIFF/i.test(m)) return 'CASH';
  if (item.area === 'inventory') return 'INVENTORY';
  if (item.area === 'credit') return 'STAFF';
  if (item.area === 'ledger') return 'CASH';
  return 'SALES'; // sales + target
}

const TYPE_RULES = [
  [/^Cash DIFF/i, 'CASH'], [/below the same weekday|above the recent/i, 'ANOMALY'], [/duplicate/i, 'ANOMALY'],
  [/target.*achieved|on pace/i, 'PERFORMANCE'], [/target|pace|projection|project/i, 'FORECAST'],
  [/out of stock|run out|not sold in 90|slow/i, 'INVENTORY'], [/credit|carried/i, 'STAFF'], [/no sales entry|sales entry/i, 'WARNING'],
];
function typeOf(item, system) {
  for (const [re, t] of TYPE_RULES) if (re.test(item.message)) return t;
  return system;
}

/** Deterministic evidence rows for a briefing item, copied from the briefing's own structured output. */
export function evidenceFor(item, b) {
  const ev = [{ kind: 'DETECTION', label: 'Rule', value: item.message }];
  const A = item.area;
  if (A === 'sales' && b.last_sales_entry) ev.push({ kind: 'FACT', label: 'Latest sales entry', value: b.last_sales_entry.date + ' · TOTAL Rs ' + fmtNum(b.last_sales_entry.total_sale) });
  if (A === 'sales' && b.latest_vs_last_week_pct != null && /weekday/.test(item.message)) ev.push({ kind: 'CALCULATION', label: 'vs same weekday last week', value: b.latest_vs_last_week_pct + '%' });
  if (A === 'sales' && b.yesterday && /Yesterday/.test(item.message)) ev.push({ kind: 'FACT', label: 'Yesterday', value: 'TOTAL Rs ' + fmtNum(b.yesterday.total_sale) });
  if (A === 'sales' && b.yesterday && b.yesterday.vs_recent_avg_pct != null && /recent daily average/.test(item.message)) ev.push({ kind: 'CALCULATION', label: 'vs recent average', value: b.yesterday.vs_recent_avg_pct + '%' });
  if (A === 'sales' && /no sales entry/.test(item.message)) ev.push({ kind: 'CALCULATION', label: 'Missing days this month', value: String(b.missing_sales_days) });
  if (A === 'target' && b.target) {
    const t = b.target;
    ev.push({ kind: 'FACT', label: 'Target', value: 'Rs ' + fmtNum(t.target) }, { kind: 'FACT', label: 'Sold so far', value: 'Rs ' + fmtNum(t.sold_so_far) });
    ev.push({ kind: 'CALCULATION', label: 'Done', value: t.pct_done + '%' }, { kind: 'CALCULATION', label: 'Needed per day', value: 'Rs ' + fmtNum(t.needed_per_day) + ' for ' + t.days_left + ' day(s)' });
    ev.push({ kind: 'PREDICTION', label: 'Projected month-end (average × days)', value: 'Rs ' + fmtNum(t.projected_month_end) });
  }
  if (A === 'credit' && b.credit) ev.push({ kind: 'CALCULATION', label: 'Carried-over credit (' + b.credit.month + ')', value: 'Rs ' + fmtNum(b.credit.carried_over_total) }, { kind: 'DETECTION', label: 'Possible duplicate credit entries', value: String(b.credit.possible_duplicates) });
  if (A === 'ledger') ev.push({ kind: 'CALCULATION', label: 'Possible duplicate ledger entries (7 days)', value: String(b.possible_duplicate_ledger_entries || 0) });
  if (A === 'inventory' && b.inventory) {
    const i = b.inventory;
    ev.push({ kind: 'CALCULATION', label: 'Out of stock but selling (30d)', value: String(i.out_of_stock_but_selling) }, { kind: 'CALCULATION', label: 'Run out within 7 days', value: String(i.running_out_within_7_days) });
    if (i.most_urgent && i.most_urgent.length) ev.push({ kind: 'FACT', label: 'Most urgent', value: i.most_urgent.slice(0, 3).map(x => x.name + ' (' + x.cover_days + 'd cover)').join(', ') });
    ev.push({ kind: 'CALCULATION', label: 'Not sold in 90+ days', value: i.slow_moving_90d_items + ' items · Rs ' + fmtNum(i.slow_moving_stock_value) });
  }
  return ev;
}

export const fmtNum = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n).toLocaleString('en-PK') : String(v); };

const SEVERITY = { warn: 'warning', info: 'info', good: 'good' };

/**
 * Unified Finding from every source we have. `snap` = { briefing, closing, str, strPending, now }.
 * Each field can be null (source unavailable) — then it simply contributes nothing; availability is
 * reported separately by the system cards, never papered over here.
 */
export function buildFindings(snap) {
  const now = snap.now || Date.now();
  const out = [];
  const push = f => out.push({ confidence: 'deterministic', approval_required: false, status: 'open', audit_reference: null, related_entities: [], detected_at: now, ...f, id: stableId(f.system, f.source, f.title) });

  const b = snap.briefing;
  if (b && Array.isArray(b.attention)) {
    for (const item of b.attention) {
      const system = systemOfBriefingItem(item);
      const src = SYSTEM_SOURCES[system];
      push({
        type: typeOf(item, system), severity: SEVERITY[item.level] || 'info', system, source: 'daily_briefing',
        title: item.message, description: item.message, evidence: evidenceFor(item, b),
        related_agents: src.agents, related_tools: ['daily_briefing', ...src.tools.slice(0, 2)],
        recommendation: null, action: { kind: 'open', href: SYSTEM_PAGE[system] },
      });
    }
  }

  // Closing: days BEFORE today with a shift that is not closed (closing_recent_days result).
  const c = snap.closing;
  if (c && Array.isArray(c.incomplete_days)) {
    const today = isoDay(new Date(now));
    for (const d of c.incomplete_days.filter(x => x.date < today)) {
      push({
        type: 'CLOSING', severity: 'warning', system: 'CLOSING', source: 'closing_recent_days',
        title: 'Closing incomplete for ' + d.date + ': ' + d.missing.join(', '),
        description: 'These shifts have no closed entry in the Closing Book.',
        evidence: [{ kind: 'DETECTION', label: 'Shifts not closed', value: d.missing.join(', ') }, { kind: 'FACT', label: 'Date', value: d.date }],
        related_agents: SYSTEM_SOURCES.CLOSING.agents, related_tools: SYSTEM_SOURCES.CLOSING.tools,
        recommendation: null, action: { kind: 'open', href: SYSTEM_PAGE.CLOSING },
      });
    }
  }

  // STR: incoming transfers unreceived for 3+ days — the same rule as the ntfy briefing.
  const sp = snap.strPending;
  if (sp && sp.matching > 0) {
    const first = sp.items && sp.items[0];
    push({
      type: 'STR', severity: 'warning', system: 'STR', source: 'list_pending_strs',
      title: sp.matching + ' incoming STR(s) unreceived for 3+ days',
      description: first ? 'Oldest: ' + first.str + ' (' + first.age_days + ' days, ' + first.stage + ').' : 'See the STR page.',
      evidence: [{ kind: 'DETECTION', label: 'Rule', value: 'Incoming STR not received for 3+ days (same rule as the daily push briefing)' }, { kind: 'CALCULATION', label: 'Matching STRs', value: String(sp.matching) }].concat(first ? [{ kind: 'FACT', label: 'Oldest', value: first.str + ' · ' + first.age_days + 'd · ' + first.stage + (first.from ? ' · from ' + first.from : '') }] : []),
      related_agents: SYSTEM_SOURCES.STR.agents, related_tools: SYSTEM_SOURCES.STR.tools,
      recommendation: null, action: { kind: 'open', href: SYSTEM_PAGE.STR },
    });
  }

  const rank = { warning: 0, error: 0, info: 1, good: 2 };
  return out.sort((a, b2) => (rank[a.severity] ?? 3) - (rank[b2.severity] ?? 3));
}

export function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/** Health of one business system. NEVER a made-up percentage: a status word + the real counts behind it. */
export function systemStatus(system, findings, availability) {
  if (availability && availability.state && availability.state !== 'ready') {
    return { status: availability.state === 'unauthorized' ? 'UNAUTHORIZED' : 'UNKNOWN', reason: availability.reason || 'Data not available', warnings: 0 };
  }
  const mine = findings.filter(f => f.system === system);
  const warns = mine.filter(f => f.severity === 'warning' || f.severity === 'error').length;
  if (warns) return { status: 'ATTENTION', reason: warns + ' finding' + (warns === 1 ? '' : 's') + ' need review', warnings: warns };
  return { status: 'CLEAR', reason: mine.some(f => f.severity === 'good') ? 'On track' : 'No open findings', warnings: 0 };
}

// ───────────────────────── BT core state (from REAL telemetry) ─────────────────────────
export const CORE_STATES = Object.freeze(['IDLE', 'MONITORING', 'DETECTING', 'INVESTIGATING', 'CORRELATING', 'ANALYZING', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'COMPLETE', 'ERROR', 'OFFLINE']);
const DONE_FLASH_MS = 12000, ERROR_FLASH_MS = 60000;

/**
 * @param {object} i { online, authed, snapshotLoading, snapshotReady, live (telemetry.liveState()), now }
 * RECOMMENDING / VERIFYING are deliberately never reported: nothing in BT emits those moments, so claiming them would be invented.
 */
export function deriveCoreState({ online = true, authed = true, snapshotLoading = false, snapshotReady = false, live = null, now = Date.now() } = {}) {
  if (!online) return { state: 'OFFLINE', detail: 'No network connection. Showing last known data.' };
  if (!authed) return { state: 'OFFLINE', detail: 'Not signed in. BT cannot read live data.' };
  if (live && live.open) {
    const q = live.open.metadata && live.open.metadata.question;
    if (live.pendingApproval) return { state: 'WAITING_FOR_APPROVAL', detail: 'Waiting for your approval: ' + ((live.pendingApproval.metadata && live.pendingApproval.metadata.title) || live.pendingApproval.tool) };
    const at = live.activeTool;
    if (at && at.metadata && (at.metadata.risk === 'write' || at.metadata.risk === 'critical')) return { state: 'EXECUTING', detail: 'Running ' + at.tool };
    const multi = live.routed && live.routed.metadata && Array.isArray(live.routed.metadata.domains) && live.routed.metadata.domains.length > 1;
    if (at) return { state: multi ? 'CORRELATING' : 'INVESTIGATING', detail: (multi ? 'Cross-domain: ' : '') + 'checking ' + at.tool + (q ? ' for "' + q + '"' : '') };
    return { state: 'ANALYZING', detail: 'Reasoning over ' + live.tools.length + ' tool result(s)' + (q ? ' for "' + q + '"' : '') };
  }
  const lc = live && live.lastClosed;
  if (lc && lc.type === 'error' && now - lc.timestamp < ERROR_FLASH_MS) return { state: 'ERROR', detail: (lc.metadata && lc.metadata.message) || 'The last request failed.' };
  if (lc && lc.type === 'answer' && now - lc.timestamp < DONE_FLASH_MS) return { state: 'COMPLETE', detail: 'Last request finished.' };
  if (snapshotLoading) return { state: 'DETECTING', detail: 'Reading current business data.' };
  if (snapshotReady) return { state: 'MONITORING', detail: 'Watching your business data.' };
  return { state: 'IDLE', detail: 'Waiting for first read.' };
}

// ───────────────────────── lifecycle strip (from REAL events) ─────────────────────────
export const LIFECYCLE = Object.freeze([
  ['detect', 'Detect'], ['understand', 'Understand'], ['investigate', 'Investigate'], ['correlate', 'Correlate'], ['reason', 'Reason'],
  ['recommend', 'Recommend'], ['approve', 'Approval'], ['act', 'Act'], ['verify', 'Verify'], ['audit', 'Audit'],
]);

/** @param events newest-first events of ONE request (or []); @param detected whether a monitoring read has produced findings. */
export function deriveLifecycle(events, detected) {
  const ev = events || [];
  const has = t => ev.some(e => e.type === t);
  const routed = ev.find(e => e.type === 'routed');
  const multi = !!(routed && routed.metadata && Array.isArray(routed.metadata.domains) && routed.metadata.domains.length > 1);
  const writeDone = ev.some(e => e.type === 'tool_end' && e.status === 'ok' && e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical'));
  const reached = {
    detect: !!detected, understand: has('routed'), investigate: has('tool_start'), correlate: multi && has('tool_end'),
    reason: has('step'), recommend: has('answer'), approve: has('approval_requested'), act: writeDone, verify: false, audit: writeDone,
  };
  return LIFECYCLE.map(([id, label]) => ({ id, label, reached: !!reached[id], available: id !== 'verify' }));
}

// ───────────────────────── freshness + health rules ─────────────────────────
export function ageLabel(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + ' sec ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}

/** age → HEALTHY / WARNING / ERROR by thresholds. null/NaN age → UNKNOWN. */
export function freshness(ts, { warnMs, errMs }, now = Date.now()) {
  if (!ts || !Number.isFinite(ts)) return { status: 'UNKNOWN', label: 'no timestamp' };
  const age = now - ts;
  return { status: age > errMs ? 'ERROR' : age > warnMs ? 'WARNING' : 'HEALTHY', label: ageLabel(ts, now), stale: age > warnMs };
}

/** summarizeUsage() rows → agent/provider health. UNKNOWN when there were no calls (we do not guess). */
export function providerHealth(rows) {
  const calls = rows.reduce((a, r) => a + r.calls, 0), failed = rows.reduce((a, r) => a + r.failed, 0);
  if (!calls) return { status: 'UNKNOWN', detail: 'No AI calls in the last 24 hours.' };
  const rate = failed / calls;
  const detail = calls + ' calls · ' + failed + ' failed in 24h';
  return { status: rate >= 0.5 ? 'ERROR' : rate >= 0.15 ? 'DEGRADED' : 'HEALTHY', detail };
}

export const STATUS_TONE = Object.freeze({ HEALTHY: 'ok', CLEAR: 'ok', DEGRADED: 'wn', WARNING: 'wn', ATTENTION: 'wn', ERROR: 'cr', OFFLINE: 'cr', UNAUTHORIZED: 'cr', UNKNOWN: 'mu' });

// ───────────────────────── forecast (two existing calculations, shown side by side) ─────────────────────────
/**
 * Authoritative = Analytics.getTargetPaceForMonth (what the Dashboard and `get_target_pace` use).
 * The briefing carries its own average×days projection. Both are real; if they disagree on "will the target
 * be met?" we SAY SO instead of silently picking one.
 */
export function buildForecast(pace, briefingTarget) {
  if (!pace || pace.error) return { available: false, reason: (pace && pace.error) || 'Target pace not available.' };
  const proj = briefingTarget ? briefingTarget.projected_month_end : null;
  const paceSaysBehind = pace.on_track === false;
  const projSaysBehind = proj != null ? proj < Number(pace.target) : null;
  const disagree = projSaysBehind != null && projSaysBehind !== paceSaysBehind;
  const gap = Number(pace.needed_per_day) - Number(pace.actual_per_day);
  const summary = pace.pct_done >= 100 ? 'Target for ' + pace.month + ' is achieved.'
    : paceSaysBehind
      ? 'Behind pace: Rs ' + fmtNum(pace.actual_per_day) + '/day against Rs ' + fmtNum(pace.needed_per_day) + '/day needed over the last ' + pace.days_left + ' day(s) (Rs ' + fmtNum(gap) + '/day short).'
      : 'On pace: Rs ' + fmtNum(pace.actual_per_day) + '/day against Rs ' + fmtNum(pace.needed_per_day) + '/day needed.';
  return { available: true, pace, projection: proj, disagree, summary };
}

// ───────────────────────── activity timeline ─────────────────────────
export const FILTERS = Object.freeze([['all', 'All'], ['bt', 'BT'], ['agents', 'Agents'], ['tools', 'Tools'], ['findings', 'Findings'], ['actions', 'Actions'], ['approvals', 'Approvals'], ['system', 'System']]);

const isChangeRisk = e => !!(e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical'));
export function eventMatches(e, filter) {
  switch (filter) {
    case 'bt': return ['request_start', 'answer', 'instant', 'error', 'cancelled', 'writes_killed'].includes(e.type);
    case 'agents': return ['request_start', 'routed', 'step'].includes(e.type);
    case 'tools': return e.type === 'tool_start' || e.type === 'tool_end';
    case 'findings': return e.type === 'finding_new' || e.type === 'finding_cleared';
    case 'actions': return (e.type === 'tool_end' || e.type === 'tool_start') && isChangeRisk(e);
    case 'approvals': return e.type === 'approval_requested' || e.type === 'approval_resolved';
    case 'system': return e.source === 'ai-center' || e.source === 'server' || e.type === 'snapshot';
    default: return true;
  }
}

/** One human line per REAL event. Never invents wording about reasoning we did not observe. */
export function describeEvent(e) {
  const m = e.metadata || {}, who = e.agent ? e.agent + ' · ' : '';
  switch (e.type) {
    case 'request_start': return 'Request received' + (m.question ? ': "' + m.question + '"' : '');
    case 'routed': return who + 'handling this (' + (m.by === 'model' ? 'model-assisted' : 'rule') + ' routing' + (m.domains && m.domains.length > 1 ? ', cross-domain: ' + m.domains.join(' + ') : '') + ')';
    case 'step': return 'Model step ' + m.step + ' of max ' + m.max;
    case 'tool_start': return (e.source === 'ai-center' ? 'AI Center read ' : 'Running ') + e.tool;
    case 'tool_end': return e.tool + (e.status === 'ok' ? ' finished' : e.status === 'rejected' ? ' rejected by you' : ' failed' + (m.error ? ': ' + m.error : '')) + (e.duration != null ? ' · ' + e.duration + ' ms' : '');
    case 'approval_requested': return 'Approval requested: ' + (m.title || e.tool);
    case 'approval_resolved': return 'Change ' + e.status + ': ' + e.tool;
    case 'answer': return 'Answer produced in ' + m.steps + ' step(s)';
    case 'instant': return 'Answered instantly with no model call (' + (e.tool || 'local') + ')';
    case 'error': return 'Request failed: ' + (m.message || 'unknown error');
    case 'cancelled': return 'Request cancelled';
    case 'writes_killed': return 'Server kill switch is ON: changes stopped';
    case 'finding_new': return 'New finding: ' + (m.title || '');
    case 'finding_cleared': return 'Finding no longer present: ' + (m.title || '');
    case 'snapshot': return 'Monitoring read complete: ' + m.reads + ' sources, ' + m.findings + ' finding(s)' + (m.failed ? ', ' + m.failed + ' unavailable' : '');
    default: return e.type;
  }
}

/** Compare two finding lists → what is new / what disappeared (by stable id). */
export function diffFindings(prev, curr) {
  const p = new Map((prev || []).map(f => [f.id, f])), c = new Map((curr || []).map(f => [f.id, f]));
  return { added: [...c.values()].filter(f => !p.has(f.id)), cleared: [...p.values()].filter(f => !c.has(f.id)) };
}
