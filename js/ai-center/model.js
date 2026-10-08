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

// Which business-area specialists investigate a finding of this system (the orchestrator then adds related areas).
// CASH and STAFF are both owned by the 'Staff & money' specialist (ledger, credit, notes).
export const FINDING_DOMAINS = Object.freeze({ SALES: ['sales'], CASH: ['manager'], INVENTORY: ['inventory'], STAFF: ['manager'], STR: ['str'], CLOSING: ['closing'] });
export const domainsForFinding = f => (f && FINDING_DOMAINS[f.system] ? [...FINDING_DOMAINS[f.system]] : []);

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

export const fmtDur = ms => (ms == null ? '' : ms < 1000 ? Math.round(ms) + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.floor(ms / 60000) + ' min ' + Math.round((ms % 60000) / 1000) + ' s');
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

  // Fixed, rule-based guidance + entity/audit references for every finding (section 11). Not AI-written.
  out.forEach(f => {
    const g = guidanceFor(f.type, f.system);
    f.recommendation = f.recommendation || g.rec;
    f.if_act = g.ifAct;
    f.related_entities = relatedEntitiesOf(f);
    f.audit_reference = 'rule:' + f.source + '#' + f.id;
  });
  const rank = { warning: 0, error: 0, info: 1, good: 2 };
  return out.sort((a, b2) => (rank[a.severity] ?? 3) - (rank[b2.severity] ?? 3));
}

export function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/** Health of one business system. NEVER a made-up percentage: a status word + the real counts behind it. */
export function systemStatus(system, findings, availability) {
  if (availability && availability.state && availability.state !== 'ready') {
    return { status: availability.state === 'unauthorized' ? 'UNAUTHORIZED' : 'DATA_UNAVAILABLE', reason: availability.reason || 'Data not available', warnings: 0 };
  }
  const mine = findings.filter(f => f.system === system);
  const warns = mine.filter(f => f.severity === 'warning' || f.severity === 'error').length;
  if (warns) return { status: 'ATTENTION', reason: warns + ' finding' + (warns === 1 ? '' : 's') + ' need review', warnings: warns };
  return { status: 'CLEAR', reason: mine.some(f => f.severity === 'good') ? 'On track' : 'No open findings', warnings: 0 };
}

// ───────────────────────── BT core state (from REAL telemetry) ─────────────────────────
export const CORE_STATES = Object.freeze(['IDLE', 'READY', 'DETECTING', 'INVESTIGATING', 'CORRELATING', 'ANALYZING', 'WAITING_FOR_APPROVAL', 'EXECUTING', 'VERIFYING', 'COMPLETE', 'ERROR', 'OFFLINE']);
const DONE_FLASH_MS = 12000, ERROR_FLASH_MS = 60000;

/**
 * @param {object} i { online, authed, snapshotLoading, snapshotReady, live (telemetry.liveState()), now }
 * RECOMMENDING is deliberately never reported: nothing in BT emits that moment. VERIFYING is real: it is reported only between a
 * verify_start and verify_end event (the read-back that runs after an approved change).
 */
