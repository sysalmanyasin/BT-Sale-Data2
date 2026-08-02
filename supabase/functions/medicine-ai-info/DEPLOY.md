# Deploying medicine-ai-info

Same story as `send-daily-whatsapp-briefing`: this sandbox has no
network access to supabase.com, so I can't deploy this for you. Here's
how to do it yourself, in order.

## 1. Get free API keys
- **Groq** (primary, recommended): https://console.groq.com/keys — free tier, fast.
- **Gemini** (fallback): https://aistudio.google.com/apikey — also has a free tier.

You only strictly need one, but setting both means the AI button keeps
working if one provider is briefly rate-limited or down.

## 2. (Optional but recommended) create the cache table
Run `../../medicine_ai_cache.sql` once against the **same Supabase
project `inventory_products` lives in** (`vtcrdkqhuvxatclobsby`) — via
the SQL Editor in the Supabase dashboard, or:
```bash
supabase db execute -f supabase/medicine_ai_cache.sql --project-ref vtcrdkqhuvxatclobsby
```
Without this table the function still works, it just re-asks the AI
every single time instead of reusing a 30-day-old cached answer — on a
free-tier key, across a whole pharmacy's searches, you'll want the cache.

## 3. Deploy the function
```bash
supabase functions deploy medicine-ai-info --project-ref vtcrdkqhuvxatclobsby --no-verify-jwt
```
`--no-verify-jwt` is needed because Inventory Search has no login step
of its own — it calls this function with only the public anon key,
same as inventory-bridge.js does for the table read.

## 4. Set secrets
```bash
supabase secrets set GROQ_API_KEY=...   --project-ref vtcrdkqhuvxatclobsby
supabase secrets set GEMINI_API_KEY=... --project-ref vtcrdkqhuvxatclobsby   # optional fallback

# Only needed if you did step 2 (the cache table) — service-role key,
# find it in Dashboard > Project Settings > API. Never the anon key here.
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... --project-ref vtcrdkqhuvxatclobsby
```

## 5. Test
```bash
curl -X POST 'https://vtcrdkqhuvxatclobsby.supabase.co/functions/v1/medicine-ai-info' \
  -H "apikey: sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy" \
  -H "Content-Type: application/json" \
  -d '{"name":"Panadol 500mg","generic":"Paracetamol","company":"GSK"}'
```
Should return `{"info": "...", "cached": false}` the first time and
`"cached": true` on a repeat call within 30 days (once the cache table
is set up).

## Known limitation
The AI text is general reference information, not sourced live from a
drug database — it's a language model's knowledge, so always sanity
check anything dosage-specific against the actual product leaflet
before relying on it clinically. The app already shows this disclaimer
under every AI answer.
