# Android Widget UX Roadmap — Clean Premium Minimal

## Purpose

Improve the visual hierarchy, clarity, and daily usefulness of the native Android widget app without changing business calculations, Supabase access rules, transaction semantics, or authentication behavior.

This is a design proposal, not a claim that these UI changes have already been implemented.

## What exists today

The `android-widget` module is a native Kotlin app built around `AppWidgetProvider` and `RemoteViews`. It includes 22 documented home-screen widgets across closing/sales, credit, inventory, and STR workflows, plus inventory search and the Quick Add / Ask Dua assistant. The launcher screen currently offers three primary actions: refresh all widgets, open Quick Add / Ask Dua, and search inventory. The launcher and assistant retain some futuristic dark/neon styling.

## Recommended visual direction

- **Quiet, premium surfaces:** warm white / soft neutral background, subtle borders, restrained shadows, and a single brand accent (deep teal or indigo). Keep strong semantic colors only for warnings and exceptions.
- **Typographic hierarchy:** large figures for primary KPIs; concise labels; smaller muted metadata for dates, shifts, source, and freshness.
- **Consistent spacing:** an 8dp spacing rhythm, predictable internal padding, aligned card edges, and consistent icon sizing.
- **Meaningful color:** green for positive/healthy, amber for attention, red for negative/urgent, neutral for ordinary values. Always include labels or symbols so color is not the only signal.
- **Adaptive light/dark appearance:** respect system theme and dynamic color where practical. Avoid hard-coded neon as the default.
- **Glanceable first:** show the one number or action that matters most at small sizes; reveal supporting breakdowns and lists as widgets grow.
- **Subtle feedback:** native ripple/touch feedback, visible loading/error/freshness states, and no decorative animation that wastes attention or battery.

## High-value ideas

### 1. Turn the launcher into a useful control center

Replace the current centered title + three-button card with a practical dashboard:

- A compact header: **BT Sales** and a short “Business at a glance” subtitle.
- Three clear action tiles: **Ask Dua**, **Quick Add**, and **Search inventory**. Ask Dua and Quick Add can still open the existing `AssistantActivity`; use launch extras only where the current implementation already supports them.
- A refresh row with last refresh status, progress feedback, and an accessible retry action. Do not report “refreshed” until work actually completes.
- Small grouped shortcuts for **Sales & closing**, **Credit**, **Inventory**, and **STR transfers**, with links to the existing relevant screens/widgets where available. Do not invent detail screens just for the visual.
- A concise setup hint explaining how to add a home-screen widget, shown as secondary help rather than the main content.

### 2. Give the 22 widgets a shared design system

Create reusable color, spacing, text-size, and state conventions for XML/RemoteViews layouts, then migrate widgets incrementally.

Suggested widget anatomy:
1. Small domain label and optional refresh affordance.
2. Primary value or top actionable item.
3. One compact secondary comparison or breakdown.
4. A tiny freshness/source line where helpful.

Use the platform-provided widget corner treatment instead of drawing heavily rounded cards inside the widget. Keep touch targets comfortable and avoid layouts that clip at different launcher grid sizes.

### 3. Make size changes meaningful

For each widget, define small, medium, and large behavior rather than simply shrinking the same content:

- **Small:** headline number, status, and one tap target.
- **Medium:** headline plus 2–3 supporting metrics or the top few list rows.
- **Large:** richer breakdown or scrollable list, with clear row separators.

Prioritize the most-used widgets first: Today's Sale, Sales & Target Pace, Closing Summary, Total Outstanding Credit, Inventory Health, Reorder Now, and inbound STRs. Preserve list-service patterns for unbounded collections such as inbound STRs and inventory rankings.

### 4. Make stale, loading, and failed data obvious

Add a consistent, lightweight status treatment where the existing data flow permits it:

- **Updated recently:** “Updated 10:42”
- **Refreshing:** short progress state
- **Couldn’t refresh:** keep the last successful value visible when safe, mark it as stale, and make retry available
- **No data:** explain the reason if known, otherwise say “No data available”

Do not display old cached figures as though they were live. Keep the 30-minute widget refresh policy and Android background-work constraints in mind.

### 5. Make Ask Dua feel like a calm assistant

Keep the assistant useful, not theatrical:

