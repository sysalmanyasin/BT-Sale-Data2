// ══════════════════════════════════════════════════════════════════════
// AI CENTER — COPILOT LOGIC (pure)
//
// No DOM, no Supabase, no tool calls and NO WRITE PATH. Everything here maps data the Center already read
// (findings, snapshot, telemetry runs, audit rows) into the shapes the dashboard draws:
//   • prioritised "Needs attention" entries (grouped, with impact and next action)
//   • elevated critical items
//   • context-aware prompt suggestions
//   • structured investigation results (Finding / Impact / Evidence / Confidence / Recommendation / Actions)
//   • prepared drafts (reorder, overdue STR, closing + cash discrepancy): text only, nothing is changed or sent
//   • investigation history that links question → tools → evidence → approval → execution outcome
//   • honest failure descriptions (timeout, permission, offline, partial data)
// ══════════════════════════════════════════════════════════════════════
import { fmtNum, findingImpact, correlate, isoDay } from './model.js';
import { reorderDraftText } from '../shared/planning-metrics.js';

const SEV_RANK = { error: 0, warning: 1, info: 2, good: 3 };
const AREA_LABEL = { SALES: 'Sales', CASH: 'Cash', INVENTORY: 'Inventory', STAFF: 'Staff & money', STR: 'Stock transfers', CLOSING: 'Closing', FORECAST: 'Sales' };
// Same-area findings that describe one operational problem are shown as one row (the rest stay one tap away).
const GROUPED_SYSTEMS = new Set(['INVENTORY', 'STR']);

export const areaLabel = system => AREA_LABEL[system] || (system ? system.charAt(0) + system.slice(1).toLowerCase() : 'General');

/** Honest impact text: only a Rs figure that is really in the finding. Never a guess. */
export function impactText(f) {
  const n = findingImpact(f);
  return n > 0 ? 'Rs ' + fmtNum(n) + ' involved' : 'Impact not quantified';
}

/**
 * Top actionable issues, most urgent first. Warnings/errors before notes; within a severity the larger Rs amount first.
 * INVENTORY and STR findings are merged per area (one row, "+N related"); where two areas fire together the
 * co-occurrence from correlate() is attached as `linked` (it is labelled co-occurrence, never cause).
 */
export function prioritizeFindings(findings, { limit = 5 } = {}) {
  const live = (findings || []).filter(f => f && f.severity !== 'good');
  const links = correlate(live);
  const groups = new Map();
  live.forEach((f, i) => {
    const key = GROUPED_SYSTEMS.has(f.system) ? 'area:' + f.system : 'id:' + f.id;
    if (!groups.has(key)) groups.set(key, { members: [], order: i });
    groups.get(key).members.push(f);
  });
  const entries = [...groups.values()].map(g => {
    const members = g.members.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) || findingImpact(b) - findingImpact(a));
    const primary = members[0], ids = new Set(members.map(m => m.id));
    return {
      id: primary.id, primary, related: members.slice(1), severity: primary.severity, system: primary.system, area: areaLabel(primary.system),
      impact: Math.max(...members.map(findingImpact)), impactText: impactText({ ...primary, impact: Math.max(...members.map(findingImpact)) }),
      evidence: (primary.evidence || []).slice(0, 2), next: primary.recommendation || null, order: g.order,
      linked: links.filter(l => l.parts.some(p => ids.has(p.id))).map(l => ({ id: l.id, title: l.title, why: l.why, systems: l.systems })),
    };
  }).sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) || b.impact - a.impact || a.order - b.order);
  const shown = entries.slice(0, Math.max(1, limit));
  return { entries: shown, hidden: entries.length - shown.length, total: entries.length };
}

/** Items that must be lifted above every normal section: error-severity findings and any pending approval. */
export function criticalItems({ findings = [], approvals = [] } = {}) {
  const out = [];
  findings.filter(f => f && f.severity === 'error').forEach(f => out.push({ kind: 'finding', id: f.id, title: f.title, severity: 'critical', area: areaLabel(f.system), finding: f }));
  (approvals || []).forEach(p => out.push({ kind: 'approval', id: p.id, title: (p.preview && p.preview.title) || p.tool || 'Change waiting for approval', severity: p.risk === 'critical' ? 'critical' : 'urgent', area: 'Approvals' }));
  return out.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
}

