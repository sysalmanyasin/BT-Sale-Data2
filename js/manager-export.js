/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  MANAGER SUMMARY EXPORT  —  BT Sales App  ·  Phase 5               ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  One-tap print/share: today's numbers, week trend, active           ║
 * ║  flags/alerts — single page, forwardable without opening the app.  ║
 * ║                                                                      ║
 * ║  Builds on the existing reports-print.js pipeline.                  ║
 * ║                                                                      ║
 * ║  Public API:                                                         ║
 * ║    exportManagerSummary()  — open print dialog with summary         ║
 * ║    buildManagerSummaryHTML(my)  — returns HTML string only          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════ */
function _msN(v)  { return isNaN(parseFloat(v)) ? 0 : parseFloat(v); }
function _msFF(v) { return Math.round(v).toLocaleString('en-PK'); }
function _msM(v)  { return (v / 1e6).toFixed(2) + 'M'; }

function _msCurrentMonthYear() {
  const d = new Date();
  const MN = ['January','February','March','April','May','June','July','August',
              'September','October','November','December'];
  return MN[d.getMonth()] + ' ' + d.getFullYear();
}

function _msLatestManagerMonth() {
  return (typeof latestManagerMonth === 'function') ? latestManagerMonth() : _msCurrentMonthYear();
}

function _msGetManagerData(mon) {
  try { return JSON.parse(localStorage.getItem('BT_ManagerWork_v1') || '{}'); } catch(_) { return {}; }
}

function _msTgts() {
  try { return JSON.parse(localStorage.getItem('bt_targets') || '{}'); } catch(_) { return {}; }
}

/* ══════════════════════════════════════════════════════════════════════
   SECTION BUILDERS
══════════════════════════════════════════════════════════════════════ */

