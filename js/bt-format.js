// ══════════════════════════════════════════════════════════════════════
// BTFormat — Step 2: Single source of truth for number/currency formatting
// Consumed by: Dashboard, Assistant, Reports, CommandHub, Manager, Index
// ══════════════════════════════════════════════════════════════════════

const BTFormat = Object.freeze({
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

// ══════════════════════════════════════════════════════════════════════
// btPrint — shared, race-condition-safe print trigger.
//
// BUG THIS FIXES: every report function used to do
//   pa.innerHTML = html; pa.style.display = 'flex'; window.print();
//   setTimeout(() => pa.style.display = 'none', 1000-1200);
// On Android, window.print() does NOT block JS execution like desktop
// browsers — it just queues a system print job and returns immediately.
// The very next lines kept running, and on slower devices / when the
// share-sheet ("Save as PDF") took a moment to open, the fixed-time
// setTimeout fired and reset #print-area back to display:none — and
// reset the live page's other elements back to normal — BEFORE the
// system print pipeline actually rasterized the page. The result: the
// printed/saved PDF captured whatever was on screen at THAT moment
// (the live CommandHub chat, banners, chips) instead of the report.
//
// FIX: 1) give the browser a paint frame before calling print() so the
//         injected report HTML is guaranteed to be laid out first, and
//      2) only hide #print-area on the 'afterprint' event (fired once
//         the user actually closes/completes the print dialog), with a
//         generous fallback timeout as a safety net instead of a tight
//         1000-1200ms guess.
// ══════════════════════════════════════════════════════════════════════
function btPrint(html, opts) {
  opts = opts || {};
  var pa = document.getElementById('print-area');
  if (!pa) return false;
  pa.innerHTML = html;
  pa.style.display = opts.display || 'block';

  var hidden = false;
  function hide() {
    if (hidden) return;
    hidden = true;
    pa.style.display = 'none';
    pa.innerHTML = '';
    window.removeEventListener('afterprint', hide);
  }

  // Restore as soon as the OS print/share dialog actually closes…
  window.addEventListener('afterprint', hide);
  // …with a safety-net timeout in case 'afterprint' never fires
  // (some Android WebView/browser combos skip it for window.print()).
  setTimeout(hide, opts.fallbackMs || 8000);

  // Wait one paint frame (+ a tick) so the new report HTML is fully
  // laid out before the print snapshot is taken.
  requestAnimationFrame(function () {
    setTimeout(function () {
      window.print();
    }, 60);
  });
  return true;
}