export function deriveCoreState({ online = true, authed = true, snapshotLoading = false, snapshotReady = false, live = null, now = Date.now() } = {}) {
  if (!online) return { state: 'OFFLINE', detail: 'No network connection. Showing last known data.' };
  if (!authed) return { state: 'OFFLINE', detail: 'Not signed in. BT cannot read live data.' };
  if (live && live.open) {
    const q = live.open.metadata && live.open.metadata.question;
    if (live.pendingApproval) return { state: 'WAITING_FOR_APPROVAL', detail: 'Waiting for your approval: ' + ((live.pendingApproval.metadata && live.pendingApproval.metadata.title) || live.pendingApproval.tool) };
    if (live.verifying) return { state: 'VERIFYING', detail: 'Reading the change back from the app data to confirm it: ' + live.verifying.tool };
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
  if (snapshotReady) return { state: 'READY', detail: 'Current business snapshot loaded. Refresh to update; no background polling.' };
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
  const writeDone = ev.some(e => e.type === 'tool_end' && e.status === 'ok' && e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical'));
  const reached = {
    // Every stage needs ITS OWN real event. `recommend` is no longer inferred from `answer`, `correlate` is no longer
    // inferred from "two domains + a tool finished", and `audit` is no longer inferred from "a write succeeded":
    // a stage lights only when the matching event (recommendation / correlation / audit) was actually emitted.
    detect: !!detected, understand: has('routed'), investigate: has('tool_start'), correlate: has('correlation'),
    reason: has('step'), recommend: has('recommendation'), approve: has('approval_requested'), act: writeDone, verify: has('verify_end'), audit: has('audit'),
  };
  const vEnd = ev.find(e => e.type === 'verify_end'), aud = ev.find(e => e.type === 'audit');
  return LIFECYCLE.map(([id, label]) => ({ id, label, reached: !!reached[id], available: true,
    ...(id === 'verify' && vEnd ? { failed: vEnd.status !== 'ok' } : {}), ...(id === 'audit' && aud ? { failed: aud.status === 'failed' } : {}) }));
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
  if (!ts || !Number.isFinite(ts)) return { status: 'NOT_MONITORED', label: 'No freshness signal is exposed.' };
  const age = now - ts;
  return { status: age > errMs ? 'ERROR' : age > warnMs ? 'WARNING' : 'HEALTHY', label: ageLabel(ts, now), stale: age > warnMs };
}

/** summarizeUsage() rows → agent/provider health. UNKNOWN when there were no calls (we do not guess). */
export function providerHealth(rows) {
  const calls = rows.reduce((a, r) => a + r.calls, 0), failed = rows.reduce((a, r) => a + r.failed, 0);
  if (!calls) return { status: 'NOT_MEASURED', detail: 'No AI calls in the last 24 hours, so provider health is not measured.' };
  const rate = failed / calls;
  const detail = calls + ' calls · ' + failed + ' failed in 24h';
  return { status: rate >= 0.5 ? 'ERROR' : rate >= 0.15 ? 'DEGRADED' : 'HEALTHY', detail };
}

export const STATUS_TONE = Object.freeze({ HEALTHY: 'ok', CLEAR: 'ok', DEGRADED: 'wn', WARNING: 'wn', ATTENTION: 'wn', ERROR: 'cr', OFFLINE: 'cr', UNAUTHORIZED: 'cr', DATA_UNAVAILABLE: 'wn', NOT_MONITORED: 'mu', NOT_MEASURED: 'mu', CHECK_FAILED: 'wn', INFO: 'mu' });

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
    case 'agents': return ['request_start', 'routed', 'step', 'specialist_start', 'specialist_end', 'evidence_bundle', 'synthesis', 'correlation'].includes(e.type);
    case 'tools': return e.type === 'tool_start' || e.type === 'tool_end' || e.type === 'verify_start' || e.type === 'verify_end';
    case 'findings': return e.type === 'finding_new' || e.type === 'finding_cleared';
    case 'actions': return ((e.type === 'tool_end' || e.type === 'tool_start') && isChangeRisk(e)) || ['verify_start', 'verify_end', 'recommendation', 'audit', 'undo'].includes(e.type);
    case 'approvals': return e.type === 'approval_requested' || e.type === 'approval_resolved';
    case 'system': return e.source === 'ai-center' || e.source === 'server' || e.type === 'snapshot' || e.type === 'retry';
    default: return true;
  }
}

