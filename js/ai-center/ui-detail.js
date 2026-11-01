// BT INTELLIGENCE — detail panels: activity events, outcome/draft views, observability, health, tools and the Command Deck list helpers.

import * as DK from './deck-model.js';
import * as FG from './forecast-game.js';
import { listTools } from '../agent/core/tool-registry.js';
import * as T from '../agent/core/telemetry.js';
import { readTool } from './adapters.js';
import * as M from './model.js';
import * as C from './copilot.js';
import { S, ask, card, clock, clockFull, closeModal, copyText, dkCard, dkWait, empty, h, kvList, openModal, openPage, pill, sectionHeader, skeleton, toast } from './ui-base.js';

// ── activity ──
export function eventList(evs) {
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


// Outcome chip for an audit row. "Executed" only when the audit log recorded success; a failure is shown as failed.
export function outcomeChip(r) {
  const key = C.auditActionState({ change: true, status: r.status === 'applied' ? 'approved' : r.status });
  const st = C.ACTION_STATES[key];
  return h('span', { class: 'aic-pill aic-' + st.tone, title: st.note, text: st.label });
}
// Prepared drafts: text only. Creating or viewing one never changes, sends or approves anything.
export function draftsNode() {
  if (!S.snap) return null;
  const drafts = C.buildActionDrafts(S.snap.raw);
  if (!drafts.length) return null;
  return h('div', { class: 'aic-drafts' }, h('div', { class: 'aic-k', text: 'PREPARED DRAFTS (nothing is changed or sent)' }),
    h('ul', { class: 'aic-list' }, drafts.map(d => h('li', {},
      h('div', { class: 'aic-row' }, h('b', { text: d.title }), h('span', { class: 'aic-pill aic-' + C.ACTION_STATES[d.state].tone, title: C.ACTION_STATES[d.state].note, text: C.ACTION_STATES[d.state].label })),
      h('div', { class: 'aic-sub', text: d.affected + ' · ' + d.amounts }),
      h('button', { text: 'Preview', 'aria-label': 'Preview ' + d.title, onclick: () => openDraft(d.id) })))));
}
export function openDraft(id) {
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
export const tagEl = k => h('span', { class: 'aic-tag aic-k-' + String(k).split(' ')[0].toLowerCase(), text: k });

//  correlation (rule-based co-occurrence of findings; never a claim of cause)

//  observability (section 42): measured from real recorded events (last 7 days on this device + this session)
export function secObs() {
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
export function deepViews(name) {
  const defs = DEEP[name]; if (!defs) return null;
  return h('div', {}, h('div', { class: 'aic-k', text: 'DEEPER VIEWS (existing read-only tools, loaded on request)' }), defs.map(([label, tool, args]) => {
    const key = name + ':' + label, out = h('div', { class: 'aic-deep' });
    const paint2 = () => { const d = S.deep[key]; out.replaceChildren(d ? (d.error ? h('div', { class: 'aic-err', text: d.error }) : renderDeep(d.data)) : ''); };
    paint2();
    return h('div', { class: 'aic-dv' }, h('button', { text: label, onclick: async ev => { const b = ev.currentTarget; b.disabled = true; try { S.deep[key] = { data: await readTool(tool, args) }; } catch (e) { S.deep[key] = { error: (e && e.message) || 'Could not read this.' }; } b.disabled = false; paint2(); } }), h('span', { class: 'aic-sub', text: ' ' + tool }), out);
  }));
}

// ── health ──
export function secHealth() {
  const rows = S.health;
  return card('health', 'investigate', sectionHeader('SYSTEM HEALTH', h('span', { class: 'aic-sub', text: 'measured, not assumed' })),
    rows ? h('ul', { class: 'aic-hl' }, rows.map(r => h('li', {}, h('span', { class: 'aic-hn', text: r.label }), pill(r.status), h('span', { class: 'aic-sub', text: r.detail })))) : skeleton(4));
}

// ── tools (lazy) ──
export function secTools() {
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
function dkList(rows) {
  return h('div', { class: 'dk-rows dk-flat' }, rows.map(r => h('div', { class: 'dk-line' }, h('span', { class: 'dk-lt' }, h('b', { text: r.name }), h('small', { text: r.sub })), h('b', { class: 'dk-big dk-r-' + (r.tone || 'cy'), text: r.value }))));
}
function auditSrc() { const d = S.snap && S.snap.raw && S.snap.raw.deck; return d || {}; }
export function secDkAudit() {
  const P = S.snap ? DK.auditPanel(auditSrc().ai) : null;
  return dkCard('dkaudit', 'shield', 'Audit & Variance', null,
    !S.snap ? dkWait() : !P ? empty('Audit data is not loaded yet. Open the Audit page once.') : h('div', {}, h('div', { class: 'dk-two' }, kvList(P.left, 'dk-l'), kvList(P.right, 'dk-r')),
      P.top.length ? h('div', {}, h('div', { class: 'dk-foot', text: 'Biggest unresolved variances' }), dkList(P.top)) : null));
}
export function secDkExpiry() {
  const P = S.snap ? DK.expiryPanel(auditSrc().ai) : null;
  return dkCard('dkexp', 'calendar', 'Near Expiry', null,
    !S.snap ? dkWait() : !P ? empty('No expiry data yet.') : h('div', {}, h('div', { class: 'dk-two' }, kvList(P.left, 'dk-l'), kvList(P.right, 'dk-r')), P.months.length ? dkList(P.months) : null));
}
export function secDkPay() {
  const P = S.snap ? DK.paymentPanel(auditSrc().pay) : null;
  return dkCard('dkpay', 'cash', 'Payments (Cash / Card / Credit)', null,
    !S.snap ? dkWait() : !P ? empty('Payment data is not loaded yet. Open the Payments page once.') : h('div', {}, h('div', { class: 'dk-two' }, kvList(P.left, 'dk-l'), kvList(P.right, 'dk-r')), dkList(P.days), P.foot ? h('div', { class: 'dk-foot', text: P.foot }) : null));
}
const GRADE_ICON = { bullseye: '\uD83C\uDFAF', hit: '\u2705', close: '\uD83D\uDFE1', miss: '\u274C' };
export function secDkGame() {
  const v = FG.view();
  return dkCard('dkgame', 'target', 'AI Forecast Game', null,
    !v ? empty('The AI needs at least 2 earlier same-weekday sales entries to make today\u2019s call.') : h('div', {},
      h('div', { class: 'dk-two' }, kvList([{ label: 'AI\u2019s call for today', value: v.locked ? DK.rs(v.locked.expected) : '\u2014', note: v.locked ? 'range ' + DK.rs(v.locked.low) + ' \u2013 ' + DK.rs(v.locked.high) : 'needs 2+ earlier same-weekday entries' }, { label: 'Projected close', value: DK.rs(v.projected), note: v.basis }], 'dk-l'),
        kvList([{ label: 'Sold so far (POS)', value: DK.rs(v.live), tone: v.status === 'reached' ? 'ok' : null, note: v.progressPct + '% of the call' }, { label: 'Status', value: ({ reached: 'Reached!', ahead: 'Ahead', on_track: 'On track', behind: 'Behind' })[v.status] || 'Waiting', tone: v.status === 'behind' ? 'wn' : v.status === 'waiting' ? null : 'ok' }], 'dk-r')),
      h('div', { class: 'fg-bar', role: 'progressbar', 'aria-valuenow': String(v.progressPct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Sold so far vs the AI call' }, h('s', { style: 'width:' + v.progressPct + '%' }), h('em', { style: 'left:100%' })),
      h('div', { class: 'dk-foot', text: v.message }),
      h('div', { class: 'dk-two fg-score' }, kvList([{ label: 'Streak', value: (v.score.streak ? '\uD83D\uDD25 ' : '') + v.score.streak, note: 'hits in a row' }, { label: 'Hit rate', value: v.score.played ? v.score.hits + ' / ' + v.score.played : '\u2014', note: v.score.bullseyes + ' bullseyes' }], 'dk-l'),
        kvList([{ label: 'Points', value: String(v.score.points) }, { label: 'Recent', value: v.score.recent.length ? v.score.recent.map(r => GRADE_ICON[r.grade]).join(' ') : 'none yet', note: v.score.recent[0] ? 'last: ' + (v.score.recent[0].errPct > 0 ? '+' : '') + v.score.recent[0].errPct + '%' : null }], 'dk-r')),
      h('div', { class: 'dk-foot', text: 'Bullseye (within 2%) = 3 pts \u00B7 Hit (5%) = 2 \u00B7 Close (10%) = 1. The AI locks one call per day and is graded on the final POS total; it celebrates when the sale reaches the call or it called a day within 5%.' }),
      h('div', { class: 'aic-row' }, h('button', { class: 'dk-pill', text: 'Preview celebration', onclick: () => FG.celebrate('This is how I celebrate when we reach the forecast!') }))));
}
