# Verifying AI Center numbers against the real app (prompt section 50, "Data")

The Center copies numbers from existing tools; it does no maths of its own. Compare each number below with the page named. A difference means a bug in either the tool or the page: report it with both values.

Do this on a **real, loaded app** (open Dashboard, Inventory, STR and Closing once so their data is loaded, then open the AI Center and press Refresh).

| Center shows | Source tool | Compare with |
|---|---|---|
| SALES: Latest entry (date, Rs) | `daily_briefing` | Daily Sales page, newest row, TOTAL |
| SALES / Forecast: Target done %, needed/day, actual/day | `get_target_pace` | Dashboard target card (same function: `Analytics.getTargetPaceForMonth`) |
| Forecast: briefing projection | `daily_briefing.target` | Should agree with the Dashboard projection; a "disagree" note means they differ on whether the target is met |
| CASH: DIFF, Cash sale, Bank total | `get_daily_sales` for the latest date | Daily Sales row for that date |
| INVENTORY: out of stock but selling, run out in 7 days, not sold 90d+ | `daily_briefing.inventory` | Inventory Health page counts |
| INVENTORY deeper views | `low_cover_items`, `slow_moving_stock`, `low_stock_items` | Inventory pages (same product list) |
| STAFF: carried-over credit, duplicates | `daily_briefing.credit` | Manager dashboard, staff credit for the month |
| STR: awaited, dispatched not received, received, oldest open | `str_overview` | STR Report summary |
| CLOSING: shifts closed today, incomplete days | `closing_recent_days` | Closing Book |
| Freshness labels | bridge sync stamps | Inventory/STR "last synced" |

Pass condition: every pair equal (rounding to the nearest Rs). Record: date, Center value, page value, screenshot of both for any mismatch.

Automated parity already covered by tests: briefing projection = `Analytics.getTargetPaceForMonth`; every verifier re-reads the same store the tool wrote.
