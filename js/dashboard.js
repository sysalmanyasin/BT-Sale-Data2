// ══════════════════════════════════════════
// FLOOR 5 — buildDashboard (pure renderer)
//
// All computation is now done by Analytics.getDashboardKPIs() and
// Analytics.getCreditSectionData() (Floor 3 / analytics.js).
// buildDashboard() only maps their output to DOM — no business logic
// lives here. This closes audit finding CF-03.
// ══════════════════════════════════════════

// Tracks user's chosen month for the dashboard credit section.
// Empty string = auto-select (latest with manager data / latest sales month).
// Set via the inline <select> rendered inside buildCreditSection().
(function() {
'use strict';

let _dashCreditMonthOverride = '';
// Monthly Total chart's own preset/compare state (Rule-Based Intelligence
// Plan §2/§3.1) — independent of the #dash-year select above it, which
// still governs the rest of buildCharts()'s KPI-driven charts (Cash vs
// Bank, Top Clients, Customers, YoY). Only the Monthly Total chart uses
// DashboardControls; the rest are unchanged this round (see plan's own
// "built once, reused per domain" — reusing here is a follow-up, not a
// rewrite of every chart in one pass).
let _dashTotalPreset = '12M';
let _dashTotalCompareOn = false;
// Patty/Expenses card on Overview — its own date-range filter (independent
// of the Staff Credit month picker above) plus which category rows are
// currently expanded to show individual entries. In-memory only, same as
// the credit-month override — resets on page reload.
let _dashPattyDateFrom = '';
let _dashPattyDateTo = '';
const _dashPattyExpanded = new Set();
// Which quick-preset button (if any) is currently active, purely for
// highlighting the matching pill. Cleared whenever the user edits either
// date input by hand or hits Reset, so a stale pill never stays lit once
// the range no longer matches it.
let _dashPattyActivePreset = '';

// Called by the month <select> inside the credit section on the dashboard.
// Re-renders the credit block and the Working Summary for the chosen month.
function dashSetCreditMonth(my) {
  _dashCreditMonthOverride = my;
  const resolved = my || _dashDefaultCreditMonth();
  buildCreditSection(resolved);
  if (typeof populateDashWorking === 'function') populateDashWorking(resolved || '');
}

// Patty/Expenses card's own From/To filter — re-renders just the credit
// section (not the whole dashboard) against whichever month/credit-month
// is currently selected, same as dashSetCreditMonth above.
function dashSetPattyDateFrom(v) { _dashPattyDateFrom = v; _dashPattyActivePreset = ''; buildCreditSection(_dashCreditMonthOverride || _dashDefaultCreditMonth()); }
function dashSetPattyDateTo(v)   { _dashPattyDateTo = v; _dashPattyActivePreset = ''; buildCreditSection(_dashCreditMonthOverride || _dashDefaultCreditMonth()); }
function dashClearPattyDates()   { _dashPattyDateFrom = ''; _dashPattyDateTo = ''; _dashPattyActivePreset = ''; buildCreditSection(_dashCreditMonthOverride || _dashDefaultCreditMonth()); }

// Quick-preset ranges for the Patty/Expenses card, all anchored to the
// current calendar month (not whichever month Staff Credit is showing —
// this card is its own all-time/date-filtered view). Weeks are fixed
// day-of-month bands (01-07 / 08-14 / 15-22 / 23-end) rather than actual
// Mon-Sun weeks, matching how the branch already talks about "1st week,
// 2nd week" for petty cash reconciliation.
function _dashPattyPresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = n => String(n).padStart(2, '0');
  const iso = (dd) => `${y}-${pad(m + 1)}-${pad(dd)}`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  switch (preset) {
    case 'month': return [iso(1), iso(lastDay)];
    case 'w1':    return [iso(1), iso(7)];
    case 'w2':    return [iso(8), iso(14)];
    case 'w3':    return [iso(15), iso(22)];
    case 'w4':    return [iso(23), iso(lastDay)];
    default:      return ['', ''];
  }
}

function dashSetPattyPreset(preset) {
  const [from, to] = _dashPattyPresetRange(preset);
  _dashPattyDateFrom = from;
  _dashPattyDateTo = to;
  _dashPattyActivePreset = preset;
  buildCreditSection(_dashCreditMonthOverride || _dashDefaultCreditMonth());
}
function dashTogglePattyCat(catId) {
  if (_dashPattyExpanded.has(catId)) _dashPattyExpanded.delete(catId); else _dashPattyExpanded.add(catId);
  buildCreditSection(_dashCreditMonthOverride || _dashDefaultCreditMonth());
}

// Staff Credit's own default month — deliberately NOT the same as
// _dashRunningMonth() below. Staff Credit is the one card that's still
// genuinely month-scoped (each month starts empty until "Copy → Next
// Month" is run), and that rollover often lags the calendar by 10-12
// days (salaries settled on the 10th-12th). Defaulting this card to
// today's literal date meant it went blank — and Total Outstanding
// Credits silently dropped to ~0 — for the first ~12 days of every
// month, even though last month's staff balances were still genuinely
// owed. Uses Analytics.latestStaffCreditMonth() specifically (NOT
// latestManagerMonth() — that one also counts Salary/Generic/Petty/
// Incentive activity, any of which can easily exist for the new month
// already while Staff Credit itself is still empty, which would wrongly
// jump this card to the new month early). Keeps showing the last month
// with real credit rows until Copy → Next Month actually opens the new
// one — matching what the Cover page's Total Outstanding Credits tile
// does. Falls back to the plain running month only if there's no credit
// data anywhere yet.
function _dashDefaultCreditMonth() {
  try {
    const A = window.Analytics;
    const latest = A && typeof A.latestStaffCreditMonth === 'function' ? A.latestStaffCreditMonth() : '';
    if (latest) return latest;
  } catch (e) {}
  return _dashRunningMonth();
}

// The default month for every "current" dashboard card — always the
// running calendar month from day 1, even before any Manager data (or
// even any sales) has been entered for it yet. Previously this defaulted
// to Analytics.latestManagerMonth()/latestSalesMonth(), which silently
// fell back to the last month that happened to have data — so on day 1
// of a new month (before Jazz Cash/Expense/credit entries exist yet) the
// dashboard kept showing last month instead. A past month is still one
// dropdown pick away (see _dashCreditMonthOptions()); it's just never the
// unrequested default again.
function _dashRunningMonth() {
  return (typeof BTDate !== 'undefined' && BTDate.currentMonthYear)
    ? BTDate.currentMonthYear()
    : (() => { const d = new Date();
        const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return MN[d.getMonth()] + ' ' + d.getFullYear(); })();
}

// Returns a sorted list of the last N month-year strings that have either
// sales data or manager data — used to populate the dashboard month picker.
function _dashCreditMonthOptions(n_) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July',
                       'August','September','October','November','December'];
  const sortVal = my => {
    const p = String(my || '').split(' ');
    const i = MONTH_NAMES.indexOf(p[0]);
    const y = parseInt(p[1], 10);
    return i >= 0 && !isNaN(y) ? y * 12 + i : -1;
  };
  const now = new Date();
  const curVal = now.getFullYear() * 12 + now.getMonth();
  const candidates = new Set();
  // Include MONTHLY entries (sales data)
  MONTHLY.forEach(m => { if (sortVal(m.Month_Year) <= curVal) candidates.add(m.Month_Year); });
  // Include current calendar month even if no sales yet (for manager-only months)
  candidates.add(MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear());
  return Array.from(candidates)
    .sort((a, b) => sortVal(b) - sortVal(a))
    .slice(0, n_ || 6);
}

