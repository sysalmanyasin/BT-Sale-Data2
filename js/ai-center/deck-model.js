// BT Intelligence "Command Deck" — pure view-model. Every number on the Overview comes from the real snapshot (daily_briefing,
// get_target_pace, closing_recent_days, str_*, planning tools, the inventory + audit bridges). A missing source gives null/omitted
// rows, never an invented value. No DOM here, so it is unit-tested directly.
import { notSoldStock, qtyOf, priceOf } from '../shared/inventory-metrics.js';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const fmt = v => Math.round(num(v)).toLocaleString('en-PK');
export const rs = v => 'Rs ' + fmt(v);
export const rsSigned = v => (num(v) < 0 ? '-' : '') + 'Rs ' + fmt(Math.abs(num(v)));
const short = v => { const n = num(v); return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n)); };

// ── from the inventory bridge (products) ──
export function inventoryStats(products, now = Date.now()) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) return null;
  const inStockRows = list.filter(p => qtyOf(p) > 0);
  const cover = inStockRows.map(p => { const per = num(p.netQty30Days) / 30; return per > 0 ? qtyOf(p) / per : null; }).filter(c => c !== null && c < 365);
  const ns = notSoldStock(list, 90, now);
  return {
    totalSkus: list.length, inStock: inStockRows.length, outOfStock: list.length - inStockRows.length,
    stockValue: Math.round(inStockRows.reduce((s, p) => s + qtyOf(p) * priceOf(p), 0)),
    avgCoverDays: cover.length ? Math.round((cover.reduce((a, b) => a + b, 0) / cover.length) * 10) / 10 : null,
    notSold90: { count: ns.count, value: ns.value },
  };
}
// ── from the audit bridge cache (open engagements and their counting rounds) ──
export function auditStats(summary) {
  const items = summary && Array.isArray(summary.items) ? summary.items : null;
  if (!items || !items.length) return null;
  const assigned = items.reduce((s, i) => s + num(i.assigned), 0), submitted = items.reduce((s, i) => s + num(i.submitted), 0);
  return { engagements: items.length, assigned, submitted, pct: assigned ? Math.round((submitted / assigned) * 100) : null,
    lead: { name: items[0].name, state: items[0].roundState, round: items[0].roundNumber } };
}

const raw = snap => (snap && snap.raw) || null;

export function overviewTiles(snap) {
  const r = raw(snap); if (!r) return [];
  const b = r.briefing, last = b && b.last_sales_entry, pace = r.pace, day = r.day, inv = b && b.inventory, cr = b && b.credit, fill = r.planning && r.planning.fill;
  const vs = b && b.yesterday && b.yesterday.vs_recent_avg_pct;
  // the briefing says when sales data is still loading: show that instead of a misleading "No sales entry" / 0%
  if (b && b.sales_data_ready === false) return overviewTilesLoading(r);
  return [
    { id: 'sales', icon: 'bars', tone: 'cy', label: 'Latest Sales', value: last ? rs(last.total_sale) : '\u2014', sub: last ? last.date : 'No sales entry yet',
      delta: Number.isFinite(Number(vs)) && vs !== null ? { pct: Math.abs(Math.round(num(vs))), up: num(vs) >= 0, text: 'yesterday vs recent avg' } : null },
    { id: 'target', icon: 'target', tone: 'cy', label: 'Sales Target', value: pace && pace.pct_done != null ? pace.pct_done + '%' : '\u2014', progress: pace && pace.pct_done != null ? Math.max(0, Math.min(100, num(pace.pct_done))) : null,
      sub: pace && pace.target ? 'of ' + rs(pace.target) : '' },
    { id: 'diff', icon: 'wallet', tone: day && num(day.diff) < 0 ? 'cr' : 'cy', label: 'Cash & Closing DIFF', value: day ? rsSigned(day.diff) : '\u2014', sub: day ? day.date : 'No day loaded' },
    { id: 'risk', icon: 'box', tone: inv && inv.out_of_stock_but_selling > 0 ? 'cr' : 'ok', label: 'Inventory Risk', value: inv ? String(inv.out_of_stock_but_selling) : '\u2014', sub: inv ? 'out of stock, still selling' : 'Open Inventory once' },
    { id: 'credit', icon: 'users', tone: 'ok', label: 'Staff Credit', value: cr && cr.month_net_owed != null ? rs(cr.month_net_owed) : '\u2014', sub: cr && cr.staff_owing != null ? cr.staff_owing + ' staff owing' : '' },
    { id: 'fill', icon: 'shield', tone: fill && fill.fill_rate_pct != null && fill.fill_rate_pct < 90 ? 'wn' : 'cy', label: 'STR Fill Rate', value: fill && fill.fill_rate_pct != null ? fill.fill_rate_pct + '%' : '\u2014', sub: fill ? 'transfer lines filled' : '' },
  ];
}

