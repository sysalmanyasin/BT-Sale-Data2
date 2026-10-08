# BT Sale Data — second 10 manager-intelligence improvements

This patch is designed to be applied **after** `bt-sale-data-first10.patch` and its installer.
It extends the same Agent, finding lifecycle, telemetry, Supabase data, approval/verification path and ntfy function.

## Improvements 11–20

11. Money-ranked opportunities
12. Evidence-first answer bundles
13. Deterministic sales anomaly signals
14. Staff/credit action signals
15. 7/30-day demand forecast
16. Read-only smart reorder recommendations
17. Richer daily manager briefing blocks
18. Verification summary from existing telemetry
19. Finding-review learning summary from existing lifecycle actions
20. Manager-facing opportunity/evidence/learning/verification model

## Apply

```bash
git apply bt-sale-data-second10.patch
node scripts/apply-manager-intelligence-v2.mjs
npm test
```

Then run the normal Supabase migration workflow and deploy the **existing** `send-daily-ntfy-briefing` function.

No new scheduler, AI provider, notification service, write path, approval system, or business-data table is introduced.