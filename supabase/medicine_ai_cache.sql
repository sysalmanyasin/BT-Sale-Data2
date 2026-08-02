-- Run once against the Inventory / Pharmacy Audit Hub Supabase project
-- (the same one inventory_products lives in — vtcrdkqhuvxatclobsby).
-- Optional but recommended: without this table, medicine-ai-info still
-- works, it just calls the AI provider on every single lookup instead
-- of reusing a cached answer for CACHE_DAYS.

create table if not exists medicine_ai_cache (
  cache_key   text primary key,   -- lowercased generic name (falls back to product name)
  info        text not null,
  updated_at  timestamptz not null default now()
);

-- No RLS policies needed for public read/write here — the Edge Function
-- talks to this table with the service-role key, never the anon key,
-- so it's not reachable directly from the browser. Leave RLS enabled
-- with no policies (the default-deny) so anon/authenticated clients
-- can't read or write it directly.
alter table medicine_ai_cache enable row level security;
