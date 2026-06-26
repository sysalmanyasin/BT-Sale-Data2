// ══════════════════════════════════════════════════════════════════════
// AppContext — Unified read-only snapshot of application state
// Consumed by: AI Bridge, Command Hub, Assistant Engine
// ══════════════════════════════════════════════════════════════════════

function getAppContext() {
  return Object.freeze({
    monthly:      Array.isArray(window.MONTHLY)      ? window.MONTHLY      : [],
    daily:        Array.isArray(window.DAILY)        ? window.DAILY        : [],
    staff:        Array.isArray(window.STAFF)        ? window.STAFF        : [],
    targets:      typeof window.getTgts === 'function' ? window.getTgts()  : {},
    clientCols:   typeof window.CLIENT_COLS !== 'undefined' ? window.CLIENT_COLS : [],
    bankCols:     typeof window.BANK_COLS   !== 'undefined' ? window.BANK_COLS   : [],
    returnFields: typeof window.RETURN_FIELDS !== 'undefined' ? window.RETURN_FIELDS : new Set(),
    currentPage:  typeof window._curPage !== 'undefined' ? window._curPage : '',
  });
}

// ── Rich context summary for Groq ─────────────────────────────────────────
// Includes all fields: Load Sale, DIFF, credit clients, petty, expenses
function getAppContextSummary(opts) {
  opts = opts || {};
  const fullMonths = opts.fullMonths !== undefined ? opts.fullMonths : 3;
  const ctx = getAppContext();
  const M   = ctx.monthly;
  const D   = ctx.daily;

  if (!M.length && !D.length) return 'No data loaded yet. User has not entered any sales records.';

  const n  = (typeof BTFormat !== 'undefined') ? BTFormat.num   : function(v){ return isNaN(parseFloat(v)) ? 0 : parseFloat(v); };
  const fc = (typeof BTFormat !== 'undefined') ? BTFormat.plain : function(v){ return Math.round(v).toLocaleString('en-PK'); };

  const lines = [];

  // ── Summary header ────────────────────────────────────────────────
  if (M.length) {
    const grand     = M.reduce(function(s, m){ return s + n(m.TOTAL); }, 0);
    const dateRange = M[0].Month_Year + ' to ' + M[M.length - 1].Month_Year;
    const last      = M[M.length - 1];
    const activeStaff = ctx.staff.filter(function(s){ return s.active !== false; }).length;

    lines.push('=== SALES DATA OVERVIEW ===');
    lines.push('Total months: ' + M.length + ' | Date range: ' + dateRange);
    lines.push('Grand total (all time): \u20a8' + fc(grand));
    lines.push('Latest month: ' + last.Month_Year + ' \u2014 \u20a8' + fc(n(last.TOTAL)) + ' | Customers: ' + Math.round(n(last.Customers || last['Customers'])));
    lines.push('Active staff: ' + activeStaff);
    lines.push('');
  }

  // ── Last 12 months — full breakdown ──────────────────────────────
  if (M.length) {
    lines.push('=== MONTHLY BREAKDOWN (last 12 months) ===');
    const last12 = M.slice(-12);
    last12.forEach(function(m) {
      const tot   = n(m.TOTAL);
      const cash  = n(m['Cash_Sale'] || m['Cash Sale'] || 0);
      const load  = n(m['Load_Sale'] || m['Load Sale'] || 0);
      const comp  = n(m['COMP_SALE'] || m['COMP SALE'] || 0);
      const diff  = tot - comp;
      const cust  = Math.round(n(m.Customers || m['Customers'] || 0));
      const creditTotal = (ctx.clientCols || []).reduce(function(s, c){ return s + n(m[c]); }, 0);
      let line = m.Month_Year + ': Total=\u20a8' + fc(tot) + ' | Cash=\u20a8' + fc(cash) + ' | Credit=\u20a8' + fc(creditTotal) + ' | Cust=' + cust;
      if (load > 0) line += ' | LoadSale=\u20a8' + fc(load);
      if (comp > 0) line += ' | CompSale=\u20a8' + fc(comp) + ' | DIFF=' + (diff >= 0 ? '+' : '') + fc(diff);
      lines.push('  ' + line);
    });
    lines.push('');

    // ── Credit clients breakdown (last 3 months) ──────────────────
    const activeClients = (ctx.clientCols || []).filter(function(c){
      return M.slice(-3).some(function(m){ return n(m[c]) > 0; });
    });
    if (activeClients.length) {
      lines.push('=== ACTIVE CREDIT CLIENTS (last 3 months) ===');
      activeClients.forEach(function(c) {
        const totals = M.slice(-3).map(function(m){ return fc(n(m[c])); });
        lines.push('  ' + c + ': ' + totals.join(' | '));
      });
      lines.push('');
    }
  }

  // ── Recent daily records — full field detail ──────────────────────
  if (D.length && fullMonths > 0) {
    const lastMonthNames = M.length ? M.slice(-fullMonths).map(function(m){ return m.Month_Year; }) : [];
    const recentDaily = lastMonthNames.length
      ? D.filter(function(d){ return lastMonthNames.includes(d.Month_Year); })
      : D.slice(-60);

    if (recentDaily.length) {
      lines.push('=== DAILY RECORDS (last ' + fullMonths + ' months) ===');
      lines.push('Format: Date [Month]: Total | Cash | Load | CompSale | DIFF | Customers');
      recentDaily.forEach(function(d) {
        const tot  = n(d.TOTAL || d['TOTAL']);
        const cash = n(d.Cash_Sale || d['Cash_Sale'] || d['Cash Sale'] || 0);
        const load = n(d.Load_Sale || d['Load_Sale'] || d['Load Sale'] || 0);
        const comp = n(d.COMP_SALE || d['COMP_SALE'] || d['COMP SALE'] || 0);
        const diff = tot - comp;
        const cust = Math.round(n(d.Customers || d['Customers'] || 0));
        const reason = d['Low Sale Reason'] ? ' [NOTE: ' + d['Low Sale Reason'] + ']' : '';
        let line = d.Date + ' [' + d.Month_Year + ']: \u20a8' + fc(tot);
        if (cash > 0) line += ' | Cash \u20a8' + fc(cash);
        if (load > 0) line += ' | Load \u20a8' + fc(load);
        if (comp > 0) line += ' | Comp \u20a8' + fc(comp) + ' DIFF ' + (diff >= 0 ? '+' : '') + fc(diff);
        line += ' | ' + cust + ' cust' + reason;
        lines.push('  ' + line);
      });
      lines.push('');
    }
  }

  // ── Petty cash and expense summary from manager localStorage ─────
  try {
    const mgrKey = Object.keys(localStorage).find(function(k){ return k.startsWith('mw_mgr_') || k === 'mw_manager'; });
    if (mgrKey) {
      const mgr  = JSON.parse(localStorage.getItem(mgrKey) || '{}');
      const months = M.slice(-2).map(function(m){ return m.Month_Year; });
      months.forEach(function(mon) {
        const expRows = (mgr.expense && mgr.expense[mon]) ? mgr.expense[mon] : [];
        if (expRows.length) {
          const tot = expRows.reduce(function(s, r){
            return s + (parseFloat(r.bill||0)+parseFloat(r.fuel||0)+parseFloat(r.soap||0)+parseFloat(r.refresh||0)+parseFloat(r.extra||0));
          }, 0);
          lines.push('Expense sheet ' + mon + ': \u20a8' + fc(tot) + ' (' + expRows.length + ' entries)');
        }
      });
    }
  } catch (_) {}

  if (!lines.length) return 'Data is loading. Please try again in a moment.';
  return lines.join('\n');
}
