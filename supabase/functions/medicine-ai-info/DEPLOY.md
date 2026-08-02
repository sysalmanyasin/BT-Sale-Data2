# medicine-ai-info — deployment status

**Already done, via Supabase MCP in this Claude session:**
- ✅ Function deployed and ACTIVE — project `wetbugzzchkghpzmowod` (BT SALE DATA / Closing), `verify_jwt=false`.
- ✅ `medicine_ai_cache` table created in that same project, RLS enabled with no policies (default-deny — only the function's auto-injected service-role key can read/write it; anon/authenticated get nothing).
- ✅ `inventory-search/app.js` already points at this project's function URL.

**Only step left — you have to do this one, it needs your own free API key(s):**

## Set the AI provider secret(s)
Neither `GROQ_API_KEY` nor `GEMINI_API_KEY` is set yet, so "Ask AI" will
currently return a 502 ("no provider key set"). Get at least one free
key and set it:

- Groq (recommended, primary): https://console.groq.com/keys
- Gemini (optional fallback): https://aistudio.google.com/apikey

```bash
supabase secrets set GROQ_API_KEY=...   --project-ref wetbugzzchkghpzmowod
supabase secrets set GEMINI_API_KEY=... --project-ref wetbugzzchkghpzmowod   # optional
```
(No Supabase CLI installed? Dashboard → this project → Edge Functions →
Secrets works the same way.)

That's it — no redeploy needed, the function reads the secret at
request time.

## Test after setting a key
```bash
curl -X POST 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/medicine-ai-info' \
  -H "apikey: sb_publishable_pPP1QowIcwHFjCGFldrevw_De11RqkD" \
  -H "Content-Type: application/json" \
  -d '{"name":"Panadol 500mg","generic":"Paracetamol","company":"GSK"}'
```
Should return `{"info": "...", "cached": false}` the first time and
`"cached": true` on a repeat call within 30 days.

## Known limitation
The AI text is general reference information from a language model,
not sourced live from a drug database — always sanity-check anything
dosage-specific against the actual product leaflet before relying on
it clinically. The app already shows this disclaimer under every AI
answer.
