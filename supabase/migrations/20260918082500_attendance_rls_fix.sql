-- ══════════════════════════════════════════════════════════════════════
-- Fix: the original attendance RLS policies keyed off auth.jwt() ->>
-- 'role'/'staff_id' custom claims. This app has no real Supabase Auth
-- session anywhere (confirmed: js/supabase.js never calls signIn*/
-- setSession — every table, including bt_sessions per the 2026-08-05
-- security-audit migration, runs on the plain anon key with USING
-- (true) policies; access control is enforced client-side via
-- auth.js's Google-email allow-list). The claim-based policies would
-- have silently blocked every read/write, manager included.
--
-- Replaced with the same anon-role, USING(true) pattern as the rest
-- of the app, so Manager > Attendance actually works. This carries
-- the same accepted tradeoff bt_sessions' policy comment already
-- documents for this single-user app: anything holding the anon
-- publishable key can read/write these tables directly (not just
-- through the UI) — there's no per-device or per-manager enforcement
-- at the database layer. If that ever needs tightening, it needs a
-- real per-device Supabase Auth session (see the PIN-login note in
-- ATTENDANCE_INTEGRATION.md), not a bigger RLS policy.
-- ══════════════════════════════════════════════════════════════════════

drop policy if exists "locations_read_all_authenticated" on attendance_locations;
drop policy if exists "locations_write_manager_only" on attendance_locations;
drop policy if exists "devices_self_read" on attendance_devices;
drop policy if exists "devices_self_upsert" on attendance_devices;
drop policy if exists "devices_self_update" on attendance_devices;
drop policy if exists "events_manager_read_all" on attendance_events;
drop policy if exists "events_self_insert" on attendance_events;
drop policy if exists "events_manager_update" on attendance_events;

create policy "attendance_locations_all" on attendance_locations
  for all to anon, authenticated using (true) with check (true);

create policy "attendance_devices_all" on attendance_devices
  for all to anon, authenticated using (true) with check (true);

create policy "attendance_events_all" on attendance_events
  for all to anon, authenticated using (true) with check (true);