function _msBuildSalesSummary(mon) {
  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  const D = (typeof DAILY   !== 'undefined' && DAILY)   ? DAILY   : [];
  if (!M.length) return '';

  const lat  = M.find(m => m.Month_Year === mon) || M[M.length - 1];
  const prev = M.length > 1 ? M[M.length - 2] : null;
  const tgts = _msTgts();
  const tgt  = _msN(tgts[lat.Month_Year]);
  const total = _msN(lat.TOTAL);
  const pct   = tgt > 0 ? Math.round(total / tgt * 100) : null;

  // Week trend (last 7 filled days)
  const days = D.filter(d => d.Month_Year === lat.Month_Year && _msN(d.TOTAL) > 0)
                .sort((a, b) => {
                  const pa = a.Date || '', pb = b.Date || '';
                  return pa < pb ? -1 : pa > pb ? 1 : 0;
                });
  const week = days.slice(-7);
  const weekTotal  = week.reduce((s, d) => s + _msN(d.TOTAL), 0);
  const weekAvg    = week.length ? Math.round(weekTotal / week.length) : 0;
  const weekBest   = week.length ? week.reduce((a, b) => _msN(b.TOTAL) > _msN(a.TOTAL) ? b : a, week[0]) : null;

  // Target pace
  const now          = new Date();
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed  = now.getDate();
  const daysLeft     = daysInMonth - daysElapsed;
  const neededPerDay = tgt > 0 && daysLeft > 0 ? Math.ceil((tgt - total) / daysLeft) : 0;
  const onPace       = tgt > 0 && total >= tgt * (daysElapsed / daysInMonth) * 0.95;

  const trendRows = week.map(d => {
    const t = _msN(d.TOTAL);
    const bar = weekAvg > 0 ? Math.max(5, Math.round(t / weekAvg * 60)) : 30;
    const col  = t >= weekAvg ? '#16a34a' : '#dc2626';
    return `<tr>
      <td style="padding:4px 8px;font-size:11px;color:#64748b">${d.Date}</td>
      <td style="padding:4px 8px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:${bar}px;height:8px;background:${col};border-radius:4px;min-width:4px"></div>
          <span style="font-size:11px;font-weight:600;color:#1e293b">₨${_msFF(t)}</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  const prevDelta = prev && _msN(prev.TOTAL) > 0
    ? Math.round((total - _msN(prev.TOTAL)) / _msN(prev.TOTAL) * 100)
    : null;

  return `
    <div class="ms-section">
      <div class="ms-section-title">📊 Sales — ${lat.Month_Year}</div>

      <div class="ms-kpi-grid">
        <div class="ms-kpi">
          <div class="ms-kpi-label">Month Total</div>
          <div class="ms-kpi-value" style="color:#2563eb">₨${_msFF(total)}</div>
          ${pct !== null ? `<div class="ms-kpi-sub">${pct}% of ₨${_msM(tgt)} target</div>` : ''}
          ${prevDelta !== null ? `<div class="ms-kpi-sub" style="color:${prevDelta >= 0 ? '#16a34a' : '#dc2626'}">${prevDelta >= 0 ? '▲' : '▼'} ${Math.abs(prevDelta)}% vs ${prev.Month_Year}</div>` : ''}
        </div>
        <div class="ms-kpi">
          <div class="ms-kpi-label">Customers</div>
          <div class="ms-kpi-value">${_msFF(_msN(lat.Customers))}</div>
          <div class="ms-kpi-sub">Avg bill ₨${lat.Customers && _msN(lat.Customers) > 0 ? _msFF(Math.round(total / _msN(lat.Customers))) : '—'}</div>
        </div>
        ${tgt > 0 ? `
        <div class="ms-kpi">
          <div class="ms-kpi-label">Target Pace</div>
          <div class="ms-kpi-value" style="color:${onPace ? '#16a34a' : '#f59e0b'}">${onPace ? 'On Track ✓' : 'Behind ⚠'}</div>
          ${neededPerDay > 0 && !onPace ? `<div class="ms-kpi-sub">Need ₨${_msFF(neededPerDay)}/day, ${daysLeft} days left</div>` : ''}
        </div>` : ''}
        ${weekBest ? `
        <div class="ms-kpi">
          <div class="ms-kpi-label">Best Day (7d)</div>
          <div class="ms-kpi-value">₨${_msFF(_msN(weekBest.TOTAL))}</div>
          <div class="ms-kpi-sub">${weekBest.Date}</div>
        </div>` : ''}
      </div>

      ${week.length ? `
      <div style="margin-top:12px">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px">Last 7 Days Trend</div>
        <table style="width:100%;border-collapse:collapse">${trendRows}</table>
      </div>` : ''}
    </div>`;
}

function _msBuildManagerSummary(mon) {
  const mgr = _msGetManagerData(mon);

  // Salary
  const salaryRows  = (mgr.salary  && mgr.salary[mon])  || [];
  const genericRows = (mgr.generic && mgr.generic[mon])  || [];
  const salaryTotal  = salaryRows.reduce((s, r) => s + (_msN(r.hoSal) - _msN(r.advance) + _msN(r.generic)), 0);
  const genericTotal = genericRows.reduce((s, r) => s + (Math.round(_msN(r.genericSale) * 0.04) + _msN(r.extra)), 0);

  // Petty
  const pettyTotal = (typeof _pettyTotalForMonth === 'function') ? _pettyTotalForMonth(mon) : 0;

  // Jazz Cash balance
  let jcBalance = null;
  try {
    if (typeof _jcCurrentBalance === 'function') jcBalance = _jcCurrentBalance();
  } catch(_) {}

  // Incentive
  let incNet = null;
  try {
    const inc = JSON.parse(localStorage.getItem('mw_incentive_' + mon) || '{}');
    if (inc.netInc != null) {
      incNet = inc.netInc;
    } else if (inc.saleVal || inc.genSale) {
      const saleComm  = Math.round(_msN(inc.saleVal) * 0.005);
      const genInc    = Math.round(_msN(inc.genSale) * 0.045);
      const totalComm = saleComm - _msN(inc.pilferage) - _msN(inc.tillShort);
      const totalGen  = genInc - _msN(inc.excessFine);
      incNet = totalComm + _msN(inc.cashTarget) + totalGen - _msN(inc.plusFine) - _msN(inc.paperFine) - _msN(inc.panelFine);
    }
  } catch(_) {}

  // Credit outstanding (top 3)
  let creditRows = [];
  try {
    const mgrKey = Object.keys(localStorage).find(k => k.startsWith('mw_mgr_') || k === 'mw_manager');
    if (mgrKey) {
      const mgrData = JSON.parse(localStorage.getItem(mgrKey) || '{}');
      const months  = Object.keys(mgrData.credit || {});
      if (months.length) {
        const crd = mgrData.credit[months[months.length - 1]] || [];
        creditRows = crd.map(e => ({
          name: e.name,
          bal: _msN(e.prevBal) + (e.entries || []).reduce((s, x) => s + _msN(x.amount), 0)
        })).filter(e => e.bal > 0).sort((a, b) => b.bal - a.bal).slice(0, 5);
      }
    }
  } catch(_) {}

  const hasData = salaryTotal || genericTotal || pettyTotal || jcBalance || incNet != null || creditRows.length;
  if (!hasData) return '';

  const rows = [
    salaryTotal   ? `<tr><td>👥 Salary Payroll</td><td class="ms-amt">₨${_msFF(salaryTotal)}</td></tr>` : '',
    genericTotal  ? `<tr><td>📦 Generic Commission</td><td class="ms-amt">₨${_msFF(genericTotal)}</td></tr>` : '',
    pettyTotal    ? `<tr><td>💰 Petty Cash</td><td class="ms-amt">₨${_msFF(pettyTotal)}</td></tr>` : '',
    jcBalance != null ? `<tr><td>📱 Jazz Cash Balance</td><td class="ms-amt" style="color:${jcBalance < 0 ? '#dc2626' : '#16a34a'}">₨${_msFF(jcBalance)}</td></tr>` : '',
    incNet != null ? `<tr><td>🏅 Net Incentive</td><td class="ms-amt" style="color:${incNet >= 0 ? '#16a34a' : '#dc2626'}">₨${_msFF(incNet)}</td></tr>` : '',
  ].filter(Boolean).join('');

  const creditHtml = creditRows.length ? `
    <div style="margin-top:12px">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px">Top Credit Outstanding</div>
      <table style="width:100%;border-collapse:collapse">
        ${creditRows.map(r => `<tr>
          <td style="padding:4px 8px;font-size:12px;color:#1e293b">${r.name}</td>
          <td style="padding:4px 8px;font-size:12px;font-weight:700;color:#dc2626;text-align:right">₨${_msFF(r.bal)}</td>
        </tr>`).join('')}
      </table>
    </div>` : '';

  return `
    <div class="ms-section">
      <div class="ms-section-title">🗂 Manager Summary — ${mon}</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em">Category</th>
          <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${creditHtml}
    </div>`;
}

function _msBuildAlerts() {
  const alerts = [];
  try {
    if (typeof aimRulesCheckAll === 'function') {
      aimRulesCheckAll().forEach(f => alerts.push(f.msg));
    }
  } catch(_) {}
  try {
    if (typeof aimSectionZeroAlerts === 'function') {
      aimSectionZeroAlerts().forEach(a => alerts.push(a));
    }
  } catch(_) {}
  if (!alerts.length) return '';
  return `
    <div class="ms-section">
      <div class="ms-section-title">⚠️ Active Alerts</div>
      ${alerts.map(a => `<div style="font-size:12px;color:#92400e;padding:5px 0;border-bottom:1px solid #fef3c7;line-height:1.5">${a}</div>`).join('')}
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN HTML BUILDER
══════════════════════════════════════════════════════════════════════ */
function buildManagerSummaryHTML(mon) {
  mon = mon || _msLatestManagerMonth();
  const printDate = new Date().toLocaleDateString('en-PK', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fff; color: #1e293b; padding: 20px; max-width: 680px; margin: 0 auto; }
    .ms-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1e3a5f; padding-bottom: 14px; }
    .ms-header-title { font-size: 20px; font-weight: 800; color: #1e3a5f; }
    .ms-header-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
    .ms-section { margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 10px;
      overflow: hidden; page-break-inside: avoid; }
    .ms-section-title { background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      padding: 8px 14px; font-size: 12px; font-weight: 700; color: #1e293b;
      letter-spacing: .04em; }
    .ms-kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px;
      background: #e2e8f0; }
    .ms-kpi { background: #fff; padding: 10px 14px; }
    .ms-kpi-label { font-size: 10px; font-weight: 700; color: #94a3b8;
      text-transform: uppercase; letter-spacing: .07em; margin-bottom: 3px; }
    .ms-kpi-value { font-size: 16px; font-weight: 800; color: #1e293b; }
    .ms-kpi-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
    .ms-amt { text-align: right; font-weight: 700; font-size: 13px; padding: 5px 8px; }
    table tr:nth-child(even) td { background: #f8fafc; }
    table td { padding: 5px 8px; font-size: 12px; color: #1e293b; }
    .ms-footer { text-align: center; font-size: 10px; color: #94a3b8;
      margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
    @media print {
      body { padding: 10px; }
      .ms-section { margin-bottom: 12px; }
      @page { margin: 1.5cm; }
    }
  `;

  const salesHtml   = _msBuildSalesSummary(mon);
  const mgrHtml     = _msBuildManagerSummary(mon);
  const alertsHtml  = _msBuildAlerts();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BT Sales IC — Manager Summary</title>
  <style>${css}</style>
</head>
<body>
  <div class="ms-header">
    <div class="ms-header-title">🏬 BT Sales IC — Manager Summary</div>
    <div class="ms-header-sub">Generated: ${printDate}</div>
  </div>
  ${salesHtml}
  ${mgrHtml}
  ${alertsHtml}
  <div class="ms-footer">BT Sales IC · Confidential · Generated from app data</div>
</body>
</html>`;
}

/* ══════════════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════════════ */
function exportManagerSummary(mon) {
  mon = mon || _msLatestManagerMonth();
  const html = buildManagerSummaryHTML(mon);
  const win  = window.open('', '_blank', 'width=740,height=900');
  if (!win) {
    if (typeof toast === 'function') toast('⚠️ Pop-up blocked — please allow pop-ups and try again.', 'w');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    try { win.print(); } catch(_) {}
  }, 400);
}
