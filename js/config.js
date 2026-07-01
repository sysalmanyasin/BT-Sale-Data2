// ══════════════════════════════════════════════════════════════════════
// FLOOR 2 — PROTECTED STATE STORE
//
// MONTHLY / DAILY / STAFF are wrapped in a Proxy. Every mutation goes
// through the _protectArray trap. If a mutation happens OUTSIDE a
// Repository._withInternalWrite() call, it means something bypassed
// the architecture — the trap fires a console.error and a toast so it's
// immediately visible, instead of silently corrupting state.
//
// This closes audit finding CF-05: the old Proxy only counted raw
// mutations passively. Now it also reports WHAT bypassed and WHERE,
// making the enforcement real rather than just observational.
// ══════════════════════════════════════════════════════════════════════
function _protectArray(arr, label) {
  return new Proxy(arr, {
    set(target, prop, value) {
      const ok = Reflect.set(target, prop, value);
      // 'length' changes happen legitimately during Array method calls
      // (push, splice, sort, fill). Only flag named index mutations.
      if (prop !== 'length' && ok && typeof Repository !== 'undefined') {
        if (!Repository.isInternalWrite()) {
          const site = (new Error()).stack.split('\n').slice(2, 4).join(' ').trim();
          console.error('[Architecture] RAW MUTATION on ' + label + '[' + prop + ']. Bypassed Repository. Site: ' + site);
          Repository._noteRawMutation(label);
          try { if (typeof toast === 'function') toast('⚠ Architecture violation: direct ' + label + ' write — check console', 'e'); } catch(e) {}
        }
      }
      return ok;
    },
    deleteProperty(target, prop) {
      const ok = Reflect.deleteProperty(target, prop);
      if (ok && typeof Repository !== 'undefined') {
        if (!Repository.isInternalWrite()) {
          console.error('[Architecture] RAW DELETE on ' + label + '[' + prop + ']. Bypassed Repository.');
          Repository._noteRawMutation(label);
        }
      }
      return ok;
    }
  });
}

let MONTHLY = _protectArray([], 'MONTHLY');
let DAILY   = _protectArray([], 'DAILY');
let STAFF   = _protectArray([], 'STAFF');
let newEntries = [];

const STAFF_KEY = 'BT_Staff_v1';

let _charts   = {};
let _printDay = null;   // holds the day record currently shown in day modal
let _curMon   = null;   // holds the month currently open in month modal

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
const n  = v => (v==null||v===''||isNaN(parseFloat(v)))?0:parseFloat(v);
// Returns fields must always reduce the total, so always stored/summed as negative.
const negR = v => { const x = n(v); return x > 0 ? -x : x; };
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
const cashSales = m => n(m['Cash Sale']) + negR(m['Cash Returns']) + mBanks(m);
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const pctNum = (a,b) => b?((a-b)/b*100):0;

// ══════════════════════════════════════════
// DATE NORMALIZATION
// ══════════════════════════════════════════
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
  affectedMonths.forEach(my => recomputeMonthly(my));
}

// ══════════════════════════════════════════
// MONTHLY FIELD CONFIG
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
const RETURN_FIELDS = new Set([
  'Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns'
]);

// ══════════════════════════════════════════
// AUTO-COMPUTE MONTHLY FROM DAILY
// ══════════════════════════════════════════
function recomputeMonthly(monthYear) {
  const days = DAILY.filter(d => d.Month_Year === monthYear);
  if (!days.length) return;

  let rec = MONTHLY.find(x => x.Month_Year === monthYear);
  if (!rec) {
    rec = { Month_Year: monthYear };
    Repository.upsertMonthly(rec);
    Repository.sortMonthlyChronological();
  }

  MONTHLY_SUM_FIELDS.forEach(field => {
    const pick = RETURN_FIELDS.has(field) ? negR : n;
    const sum = days.reduce((s, d) => s + pick(d[field]), 0);
    rec[field] = sum || null;
  });
  rec['TOTAL'] = String(days.reduce((s, d) => s + n(d['TOTAL']), 0));
  rec['Sale Plus'] = null;
  const _diffVal = Math.round(n(rec['TOTAL']) - n(rec['COMP SALE']));
  rec['DIFF'] = _diffVal !== 0 ? String(_diffVal) : null;
}

function recomputeAllMonths() {
  const allMonths = [...new Set(DAILY.map(d => d.Month_Year))];
  allMonths.forEach(my => recomputeMonthly(my));
}

// ══════════════════════════════════════════
// ANALYTICS HELPERS (moved from config.js /
// formerly duplicated in dashboard.js)
// ══════════════════════════════════════════
function yearlyCAGR() {
  if (MONTHLY.length < 24) return null;
  const first12 = MONTHLY.slice(0,12).reduce((s,m)=>s+n(m.TOTAL),0);
  const last12  = MONTHLY.slice(-12).reduce((s,m)=>s+n(m.TOTAL),0);
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
