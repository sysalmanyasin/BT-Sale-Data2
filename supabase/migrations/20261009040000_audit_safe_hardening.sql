-- Applied to production 2026-10-09 via Supabase MCP (audit_safe_hardening_2026_10_09). Idempotent.
create index if not exists attendance_events_device_id_idx on public.attendance_events (device_id);
create index if not exists attendance_events_location_id_idx on public.attendance_events (location_id);

alter function public._next_emergency_invoice_number() set search_path = public, pg_temp;
alter function public.record_emergency_sale(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb) set search_path = public, pg_temp;
alter function public.record_emergency_refund(text,text,text,text,numeric,jsonb) set search_path = public, pg_temp;

revoke execute on function public.settings_history_capture() from public, anon;
revoke execute on function public.settings_history_list(text) from public, anon;
revoke execute on function public.settings_history_restore(text, bigint) from public, anon;

do $$
declare r record; q text; w text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and ((qual ~ 'auth\.uid\(\)' and qual !~ 'select auth\.uid') or (with_check ~ 'auth\.uid\(\)' and with_check !~ 'select auth\.uid'))
  loop
    q := case when r.qual is not null then regexp_replace(r.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g') end;
    w := case when r.with_check is not null then regexp_replace(r.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g') end;
    if q is not null then execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q); end if;
    if w is not null then execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, w); end if;
  end loop;
end $$;
