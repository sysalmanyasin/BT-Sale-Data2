// ══════════════════════════════════════════════════════════════════════
// PLANNING METRICS — pure functions, no DOM / window / fetch.
// Used by the BT Assistant tools (weekday_forecast, reorder_draft, str_fill_rate,
// money_overview) and the AI Center cards. Every number the assistant quotes for these
// questions comes from here, so it can be unit-tested and never drifts from the screen.
// ══════════════════════════════════════════════════════════════════════
const n = v => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const r0 = v => Math.round(v);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "05/Sep/2026" → local-midnight Date, or null. */
export function parseDailyDate(s) {
  const [d, m, y] = String(s || '').split('/');
  const i = MON.findIndex(x => x.toLowerCase() === String(m || '').toLowerCase());
  if (i < 0 || !+d || !+y) return null;
  return new Date(+y, i, +d);
}

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };

// ───────────────────────── weekday-aware forecast ─────────────────────────
/**
 * Month-end projection built from how each WEEKDAY actually sells (last `weeks` same weekdays),
 * instead of "average per day × days in month". A Friday-heavy or Sunday-light month is projected correctly.
 *
 * @param {{daily:Array<{Date:string,TOTAL:any}>, now?:Date, target?:number, weeks?:number}} o
 * `daily` rows use the app's shape (Date = "dd/Mon/yyyy", TOTAL = official sale). Days with no/zero TOTAL are
 * treated as "not entered yet", never as a zero-sale day.
 */
export function weekdayForecast({ daily, now = new Date(), target = 0, weeks = 8 } = {}) {
  const today = startOfDay(now), y = today.getFullYear(), m = today.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  const rows = (Array.isArray(daily) ? daily : []).map(d => ({ dt: parseDailyDate(d.Date), total: n(d.TOTAL) })).filter(x => x.dt && x.total > 0);
  const byDow = Array.from({ length: 7 }, () => []);
  rows.filter(x => x.dt < today).sort((a, b) => a.dt - b.dt).forEach(x => byDow[x.dt.getDay()].push(x.total));
  const base = byDow.map((vals, dow) => {
    const last = vals.slice(-Math.max(1, weeks));
    const avg = mean(last), s = sd(last);
    return { dow, weekday: DOW[dow], avg: r0(avg), sd: r0(s), samples: last.length, low: r0(Math.max(0, avg - s)), high: r0(avg + s) };
  });

  const monthRows = rows.filter(x => x.dt.getFullYear() === y && x.dt.getMonth() === m);
  const soFar = monthRows.reduce((s, x) => s + x.total, 0);
  const enteredDays = new Set(monthRows.map(x => x.dt.getDate()));
  const todayEntered = enteredDays.has(today.getDate());
  const remaining = [];
  for (let d = today.getDate(); d <= dim; d++) {
    if (enteredDays.has(d)) continue;
    const dt = new Date(y, m, d), b = base[dt.getDay()];
    remaining.push({ date: iso(dt), weekday: b.weekday, expected: b.avg, samples: b.samples });
  }
  let missingPast = 0;
  for (let d = 1; d < today.getDate(); d++) if (!enteredDays.has(d)) missingPast++;
  const expectedRest = remaining.reduce((s, x) => s + x.expected, 0);
  const varRest = remaining.reduce((s, x) => s + Math.pow(base[new Date(x.date + 'T00:00:00').getDay()].sd, 2), 0);
  const band = Math.sqrt(varRest);
  const projected = soFar + expectedRest;
  const out = {
    month: FULL[m] + ' ' + y, as_of: iso(today), days_in_month: dim, days_entered: enteredDays.size,
    sold_so_far: r0(soFar), remaining_days: remaining.length, missing_past_days: missingPast,
    projected_month_end: r0(projected), projected_low: r0(Math.max(soFar, projected - band)), projected_high: r0(projected + band),
    weekday_baseline: base.filter(b => b.samples).map(({ weekday, avg, samples, low, high }) => ({ weekday, avg, samples, typical_low: low, typical_high: high })),
    remaining: remaining.slice(0, 31),
    today: { date: iso(today), weekday: DOW[today.getDay()], entered: todayEntered, expected: base[today.getDay()].avg, typical_low: base[today.getDay()].low, typical_high: base[today.getDay()].high, samples: base[today.getDay()].samples },
    method: 'Average of the last ' + weeks + ' same weekdays, summed over the days still to come. Range = ±1 standard deviation of those days combined.',
  };
  if (target > 0) {
    const left = Math.max(0, target - soFar);
    out.target = r0(target);
    out.vs_target = {
      pct_of_target_projected: Math.round(projected / target * 100), gap_at_projection: r0(projected - target),
      needed_per_remaining_day: remaining.length ? r0(left / remaining.length) : 0,
      expected_per_remaining_day: remaining.length ? r0(expectedRest / remaining.length) : 0,
      on_track: projected >= target, could_reach_in_best_case: out.projected_high >= target,
    };
  }
  return out;
}

