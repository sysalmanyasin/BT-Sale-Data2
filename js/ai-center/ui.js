// ══════════════════════════════════════════════════════════════════════
// AI CENTER — UI
//
// Presentation only. Everything shown comes from:
//   • adapters.js  (existing tools / bridges / agent tables)
//   • telemetry    (real agent events)
//   • model.js     (pure mapping + rules)
// "Ask BT" talks to the EXISTING assistant through window.BTAgent; approval
// cards, the lock, the kill switch, undo and audit all stay in that one system.
// All text is inserted with textContent (never innerHTML) except the
// assistant's own markdown, which goes through its existing escaping renderer.
// ══════════════════════════════════════════════════════════════════════
import { listTools } from '../agent/core/tool-registry.js';
import * as T from '../agent/core/telemetry.js';
import { SPECIALISTS } from '../agent/core/specialists.js';
import { renderMarkdown } from '../agent/core/markdown-lite.js';
import { pushUndo, runUndo } from '../agent/core/undo.js';
import { markUndone } from '../agent/core/undo-store.js';
import { fetchAudit, summarizeAudit } from '../agent/core/usage-stats.js';
import { collectSnapshot, collectHealth, collectActions, getSb, readTool } from './adapters.js';
import * as M from './model.js';
import * as RI from './repo-intel.js';

const PAGE_ID = 'page-ai-center';
const LS_VISIT = 'bt_aic_last_visit_v1', LS_DISMISS = 'bt_aic_dismissed_v1';
const STALE_MS = 5 * 60000, REFRESH_MS = 45000;

const S = {
  snap: null, health: null, actions: null, history: [], loading: false, error: null,
  mode: 'monitor', filter: 'all', baseline: null, started: false, tick: 0, toolsOpen: false,
  awaitingFor: null, assess: {}, lastRefreshAt: 0, mounted: false, rafId: 0, deep: {}, repo: { state: 'idle', idx: null }, repoQ: '',
};

// ───────────────────────── tiny DOM helpers ─────────────────────────
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else e.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return e;
}
const $ = sel => document.querySelector(sel);
const root = () => document.getElementById('aic-root');
const pageOn = () => { const p = document.getElementById(PAGE_ID); return !!(p && p.classList.contains('on')); };
const clockFull = ts => (ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const tone = status => M.STATUS_TONE[status] || 'mu';
const pill = (status, text) => h('span', { class: 'aic-pill aic-' + tone(status), text: text || status });
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked: feature degrades silently */ } };

function toast(msg) {
  const el = h('div', { class: 'aic-toast', role: 'status', text: msg });
  document.body.append(el); setTimeout(() => el.remove(), 3800);
}

// ───────────────────────── modal ─────────────────────────
let modalEl = null, modalPrevFocus = null;
function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; if (modalPrevFocus && modalPrevFocus.focus) modalPrevFocus.focus(); } }
function openModal(title, body, { sub = '', tonec = 'cy' } = {}) {
  closeModal(); modalPrevFocus = document.activeElement;
  const box = h('div', { class: 'aic-modal aic-t-' + tonec, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'aic-mh' }, h('div', {}, h('h3', { text: title }), sub && h('div', { class: 'aic-sub', text: sub })), h('button', { class: 'aic-x', 'aria-label': 'Close', text: '✕', onclick: closeModal })),
    h('div', { class: 'aic-mb' }, body));
  modalEl = h('div', { class: 'aic-backdrop', onclick: ev => { if (ev.target === modalEl) closeModal(); } }, box);
  document.body.append(modalEl); box.focus();
}

// ───────────────────────── Ask BT (the existing agent) ─────────────────────────
function ask(q) {
  q = String(q || '').trim(); if (!q) return;
  const A = window.BTAgent;
  if (!A) { toast('The assistant is still loading. Try again in a moment.'); return; }
  if (A.isBusy()) { toast('BT is already working on a request.'); return; }
  S.mode = 'investigate'; render();
  Promise.resolve(A.ask(q)).catch(() => {});
}
function investigate(f) {
  const A = window.BTAgent;
  if (A && typeof A.investigate === 'function') {
    if (A.isBusy()) { toast('BT is already working on a request.'); return; }
    S.awaitingFor = f.id; closeModal(); S.mode = 'investigate'; render();
    // A real investigation: the finding (with the rule evidence) goes to the orchestrator, which runs the relevant specialists.
    Promise.resolve(A.investigate({
      question: 'Investigate this finding: "' + f.title + '"', domains: M.domainsForFinding(f),
      finding: { id: f.id, title: f.title, system: f.system, source: f.source, evidence: (f.evidence || []).map(e => ({ kind: e.kind, label: e.label, value: e.value })) },
    })).catch(() => {});
    return;
  }
  S.awaitingFor = f.id;
  closeModal();
  ask('Investigate this finding and show the evidence for it. Check the relevant data with your tools and say what is known and what is uncertain: "' + f.title + '"');
}
const openPage = href => { closeModal(); window.location.hash = href; };

// ───────────────────────── data refresh ─────────────────────────
async function refresh({ force = false } = {}) {
  if (S.loading) return;
  if (!force && S.snap && Date.now() - S.lastRefreshAt < REFRESH_MS) return;
  S.loading = true; S.error = null; render();
  try {
    const prev = S.snap && S.snap.findings;
    const snap = await collectSnapshot();
    S.snap = snap; S.lastRefreshAt = Date.now();
    const d = M.diffFindings(prev, snap.findings);
    if (prev) {
      d.added.forEach(f => T.emit({ type: 'finding_new', source: 'ai-center', severity: f.severity, domain: f.system.toLowerCase(), entity_reference: f.id, metadata: { title: f.title } }));
      d.cleared.forEach(f => T.emit({ type: 'finding_cleared', source: 'ai-center', domain: f.system.toLowerCase(), entity_reference: f.id, metadata: { title: f.title } }));
    }
    T.emit({ type: 'snapshot', source: 'ai-center', status: snap.tableReadyErrors ? 'partial' : 'ok', metadata: { reads: 6, findings: snap.findings.length, failed: snap.tableReadyErrors } });
    if (!S.baseline) S.baseline = lsGet(LS_VISIT);
    render();
    const [health, actions, hist] = await Promise.all([collectHealth(snap), collectActions(), fetchAudit(getSb(), 8)]);
    S.health = health; S.actions = actions; S.history = summarizeAudit(hist);
  } catch (e) { S.error = (e && e.message) || 'Could not read business data.'; console.error('[ai-center]', e); }
  S.loading = false; render();
}
function persistVisit() {
  if (!S.snap) return;
  lsSet(LS_VISIT, { at: Date.now(), findings: S.snap.findings.map(f => ({ id: f.id, title: f.title })) });
}

// ───────────────────────── render scheduling ─────────────────────────
export function render() {
  if (!S.mounted || S.rafId) return;
  S.rafId = requestAnimationFrame(() => { S.rafId = 0; paint(); });
}
const dismissedToday = () => { const d = lsGet(LS_DISMISS) || {}; const today = M.isoDay(new Date()); return Object.keys(d).filter(k => d[k] === today); };

function visibleFindings() {
  const hide = new Set(dismissedToday());
  return ((S.snap && S.snap.findings) || []).filter(f => !hide.has(f.id));
}

// ───────────────────────── sections ─────────────────────────
function sectionHeader(title, right) { return h('div', { class: 'aic-sh' }, h('h2', { text: title }), right || null); }
function card(id, modes, ...kids) { return h('section', { class: 'aic-card', id: 'aic-' + id, 'data-modes': modes }, kids); }
function empty(text) { return h('div', { class: 'aic-empty', text }); }
function skeleton(n = 3) { return h('div', { class: 'aic-skel', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('i'))); }

function coreInfo() {
  const live = T.liveState();
  // The Center reads local app data, so only a real network loss makes it OFFLINE. Whether the assistant /
  // Supabase session is usable is reported by the Health panel and by Ask BT itself.
  return { live, core: M.deriveCoreState({ online: navigator.onLine !== false, authed: true, snapshotLoading: S.loading && !S.snap, snapshotReady: !!S.snap, live, now: Date.now() }) };
}

