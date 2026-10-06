-- BT Sales IC — AI agent gaps D: long-term memory (facts) + the editable "how I run this pharmacy" document.
-- Both are written ONLY by the signed-in owner through the assistant's Memory card (the model has no tool
-- that writes them), so stored text is the owner's own words, never tool output. No embeddings/pgvector yet.
-- Idempotent: safe to re-run.

create table if not exists public.agent_memory (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid(),
  fact       text not null check (char_length(fact) between 1 and 300),
  source     text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_memory_user on public.agent_memory (user_id, created_at desc);

-- Rules document: append-only versions; the latest version is the active one (full history kept).
create table if not exists public.agent_rules (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid(),
  version    int not null,
  body       text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create index if not exists agent_rules_user_version on public.agent_rules (user_id, version desc);

alter table public.agent_memory enable row level security;
alter table public.agent_rules  enable row level security;
revoke all on public.agent_memory from anon;
revoke all on public.agent_rules  from anon;

-- Memory: the owner reads, adds, edits and deletes their own facts. Only authorised users.
drop policy if exists agent_memory_select on public.agent_memory;
create policy agent_memory_select on public.agent_memory for select to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_memory_insert on public.agent_memory;
create policy agent_memory_insert on public.agent_memory for insert to authenticated
  with check (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_memory_update on public.agent_memory;
create policy agent_memory_update on public.agent_memory for update to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized())
  with check (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_memory_delete on public.agent_memory;
create policy agent_memory_delete on public.agent_memory for delete to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());

-- Rules: read own, add a new version. No update/delete (history is immutable).
drop policy if exists agent_rules_select on public.agent_rules;
create policy agent_rules_select on public.agent_rules for select to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_rules_insert on public.agent_rules;
create policy agent_rules_insert on public.agent_rules for insert to authenticated
  with check (user_id = auth.uid() and public.agent_is_authorized());

grant select, insert, update, delete on public.agent_memory to authenticated;
grant select, insert on public.agent_rules to authenticated;
