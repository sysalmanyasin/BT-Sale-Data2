-- ══════════════════════════════════════════════════════════════════════
-- attendance_devices had no unique constraint on staff_id
--
-- Discovered while building the ntfy name-resolution fix: upsertDevice
-- (Kotlin) sends 'Prefer: resolution=merge-duplicates' on every
-- registration (initial setup, the "re-check permissions" button, and
-- every boot), expecting that to UPDATE the existing row for a given
-- staff member. But attendance_devices only ever had a UUID primary
-- key (id, server-generated, never sent by the client) -- with no
-- other unique constraint to merge against, PostgREST had nothing to
-- conflict on, so every single "upsert" call has actually been a
-- plain INSERT the whole time. Confirmed live: EMP-001 alone had
-- accumulated 4 duplicate rows from ordinary use (initial setup + a
-- few re-checks).
--
-- This dedupes existing data (kept: the most recently seen row per
-- staff_id, since that has the freshest name/label) and adds the
-- missing unique constraint so it can't happen again. The
-- corresponding Kotlin fix (adding ?on_conflict=staff_id to the
-- upsertDevice URL, which PostgREST requires to know which constraint
-- to target) ships alongside this in the same commit.
-- ══════════════════════════════════════════════════════════════════════

delete from attendance_devices a
where exists (
  select 1 from attendance_devices b
  where b.staff_id = a.staff_id
    and (b.last_seen_at, b.id) > (a.last_seen_at, a.id)
);

alter table attendance_devices add constraint attendance_devices_staff_id_key unique (staff_id);
