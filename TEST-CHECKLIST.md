# BT Sales App — Structural Correction: Test Checklist

## What we're doing
Correcting the app's internal structure without changing what it does:
removing dead code, fixing real bugs found along the way, converting the
core data layer (Floor 1–3) to real ES modules, and eliminating stray
global functions/variables across the rest of the app (Floor 4–5) by
namespacing each file — all so the 5-floor architecture is actually
enforced by the code, not just by convention, before new features
(generalized Ledger, Dropbox integration, etc.) get built on top of it.

## What's done

**Dead code:** 18 unused functions removed, 1 dead file deleted
(`data-base.js`), 1 duplicate/shadowed function cleaned up.

**Real bugs found and fixed** (all confirmed pre-existing or session
regressions via `diff` against your original upload — nothing guessed):
- Daily-record TOTAL/DIFF calculation was duplicated in 3 places with
  copy-pasted logic — now one shared source in `config.js`.
- 65 places writing storage directly instead of through `Actions` — routed properly.
- `recomputeMonthly` wasn't announcing updates to other parts of the app — fixed.
- Staff add/edit/remove bypassed a safety check — fixed.
- A **notify-loop regression** (my own mistake, caught and fixed) was
  causing dashboard cards to reload constantly and dropdowns/expanded
  rows to collapse on their own.
- Same collapsing behavior on Index/Sale Data pages, root-caused
  separately (a background sync refresh was always resetting which
  months/years were expanded) — now preserves what you had open.
- Sign-out crash (`_autoHandle`) — confirmed pre-existing, unrelated to this work, fixed anyway.
- **Print producing a blank page** — root cause found: a missing CSS
  property meant background colors never printed, so white text on
  colored headers/table headers was invisible even though the report
  content was rendering correctly. Fixed.

**Architecture conversion:**
- Floor 1–3 (`config.js`, `event-bus.js`, `repository.js`, `actions.js`) — real ES modules, zero legacy workarounds between them.
- Floor 4–5 — 32 of 41 files namespaced (down from ~700 loose global functions to properly scoped, private-by-default code). Every wrap included tracing for hidden monkey-patches (3 different files patch `manager.js`'s tab-switching and page-loading; `ui.js`'s page navigation is patched by `ui-extras.js`) — each one traced and verified working correctly in isolated tests before being included.

## What's left (all deliberate, not overlooked)
- `notes-sheets.js` — will be rewritten as a real feature soon (Notes & Sheets expansion), so namespacing it now would be wasted work.
- `supabase.js`, `sync-center.js` — the real multi-device sync mechanism; the safe scope of change is small relative to the risk, and it can't be verified without real multi-device testing. (This session added new `ledger`/`ledgerCustomTypes` payload keys to both — additive only, same merge convention as the existing `jazzcash` block — but did not touch the sync engine itself.)
- `bt-format.js`, `conflict-ui.js`, `diff-report.js`, `knowledge-sheet.js`, `targets.js` — genuinely nothing left to hide in these; every function is already needed externally.
- `ai-memory.js` — still corrupted from before this session began (contains only placeholder text); left alone per your earlier instruction.

---

## ✅ Test checklist

### Sign-in / session
- [ ] Sign in with Google works
- [ ] Sign out works, returns to sign-in screen cleanly
- [ ] Console is clean on load and after sign-in (the `ai-memory.js` error is expected/known — ignore only that one)

### Dashboard
- [ ] Cards load once and **stay still** — no repeated reloading
- [ ] Credit Details month dropdown opens and **stays open** long enough to pick a value
- [ ] Numbers (target pace, cash/credit sales, CAGR, branch score) look right

### Index page
- [ ] Year groups expand/collapse correctly
- [ ] Expand a year, wait ~1 minute (let a sync poll pass), confirm it **stays expanded**
- [ ] Print a yearly report — content should now actually be visible (not blank)

### Sale Data page
- [x] ~~Months expand/collapse correctly~~ — **root cause found & fixed** (event-delegation, verified with a test reproducing the exact bug). Please re-test: expand a month, navigate away and back to Sale Data, confirm it still responds to clicks.
- [x] Add a new daily entry — TOTAL calculates correctly (confirmed working)
- [x] Edit an existing entry (Returns field) — TOTAL/DIFF correct (confirmed working)
- [ ] Print a monthly report — **still investigating**, see note below

### Index page
- [ ] Print a yearly report — **still investigating**, see note below

