// ══════════════════════════════════════════════════════════════════════
// IC HERALD — INSIGHT ENGINE  (js/herald/herald-engine.js)
//
// Computes "today's edition": a lead headline + a short list per desk,
// pulled from every domain (Sales/Manager/Closing/Inventory/Audit).
// Pure computation only — no DOM here, same Floor 3 split analytics.js
// and shared/summary-calc.js already use. herald-page.js (Floor 5) is
// the only thing that turns this into HTML.
//
// Reuses rather than re-derives wherever a real source already exists:
//   Analytics.computeInsightCandidates()/getDashboardKPIs()  — Sales
//   aimRulesCheckAll()                                       — Sales/Manager/Inventory
//   _crdData/_crdNet, _salRows/_salNet, _pettyTotalForMonth  — Manager
//   ClosingBridge / AuditBridge / InventoryBridge            — Closing/Audit/Inventory
//   computeInventoryBuckets() (shared/summary-calc.js)       — Inventory
// New computation here is limited to: streaks/records, the Cash-to-
// Deposit reconciliation (mirrors cash-deposit-report.js's own
// documented formula), the Closing credit-ledger trend (mirrors
// closing-native.js's clBuildSnapshot()), and the scoring engine itself.
//
// ── Anti-repetition ──
// One edition is "printed" per calendar day (cached in Repository under
// bt_herald_edition_cache) — re-renders within the same day (bridges
// refreshing, tab switches) reuse it rather than reshuffling headlines
// as numbers move intraday. Only building a NEW day's edition logs to
// bt_herald_shown_log (pruned to 90 days) and advances
// bt_herald_lead_desk_history (last 7 leads). Re-selection applies a
// steep novelty-decay penalty (0.35 per recent-14-day showing) plus a
// hard minimum-spacing floor for routine tiers, and phrase banks avoid
// repeating the exact wording used last time for the same insight id.
// ══════════════════════════════════════════════════════════════════════

import { MONTHLY, DAILY, n, negR, creditSales, cashSales } from '../config.js';
import { Repository } from '../repository.js';
import { Actions } from '../actions.js';
import { computeInventoryBuckets } from '../shared/summary-calc.js';
import * as ClosingBridge from '../closing-bridge.js';
import * as AuditBridge from '../audit-bridge.js';
import * as InventoryBridge from '../inventory-bridge.js';
import { aimRulesCheckAll } from '../rules-engine.js';
import { mgrMonths } from '../manager-shared.js';
import { _crdData, _crdNet } from '../manager-credit.js';
import { _salRows, _salNet } from '../manager-salary.js';
import { _pettyTotalForMonth } from '../manager-petty.js';

const MN = ['January','February','March','April','May','June','July',
            'August','September','October','November','December'];
const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_ABBR = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

const EDITION_CACHE_KEY = 'bt_herald_edition_cache';
const SHOWN_LOG_KEY     = 'bt_herald_shown_log';
const DESK_HISTORY_KEY  = 'bt_herald_lead_desk_history';
const LOG_WINDOW_DAYS      = 90;
const NOVELTY_WINDOW_DAYS  = 14;
const NOVELTY_DECAY        = 0.35;
const MIN_SPACING_DAYS     = { C: 3, B: 1, A: 0, S: 0 };
const TIER_WEIGHT          = { S: 100, A: 55, B: 28, C: 10 };

const DESK_META = {
  sales:     { label: 'Sales Desk',     icon: '📈' },
  manager:   { label: 'Manager Desk',   icon: '👔' },
  closing:   { label: 'Closing Desk',   icon: '📖' },
  inventory: { label: 'Inventory Desk', icon: '📦' },
  audit:     { label: 'Audit Desk',     icon: '🧾' },
  cross:     { label: 'Cross-Desk',     icon: '🔗' },
  milestone: { label: 'Milestone',      icon: '🏆' },
};
const DESK_ORDER = ['sales', 'manager', 'closing', 'inventory', 'audit', 'cross', 'milestone'];

// ── small helpers ────────────────────────────────────────────────────
function fmt(v) { return Math.round(Math.abs(n(v))).toLocaleString('en-PK'); }
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function currentMonthYear(d) { d = d || new Date(); return MN[d.getMonth()] + ' ' + d.getFullYear(); }
function dayOf(dateStr) { return parseInt((dateStr || '').split('/')[0], 10) || 0; }
function parseDMY(dateStr) {
  const parts = (dateStr || '').split('/');
  if (parts.length < 3) return null;
  const mi = MONTH_ABBR[parts[1]];
  if (mi === undefined) return null;
  const d = new Date(parseInt(parts[2], 10), mi, parseInt(parts[0], 10));
  return isNaN(d.getTime()) ? null : d;
}
function getTgts() {
  try { return JSON.parse(Repository.getItem('bt_targets') || '{}'); } catch (e) { return {}; }
}
function safeBuild(fn, ctx, extra) {
  try { return fn(ctx, extra) || []; } catch (e) { return []; }
}