// ───────────────────────── reorder draft v2 ─────────────────────────
const W = [[30, 0.5], [60, 0.3], [90, 0.2]];
/**
 * Draft purchase list from sales velocity, current stock and stock already on its way (inbound STRs).
 * Velocity blends the 30/60/90-day windows (50/30/20) so one spike does not drive a big order.
 * Grouped by supplier. Out-of-stock sellers come first, ranked by sales lost per day.
 * Nothing is written anywhere; it is a recommendation.
 */
export function reorderDraft({ products, inTransitByCode = {}, coverDays = 19, limit = 80 } = {}) {
  const cover = Math.max(1, Math.min(120, n(coverDays) || 19));
  const items = [];
  for (const p of Array.isArray(products) ? products : []) {
    let wsum = 0, daily = 0;
    for (const [w, wt] of W) {
      const raw = p['netQty' + w + 'Days'];
      if (raw === undefined || raw === null) continue;
      daily += (n(raw) / w) * wt; wsum += wt;
    }
    daily = wsum ? daily / wsum : 0;
    if (!(daily > 0)) continue;
    const qty = n(p.qty), transit = Math.max(0, n(inTransitByCode[p.code] || 0));
    const need = Math.ceil(daily * cover - qty - transit);
    if (need <= 0) continue;
    const price = n(p.price), d30 = n(p.netQty30Days) / 30, d90 = n(p.netQty90Days) / 90;
    const coverNow = qty > 0 ? qty / daily : 0;
    items.push({
      code: p.code || '', name: p.name, supplier: (p.supplier && String(p.supplier).trim()) || 'Unassigned Supplier',
      stock: qty, in_transit: transit, daily_rate: Math.round(daily * 100) / 100, cover_days: Math.round(coverNow * 10) / 10,
      suggested_qty: need, est_value_at_sale_price: r0(need * price),
      status: qty <= 0 ? 'out_of_stock' : coverNow <= 7 ? 'low' : 'reorder',
      lost_sales_per_day: qty <= 0 ? r0(daily * price) : 0,
      trend: d90 > 0 ? (d30 > d90 * 1.25 ? 'rising' : d30 < d90 * 0.75 ? 'falling' : 'steady') : 'new',
    });
  }
  const rank = { out_of_stock: 0, low: 1, reorder: 2 };
  items.sort((a, b) => rank[a.status] - rank[b.status] || b.lost_sales_per_day - a.lost_sales_per_day || a.cover_days - b.cover_days);
  const shown = items.slice(0, Math.max(1, Math.min(300, limit)));
  const bySup = new Map();
  shown.forEach(i => { if (!bySup.has(i.supplier)) bySup.set(i.supplier, []); bySup.get(i.supplier).push(i); });
  const groups = Array.from(bySup, ([supplier, list]) => ({
    supplier, lines: list.length, urgent_lines: list.filter(i => i.status !== 'reorder').length,
    est_value_at_sale_price: list.reduce((s, i) => s + i.est_value_at_sale_price, 0), items: list,
  })).sort((a, b) => b.urgent_lines - a.urgent_lines || b.est_value_at_sale_price - a.est_value_at_sale_price);
  return {
    cover_days_target: cover, total_lines: items.length, shown: shown.length,
    out_of_stock_selling: items.filter(i => i.status === 'out_of_stock').length, low_cover: items.filter(i => i.status === 'low').length,
    lost_sales_per_day: items.reduce((s, i) => s + i.lost_sales_per_day, 0),
    est_value_at_sale_price: items.reduce((s, i) => s + i.est_value_at_sale_price, 0),
    groups,
    method: 'Daily rate = 50% of 30-day + 30% of 60-day + 20% of 90-day sales. Suggested = rate × ' + cover + ' days − stock − stock in transit (inbound STRs). Value is at sale price.',
  };
}

