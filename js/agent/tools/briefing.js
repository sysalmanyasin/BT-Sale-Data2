// Cross-domain "what needs my attention today?" — deterministic checks
// (read-only). The model only turns the findings into a short summary.
import { registerTool } from '../core/tool-registry.js';
import { DAILY, MONTHLY } from '../../config.js';
import { Repository } from '../../repository.js';
import { num, rs, FULL, MON, sameMonth, parseAppDate } from './_util.js';

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
    if (gap >= 2) add('warn', 'sales', 'Latest sales entry is ' + last.d.Date + ' (' + gap + ' days ago).');
  }
  const monthDays = DAILY.filter(d => sameMonth(d.Month_Year, my));
  const have = new Set(monthDays.map(d => parseAppDate(d.Date) && parseAppDate(d.Date).getDate()));
  const missing = [];
  for (let day = 1; day < today.getDate(); day++) if (!have.has(day)) missing.push(dayStr(new Date(today.getFullYear(), today.getMonth(), day)));
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
  } else if (entered.length && today.getDate() > 1) {
    add('info', 'sales', 'Yesterday (' + dayStr(yest) + ') has no sales entry yet.');
  }

  // ── Target pace ────────────────────────────────────────────────────
  const tgt = num(targetsMap()[my]);
  const mRec = MONTHLY.find(m => sameMonth(m.Month_Year, my));
  if (!tgt) {
    add('info', 'target', 'No sales target is set for ' + my + '.');
  } else if (mRec && monthDays.length) {
    const sold = num(mRec.TOTAL);
    const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const lastDay = Math.max(...monthDays.map(d => parseAppDate(d.Date).getDate()));
    const avg = sold / monthDays.length;
    const projected = Math.round(avg * dim);
    const remainingDays = Math.max(0, dim - lastDay);
    out.target = { target: rs(tgt), sold_so_far: rs(sold), pct_done: Math.round((sold / tgt) * 1000) / 10, projected_month_end: projected, days_left: remainingDays, needed_per_day: remainingDays ? rs(Math.max(0, tgt - sold) / remainingDays) : 0 };
    if (sold >= tgt) add('good', 'target', 'Target for ' + my + ' is already achieved.');
    else if (lastDay >= 10 && projected < tgt * 0.9) add('warn', 'target', 'At the current pace ' + my + ' ends near Rs ' + projected.toLocaleString('en-PK') + ' vs target Rs ' + rs(tgt).toLocaleString('en-PK') + '. Need Rs ' + out.target.needed_per_day.toLocaleString('en-PK') + '/day for the remaining ' + remainingDays + ' day(s).');
    else if (projected < tgt * 0.9) add('info', 'target', 'Too early to project ' + my + ' (day ' + lastDay + '): at this pace it ends near Rs ' + projected.toLocaleString('en-PK') + ' vs target Rs ' + rs(tgt).toLocaleString('en-PK') + '.');
    else add('good', 'target', 'On pace for the ' + my + ' target.');
  }

  // ── Inventory ──────────────────────────────────────────────────────
  const inv = inventoryProducts();
  if (inv) {
    const list = inv.products;
    const sellingZero = list.filter(p => num(p.qty) <= 0 && num(p.netQty30Days) > 0);
    const cover = p => { const per = num(p.netQty30Days) / 30; return per > 0 ? num(p.qty) / per : null; };
    const lowCover = list.map(p => ({ p, c: cover(p) })).filter(x => x.p && num(x.p.qty) > 0 && x.c !== null && x.c <= 7).sort((a, b) => a.c - b.c);
    const cutoff = now.getTime() - 90 * 86400000;
    const slow = list.filter(p => num(p.qty) > 0 && (!p.lastSaleDate || new Date(p.lastSaleDate).getTime() < cutoff));
    const slowValue = rs(slow.reduce((s, p) => s + num(p.qty) * num(p.price), 0));
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
  description: 'The morning check: what needs the owner\'s attention today across sales entry gaps, yesterday vs average, target pace and stock (out-of-stock sellers, running out soon, dead stock). Use for "what needs my attention", "morning briefing", "anything I should know today".',
  parameters: { type: 'object', properties: {} },
  run: () => buildBriefing(new Date()),
});
