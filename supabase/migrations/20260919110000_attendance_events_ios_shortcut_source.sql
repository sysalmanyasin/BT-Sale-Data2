-- ══════════════════════════════════════════════════════════════════════
-- 'ios_shortcut' as an allowed attendance_events.source
--
-- iPhone doesn't get a native app (see the chat thread on Xcode/
-- signing constraints) — instead, staff set up two Personal
-- Automations in Apple's own Shortcuts app (Arrive/Leave a location
-- -> HTTP POST straight to this table). It's conceptually the same
-- idea as the Android app's 'geofence' source (Apple's own location
-- engine doing the detection, not a human tapping anything), but
-- deliberately kept as its own value rather than reusing 'geofence' --
-- it has none of the Android app's protections (no mock-location
-- detection, no 5-minute debounce), so a manager reviewing Raw Log
-- should be able to tell at a glance which check-ins came through
-- that weaker path.
-- ══════════════════════════════════════════════════════════════════════

alter table attendance_events drop constraint attendance_events_source_check;
alter table attendance_events add constraint attendance_events_source_check
  check (source in ('geofence', 'qr', 'manual', 'ios_shortcut'));