/** 3–4 questions that the existing tools can answer, picked from what is actually going on. */
export function suggestPrompts({ findings = [], reorderLines = 0, fillPct = null, closingIncomplete = 0, approvals = 0 } = {}, max = 4) {
  const live = findings.filter(f => f && f.severity !== 'good');
  const has = (sys, re) => live.some(f => f.system === sys && (!re || re.test(f.title)));
  const cand = [];
  const add = (q, score) => { if (!cand.some(c => c.q === q)) cand.push({ q, score }); };
  const warns = live.filter(f => f.severity === 'warning' || f.severity === 'error').length;
  if (warns) add('What needs my attention?', 100);
  if (closingIncomplete > 0 || has('CLOSING')) add('What is blocking closing?', 90);
  if (has('INVENTORY') || has('STR', /unreceived|fill rate/i)) add('Which inventory risks are most urgent?', 80);
  if (has('STR') || (fillPct != null && fillPct < 90)) add('Why are transfers delayed?', 85);
  if (reorderLines > 0) add('Which reorder recommendations need review?', 70);
  if (has('CASH')) add('Explain the cash difference in the latest entry.', 75);
  if (has('STAFF')) add('Which staff credit balances need review?', 60);
  if (approvals > 0) add('What changes is BT proposing right now?', 110);
  add('Explain today’s closing position.', 40);
  add('What needs my attention?', 30);
  add('Which inventory risks are most urgent?', 20);
  return cand.sort((a, b) => b.score - a.score).slice(0, Math.max(3, Math.min(4, max))).map(c => c.q);
}

// ── evidence classes: verified fact vs hypothesis vs estimate vs recommendation ──
const EVIDENCE_CLASS = { FACT: 'verified', DETECTION: 'verified', CALCULATION: 'verified', PREDICTION: 'estimate', CORRELATION: 'hypothesis', 'AI INTERPRETATION': 'hypothesis', RECOMMENDATION: 'recommendation' };
export const classifyEvidence = kind => EVIDENCE_CLASS[String(kind || '').toUpperCase()] || 'hypothesis';
export const CLASS_LABEL = { verified: 'Verified', estimate: 'Estimate', hypothesis: 'Hypothesis', recommendation: 'Recommendation', missing: 'Missing data' };

/** Actions a finding can lead to. Every one is read-only or a text draft; changes only ever go through the approval gate. */
export function availableActions(f, drafts = []) {
  const out = [{ id: 'open', label: 'Open source page', kind: 'open', href: f && f.action && f.action.href }];
  const sys = f && f.system;
  const want = sys === 'INVENTORY' ? 'reorder' : sys === 'STR' ? 'overdue_str' : (sys === 'CLOSING' || sys === 'CASH') ? 'closing_discrepancy' : null;
  drafts.filter(d => d.kind === want).forEach(d => out.push({ id: d.id, label: 'Prepare ' + d.title.toLowerCase(), kind: 'draft', draft: d.id }));
  out.push({ id: 'ask', label: 'Investigate with BT', kind: 'investigate' });
  return out;
}

/**
 * One finding + BT's assessment → Finding, Impact, Evidence, Confidence/Limitations, Recommendation, Available actions.
 * `assessment` is what ui.js stored after an investigation ({text, at, investigation}); null when BT has not been asked.
 */