function overviewTilesLoading(r) {
  const inv = r.briefing && r.briefing.inventory, cr = r.briefing && r.briefing.credit, fill = r.planning && r.planning.fill, L = 'Loading sales data\u2026';
  return [
    { id: 'sales', icon: 'bars', tone: 'cy', label: 'Latest Sales', value: '\u2026', sub: L, loading: true },
    { id: 'target', icon: 'target', tone: 'cy', label: 'Sales Target', value: '\u2026', sub: L, loading: true },
    { id: 'diff', icon: 'wallet', tone: 'cy', label: 'Cash & Closing DIFF', value: '\u2026', sub: L, loading: true },
    { id: 'risk', icon: 'box', tone: inv && inv.out_of_stock_but_selling > 0 ? 'cr' : 'ok', label: 'Inventory Risk', value: inv ? String(inv.out_of_stock_but_selling) : '\u2014', sub: inv ? 'out of stock, still selling' : 'Open Inventory once' },
    { id: 'credit', icon: 'users', tone: 'ok', label: 'Staff Credit', value: cr && cr.month_net_owed != null ? rs(cr.month_net_owed) : '\u2014', sub: cr && cr.staff_owing != null ? cr.staff_owing + ' staff owing' : '' },
    { id: 'fill', icon: 'shield', tone: 'cy', label: 'STR Fill Rate', value: fill && fill.fill_rate_pct != null ? fill.fill_rate_pct + '%' : '\u2014', sub: fill ? 'transfer lines filled' : '' },
  ];
}

export function attentionRows(snap) {
  const r = raw(snap); if (!r) return [];
  const b = r.briefing, inv = b && b.inventory, R = r.planning && r.planning.reorder, out = [];
  const oos = inv ? inv.out_of_stock_but_selling : R ? R.out_of_stock_selling : null;
  if (oos != null) out.push({ id: 'oos', icon: 'globe', tone: 'cr', big: String(oos), label: 'Stock-outs', sub: 'Sold in the last 30 days, now out of stock', go: 'inventory' });
  const low = inv ? inv.running_out_within_7_days : R ? R.low_cover : null;
  if (low != null) out.push({ id: 'low', icon: 'calendar', tone: 'wn', big: String(low), label: 'Run out within 7 days', sub: 'Items at risk of running out', go: 'inventory' });
  if (R && R.lost_sales_per_day > 0) out.push({ id: 'risk', icon: 'trend', tone: 'vi', big: rs(R.lost_sales_per_day), label: 'Sales at risk / day', sub: 'Potential loss from stock-outs', go: 'inventory' });
  if (R && R.total_lines) out.push({ id: 'reo', icon: 'cart', tone: 'cy', big: fmt(R.total_lines), label: 'Reorder lines', sub: 'Est. ' + rs(R.est_value_at_sale_price) + ' at sale price', go: 'inventory' });
  return out;
}

