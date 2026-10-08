-- Manager finding lifecycle only. Does not modify business records.
create table if not exists public.agent_finding_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  finding_id text not null,
  action text not null check (action in ('reviewed','snoozed','resolved')),
  note text,
  created_at timestamptz not null default now(),
  snoozed_until timestamptz,
  unique(user_id, finding_id, action)
);
create index if not exists agent_finding_actions_user_finding_idx on public.agent_finding_actions(user_id, finding_id, created_at desc);
alter table public.agent_finding_actions enable row level security;
drop policy if exists agent_finding_actions_select_own on public.agent_finding_actions;
create policy agent_finding_actions_select_own on public.agent_finding_actions for select using (auth.uid() = user_id);
drop policy if exists agent_finding_actions_insert_own on public.agent_finding_actions;
create policy agent_finding_actions_insert_own on public.agent_finding_actions for insert with check (auth.uid() = user_id);
comment on table public.agent_finding_actions is 'AI Center manager lifecycle state only; never changes business records.';