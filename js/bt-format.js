// ══════════════════════════════════════════════════════════════════════
// BTFormat — Step 2: Single source of truth for number/currency formatting
// Consumed by: Dashboard, Assistant, Reports, CommandHub, Manager, Index
//
// (The race-condition-safe print trigger that used to live in this file
// as btPrint() has moved to print.js — see that file's header for why.
// Every caller here now goes through window.Print.render()/.renderNewTab()
// instead. bt-format.js is number formatting only.)
//
// Module-migration Stage B (first file converted): now a real ES module.
// Verified consumers still on classic <script defer> tags — app-context.js,
// commandhub.js — reference bare `BTFormat`, so the window bridge at the
// bottom stays until those two are converted too. (bt-calc.js, originally
// planned as the next file in this batch, turned out to be fully dead
// code — zero consumers anywhere, superseded by config.js's own
// cashSales/creditSales/etc — and was deleted instead of converted.)
// ══════════════════════════════════════════════════════════════════════

export const BTFormat = Object.freeze({
  num(v) {
    return (v == null || v === '' || isNaN(parseFloat(v))) ? 0 : parseFloat(v);
  },
  currency(v) {
    return '₨ ' + Math.round(v).toLocaleString('en-PK');
  },
  compact(v) {
    const a = Math.abs(Math.round(v));
    if (a >= 1e6) return '₨ ' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1000) return '₨ ' + Math.round(v).toLocaleString('en-PK');
    return '₨ ' + String(Math.round(v));
  },
  signed(v) {
    const r = Math.round(BTFormat.num(v));
    if (r === 0) return '0';
    const s = Math.abs(r).toLocaleString('en-PK');
    return r < 0 ? '-₨ ' + s : '₨ ' + s;
  },
  pct(a, b) {
    return b ? ((a - b) / b * 100).toFixed(1) + '%' : '—';
  },
  plain(v) {
    return Math.round(BTFormat.num(v)).toLocaleString('en-PK');
  },
});

// TEMPORARY WINDOW BRIDGE — remove once app-context.js and commandhub.js
// (the only two remaining classic-script consumers, verified via grep) are
// themselves converted to `import { BTFormat } from './bt-format.js'`.
window.BTFormat = BTFormat;
