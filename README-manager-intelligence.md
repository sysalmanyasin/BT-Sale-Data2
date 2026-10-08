# BT Sale Data — first 10 improvements

This patch is an **overlay**, not a replacement architecture. It reuses the existing BT Agent, tool registry, telemetry, AI Center, Supabase tables and twice-daily ntfy Edge Function.

## Apply

```bash
git apply bt-sale-data-first10.patch
node scripts/apply-manager-intelligence.mjs
npm test
```

Then apply the migration using the project's normal Supabase migration workflow and deploy **only** the existing `send-daily-ntfy-briefing` Edge Function.

The installer is idempotent and fails instead of guessing if an expected source anchor has changed.

## First 10 covered

1. Money-ranked inventory — top 10 estimated 7-day lost-sales opportunities.
2. Background alerts — critical manager findings flow through the existing ntfy briefing.
3. STR mismatch — dispatched vs received quantity detection with schema-tolerant receive-field lookup.
4. Cash reconciliation — DIFF, cash-to-deposit gap, JazzCash app/ledger gap, cheque ageing.
5. Finding actions — reviewed, snooze 7 days, resolve; reorder action only prepares a BT request and does not change inventory.
6. Better mission/finding presentation — evidence, recommendation and manager action surface remain in the existing AI Center.
7. 7/30-day trends — deterministic sales/day and cash-DIFF trend metrics.
8. Data freshness — findings show source timestamp where one exists.
9. Agent reliability — latest real audit error is surfaced in Agent health.
10. Rule-based fallback — existing instant path first, then deterministic `daily_briefing` if the model call fails.

No financial/inventory write path is added. Existing approval, audit, VERIFY, undo, write-lock and kill-switch mechanisms remain authoritative.