function buildDashboard() {
  if (typeof buildDashboardInsights === 'function') buildDashboardInsights();
  if (!MONTHLY.length || MONTHLY.length < 2) return;

  // ── Get all KPI data from Analytics (Floor 3) ──────────────────
  const kd = Analytics.getDashboardKPIs();
  if (!kd) return;

  const {
    lat, isLive, D, vsLabel, ytdVsLabel,
    gTotal, dailyRecordCount,
    prvTotal, prvCash, prvCredit, prvCustomers,
    ytd, pYtd, curY,
    latTgt, latAct, latDays, daysInMon, forecastTotal,
    avgBill, pAvgBill,
    cagr, bScore, cumDiff,
  } = kd;

  // ── Hero numbers ───────────────────────────────────────────────
  document.getElementById('grand-total').textContent = fc(gTotal);
  document.getElementById('hero-sub').textContent =
    MONTHLY.length + ' months · ' + dailyRecordCount + ' records · Latest: ' + lat.Month_Year;

  // ── Build KPI card array (pure data → template strings) ────────
  const yr   = document.getElementById('dash-year')?.value;
  const data = yr ? MONTHLY.filter(m => m.Month_Year.endsWith(yr)) : MONTHLY;

  const kpis = [
    ...(latTgt ? [{
      label: isLive
        ? ('🎯 Forecast vs Target — ' + lat.Month_Year)
        : ('🎯 Final vs Target — ' + lat.Month_Year),
      value: Math.min(100, Math.round(forecastTotal / latTgt * 100)) + '% of ₨' + ff(latTgt),
      sub: isLive
        ? ('Projected ₨' + fc(forecastTotal) + ' · Day ' + latDays + '/' + daysInMon)
        : ('Closed · ' + latDays + ' sale days · ' + daysInMon + '-day month'),
      bar:   { pct: Math.min(100, Math.round(forecastTotal / latTgt * 100)), cls: forecastTotal / latTgt >= 1 ? 'g' : forecastTotal / latTgt >= .75 ? 'a' : 'r' },
      extra: isLive
        ? ('Remaining ₨' + fc(Math.max(0, latTgt - latAct)))
        : (latAct >= latTgt ? '✓ Target achieved' : 'Shortfall ₨' + fc(latTgt - latAct)),
      borderColor: forecastTotal / latTgt >= 1 ? 'var(--green)' : forecastTotal / latTgt >= .75 ? 'var(--amber)' : 'var(--red)',
    }] : []),
    { label: 'Latest Month' + (isLive ? ' (day 1–' + D + ')' : ''), value: '₨ ' + ff(n(lat.TOTAL)), delta: pct(n(lat.TOTAL), prvTotal) + ' ' + vsLabel, up: n(lat.TOTAL) >= prvTotal },
    { label: 'Cash Sales (Cash+Bank)',  value: '₨ ' + ff(cashSales(lat)),   delta: pct(cashSales(lat),   prvCash)      + ' ' + vsLabel, up: cashSales(lat)   >= prvCash },
    { label: 'Credit Sales',            value: '₨ ' + ff(creditSales(lat)), delta: pct(creditSales(lat), prvCredit)    + ' ' + vsLabel, up: creditSales(lat) >= prvCredit },
    { label: 'Avg Bill Size',           value: '₨ ' + ff(avgBill),          delta: pct(avgBill, pAvgBill) + ' vs prev',                 up: avgBill          >= pAvgBill },
    { label: 'Customers (Latest)',       value: fc(n(lat.Customers)),        delta: pct(n(lat.Customers), prvCustomers) + ' ' + vsLabel, up: n(lat.Customers) >= prvCustomers },
    { label: 'YTD ' + curY,             value: '₨ ' + ff(ytd),             delta: pct(ytd, pYtd) + ' ' + ytdVsLabel,                  up: ytd              >= pYtd },
    ...(cagr != null ? [{ label: 'CAGR Since 2020', value: cagr.toFixed(1) + '%', sub: 'TTM vs first 12 months' }] : []),
    ...(bScore != null ? [{
      label: 'Branch Performance Score', value: bScore + '/100',
      bar: { pct: bScore, cls: bScore >= 75 ? 'g' : bScore >= 50 ? 'a' : 'r' },
      borderColor: bScore >= 75 ? 'var(--green)' : bScore >= 50 ? 'var(--amber)' : 'var(--red)',
    }] : []),
    (()=>{
      const sign = cumDiff >= 0 ? '+' : '';
      const col  = cumDiff > 0 ? 'var(--green)' : cumDiff < 0 ? 'var(--red)' : 'var(--muted)';
      const lbl  = cumDiff > 0 ? 'Physical ahead of system' : 'System ahead of physical';
      return { label: '📉 CC Difference', value: sign + '₨ ' + ff(cumDiff), sub: lbl + ' · ' + MONTHLY.length + ' months', borderColor: col };
    })(),
  ];

  document.getElementById('krow').innerHTML = kpis.map(k => `
    <div class="kpi" style="${k.borderColor ? 'border-color:' + k.borderColor : ''}">
      <div class="klabel">${k.label}</div>
      <div class="kvalue">${k.value}</div>
      ${k.bar ? '<div class="kpbar"><div class="kpfill ' + k.bar.cls + '" style="width:' + k.bar.pct + '%"></div></div>'
              : (k.delta ? '<div class="kdelta ' + (k.up ? 'up' : 'dn') + '">' + (k.up ? '▲' : '▼') + ' ' + k.delta + '</div>' : '')}
      ${k.sub   ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">'  + k.sub   + '</div>' : ''}
      ${k.extra ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + k.extra + '</div>' : ''}
    </div>`).join('');

  buildCharts(data);
  buildSummaryTable();
  buildTop10Days();
  buildDayOfWeek();
  buildBestWorstPerYear();

  // Manager month: use user override if set, otherwise Staff Credit's
  // own default (see _dashDefaultCreditMonth() — latest month with real
  // credit data, since salary rollover lags the calendar by ~10-12 days).
  const managerMonth = _dashCreditMonthOverride || _dashDefaultCreditMonth();
  buildCreditSection(managerMonth);
  if (typeof populateDashWorking === 'function') populateDashWorking(managerMonth || '');
}

