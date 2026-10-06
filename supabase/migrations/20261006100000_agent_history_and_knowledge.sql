-- BT Sales IC — AI agent: conversation history (Phase 1-3 gap) + knowledge index with pgvector (Phase 4).
-- Idempotent: safe to re-run.

-- ── 1. Conversation history ─────────────────────────────────────────
-- Only the visible turns (the user's question and the assistant's final answer) are stored, never raw
-- tool results. Owner-only; the owner can delete any conversation.
create table if not exists public.agent_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  title      text not null default '' check (char_length(title) <= 120),
  specialist text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_conversations_user on public.agent_conversations (user_id, updated_at desc);

create table if not exists public.agent_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.agent_conversations(id) on delete cascade,
  user_id         uuid not null default auth.uid(),
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) between 1 and 12000),
  created_at      timestamptz not null default now()
);
create index if not exists agent_messages_conv on public.agent_messages (conversation_id, id);

alter table public.agent_conversations enable row level security;
alter table public.agent_messages      enable row level security;
revoke all on public.agent_conversations from anon;
revoke all on public.agent_messages      from anon;

drop policy if exists agent_conversations_all on public.agent_conversations;
create policy agent_conversations_all on public.agent_conversations for all to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized())
  with check (user_id = auth.uid() and public.agent_is_authorized());

drop policy if exists agent_messages_select on public.agent_messages;
create policy agent_messages_select on public.agent_messages for select to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_messages_insert on public.agent_messages;
create policy agent_messages_insert on public.agent_messages for insert to authenticated
  with check (user_id = auth.uid() and public.agent_is_authorized()
    and exists (select 1 from public.agent_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
-- messages are immutable; they disappear only when their conversation is deleted (cascade)

grant select, insert, update, delete on public.agent_conversations to authenticated;
grant select, insert on public.agent_messages to authenticated;

-- ── 2. Memory facts: who wrote them ─────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_memory_source_check') then
    alter table public.agent_memory add constraint agent_memory_source_check check (source in ('user', 'assistant'));
  end if;
end $$;

-- ── 3. Knowledge index (pgvector) ───────────────────────────────────
create extension if not exists vector with schema extensions;

create table if not exists public.agent_knowledge (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  source       text not null check (source in ('note', 'sheet', 'staff_note')),
  source_id    text not null check (char_length(source_id) between 1 and 120),
  chunk_index  int  not null check (chunk_index between 0 and 500),
  title        text not null default '' check (char_length(title) <= 160),
  content      text not null check (char_length(content) between 1 and 2000),   -- already redacted by the function
  content_hash text not null,
  embedding    extensions.vector(768),
  model        text not null,                                                    -- vectors from different models are never compared
  sensitive    boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (user_id, source, source_id, chunk_index)
);
create index if not exists agent_knowledge_user_src on public.agent_knowledge (user_id, source, source_id);
create index if not exists agent_knowledge_embedding on public.agent_knowledge using hnsw (embedding extensions.vector_cosine_ops);

alter table public.agent_knowledge enable row level security;
revoke all on public.agent_knowledge from anon;
-- The owner can read and delete their index. Only the bt-agent function (service role) writes it,
-- because only it holds the embedding keys.
drop policy if exists agent_knowledge_select on public.agent_knowledge;
create policy agent_knowledge_select on public.agent_knowledge for select to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
drop policy if exists agent_knowledge_delete on public.agent_knowledge;
create policy agent_knowledge_delete on public.agent_knowledge for delete to authenticated
  using (user_id = auth.uid() and public.agent_is_authorized());
grant select, delete on public.agent_knowledge to authenticated;

-- Similarity search. SECURITY INVOKER + explicit user filter, callable ONLY by the service role
-- (the function passes the verified user id), so a browser can never search someone else's rows.
create or replace function public.agent_match_knowledge(
  p_user_id uuid, p_query extensions.vector(768), p_model text,
  p_limit int default 6, p_min_similarity float default 0.35, p_include_sensitive boolean default false
) returns table (source text, source_id text, chunk_index int, title text, content text, similarity float)
language sql stable set search_path = public, extensions as $$
  select k.source, k.source_id, k.chunk_index, k.title, k.content, 1 - (k.embedding <=> p_query) as similarity
  from public.agent_knowledge k
  where k.user_id = p_user_id and k.model = p_model and k.embedding is not null
    and (p_include_sensitive or not k.sensitive)
    and 1 - (k.embedding <=> p_query) >= p_min_similarity
  order by k.embedding <=> p_query
  limit least(greatest(p_limit, 1), 12);
$$;
revoke all on function public.agent_match_knowledge(uuid, extensions.vector, text, int, float, boolean) from public, anon, authenticated;
grant execute on function public.agent_match_knowledge(uuid, extensions.vector, text, int, float, boolean) to service_role;
