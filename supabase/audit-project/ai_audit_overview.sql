-- Audit Hub project (vtcrdkqhuvxatclobsby) -- NOT the main BT project. Do not put this in supabase/migrations
-- (that folder is deployed to the main project by .github/workflows/supabase-deploy.yml).
-- One read-only function the BT Intelligence page + assistant read through js/audit-bridge.js.
-- Aggregates only: no customer names, no auditor names, no phone numbers, no raw count rows.
create or replace function public.ai_audit_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  res jsonb;
begin
  with open_eng as (
    select id, name, scope_type from engagements where status = 'open'
  ),
  latest_rows as (  -- newest unresolved variance per (engagement, company, code)
    select distinct on (e.id, v->>'company', v->>'code')
      e.id eng_id, v->>'company' company, v->>'code' code, v->>'name' item,
      coalesce((v->>'variance')::numeric, 0) var,
      coalesce((v->>'price')::numeric, 0) price,
      (v->>'systemQty')::numeric sys, (v->>'countedQty')::numeric counted
    from open_eng e
    join compiled_rounds cr on cr.engagement_id = e.id
    cross join lateral jsonb_array_elements(cr.variances) v
    where coalesce((v->>'variance')::numeric, 0) <> 0 and (v->>'correctedAt') is null
    order by e.id, v->>'company', v->>'code', cr.compiled_at desc
  ),
  per_eng as (
    select e.id, e.name, e.scope_type,
      (select count(*) from rounds r where r.engagement_id = e.id) rounds_total,
      (select jsonb_build_object('number', r.round_number, 'suffix', r.round_suffix, 'state', r.state, 'created', r.created_at)
         from rounds r where r.engagement_id = e.id order by r.created_at desc limit 1) latest_round,
      (select count(*) from assignments a where a.engagement_id = e.id and a.status <> 'revoked') assigned,
      (select count(*) from assignments a where a.engagement_id = e.id and a.status = 'submitted') submitted,
      (select count(*) from assignments a where a.engagement_id = e.id and a.status = 'counting') counting,
      (select count(*) from latest_rows l where l.eng_id = e.id) variance_items,
      (select coalesce(sum(-var * price), 0) from latest_rows l where l.eng_id = e.id and var < 0) shortage_value,
      (select coalesce(sum(var * price), 0) from latest_rows l where l.eng_id = e.id and var > 0) excess_value,
      (select coalesce(jsonb_agg(t), '[]') from (
         select item, company, sys as system_qty, counted as counted_qty, var as variance, round(var * price) as value
         from latest_rows l where l.eng_id = e.id order by abs(var * price) desc limit 5) t) top_items
    from open_eng e
  )
  select jsonb_build_object(
    'generated_at', now(),
    'engagements', coalesce((select jsonb_agg(to_jsonb(p) - 'id') from per_eng p), '[]'),
    'last_final', (select jsonb_build_object('engagement', e.name, 'generated_at', f.generated_at,
                      'variance_value', f.report->>'totalVarianceValue', 'total_items', f.report->>'totalItems')
                   from final_snapshots f join engagements e on e.id = f.engagement_id order by f.generated_at desc limit 1),
    'suggestions', jsonb_build_object(
      'pending', (select count(*) from variance_edit_suggestions where status = 'pending'),
      'latest', coalesce((select jsonb_agg(t) from (
         select name as item, company, system_qty, previous_counted_qty, suggested_qty, reason, created_at
         from variance_edit_suggestions where status = 'pending' order by created_at desc limit 5) t), '[]')),
    'expiry', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from expiry_entries group by 1) s), '{}'),
      'near_entries', (select count(*) from expiry_entries where status = 'Near Expiry'),
      'near_qty', (select coalesce(sum(quantity), 0) from expiry_entries where status = 'Near Expiry'),
      'earliest_month', (select min(expiry_month) from expiry_entries where status = 'Near Expiry'),
      'within_90_days_entries', (select count(*) from expiry_entries where status = 'Near Expiry' and expiry_month <= to_char(now() + interval '3 months', 'YYYY-MM')),
      'by_month', coalesce((select jsonb_agg(t order by t.month) from (
         select expiry_month as month, count(*) entries, sum(quantity) qty from expiry_entries where status = 'Near Expiry' group by 1) t), '[]')),
    'payments', jsonb_build_object(
      'synced_at', (select max(synced_at) from sales_payment_summary),
      'days', coalesce((select jsonb_agg(t order by t.sale_day desc) from (
         select p.sale_day, p.cash_sale cash, p.card_sale card, p.credit_sale credit, p.total_sale total,
                (select count(*) from sales_credit_by_customer c where c.sale_day = p.sale_day) credit_customers
         from sales_payment_summary p order by p.sale_day desc limit 7) t), '[]')),
    'barcodes', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from product_barcodes group by 1) s), '{}'),
    'staff', jsonb_build_object(
      'total', (select count(*) from staff),
      'access_expiring_7d', (select count(*) from staff where access_expires_at is not null and access_expires_at between now() and now() + interval '7 days'),
      'access_expired', (select count(*) from staff where access_expires_at is not null and access_expires_at < now()))
  ) into res;
  return res;
end $$;

revoke all on function public.ai_audit_overview() from public;
grant execute on function public.ai_audit_overview() to anon, authenticated;
