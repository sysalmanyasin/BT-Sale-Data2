-- ════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — BATCH 1 (client-independent; applied to prod 2026-10-24)
-- Project: wetbugzzchkghpzmowod. Idempotent: safe to re-run.
--
-- 1. widget_summary() / get_widget_summary(): any signed-in Google account could read
--    latest sales, cash, staff credit and closing figures. Now each runs only for an
--    allow-listed user or the widget service account (same bodies, renamed to _impl).
-- 2. Remove TRUNCATE / REFERENCES / TRIGGER from anon + authenticated on public tables.
--    (The REST API never needs them; they are pure excess privilege.)
-- 3. bt_sessions: drop the legacy "anon + authenticated, using (true)" policies. The app's
--    sync-center uses the signed-in client, covered by the existing
--    "authorized staff can read/write" policies (is_authorized_user()).
-- 4. attendance_verify_manager_pin(): unlimited guessing by the public key. Now 5 failures
--    in 15 minutes lock verification for everyone until the window passes (same signature
--    and boolean result, so the installed Android app is unaffected).
--
-- ROLLBACK (per item):
--  1. alter function _widget_summary_impl() rename to widget_summary; (same for get_) and
--     drop the wrappers first.
--  3. create policy "bt_sessions read all"  on bt_sessions for select to anon, authenticated using (true);
--     create policy "bt_sessions insert"    on bt_sessions for insert to anon, authenticated with check (true);
--     create policy "bt_sessions update"    on bt_sessions for update to anon, authenticated using (true) with check (true);
--     create policy "bt_sessions delete"    on bt_sessions for delete to anon, authenticated using (true);
--  4. recreate the previous sql function:  select exists (select 1 from attendance_manager_pin
--     where id = true and pin_hash = extensions.crypt(candidate, pin_hash));
-- ════════════════════════════════════════════════════════════════

-- ── 1. widget summaries ─────────────────────────────────────────
do $$ begin
  if to_regprocedure('public._widget_summary_impl()') is null then
    alter function public.widget_summary() rename to _widget_summary_impl;
  end if;
  if to_regprocedure('public._get_widget_summary_impl()') is null then
    alter function public.get_widget_summary() rename to _get_widget_summary_impl;
  end if;
end $$;
revoke all on function public._widget_summary_impl()     from public, anon, authenticated;
revoke all on function public._get_widget_summary_impl() from public, anon, authenticated;

create or replace function public.widget_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_authorized_user() or public.is_widget_service()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public._widget_summary_impl();
end $$;
revoke all on function public.widget_summary() from public, anon;
grant execute on function public.widget_summary() to authenticated;

create or replace function public.get_widget_summary()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_authorized_user() or public.is_widget_service()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public._get_widget_summary_impl();
end $$;
revoke all on function public.get_widget_summary() from public, anon;
grant execute on function public.get_widget_summary() to authenticated;

-- ── 2. excess table privileges ──────────────────────────────────
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ── 3. bt_sessions legacy open policies ─────────────────────────
drop policy if exists "bt_sessions read all" on public.bt_sessions;
drop policy if exists "bt_sessions insert"   on public.bt_sessions;
drop policy if exists "bt_sessions update"   on public.bt_sessions;
drop policy if exists "bt_sessions delete"   on public.bt_sessions;

-- ── 4. manager PIN throttle ─────────────────────────────────────
create table if not exists public.attendance_pin_attempts (
  id bigserial primary key,
  attempted_at timestamptz not null default now()
);
alter table public.attendance_pin_attempts enable row level security;
revoke all on table public.attendance_pin_attempts from anon, authenticated;
revoke all on sequence public.attendance_pin_attempts_id_seq from anon, authenticated;

create or replace function public.attendance_verify_manager_pin(candidate text)
returns boolean language plpgsql volatile security definer
set search_path = public, extensions as $$
declare ok boolean;
begin
  delete from attendance_pin_attempts where attempted_at < now() - interval '1 day';
  if (select count(*) from attendance_pin_attempts where attempted_at > now() - interval '15 minutes') >= 5 then
    return false;  -- locked: too many recent failures (applies to everyone, including the right PIN)
  end if;
  select exists (select 1 from attendance_manager_pin
                 where id = true and pin_hash = extensions.crypt(candidate, pin_hash)) into ok;
  if not ok then insert into attendance_pin_attempts default values; end if;
  return ok;
end $$;
revoke all on function public.attendance_verify_manager_pin(text) from public;
grant execute on function public.attendance_verify_manager_pin(text) to anon, authenticated;
