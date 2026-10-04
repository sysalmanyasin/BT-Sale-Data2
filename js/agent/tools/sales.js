// Sales domain — READ tools over DAILY / MONTHLY / targets.
// All maths is done here (deterministic); the model only explains.
import { registerTool } from '../core/tool-registry.js';
import { DAILY, MONTHLY, mBanks, creditSales } from '../../config.js';
import { num, rs, normMonth, normDay, monthSortVal, currentMonthYear, clampInt, pctChange, dayOfMonth, sameMonth, parseAppDate } from './_util.js';

const targets = () => { try { return typeof window.getTgts === 'function' ? window.getTgts() : {}; } catch (_) { return {}; } };

function latestMonthYear() {
  if (!MONTHLY.length) return null;
  return MONTHLY.map(m => m.Month_Year).sort((a, b) => monthSortVal(a) - monthSortVal(b)).pop();
}
function monthRec(my) { return MONTHLY.find(m => sameMonth(m.Month_Year, my)) || null; }
function daysFor(my) { return DAILY.filter(d => sameMonth(d.Month_Year, my)); }

function summarise(rec) {
  return {
    total_sale: rs(rec.TOTAL),
    comp_sale: rs(rec['COMP SALE']),
    diff: rs(rec.DIFF),
    cash_sale: rs(rec['Cash Sale']),
    cash_returns: rs(rec['Cash Returns']),
    bank_total: rs(mBanks(rec)),
    credit_total: rs(creditSales(rec)),
    customers: rs(rec.Customers),
  };
}

function resolveMonth(arg) {
  if (!arg) return { my: latestMonthYear() };
  const my = normMonth(arg);
  return { my, bad: my ? null : 'Could not understand month "' + arg + '". Use e.g. "September 2026".' };
}

registerTool({
  name: 'list_sales_months', domain: 'sales', risk: 'read',
  description: 'List every month that has sales data with its total sale and number of days entered. Use first when unsure which months exist.',
  parameters: { type: 'object', properties: { year: { type: 'string', description: 'Optional 4-digit year filter, e.g. 2026' } } },
  run: ({ year }) => {
    const rows = MONTHLY.filter(m => !year || String(m.Month_Year).trim().endsWith(' ' + year))
      .sort((a, b) => monthSortVal(a.Month_Year) - monthSortVal(b.Month_Year))
      .map(m => ({ month: m.Month_Year, total_sale: rs(m.TOTAL), days_entered: daysFor(m.Month_Year).length }));
    return { count: rows.length, months: rows };
  },
});

registerTool({
  name: 'get_sales_summary', domain: 'sales', risk: 'read',
  description: 'Totals for one month: total sale, comparison (COMP) sale, difference, cash, bank, credit, customers, days entered, average per day, plus target and pace if a target is set. Defaults to the latest month.',
  parameters: { type: 'object', properties: { month_year: { type: 'string', description: 'e.g. "September 2026". Omit for the latest month.' } } },
  run: ({ month_year }) => {
    const { my, bad } = resolveMonth(month_year);
    if (bad) return { error: bad };
    const rec = my && monthRec(my);
    if (!rec) return { error: 'No sales data for ' + (my || 'any month'), available_latest: latestMonthYear() };
    const days = daysFor(my);
    const out = { month: rec.Month_Year, days_entered: days.length, ...summarise(rec) };
    out.avg_per_day = days.length ? rs(num(rec.TOTAL) / days.length) : 0;
    const myKey = rec.Month_Year;
    const tgt = num(targets()[myKey]);
    if (tgt) {
      out.target = rs(tgt);
      const A = window.Analytics;
      const pace = A && typeof A.getTargetPaceForMonth === 'function' ? A.getTargetPaceForMonth(myKey, targets()) : null;
      if (pace) Object.assign(out, {
        target_pct_done: pace.pct, remaining_to_target: rs(pace.remaining), days_left: pace.daysLeft,
        needed_per_day: rs(pace.neededPerDay), ideal_per_day: rs(pace.idealPerDay), actual_per_day: rs(pace.actualPerDay),
        pace_ratio: Math.round(pace.paceRatio * 100) / 100, achieved: pace.achieved,
      });
    }
    return out;
  },
});

