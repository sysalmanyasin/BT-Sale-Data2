-- ══════════════════════════════════════════════════════════════════════
-- attendance_locations.qr_secret — the QR fallback validated nothing
--
-- Found while building the printable-QR feature: MainActivity.kt's
-- handleQrScan(contents: String) never actually reads `contents` at
-- all -- ANY scanned barcode (even an unrelated product barcode)
-- triggered a check-in/out toggle. The QR "fallback" had no real
-- validation whatsoever.
--
-- This column holds a random secret, printed as the QR code posted at
-- the entrance (see the dashboard's Location tab). The corresponding
-- Kotlin fix (MainActivity.kt's handleQrScan) now fetches this value
-- and rejects a scan that doesn't match, rather than accepting
-- anything. Nullable and optional by design -- a location with no
-- qr_secret set simply has no working QR fallback yet (the app should
-- tell the person to ask their manager to print one), rather than
-- this being a breaking migration for existing setups.
-- ══════════════════════════════════════════════════════════════════════

alter table attendance_locations add column if not exists qr_secret text;

-- Seeded directly on the active location — this value is designed to
-- become physically public the moment it's printed and posted at the
-- entrance, unlike the manager PIN or ntfy topic (which stay out of
-- this repo's committed files on purpose). If you ever need to
-- invalidate a lost/photographed printout, generate a fresh random
-- value and update this column, then re-print and re-post the QR.
update attendance_locations
set qr_secret = 'BT-QR-2vzLa-1SlEnbEnu5brjZlg'
where active = true and qr_secret is null;