// ── persistence ──────────────────────────────────────────────────────
function _loadLog() {
  try { return JSON.parse(Repository.getItem(SHOWN_LOG_KEY) || '[]'); } catch (e) { return []; }
}
function _pruneLog(log) {
  const cutoff = Date.now() - LOG_WINDOW_DAYS * 86400000;
  return (Array.isArray(log) ? log : []).filter(e => e && e.ts >= cutoff);
}
function _saveLog(log) {
  try { Actions.saveFeatureData(SHOWN_LOG_KEY, JSON.stringify(_pruneLog(log))); } catch (e) {}
}
function _loadDeskHistory() {
  try { const h = JSON.parse(Repository.getItem(DESK_HISTORY_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; }
}
function _saveDeskHistory(hist) {
  try { Actions.saveFeatureData(DESK_HISTORY_KEY, JSON.stringify(hist.slice(0, 7))); } catch (e) {}
}
function _timesShownWithin(log, id, days) {
  const cutoff = Date.now() - days * 86400000;
  return log.filter(e => e.id === id && e.ts >= cutoff).length;
}
function _daysSinceLastShown(log, id) {
  let last = null;
  log.forEach(e => { if (e.id === id && (last === null || e.ts > last)) last = e.ts; });
  return last === null ? Infinity : Math.floor((Date.now() - last) / 86400000);
}
function _lastVariant(log, id) {
  let idx = -1, lastTs = -1;
  log.forEach(e => { if (e.id === id && e.ts > lastTs) { lastTs = e.ts; idx = e.variant; } });
  return idx;
}
function pickPhrase(templates, avoidIdx) {
  if (!templates || !templates.length) return { text: '', idx: 0 };
  if (templates.length === 1) return { text: templates[0], idx: 0 };
  let idx = Math.floor(Math.random() * templates.length);
  if (idx === avoidIdx) idx = (idx + 1) % templates.length;
  return { text: templates[idx], idx };
}

// ════════════════════════════════════════════════════════════════════
// SALES DESK
// ════════════════════════════════════════════════════════════════════
function buildSalesCandidates(ctx) {
  const out = [];
  const M = MONTHLY, D = DAILY;
  if (!M.length || !D.length) return out;

  // Reuse Analytics' own fact computation (weekday/momSwing/bestDay/
  // avgBill/targetPace) instead of re-deriving it — same numbers
  // Dashboard already shows, just given Herald's own wording/tiers.
  let facts = [];
  try {
    if (window.Analytics && typeof window.Analytics.computeInsightCandidates === 'function') {
      facts = window.Analytics.computeInsightCandidates(ctx.tgts) || [];
    }
  } catch (e) {}

  facts.forEach(f => {
    if (f.type === 'targetPace') {
      out.push({
        id: 'sales.targetPace', desk: 'sales', tier: f.pct >= 90 ? 'A' : 'B', page: 'dashboard',
        headlineTemplates: [
          `${f.pct}% of the ${f.curMY} target reached — need ₨${fmt(f.neededPerDay)}/day for the last ${f.daysLeft} days`,
          `${f.daysLeft} days left in ${f.curMY}: ₨${fmt(f.neededPerDay)}/day needed to land on target`,
          `Target pace: ${f.pct}% there, ₨${fmt(f.neededPerDay)}/day required the rest of the month`,
        ],
        detail: `${f.curMY} target progress`,
      });
    } else if (f.type === 'weekday') {
      const dir = f.diffPct >= 0 ? 'above' : 'below';
      out.push({
        id: 'sales.weekdayPattern', desk: 'sales', tier: Math.abs(f.diffPct) >= 20 ? 'A' : 'B', page: 'dashboard',
        headlineTemplates: [
          `${Math.abs(f.diffPct)}% ${dir} the usual ${DOW_NAMES[f.dow]} — ₨${fmt(f.latestVal)} vs a ₨${fmt(f.sameDayAvg)} average`,
          `This ${DOW_NAMES[f.dow]} ran ${Math.abs(f.diffPct)}% ${dir} its typical pace`,
          `${DOW_NAMES[f.dow]} check-in: ₨${fmt(f.latestVal)}, ${Math.abs(f.diffPct)}% ${dir} average`,
        ],
        detail: `${f.latestSameDay.Date}`,
      });
    } else if (f.type === 'momSwing') {
      const dir = f.swingPct >= 0 ? 'up' : 'down';
      out.push({
        id: 'sales.momSwing', desk: 'sales', tier: Math.abs(f.swingPct) >= 15 ? 'A' : 'B', page: 'dashboard',
        headlineTemplates: [
          `${f.last.Month_Year} ${dir} ${Math.abs(f.swingPct)}% on ${f.prev.Month_Year} — ₨${fmt(f.prevT)} → ₨${fmt(f.lastT)}`,
          `Month-on-month: ${dir} ${Math.abs(f.swingPct)}% vs ${f.prev.Month_Year}`,
          `${f.last.Month_Year} is running ${dir} ${Math.abs(f.swingPct)}% on the month before`,
        ],
        detail: 'Month-on-month',
      });
    } else if (f.type === 'bestDay') {
      const dir = f.diffPct >= 0 ? 'better' : 'lower';
      out.push({
        id: 'sales.bestDay', desk: 'sales', tier: 'A', page: 'dashboard',
        headlineTemplates: [
          `Best day this month (${f.curBest.Date}) is ${Math.abs(f.diffPct)}% ${dir} than ${f.prvMon}'s best`,
          `This month's top day is ${Math.abs(f.diffPct)}% ${dir} than last month's`,
        ],
        detail: `${f.curBest.Date} — ₨${fmt(n(f.curBest.TOTAL))}`,
      });
    } else if (f.type === 'avgBill') {
      const dir = f.diffPct >= 0 ? 'up' : 'down';
      out.push({
        id: 'sales.avgBill', desk: 'sales', tier: 'B', page: 'dashboard',
        headlineTemplates: [
          `Average bill size ${dir} ${Math.abs(f.diffPct)}% this month — ₨${fmt(f.avgLast)} vs ₨${fmt(f.avgPrev)}`,
          `Basket size trend: ${dir} ${Math.abs(f.diffPct)}% on last month`,
        ],
        detail: f.last.Month_Year,
      });
    }
  });

  // YoY + forecast-vs-target, via Analytics.getDashboardKPIs()
  try {
    if (window.Analytics && typeof window.Analytics.getDashboardKPIs === 'function') {
      const k = window.Analytics.getDashboardKPIs();
      if (k && k.pYtd > 0) {
        const diffPct = Math.round((k.ytd - k.pYtd) / k.pYtd * 100);
        const dir = diffPct >= 0 ? 'ahead of' : 'behind';
        out.push({
          id: 'sales.yoy', desk: 'sales', tier: Math.abs(diffPct) >= 15 ? 'A' : 'B', page: 'dashboard',
          headlineTemplates: [
            `Year-to-date is ${Math.abs(diffPct)}% ${dir} this time last year`,
            `YTD ₨${fmt(k.ytd)} vs ₨${fmt(k.pYtd)} same point last year — ${Math.abs(diffPct)}% ${dir}`,
          ],
          detail: k.ytdVsLabel || 'Year-to-date',
        });
      }
      if (k && k.latTgt > 0 && k.isLive) {
        const gap = k.forecastTotal - k.latTgt;
        const dir = gap >= 0 ? 'clear of' : 'short of';
        out.push({
          id: 'sales.forecastVsTarget', desk: 'sales', tier: Math.abs(gap) > k.latTgt * 0.1 ? 'A' : 'B', page: 'dashboard',
          headlineTemplates: [
            `At the current daily average, ${k.lat.Month_Year} lands ₨${fmt(gap)} ${dir} target`,
            `Run-rate forecast: ₨${fmt(k.forecastTotal)}, ${dir} ₨${fmt(k.latTgt)} target by ₨${fmt(gap)}`,
          ],
          detail: `Forecast at ₨${fmt(k.dailyAvg)}/day average`,
        });
      }
    }
  } catch (e) {}

  // All-time daily / monthly records
  try {
    const filled = D.filter(d => n(d.TOTAL) > 0);
    if (filled.length >= 5) {
      const maxDay = filled.reduce((a, b) => n(b.TOTAL) > n(a.TOTAL) ? b : a, filled[0]);
      const sorted = filled.slice().sort((a, b) => (parseDMY(a.Date) || 0) - (parseDMY(b.Date) || 0));
      const mostRecent = sorted[sorted.length - 1];
      if (mostRecent && mostRecent.Date === maxDay.Date) {
        out.push({
          id: 'sales.allTimeDailyRecord', desk: 'sales', tier: 'S', page: 'dashboard',
          headlineTemplates: [`New all-time daily sales record — ₨${fmt(n(maxDay.TOTAL))} on ${maxDay.Date}`],
          detail: 'All-time high',
        });
      }
    }
  } catch (e) {}
  try {
    if (M.length >= 3) {
      const maxMonth = M.reduce((a, b) => n(b.TOTAL) > n(a.TOTAL) ? b : a, M[0]);
      const latest = M[M.length - 1];
      if (latest.Month_Year === maxMonth.Month_Year) {
        out.push({
          id: 'sales.allTimeMonthlyRecord', desk: 'sales', tier: 'S', page: 'dashboard',
          headlineTemplates: [`${latest.Month_Year} is the best month on record — ₨${fmt(n(latest.TOTAL))}`],
          detail: 'All-time monthly high',
        });
      }
    }
  } catch (e) {}

  // Rolling streak above/below the last-30-filled-days average
  try {
    const filled = D.filter(d => n(d.TOTAL) > 0).slice().sort((a, b) => (parseDMY(a.Date) || 0) - (parseDMY(b.Date) || 0));
    if (filled.length >= 10) {
      const last30 = filled.slice(-30);
      const avg30 = last30.reduce((s, d) => s + n(d.TOTAL), 0) / last30.length;
      let streak = 0, above = null;
      for (let i = filled.length - 1; i >= 0; i--) {
        const isAbove = n(filled[i].TOTAL) >= avg30;
        if (above === null) { above = isAbove; streak = 1; }
        else if (isAbove === above) streak++;
        else break;
      }
      if (streak >= 3) {
        out.push({
          id: 'sales.rollingStreak', desk: 'sales', tier: streak >= 6 ? 'A' : 'B', page: 'dashboard',
          headlineTemplates: [`${streak}-day streak ${above ? 'above' : 'below'} the 30-day average`],
          detail: `${streak}-day streak`,
        });
      }
    }
  } catch (e) {}

  // Cash-share-of-sales shift, last two months
  try {
    if (M.length >= 2) {
      const last = M[M.length - 1], prev = M[M.length - 2];
      const lastCash = cashSales(last), lastCredit = creditSales(last);
      const prevCash = cashSales(prev), prevCredit = creditSales(prev);
      const lastShare = (lastCash + lastCredit) > 0 ? lastCash / (lastCash + lastCredit) : 0;
      const prevShare = (prevCash + prevCredit) > 0 ? prevCash / (prevCash + prevCredit) : 0;
      const ptsDiff = Math.round((lastShare - prevShare) * 1000) / 10;
      if (Math.abs(ptsDiff) >= 3) {
        const dir = ptsDiff > 0 ? 'up' : 'down';
        out.push({
          id: 'sales.cashShareShift', desk: 'sales', tier: 'C', page: 'dashboard',
          headlineTemplates: [`Cash share of sales ${dir} ${Math.abs(ptsDiff)} points this month`],
          detail: last.Month_Year,
        });
      }
    }
  } catch (e) {}

  // Customer count MoM
  try {
    if (M.length >= 2) {
      const last = M[M.length - 1], prev = M[M.length - 2];
      const lc = n(last.Customers), pc = n(prev.Customers);
      if (pc > 0) {
        const diffPct = Math.round((lc - pc) / pc * 100);
        if (Math.abs(diffPct) >= 5) {
          const dir = diffPct >= 0 ? 'up' : 'down';
          out.push({
            id: 'sales.customerTrend', desk: 'sales', tier: 'B', page: 'dashboard',
            headlineTemplates: [`Customer count ${dir} ${Math.abs(diffPct)}% this month — ${fmt(lc)} vs ${fmt(pc)}`],
            detail: last.Month_Year,
          });
        }
      }
    }
  } catch (e) {}

  // Cash-to-Deposit reconciliation — same formula as cash-deposit-
  // report.js's own _cdrCompute(): Cash Sale − Cash Returns + FDPP +
  // FDPP Con, compared against the manually-typed "Cash to be
  // Deposited" field on the same row.
  try {
    const filled = D.filter(d => n(d.TOTAL) !== 0 || d['Low Sale Reason']).slice()
      .sort((a, b) => (parseDMY(a.Date) || 0) - (parseDMY(b.Date) || 0));
    const latestDay = filled[filled.length - 1];
    if (latestDay) {
      const derived = n(latestDay['Cash Sale']) + negR(latestDay['Cash Returns']) + n(latestDay['FDPP']) + n(latestDay['FDPP Con']);
      const manual = n(latestDay['Cash to be Deposited']);
      if (manual !== 0) {
        const gap = derived - manual;
        if (Math.abs(gap) >= 2000) {
          out.push({
            id: 'sales.cashDepositGap', desk: 'sales', tier: 'A', page: 'dashboard',
            headlineTemplates: [
              `₨${fmt(gap)} gap between calculated and logged Cash-to-Deposit on ${latestDay.Date}`,
              `Cash Deposit check for ${latestDay.Date}: calculated ₨${fmt(derived)} vs logged ₨${fmt(manual)}`,
            ],
            detail: `Calculated ₨${fmt(derived)} vs logged ₨${fmt(manual)}`,
          });
        }
      }
    }
  } catch (e) {}

  // Cumulative TOTAL vs COMP SALE gap (DIFF Report), via getDashboardKPIs().cumDiff
  try {
    if (window.Analytics && typeof window.Analytics.getDashboardKPIs === 'function') {
      const k = window.Analytics.getDashboardKPIs();
      if (k && Math.abs(k.cumDiff) >= 50000) {
        out.push({
          id: 'sales.cumDiff', desk: 'sales', tier: 'C', page: 'dashboard',
          headlineTemplates: [`Cumulative TOTAL vs COMP SALE gap stands at ₨${fmt(k.cumDiff)} across all recorded months`],
          detail: 'DIFF Report',
        });
      }
    }
  } catch (e) {}

  // Rule-based sales alerts (diffTolerance / paceAtRisk — rules-registrations.js)
  try {
    const fired = aimRulesCheckAll() || [];
    fired.filter(a => a.domain === 'sales').forEach((a, i) => {
      out.push({
        id: 'sales.rule.' + a.id + '.' + i, desk: 'sales', tier: a.severity === 'red' ? 'A' : 'B', page: 'dashboard',
        headlineTemplates: [String(a.msg || '').replace(/<\/?b>/g, '').replace(/^\S+\s*/, '')],
        detail: 'Rule alert',
      });
    });
  } catch (e) {}

  // Missing-entry hygiene flag
  try {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yMY = currentMonthYear(y), yDay = y.getDate();
    const hasYesterday = D.some(d => d.Month_Year === yMY && dayOf(d.Date) === yDay && n(d.TOTAL) !== 0);
    if (!hasYesterday) {
      out.push({
        id: 'sales.missingEntry', desk: 'sales', tier: 'C', page: 'daily',
        headlineTemplates: [`No Sale Data entry logged yet for yesterday`],
        detail: 'Data hygiene',
      });
    }
  } catch (e) {}

  return out;
}

// ════════════════════════════════════════════════════════════════════
// MANAGER DESK
// ════════════════════════════════════════════════════════════════════
function buildManagerCandidates() {
  const out = [];

  try {
    const months = mgrMonths();
    if (months && months.length) {
      const [curMY, prevMY] = months;
      const curEmps = _crdData(curMY) || [];
      const curTotal = curEmps.reduce((s, e) => s + _crdNet(e), 0);

      if (prevMY) {
        const prevEmps = _crdData(prevMY) || [];
        const prevTotal = prevEmps.reduce((s, e) => s + _crdNet(e), 0);
        const diff = curTotal - prevTotal;
        if (Math.abs(diff) >= 5000) {
          const dir = diff > 0 ? 'up' : 'down';
          out.push({
            id: 'manager.creditTotalTrend', desk: 'manager', tier: Math.abs(diff) >= 30000 ? 'A' : 'B', page: 'manager',
            headlineTemplates: [
              `Total staff credit outstanding ${dir} ₨${fmt(diff)} vs ${prevMY} — now ₨${fmt(curTotal)}`,
              `Staff credit balance moved ${dir} ₨${fmt(diff)} since ${prevMY}`,
            ],
            detail: curMY,
          });
        }

        const prevByName = new Map(prevEmps.map(e => [String(e.name || '').trim().toLowerCase(), e]));
        let mover = null, moverDiff = 0;
        curEmps.forEach(e => {
          const pe = prevByName.get(String(e.name || '').trim().toLowerCase());
          if (!pe) return;
          const d = _crdNet(e) - _crdNet(pe);
          if (Math.abs(d) > Math.abs(moverDiff)) { moverDiff = d; mover = e; }
        });
        if (mover && Math.abs(moverDiff) >= 5000) {
          const dir = moverDiff > 0 ? 'grew' : 'fell';
          out.push({
            id: 'manager.biggestMover', desk: 'manager', tier: 'B', page: 'manager',
            headlineTemplates: [`${mover.name}'s credit ${dir} the most this month — ₨${fmt(moverDiff)}`],
            detail: curMY,
          });
        }
      }
    }
  } catch (e) {}

  // Salary MTD vs last month
  try {
    const months = mgrMonths();
    if (months && months.length >= 2) {
      const [curMY, prevMY] = months;
      const curTotal = (_salRows(curMY) || []).reduce((s, r) => s + _salNet(r), 0);
      const prevTotal = (_salRows(prevMY) || []).reduce((s, r) => s + _salNet(r), 0);
      if (prevTotal > 0) {
        const diffPct = Math.round((curTotal - prevTotal) / prevTotal * 100);
        if (Math.abs(diffPct) >= 5) {
          const dir = diffPct >= 0 ? 'above' : 'below';
          out.push({
            id: 'manager.salaryTrend', desk: 'manager', tier: 'B', page: 'manager',
            headlineTemplates: [`Salary payout running ${Math.abs(diffPct)}% ${dir} last month — ₨${fmt(curTotal)} vs ₨${fmt(prevTotal)}`],
            detail: curMY,
          });
        }
      }
    }
  } catch (e) {}

  // Petty cash MTD vs last month
  try {
    const months = mgrMonths();
    if (months && months.length >= 2) {
      const [curMY, prevMY] = months;
      const curTotal = n(_pettyTotalForMonth(curMY));
      const prevTotal = n(_pettyTotalForMonth(prevMY));
      if (prevTotal > 0) {
        const diffPct = Math.round((curTotal - prevTotal) / prevTotal * 100);
        if (Math.abs(diffPct) >= 10) {
          const dir = diffPct >= 0 ? 'above' : 'below';
          out.push({
            id: 'manager.pettyTrend', desk: 'manager', tier: 'C', page: 'manager',
            headlineTemplates: [`Petty cash running ${Math.abs(diffPct)}% ${dir} last month's pace`],
            detail: curMY,
          });
        }
      }
    }
  } catch (e) {}

  // Rule-based manager alerts (advanceExceedsSalary / salarySwing)
  try {
    const fired = aimRulesCheckAll() || [];
    fired.filter(a => a.domain === 'manager').forEach((a, i) => {
      out.push({
        id: 'manager.rule.' + a.id + '.' + i, desk: 'manager', tier: a.severity === 'red' ? 'A' : 'B', page: 'manager',
        headlineTemplates: [String(a.msg || '').replace(/<\/?b>/g, '').replace(/^\S+\s*/, '')],
        detail: 'Rule alert',
      });
    });
  } catch (e) {}

  return out;
}

// ════════════════════════════════════════════════════════════════════
// CLOSING DESK
// ════════════════════════════════════════════════════════════════════
function buildClosingCandidates() {
  const out = [];

  try {
    const summary = ClosingBridge.getCachedSummary();
    if (summary && Array.isArray(summary.shifts)) {
      const closed = summary.shifts.filter(s => s.status === 'closed');
      const pending = summary.shifts.filter(s => s.status !== 'closed');
      if (closed.length) {
        const total = closed.reduce((s, sh) => s + n(sh.netSale), 0);
        out.push({
          id: 'closing.todaySummary', desk: 'closing', tier: 'B', page: 'closing',
          headlineTemplates: [
            `${closed.length} of ${summary.shifts.length} shifts closed today, ₨${fmt(total)} net so far`,
            `Today's closings so far: ${closed.map(s => s.shift).join(', ')} — ₨${fmt(total)} net`,
          ],
          detail: summary.today,
        });
      }
      if (pending.length && closed.length) {
        out.push({
          id: 'closing.pendingShifts', desk: 'closing', tier: 'C', page: 'closing',
          headlineTemplates: [`${pending.map(s => s.shift).join(', ')} shift${pending.length > 1 ? 's' : ''} still open today`],
          detail: 'Closing Book',
        });
      }
    }
  } catch (e) {}

  // Credit-ledger trend — light mirror of closing-native.js's
  // clBuildSnapshot() (namedCredits/tierCredits/auxCredits -> outTotalE),
  // dependency-free copy for the same reason summary-calc.js's
  // normalizeInventoryRow mirrors stockledger.js's own mapping.
  try {
    const cdb = ClosingBridge.getFullDb();
    if (cdb && cdb.sheets) {
      const snaps = Object.entries(cdb.sheets)
        .filter(([, rec]) => rec && rec.draft !== true)
        .map(([key, rec]) => {
          const parts = key.split('_');
          return { date: parts[0] || '', totalCredit: n(rec.outTotalE) };
        })
        .filter(s => s.date);

      if (snaps.length) {
        const today = todayISO();
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        const weekAgoISO = weekAgo.toISOString().slice(0, 10);
        const todaysSnaps = snaps.filter(s => s.date === today);
        const weekAgoSnaps = snaps.filter(s => s.date === weekAgoISO);

        if (todaysSnaps.length && weekAgoSnaps.length) {
          const todayTotal = Math.max(...todaysSnaps.map(s => s.totalCredit));
          const weekTotal = Math.max(...weekAgoSnaps.map(s => s.totalCredit));
          const diff = todayTotal - weekTotal;
          if (Math.abs(diff) >= 5000) {
            const dir = diff > 0 ? 'up' : 'down';
            out.push({
              id: 'closing.creditTrend', desk: 'closing', tier: 'B', page: 'closing',
              headlineTemplates: [`Closing credit ledger ${dir} ₨${fmt(diff)} vs the same day last week`],
              detail: 'Credit Ledger',
            });
          }
        }

        const maxCredit = Math.max(0, ...snaps.map(s => s.totalCredit));
        if (maxCredit > 0 && todaysSnaps.some(s => s.totalCredit === maxCredit)) {
          out.push({
            id: 'closing.creditRecord', desk: 'closing', tier: 'S', page: 'closing',
            headlineTemplates: [`Highest Closing credit balance on record today — ₨${fmt(maxCredit)}`],
            detail: 'Credit Ledger',
          });
        }
      }
    }
  } catch (e) {}

  return out;
}

// ════════════════════════════════════════════════════════════════════
// INVENTORY DESK
// ════════════════════════════════════════════════════════════════════
function buildInventoryCandidates() {
  const out = [];

  try {
    const data = InventoryBridge.getFullData();
    if (data && Array.isArray(data.products) && data.products.length) {
      const mapped = data.products.map(p => ({
        stock: n(p.qty), unitPrice: n(p.price), conversionFactor: p.conversionFactor,
        lastReceiveDate: p.lastReceiveDate, lastSaleDate: p.lastSaleDate, netQty90Days: n(p.netQty90Days),
      }));
      const b = computeInventoryBuckets(mapped);
      if (b.dataReady) {
        if (b.negativeValue < 0) {
          out.push({
            id: 'inventory.negativeStock', desk: 'inventory', tier: 'A', page: 'inventory',
            headlineTemplates: [`₨${fmt(b.negativeValue)} in negative-stock items right now`],
            detail: 'BT Inventory',
          });
        }
        if (b.deadStock60Value > 0) {
          out.push({
            id: 'inventory.deadStockValue', desk: 'inventory', tier: 'B', page: 'inventory',
            headlineTemplates: [`₨${fmt(b.deadStock60Value)} tied up in dead stock — no sale in 60+ days`],
            detail: 'Stock Ledger',
          });
        }
        if (b.neverSold60Value > 0) {
          out.push({
            id: 'inventory.neverSoldValue', desk: 'inventory', tier: 'C', page: 'inventory',
            headlineTemplates: [`₨${fmt(b.neverSold60Value)} in stock that's never sold, received 60+ days ago`],
            detail: 'Stock Ledger',
          });
        }
        if (b.rawExcessValue > 0) {
          out.push({
            id: 'inventory.excessValue', desk: 'inventory', tier: 'B', page: 'excess',
            headlineTemplates: [`₨${fmt(b.rawExcessValue)} sitting in excess stock beyond a 100-day sale pace`],
            detail: 'Excess Working',
          });
        }
      }
    }
  } catch (e) {}

  try {
    if (window.ReorderReportApp && typeof window.ReorderReportApp.getFlaggedRows === 'function') {
      const rows = window.ReorderReportApp.getFlaggedRows() || [];
      if (rows.length) {
        out.push({
          id: 'inventory.reorderCount', desk: 'inventory', tier: rows.length >= 10 ? 'A' : 'B', page: 'reorder',
          headlineTemplates: [`${rows.length} item${rows.length > 1 ? 's' : ''} now reorder-worthy`],
          detail: 'Reorder Report',
        });
      }
    }
  } catch (e) {}

  try {
    const fired = aimRulesCheckAll() || [];
    fired.filter(a => a.domain === 'inventory').forEach((a, i) => {
      out.push({
        id: 'inventory.rule.' + a.id + '.' + i, desk: 'inventory', tier: a.severity === 'red' ? 'A' : 'B', page: 'inventory',
        headlineTemplates: [String(a.msg || '').replace(/<\/?b>/g, '').replace(/^\S+\s*/, '')],
        detail: 'Rule alert',
      });
    });
  } catch (e) {}

  return out;
}

// ════════════════════════════════════════════════════════════════════
// AUDIT DESK
// ════════════════════════════════════════════════════════════════════
function buildAuditCandidates() {
  const out = [];
  try {
    const summary = AuditBridge.getCachedSummary();
    if (summary && Array.isArray(summary.items) && summary.items.length) {
      const active = summary.items.filter(it => it.roundState && it.roundState !== 'no rounds yet');
      if (active.length) {
        out.push({
          id: 'audit.openCount', desk: 'audit', tier: 'C', page: 'audit',
          headlineTemplates: [`${active.length} audit engagement${active.length > 1 ? 's' : ''} currently active`],
          detail: 'Assignments',
        });
      }
      const nearCompile = summary.items.filter(it => it.roundState === 'counting' || it.roundState === 'locked');
      if (nearCompile.length) {
        out.push({
          id: 'audit.nearCompile', desk: 'audit', tier: 'B', page: 'audit',
          headlineTemplates: [`${nearCompile.map(it => it.name).join(', ')} nearing compile`],
          detail: 'Assignments',
        });
      }
      summary.items.forEach(it => {
        if (it.assigned > 0 && it.submitted >= it.assigned) {
          out.push({
            id: 'audit.fullySubmitted.' + it.name, desk: 'audit', tier: 'B', page: 'audit',
            headlineTemplates: [`${it.name}: all ${it.assigned} counts submitted for round ${it.roundNumber || '—'}`],
            detail: 'Assignments',
          });
        }
      });
    }
  } catch (e) {}
  return out;
}

// ════════════════════════════════════════════════════════════════════
// CROSS-DOMAIN DESK
// ════════════════════════════════════════════════════════════════════
function buildCrossDomainCandidates(ctx, priorCandidates) {
  const out = [];
  try {
    const salesDip = priorCandidates.find(c => c.id === 'sales.momSwing' && /down \d/.test(c.headlineTemplates[0] || ''));
    const creditUp = priorCandidates.find(c => c.id === 'manager.creditTotalTrend' && /^Total staff credit outstanding up/.test(c.headlineTemplates[0] || ''));
    if (salesDip && creditUp) {
      out.push({
        id: 'cross.salesDipCreditUp', desk: 'cross', tier: 'A', page: 'dashboard',
        headlineTemplates: [`Sales are down this month while staff credit is climbing — worth a look together`],
        detail: 'Sales × Manager',
      });
    }
  } catch (e) {}
  return out;
}

// ════════════════════════════════════════════════════════════════════
// MILESTONE DESK
// ════════════════════════════════════════════════════════════════════
function buildMilestoneCandidates() {
  const out = [];
  const M = MONTHLY, D = DAILY;

  try {
    if (M.length) {
      const cumulative = M.reduce((s, m) => s + n(m.TOTAL), 0);
      const step = 50000000; // ₨5 crore steps — tune to your own scale
      const prevCumulative = cumulative - n((M[M.length - 1] || {}).TOTAL);
      if (cumulative >= step && Math.floor(cumulative / step) > Math.floor(prevCumulative / step)) {
        out.push({
          id: 'milestone.cumulative', desk: 'milestone', tier: 'S', page: 'dashboard',
          headlineTemplates: [`Crossed ₨${fmt(Math.floor(cumulative / step) * step)} in cumulative recorded sales`],
          detail: 'All-time',
        });
      }
    }
  } catch (e) {}

  try {
    const filled = D.filter(d => n(d.TOTAL) > 0);
    if (filled.length >= 20) {
      const dow = new Date().getDay();
      const sameDow = filled.filter(d => { const dt = parseDMY(d.Date); return dt && dt.getDay() === dow; });
      if (sameDow.length >= 5) {
        const best = sameDow.reduce((a, b) => n(b.TOTAL) > n(a.TOTAL) ? b : a, sameDow[0]);
        const sorted = sameDow.slice().sort((a, b) => (parseDMY(a.Date) || 0) - (parseDMY(b.Date) || 0));
        const mostRecent = sorted[sorted.length - 1];
        if (mostRecent.Date === best.Date) {
          out.push({
            id: 'milestone.bestWeekdayEver', desk: 'milestone', tier: 'S', page: 'dashboard',
            headlineTemplates: [`Best ${DOW_NAMES[dow]} on record — ₨${fmt(n(best.TOTAL))}`],
            detail: best.Date,
          });
        }
      }
    }
  } catch (e) {}

  return out;
}

// ════════════════════════════════════════════════════════════════════
// SCORING + SELECTION ENGINE
// ════════════════════════════════════════════════════════════════════
function scoreCandidate(c, log) {
  const tierW = TIER_WEIGHT[c.tier] || 20;
  const spacing = MIN_SPACING_DAYS[c.tier];
  const daysSince = _daysSinceLastShown(log, c.id);
  if (spacing > 0 && daysSince < spacing) return -1; // hard-blocked, too soon
  const shownRecently = _timesShownWithin(log, c.id, NOVELTY_WINDOW_DAYS);
  const novelty = Math.pow(NOVELTY_DECAY, shownRecently);
  return tierW * novelty;
}

function pickLead(scored, deskHistory) {
  const positive = scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  if (!positive.length) return null;
  const top = positive[0];
  // Desk rotation: if one desk led the last 3 editions running, prefer a
  // close second (within 25% of the top score) from a different desk.
  const recentLeads = deskHistory.slice(0, 3);
  const dominant = recentLeads.length === 3 && recentLeads.every(d => d === top.desk);
  if (dominant) {
    const alt = positive.find(c => c.desk !== top.desk && c.score >= top.score * 0.75);
    if (alt) return alt;
  }
  return top;
}

function finalizeItem(c, log) {
  const avoidIdx = _lastVariant(log, c.id);
  const { text, idx } = pickPhrase(c.headlineTemplates, avoidIdx);
  return { id: c.id, desk: c.desk, tier: c.tier, page: c.page || 'dashboard', headline: text, detail: c.detail || '', variantIdx: idx };
}

function _editionDateLabel() {
  const d = new Date();
  return DOW_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MN[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
}

function _computeEdition() {
  const ctx = { now: new Date(), curMY: currentMonthYear(), tgts: getTgts() };

  let candidates = [].concat(
    safeBuild(buildSalesCandidates, ctx),
    safeBuild(buildManagerCandidates, ctx),
    safeBuild(buildClosingCandidates, ctx),
    safeBuild(buildInventoryCandidates, ctx),
    safeBuild(buildAuditCandidates, ctx)
  );
  candidates = candidates.concat(safeBuild(buildCrossDomainCandidates, ctx, candidates));
  candidates = candidates.concat(safeBuild(buildMilestoneCandidates, ctx));

  const log = _pruneLog(_loadLog());
  const deskHistory = _loadDeskHistory();

  const scored = candidates
    .map(c => Object.assign({}, c, { score: scoreCandidate(c, log) }))
    .filter(c => c.score > 0);

  if (!scored.length) {
    return {
      empty: true,
      dateLabel: _editionDateLabel(),
      lead: { headline: 'A quiet one — no fresh headlines since the last edition.', detail: 'All quiet', tier: 'C', desk: 'cross', page: 'dashboard' },
      desks: [],
    };
  }

  const lead = pickLead(scored, deskHistory);
  const remaining = scored.filter(c => c !== lead).sort((a, b) => b.score - a.score);

  const byDesk = {};
  remaining.forEach(c => { (byDesk[c.desk] = byDesk[c.desk] || []).push(c); });

  const desks = DESK_ORDER
    .filter(d => byDesk[d] && byDesk[d].length)
    .map(d => ({
      desk: d, label: DESK_META[d].label, icon: DESK_META[d].icon,
      items: byDesk[d].slice(0, 3).map(c => finalizeItem(c, log)),
    }));

  const finalLead = finalizeItem(lead, log);

  // Log what was printed, advance desk-lead history — once per edition.
  const nowTs = Date.now();
  const shownItems = [finalLead].concat(desks.flatMap(d => d.items));
  _saveLog(log.concat(shownItems.map(it => ({ id: it.id, ts: nowTs, variant: it.variantIdx }))));
  _saveDeskHistory([lead.desk].concat(deskHistory));

  return { empty: false, dateLabel: _editionDateLabel(), lead: finalLead, desks };
}

// ── public API ───────────────────────────────────────────────────────
// One edition per calendar day — cached so re-renders within the same
// day (bridge refreshes, page revisits) don't reshuffle the front page.
export function buildTodaysEdition() {
  const today = todayISO();
  try {
    const cached = JSON.parse(Repository.getItem(EDITION_CACHE_KEY) || 'null');
    if (cached && cached.date === today && cached.edition) return cached.edition;
  } catch (e) {}

  const edition = _computeEdition();
  try { Actions.saveFeatureData(EDITION_CACHE_KEY, JSON.stringify({ date: today, edition })); } catch (e) {}
  return edition;
}

// Manual "later edition" refresh — same day, but discards the cache and
// re-scores against current numbers (still logs/rotates normally).
export function refreshEdition() {
  try { Repository.setItem(EDITION_CACHE_KEY, ''); } catch (e) {}
  return buildTodaysEdition();
}

window.HeraldEngine = { buildTodaysEdition, refreshEdition };