export function salesChart(snap) {
  const W = raw(snap) && raw(snap).planning && raw(snap).planning.weekday;
  const rows = ((W && W.weekday_baseline) || []).filter(b => b && Number.isFinite(b.avg));
  if (!rows.length) return null;
  const maxV = Math.max(...rows.map(b => b.avg), 1), step = maxV > 300000 ? 100000 : maxV > 120000 ? 50000 : maxV > 40000 ? 20000 : 10000;
  const top = Math.ceil(maxV / step) * step, ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push({ v, label: v === 0 ? '0' : short(v) });
  return { bars: rows.map(b => ({ day: b.weekday.slice(0, 3), value: b.avg, pct: Math.max(2, Math.round((b.avg / top) * 100)), today: !!(W.today && W.today.weekday === b.weekday) })), ticks, top,
    projected: W.projected_month_end != null ? W.projected_month_end : null };
}

export function inventoryPanel(snap) {
  const r = raw(snap); if (!r) return null;
  const R = r.planning && r.planning.reorder, F = r.planning && r.planning.fill, d = r.deck && r.deck.inv, au = r.deck && r.deck.audit, inv = r.briefing && r.briefing.inventory;
  const left = [], right = [];
  if (d) left.push({ label: 'Stock on Hand (SKUs in stock)', value: fmt(d.inStock), note: 'of ' + fmt(d.totalSkus) + ' products' });
  if (d) left.push({ label: 'Stock-Out Items', value: fmt(d.outOfStock) });
  else if (inv) left.push({ label: 'Out of stock, still selling', value: fmt(inv.out_of_stock_but_selling) });
  if (F && F.fill_rate_pct != null) left.push({ label: 'STR (Fill Rate)', value: F.fill_rate_pct + '%', tone: F.fill_rate_pct < 90 ? 'wn' : 'ok' });
  if (R && R.total_lines != null) right.push({ label: 'Reorder Suggestions', value: fmt(R.total_lines) + (d ? ' / ' + fmt(d.totalSkus) : ''), note: 'lines to buy' });
  if (R && R.est_value_at_sale_price != null) right.push({ label: 'Reorder Value', value: rs(R.est_value_at_sale_price), note: 'at sale price' });
  if (d && d.avgCoverDays != null) right.push({ label: 'Coverage (Avg.)', value: d.avgCoverDays + (R && R.cover_days_target ? ' / ' + R.cover_days_target : '') + ' days', note: R && R.cover_days_target ? 'average vs target' : 'average days of stock' });
  if (d) right.push({ label: 'Stock Value (sale price)', value: rs(d.stockValue) });
  if (d && d.notSold90.count) right.push({ label: 'Not sold in 90+ days', value: fmt(d.notSold90.count) + ' items', note: rs(d.notSold90.value) + ' of stock' });
  if (au) right.push({ label: 'Audit counting', value: au.submitted + ' / ' + au.assigned, note: au.engagements + (au.engagements === 1 ? ' open audit' : ' open audits') + (au.pct != null ? ' \u00B7 ' + au.pct + '% submitted' : '') });
  return left.length || right.length ? { left, right } : null;
}

const ledgerName = s => { const n = String(s || ''); return /^jazzcash$/i.test(n) ? 'JazzCash' : n.charAt(0).toUpperCase() + n.slice(1); };
const MONEY_ORDER = [/jazz/i, /expense/i, /petty/i, /less/i];
export function moneyPanel(snap) {
  const r = raw(snap); if (!r) return null;
  const cl = r.closing, today = cl && cl.days && cl.days[0], Mo = r.planning && r.planning.money, cr = r.briefing && r.briefing.credit;
  const left = [], right = [];
  if (today) left.push({ label: 'Closing Today', value: today.closed + ' of 3 shifts closed', note: num(today.closed) >= 3 ? 'All shifts closed' : today.missing && today.missing.length ? 'Pending: ' + today.missing.join(', ') : (3 - num(today.closed)) + (3 - num(today.closed) === 1 ? ' shift' : ' shifts') + ' still to close' });
  if (r.day) left.push({ label: 'Cash DIFF (' + r.day.date + ')', value: rsSigned(r.day.diff) });
  if (cl && Array.isArray(cl.incomplete_days)) left.push({ label: 'Days with open shifts (7d)', value: String(cl.incomplete_days.length) });
  const led = (Mo && Array.isArray(Mo.ledgers) ? Mo.ledgers : []).filter(L => num(L.month_to_date_total) > 0 || num(L.entries_this_month) > 0);
  led.sort((a, b) => { const ia = MONEY_ORDER.findIndex(re => re.test(a.ledger)), ib = MONEY_ORDER.findIndex(re => re.test(b.ledger)); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || num(b.month_to_date_total) - num(a.month_to_date_total); });
  led.slice(0, 4).forEach(L => right.push({ label: ledgerName(L.ledger) + ' (MTD)', value: rs(L.month_to_date_total) }));
  if (cr && cr.month_net_owed != null) right.push({ label: 'Staff credit owed', value: rs(cr.month_net_owed), note: (cr.staff_owing || 0) + ' staff' });
  const exc = Mo && Array.isArray(Mo.ledgers) ? Mo.ledgers.reduce((n, L) => n + (L.running_above_usual || []).length, 0) : null, dup = cr ? num(cr.possible_duplicates) : null;
  const foot = exc == null && dup == null ? '' : 'Ledger exceptions: ' + (exc || 0) + ' running above usual \u00B7 ' + (dup || 0) + ' possible duplicate' + (dup === 1 ? '' : 's');
  return left.length || right.length ? { left, right, foot, month: (Mo && Mo.month) || (r.briefing && r.briefing.month) || '' } : null;
}