// ══════════════════════════════════════════
// DASHBOARD CREDIT DETAILS SECTION
// ══════════════════════════════════════════
// ── Delegators to Analytics (Floor 3) — dashboard.js no longer owns ──
// these computations. They are kept as named wrappers so any other code
// in this file that called them by their old names still works.
function _monthSortVal(my)            { return Analytics._monthSortVal(my); }
function _currentMonthVal()           { return Analytics._currentMonthVal(); }
function managerMonthHasData(my)      { return Analytics.managerMonthHasData(my); }
function latestManagerMonth()         { return Analytics.latestManagerMonth(); }

// ── FLOOR 5 renderer — buildCreditSection ────────────────────────────
// Data fetching fully delegated to Analytics.getCreditSectionData()
// (Floor 3). This function only maps the result to HTML (closes CF-04).
function buildCreditSection(lat) {
  const el = document.getElementById('dash-credit-section');
  if (!el || !lat) return;

  const my = typeof lat === 'string' ? lat : lat.Month_Year;

  // All data aggregation lives in Analytics (Floor 3). Patty/Expenses'
  // own date filter is passed through here — every other section stays
  // all-time regardless of it (see _ledgerBreakdown's own comment).
  const d = Analytics.getCreditSectionData(my, _dashPattyDateFrom, _dashPattyDateTo);

  // ── Pure render helpers ────────────────────────────────────────
  const fmtAmt  = v => (v < 0 ? '−' : '') + '₨' + _fc2(Math.abs(v));
  const amtColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)';
  const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const detailRows = rows => rows.map(r => `
    <div class="mgr-card-row">
      <span style="font-size:11px;color:var(--t2)">${r.name}</span>
      <span style="font-size:11px;font-family:var(--mono);font-weight:600;color:${amtColor(r.net)}">${fmtAmt(r.net)}</span>
    </div>`).join('') || `<div style="font-size:11px;color:var(--muted);padding:4px 0">No activity yet</div>`;

  const sectionCard = (icon, title, rows, total, navTab, tint) => {
    const t = tint || { accent: 'var(--accent)', bg: 'var(--alt)' };
    return `
    <div class="mgr-card" style="--card-accent:${t.accent};--card-bg:${t.bg}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--t2)">
          <span class="mgr-card-icon">${icon}</span>${title}
          ${navTab ? `<span onclick="navigateTo('manager');setTimeout(()=>{switchMgrTab('${navTab}');},200)" class="mgr-card-open">OPEN ↗</span>` : ''}
        </div>
        <div class="mgr-card-total" style="color:${amtColor(total)}">${fmtAmt(total)}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:6px">${detailRows(rows)}</div>
    </div>`;
  };

  // ── Patty/Expenses card — its own expandable-by-category rows ────────
  // Each category row (Bill Amount, Fuel/HO, ...) is clickable; expanding
  // it lists that category's individual entries (date, description,
  // signed amount) directly underneath, using the same filtered `entries`
  // _ledgerBreakdown already attached per row — no second data pass.
  const pattyEntryRow = e => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0 4px 16px;border-bottom:1px dashed var(--border)">
      <span style="font-size:10.5px;color:var(--muted)">${_esc(e.date || '—')}${e.desc ? ' · ' + _esc(e.desc) : ''}</span>
      <span style="font-size:10.5px;font-family:var(--mono);color:${amtColor(e.sign * e.amount)}">${fmtAmt(e.sign * e.amount)}</span>
    </div>`;

  const pattyDetailRows = rows => rows.map(r => {
    const expandable = !!r.catId && r.entries && r.entries.length;
    const isOpen = expandable && _dashPattyExpanded.has(r.catId);
    return `
    <div>
      <div class="mgr-card-row" style="${expandable ? 'cursor:pointer' : ''}"
        ${expandable ? `onclick="dashTogglePattyCat('${r.catId}')"` : ''}>
        <span style="font-size:11px;color:var(--t2)">${expandable ? (isOpen ? '▾ ' : '▸ ') : ''}${r.name}${expandable ? ` <span style="color:var(--muted);font-weight:400">(${r.entries.length})</span>` : ''}</span>
        <span style="font-size:11px;font-family:var(--mono);font-weight:600;color:${amtColor(r.net)}">${fmtAmt(r.net)}</span>
      </div>
      ${isOpen ? r.entries.map(pattyEntryRow).join('') : ''}
    </div>`;
  }).join('') || `<div style="font-size:11px;color:var(--muted);padding:4px 0">${(_dashPattyDateFrom || _dashPattyDateTo) ? 'No entries in this date range' : 'No activity yet'}</div>`;

  const pattyTint = { accent: 'var(--amber)', bg: 'var(--alt2)' };
  const pattyCardHtml = `
    <div class="mgr-card" style="--card-accent:${pattyTint.accent};--card-bg:${pattyTint.bg}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-size:12px;font-weight:700;color:var(--t2)">
          <span class="mgr-card-icon">🧾</span>Patty / Expenses ${d.pattyIsFiltered ? '(filtered)' : '(all-time)'}
          <span onclick="navigateTo('manager');setTimeout(()=>{switchMgrTab('expense');},200)" class="mgr-card-open">OPEN ↗</span>
        </div>
        <div class="mgr-card-total" style="color:${amtColor(d.pattyTotal)}">${fmtAmt(d.pattyTotal)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <input type="date" value="${_esc(_dashPattyDateFrom)}" onchange="dashSetPattyDateFrom(this.value)"
          style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">
        <span style="font-size:10px;color:var(--muted)">to</span>
        <input type="date" value="${_esc(_dashPattyDateTo)}" onchange="dashSetPattyDateTo(this.value)"
          style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text)">
        ${(_dashPattyDateFrom || _dashPattyDateTo) ? `<span onclick="dashClearPattyDates()" style="font-size:10px;color:var(--red,#dc2626);cursor:pointer;text-decoration:underline">✕ Clear</span>` : ''}
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        ${[
          ['month', 'This Month'],
          ['w1', 'Wk1 (01-07)'],
          ['w2', 'Wk2 (08-14)'],
          ['w3', 'Wk3 (15-22)'],
          ['w4', 'Wk4 (23-End)'],
        ].map(([key, label]) => `
        <span onclick="dashSetPattyPreset('${key}')"
          style="font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:20px;cursor:pointer;white-space:nowrap;
            ${_dashPattyActivePreset === key
              ? 'background:' + pattyTint.accent + ';color:#fff;border:1px solid ' + pattyTint.accent
              : 'background:var(--s2);color:var(--t2);border:1px solid var(--border)'}">${label}</span>`).join('')}
        <span onclick="dashClearPattyDates()"
          style="font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:20px;cursor:pointer;white-space:nowrap;
            background:var(--s2);color:var(--red,#dc2626);border:1px solid var(--border)">↺ Reset</span>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:6px">${pattyDetailRows(d.pattyRows)}</div>
    </div>`;

  // Build month picker options — sorted newest-first, limited to 6 months
  const monthOpts = _dashCreditMonthOptions(6);
  const monthPickerOpts = monthOpts.map(m =>
    `<option value="${m}"${m === my ? ' selected' : ''}>${m}</option>`
  ).join('');

  el.innerHTML = `
    <div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">💳 Credit Details</span>
      <select onchange="dashSetCreditMonth(this.value)"
        style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:var(--text);outline:none;cursor:pointer"
        title="Staff Credit is by month — pick which month to view">
        ${monthPickerOpts}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px">
      ${sectionCard('👥', 'Staff Credit — ' + my, d.staffRows, d.staffTotal, null, { accent: 'var(--mgrblue)', bg: 'var(--mgrblue-lt)' })}
      ${sectionCard('💚', 'Jazz Cash (all-time)', d.jazzCashRows, d.jazzCashTotal, 'jazzcash', { accent: 'var(--teal)', bg: 'var(--tlt)' })}
      ${pattyCardHtml}
    </div>
    ${d.otherSections.length ? `
    <div style="margin:14px 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">📋 Misc Sections (all-time)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px">
      ${d.otherSections.map(sec => sectionCard('📋', sec.label, sec.rows, sec.total, 'custom', { accent: 'var(--purple)', bg: 'var(--purple-lt)' })).join('')}
    </div>` : ''}
    <div style="background:var(--grad-header);border-radius:var(--r-md);padding:16px 22px;display:flex;align-items:center;justify-content:space-between;box-shadow:var(--sh-md)">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.65);margin-bottom:3px">💰 Total Outstanding Credits</div>
        <div style="font-size:10px;color:rgba(255,255,255,.45)">Staff (${my}) + Jazz Cash + Patty/Expenses + Misc Sections, all-time</div>
      </div>
      <div style="font-size:25px;font-weight:800;font-family:var(--mono);color:${d.grandTotal >= 0 ? '#4ade80' : '#f87171'}">${fmtAmt(d.grandTotal)}</div>
    </div>`;
}

const CHART_OPTS = {responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{color:'#334155',font:{size:10}}}},
  scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'#f1f5f9'}},
          y:{ticks:{color:'#64748b',font:{size:9},callback:v=>'₨'+ff(v)},grid:{color:'#e2e8f0'}}}};
function dc(id){if(_charts[id]){_charts[id].destroy();delete _charts[id];}}

// Monthly Total chart — preset + compare + drill (plan §3.1's explicit
// example of what dashboard-controls.js is for). Independent of the
// #dash-year select and of buildCharts(data)'s year-filtered `data` —
// this chart always resolves its own slice straight from MONTHLY via
// DashboardControls, so switching its preset never disturbs the rest
// of the dashboard.
function _dashSetTotalPreset(p) { _dashTotalPreset = p; buildTotalChart(); }
function _dashSetTotalCompare(on) { _dashTotalCompareOn = on; buildTotalChart(); }

function buildTotalChart() {
  if (typeof window.DashboardControls === 'undefined') return; // script not loaded — degrade silently, rest of dashboard still works
  const DCon = window.DashboardControls;
  const controlsEl = document.getElementById('ch-total-controls');
  if (controlsEl) {
    DCon.renderRangeBar(controlsEl, {
      active: _dashTotalPreset,
      onChange: _dashSetTotalPreset,
      compareEnabled: true,
      compareOn: _dashTotalCompareOn,
      onCompareToggle: _dashSetTotalCompare,
    });
  }

  const cur = DCon.resolvePreset(MONTHLY, _dashTotalPreset);
  if (!cur.length) return;
  const shortLbl = m => { const [mn, yr] = m.Month_Year.split(' '); return mn.slice(0, 3) + ' ' + yr.slice(2); };
  const lbl = cur.map(shortLbl);

  const datasets = [{
    label: 'Total', data: cur.map(m => n(m.TOTAL)),
    backgroundColor: 'rgba(37,99,235,.6)', borderColor: '#2563eb', borderWidth: 1.5, borderRadius: 3,
  }];

  if (_dashTotalCompareOn) {
    const prev = DCon.getComparePeriod(MONTHLY, _dashTotalPreset);
    if (prev.length) {
      // Compare series plotted against the SAME x-axis positions (this
      // month vs the equivalent month last period), not appended after —
      // pads the shorter side with nulls so Chart.js doesn't misalign
      // when a compare period is a different length near the edges of
      // available history.
      const len = Math.max(cur.length, prev.length);
      const prevPadded = Array(len - prev.length).fill(null).concat(prev.map(m => n(m.TOTAL)));
      datasets[0].data = Array(len - cur.length).fill(null).concat(datasets[0].data);
      datasets.push({
        label: 'Previous period', data: prevPadded,
        backgroundColor: 'rgba(148,163,184,.5)', borderColor: '#94a3b8', borderWidth: 1.5, borderRadius: 3,
      });
    }
  }

  dc('ch-total');
  _charts['ch-total'] = new Chart(document.getElementById('ch-total'), {
    type: 'bar',
    data: { labels: lbl, datasets },
    options: { ...CHART_OPTS, plugins: { legend: { display: datasets.length > 1 }, tooltip: { callbacks: { label: c => (c.dataset.label + ': ₨' + fc(c.raw)) } } } },
  });

  // Drill — click a bar to open that month's detail modal. Only the
  // primary "Total" dataset's months are drillable (compare-period bars
  // don't map 1:1 to a real month click target in the same way).
  DCon.attachDrilldown(_charts['ch-total'], cur, m => {
    if (typeof window.openMonthModal === 'function') window.openMonthModal(m.Month_Year);
  });
}

function buildCharts(data) {
  const lbl=data.map(m=>{ const[mn,yr]=m.Month_Year.split(' '); return mn.slice(0,3)+' '+yr.slice(2); });
  buildTotalChart();

  dc('ch-cashbank');
  _charts['ch-cashbank']=new Chart(document.getElementById('ch-cashbank'),{type:'bar',
    data:{labels:lbl,datasets:[{label:'Cash',data:data.map(m=>n(m['Cash Sale'])),backgroundColor:'rgba(217,119,6,.65)',borderRadius:3},{label:'Banks',data:data.map(m=>mBanks(m)),backgroundColor:'rgba(37,99,235,.65)',borderRadius:3}]},
    options:{...CHART_OPTS,scales:{x:{stacked:true,ticks:{color:'#64748b',font:{size:9}},grid:{color:'#f1f5f9'}},y:{stacked:true,ticks:{color:'#64748b',font:{size:9},callback:v=>'₨'+ff(v)},grid:{color:'#e2e8f0'}}}}});

  const ct=CLIENT_COLS.map(c=>({name:c,val:MONTHLY.reduce((s,m)=>s+n(m[c]),0)})).filter(c=>c.val>0).sort((a,b)=>b.val-a.val).slice(0,10);
  dc('ch-clients');
  _charts['ch-clients']=new Chart(document.getElementById('ch-clients'),{type:'doughnut',
    data:{labels:ct.map(c=>c.name),datasets:[{data:ct.map(c=>c.val),backgroundColor:CC,borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#334155',font:{size:10},boxWidth:10,padding:5}}}}});

  dc('ch-cust');
  _charts['ch-cust']=new Chart(document.getElementById('ch-cust'),{type:'line',
    data:{labels:lbl,datasets:[{label:'Customers',data:data.map(m=>n(m.Customers)),borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.07)',tension:.4,fill:true,pointRadius:2}]},
    options:{...CHART_OPTS,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'#f1f5f9'}},y:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'#e2e8f0'}}}}});
  // Click-to-drill (plan §3.1: "Customer footfall — click-to-drill into
  // Daily Data") — reuses the existing month detail modal rather than a
  // new navigation path.
  if (typeof window.DashboardControls !== 'undefined') {
    window.DashboardControls.attachDrilldown(_charts['ch-cust'], data, m => {
      if (typeof window.openMonthModal === 'function') window.openMonthModal(m.Month_Year);
    });
  }

  // YoY
  const yrs=years();
  const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  dc('ch-yoy');
  _charts['ch-yoy']=new Chart(document.getElementById('ch-yoy'),{type:'line',
    data:{labels:MS,datasets:yrs.map((yr,i)=>({label:yr,data:MN.map(mn=>{ const r=MONTHLY.find(m=>m.Month_Year===mn+' '+yr); return r?n(r.TOTAL):null; }),borderColor:CC[i%CC.length],backgroundColor:CC[i%CC.length]+'18',tension:.4,fill:false,pointRadius:2,spanGaps:true}))},
    options:{...CHART_OPTS,plugins:{legend:{labels:{color:'#334155',font:{size:10}}}}}});
}

function buildSummaryTable() {
  const last12=MONTHLY.slice(-12);
  const cols=['TOTAL','Cash Sale','HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)','F/Issue','COMP SALE','DIFF','Customers'];
  const tbl=document.getElementById('tbl-summary');
  tbl.innerHTML='<thead><tr><th>Month</th>'+cols.map(c=>'<th>'+(c==='DIFF'?'Difference':c)+'</th>').join('')+'</tr></thead>';
  const tbody=document.createElement('tbody');
  last12.forEach(m=>{
    // Compute DIFF on the fly in case legacy monthly record has null
    const diff = Math.round(n(m.TOTAL) - n(m['COMP SALE']));
    const rowData = {...m, DIFF: diff || null};
    const tr=document.createElement('tr'); tr.innerHTML='<td>'+m.Month_Year+'</td>'+cols.map(c=>{ const v=n(rowData[c]); return '<td>'+(v?'₨'+fc(v):'—')+'</td>'; }).join(''); tbody.appendChild(tr); });
  const tf=document.createElement('tfoot'); const tr2=document.createElement('tr');
  tr2.innerHTML='<td><strong>TOTAL</strong></td>'+cols.map(c=>{ const s=last12.reduce((a,m)=>a+n(m[c]),0); return '<td><strong>'+(s?'₨'+fc(s):'—')+'</strong></td>'; }).join('');
  tf.appendChild(tr2); tbl.appendChild(tbody); tbl.appendChild(tf);
}

// ══════════════════════════════════════════
// TOP 10 BEST DAYS
// ══════════════════════════════════════════
function buildTop10Days() {
  const el = document.getElementById('dash-top10');
  if (!el) return;

  // Sort all daily records by TOTAL descending, take top 10
  const top10 = DAILY.filter(d => n(d.TOTAL) > 0)
    .slice()
    .sort((a, b) => n(b.TOTAL) - n(a.TOTAL))
    .slice(0, 10);

  if (!top10.length) { el.innerHTML = ''; return; }

  const maxVal = n(top10[0].TOTAL);
  const medals = ['🥇', '🥈', '🥉'];

  const rows = top10.map((d, i) => {
    const total = n(d.TOTAL);
    const customers = n(d.Customers);
    const barPct = Math.round(total / maxVal * 100);
    const medal = medals[i] || `<span style="font-size:11px;font-weight:700;color:var(--muted);min-width:18px;display:inline-block;text-align:center">${i + 1}</span>`;
    const avgBill = customers ? Math.round(total / customers) : 0;

    return `
      <div onclick="openDayModal('${d.Date}','${d.Month_Year}')"
        style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;
               background:var(--surface);border:1px solid var(--border);cursor:pointer;
               transition:box-shadow .15s,border-color .15s;active:opacity:.8"
        onmouseenter="this.style.borderColor='var(--accent)';this.style.boxShadow='0 2px 10px rgba(37,99,235,.12)'"
        onmouseleave="this.style.borderColor='var(--border)';this.style.boxShadow=''">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div style="display:flex;align-items:center;gap:7px;min-width:0">
            <span style="font-size:16px;flex-shrink:0">${medal}</span>
            <div style="min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--text);font-family:var(--mono)">${d.Date}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:1px">${d.Month_Year}</div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:14px;font-weight:700;color:var(--accent);font-family:var(--mono)">₨${ff(total)}</div>
            <div style="font-size:10px;color:var(--muted);margin-top:1px">👥 ${fc(customers)}${avgBill ? ' · ₨' + ff(avgBill) + '/bill' : ''}</div>
          </div>
        </div>
        <div style="background:var(--border);border-radius:99px;height:3px;overflow:hidden">
          <div style="height:100%;width:${barPct}%;background:${i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--accent)'};border-radius:99px;transition:width .4s"></div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:8px">
      <span>🏆 Top 10 Best Days — All Time</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
      <span style="font-size:10px;font-weight:400;color:var(--muted)">tap to open report</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px">
      ${rows}
    </div>`;
}

// ══════════════════════════════════════════
// BEST DAY OF WEEK
// ══════════════════════════════════════════
function buildDayOfWeek() {
  const el = document.getElementById('dash-dow');
  if (!el) return;

  const MON_NUM = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DOW_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  // Bucket totals and counts per weekday
  const buckets = Array.from({length:7}, () => ({sum:0, count:0, best:0, bestDate:''}));

  DAILY.filter(d => n(d.TOTAL) > 0 && d.Date).forEach(d => {
    const p = d.Date.split('/');
    if (p.length !== 3) return;
    const dt = new Date(parseInt(p[2]), (MON_NUM[p[1]]||1)-1, parseInt(p[0]));
    const dow = dt.getDay(); // 0=Sun
    const total = n(d.TOTAL);
    buckets[dow].sum   += total;
    buckets[dow].count += 1;
    if (total > buckets[dow].best) { buckets[dow].best = total; buckets[dow].bestDate = d.Date; }
  });

  const avgs = buckets.map(b => b.count ? Math.round(b.sum / b.count) : 0);
  const maxAvg = Math.max(...avgs);
  const bestDow = avgs.indexOf(maxAvg);

  // Show all 7 days including Sunday
  const workDays = [1,2,3,4,5,6,0]; // Mon–Sat then Sun

  const workAvgs = workDays.map(i => avgs[i]).filter(a => a > 0);
  const minAvg = workAvgs.length ? Math.min(...workAvgs) : 0;
  const worstDow = minAvg > 0 ? avgs.indexOf(minAvg) : -1;

  const bars = workDays.map(i => {
    const avg = avgs[i];
    const pct = maxAvg ? Math.round(avg / maxAvg * 100) : 0;
    const isTop = i === bestDow;
    const isWorst = i === worstDow && avg > 0;
    const barColor = isTop ? 'var(--green)' : isWorst ? 'var(--red,#dc2626)' : 'var(--accent)';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0">
        <div style="font-size:10px;font-weight:600;color:${isWorst?'#dc2626':isTop?'var(--green)':'var(--muted)'};font-family:var(--mono)">₨${ff(avg)}</div>
        <div style="width:100%;background:var(--border);border-radius:99px 99px 4px 4px;height:80px;display:flex;align-items:flex-end;overflow:hidden">
          <div style="width:100%;height:${pct}%;background:${barColor};border-radius:99px 99px 0 0;transition:height .5s;position:relative">
            ${isTop ? '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:11px">⭐</div>' : ''}
            ${isWorst ? '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:11px">🔴</div>' : ''}
          </div>
        </div>
        <div style="font-size:11px;font-weight:${isTop||isWorst?'700':'500'};color:${isTop?'var(--accent)':isWorst?'#dc2626':'var(--text)'}">${DOW_LABELS[i]}</div>
        <div style="font-size:9px;color:var(--muted)">${buckets[i].count}d</div>
      </div>`;
  }).join('');

  // Rank sentence
  const ranked = workDays
    .map(i => ({label: DOW_FULL[i], avg: avgs[i], count: buckets[i].count}))
    .filter(x => x.count > 0)
    .sort((a,b) => b.avg - a.avg);

  const rankText = ranked.map((x,i) =>
    `<span style="font-size:10px;color:var(--muted)">${i+1}. <strong style="color:var(--text)">${x.label}</strong> ₨${ff(x.avg)}</span>`
  ).join(' &nbsp;·&nbsp; ');

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>📅 Average Sales by Day of Week</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:12px;padding:8px 4px 0">
        ${bars}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border);padding-top:10px">
        ${rankText}
      </div>
    </div>`;
}

// ══════════════════════════════════════════
// BEST & SLOWEST MONTH PER YEAR
// ══════════════════════════════════════════
function buildBestWorstPerYear() {
  const el = document.getElementById('dash-best-worst');
  if (!el) return;

  // Group MONTHLY by year
  const byYear = {};
  MONTHLY.forEach(m => {
    const yr = (m.Month_Year.split(' ')[1] || '').trim();
    if (!yr) return;
    (byYear[yr] = byYear[yr] || []).push(m);
  });

  const years = Object.keys(byYear).sort((a,b) => b - a);
  if (!years.length) { el.innerHTML = ''; return; }

  // Current month — exclude from worst if it's still in progress
  const _now = new Date();
  const _MN2 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const curMonthYear = _MN2[_now.getMonth()] + ' ' + _now.getFullYear();

  const yearCards = years.map(yr => {
    const months = byYear[yr];
    // For current year, exclude the live month from worst (partial data skews it)
    const forWorst = months.filter(m => m.Month_Year !== curMonthYear);

    const best  = months.reduce((a,b) => n(b.TOTAL) > n(a.TOTAL) ? b : a);
    const worst = (forWorst.length ? forWorst : months).reduce((a,b) => n(b.TOTAL) < n(a.TOTAL) ? b : a);

    const bestTotal  = n(best.TOTAL);
    const worstTotal = n(worst.TOTAL);
    const isCurrentYear = yr === String(_now.getFullYear());

    const bestMonth  = best.Month_Year.split(' ')[0];
    const worstMonth = worst.Month_Year.split(' ')[0];

    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
          <span>${yr}</span>
          ${isCurrentYear ? '<span style="font-size:9px;background:var(--accent);color:#fff;padding:2px 7px;border-radius:99px;font-weight:600">LIVE</span>' : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <!-- Best -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.2);border-radius:8px;cursor:pointer"
               onclick="openMonthModal('${best.Month_Year}')" title="Open ${best.Month_Year}">
            <div>
              <div style="font-size:9px;font-weight:700;color:#059669;letter-spacing:.06em;text-transform:uppercase">🏆 Best</div>
              <div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">${bestMonth}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:#059669">₨${ff(bestTotal)}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:1px">👥 ${fc(n(best.Customers))}</div>
            </div>
          </div>

          <!-- Worst -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.15);border-radius:8px;cursor:pointer"
               onclick="openMonthModal('${worst.Month_Year}')" title="Open ${worst.Month_Year}">
            <div>
              <div style="font-size:9px;font-weight:700;color:#dc2626;letter-spacing:.06em;text-transform:uppercase">📉 Slowest</div>
              <div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">${worstMonth}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:#dc2626">₨${ff(worstTotal)}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:1px">👥 ${fc(n(worst.Customers))}</div>
            </div>
          </div>

          <!-- Gap bar -->
          <div style="font-size:9px;color:var(--muted);text-align:center;margin-top:2px">
            Gap: <strong style="color:var(--text)">₨${ff(bestTotal - worstTotal)}</strong>
            &nbsp;·&nbsp; Best is <strong style="color:var(--text)">${bestTotal && worstTotal ? (bestTotal/worstTotal).toFixed(1) : '—'}×</strong> slowest
          </div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>🏆 Best & Slowest Month — Per Year</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
      <span style="font-size:10px;font-weight:400;color:var(--muted)">tap to open month</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">
      ${yearCards}
    </div>`;
}

