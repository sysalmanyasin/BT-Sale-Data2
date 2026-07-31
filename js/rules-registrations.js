// ══════════════════════════════════════════════════════════════════════
// RULE REGISTRATIONS  —  BT Sales App  ·  Rule-Based Intelligence Plan §3
//
// Registers the per-domain rule functions from the plan into the engine
// (rules-engine.js). Each fn is pure and re-reads its domain's own
// cold-callable getter every time it's called — nothing here caches or
// assumes a tab has been opened this session, same contract as
// getSummaryFor()/getSummary() themselves.
//
// Thresholds below (COVER_VALUE_THRESHOLD, EXCESS_ITEM_THRESHOLD, etc.)
// are starting defaults, not tuned against real data — flagged inline.
// Adjust once you've seen what fires for a week or two.
//
// Deliberately NOT implemented: "missing salary/credit entry past the
// data-entry cutoff" (plan §3.3). reconcileStaffRows() (manager-shared.js)
// always fills a blank {prevBal:0, entries:[], salary:0, ...} /
// {hoSal:0, advance:0, generic:0} row for any active staff member with
// no saved data yet — so "never entered" and "genuinely all zero" are
// the same object shape. There's no reliable way to tell them apart
// from the data as currently modeled, so a rule here would either miss
// real gaps or false-positive on legitimately-zero months. Needs a
// schema change (e.g. a saved-at timestamp) before this can be a real
// rule rather than a guess.
// ══════════════════════════════════════════════════════════════════════
function n(v) { return Number(v) || 0; }
  function fmt(v) { return Math.round(n(v)).toLocaleString('en-PK'); }

  /* ────────────────────────────────────────────────────────────────
     SALES
  ──────────────────────────────────────────────────────────────── */

  const SALES_DIFF_TOLERANCE = 5000; // ₨ — |TOTAL - COMP SALE| beyond this fires

  window.aimRulesRegister('sales', 'diffTolerance', function () {
    const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
    if (!M.length) return null;
    const last = M[M.length - 1];
    const diff = n(last.TOTAL) - n(last['COMP SALE']);
    if (Math.abs(diff) <= SALES_DIFF_TOLERANCE) return null;
    const dir = diff > 0 ? 'above' : 'below';
    return {
      severity: 'amber',
      msg: `📊 <b>${last.Month_Year}</b>: Total is ₨${fmt(Math.abs(diff))} ${dir} COMP SALE — beyond the ₨${fmt(SALES_DIFF_TOLERANCE)} tolerance.`,
    };
  });

  // Complements (doesn't duplicate) the always-visible Target Pace card:
  // that card shows every state (on-pace/behind/at-risk/achieved) all
  // month long. This only fires as an actual alert once things are both
  // clearly off-pace (paceRatio < 0.8, the card's own "at-risk" tier)
  // AND there's genuinely little runway left to fix it.
  const PACE_URGENT_DAYS_LEFT = 10;

  window.aimRulesRegister('sales', 'paceAtRisk', function () {
    if (typeof Analytics === 'undefined' || typeof Analytics.getTargetPaceForMonth !== 'function') return null;
    const d = new Date();
    const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const my = MN[d.getMonth()] + ' ' + d.getFullYear();
    let tgts = {};
    try { tgts = JSON.parse(Repository.getItem('bt_targets') || '{}'); } catch (e) {}
    const p = Analytics.getTargetPaceForMonth(my, tgts);
    if (!p || p.achieved) return null;
    if (p.paceRatio >= 0.8 || p.daysLeft > PACE_URGENT_DAYS_LEFT) return null;
    return {
      severity: 'red',
      msg: `⚠️ <b>${my} target at risk</b> — only ${p.daysLeft} days left, need ₨${fmt(p.neededPerDay)}/day (currently ₨${fmt(p.actualPerDay)}/day).`,
    };
  });

  /* ────────────────────────────────────────────────────────────────
     INVENTORY
  ──────────────────────────────────────────────────────────────── */

  const COVER_VALUE_THRESHOLD = 10000; // ₨ 30-day sale value — below this, low cover isn't worth an alert
  const EXCESS_ITEM_THRESHOLD = 25000; // ₨ single-item excess value

  // "daysCover_primary < coverDays AND saleValue_30 > threshold" — uses
  // getFlaggedRows() (this page's own persisted cover-days/window/topN
  // settings, defaulting to 90-day/15-day-cover/top-50 if the tab's
  // never been opened — see reorder-report.js state defaults), then
  // adds the value floor so a fast-selling ₨200 item doesn't fire.
  window.aimRulesRegister('inventory', 'lowCoverValue', function () {
    if (typeof window.ReorderReportApp === 'undefined') return null;
    const rows = window.ReorderReportApp.getFlaggedRows();
    if (!rows || !rows.length) return null;
    const worthy = rows
      .filter(r => n(r.saleValue30) > COVER_VALUE_THRESHOLD)
      .sort((a, b) => (a.daysCoverP ?? Infinity) - (b.daysCoverP ?? Infinity));
    if (!worthy.length) return null;
    return worthy.map(r => ({
      severity: 'red',
      msg: `📦 <b>${r.name || r.code}</b> — ${r.daysCoverP != null ? r.daysCoverP.toFixed(1) : '0'} days cover left. Reorder ~${fmt(r.demandQtyP)} units (₨${fmt(r.demandValueP)}).`,
    }));
  });

  // "excessValue > X for a single item" — uses ExcessWorkingApp.getRows()
  // (added alongside this plan; see excess-working.js getRows()).
  window.aimRulesRegister('inventory', 'excessItem', function () {
    if (typeof window.ExcessWorkingApp === 'undefined') return null;
    const rows = window.ExcessWorkingApp.getRows();
    if (!rows || !rows.length) return null;
    const worthy = rows
      .filter(r => r.status === 'Excess' && n(r.excessContribution) > EXCESS_ITEM_THRESHOLD)
      .sort((a, b) => n(b.excessContribution) - n(a.excessContribution));
    if (!worthy.length) return null;
    return worthy.map(r => ({
      severity: 'amber',
      msg: `🗃️ <b>${r.name}</b> — ₨${fmt(r.excessContribution)} tied up in excess stock.`,
    }));
  });

  // "Zero sales in 90 days but stock > 0" — a distinct signal from the
  // Excess Working tab's own classification, read straight from Stock
  // Ledger's raw rows (same source reorder-report.js pulls from) rather
  // than routed through either report's own filters. Reported as one
  // aggregate line, not per-item — this list can genuinely run into the
  // hundreds for an old inventory, and naming each one would flood the
  // alert stack.
  window.aimRulesRegister('inventory', 'deadStockAggregate', function () {
    const SL = window.StockLedgerApp;
    if (!SL || typeof SL.hasData !== 'function' || !SL.hasData() || typeof SL.getRawRows !== 'function') return null;
    const rows = SL.getRawRows();
    const dead = rows.filter(r => n(r.netQty90Days) === 0 && n(r.stock) > 0);
    if (!dead.length) return null;
    const value = dead.reduce((s, r) => s + n(r.stock) * n(r.unitPrice), 0);
    return {
      severity: 'amber',
      msg: `🧊 <b>${dead.length} items</b> haven't sold in 90+ days but still carry stock — roughly ₨${fmt(value)} at current unit price.`,
    };
  });

  /* ────────────────────────────────────────────────────────────────
     MANAGER
  ──────────────────────────────────────────────────────────────── */

  const SALARY_SWING_PCT = 30;      // % month-over-month swing that fires
  const SALARY_SWING_MIN_BASE = 1000; // ₨ — ignore swings on trivially small bases

  function _currentCreditMY() {
    const d = new Date();
    const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return MN[d.getMonth()] + ' ' + d.getFullYear();
  }

  // "net > salary for any staff" — net advance (credit ledger) exceeding
  // the employee's own monthly salary figure. Skips salary=0 rows: those
  // are almost always "not filled in yet" rather than a real ₨0 salary,
  // and would otherwise make every unset row look like a huge overage.
  window.aimRulesRegister('manager', 'advanceExceedsSalary', function () {
    if (typeof window._crdData !== 'function' || typeof window._crdNet !== 'function') return null;
    const my = _currentCreditMY();
    let emps = [];
    try { emps = window._crdData(my) || []; } catch (e) { return null; }
    const over = emps
      .filter(e => n(e.salary) > 0 && window._crdNet(e) > n(e.salary))
      .map(e => ({ name: e.name, net: window._crdNet(e), salary: n(e.salary) }))
      .sort((a, b) => (b.net - b.salary) - (a.net - a.salary));
    if (!over.length) return null;
    return over.map(e => ({
      severity: 'red',
      msg: `💳 <b>${e.name}</b> — net advance ₨${fmt(e.net)} exceeds monthly salary ₨${fmt(e.salary)}.`,
    }));
  });

  // "Salary swing beyond threshold" — compares the two most recent
  // months in the app's own continuous month list (mgrMonths(), which
  // already covers gaps/blank months) rather than assuming "this month"
  // has been entered yet.
  window.aimRulesRegister('manager', 'salarySwing', function () {
    if (typeof window.mgrMonths !== 'function' || typeof window._salRows !== 'function' || typeof window._salNet !== 'function') return null;
    const months = window.mgrMonths();
    if (!months || months.length < 2) return null;
    const [curMY, prevMY] = months;
    let curRows = [], prevRows = [];
    try { curRows = window._salRows(curMY) || []; prevRows = window._salRows(prevMY) || []; } catch (e) { return null; }
    const prevByName = new Map(prevRows.map(r => [String(r.name || '').trim().toLowerCase(), r]));
    const swings = [];
    curRows.forEach(r => {
      const key = String(r.name || '').trim().toLowerCase();
      const prev = prevByName.get(key);
      if (!prev) return; // no prior month to compare — not a swing, just new
      const curNet = window._salNet(r), prevNet = window._salNet(prev);
      if (Math.abs(prevNet) < SALARY_SWING_MIN_BASE) return;
      const pct = ((curNet - prevNet) / Math.abs(prevNet)) * 100;
      if (Math.abs(pct) >= SALARY_SWING_PCT) swings.push({ name: r.name, curNet, prevNet, pct });
    });
    if (!swings.length) return null;
    swings.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return swings.map(s => {
      const dir = s.pct >= 0 ? 'up' : 'down';
      return {
        severity: 'amber',
        msg: `📉 <b>${s.name}</b> salary net ${dir} ${Math.abs(Math.round(s.pct))}% (₨${fmt(s.prevNet)} → ₨${fmt(s.curNet)}) vs last month.`,
      };
    });
  });
