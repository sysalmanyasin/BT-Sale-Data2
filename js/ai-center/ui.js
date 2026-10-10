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
import * as V from '../agent/ui/voice.js';
import { listTools } from '../agent/core/tool-registry.js';
import * as T from '../agent/core/telemetry.js';
import { SPECIALISTS } from '../agent/core/specialists.js';
import { renderMarkdown } from '../agent/core/markdown-lite.js';
import { pushUndo, runUndo } from '../agent/core/undo.js';
import { markUndone } from '../agent/core/undo-store.js';
import { fetchAudit, summarizeAudit } from '../agent/core/usage-stats.js';
import { collectSnapshot, collectHealth, collectActions, getSb, readTool } from './adapters.js';
import * as M from './model.js';
import * as C from './copilot.js';
import * as RI from './repo-intel.js';
import { reorderDraftText } from '../shared/planning-metrics.js';

const PAGE_ID = 'page-ai-center';
const LS_VISIT = 'bt_aic_last_visit_v1', LS_DISMISS = 'bt_aic_dismissed_v1';
const STALE_MS = 5 * 60000, REFRESH_MS = 45000;

const S = {
  view: 'home', snap: null, health: null, actions: null, history: [], loading: false, error: null,
  voice: { listening: false, out: V.getVoiceOut() }, mode: 'monitor', filter: 'all', baseline: null, started: false, tick: 0, toolsOpen: false, open: {},
  awaitingFor: null, assess: {}, lastRefreshAt: 0, mounted: false, rafId: 0, deep: {}, repo: { state: 'idle', idx: null }, repoQ: '',
};

