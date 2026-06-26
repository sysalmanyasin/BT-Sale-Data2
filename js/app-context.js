// ══════════════════════════════════════════════════════════════════════
// AppContext — Step 1: Unified read-only snapshot of application state
// Consumed by: Assistant Engine, AI Bridge, Command Hub Engine
// Step 9: getAppContextSummary() — compact context for LLM calls
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

// Step 9: getAppContextSummary() — compact token-efficient text for LLM context
// Older data is summarised; only recent detailed data is sent in full.
function getAppContextSummary(opts) {
  opts = opts || {};
  const fullMonths = opts.fullMonths !== undefined ? opts.fullMonths : 3;
  const ctx = getAppContext();
  const M   = ctx.monthly;
  const D   = ctx.daily;
  if (!M.length) return 'No monthly data loaded.';

  const n  = BTFormat.num;
  const fc = BTFormat.plain;

  const grand     = M.reduce((s, m) => s + n(m.TOTAL), 0);
  const dateRange = M[0].Month_Year + ' – ' + M[M.length - 1].Month_Year;
  const last      = M[M.length - 1];
  const activeStaff = ctx.staff.filter(s => s.active !== false).length;

  const activeClients = (ctx.clientCols || []).filter(c =>
    M.slice(-3).some(m => n(m[c]) > 0)
  );

  const last12 = M.slice(-12).map(m => {
    const creditTotal = (ctx.clientCols || []).reduce((s, c) => s + n(m[c]), 0);
    return [
      m.Month_Year,
      fc(n(m.TOTAL)),
      fc(n(m['Cash Sale'])),
      fc(creditTotal),
      Math.round(n(m.Customers)),
    ];
  });

  const recentDaily = fullMonths > 0
    ? D.filter(d => {
        const lastMonthNames = M.slice(-fullMonths).map(m => m.Month_Year);
        return lastMonthNames.includes(d.Month_Year);
      })
    : [];

  const lines = [
    `Total months of data: ${M.length}`,
    `Date range: ${dateRange}`,
    `Grand total: ₨ ${fc(grand)}`,
    `Last month: ${last.Month_Year} — ₨ ${fc(n(last.TOTAL))}`,
    `Active credit clients (last 3 months): ${activeClients.join(', ') || 'none'} (${activeClients.length} total)`,
    `Staff: ${activeStaff} active employees`,
    '',
    'Last 12 months [Month, Total, Cash, Credit, Customers]:',
    ...last12.map(r => `  ${r[0]}: ₨${r[1]} | Cash ₨${r[2]} | Credit ₨${r[3]} | Cust ${r[4]}`),
  ];

  if (recentDaily.length) {
    lines.push('', `Full daily records (last ${fullMonths} months):`);
    recentDaily.forEach(d =>
      lines.push(`  ${d.Date} [${d.Month_Year}]: ₨${fc(n(d.TOTAL))} Cust:${n(d.Customers)}`)
    );
  }

  return lines.join('\n');
}