export function approvalRows(approvals) {
  const list = Array.isArray(approvals) ? approvals : [];
  return list.map(a => ({ id: a.id, title: (a.preview && a.preview.title) || String(a.tool || 'Change').replace(/_/g, ' '), sub: a.risk === 'critical' ? 'Critical change' : 'Waiting for your decision' }));
}

const OK = new Set(['HEALTHY', 'CLEAR', 'NOT_MONITORED']);
export function opsStrip(snap, health) {
  const sys = (snap && snap.systems) || {}, items = [];
  const label = { SALES: 'Sales', INVENTORY: 'Inventory', STR: 'Transfers', CLOSING: 'Closing', STAFF: 'Staff', CASH: 'Cash' };
  for (const k of ['SALES', 'INVENTORY', 'STR', 'CLOSING']) if (sys[k]) { const ok = OK.has(sys[k].status); items.push({ id: k.toLowerCase(), label: label[k], text: ok ? 'Normal' : String(sys[k].status).replace(/_/g, ' ').toLowerCase(), tone: ok ? 'ok' : 'wn' }); }
  const sb = (health || []).find(x => x.id === 'supabase');
  if (sb) items.push({ id: 'db', label: 'Database', text: sb.status === 'HEALTHY' ? 'Online' : String(sb.status).toLowerCase(), tone: sb.status === 'HEALTHY' ? 'ok' : 'cr' });
  const bad = items.filter(i => i.tone !== 'ok').length;
  return { items, healthy: items.length > 0 && bad === 0, summary: !items.length ? 'Checking\u2026' : bad ? bad + ' need attention' : 'System Healthy' };
}


// ───────────── Audit tab (audit bridge ai_audit_overview + payments bridge). Missing source => null, never invented. ─────────────
const ageText = iso => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return null; const d = Math.max(0, Math.floor((Date.now() - t) / 86400000)); return d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago'; };

