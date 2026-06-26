// ══════════════════════════════════════════
function buildDashboard() {
  const yr = document.getElementById('dash-year')?.value;
  const data = yr ? MONTHLY.filter(m=>m.Month_Year.endsWith(yr)) : MONTHLY;

  // Grand total
  const gTotal = MONTHLY.reduce((s,m)=>s+n(m.TOTAL),0);
  document.getElementById('grand-total').textContent = fc(gTotal);
  document.getElementById('hero-sub').textContent =
    MONTHLY.length+' months · '+DAILY.filter(d=>n(d.TOTAL)>0).length+' records · Latest: '+MONTHLY[MONTHLY.length-1].Month_Year;

  // KPIs
  const lat=MONTHLY[MONTHLY.length-1], prv=MONTHLY[MONTHLY.length-2];
  const _now=new Date();
  const curY=_now.getFullYear();

  // ── Same-Period (MTD) helpers ───────────────────────────────────
  // Parse day number from DAILY Date field ('20/Jun/2026' → 20)
  function _dayOf(dateStr){ return parseInt((dateStr||'').split('/')[0],10)||0; }

  // Check if a Month_Year string equals the current running month
  const _MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const _curMonthYear=_MN[_now.getMonth()]+' '+curY;
  const _isLive = lat.Month_Year === _curMonthYear;

  // Last day with actual filled data in current month (NOT calendar today)
  // e.g. if data entered up to June 23, use 23 — not 24
  const _lastFilledDay = _isLive
    ? Math.max(0, ...DAILY.filter(d=>d.Month_Year===lat.Month_Year && n(d.TOTAL)>0).map(d=>_dayOf(d.Date)))
    : 0;

  // Sum DAILY totals for a given Month_Year, only up to dayLimit
  function _dailyMTD(monthYear, dayLimit){
    return DAILY.filter(d=>d.Month_Year===monthYear && _dayOf(d.Date)<=dayLimit)
                .reduce((s,d)=>s+n(d.TOTAL),0);
  }
  // Same for any numeric field
  function _dailyMTDField(monthYear, dayLimit, field){
    return DAILY.filter(d=>d.Month_Year===monthYear && _dayOf(d.Date)<=dayLimit)
                .reduce((s,d)=>s+n(d[field]),0);
  }

  // Previous month comparison values:
  //   If current month is live → compare vs same last-filled day in prev month
  //   If latest month is already complete → compare full months as before
  const _D=_lastFilledDay;
  const _prvTotal     = _isLive ? _dailyMTD(prv.Month_Year,_D) : n(prv.TOTAL);
  const _prvCash      = _isLive ? (['Cash Sale','HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)']
                          .reduce((s,f)=>s+_dailyMTDField(prv.Month_Year,_D,f),0)
                          - Math.abs(_dailyMTDField(prv.Month_Year,_D,'Cash Returns'))) : cashSales(prv);
  const _prvCredit    = _isLive ? CLIENT_COLS.reduce((s,c)=>s+_dailyMTDField(prv.Month_Year,_D,c),0) : creditSales(prv);
  const _prvCustomers = _isLive ? _dailyMTDField(prv.Month_Year,_D,'Customers') : n(prv.Customers);
  const _vsLabel      = _isLive ? 'vs prev (day 1–'+_D+')' : 'vs prev';

  // YTD — compare current year vs same period last year (up to last filled day)
  const _curMonthIdx=_now.getMonth(); // 0-based
  // Current YTD: all months of curY (lat already holds partial total for live month)
  const ytd=MONTHLY.filter(m=>{ const p=m.Month_Year.split(' '); return parseInt(p[1])===curY; }).reduce((s,m)=>s+n(m.TOTAL),0);
  // Prev year same period: complete months Jan to (curMonth-1) + same last-filled day of curMonth last year
  const _prevSameMonthYear=_MN[_curMonthIdx]+' '+(curY-1);
  const pYtd=MONTHLY.filter(m=>{ const p=m.Month_Year.split(' '); return parseInt(p[1])===(curY-1) && _MN.indexOf(p[0])<_curMonthIdx; }).reduce((s,m)=>s+n(m.TOTAL),0)
             + (_isLive ? _dailyMTD(_prevSameMonthYear,_D) : 0);
  const _ytdVsLabel=_isLive ? 'vs '+(curY-1)+' (1–'+_D+' '+_MN[_curMonthIdx]+')' : 'vs '+(curY-1);

  const tgts=getTgts(), latTgt=tgts[lat.Month_Year];
  const latAct=n(lat.TOTAL);
  const latDays=DAILY.filter(d=>d.Month_Year===lat.Month_Year&&n(d.TOTAL)>0).length;
  const daysInMon=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
  const dailyAvg=latDays?latAct/latDays:0;
  const forecastTotal=dailyAvg*daysInMon;
  const avgBill=n(lat.Customers)?latAct/n(lat.Customers):0;
  const pAvgBill=_prvCustomers?_prvTotal/_prvCustomers:0;
  const cagr=yearlyCAGR();
  const bScore=branchScore(lat,prv,latTgt,latAct);

  const kpis=[
    ...(latTgt?[{label:'🎯 Forecast vs Target — '+lat.Month_Year,value:Math.min(100,Math.round(forecastTotal/latTgt*100))+'% of ₨'+ff(latTgt),
      sub:'Projected ₨'+fc(forecastTotal)+' · Day '+latDays+'/'+daysInMon,
      bar:{pct:Math.min(100,Math.round(forecastTotal/latTgt*100)),cls:forecastTotal/latTgt>=1?'g':forecastTotal/latTgt>=.75?'a':'r'},
      extra:'Remaining ₨'+fc(Math.max(0,latTgt-latAct)),
      borderColor:forecastTotal/latTgt>=1?'var(--green)':forecastTotal/latTgt>=.75?'var(--amber)':'var(--red)'}]:[]),
    {label:'Latest Month'+(_isLive?' (day 1–'+_D+')':''),value:'₨ '+ff(n(lat.TOTAL)),delta:pct(n(lat.TOTAL),_prvTotal)+' '+_vsLabel,up:n(lat.TOTAL)>=_prvTotal},
    {label:'Cash Sales (Cash+Bank)',value:'₨ '+ff(cashSales(lat)),delta:pct(cashSales(lat),_prvCash)+' '+_vsLabel,up:cashSales(lat)>=_prvCash},
    {label:'Credit Sales',value:'₨ '+ff(creditSales(lat)),delta:pct(creditSales(lat),_prvCredit)+' '+_vsLabel,up:creditSales(lat)>=_prvCredit},
    {label:'Avg Bill Size',value:'₨ '+ff(avgBill),delta:pct(avgBill,pAvgBill)+' vs prev',up:avgBill>=pAvgBill},
    {label:'Customers (Latest)',value:fc(n(lat.Customers)),delta:pct(n(lat.Customers),_prvCustomers)+' '+_vsLabel,up:n(lat.Customers)>=_prvCustomers},
    {label:'YTD '+curY,value:'₨ '+ff(ytd),delta:pct(ytd,pYtd)+' '+_ytdVsLabel,up:ytd>=pYtd},
    ...(cagr!=null?[{label:'CAGR Since 2020',value:cagr.toFixed(1)+'%',sub:'TTM vs first 12 months'}]:[]),
    ...(bScore!=null?[{label:'Branch Performance Score',value:bScore+'/100',
      bar:{pct:bScore,cls:bScore>=75?'g':bScore>=50?'a':'r'},
      borderColor:bScore>=75?'var(--green)':bScore>=50?'var(--amber)':'var(--red)'}]:[]),
    // Cumulative DIFF KPI
    (()=>{
      const cumDiff=MONTHLY.reduce((s,m)=>s+Math.round(n(m.TOTAL)-n(m['COMP SALE'])),0);
      const sign=cumDiff>=0?'+':'';
      const col=cumDiff>0?'var(--green)':cumDiff<0?'var(--red)':'var(--muted)';
      const lbl=cumDiff>0?'Physical ahead of system':'System ahead of physical';
      return {label:'📉 CC Difference',value:sign+'₨ '+ff(cumDiff),
        sub:lbl+' · '+MONTHLY.length+' months',borderColor:col};
    })(),
  ];

  document.getElementById('krow').innerHTML=kpis.map(k=>`
    <div class="kpi" style="${k.borderColor?'border-color:'+k.borderColor:''}">
      <div class="klabel">${k.label}</div>
      <div class="kvalue">${k.value}</div>
      ${k.bar?'<div class="kpbar"><div class="kpfill '+k.bar.cls+'" style="width:'+k.bar.pct+'%"></div></div>':
       (k.delta?'<div class="kdelta '+(k.up?'up':'dn')+'">'+(k.up?'▲':'▼')+' '+k.delta+'</div>':'')}
      ${k.sub?'<div style="font-size:10px;color:var(--muted);margin-top:4px">'+k.sub+'</div>':''}
      ${k.extra?'<div style="font-size:10px;color:var(--muted);margin-top:2px">'+k.extra+'</div>':''}
    </div>`).join('');

  buildCharts(data);
  buildSummaryTable();
  buildTop10Days();
  buildDayOfWeek();
  buildBestWorstPerYear();
  const managerMonth = latestManagerMonth() || latestSalesMonthForDashboard(lat);
  buildCreditSection(managerMonth);

  // populate Working summary for the latest manager month
  if (typeof populateDashWorking === 'function') populateDashWorking(managerMonth || '');
}

