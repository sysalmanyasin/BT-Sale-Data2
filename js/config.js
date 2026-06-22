let MONTHLY = [...MONTHLY_BASE];
let DAILY   = [...DAILY_BASE];
let newEntries = [];
let _charts = {};
let _printDay = null;   // holds the day record currently shown in day modal
let _curMon = null;    // holds the month currently open in month modal

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
const n  = v => (v==null||v===''||isNaN(parseFloat(v)))?0:parseFloat(v);
const ff = v => { const a=Math.abs(Math.round(v)); return a>=1e6?(v/1e6).toFixed(2)+'M':a>=1000?Math.round(v).toLocaleString('en-PK'):String(Math.round(v)); };
const fc = v => Math.round(v).toLocaleString('en-PK');
const fv = v => { const r=Math.round(n(v)); if(r===0)return '0'; const s=Math.abs(r).toLocaleString('en-PK'); return r<0?'-'+s:s; };
const pct = (a,b) => b?((a-b)/b*100).toFixed(1)+'%':'—';
const BANK_COLS = ['HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)','Askari Bank','Askari Bank Returns'];
const mBanks = m => BANK_COLS.reduce((s,k)=>s+n(m[k]),0);
const years  = () => [...new Set(MONTHLY.map(m=>m.Month_Year.split(' ').pop()))].sort();
const months = () => [...new Set(DAILY.map(d=>d.Month_Year))];
const CC = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#be185d','#65a30d','#9333ea','#c2410c'];
const CLIENT_COLS = ['PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda'];
const creditSales = m => CLIENT_COLS.reduce((s,c)=>s+n(m[c]),0);
const cashSales = m => n(m['Cash Sale']) + n(m['Cash Returns']) + mBanks(m);
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const pctNum = (a,b) => b?((a-b)/b*100):0;
function yearlyCAGR() {
  if (MONTHLY.length < 24) return null;
  const first12 = MONTHLY.slice(0,12).reduce((s,m)=>s+n(m.TOTAL),0);
  const last12 = MONTHLY.slice(-12).reduce((s,m)=>s+n(m.TOTAL),0);
  const yrsSpan = (MONTHLY.length-12)/12;
  if (first12<=0 || yrsSpan<=0) return null;
  return (Math.pow(last12/first12, 1/yrsSpan)-1)*100;
}
function branchScore(lat,prv,latTgt,latAct) {
  const comps=[];
  if (latTgt) comps.push(clamp(latAct/latTgt*100,0,100));
  const [mn,yr]=lat.Month_Year.split(' ');
  const yoyMonth=MONTHLY.find(m=>m.Month_Year===mn+' '+(parseInt(yr)-1));
  if (yoyMonth) comps.push(clamp(50+pctNum(n(lat.TOTAL),n(yoyMonth.TOTAL))*2.5,0,100));
  comps.push(clamp(50+pctNum(n(lat.Customers),n(prv.Customers))*2.5,0,100));
  if (!comps.length) return null;
  return Math.round(comps.reduce((a,b)=>a+b,0)/comps.length);
}
