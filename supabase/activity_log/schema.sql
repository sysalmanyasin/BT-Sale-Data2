-- ══════════════════════════════════════════════════════════════════════
-- ACTIVITY LOG  —  table for the in-app, cross-device "who changed what,
-- when" feed (Utility → Activity Log, js/activity-log.js).
--
-- Every meaningful write this app already announces on the EventBus
-- (js/event-bus.js — daily/monthly/staff/ledger records, plus a known
-- set of feature-data blobs saved via Actions.saveXxx) gets mirrored
-- here as one short, human-readable row: when, which section, what kind
-- of change (add/edit/delete), and a one-line summary. This is a NEW,
-- app-wide log — do not confuse it with the sibling standalone Closing
-- app's own `activity_log` table (schema {ts, actor, key, action,
-- changes} — see js/closing-bridge.js), which only covers Closing's own
-- data and already existed before this file. This table is named
-- bt_activity_log (this app's `bt_` prefix, same as bt_pdf_library,
-- bt_daily, bt_monthly, bt_sessions, …) specifically so the two never
-- collide in the same Supabase project.
--
-- Same Supabase project this whole app already syncs everything else to
-- (see SB_URL/SB_KEY in js/supabase.js) — no new project needed.
--
-- Run this once, by hand, in the Supabase SQL editor for this project.
--
-- SECURITY:
-- Confirmed live against this project (2026-08-11) — bt_pdf_library's
-- actual policies are `using (is_authorized_user())` for both its read
-- and its write policy (its checked-in schema.sql under
-- supabase/pdf_library/ still shows the older, pre-lockdown `using
-- (true)` baseline — that file just hasn't been updated to match, it's
-- not a second, looser policy). is_authorized_user() itself (STABLE
-- SECURITY DEFINER) checks the caller's JWT email against
-- bt_authorized_users. bt_activity_log is created straight into that
-- same, current convention below — no separate lockdown step needed
-- after running this.
-- ══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- gen_random_uuid()

create table if not exists public.bt_activity_log (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),  -- server-side write time
  section      text not null,                        -- e.g. 'Sale Data', 'Manager · Staff', 'Manager · Ledger (Jazz Cash)'
  action       text not null default 'other',         -- 'add' | 'edit' | 'delete' | 'other'
  summary      text not null,                         -- one-line human-readable description
  details      jsonb,                                 -- optional structured extra (record id, before/after, etc.)
  device       text,                                   -- friendly device label, e.g. 'Windows PC', 'Samsung A52'
  device_id    text                                    -- this app's per-device UDID (js/sync-center.js _sc_getUDID)
);

create index if not exists bt_activity_log_occurred_idx on public.bt_activity_log (occurred_at desc);
create index if not exists bt_activity_log_section_idx  on public.bt_activity_log (section);
create index if not exists bt_activity_log_action_idx   on public.bt_activity_log (action);

alter table public.bt_activity_log enable row level security;

-- Same shape as bt_pdf_library's live policies: one combined read
-- policy, one combined write policy (insert/update/delete), both
-- gated on is_authorized_user(). No separate delete-only policy is
-- needed since '*' already covers it.
drop policy if exists "authorized staff can read" on public.bt_activity_log;
create policy "authorized staff can read" on public.bt_activity_log
  for select using (is_authorized_user());

drop policy if exists "authorized staff can write" on public.bt_activity_log;
create policy "authorized staff can write" on public.bt_activity_log
  for all using (is_authorized_user()) with check (is_authorized_user());
