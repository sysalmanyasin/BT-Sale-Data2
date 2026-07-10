// ══════════════════════════════════════════════════════════════════════
// LEDGER MIGRATION
//
// Converts existing Jazz Cash and Petty data into the new unified
// Ledger shape. NOT run automatically — call these explicitly (e.g.
// from a Tools-page button) once the Ledger UI is ready to replace the
// old Jazz Cash / Petty tabs. Each function is idempotent-safe to call
// more than once is NOT guaranteed — running twice would duplicate
// entries, since there's no "already migrated" marker by design (keeps
// this module simple; the caller is responsible for only running each
// migration once, ideally with a confirmation step first).
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { _addEntry, setOpeningBalance } from './ledger-store.js';

const JC_KEY = 'bt_jazzcash_v2';
const PETTY_PFX = 'mw_petty_';

// ── Jazz Cash → Ledger ──────────────────────────────────────────────
// Mechanical, low-risk: entries[] already have the same real shape
// (date, type, amount, desc) as the new model expects (categoryId is
// just a rename of `type`), openingBalance carries over directly.
export function migrateJazzCashToLedger() {
  const raw = Repository.getItem(JC_KEY);
  if (!raw) return { migrated: 0, reason: 'no existing Jazz Cash data found' };
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { migrated: 0, reason: 'existing Jazz Cash data could not be parsed' }; }

  setOpeningBalance('jazzcash', data.openingBalance || 0);

  let count = 0;
  (data.entries || []).forEach(e => {
    _addEntry({
      ledgerType: 'jazzcash',
      date: e.date,
      categoryId: e.type,          // JC_TYPES ids match LEDGER_CATEGORIES.jazzcash ids exactly
      amount: Math.abs(parseFloat(e.amount) || 0),
      desc: e.desc || '',
      groupLabel: null,
      shift: e.shift || null,  // BUG FIX: this used to hardcode null, silently
                                // dropping every entry's Morning/Evening/Night/
                                // Both/Off shift on migration — found while
                                // smoke-testing this migration for real use.
      // preserve the original entry's own id if it has one, so this
      // migration doesn't invent a second identity for the same record
      id: e.id ? ('jc_' + e.id) : undefined,
    });
    count++;
  });

  return { migrated: count, openingBalance: data.openingBalance || 0 };
}

// ── Petty → Ledger ────────────────────────────────────────────────────
// NOT purely mechanical — this is a genuine behavior change, from
// month-scoped (resets every month) to continuous (one running list),
// which is what was actually asked for, but worth being explicit that
// this function does more than reshape storage.
//
// Petty currently has NO per-row date — only a month-level key
// (`mw_petty_<Month Year>`). Each migrated row gets assigned the 1st of
// its source month as a placeholder date, since the Ledger model needs
// a real date for sorting/running-balance purposes. groupLabel carries
// over the original "period" grouping so the migrated data doesn't lose
// that context, even though the date itself is a best-effort default
// rather than the actual day the expense happened.
//
// monthKeys: array of "Month Year" strings to migrate (the caller
// supplies this — typically Repository.getMonthly().map(m => m.Month_Year),
// since this module doesn't import config.js/MONTHLY to stay decoupled
// from the rest of the app's state).
export function migratePettyToLedger(monthKeys) {
  let count = 0;
  let monthsWithData = 0;
  const skipped = [];

  monthKeys.forEach(my => {
    const raw = Repository.getItem(PETTY_PFX + my);
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (e) { skipped.push(my); return; }
    if (!data || !Array.isArray(data.groups) || !data.groups.length) return;

    const placeholderDate = _firstDayOf(my);
    if (!placeholderDate) { skipped.push(my); return; }

    monthsWithData++;
    data.groups.forEach(g => {
      (g.rows || []).forEach(row => {
        if (!row.desc && !row.amount) return; // skip genuinely empty rows
        _addEntry({
          ledgerType: 'petty',
          date: placeholderDate,
          categoryId: 'expense',
          amount: Math.abs(parseFloat(row.amount) || 0),
          desc: row.desc || '',
          groupLabel: g.period || null,
          shift: null,
        });
        count++;
      });
    });
  });

  return { migrated: count, monthsWithData, skipped };
}

function _firstDayOf(monthYearStr) {
  // "July 2026" -> "01/Jul/2026", matching this app's existing Date format
  const MONTHS = { January:'Jan',February:'Feb',March:'Mar',April:'Apr',May:'May',June:'Jun',
    July:'Jul',August:'Aug',September:'Sep',October:'Oct',November:'Nov',December:'Dec' };
  const [monthName, year] = (monthYearStr || '').split(' ');
  const abbrev = MONTHS[monthName];
  if (!abbrev || !year) return null;
  return '01/' + abbrev + '/' + year;
}

// ── Window bridge — jazz-cash.js (classic script) triggers this from an
// explicit, user-confirmed button click, not automatically on load, per
// this file's own header comment. ──
window.migrateJazzCashToLedger = migrateJazzCashToLedger;
window.migratePettyToLedger = migratePettyToLedger;
