// ══════════════════════════════════════════════════════════════════════
// AI DATE/MONTH HELPERS — extracted verbatim from ai-bridge.js during
// the Phase 5 domain-registry split (AI + CommandHub Build Plan v2).
//
// Shared by ai-bridge.js and both js/ai/domains/*.js files, so it lives
// in core rather than either domain, avoiding a circular import between
// ai-bridge.js <-> the domain files. No behavior change from the
// original ai-bridge.js versions of these functions.
// ══════════════════════════════════════════════════════════════════════
import { BTDate } from '../../bt-date.js';

export function _aiTodayStr() {
  // Delegates to BTDate when available — single source of truth.
  // BTDate.today() → "29/Jun/2026" which matches DAILY[].Date format.
  if (typeof BTDate !== 'undefined' && BTDate.today) return BTDate.today();
  const d = new Date();
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2,'0') + '/' + M[d.getMonth()] + '/' + d.getFullYear();
}
export function _aiCurrentMonthYear() {
  const d = new Date();
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}

// ── Shared month resolver — used by every Manager-section read/edit ────
// Recognizes: "this month", "last month", "June", "June 2026", or falls
// back to current month. Keeps all 6 sections reading the SAME month
// whenever the user doesn't say one explicitly.
export const _AI_MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function _aiResolveMonth(text) {
  const t = (text || '').toLowerCase();
  const now = new Date();
  if (/\blast month\b|\bpichla mahine\b|\bpichle mahine\b/.test(t)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return _aiMonthYearFor(d);
  }
  if (/\bthis month\b|\bis mahine\b|\bcurrent month\b/.test(t)) return _aiCurrentMonthYear();
  // Explicit "June 2026" or just "June" (assume current/most-recent year)
  const m = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4}))?/);
  if (m) {
    const monName = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const year = m[2] || now.getFullYear();
    return monName + ' ' + year;
  }
  return _aiCurrentMonthYear();
}
export function _aiMonthYearFor(d) {
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}
// Ledger entries store ISO dates (YYYY-MM-DD, from <input type="date">) —
// this converts one to the "Month YYYY" format _aiResolveMonth() returns,
// so Ledger data (Expense, Jazz Cash, custom sections) can be filtered by
// the same month strings the rest of this file already works with.
export function _aiIsoMonthOf(dateStr) {
  const d = new Date((dateStr || '') + 'T00:00:00');
  if (isNaN(d)) return '';
  return _aiMonthYearFor(d);
}
// The Ledger (Expense/Custom Sections/Jazz Cash) needs ISO dates
// (YYYY-MM-DD, from <input type="date">) for correct chronological sort
// and month-matching — distinct from _aiTodayStr()'s DD/Mon/YYYY, which
// matches DAILY[].Date and stays that way for Salary/Credit/Generic.
// Mixing the two formats into the same field silently breaks sort order
// (string-comparing "05/Mar/2026" vs "12/Jan/2026" puts March first).
export function _aiIsoTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
// Converts whatever date format the Groq system prompt might still hand
// back (its EXPENSE/CUSTOM SECTION docs currently ask for DD-Mon-YYYY,
// a holdover from the old row-based models) into ISO, so Ledger data
// never ends up storing anything but ISO regardless of prompt drift.
export function _aiToIsoDate(str) {
  if (!str) return _aiIsoTodayStr();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str; // already ISO
  const m = String(str).match(/^(\d{1,2})[\/\-]([A-Za-z]{3})[\/\-](\d{4})$/); // DD/Mon/YYYY or DD-Mon-YYYY
  if (m) {
    const MONTHS = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
    const mm = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1,3).toLowerCase()];
    if (mm) return m[3] + '-' + mm + '-' + m[1].padStart(2, '0');
  }
  const d = new Date(str);
  if (!isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  return _aiIsoTodayStr();
}
