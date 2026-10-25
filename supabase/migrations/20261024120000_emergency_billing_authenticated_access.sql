-- ════════════════════════════════════════════════════════════════
-- EMERGENCY BILLING — PHASE 1 of 2: allow the signed-in Google session
--
-- Project: wetbugzzchkghpzmowod.
--
-- ADDITIVE ONLY. Nothing is removed or revoked here, so the app keeps working
-- during rollout. It adds what the app needs to stop using the public anon key:
--   * bt_is_authorized_user()  — true only when the caller's JWT email is an
--     ACTIVE row in bt_authorized_users (same rule as agent_is_authorized()).
--   * RLS policies for role `authenticated`, gated on that function.
--   * table / sequence / RPC grants for `authenticated`.
-- Why the allow-list check is needed: signInWithIdToken accepts ANY Google
-- account, so "authenticated" alone does not mean "one of our people".
--
-- Phase 2 (supabase/pending/20261024130000_emergency_billing_lockdown.sql) then
-- removes the anon access. Do NOT promote phase 2 until js/emergency-billing/emergency-billing-bridge.js
-- (now using the signed-in client) is live and billing has been tested.
--
-- Note: until phase 2, the two record_* RPCs are executable by any authenticated
-- user (they are already executable by anon today, so this is not wider).
-- Safe to run more than once.
-- ════════════════════════════════════════════════════════════════

create or replace function public.bt_is_authorized_user()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bt_authorized_users u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and u.active = true
  );
$$;
revoke all on function public.bt_is_authorized_user() from public;
grant execute on function public.bt_is_authorized_user() to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='emergency_invoices' and policyname='authorized_all') then
    create policy authorized_all on public.emergency_invoices
      for all to authenticated using (public.bt_is_authorized_user()) with check (public.bt_is_authorized_user()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='emergency_invoice_items' and policyname='authorized_all') then
    create policy authorized_all on public.emergency_invoice_items
      for all to authenticated using (public.bt_is_authorized_user()) with check (public.bt_is_authorized_user()); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='emergency_stock_deltas' and policyname='authorized_all') then
    create policy authorized_all on public.emergency_stock_deltas
      for all to authenticated using (public.bt_is_authorized_user()) with check (public.bt_is_authorized_user()); end if;
end $$;

grant select, insert, update, delete on table public.emergency_invoices      to authenticated;
grant select, insert, update, delete on table public.emergency_invoice_items to authenticated;
grant select, insert, update, delete on table public.emergency_stock_deltas  to authenticated;
grant usage, select on sequence public.emergency_invoice_seq to authenticated;

grant execute on function public.record_emergency_sale(
    text, text, text, text, numeric, numeric, numeric, text, numeric, numeric, jsonb
) to authenticated;
grant execute on function public.record_emergency_refund(
    text, text, text, text, numeric, jsonb
) to authenticated;
