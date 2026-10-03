// Shared helpers for agent tools. Pure functions, no app imports.
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
export const rs = v => Math.round(num(v));

/** "Sep 2026" | "september 2026" | "2026-09" | "9/2026" → "Sep 2026" (or null). */
export function normMonth(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return MON[+m[2] - 1] ? MON[+m[2] - 1] + ' ' + m[1] : null;
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return MON[+m[1] - 1] ? MON[+m[1] - 1] + ' ' + m[2] : null;
  m = /^([a-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) { const i = MON.findIndex(x => m[1].startsWith(x.toLowerCase())); return i >= 0 ? MON[i] + ' ' + m[2] : null; }
  return null;
}

export function monthSortVal(my) {
  const [mn, yr] = String(my || '').split(' ');
  const i = MON.indexOf(mn);
  return (parseInt(yr, 10) || 0) * 12 + (i < 0 ? 0 : i);
}

/** "05/Sep/2026" | "2026-09-05" | "today" | "yesterday" → "05/Sep/2026" (or null). */
export function normDay(input, now = new Date()) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const fmt = d => String(d.getDate()).padStart(2, '0') + '/' + MON[d.getMonth()] + '/' + d.getFullYear();
  if (s === 'today') return fmt(now);
  if (s === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return fmt(d); }
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return m[3] + '/' + MON[+m[2] - 1] + '/' + m[1];
  m = /^(\d{1,2})[/\- ]([a-z]{3,9})[/\- ,]*(\d{4})$/.exec(s);
  if (m) { const i = MON.findIndex(x => m[2].startsWith(x.toLowerCase())); if (i >= 0) return String(m[1]).padStart(2, '0') + '/' + MON[i] + '/' + m[3]; }
  return null;
}

export function dayOfMonth(dateStr) { return parseInt(String(dateStr || '').split('/')[0], 10) || 0; }

export function currentMonthYear(now = new Date()) { return MON[now.getMonth()] + ' ' + now.getFullYear(); }

export function clampInt(v, lo, hi, dflt) {
  const x = Math.round(Number(v));
  if (!Number.isFinite(x)) return dflt;
  return Math.max(lo, Math.min(hi, x));
}

export const pctChange = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);
