// BT INTELLIGENCE — data panels: weekday forecast, reorder draft, STR fill rate, ledgers, Inventory/STR and Money summaries, agent network, fleet, runs and instrument gauges.

import { listTools } from '../agent/core/tool-registry.js';
import * as T from '../agent/core/telemetry.js';
import { SPECIALISTS } from '../agent/core/specialists.js';
import * as M from './model.js';
import * as C from './copilot.js';
import { reorderDraftText } from '../shared/planning-metrics.js';
import { S, activeAgentIds, ask, card, clock, clockFull, copyText, empty, h, h2svg, mdNode, openModal, openPage, sectionHeader, skeleton, visibleFindings } from './ui-base.js';
import { eventList, tagEl } from './ui-detail.js';

// Weekday-aware projection + today's expected sale (tool: weekday_forecast, maths in shared/planning-metrics.js).

// Average sale per weekday, drawn from the tool's own weekday_baseline (no new calculation). Today's weekday is marked.
export function weekdayBars(W) {
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

export function secForecast() {
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
export function secInvStr() {
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
export function secMoney() {
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
export function secNetwork(info) {
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
    info.q ? h('button', { class: 'aic-fask', onclick: () => ask(info.q), title: 'Ask DUA this question', text: 'Ask: ' + info.q }) : null);
}

// ── agent runs: timeline rebuilt from the real activity log ──
export const RUN_TONE = { complete: 'ok', running: 'ok', awaiting_approval: 'wn', failed: 'cr', cancelled: 'wn', unfinished: 'mu' };
export const RUN_LABEL = { complete: 'COMPLETE', running: 'RUNNING', awaiting_approval: 'AWAITING APPROVAL', failed: 'FAILED', cancelled: 'CANCELLED', unfinished: 'NOT FINISHED' };
export const allRuns = () => M.buildRuns(T.recent(400).slice().reverse(), (T.liveState().open || {}).request_id || null);
function stageList(run) {
  if (!run.stages.length) return empty('No stages recorded.');
  return h('ol', { class: 'aic-tl' }, run.stages.map(st => h('li', { class: 'aic-tls aic-tl-' + st.status },
    h('span', { class: 'aic-tld', 'aria-hidden': 'true' }),
    h('b', { text: st.label }), ' ', h('time', { text: clock(st.at) }),
    st.status === 'waiting' ? h('span', { class: 'aic-tag', text: 'WAITING FOR YOU' }) : st.status === 'failed' ? h('span', { class: 'aic-tag aic-tl-bad', text: 'FAILED' }) : null,
    st.detail ? h('div', { class: 'aic-sub', text: st.detail }) : null)));
}
export function openRun(run) {
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
export function runsBlock(heading = true) {
  const runs = allRuns();
  return h('div', { class: 'aic-runs' }, heading ? h('div', { class: 'aic-k', text: 'RECENT RUNS · FROM THE REAL ACTIVITY LOG' }) : null,
    runs.length ? h('ul', { class: 'aic-runl' }, runs.slice(0, 3).map(runRow)) : empty('No agent runs recorded on this device yet. Ask DUA something and the run appears here.'),
    runs.length > 3 ? h('details', { class: 'aic-log' }, h('summary', { text: 'Earlier runs · ' + (runs.length - 3) }), h('ul', { class: 'aic-runl' }, runs.slice(3, 15).map(runRow))) : null);
}


// ── instrument tiles (compact gauges around the core). Every value is read from existing state; "—" means not available, never 0. ──
const RING_C = 2 * Math.PI * 20;
export function ringGauge(pct, tn) {
  const p = Math.max(0, Math.min(100, pct)), svg = h2svg('svg', { viewBox: '0 0 48 48', class: 'aic-ring-g aic-g-' + tn, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(h2svg('circle', { class: 'rg-track', cx: 24, cy: 24, r: 20 }),
    h2svg('circle', { class: 'rg-val', cx: 24, cy: 24, r: 20, 'stroke-dasharray': (p / 100 * RING_C).toFixed(1) + ' ' + RING_C.toFixed(1), transform: 'rotate(-90 24 24)' }));
  return svg;
}

export function secFleet(info) {
  const act = activeAgentIds(info.live);
  const ids = Object.keys(SPECIALISTS).filter(id => id !== 'general');
  return card('fleet', 'monitor investigate', sectionHeader('AGENT FLEET', h('span', { class: 'aic-sub', text: ids.length + ' specialists · tap one for its tools and events' })),
    h('div', { class: 'aic-fleet' }, ids.map(id => fleetTile(id, act))));
}
export function secRuns() {
  return card('runs', 'monitor investigate', sectionHeader('RECENT RUNS', h('span', { class: 'aic-sub', text: 'from the real activity log' })), runsBlock(false));
}

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
export function assessmentNode(A) {
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
