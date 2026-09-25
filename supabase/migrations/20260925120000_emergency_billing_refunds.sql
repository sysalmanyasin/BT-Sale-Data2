-- ════════════════════════════════════════════════════════════════
-- EMERGENCY BILLING DOMAIN — refunds/partial-refunds RPC
-- (architecture doc §6/§8, phase "Held bills / F9 edit / refunds")
--
-- Adds record_emergency_refund() alongside record_emergency_sale()
-- from 20260924182923_emergency_billing.sql. No new tables — refunds
-- are just another row in emergency_invoices with is_refund = true
-- and original_invoice_id set, per the schema that migration already
-- shipped.
--
-- Two deliberate design choices, in one place so they're easy to
-- revisit later:
--
-- 1. Partial refunds are validated against the ORIGINAL invoice's line
--    items, capped by (original qty - already refunded qty) per
--    product — computed from every prior is_refund=true row pointing
--    at the same original_invoice_id. Same row-lock-then-validate
--    shape as record_emergency_sale's oversell check, for the same
--    reason: two concurrent refunds against the same invoice/product
--    shouldn't both succeed if together they'd over-refund it.
--
-- 2. Stock given back goes into the CURRENT bridge sync window (the
--    client passes today's bridge_synced_at per item, same as a sale
--    does), not the original sale's window. See architecture doc §4's
--    self-cleaning note: a delta keyed to an old, now-superseded sync
--    window no longer affects today's computed availability at all, so
--    crediting stock back there would silently vanish. Crediting the
--    CURRENT window is what actually makes the item available again
--    right now — which is the only thing a refund needs to guarantee.
-- ════════════════════════════════════════════════════════════════

create or replace function record_emergency_refund(
    p_device_uuid              text,
    p_staff_name               text,
    p_original_invoice_number  text,
    p_payment_method           text,
    p_cash_given               numeric,
    p_items                    jsonb
    -- [{ "product_code": "...", "product_name": "...", "unit_price": 12.5,
    --    "qty": 1, "bridge_synced_at": "2026-10-01T09:00:00Z" }, ...]
)
returns table(success boolean, message text, invoice_number text, net_total numeric)
language plpgsql security definer
as $$
declare
    v_invoice_number    text;
    v_item              jsonb;
    v_code              text;
    v_qty               integer;
    v_bridge_synced     timestamptz;
    v_orig_qty          integer;
    v_already_refunded  integer;
    v_subtotal          numeric := 0;
begin
    if p_original_invoice_number is null or p_original_invoice_number = '' then
        return query select false::boolean, 'Original invoice number required'::text, null::text, null::numeric;
        return;
    end if;

    if not exists (
        select 1 from emergency_invoices
         where invoice_number = p_original_invoice_number and is_refund = false
    ) then
        return query select false::boolean, 'Original invoice not found'::text, null::text, null::numeric;
        return;
    end if;

    if p_items is null or jsonb_array_length(p_items) = 0 then
        return query select false::boolean, 'No items to refund'::text, null::text, null::numeric;
        return;
    end if;

    -- Pass 1: lock the original invoice row (serializes concurrent
    -- refunds against it) and validate every line against remaining
    -- refundable qty before writing anything.
    perform 1 from emergency_invoices where invoice_number = p_original_invoice_number for update;

    for v_item in select * from jsonb_array_elements(p_items) order by (value->>'product_code')
    loop
        v_code := v_item->>'product_code';
        v_qty  := (v_item->>'qty')::integer;

        if v_qty is null or v_qty <= 0 then
            return query select false::boolean, ('Invalid refund quantity for ' || v_code)::text, null::text, null::numeric;
            return;
        end if;

        select coalesce(qty, 0) into v_orig_qty
          from emergency_invoice_items
         where invoice_number = p_original_invoice_number and product_code = v_code;

        if v_orig_qty is null then
            return query select false::boolean, (v_code || ' was not on the original invoice')::text, null::text, null::numeric;
            return;
        end if;

        select coalesce(sum(ii.qty), 0) into v_already_refunded
          from emergency_invoice_items ii
          join emergency_invoices inv on inv.invoice_number = ii.invoice_number
         where inv.original_invoice_id = p_original_invoice_number
           and inv.is_refund = true
           and ii.product_code = v_code;

        if v_already_refunded + v_qty > v_orig_qty then
            return query select false::boolean,
                ('Refund exceeds original quantity for ' || v_code || ': already refunded ' ||
                 v_already_refunded || ' of ' || v_orig_qty)::text,
                null::text, null::numeric;
            return;
        end if;
    end loop;

    -- Pass 2: validated — commit the refund invoice + give stock back.
    v_invoice_number := _next_emergency_invoice_number();

    for v_item in select * from jsonb_array_elements(p_items)
    loop
        v_code          := v_item->>'product_code';
        v_qty           := (v_item->>'qty')::integer;
        v_bridge_synced := (v_item->>'bridge_synced_at')::timestamptz;
        v_subtotal      := v_subtotal + coalesce((v_item->>'unit_price')::numeric, 0) * v_qty;

        if v_bridge_synced is not null then
            insert into emergency_stock_deltas (product_code, bridge_synced_at, qty_sold)
            values (v_code, v_bridge_synced, 0)
            on conflict (product_code, bridge_synced_at) do nothing;

            update emergency_stock_deltas
               set qty_sold = qty_sold - v_qty, updated_at = now()
             where product_code = v_code and bridge_synced_at = v_bridge_synced;
        end if;
    end loop;

    insert into emergency_invoices (
        invoice_number, device_uuid, staff_name, customer_name, customer_phone,
        subtotal, discount_amount, net_total, payment_method,
        cash_received, change_amount, is_refund, original_invoice_id, status, billed_at
    )
    select
        v_invoice_number, coalesce(p_device_uuid, ''), coalesce(p_staff_name, ''),
        orig.customer_name, orig.customer_phone,
        v_subtotal, 0, v_subtotal, coalesce(p_payment_method, orig.payment_method),
        coalesce(p_cash_given, 0), 0, true, p_original_invoice_number, 'finalized', now()
    from emergency_invoices orig
    where orig.invoice_number = p_original_invoice_number;

    insert into emergency_invoice_items (invoice_number, product_code, product_name, unit_price, qty, total)
    select
        v_invoice_number,
        item->>'product_code',
        coalesce(item->>'product_name', ''),
        coalesce((item->>'unit_price')::numeric, 0),
        (item->>'qty')::integer,
        coalesce((item->>'unit_price')::numeric, 0) * (item->>'qty')::integer
    from jsonb_array_elements(p_items) as item;

    return query select true::boolean, 'ok'::text, v_invoice_number::text, v_subtotal::numeric;
end;
$$;

grant execute on function record_emergency_refund(
    text, text, text, text, numeric, jsonb
) to anon;