// ══════════════════════════════════════════
// DASHBOARD CREDIT DETAILS SECTION
// ══════════════════════════════════════════
function _monthSortVal(my) {
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const parts = String(my || '').split(' ');
  const idx = MN.indexOf(parts[0]);
  const yr = parseInt(parts[1], 10);
  return idx >= 0 && !isNaN(yr) ? yr * 12 + idx : -1;
}

function _currentMonthVal() {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

function latestSalesMonthForDashboard(lat) {
  const current = _currentMonthVal();
  if (lat && _monthSortVal(lat.Month_Year) <= current) return lat.Month_Year;
  const latest = [...MONTHLY].reverse().find(m => _monthSortVal(m.Month_Year) <= current);
  return latest ? latest.Month_Year : '';
}

function managerMonthHasData(my) {
  let hasData = false;
  try {
    const mgr = mgrLoad();
    const salary = (mgr.salary && mgr.salary[my]) || [];
    const generic = (mgr.generic && mgr.generic[my]) || [];
    const expense = mgr.expense && mgr.expense[my];
    const credit = (mgr.credit && mgr.credit[my]) || [];
    hasData = hasData
      || salary.some(r => _ni(r.hoSal) || _ni(r.advance) || _ni(r.generic))
      || generic.some(r => _ni(r.genericSale) || _ni(r.extra))
      || !!(expense && (_ni(expense.opening) || (expense.rows || []).some(r => _ni(r.bill) || _ni(r.fuel) || _ni(r.soap) || _ni(r.refresh) || _ni(r.extra) || _ni(r.pattyHO))))
      || credit.some(emp => _ni(emp.prevBal) || _ni(emp.salary) || _ni(emp.lessGeneric) || (emp.entries || []).some(e => _ni(e.amount) || e.desc || e.date));
  } catch(e) {}
  try {
    hasData = hasData || (typeof _pettyTotalForMonth === 'function' && _pettyTotalForMonth(my) !== 0);
  } catch(e) {}
  try {
    const csecAll = typeof _csecLoad === 'function' ? _csecLoad() : {};
    hasData = hasData || Object.values(csecAll).some(sec => ((sec && sec.months && sec.months[my]) || []).some(r => (parseFloat(r.amount) || 0) !== 0 || r.desc || r.notes));
  } catch(e) {}
  try {
    const inc = JSON.parse(localStorage.getItem('mw_incentive_' + my) || '{}');
    hasData = hasData || Object.values(inc).some(v => _ni(v) !== 0);
  } catch(e) {}
  return hasData;
}

function latestManagerMonth() {
  const found = new Set();
  try {
    const mgr = mgrLoad();
    ['salary','generic','expense','credit'].forEach(k => {
      Object.keys(mgr[k] || {}).forEach(m => found.add(m));
    });
  } catch(e) {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mw_petty_')) found.add(k.slice('mw_petty_'.length));
    }
  } catch(e) {}
  try {
    const csecAll = typeof _csecLoad === 'function' ? _csecLoad() : {};
    Object.values(csecAll).forEach(sec => Object.keys((sec && sec.months) || {}).forEach(m => found.add(m)));
  } catch(e) {}
  const current = _currentMonthVal();
  return Array.from(found)
    .filter(m => _monthSortVal(m) <= current && managerMonthHasData(m))
    .sort((a, b) => _monthSortVal(b) - _monthSortVal(a))[0] || '';
}

