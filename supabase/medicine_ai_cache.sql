-- STATUS: already applied to project wetbugzzchkghpzmowod (BT SALE
-- DATA / Closing — where medicine-ai-info is deployed) via Supabase
-- MCP in this Claude session. Kept here for reference / disaster
-- recovery, not something you need to run again.
--
-- Note this is the Closing project, not the inventory project
-- (vtcrdkqhuvxatclobsby) that inventory_products lives in — see
-- supabase/functions/medicine-ai-info/index.ts header for why.

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
