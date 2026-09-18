-- ══════════════════════════════════════════════════════════════════════
-- ATTENDANCE — schema for the staff attendance app
--
-- Lives in the SAME Supabase project as the main app (the one
-- js/supabase.js points at — SB_URL in that file), NOT the separate
-- Pharmacy Audit Hub project that inventory-bridge.js/audit-bridge.js
-- read from. Reason: attendance_events.staff_id references the
-- STAFF records that already live in *this* project's world (even
-- though STAFF itself is currently a localStorage-first array synced
-- as JSON, not a real Supabase table — see note below), and keeping
-- it in the same project means one Supabase dashboard, one set of
-- secrets, no cross-project bridge needed for something this coupled
-- to Staff Registry.
--
-- staff_id is TEXT, not a uuid/FK, because STAFF records use a
-- generated string id ('emp_' + timestamp + random suffix — see
-- js/actions.js addEmployee) with no corresponding Postgres "staff"
-- table to foreign-key against. Integrity is enforced app-side, same
-- as the rest of this app's localStorage-first, eventually-synced
-- model — not by a DB constraint.
-- ══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ── Pharmacy locations (usually just one row) ──────────────────────────
create table if not exists attendance_locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  lat           double precision not null,
  lng           double precision not null,
  radius_meters int not null default 100,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── One row per staff member's registered phone ────────────────────────
-- A staff member could reinstall the app or change phones — device_id
-- is what the staff app actually authenticates as; staff_id is who it
-- belongs to. Keeping these separate means swapping a phone is a
-- one-row update, not a data migration.
create table if not exists attendance_devices (
  id            uuid primary key default gen_random_uuid(),
  staff_id      text not null,        -- matches STAFF[i].id, e.g. 'emp_1731...'
  staff_number  text,                 -- matches STAFF[i].staffId, e.g. 'EMP-003' — denormalized for readability in the dashboard/logs without a join
  device_label  text,                 -- "Ali's Redmi Note 12"
  pin_hash      text,                 -- if using PIN login instead of phone-number auth — see integration notes
  fcm_token     text,                 -- reserved for future push reminders
  last_seen_at  timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_attendance_devices_staff on attendance_devices (staff_id);

-- ── The punches themselves ──────────────────────────────────────────────
create table if not exists attendance_events (
  id              uuid primary key default gen_random_uuid(),
  staff_id        text not null,
  staff_number    text,               -- denormalized, same reasoning as above
  device_id       uuid references attendance_devices(id),
  location_id     uuid references attendance_locations(id),
  event_type      text not null check (event_type in ('check_in','check_out')),
  source          text not null check (source in ('geofence','qr','manual')),
  occurred_at     timestamptz not null default now(),
  lat             double precision,
  lng             double precision,
  accuracy_meters double precision,
  is_mock_location boolean not null default false,  -- flagged client-side if Android reports a mock location provider
  is_flagged      boolean not null default false,   -- poor accuracy / suspicious — surfaced for manager review, not auto-rejected
  note            text,               -- manager annotation, or reason on a manual entry
  created_by      text,               -- 'device' for automatic events, or manager's identity for manual ones
  created_at      timestamptz not null default now()
);
create index if not exists idx_attendance_events_staff_time on attendance_events (staff_id, occurred_at);
create index if not exists idx_attendance_events_time on attendance_events (occurred_at);

-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--
-- Two very different clients read/write this data:
--   1. The staff Android app — signed in as one specific staff member,
--      should be able to INSERT its own events and read only its OWN
--      history. Never another staff member's.
--   2. The main PWA (Manager > Attendance) — signed in with your own
--      Google account via auth.js, should be able to read everything
--      and insert/edit 'manual' events.
--
-- This assumes the staff app authenticates via Supabase Auth (phone-
-- number OTP is the simplest built-in option, or a custom PIN scheme
-- validated by an Edge Function that mints a Supabase session — see
-- integration notes for the tradeoff). The policies below key off
-- auth.jwt() claims; adjust the claim name to whatever your chosen
-- auth method actually sets.
-- ══════════════════════════════════════════════════════════════════════

alter table attendance_locations enable row level security;
alter table attendance_devices   enable row level security;
alter table attendance_events    enable row level security;

-- Locations: every authenticated client (staff app + main app) can read
-- the geofence definitions; only the main app (manager) can write.
create policy "locations_read_all_authenticated"
  on attendance_locations for select
  using (auth.role() = 'authenticated');

create policy "locations_write_manager_only"
  on attendance_locations for all
  using (auth.jwt() ->> 'role' = 'manager')
  with check (auth.jwt() ->> 'role' = 'manager');

-- Devices: a staff app can read/update only its own device row
-- (matched by staff_id claim on the JWT); manager can read/write all.
create policy "devices_self_read"
  on attendance_devices for select
  using (
    auth.jwt() ->> 'role' = 'manager'
    or staff_id = auth.jwt() ->> 'staff_id'
  );

create policy "devices_self_upsert"
  on attendance_devices for insert
  with check (staff_id = auth.jwt() ->> 'staff_id' or auth.jwt() ->> 'role' = 'manager');

create policy "devices_self_update"
  on attendance_devices for update
  using (staff_id = auth.jwt() ->> 'staff_id' or auth.jwt() ->> 'role' = 'manager');

-- Events: this is the important one.
--   - Staff app: INSERT only, only its own staff_id, never SELECT
--     (so one employee's app has no way to read another's punch
--     history, per your "no visibility into coworkers" pattern).
--   - Manager (main app): full read, plus insert/update for manual
--     corrections.
create policy "events_manager_read_all"
  on attendance_events for select
  using (auth.jwt() ->> 'role' = 'manager');

create policy "events_self_insert"
  on attendance_events for insert
  with check (
    staff_id = auth.jwt() ->> 'staff_id'
    or auth.jwt() ->> 'role' = 'manager'
  );

create policy "events_manager_update"
  on attendance_events for update
  using (auth.jwt() ->> 'role' = 'manager');

-- ══════════════════════════════════════════════════════════════════════
-- Seed your one pharmacy location — replace lat/lng/radius with the
-- real values before running (radius in meters; err a little wide
-- rather than too tight, since indoor/near-entrance GPS fixes drift).
-- ══════════════════════════════════════════════════════════════════════
-- insert into attendance_locations (name, lat, lng, radius_meters)
-- values ('Bahria Town Pharmacy', 33.000000, 73.000000, 100);