/** Plain text of a reorder draft, for copy / print / WhatsApp. */
export function reorderDraftText(draft, title = 'Reorder draft') {
  const lines = [title + ' — ' + draft.total_lines + ' lines, cover ' + draft.cover_days_target + ' days'];
  for (const g of draft.groups) {
    lines.push('', g.supplier + ' (' + g.lines + ' lines)');
    g.items.forEach(i => lines.push('  ' + i.name + ' — buy ' + i.suggested_qty + (i.status === 'out_of_stock' ? ' [OUT]' : i.status === 'low' ? ' [LOW]' : '') + (i.in_transit ? ' (in transit ' + i.in_transit + ')' : '')));
  }
  return lines.join('\n');
}

// ───────────────────────── STR fill rate ─────────────────────────
/**
 * Fill rate of stock transfers INTO Bahria Town: how much of what was requested was actually dispatched, and how
 * much of what was dispatched was actually received.
 *  headers  : STR headers ({strId, strNumber, strDate, direction, dispatchBranch, dispatchStatus, receiveStatus})
 *  rowsByStr: Map|object  strId → line rows with PACK quantities {productCode, productName, packStrQty, packDispatchQty, packReceiveQty}
 * Only STRs already dispatched or received count toward fill (an awaited STR has nothing dispatched yet; it is
 * reported separately as "awaiting dispatch").
 */