- Use a clear conversation surface with readable question/answer hierarchy.
- Offer one-tap suggested questions grounded in existing read-only capabilities, such as today’s sales, the latest closing, urgent reorder items, and outstanding credit.
- Show a discreet “Read-only answer” label for assistant queries, distinct from Quick Add’s transaction-writing flow.
- Keep the answer and current question easy to scan; provide a clear retry/error state.
- For Quick Add, group fields into short sections, reveal only relevant fields for the selected transaction type, and keep the submit action visible.
- Preserve Google OAuth PKCE, the authorized-user check, the `android-assistant` Edge Function boundary, and the client UUID retry/idempotency behavior. Never place privileged credentials or arbitrary SQL/RPC execution in the Android client.

### 6. Improve transaction-entry confidence

For Quick Add:
- Use explicit field labels and numeric keyboard types for amounts.
- Make date, shift, category/section, and staff selection easy to review before submission.
- Distinguish **Credit** and **Deduction** with text as well as color.
- Show a review/confirmation summary before a write when it can be added without changing the existing backend contract.
- Disable duplicate taps while a submission is pending; preserve the same request UUID across retries until the server confirms success.
- Clearly separate “saved” from “pending” and “failed”.

### 7. Make inventory and STR widgets action-oriented

- **Reorder Now:** lead with the most urgent item and days-of-cover context; keep the threshold definition visible in the detailed view.
- **Negative Stock / Excess Stock:** emphasize value at risk and rank rows by the existing repository logic.
- **Inventory Health:** use a simple segmented summary for never-sold, dead, and excess stock, with readable labels.
- **STR:** use clear Awaited / Dispatched / Received language, branch direction, and age/overdue cues; never infer a stage that the source fields do not support.
- Keep all existing calculations as the source of truth. This roadmap proposes presentation changes, not changes to the Kotlin ports of the web app's formulas.

## Suggested delivery plan

### Phase 1 — Safe visual foundation
- Document shared colors, typography, spacing, icon, and status conventions.
- Redesign the launcher layout only.
- Improve refresh feedback without changing which providers are refreshed.
- Add screenshots/previews and basic accessibility checks.

### Phase 2 — Highest-value widgets
- Apply the shared visual conventions to Today's Sale, Sales & Target Pace, Closing Summary, Total Credit, and Inventory Health.
- Add small/medium/large content strategies and validate clipping on multiple launchers.
- Keep repository output and calculations untouched.

### Phase 3 — Assistant and Quick Add polish
- Simplify Ask Dua visual hierarchy and suggested prompts.
- Improve field grouping, pending/error/success states, and duplicate-submit prevention while retaining current API contracts.
- Verify sign-in, authorized-user rejection, read-only Ask Dua behavior, and write idempotency.

### Phase 4 — Remaining widgets
- Migrate the other credit, inventory list, and STR widgets.
- Add widget previews/descriptions and system-theme support where compatible with the current RemoteViews implementation.
- Consider Jetpack Glance only as a separate, measured migration—not a prerequisite for a visual refresh.

## Non-negotiable safety and correctness constraints

- Do not change sales, closing, credit, inventory, or STR calculations as part of a visual redesign.
- Keep the widget-service account read-only and preserve existing Row Level Security policies.
- Keep Google sign-in, PKCE, encrypted token storage, and authorized-user checks intact.
- Keep Ask Dua read-only; transaction writes must continue through the authenticated Edge Function and existing inbox/idempotency design.
- Do not add service-role keys, refresh tokens, or other credentials to source code or widget layouts.
- Never use fake demo numbers in production widgets.
- Preserve the current widget refresh interval unless a separate performance review justifies a change.

## Acceptance checklist

- [ ] Existing widget IDs and provider registrations remain intact.
- [ ] All 22 documented widgets still install, refresh, and render.
- [ ] Small and large widget sizes avoid clipped text and inaccessible touch targets.
- [ ] Loading, stale, empty, and failure states are distinguishable.
- [ ] Launcher refresh calls the same providers as before and communicates completion truthfully.
- [ ] Sales/closing/credit/inventory/STR calculations are unchanged.
- [ ] Ask Dua remains read-only and authenticated; Quick Add writes remain authorized and idempotent.
- [ ] Light/dark/system-theme behavior is checked on at least one Android 12+ device and one additional launcher/device configuration.
- [ ] Build and smoke tests pass before merging.

## Design references

- [Android app widget overview](https://developer.android.com/develop/ui/views/appwidgets/overview)
- [Flexible widget layouts](https://developer.android.com/develop/ui/views/appwidgets/layouts)
- [Widget styling guidance](https://developer.android.google.cn/design/ui/mobile/guides/widgets/style)
- [Android widget quality tiers](https://android-developers.googleblog.com/2025/03/introducing-widget-quality-tiers.html)
