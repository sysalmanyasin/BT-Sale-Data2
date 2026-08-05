-- ══════════════════════════════════════════════════════════════════════════
-- Sync reliability + security audit — 2026-08-05
-- Project: BT SALE DATA (wetbugzzchkghpzmowod)
--
-- Background
-- ----------
-- Sync Center was repeatedly logging:
--   "canceling statement due to statement timeout"
-- on push.
--
-- Root cause: bt_salesdata (the single-row JSONB blob the app pushes to)
-- has an AFTER INSERT/UPDATE trigger, trg_bt_fanout, that calls
-- bt_fanout_payload(). That function fanned every section of the payload
-- (daily, monthly, staff, ledger, jazzcash, etc — 2,000+ JSON rows total)
-- out into their own tables on EVERY push, even if only one field changed
-- anywhere in the document. That easily exceeded the client role's
-- statement_timeout (anon = 3s, authenticated = 8s).
--
-- Fix: bt_fanout_payload() now diffs each array/map element against the
-- OLD payload (available via TG_OP = 'UPDATE') and only upserts rows/keys
-- that actually changed. Verified live: a no-op re-save now touches zero
-- child rows, versus 2,000+ before this fix.
--
-- Alongside the fix, a Supabase security audit (via advisors) also
-- surfaced two issues fixed here:
--   1. bt_sessions (the Sync Center device write-lock table) had RLS
--      disabled entirely — any anon-key holder could read/write it.
--   2. admin_restore_backup() and admin_set_drive_trigger() are
--      SECURITY DEFINER RPC functions with no permission check inside
--      them. admin_restore_backup() unconditionally WIPES sheets,
--      credit_ledger, deleted_records, and activity_log and replaces
--      them from the given payload — and was callable by the public
--      anon role. Neither function is referenced anywhere in the app's
--      client code (js/), so restricting them to `authenticated` is
--      safe and breaks nothing.
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Diff-aware fanout trigger — only upserts child rows that changed.
--    (Full function body lives in this file; see below.)
CREATE OR REPLACE FUNCTION public.bt_fanout_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  p jsonb := new.payload;
  o jsonb := case when TG_OP = 'UPDATE' then old.payload else null end;
  rec jsonb;
  k text;
  old_map jsonb;
