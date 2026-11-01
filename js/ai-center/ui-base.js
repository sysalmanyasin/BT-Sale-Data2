// BT INTELLIGENCE — base layer: page constants, shared state (S), tiny DOM helpers, toast, modal, Ask BT and the card/section primitives.

import { ICONS } from './deck-icons.js';
import * as T from '../agent/core/telemetry.js';
import { SPECIALISTS } from '../agent/core/specialists.js';
import { renderMarkdown } from '../agent/core/markdown-lite.js';
import * as M from './model.js';

export const PAGE_ID = 'page-ai-center';
export const LS_VISIT = 'bt_aic_last_visit_v1', LS_DISMISS = 'bt_aic_dismissed_v1';
export const STALE_MS = 5 * 60000, REFRESH_MS = 45000;

export const S = {
  tab: 'overview', snap: null, health: null, actions: null, history: [], loading: false, error: null,
  voice: { talking: false }, mode: 'monitor', filter: 'all', baseline: null, started: false, tick: 0, toolsOpen: false, open: {},
  awaitingFor: null, assess: {}, lastRefreshAt: 0, mounted: false, rafId: 0, deep: {}, repo: { state: 'idle', idx: null }, repoQ: '',
};

// ───────────────────────── tiny DOM helpers ─────────────────────────
export function h(tag, attrs, ...kids) {
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
export const $ = sel => document.querySelector(sel);
export const root = () => document.getElementById('aic-root');
export const pageOn = () => { const p = document.getElementById(PAGE_ID); return !!(p && p.classList.contains('on')); };
export const clockFull = ts => (ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const tone = status => M.STATUS_TONE[status] || 'mu';
export const pill = (status, text) => h('span', { class: 'aic-pill aic-' + tone(status), text: text || status });
export const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked: feature degrades silently */ } };

export function toast(msg) {
  const el = h('div', { class: 'aic-toast', role: 'status', text: msg });
  document.body.append(el); setTimeout(() => el.remove(), 3800);
}

// ───────────────────────── modal ─────────────────────────
export let modalEl = null, modalPrevFocus = null;

// Keep keyboard focus inside the open dialog (WCAG 2.4.3): Tab wraps from the last control to the first and back.
export function trapTab(e) {
  const box = modalEl && modalEl.querySelector('.aic-modal'); if (!box) return;
  const f = [...box.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(x => !x.closest('[hidden]'));
  if (!f.length) { e.preventDefault(); box.focus(); return; }
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || at === box)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  else if (!box.contains(at)) { e.preventDefault(); first.focus(); }
}
export function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; if (modalPrevFocus && modalPrevFocus.focus) modalPrevFocus.focus(); } }
export function openModal(title, body, { sub = '', tonec = 'cy' } = {}) {
  closeModal(); modalPrevFocus = document.activeElement;
  const box = h('div', { class: 'aic-modal aic-t-' + tonec, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'aic-mh' }, h('div', {}, h('h3', { text: title }), sub && h('div', { class: 'aic-sub', text: sub })), h('button', { class: 'aic-x', 'aria-label': 'Close', text: '✕', onclick: closeModal })),
    h('div', { class: 'aic-mb' }, body));
  modalEl = h('div', { class: 'aic-backdrop', onclick: ev => { if (ev.target === modalEl) closeModal(); } }, box);
  document.body.append(modalEl); box.focus();
}