function secHeaderBar(core) {
  const f = visibleFindings(), warns = f.filter(x => x.severity === 'warning' || x.severity === 'error').length;
  const stale = S.snap && Date.now() - S.snap.at > STALE_MS;
  const chip = (k, v, cls) => h('span', { class: 'aic-chip ' + (cls || '') }, k + ' ', h('b', { text: v }));
  return h('header', { class: 'aic-hdr' },
    h('div', { class: 'aic-hr1' },
      h('h1', { text: 'BT AI CENTER' }),
      h('span', { class: 'aic-live aic-' + (core.state === 'OFFLINE' || core.state === 'ERROR' ? 'cr' : core.state === 'MONITORING' || core.state === 'IDLE' ? 'ok' : 'cy'), 'aria-live': 'polite' }, h('i', { class: 'aic-dot' }), core.state.replace(/_/g, ' '))),
    h('div', { class: 'aic-tele', 'aria-label': 'Telemetry' },
      chip('SYSTEMS', M.SYSTEMS.length + ' monitored'),
      chip('FINDINGS', S.snap ? String(f.length) : '—'),
      chip('NEED REVIEW', S.snap ? String(warns) : '—', warns ? 'wn' : ''),
      chip('DATA AS OF', S.snap ? clock(S.snap.at) + ' (' + M.ageLabel(S.snap.at) + ')' : '—', stale ? 'wn' : ''),
      stale ? chip('STALE', 'refresh to update', 'wn') : null,
      chip('MONITORING', 'on view · no background polling')));
}

function secModes() {
  const seg = [['monitor', 'Monitor'], ['investigate', 'Investigate'], ['act', 'Act']];
  return h('div', { class: 'aic-tool' },
    h('div', { class: 'aic-seg', role: 'group', 'aria-label': 'Mode' }, seg.map(([id, label]) => h('button', { 'aria-pressed': String(S.mode === id), class: S.mode === id ? 'on' : '', text: label, onclick: () => { S.mode = id; render(); } }))),
    h('div', { class: 'aic-seg' },
      h('button', { text: S.loading ? 'Reading…' : 'Refresh', disabled: S.loading, onclick: () => refresh({ force: true }) }),
      h('button', { text: 'Commands  ⌘K', onclick: openPalette })));
}

function secCore(info) {
  const { core, live } = info, m = live.open;
  const mission = m
    ? h('div', { class: 'aic-mission' },
      h('div', { class: 'aic-k', text: 'CURRENT MISSION' }),
      h('div', { class: 'aic-mq', text: (m.metadata && m.metadata.question) || 'Working on a request' }),
      h('div', { class: 'aic-mg' },
        h('span', {}, 'Agent ', h('b', { text: m.agent || 'BT' })),
        h('span', {}, 'Step ', h('b', { text: live.steps ? live.steps + ' of max ' + (T.recent(60).find(e => e.type === 'step' && e.request_id === m.request_id) || { metadata: {} }).metadata.max : 'starting' })),
        h('span', {}, 'Elapsed ', h('b', { text: Math.round(live.elapsedMs / 1000) + 's' }))),
      live.activeTool ? h('div', { class: 'aic-mcur' }, 'Now: ', h('b', { text: live.activeTool.tool })) : h('div', { class: 'aic-mcur', text: 'Now: model is reasoning over the results so far' }),
      live.tools.length ? h('ul', { class: 'aic-mtools' }, live.tools.map(t => h('li', {}, h('span', { class: 'aic-pill aic-' + (t.status === 'ok' ? 'ok' : t.status === 'rejected' ? 'wn' : 'cr'), text: t.status }), ' ', t.tool, t.duration != null ? ' · ' + t.duration + ' ms' : ''))) : null,
      live.pendingApproval ? h('div', { class: 'aic-appr' }, h('b', { text: 'Waiting for you. ' }), (live.pendingApproval.metadata && live.pendingApproval.metadata.title) || live.pendingApproval.tool, ' ', h('button', { class: 'aic-p', text: 'Review', onclick: reviewApproval })) : null)
    : lastMissionNode();
  const life = M.deriveLifecycle(requestEvents(m || lastRequestStart()), !!S.snap);
  return card('core', 'monitor investigate',
    h('div', { class: 'aic-stage', 'data-s': core.state.toLowerCase() },
      h('i', { class: 'aic-ring r1' }), h('i', { class: 'aic-ring r2' }), h('i', { class: 'aic-ring r3' }),
      h('div', { class: 'aic-orb' }, h('div', {}, h('b', { text: 'BT' }), h('small', { text: core.state.replace(/_/g, ' ') })))),
    h('div', { class: 'aic-cs' }, h('h2', { text: core.state.replace(/_/g, ' ') }), h('p', { text: core.detail })),
    h('ol', { class: 'aic-life', 'aria-label': 'Intelligence lifecycle' }, life.map(s => h('li', { class: (s.reached ? (s.failed ? 'on fail ' : 'on ') : '') + (s.available ? '' : 'na'), title: s.available ? (s.reached ? 'Happened in the latest request' : 'Not reached in the latest request') : 'BT has no automated verification step yet', text: s.label }))),
    mission);
}
function reviewApproval() { if (window.BTAgent && typeof window.BTAgent.approvals === 'function') goMode('act', 'aic-actc'); else if (window.BTAgent) window.BTAgent.open(); }
const lastRequestStart = () => T.recent(400).find(e => e.type === 'request_start') || null;
const requestEvents = start => start ? T.recent(400, e => e.request_id === start.request_id) : [];
function lastMissionNode() {
  const s = lastRequestStart();
  if (!s) return h('div', { class: 'aic-mission' }, h('div', { class: 'aic-k', text: 'CURRENT MISSION' }), empty('No active mission. Ask BT something, or open a finding and choose Investigate.'));
  const evs = requestEvents(s), end = evs.find(e => e.type === 'answer' || e.type === 'error' || e.type === 'cancelled');
  const tools = evs.filter(e => e.type === 'tool_end');
  return h('div', { class: 'aic-mission' }, h('div', { class: 'aic-k', text: 'LAST MISSION · ' + (end ? end.type === 'answer' ? 'COMPLETE' : 'ENDED: ' + end.type.toUpperCase() : 'UNFINISHED') }),
    h('div', { class: 'aic-mq', text: (s.metadata && s.metadata.question) || '' }),
    h('div', { class: 'aic-mg' }, h('span', {}, 'Agent ', h('b', { text: s.agent || 'BT' })), h('span', {}, 'Tools ', h('b', { text: String(tools.length) })), end ? h('span', {}, 'Took ', h('b', { text: Math.round((end.timestamp - s.timestamp) / 1000) + 's' })) : null, h('span', { text: M.ageLabel(s.timestamp) })));
}

function findingCard(f) {
  return h('button', { class: 'aic-f aic-sev-' + f.severity, onclick: () => openFinding(f), 'aria-label': f.system + ': ' + f.title },
    h('div', { class: 'aic-fh' }, h('span', { class: 'aic-tag', text: f.system }), h('span', { class: 'aic-type', text: f.type })),
    h('div', { class: 'aic-ft', text: f.title }),
    h('div', { class: 'aic-fs', text: 'Source: ' + f.source + ' · observed ' + M.ageLabel(f.detected_at) }));
}
function secAttention() {
  let body;
  if (S.error && !S.snap) body = h('div', { class: 'aic-err' }, 'Could not read business data. ', h('button', { text: 'Retry', onclick: () => refresh({ force: true }) }));
  else if (!S.snap) body = skeleton();
  else {
    const f = visibleFindings(), top = f.filter(x => x.severity !== 'good');
    const good = f.filter(x => x.severity === 'good');
    body = h('div', {}, top.length ? top.slice(0, 8).map(findingCard) : empty('Nothing needs attention right now. All monitored rules are clear.'),
      top.length > 8 ? h('div', { class: 'aic-more', text: '+ ' + (top.length - 8) + ' more. Ask BT "What needs my attention?"' }) : null,
      good.map(g => h('div', { class: 'aic-good' }, '✓ ', g.title)));
  }
  return card('att', 'monitor', sectionHeader('WHAT NEEDS MY ATTENTION'), body);
}

function secSince() {
  if (!S.snap) return null;
  const b = S.baseline;
  const body = !b ? empty('This is your first visit. The next visit will show what changed.')
    : (() => { const d = M.diffFindings(b.findings, S.snap.findings); return h('div', { class: 'aic-since' }, h('div', {}, h('b', { text: '+' + d.added.length }), ' new'), h('div', {}, h('b', { text: String(d.cleared.length) }), ' no longer present'), h('div', { class: 'aic-sub', text: 'Since ' + new Date(b.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) })); })();
  return card('since', 'monitor', sectionHeader('SINCE YOUR LAST VISIT'), body);
}

