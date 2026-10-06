-- BT Sales IC — AI agent gaps B: undo that survives a reload.
-- The undo "recipe" (tool + args + result) is stored on the audit row of the change. After a reload the
-- browser rebuilds the undo function from the recipe via the tool's own makeUndo().
-- agent_audit stays append-only except for one thing: the owner may stamp undone_at once.
alter table public.agent_audit add column if not exists undo jsonb;
alter table public.agent_audit add column if not exists undo_key text;
alter table public.agent_audit add column if not exists undone_at timestamptz;
create index if not exists agent_audit_undo_key on public.agent_audit (user_id, undo_key) where undo_key is not null;
create index if not exists agent_audit_pending_undo on public.agent_audit (user_id, created_at desc) where undo is not null and undone_at is null;

-- Column-level privilege: only undone_at can be updated; everything else stays immutable.
revoke update on public.agent_audit from authenticated;
grant update (undone_at) on public.agent_audit to authenticated;

drop policy if exists agent_audit_mark_undone on public.agent_audit;
create policy agent_audit_mark_undone on public.agent_audit
  for update to authenticated
  using (user_id = auth.uid() and undo is not null and undone_at is null)
  with check (user_id = auth.uid());