// ───────────────────────── Ask BT (the existing agent) ─────────────────────────
export function ask(q) {
  q = String(q || '').trim(); if (!q) return;
  const A = window.BTAgent;
  if (!A) { toast('The assistant is still loading. Try again in a moment.'); return; }
  if (A.isBusy()) { toast('Dua is already working on a request.'); return; }
  Promise.resolve(A.ask(q)).catch(() => {});
}
export function investigate(f) {
  const A = window.BTAgent;
  if (A && typeof A.investigate === 'function') {
    if (A.isBusy()) { toast('Dua is already working on a request.'); return; }
    S.awaitingFor = f.id; closeModal();
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
export const openPage = href => { closeModal(); window.location.hash = href; };
export const SCROLL_QUIET_MS = 800;
export const scrollingNow = () => Date.now() - (S.lastScrollAt || 0) < SCROLL_QUIET_MS;
export function watchScrolling() {
  if (typeof document === 'undefined' || window.__btAicScrollWatch) return; window.__btAicScrollWatch = true;
  const mark = () => { S.lastScrollAt = Date.now(); };
  ['touchstart', 'touchmove', 'wheel', 'scroll'].forEach(t => document.addEventListener(t, mark, { capture: true, passive: true })); // capture: element scrolls do not bubble
}
const dismissedToday = () => { const d = lsGet(LS_DISMISS) || {}; const today = M.isoDay(new Date()); return Object.keys(d).filter(k => d[k] === today); };

export function visibleFindings() {
  const hide = new Set(dismissedToday());
  return ((S.snap && S.snap.findings) || []).filter(f => !hide.has(f.id));
}

// ───────────────────────── sections ─────────────────────────
export function sectionHeader(title, right) { return h('div', { class: 'aic-sh' }, h('h2', { text: title }), right || null); }
// Cards are collapsed by default (tap the title to open). Kept open: the one-line summary + status core, the Action Center
// (pending approvals must never be hidden), the latest BT response, and Tool Intelligence (it already has its own toggle).
// The open/closed choice lives in S.open so it survives the full repaint that runs on every refresh.
const ALWAYS_OPEN = new Set(['dktiles', 'dkatt', 'dksales', 'dkinv', 'dkmoney', 'dkappr', 'dkops', 'ops', 'crit', 'copilot', 'core', 'runs', 'att', 'sys', 'fc', 'invstr', 'money', 'actc', 'tools']);

// One-line, REAL summary shown in a collapsed card's header (hidden once the card is open). Returns [text, tone] or null.
function foldSummary(id) {
  const P = S.snap && S.snap.raw && S.snap.raw.planning;
  switch (id) {
    case 'fleet': { const n = activeAgentIds(coreInfo().live).on.size, total = Object.keys(SPECIALISTS).filter(k => k !== 'general').length; return [n ? n + ' running now' : total + ' ready · none running', n ? 'ok' : 'mu']; }
    case 'net': { const n = activeAgentIds(coreInfo().live).on.size; return [n ? n + ' running now' : 'none running', n ? 'ok' : 'mu']; }
    case 'reo': { const D = P && P.reorder; if (!S.snap) return null; return D ? (D.total_lines ? [D.total_lines + ' lines to buy', 'wn'] : ['nothing to reorder', 'ok']) : ['not available', 'mu']; }
    case 'fill': { const F = P && P.fill; if (!S.snap) return null; return F && F.fill_rate_pct != null ? [F.fill_rate_pct + '% filled', F.fill_rate_pct < 90 ? 'wn' : 'ok'] : ['not measurable', 'mu']; }
    case 'money': { const sc = P && P.money && P.money.staff_credit; if (!S.snap) return null; return sc ? ['Rs ' + M.fmtNum(sc.this_month.total_owed) + ' owed', 'mu'] : ['not available', 'mu']; }
    case 'ops': { const live = coreInfo().live, run = activeAgentIds(live).on.size, r = S.health, ok = r ? r.filter(x => x.status === 'HEALTHY').length : null; return [(r ? ok + ' of ' + r.length + ' healthy' : 'health loading') + ' \u00B7 ' + (run ? run + ' agent(s) running' : 'no agent running'), r && ok < r.length ? 'wn' : 'mu']; }
    case 'act': { const n = T.recent(150).length; return [n + (n === 1 ? ' event' : ' events'), 'mu']; }
    case 'obs': { const o = M.observability(T.recent(400).reverse()); return [o.requests + ' requests · ' + o.errors + ' failed', o.errors ? 'wn' : 'mu']; }
    case 'health': { const r = S.health; if (!r) return null; const ok = r.filter(x => x.status === 'HEALTHY').length; return [ok + ' of ' + r.length + ' healthy', ok < r.length ? 'wn' : 'ok']; }
    default: return null;
  }
}
export function card(id, modes, ...kids) {
  const first = kids[0];
  const foldable = !ALWAYS_OPEN.has(id) && kids.length > 1 && first && first.nodeType === 1 && first.classList.contains('aic-sh');
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
export function empty(text) { return h('div', { class: 'aic-empty', text }); }
export function skeleton(n = 3) { return h('div', { class: 'aic-skel', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('i'))); }

export function coreInfo() {
  const live = T.liveState();
  // The Center reads local app data, so only a real network loss makes it OFFLINE. Whether the assistant /
  // Supabase session is usable is reported by the Health panel and by Ask BT itself.
  return { live, core: M.deriveCoreState({ online: navigator.onLine !== false, authed: true, snapshotLoading: S.loading && !S.snap, snapshotReady: !!S.snap, live, now: Date.now() }) };
}

// ── reorder draft ──
export function copyText(text, ok) {
  const done = () => { if (typeof window.toast === 'function') window.toast(ok, 'success'); };
  try { navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy this list:', text)); } catch (_) { window.prompt('Copy this list:', text); }
}

// ── agent fleet ── one tile per REGISTERED specialist. Every value is read from the registry or real telemetry:
// ACTIVE only while routed/running now; otherwise runs / last run / errors from this device's history (never invented).
export function activeAgentIds(live) {
  const on = new Set(), tool = {};
  const rm = live.open && live.routed && live.routed.metadata;
  if (rm) { (rm.domains || []).forEach(d => on.add(d)); if (rm.specialist) on.add(rm.specialist); if ((rm.domains || []).length > 1) on.add('analyst'); }
  if (live.activeTool && live.activeTool.domain) { on.add(live.activeTool.domain); tool[live.activeTool.domain] = live.activeTool.tool; }
  return { on, tool };
}
export function h2svg(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; }
export function mdNode(text) { const d = document.createElement('div'); d.innerHTML = renderMarkdown(text); return d; } // renderMarkdown escapes everything first
export const ic = (name, cls = 'dk-ic') => { const s = h2svg('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); s.append(h2svg('path', { d: ICONS[name] || ICONS.bars })); return s; };
export function dkCard(id, icon, title, link, kids) {
  return h('section', { class: 'aic-card dk-card', id: 'aic-' + id },
    h('div', { class: 'dk-h' }, h('span', { class: 'dk-hic' }, ic(icon)), h('h2', { text: title }),
      link ? h('button', { class: 'dk-link', onclick: link[1], 'aria-label': link[0] + ': ' + title }, link[0], ic('chevron', 'dk-chev')) : null), kids);
}
export function dkWait() { return skeleton(3); }
export function kvList(items, cls) {
  return h('dl', { class: cls }, items.map(i => h('div', { class: 'dk-kv' + (i.tone ? ' dk-' + i.tone : '') }, h('dt', { text: i.label }), h('dd', { text: i.value }), i.note ? h('small', { text: i.note }) : null)));
}