function systemCard(name) {
  const s = S.snap && S.snap.systems[name];
  if (!s) return h('div', { class: 'aic-sys' }, h('div', { class: 'aic-sysh' }, h('b', { text: name })), skeleton(2));
  return h('div', { class: 'aic-sys aic-edge-' + tone(s.status) },
    h('div', { class: 'aic-sysh' }, h('b', { text: name }), pill(s.status)),
    h('div', { class: 'aic-sub', text: s.reason }),
    s.metrics.length ? h('dl', { class: 'aic-met' }, s.metrics.slice(0, 4).map(m => [h('dt', { text: m.label, title: 'Source: ' + m.src }), h('dd', { text: m.value })])) : h('div', { class: 'aic-sub', text: s.availability.reason || 'No data' }),
    h('div', { class: 'aic-fresh aic-' + tone(s.fresh.status), text: 'Data: ' + s.fresh.label }),
    h('div', { class: 'aic-row' }, h('button', { text: 'Open', onclick: () => openSystem(name) }), h('button', { text: 'Investigate', onclick: () => ask(SYSTEM_ASK[name]) })));
}
const SYSTEM_ASK = {
  SALES: 'How are sales going this month compared with last month and the target?', CASH: 'Is there any cash difference in the latest sales entry?',
  INVENTORY: 'What inventory is at risk? Which products are out of stock or about to run out?', STAFF: 'How are staff credits looking, including carried-over balances and possible duplicates?',
  STR: 'Which STRs are delayed or still pending?', CLOSING: 'What is blocking closing? Which days or shifts are not closed?',
};
function secSystems() { return card('sys', 'monitor', sectionHeader('BUSINESS SYSTEMS'), h('div', { class: 'aic-grid6' }, M.SYSTEMS.map(systemCard))); }