export function structureInvestigation(f, assessment, drafts = []) {
  if (!f) return null;
  const inv = assessment && assessment.investigation, syn = inv && inv.synthesis;
  const evidence = [];
  (f.evidence || []).forEach(e => evidence.push({ cls: classifyEvidence(e.kind), kind: e.kind, label: e.label, value: e.value, source: f.source }));
  if (syn) (syn.evidence_items || []).forEach(it => evidence.push({ cls: classifyEvidence(it.class), kind: it.class, label: it.label, value: it.text, source: it.source }));
  const limitations = [];
  if (!assessment) limitations.push('BT has not investigated this yet. The detection is a fixed rule; the cause is not known.');
  else if (!syn) limitations.push('This answer is not structured and its confidence is not rated. Check it against the evidence.');
  if (syn) {
    (syn.gaps || []).forEach(g => limitations.push(String(g)));
    ((inv && inv.entries) || []).filter(e => e.status !== 'ok').forEach(e => limitations.push(e.label + ' specialist ' + e.status + (e.error ? ' (' + e.error + ')' : '') + '.'));
    ((inv && inv.stats && inv.stats.ungrounded) || []).forEach(u => limitations.push('No data returned by: ' + (u.label || u) + '.'));
  }
  const rec = syn && syn.recommendation;
  return {
    investigated: !!assessment, finding: f.title, system: f.system, area: areaLabel(f.system), severity: f.severity,
    impact: impactText(f), evidence,
    verified: evidence.filter(e => e.cls === 'verified'), hypotheses: evidence.filter(e => e.cls === 'hypothesis'), estimates: evidence.filter(e => e.cls === 'estimate'),
    confidence: syn ? { level: syn.confidence, reason: syn.confidence_reason || '' } : { level: 'not rated', reason: assessment ? 'Plain answer: no confidence rating.' : 'Not investigated.' },
    limitations,
    recommendation: rec
      ? { source: 'ai', text: rec.action, why: rec.why, expected: rec.expected_result || 'not stated', risk: rec.risk, approval_required: !!rec.approval_required }
      : { source: 'rule', text: f.recommendation || 'Review the source page.', why: 'Fixed rule for this type of finding (not AI).', expected: f.if_act || 'not stated', risk: 'none: advice only', approval_required: false },
    actions: availableActions(f, drafts),
    conclusion: syn ? syn.conclusion : (assessment && assessment.text) || null,
    investigationId: inv ? inv.id : null,
  };
}

// ── prepared drafts: text only. Nothing is written, sent or approved by creating one. ──
export const DRAFT_NOTE = 'Prepared draft only. Nothing has been changed, sent or approved.';
const today = (now = Date.now()) => isoDay(new Date(now));

