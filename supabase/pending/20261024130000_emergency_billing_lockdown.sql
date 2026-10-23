-- ════════════════════════════════════════════════════════════════
-- EMERGENCY BILLING — PHASE 2 of 2: LOCKDOWN  (NOT AUTO-DEPLOYED)
--
-- This file lives in supabase/pending/ on purpose: supabase-deploy.yml only
-- applies supabase/migrations/. To promote, `git mv` it into supabase/migrations/
-- ONLY after:
--   1. phase 1 (20261024120000_emergency_billing_authenticated_access.sql) is applied, and
--   2. the app build using the signed-in client is live, and
--   3. a real sale AND a real refund were done while signed in with Google.
--
-- Effect: the public anon key can no longer read or write ANY emergency billing
-- data or call its RPCs. Only an authenticated, ACTIVE bt_authorized_users email can.
--
-- The two security-definer RPCs bypass RLS, so each is renamed to a private
-- _impl (no client can execute it) and replaced by a same-signature wrapper that
-- checks bt_is_authorized_user() first. The bodies are untouched.
--
-- ROLLBACK (restores today's open access):
--   create policy anon_all on emergency_invoices      for all to anon using (true) with check (true);
--   create policy anon_all on emergency_invoice_items for all to anon using (true) with check (true);
--   create policy anon_all on emergency_stock_deltas  for all to anon using (true) with check (true);
--   grant select,insert,update,delete on emergency_invoices, emergency_invoice_items, emergency_stock_deltas to anon;
--   grant usage,select on sequence emergency_invoice_seq to anon;
--   -- then drop the two wrappers, rename _record_*_impl back, and `grant execute ... to anon`.
-- ════════════════════════════════════════════════════════════════

drop policy if exists anon_all on public.emergency_invoices;
drop policy if exists anon_all on public.emergency_invoice_items;
drop policy if exists anon_all on public.emergency_stock_deltas;

revoke all on table public.emergency_invoices      from anon;
revoke all on table public.emergency_invoice_items from anon;
revoke all on table public.emergency_stock_deltas  from anon;
revoke all on sequence public.emergency_invoice_seq from anon;
revoke execute on function public._next_emergency_invoice_number() from public, anon;

-- ── record_emergency_sale ───────────────────────────────────────
do $$ begin
  if to_regprocedure('public._record_emergency_sale_impl(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb)') is null then
    alter function public.record_emergency_sale(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb)
      rename to _record_emergency_sale_impl;
  end if;
end $$;
revoke all on function public._record_emergency_sale_impl(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb)
  from public, anon, authenticated;

create or replace function public.record_emergency_sale(
    p_device_uuid text, p_staff_name text, p_customer_name text, p_customer_phone text,
    p_subtotal numeric, p_discount_amount numeric, p_net_total numeric, p_payment_method text,
    p_cash_received numeric, p_change_amount numeric, p_items jsonb
)
returns table(success boolean, message text, invoice_number text)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.bt_is_authorized_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select r.success, r.message, r.invoice_number
    from public._record_emergency_sale_impl(p_device_uuid, p_staff_name, p_customer_name, p_customer_phone,
      p_subtotal, p_discount_amount, p_net_total, p_payment_method, p_cash_received, p_change_amount, p_items) as r;
end;
$$;
revoke all on function public.record_emergency_sale(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb) from public, anon;
grant execute on function public.record_emergency_sale(text,text,text,text,numeric,numeric,numeric,text,numeric,numeric,jsonb) to authenticated;

-- ── record_emergency_refund ─────────────────────────────────────
do $$ begin
  if to_regprocedure('public._record_emergency_refund_impl(text,text,text,text,numeric,jsonb)') is null then
    alter function public.record_emergency_refund(text,text,text,text,numeric,jsonb)
      rename to _record_emergency_refund_impl;
  end if;
end $$;
revoke all on function public._record_emergency_refund_impl(text,text,text,text,numeric,jsonb)
  from public, anon, authenticated;

create or replace function public.record_emergency_refund(
    p_device_uuid text, p_staff_name text, p_original_invoice_number text,
    p_payment_method text, p_cash_given numeric, p_items jsonb
)
returns table(success boolean, message text, invoice_number text, net_total numeric)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.bt_is_authorized_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select r.success, r.message, r.invoice_number, r.net_total
    from public._record_emergency_refund_impl(p_device_uuid, p_staff_name, p_original_invoice_number,
      p_payment_method, p_cash_given, p_items) as r;
end;
$$;
revoke all on function public.record_emergency_refund(text,text,text,text,numeric,jsonb) from public, anon;
grant execute on function public.record_emergency_refund(text,text,text,text,numeric,jsonb) to authenticated;