function secForecast() {
  const F = S.snap && S.snap.forecast;
  let body;
  if (!S.snap) body = skeleton(2);
  else if (!F.available) body = empty(F.reason);
  else {
    const p = F.pace;
    body = h('div', {},
      h('dl', { class: 'aic-met aic-big' }, [['TARGET', 'Rs ' + M.fmtNum(p.target)], ['SOLD SO FAR', 'Rs ' + M.fmtNum(p.sold_so_far) + ' (' + p.pct_done + '%)'], ['NEEDED / DAY', 'Rs ' + M.fmtNum(p.needed_per_day)], ['ACTUAL / DAY', 'Rs ' + M.fmtNum(p.actual_per_day)]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      h('div', { class: 'aic-interp' }, h('span', { class: 'aic-tag', text: 'CALCULATION' }), ' ', F.summary),
      F.projection != null ? h('div', { class: 'aic-sub' }, h('span', { class: 'aic-tag', text: 'PREDICTION' }), ' Briefing projection (average × days in month): Rs ' + M.fmtNum(F.projection)) : null,
      F.disagree ? h('div', { class: 'aic-note', text: 'Two existing calculations disagree on whether the target will be met (pace tracker vs briefing projection). Both are shown; the pace tracker is the one the Dashboard uses.' }) : null,
      h('div', { class: 'aic-row' }, h('button', { text: 'Ask BT to interpret', onclick: () => ask('Interpret my target pace for this month and say what would need to change to reach the target.') })));
  }
  return card('fc', 'monitor', sectionHeader('FORECAST', h('span', { class: 'aic-sub', text: 'Analytics.getTargetPaceForMonth' })), body);
}

// ── agent network ──
const NODES = [['sales', 50, 12], ['manager', 85, 32], ['inventory', 85, 68], ['str', 50, 88], ['closing', 15, 68], ['billing', 15, 32], ['documents', 32, 50], ['analyst', 68, 50]];
function agentStats(id) {
  const label = SPECIALISTS[id].label, ev = T.recent(400, e => e.type === 'request_start' && e.agent === label);
  return { runs: ev.length, last: ev[0] ? ev[0].timestamp : null };
}
function secNetwork(info) {
  const live = info.live, active = new Set(), toolBy = {};
  if (live.open && live.routed && live.routed.metadata) { (live.routed.metadata.domains || []).forEach(d => active.add(d)); if (live.routed.metadata.specialist) active.add(live.routed.metadata.specialist); if ((live.routed.metadata.domains || []).length > 1) active.add('analyst'); }
  if (live.activeTool && live.activeTool.domain) { active.add(live.activeTool.domain); toolBy[live.activeTool.domain] = live.activeTool.tool; }
  const lines = NODES.map(([, x, y]) => h2svg('line', { x1: 50, y1: 50, x2: x, y2: y }));
  const nodes = NODES.map(([id, x, y]) => {
    const st = agentStats(id), on = active.has(id);
    return h('button', { class: 'aic-node' + (on ? ' on' : ''), style: 'left:' + x + '%;top:' + y + '%', onclick: () => openAgent(id), 'aria-label': SPECIALISTS[id].label + (on ? ' active' : st.runs ? ' ran ' + st.runs + ' times' : ' not run this session') },
      h('b', { text: SPECIALISTS[id].label }), h('small', { text: on ? (toolBy[id] ? 'running ' + toolBy[id] : 'active') : st.runs ? 'last ' + M.ageLabel(st.last) : 'idle' }));
  });
  const svg = h2svg('svg', { class: 'aic-lines', viewBox: '0 0 100 100', 'aria-hidden': 'true' }); lines.forEach(l => svg.append(l));
  return card('net', 'investigate', sectionHeader('AGENT NETWORK', h('span', { class: 'aic-sub', text: 'real specialists · lit only while running' })),
    h('div', { class: 'aic-net' }, svg, h('div', { class: 'aic-hub' }, h('b', { text: 'BT' }), h('small', { text: 'Orchestrator' })), nodes),
    h('div', { class: 'aic-sub', text: 'Specialists are chosen per question by rule-based routing (with a model fallback). The Analyst is used when 2+ areas match.' }));
}
function h2svg(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; }

function openAgent(id) {
  const sp = SPECIALISTS[id], st = agentStats(id), tools = listTools().filter(t => t.domain === id);
  const ev = T.recent(60, e => e.agent === sp.label).slice(0, 10);
  openModal(sp.label + ' specialist', h('div', {},
    h('dl', { class: 'aic-met' }, [['Runs (7 days, this device)', String(st.runs)], ['Last run', st.last ? M.ageLabel(st.last) : 'not run yet'], ['Tools', String(id === 'analyst' ? 'all domains it is routed to' : tools.length)]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    tools.length ? h('ul', { class: 'aic-list' }, tools.map(t => h('li', {}, h('b', { text: t.name }), ' ', h('span', { class: 'aic-pill aic-' + (t.risk === 'read' || t.risk === 'ui' ? 'ok' : 'wn'), text: t.risk }), h('div', { class: 'aic-sub', text: t.description.slice(0, 140) })))) : null,
    ev.length ? [h('div', { class: 'aic-k', text: 'RECENT EVENTS' }), eventList(ev)] : empty('No events from this specialist yet in this session.')));
}

// ── findings ──
// BT's assessment. An orchestrated investigation shows what really happened (which specialists ran, what each returned), typed
// evidence, the Analyst's confidence and the recommendation. A plain Ask BT answer keeps the old text-only view.
const CLASS_NOTE = { 'AI INTERPRETATION': 'interpretation, not a calculation', CORRELATION: 'moved together, not proof of cause', FACT: 'as returned by the tool', RECOMMENDATION: 'advice from the Analyst' };
function assessmentNode(A) {
  const inv = A.investigation;
  if (!inv || !inv.synthesis) return h('div', { class: 'aic-assess' }, h('div', {}, h('span', { class: 'aic-tag aic-k-ai', text: 'AI INTERPRETATION' }), ' ', h('span', { class: 'aic-sub', text: 'Confidence not rated. Treat as an explanation to check against the evidence above, not as a calculation.' })), h('div', { class: 'aic-md', html: null }, mdNode(A.text)));
  const syn = inv.synthesis, st = inv.stats, rec = syn.recommendation;
  const ran = inv.entries.map(e => h('span', { class: 'aic-tag aic-spec-' + (e.status === 'ok' && e.grounded ? 'ok' : 'bad'), title: e.error || '', text: e.label + ': ' + (e.status !== 'ok' ? e.status.toUpperCase() : e.grounded ? e.tools.length + ' tool call(s)' : 'NO DATA') }));
  const items = (syn.evidence_items || []).map(it => h('li', {}, tagEl(it.class), ' ', h('b', { text: it.label + ': ' }), it.text, ' ', h('span', { class: 'aic-sub', text: '(' + it.source + (CLASS_NOTE[it.class] ? ', ' + CLASS_NOTE[it.class] : '') + (it.causal_language ? ', wording claimed a cause: unproven' : '') + ')' })));
  return h('div', { class: 'aic-assess' },
    h('div', {}, h('span', { class: 'aic-tag aic-k-ai', text: 'AI INTERPRETATION' }), ' ', h('span', { class: 'aic-sub', text: 'Confidence: ' + syn.confidence + (syn.confidence_reason ? ' - ' + syn.confidence_reason : '') + '. An explanation to check against the evidence, not a calculation.' })),
    h('p', { text: syn.conclusion }),
    h('div', { class: 'aic-k', text: 'SPECIALISTS THAT ACTUALLY RAN (' + st.grounded + ' of ' + st.members + ' returned data)' }), h('div', { class: 'aic-path' }, ran),
    h('div', { class: 'aic-k', text: 'EVIDENCE USED' }), items.length ? h('ul', { class: 'aic-list' }, items) : empty('No evidence rows.'),
    syn.conflicts.length ? [h('div', { class: 'aic-k', text: 'CONFLICTS BETWEEN SPECIALISTS' }), h('ul', { class: 'aic-list' }, syn.conflicts.map(c => h('li', { text: c.statement })))] : null,
    syn.gaps.length || st.failed || st.ungrounded.length ? [h('div', { class: 'aic-k', text: 'NOT CHECKED / MISSING' }), h('ul', { class: 'aic-list' }, [...syn.gaps.map(g => h('li', { text: g })), ...inv.entries.filter(e => e.status !== 'ok').map(e => h('li', { text: e.label + ' specialist ' + e.status + (e.error ? ' (' + e.error + ')' : '') + ': its area was not checked.' })), ...st.ungrounded.map(id => h('li', { text: id + ' specialist retrieved no data, so it was not used as evidence.' }))])] : null,
    rec
      ? [h('div', { class: 'aic-k', text: 'AI RECOMMENDATION' }), h('div', {}, tagEl('RECOMMENDATION'), ' ', h('b', { text: rec.action })),
        h('dl', { class: 'aic-met' }, [['Why', rec.why], ['Expected result', rec.expected_result || 'not stated'], ['Risk', rec.risk], ['Affects', rec.affected.join(', ') || 'not stated'], ['Based on', rec.evidence_from.join(' + ')],
          ['Approval', rec.approval_required ? 'Required for any change; ' + rec.reversibility_note : 'Not needed: advice only, nothing is changed'], ['Verification', rec.how_verified]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))]
      : [h('div', { class: 'aic-k', text: 'AI RECOMMENDATION' }), h('p', { class: 'aic-sub', text: syn.dropped_recommendation ? 'Withheld: the Analyst suggested something that was not tied to data a specialist retrieved.' : 'The Analyst did not recommend an action.' })],
    h('div', { class: 'aic-sub', text: 'Investigation ' + inv.id + ' took ' + M.fmtDur(inv.ms) + '. Agreement/conflict and correlation are the Analyst\'s reading of the evidence; the tool outputs are the facts.' }));
}
function openFinding(f) {
  const A = S.assess[f.id];
  const ev = f.evidence.map(e => h('li', {}, h('span', { class: 'aic-tag aic-k-' + e.kind.split(' ')[0].toLowerCase(), text: e.kind }), ' ', h('b', { text: e.label + ': ' }), e.value));
  openModal(f.title.length > 60 ? f.type + ' · ' + f.system : f.title, h('div', { class: 'aic-find' },
    h('div', { class: 'aic-row' }, pill(f.severity === 'warning' ? 'WARNING' : f.severity === 'good' ? 'HEALTHY' : 'UNKNOWN', f.severity.toUpperCase()), h('span', { class: 'aic-tag', text: f.system }), h('span', { class: 'aic-tag', text: f.type }), h('span', { class: 'aic-sub', text: 'Observed ' + M.ageLabel(f.detected_at) + ' · ' + clock(f.detected_at) })),
    h('div', { class: 'aic-k', text: 'WHAT HAPPENED' }), h('p', { text: f.description }),
    h('div', { class: 'aic-k', text: 'EVIDENCE' }), h('ul', { class: 'aic-list' }, ev),
    h('div', { class: 'aic-k', text: 'INVESTIGATION PATH' }), h('div', { class: 'aic-path' }, f.related_agents.map((a, i) => [i ? h('span', { class: 'aic-arrow', text: '→' }) : null, h('span', { class: 'aic-tag', text: a })]), h('div', { class: 'aic-sub', text: 'Tools: ' + f.related_tools.join(', ') })),
    h('div', { class: 'aic-k', text: "BT'S ASSESSMENT" }),
    A ? assessmentNode(A)
      : h('p', { class: 'aic-sub', text: 'BT has not been asked about this yet. The detection above is rule-based, with no AI involved.' }),
    h('div', { class: 'aic-k', text: 'WHY AM I SEEING THIS' }), h('p', { class: 'aic-sub', text: 'Rule-based check "' + f.source + '" ran on your current data. Known: the FACT and CALCULATION rows. Not known: the cause. That needs investigation.' }),
    h('div', { class: 'aic-k', text: 'RECOMMENDATION' }), h('p', {}, tagEl('RECOMMENDATION'), ' ', h('span', { class: 'aic-sub', text: '(fixed rule, not AI) ' }), f.recommendation, ' BT will never change data without your approval.'),
    h('div', { class: 'aic-k', text: 'WHAT HAPPENS IF I ACT' }), h('p', { class: 'aic-sub', text: f.if_act }),
    h('div', { class: 'aic-k', text: 'RELATED RECORDS' }), h('div', { class: 'aic-path' }, (f.related_entities || []).map(r => h('span', { class: 'aic-tag', text: r.kind + ': ' + r.value }))),
    h('div', { class: 'aic-k', text: 'AUDIT REFERENCE' }), h('p', { class: 'aic-sub', text: f.audit_reference + '. Read-only detection: nothing was changed. Changes made later through BT appear in the audit log with their own reference.' }),
    h('div', { class: 'aic-row' },
      h('button', { class: 'aic-p', text: 'Investigate with BT', onclick: () => investigate(f) }),
      h('button', { text: 'Open source page', onclick: () => openPage(f.action.href) }),
      h('button', { class: 'aic-g', text: 'Dismiss for today', onclick: () => { const d = lsGet(LS_DISMISS) || {}; d[f.id] = M.isoDay(new Date()); lsSet(LS_DISMISS, d); closeModal(); render(); } }))),
  { sub: f.source, tonec: tone(f.severity === 'warning' ? 'WARNING' : 'HEALTHY') });
}
function mdNode(text) { const d = document.createElement('div'); d.innerHTML = renderMarkdown(text); return d; } // renderMarkdown escapes everything first

function openSystem(name) {
  const s = S.snap && S.snap.systems[name]; if (!s) return;
  const src = M.SYSTEM_SOURCES[name], fs = visibleFindings().filter(f => f.system === name);
  const dom = name.toLowerCase();
  const ev = T.recent(80, e => e.domain === dom || (src.tools.includes(e.tool))).slice(0, 8);
  openModal(name + ' INTELLIGENCE', h('div', {},
    h('div', { class: 'aic-row' }, pill(s.status), h('span', { class: 'aic-sub', text: s.reason }), h('span', { class: 'aic-fresh aic-' + tone(s.fresh.status), text: 'Data: ' + s.fresh.label })),
    h('div', { class: 'aic-k', text: 'CURRENT NUMBERS (from existing tools)' }), s.metrics.length ? h('dl', { class: 'aic-met aic-big' }, s.metrics.map(m => [h('dt', { text: m.label, title: m.src }), h('dd', { text: m.value })])) : empty(s.availability.reason || 'No data'),
    h('div', { class: 'aic-k', text: 'FINDINGS' }), fs.length ? fs.map(findingCard) : empty('No open findings for this system.'),
    h('div', { class: 'aic-k', text: 'RELATED AGENTS AND TOOLS' }), h('div', { class: 'aic-path' }, src.agents.map(a => h('span', { class: 'aic-tag', text: a })), h('div', { class: 'aic-sub', text: src.tools.join(', ') })),
    deepViews(name),
    h('div', { class: 'aic-k', text: 'RECENT ACTIVITY' }), ev.length ? eventList(ev) : empty('No activity for this system yet on this device.'),
    h('div', { class: 'aic-row' }, h('button', { class: 'aic-p', text: 'Investigate with BT', onclick: () => { closeModal(); ask(SYSTEM_ASK[name]); } }), h('button', { text: 'Open ' + name.toLowerCase() + ' page', onclick: () => openPage(M.SYSTEM_PAGE[name]) }))),
  { tonec: tone(s.status) });
}

// ── activity ──
function eventList(evs) {
  return h('ul', { class: 'aic-ev' }, evs.map(e => h('li', { class: 'aic-evi aic-sev-' + (e.severity || 'info') + (e.historical ? ' aic-hist-ev' : '') },
    h('time', { text: e.historical ? clockFull(e.timestamp) : clock(e.timestamp) }), e.historical ? h('span', { class: 'aic-tag aic-earlier', text: 'EARLIER', title: 'Restored from a previous session on this device. Not live.' }) : null, h('span', { class: 'aic-evt', text: M.describeEvent(e) }),
    (e.type === 'tool_end' || e.type === 'tool_start') ? h('button', { class: 'aic-g aic-insp', text: 'inspect', onclick: () => inspect(e) }) : null)));
}
function inspect(e) {
  const start = T.recent(400, x => x.type === 'tool_start' && x.entity_reference === e.entity_reference)[0];
  const end = T.recent(400, x => x.type === 'tool_end' && x.entity_reference === e.entity_reference)[0];
  const def = listTools().find(t => t.name === e.tool);
  const rows = [['Agent', e.agent || (e.source === 'ai-center' ? 'AI Center monitoring read' : '—')], ['Tool', e.tool], ['Domain', e.domain || '—'], ['Risk', (e.metadata && e.metadata.risk) || (def && def.risk) || '—'],
    ['Input', JSON.stringify((start && start.metadata && start.metadata.args) || {}) + '  (sensitive keys redacted)'], ['Data source', 'Existing app data via the tool registry'], ['Status', (end && end.status) || 'running'], ['Duration', end && end.duration != null ? end.duration + ' ms' : '—'], ['Result', 'Not retained here. Results stay in the assistant conversation.'], ['Started', clock(start && start.timestamp)]];
  openModal('Tool execution', h('dl', { class: 'aic-met aic-big aic-insp-dl' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])), { sub: 'Agent → Tool → Input → Result' });
}
function secActivity() {
  const evs = T.recent(150, e => M.eventMatches(e, S.filter)).slice(0, 40);
  return card('act', 'investigate act',
    sectionHeader('LIVE ACTIVITY', h('span', { class: 'aic-sub', text: 'real events only' })),
    h('div', { class: 'aic-filters', role: 'group', 'aria-label': 'Filter activity' }, M.FILTERS.map(([id, label]) => h('button', { class: S.filter === id ? 'on' : '', 'aria-pressed': String(S.filter === id), text: label, onclick: () => { S.filter = id; render(); } }))),
    evs.length ? eventList(evs) : empty('No ' + (S.filter === 'all' ? '' : S.filter + ' ') + 'activity yet in this session. Events appear here when BT actually runs.'),
    S.history.length && (S.filter === 'all' || S.filter === 'tools' || S.filter === 'actions') ? h('details', { class: 'aic-hist' }, h('summary', { text: 'Earlier tool activity (audit log, all devices)' }), h('ul', { class: 'aic-ev' }, S.history.filter(x => S.filter !== 'actions' || x.change).map(x => h('li', { class: 'aic-evi' }, h('time', { text: new Date(x.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }), h('span', { class: 'aic-evt', text: x.tool + ' · ' + x.status }))))) : null);
}

// ── action center ──
function secActions(info) {
  const live = info.live, pending = live.pendingApproval, A = S.actions;
  const A_ok = window.BTAgent ? window.BTAgent.writesAllowed() : false, killed = window.BTAgent ? window.BTAgent.killed() : true;
  const body = [];
  body.push(h('div', { class: 'aic-gate aic-' + (killed ? 'cr' : A_ok ? 'ok' : 'wn') }, killed ? '⛔ AI changes are stopped on all devices (kill switch).' : A_ok ? '🔓 Changes allowed on this device. You approve every one.' : '🔒 Read-only on this device. BT can recommend but not change anything. Unlock from the assistant header.'));
  body.push(h('div', { class: 'aic-k', text: 'PENDING APPROVAL' }));
  body.push(...approvalNodes(info));
  body.push(h('div', { class: 'aic-k', text: 'UNDOABLE (last 48 hours)' }));
  if (!A) body.push(skeleton(2));
  else if (A.state === 'error') body.push(h('div', { class: 'aic-err', text: 'Could not read the audit log: ' + A.error }));
  else {
    body.push(A.undos.length ? h('ul', { class: 'aic-list' }, A.undos.map(u => h('li', {}, h('b', { text: u.label }), h('div', { class: 'aic-sub', text: M.ageLabel(u.at) + ' · ' + u.tool }), h('button', { text: '↶ Undo', onclick: async ev => { ev.target.disabled = true; const it = pushUndo({ tool: u.tool, label: u.label, fn: u.fn, key: u.key }); const r = await runUndo(it.id); if (r.ok && r.key) await markUndone(getSb(), r.key); toast(r.ok ? 'Undone: ' + r.label : 'Undo failed: ' + r.error); refresh({ force: true }); } })))) : empty('No undoable changes.'));
    body.push(h('div', { class: 'aic-k', text: 'RECENT CHANGES (audit log)' }));
    body.push(A.recent.length ? h('ul', { class: 'aic-ev' }, A.recent.map(r => h('li', { class: 'aic-evi' }, h('time', { text: new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }), h('span', { class: 'aic-evt', text: r.tool + ' · ' + r.status + (r.error ? ' (' + r.error + ')' : '') }), h('span', { class: 'aic-sub', text: r.ref })))) : empty('No AI changes recorded.'));
  }
  return card('actc', 'act', sectionHeader('ACTION CENTER', h('span', { class: 'aic-sub', text: 'BT proposes · you approve' })), body);
}

//  approval view (section 25): the real proposal, decided through the ONE shared controller
const tagEl = k => h('span', { class: 'aic-tag aic-k-' + String(k).split(' ')[0].toLowerCase(), text: k });
function afterDecision(r, action) {
  if (!r || r.ok !== true) {
    toast(r && r.needs === 'type' ? 'Type the confirmation word first.' : r && r.needs === 'confirm' ? 'Tap once more to confirm.' : (r && r.error) || 'Could not record that decision.');
  } else toast(action === 'approve' ? 'Approved. BT will apply the change, then read it back to verify.' : 'Rejected. Nothing was changed.');
  render();
}
function approvalNodes(info) {
  const A = window.BTAgent, list = A && typeof A.approvals === 'function' ? A.approvals() : null, pending = info.live.pendingApproval;
  if (!list) return [pending ? h('div', { class: 'aic-appr' }, h('b', { text: (pending.metadata && pending.metadata.title) || pending.tool }), h('div', { class: 'aic-row' }, h('button', { class: 'aic-p', text: 'Review and decide', onclick: () => A && A.open() }))) : empty('Nothing is waiting for approval.')];
  if (!list.length) return [empty('Nothing is waiting for approval.')];
  return list.map(approvalCard);
}
function approvalCard(p) {
  const req = T.recent(400, e => e.type === 'approval_requested' && e.entity_reference === p.id)[0] || null, v = M.approvalView(p, req), A = window.BTAgent;
  const typed = v.gate.kind === 'type' ? h('input', { class: 'aic-pin', type: 'text', placeholder: 'Type ' + v.gate.word, 'aria-label': 'Type the confirmation word', autocomplete: 'off' }) : null;
  const killed = A.killed(), decide = (action, ev) => afterDecision(A.decide(p.id, action, { typed: typed ? typed.value : undefined, gesture: ev }), action);
  const sec = (label, ...kids) => [h('div', { class: 'aic-k', text: label }), ...kids];
  return h('div', { class: 'aic-appr aic-ap2 aic-t-' + v.tone, role: 'group', 'aria-label': 'Approval request: ' + v.title },
    h('div', { class: 'aic-row' }, h('b', { text: v.title }), pill(v.risk === 'critical' ? 'ERROR' : 'WARNING', v.risk.toUpperCase())),
    sec('WHY BT IS ASKING', h('div', { class: 'aic-sub' }, tagEl(v.why.kind), ' ', v.why.text)),
    sec('EVIDENCE (the exact proposal)', v.evidence.length ? h('ul', { class: 'aic-list' }, v.evidence.map(e => h('li', {}, tagEl(e.kind), ' ', h('b', { text: e.label + ': ' }), e.value))) : h('div', { class: 'aic-sub', text: 'The tool gave no detail lines.' })),
    v.warnings.length ? sec('WARNINGS', h('ul', { class: 'aic-list' }, v.warnings.map(w => h('li', { text: w })))) : null,
    sec('EXPECTED RESULT', h('div', { class: 'aic-sub', text: v.expected + ' ' + v.verification })),
    sec('REVERSIBILITY', h('div', { class: 'aic-sub aic-' + (v.reversibility.ok ? 'ok' : 'cr'), text: v.reversibility.text })),
    v.affected.length ? sec('AFFECTED RECORDS', h('dl', { class: 'aic-met' }, v.affected.map(a => [h('dt', { text: a.label }), h('dd', { text: a.value })]))) : null,
    h('div', { class: 'aic-sub', text: v.gate.text }), typed,
    h('div', { class: 'aic-row' },
      h('button', { class: 'aic-p', text: v.gate.kind === 'twotap' && p.armed ? 'Yes, I am sure' : 'Approve', disabled: killed, onclick: ev => decide('approve', ev) }),
      h('button', { text: 'Reject', onclick: ev => decide('reject', ev) })),
    killed ? h('div', { class: 'aic-err', text: 'Kill switch is ON: changes are stopped.' }) : null);
}

//  correlation (rule-based co-occurrence of findings; never a claim of cause)
function secCorrelation() {
  if (!S.snap) return null;
  const c = M.correlate(visibleFindings());
  return card('corr', 'monitor', sectionHeader('CROSS-AREA SIGNALS', h('span', { class: 'aic-sub', text: 'rule-based, not proof' })),
    c.length ? c.map(x => h('div', { class: 'aic-f aic-sev-warning aic-corr' }, h('div', { class: 'aic-fh' }, x.systems.map(sy => h('span', { class: 'aic-tag', text: sy })), tagEl('CORRELATION')),
      h('div', { class: 'aic-ft', text: x.title }), h('div', { class: 'aic-sub', text: x.why }), h('div', { class: 'aic-row' }, h('button', { text: 'Ask BT to check', onclick: () => ask('Check whether these are connected, using your tools, and say what is known and what is uncertain: ' + x.parts.map(p => p.title).join(' / ')) }))))
      : empty('No findings in two areas at once right now.'));
}

//  observability (section 42): measured from real recorded events (last 7 days on this device + this session)
function secObs() {
  const o = M.observability(T.recent(400).reverse()), na = 'no data yet';
  const row = (k, v) => [h('dt', { text: k }), h('dd', { text: v })];
  return card('obs', 'investigate', sectionHeader('OBSERVABILITY', h('span', { class: 'aic-sub', text: 'last 7 days, this device' })),
    h('dl', { class: 'aic-met aic-big' }, [
      ...row('REQUESTS', o.requests + ' (' + o.answered + ' answered, ' + o.errors + ' failed)'), ...row('AVG INVESTIGATION', o.avgInvestigationMs != null ? M.fmtDur(o.avgInvestigationMs) : na), ...row('LONGEST', o.maxInvestigationMs != null ? M.fmtDur(o.maxInvestigationMs) : na),
      ...row('APPROVALS', o.approvals + ' decided (' + o.approvalsRejected + ' rejected)'), ...row('AVG APPROVAL WAIT', o.avgApprovalWaitMs != null ? M.fmtDur(o.avgApprovalWaitMs) : na), ...row('RETRIES', String(o.retries)),
      ...row('VERIFIED CHANGES', o.verified + ' passed, ' + o.verifyFailed + ' failed')]),
    h('div', { class: 'aic-sub', text: 'Older than 7 days, or from another device, is not included. Cross-device history lives in the audit log.' }));
}

//  deeper system views: existing READ tools, loaded only when you ask
const DEEP = {
  INVENTORY: [['Fast movers running out', 'low_cover_items', { max_days: 15, limit: 8 }], ['Out of stock but selling', 'low_stock_items', { max_qty: 0, only_selling: true, limit: 8 }], ['Slow movers (no sale 30+ days)', 'slow_moving_stock', { days: 30, limit: 8 }], ['Dead stock (no sale 90+ days)', 'slow_moving_stock', { days: 90, limit: 8 }]],
  SALES: [['Best sales days', 'top_sales_days', {}]], STR: [['Incoming STRs not received', 'list_pending_strs', { direction: 'in', limit: 8 }]], CLOSING: [['Last 14 days of closing', 'closing_recent_days', { days: 14 }]],
};
const scalar = v => v != null && typeof v !== 'object';
function renderDeep(data) {
  const arr = Object.entries(data || {}).find(([, v]) => Array.isArray(v)), head = Object.entries(data || {}).filter(([, v]) => scalar(v)).slice(0, 6);
  return h('div', {}, head.length ? h('dl', { class: 'aic-met' }, head.map(([k, v]) => [h('dt', { text: k.replace(/_/g, ' ') }), h('dd', { text: typeof v === 'number' ? M.fmtNum(v) : String(v) })])) : null,
    arr && arr[1].length ? h('ul', { class: 'aic-list' }, arr[1].slice(0, 12).map(it => { const o = it && typeof it === 'object' ? it : { value: it }, first = o.name || o.str || o.date || o.value || ''; const rest = Object.entries(o).filter(([k, v]) => scalar(v) && v !== first && !['name', 'str', 'date'].includes(k)).slice(0, 5).map(([k, v]) => k.replace(/_/g, ' ') + ' ' + (typeof v === 'number' ? M.fmtNum(v) : v)).join('  |  '); return h('li', {}, h('b', { text: String(first) }), rest ? h('div', { class: 'aic-sub', text: rest }) : null); })) : h('div', { class: 'aic-sub', text: 'Nothing matched.' }));
}
function deepViews(name) {
  const defs = DEEP[name]; if (!defs) return null;
  return h('div', {}, h('div', { class: 'aic-k', text: 'DEEPER VIEWS (existing read-only tools, loaded on request)' }), defs.map(([label, tool, args]) => {
    const key = name + ':' + label, out = h('div', { class: 'aic-deep' });
    const paint2 = () => { const d = S.deep[key]; out.replaceChildren(d ? (d.error ? h('div', { class: 'aic-err', text: d.error }) : renderDeep(d.data)) : ''); };
    paint2();
    return h('div', { class: 'aic-dv' }, h('button', { text: label, onclick: async ev => { const b = ev.currentTarget; b.disabled = true; try { S.deep[key] = { data: await readTool(tool, args) }; } catch (e) { S.deep[key] = { error: (e && e.message) || 'Could not read this.' }; } b.disabled = false; paint2(); } }), h('span', { class: 'aic-sub', text: ' ' + tool }), out);
  }));
}

// ── health ──
function secHealth() {
  const rows = S.health;
  return card('health', 'monitor', sectionHeader('SYSTEM HEALTH', h('span', { class: 'aic-sub', text: 'measured, not assumed' })),
    rows ? h('ul', { class: 'aic-hl' }, rows.map(r => h('li', {}, h('span', { class: 'aic-hn', text: r.label }), pill(r.status), h('span', { class: 'aic-sub', text: r.detail })))) : skeleton(4));
}

// ── tools (lazy) ──
function secTools() {
  const body = h('div', { class: 'aic-toolsbody' });
  const det = h('details', { class: 'aic-tooldet', ontoggle: ev => { S.toolsOpen = ev.target.open; if (S.toolsOpen) fillTools(body); } }, h('summary', { text: listTools().length + ' registered tools · risk, approval and 7-day stats on this device' }), body);
  if (S.toolsOpen) { det.setAttribute('open', ''); fillTools(body); }
  return card('tools', 'investigate', sectionHeader('TOOL INTELLIGENCE'), det);
}
function fillTools(el) {
  const stats = T.toolStats(), by = {}, gate = { writesAllowed: window.BTAgent ? window.BTAgent.writesAllowed() : false, killed: window.BTAgent ? window.BTAgent.killed() : true };
  listTools().forEach(t => (by[t.domain] = by[t.domain] || []).push(t));
  el.replaceChildren(...Object.keys(by).sort().map(d => h('div', { class: 'aic-tg' }, h('div', { class: 'aic-k', text: d.toUpperCase() + ' TOOLS' }), h('div', { class: 'aic-twrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Tool', 'Purpose', 'Status', 'R/W', 'Risk', 'Approval', 'Runs', 'Success', 'Avg', 'Last used'].map(x => h('th', { text: x })))),
    h('tbody', {}, by[d].map(t => { const st = stats[t.name], chg = t.risk === 'write' || t.risk === 'critical'; const ts = M.toolStatus(t, gate); return h('tr', {}, h('td', { text: t.name, title: t.description }), h('td', { class: 'aic-purp', text: M.toolPurpose(t) }), h('td', {}, h('span', { class: 'aic-pill aic-' + M.toolTone(ts.status), text: ts.status, title: ts.detail })), h('td', { text: chg ? 'Write' : t.risk === 'ui' ? 'UI' : 'Read' }), h('td', {}, h('span', { class: 'aic-pill aic-' + (chg ? (t.risk === 'critical' ? 'cr' : 'wn') : 'ok'), text: t.risk })), h('td', { text: chg ? 'Required' + (t.risk === 'critical' ? ' + typed word' : '') : 'No' }), h('td', { text: st ? String(st.calls) : '0' }), h('td', { text: st && st.successRate != null ? st.successRate + '%' : '—' }), h('td', { text: st && st.avgMs != null ? st.avgMs + ' ms' : '—' }), h('td', { text: st ? M.ageLabel(st.lastAt) : 'not in 7 days' })); }))))))); }

// ── repository intelligence (loads the static index; shows NOT CONNECTED if it cannot) ──
function loadRepoIndex() {
  if (S.repo.state !== 'idle') return;
  S.repo.state = 'loading';
  Promise.resolve().then(() => (typeof fetch === 'function' ? fetch('js/ai-center/repo-index.json', { cache: 'no-cache' }) : Promise.reject(new Error('no fetch'))))
    .then(r => (r && r.ok ? r.json() : Promise.reject(new Error('HTTP ' + (r && r.status)))))
    .then(j => { if (!M.validRepoIndex(j)) throw new Error('bad index'); S.repo = { state: 'ready', idx: j }; })
    .catch(() => { S.repo = { state: 'error', idx: null }; })
    .then(() => render());
}
function secRepo() {
  loadRepoIndex();
  const R = S.repo, info = R.state === 'ready' ? M.repoIndexInfo(R.idx) : null;
  const head = sectionHeader('REPOSITORY INTELLIGENCE', info ? pill(info.stale ? 'WARNING' : 'HEALTHY', info.stale ? 'INDEX OLD' : 'INDEX READY') : pill(R.state === 'loading' ? 'UNKNOWN' : 'OFFLINE', R.state === 'loading' ? 'LOADING' : 'NOT CONNECTED'));
  if (!info) return card('repo', 'investigate', head, h('p', { class: 'aic-sub', text: R.state === 'loading' ? 'Loading the code index...' : 'The code index (js/ai-center/repo-index.json) could not be loaded, so BT cannot say where things are calculated. Nothing here pretends otherwise. Build it with: npm run index:repo' }));
  const results = h('div', { class: 'aic-rres' });
  const locNode = l => h('li', {}, tagEl(String(l.kind || 'file').toUpperCase()), ' ', h('b', { text: l.symbol || l.file }),
    l.domain ? h('span', { class: 'aic-sub', text: '  ' + l.domain + ' / ' + l.risk }) : null,
    h('div', { class: 'aic-sub', text: l.file + ':' + l.line + (l.role ? '  |  ' + l.role : '') }),
    l.summary ? h('div', { class: 'aic-sub', text: l.summary }) : null,
    l.related && (l.related.tools.length || l.related.features.length) ? h('div', { class: 'aic-path' }, l.related.tools.slice(0, 4).map(t => h('span', { class: 'aic-tag', text: 'tool: ' + t })), l.related.features.slice(0, 3).map(f => h('span', { class: 'aic-tag', text: 'feature: ' + f }))) : null,
    l.github ? h('a', { class: 'aic-sub', href: l.github, target: '_blank', rel: 'noopener noreferrer', text: 'Read the code on GitHub (indexed commit)' }) : null);
  const draw = () => {
    const q = S.repoQ.trim();
    if (!q) { results.replaceChildren(h('div', { class: 'aic-sub', text: 'Ask where something is, or pick an example or topic below. Try: target pace, cash diff, low stock, closing, approval.' })); return; }
    // the real service: curated, index-verified architecture notes + tool lookup + symbol search
    const a = RI.answerRepoQuestion(R.idx, q, { registered: listTools().map(t => t.name), limit: 10 });
    if (!a.ok || a.kind === 'none') { results.replaceChildren(empty(a.explanation || a.reason || 'No symbol, tool or file matches "' + q + '".')); return; }
    results.replaceChildren(
      h('div', { class: 'aic-k', text: a.title.toUpperCase() }),
      a.explanation ? h('div', {}, h('span', { class: 'aic-tag aic-k-ai', text: a.kind === 'tools' ? 'FROM THE INDEX' : 'ARCHITECTURE NOTE' }), ' ', h('span', { class: 'aic-sub', text: a.source || '' }), h('p', { text: a.explanation })) : null,
      h('ul', { class: 'aic-list' }, a.locations.map(locNode)),
      a.unresolved.length ? h('div', { class: 'aic-note', text: a.unresolved.length + ' location(s) in the note could not be found in the current index and are not shown: ' + a.unresolved.map(u => u.file + (u.symbol ? '#' + u.symbol : '')).join(', ') }) : null,
      h('div', { class: 'aic-sub', text: a.notes.join(' ') }));
  };
  const input = h('input', { id: 'aic-rq', class: 'aic-pin', type: 'search', placeholder: 'Where is it implemented? e.g. approval, VERIFY, target pace', 'aria-label': 'Ask the code index', autocomplete: 'off', value: S.repoQ });
  const setQ = v => { S.repoQ = v; input.value = v; draw(); };
  input.addEventListener('input', () => { S.repoQ = input.value; draw(); });
  draw();
  return card('repo', 'investigate', head,
    h('p', { class: 'aic-sub', text: info.files + ' files, ' + info.symbols + ' symbols. Built ' + info.age + ' at commit ' + info.commit + '. It tells you WHERE things are implemented (file, line, summary, related tool). It holds no source code: use the GitHub link to read it. Secret-bearing files are excluded. This is a snapshot, not live.' }),
    info.stale ? h('div', { class: 'aic-note', text: 'This index is more than 14 days old. Rebuild it with: npm run index:repo' }) : null,
    input,
    h('div', { class: 'aic-chips', 'aria-label': 'Example questions' }, RI.SAMPLE_QUESTIONS.map(x => h('button', { text: x, onclick: () => setQ(x) }))),
    h('div', { class: 'aic-chips', 'aria-label': 'Architecture topics' }, RI.CONCEPTS.map(c => h('button', { class: 'aic-g', text: c.title, onclick: () => setQ(c.title) }))),
    results);
}

// ── latest answer ──
function secResponse() {
  const e = T.recent(400, x => x.type === 'answer' || x.type === 'instant')[0];
  const err = T.recent(400, x => x.type === 'error')[0];
  const showErr = err && (!e || err.timestamp > e.timestamp);
  return card('resp', 'investigate', sectionHeader('LATEST BT RESPONSE', e ? h('span', { class: 'aic-sub', text: M.ageLabel(e.timestamp) + (e.type === 'instant' ? ' · instant, no AI used' : '') }) : null),
    showErr ? h('div', { class: 'aic-err', text: 'The last request failed: ' + ((err.metadata && err.metadata.message) || 'unknown error') })
      : e && e.metadata && e.metadata.text ? [mdNode(e.metadata.text), h('div', { class: 'aic-row' }, h('button', { text: 'Open full conversation', onclick: () => window.BTAgent && window.BTAgent.open() }))]
        : empty('Ask BT below. Answers appear here and in the assistant panel.'));
}

// ───────────────────────── command bar + palette ─────────────────────────
const CHIPS = ['What needs my attention?', 'What is blocking closing?', 'Which STRs are delayed?', 'What inventory is at risk?', 'Forecast this month'];
function cmdBar() {
  const input = h('input', { id: 'aic-q', type: 'text', placeholder: 'Ask BT anything about your business…', 'aria-label': 'Ask BT', autocomplete: 'off', enterkeyhint: 'send', maxlength: '2000' });
  const go = () => { const v = input.value; if (v.trim()) { input.value = ''; ask(v); } };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { class: 'aic-cmd' },
    h('div', { class: 'aic-chips' }, CHIPS.map(c => h('button', { text: c, onclick: () => ask(c) }))),
    h('div', { class: 'aic-form' }, input,
      h('button', { class: 'aic-mic', disabled: true, title: 'Voice is not available: BT has no voice pipeline yet', 'aria-label': 'Voice input unavailable', text: '🎙' }),
      h('button', { class: 'aic-p', 'aria-label': 'Send', text: '➤', onclick: go }),
      h('button', { 'aria-label': 'Open command palette', text: '⌘K', onclick: openPalette })));
}

