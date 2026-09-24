-- ════════════════════════════════════════════════════════════════
-- EMERGENCY BILLING DOMAIN — schema + atomic checkout RPC
--
-- Project: wetbugzzchkghpzmowod (the main app's own Supabase project).
-- Deliberately does NOT touch inventory_products or anything in the
-- separate Pharmacy Audit Hub project (vtcrdkqhuvxatclobsby) — see
-- architecture doc §1/§4. Stock availability here is a client-computed
-- overlay on top of the read-only inventory bridge; this migration
-- only owns the overlay (emergency_stock_deltas) and the invoices
-- themselves, never the product master.
--
-- App-wide usage (no per-device/counter restriction), fully manual
-- reconciliation into Daily Sale Entry (see architecture doc §7/§9).
--
-- Safe to run more than once — every statement is IF NOT EXISTS /
-- CREATE OR REPLACE, matching the rest of this repo's migration style.
-- ════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- TABLE 1: emergency_invoices
-- ────────────────────────────────────────────────────────────────
create table if not exists emergency_invoices (
    invoice_number       text          primary key,
    device_uuid          text          not null default '',
    staff_name            text          not null default '',
    customer_name         text          not null default '',
    customer_phone        text          not null default '',
    subtotal              numeric(12,2) not null default 0,
    discount_amount       numeric(12,2) not null default 0,
    net_total             numeric(12,2) not null default 0,
    payment_method        text          not null default 'cash',   -- cash | card | online
    cash_received         numeric(12,2) not null default 0,
    change_amount         numeric(12,2) not null default 0,
    is_refund             boolean       not null default false,
    original_invoice_id   text,
    status                text          not null default 'open',    -- open | held | finalized | voided
    reconciled_into_daily boolean       not null default false,
    reconciled_date       text,
    billed_at             timestamptz   not null default now()
);

create index if not exists idx_eb_invoices_billed_at on emergency_invoices(billed_at desc);
create index if not exists idx_eb_invoices_status     on emergency_invoices(status);
create index if not exists idx_eb_invoices_reconciled on emergency_invoices(reconciled_into_daily);


-- ────────────────────────────────────────────────────────────────
-- TABLE 2: emergency_invoice_items
-- ────────────────────────────────────────────────────────────────
create table if not exists emergency_invoice_items (
    invoice_number  text          not null references emergency_invoices(invoice_number) on delete cascade,
    product_code    text          not null,
    product_name    text          not null default '',
    unit_price      numeric(12,2) not null default 0,
    qty             integer       not null default 0,
    total           numeric(12,2) not null default 0,
    primary key (invoice_number, product_code)
);

create index if not exists idx_eb_items_invoice on emergency_invoice_items(invoice_number);
create index if not exists idx_eb_items_product on emergency_invoice_items(product_code);


-- ────────────────────────────────────────────────────────────────
-- TABLE 3: emergency_stock_deltas  (the stock overlay — see doc §4)
-- One row per product per bridge-sync window. bridge_synced_at pins
-- this delta to a specific inventory_sync_log.synced_at value from
-- the Pharmacy Audit Hub project, so it naturally stops being
-- subtracted once a newer real sync lands.
-- ────────────────────────────────────────────────────────────────
create table if not exists emergency_stock_deltas (
    product_code     text        not null,
    bridge_synced_at timestamptz not null,
    qty_sold         integer     not null default 0,
    updated_at       timestamptz not null default now(),
    primary key (product_code, bridge_synced_at)
);

create index if not exists idx_eb_deltas_product on emergency_stock_deltas(product_code);


-- ════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — same anon-role, USING(true) pattern the rest
-- of this app already uses (attendance, inventory bridge, etc.).
-- App-wide access, no device/counter scoping, per §9.
-- ════════════════════════════════════════════════════════════════
alter table emergency_invoices      enable row level security;
alter table emergency_invoice_items enable row level security;
alter table emergency_stock_deltas  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='emergency_invoices' and policyname='anon_all') then
    create policy anon_all on emergency_invoices for all to anon using (true) with check (true); end if;
  if not exists (select 1 from pg_policies where tablename='emergency_invoice_items' and policyname='anon_all') then
    create policy anon_all on emergency_invoice_items for all to anon using (true) with check (true); end if;
  if not exists (select 1 from pg_policies where tablename='emergency_stock_deltas' and policyname='anon_all') then
    create policy anon_all on emergency_stock_deltas for all to anon using (true) with check (true); end if;
end $$;

grant select, insert, update, delete on table emergency_invoices      to anon;
grant select, insert, update, delete on table emergency_invoice_items to anon;
grant select, insert, update, delete on table emergency_stock_deltas  to anon;
grant usage, select on all sequences in schema public to anon;


-- ────────────────────────────────────────────────────────────────
-- Invoice number generator: EB-YYYYMMDD-NNNN. The counter is a
-- single global sequence (not reset daily) — still produces unique,
-- readable, chronologically-sortable numbers; a reset-per-day scheme
-- would need its own bookkeeping row for no real benefit here.
-- ────────────────────────────────────────────────────────────────
create sequence if not exists emergency_invoice_seq;

create or replace function _next_emergency_invoice_number()
returns text
language plpgsql
as $$
begin
    return 'EB-' || to_char(now(), 'YYYYMMDD') || '-' ||
           lpad(nextval('emergency_invoice_seq')::text, 4, '0');
end;
$$;