function buildCreditSection(lat) {
  const el = document.getElementById('dash-credit-section');
  if (!el || !lat) return;

  const my = typeof lat === 'string' ? lat : lat.Month_Year;
  const mgrData = mgrLoad();

  // ── 1. Staff Credit: net balance per employee ──────────────────
  const crdRows = (mgrData.credit && mgrData.credit[my]) || [];
  const staffCreditRows = crdRows.map(emp => {
    const entriesTotal = (emp.entries||[]).reduce((s,e) => s + _ni(e.amount), 0);
    const net = _ni(emp.prevBal) + entriesTotal - _ni(emp.salary) - _ni(emp.lessGeneric);
    return { name: emp.name, net };
  }).filter(r => r.net !== 0);
  const staffCreditTotal = staffCreditRows.reduce((s,r) => s + r.net, 0);

  // ── 2. Patty / Expense balance ─────────────────────────────────
  const expData = mgrData.expense && mgrData.expense[my];
  let pattyTotal = 0;
  let pattyRows = [];
  if (expData) {
    const rows = expData.rows || [];
    const opening   = _ni(expData.opening);
    const totHO     = rows.reduce((s,r) => s + _ni(r.pattyHO), 0);
    const totBill   = rows.reduce((s,r) => s + _ni(r.bill), 0);
    const totFuel   = rows.reduce((s,r) => s + _ni(r.fuel), 0);
    const totSoap   = rows.reduce((s,r) => s + _ni(r.soap), 0);
    const totRef    = rows.reduce((s,r) => s + _ni(r.refresh), 0);
    const totExt    = rows.reduce((s,r) => s + _ni(r.extra), 0);
    const totalExp  = totBill + totFuel + totSoap + totRef + totExt;
    pattyTotal = opening + totHO - totalExp;
    pattyRows = [
      { name: 'Opening Patty',    net:  opening  },
      { name: 'HO Received',      net:  totHO    },
      { name: 'Total Expenses',   net: -totalExp  },
    ].filter(r => r.net !== 0);
  }

  // ── 3. Other Credits: Custom Sections totals for this month ────
  const csecAll = _csecLoad();
  const otherRows = Object.values(csecAll).map(sec => {
    const rows = (sec.months && sec.months[my]) || [];
    const total = rows.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
    return { name: (sec.emoji||'📋') + ' ' + sec.name, net: total };
  }).filter(r => r.net !== 0);
  const otherTotal = otherRows.reduce((s,r) => s + r.net, 0);

  // ── Grand total ────────────────────────────────────────────────
  const grandCredit = staffCreditTotal + pattyTotal + otherTotal;

  // ── Helpers ────────────────────────────────────────────────────
  const fmtAmt = v => (v < 0 ? '−' : '') + '₨' + _fc2(Math.abs(v));
  const amtColor = v => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--muted)';

  const detailRows = rows => rows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--t2)">${r.name}</span>
      <span style="font-size:11px;font-family:var(--mono);font-weight:600;color:${amtColor(r.net)}">${fmtAmt(r.net)}</span>
    </div>`).join('') || `<div style="font-size:11px;color:var(--muted);padding:4px 0">No data for ${my}</div>`;

  const sectionCard = (icon, title, rows, total, accent) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:14px 16px;box-shadow:var(--sh)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--t2)">${icon} ${title}</div>
        <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:${amtColor(total)}">${fmtAmt(total)}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:8px">${detailRows(rows)}</div>
    </div>`;

  el.innerHTML = `
    <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">💳 Credit Details — ${my}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px">
      ${sectionCard('👥', 'Staff Credit', staffCreditRows, staffCreditTotal, 'var(--accent)')}
      ${sectionCard('🧾', 'Patty / Expenses', pattyRows, pattyTotal, 'var(--amber)')}
      ${sectionCard('📋', 'Other Credits', otherRows, otherTotal, 'var(--purple)')}
    </div>
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:11px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:3px">Total Outstanding Credits — ${my}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.4)">Staff + Patty + Other</div>
      </div>
      <div style="font-size:24px;font-weight:700;font-family:var(--mono);color:${grandCredit >= 0 ? '#4ade80' : '#f87171'}">${fmtAmt(grandCredit)}</div>
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