/** Reorder / overdue-STR / closing+cash drafts from data the Center already read. Each states purpose, records, amounts, impact. */
export function buildActionDrafts(raw, now = Date.now()) {
  const drafts = [], P = (raw && raw.planning) || {};
  const R = P.reorder;
  if (R && R.total_lines > 0) {
    const sup = (R.groups || []).length;
    drafts.push({
      id: 'draft:reorder', kind: 'reorder', title: 'Reorder draft', state: 'prepared_draft', writes: false,
      purpose: 'A buy list for items that are out of stock or low, net of stock already on inbound STRs.',
      affected: R.total_lines + ' product lines across ' + sup + ' supplier' + (sup === 1 ? '' : 's') + (R.shown < R.total_lines ? ' (first ' + R.shown + ' shown)' : ''),
      amounts: 'Estimated Rs ' + fmtNum(R.est_value_at_sale_price) + ' at sale price', impact: R.lost_sales_per_day > 0 ? 'About Rs ' + fmtNum(R.lost_sales_per_day) + '/day of sales at risk from ' + R.out_of_stock_selling + ' out-of-stock sellers' : 'Prevents running out of ' + R.low_cover + ' low-cover items',
      source: 'reorder_draft', text: reorderDraftText(R), href: '#reorder', note: DRAFT_NOTE,
    });
  }
  const sp = raw && raw.strPending;
  if (sp && sp.matching > 0 && Array.isArray(sp.items) && sp.items.length) {
    const lines = ['Overdue incoming STRs (not received for 3+ days): ' + sp.matching];
    sp.items.forEach(i => lines.push('  ' + i.str + ' · ' + i.age_days + ' days · ' + i.stage + (i.from ? ' · from ' + i.from : '') + (i.date ? ' · dated ' + i.date : '')));
    if (sp.matching > sp.items.length) lines.push('  (+' + (sp.matching - sp.items.length) + ' more not listed)');
    drafts.push({
      id: 'draft:overdue_str', kind: 'overdue_str', title: 'Overdue STR report', state: 'prepared_draft', writes: false,
      purpose: 'A follow-up list of incoming transfers that have not been received for 3 or more days.',
      affected: sp.matching + ' STR' + (sp.matching === 1 ? '' : 's') + ' (oldest ' + sp.items[0].str + ', ' + sp.items[0].age_days + ' days)', amounts: 'Quantities are not in this list: open each STR for lines.',
      impact: 'Receiving them frees stock that may cover current stock-outs. Not proven: check the contents first.',
      source: 'list_pending_strs', text: lines.join('\n'), href: '#str', note: DRAFT_NOTE,
    });
  }
  const cl = raw && raw.closing, day = raw && raw.day, t = today(now);
  const inc = cl && Array.isArray(cl.incomplete_days) ? cl.incomplete_days.filter(d => d.date < t) : [];
  const diff = day && Number(day.diff);
  if (inc.length || (day && Number.isFinite(diff) && diff !== 0)) {
    const lines = ['Closing and cash discrepancy report'];
    if (inc.length) { lines.push('', 'Shifts not closed:'); inc.forEach(d => lines.push('  ' + d.date + ': ' + d.missing.join(', '))); }
    if (day && Number.isFinite(diff) && diff !== 0) lines.push('', 'Cash DIFF on ' + day.date + ': Rs ' + fmtNum(diff) + ' (cash sale Rs ' + fmtNum(day.cash_sale) + ', bank total Rs ' + fmtNum(day.bank_total) + ')');
    drafts.push({
      id: 'draft:closing_discrepancy', kind: 'closing_discrepancy', title: 'Closing discrepancy report', state: 'prepared_draft', writes: false,
      purpose: 'A checklist of unclosed shifts and the latest cash difference, to settle before the day is signed off.',
      affected: (inc.length ? inc.length + ' day' + (inc.length === 1 ? '' : 's') + ' with open shifts' : 'no open shifts') + (day && diff ? '; cash entry ' + day.date : ''),
      amounts: day && Number.isFinite(diff) && diff !== 0 ? 'Cash DIFF Rs ' + fmtNum(diff) : 'No cash difference recorded',
      impact: 'Unclosed shifts can leave cash figures incomplete; close them first, then re-check the difference. Co-occurrence, not proof of cause.',
      source: 'closing_recent_days + get_daily_sales', text: lines.join('\n'), href: '#closing', note: DRAFT_NOTE,
    });
  }
  return drafts;
}

// ── one vocabulary for how far an action got ──
export const ACTION_STATES = Object.freeze({
  recommendation: { label: 'Recommendation', tone: 'mu', note: 'Advice only. Nothing prepared.' },
  prepared_draft: { label: 'Prepared draft', tone: 'cy', note: DRAFT_NOTE },
  pending_approval: { label: 'Pending approval', tone: 'wn', note: 'Waiting for your decision. Nothing has changed yet.' },
  executed: { label: 'Executed', tone: 'ok', note: 'The system confirmed the change was applied.' },
  executed_unverified: { label: 'Applied, not verified', tone: 'wn', note: 'The tool reported success but the read-back was not confirmed.' },
  failed: { label: 'Failed', tone: 'cr', note: 'The change was not applied.' },
  rejected: { label: 'Rejected', tone: 'mu', note: 'You rejected it. Nothing was changed.' },
  undone: { label: 'Undone', tone: 'mu', note: 'The change was reversed.' },
});
/** Audit row (from summarizeAudit) → action state. "Executed" only when the system recorded ok. */
export function auditActionState(row) {
  if (!row) return 'recommendation';
  if (row.status === 'undone') return 'undone';
  if (row.status === 'rejected') return 'rejected';
  if (row.status === 'failed' || row.status === 'not applied') return 'failed';
  if (row.change && row.status === 'approved') return 'executed';
  return row.change ? 'failed' : 'recommendation';
}

