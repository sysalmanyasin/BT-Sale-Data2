-- BT Sales IC — AI agent foundation (Phase 0/1)
-- Usage metering (written by the bt-agent Edge Function via service role)
-- and a per-user audit trail of tool calls (written by the browser).

create table if not exists public.agent_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  email      text,
  provider   text,
  model      text,
  ok         boolean not null default true,
  status     int,
  latency_ms int,
  prompt_tokens int,
  completion_tokens int,
  sensitivity text,
  created_at timestamptz not null default now()
);
create index if not exists agent_usage_user_time on public.agent_usage (user_id, created_at desc);

create table if not exists public.agent_audit (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid(),
  conversation_id text,
  tool        text not null,
  risk        text not null default 'read',
  args        jsonb,
  ok          boolean not null default true,
  result_chars int,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_audit_user_time on public.agent_audit (user_id, created_at desc);

alter table public.agent_usage enable row level security;
alter table public.agent_audit enable row level security;

-- Usage: users may read their own rows; only the service role writes.
drop policy if exists agent_usage_select_own on public.agent_usage;
create policy agent_usage_select_own on public.agent_usage
  for select to authenticated using (user_id = auth.uid());

-- Audit: authenticated users may insert/read only their own rows. No update/delete.
drop policy if exists agent_audit_insert_own on public.agent_audit;
create policy agent_audit_insert_own on public.agent_audit
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists agent_audit_select_own on public.agent_audit;
create policy agent_audit_select_own on public.agent_audit
  for select to authenticated using (user_id = auth.uid());

revoke all on public.agent_usage from anon;
revoke all on public.agent_audit from anon;
