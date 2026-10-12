# send-daily-ntfy-briefing

Twice-daily business briefing pushed to ntfy (Sales, Candela POS, Manager, STR, Inventory + alerts).
Source of truth is this folder; the version running in production is **v20** (project `wetbugzzchkghpzmowod`).

## Schedule
`pg_cron` + `pg_net` call the function with an `x-cron-secret` header:

| Job | Time (PKT) |
|---|---|
| `briefing-ntfy-11am-pkt` | 11:00 |
| `briefing-ntfy-11pm-pkt` | 23:00 |

`verify_jwt` is **off** (pinned in `supabase/config.toml`); access is protected by the secret header.

## Secrets (Edge Function secrets, never in git)
`CRON_SECRET`, `NTFY_TOPIC` (required) · `NTFY_SERVER`, `NTFY_TOKEN`, `CLICK_URL`, `INVENTORY_URL`, `INVENTORY_KEY`, `GROQ_API_KEY`, `GROQ_MODEL` (optional).

> The cron jobs store the secret in their command text, which is normal for pg_cron but means anyone who can
> read `cron.job` can read it. To rotate: set a new `CRON_SECRET` secret, then
> `select cron.alter_job(<jobid>, command := '<same command with the new header value>')` for both jobs.

## Test without sending anything
Call the function with `?dry=1` (same header). It returns the exact messages and their byte sizes.

## What "Sale" means
**v20 (2026-10-05):** a day's sale is its **TOTAL** (the official figure), the same number the app, the dashboard
targets and the AI assistant use. Before v20 the push used `COMP SALE` (falling back to TOTAL), so the push and the
app disagreed on individual days (e.g. 1 Oct: 664,301 vs 648,239).

## Alert rules (shared with the in-app briefing, `js/agent/tools/briefing.js`)
- cash `DIFF` of Rs 10,000 or more on the latest entered day
- latest sale 30% or more below the same weekday last week
- projected month below 90% of target (from day 10 only)
- an incoming STR not received for 3+ days

## Deploy
```bash
supabase functions deploy send-daily-ntfy-briefing --project-ref wetbugzzchkghpzmowod --no-verify-jwt
```
Deploy all files in the folder (`index.ts`, `summary-calc.js`, `credit-alerts.js`, `manager-intelligence.ts`).

## Manager intelligence (added after v20)
`manager-intelligence.ts` adds read-only blocks to the detail messages and alerts to the alert message. It runs after the five main sections and can never break the briefing (any failure just omits its blocks):

- **Money at risk · stockouts**: selling items with zero stock, ranked by estimated 7-day lost sales (alert when the total is Rs 10,000 or more).
- **STR mismatches**: dispatched vs received quantity differences.
- **Cash reconciliation**: DIFF, cash-to-deposit gap (alert at Rs 1,000+), JazzCash app vs ledger gap (alert at Rs 1,000+), cheque-related ledger entries 30+ days old. The cash DIFF >= Rs 10,000 alert is raised by the Sales section, not repeated here.
- **Trends**: 7-day and 30-day sales/day and average absolute DIFF (from the 30 most recently updated `bt_daily` rows).

It uses the function's existing service-role `rest()` and the Audit Hub `auditRest()` helpers; no new secrets, tables or schedules. Check it with `?dry=1` after deploying.
