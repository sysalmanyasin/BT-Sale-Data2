# Deploying send-daily-whatsapp-briefing

I can't deploy this from here — this sandbox has no network access to
supabase.com or Meta's Graph API. Steps to run it yourself:

## 1. One-time WhatsApp template approval
Business-initiated messages need a pre-approved template — see the
warning at the top of `index.ts`. Create it in Meta Business Manager >
WhatsApp Manager (Utility category, one `{{1}}` body variable) before
deploying, since approval can take a while.

## 2. Deploy
```bash
supabase functions deploy send-daily-whatsapp-briefing
```
Run from the repo root so the relative import to `js/shared/summary-calc.js`
resolves. If your Supabase CLI version can't follow imports outside the
function's own folder, copy that file into
`supabase/functions/_shared/summary-calc.js` and update the import path
in `index.ts` instead.

## 3. Set secrets
```bash
supabase secrets set GROQ_API_KEY=...
supabase secrets set CEREBRAS_API_KEY=...            # optional fallback
supabase secrets set WHATSAPP_TOKEN=...
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=...
supabase secrets set WHATSAPP_RECIPIENT=923001234567  # E.164, no leading +
supabase secrets set WHATSAPP_TEMPLATE_NAME=your_template_name
```

## 4. Schedule it
Supabase Dashboard → Edge Functions → your function → Cron, or via SQL
(`pg_cron` + `pg_net`), once daily at closing time. Test with a manual
invoke first:
```bash
supabase functions invoke send-daily-whatsapp-briefing
```

## 5. Confirm delivery end-to-end (per plan 4.3)
Ship this one message type only — daily closing total + inventory-health
line — and confirm a real WhatsApp message arrives before adding any
second message type.

## Known limitation, by design (see index.ts header)
The inventory "excess" figure sent here is the **raw** 100-day-excess
value, not the corrected one Cover Dashboard's doughnut shows — the
correction (retain list + misc buffer) lives in per-device localStorage
and has no server-reachable copy. If you want the corrected figure in
the WhatsApp message too, the retain list / misc buffer need to move to
a synced table first (a bigger change than this phase).
