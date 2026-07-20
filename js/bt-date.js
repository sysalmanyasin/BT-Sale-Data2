// ══════════════════════════════════════════════════════════════════════
// BTDate — Step 3: Single source of truth for date logic
// Consumed by (verified via grep, not the stale list this comment used to
// have — config.js does NOT actually reference BTDate): ai-bridge.js,
// commandhub-page.js, commandhub.js, dashboard.js, hub-actions.js, manager.js.
//
// Module-migration Stage B: now a real ES module. Window bridge below
// stays until all six classic-script consumers above are converted too.
// (bt-calc.js, originally planned as the next file in this batch, turned
// out to be fully dead code — zero consumers anywhere, superseded by
// config.js's own cashSales/creditSales/branchScore/yearlyCAGR — and was
// deleted instead of converted.)
// ══════════════════════════════════════════════════════════════════════

export const BTDate = Object.freeze({
  monthNames: ['January','February','March','April','May','June',
               'July','August','September','October','November','December'],
  monthShort: ['Jan','Feb','Mar','Apr','May','Jun',
               'Jul','Aug','Sep','Oct','Nov','Dec'],

  today() {
    const d  = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${BTDate.monthShort[d.getMonth()]}/${d.getFullYear()}`;
  },

  currentMonthYear() {
    const d = new Date();
    return `${BTDate.monthNames[d.getMonth()]} ${d.getFullYear()}`;
  },

  currentYear() {
    return String(new Date().getFullYear());
  },

  parseDate(str) {
    if (!str) return 0;
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    // Parse ISO dates as LOCAL midnight, not UTC midnight. new Date("YYYY-MM-DD") parses
    // as UTC which causes an off-by-one day in +5 (PKT) and other positive-offset timezones.
    if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]).getTime();
    const parts = str.split('/');
    if (parts.length !== 3) return 0;
    const [dd, mon, yyyy] = parts;
    const mi = BTDate.monthShort.indexOf(mon);
    if (mi < 0) return 0;
    return new Date(parseInt(yyyy, 10), mi, parseInt(dd, 10)).getTime();
  },

  nextMonth(monthYear) {
    if (!monthYear) return '';
    const [mon, yr] = monthYear.split(' ');
    const mi = BTDate.monthNames.indexOf(mon);
    if (mi < 0) return '';
    const next = new Date(parseInt(yr, 10), mi + 1, 1);
    return `${BTDate.monthNames[next.getMonth()]} ${next.getFullYear()}`;
  },
});

// TEMPORARY WINDOW BRIDGE — remove once ai-bridge.js, commandhub-page.js,
// commandhub.js, dashboard.js, hub-actions.js, manager.js (the six
// remaining classic-script consumers, verified via grep) are themselves
// converted to `import { BTDate } from './bt-date.js'`.
window.BTDate = BTDate;
