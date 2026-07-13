// ══════════════════════════════════════════════════════════════════════
// ANALYTICS  —  Floor 3 business computation module (CF-03 / CF-04 fix)
//
// All KPI aggregations, MTD/YTD comparisons, forecast calculations,
// manager-data queries, and "latest month" discovery live here.
// Nothing in this file knows about the DOM.
//
// Pages call Analytics.getDashboardKPIs() and receive a plain data
// object — they then map it to HTML. This closes the audit finding
// where buildDashboard() contained CAGR, branch score, MTD/YTD,
// forecast, and YTD computations all inline on Floor 5.
//
// Load order: after config.js (needs n, fc, ff, pct, MONTHLY, DAILY,
// cashSales, creditSales, CLIENT_COLS, BANK_COLS, clamp, pctNum,
// yearlyCAGR, branchScore) and after targets.js (needs getTgts).
// Must be loaded BEFORE dashboard.js.
// ══════════════════════════════════════════════════════════════════════

const Analytics = (function () {

  // ── Shared month-order helpers (used by several functions) ────────
  const _MN = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];

  function _monthSortVal(my) {
    const parts = String(my || '').split(' ');
    const idx = _MN.indexOf(parts[0]);
    const yr  = parseInt(parts[1], 10);
    return idx >= 0 && !isNaN(yr) ? yr * 12 + idx : -1;
  }

  function _currentMonthVal() {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth();
  }

  // ── MTD helpers ───────────────────────────────────────────────────
  // Parse day number from Date field ('20/Jun/2026' → 20)
  function _dayOf(dateStr) {
    return parseInt((dateStr || '').split('/')[0], 10) || 0;
  }

  // Sum TOTAL for a month up to dayLimit (inclusive)
  function _dailyMTD(monthYear, dayLimit) {
    return DAILY.filter(d => d.Month_Year === monthYear && _dayOf(d.Date) <= dayLimit)
                .reduce((s, d) => s + n(d.TOTAL), 0);
  }

  // Sum any numeric field up to dayLimit
  function _dailyMTDField(monthYear, dayLimit, field) {
    return DAILY.filter(d => d.Month_Year === monthYear && _dayOf(d.Date) <= dayLimit)
                .reduce((s, d) => s + n(d[field]), 0);
  }

  // Last calendar day-of-month with an actual (non-zero) DAILY entry for
  // the given month. This is "days elapsed" for every pace/forecast/MTD
  // calculation below — deliberately NOT today's calendar date, because
  // the day's sale is typically entered the next day (today is the 10th,
  // but the last saved entry is the 9th's — elapsed is 9, not 10, and the
  // remaining-days math is over the true days left in the month, not one
  // short). Single source of truth so getDashboardKPIs() and
  // getTargetPaceForMonth() can never drift from each other on this.
  function _lastFilledDay(monthYear) {
    return Math.max(0, ...DAILY
      .filter(d => d.Month_Year === monthYear && n(d.TOTAL) > 0)
      .map(d => _dayOf(d.Date)));
  }

  // ── Manager data queries ──────────────────────────────────────────

  // Returns true if the given Month_Year has any non-trivial manager data
  // (salary, generic, expense, petty, custom sections, or incentives).
  // This is a pure query — reads through Repository only.
  function managerMonthHasData(my) {
    const _ni = v => Math.round(Number(v) || 0);
    let hasData = false;
    try {
      const mgr = typeof mgrLoad === 'function' ? mgrLoad() : {};
      const salary  = (mgr.salary  && mgr.salary[my])  || [];
      const generic = (mgr.generic && mgr.generic[my]) || [];
      const expense = mgr.expense  && mgr.expense[my];
      const credit  = (mgr.credit  && mgr.credit[my])  || [];
      hasData = hasData
        || salary.some(r  => _ni(r.hoSal) || _ni(r.advance) || _ni(r.generic))
        || generic.some(r => _ni(r.genericSale) || _ni(r.extra))
        || !!(expense && (_ni(expense.opening)
            || (expense.rows || []).some(r =>
                _ni(r.bill) || _ni(r.fuel) || _ni(r.soap) ||
                _ni(r.refresh) || _ni(r.extra) || _ni(r.pattyHO))))
        || credit.some(emp =>
            _ni(emp.prevBal) || _ni(emp.salary) || _ni(emp.lessGeneric)
            || (emp.entries || []).some(e => _ni(e.amount) || e.desc || e.date));
    } catch(e) {}
    try {
      hasData = hasData || (typeof _pettyTotalForMonth === 'function' && _pettyTotalForMonth(my) !== 0);
    } catch(e) {}
    try {
      const csecAll = typeof _csecLoad === 'function' ? _csecLoad() : {};
      hasData = hasData || Object.values(csecAll).some(sec =>
        ((sec && sec.months && sec.months[my]) || []).some(r =>
          (parseFloat(r.amount) || 0) !== 0 || r.desc || r.notes));
    } catch(e) {}
    try {
      const inc = JSON.parse(Repository.getItem('mw_incentive_' + my) || '{}');
      hasData = hasData || Object.values(inc).some(v => (Math.round(Number(v) || 0)) !== 0);
    } catch(e) {}
    return hasData;
  }

  // Returns the most recent Month_Year string that has real manager data.
  function latestManagerMonth() {
    const found = new Set();
    try {
      const mgr = typeof mgrLoad === 'function' ? mgrLoad() : {};
      ['salary', 'generic', 'expense', 'credit'].forEach(k => {
        Object.keys(mgr[k] || {}).forEach(m => found.add(m));
      });
    } catch(e) {}
    try {
      Repository.getKeysByPrefix('mw_petty_').forEach(k => found.add(k.slice('mw_petty_'.length)));
    } catch(e) {}
    try {
      const csecAll = typeof _csecLoad === 'function' ? _csecLoad() : {};
      Object.values(csecAll).forEach(sec =>
        Object.keys((sec && sec.months) || {}).forEach(m => found.add(m)));
    } catch(e) {}
    const current = _currentMonthVal();
    return Array.from(found)
      .filter(m => _monthSortVal(m) <= current && managerMonthHasData(m))
      .sort((a, b) => _monthSortVal(b) - _monthSortVal(a))[0] || '';
  }

  // Returns the latest MONTHLY entry that is not in the future.
  function latestSalesMonth(lat) {
    const current = _currentMonthVal();
    if (lat && _monthSortVal(lat.Month_Year) <= current) return lat.Month_Year;
    const latest = [...MONTHLY].reverse().find(m => _monthSortVal(m.Month_Year) <= current);
    return latest ? latest.Month_Year : '';
  }

  // Builds a { rows, total } breakdown for one Ledger type — opening
  // balance (if any) as its own row, then one row per category that has
  // ever had activity, each signed by that category's own +/- sign, so
  // Inflow and Outflow categories are never conflated. `total` is the
  // ledger's real running balance (LedgerStore.getCurrentBalance), not a
  // re-derived sum, so this always matches what the Ledger page itself
  // shows.
  function _ledgerBreakdown(ledgerType) {
    const LS = (typeof window !== 'undefined') ? window.LedgerStore : null;
    if (!LS) return { rows: [], total: 0 };
    const categories = LS.getCategoryList(ledgerType) || [];
    const entries = LS.getEntries(ledgerType) || [];
    const sums = {};
    entries.forEach(e => { sums[e.categoryId] = (sums[e.categoryId] || 0) + (parseFloat(e.amount) || 0); });
    const opening = LS.getOpeningBalance(ledgerType) || 0;
    const rows = [];
    if (opening) rows.push({ name: '🏦 Opening Balance', net: opening });
    categories.forEach(c => {
      const sum = sums[c.id] || 0;
      if (sum) rows.push({ name: (c.icon ? c.icon + ' ' : '') + c.label, net: c.sign * sum });
    });
    return { rows, total: LS.getCurrentBalance(ledgerType) };
  }

  // Aggregates all data needed by buildCreditSection — a pure data
  // query that the page function just renders. Closes CF-04 gap where
  // buildCreditSection() mixed data fetching with DOM rendering.
  //
  // Staff Credit stays month-scoped (mgrData.credit[my] is genuinely
  // month-by-month data). Jazz Cash, Patty/Expenses, and every "Other
  // Section" now come straight from the unified Ledger (bt_ledger_v1) —
  // continuous, running balances, same source of truth as the Ledger
  // tabs themselves — replacing the old month-scoped Expense-tab math
  // and the old per-section custom-sections store entirely.
  function getCreditSectionData(my) {
    const _ni = v => Math.round(Number(v) || 0);
    const mgrData = typeof mgrLoad === 'function' ? mgrLoad() : {};

    // 1. Staff credit net balances
    const crdRows  = (mgrData.credit && mgrData.credit[my]) || [];
    const staffRows = crdRows.map(emp => {
      const entriesTotal = (emp.entries || []).reduce((s, e) => s + _ni(e.amount), 0);
      const net = _ni(emp.prevBal) + entriesTotal - _ni(emp.salary) - _ni(emp.lessGeneric);
      return { name: emp.name, net };
    }).filter(r => r.net !== 0);
    const staffTotal = staffRows.reduce((s, r) => s + r.net, 0);

    // 2. Jazz Cash ledger (continuous, all-time — not month-scoped)
    const jazzCash = _ledgerBreakdown('jazzcash');

    // 3. Patty / Expenses ledger (continuous, all-time — not month-scoped)
    const patty = _ledgerBreakdown('expense');

    // 4. Every user-created "Other Section", each with its own category
    // breakdown, plus a combined total across all of them.
    const LS = (typeof window !== 'undefined') ? window.LedgerStore : null;
    const customTypes = LS ? LS.getAllLedgerTypes().filter(t => t.isCustom) : [];
    const otherSections = customTypes.map(t => ({
      id: t.id, label: t.label, ..._ledgerBreakdown(t.id),
    }));
    const otherSectionsTotal = otherSections.reduce((s, sec) => s + sec.total, 0);

    return {
      my,
      staffRows, staffTotal,
      jazzCashRows: jazzCash.rows, jazzCashTotal: jazzCash.total,
      pattyRows: patty.rows, pattyTotal: patty.total,
      otherSections, otherSectionsTotal,
      grandTotal: staffTotal + jazzCash.total + patty.total + otherSectionsTotal,
    };
  }

  // ── Main KPI computation ──────────────────────────────────────────
  // Returns a plain object with all values buildDashboard() needs to
  // render. Zero DOM access. Pure data in, plain data out.
  function getDashboardKPIs() {
    // Make sure MONTHLY already reflects any DAILY entries saved for the
    // running calendar month before picking 'lat' as MONTHLY's last row.
    // Without this, the dashboard could stay pinned on last month's
    // "Closed / Final" card even after this month's sales have been
    // entered — e.g. after a raw data import, or a sync pull that for
    // whatever reason didn't trigger the usual recomputeMonthly() hook.
    // recomputeMonthly() is a safe no-op when the month has no DAILY
    // rows yet, so this never invents a month that has no real entries.
    const _now0 = new Date();
    const _curMY0 = _MN[_now0.getMonth()] + ' ' + _now0.getFullYear();
    if (typeof recomputeMonthly === 'function') recomputeMonthly(_curMY0);

    if (!MONTHLY.length || !MONTHLY[MONTHLY.length - 1]) return null;

    const lat  = MONTHLY[MONTHLY.length - 1];
    const prv  = MONTHLY[MONTHLY.length - 2];
    if (!prv) return null;

    const now     = new Date();
    const curY    = now.getFullYear();
    const curMonthIdx = now.getMonth(); // 0-based
    const curMonthYear = _MN[curMonthIdx] + ' ' + curY;
    const isLive  = lat.Month_Year === curMonthYear;

    // Last day with actual data in the current month
    const lastFilledDay = isLive ? _lastFilledDay(lat.Month_Year) : 0;

    const D = lastFilledDay;
    const vsLabel = isLive ? 'vs prev (day 1–' + D + ')' : 'vs prev';

    // MTD comparisons
    const CASH_FIELDS = ['Cash Sale', 'HBL', 'MCB', 'Alfala Bank', 'Bank Al Habib', 'Meezan Bank (Paysa)'];
    const prvTotal     = isLive ? _dailyMTD(prv.Month_Year, D) : n(prv.TOTAL);
    const prvCash      = isLive
      ? CASH_FIELDS.reduce((s, f) => s + _dailyMTDField(prv.Month_Year, D, f), 0)
        - Math.abs(_dailyMTDField(prv.Month_Year, D, 'Cash Returns'))
      : cashSales(prv);
    const prvCredit    = isLive
      ? CLIENT_COLS.reduce((s, c) => s + _dailyMTDField(prv.Month_Year, D, c), 0)
      : creditSales(prv);
    const prvCustomers = isLive ? _dailyMTDField(prv.Month_Year, D, 'Customers') : n(prv.Customers);

    // YTD
    const ytd  = MONTHLY
      .filter(m => parseInt((m.Month_Year.split(' ')[1] || ''), 10) === curY)
      .reduce((s, m) => s + n(m.TOTAL), 0);
    const prevSameMonthYear = _MN[curMonthIdx] + ' ' + (curY - 1);
    const pYtd = MONTHLY
      .filter(m => {
        const p = m.Month_Year.split(' ');
        return parseInt(p[1], 10) === (curY - 1) && _MN.indexOf(p[0]) < curMonthIdx;
      })
      .reduce((s, m) => s + n(m.TOTAL), 0)
      + (isLive ? _dailyMTD(prevSameMonthYear, D) : 0);
    const ytdVsLabel = isLive
      ? 'vs ' + (curY - 1) + ' (1–' + D + ' ' + _MN[curMonthIdx] + ')'
      : 'vs ' + (curY - 1);

    // Forecast
    const tgts        = typeof getTgts === 'function' ? getTgts() : {};
    const latTgt      = tgts[lat.Month_Year];
    const latAct      = n(lat.TOTAL);
    const latDays     = DAILY.filter(d => d.Month_Year === lat.Month_Year && n(d.TOTAL) > 0).length;
    // Use the ACTUAL month from lat (not the current calendar month) so that
    // a closed month like June (30 days) is never shown as 31 days just because
    // the current month (July) has 31. This also fixes the forecast for a
    // closed month — for a closed month the forecast IS the actual total.
    const [_latMonName, _latYrStr] = lat.Month_Year.split(' ');
    const _latMonIdx = _MN.indexOf(_latMonName);
    const _latYrNum  = parseInt(_latYrStr, 10);
    const daysInMon  = (_latMonIdx >= 0 && !isNaN(_latYrNum))
      ? new Date(_latYrNum, _latMonIdx + 1, 0).getDate()
      : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyAvg    = latDays ? latAct / latDays : 0;
    // For a closed month there is no more runway — the final total IS the result.
    const forecastTotal = isLive ? dailyAvg * daysInMon : latAct;
    const avgBill     = n(lat.Customers) ? latAct / n(lat.Customers) : 0;
    const pAvgBill    = prvCustomers ? prvTotal / prvCustomers : 0;

    // CAGR and branch score (already extracted in config.js)
    const cagr   = yearlyCAGR();
    const bScore = branchScore(lat, prv, latTgt, latAct);

    // Cumulative diff
    const cumDiff = MONTHLY.reduce((s, m) => s + Math.round(n(m.TOTAL) - n(m['COMP SALE'])), 0);

    // Grand total
    const gTotal = MONTHLY.reduce((s, m) => s + n(m.TOTAL), 0);

    // Hero sub-text counts
    const dailyRecordCount = DAILY.filter(d => n(d.TOTAL) > 0).length;

    return {
      // meta
      lat, prv, isLive, D, vsLabel, ytdVsLabel,
      gTotal, dailyRecordCount,
      // MTD
      prvTotal, prvCash, prvCredit, prvCustomers,
      // YTD
      ytd, pYtd, curY,
      // Forecast / target
      latTgt, latAct, latDays, daysInMon, dailyAvg, forecastTotal,
      avgBill, pAvgBill,
      // Scores
      cagr, bScore,
      // Cumulative diff
      cumDiff,
    };
  }

  return {
    getDashboardKPIs,
    getCreditSectionData,
    latestManagerMonth,
    latestSalesMonth,
    managerMonthHasData,
    // Expose helpers so dashboard.js can use them for sub-sections
    // (buildTop10Days, buildBestWorstPerYear still read MONTHLY/DAILY
    //  directly as pure reads — acceptable for now).
    _monthSortVal,
    _currentMonthVal,
    // Index page (Floor 5) view-model builder
    buildIndexViewModel,
    // Dashboard insights (Floor 5) computations
    getTargetPaceForMonth,
    computeInsightCandidates,
    getSalesDiffSinceLastLook,
  };

  // ── Index page view-model ──────────────────────────────────────────
  // All filtering/sorting/grouping/aggregation for the Index page moved
  // here from index-page.js (closes the last CF-03-style gap). Returns
  // plain data; index-page.js only maps it to HTML.
  function buildIndexViewModel(query, year, sort) {
    const q = (query || '').toLowerCase();
    let data = MONTHLY.filter(m =>
      (!q || m.Month_Year.toLowerCase().includes(q)) &&
      (!year || m.Month_Year.endsWith(year)));
    if (sort === 'total-d') data.sort((a, b) => n(b.TOTAL) - n(a.TOTAL));
    else if (sort === 'total-a') data.sort((a, b) => n(a.TOTAL) - n(b.TOTAL));

    const maxT = Math.max(...MONTHLY.map(m => n(m.TOTAL)));
    const tgts = typeof getTgts === 'function' ? getTgts() : {};

    if (sort === 'date') {
      const MONTH_ORDER = ['January','February','March','April','May','June','July',
        'August','September','October','November','December'];
      const byYr = {};
      data.forEach(m => {
        const y = m.Month_Year.split(' ').pop();
        (byYr[y] = byYr[y] || []).push(m);
      });
      const sortedYrs = Object.keys(byYr).sort((a, b) => b - a);
      const groups = sortedYrs.map((y, yi) => {
        const mons = byYr[y].slice().sort((a, b) => {
          const ai = MONTH_ORDER.indexOf(a.Month_Year.split(' ')[0]);
          const bi = MONTH_ORDER.indexOf(b.Month_Year.split(' ')[0]);
          return bi - ai;
        });
        const yrTotal = mons.reduce((s, m) => s + n(m.TOTAL), 0);
        const yrCust  = mons.reduce((s, m) => s + n(m.Customers), 0);
        return { year: y, months: mons, yrTotal, yrCust, isLatest: yi === 0 };
      });
      return { mode: 'grouped', groups, maxT, tgts };
    }

    return { mode: 'flat', months: data, maxT, tgts };
  }

  // ── Dashboard insights: target pace ──────────────────────────────────
  // Extracted from dashboard-insights.js's _dbiBuildTargetPace(). Returns
  // plain numbers; dashboard-insights.js only formats them into HTML.
  function getTargetPaceForMonth(monthYear, tgts) {
    const tgt = n((tgts || {})[monthYear]);
    if (!tgt) return null;

    // Derive daysInMonth from the actual target month (not always "now"'s
    // month) — same reasoning getDashboardKPIs() already uses for daysInMon,
    // so a report run for a different month never inherits the wrong month
    // length.
    const [_pMonName, _pYrStr] = String(monthYear).split(' ');
    const _pMonIdx = _MN.indexOf(_pMonName);
    const _pYrNum  = parseInt(_pYrStr, 10);
    const now = new Date();
    const daysInMonth = (_pMonIdx >= 0 && !isNaN(_pYrNum))
      ? new Date(_pYrNum, _pMonIdx + 1, 0).getDate()
      : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // Days elapsed = last day with an actual entered sale, not today's
    // calendar date — see _lastFilledDay()'s header note. If today is the
    // 10th but only the 9th has been entered so far, elapsed is 9 and
    // daysLeft is the true 22 remaining days of the month, not 21.
    const daysElapsed = _lastFilledDay(monthYear);
    const daysLeft     = Math.max(0, daysInMonth - daysElapsed);
    const monthRec     = MONTHLY.find(m => m.Month_Year === monthYear);
    const soFar         = n((monthRec && monthRec.TOTAL) || 0);
    const pct           = tgt > 0 ? Math.min(100, Math.round(soFar / tgt * 100)) : 0;
    const remaining     = tgt - soFar;
    const achieved       = remaining <= 0;

    const idealPerDay  = tgt / daysInMonth;
    const actualPerDay = daysElapsed > 0 ? soFar / daysElapsed : 0;
    const neededPerDay = daysLeft > 0 ? Math.ceil(Math.max(0, remaining) / daysLeft) : 0;
    const paceRatio     = idealPerDay > 0 ? actualPerDay / idealPerDay : 0;

    return {
      monthYear, tgt, daysInMonth, daysElapsed, daysLeft,
      soFar, pct, remaining, achieved,
      idealPerDay, actualPerDay, neededPerDay, paceRatio,
    };
  }

  // ── Dashboard insights: rotating insight candidates ──────────────────
  // Extracted from dashboard-insights.js's _dbiComputeInsights(). Returns
  // plain fact objects (numbers, not HTML). dashboard-insights.js formats
  // each candidate into its icon/title/text/cta presentation.
  function computeInsightCandidates(tgts) {
    const M = MONTHLY, D = DAILY;
    if (M.length < 2 || !D.length) return [];

    const now = new Date();
    const curMY = _MN[now.getMonth()] + ' ' + now.getFullYear();
    const candidates = [];

    // A. Target pace
    const tgt = n((tgts || {})[curMY]);
    if (tgt > 0) {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysElapsed = now.getDate();
      const daysLeft = daysInMonth - daysElapsed;
      const monthRec = M.find(m => m.Month_Year === curMY);
      const soFar = n((monthRec && monthRec.TOTAL) || 0);
      const pct = tgt > 0 ? Math.round(soFar / tgt * 100) : 0;
      const neededPerDay = daysLeft > 0 ? Math.ceil((tgt - soFar) / daysLeft) : 0;
      if (soFar < tgt) {
        candidates.push({ type: 'targetPace', curMY, pct, neededPerDay, daysLeft });
      }
    }

    // B. Weekday comparison
    const dow = now.getDay();
    const sortedD = D.slice().sort((a, b) => {
      const pa = a.Date || '', pb = b.Date || '';
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    const sameDay = sortedD.filter(d => {
      try {
        const parts = (d.Date || '').split('/');
        if (parts.length < 3) return false;
        const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
        const dt = new Date(parseInt(parts[2]), months[parts[1]] || 0, parseInt(parts[0]));
        return dt.getDay() === dow;
      } catch (e) { return false; }
    }).slice(-5);
    if (sameDay.length >= 3) {
      const sameDayAvg = sameDay.slice(0, -1).reduce((s, d) => s + n(d.TOTAL), 0) / (sameDay.length - 1);
      const latestSameDay = sameDay[sameDay.length - 1];
      const latestVal = n(latestSameDay.TOTAL);
      if (sameDayAvg > 0 && latestVal > 0) {
        const diffPct = Math.round((latestVal - sameDayAvg) / sameDayAvg * 100);
        candidates.push({ type: 'weekday', dow, latestSameDay, latestVal, sameDayAvg, diffPct });
      }
    }

    // C. Biggest MoM swing
    if (M.length >= 2) {
      const last = M[M.length - 1], prev = M[M.length - 2];
      const lastT = n(last.TOTAL), prevT = n(prev.TOTAL);
      if (prevT > 0) {
        const swingPct = Math.round((lastT - prevT) / prevT * 100);
        candidates.push({ type: 'momSwing', last, prev, lastT, prevT, swingPct });
      }
    }

    // D. Best day this month vs last month's best day
    if (M.length >= 2 && D.length) {
      const curMon = M[M.length - 1].Month_Year;
      const prvMon = M[M.length - 2].Month_Year;
      const curDays = D.filter(d => d.Month_Year === curMon && n(d.TOTAL) > 0);
      const prvDays = D.filter(d => d.Month_Year === prvMon && n(d.TOTAL) > 0);
      if (curDays.length && prvDays.length) {
        const curBest = curDays.reduce((a, b) => n(b.TOTAL) > n(a.TOTAL) ? b : a, curDays[0]);
        const prvBest = prvDays.reduce((a, b) => n(b.TOTAL) > n(a.TOTAL) ? b : a, prvDays[0]);
        const diffPct = n(prvBest.TOTAL) > 0
          ? Math.round((n(curBest.TOTAL) - n(prvBest.TOTAL)) / n(prvBest.TOTAL) * 100) : 0;
        candidates.push({ type: 'bestDay', curBest, prvBest, prvMon, diffPct });
      }
    }

    // E. Avg bill size trend
    if (M.length >= 2) {
      const last = M[M.length - 1], prev = M[M.length - 2];
      const avgLast = n(last.Customers) > 0 ? n(last.TOTAL) / n(last.Customers) : 0;
      const avgPrev = n(prev.Customers) > 0 ? n(prev.TOTAL) / n(prev.Customers) : 0;
      if (avgLast > 0 && avgPrev > 0) {
        const diffPct = Math.round((avgLast - avgPrev) / avgPrev * 100);
        candidates.push({ type: 'avgBill', last, prev, avgLast, avgPrev, diffPct });
      }
    }

    return candidates;
  }

  // ── Dashboard insights: "since you last looked" diff ─────────────────
  // Pure computation only — reading/writing the previous-session snapshot
  // through Repository stays in dashboard-insights.js (that's legitimate
  // UI-state persistence, not business data).
  function getSalesDiffSinceLastLook(prevSnapshot) {
    const lastTotal = MONTHLY.reduce((s, m) => s + n(m.TOTAL), 0);
    const lastMonths = MONTHLY.length;
    if (!prevSnapshot || prevSnapshot.totalMonths !== lastMonths) {
      return { diff: null, lastTotal, lastMonths };
    }
    const diff = lastTotal - prevSnapshot.totalSales;
    return { diff, lastTotal, lastMonths };
  }

})();
