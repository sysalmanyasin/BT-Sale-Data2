-- BT Sales IC — AI agent gaps A (security + Phase 0)
--  1. agent_usage: per-provider attempt tracking (real quota / failure tracker, shared by every function instance)
--  2. agent_settings: server-side kill switch for AI changes (applies to every device)
-- Idempotent: safe to re-run.

-- ── 1. Quota / failure tracking ─────────────────────────────────────
-- kind = 'request' : one row per user-visible request (counts toward per-user rate limits)
-- kind = 'attempt' : one row per provider/model call, success or failure (counts toward provider quota + cooldown)
alter table public.agent_usage add column if not exists kind text not null default 'request';
alter table public.agent_usage add column if not exists error text;
create index if not exists agent_usage_provider_time on public.agent_usage (provider, model, created_at desc);
create index if not exists agent_usage_kind_time on public.agent_usage (kind, created_at desc);

-- ── 2. Kill switch ──────────────────────────────────────────────────
create table if not exists public.agent_settings (
  key        text primary key,
  value      jsonb not null default 'false'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.agent_settings (key, value) values ('writes_killed', 'false'::jsonb)
  on conflict (key) do nothing;

alter table public.agent_settings enable row level security;
revoke all on public.agent_settings from anon;

-- Helper: is the signed-in user an active authorised user? (SECURITY DEFINER so it works even if
-- bt_authorized_users has its own RLS.)
create or replace function public.agent_is_authorized()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bt_authorized_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and u.active = true
  );
$$;
revoke all on function public.agent_is_authorized() from public, anon;
grant execute on function public.agent_is_authorized() to authenticated;

drop policy if exists agent_settings_select on public.agent_settings;
create policy agent_settings_select on public.agent_settings
  for select to authenticated using (public.agent_is_authorized());

-- Only the one known key may be changed, and only by an authorised user. No insert/delete.
drop policy if exists agent_settings_update on public.agent_settings;
create policy agent_settings_update on public.agent_settings
  for update to authenticated
  using (public.agent_is_authorized() and key = 'writes_killed')
  with check (public.agent_is_authorized() and key = 'writes_killed' and jsonb_typeof(value) = 'boolean');

grant select, update on public.agent_settings to authenticated;