begin
  -- Monthly ------------------------------------------------------------
  if p ? 'monthly' and jsonb_typeof(p->'monthly') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o ? 'monthly' and jsonb_typeof(o->'monthly') = 'array' then
      select coalesce(jsonb_object_agg(e->>'Month_Year', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'monthly') e where e ? 'Month_Year';
    end if;
    for rec in select * from jsonb_array_elements(p->'monthly') loop
      if rec ? 'Month_Year' and (old_map->(rec->>'Month_Year')) is distinct from rec then
        insert into bt_monthly (month_year, data, updated_at)
        values (rec->>'Month_Year', rec, now())
        on conflict (month_year) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Daily ----------------------------------------------------------------
  if p ? 'daily' and jsonb_typeof(p->'daily') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o ? 'daily' and jsonb_typeof(o->'daily') = 'array' then
      select coalesce(jsonb_object_agg(e->>'Date', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'daily') e where e ? 'Date';
    end if;
    for rec in select * from jsonb_array_elements(p->'daily') loop
      if rec ? 'Date' and (old_map->(rec->>'Date')) is distinct from rec then
        insert into bt_daily (date, month_year, data, updated_at)
        values (rec->>'Date', rec->>'Month_Year', rec, now())
        on conflict (date) do update
          set month_year = excluded.month_year, data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Staff ------------------------------------------------------------------
  if p ? 'staff' and jsonb_typeof(p->'staff') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o ? 'staff' and jsonb_typeof(o->'staff') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'staff') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'staff') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_staff (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Manager (section -> month -> data) --------------------------------------
  if p ? 'manager' then
    for k in select jsonb_object_keys(p->'manager') loop
      if jsonb_typeof(p->'manager'->k) = 'object' then
        declare
          m text;
          old_section jsonb := case when o is not null then o->'manager'->k else null end;
        begin
          for m in select jsonb_object_keys(p->'manager'->k) loop
            if old_section is null or (old_section->m) is distinct from (p->'manager'->k->m) then
              insert into bt_manager (section, month, data, updated_at)
              values (k, m, p->'manager'->k->m, now())
              on conflict (section, month) do update set data = excluded.data, updated_at = now();
            end if;
          end loop;
        end;
      end if;
    end loop;
  end if;

  -- Petty cash / incentive (flat key->value maps) ----------------------------
  if p ? 'petty' then
    for k in select jsonb_object_keys(p->'petty') loop
      if o is null or (o->'petty'->k) is distinct from (p->'petty'->k) then
        insert into bt_petty_cash (key, data, updated_at)
        values (k, p->'petty'->k, now())
        on conflict (key) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  if p ? 'incentive' then
    for k in select jsonb_object_keys(p->'incentive') loop
      if o is null or (o->'incentive'->k) is distinct from (p->'incentive'->k) then
        insert into bt_incentives (key, data, updated_at)
        values (k, p->'incentive'->k, now())
        on conflict (key) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Custom sections: { sectionId: { name, emoji, months: { month: {...} } } } --
  if p ? 'custom' then
    for k in select jsonb_object_keys(p->'custom') loop
      declare
        sec jsonb := p->'custom'->k;
        m text;
        old_sec jsonb := case when o is not null then o->'custom'->k else null end;
      begin
        if sec ? 'months' then
          for m in select jsonb_object_keys(sec->'months') loop
            if old_sec is null or not (old_sec ? 'months')
               or (old_sec->'months'->m) is distinct from (sec->'months'->m)
               or (old_sec->>'name') is distinct from (sec->>'name')
               or (old_sec->>'emoji') is distinct from (sec->>'emoji') then
              insert into bt_custom_sections (section_id, month, name, emoji, data, updated_at)
              values (k, m, sec->>'name', sec->>'emoji', sec->'months'->m, now())
              on conflict (section_id, month) do update
                set name = excluded.name, emoji = excluded.emoji,
                    data = excluded.data, updated_at = now();
            end if;
          end loop;
        end if;
      end;
    end loop;
  end if;

  -- Targets: { month: {...} } -------------------------------------------------
  if p ? 'targets' then
    for k in select jsonb_object_keys(p->'targets') loop
      if o is null or (o->'targets'->k) is distinct from (p->'targets'->k) then
        insert into bt_targets (month, data, updated_at)
        values (k, p->'targets'->k, now())
        on conflict (month) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- JazzCash entries -------------------------------------------------------
  if p->'jazzcash' ? 'entries' and jsonb_typeof(p->'jazzcash'->'entries') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o->'jazzcash' ? 'entries' and jsonb_typeof(o->'jazzcash'->'entries') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'jazzcash'->'entries') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'jazzcash'->'entries') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_jazzcash_entries (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- JazzCash tally accounts + snapshots ----------------------------------
  if p->'jcTally' ? 'accounts' and jsonb_typeof(p->'jcTally'->'accounts') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o->'jcTally' ? 'accounts' and jsonb_typeof(o->'jcTally'->'accounts') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'jcTally'->'accounts') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'jcTally'->'accounts') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_jazzcash_tally_accounts (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  if p->'jcTally' ? 'snapshots' and jsonb_typeof(p->'jcTally'->'snapshots') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o->'jcTally' ? 'snapshots' and jsonb_typeof(o->'jcTally'->'snapshots') = 'array' then
      select coalesce(jsonb_object_agg(e->>'date', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'jcTally'->'snapshots') e where e ? 'date';
    end if;
    for rec in select * from jsonb_array_elements(p->'jcTally'->'snapshots') loop
      if rec ? 'date' and (old_map->(rec->>'date')) is distinct from rec then
        insert into bt_jazzcash_tally_snapshots (date, data, updated_at)
        values (rec->>'date', rec, now())
        on conflict (date) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Generalized ledger entries -------------------------------------------
  if p->'ledger' ? 'entries' and jsonb_typeof(p->'ledger'->'entries') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o->'ledger' ? 'entries' and jsonb_typeof(o->'ledger'->'entries') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'ledger'->'entries') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'ledger'->'entries') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_ledger_entries (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  if p ? 'ledgerCustomTypes' then
    for k in select jsonb_object_keys(p->'ledgerCustomTypes') loop
      if o is null or (o->'ledgerCustomTypes'->k) is distinct from (p->'ledgerCustomTypes'->k) then
        insert into bt_ledger_custom_types (type, data, updated_at)
        values (k, p->'ledgerCustomTypes'->k, now())
        on conflict (type) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Notes / Staff notes -----------------------------------------------
  if p ? 'notes' and jsonb_typeof(p->'notes') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o ? 'notes' and jsonb_typeof(o->'notes') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'notes') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'notes') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_notes (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  if p ? 'staffNotes' and jsonb_typeof(p->'staffNotes') = 'array' then
    old_map := '{}'::jsonb;
    if o is not null and o ? 'staffNotes' and jsonb_typeof(o->'staffNotes') = 'array' then
      select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into old_map
      from jsonb_array_elements(o->'staffNotes') e where e ? 'id';
    end if;
    for rec in select * from jsonb_array_elements(p->'staffNotes') loop
      if rec ? 'id' and (old_map->(rec->>'id')) is distinct from rec then
        insert into bt_staff_notes (id, data, updated_at)
        values (rec->>'id', rec, now())
        on conflict (id) do update set data = excluded.data, updated_at = now();
      end if;
    end loop;
  end if;

  -- Column config ---------------------------------------------------------
  if p ? 'colConfig' and (o is null or (o->'colConfig') is distinct from (p->'colConfig')) then
    insert into bt_col_config (id, hidden, custom, updated_at)
    values ('main', p->'colConfig'->'hidden', p->'colConfig'->'custom', now())
    on conflict (id) do update
      set hidden = excluded.hidden, custom = excluded.custom, updated_at = now();
  end if;

  return new;
end;
$function$;


-- 2) bt_sessions had RLS disabled entirely. It has no per-user auth concept
--    (devices are identified by a client-generated device_id, not
--    auth.uid()), so these policies preserve current behavior exactly
--    while formally closing the "RLS disabled" gap. Consider adding
--    device-level auth later if you want to actually restrict who can
--    demote/hijack another device's write lock.
ALTER TABLE public.bt_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bt_sessions read all" ON public.bt_sessions
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "bt_sessions insert" ON public.bt_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "bt_sessions update" ON public.bt_sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "bt_sessions delete" ON public.bt_sessions
  FOR DELETE TO anon, authenticated USING (true);