const COMMANDS = () => [
  ['Ask BT…', 'Focus the command bar', () => { closeModal(); const i = $('#aic-q'); if (i) i.focus(); }],
  ['What needs my attention?', 'Ask BT', () => ask('What needs my attention today?')],
  ['Investigate the biggest issue', 'Ask BT', () => { const f = visibleFindings().find(x => x.severity === 'warning'); f ? investigate(f) : toast('No warning-level findings to investigate.'); }],
  ['Prepare me for closing', 'Ask BT', () => ask('Prepare me for closing: what is not closed, and what should I check first?')],
  ['Show forecast', 'Ask BT', () => ask('Interpret my target pace for this month.')],
  ['View findings', 'Monitor', () => goMode('monitor', 'aic-att')], ['View agents', 'Investigate', () => goMode('investigate', 'aic-net')], ['View tools', 'Investigate', () => { S.toolsOpen = true; goMode('investigate', 'aic-tools'); }],
  ['View approvals / actions', 'Act', () => goMode('act', 'aic-actc')], ['View activity', 'Investigate', () => goMode('investigate', 'aic-act')], ['View system health', 'Monitor', () => goMode('monitor', 'aic-health')],
  ...M.SYSTEMS.map(s => ['View ' + s.toLowerCase(), 'System', () => openSystem(s)]),
  ['Run health check', 'System', () => refresh({ force: true })],
  ['Search repository', 'Investigate', () => { goMode('investigate', 'aic-repo'); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }], ['Explain architecture', 'Investigate', () => { goMode('investigate', 'aic-repo'); S.repoQ = RI.SAMPLE_QUESTIONS[4]; paint(); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }],
  ['Open Dashboard', 'Go to', () => openPage('#dashboard')], ['Open Closing Book', 'Go to', () => openPage('#closing-book')], ['Open STR Report', 'Go to', () => openPage('#str')], ['Open Inventory Health', 'Go to', () => openPage('#inv-health')], ['Open Cover', 'Go to', () => openPage('#cover')],
];
function goMode(mode, id) { closeModal(); S.mode = mode; paint(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function openPalette() {
  const input = h('input', { class: 'aic-pin', type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command', autocomplete: 'off' });
  const list = h('ul', { class: 'aic-plist', role: 'listbox' }); let idx = 0, shown = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = COMMANDS().filter(c => !q || c[0].toLowerCase().includes(q) || c[1].toLowerCase().includes(q));
    if (idx >= shown.length) idx = Math.max(0, shown.length - 1);
    list.replaceChildren(...(shown.length ? shown.map((c, i) => h('li', { role: 'option', 'aria-selected': String(i === idx), class: i === idx ? 'on' : '', onclick: () => run(c) }, h('span', { text: c[0] }), h('small', { text: c[1] }))) : [h('li', { class: 'aic-empty', text: 'No matching command. Press Enter to ask BT instead.' })]));
  };
  const run = c => { closeModal(); c[2](); };
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[idx]) run(shown[idx]); else if (input.value.trim()) { const q = input.value; closeModal(); ask(q); } }
  });
  openModal('Command palette', h('div', {}, input, list), { sub: 'Esc to close' }); draw(); input.focus();
}

