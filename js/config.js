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
export function _protectArray(arr, label) {
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

export let MONTHLY = _protectArray([], 'MONTHLY');
export let DAILY   = _protectArray([], 'DAILY');
export let STAFF   = _protectArray([], 'STAFF');
export let newEntries = [];

export const STAFF_KEY = 'BT_Staff_v1';

export let _charts   = {};
export let _printDay = null;   // holds the day record currently shown in day modal
export let _curMon   = null;   // holds the month currently open in month modal

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
export const n  = v => (v==null||v===''||isNaN(parseFloat(v)))?0:parseFloat(v);
// Returns fields must always reduce the total, so always stored/summed as negative.
export const negR = v => { const x = n(v); return x > 0 ? -x : x; };
export const ff = v => { const a=Math.abs(Math.round(v)); return a>=1e6?(v/1e6).toFixed(2)+'M':a>=1000?Math.round(v).toLocaleString('en-PK'):String(Math.round(v)); };
export const fc = v => Math.round(v).toLocaleString('en-PK');
export const fv = v => { const r=Math.round(n(v)); if(r===0)return '0'; const s=Math.abs(r).toLocaleString('en-PK'); return r<0?'-'+s:s; };
export const pct = (a,b) => b?((a-b)/b*100).toFixed(1)+'%':'—';
export const BANK_COLS = ['HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)'];
export const mBanks = m => BANK_COLS.reduce((s,k)=>s+n(m[k]),0);
export const years  = () => [...new Set(MONTHLY.map(m=>m.Month_Year.split(' ').pop()))].sort();
export const months = () => [...new Set(DAILY.map(d=>d.Month_Year))];
export const CC = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#be185d','#65a30d','#9333ea','#c2410c'];
export const CLIENT_COLS = ['PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','Askari Bank','Askari Bank Returns'];
export const creditSales = m => CLIENT_COLS.reduce((s,c)=>s+n(m[c]),0);
export const cashSales = m => n(m['Cash Sale']) + negR(m['Cash Returns']) + mBanks(m);
export const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
export const pctNum = (a,b) => b?((a-b)/b*100):0;

// ══════════════════════════════════════════
// DATE NORMALIZATION
// ══════════════════════════════════════════
export function normalizeDates() {
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
export const MONTHLY_SUM_FIELDS = [
  'Cash Sale','Cash Returns','HBL','MCB','Alfala Bank','Bank Al Habib',
  'Meezan Bank (Paysa)','Askari Bank','Askari Bank Returns',
  'PSO','PSO Returns','NESPAK','NESPAK Returns','PARCO','PARCO Returns',
  'TEPA','TEPA Returns','LDA','LDA Returns','Gourmet','Wapda Hospital',
  'BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation',
  'Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','F/Issue',
  'TOTAL','COMP SALE','Customers','FDPP','FDPP Con',
  'Amount Received','Load Sale','Cash to be Deposited'
];
export const RETURN_FIELDS = new Set([
  'Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns'
]);

// ══════════════════════════════════════════
// DAILY FIELD CONFIG (single source of truth — was previously
// duplicated 3x across data-page.js: updateTotalPreview,
// editCalcTotal, and saveEditModal. Any field added here now
// automatically applies everywhere instead of needing 3 edits.)
// ══════════════════════════════════════════
export const DAILY_ADD_KEYS = ['Cash Sale','Meezan Bank (Paysa)','Alfala Bank','Bank Al Habib','HBL','MCB',
  'Askari Bank','PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints',
  'Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','F/Issue'];
export const DAILY_SUB_KEYS = ['Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns'];

// Computes and writes TOTAL/DIFF onto a daily record in place. This is
// the ONLY place that logic should live — Actions.editDailyEntry calls
// it after merging field changes, and the Pages-layer live preview
// (editCalcTotal) mirrors the same key lists so the preview can never
// drift from what actually gets saved.
export function computeDailyTotals(rec) {
  let t = 0;
  DAILY_ADD_KEYS.forEach(k => { t += Math.abs(n(rec[k])); });
  DAILY_SUB_KEYS.forEach(k => { t -= Math.abs(n(rec[k])); });
  if (typeof _fmCustom !== 'undefined') {
    _fmCustom.forEach(f => {
      if (f.calcType === 'none') return;
      const v = Math.abs(n(rec[f.id]));
      if (f.calcType === 'add') t += v; else if (f.calcType === 'sub') t -= v;
    });
  }
  rec['TOTAL'] = String(Math.round(t));
  const diff = Math.round(n(rec['TOTAL']) - n(rec['COMP SALE']));
  rec['DIFF'] = diff !== 0 ? String(diff) : null;
  return rec;
}

// ══════════════════════════════════════════
// AUTO-COMPUTE MONTHLY FROM DAILY
// ══════════════════════════════════════════
export function recomputeMonthly(monthYear) {
  const days = DAILY.filter(d => d.Month_Year === monthYear);
  if (!days.length) return;

  const existing = MONTHLY.find(x => x.Month_Year === monthYear);
  const isNew = !existing;

  // Compute into a fresh candidate object first — do NOT touch the live
  // `existing` record yet. This lets us compare old vs. new values below
  // and skip the notify entirely when nothing actually changed, instead
  // of always overwriting rec in place and only then "comparing" (which
  // would always show a change, since rec IS the live object).
  const candidate = isNew ? { Month_Year: monthYear } : {};
  MONTHLY_SUM_FIELDS.forEach(field => {
    const pick = RETURN_FIELDS.has(field) ? negR : n;
    const sum = days.reduce((s, d) => s + pick(d[field]), 0);
    candidate[field] = sum || null;
  });
  candidate['TOTAL'] = String(days.reduce((s, d) => s + n(d['TOTAL']), 0));
  candidate['Sale Plus'] = null;
  const _diffVal = Math.round(n(candidate['TOTAL']) - n(candidate['COMP SALE']));
  candidate['DIFF'] = _diffVal !== 0 ? String(_diffVal) : null;

  const changed = isNew || Object.keys(candidate).some(k => candidate[k] !== existing[k]);
  if (!changed) return; // nothing to do — avoids re-notifying subscribers
                          // (like manager.js's rebuildAll listener) with
                          // no actual change, which was causing a ~300ms
                          // notify → rebuildAll → recompute → notify loop.

  const rec = isNew ? candidate : Object.assign(existing, candidate);

  // Always go through Repository.upsertMonthly — this is the one door
  // that stamps metadata AND notifies EventBus, whether this is a brand
  // new month record or a genuine update to an existing one.
  Repository.upsertMonthly(rec);
  if (isNew) Repository.sortMonthlyChronological();
}

export function recomputeAllMonths() {
  const allMonths = [...new Set(DAILY.map(d => d.Month_Year))];
  allMonths.forEach(my => recomputeMonthly(my));
}

// ══════════════════════════════════════════
// ANALYTICS HELPERS (moved from config.js /
// formerly duplicated in dashboard.js)
// ══════════════════════════════════════════
export function yearlyCAGR() {
  if (MONTHLY.length < 24) return null;
  const first12 = MONTHLY.slice(0,12).reduce((s,m)=>s+n(m.TOTAL),0);
  const last12  = MONTHLY.slice(-12).reduce((s,m)=>s+n(m.TOTAL),0);
  const yrsSpan = (MONTHLY.length-12)/12;
  if (first12<=0 || yrsSpan<=0) return null;
  return (Math.pow(last12/first12, 1/yrsSpan)-1)*100;
}

export function branchScore(lat,prv,latTgt,latAct) {
  const comps=[];
  if (latTgt) comps.push(clamp(latAct/latTgt*100,0,100));
  const [mn,yr]=lat.Month_Year.split(' ');
  const yoyMonth=MONTHLY.find(m=>m.Month_Year===mn+' '+(parseInt(yr)-1));
  if (yoyMonth) comps.push(clamp(50+pctNum(n(lat.TOTAL),n(yoyMonth.TOTAL))*2.5,0,100));
  comps.push(clamp(50+pctNum(n(lat.Customers),n(prv.Customers))*2.5,0,100));
  if (!comps.length) return null;
  return Math.round(comps.reduce((a,b)=>a+b,0)/comps.length);
}

// ══════════════════════════════════════════════════════════════════════
// TEMPORARY WINDOW BRIDGE — remove once every consuming file has been
// converted to `import { ... } from './config.js'` (module-migration
// Stage B, file-by-file). Until then, the other 43 files are still
// classic <script> tags that reference these names as bare globals, so
// this bridge keeps them working unchanged. MONTHLY/DAILY/STAFF are
// mutated in place elsewhere (never reassigned) so a single reference
// copy here stays correct; _printDay/_curMon are the only exports that
// get reassigned outside this file, and only via bare-global writes
// (e.g. reports.js), which land here on window directly — safe, since
// nothing inside config.js itself ever reads them back.
// ══════════════════════════════════════════════════════════════════════
Object.assign(window, {
  _protectArray, MONTHLY, DAILY, STAFF, newEntries, STAFF_KEY, _charts, _printDay, _curMon,
  n, negR, ff, fc, fv, pct, BANK_COLS, mBanks, years, months, CC, CLIENT_COLS,
  creditSales, cashSales, clamp, pctNum, normalizeDates, MONTHLY_SUM_FIELDS, RETURN_FIELDS,
  DAILY_ADD_KEYS, DAILY_SUB_KEYS, computeDailyTotals, recomputeMonthly, recomputeAllMonths,
  yearlyCAGR, branchScore,
});
