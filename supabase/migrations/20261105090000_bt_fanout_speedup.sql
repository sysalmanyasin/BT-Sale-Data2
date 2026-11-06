-- ════════════════════════════════════════════════════════════════
-- bt_fanout_payload() SPEEDUP  (APPLIED to production 2026-11-05 via the Supabase connector)
--
-- Why: PATCHes of the bt_salesdata row were hitting the 8 s statement_timeout of the `authenticated`
-- API role (12 of ~730 saves in 4 h, every one cancelled INSIDE bt_fanout_payload()). The trigger
-- cost ~0.8 s per save on an idle database and spiked past 8 s under load, because
--   (a) `p`/`o` held the 2.5 MB payload TOASTed, so EVERY p->'x' / o->'x' / p ? 'x' re-decompressed
--       it (dozens of times per call), and
--   (b) it rebuilt a 2,378-entry lookup of the old `daily` array on every save even when nothing
--       in `daily` had changed.
--
-- Now: the payload is detoasted ONCE (`|| '{}'::jsonb`), unchanged array sections are skipped by a
-- single equality check, and the big arrays (monthly, daily, ledger entries) are diffed set-based
-- (EXCEPT) instead of with a per-row loop. Smaller arrays keep their original loop, behind the same
-- equality guard.
--
-- Verified on the live data inside rolled-back transactions: identical contents in all 16 fan-out
-- tables (bt_daily, bt_monthly, bt_ledger_entries, bt_staff, bt_manager, bt_petty_cash, bt_incentives,
-- bt_custom_sections, bt_targets, bt_jazzcash_*, bt_ledger_custom_types, bt_notes, bt_staff_notes,
-- bt_col_config) for a no-change save and for a save with a changed day + new day + monthly row +
-- new ledger entry. Timing: no-change save 790-840 ms -> ~80-120 ms; real edit ~790 ms -> ~150 ms.
--
-- ROLLBACK: re-create the previous body from supabase/migrations/20260805_sync_fanout_and_security_fixes.sql
-- ════════════════════════════════════════════════════════════════

create or replace function public.bt_fanout_payload()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $fn$
declare
  p jsonb := new.payload || '{}'::jsonb;  -- concat forces ONE detoast (a TOASTed value is otherwise re-decompressed on every p->... access)
  o jsonb := case when TG_OP = 'UPDATE' then old.payload || '{}'::jsonb else null end;
  rec jsonb;
  k text;
  old_map jsonb;
begin
  -- Monthly (small) ------------------------------------------------------
  if p ? 'monthly' and jsonb_typeof(p->'monthly') = 'array'
     and (o is null or (o->'monthly') is distinct from (p->'monthly')) then
    insert into bt_monthly (month_year, data, updated_at)
    select e->>'Month_Year', e, now()
    from (select e from jsonb_array_elements(p->'monthly') e
          except
          select e from jsonb_array_elements(case when jsonb_typeof(o->'monthly') = 'array' then o->'monthly' else '[]'::jsonb end) e) d(e)
    where e ? 'Month_Year'
    on conflict (month_year) do update set data = excluded.data, updated_at = now();
  end if;

  -- Daily (the big one): untouched when identical; otherwise only the new/changed days are upserted ---
  if p ? 'daily' and jsonb_typeof(p->'daily') = 'array'
     and (o is null or (o->'daily') is distinct from (p->'daily')) then
    insert into bt_daily (date, month_year, data, updated_at)
    select e->>'Date', e->>'Month_Year', e, now()
    from (select e from jsonb_array_elements(p->'daily') e
          except
          select e from jsonb_array_elements(case when jsonb_typeof(o->'daily') = 'array' then o->'daily' else '[]'::jsonb end) e) d(e)
    where e ? 'Date'
    on conflict (date) do update
      set month_year = excluded.month_year, data = excluded.data, updated_at = now();
  end if;

  -- Staff ------------------------------------------------------------------
  if p ? 'staff' and jsonb_typeof(p->'staff') = 'array'
     and (o is null or (o->'staff') is distinct from (p->'staff')) then
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
  if p->'jazzcash' ? 'entries' and jsonb_typeof(p->'jazzcash'->'entries') = 'array'
     and (o is null or (o->'jazzcash'->'entries') is distinct from (p->'jazzcash'->'entries')) then
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
  if p->'jcTally' ? 'accounts' and jsonb_typeof(p->'jcTally'->'accounts') = 'array'
     and (o is null or (o->'jcTally'->'accounts') is distinct from (p->'jcTally'->'accounts')) then
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

  if p->'jcTally' ? 'snapshots' and jsonb_typeof(p->'jcTally'->'snapshots') = 'array'
     and (o is null or (o->'jcTally'->'snapshots') is distinct from (p->'jcTally'->'snapshots')) then
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

  -- Generalized ledger entries (set-based diff) ------------------------------
  if p->'ledger' ? 'entries' and jsonb_typeof(p->'ledger'->'entries') = 'array'
     and (o is null or (o->'ledger'->'entries') is distinct from (p->'ledger'->'entries')) then
    insert into bt_ledger_entries (id, data, updated_at)
    select e->>'id', e, now()
    from (select e from jsonb_array_elements(p->'ledger'->'entries') e
          except
          select e from jsonb_array_elements(case when jsonb_typeof(o->'ledger'->'entries') = 'array' then o->'ledger'->'entries' else '[]'::jsonb end) e) d(e)
    where e ? 'id'
    on conflict (id) do update set data = excluded.data, updated_at = now();
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
  if p ? 'notes' and jsonb_typeof(p->'notes') = 'array'
     and (o is null or (o->'notes') is distinct from (p->'notes')) then
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

  if p ? 'staffNotes' and jsonb_typeof(p->'staffNotes') = 'array'
     and (o is null or (o->'staffNotes') is distinct from (p->'staffNotes')) then
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
$fn$;
