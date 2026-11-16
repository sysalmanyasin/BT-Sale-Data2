# Dua Invoice Desk

Independent multi-business invoicing domain inside Dua.

## Included in this milestone
- Five workbook business/template profiles.
- Shared calculation and validation engine.
- Escaped HTML invoice preview.
- A4/PDF and 58mm/80mm thermal-PDF adapters using the existing shared Print service.
- Responsive Invoice Desk page and navigation entry.

## Source-data integrity
The workbook identifies B.S MART, Safari Book Land, Best Choice Store, Book Land & Sports, and Spare Parts Replace Invoice. Safari Book Land has an embedded logo in the source workbook; the other formats do not supply separate logo image assets. No missing logo, address, phone number, or legal detail is invented. Profile details remain editable pending verification.

## Rollout boundary
This milestone is a draft/preview/print foundation only. It does not issue official invoice numbers or write permanent invoice records. Shared invoice history, database-backed numbering, voids, and audit history require a reviewed Supabase migration plus authenticated repository/RLS/RPC implementation. No production database is changed here.

## Rules
- No imports from other feature domains.
- No new `window.*` globals.
- Escape all user-provided text before HTML rendering.
- Use `js/lib/print.js`; never call `window.print()` directly.
- Keep Emergency Billing's checkout, stock bridge, and tables separate.