export function strFillRate({ headers, rowsByStr, now = new Date(), days = 7 } = {}) {
  const get = id => (rowsByStr instanceof Map ? rowsByStr.get(id) : rowsByStr && rowsByStr[id]) || [];
  const cutoff = startOfDay(now).getTime() - Math.max(1, days) * 86400000;
  const hs = (Array.isArray(headers) ? headers : []).filter(h => h.direction === 'in' && (!Date.parse(h.strDate) || Date.parse(h.strDate) >= cutoff));
  const total = { strs: 0, lines: 0, requested: 0, dispatched: 0, zero_lines: 0, short_lines: 0, full_lines: 0, recv_dispatched: 0, recv_received: 0, recv_short_lines: 0 };
  const bySource = new Map(), byProduct = new Map();
  const awaiting = { count: 0, oldest_age_days: null };
  for (const h of hs) {
    const dispatched = h.dispatchStatus === 'Dispatched' || h.receiveStatus === 'Received';
    if (!dispatched) {
      awaiting.count++;
      const t = Date.parse(h.strDate);
      if (Number.isFinite(t)) { const a = Math.max(0, Math.floor((startOfDay(now).getTime() - t) / 86400000)); awaiting.oldest_age_days = awaiting.oldest_age_days == null ? a : Math.max(awaiting.oldest_age_days, a); }
      continue;
    }
    const src = h.dispatchBranch || 'Unknown';
    if (!bySource.has(src)) bySource.set(src, { source: src, strs: 0, lines: 0, requested: 0, dispatched: 0, zero_lines: 0, short_lines: 0 });
    const S = bySource.get(src); S.strs++; total.strs++;
    for (const li of get(h.strId)) {
      const req = n(li.packStrQty);
      if (!(req > 0)) continue;
      const disp = li.packDispatchQty == null ? 0 : n(li.packDispatchQty);
      total.lines++; S.lines++; total.requested += req; S.requested += req; total.dispatched += Math.min(disp, req); S.dispatched += Math.min(disp, req);
      if (disp === 0) { total.zero_lines++; S.zero_lines++; } else if (disp < req) { total.short_lines++; S.short_lines++; } else total.full_lines++;
      if (disp < req) {
        const k = li.productCode || li.productName;
        const P = byProduct.get(k) || { code: li.productCode || '', name: li.productName || k, source: src, times_short: 0, packs_short: 0, packs_requested: 0 };
        P.times_short++; P.packs_short += req - disp; P.packs_requested += req; byProduct.set(k, P);
      }
      if (li.packReceiveQty != null && li.packDispatchQty != null) {
        total.recv_dispatched += n(li.packDispatchQty); total.recv_received += Math.min(n(li.packReceiveQty), n(li.packDispatchQty));
        if (n(li.packReceiveQty) < n(li.packDispatchQty)) total.recv_short_lines++;
      }
    }
  }
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
  return {
    window_days: days, strs_counted: total.strs, lines: total.lines,
    fill_rate_pct: pct(total.dispatched, total.requested), line_fill_pct: pct(total.full_lines, total.lines),
    zero_dispatch_lines: total.zero_lines, short_lines: total.short_lines,
    receipt_accuracy_pct: pct(total.recv_received, total.recv_dispatched), received_short_lines: total.recv_short_lines,
    awaiting_dispatch: awaiting,
    by_source: Array.from(bySource.values()).map(s => ({ ...s, fill_rate_pct: pct(s.dispatched, s.requested) }))
      .sort((a, b) => (a.fill_rate_pct ?? 101) - (b.fill_rate_pct ?? 101)),
    worst_products: Array.from(byProduct.values()).sort((a, b) => b.packs_short - a.packs_short).slice(0, 10),
    note: 'Based on the STR window the app keeps (rolling 7 days). Fill = dispatched ÷ requested (packs). Receipt accuracy = received ÷ dispatched.',
  };
}

// ───────────────────────── ledger category spikes ─────────────────────────
/**
 * Flag categories whose month-to-date total is well above the same day-range of earlier months.
 * @param {Record<string, number>} cur       category → month-to-date total
 * @param {Array<Record<string, number>>} prev  earlier months, each category → total over the SAME day-range
 */
export function categorySpikes(cur, prev, { ratio = 1.5, minDelta = 5000 } = {}) {
  const months = (Array.isArray(prev) ? prev : []).filter(Boolean);
  const out = [];
  for (const [cat, amt] of Object.entries(cur || {})) {
    const base = months.length ? mean(months.map(m => n(m[cat]))) : 0;
    if (amt - base >= minDelta && (base === 0 || amt >= base * ratio)) out.push({ category: cat, month_to_date: r0(amt), usual_same_period: r0(base), extra: r0(amt - base), times_usual: base > 0 ? Math.round(amt / base * 10) / 10 : null });
  }
  return out.sort((a, b) => b.extra - a.extra);
}

/**
 * Packs on their way to Bahria Town per product code: inbound STRs that are dispatched but not yet received.
 * Same rule as the Reorder Report's In Transit column (js/reorder-report.js buildInTransitMap).
 */
export function inTransitByCode(data) {
  const map = {};
  if (!data || !Array.isArray(data.headers) || !Array.isArray(data.lineItems)) return map;
  const ids = new Set(data.headers.filter(h => h.direction === 'in' && h.dispatchStatus === 'Dispatched' && h.receiveStatus !== 'Received').map(h => h.strId));
  data.lineItems.forEach(li => {
    if (!li.productCode || !ids.has(li.strId)) return;
    const f = Number(data.packFactorByCode && data.packFactorByCode[li.productCode]);
    const factor = f > 0 && Number.isFinite(f) ? f : 1;
    map[li.productCode] = (map[li.productCode] || 0) + Math.floor((Number(li.dispatchQty) || 0) / factor);
  });
  return map;
}