export function auditPanel(o) {
  if (!o || !Array.isArray(o.engagements)) return null;
  const left = [], right = [], e = o.engagements[0];
  if (e) {
    left.push({ label: 'Counting progress', value: fmt(e.submitted) + ' / ' + fmt(e.assigned), note: e.name + (e.latest_round ? ' \u00B7 round ' + e.latest_round.number + ' ' + e.latest_round.state : '') + (o.engagements.length > 1 ? ' (+' + (o.engagements.length - 1) + ' more)' : ''), tone: e.assigned && e.submitted < e.assigned ? 'wn' : 'ok' });
    left.push({ label: 'Unresolved variance items', value: fmt(e.variance_items) });
    left.push({ label: 'Shortage', value: rs(e.shortage_value), tone: num(e.shortage_value) > num(e.excess_value) ? 'wn' : null });
    left.push({ label: 'Excess', value: rs(e.excess_value) });
    right.push({ label: 'Net variance', value: rsSigned(num(e.excess_value) - num(e.shortage_value)), note: 'excess minus shortage' });
  } else left.push({ label: 'Open audits', value: '0', note: 'nothing is being counted' });
  const sg = o.suggestions && o.suggestions.pending;
  right.push({ label: 'Variance edits waiting', value: fmt(sg || 0), tone: sg ? 'wn' : 'ok', note: sg ? 'need Main Auditor review' : 'none pending' });
  const bc = o.barcodes || {}, conflicts = num(bc.conflict);
  right.push({ label: 'Barcode conflicts', value: fmt(conflicts), tone: conflicts ? 'wn' : 'ok', note: fmt(num(bc.verified)) + ' verified' });
  if (o.last_final) right.push({ label: 'Last finished audit', value: ageText(o.last_final.generated_at) || '\u2014', note: o.last_final.engagement });
  const st = o.staff || {}, ex = num(st.access_expiring_7d) + num(st.access_expired);
  if (ex) right.push({ label: 'Auditor access', value: fmt(ex), tone: 'wn', note: 'expiring or expired' });
  const top = ((e && e.top_items) || []).map(t => ({ name: t.item, sub: (t.company || '') + ' \u00B7 system ' + fmt(t.system_qty) + ' \u2192 counted ' + fmt(t.counted_qty), value: rsSigned(t.value), tone: num(t.value) < 0 ? 'cr' : 'wn' }));
  return { left, right, top };
}

export function expiryPanel(o) {
  const x = o && o.expiry; if (!x) return null;
  const left = [{ label: 'Near-expiry entries', value: fmt(x.near_entries), note: fmt(x.near_qty) + ' units logged' }];
  if (x.earliest_month) left.push({ label: 'Earliest expiry', value: x.earliest_month });
  const right = [{ label: 'Within 90 days', value: fmt(x.within_90_days_entries), tone: num(x.within_90_days_entries) ? 'wn' : 'ok', note: 'entries to act on' }];
  const months = (x.by_month || []).map(m => ({ name: m.month, sub: fmt(m.entries) + (num(m.entries) === 1 ? ' entry' : ' entries'), value: fmt(m.qty) + ' units', tone: 'wn' }));
  return { left, right, months };
}

export function paymentPanel(d) {
  const rows = d && Array.isArray(d.paymentSummary) ? [...d.paymentSummary].sort((a, b) => String(b.saleDay).localeCompare(String(a.saleDay))) : null;
  if (!rows || !rows.length) return null;
  const t = rows[0], tot = num(t.totalSale), pct = v => (tot ? Math.round((num(v) / tot) * 100) + '%' : '\u2014');
  const credit = (d.creditByCustomer || []).filter(c => c.saleDay === t.saleDay);
  const week = rows.slice(0, 4), wt = week.reduce((s, r) => s + num(r.totalSale), 0);
  return {
    day: t.saleDay,
    left: [{ label: 'Total sale', value: rs(t.totalSale), note: t.saleDay }, { label: 'Cash', value: rs(t.cashSale), note: pct(t.cashSale) + ' of total' }],
    right: [{ label: 'Card', value: rs(t.cardSale), note: pct(t.cardSale) + ' of total' }, { label: 'Credit', value: rs(t.creditSale), tone: num(t.creditSale) ? 'wn' : null, note: credit.length ? credit.length + (credit.length === 1 ? ' customer' : ' customers') : 'no credit sales' }],
    days: week.map(r => ({ name: r.saleDay, sub: 'cash ' + fmt(r.cashSale) + ' \u00B7 card ' + fmt(r.cardSale) + ' \u00B7 credit ' + fmt(r.creditSale), value: rs(r.totalSale), tone: 'cy' })),
    foot: week.length > 1 ? 'Last ' + week.length + ' days: Rs ' + fmt(wt) + ' \u00B7 card ' + (wt ? Math.round(week.reduce((s, r) => s + num(r.cardSale), 0) / wt * 100) : 0) + '%' : null,
  };
}