registerTool({
  name: 'get_daily_sales', domain: 'sales', risk: 'read',
  description: 'Daily sales. Give `date` (today, yesterday, 05/Sep/2026 or 2026-09-05) for one day, or `month_year` for the days of a month (latest month by default). Returns each day with total, COMP sale, diff, cash, bank and credit.',
  parameters: { type: 'object', properties: {
    date: { type: 'string' }, month_year: { type: 'string' },
    limit: { type: 'integer', description: 'max days to return, default 31' },
  } },
  run: ({ date, month_year, limit }) => {
    const row = d => ({ date: d.Date, ...summarise(d) });
    if (date) {
      const nd = normDay(date);
      if (!nd) return { error: 'Could not understand date "' + date + '"' };
      const d = DAILY.find(x => x.Date === nd);
      return d ? row(d) : { error: 'No entry for ' + nd };
    }
    const { my, bad } = resolveMonth(month_year);
    if (bad) return { error: bad };
    const days = daysFor(my).slice().sort((a, b) => dayOfMonth(a.Date) - dayOfMonth(b.Date)).slice(0, clampInt(limit, 1, 62, 31));
    return { month: my, count: days.length, days: days.map(row) };
  },
});

registerTool({
  name: 'top_sales_days', domain: 'sales', risk: 'read',
  description: 'Highest or lowest sale days. Scope by `year` (e.g. "2022") OR `month_year` (e.g. "September 2026"); month_year "all" = every year. Defaults to the latest month.',
  parameters: { type: 'object', properties: {
    year: { type: 'string', description: '4-digit year, e.g. 2022' },
    month_year: { type: 'string', description: 'e.g. "September 2026", or "all"' },
    order: { type: 'string', enum: ['highest', 'lowest'] },
    count: { type: 'integer', description: 'default 5, max 15' },
  } },
  run: ({ year, month_year, order, count }) => {
    let pool, scope;
    if (year) {
      if (!/^\d{4}$/.test(String(year).trim())) return { error: 'year must be 4 digits, e.g. 2022' };
      const y = Number(year);
      pool = DAILY.filter(d => { const t = parseAppDate(d.Date); return t && t.getFullYear() === y; });
      scope = String(y);
      if (!pool.length) return { error: 'No daily sales data for ' + y };
    } else if (String(month_year || '').toLowerCase() === 'all') { pool = DAILY; scope = 'all years'; }
    else { const { my, bad } = resolveMonth(month_year); if (bad) return { error: bad }; pool = daysFor(my); scope = my; }
    const sorted = pool.filter(d => num(d.TOTAL) > 0).slice().sort((a, b) => num(b.TOTAL) - num(a.TOTAL));
    const pick = (order === 'lowest' ? sorted.reverse() : sorted).slice(0, clampInt(count, 1, 15, 5));
    return { scope, order: order || 'highest', days_considered: sorted.length, days: pick.map(d => ({ date: d.Date, total_sale: rs(d.TOTAL) })) };
  },
});