/** Error text → a state the screen can explain: timeout, permission, offline, partial data or generic error. */
export function describeFailure(err) {
  const msg = String((err && (err.message || err.error)) || err || '').trim();
  const low = msg.toLowerCase();
  const kind = /timeout|timed out|aborted|took too long/.test(low) ? 'timeout'
    : /permission|unauthori|forbidden|\b40[13]\b|not allowed|read-only|locked/.test(low) ? 'permission'
      : /offline|network|failed to fetch|no connection/.test(low) ? 'offline'
        : /not loaded|still loading|not ready|not available|no data/.test(low) ? 'partial' : 'error';
  const T = {
    timeout: ['Took too long', 'The data source did not answer in time. Nothing was changed. Try again.', true],
    permission: ['Not permitted', 'This account or device is not allowed to do that. Nothing was changed.', false],
    offline: ['Offline', 'There is no connection. The last known data is shown.', true],
    partial: ['Partly loaded', 'Some data is not loaded yet, so figures may be incomplete.', true],
    error: ['Could not complete', 'Something went wrong. Nothing was changed.', true],
  }[kind];
  return { kind, title: T[0], text: T[1], retry: T[2], detail: msg };
}

/**
 * Investigation history: each run from telemetry (M.buildRuns) with what it asked, who answered, which tools ran,
 * whether it produced evidence, and how any approval/change ended. Outcome wording never exceeds what was recorded.
 */
export function buildInvestigationHistory(runs, limit = 8) {
  return (runs || []).filter(r => r && r.question).slice(0, limit).map(r => {
    const evs = r.events || [];
    const writes = evs.filter(e => e.type === 'tool_end' && e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical'));
    const verifyEnd = evs.filter(e => e.type === 'verify_end').pop();
    const req = evs.find(e => e.type === 'approval_requested'), res = evs.filter(e => e.type === 'approval_resolved').pop();
    const approval = !req ? null : !res ? { status: 'pending', title: (req.metadata && req.metadata.title) || req.tool || '' }
      : { status: res.status === 'approved' || res.status === 'ok' ? 'approved' : 'rejected', title: (req.metadata && req.metadata.title) || req.tool || '' };
    let outcome = 'none';
    if (approval && approval.status === 'pending') outcome = 'pending_approval';
    else if (approval && approval.status === 'rejected') outcome = 'rejected';
    else if (writes.length) outcome = writes.some(e => e.status !== 'ok') ? 'failed' : verifyEnd ? (verifyEnd.status === 'ok' ? 'executed' : 'executed_unverified') : 'executed_unverified';
    const ev = r.stages.find(s => s.key === 'evidence'), an = r.stages.find(s => s.key === 'analysis');
    return {
      id: r.id, question: r.question, status: r.status, at: r.startedAt, durationMs: r.durationMs, specialists: r.agents.slice(),
      tools: r.tools.map(t => ({ tool: t.tool, status: t.status })), toolCount: r.tools.length, failedTools: r.tools.filter(t => t.status && t.status !== 'ok').length,
      evidence: ev ? ev.detail || 'gathered' : r.tools.length ? r.tools.length + ' tool result(s)' : 'none',
      confidence: an ? (an.detail || '').replace(/^confidence /, '') || null : null,
      approval, outcome, outcomeState: outcome === 'none' ? null : outcome, historical: !!r.historical,
    };
  });
}

/** Actual vs needed per day, month-end gap and plain-language drivers, all from numbers the tools returned. */
export function forecastVariance(pace, weekday = null, briefing = null) {
  if (!pace || pace.error) return null;
  const needed = Number(pace.needed_per_day), actual = Number(pace.actual_per_day), left = Number(pace.days_left);
  const perDay = actual - needed;
  const runRate = Number.isFinite(actual) && Number.isFinite(left) ? Number(pace.sold_so_far) + actual * left : null;
  const drivers = [];
  if (Number.isFinite(perDay)) drivers.push({ kind: 'CALCULATION', text: 'Run rate: Rs ' + fmtNum(actual) + '/day against Rs ' + fmtNum(needed) + '/day needed (' + (perDay >= 0 ? 'Rs ' + fmtNum(perDay) + '/day ahead' : 'Rs ' + fmtNum(-perDay) + '/day behind') + ').' });
  if (weekday && weekday.projected_month_end != null) drivers.push({ kind: 'PREDICTION', text: 'Weekday pattern: each remaining day is expected at that weekday’s recent average, giving about Rs ' + fmtNum(weekday.projected_month_end) + ' for the month' + (weekday.projected_low != null ? ' (range Rs ' + fmtNum(weekday.projected_low) + ' to ' + fmtNum(weekday.projected_high) + ')' : '') + '.' });
  if (runRate != null && runRate !== weekday?.projected_month_end) drivers.push({ kind: 'PREDICTION', text: 'Flat run rate would give about Rs ' + fmtNum(runRate) + '. The two estimates differ because weekdays sell differently.' });
  if (briefing && Number(briefing.missing_sales_days) > 0) drivers.push({ kind: 'FACT', text: briefing.missing_sales_days + ' day(s) have no sales entry, so the pace may look weaker than it is.' });
  return { perDay, behind: perDay < 0, monthEndGap: pace.target != null && runRate != null ? Math.round(runRate - Number(pace.target)) : null, runRate: runRate != null ? Math.round(runRate) : null, drivers };
}

// ── Business snapshot: six compact tiles from the existing snapshot (nothing recomputed) ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function isToday(dateLabel, now = Date.now()) {
  const d = new Date(now), s = String(dateLabel || '');
  return s === isoDay(d) || s.toLowerCase() === String(d.getDate()).padStart(2, '0') + '/' + MONTHS[d.getMonth()].toLowerCase() + '/' + d.getFullYear();
}
const tn = st => (st === 'ERROR' || st === 'UNAUTHORIZED') ? 'cr' : st === 'ATTENTION' ? 'wn' : st === 'DATA_UNAVAILABLE' ? 'mu' : 'ok';

