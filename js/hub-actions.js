// ══════════════════════════════════════════════════════════════════════
(function() {
'use strict';
// HUB QUICK ACTIONS — headless print/report triggers for the CommandHub
// page's "⚡ Quick" chips. Each function works standalone (no other page
// needs to be open first) and either prints a report or posts a reply
// into the CommandHub conversation thread.
// ══════════════════════════════════════════════════════════════════════

function _hubPost(html) {
  if (typeof _chHistory === 'undefined') { toast(html.replace(/<[^>]*>/g, ' ')); return; }
  _chHistory.push({ role: 'bot', text: html });
  if (typeof _chRenderThread === 'function') _chRenderThread();
}

// ── Today's Total → print today's Sale Report ─────────────────────────
function hubPrintTodayReport() {
  const dateStr = (typeof BTDate !== 'undefined') ? BTDate.today() :
    (function () { const d = new Date(), dd = String(d.getDate()).padStart(2,'0'),
      MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return dd + '/' + MS[d.getMonth()] + '/' + d.getFullYear(); })();
  const rec = (typeof Repository !== 'undefined') ? Repository.findDailyByDate(dateStr) : null;
  if (!rec) {
    _hubPost('⚠️ No sale entry found for today (' + dateStr + ') yet. <button class="chp-state-btn" onclick="showPage(\'entry\')">Add Entry →</button>');
    return;
  }
  const html = buildPrintHTML(dateStr, rec.Month_Year, 0, 0);
  if (!html) { _hubPost('⚠️ Could not build today\'s report.'); return; }
  Print.render(html);
}

// ── Credit Balance → Staff Credit Summary print ────────────────────────
function hubPrintCreditSummary() {
  const my = (typeof BTDate !== 'undefined') ? BTDate.currentMonthYear() : '';
  if (typeof printCreditSummaryReport === 'function') printCreditSummaryReport(my);
}

// ── Print This Year → current year's annual report, instant (no chat round-trip) ──
function hubPrintYearReport() {
  if (typeof printYearlyReport === 'function') {
    printYearlyReport(String(new Date().getFullYear()));
  }
}

// ── Pace Check → print report on pace toward the monthly target ───────
function hubPrintPaceReport() {
  const my  = (typeof BTDate !== 'undefined') ? BTDate.currentMonthYear() : '';
  const now = new Date();
  const tgts = (typeof getTgts === 'function') ? getTgts() : {};
  const tgt  = Number(tgts[my] || 0);
  const monthRec = (typeof Repository !== 'undefined') ? Repository.getMonthlyEntry(my) : null;
  const soFar = Number((monthRec && monthRec.TOTAL) || 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);
  const remaining = tgt - soFar;
  const pct = tgt ? Math.min(100, Math.round(soFar / tgt * 100)) : null;
  const today = now.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
  const fmt = v => '₨' + Math.round(v).toLocaleString('en-PK');

  let statusHtml;
  if (!tgt) {
    statusHtml = `<div style="padding:14px;text-align:center;color:#94a3b8">No monthly target set for ${my}. Set one in Tools → Targets.</div>`;
  } else if (remaining <= 0) {
    statusHtml = `<div style="padding:16px;text-align:center;background:#f0fdf4;border:1px solid #86efac;border-radius:8px">
      <div style="font-size:22px;font-weight:700;color:#16a34a">🏆 Target Achieved!</div>
      <div style="font-size:13px;color:#166534;margin-top:4px">${fmt(soFar)} of ${fmt(tgt)} target</div>
    </div>`;
  } else {
    const perDay = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;
    statusHtml = `<div style="padding:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
      <div style="font-size:14px;color:#1e40af">Need <strong>${fmt(perDay)}/day</strong> for the remaining <strong>${daysLeft}</strong> day${daysLeft===1?'':'s'} to hit target.</div>
    </div>`;
  }

  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">PACE TOWARDS MONTHLY TARGET</h2><p style="margin:4px 0 0;font-size:11px;opacity:.7">${my}</p></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee">Monthly Target</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${tgt ? fmt(tgt) : '—'}</td></tr>
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee">Sales So Far</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${fmt(soFar)}</td></tr>
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee">Remaining</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${tgt ? fmt(Math.max(0,remaining)) : '—'}</td></tr>
      <tr><td style="padding:6px 10px;border-bottom:1px solid #eee">Progress</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${pct !== null ? pct + '%' : '—'}</td></tr>
      <tr><td style="padding:6px 10px">Days Left in Month</td><td style="padding:6px 10px;text-align:right;font-family:monospace">${daysLeft}</td></tr>
    </table>
    ${statusHtml}
  </div>`;
  Print.render(html);
}

// ── Expense Summary → print totals-only Patty/Expense summary ─────────
// FOUND IN DEEP AUDIT: this used to read data.expense[my] via mgrLoad() —
// a per-month structure from before Patty/Expenses was migrated to the
// unified Ledger (see ledger-store.js's LEDGER_CATEGORIES.expense and
// analytics.js's _ledgerBreakdown). Nothing has WRITTEN to
// data.expense[my] since that migration — the Manager → Expense tab
// (manager.js's switchMgrTab → renderLedgerView('ledger-expense-
// container','expense',...)) and the Dashboard's own "Patty / Expenses"
// credit-details card have both been reading from LedgerStore for a
// while. This function alone was never updated, so it silently printed
// an all-zero summary no matter how much real expense data existed —
// no error, just wrong numbers. Now reads the same all-time Ledger data,
// with the same category sign convention, as everywhere else in the app.
function hubPrintExpenseSummary() {
  const LS = (typeof window !== 'undefined') ? window.LedgerStore : null;
  if (!LS) { toast('⚠️ Ledger data not available.', 'w'); return; }
  const categories = LS.getCategoryList('expense') || [];
  const entries = LS.getEntries('expense') || [];
  const opening = LS.getOpeningBalance('expense') || 0;
  const balance = LS.getCurrentBalance('expense');
  const ni = v => Math.round(Number(v) || 0);
  const fc = v => Math.abs(ni(v)).toLocaleString('en-PK');
  const today = new Date().toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });

  const sums = {};
  entries.forEach(e => { sums[e.categoryId] = (sums[e.categoryId] || 0) + (parseFloat(e.amount) || 0); });

  const rows = categories
    .map(c => ({ label: c.label, raw: sums[c.id] || 0, signed: c.sign * (sums[c.id] || 0) }))
    .filter(r => r.raw !== 0);

  const rowsHtml = rows.map(r => `
    <tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${r.label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${r.signed < 0 ? '−' : ''}₨${fc(r.raw)}</td></tr>`
  ).join('') || '<tr><td colspan="2" style="padding:10px;text-align:center;color:#94a3b8">No expense activity yet</td></tr>';

  const html = `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#0f172a;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div><h2 style="margin:0;font-size:16px">PATTY / EXPENSES SUMMARY</h2><p style="margin:4px 0 0;font-size:11px;opacity:.7">All-time — same running ledger as Manager → Expense</p></div>
      <div style="font-size:11px;opacity:.7">Printed: ${today}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${opening ? `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">Opening Balance</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${fc(opening)}</td></tr>` : ''}
      ${rowsHtml}
      <tr style="background:${balance>=0?'#f0fdf4':'#fef2f2'}"><td style="padding:7px 10px;font-weight:700;color:${balance>=0?'#059669':'#dc2626'}">Current Balance</td><td style="padding:7px 10px;text-align:right;font-weight:700;font-family:monospace;color:${balance>=0?'#059669':'#dc2626'}">₨${fc(balance)}</td></tr>
    </table>
  </div>`;
  Print.render(html);
}

// ── Month Summary → current month Sale Report print (full report) ────
function hubPrintMonthSummary() {
  const my = (typeof BTDate !== 'undefined') ? BTDate.currentMonthYear() : '';
  if (typeof printMonthReport === 'function') printMonthReport(my);
}

// ── Jazz Cash Ledger → reply with the current balance (no nav/print) ──
function hubShowJazzCashBalance() {
  const bal = (typeof _jcCurrentBalance === 'function') ? _jcCurrentBalance() : 0;
  const fmt = Math.round(Math.abs(bal)).toLocaleString('en-PK');
  const sign = bal < 0 ? '−' : '';
  _hubPost('🏦 <strong>Jazz Cash current balance:</strong> ' + sign + '₨' + fmt +
    ' <button class="chp-state-btn" onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'jazzcash\')},250)">Open Ledger →</button>');
}

// _hubPost is genuinely private (only used within this file). Everything
// else is consumed by commandhub-page.js and/or commandhub.js.
window.hubPrintTodayReport     = hubPrintTodayReport;
window.hubPrintCreditSummary   = hubPrintCreditSummary;
window.hubPrintYearReport      = hubPrintYearReport;
window.hubPrintPaceReport      = hubPrintPaceReport;
window.hubPrintExpenseSummary  = hubPrintExpenseSummary;
window.hubPrintMonthSummary    = hubPrintMonthSummary;
window.hubShowJazzCashBalance  = hubShowJazzCashBalance;

})();
