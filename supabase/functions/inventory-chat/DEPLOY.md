# inventory-chat — deployment status

**Already done, via Supabase MCP in this Claude session:**
- ✅ Function deployed and ACTIVE — project `wetbugzzchkghpzmowod` (BT SALE DATA / Closing), `verify_jwt=false`. Same project as `medicine-ai-info`.
- ✅ `inventory-search/app.js` already points at this project's function URL, with the chat FAB/panel wired up in `index.html`/`style.css`.
- ✅ Uses the same `GROQ_API_KEY`/`GEMINI_API_KEY` secrets already set for `medicine-ai-info` — nothing new to configure.

No table of its own — unlike `medicine-ai-info`, there's nothing here to cache (conversations aren't shared/reusable across users the way a single medicine lookup is), and it never talks to the inventory project's database directly. The client builds a small inventory-context slice locally (from the product list it already has synced for its own search box) and sends that along each turn.

## Test
```bash
curl -X POST 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/inventory-chat' \
  -H "apikey: sb_publishable_pPP1QowIcwHFjCGFldrevw_De11RqkD" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"side effects of metformin"}],"context":{"matches":[],"lowStock":[],"outOfStock":[],"totalProducts":0}}'
```
Should return `{"reply": "..."}`.

## Known limitation
Stock/price answers are only as good as the client-side text match
against the latest message — "what antibiotics are low on stock"
won't currently pull in every antibiotic by drug class, since the
context is built with a plain fuzzy name/generic/company search, not
a therapeutic-class lookup. It's told to say plainly when something
didn't turn up rather than guess, but a class-aware search (e.g. a
small keyword→class map) would make that class of question work
better — worth revisiting if it comes up in practice.
