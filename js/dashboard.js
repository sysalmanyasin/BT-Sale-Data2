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
  const curY=new Date().getFullYear();
  const ytd=MONTHLY.filter(m=>m.Month_Year.includes(curY)).reduce((s,m)=>s+n(m.TOTAL),0);
  const pYtd=MONTHLY.filter(m=>m.Month_Year.includes(curY-1)).reduce((s,m)=>s+n(m.TOTAL),0);

  const tgts=getTgts(), latTgt=tgts[lat.Month_Year];
  const latAct=n(lat.TOTAL);
  const latDays=DAILY.filter(d=>d.Month_Year===lat.Month_Year&&n(d.TOTAL)>0).length;
  const daysInMon=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
  const dailyAvg=latDays?latAct/latDays:0;
  const forecastTotal=dailyAvg*daysInMon;
  const avgBill=n(lat.Customers)?latAct/n(lat.Customers):0;
  const pAvgBill=n(prv.Customers)?n(prv.TOTAL)/n(prv.Customers):0;
  const cagr=yearlyCAGR();
  const bScore=branchScore(lat,prv,latTgt,latAct);

  const kpis=[
    ...(latTgt?[{label:'🎯 Forecast vs Target — '+lat.Month_Year,value:Math.min(100,Math.round(forecastTotal/latTgt*100))+'% of ₨'+ff(latTgt),
      sub:'Projected ₨'+fc(forecastTotal)+' · Day '+latDays+'/'+daysInMon,
      bar:{pct:Math.min(100,Math.round(forecastTotal/latTgt*100)),cls:forecastTotal/latTgt>=1?'g':forecastTotal/latTgt>=.75?'a':'r'},
      extra:'Remaining ₨'+fc(Math.max(0,latTgt-latAct)),
      borderColor:forecastTotal/latTgt>=1?'var(--green)':forecastTotal/latTgt>=.75?'var(--amber)':'var(--red)'}]:[]),
    {label:'Latest Month',value:'₨ '+ff(n(lat.TOTAL)),delta:pct(n(lat.TOTAL),n(prv.TOTAL))+' vs prev',up:n(lat.TOTAL)>=n(prv.TOTAL)},
    {label:'Cash Sales (Cash+Bank)',value:'₨ '+ff(cashSales(lat)),delta:pct(cashSales(lat),cashSales(prv))+' vs prev',up:cashSales(lat)>=cashSales(prv)},
    {label:'Credit Sales',value:'₨ '+ff(creditSales(lat)),delta:pct(creditSales(lat),creditSales(prv))+' vs prev',up:creditSales(lat)>=creditSales(prv)},
    {label:'Avg Bill Size',value:'₨ '+ff(avgBill),delta:pct(avgBill,pAvgBill)+' vs prev',up:avgBill>=pAvgBill},
    {label:'Customers (Latest)',value:fc(n(lat.Customers)),delta:pct(n(lat.Customers),n(prv.Customers))+' vs prev',up:n(lat.Customers)>=n(prv.Customers)},
    {label:'YTD '+curY,value:'₨ '+ff(ytd),delta:pct(ytd,pYtd)+' vs '+(curY-1),up:ytd>=pYtd},
    ...(cagr!=null?[{label:'CAGR Since 2020',value:cagr.toFixed(1)+'%',sub:'TTM vs first 12 months'}]:[]),
    ...(bScore!=null?[{label:'Branch Performance Score',value:bScore+'/100',
      bar:{pct:bScore,cls:bScore>=75?'g':bScore>=50?'a':'r'},
      borderColor:bScore>=75?'var(--green)':bScore>=50?'var(--amber)':'var(--red)'}]:[]),
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
  const managerMonth = latestManagerMonth() || (lat && lat.Month_Year);
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
  return Array.from(found).sort((a, b) => _monthSortVal(b) - _monthSortVal(a))[0] || '';
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
  const cols=['TOTAL','Cash Sale','HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)','F/Issue','Customers'];
  const tbl=document.getElementById('tbl-summary');
  tbl.innerHTML='<thead><tr><th>Month</th>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr></thead>';
  const tbody=document.createElement('tbody');
  last12.forEach(m=>{ const tr=document.createElement('tr'); tr.innerHTML='<td>'+m.Month_Year+'</td>'+cols.map(c=>{ const v=n(m[c]); return '<td>'+(v?'₨'+fc(v):'—')+'</td>'; }).join(''); tbody.appendChild(tr); });
  const tf=document.createElement('tfoot'); const tr2=document.createElement('tr');
  tr2.innerHTML='<td><strong>TOTAL</strong></td>'+cols.map(c=>{ const s=last12.reduce((a,m)=>a+n(m[c]),0); return '<td><strong>'+(s?'₨'+fc(s):'—')+'</strong></td>'; }).join('');
  tf.appendChild(tr2); tbl.appendChild(tbody); tbl.appendChild(tf);
}