// ───────────────────────── page paint ─────────────────────────
function paint() {
  const r = root(); if (!r || !pageOn()) return;
  const info = coreInfo();
  const cards = [secCore(info), secAttention(), secCorrelation(), secSince(), secSystems(), secForecast(), secNetwork(info), secResponse(), secActions(info), secActivity(), secObs(), secHealth(), secTools(), secRepo()]
    .filter(c => c && c.getAttribute('data-modes').split(' ').includes(S.mode));
  const main = h('main', { class: 'aic-main', 'data-mode': S.mode }, cards);
  const offline = navigator.onLine === false ? h('div', { class: 'aic-offline', role: 'alert' }, h('b', { text: 'BT OFFLINE · ' }), 'Showing last known data' + (S.snap ? ' from ' + clock(S.snap.at) : '') + '. Some intelligence may be unavailable.') : null;
  const keep = $('#aic-q'), val = keep ? keep.value : '', hadFocus = keep && document.activeElement === keep;
  const rqHad = !!(document.activeElement && document.activeElement.id === 'aic-rq');
  const scroll = window.scrollY;
  r.replaceChildren(secHeaderBar(info.core), secModes(), offline, S.error && S.snap ? h('div', { class: 'aic-err', text: 'Last refresh failed: ' + S.error }) : null, main, cmdBar());
  const q = $('#aic-q'); if (q) { q.value = val; if (hadFocus) q.focus(); }
  if (rqHad) { const r2 = $('#aic-rq'); if (r2) { r2.focus(); const n = r2.value.length; try { r2.setSelectionRange(n, n); } catch (_) { /* not a text input */ } } }
  if (Math.abs(window.scrollY - scroll) > 1) window.scrollTo(0, scroll);
}

