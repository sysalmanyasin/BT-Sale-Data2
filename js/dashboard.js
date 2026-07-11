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

// Called by the month <select> inside the credit section on the dashboard.
// Re-renders the credit block and the Working Summary for the chosen month.
function dashSetCreditMonth(my) {
  _dashCreditMonthOverride = my;
  const resolved = my || _dashRunningMonth();
  buildCreditSection(resolved);
  if (typeof populateDashWorking === 'function') populateDashWorking(resolved || '');
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
    lat, prv, isLive, D, vsLabel, ytdVsLabel,
    gTotal, dailyRecordCount,
    prvTotal, prvCash, prvCredit, prvCustomers,
    ytd, pYtd, curY,
    latTgt, latAct, latDays, daysInMon, dailyAvg, forecastTotal,
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

  // Manager month: use user override if set, otherwise the running
  // calendar month from day 1 (see _dashRunningMonth() for why this no
  // longer falls back to "last month with manager data" by default).
  const managerMonth = _dashCreditMonthOverride || _dashRunningMonth();
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

  // All data aggregation lives in Analytics (Floor 3)
  const d = Analytics.getCreditSectionData(my);

  // ── Pure render helpers ────────────────────────────────────────
  const fmtAmt  = v => (v < 0 ? '−' : '') + '₨' + _fc2(Math.abs(v));
  const amtColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)';

  const detailRows = rows => rows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--t2)">${r.name}</span>
      <span style="font-size:11px;font-family:var(--mono);font-weight:600;color:${amtColor(r.net)}">${fmtAmt(r.net)}</span>
    </div>`).join('') || `<div style="font-size:11px;color:var(--muted);padding:4px 0">No activity yet</div>`;

  const sectionCard = (icon, title, rows, total, navTab) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:14px 16px;box-shadow:var(--sh)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--t2)">${icon} ${title}
          ${navTab ? `<span onclick="navigateTo('manager');setTimeout(()=>{switchMgrTab('${navTab}');},200)" style="font-size:9px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;margin-left:6px;cursor:pointer;font-weight:700">OPEN ↗</span>` : ''}
        </div>
        <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:${amtColor(total)}">${fmtAmt(total)}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:8px">${detailRows(rows)}</div>
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
      ${sectionCard('👥', 'Staff Credit — ' + my, d.staffRows, d.staffTotal)}
      ${sectionCard('💚', 'Jazz Cash (all-time)', d.jazzCashRows, d.jazzCashTotal, 'jazzcash')}
      ${sectionCard('🧾', 'Patty / Expenses (all-time)', d.pattyRows, d.pattyTotal, 'expense')}
    </div>
    ${d.otherSections.length ? `
    <div style="margin:14px 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">📋 Other Sections (all-time)</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px">
      ${d.otherSections.map(sec => sectionCard('📋', sec.label, sec.rows, sec.total, 'custom')).join('')}
    </div>` : ''}
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:11px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:3px">Total Outstanding Credits</div>
        <div style="font-size:10px;color:rgba(255,255,255,.4)">Staff (${my}) + Jazz Cash + Patty/Expenses + Other Sections, all-time</div>
      </div>
      <div style="font-size:24px;font-weight:700;font-family:var(--mono);color:${d.grandTotal >= 0 ? '#4ade80' : '#f87171'}">${fmtAmt(d.grandTotal)}</div>
    </div>`;
}

const CHART_OPTS = {responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{color:'#334155',font:{size:10}}}},
  scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'#f1f5f9'}},
          y:{ticks:{color:'#64748b',font:{size:9},callback:v=>'₨'+ff(v)},grid:{color:'#e2e8f0'}}}};
function dc(id){if(_charts[id]){_charts[id].destroy();delete _charts[id];}}

function buildCharts(data) {
  const lbl=data.map(m=>{ const[mn,yr]=m.Month_Year.split(' '); return mn.slice(0,3)+' '+yr.slice(2); });
  dc('ch-total');
  _charts['ch-total']=new Chart(document.getElementById('ch-total'),{type:'bar',
    data:{labels:lbl,datasets:[{label:'Total',data:data.map(m=>n(m.TOTAL)),backgroundColor:'rgba(37,99,235,.6)',borderColor:'#2563eb',borderWidth:1.5,borderRadius:3}]},
    options:{...CHART_OPTS,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'₨'+fc(c.raw)}}}}});

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

})();