-- 3) admin_restore_backup() wipes and replaces sheets / credit_ledger /
--    deleted_records / activity_log with no auth check inside it, and was
--    callable by the public anon role. admin_set_drive_trigger() toggles
--    the Drive backup trigger, same exposure. Neither is called anywhere
--    in js/ — restricting to `authenticated` breaks nothing in the app.
REVOKE EXECUTE ON FUNCTION public.admin_restore_backup(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_restore_backup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_restore_backup(jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_set_drive_trigger(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_drive_trigger(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_drive_trigger(boolean) TO authenticated;


-- 4) widget_outstanding_credits_v was SECURITY DEFINER (runs as the view
--    creator rather than the querying user, bypassing their RLS). It's a
--    read-only projection of bt_salesdata with no extra privilege need —
--    switch it to SECURITY INVOKER.
ALTER VIEW public.widget_outstanding_credits_v SET (security_invoker = on);


-- ══════════════════════════════════════════════════════════════════════════
-- NOT included in this migration (flagged for follow-up, lower priority):
--   • auth_leaked_password_protection — enable in Dashboard > Auth >
--     Providers > Password (not a SQL-level setting).
--   • Several SECURITY DEFINER functions (bt_fold_ledger_inbox,
--     bt_fold_staff_credit_inbox, bt_fold_unmatched_inbox, current_staff_id,
--     drive_backup_on_shift_save, get_widget_summary, is_active_staff,
--     notify_admin_shift_saved, widget_summary) are anon-executable. These
--     appear intentional (public-facing widgets / inbox folding used by
--     the app), so left as-is pending confirmation of intent.
--   • function_search_path_mutable warnings on several trigger functions —
--     cosmetic hardening (SET search_path), no functional impact.
--   • Duplicate permissive RLS policies across most bt_* tables
--     ("bt dashboard can read" + "bt dashboard can write" both matching
--     SELECT) — adds minor per-query overhead, not correctness-affecting.
-- ══════════════════════════════════════════════════════════════════════════