// ───────────────────────── lifecycle ─────────────────────────
function onTelemetry(e) {
  if (!S.mounted) return;
  if (e.type === 'approval_requested' && window.BTAgent && pageOn()) { toast('BT needs your approval.'); if (typeof window.BTAgent.approvals === 'function') S.mode = 'act'; else window.BTAgent.open(); }
  if (e.type === 'answer' && S.awaitingFor) { S.assess[S.awaitingFor] = { text: (e.metadata && e.metadata.text) || '', at: e.timestamp, investigation: window.BTAgent && typeof window.BTAgent.investigationFor === 'function' ? window.BTAgent.investigationFor(S.awaitingFor) : null }; S.awaitingFor = null; }
  if (e.type === 'error' || e.type === 'cancelled') S.awaitingFor = null;
  if (e.type === 'tool_end' && e.status === 'ok' && e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical') && e.source !== 'ai-center') setTimeout(() => refresh({ force: true }), 800);
  if (pageOn()) render();
}

export function mount() {
  if (S.mounted) return;
  const p = document.getElementById(PAGE_ID); if (!p) return;
  p.replaceChildren(h('div', { id: 'aic-root', class: 'aic' }));
  S.mounted = true;
  T.subscribe(onTelemetry);
  window.addEventListener('online', render); window.addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistVisit(); else if (pageOn()) refresh(); });
  window.addEventListener('pagehide', persistVisit);
  window.addEventListener('hashchange', () => { document.body.classList.toggle('aic-open', /^#ai-center/.test(window.location.hash)); if (!/^#ai-center/.test(window.location.hash)) persistVisit(); });
  document.addEventListener('keydown', e => {
    if (!pageOn()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && modalEl) closeModal();
  });
  const iv = setInterval(() => { if (!pageOn()) return; S.tick++; if (T.liveState().open || S.tick % 15 === 0) render(); }, 1000);
  if (iv && typeof iv.unref === 'function') iv.unref(); // Node (tests) only: never keep the process alive
}

export function onShow() {
  mount();
  document.body.classList.add('aic-open');
  paint();
  refresh();
}

export const __test = { S, refresh, paint, openFinding, openSystem, openPalette, investigate };
