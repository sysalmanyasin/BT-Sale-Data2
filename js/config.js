let MONTHLY = [...MONTHLY_BASE];
let DAILY   = [...DAILY_BASE];
let newEntries = [];
const STAFF_KEY = 'BT_Staff_v1';
let STAFF = [];   // [{id, name, designation, active}] — loaded from localStorage / Supabase
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
const BANK_COLS = ['HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)'];
const mBanks = m => BANK_COLS.reduce((s,k)=>s+n(m[k]),0);
const years  = () => [...new Set(MONTHLY.map(m=>m.Month_Year.split(' ').pop()))].sort();
const months = () => [...new Set(DAILY.map(d=>d.Month_Year))];
const CC = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#be185d','#65a30d','#9333ea','#c2410c'];
const CLIENT_COLS = ['PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','Askari Bank','Askari Bank Returns'];
const creditSales = m => CLIENT_COLS.reduce((s,c)=>s+n(m[c]),0);
const cashSales = m => n(m['Cash Sale']) + n(m['Cash Returns']) + mBanks(m);
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const pctNum = (a,b) => b?((a-b)/b*100):0;
// ══════════════════════════════════════════
// DATE NORMALIZATION
// Fixes entries manually added to JSON with ISO dates (YYYY-MM-DD)
// instead of the expected DD/Mon/YYYY format.
// Also recomputes MONTHLY.TOTAL for any affected months.
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// AUTO-COMPUTE MONTHLY FROM DAILY ENTRIES
// Called after every saveEntry() so dashboard, Month Index,
// Daily Records and Report Generator all stay in sync automatically.
// ══════════════════════════════════════════
const MONTHLY_SUM_FIELDS = [
  'Cash Sale','Cash Returns','HBL','MCB','Alfala Bank','Bank Al Habib',
  'Meezan Bank (Paysa)','Askari Bank','Askari Bank Returns',
  'PSO','PSO Returns','NESPAK','NESPAK Returns','PARCO','PARCO Returns',
  'TEPA','TEPA Returns','LDA','LDA Returns','Gourmet','Wapda Hospital',
  'BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation',
  'Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','F/Issue',
  'TOTAL','COMP SALE','Customers','FDPP','FDPP Con',
  'Amount Received','Load Sale','Cash to be Deposited'
];

function recomputeMonthly(monthYear) {
  // Get all daily entries for this month
  const days = DAILY.filter(d => d.Month_Year === monthYear);
  if (!days.length) return;

  // Find or create the MONTHLY record
  let rec = MONTHLY.find(x => x.Month_Year === monthYear);
  if (!rec) {
    rec = { Month_Year: monthYear };
    MONTHLY.push(rec);
    // Keep MONTHLY sorted chronologically
    const MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    MONTHLY.sort((a, b) => {
      const [am, ay] = a.Month_Year.split(' ');
      const [bm, by_] = b.Month_Year.split(' ');
      if (ay !== by_) return parseInt(ay) - parseInt(by_);
      return MO.indexOf(am) - MO.indexOf(bm);
    });
  }

  // Sum every numeric field from DAILY into MONTHLY
  MONTHLY_SUM_FIELDS.forEach(field => {
    const sum = days.reduce((s, d) => s + n(d[field]), 0);
    rec[field] = sum || null;
  });
  rec['TOTAL'] = String(days.reduce((s, d) => s + n(d['TOTAL']), 0));
  rec['Sale Plus'] = null;
  rec['DIFF'] = null;
}

// Recompute all months — called after Supabase pull so pulled data is always in sync
function recomputeAllMonths() {
  const allMonths = [...new Set(DAILY.map(d => d.Month_Year))];
  allMonths.forEach(my => recomputeMonthly(my));
}

function normalizeDates() {
  const _months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const isoRe=/^(\d{4})-(\d{2})-(\d{2})$/;
  const affectedMonths=new Set();

  DAILY.forEach(d=>{
    const m=isoRe.exec(d.Date);
    if(m){
      const [,yyyy,mm,dd]=m;
      d.Date=`${dd}/${_months[parseInt(mm,10)-1]}/${yyyy}`;
      affectedMonths.add(d.Month_Year);
    }
  });

  // Recompute MONTHLY for each affected month from DAILY entries
  affectedMonths.forEach(my => recomputeMonthly(my));
}

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
