-- ════════════════════════════════════════════════════════════════
-- bt_salesdata READ-SIDE SPLIT  (APPLIED to production 2026-11-04 via the Supabase connector)
--
-- Why: the single bt_salesdata row is ~2.5 MB of JSON (82% is `daily`). Every push
-- re-read it whole (compare-and-swap pre-read), every pull re-read it whole, and
-- every UPDATE was broadcast over Realtime to every subscribed device WITH the whole
-- row. ~140 full reads/day were seen in the API logs, plus the broadcasts.
--
-- Purely additive — old app versions keep working unchanged:
--   1. bt_salesdata_core  — the same row WITHOUT `daily` (~458 kB instead of ~2.5 MB).
--      security_invoker → the caller's RLS on bt_salesdata still applies.
--   2. bt_daily(updated_at) index — `daily` is already mirrored row-for-row into bt_daily
--      by trg_bt_fanout (verified: 2378/2378 rows, 0 differences), so clients can fetch
--      just the days that changed since a cursor.
--   3. bt_sync_signal — a one-row, ~100-byte "something changed" table kept up to date by a
--      trigger. Clients subscribe to Realtime on THIS instead of on the 2.5 MB row.
--
-- ROLLBACK:
--   drop trigger if exists trg_bt_sync_signal on public.bt_salesdata;
--   drop function if exists public.bt_sync_signal_touch();
--   alter publication supabase_realtime drop table public.bt_sync_signal;
--   drop table if exists public.bt_sync_signal;
--   drop view if exists public.bt_salesdata_core;
--   drop index if exists public.bt_daily_updated_at_idx;
-- ════════════════════════════════════════════════════════════════

-- 1. Core view (everything except the 2 MB `daily` array) ────────
create or replace view public.bt_salesdata_core
  with (security_invoker = true) as
  select id, updated_at, payload - 'daily' as payload
  from public.bt_salesdata;
revoke all on public.bt_salesdata_core from public, anon;
grant select on public.bt_salesdata_core to authenticated;

-- 2. Cursor index for "days changed since ..." ───────────────────
create index if not exists bt_daily_updated_at_idx on public.bt_daily (updated_at);

-- 3. Tiny change-signal for Realtime ─────────────────────────────
create table if not exists public.bt_sync_signal (
  id              text primary key,
  device_id       text,
  payload_version bigint,
  updated_at      timestamptz not null default now()
);
alter table public.bt_sync_signal enable row level security;
drop policy if exists "authorized staff can read" on public.bt_sync_signal;
create policy "authorized staff can read" on public.bt_sync_signal
  for select to authenticated using (public.is_authorized_user());
revoke all on public.bt_sync_signal from public, anon;
grant select on public.bt_sync_signal to authenticated;

create or replace function public.bt_sync_signal_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from 'main' then return new; end if;   -- ignore the connection-test ping rows
  insert into public.bt_sync_signal (id, device_id, payload_version, updated_at)
  values (
    new.id,
    new.payload->>'device_id',
    case when (new.payload->>'payloadVersion') ~ '^[0-9]{1,15}$' then (new.payload->>'payloadVersion')::bigint end,
    new.updated_at
  )
  on conflict (id) do update
    set device_id = excluded.device_id,
        payload_version = excluded.payload_version,
        updated_at = excluded.updated_at;
  return new;
end $$;
revoke all on function public.bt_sync_signal_touch() from public, anon, authenticated;

-- AFTER trigger: runs after trg_bt_salesdata_updated_at (BEFORE) has stamped updated_at.
drop trigger if exists trg_bt_sync_signal on public.bt_salesdata;
create trigger trg_bt_sync_signal
  after insert or update of payload on public.bt_salesdata
  for each row execute function public.bt_sync_signal_touch();

-- Seed from the current row so there is always something to read.
insert into public.bt_sync_signal (id, device_id, payload_version, updated_at)
select id, payload->>'device_id',
       case when (payload->>'payloadVersion') ~ '^[0-9]{1,15}$' then (payload->>'payloadVersion')::bigint end,
       updated_at
from public.bt_salesdata where id = 'main'
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bt_sync_signal') then
    alter publication supabase_realtime add table public.bt_sync_signal;
  end if;
end $$;