registerTool({
  name: 'compare_sales_months', domain: 'sales', risk: 'read',
  description: 'Compare two months (total, cash, bank, credit, customers, average per day) with absolute and percent change. For a fair comparison of a part-month, set same_days_only to compare only the days both months have entered.',
  parameters: { type: 'object', required: ['month_a', 'month_b'], properties: {
    month_a: { type: 'string', description: 'e.g. "September 2026"' }, month_b: { type: 'string', description: 'month to compare against' },
    same_days_only: { type: 'boolean' },
  } },
  run: ({ month_a, month_b, same_days_only }) => {
    const a = normMonth(month_a), b = normMonth(month_b);
    if (!a || !b) return { error: 'Use month names like "September 2026"' };
    if (!monthRec(a) || !monthRec(b)) return { error: 'No data for ' + (!monthRec(a) ? a : b) };
    let da = daysFor(a), db = daysFor(b);
    let note = null;
    if (same_days_only) {
      const cut = Math.min(Math.max(0, ...da.map(d => dayOfMonth(d.Date))), Math.max(0, ...db.map(d => dayOfMonth(d.Date))));
      da = da.filter(d => dayOfMonth(d.Date) <= cut); db = db.filter(d => dayOfMonth(d.Date) <= cut);
      note = 'Compared days 1–' + cut + ' of both months.';
    }
    const agg = ds => ({
      days: ds.length, total_sale: rs(ds.reduce((s, d) => s + num(d.TOTAL), 0)),
      cash_sale: rs(ds.reduce((s, d) => s + num(d['Cash Sale']), 0)),
      bank_total: rs(ds.reduce((s, d) => s + mBanks(d), 0)),
      credit_total: rs(ds.reduce((s, d) => s + creditSales(d), 0)),
      customers: rs(ds.reduce((s, d) => s + num(d.Customers), 0)),
    });
    const A = agg(da), B = agg(db);
    A.avg_per_day = A.days ? Math.round(A.total_sale / A.days) : 0;
    B.avg_per_day = B.days ? Math.round(B.total_sale / B.days) : 0;
    const delta = {};
    ['total_sale', 'cash_sale', 'bank_total', 'credit_total', 'customers', 'avg_per_day'].forEach(k => {
      delta[k] = { change: A[k] - B[k], pct: pctChange(A[k], B[k]) };
    });
    return { [a]: A, [b]: B, difference_a_minus_b: delta, note };
  },
});

registerTool({
  name: 'get_target_pace', domain: 'sales', risk: 'read',
  description: 'Sales target progress for a month: target, sold so far, remaining, days left, needed per day and whether pace is on track. Defaults to the current/latest month.',
  parameters: { type: 'object', properties: { month_year: { type: 'string' } } },
  run: ({ month_year }) => {
    const { my, bad } = resolveMonth(month_year || currentMonthYear());
    if (bad) return { error: bad };
    const tgt = num(targets()[my]);
    if (!tgt) return { error: 'No target set for ' + my, months_with_targets: Object.keys(targets()).slice(-6) };
    const A = window.Analytics;
    const p = A && typeof A.getTargetPaceForMonth === 'function' ? A.getTargetPaceForMonth(my, targets()) : null;
    if (!p) return { error: 'Pace calculation unavailable right now' };
    return {
      month: my, target: rs(p.tgt), sold_so_far: rs(p.soFar), pct_done: p.pct, remaining: rs(p.remaining),
      days_elapsed: p.daysElapsed, days_left: p.daysLeft, needed_per_day: rs(p.neededPerDay),
      ideal_per_day: rs(p.idealPerDay), actual_per_day: rs(p.actualPerDay),
      on_track: p.achieved || p.paceRatio >= 1, pace_ratio: Math.round(p.paceRatio * 100) / 100,
    };
  },
});

registerTool({
  name: 'get_year_overview', domain: 'sales', risk: 'read',
  description: 'Month-by-month total sales for a year with the best and worst month and the year total.',
  parameters: { type: 'object', required: ['year'], properties: { year: { type: 'string', description: '4-digit year' } } },
  run: ({ year }) => {
    const rows = MONTHLY.filter(m => String(m.Month_Year).trim().endsWith(' ' + year))
      .sort((a, b) => monthSortVal(a.Month_Year) - monthSortVal(b.Month_Year))
      .map(m => ({ month: m.Month_Year, total_sale: rs(m.TOTAL) }));
    if (!rows.length) return { error: 'No data for year ' + year };
    const by = rows.slice().sort((a, b) => b.total_sale - a.total_sale);
    return { year, months: rows, year_total: rows.reduce((s, r) => s + r.total_sale, 0), best: by[0], worst: by[by.length - 1] };
  },
});

