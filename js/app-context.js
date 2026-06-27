// ══════════════════════════════════════════════════════════════════════
// AppContext — Unified read-only snapshot of application state
// Consumed by: AI Bridge, Command Hub, Assistant Engine
// Gives the AI full visibility into EVERY page: Dashboard, Index, Data,
// Diff, and every tab inside Manager (Credit, Salary, Generic, Expense,
// Petty Cash, Custom Sections) — not just the last few months.
// ══════════════════════════════════════════════════════════════════════

const MGR_STORAGE_KEY = 'BT_ManagerWork_v1';

function getAppContext() {
  return Object.freeze({
    monthly:      Array.isArray(MONTHLY)      ? MONTHLY      : [],
    daily:        Array.isArray(DAILY)        ? DAILY        : [],
    staff:        Array.isArray(STAFF)        ? STAFF        : [],
    targets:      typeof window.getTgts === 'function' ? window.getTgts()  : {},
    // CLIENT_COLS / BANK_COLS / RETURN_FIELDS are `const` in config.js and
    // _curPage is `let` in storage.js — neither attaches to window, so
    // window.X is always undefined.  Reference as bare identifiers instead.
    clientCols:   typeof CLIENT_COLS   !== 'undefined' ? CLIENT_COLS   : [],
    bankCols:     typeof BANK_COLS     !== 'undefined' ? BANK_COLS     : [],
    returnFields: typeof RETURN_FIELDS !== 'undefined' ? RETURN_FIELDS : new Set(),
    currentPage:  typeof _curPage      !== 'undefined' ? _curPage      : '',
  });
}

function _acNum(v) {
  return (typeof BTFormat !== 'undefined') ? BTFormat.num(v) : (isNaN(parseFloat(v)) ? 0 : parseFloat(v));
}
function _acFc(v) {
  return (typeof BTFormat !== 'undefined') ? BTFormat.plain(v) : Math.round(v).toLocaleString('en-PK');
}
function _acMgrLoad() {
  try { return JSON.parse(localStorage.getItem(MGR_STORAGE_KEY) || '{}'); } catch (_) { return {}; }
}
function _acPettyTotalForMonth(my) {
  try {
    const raw = localStorage.getItem('mw_petty_' + my);
    if (!raw) return { total: 0, count: 0 };
    const data = JSON.parse(raw);
    const groups = data.groups || [];
    let total = 0, count = 0;
    groups.forEach(function (g) {
      (g.rows || []).forEach(function (r) { total += _acNum(r.amount); count++; });
    });
    return { total: total, count: count };
  } catch (_) { return { total: 0, count: 0 }; }
}

