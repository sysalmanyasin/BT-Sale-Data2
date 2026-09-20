-- ══════════════════════════════════════════════════════════════════════
-- Attendance RLS tightening — remove unused write capabilities
--
-- Every attendance table previously had a single policy:
--   for all to anon, authenticated using (true) with check (true)
-- i.e. SELECT + INSERT + UPDATE + DELETE, wide open, for anyone
-- holding the anon key (which is public, in a public repo, by
-- design/necessity — see the chat thread on this).
--
-- This is NOT the full fix (that's the per-staff-token overhaul we
-- discussed and explicitly deferred — INSERT/UPDATE on these tables
-- is still unauthenticated after this migration, so anyone with the
-- key can still fabricate a check-in for any staff_id). This migration
-- only removes capabilities that a real audit of every client
-- (android-attendance/, js/attendance-bridge.js) confirmed NOTHING
-- legitimate ever uses — pure downside removed, zero features broken:
--
--   attendance_events:     DELETE removed (nothing ever deletes an
--                           event) AND UPDATE removed (attendance-
--                           bridge.js's updateEvent() is exported but
--                           never called from any UI -- dead code,
--                           confirmed by grepping every caller).
--   attendance_devices:    DELETE removed (nothing ever deletes a
--                           device row).
--   attendance_locations:  DELETE removed (nothing ever deletes a
--                           location; deleting the active geofence
--                           would break check-in for every phone).
--                           INSERT/UPDATE deliberately KEPT -- the
--                           dashboard's "capture GPS location" button
--                           (upsertLocation in attendance-bridge.js,
--                           called from manager-attendance.js) needs
--                           it, and there's no real per-role auth yet
--                           to restrict it to managers specifically.
--
-- If you add a legitimate need for UPDATE/DELETE on any of these
-- later, add a narrow, purpose-specific policy for it rather than
-- reverting to a blanket "for all" — that's exactly the pattern that
-- created this gap in the first place.
-- ══════════════════════════════════════════════════════════════════════

-- attendance_events: SELECT + INSERT only (was ALL)
drop policy if exists attendance_events_all on attendance_events;
create policy attendance_events_select on attendance_events
  for select to anon, authenticated using (true);
create policy attendance_events_insert on attendance_events
  for insert to anon, authenticated with check (true);

-- attendance_devices: SELECT + INSERT + UPDATE (was ALL) -- upsertDevice
-- needs both insert and update for its ON CONFLICT merge to work.
drop policy if exists attendance_devices_all on attendance_devices;
create policy attendance_devices_select on attendance_devices
  for select to anon, authenticated using (true);
create policy attendance_devices_insert on attendance_devices
  for insert to anon, authenticated with check (true);
create policy attendance_devices_update on attendance_devices
  for update to anon, authenticated using (true) with check (true);

-- attendance_locations: SELECT + INSERT + UPDATE (was ALL) -- the
-- dashboard's upsertLocation needs both for the same ON CONFLICT
-- merge reason.
drop policy if exists attendance_locations_all on attendance_locations;
create policy attendance_locations_select on attendance_locations
  for select to anon, authenticated using (true);
create policy attendance_locations_insert on attendance_locations
  for insert to anon, authenticated with check (true);
create policy attendance_locations_update on attendance_locations
  for update to anon, authenticated using (true) with check (true);
