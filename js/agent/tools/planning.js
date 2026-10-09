// Planning domain — READ tools that answer "what will happen / what should I do":
//   weekday_forecast  (sales)      month-end + today, built from each weekday's own history
//   reorder_draft     (inventory)  supplier-grouped buy list, net of stock already in transit
//   str_fill_rate     (str)        how much of what we request on STRs is dispatched / received
//   money_overview    (manager)    staff credit + ledger/petty-cash categories vs the same period of earlier months
// All maths lives in js/shared/planning-metrics.js (pure, unit-tested). Nothing here writes anything.
import { registerTool } from '../core/tool-registry.js';
import { Repository } from '../../repository.js';
import * as LedgerStore from '../../ledger-store.js';
import { DAILY } from '../../config.js';
import { groupedLineItems } from '../../str-shared.js';
import { creditNet } from '../../shared/credit-alerts.js';
import { weekdayForecast, reorderDraft, strFillRate, categorySpikes, inTransitByCode } from '../../shared/planning-metrics.js';
import { num, rs, clampInt, FULL } from './_util.js';

const targets = () => { try { const v = JSON.parse(Repository.getItem('bt_targets') || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } };

registerTool({
  name: 'weekday_forecast', domain: 'sales', risk: 'read',
  description: 'Forecast for the month and for TODAY that respects weekdays: each remaining day is expected at that weekday\'s recent average (e.g. a Friday sells differently from a Sunday). Returns projected month-end with a typical range, gap to target, needed vs expected per remaining day, today\'s expected sale (with typical range) and the weekday averages. Use for "will I hit target?", "what will today/Friday sell?", "forecast".',
  parameters: { type: 'object', properties: { weeks: { type: 'integer', description: 'how many recent same-weekdays to average, default 8 (4-16)' } } },
  run: ({ weeks }) => {
    const now = new Date(), my = FULL[now.getMonth()] + ' ' + now.getFullYear();
    return weekdayForecast({ daily: DAILY, now, target: num(targets()[my]), weeks: clampInt(weeks, 4, 16, 8) });
  },
});

function products() {
  const d = typeof window.inventoryBridgeGetFullData === 'function' ? window.inventoryBridgeGetFullData() : null;
  if (!d || !Array.isArray(d.products) || !d.products.length) throw new Error('Inventory data is not loaded yet. Open the Inventory page once, then ask again.');
  return d;
}
const strData = () => (typeof window.strBridgeGetFullData === 'function' ? window.strBridgeGetFullData() : null);

registerTool({
  name: 'reorder_draft', domain: 'inventory', risk: 'read',
  description: 'Draft buy list grouped by supplier. Blends 30/60/90-day sales, subtracts stock already in transit on inbound STRs, puts out-of-stock sellers first (with sales lost per day). Recommendation only, nothing is ordered or changed. Optional supplier filter and cover_days (default 19).',
  parameters: { type: 'object', properties: {
    cover_days: { type: 'integer', description: 'days of stock to buy up to, default 19' },
    supplier: { type: 'string', description: 'only this supplier (part of the name)' },
    limit: { type: 'integer', description: 'max lines, default 40, max 150' },
  } },
  run: ({ cover_days, supplier, limit }) => {
    const d = products();
    let list = d.products;
    const q = String(supplier || '').trim().toLowerCase();
    if (q) list = list.filter(p => String(p.supplier || '').toLowerCase().includes(q));
    const draft = reorderDraft({ products: list, inTransitByCode: inTransitByCode(strData()), coverDays: clampInt(cover_days, 1, 90, 19), limit: clampInt(limit, 1, 150, 40) });
    return { ...draft, inventory_last_synced: (d.lastSync && d.lastSync.syncedAt) || null, str_data_loaded: !!strData() };
  },
});

registerTool({
  name: 'str_fill_rate', domain: 'str', risk: 'read',
  description: 'Fill rate of stock transfers INTO Bahria Town over the STR window the app holds: dispatched ÷ requested (packs), receipt accuracy (received ÷ dispatched), zero-dispatch and short lines, a breakdown by source warehouse (worst first), the most-short products and how many STRs still await dispatch.',
  parameters: { type: 'object', properties: { days: { type: 'integer', description: 'look-back days, default 7 (the app keeps a rolling 7 days)' } } },
  run: ({ days }) => {
    const d = strData();
    if (!d || !Array.isArray(d.headers)) throw new Error('STR data is not loaded yet. Open the STR page once, then ask again.');
    const rowsByStr = new Map();
    d.headers.filter(h => h.direction === 'in').forEach(h => rowsByStr.set(h.strId, groupedLineItems(d, h.strId).flatMap(g => g.rows)));
    return strFillRate({ headers: d.headers, rowsByStr, now: new Date(), days: clampInt(days, 1, 90, 7) });
  },
});

// ── money_overview ───────────────────────────────────────────────────
const pad = v => String(v).padStart(2, '0');
function monthTotals(ledgerId, y, m0, upToDay) {
  const prefix = y + '-' + pad(m0 + 1), by = {};
  for (const e of LedgerStore.getEntries(ledgerId)) {
    const dt = String(e.date || '');
    if (!dt.startsWith(prefix) || +dt.slice(8, 10) > upToDay) continue;
    by[e.categoryId] = (by[e.categoryId] || 0) + num(e.amount);
  }
  return by;
}
registerTool({
  name: 'money_overview', domain: 'manager', risk: 'read', sensitive: true,
  description: 'Latest-month money picture: staff credit owed (this month vs last, top balances) and, for every ledger (petty cash, Jazz Cash, custom sections), the month-to-date total per category compared with the SAME day-range of the previous 3 months, flagging categories running well above usual.',
  parameters: { type: 'object', properties: {} },
  run: () => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
    const prev = k => { const d = new Date(y, m - k, 1); return [d.getFullYear(), d.getMonth()]; };
    const out = { month: FULL[m] + ' ' + y, through_day: day, ledgers: [], staff_credit: null };
    try {
      const mgr = JSON.parse(Repository.getItem('BT_ManagerWork_v1') || '{}'), credit = (mgr && mgr.credit) || {};
      const label = (yy, mm) => FULL[mm] + ' ' + yy;
      const sum = rows => (Array.isArray(rows) ? rows : []).map(r => ({ name: String(r.name || '').trim(), net: Math.round(creditNet(r)) })).filter(x => x.net > 0).sort((a, b) => b.net - a.net);
      const [py, pm] = prev(1);
      const cur = sum(credit[label(y, m)]), last = sum(credit[label(py, pm)]);
      out.staff_credit = {
        this_month: { month: label(y, m), total_owed: cur.reduce((s, x) => s + x.net, 0), people: cur.length, top: cur.slice(0, 5) },
        last_month: { month: label(py, pm), total_owed: last.reduce((s, x) => s + x.net, 0), people: last.length, top: last.slice(0, 5) },
      };
    } catch (_) { out.staff_credit = null; }
    for (const t of LedgerStore.getAllLedgerTypes()) {
      try {
        const cur = monthTotals(t.id, y, m, 31);
        const history = [1, 2, 3].map(k => { const [yy, mm] = prev(k); return monthTotals(t.id, yy, mm, day); });
        const fullMonths = [1, 2, 3].map(k => { const [yy, mm] = prev(k); return monthTotals(t.id, yy, mm, 31); });
        const spikes = categorySpikes(cur, history, { fullMonths });
        const lab = id => { const c = LedgerStore.getCategory(t.id, id); return (c && c.label) || id; };
        out.ledgers.push({
          ledger: t.label || t.id, month_to_date_total: rs(Object.values(cur).reduce((s, v) => s + v, 0)),
          categories: Object.entries(cur).map(([id, v]) => ({ category: lab(id), amount: rs(v) })).sort((a, b) => b.amount - a.amount).slice(0, 8),
          running_above_usual: spikes.map(s => ({ ...s, category: lab(s.category) })).slice(0, 5),
        });
      } catch (_) { /* a broken ledger must not break the overview */ }
    }
    out.note = 'Spikes compare month-to-date with the average of the same day-range in the previous 3 months.';
    return out;
  },
});
