// SALE BOOK CALC — pure functions, no DOM / window / fetch / storage.
//
// Turns the app's DAILY records into the Sale Book's fixed columns:
//   Date | Day | Cash | Cash Returns | Banks | Credit Clients | Total Sale |
//   Computer Sale | Sale Difference | Customers | FDPP POS | FDPP Consumer
//
// Definitions (match the app: js/platform/config.js, js/sales/fields.js):
//   Total Sale      = the stored TOTAL (the official figure).
//   Computer Sale   = COMP SALE.   Sale Difference = TOTAL - COMP SALE.
//   Cash            = Cash Sale.   Cash Returns = always negative (negR).
//   Banks           = HBL, MCB, Bank Alfalah, Bank Al Habib, Meezan + every custom field
//                     that is not in the "Credit Clients" section.
//   Credit Clients  = Askari, PSO, NESPAK, PARCO, TEPA, LDA, Gourmet ... F/Issue (returns
//                     netted) + every custom "Credit Clients" field. A custom_* value that is
//                     in the data but no longer in the field list (deleted field) counts here,
//                     because TOTAL still includes it.
// So   Cash + Cash Returns + Banks + Credit Clients = Total Sale   (checked per day: `drift`).

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const num = (v) => (v == null || v === '' || isNaN(parseFloat(v)) ? 0 : parseFloat(v));
const negR = (v) => { const x = num(v); return x > 0 ? -x : x; };

const BANK_KEYS = ['HBL', 'MCB', 'Alfala Bank', 'Bank Al Habib', 'Meezan Bank (Paysa)'];
const CREDIT_ADD = ['Askari Bank', 'PSO', 'NESPAK', 'PARCO', 'TEPA', 'LDA', 'Gourmet', 'Wapda Hospital',
  'BTH', 'Berger Paints', 'Ecolean PK', 'Style Textile', 'Syed Babar Ali Foundation', 'Rahnuma NGO',
  'Health Pass', 'Nisar Spinning Mills', 'Food Panda', 'F/Issue'];
const CREDIT_SUB = ['Askari Bank Returns', 'PSO Returns', 'NESPAK Returns', 'PARCO Returns',
  'TEPA Returns', 'LDA Returns'];
const NUM_COLS = ['cash', 'cashReturns', 'banks', 'credit', 'total', 'comp', 'diff', 'customers', 'fdpp', 'fdppCon'];
export { NUM_COLS };

/** "DD/Mon/YYYY" (or ISO "YYYY-MM-DD") -> {y, m (0-11), d, ts, dow} or null. */
export function parseDate(str) {
  if (!str) return null;
  let y, m, d;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (iso) { y = +iso[1]; m = +iso[2] - 1; d = +iso[3]; }
  else {
    const p = String(str).split('/');
    if (p.length !== 3) return null;
    d = parseInt(p[0], 10); y = parseInt(p[2], 10);
    m = MONTH_SHORT.findIndex((s) => s.toLowerCase() === p[1].slice(0, 3).toLowerCase());
  }
  if (!(y > 1999) || m < 0 || m > 11 || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m, d));
  return { y, m, d, ts: dt.getTime(), dow: dt.getUTCDay() };
}

/** Split the custom-field list (bt_custom_cols) into bank-side / credit-side ids and "sub" ids. */
export function fieldGroups(customCols) {
  const bank = [], credit = [], sub = new Set(), known = new Set(), labels = {};
  (Array.isArray(customCols) ? customCols : []).forEach((f) => {
    if (!f || !f.id || f.calcType === 'none') return;
    known.add(f.id); labels[f.id] = f.label || f.id;
    if (f.calcType === 'sub') sub.add(f.id);
    (f.section === 'Credit Clients' ? credit : bank).push(f.id);
  });
  return { bank, credit, sub, known, labels };
}

/** One DAILY record -> one Sale Book row. */
export function dayRow(rec, groups) {
  const g = groups || fieldGroups([]);
  const dt = parseDate(rec.Date);
  if (!dt) return null;
  const pick = (k) => (g.sub.has(k) ? -Math.abs(num(rec[k])) : num(rec[k]));
  const cash = num(rec['Cash Sale']);
  const cashReturns = negR(rec['Cash Returns']);
  let banks = BANK_KEYS.reduce((s, k) => s + num(rec[k]), 0);
  g.bank.forEach((k) => { banks += pick(k); });
  let credit = CREDIT_ADD.reduce((s, k) => s + num(rec[k]), 0)
    - CREDIT_SUB.reduce((s, k) => s + Math.abs(num(rec[k])), 0);
  g.credit.forEach((k) => { credit += pick(k); });
  Object.keys(rec).forEach((k) => { if (k.startsWith('custom_') && !g.known.has(k)) credit += num(rec[k]); });
  const total = num(rec.TOTAL);
  const comp = num(rec['COMP SALE']);
  const row = {
    date: rec.Date, ts: dt.ts, y: dt.y, m: dt.m, d: dt.d, dow: dt.dow, day: DAY_SHORT[dt.dow],
    cash, cashReturns, banks, credit, total,
    comp, diff: comp !== 0 ? total - comp : null,
    customers: num(rec.Customers), fdpp: num(rec.FDPP), fdppCon: num(rec['FDPP Con']),
    note: rec['Low Sale Reason'] || '',
  };
  row.drift = Math.round(total - (cash + cashReturns + banks + credit));
  row.hasData = total !== 0 || cash !== 0 || credit !== 0 || banks !== 0;
  return row;
}