export function snapshotTiles(snap, now = Date.now()) {
  if (!snap) return [];
  const raw = snap.raw || {}, sys = snap.systems || {}, b = raw.briefing, pace = raw.pace, P = raw.planning || {};
  const fresh = s => (sys[s] && sys[s].fresh && sys[s].fresh.label) || '';
  const why0 = (system, why) => (sys[system] && sys[system].availability && sys[system].availability.reason) || why;
  const na = (id, label, system, why) => ({ id, label, system, systems: [system], value: '—', sub: why0(system, why) || 'not available', compare: null, tone: 'mu', fresh: fresh(system), available: false });
  const tiles = [];
  // 1 sales (latest entry; "Today" only when the entry really is today's)
  const le = b && b.last_sales_entry;
  tiles.push(le ? { id: 'sales', system: 'SALES', systems: ['SALES'], label: isToday(le.date, now) ? 'TODAY’S SALES' : 'LATEST SALES', value: 'Rs ' + fmtNum(le.total_sale), sub: le.date,
    compare: b.yesterday && b.yesterday.vs_recent_avg_pct != null ? (b.yesterday.vs_recent_avg_pct >= 0 ? '+' : '') + b.yesterday.vs_recent_avg_pct + '% vs recent average' : null,
    tone: b.yesterday && b.yesterday.vs_recent_avg_pct <= -15 ? 'wn' : tn(sys.SALES && sys.SALES.status), fresh: fresh('SALES'), available: true } : na('sales', 'LATEST SALES', 'SALES', snap.errors && snap.errors.briefing));
  // 2 target
  tiles.push(pace && !pace.error ? { id: 'target', system: 'SALES', systems: ['SALES'], label: 'SALES TARGET', value: pace.pct_done + '%', sub: 'Rs ' + fmtNum(pace.sold_so_far) + ' of ' + fmtNum(pace.target),
    compare: pace.pct_done >= 100 ? 'achieved' : (Number(pace.actual_per_day) >= Number(pace.needed_per_day) ? 'on pace' : 'behind pace') + ': Rs ' + fmtNum(pace.actual_per_day) + ' vs ' + fmtNum(pace.needed_per_day) + '/day',
    tone: pace.on_track === false ? 'wn' : 'ok', fresh: fresh('SALES'), available: true, pct: pace.pct_done } : na('target', 'SALES TARGET', 'SALES', snap.errors && snap.errors.pace));
  // 3 cash + closing
  const cd = raw.day, today0 = raw.closing && raw.closing.days && raw.closing.days[0], inc = raw.closing && raw.closing.incomplete_days ? raw.closing.incomplete_days.length : null;
  tiles.push(cd || today0 ? { id: 'cash', system: cd ? 'CASH' : 'CLOSING', systems: ['CASH', 'CLOSING'], label: 'CASH & CLOSING', value: cd ? 'DIFF Rs ' + fmtNum(cd.diff) : today0.closed + '/3 closed',
    sub: (cd ? cd.date : '') + (today0 ? (cd ? ' · ' : '') + today0.closed + '/3 shifts closed today' : ''), compare: inc != null ? inc + ' day(s) with open shifts (7d)' : null,
    tone: (cd && Number(cd.diff) !== 0) || inc > 0 ? 'wn' : 'ok', fresh: fresh(cd ? 'CASH' : 'CLOSING'), available: true } : na('cash', 'CASH & CLOSING', 'CLOSING', snap.errors && (snap.errors.day || snap.errors.closing)));
  // 4 inventory risk
  const inv = b && b.inventory, R = P.reorder;
  tiles.push(inv ? { id: 'inventory', system: 'INVENTORY', systems: ['INVENTORY'], label: 'INVENTORY RISK', value: String(inv.out_of_stock_but_selling) + ' out of stock', sub: inv.running_out_within_7_days + ' run out within 7 days',
    compare: R && R.lost_sales_per_day > 0 ? 'about Rs ' + fmtNum(R.lost_sales_per_day) + '/day of sales at risk' : null, tone: inv.out_of_stock_but_selling > 0 ? 'wn' : 'ok', fresh: fresh('INVENTORY'), available: true } : na('inventory', 'INVENTORY RISK', 'INVENTORY', 'Open the Inventory page once.'));
  // 5 staff credit
  const cr = b && b.credit;
  tiles.push(cr ? { id: 'staff', system: 'STAFF', systems: ['STAFF'], label: 'STAFF CREDIT', value: 'Rs ' + fmtNum(cr.month_net_owed != null ? cr.month_net_owed : 0), sub: (cr.month || '') + ' · ' + (cr.staff_owing || 0) + ' staff',
    compare: cr.prev_month_net_owed != null ? 'Rs ' + fmtNum(cr.prev_month_net_owed) + ' in ' + cr.prev_month + (cr.carried_over_total === 0 && cr.prev_month_net_owed > 0 ? ' (nothing carried over)' : '') : null,
    tone: cr.possible_duplicates > 0 || (cr.carried_over_total === 0 && cr.prev_month_net_owed > 0) ? 'wn' : 'ok', fresh: fresh('STAFF'), available: true } : na('staff', 'STAFF CREDIT', 'STAFF', 'No staff credit data found.'));
  // 6 STR fill
  const F = P.fill, str = raw.str;
  tiles.push(F && F.fill_rate_pct != null ? { id: 'str', system: 'STR', systems: ['STR'], label: 'STR FILL RATE', value: F.fill_rate_pct + '%', sub: 'incoming, last ' + F.window_days + ' days',
    compare: [str ? str.dispatched_not_received.all + ' dispatched, not received' : null, F.awaiting_dispatch && F.awaiting_dispatch.count ? F.awaiting_dispatch.count + ' awaiting dispatch' : null].filter(Boolean).join(' · ') || null,
    tone: F.fill_rate_pct < 90 ? 'wn' : 'ok', fresh: fresh('STR'), available: true, pct: F.fill_rate_pct } : na('str', 'STR FILL RATE', 'STR', (P.errors && P.errors.fill) || 'not measurable'));
  return tiles;
}
