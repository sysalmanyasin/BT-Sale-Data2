// Cross-domain "what needs my attention today?" — deterministic checks
// (read-only). The model only turns the findings into a short summary.
import { registerTool } from '../core/tool-registry.js';
import { DAILY } from '../../config.js';
import { Repository } from '../../repository.js';
import { num, rs, FULL, MON, sameMonth, parseAppDate, monthSortVal } from './_util.js';
import { creditAlertMessages, findUnrolledCredit, creditNet } from '../../shared/credit-alerts.js';
import * as LedgerStore from '../../ledger-store.js';
import { notSoldStock } from '../../shared/inventory-metrics.js';

const dayStr = d => String(d.getDate()).padStart(2, '0') + '/' + MON[d.getMonth()] + '/' + d.getFullYear();
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function targetsMap() {
  try { const raw = Repository.getItem('bt_targets'); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}

function inventoryProducts() {
  try { const d = typeof window.inventoryBridgeGetFullData === 'function' ? window.inventoryBridgeGetFullData() : null; return d && Array.isArray(d.products) && d.products.length ? d : null; } catch (_) { return null; }
}

/** Pure given `now` + the app data, so it can be unit-tested. */
export function buildBriefing(now = new Date()) {
  const today = startOfDay(now);
  const my = FULL[today.getMonth()] + ' ' + today.getFullYear();
  const attention = [];
  const add = (level, area, message) => attention.push({ level, area, message });
  const out = { date: dayStr(today), month: my };

  // ── Sales entry freshness ──────────────────────────────────────────
  const entered = DAILY.map(d => ({ d, t: parseAppDate(d.Date) })).filter(x => x.t).sort((a, b) => b.t - a.t);
  if (entered.length) {
    const last = entered[0];
    const gap = Math.round((today - last.t) / 86400000);
    out.last_sales_entry = { date: last.d.Date, total_sale: rs(last.d.TOTAL), days_ago: gap };
    if (gap >= 2) { out.latest_gap_flagged = true; add('warn', 'sales', 'Latest sales entry is ' + last.d.Date + ' (' + gap + ' days ago).'); }
  }
  // Sales data not loaded yet (page just opened): say so instead of reporting every day as missing.
  const salesReady = DAILY.length > 0;
  out.sales_data_ready = salesReady;
  if (!salesReady) add('info', 'sales', 'Sales data is still loading. Findings will update in a moment.');
  const monthDays = DAILY.filter(d => sameMonth(d.Month_Year, my));
  const have = new Set(monthDays.map(d => parseAppDate(d.Date) && parseAppDate(d.Date).getDate()));
  const missing = [];
  // Yesterday is excluded here: it is already covered by 'Latest sales entry is ...' / 'Yesterday ... has no sales entry'.
  if (salesReady) for (let day = 1; day < today.getDate() - 1; day++) if (!have.has(day)) missing.push(dayStr(new Date(today.getFullYear(), today.getMonth(), day)));
  out.missing_sales_days = missing.length;
  if (missing.length) add('warn', 'sales', missing.length + ' day(s) this month have no sales entry: ' + missing.slice(0, 8).join(', ') + (missing.length > 8 ? ', …' : '') + '.');

  // ── Alert rules shared with the ntfy briefing (send-daily-ntfy-briefing) ──
  // On the LATEST entered day: cash DIFF of Rs 10,000+ and a sale 30%+ below the same weekday last week.
  if (entered.length) {
    const L0 = entered[0];
    const diffV = num(L0.d.DIFF);
    if (Math.abs(diffV) >= 10000) add('warn', 'sales', 'Cash DIFF Rs ' + rs(diffV).toLocaleString('en-PK') + ' on ' + L0.d.Date + '.');
    const wkAgo = new Date(L0.t); wkAgo.setDate(wkAgo.getDate() - 7);
    const wkRec = DAILY.find(d => d.Date === dayStr(wkAgo));
    if (wkRec && num(wkRec.TOTAL) > 0 && num(L0.d.TOTAL) < num(wkRec.TOTAL) * 0.7) {
      const p = Math.round((1 - num(L0.d.TOTAL) / num(wkRec.TOTAL)) * 100);
      add('warn', 'sales', 'Sale on ' + L0.d.Date + ' was ' + p + '% below the same weekday last week.');
      out.latest_vs_last_week_pct = -p;
    }
  }

  // ── Yesterday vs recent average ────────────────────────────────────
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const yRec = DAILY.find(d => d.Date === dayStr(yest));
  if (yRec) {
    out.yesterday = { date: yRec.Date, total_sale: rs(yRec.TOTAL), customers: rs(yRec.Customers) };
    const prior = entered.filter(x => x.t < yest).slice(0, 14).map(x => num(x.d.TOTAL)).filter(v => v > 0);
    if (prior.length >= 5) {
      const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
      const pct = Math.round(((num(yRec.TOTAL) - avg) / avg) * 100);
      out.yesterday.vs_recent_avg_pct = pct;
      if (Math.abs(pct) >= 30) add('info', 'sales', 'Yesterday was ' + Math.abs(pct) + '% ' + (pct < 0 ? 'below' : 'above') + ' the recent daily average (Rs ' + rs(avg).toLocaleString('en-PK') + ').');
    }
  } else if (salesReady && entered.length && today.getDate() > 1 && !out.latest_gap_flagged) {
    add('info', 'sales', 'Yesterday (' + dayStr(yest) + ') has no sales entry yet.');
  }

  // ── Target pace ────────────────────────────────────────────────────
  // ONE implementation: Analytics.getTargetPaceForMonth (what the Dashboard and the get_target_pace tool use).
  // This used to carry a second, slightly different calculation (average per ENTERED day × days in month,
  // days-left counted from the latest entry even if its TOTAL was 0). Both now come from the same function,
  // so the briefing, the Dashboard, get_target_pace and the AI Center can never disagree.
  // The month-end projection is the same straight-line pace the Dashboard shows: actual per day × days in month.
  const tgt = num(targetsMap()[my]);
  if (!tgt) {
    add('info', 'target', 'No sales target is set for ' + my + '.');
  } else {
    const A = typeof window !== 'undefined' ? window.Analytics : null;
    const p = A && typeof A.getTargetPaceForMonth === 'function' ? A.getTargetPaceForMonth(my, targetsMap()) : null;
    if (!p) {
      out.target = null;
      add('info', 'target', 'Target pace is not available right now (the pace calculation is not loaded).');
    } else if (monthDays.length) {
      const projected = Math.round(p.actualPerDay * p.daysInMonth);
      out.target = { target: rs(p.tgt), sold_so_far: rs(p.soFar), pct_done: Math.round((p.soFar / p.tgt) * 1000) / 10, projected_month_end: projected, days_left: p.daysLeft, needed_per_day: rs(p.neededPerDay), source: 'Analytics.getTargetPaceForMonth' };
      if (p.achieved) add('good', 'target', 'Target for ' + my + ' is already achieved.');
      else if (p.daysElapsed >= 10 && projected < p.tgt * 0.9) add('warn', 'target', 'At the current pace ' + my + ' ends near Rs ' + projected.toLocaleString('en-PK') + ' vs target Rs ' + rs(p.tgt).toLocaleString('en-PK') + '. Need Rs ' + out.target.needed_per_day.toLocaleString('en-PK') + '/day for the remaining ' + p.daysLeft + ' day(s).');
      else if (projected < p.tgt * 0.9) add('info', 'target', 'Too early to project ' + my + ' (day ' + p.daysElapsed + '): at this pace it ends near Rs ' + projected.toLocaleString('en-PK') + ' vs target Rs ' + rs(p.tgt).toLocaleString('en-PK') + '.');
      else add('good', 'target', 'On pace for the ' + my + ' target.');
    }
  }

  // ── Credit: duplicate entries + carried-over (aged) balances ───────
  // Same rules as the ntfy push (shared js/shared/credit-alerts.js), run on the latest credit month.
  try {
    const mgr = JSON.parse(Repository.getItem('BT_ManagerWork_v1') || '{}');
    const months = Object.keys((mgr && mgr.credit) || {}).filter(m => Array.isArray(mgr.credit[m])).sort((a, b) => monthSortVal(b) - monthSortVal(a));
    if (months.length) {
      const ca = creditAlertMessages(mgr.credit[months[0]]);
      const owedRows = mgr.credit[months[0]].map(creditNet);
      out.credit = { month: months[0], carried_over_total: Math.round(ca.agedTotal), possible_duplicates: ca.duplicates.length,
        month_net_owed: Math.round(owedRows.filter(v => v > 0).reduce((s, v) => s + v, 0)), staff_owing: owedRows.filter(v => v > 0).length,
        prev_month: months[1] || null, prev_month_net_owed: months[1] ? Math.round(mgr.credit[months[1]].map(creditNet).filter(v => v > 0).reduce((s, v) => s + v, 0)) : null };
      ca.duplicates.forEach(m => add('warn', 'credit', m + '.'));
      // Rollover gap: the latest month carries nothing over although the month before it closed with money owed.
      const gap = months.length > 1 ? findUnrolledCredit(mgr.credit[months[1]], mgr.credit[months[0]]) : null;
      if (gap) { out.credit.unrolled_from = months[1]; out.credit.unrolled_owed = Math.round(gap.owed);
        // Salaries are settled around the 10th-12th and the rollover follows, so before the 10th this is expected, not a problem.
        add(now.getDate() >= 10 ? 'warn' : 'info', 'credit', months[1] + ' closed with Rs ' + Math.round(gap.owed).toLocaleString('en-PK') + ' still owed by ' + gap.staff + ' staff, but ' + months[0] + ' carries nothing over. Roll the credit month forward so balances are not lost.'); }
      if (ca.aged) add('warn', 'credit', ca.aged + '.');
    }
  } catch (_) { /* credit data unreadable: skip, never break the briefing */ }

  // ── Ledgers: the same entry recorded twice in the last 7 days (in-app only) ──
  try {
    const cutoff = startOfDay(now).getTime() - 7 * 86400000;
    const dups = [];
    for (const t of LedgerStore.getAllLedgerTypes()) {
      const seen = new Map();
      for (const e of LedgerStore.getEntries(t.id)) {
        const when = new Date(String(e.date) + 'T00:00:00').getTime();
        if (!Number.isFinite(when) || when < cutoff || !num(e.amount)) continue;
        const k = [e.date, e.categoryId, num(e.amount), String(e.desc || '').trim().toLowerCase()].join('|');
        const hit = seen.get(k); if (hit) hit.n++; else seen.set(k, { n: 1, ledger: t.label || t.id, date: e.date, amount: num(e.amount) });
      }
      seen.forEach(v => { if (v.n >= 2) dups.push(v); });
    }
    if (dups.length) {
      out.possible_duplicate_ledger_entries = dups.length;
      const d = dups[0];
      add('warn', 'ledger', 'Possible duplicate ledger entry: ' + d.ledger + ' Rs ' + Math.round(d.amount).toLocaleString('en-PK') + ' on ' + d.date + ' entered ' + d.n + ' times' + (dups.length > 1 ? ' (+' + (dups.length - 1) + ' more)' : '') + '.');
    }
  } catch (_) { /* ledger store unavailable: skip */ }

  // ── Inventory ──────────────────────────────────────────────────────
  const inv = inventoryProducts();
  if (inv) {
    const list = inv.products;
    const sellingZero = list.filter(p => num(p.qty) <= 0 && num(p.netQty30Days) > 0);
    const cover = p => { const per = num(p.netQty30Days) / 30; return per > 0 ? num(p.qty) / per : null; };
    const lowCover = list.map(p => ({ p, c: cover(p) })).filter(x => x.p && num(x.p.qty) > 0 && x.c !== null && x.c <= 7).sort((a, b) => a.c - b.c);
    const ns = notSoldStock(list, 90, now.getTime()); // shared definition: one number everywhere
    const slow = ns.rows, slowValue = rs(ns.value);
    out.inventory = { out_of_stock_but_selling: sellingZero.length, running_out_within_7_days: lowCover.length, slow_moving_90d_items: slow.length, slow_moving_stock_value: slowValue,
      last_synced: (inv.lastSync && inv.lastSync.syncedAt) || null,
      most_urgent: lowCover.slice(0, 5).map(x => ({ name: x.p.name, qty: num(x.p.qty), cover_days: Math.round(x.c * 10) / 10 })) };
    if (sellingZero.length) add('warn', 'inventory', sellingZero.length + ' product(s) that sold in the last 30 days are out of stock.');
    if (lowCover.length) add('warn', 'inventory', lowCover.length + ' product(s) will run out within a week (e.g. ' + lowCover.slice(0, 3).map(x => x.p.name).join(', ') + ').');
    if (slow.length) add('info', 'inventory', slow.length + ' item(s) have not sold in 90+ days, holding about Rs ' + slowValue.toLocaleString('en-PK') + ' of stock.');
  } else {
    out.inventory = null;
    add('info', 'inventory', 'Inventory data is not loaded; open the Inventory page once for stock checks.');
  }

  const rank = { warn: 0, info: 1, good: 2 };
  attention.sort((a, b) => rank[a.level] - rank[b.level]);
  out.attention = attention;
  out.needs_action = attention.filter(a => a.level === 'warn').length;
  return out;
}

registerTool({
  name: 'daily_briefing', domain: 'app', risk: 'read',
  description: 'The morning check: what needs the owner\'s attention today across sales entry gaps, yesterday vs average, target pace, duplicate entries, carried-over staff credit and stock (out-of-stock sellers, running out soon, dead stock). Use for "what needs my attention", "morning briefing", "anything I should know today".',
  parameters: { type: 'object', properties: {} },
  run: () => buildBriefing(new Date()),
});
