// ══════════════════════════════════════════════════════════════════════
// LEDGER MIGRATION
//
// Converts existing Petty data into the new unified Ledger shape. NOT
// run automatically — call this explicitly (e.g. from a Tools-page
// button) once the Ledger UI is ready to replace the old Petty tab.
// Idempotent-safe to call more than once is NOT guaranteed — running
// twice would duplicate entries, since there's no "already migrated"
// marker by design (keeps this module simple; the caller is
// responsible for only running the migration once, ideally with a
// confirmation step first).
//
// The equivalent Jazz Cash → Ledger migration (migrateJazzCashToLedger)
// has already been run for this app's data and was removed from here —
// jazz-cash.js no longer shows a migration banner/button. If it's ever
// needed again, it's mechanical: entries[] under the old bt_jazzcash_v2
// key (still backed up by drive.js/supabase.js) have the same real
// shape (date, type, amount, desc) as this model expects (categoryId
// is just a rename of `type`), openingBalance carries over directly.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { _addEntry, setOpeningBalance } from './ledger-store.js';

const PETTY_PFX = 'mw_petty_';

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

// ── Window bridge — a Tools-page button (classic script) would trigger
// this from an explicit, user-confirmed click, not automatically on
// load, per this file's own header comment. ──
window.migratePettyToLedger = migratePettyToLedger;
