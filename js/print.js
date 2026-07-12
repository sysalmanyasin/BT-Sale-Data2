// ══════════════════════════════════════════════════════════════════════
// PRINT  —  Floor 4, the one and only print engine (V2 plan §7)
//
// Before this file: FOUR independent places touched window.print()/
// document.write()/#print-area, with three different levels of
// race-condition safety:
//   1. btPrint() (was in bt-format.js) — in-page #print-area injection,
//      the correct, already-proven-in-production fix for Android's
//      window.print() not blocking JS execution (double-rAF before
//      print(), hide on 'afterprint' with a generous fallback timeout
//      instead of a guessed fixed delay).
//   2. doPrint() (was private to manager-export.js) — new-tab
//      window.open()+document.write(), correctly using win.onload
//      (+ a fallback timeout) instead of a guessed fixed delay.
//   3. _nsSpPrint()'s inline trigger (notes-sheets.js) — new-tab
//      window.open()+document.write(), but with ONLY a fixed 500ms
//      setTimeout — the exact bug class #1 above exists to fix, just
//      not caught yet because Sheets printing is simpler content.
//   4. sheets-patch.js's shtFmPrint() fallback — a bare, completely
//      unguarded window.print() with no race-condition handling at all
//      if its DOM-query fallback ever fails to find a button.
//
// Now: every report in the app funnels through Print.render() (in-page,
// reuses #1's proven logic) or Print.renderNewTab() (new-tab, reuses
// #2's proven logic) — both engines live ONLY here. No other file may
// call window.print(), document.write(), or touch #print-area directly;
// if a future report needs to print, it builds its HTML and calls one
// of these two functions, the same way every existing report now does.
//
// Real ES module — the two entry points classic scripts need are
// bridged to `window` at the bottom, same pattern as every other
// Floor 4/5 module in this app.
// ══════════════════════════════════════════════════════════════════════

// ── In-page engine (was btPrint) ─────────────────────────────────────
// Injects HTML into the page's own #print-area and calls window.print()
// on the current document. Used by every report that prints via the
// app's own @media print stylesheet (Sale/Monthly/Yearly reports,
// Manager reports, CommandHub quick-print chips).
export function render(html, opts) {
  opts = opts || {};
  const pa = document.getElementById('print-area');
  if (!pa) return false;
  pa.innerHTML = html;
  pa.style.display = opts.display || 'block';

  let hidden = false;
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

  // Wait for layout to actually settle before snapshotting for print.
  // Double-rAF (wait two paint frames, not just one + a fixed guess) is
  // a more robust way to ensure the browser has genuinely finished
  // laying out the injected report HTML than a fixed-ms guess — a fixed
  // 60ms guess may not be enough for a large report (e.g. a full yearly
  // breakdown) on a loaded system.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
  return true;
}

// ── New-tab engine (was doPrint, private to manager-export.js) ──────
// Opens a full standalone HTML document in a new tab and prints THAT
// window — for reports that are meant to be a self-contained,
// forwardable page (Manager Summary export) rather than an injection
// into the current page's own print stylesheet. `html` here is a
// complete document (<html>…</html>), not a fragment.
export function renderNewTab(html, opts) {
  opts = opts || {};
  const win = window.open('', '_blank', opts.windowFeatures || '');
  // Mobile browsers often return a non-null window that's still silently
  // discarded a tick later (especially when this is invoked a few calls
  // deep inside an async chat-command chain, rather than directly from
  // the click). Re-check after the write so we can warn instead of
  // failing silently.
  if (!win || win.closed) {
    if (typeof window.toast === 'function') window.toast('⚠️ Pop-up blocked — please allow pop-ups for this site and try again.', 'w');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // win.onload is far more reliable on mobile than a fixed setTimeout: a
  // guessed delay can fire before the new tab/document has actually
  // finished rendering, causing print() to act on a blank page (or be
  // dropped if the tab isn't focused yet).
  let printed = false;
  function doPrint() {
    if (printed || win.closed) return;
    printed = true;
    try { win.focus(); win.print(); } catch (e) { /* best-effort */ }
  }
  win.onload = doPrint;
  // Fallback in case onload never fires (some in-app/WebView browsers).
  setTimeout(doPrint, opts.fallbackMs || 600);
  return true;
}

export const Print = { render, renderNewTab };

// Bridged — see header note. Remove once every consumer imports Print
// directly (blocked on the same ui.js/manager.js circular-dependency
// call already made for the rest of Floor 4/5 — see BLUEPRINT.md).
window.Print = Print;