// ── Rich, FULL context summary for Groq — covers every page in the app ────
// opts.fullMonths: 'all' (default) sends every daily record; pass a number
// to cap it for unusually large datasets.
function getAppContextSummary(opts) {
  opts = opts || {};
  const fullMonths = opts.fullMonths !== undefined ? opts.fullMonths : 'all';
  const ctx = getAppContext();
  const M   = ctx.monthly;
  const D   = ctx.daily;

  if (!M.length && !D.length) return 'No data loaded yet. User has not entered any sales records.';

  const n  = _acNum;
  const fc = _acFc;
  const lines = [];

  // ── 1. SUMMARY HEADER (Dashboard hero) ────────────────────────────
  if (M.length) {
    const grand       = M.reduce(function (s, m) { return s + n(m.TOTAL); }, 0);
    const dateRange   = M[0].Month_Year + ' to ' + M[M.length - 1].Month_Year;
    const last        = M[M.length - 1];
    const prev        = M.length > 1 ? M[M.length - 2] : null;
    const activeStaff = ctx.staff.filter(function (s) { return s.active !== false; }).length;
    const cagr        = (typeof yearlyCAGR === 'function') ? yearlyCAGR() : null;
    const tgts        = ctx.targets || {};
    const latTgt       = n(tgts[last.Month_Year]);
    const cumDiff      = M.reduce(function (s, m) { return s + Math.round(n(m.TOTAL) - n(m['COMP SALE'] || m['COMP_SALE'])); }, 0);
    const bScore       = (typeof branchScore === 'function' && prev) ? branchScore(last, prev, latTgt, n(last.TOTAL)) : null;

    lines.push('=== DASHBOARD OVERVIEW (all-time, every page) ===');
    lines.push('Total months recorded: ' + M.length + ' | Total daily records: ' + D.length + ' | Date range: ' + dateRange);
    lines.push('Grand total sales (all time, cumulative since start): \u20a8' + fc(grand));
    lines.push('Latest month: ' + last.Month_Year + ' \u2014 \u20a8' + fc(n(last.TOTAL)) + ' | Customers: ' + Math.round(n(last.Customers || last['Customers'])));
    if (latTgt) lines.push('Latest month target: \u20a8' + fc(latTgt) + ' (' + Math.round(n(last.TOTAL) / latTgt * 100) + '% achieved so far)');
    if (cagr != null) lines.push('CAGR since first 12 months: ' + cagr.toFixed(1) + '%');
    if (bScore != null) lines.push('Branch Performance Score (latest): ' + bScore + '/100');
    lines.push('Cumulative CC Difference (Total \u2212 Comp Sale, all months): ' + (cumDiff >= 0 ? '+' : '') + '\u20a8' + fc(cumDiff) + ' (' + (cumDiff >= 0 ? 'physical ahead of system' : 'system ahead of physical') + ')');
    lines.push('Active staff: ' + activeStaff);
    lines.push('');
  }

  // ── 2. ALL TARGETS (every month, not just latest) ─────────────────
  if (ctx.targets && Object.keys(ctx.targets).length) {
    lines.push('=== TARGETS (all months set) ===');
    Object.entries(ctx.targets).forEach(function (e) {
      lines.push('  ' + e[0] + ': \u20a8' + fc(n(e[1])));
    });
    lines.push('');
  }

  // ── 3. EVERY MONTH on record (Index / Month Index page) ───────────
  if (M.length) {
    lines.push('=== MONTHLY BREAKDOWN \u2014 ALL ' + M.length + ' MONTHS (Index page) ===');
    lines.push('Format: Month: Total | Cash | Credit | Cust | LoadSale | CompSale | DIFF');
    M.forEach(function (m) {
      const tot   = n(m.TOTAL);
      const cash  = (typeof cashSales === 'function') ? cashSales(m) : n(m['Cash_Sale'] || m['Cash Sale'] || 0);
      const load  = n(m['Load_Sale'] || m['Load Sale'] || 0);
      const comp  = n(m['COMP_SALE'] || m['COMP SALE'] || 0);
      const diff  = tot - comp;
      const cust  = Math.round(n(m.Customers || m['Customers'] || 0));
      const creditTotal = (typeof creditSales === 'function') ? creditSales(m) : (ctx.clientCols || []).reduce(function (s, c) { return s + n(m[c]); }, 0);
      let line = m.Month_Year + ': \u20a8' + fc(tot) + ' | Cash \u20a8' + fc(cash) + ' | Credit \u20a8' + fc(creditTotal) + ' | Cust ' + cust;
      if (load > 0) line += ' | Load \u20a8' + fc(load);
      if (comp > 0) line += ' | Comp \u20a8' + fc(comp) + ' | DIFF ' + (diff >= 0 ? '+' : '') + fc(diff);
      lines.push('  ' + line);
    });
    lines.push('');

    // Credit clients — full history, every month they had activity
    const activeClients = (ctx.clientCols || []).filter(function (c) {
      return M.some(function (m) { return n(m[c]) > 0; });
    });
    if (activeClients.length) {
      lines.push('=== CREDIT CLIENTS \u2014 monthly totals, all months (Manager > Credit / Dashboard) ===');
      activeClients.forEach(function (c) {
        const clientTotal = M.reduce(function (s, m) { return s + n(m[c]); }, 0);
        lines.push('  ' + c + ': all-time total \u20a8' + fc(clientTotal));
      });
      lines.push('');
    }
  }

  // ── 4. EVERY DAILY RECORD (Daily Data page) ────────────────────────
  if (D.length) {
    const useAll = fullMonths === 'all' || fullMonths >= M.length;
    const monthNames = useAll ? null : M.slice(-fullMonths).map(function (m) { return m.Month_Year; });
    const dailySet = monthNames ? D.filter(function (d) { return monthNames.includes(d.Month_Year); }) : D;

    lines.push('=== DAILY RECORDS \u2014 ' + (useAll ? 'ALL ' + dailySet.length + ' DAYS ON RECORD' : 'last ' + fullMonths + ' months') + ' (Data page) ===');
    lines.push('Format: Date [Month]: Total | Cash | Credit | DIFF | Customers');
    dailySet.forEach(function (d) {
      const tot   = n(d.TOTAL);
      // Daily records use underscore keys (Cash_Sale, Alfala_Bank…) not the space keys
      // that cashSales()/mBanks() read from MONTHLY — compute directly from both formats.
      const _dv   = function(k) { return n(d[k] !== undefined ? d[k] : d[k.replace(/ /g,'_')]); };
      const cash  = _dv('Cash_Sale') + _dv('HBL') + _dv('MCB') +
                    _dv('Alfala_Bank') + _dv('Bank_Al_Habib') + _dv('Meezan_Bank') + _dv('Askari_Bank') -
                    Math.abs(_dv('Cash_Returns'));
      const comp  = n(d['COMP SALE'] || d['COMP_SALE'] || 0);
      const diff  = comp ? (tot - comp) : null;
      // creditSales() reads CLIENT_COLS with space keys — also fails on daily underscore keys.
      // Read both key formats so multi-word clients (Wapda Hospital → Wapda_Hospital) resolve.
      const credit = (typeof CLIENT_COLS !== 'undefined' ? CLIENT_COLS : []).reduce(function(s, c) {
        return s + n(d[c] !== undefined ? d[c] : d[c.replace(/ /g,'_')]);
      }, 0);
      const cust  = Math.round(n(d.Customers || d['Customers'] || 0));
      const reason = d['Low Sale Reason'] ? ' [NOTE: ' + d['Low Sale Reason'] + ']' : '';
      let line = d.Date + ' [' + d.Month_Year + ']: \u20a8' + fc(tot);
      if (cash)   line += ' | Cash \u20a8' + fc(cash);
      if (credit) line += ' | Credit \u20a8' + fc(credit);
      if (diff != null) line += ' | DIFF ' + (diff >= 0 ? '+' : '') + fc(diff);
      line += ' | ' + cust + ' cust' + reason;
      lines.push('  ' + line);
    });
    lines.push('');
  }

  // ── 5. MANAGER DATA — Credit Ledger, Salary, Generic, Expense, ALL months ──
  const mgr = _acMgrLoad();

  if (mgr.credit && Object.keys(mgr.credit).length) {
    lines.push('=== MANAGER > STAFF CREDIT LEDGER (every month, every staff entry) ===');
    Object.entries(mgr.credit).forEach(function (e) {
      const my = e[0], emps = e[1] || [];
      emps.forEach(function (emp) {
        const entryTotal = (emp.entries || []).reduce(function (s, en) { return s + n(en.amount); }, 0);
        const net = n(emp.prevBal) + entryTotal - n(emp.salary) - n(emp.lessGeneric);
        let line = my + ' \u2014 ' + emp.name + ': net balance \u20a8' + fc(net);
        if ((emp.entries || []).length) {
          line += ' [' + emp.entries.map(function (en) { return en.date + ' ' + (en.desc || '') + ' \u20a8' + fc(n(en.amount)); }).join('; ') + ']';
        }
        lines.push('  ' + line);
      });
    });
    lines.push('');
  }

  if (mgr.salary && Object.keys(mgr.salary).length) {
    lines.push('=== MANAGER > SALARY SHEET (every month) ===');
    Object.entries(mgr.salary).forEach(function (e) {
      const my = e[0], rows = e[1] || [];
      rows.forEach(function (r) {
        const net = n(r.hoSal) - n(r.advance) + n(r.generic);
        lines.push('  ' + my + ' \u2014 ' + r.name + ' (' + (r.desig || '') + '): HO Salary \u20a8' + fc(r.hoSal) + ', Advance \u20a8' + fc(r.advance) + ', Generic \u20a8' + fc(r.generic) + ', Net \u20a8' + fc(net));
      });
    });
    lines.push('');
  }

  if (mgr.generic && Object.keys(mgr.generic).length) {
    lines.push('=== MANAGER > GENERIC WORKING (every month) ===');
    Object.entries(mgr.generic).forEach(function (e) {
      const my = e[0], rows = e[1] || [];
      rows.forEach(function (r) {
        const incentive = Math.round(n(r.genericSale) * 0.04);
        lines.push('  ' + my + ' \u2014 ' + r.name + ': Generic Sale \u20a8' + fc(r.genericSale) + ', Incentive \u20a8' + fc(incentive) + ', Extra \u20a8' + fc(r.extra));
      });
    });
    lines.push('');
  }

  if (mgr.expense && Object.keys(mgr.expense).length) {
    lines.push('=== MANAGER > EXPENSE SHEET (every month) ===');
    Object.entries(mgr.expense).forEach(function (e) {
      const my = e[0], rows = e[1] || [];
      const tot = rows.reduce(function (s, r) { return s + n(r.bill) + n(r.fuel) + n(r.soap) + n(r.refresh) + n(r.extra) + n(r.pattyHO); }, 0);
      lines.push('  ' + my + ': \u20a8' + fc(tot) + ' total (' + rows.length + ' entries)');
      rows.forEach(function (r) {
        lines.push('    ' + r.date + ' ' + (r.desc || '') + ': \u20a8' + fc(n(r.bill) + n(r.fuel) + n(r.soap) + n(r.refresh) + n(r.extra) + n(r.pattyHO)));
      });
    });
    lines.push('');
  }

  // ── 6. PETTY CASH (every month, scanning localStorage) ─────────────
  try {
    const pettyMonths = Object.keys(localStorage)
      .filter(function (k) { return k.indexOf('mw_petty_') === 0; })
      .map(function (k) { return k.replace('mw_petty_', ''); });
    if (pettyMonths.length) {
      lines.push('=== MANAGER > PETTY CASH (every month) ===');
      pettyMonths.forEach(function (my) {
        const p = _acPettyTotalForMonth(my);
        if (p.count) lines.push('  ' + my + ': \u20a8' + fc(p.total) + ' (' + p.count + ' items)');
      });
      lines.push('');
    }
  } catch (_) {}

  // ── 7. CUSTOM SECTIONS in Manager (e.g. Jazz Cash) — all entries ───
  try {
    const secs = JSON.parse(localStorage.getItem('mw_custom_sections_v1') || '{}');
    const ids = Object.keys(secs);
    if (ids.length) {
      lines.push('=== MANAGER > CUSTOM SECTIONS (all entries) ===');
      ids.forEach(function (id) {
        const s = secs[id];
        const rows = s.rows || s.entries || [];
        const tot = rows.reduce(function (sum, r) { return sum + n(r.amount); }, 0);
        lines.push('  ' + (s.emoji || '') + ' ' + s.name + ': \u20a8' + fc(tot) + ' total (' + rows.length + ' entries)');
        rows.forEach(function (r) {
          lines.push('    ' + (r.date || r.desc || '') + ' ' + (r.notes || '') + ': \u20a8' + fc(n(r.amount)));
        });
      });
      lines.push('');
    }
  } catch (_) {}

  if (!lines.length) return 'Data is loading. Please try again in a moment.';
  return lines.join('\n');
}