// ───────────────────────── mobile views ─────────────────────────
// On phones (<= 860px) the one BT Intelligence page is split into three bottom-nav destinations driven by the hash:
//   #ai-center (Home) · #ai-center/copilot (AI Copilot) · #ai-center/alerts (Alerts). Desktop/tablet keep the full dashboard.
const MOBILE_Q = '(max-width: 860px)';
const isMobile = () => { try { return !!(window.matchMedia && window.matchMedia(MOBILE_Q).matches); } catch (_) { return false; } };
export function viewFromHash(hash) { const m = /^#ai-center\/(copilot|alerts)\b/.exec(hash == null ? (window.location && window.location.hash) || '' : hash); return m ? m[1] : 'home'; }
const compactHome = () => isMobile() && S.view === 'home';
const COMPACT_FOLD = new Set(['fc', 'invstr', 'money']); // full detail lives on the existing pages; Home shows a one-line summary
const DETAIL_LINKS = { fc: ['#dashboard', 'Open Sales & Forecast details'], invstr: ['#inv-health', 'Open Inventory & STR details'], money: ['#closing-book', 'Open Closing, Cash & Money details'], actc: ['#ai-center/alerts', 'Open Actions & Approvals'] };
function setView(v) { S.view = v; document.body.dataset.aicView = v; }
function goCopilot(q) { window.location.hash = '#ai-center/copilot'; if (q) setTimeout(() => ask(q), 80); }

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

// Keep keyboard focus inside the open dialog (WCAG 2.4.3): Tab wraps from the last control to the first and back.
function trapTab(e) {
  const box = modalEl && modalEl.querySelector('.aic-modal'); if (!box) return;
  const f = [...box.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(x => !x.closest('[hidden]'));
  if (!f.length) { e.preventDefault(); box.focus(); return; }
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || at === box)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  else if (!box.contains(at)) { e.preventDefault(); first.focus(); }
}
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
function alertCount() {
  if (!S.snap) return null; // unknown until a real read finished: the badge stays hidden rather than guessing
  const A = window.BTAgent;
  const approvals = A && typeof A.approvals === 'function' ? A.approvals() : [];
  return C.criticalItems({ findings: visibleFindings(), approvals }).length;
}
function publishAlerts() {
  const n = alertCount();
  try { window.dispatchEvent(new CustomEvent('bt:alerts-count', { detail: { count: n, at: S.lastRefreshAt || null } })); } catch (_) { /* no CustomEvent: badge simply stays hidden */ }
}
const openPage = href => { closeModal(); window.location.hash = href; };

// ───────────────────────── data refresh ─────────────────────────
async function refresh({ force = false } = {}) {
  if (S.loading) return;
  if (!force && S.snap && Date.now() - S.lastRefreshAt < REFRESH_MS) return;
  S.loading = true; S.error = null; render();
  try {
    const prev = S.snap && S.snap.findings, prevPartial = M.isPartialSnapshot(S.snap);
    const snap = await collectSnapshot();
    S.snap = snap; S.lastRefreshAt = Date.now();
    // Sales data can still be loading right after the page opens: re-read a few times instead of showing false alarms.
    const pending = snap.raw && snap.raw.briefing && snap.raw.briefing.sales_data_ready === false;
    S.pendingTries = pending ? (S.pendingTries || 0) + 1 : 0;
    if (pending && S.pendingTries <= 6) setTimeout(() => { S.lastRefreshAt = 0; refresh({ force: true }); }, 2500);
    const d = M.diffFindings(prev, snap.findings);
    if (prev && !prevPartial && !M.isPartialSnapshot(snap)) { // while sales is still loading the findings are incomplete: do not log false new/cleared events
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
  if (!S.snap || M.isPartialSnapshot(S.snap)) return;
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
// Cards are collapsed by default (tap the title to open). Kept open: the one-line summary + status core, the Action Center
// (pending approvals must never be hidden), the latest BT response, and Tool Intelligence (it already has its own toggle).
// The open/closed choice lives in S.open so it survives the full repaint that runs on every refresh.
const ALWAYS_OPEN = new Set(['crit', 'copilot', 'core', 'runs', 'att', 'sys', 'fc', 'invstr', 'money', 'actc', 'tools', 'copilot-entry', 'suggested']);

// One-line, REAL summary shown in a collapsed card's header (hidden once the card is open). Returns [text, tone] or null.
function foldSummary(id) {
  const P = S.snap && S.snap.raw && S.snap.raw.planning;
  switch (id) {
    case 'fleet': { const n = activeAgentIds(coreInfo().live).on.size, total = Object.keys(SPECIALISTS).filter(k => k !== 'general').length; return [n ? n + ' running now' : total + ' ready · none running', n ? 'ok' : 'mu']; }
    case 'net': { const n = activeAgentIds(coreInfo().live).on.size; return [n ? n + ' running now' : 'none running', n ? 'ok' : 'mu']; }
    case 'reo': { const D = P && P.reorder; if (!S.snap) return null; return D ? (D.total_lines ? [D.total_lines + ' lines to buy', 'wn'] : ['nothing to reorder', 'ok']) : ['not available', 'mu']; }
    case 'fill': { const F = P && P.fill; if (!S.snap) return null; return F && F.fill_rate_pct != null ? [F.fill_rate_pct + '% filled', F.fill_rate_pct < 90 ? 'wn' : 'ok'] : ['not measurable', 'mu']; }
    case 'money': { const sc = P && P.money && P.money.staff_credit; if (!S.snap) return null; return sc ? ['Rs ' + M.fmtNum(sc.this_month.total_owed) + ' owed', 'mu'] : ['not available', 'mu']; }
    case 'fc': { const F = S.snap && S.snap.forecast; if (!S.snap) return null; return F && F.available ? [F.pace.pct_done + '% of month target sold', F.pace.pct_done < 50 ? 'wn' : 'ok'] : ['not available', 'mu']; }
    case 'invstr': { const a = foldSummary('reo'), b = foldSummary('fill'); if (!a && !b) return null; return [[a && a[0], b && b[0]].filter(Boolean).join(' · '), (a && a[1] === 'wn') || (b && b[1] === 'wn') ? 'wn' : 'mu']; }
    case 'ops': { const live = coreInfo().live, run = activeAgentIds(live).on.size, r = S.health, ok = r ? r.filter(x => x.status === 'HEALTHY').length : null; return [(r ? ok + ' of ' + r.length + ' healthy' : 'health loading') + ' \u00B7 ' + (run ? run + ' agent(s) running' : 'no agent running'), r && ok < r.length ? 'wn' : 'mu']; }
    case 'act': { const n = T.recent(150).length; return [n + (n === 1 ? ' event' : ' events'), 'mu']; }
    case 'obs': { const o = M.observability(T.recent(400).reverse()); return [o.requests + ' requests · ' + o.errors + ' failed', o.errors ? 'wn' : 'mu']; }
    case 'health': { const r = S.health; if (!r) return null; const ok = r.filter(x => x.status === 'HEALTHY').length; return [ok + ' of ' + r.length + ' healthy', ok < r.length ? 'wn' : 'ok']; }
    default: return null;
  }
}
function card(id, modes, ...kids) {
  const first = kids[0];
  const keepOpen = ALWAYS_OPEN.has(id) && !(compactHome() && COMPACT_FOLD.has(id));
  const foldable = !keepOpen && kids.length > 1 && first && first.nodeType === 1 && first.classList.contains('aic-sh');
  if (!foldable) return h('section', { class: 'aic-card', id: 'aic-' + id, 'data-modes': modes }, kids);
  const open = !!S.open[id];
  const bodyId = 'aic-b-' + id;
  const body = h('div', { class: 'aic-cbody', id: bodyId, hidden: !open }, kids.slice(1));
  const sec = h('section', { class: 'aic-card aic-fold' + (open ? '' : ' aic-folded'), id: 'aic-' + id, 'data-modes': modes }, first, body);
  const fs = foldSummary(id);
  if (fs) first.append(h('span', { class: 'aic-fsum aic-fsum-' + fs[1], text: fs[0] }));
  first.append(h('span', { class: 'aic-caret', 'aria-hidden': 'true', text: '\u25BE' }));
  first.setAttribute('role', 'button'); first.setAttribute('tabindex', '0');
  first.setAttribute('aria-controls', bodyId); first.setAttribute('aria-expanded', String(open));
  const toggle = ev => {
    if (ev.target && ev.target.closest && ev.target.closest('button,a,input,select,textarea')) return;
    if (ev.type === 'keydown') { if (ev.key !== 'Enter' && ev.key !== ' ') return; ev.preventDefault(); }
    const now = body.hidden; // hidden -> opening
    S.open[id] = now; body.hidden = !now;
    sec.classList.toggle('aic-folded', !now); first.setAttribute('aria-expanded', String(now));
  };
  first.addEventListener('click', toggle); first.addEventListener('keydown', toggle);
  return sec;
}
function empty(text) { return h('div', { class: 'aic-empty', text }); }
function skeleton(n = 3) { return h('div', { class: 'aic-skel', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('i'))); }

function coreInfo() {
  const live = T.liveState();
  // The Center reads local app data, so only a real network loss makes it OFFLINE. Whether the assistant /
  // Supabase session is usable is reported by the Health panel and by Ask BT itself.
  return { live, core: M.deriveCoreState({ online: navigator.onLine !== false, authed: true, snapshotLoading: S.loading && !S.snap, snapshotReady: !!S.snap, live, now: Date.now() }) };
}

function secHeaderBar(core) {
  const stale = S.snap && Date.now() - S.snap.at > STALE_MS;
  const cls = core.state === 'OFFLINE' || core.state === 'ERROR' ? 'cr' : core.state === 'READY' || core.state === 'IDLE' ? 'ok' : 'cy';
  const fresh = S.snap ? 'Data as of ' + clock(S.snap.at) + ' (' + M.ageLabel(S.snap.at) + ')' + (stale ? ' · stale, refresh to update' : '') : (S.loading ? 'Reading business data…' : 'Waiting for data');
  // One authoritative status (the pill) and one freshness line. Counts live in the snapshot and in Needs attention, not here.
  return h('header', { class: 'aic-hdr' },
    h('div', { class: 'aic-hr1' },
      h('h1', { text: 'BT INTELLIGENCE' }),
      h('span', { class: 'aic-live aic-' + cls, 'aria-live': 'polite' }, h('i', { class: 'aic-dot' }), core.state.replace(/_/g, ' '))),
    h('div', { class: 'aic-hr2' },
      h('span', { class: 'aic-fresh2' + (stale ? ' aic-wn' : ''), text: fresh }),
      h('div', { class: 'aic-seg' },
        h('button', { text: S.loading ? 'Reading…' : 'Refresh', disabled: S.loading, onclick: () => refresh({ force: true }) }),
        h('button', { text: '⌘K', 'aria-label': 'Open command palette', onclick: openPalette }))));
}




// Decorative holographic avatar. Pure SVG, no data: every operational fact stays in real DOM text beside it.
function jarvisAvatar() {
  // Static, decorative humanoid (visor, glowing eyes, headset with mic, shoulder armour, chest core). Built with DOM nodes, no innerHTML.
  const n = (tag, a, ...kids) => { const e = h2svg(tag, a); kids.forEach(k => e.append(k)); return e; };
  const stop = (o, c) => n('stop', { offset: o, 'stop-color': c });
  const svg = n('svg', { viewBox: '0 0 160 160', class: 'aic-avatar', 'aria-hidden': 'true', focusable: 'false' },
    n('defs', {},
      n('linearGradient', { id: 'jv-armor', x1: 0, y1: 0, x2: 0, y2: 1 }, stop('0', '#3a4f6d'), stop('1', '#0d1626')),
      n('linearGradient', { id: 'jv-head', x1: 0, y1: 0, x2: 1, y2: 1 }, stop('0', '#46607f'), stop('.55', '#1a2a41'), stop('1', '#0c1626')),
      n('filter', { id: 'jv-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, n('feGaussianBlur', { stdDeviation: 2.2, result: 'b' }), n('feMerge', {}, n('feMergeNode', { in: 'b' }), n('feMergeNode', { in: 'SourceGraphic' })))),
    n('path', { class: 'av-body', fill: 'url(#jv-armor)', d: 'M6 160c4-34 30-48 74-52 44 4 70 18 74 52z' }),
    n('path', { class: 'av-line', d: 'M46 160l8-30M114 160l-8-30M60 112l20 24 20-24M24 150c10-14 24-22 40-26M136 150c-10-14-24-22-40-26' }),
    n('rect', { class: 'av-neck', x: 70, y: 92, width: 20, height: 20, rx: 4 }),
    n('path', { class: 'av-head', fill: 'url(#jv-head)', d: 'M80 24c-23 0-35 16-35 38 0 24 12 38 35 38s35-14 35-38c0-22-12-38-35-38z' }),
    n('path', { class: 'av-visor', d: 'M55 55c0-9 11-13 25-13s25 4 25 13v13c0 11-11 17-25 17S55 79 55 68z' }),
    n('path', { class: 'av-line', d: 'M64 78c6 4 26 4 32 0' }),
    n('ellipse', { class: 'av-eye', cx: 67, cy: 62, rx: 6.5, ry: 3.6, filter: 'url(#jv-glow)' }),
    n('ellipse', { class: 'av-eye', cx: 93, cy: 62, rx: 6.5, ry: 3.6, filter: 'url(#jv-glow)' }),
    n('path', { class: 'av-phone', d: 'M43 62C40 30 60 12 80 12s40 18 37 50' }),
    n('rect', { class: 'av-cup', x: 33, y: 54, width: 15, height: 28, rx: 7 }),
    n('rect', { class: 'av-cup', x: 112, y: 54, width: 15, height: 28, rx: 7 }),
    n('path', { class: 'av-line', d: 'M40 82c-2 12 8 18 22 14' }),
    n('circle', { class: 'av-chest', cx: 64, cy: 96, r: 2.6 }),
    n('circle', { class: 'av-ring', cx: 80, cy: 128, r: 11 }),
    n('circle', { class: 'av-chest', cx: 80, cy: 128, r: 5.2, filter: 'url(#jv-glow)' }));
  return svg;
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
  // Compact status row inside the Copilot card (small avatar, one line of detail). The lifecycle is kept, folded.
  return h('div', { class: 'aic-corerow', id: 'aic-core' },
    h('div', { class: 'aic-stage', 'data-s': core.state.toLowerCase() },
      h('i', { class: 'aic-ring r1' }), h('i', { class: 'aic-ring r2' }), h('i', { class: 'aic-ring r3' }),
      h('div', { class: 'aic-orb' }, jarvisAvatar(), h('div', { class: 'aic-orb-t' }, h('b', { text: 'JARVIS' }), h('small', { text: core.state.replace(/_/g, ' ') })))),
    h('div', { class: 'aic-cs' }, h('h2', { text: core.state.replace(/_/g, ' ') }), h('p', { text: core.detail })),
    mission,
    h('details', { class: 'aic-lifed' }, h('summary', { text: 'Lifecycle of the last request' }), h('ol', { class: 'aic-life', 'aria-label': 'Intelligence lifecycle' }, life.map(s => h('li', { class: (s.reached ? (s.failed ? 'on fail ' : 'on ') : '') + (s.available ? '' : 'na'), title: s.available ? (s.reached ? 'Happened in the latest request' : 'Not reached in the latest request') : 'BT has no automated verification step yet', text: s.label })))));
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
  const area = f.system ? f.system.charAt(0) + f.system.slice(1).toLowerCase() : '';
  return h('button', { class: 'aic-f aic-sev-' + f.severity, onclick: () => openFinding(f), 'aria-label': f.system + ': ' + f.title },
    h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
    h('span', { class: 'aic-fb' }, h('span', { class: 'aic-ft', text: f.title }), h('span', { class: 'aic-fs', text: area + '  ' + M.ageLabel(f.detected_at) })),
    h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '\u203a' }));
}
// One-line answer to "do I need to do anything?" (replaces the big orb on the Monitor view).
function summaryLine() {
  if (!S.snap) return null;
  // Same rule as the chat briefing ("N things need attention" counts warnings/errors only);
  // info-level notes are counted separately so the two screens never disagree.
  const all = visibleFindings().filter(x => x.severity !== 'good');
  const open = all.filter(x => x.severity !== 'info');
  const notes = all.length - open.length;
  const tn = open.some(x => x.severity === 'error') ? 'cr' : open.length ? 'wn' : 'ok';
  const noteTxt = notes ? ' (+' + notes + ' note' + (notes === 1 ? '' : 's') + ')' : '';
  const partial = M.isPartialSnapshot(S.snap);
  const text = partial ? 'Sales data is still loading. Counts may change.'
    : open.length ? (open.length === 1 ? '1 thing needs you today' : open.length + ' things need you today') + noteTxt
      : notes ? 'Nothing urgent. ' + notes + ' note' + (notes === 1 ? '' : 's') + ' to review.' : 'All clear. Nothing needs you right now.';
  return h('div', { class: 'aic-sumrow', id: 'aic-sum' }, h('i', { class: 'aic-dot2 aic-d-' + tn, 'aria-hidden': 'true' }),
    h('div', {}, h('div', { class: 'aic-sumt', text }), h('div', { class: 'aic-sub', text: 'Ranked by severity, then by the Rs amount involved. Data as of ' + clock(S.snap.at) + '.' })));
}
// One actionable row: severity, area, Rs involved, the first evidence line, the next action, and one-tap Investigate.
function attentionRow(e) {
  const f = e.primary;
  const ev = e.evidence[0];
  return h('div', { class: 'aic-att-row' },
    h('button', { class: 'aic-f aic-sev-' + f.severity, onclick: () => openFinding(f, e), 'aria-label': e.area + ': ' + f.title + '. ' + e.impactText },
      h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
      h('span', { class: 'aic-fb' },
        h('span', { class: 'aic-ft', text: f.title }),
        h('span', { class: 'aic-fs' }, h('b', { text: e.area }), ' · ', e.impactText, ' · ', M.ageLabel(f.detected_at)),
        ev ? h('span', { class: 'aic-fe', text: ev.label + ': ' + ev.value }) : null,
        e.next ? h('span', { class: 'aic-fn' }, h('b', { text: 'Next: ' }), e.next) : null,
        e.related.length ? h('span', { class: 'aic-fr', text: '+' + e.related.length + ' related ' + (e.related.length === 1 ? 'issue' : 'issues') + ' in ' + e.area.toLowerCase() }) : null,
        ...e.linked.map(l => h('span', { class: 'aic-fl', text: 'Seen together with: ' + l.systems.filter(x => C.areaLabel(x) !== e.area).map(C.areaLabel).join(', ') + ' (co-occurrence, not proven)' }))),
      h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '›' })),
    h('button', { class: 'aic-inv', text: 'Investigate', 'aria-label': 'Investigate: ' + f.title, onclick: () => investigate(f) }));
}
function secAttention() {
  let body;
  if (S.error && !S.snap) body = failureNode(S.error, () => refresh({ force: true }));
  else if (!S.snap) body = skeleton();
  else {
    const f = visibleFindings(), good = f.filter(x => x.severity === 'good');
    const showAll = S.attAll || (isMobile() && S.view === 'alerts');
    const P = C.prioritizeFindings(f, { limit: showAll ? 10 : 5 });
    body = h('div', {}, summaryLine(),
      P.entries.length ? P.entries.map(attentionRow) : empty('Nothing needs attention right now. All monitored rules are clear.'),
      P.total > 5 && !(isMobile() && S.view === 'alerts') ? h('button', { class: 'aic-showall', 'aria-expanded': String(!!S.attAll), text: S.attAll ? 'Show fewer' : 'Show ' + Math.min(P.total - 5, 5) + ' more', onclick: () => { S.attAll = !S.attAll; render(); } }) : null,
      S.attAll && P.hidden ? h('div', { class: 'aic-more', text: '+ ' + P.hidden + ' more. Ask BT "What needs my attention?"' }) : null,
      good.map(g => h('div', { class: 'aic-good' }, '✓ ', g.title)));
  }
  return card('att', 'monitor', sectionHeader('NEEDS ATTENTION', S.snap ? (compactHome() ? h('a', { class: 'aic-viewall', href: '#ai-center/alerts', text: 'View all (' + (C.prioritizeFindings(visibleFindings(), { limit: 99 }).total) + ')' }) : h('span', { class: 'aic-sub', text: 'top 5 by severity and amount' })) : null), body);
}

// Compact Copilot entry for the phone Home screen: status + two suggestions, everything else lives on the Copilot screen.
function secCopilotEntry(info) {
  const ready = !!window.BTAgent, busy = !!(ready && window.BTAgent.isBusy && window.BTAgent.isBusy());
  const tips = promptChips().slice(0, 2);
  return card('copilot-entry', 'monitor',
    sectionHeader('AI BUSINESS COPILOT', h('span', { class: 'aic-pill aic-' + (ready ? (busy ? 'wn' : 'ok') : 'mu'), text: ready ? (busy ? 'Working' : 'Connected') : 'Loading' })),
    h('button', { class: 'aic-entry', onclick: () => goCopilot(), 'aria-label': 'Open AI Copilot' }, h('span', { text: 'Ask about your business\u2026' }), h('span', { 'aria-hidden': 'true', text: '\u203A' })),
    h('div', { class: 'aic-chips aic-chips-wrap', 'aria-label': 'Suggested questions' }, tips.map(t => h('button', { text: t, onclick: () => goCopilot(t) }))));
}
function secSuggested() {
  return card('suggested', 'monitor investigate', sectionHeader('SUGGESTED INVESTIGATIONS'),
    h('div', { class: 'aic-sugg' }, promptChips().map(t => h('button', { text: t, onclick: () => ask(t) }))));
}

// Failure / empty-state wording: one place, honest about timeout, permission, offline and partial data.
function failureNode(err, retry) {
  const d = C.describeFailure(err);
  return h('div', { class: 'aic-err aic-fail-' + d.kind, role: 'alert' }, h('b', { text: d.title + '. ' }), d.text, d.detail && d.detail !== d.text ? h('div', { class: 'aic-sub', text: d.detail }) : null,
    d.retry && retry ? h('div', { class: 'aic-row' }, h('button', { text: 'Retry', onclick: retry })) : null);
}

function sinceNode() {
  if (!S.snap) return null;
  const b = S.baseline;
  if (!b) return null; // first visit: nothing to compare, no card
  const d = M.diffFindings(b.findings, S.snap.findings);
  if (!d.added.length && !d.cleared.length) return null; // nothing changed: no empty panel
  return h('div', { class: 'aic-since' }, h('div', { class: 'aic-k', text: 'SINCE YOUR LAST VISIT' }), h('div', {}, h('b', { text: '+' + d.added.length }), ' new'), h('div', {}, h('b', { text: String(d.cleared.length) }), ' no longer present'),
    d.added.length ? h('ul', { class: 'aic-list' }, d.added.slice(0, 4).map(f => h('li', { text: f.title }))) : null);
}


const SYSTEM_ASK = {
  SALES: 'How are sales going this month compared with last month and the target?', CASH: 'Is there any cash difference in the latest sales entry?',
  INVENTORY: 'What inventory is at risk? Which products are out of stock or about to run out?', STAFF: 'How are staff credits looking, including carried-over balances and possible duplicates?',
  STR: 'Which STRs are delayed or still pending?', CLOSING: 'What is blocking closing? Which days or shifts are not closed?',
};
const STATUS_RANK = { ERROR: 0, UNAUTHORIZED: 0, DATA_UNAVAILABLE: 1, ATTENTION: 2, STALE: 2 };
const worstStatus = names => names.map(n => S.snap.systems[n] && S.snap.systems[n].status).filter(Boolean).sort((a, b) => (STATUS_RANK[a] ?? 3) - (STATUS_RANK[b] ?? 3))[0] || 'CLEAR';
function snapTile(t) {
  const status = worstStatus(t.systems), tn2 = [tone(status), t.tone].sort((a, b) => ({ cr: 0, wn: 1, mu: 2, ok: 3 }[a] - { cr: 0, wn: 1, mu: 2, ok: 3 }[b]))[0];
  const aria = t.label + ': ' + t.value + '. ' + t.sub + (t.compare ? '. ' + t.compare : '') + (status !== 'CLEAR' ? '. Status ' + status : '');
  return h('button', { class: 'aic-it aic-snap-tile aic-edge-' + tn2, 'data-tile': t.id, 'aria-label': aria + '. Tap for details.', onclick: () => openSystem(t.system) },
    t.pct != null ? ringGauge(t.pct, tn2) : null,
    h('span', { class: 'aic-it-b' },
      h('span', { class: 'aic-it-l', text: t.label }),
      h('b', { class: 'aic-it-v aic-' + tn2, text: t.value }),
      h('small', { text: t.sub }),
      t.compare ? h('small', { class: 'aic-it-c', text: t.compare }) : null,
      h('span', { class: 'aic-it-f' }, status !== 'CLEAR' ? pill(status) : null, t.fresh ? h('small', { class: 'aic-fresh aic-' + tone(S.snap.systems[t.system] && S.snap.systems[t.system].fresh.status), text: t.fresh }) : null)));
}
function secSystems() {
  const tiles = S.snap ? C.snapshotTiles(S.snap) : [];
  return card('sys', 'monitor', sectionHeader('BUSINESS SNAPSHOT', h('span', { class: 'aic-sub', text: S.snap ? 'tap a tile for detail' : 'loading' })),
    S.snap ? h('div', { class: 'aic-snap' }, tiles.map(snapTile)) : skeleton(3));
}

// Weekday-aware projection + today's expected sale (tool: weekday_forecast, maths in shared/planning-metrics.js).

// Average sale per weekday, drawn from the tool's own weekday_baseline (no new calculation). Today's weekday is marked.
function weekdayBars(W) {
  const rows = (W.weekday_baseline || []).filter(b => b && Number.isFinite(b.avg));
  if (!rows.length) return null;
  const max = Math.max(...rows.map(b => b.avg), 1), today = W.today && W.today.weekday;
  return h('div', { class: 'aic-wbars' },
    h('div', { class: 'aic-k', text: 'AVERAGE SALE BY WEEKDAY (RS, RECENT WEEKS)' }),
    h('ul', { class: 'aic-bars', 'aria-label': 'Average sale by weekday: ' + rows.map(b => b.weekday + ' Rs ' + M.fmtNum(b.avg)).join(', ') },
      rows.map(b => h('li', { class: 'aic-bar' + (b.weekday === today ? ' today' : '') },
        h('span', { class: 'aic-bv', title: 'Rs ' + M.fmtNum(b.avg), text: b.avg >= 10000 ? Math.round(b.avg / 1000) + 'k' : M.fmtNum(b.avg) }),
        h('span', { class: 'aic-bf', style: 'height:' + Math.max(4, Math.round(b.avg / max * 100)) + '%', 'aria-hidden': 'true' }),
        h('span', { class: 'aic-bl', text: b.weekday.slice(0, 3) + (b.weekday === today ? ' \u2022' : '') })))),
    h('div', { class: 'aic-sub', text: 'Bars start at zero. The dot marks today. Values are the tool\u2019s recent weekday averages.' }));
}
function weekdayBlock() {
  const P = S.snap && S.snap.raw && S.snap.raw.planning, W = P && P.weekday;
  if (!W) return P && P.errors && P.errors.weekday ? h('div', { class: 'aic-sub', text: 'Weekday forecast unavailable: ' + P.errors.weekday }) : null;
  const rows = [['EXPECTED MONTH-END', 'Rs ' + M.fmtNum(W.projected_month_end) + '  (typical Rs ' + M.fmtNum(W.projected_low) + ' to ' + M.fmtNum(W.projected_high) + ')']];
  if (W.vs_target) rows.push(['VS TARGET', (W.vs_target.on_track ? 'On track' : 'Short by about Rs ' + M.fmtNum(-W.vs_target.gap_at_projection)) + '  (' + W.vs_target.pct_of_target_projected + '%)'],
    ['NEED / DAY vs WEEKDAY PATTERN', 'Rs ' + M.fmtNum(W.vs_target.needed_per_remaining_day) + ' vs Rs ' + M.fmtNum(W.vs_target.expected_per_remaining_day)]);
  rows.push([W.today.weekday.toUpperCase() + (W.today.entered ? ' (ENTERED)' : ' EXPECTED'), W.today.samples ? 'Rs ' + M.fmtNum(W.today.expected) + '  (typical Rs ' + M.fmtNum(W.today.typical_low) + ' to ' + M.fmtNum(W.today.typical_high) + ')' : 'not enough history']);
  return h('div', { class: 'aic-wf' },
    h('div', { class: 'aic-interp' }, h('span', { class: 'aic-tag', text: 'PREDICTION' }), ' Weekday-aware: each remaining day is expected at that weekday\'s recent average.'),
    h('dl', { class: 'aic-met' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    weekdayBars(W));
}

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
      (() => {
        const raw = S.snap.raw, V = C.forecastVariance(F.pace, raw.planning && raw.planning.weekday, raw.briefing);
        if (!V) return null;
        return h('div', { class: 'aic-drivers' }, h('div', { class: 'aic-k', text: 'VARIANCE AND WHAT DRIVES THE FORECAST' }),
          h('div', { class: 'aic-var aic-' + (V.behind ? 'wn' : 'ok') }, V.behind ? 'Behind by Rs ' + M.fmtNum(-V.perDay) + ' per day' : 'Ahead by Rs ' + M.fmtNum(V.perDay) + ' per day',
            V.monthEndGap != null ? ' \u00B7 at this run rate the month ends about Rs ' + M.fmtNum(Math.abs(V.monthEndGap)) + (V.monthEndGap >= 0 ? ' above' : ' below') + ' target' : ''),
          h('ul', { class: 'aic-list' }, V.drivers.map(d => h('li', {}, tagEl(d.kind), ' ', d.text))));
      })(),
      F.projection != null && F.disagree ? h('div', { class: 'aic-sub' }, h('span', { class: 'aic-tag', text: 'PREDICTION' }), ' Briefing projection (average × days in month): Rs ' + M.fmtNum(F.projection)) : null,
      weekdayBlock(),
      F.disagree ? h('div', { class: 'aic-note', text: 'Two existing calculations disagree on whether the target will be met (pace tracker vs briefing projection). Both are shown; the pace tracker is the one the Dashboard uses.' }) : null,
      h('div', { class: 'aic-row' }, h('button', { text: 'Ask BT to interpret', onclick: () => ask('Interpret my target pace for this month and say what would need to change to reach the target.') })));
  }
  return card('fc', 'monitor', sectionHeader('SALES & FORECAST', h('span', { class: 'aic-sub', text: 'actual vs target \u00B7 get_target_pace' })), body);
}

// ── reorder draft ──
function copyText(text, ok) {
  const done = () => { if (typeof window.toast === 'function') window.toast(ok, 'success'); };
  try { navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy this list:', text)); } catch (_) { window.prompt('Copy this list:', text); }
}
function reorderLine(i) {
  const tag = i.status === 'out_of_stock' ? '  [OUT]' : i.status === 'low' ? '  [LOW ' + i.cover_days + 'd]' : '';
  return h('li', { text: i.name + ' — buy ' + i.suggested_qty + tag + (i.in_transit ? '  (in transit ' + i.in_transit + ')' : '') + (i.trend === 'rising' ? '  ↑' : '') });
}
function reorderGroup(g) {
  const title = g.supplier + ' · ' + g.lines + ' lines' + (g.urgent_lines ? ' · ' + g.urgent_lines + ' urgent' : '') + ' · Rs ' + M.fmtNum(g.est_value_at_sale_price);
  return h('details', { class: 'aic-det', open: g.urgent_lines > 0 ? '' : null }, h('summary', { text: title }), h('ul', {}, g.items.slice(0, 12).map(reorderLine)));
}
function reorderBody() {
  const P = S.snap && S.snap.raw && S.snap.raw.planning, D = P && P.reorder;
  let body;
  if (!S.snap) body = skeleton(2);
  else if (!D) body = empty((P && P.errors && P.errors.reorder) || 'Reorder draft not available.');
  else if (!D.total_lines) body = empty('Nothing to reorder right now: stock covers ' + D.cover_days_target + ' days of sales (net of stock in transit).');
  else body = h('div', {},
    h('dl', { class: 'aic-met aic-big' }, [['LINES TO BUY', String(D.total_lines)], ['OUT OF STOCK, SELLING', String(D.out_of_stock_selling)], ['RUNNING LOW (≤7d)', String(D.low_cover)], ['SALES AT RISK / DAY', 'Rs ' + M.fmtNum(D.lost_sales_per_day)], ['EST. VALUE (SALE PRICE)', 'Rs ' + M.fmtNum(D.est_value_at_sale_price)]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    h('div', { class: 'aic-list' }, D.groups.slice(0, 6).map(reorderGroup)),
    h('div', { class: 'aic-sub', text: D.method }),
    h('div', { class: 'aic-row' },
      h('button', { class: 'aic-p', text: 'Copy full list', onclick: () => copyText(reorderDraftText(D), 'Reorder list copied') }),
      h('button', { text: 'Open Reorder Report', onclick: () => openPage('#reorder') }),
      h('button', { text: 'Ask BT about this', onclick: () => ask('Draft my reorder list. Which items are most urgent and from which suppliers?') })));
  return body;
}

// ── STR fill rate ──
function fillBody() {
  const P = S.snap && S.snap.raw && S.snap.raw.planning, F = P && P.fill;
  let body;
  if (!S.snap) body = skeleton(2);
  else if (!F) body = empty((P && P.errors && P.errors.fill) || 'STR fill rate not available.');
  else if (F.fill_rate_pct == null) body = empty('No dispatched incoming STR lines in the last ' + F.window_days + ' days to measure.' + (F.awaiting_dispatch.count ? ' ' + F.awaiting_dispatch.count + ' STR(s) still await dispatch.' : ''));
  else body = h('div', {},
    h('dl', { class: 'aic-met aic-big' }, [['FILL RATE', F.fill_rate_pct + '%'], ['LINES FILLED IN FULL', F.line_fill_pct + '%'], ['ZERO-DISPATCH LINES', String(F.zero_dispatch_lines)], ['SHORT LINES', String(F.short_lines)], ['RECEIPT ACCURACY', F.receipt_accuracy_pct == null ? 'n/a' : F.receipt_accuracy_pct + '%'], ['AWAITING DISPATCH', F.awaiting_dispatch.count + (F.awaiting_dispatch.oldest_age_days != null ? ' (oldest ' + F.awaiting_dispatch.oldest_age_days + 'd)' : '')]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    F.by_source.length ? h('div', { class: 'aic-sub', text: 'By source (worst first): ' + F.by_source.slice(0, 4).map(x => x.source + ' ' + x.fill_rate_pct + '% (' + x.strs + ' STRs)').join(' · ') }) : null,
    F.worst_products.length ? h('div', { class: 'aic-sub', text: 'Most short: ' + F.worst_products.slice(0, 4).map(x => x.name + ' (-' + x.packs_short + ')').join(', ') }) : null,
    h('div', { class: 'aic-sub', text: F.note }),
    h('div', { class: 'aic-row' }, h('button', { text: 'Open zero-dispatch', onclick: () => openPage('#str-zero-dispatch') }), h('button', { text: 'Ask BT about this', onclick: () => ask('Which warehouses are short-dispatching our STRs and which products are affected?') })));
  return body;
}

// ── staff credit + ledgers ──
// A ledger is worth a block of its own only when it has money, categories or a flagged category this month.
const ledgerHasActivity = L => !!L && (Number(L.month_to_date_total) > 0 || (L.categories || []).length > 0 || (L.running_above_usual || []).length > 0);
function ledgerBody() {
  const P = S.snap && S.snap.raw && S.snap.raw.planning, Mo = P && P.money;
  let body;
  if (!S.snap) body = skeleton(2);
  else if (!Mo) body = empty((P && P.errors && P.errors.money) || 'Ledger overview not available.');
  else {
    const sc = Mo.staff_credit;
    body = h('div', {},
      sc ? h('div', {}, h('div', { class: 'aic-k', text: 'STAFF CREDIT OWED' }),
        h('dl', { class: 'aic-met' }, [[sc.this_month.month, 'Rs ' + M.fmtNum(sc.this_month.total_owed) + ' · ' + sc.this_month.people + ' people'], [sc.last_month.month, 'Rs ' + M.fmtNum(sc.last_month.total_owed) + ' · ' + sc.last_month.people + ' people']].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
        (sc.this_month.top.length ? sc.this_month : sc.last_month).top.length ? h('div', { class: 'aic-sub', text: 'Largest balances (' + (sc.this_month.top.length ? sc.this_month.month : sc.last_month.month) + '): ' + (sc.this_month.top.length ? sc.this_month : sc.last_month).top.map(x => x.name + ' Rs ' + M.fmtNum(x.net)).join(' · ') }) : null) : null,
      Mo.ledgers.filter(ledgerHasActivity).map(L => h('div', { class: 'aic-led' },
        h('div', { class: 'aic-k', text: L.ledger.toUpperCase() + ' · MONTH TO DATE Rs ' + M.fmtNum(L.month_to_date_total) }),
        L.categories.length ? h('div', { class: 'aic-sub', text: L.categories.slice(0, 5).map(c => c.category + ' Rs ' + M.fmtNum(c.amount)).join(' · ') }) : h('div', { class: 'aic-sub', text: 'No entries this month.' }),
        L.running_above_usual.length ? h('div', { class: 'aic-note', text: 'Running above usual for this point of the month: ' + L.running_above_usual.map(x => x.category + ' (Rs ' + M.fmtNum(x.month_to_date) + (x.usual_same_period > 0 ? ' vs ~' + M.fmtNum(x.usual_same_period) : x.usual_full_month > 0 ? ', full month usually ~' + M.fmtNum(x.usual_full_month) : ', no earlier entries') + ')').join('; ') }) : null)),
      Mo.ledgers.some(L => !ledgerHasActivity(L)) ? h('div', { class: 'aic-sub', text: 'No entries this month: ' + Mo.ledgers.filter(L => !ledgerHasActivity(L)).map(L => String(L.ledger).charAt(0).toUpperCase() + String(L.ledger).slice(1)).join(' · ') + '.' }) : null,
      h('div', { class: 'aic-sub', text: Mo.note }),
      h('div', { class: 'aic-row' }, h('button', { text: 'Open Manager', onclick: () => openPage('#manager-dashboard') }), h('button', { text: 'Ask BT about this', onclick: () => ask('Why is petty cash and other expenses high this month? Break it down by category.') })));
  }
  return body;
}


// ── Inventory & STR: one compact summary, detail on demand ──
function secInvStr() {
  const raw = S.snap && S.snap.raw, P = raw && raw.planning, R = P && P.reorder, F = P && P.fill, str = raw && raw.str, sp = raw && raw.strPending, inv = raw && raw.briefing && raw.briefing.inventory;
  let body;
  if (!S.snap) body = skeleton(2);
  else {
    const rows = [];
    if (inv) rows.push(['STOCK-OUTS, STILL SELLING', String(inv.out_of_stock_but_selling)], ['RUN OUT WITHIN 7 DAYS', String(inv.running_out_within_7_days)]);
    else if (R) rows.push(['STOCK-OUTS, STILL SELLING', String(R.out_of_stock_selling)], ['RUNNING LOW (≤7d)', String(R.low_cover)]);
    if (R && R.lost_sales_per_day > 0) rows.push(['SALES AT RISK / DAY', 'Rs ' + M.fmtNum(R.lost_sales_per_day)]);
    if (R && R.total_lines) rows.push(['REORDER LINES', R.total_lines + ' (est. Rs ' + M.fmtNum(R.est_value_at_sale_price) + ' at sale price)']);
    if (sp) rows.push(['DELAYED TRANSFERS (3+ DAYS)', sp.matching + (sp.items && sp.items[0] ? ' · oldest ' + sp.items[0].age_days + ' days' : '')]);
    else if (str) rows.push(['DISPATCHED, NOT RECEIVED', String(str.dispatched_not_received.all)]);
    if (F && F.fill_rate_pct != null) rows.push(['STR FILL RATE', F.fill_rate_pct + '%'], ['SHORT / ZERO-DISPATCH LINES', F.short_lines + ' / ' + F.zero_dispatch_lines], ['SHORT RECEIPTS', F.receipt_accuracy_pct != null ? 'receipt accuracy ' + F.receipt_accuracy_pct + '%' : 'not measurable']);
    const link = M.correlate(visibleFindings()).find(c => c.id === 'c_str_inv');
    body = h('div', {},
      rows.length ? h('dl', { class: 'aic-met aic-big' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])) : empty((P && P.errors && (P.errors.reorder || P.errors.fill)) || 'Inventory and transfer data not available.'),
      link ? h('div', { class: 'aic-note' }, tagEl('CORRELATION'), ' ', link.title + '. ', link.why, ' ', h('button', { class: 'aic-g', text: 'Ask BT to check', onclick: () => ask('Check whether these are connected, using your tools, and say what is known and what is uncertain: ' + link.parts.map(p => p.title).join(' / ')) })) : null,
      R ? h('details', { class: 'aic-det2', id: 'aic-d-reorder' }, h('summary', { text: 'Reorder recommendations' + (R.total_lines ? ' · ' + R.total_lines + ' lines' : '') }), reorderBody()) : null,
      F ? h('details', { class: 'aic-det2', id: 'aic-d-fill' }, h('summary', { text: 'STR fill rate detail' + (F.fill_rate_pct != null ? ' · ' + F.fill_rate_pct + '%' : '') }), fillBody()) : null,
      h('div', { class: 'aic-row' }, h('button', { text: 'Why are transfers delayed?', onclick: () => ask('Why are transfers delayed?') }), h('button', { text: 'Which reorders need review?', onclick: () => ask('Which reorder recommendations need review?') })));
  }
  return card('invstr', 'monitor', sectionHeader('INVENTORY & STR', h('span', { class: 'aic-sub', text: 'recommendations only · nothing is ordered' })), body);
}

// ── Closing, Cash & Money: compact totals, ledger detail on demand ──
function secMoney() {
  const raw = S.snap && S.snap.raw, P = raw && raw.planning, Mo = P && P.money;
  let body;
  if (!S.snap) body = skeleton(2);
  else {
    const rows = [], cl = raw.closing, today = cl && cl.days && cl.days[0], inc = cl && cl.incomplete_days, day = raw.day, cr = raw.briefing && raw.briefing.credit;
    if (today) rows.push(['CLOSING TODAY', today.closed + ' of 3 shifts closed']);
    if (inc) rows.push(['DAYS WITH OPEN SHIFTS (7D)', inc.length ? inc.length + ' · ' + inc.slice(0, 2).map(d => d.date + ': ' + d.missing.join(', ')).join(' | ') : '0']);
    if (day) rows.push(['CASH DIFF (' + day.date + ')', 'Rs ' + M.fmtNum(day.diff)]);
    if (cr && cr.month_net_owed != null) rows.push(['STAFF CREDIT OWED (' + cr.month + ')', 'Rs ' + M.fmtNum(cr.month_net_owed) + ' · ' + (cr.staff_owing || 0) + ' staff']);
    if (Mo) Mo.ledgers.filter(ledgerHasActivity).forEach(L => rows.push([String(L.ledger).toUpperCase() + ' · MONTH TO DATE', 'Rs ' + M.fmtNum(L.month_to_date_total)]));
    const exc = Mo ? Mo.ledgers.reduce((n, L) => n + (L.running_above_usual || []).length, 0) : 0, dup = cr ? cr.possible_duplicates : 0;
    if (Mo || cr) rows.push(['LEDGER EXCEPTIONS', exc + ' running above usual · ' + (dup || 0) + ' possible duplicate' + (dup === 1 ? '' : 's')]);
    body = h('div', {},
      rows.length ? h('dl', { class: 'aic-met aic-big' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])) : empty((P && P.errors && P.errors.money) || 'Closing, cash and ledger data not available.'),
      Mo || (P && P.errors && P.errors.money) ? h('details', { class: 'aic-det2', id: 'aic-d-ledger' }, h('summary', { text: 'Ledger detail · ' + ((Mo && Mo.month) || 'this month') }), ledgerBody()) : null,
      h('div', { class: 'aic-row' }, h('button', { text: 'Open Closing Book', onclick: () => openPage('#closing') }), h('button', { text: 'Explain closing position', onclick: () => ask('Explain today’s closing position.') })));
  }
  return card('money', 'monitor', sectionHeader('CLOSING, CASH & MONEY', h('span', { class: 'aic-sub', text: 'closing_recent_days · money_overview' })), body);
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

// ── agent fleet ── one tile per REGISTERED specialist. Every value is read from the registry or real telemetry:
// ACTIVE only while routed/running now; otherwise runs / last run / errors from this device's history (never invented).
function activeAgentIds(live) {
  const on = new Set(), tool = {};
  const rm = live.open && live.routed && live.routed.metadata;
  if (rm) { (rm.domains || []).forEach(d => on.add(d)); if (rm.specialist) on.add(rm.specialist); if ((rm.domains || []).length > 1) on.add('analyst'); }
  if (live.activeTool && live.activeTool.domain) { on.add(live.activeTool.domain); tool[live.activeTool.domain] = live.activeTool.tool; }
  return { on, tool };
}
// What each specialist is for, and one question it can answer right now. Questions are plain asks to the existing assistant.
const FLEET_INFO = {
  sales: { job: 'Sales, target pace and cash', q: 'How are sales against target this month?' },
  manager: { job: 'Staff credit, salary and ledgers', q: 'Who owes staff credit and how much?' },
  inventory: { job: 'Stock levels, reorder and risk', q: 'What inventory is at risk?' },
  str: { job: 'Stock transfers and fill rate', q: 'Which stock transfers are waiting to be dispatched or received?' },
  closing: { job: 'Daily closing and shifts', q: 'What is blocking closing?' },
  billing: { job: 'Emergency billing entries', q: 'Is anything stuck in emergency billing?' },
  documents: { job: 'Notes, sheets and documents', q: 'Summarise my recent notes and sheets.' },
  analyst: { job: 'Combines several areas into one answer', q: 'What needs my attention?' },
};
function fleetTile(id, act) {
  const sp = SPECIALISTS[id], st = agentStats(id), tools = listTools().filter(t => t.domain === id);
  const errs = T.recent(400, e => e.type === 'error' && e.agent === sp.label).length;
  const on = act.on.has(id);
  const waiting = allRuns().some(r => r.status === 'awaiting_approval' && r.agents.includes(sp.label));
  const state = on ? 'ACTIVE' : waiting ? 'NEEDS YOU' : st.runs ? 'STANDBY' : 'NO RUNS';
  const detail = on ? (act.tool[id] ? 'Running ' + act.tool[id] : 'Working on the current request') : waiting ? 'Waiting for your approval' : st.runs ? 'Last run ' + M.ageLabel(st.last) : 'Not run in the last 7 days on this device';
  const info = FLEET_INFO[id] || { job: '', q: '' };
  const stats = id === 'analyst' ? st.runs + ' runs' : st.runs + ' runs' + (errs ? ' · ' + errs + ' errors' : '');
  const cls = 'aic-ftile' + (on ? ' on' : '') + (waiting ? ' await' : '') + (!on && !waiting && !st.runs ? ' idle' : '');
  return h('div', { class: cls, role: 'group', 'data-agent': id, 'aria-label': sp.label + ', ' + state.toLowerCase() + '. ' + detail },
    h('button', { class: 'aic-fmain', onclick: () => openAgent(id), 'aria-label': 'Details for ' + sp.label + ': tools, latest run and events' },
      h('span', { class: 'aic-fport', 'aria-hidden': 'true', text: id.slice(0, 2).toUpperCase() }),
      h('span', { class: 'aic-fbody' },
        h('b', { text: sp.label }),
        h('span', { class: 'aic-pill aic-' + (on ? 'ok' : waiting ? 'wn' : 'mu'), text: state }),
        info.job ? h('span', { class: 'aic-fjob', text: info.job }) : null,
        h('small', { class: 'aic-fstats', text: detail + (on || waiting || !st.runs ? '' : ' · ' + stats) + ' · ' + (id === 'analyst' ? 'all tools' : tools.length + ' tools') }))),
    info.q ? h('button', { class: 'aic-fask', onclick: () => ask(info.q), title: 'Ask JARVIS this question', text: 'Ask: ' + info.q }) : null);
}

// ── agent runs: timeline rebuilt from the real activity log ──
const RUN_TONE = { complete: 'ok', running: 'ok', awaiting_approval: 'wn', failed: 'cr', cancelled: 'wn', unfinished: 'mu' };
const RUN_LABEL = { complete: 'COMPLETE', running: 'RUNNING', awaiting_approval: 'AWAITING APPROVAL', failed: 'FAILED', cancelled: 'CANCELLED', unfinished: 'NOT FINISHED' };
const allRuns = () => M.buildRuns(T.recent(400).slice().reverse(), (T.liveState().open || {}).request_id || null);
function stageList(run) {
  if (!run.stages.length) return empty('No stages recorded.');
  return h('ol', { class: 'aic-tl' }, run.stages.map(st => h('li', { class: 'aic-tls aic-tl-' + st.status },
    h('span', { class: 'aic-tld', 'aria-hidden': 'true' }),
    h('b', { text: st.label }), ' ', h('time', { text: clock(st.at) }),
    st.status === 'waiting' ? h('span', { class: 'aic-tag', text: 'WAITING FOR YOU' }) : st.status === 'failed' ? h('span', { class: 'aic-tag aic-tl-bad', text: 'FAILED' }) : null,
    st.detail ? h('div', { class: 'aic-sub', text: st.detail }) : null)));
}
function openRun(run) {
  openModal('Run · ' + (run.question ? run.question.slice(0, 60) : 'request'), h('div', {},
    h('div', { class: 'aic-row' }, h('span', { class: 'aic-pill aic-' + RUN_TONE[run.status], text: RUN_LABEL[run.status] }), run.durationMs != null ? h('span', { class: 'aic-sub', text: 'took ' + (run.durationMs < 1000 ? run.durationMs + ' ms' : (run.durationMs / 1000).toFixed(1) + ' s') }) : h('span', { class: 'aic-sub', text: 'no end event recorded' }), run.historical ? h('span', { class: 'aic-tag aic-earlier', text: 'EARLIER SESSION' }) : null),
    h('div', { class: 'aic-k', text: 'STAGES THAT ACTUALLY HAPPENED' }), stageList(run),
    run.tools.length ? [h('div', { class: 'aic-k', text: 'TOOLS (' + run.tools.length + ')' }), h('ul', { class: 'aic-list' }, run.tools.map(t => h('li', {}, h('b', { text: t.tool }), ' ', h('span', { class: 'aic-pill aic-' + (t.status === 'ok' ? 'ok' : 'cr'), text: t.status || '?' }), t.duration != null ? h('span', { class: 'aic-sub', text: ' ' + t.duration + ' ms' }) : null)))] : null,
    h('div', { class: 'aic-k', text: 'ALL EVENTS' }), eventList(run.events.slice().reverse())));
}
function runRow(run) {
  const when = run.historical ? clockFull(run.startedAt) : clock(run.startedAt);
  return h('li', { class: 'aic-run aic-run-' + run.status },
    h('button', { class: 'aic-runb', onclick: () => openRun(run), 'aria-label': 'Open run: ' + (run.question || 'request') + ', ' + RUN_LABEL[run.status].toLowerCase() },
      h('span', { class: 'aic-runq', text: run.question ? (run.question.length > 90 ? run.question.slice(0, 89).trimEnd() + '…' : run.question) : 'Request' }),
      h('span', { class: 'aic-pill aic-' + RUN_TONE[run.status], text: RUN_LABEL[run.status] }),
      h('span', { class: 'aic-sub', text: when + (run.durationMs != null ? ' · ' + (run.durationMs / 1000).toFixed(1) + ' s' : '') + (run.agents.length ? ' · ' + run.agents.join(' + ') : '') + (run.tools.length ? ' · ' + run.tools.length + ' tool' + (run.tools.length === 1 ? '' : 's') : '') }),
      h('span', { class: 'aic-runst', 'aria-hidden': 'true' }, run.stages.map(st => h('i', { class: 'aic-tl-' + st.status, title: st.label })))));
}
function runsBlock(heading = true) {
  const runs = allRuns();
  return h('div', { class: 'aic-runs' }, heading ? h('div', { class: 'aic-k', text: 'RECENT RUNS · FROM THE REAL ACTIVITY LOG' }) : null,
    runs.length ? h('ul', { class: 'aic-runl' }, runs.slice(0, 3).map(runRow)) : empty('No agent runs recorded on this device yet. Ask JARVIS something and the run appears here.'),
    runs.length > 3 ? h('details', { class: 'aic-log' }, h('summary', { text: 'Earlier runs · ' + (runs.length - 3) }), h('ul', { class: 'aic-runl' }, runs.slice(3, 15).map(runRow))) : null);
}


// ── instrument tiles (compact gauges around the core). Every value is read from existing state; "—" means not available, never 0. ──
const RING_C = 2 * Math.PI * 20;
function ringGauge(pct, tn) {
  const p = Math.max(0, Math.min(100, pct)), svg = h2svg('svg', { viewBox: '0 0 48 48', class: 'aic-ring-g aic-g-' + tn, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(h2svg('circle', { class: 'rg-track', cx: 24, cy: 24, r: 20 }),
    h2svg('circle', { class: 'rg-val', cx: 24, cy: 24, r: 20, 'stroke-dasharray': (p / 100 * RING_C).toFixed(1) + ' ' + RING_C.toFixed(1), transform: 'rotate(-90 24 24)' }));
  return svg;
}
function instTile({ label, value, sub, tn = 'mu', pct = null, onclick = null }) { // kept for diagnostics tiles
  const body = [pct != null ? ringGauge(pct, tn) : null,
    h('span', { class: 'aic-it-b' }, h('span', { class: 'aic-it-l', text: label }), h('b', { class: 'aic-it-v aic-' + tn, text: value }), h('small', { text: sub }))];
  const aria = label + ': ' + value + '. ' + sub;
  return onclick ? h('button', { class: 'aic-it', 'aria-label': aria, onclick }, body) : h('div', { class: 'aic-it', role: 'group', 'aria-label': aria }, body);
}


function secFleet(info) {
  const act = activeAgentIds(info.live);
  const ids = Object.keys(SPECIALISTS).filter(id => id !== 'general');
  return card('fleet', 'monitor investigate', sectionHeader('AGENT FLEET', h('span', { class: 'aic-sub', text: ids.length + ' specialists · tap one for its tools and events' })),
    h('div', { class: 'aic-fleet' }, ids.map(id => fleetTile(id, act))));
}
function secRuns() {
  return card('runs', 'monitor investigate', sectionHeader('RECENT RUNS', h('span', { class: 'aic-sub', text: 'from the real activity log' })), runsBlock(false));
}
function h2svg(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; }

function openAgent(id) {
  const sp = SPECIALISTS[id], st = agentStats(id), tools = listTools().filter(t => t.domain === id);
  const ev = T.recent(60, e => e.agent === sp.label).slice(0, 10);
  openModal(sp.label + ' specialist', h('div', {},
    h('dl', { class: 'aic-met' }, [['Runs (7 days, this device)', String(st.runs)], ['Last run', st.last ? M.ageLabel(st.last) : 'not run yet'], ['Tools', String(id === 'analyst' ? 'all domains it is routed to' : tools.length)]].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    tools.length ? h('ul', { class: 'aic-list' }, tools.map(t => h('li', {}, h('b', { text: t.name }), ' ', h('span', { class: 'aic-pill aic-' + (t.risk === 'read' || t.risk === 'ui' ? 'ok' : 'wn'), text: t.risk }), h('div', { class: 'aic-sub', text: t.description.slice(0, 140) })))) : null,
    (() => { const mine = allRuns().filter(r => r.agents.includes(sp.label)).slice(0, 1)[0]; return mine ? [h('div', { class: 'aic-k', text: 'LATEST RUN · ' + RUN_LABEL[mine.status] }), stageList(mine)] : null; })(),
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
function openFinding(f, entry) {
  const A = S.assess[f.id];
  const R = C.structureInvestigation(f, A, S.snap ? C.buildActionDrafts(S.snap.raw) : []);
  const sec = (label, ...kids) => [h('div', { class: 'aic-k', text: label }), ...kids];
  const evRow = e => h('li', {}, h('span', { class: 'aic-tag aic-k-' + String(e.kind).split(' ')[0].toLowerCase(), text: e.kind }), ' ', h('span', { class: 'aic-cls aic-cls-' + e.cls, text: C.CLASS_LABEL[e.cls] }), ' ', h('b', { text: e.label + ': ' }), e.value, e.source ? h('span', { class: 'aic-sub', text: '  (' + e.source + ')' }) : null);
  const act = a => a.kind === 'open' ? h('button', { text: a.label, onclick: () => openPage(a.href) })
    : a.kind === 'draft' ? h('button', { text: a.label + ' (preview)', onclick: () => { closeModal(); openDraft(a.draft); } })
      : h('button', { class: 'aic-p', text: a.label, onclick: () => investigate(f) });
  openModal(f.title.length > 60 ? f.type + ' · ' + f.system : f.title, h('div', { class: 'aic-find' },
    h('div', { class: 'aic-row' }, pill(f.severity === 'warning' ? 'WARNING' : f.severity === 'good' ? 'HEALTHY' : 'INFO', f.severity.toUpperCase()), h('span', { class: 'aic-tag', text: R.area }), h('span', { class: 'aic-tag', text: f.type }), h('span', { class: 'aic-sub', text: 'Observed ' + M.ageLabel(f.detected_at) })),
    sec('FINDING', h('p', { text: f.title }), f.description && f.description !== f.title ? h('p', { class: 'aic-sub', text: f.description }) : null,
      entry && entry.related && entry.related.length ? h('ul', { class: 'aic-list' }, entry.related.map(r => h('li', {}, h('b', { text: 'Related: ' }), r.title))) : null,
      entry && entry.linked && entry.linked.length ? entry.linked.map(l => h('div', { class: 'aic-note' }, tagEl('CORRELATION'), ' ', l.title + '. ', l.why)) : null),
    sec('IMPACT', h('p', { text: R.impact }), h('p', { class: 'aic-sub', text: f.if_act })),
    sec('EVIDENCE', R.evidence.length ? h('ul', { class: 'aic-list' }, R.evidence.map(evRow)) : empty('No evidence rows.'),
      h('div', { class: 'aic-sub', text: 'Checked with: ' + f.related_tools.join(', ') + '. Agents: ' + f.related_agents.join(', ') + '.' }),
      h('div', { class: 'aic-path' }, (f.related_entities || []).map(r => h('span', { class: 'aic-tag', text: r.kind + ': ' + r.value })))),
    sec('CONFIDENCE & LIMITATIONS', h('p', {}, h('b', { text: 'Confidence: ' + R.confidence.level }), R.confidence.reason ? ' — ' + R.confidence.reason : ''),
      R.limitations.length ? h('ul', { class: 'aic-list' }, R.limitations.map(l => h('li', { text: l }))) : null,
      h('p', { class: 'aic-sub', text: 'Rule-based check "' + f.source + '" ran on your current data. Verified: FACT, DETECTION and CALCULATION rows. Not known: the cause. That needs investigation.' })),
    sec('RECOMMENDATION', h('p', {}, tagEl('RECOMMENDATION'), ' ', R.recommendation.text),
      h('dl', { class: 'aic-met' }, [['Source', R.recommendation.source === 'ai' ? 'AI Analyst (check against the evidence)' : 'Rule-based: a fixed rule, not AI'], ['Why', R.recommendation.why || 'not stated'], ['Expected result', R.recommendation.expected], ['Risk', R.recommendation.risk], ['Approval', R.recommendation.approval_required ? 'Required for any change' : 'Not needed: advice only. BT never changes data without your approval.']].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))),
    sec('AVAILABLE ACTIONS', h('div', { class: 'aic-row' }, R.actions.map(act), h('button', { class: 'aic-g', text: 'Dismiss for today', onclick: () => { const d = lsGet(LS_DISMISS) || {}; d[f.id] = M.isoDay(new Date()); lsSet(LS_DISMISS, d); closeModal(); render(); } }))),
    sec("BT'S ASSESSMENT", A ? assessmentNode(A) : h('p', { class: 'aic-sub', text: 'BT has not been asked about this yet. The detection above is rule-based, with no AI involved.' })),
    sec('AUDIT REFERENCE', h('p', { class: 'aic-sub', text: f.audit_reference + '. Read-only detection: nothing was changed. Changes made later through BT appear in the audit log with their own reference.' }))),
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
  const rows = [['Agent', e.agent || (e.source === 'ai-center' ? 'BT Intelligence monitoring read' : '—')], ['Tool', e.tool], ['Domain', e.domain || '—'], ['Risk', (e.metadata && e.metadata.risk) || (def && def.risk) || '—'],
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
  const dn = draftsNode(); if (dn) body.push(dn);
  const sn = sinceNode(); if (sn) body.push(sn);
  body.push(h('div', { class: 'aic-k', text: 'UNDOABLE (last 48 hours)' }));
  if (!A) body.push(skeleton(2));
  else if (A.state === 'error') body.push(h('div', { class: 'aic-err', text: 'Could not read the audit log: ' + A.error }));
  else {
    body.push(A.undos.length ? h('ul', { class: 'aic-list' }, A.undos.map(u => h('li', {}, h('b', { text: u.label }), h('div', { class: 'aic-sub', text: M.ageLabel(u.at) + ' · ' + u.tool }), h('button', { text: '↶ Undo', onclick: async ev => { ev.target.disabled = true; const it = pushUndo({ tool: u.tool, label: u.label, fn: u.fn, key: u.key }); const r = await runUndo(it.id); if (r.ok && r.key) await markUndone(getSb(), r.key); toast(r.ok ? 'Undone: ' + r.label : 'Undo failed: ' + r.error); refresh({ force: true }); } })))) : empty('No undoable changes.'));
    const logList = A.recent.length ? h('ul', { class: 'aic-ev' }, A.recent.map(r => h('li', { class: 'aic-evi' }, h('time', { text: new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }), h('span', { class: 'aic-evt', text: r.tool + (r.error ? ' (' + r.error + ')' : '') }), outcomeChip(r), h('span', { class: 'aic-sub', text: r.ref })))) : empty('No AI changes recorded.');
    body.push(h('details', { class: 'aic-log' }, h('summary', { text: 'Recent changes (audit log) · ' + A.recent.length }), logList));
  }
  return card('actc', 'act', sectionHeader('APPROVALS & RECENT ACTIVITY', h('span', { class: 'aic-sub', text: 'BT proposes \u00B7 you approve' })), body);
}


// Outcome chip for an audit row. "Executed" only when the audit log recorded success; a failure is shown as failed.
function outcomeChip(r) {
  const key = C.auditActionState({ change: true, status: r.status === 'applied' ? 'approved' : r.status });
  const st = C.ACTION_STATES[key];
  return h('span', { class: 'aic-pill aic-' + st.tone, title: st.note, text: st.label });
}
// Prepared drafts: text only. Creating or viewing one never changes, sends or approves anything.
function draftsNode() {
  if (!S.snap) return null;
  const drafts = C.buildActionDrafts(S.snap.raw);
  if (!drafts.length) return null;
  return h('div', { class: 'aic-drafts' }, h('div', { class: 'aic-k', text: 'PREPARED DRAFTS (nothing is changed or sent)' }),
    h('ul', { class: 'aic-list' }, drafts.map(d => h('li', {},
      h('div', { class: 'aic-row' }, h('b', { text: d.title }), h('span', { class: 'aic-pill aic-' + C.ACTION_STATES[d.state].tone, title: C.ACTION_STATES[d.state].note, text: C.ACTION_STATES[d.state].label })),
      h('div', { class: 'aic-sub', text: d.affected + ' · ' + d.amounts }),
      h('button', { text: 'Preview', 'aria-label': 'Preview ' + d.title, onclick: () => openDraft(d.id) })))));
}
function openDraft(id) {
  const d = S.snap && C.buildActionDrafts(S.snap.raw).find(x => x.id === id);
  if (!d) { toast('That draft is no longer available. Refresh and try again.'); return; }
  const st = C.ACTION_STATES[d.state];
  openModal(d.title, h('div', {},
    h('div', { class: 'aic-row' }, h('span', { class: 'aic-pill aic-' + st.tone, text: st.label }), h('span', { class: 'aic-sub', text: 'Built from ' + d.source + ' · data as of ' + clock(S.snap.at) })),
    h('div', { class: 'aic-k', text: 'PURPOSE' }), h('p', { text: d.purpose }),
    h('div', { class: 'aic-k', text: 'AFFECTED RECORDS' }), h('p', { text: d.affected }),
    h('div', { class: 'aic-k', text: 'QUANTITIES / AMOUNTS' }), h('p', { text: d.amounts }),
    h('div', { class: 'aic-k', text: 'EXPECTED IMPACT' }), h('p', { class: 'aic-sub', text: d.impact }),
    h('div', { class: 'aic-k', text: 'PREVIEW (exactly what will be copied)' }), h('pre', { class: 'aic-pre', text: d.text }),
    h('div', { class: 'aic-gate aic-ok', text: d.note + ' Any real change still needs your approval in the Action Center.' }),
    h('div', { class: 'aic-row' },
      h('button', { class: 'aic-p', text: 'Copy', onclick: () => copyText(d.text, d.title + ' copied') }),
      h('button', { text: 'Open source page', onclick: () => openPage(d.href) }),
      h('button', { class: 'aic-g', text: 'Ask BT to review', onclick: () => { closeModal(); ask('Review this ' + d.title.toLowerCase() + ' and tell me what is known and what is uncertain.'); } }))),
  { sub: 'Prepared draft · read-only', tonec: 'cy' });
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

//  observability (section 42): measured from real recorded events (last 7 days on this device + this session)
function secObs() {
  const o = M.observability(T.recent(400).reverse()), na = 'no data yet';
  const row = (k, v) => [h('dt', { text: k }), h('dd', { text: v })];
  return card('obs', 'investigate', sectionHeader('OBSERVABILITY', h('span', { class: 'aic-sub', text: 'last 7 days, this device' })),
    h('dl', { class: 'aic-met aic-big' }, [
      ...row('REQUESTS', o.requests + ' (' + o.answered + ' answered, ' + o.errors + ' failed)'), ...row('AVG INVESTIGATION', o.avgInvestigationMs != null ? M.fmtDur(o.avgInvestigationMs) : na), ...row('LONGEST', o.maxInvestigationMs != null ? M.fmtDur(o.maxInvestigationMs) : na),
      ...row('APPROVALS', o.approvals + ' decided (' + o.approvalsRejected + ' rejected)'), ...row('AVG APPROVAL WAIT', o.avgApprovalWaitMs != null ? M.fmtDur(o.avgApprovalWaitMs) : na), ...row('RETRIES', String(o.retries)),
      ...row('TOOL RUNS (THIS SESSION)', (() => { const st = T.toolStats(), c = Object.values(st).reduce((a, x) => a + x.calls, 0), f = Object.values(st).reduce((a, x) => a + x.failed, 0); return c ? c + ' (' + f + ' failed)' : na; })()),
      ...row('VERIFIED CHANGES', o.verified + ' passed, ' + o.verifyFailed + ' failed')]),
    h('div', { class: 'aic-sub', text: 'Requests = assistant questions on this device. System Health counts server calls from every device, so the two numbers can differ. Older than 7 days, or from another device, is not included. Cross-device history lives in the audit log.' }));
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
  return card('health', 'investigate', sectionHeader('SYSTEM HEALTH', h('span', { class: 'aic-sub', text: 'measured, not assumed' })),
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
  const head = sectionHeader('REPOSITORY INTELLIGENCE', info ? pill(info.stale ? 'WARNING' : 'HEALTHY', info.stale ? 'INDEX OLD' : 'INDEX READY') : pill(R.state === 'loading' ? 'NOT_MEASURED' : 'OFFLINE', R.state === 'loading' ? 'LOADING' : 'NOT CONNECTED'));
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


// ── AI Business Copilot: status, latest answer (merged here), structured result, investigation history ──
function responseNode() {
  const e = T.recent(400, x => x.type === 'answer' || x.type === 'instant')[0];
  const err = T.recent(400, x => x.type === 'error')[0];
  if (err && (!e || err.timestamp > e.timestamp)) return failureNode((err.metadata && err.metadata.message) || 'unknown error', null);
  if (e && e.metadata && e.metadata.text) {
    const last = Object.entries(S.assess).sort((a, b) => b[1].at - a[1].at)[0];
    const f = last && S.snap && S.snap.findings.find(x => x.id === last[0]);
    return h('div', { class: 'aic-resp' },
      h('div', { class: 'aic-k', text: 'LATEST ANSWER · ' + M.ageLabel(e.timestamp) + (e.type === 'instant' ? ' · instant, no AI used' : '') }),
      mdNode(e.metadata.text),
      h('div', { class: 'aic-row' },
        f ? h('button', { class: 'aic-p', text: 'Open structured result', onclick: () => openFinding(f) }) : null,
        h('button', { text: 'Open full conversation', onclick: () => window.BTAgent && window.BTAgent.open() })));
  }
  return empty('Ask BT below, or tap Investigate on an issue. Answers appear here with their evidence.');
}
function histNode() {
  const runs = allRuns(), hist = C.buildInvestigationHistory(runs, 5);
  if (!hist.length) return empty('No investigations yet. Ask a question or tap Investigate on an issue.');
  return h('ul', { class: 'aic-ihist' }, hist.map(x => h('li', {},
    h('button', { class: 'aic-ih', 'aria-label': 'Open investigation: ' + x.question, onclick: () => { const r = runs.find(y => y.id === x.id); if (r) openRun(r); } },
      h('span', { class: 'aic-iq', text: x.question.length > 90 ? x.question.slice(0, 89).trimEnd() + '…' : x.question }),
      h('span', { class: 'aic-im' }, h('span', { class: 'aic-pill aic-' + RUN_TONE[x.status], text: RUN_LABEL[x.status] }), ' ', (x.specialists.join(' + ') || 'BT') + ' · ' + x.toolCount + (x.toolCount === 1 ? ' tool' : ' tools') + (x.failedTools ? ' (' + x.failedTools + ' failed)' : '') + ' · ' + M.ageLabel(x.at)),
      h('span', { class: 'aic-im2', text: 'Evidence: ' + x.evidence + (x.confidence ? ' · confidence ' + x.confidence : '') + (x.approval ? ' · approval ' + x.approval.status : '') }),
      x.outcomeState ? h('span', { class: 'aic-pill aic-' + C.ACTION_STATES[x.outcomeState].tone, title: C.ACTION_STATES[x.outcomeState].note, text: C.ACTION_STATES[x.outcomeState].label }) : null))));
}
function secCopilot(info) {
  return card('copilot', 'monitor investigate', sectionHeader('AI BUSINESS COPILOT', h('span', { class: 'aic-sub', text: 'read-only · evidence shown · you approve changes' })),
    secCore(info), responseNode(),
    h('div', { class: 'aic-k', text: 'INVESTIGATION HISTORY' }), histNode());
}

// ── Needs-you-now banner: critical findings and pending approvals are lifted above every normal section ──
function secCritical(info) {
  const A = window.BTAgent;
  const list = A && typeof A.approvals === 'function' ? A.approvals()
    : info.live.pendingApproval ? [{ id: 'live', tool: info.live.pendingApproval.tool, preview: { title: (info.live.pendingApproval.metadata && info.live.pendingApproval.metadata.title) || info.live.pendingApproval.tool } }] : [];
  const items = C.criticalItems({ findings: S.snap ? visibleFindings() : [], approvals: list });
  if (!items.length) return null;
  return card('crit', 'monitor investigate act', sectionHeader('NEEDS YOU NOW'),
    items.map(it => h('button', { class: 'aic-f aic-sev-error aic-crit-item', onclick: () => it.kind === 'approval' ? reviewApproval() : openFinding(it.finding) },
      h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
      h('span', { class: 'aic-fb' }, h('span', { class: 'aic-ft', text: it.title }), h('span', { class: 'aic-fs', text: it.area + ' · ' + (it.kind === 'approval' ? 'waiting for your decision' : 'critical') })),
      h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '›' }))));
}

// ── Operations & Diagnostics: every technical panel, one collapsed group ──
function secOps(info) {
  return card('ops', 'investigate', sectionHeader('OPERATIONS & DIAGNOSTICS', h('span', { class: 'aic-sub', text: 'agents · tools · health · repository' })),
    h('div', { class: 'aic-ops' }, secRuns(), secFleet(info), secNetwork(info), secActivity(), secObs(), secHealth(), secTools(), secRepo()));
}

// ───────────────────────── command bar + palette ─────────────────────────
function openChat() { if (window.BTAgent && typeof window.BTAgent.open === 'function') window.BTAgent.open(); else toast('The chat assistant is still loading. Try again in a moment.'); }

// ── voice (browser speech; shared module js/agent/ui/voice.js; spoken answers are handled by the chat panel) ──
const LS_VOICE = 'bt_aic_voice_v1';
const voiceLang = () => V.voiceLang(window);
let recog = null;
function voiceStop() { if (recog) recog.stop(); }
function voiceToggle() {
  if (S.voice.listening) { voiceStop(); return; }
  V.stopSpeaking(window);
  if (!window.BTAgent) { toast('The assistant is still loading. Try again in a moment.'); return; }
  const pref = lsGet(LS_VOICE) || {};
  if (!pref.noticed) { lsSet(LS_VOICE, { ...pref, noticed: true }); toast('Voice uses your browser\u2019s speech service. Audio may be processed by the browser vendor.'); }
  recog = V.createRecognizer(window, {
    lang: voiceLang(),
    onInterim: t => { const q = $('#aic-q'); if (q) q.value = t; },
    onFinal: t => { const q = $('#aic-q'); if (q) q.value = ''; toast('Heard: \u201C' + t.slice(0, 80) + '\u201D'); ask(t); },
    onEnd: () => { S.voice.listening = false; render(); },
    onError: code => toast(code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone permission was denied. Allow it in the browser site settings.' : code === 'no-speech' ? 'I did not hear anything. Try again.' : code === 'network' ? 'Voice needs an internet connection.' : 'Voice input failed (' + code + ').'),
  });
  if (!recog) return;
  try { recog.start(); S.voice.listening = true; render(); } catch (err) { toast('Could not start the microphone: ' + (err && err.message ? err.message : 'unknown error')); }
}
function micButton() {
  if (!V.voiceSupport(window).input) return h('button', { class: 'aic-mic', disabled: true, title: 'Voice input is not available in this browser', 'aria-label': 'Voice input unavailable', text: '🎙' });
  const on = S.voice.listening;
  return h('button', { class: 'aic-mic' + (on ? ' on' : ''), 'aria-pressed': String(on), title: on ? 'Listening. Tap to stop' : 'Speak to JARVIS', 'aria-label': on ? 'Stop listening' : 'Speak to JARVIS', text: on ? '⏹' : '🎙', onclick: voiceToggle });
}
function speakerButton() {
  if (!V.voiceSupport(window).output) return null; // no fake control when the browser cannot speak
  const on = S.voice.out;
  return h('button', { class: 'aic-spk' + (on ? ' on' : ''), 'aria-pressed': String(on), title: on ? 'Spoken answers on' : 'Spoken answers off', 'aria-label': 'Read answers aloud', text: on ? '🔊' : '🔈',
    onclick: () => { S.voice.out = !S.voice.out; V.setVoiceOut(S.voice.out); if (!S.voice.out) V.stopSpeaking(window); render(); } });
}
function promptChips() {
  const raw = S.snap && S.snap.raw, P = raw && raw.planning, A = window.BTAgent;
  return C.suggestPrompts({
    findings: S.snap ? visibleFindings() : [], reorderLines: (P && P.reorder && P.reorder.total_lines) || 0, fillPct: P && P.fill ? P.fill.fill_rate_pct : null,
    closingIncomplete: raw && raw.closing && raw.closing.incomplete_days ? raw.closing.incomplete_days.length : 0, approvals: A && typeof A.approvals === 'function' ? A.approvals().length : 0,
  }, 4);
}
function cmdBar() {
  const input = h('input', { id: 'aic-q', type: 'text', placeholder: 'Ask JARVIS anything about your business…', 'aria-label': 'Ask BT', autocomplete: 'off', enterkeyhint: 'send', maxlength: '2000' });
  const go = () => { const v = input.value; if (v.trim()) { input.value = ''; ask(v); } };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { class: 'aic-cmd' },
    h('div', { class: 'aic-chips', 'aria-label': 'Suggested questions' }, promptChips().map(c => h('button', { text: c, onclick: () => ask(c) }))),
    h('div', { class: 'aic-form' }, input,
      micButton(),
      speakerButton(),
      h('button', { class: 'aic-chatbtn', title: 'Open chat assistant', 'aria-label': 'Open chat assistant', onclick: openChat }, h('span', { 'aria-hidden': 'true', text: '\u{1F4AC}' }), h('span', { class: 'aic-chatbtn-t', text: 'Chat' })),
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
  ['View approvals / actions', 'Act', () => goMode('act', 'aic-actc')], ['View activity', 'Investigate', () => goMode('investigate', 'aic-act')], ['View system health', 'Investigate', () => goMode('investigate', 'aic-health')],
  ...M.SYSTEMS.map(s => ['View ' + s.toLowerCase(), 'System', () => openSystem(s)]),
  ['Run health check', 'System', () => refresh({ force: true })],
  ['Search repository', 'Investigate', () => { goMode('investigate', 'aic-repo'); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }], ['Explain architecture', 'Investigate', () => { goMode('investigate', 'aic-repo'); S.repoQ = RI.SAMPLE_QUESTIONS[4]; paint(); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }],
  ['Open Dashboard', 'Go to', () => openPage('#dashboard')], ['Open Closing Book', 'Go to', () => openPage('#closing-book')], ['Open STR Report', 'Go to', () => openPage('#str')], ['Open Inventory Health', 'Go to', () => openPage('#inv-health')], ['Open Cover', 'Go to', () => openPage('#cover')],
];
function goMode(mode, id) { closeModal(); S.mode = mode; S.open[String(id).replace(/^aic-/, '')] = true; paint(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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
  // Business-first order: critical → snapshot → needs attention → copilot → sales → inventory/STR → closing/cash/money → approvals → operations
  const mobile = isMobile();
  if (!mobile) document.body.removeAttribute('data-aic-view'); else document.body.dataset.aicView = S.view;
  let cards;
  if (mobile && S.view === 'copilot') cards = [secCopilot(info), secSuggested()];
  else if (mobile && S.view === 'alerts') cards = [secCritical(info), secAttention(), secActions(info)];
  else if (mobile) cards = [secCritical(info), secSystems(), secAttention(), secCopilotEntry(info), secForecast(), secInvStr(), secMoney(), secActions(info), secOps(info)];
  else cards = [secCritical(info), secSystems(), secAttention(), secCopilot(info), secForecast(), secInvStr(), secMoney(), secActions(info), secOps(info)];
  cards = cards.filter(Boolean);
  if (mobile && S.view === 'home') cards.forEach(c => { const l = DETAIL_LINKS[String(c.id).replace(/^aic-/, '')]; if (l) c.append(h('a', { class: 'aic-detail', href: l[0], text: l[1] + ' \u203A' })); });
  // a genuinely pending approval outranks everything: the Action Center moves to the top (CSS keyed on data-pri)
  const main = h('main', { class: 'aic-main', 'data-mode': S.mode, 'data-pri': info.live.pendingApproval ? 'approvals' : 'normal' }, cards);
  const offline = navigator.onLine === false ? h('div', { class: 'aic-offline', role: 'alert' }, h('b', { text: 'BT OFFLINE · ' }), 'Showing last known data' + (S.snap ? ' from ' + clock(S.snap.at) : '') + '. Some intelligence may be unavailable.') : null;
  const keep = $('#aic-q'), val = keep ? keep.value : '', hadFocus = keep && document.activeElement === keep;
  const rqHad = !!(document.activeElement && document.activeElement.id === 'aic-rq');
  const scroll = window.scrollY;
  r.replaceChildren(...[secHeaderBar(info.core), offline, S.error && S.snap ? failureNode(S.error, () => refresh({ force: true })) : null, main, !mobile || S.view === 'copilot' ? cmdBar() : null].filter(Boolean)); // null args would render the text "null"
  const cmdEl = $('.aic-cmd'); if (cmdEl && cmdEl.offsetHeight) r.style.setProperty('--aic-cmd-h', cmdEl.offsetHeight + 'px'); // content clearance: the fixed composer never covers the last card
  const q = $('#aic-q'); if (q) { q.value = val; if (hadFocus) q.focus(); }
  if (rqHad) { const r2 = $('#aic-rq'); if (r2) { r2.focus(); const n = r2.value.length; try { r2.setSelectionRange(n, n); } catch (_) { /* not a text input */ } } }
  if (Math.abs(window.scrollY - scroll) > 1) window.scrollTo(0, scroll);
  publishAlerts();
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
  p.classList.add('aic-jarvis');
  p.replaceChildren(h('div', { id: 'aic-root', class: 'aic' }));
  S.mounted = true;
  T.subscribe(onTelemetry);
  window.addEventListener('online', render); window.addEventListener('offline', render);
  try { const mq = window.matchMedia && window.matchMedia(MOBILE_Q); if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (pageOn()) paint(); }); } catch (_) { /* no matchMedia: desktop layout only */ }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistVisit(); else if (pageOn()) refresh(); });
  window.addEventListener('pagehide', persistVisit);
  window.addEventListener('hashchange', () => { document.body.classList.toggle('aic-open', /^#ai-center/.test(window.location.hash));
    if (/^#ai-center/.test(window.location.hash)) { const v = viewFromHash(); if (v !== S.view) { setView(v); if (pageOn()) { paint(); window.scrollTo(0, 0); } } } if (!/^#ai-center/.test(window.location.hash)) persistVisit(); });
  document.addEventListener('keydown', e => {
    if (!pageOn()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && modalEl) closeModal();
    else if (e.key === 'Tab' && modalEl) trapTab(e);
  });
  const iv = setInterval(() => { if (!pageOn()) return; S.tick++; if (T.liveState().open || S.tick % 15 === 0) render(); }, 1000);
  if (iv && typeof iv.unref === 'function') iv.unref(); // Node (tests) only: never keep the process alive
}

export function onShow() {
  mount();
  setView(viewFromHash());
  document.body.classList.add('aic-open');
  paint();
  refresh();
}

export const __test = { S, refresh, paint, openFinding, openSystem, openPalette, investigate, weekdayBars, openModal, allRuns, runsBlock, openDraft, promptChips };
