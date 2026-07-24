// ══════════════════════════════════════════════════════════════════════
// BTCalc — Step 4: Pure business calculation functions (no state mutation)
// Consumed by: Dashboard, Assistant, Reports, CommandHub
// References BANK_COLS, CLIENT_COLS, MONTHLY lazily (at call time, not load time)
// ══════════════════════════════════════════════════════════════════════

const BTCalc = Object.freeze({
  cashSales(m) {
    const n    = BTFormat.num;
    const negR = v => { const x = n(v); return x > 0 ? -x : x; };
    const banks = (typeof BANK_COLS !== 'undefined' ? BANK_COLS : [])
      .reduce((s, k) => s + n(m[k]), 0);
    return n(m['Cash Sale']) + negR(m['Cash Returns']) + banks;
  },

  creditSales(m) {
    const n = BTFormat.num;
    return (typeof CLIENT_COLS !== 'undefined' ? CLIENT_COLS : [])
      .reduce((s, c) => s + n(m[c]), 0);
  },

  bankTotal(m) {
    const n = BTFormat.num;
    return (typeof BANK_COLS !== 'undefined' ? BANK_COLS : [])
      .reduce((s, k) => s + n(m[k]), 0);
  },

  grandTotal(monthlyArray) {
    return (monthlyArray || []).reduce((s, m) => s + BTFormat.num(m.TOTAL), 0);
  },

  monthlyAverage(monthlyArray) {
    const arr = monthlyArray || [];
    if (!arr.length) return 0;
    return BTCalc.grandTotal(arr) / arr.length;
  },

  dailyAverage(dailyArray, monthYear) {
    const days = (dailyArray || []).filter(d => d.Month_Year === monthYear);
    if (!days.length) return 0;
    return days.reduce((s, d) => s + BTFormat.num(d.TOTAL), 0) / days.length;
  },

  anomalyScore(dailyRecord, average, stdDev) {
    if (!stdDev) return 0;
    return Math.abs(BTFormat.num(dailyRecord.TOTAL) - average) / stdDev;
  },

  forecastTotal(latestMonthRecord, dailyArray) {
    const n  = BTFormat.num;
    const my = latestMonthRecord && latestMonthRecord.Month_Year;
    if (!my) return 0;
    const days = (dailyArray || []).filter(d => d.Month_Year === my);
    if (!days.length) return 0;
    const total = days.reduce((s, d) => s + n(d.TOTAL), 0);
    const avg   = total / days.length;
    const [mon, yr] = my.split(' ');
    const mi = BTDate.monthNames.indexOf(mon);
    const daysInMonth = new Date(parseInt(yr, 10), mi + 1, 0).getDate();
    return avg * daysInMonth;
  },

  branchScore(latest, previous, target, actual) {
    if (!latest || !previous) return null;
    const n      = BTFormat.num;
    const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const pctNum = (a, b) => b ? ((a - b) / b * 100) : 0;
    const comps  = [];
    if (target) comps.push(clamp(actual / target * 100, 0, 100));
    const [mn, yr] = latest.Month_Year.split(' ');
    const allMonthly = (typeof MONTHLY !== 'undefined') ? MONTHLY : [];
    const yoyMonth = allMonthly.find(m => m.Month_Year === mn + ' ' + (parseInt(yr, 10) - 1));
    if (yoyMonth) comps.push(clamp(50 + pctNum(n(latest.TOTAL), n(yoyMonth.TOTAL)) * 2.5, 0, 100));
    comps.push(clamp(50 + pctNum(n(latest.Customers), n(previous.Customers)) * 2.5, 0, 100));
    if (!comps.length) return null;
    return Math.round(comps.reduce((a, b) => a + b, 0) / comps.length);
  },

  cagr(monthlyArray) {
    const arr = monthlyArray || [];
    if (arr.length < 24) return null;
    const n      = BTFormat.num;
    const first12 = arr.slice(0, 12).reduce((s, m) => s + n(m.TOTAL), 0);
    const last12  = arr.slice(-12).reduce((s, m) => s + n(m.TOTAL), 0);
    const yrsSpan = (arr.length - 12) / 12;
    if (first12 <= 0 || yrsSpan <= 0) return null;
    return (Math.pow(last12 / first12, 1 / yrsSpan) - 1) * 100;
  },
});