/** All DAILY records -> sorted rows, one per date (later record wins on a duplicate date). */
export function buildRows(daily, customCols) {
  const g = fieldGroups(customCols);
  const byTs = new Map();
  (daily || []).forEach((rec) => { const r = dayRow(rec, g); if (r && r.hasData) byTs.set(r.ts, r); });
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/** Sum a list of rows into one totals object (+ days, averages, best/lowest day, drift count). */
export function summarize(rows) {
  const t = { days: rows.length, driftDays: 0, diffDays: 0 };
  NUM_COLS.forEach((k) => { t[k] = 0; });
  rows.forEach((r) => {
    NUM_COLS.forEach((k) => { if (r[k] != null) t[k] += r[k]; });
    if (r.diff != null) t.diffDays++;
    if (r.drift) t.driftDays++;
  });
  t.avgDay = t.days ? t.total / t.days : 0;
  t.avgBill = t.customers ? t.total / t.customers : 0;
  t.best = rows.reduce((b, r) => (!b || r.total > b.total ? r : b), null);
  t.low = rows.reduce((b, r) => (!b || r.total < b.total ? r : b), null);
  return t;
}

/** Average Total Sale per weekday (index 0 = Sunday). */
export function weekdayAverages(rows) {
  const sum = Array(7).fill(0), cnt = Array(7).fill(0);
  rows.forEach((r) => { sum[r.dow] += r.total; cnt[r.dow]++; });
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Calendar rows for one month: a recorded day gives its row, an unrecorded day gives
 * {missing:true}. A month that is not the last recorded month runs to its last day; the last
 * month stops at its last recorded day (no "missing" rows for days that have not happened).
 */
export function monthCalendar(rows, y, m, lastTs) {
  const mine = new Map(rows.filter((r) => r.y === y && r.m === m).map((r) => [r.d, r]));
  if (!mine.size) return [];
  const lastRec = Math.max(...mine.keys());
  const isLast = lastTs != null && new Date(lastTs).getUTCFullYear() === y && new Date(lastTs).getUTCMonth() === m;
  const end = isLast ? lastRec : daysInMonth(y, m);
  const out = [];
  for (let d = 1; d <= end; d++) {
    if (mine.has(d)) { out.push(mine.get(d)); continue; }
    const dt = new Date(Date.UTC(y, m, d));
    out.push({ missing: true, y, m, d, ts: dt.getTime(), dow: dt.getUTCDay(), day: DAY_SHORT[dt.getUTCDay()],
      date: `${String(d).padStart(2, '0')}/${MONTH_SHORT[m]}/${y}` });
  }
  return out;
}

/** Months (with data) inside a scope: {type:'month',y,m} | {type:'year',y} | {type:'all'}. */
export function monthsInScope(rows, scope) {
  const seen = new Map();
  rows.forEach((r) => {
    if (scope.type === 'month' && !(r.y === scope.y && r.m === scope.m)) return;
    if (scope.type === 'year' && r.y !== scope.y) return;
    seen.set(r.y * 12 + r.m, { y: r.y, m: r.m });
  });
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

export function rowsInScope(rows, scope) {
  return rows.filter((r) => scope.type === 'all'
    || (scope.type === 'year' && r.y === scope.y)
    || (scope.type === 'month' && r.y === scope.y && r.m === scope.m));
}

/** Lakh-style grouping (5,28,721) like Pakistani paperwork. Zero -> '-'. Negative -> (brackets). */
export function fmtAmt(v, { brackets = false, dash = true } = {}) {
  const r = Math.round(num(v));
  if (r === 0 && dash) return '-';
  const s = String(Math.abs(r));
  const head = s.slice(0, -3), tail = s.slice(-3);
  const g = head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail : tail;
  if (r < 0) return brackets ? `(${g})` : `-${g}`;
  return g;
}

/** Axis label: 1,250,000 -> "12.5L"; 450,000 -> "4.5L"; 80,000 -> "80K"; 2.5 crore -> "2.5Cr". */
export function fmtShort(v) {
  const a = Math.abs(v);
  const t = (x) => String(+x.toFixed(1));
  if (a >= 1e7) return t(v / 1e7) + 'Cr';
  if (a >= 1e5) return t(v / 1e5) + 'L';
  if (a >= 1e3) return t(v / 1e3) + 'K';
  return String(Math.round(v));
}

/** A tidy axis maximum + step for a bar chart (about 4-5 gridlines). */
export function niceScale(maxV) {
  if (!(maxV > 0)) return { max: 1, step: 1 };
  const raw = maxV / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw);
  return { step, max: Math.ceil(maxV / step) * step };
}

export function scopeTitle(scope) {
  if (scope.type === 'month') return `${MONTH_NAMES[scope.m]} ${scope.y}`;
  if (scope.type === 'year') return String(scope.y);
  return 'All Time';
}
