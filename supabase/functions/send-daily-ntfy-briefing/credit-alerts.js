// ══════════════════════════════════════════════════════════════════════
// CREDIT ALERTS — pure functions, no DOM / window / fetch.
// The SAME file runs in the browser (in-app briefing) and in the Deno Edge Function
// (send-daily-ntfy-briefing/credit-alerts.js is a byte-identical copy; a test enforces it),
// so the app and the push notification can never disagree about what is "duplicate" or "aged".
//
// Rows have the app's credit-sheet shape: { name, prevBal, entries:[{date,desc,amount}], salary, lessGeneric }
//   net owed = prevBal + sum(entries) - salary - lessGeneric   (positive = the staff member owes the shop)
//
// Rules
//   duplicate : the same person has 2+ entries with the same date, amount (non-zero) and description
//   unrolled  : last month closed with money owed but this month carries nothing over (rollover not done)
//   aged      : the opening balance carried over from earlier months is at least AGED_CREDIT_MIN
//               AND the person still owes money after this month's entries and deductions
// ══════════════════════════════════════════════════════════════════════
export const AGED_CREDIT_MIN = 5000;

const n = v => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(x) ? x : 0; };
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const fmt = v => Math.round(v).toLocaleString('en-US');

export function creditNet(row) {
  const entries = Array.isArray(row && row.entries) ? row.entries : [];
  return n(row && row.prevBal) + entries.reduce((s, e) => s + n(e && e.amount), 0) - n(row && row.salary) - n(row && row.lessGeneric);
}

/** @returns {Array<{name:string,date:string,amount:number,desc:string,times:number}>} */
export function findDuplicateCreditEntries(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const seen = new Map();
    for (const e of Array.isArray(r && r.entries) ? r.entries : []) {
      const amount = n(e && e.amount);
      if (!amount) continue;
      const key = [clean(e.date), amount, clean(e.desc).toLowerCase()].join('|');
      const hit = seen.get(key);
      if (hit) hit.times++; else seen.set(key, { name: clean(r.name), date: clean(e.date), amount, desc: clean(e.desc), times: 1 });
    }
    for (const v of seen.values()) if (v.times >= 2) out.push(v);
  }
  return out;
}

/** @returns {Array<{name:string, carried:number, net:number}>} largest first */
export function findAgedCredit(rows, min = AGED_CREDIT_MIN) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => ({ name: clean(r && r.name), carried: n(r && r.prevBal), net: creditNet(r) }))
    .filter(x => x.name && x.carried >= min && x.net > 0)
    .sort((a, b) => b.net - a.net);
}

/**
 * "Rollover gap": last month closed with money still owed, but this month shows NOTHING carried over.
 * That means the month rollover (prevBal = last month's net) was never done, so carried-over alerts silently read Rs 0.
 * @returns {{owed:number, staff:number}|null}
 */
export function findUnrolledCredit(prevRows, curRows, min = AGED_CREDIT_MIN) {
  const owing = (Array.isArray(prevRows) ? prevRows : []).map(creditNet).filter(v => v > 0);
  const owed = owing.reduce((s, v) => s + v, 0);
  const carriedIn = (Array.isArray(curRows) ? curRows : []).reduce((s, r) => s + Math.abs(n(r && r.prevBal)), 0);
  return owed >= min && carriedIn === 0 ? { owed, staff: owing.length } : null;
}

/** Ready-to-show messages, identical wording in the app and the push. @returns {{duplicates:string[], aged:string|null, agedTotal:number}} */
export function creditAlertMessages(rows) {
  const dups = findDuplicateCreditEntries(rows);
  const duplicates = dups.slice(0, 3).map(d => `Possible duplicate credit entry: ${d.name} Rs ${fmt(d.amount)} on ${d.date}${d.desc ? ' (' + d.desc + ')' : ''} entered ${d.times} times`)
    .concat(dups.length > 3 ? [`${dups.length - 3} more possible duplicate credit entries`] : []);
  const aged = findAgedCredit(rows);
  const agedTotal = aged.reduce((s, a) => s + a.net, 0);
  const names = aged.slice(0, 3).map(a => `${a.name.split(' ').slice(0, 2).join(' ')} Rs ${fmt(a.net)}`).join(', ');
  return {
    duplicates,
    aged: aged.length ? `${aged.length} staff still owe credit carried over from earlier months (total Rs ${fmt(agedTotal)}): ${names}${aged.length > 3 ? ', …' : ''}` : null,
    agedTotal,
  };
}
