-- BT Sales IC — AI agent gaps E: user-defined schedules (storage only).
-- NOTE: nothing runs these yet. The app's data lives in the browser and syncs to Supabase, so a server-side
-- runner needs RLS-safe RPCs first (see README, AI agent section). This table is the definition store so
-- the Scheduler agent can be built on it without another schema change. The existing 11:00/23:00 PKT ntfy
-- briefing keeps running from its own pg_cron jobs and does not depend on this table.
-- Idempotent: safe to re-run.
create table if not exists public.agent_schedules (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid(),
  name        text not null check (char_length(name) between 1 and 80),
  cron        text not null check (cron ~ '^\s*\S+(\s+\S+){4}\s*$'),          -- 5-field cron expression, evaluated in Asia/Karachi
  agent       text not null default 'briefing' check (agent in ('briefing', 'sales', 'manager', 'inventory', 'str', 'closing', 'analyst')),
  instructions text not null default '' check (char_length(instructions) <= 500),
  channel     text not null default 'ntfy' check (channel in ('ntfy', 'in_app')),
  enabled     boolean not null default true,
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'failed', 'skipped')),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_schedules_user on public.agent_schedules (user_id, enabled);

alter table public.agent_schedules enable row level security;
revoke all on public.agent_schedules from anon;

drop policy if exists agent_schedules_select on public.agent_schedules;
create policy agent_schedules_select on public.agent_schedules for select to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_schedules_insert on public.agent_schedules;
create policy agent_schedules_insert on public.agent_schedules for insert to authenticated
  with check (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_schedules_update on public.agent_schedules;
create policy agent_schedules_update on public.agent_schedules for update to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized())
  with check (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_schedules_delete on public.agent_schedules;
create policy agent_schedules_delete on public.agent_schedules for delete to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());

-- Run state (last_run_at / last_status / last_error) belongs to the future runner (service role); users may not forge it.
-- A column-level REVOKE cannot undo a table-level GRANT, so UPDATE is granted per column instead.
grant select, insert, delete on public.agent_schedules to authenticated;
revoke update on public.agent_schedules from authenticated;
grant update (name, cron, agent, instructions, channel, enabled, updated_at) on public.agent_schedules to authenticated;