-- ════════════════════════════════════════════════════════════════
-- RPC: record_emergency_sale
--
-- Atomically: validates stock against the client-supplied bridge
-- snapshot (per item), increments emergency_stock_deltas, inserts
-- the invoice header + line items. All in one transaction, row-
-- locked per product so two concurrent emergency checkouts on the
-- same product can't both oversell.
--
-- IMPORTANT — accepted tradeoff (see architecture doc §4): this
-- function lives in the main app's own project and has no access to
-- the Pharmacy Audit Hub project's inventory_products table (it's a
-- separate Supabase instance, no FDW configured). p_bridge_qty and
-- p_bridge_synced_at per item are therefore supplied by the client
-- from its most recent inventory-bridge read. This function is the
-- source of truth for "did we oversell within this emergency
-- session" — it is NOT re-verifying the client's honesty about the
-- upstream bridge state, only serializing concurrent writes against
-- each other correctly, which is the part actually at risk of a race.
--
-- p_items shape (jsonb array):
--   [{ "product_code": "...", "product_name": "...", "unit_price": 12.5,
--      "qty": 2, "bridge_qty": 40, "bridge_synced_at": "2026-10-01T09:00:00Z" }, ...]
-- ════════════════════════════════════════════════════════════════
create or replace function record_emergency_sale(
    p_device_uuid      text,
    p_staff_name       text,
    p_customer_name    text,
    p_customer_phone   text,
    p_subtotal         numeric,
    p_discount_amount  numeric,
    p_net_total        numeric,
    p_payment_method   text,
    p_cash_received    numeric,
    p_change_amount    numeric,
    p_items            jsonb
)
returns table(success boolean, message text, invoice_number text)
language plpgsql security definer
as $$
declare
    v_invoice_number text;
    v_item           jsonb;
    v_code           text;
    v_qty            integer;
    v_bridge_qty     integer;
    v_bridge_synced  timestamptz;
    v_sold_so_far    integer;
    v_available      integer;
begin
    if p_items is null or jsonb_array_length(p_items) = 0 then
        return query select false::boolean, 'No items in cart'::text, null::text;
        return;
    end if;

    -- Pass 1: lock + validate every line before writing anything.
    -- Locking rows up front (in a stable order — product_code) avoids
    -- deadlocks between two concurrent checkouts sharing products.
    for v_item in select * from jsonb_array_elements(p_items) order by (value->>'product_code')
    loop
        v_code          := v_item->>'product_code';
        v_qty           := (v_item->>'qty')::integer;
        v_bridge_qty    := coalesce((v_item->>'bridge_qty')::integer, 0);
        v_bridge_synced := (v_item->>'bridge_synced_at')::timestamptz;

        if v_qty is null or v_qty <= 0 then
            return query select false::boolean,
                ('Invalid quantity for ' || v_code)::text, null::text;
            return;
        end if;

        -- Lock (or create) this product's delta row for this sync window.
        insert into emergency_stock_deltas (product_code, bridge_synced_at, qty_sold)
        values (v_code, v_bridge_synced, 0)
        on conflict (product_code, bridge_synced_at) do nothing;

        select qty_sold into v_sold_so_far
          from emergency_stock_deltas
         where product_code = v_code and bridge_synced_at = v_bridge_synced
         for update;

        v_available := v_bridge_qty - coalesce(v_sold_so_far, 0);

        if v_qty > v_available then
            return query select false::boolean,
                ('Insufficient stock for ' || v_code || ': requested ' || v_qty ||
                 ', available ' || v_available)::text,
                null::text;
            return;
        end if;
    end loop;

    -- Pass 2: everything validated under lock — commit the deltas + invoice.
    v_invoice_number := _next_emergency_invoice_number();

    for v_item in select * from jsonb_array_elements(p_items)
    loop
        v_code          := v_item->>'product_code';
        v_qty           := (v_item->>'qty')::integer;
        v_bridge_synced := (v_item->>'bridge_synced_at')::timestamptz;

        update emergency_stock_deltas
           set qty_sold = qty_sold + v_qty, updated_at = now()
         where product_code = v_code and bridge_synced_at = v_bridge_synced;
    end loop;

    insert into emergency_invoices (
        invoice_number, device_uuid, staff_name, customer_name, customer_phone,
        subtotal, discount_amount, net_total, payment_method,
        cash_received, change_amount, status, billed_at
    ) values (
        v_invoice_number, coalesce(p_device_uuid,''), coalesce(p_staff_name,''),
        coalesce(p_customer_name,''), coalesce(p_customer_phone,''),
        coalesce(p_subtotal,0), coalesce(p_discount_amount,0), coalesce(p_net_total,0),
        coalesce(p_payment_method,'cash'), coalesce(p_cash_received,0),
        coalesce(p_change_amount,0), 'finalized', now()
    );

    insert into emergency_invoice_items (invoice_number, product_code, product_name, unit_price, qty, total)
    select
        v_invoice_number,
        item->>'product_code',
        coalesce(item->>'product_name',''),
        coalesce((item->>'unit_price')::numeric, 0),
        (item->>'qty')::integer,
        coalesce((item->>'unit_price')::numeric, 0) * (item->>'qty')::integer
    from jsonb_array_elements(p_items) as item;

    return query select true::boolean, 'ok'::text, v_invoice_number::text;
end;
$$;

grant execute on function record_emergency_sale(
    text, text, text, text, numeric, numeric, numeric, text, numeric, numeric, jsonb
) to anon;