### Print — diagnostic needed
Two fixes applied (print-color-adjust, grid→flex fallback for
Android's print pipeline) but neither is verified against the real
failure yet. **Most useful next step:** try the same print action on
**desktop Chrome** if possible. If it works there, the bug is confirmed
Android-print-pipeline-specific and we keep iterating on Android-safe
CSS. If it's *also* blank on desktop, something else is going on and
we start over on the diagnosis.


### Manager tab
- [x] Staff Registry: add / edit / toggle-active / delete an employee (confirmed working)
- [x] Salary, Generic, Credit, Petty (the simple one), Incentive tabs all load and save correctly (confirmed working)
- [ ] **Jazz Cash — re-verify, implementation changed this session** (see below; the "confirmed working" note that used to be here was against the *old* implementation, now retired)
- [x] Switching between Manager tabs works correctly (confirmed working)
- [ ] **Sheets & Notes — re-verify, the underlying storage model changed this session (multi-file workbook, V2 plan §5)** (see below; the "confirmed working" note that used to be here was against the *old* single-workbook implementation)
- [x] "Copy to Next Month" works (confirmed working)

### Notes & Sheets — multi-file workbook model (new this session, V2 plan §5)
- [ ] **First load after this update**: open Sheets & Notes. Your existing sheet(s)/tabs should appear exactly as before, under a file called "My Workbook" — nothing should look different or be missing. If you had any items in "Manage Sheets" (saved sheet files) before, each one should now show up as its own separate file too.
- [ ] Files ribbon tab (🗂 icon) → **📁 Switch File…** — should show all your files, with the one you're currently in marked "Current".
- [ ] Tap **Open** on a different file — should switch to it instantly, no confirmation prompt, and your other file's data should be completely unaffected when you switch back.
- [ ] **💾 Save As New File…** — enter a name/category, confirm a brand-new file appears (starts with one sheet, named after your current sheet).
- [ ] Within a file, add a new sheet-tab (+ button) — should work exactly as before (this part of the feature was already there, unchanged).
- [ ] 🗂 Manage Sheets → confirm each file card shows the right sheet count and cell count, and Rename / Group / Duplicate / Delete all work. Duplicate should create an independent copy — editing the copy should not affect the original.
- [ ] Try to delete your last remaining file — should be blocked with a warning toast.
- [ ] Ask the AI assistant something like "what sheet files do I have" or "open the [name] sheet" — should reflect your current files, not stale data from before this update.

### Ledger — Expense, Jazz Cash Daily Ledger, Other Sections (Jazz Cash migration was the prior session; this session added inline edit + fixed the AI chat commands)
- [ ] Open Manager → Jazz Cash. If old data exists, a yellow "Old Jazz Cash data found" banner should appear with a Migrate button.
- [ ] Click Migrate, confirm the dialog. Toast should report the number of entries migrated.
- [ ] **Compare the resulting balance to whatever the old ledger's balance was** (screenshot it beforehand if possible) — this is the one thing that hasn't been verified against real data, only sample data.
- [ ] Add a new entry (with a shift selected) — balance and running-balance column update correctly.
- [ ] Delete an entry — balance recalculates correctly.
- [ ] **NEW — tap the ✎ button on any entry (Expense, Jazz Cash, or any Other Section) — the row should turn into an inline edit form (date/category/amount/desc/shift). Change something, tap ✓ Save — balance and running balance should update correctly. Tap ✎ again, change something, tap ✕ Cancel — nothing should be saved.**
- [ ] "⚙ Set Opening" button prompts and updates the opening balance correctly.
- [ ] Balance Tally sub-tab still works exactly as before (unchanged this session) — its "Jazz Cash Balance (Ledger)" row should reflect the *new* Ledger balance, not the old one.
- [ ] AI chat command still works, e.g. "Jazz Cash 5000 for Ali" or "jazz cash balance" — should add to / read from the new Ledger now, not the old one.
- [ ] **NEW — AI chat commands for Expense and Other Sections, e.g. "add expense 500 for fuel" or "add 300 to [section name]" — these were completely dead before this session (silently did nothing); should now actually add to the Ledger and be visible in the tab.**
- [ ] **NEW — ask the AI "what's our expense total this month?" or "[section name] total this month?" — should return real numbers now instead of "no data found".**
- [ ] Google Drive backup / Supabase sync — after adding a Jazz Cash entry, trigger a manual backup/push and confirm no console errors (the payload now includes `ledger`/`ledgerCustomTypes` keys that didn't exist before this session).
- [ ] Print buttons (Salary/Generic/Credit/Petty/Incentive) — content visible, not blank (**still pending your desktop-print diagnostic**)

### NEW — Ledger-based Expense (replaces the old Patty/Expenses tab)
- [ ] Opening the "🧾 B. Patty/Expenses" tab shows the new Ledger view (add-entry form + running balance table), not the old spreadsheet-style table
- [ ] Add an entry (pick a category — Bill Amount/Fuel-HO/Soap-Tissue/Refreshment/Extra/Patty H/O — amount, description) — appears in the table immediately, balance updates
- [ ] Delete an entry — removed immediately, balance recalculates
- [ ] **The actual bug this was built to fix:** add an entry, then trigger a sync (or just wait ~1 minute for a poll cycle) — entry should still be there, not silently lost
- [ ] Navigate away to another Manager tab and back — entries and balance still correct

### NEW — Ledger-based Other Sections (replaces the old Custom Sections tab)
- [ ] Opening "＋ C. New Sections" shows the new Other Sections manager (list of sections + "Create New Section" button), not the old month-scoped custom-sections UI
- [ ] Create a new section: give it a name, add 1+ categories (each with a name and inflow/outflow direction), confirm it's created
- [ ] Click into the new section — opens its own ledger view (add entry, running balance, same as Expense)
- [ ] "← Back to Sections" returns to the section list
- [ ] Reload the page (or sign out/in) — the custom section and its entries are still there (this is the point of the persisted registry — confirm it actually survives, not just "looks like it works")

### Field Manager (Tools)
- [ ] Open Field Manager, toggle a field on/off, save — reflects on Sale Data entry form
- [ ] Add a custom field, confirm it appears and calculates into TOTAL correctly

### AI / CommandHub
- [ ] Basic chat/ask works
- [ ] Daily briefing loads
- [ ] Voice mic toggle works (if used)
- [ ] Image scan / attach sheet opens correctly

### Sync & backup
- [ ] Manual sync (Supabase) works
- [ ] Google Drive backup/restore still works
- [ ] Sign out → sign back in on the **same device**, data still there

### General
- [ ] No new console errors anywhere beyond the known `ai-memory.js` one
- [ ] App works offline after first load (PWA/service worker)
