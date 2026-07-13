# Next Steps

Status snapshot as of this doc's writing. See `README.md` for
architecture/conventions.

## Done, confirmed stable

- Cover-as-hub navigation, 5 domains (Sales/Manager/Notes & Sheets/
  Closing/Audit), each isolated and re-themed.
- Generalized Ledger, replacing Jazz Cash + Expense/Petty/Other
  Sections. Migration has been run.
- Staff Registry, full CRUD through Actions.
- Notes & Sheets multi-file workbook model, migrated from the old
  single-workbook + snapshot system.
- Print consolidated to one engine (`print.js`).
- Golden Rule audit done across the whole codebase — one real
  violation found and fixed (an AI-chat command was mutating `STAFF`
  directly, invisible to the write-guard). Nothing else found.

## Blocked on you, not on more code

- **Inventory Audit** — zero code exists. Needs a real exported JSON
  sample from the Dropbox-fed source before it can even be scoped,
  same way Cash Closing needed a sample before *it* could be built.
- **Cash Closing analytics scope** — which parts need real
  charts/analysis vs. just display (shift financials vs. strips/
  denominations) is still an open call.
- **New Supabase tables** — whether Inventory Audit (once scoped)
  gets its own tables or reuses existing ones — your call.
- **Closing/Audit domain boundary, revisit if it ever feels wrong** —
  currently split as `closing` (Closing Book + Credit Ledger) and
  `audit` (Assignments), matching their two separate external data
  sources. If that ever stops feeling right in practice, it's a small
  change to merge or re-split.

## Known bugs, need a real device/data to confirm — not blind code changes

- **`ai-memory.js` is corrupted** — its entire content is placeholder
  text (`[REPLACEMENT CONTENT WILL BE FILLED IN NEXT MESSAGE]`), not
  real code. It's loaded live in `index.html` and throws a
  `SyntaxError` on load, so whatever it was supposed to do has been
  silently non-functional. No original version available to restore
  from — needs either the original source or a decision to rebuild it
  from scratch (need to know what it was for first).
- **Android print** — a defensive fix (`print.js`'s double-rAF +
  `afterprint`-based cleanup instead of a fixed timeout) has been in
  place for a while, but the original failure was never confirmed
  fixed on a real device — only reasoned about. Worth an explicit
  real-device check next time printing changes.
- **Jazz Cash / Ledger migration** — has been run, per your
  confirmation, but worth a spot-check against real production data
  if anything in the Ledger looks off, since it was only verified
  against sample data during development.

## Smaller, low-priority, not blocking anything

- `jazz-cash.js` is one of a handful of classic scripts still not
  IIFE-namespaced (a cosmetic/structural cleanup, not a bug) — it's
  eligible now (its old "pending rewrite" deferral reason went stale
  once the file shrank after the Ledger migration), just never
  actioned.
- `notes-sheets.js` is still not namespaced either — deliberately, in
  case more feature growth lands there before it's worth doing once.

## Worth a manual pass next time you're testing

- Nav restructure (Cover-as-hub) — walk every domain on both mobile
  and desktop nav; confirm the right tabs show/hide and the accent
  colors are right.
- Notes & Sheets — confirm your existing sheets/files all came through
  the migration exactly as they were (nothing missing, nothing
  duplicated).
- Print — spot check a few report types (Salary, Monthly, Ledger
  statement) actually produce a correct printed/saved PDF, not a
  blank page, especially on Android.