// ══════════════════════════════════════════
// DASHBOARD PRINT REPORT
// ══════════════════════════════════════════
// This dashboard's toolbar Print button used to call a bare window.print()
// directly from index.html — before print.js's Floor 4 consolidation, that
// worked because nothing hid the rest of the page. Now that the shared
// @media print rule hides everything except #print-area (needed so every
// other report prints cleanly, see pages.css), a bare window.print() here
// printed a BLANK page: #print-area was empty because nothing had ever
// populated it. Fix is the same as every other report in the app — build
// real HTML and hand it to Print.render(), never call window.print() here
// directly (see print.js's header comment).
function printDashboardReport() {
  const krow = document.getElementById('krow');
  const tbl = document.getElementById('tbl-summary');
  if (!krow || !tbl || !krow.children.length) {
    toast('⚠ Dashboard is still loading — try again in a moment.', 'w');
    return;
  }
  const today = new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  const heroSub = document.getElementById('hero-sub')?.textContent || '';

  // Re-skin the live KPI cards into the app's shared print classes
  // (pr-kpi/pr-tbl, from pages.css) rather than cloning the screen-only
  // .kpi cards verbatim — this keeps the printed dashboard visually
  // consistent with every other printed report (Sale/Monthly/Yearly/
  // Manager), instead of dragging along hover/shadow/border styling that
  // means nothing on paper.
  const kpiCards = Array.from(krow.querySelectorAll('.kpi')).map(card => {
    const label = card.querySelector('.klabel')?.textContent || '';
    const value = card.querySelector('.kvalue')?.textContent || '';
    const sub = card.querySelector('.kdelta')?.textContent || '';
    return `<div class="pr-kpi"><div class="pr-kpi-l">${label}</div><div class="pr-kpi-v">${value}</div>${sub ? `<div style="font-size:9px;color:#64748b;margin-top:3px">${sub}</div>` : ''}</div>`;
  }).join('');

  const summaryTbl = tbl.outerHTML.replace('id="tbl-summary"', 'class="pr-tbl"');

  const html = `<div style="max-width:900px;margin:0 auto">
    <div class="pr-header">
      <div><h1>BAHRIA TOWN SALES IC</h1><p>Dashboard Summary${heroSub ? ' — ' + heroSub : ''}</p></div>
      <div class="pr-meta">Printed: ${today}</div>
    </div>
    <div class="pr-kpis" style="grid-template-columns:repeat(3,1fr)">${kpiCards}</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin:14px 0 6px">Last 12 Months Summary</div>
    ${summaryTbl}
  </div>`;
  Print.render(html);
}

// Bridge what's used externally or referenced via a same-file onchange
// attribute (dashSetCreditMonth is the credit-month dropdown handler).
window.buildDashboard = buildDashboard;
window._monthSortVal = _monthSortVal;
window._currentMonthVal = _currentMonthVal;
window.managerMonthHasData = managerMonthHasData;
window.latestManagerMonth = latestManagerMonth;
window.buildCreditSection = buildCreditSection;
window.dc = dc;
window.buildTop10Days = buildTop10Days;
window.buildBestWorstPerYear = buildBestWorstPerYear;
window.dashSetCreditMonth = dashSetCreditMonth;
window.dashSetPattyDateFrom = dashSetPattyDateFrom;
window.dashSetPattyDateTo = dashSetPattyDateTo;
window.dashClearPattyDates = dashClearPattyDates;
window.dashSetPattyPreset = dashSetPattyPreset;
window.dashTogglePattyCat = dashTogglePattyCat;
window.printDashboardReport = printDashboardReport;

})();