/** One human line per REAL event. Never invents wording about reasoning we did not observe. */
export function describeEvent(e) {
  const m = e.metadata || {}, who = e.agent ? e.agent + ' · ' : '';
  switch (e.type) {
    case 'request_start': return 'Request received' + (m.question ? ': "' + m.question + '"' : '');
    case 'routed': return who + 'handling this (' + (m.by === 'model' ? 'model-assisted' : 'rule') + ' routing' + (m.domains && m.domains.length > 1 ? ', cross-domain: ' + m.domains.join(' + ') : '') + ')';
    case 'specialist_start': return (m.specialist || 'specialist') + ' specialist started' + (m.mode === 'single_run' ? ' (one run; domains: ' + ((m.domains || []).join(' + ') || 'general') + ')' : m.mode === 'independent' ? ' (independent investigation run)' : m.mode === 'synthesis' ? ' (combining the specialists\' evidence)' : '');
    case 'specialist_end': return (m.specialist || 'specialist') + ' specialist ' + (e.status === 'ok' ? 'finished' : e.status === 'cancelled' ? 'was cancelled' : 'FAILED' + (m.error ? ' (' + m.error + ')' : '')) + (m.tools != null ? ' - ' + m.tools + ' tool call(s)' : '') + (e.duration != null ? ' in ' + fmtDur(e.duration) : '');
    case 'evidence_bundle': return 'Evidence gathered: ' + m.grounded + ' of ' + m.members + ' specialists returned tool data' + (m.failed ? ', ' + m.failed + ' failed' : '') + (m.ungrounded && m.ungrounded.length ? ', ' + m.ungrounded.length + ' answered without data (not used)' : '');
    case 'synthesis': return e.status === 'failed' ? 'Analyst could not combine the evidence' + (m.error ? ': ' + m.error : '') : 'Analyst assessment: confidence ' + (m.confidence || 'not rated') + ', ' + (m.agreements || 0) + ' agreement(s), ' + (m.conflicts || 0) + ' conflict(s), ' + (m.correlations || 0) + ' possible correlation(s)' + (e.status === 'unstructured' ? ' (unstructured reply)' : '');
    case 'correlation': return 'Possible correlation (not proof of cause): ' + ((m.between || []).join(' / ')) + ' - ' + (m.statement || '') + (m.causal_language ? ' [wording claimed a cause: unproven]' : '');
    case 'recommendation': return m.kind === 'investigation_advice'
      ? 'Recommendation (' + (m.action_type || 'advice') + (m.requires_approval ? ', any change needs your approval' : ', changes nothing') + (m.confidence && m.confidence !== 'unrated' ? ', confidence ' + m.confidence : '') + '): ' + (m.title || '')
      : 'Recommendation: ' + (m.title || e.tool) + (m.requires_approval ? ' (needs your approval' + (m.reversible ? ', reversible)' : ', not reversible)') : '');
    case 'audit': return e.status === 'ok' ? 'Audit recorded: ' + e.tool : e.status === 'local_only' ? 'Audit kept on this device only (cloud log unavailable): ' + e.tool : 'AUDIT NOT RECORDED: ' + e.tool + (m.error ? ' (' + m.error + ')' : '');
    case 'undo': return (e.status === 'ok' ? 'Undone: ' : 'Undo failed: ') + (m.label || e.tool) + (e.status === 'ok' ? '' : (m.error ? ' (' + m.error + ')' : ''));
    case 'step': return 'Model step ' + m.step + ' of max ' + m.max;
    case 'tool_start': return (e.source === 'ai-center' ? 'AI Center read ' : 'Running ') + e.tool;
    case 'tool_end': return e.tool + (e.status === 'ok' ? ' finished' : e.status === 'rejected' ? ' rejected by you' : ' failed' + (m.error ? ': ' + m.error : '')) + (e.duration != null ? ' · ' + e.duration + ' ms' : '');
    case 'approval_requested': return 'Approval requested: ' + (m.title || e.tool);
    case 'approval_resolved': return 'Change ' + e.status + ': ' + e.tool + (e.duration != null ? ' (you took ' + fmtDur(e.duration) + ')' : '');
    case 'verify_start': return 'Reading back the change: ' + e.tool;
    case 'verify_end': { const c = Array.isArray(m.checks) ? m.checks : null; const okN = c ? c.filter(x => x && x.ok).length : m.passed, tot = c ? c.length : m.total; return (e.status === 'ok' ? 'Verified: ' : 'NOT verified: ') + e.tool + (tot != null ? ' (' + okN + ' of ' + tot + ' checks passed)' : ''); }
    case 'retry': return 'Provider busy (HTTP ' + (m.http_status || e.status) + '): retrying once';
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

// ══════════════════════════════════════════════════════════════════════
// APPROVAL VIEW (section 25) — built ONLY from the real proposal (tool preview) and the real approval_requested event.
// Nothing here is model prose. `why` quotes the person's own question; `expected` is the preview's own change lines.
// ══════════════════════════════════════════════════════════════════════
const AFFECTED_KEYS = ['date', 'month', 'month_year', 'name', 'staff', 'staff_name', 'type', 'ledger_type', 'field', 'id', 'entry_id', 'item', 'product', 'str'];

/**
 * @param pending   one item of BTAgent.approvals(): { id, tool, risk, preview, armed }
 * @param reqEvent  the matching approval_requested telemetry event (same approval id) or null
 */
export function approvalView(pending, reqEvent) {
  const pv = pending.preview || {}, m = (reqEvent && reqEvent.metadata) || {}, args = m.args && typeof m.args === 'object' ? m.args : {};
  const affected = AFFECTED_KEYS.filter(k => args[k] != null && typeof args[k] !== 'object').map(k => ({ label: k.replace(/_/g, ' '), value: String(args[k]) }));
  if (pv.amount != null && pv.amount !== '' && Number.isFinite(Number(pv.amount)) && Number(pv.amount) !== 0) affected.push({ label: 'amount', value: 'Rs ' + fmtNum(pv.amount) });
  const reversible = m.reversible === true;
  const risk = pending.risk || m.risk || 'write';
  return {
    id: pending.id, tool: pending.tool, risk, tone: risk === 'critical' || pv.strong ? 'cr' : 'wn',
    title: pv.title || pending.tool,
    why: m.question ? { kind: 'FACT', text: 'You asked: "' + m.question + '"' + (m.specialist ? ' (handled by the ' + m.specialist + ' specialist)' : '') }
      : { kind: 'FACT', text: 'BT proposed this change while working on your request.' },
    evidence: (pv.lines || []).map(String).map(t => ({ kind: 'FACT', label: 'Proposed', value: t })),
    warnings: (pv.warnings || []).map(String),
    expected: (pv.lines || []).length ? 'If you approve, exactly this is written: ' + (pv.lines || []).slice(0, 4).map(String).join('; ') + '.' : 'If you approve, "' + (pv.title || pending.tool) + '" is applied.',
    verification: 'After the change, BT reads it back from the app data and reports verified or not verified.',
    reversibility: reversible ? { ok: true, text: 'Can be undone: from the Action Center for 48 hours.' } : { ok: false, text: 'Cannot be undone automatically. Check carefully before approving.' },
    affected,
    gate: pv.confirmWord ? { kind: 'type', word: String(pv.confirmWord), text: 'Type "' + pv.confirmWord + '" to approve.' }
      : pv.strong ? { kind: 'twotap', text: pending.armed ? 'Tap once more to confirm.' : 'Needs two taps: Approve, then "Yes, I am sure".' } : { kind: 'tap', text: 'One tap to approve.' },
  };
}

// ══════════════════════════════════════════════════════════════════════
// FINDING GUIDANCE (sections 11, 44) — fixed, rule-based wording per finding TYPE. Not AI. Labelled RECOMMENDATION (rule-based).
// ══════════════════════════════════════════════════════════════════════
const GUIDE = {
  CASH: { rec: 'Compare the cash and bank figures for that day with the till count, then correct the daily entry if one of them is wrong.', ifAct: 'Opening the page changes nothing. If you correct the entry (yourself or through BT with your approval), the day\'s DIFF is recalculated from the new figures.' },
  ANOMALY: { rec: 'Open the source page and compare the flagged days or entries before deciding. A drop can be genuine (weather, a holiday) or a missing entry.', ifAct: 'Reviewing changes nothing. A correction made through BT needs your approval, is read back to verify, and can be undone for 48 hours.' },
  PERFORMANCE: { rec: 'No action needed. This is a positive signal.', ifAct: 'Nothing to act on.' },
  FORECAST: { rec: 'Compare "needed per day" with "actual per day" on the Dashboard. Ask BT what would have to change to reach the target.', ifAct: 'Asking BT is read-only. Changing the target itself is a separate, approval-gated change.' },
  INVENTORY: { rec: 'Review the listed products in Inventory Health. Items that are out of stock but selling are the first to reorder or request by STR.', ifAct: 'Reviewing is read-only. BT has no tool that places purchase orders.' },
  STAFF: { rec: 'Open the staff credit view and check carried-over balances and possible duplicates against your records.', ifAct: 'Reviewing is read-only. Adding or removing a credit entry through BT needs your approval and can be undone for 48 hours.' },
  WARNING: { rec: 'Add the missing daily sales entry so reports, cash difference and target pace are based on complete data.', ifAct: 'Once the entry exists, this finding clears on the next refresh, and pace and cash figures include that day.' },
  CLOSING: { rec: 'Open the Closing Book and close the listed shifts.', ifAct: 'Closing the shifts completes that day\'s record. This finding clears on the next refresh.' },
  STR: { rec: 'Open the STR page, follow up the oldest transfer, and mark it received when the stock arrives.', ifAct: 'Following up is outside BT. Marking received happens on the STR page and updates STR counts.' },
};
const DATE_RE = /\b(\d{1,2}\/[A-Za-z]{3}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g;
const STR_RE = /\bSTR[-\s]?[A-Za-z0-9-]{3,}\b/g;

export function guidanceFor(type, system) {
  return GUIDE[type] || GUIDE[system] || GUIDE.ANOMALY;
}
export function relatedEntitiesOf(f) {
  const hay = [f.title, f.description, ...(f.evidence || []).map(e => e.value)].join(' | '), out = [], seen = new Set();
  const add = (kind, value) => { const k = kind + ':' + value; if (!seen.has(k)) { seen.add(k); out.push({ kind, value }); } };
  (hay.match(DATE_RE) || []).forEach(v => add('date', v));
  (hay.match(STR_RE) || []).forEach(v => add('str', v));
  add('system', f.system);
  return out.slice(0, 8);
}

// ══════════════════════════════════════════════════════════════════════
// CORRELATION (section 7) — rule-based CO-OCCURRENCE of findings across systems. It says "these appear together", never "A caused B".
// ══════════════════════════════════════════════════════════════════════
export function correlate(findings) {
  const f = (findings || []).filter(x => x.severity === 'warning' || x.severity === 'error');
  const by = (sys, re) => f.filter(x => x.system === sys && (!re || re.test(x.title)));
  const out = [];
  const add = (id, systems, title, why, parts) => out.push({ id, systems, kind: 'CORRELATION', confidence: 'co-occurrence', title, why, parts: parts.map(p => ({ id: p.id, title: p.title })) });
  const cash = by('CASH'), sales = f.filter(x => x.system === 'SALES' && /below the same weekday|below the recent|recent daily average|weekday/i.test(x.title)), inv = by('INVENTORY', /out of stock|run out/i), strs = by('STR');
  if (cash.length && sales.length) add('c_cash_sales', ['CASH', 'SALES'], 'Cash difference and weak sales appear together', 'Both rules fired on the same data. A weak day is not evidence of a cash problem, and a cash difference is not evidence of weak sales. Check the day\'s entry first.', [cash[0], sales[0]]);
  if (inv.length && sales.length) add('c_inv_sales', ['INVENTORY', 'SALES'], 'Out-of-stock items while sales are below normal', 'Products that were selling are out of stock or about to be, at a time sales are below the recent level. It is possible the two are linked. It is not proven.', [inv[0], sales[0]]);
  if (strs.length && inv.length) add('c_str_inv', ['STR', 'INVENTORY'], 'Delayed incoming transfers while stock is short', 'Incoming STRs are overdue while items are out of stock or running out. If the delayed transfers contain those items, receiving them would help. Verify the contents of the oldest STR.', [strs[0], inv[0]]);
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// TOOL INTELLIGENCE (section 16)
// ══════════════════════════════════════════════════════════════════════
export function toolPurpose(t) {
  const d = String((t && t.description) || '').replace(/\s+/g, ' ').trim();
  const first = d.split(/(?<=[.!?])\s/)[0] || d;
  return first.length > 110 ? first.slice(0, 107) + '...' : first;
}
/** Status of a tool right now, from REAL gates only (kill switch, per-device writes toggle, risk class). */
export function toolStatus(t, { writesAllowed = false, killed = false } = {}) {
  const change = t.risk === 'write' || t.risk === 'critical';
  if (!change) return { status: 'AVAILABLE', detail: t.risk === 'ui' ? 'Opens an app view' : 'Read-only' };
  if (killed) return { status: 'BLOCKED', detail: 'Kill switch is ON' };
  if (!writesAllowed) return { status: 'READ-ONLY', detail: 'Changes are off on this device' };
  return { status: 'APPROVAL', detail: 'Needs your approval each time' };
}
const TOOL_TONE = { AVAILABLE: 'ok', APPROVAL: 'wn', 'READ-ONLY': 'mu', BLOCKED: 'cr' };
export const toolTone = s => TOOL_TONE[s] || 'mu';

// ══════════════════════════════════════════════════════════════════════
// OBSERVABILITY + HEALTH (sections 28, 42) — computed from real recorded events only.
// ══════════════════════════════════════════════════════════════════════
/** @param events any order. Real request durations, approval waits, retries, failures. */
export function observability(events) {
  const ev = (events || []).filter(e => e && !e.synthetic);
  const starts = new Map(), ends = new Map();
  ev.forEach(e => {
    if (!e.request_id) return;
    if (e.type === 'request_start') starts.set(e.request_id, e);
    if (e.type === 'answer' || e.type === 'error' || e.type === 'cancelled') ends.set(e.request_id, e);
  });
  const durs = [];
  starts.forEach((s, id) => { const en = ends.get(id); if (en && en.type === 'answer') durs.push(en.timestamp - s.timestamp); });
  const waits = ev.filter(e => e.type === 'approval_resolved' && Number.isFinite(e.duration)).map(e => e.duration);
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const verifies = ev.filter(e => e.type === 'verify_end');
  return {
    requests: starts.size, answered: durs.length, errors: ev.filter(e => e.type === 'error').length,
    avgInvestigationMs: avg(durs), maxInvestigationMs: durs.length ? Math.max(...durs) : null,
    approvals: waits.length, avgApprovalWaitMs: avg(waits), maxApprovalWaitMs: waits.length ? Math.max(...waits) : null,
    approvalsRejected: ev.filter(e => e.type === 'approval_resolved' && e.status === 'rejected').length,
    retries: ev.filter(e => e.type === 'retry').length,
    verified: verifies.filter(e => e.status === 'ok').length, verifyFailed: verifies.filter(e => e.status !== 'ok').length,
  };
}
/** Per specialist: runs, failures, last run — from request_start + error events. */
export function specialistStats(events) {
  const ev = events || [], by = {}, owner = new Map();
  ev.forEach(e => { if (e.type === 'request_start' && e.agent && e.request_id) { owner.set(e.request_id, e.agent); const o = by[e.agent] = by[e.agent] || { runs: 0, failed: 0, lastAt: 0 }; o.runs++; o.lastAt = Math.max(o.lastAt, e.timestamp); } });
  ev.forEach(e => { if (e.type === 'error' && owner.has(e.request_id)) by[owner.get(e.request_id)].failed++; });
  return by;
}
export function specialistsHealth(stats, definedCount) {
  const rows = Object.values(stats || {}), runs = rows.reduce((a, r) => a + r.runs, 0), failed = rows.reduce((a, r) => a + r.failed, 0);
  if (!runs) return { status: 'UNKNOWN', detail: definedCount + ' defined. No requests recorded in the last 7 days on this device.' };
  const rate = failed / runs;
  return { status: rate >= 0.5 ? 'ERROR' : rate >= 0.15 ? 'DEGRADED' : 'HEALTHY', detail: Object.keys(stats).length + ' of ' + definedCount + ' used. ' + runs + ' request(s), ' + failed + ' failed (last 7 days, this device).' };
}
/** Realtime channel state string (the app's own bt-sync channel) -> health. */
export function realtimeHealth(state) {
  if (state == null) return { status: 'UNKNOWN', detail: 'Realtime channel is not available in this view.' };
  if (state === '') return { status: 'WARNING', detail: 'Channel not started yet.' };
  if (state === 'joined') return { status: 'HEALTHY', detail: 'bt-sync channel joined.' };
  if (state === 'joining') return { status: 'WARNING', detail: 'bt-sync channel is connecting.' };
  return { status: 'ERROR', detail: 'bt-sync channel is ' + state + '. The app retries on its own.' };
}

// ══════════════════════════════════════════════════════════════════════
// REPOSITORY INTELLIGENCE (sections 8, 47) — search over the secret-filtered SYMBOL index built by scripts/build-repo-index.mjs.
// The index holds names, line numbers and one-line file summaries. It never holds source code, so nothing here can quote code.
// ══════════════════════════════════════════════════════════════════════
export function validRepoIndex(idx) { return !!(idx && idx.version === 1 && Array.isArray(idx.index) && idx.index.length); }
export function searchRepoIndex(idx, query, limit = 12) {
  if (!validRepoIndex(idx)) return [];
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length > 1).slice(0, 6);
  if (!terms.length) return [];
  const out = [];
  for (const f of idx.index) {
    const path = f.f.toLowerCase(), sum = String(f.s || '').toLowerCase(), pen = path.startsWith('tests/') ? -3 : 0;
    for (const s of [...(f.sym || []), ...(f.tools || [])]) {
      const n = String(s.n).toLowerCase(); let score = 0;
      for (const t of terms) { if (n === t) score += 10; else if (n.includes(t)) score += 5; else if (path.includes(t) || sum.includes(t)) score += 1; else { score = -1; break; } }
      if (score > 0) out.push({ file: f.f, line: s.l, name: s.n, kind: s.k, domain: s.d || '', risk: s.r || '', summary: f.s || '', score: score + (s.k === 'tool' ? 2 : 0) + pen });
    }
    if (terms.every(t => path.includes(t) || sum.includes(t))) out.push({ file: f.f, line: 1, name: f.f, kind: 'file', domain: '', risk: '', summary: f.s || '', score: 2 + pen });
  }
  return out.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, limit);
}
export function repoIndexInfo(idx, now = Date.now()) {
  if (!validRepoIndex(idx)) return null;
  const at = Date.parse(idx.generated_at), age = Number.isFinite(at) ? now - at : null;
  return { files: idx.files, symbols: idx.symbols, commit: idx.commit || 'unknown', builtAt: at, age: ageLabel(at, now), stale: age != null && age > 14 * 86400000 };
}
