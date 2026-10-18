# Daily Checklist module (proposed integration)

This branch adds an isolated first-pass checklist UI for BT Sales IC. It is deliberately not wired into the main navigation yet, so it cannot disrupt the existing app.

## Files
- `js/daily-checklist.js`: checklist UI, local draft storage, report copy, current inventory snapshot via the existing `StockLedgerApp.getRawRows()`.
- `css/daily-checklist.css`: responsive styles.

## Preview integration
1. Add a module container to the intended app page: `<div id="daily-checklist-root"></div>`.
2. Load `css/daily-checklist.css` and `js/daily-checklist.js` using the app's existing versioned asset conventions.
3. After the app's scripts have loaded, call `DailyChecklist.init('#daily-checklist-root')` when the Daily Checklist page is opened.
4. Use the existing navigation/page lifecycle rather than embedding this UI into `index.html` as a second application.

## Data integrity notes
- The inventory panel is a **current snapshot**, not historical closing stock for the selected date.
- Sales figures are explicitly entered until the authoritative daily sales API/query is wired in. Do not label them auto-filled until that mapping is verified.
- Manual checks start unanswered. Selecting “No” exposes an issue note.
- Drafts are local to the current browser/device. Cloud sync, permissions, audit history, and multi-device draft recovery are not implemented in this first pass.
- Verify that `StockLedgerApp.init()` is safe to call on page visits in the current app version before integrating its initialization behavior.
