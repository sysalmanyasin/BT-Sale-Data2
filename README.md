# 🏥 Bahria Town Sales Intelligence Centre

<p align="center">
  <strong>A pharmacy operations platform for sales, inventory, staff, reporting, and AI-assisted insights.</strong>
</p>

<p align="center">
  <a href="https://bt.duapharma.com"><img src="https://img.shields.io/badge/Live_App-bt.duapharma.com-198754?style=for-the-badge" alt="Live app"></a>
  <img src="https://img.shields.io/badge/Platform-PWA-6f42c1?style=for-the-badge" alt="Platform: PWA">
  <img src="https://img.shields.io/badge/Frontend-Vanilla_JS-f7df1e?style=for-the-badge" alt="Frontend: Vanilla JavaScript">
  <img src="https://img.shields.io/badge/Backend-Supabase-3ecf8e?style=for-the-badge" alt="Backend: Supabase">
  <img src="https://img.shields.io/badge/Android-Kotlin-7f52ff?style=for-the-badge" alt="Android: Kotlin">
</p>

<p align="center">
  <a href="https://github.com/sysalmanyasin/BT-Sale-Data2/actions/workflows/test.yml"><img src="https://github.com/sysalmanyasin/BT-Sale-Data2/actions/workflows/test.yml/badge.svg?branch=main" alt="GitHub Actions tests"></a>
  <img src="https://img.shields.io/badge/AI-BT_Intelligence-0b5fff?style=flat-square" alt="BT Intelligence">
  <img src="https://img.shields.io/badge/Architecture-Single--pharmacy-orange?style=flat-square" alt="Single pharmacy architecture">
</p>

**BT Sales IC** is a personal, single-user pharmacy operations Progressive Web App (PWA) built for Bahria Town. It brings daily sales capture, reporting, management tools, inventory intelligence, closing and audit views, attendance, emergency billing, spreadsheets, PDF archiving, cross-device sync, **BT Intelligence**, and native Android companions into one operational workspace.

> [!IMPORTANT]
> **Designed for one pharmacy and one primary operator.** This project is not a multi-tenant SaaS platform.
>
> **Documentation rule:** this README is a guide to the current codebase. If it conflicts with the implementation or database schema, the code and schema take precedence.

| Project detail | Value |
|---|---|
| **Live application** | [bt.duapharma.com](https://bt.duapharma.com) |
| **Default branch** | `main` |
| **Web deployment** | GitHub Pages with a custom domain (`CNAME`) |
| **Primary backend** | Supabase |
| **Web release build** | `npm run build` — stamps asset versions and updates PWA cache metadata; no bundling/minification |

---

## 🧭 Table of contents

- [At a glance](#at-a-glance)
- [Quick start](#quick-start)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Module index](docs/module-index.md)
- [Architecture](#architecture)
- [Features](#features)
- [Android apps](#android-apps)
- [Definitions and conventions](#definitions-and-conventions)
- [BT Intelligence (AI Center)](#bt-intelligence-ai-center)
- [AI systems](#ai-systems)
- [Authentication & security](#authentication--security)
- [Testing](#testing)
- [Deployment & PWA versioning](#deployment--pwa-versioning)
- [Known limitations](#known-limitations)
- [Development rules](#development-rules)
- [Philosophy](#philosophy)

---

## At a glance

| Area | What it provides |
|---|---|
| 📊 **Sales** | Dashboard, daily entry, history index, reports, payments, DIFF/reconciliation, cash-deposit report |
| 👔 **Manager** | Staff Registry & notes, Ledger, Targets, Salary, Petty, Credit, Incentive, Overview, Payslip, Attendance |
| 🧾 **Emergency Billing** | Break-glass counter billing: cart, held bills, receipts, history, validated refunds |
| 📦 **Inventory** | BT Inventory, Stock Ledger, Excess Working, Reorder Report, Inventory Health |
| 🚚 **STR** | Awaited / Dispatched / Received workflow, flattened report, Zero Dispatch |
| 📖 **Closing** | Native read-only Closing Book and Credit Ledger |
| 🔍 **Audit** | Read-only Assignments view + link to the external Pharmacy Audit Hub |
| 📑 **Notes & Sheets** | Multi-file workbooks with live-data materialisation |
| 🛠️ **Utilities** | Sync Center, PDF Library, Activity Log, global search, settings |
| 📰 **Herald** | Deterministic daily operational headlines (no generative AI) |
| 🛰 **BT Intelligence** | The AI Center: Command Deck (Overview / Sales & Forecast / Inventory / Operations / Audit / More), talking Dua assistant with the one docked chat, approval-gated changes, AI Forecast Game, Audit & Variance, Near Expiry, Payments, agent health and activity |
| 🔎 **Inventory Search** | Standalone companion PWA with medicine reference + AI chat |
| 📱 **Android** | 22 home-screen widgets + native attendance/geofence app |
| 🔄 **Backup & Sync** | Supabase multi-device sync + independent Google Drive backup |

---

## Quick start

The web app is served as static files from the repository root. Node.js 22 is the version used by CI; use a compatible Node.js release and npm.

### Prerequisites

- Git
- Node.js 22 (recommended; used by GitHub Actions)
- npm
- A modern browser

### Install and verify

```bash
git clone https://github.com/sysalmanyasin/BT-Sale-Data2.git
cd BT-Sale-Data2

# Install the exact dependency versions from the lockfile
npm ci

# Run the automated test suite
npm test

# Verify release stamps and PWA cache metadata without changing files
npm run build:check
```

### Run locally

```bash
# Any static server can serve the repository root
npx serve .
# or
python3 -m http.server 8080
```

Open the local URL printed by your server. Service workers require `localhost` or HTTPS.

**Configuration notes**

- Sign-in uses Google Sign-In and Supabase. A fully working local instance needs your own Supabase project and Google client configuration; the automated test suite does **not** need either.
- Before shipping changes to files included in the PWA, run `npm run build`. It stamps local script/stylesheet URLs and updates the service-worker cache version and `build-manifest.json`; it does not bundle or minify the app. Then run `npm run build:check` and `npm test`.
- Android apps build through GitHub Actions (see [Android apps](#android-apps)).

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JavaScript (ES modules plus legacy `<script>` modules mid-migration), HTML/CSS; static delivery with a release-stamping build script (no bundling/minification) |
| **AI** | `bt-agent` Edge Function over a free-provider pool (Groq, Cerebras, Gemini, OpenRouter) with fail-over; browser-driven tool loop; pgvector knowledge index; Web Speech API for voice (browser-native, nothing recorded by BT) |
| **Backend** | Supabase: PostgreSQL, Auth, Storage, Edge Functions, REST, RPCs for transaction-sensitive work (e.g. refunds) |
| **PWA** | `manifest.json`, root `sw.js`, offline app shell, update detection, safe reload |
| **Libraries** | Chart.js, jsPDF, jsPDF-AutoTable, html2canvas, XLSX, qrcode-generator |
| **Android** | Kotlin, Gradle, native widgets, geofencing |
| **Testing** | Node built-in test runner, jsdom |
| **CI** | GitHub Actions: tests (`test.yml`), Supabase deploy (`supabase-deploy.yml`), advisory live agent eval (`agent-live-eval.yml`), APK builds (widget + attendance) |

---

## Repository structure

```text
/
├── index.html                  # App shell
├── manifest.json, sw.js        # PWA manifest and service worker
├── CNAME                       # Custom domain
├── package.json                # Test scripts (only dev dependency: jsdom)
│
├── js/                         # Application modules (see docs/module-index.md)
│   ├── shared/                 # Shared, reusable business calculations
│   │   ├── summary-calc.js     # Sales/closing and inventory summary calculations
│   │   ├── inventory-metrics.js # Shared slow-moving-stock definitions
│   │   ├── planning-metrics.js # Forecast, reorder and operational metrics
│   │   ├── today-forecast.js   # Pure daily-sale forecast and scoring logic
│   │   ├── credit-alerts.js    # Duplicate, aged and unrolled credit alerts
│   │   └── agent-shared.js     # Redaction, chunking and knowledge-index helpers
│   ├── herald/                 # Deterministic operational headlines
│   ├── nav-sections.js         # Navigation tree and All Sections drawer
│   ├── global-search.js        # Search sections and Staff Registry
│   ├── boot-guard.js           # Guard against script dependency-order failures
│   ├── daily-checklist.js      # Daily Check List page and date-specific drafts
│   ├── record-day.js           # Reacts to new daily-sales records
│   ├── agent/                  # Assistant: core/ (routing, approvals, audit, undo), tools/, ui/
│   ├── ai-center/              # BT Intelligence interface and forecast game
│   ├── emergency-billing-native.js
│   └── emergency-billing-bridge.js
├── css/                        # Per-domain stylesheets (ai-center*.css for BT Intelligence)
├── icons/
├── docs/                       # Module index, AI Center architecture, KPI verification, final report
├── scripts/                    # build.mjs, build-repo-index.mjs, agent-live-eval.mjs
│
├── inventory-search/           # Standalone Inventory Search PWA
├── android-widget/             # 22 home-screen widgets (Kotlin)
├── android-attendance/         # Native attendance / geofencing app (Kotlin)
│
├── supabase/
│   ├── audit-project/          # ai_audit_overview.sql (runs on the Audit Hub project, NOT in migrations/)
│   ├── functions/              # bt-agent, send-daily-ntfy-briefing, closing-ntfy-notify, set-staff-login, google-drive, inventory-chat, medicine-ai-info (+ legacy send-daily-whatsapp-briefing, not deployed)
│   ├── migrations/             # Dated SQL migrations
│   ├── pdf_library/            # Schema + deploy notes
│   └── activity_log/           # Schema
│
├── tests/                      # static/, unit/, dom/, eval/, helpers/
└── .github/workflows/          # test, supabase-deploy, agent-live-eval, build-widget-apk, build-attendance-apk
```

---

## Architecture

### Layered data flow

```text
User → Action → Repository → Data / State → EventBus → Pages / Components
```

| Layer | Responsibility |
|---|---|
| **Actions** | Primary mutation boundary. Business-data writes normally go through here. |
| **Repository** | Business-data storage boundary. |
| **State** | In-memory working data. |
| **EventBus** | Broadcasts meaningful changes: UI refresh, activity logging, cache invalidation, cross-module reactions. |
| **Components** | Reusable UI and utilities. |
| **Pages** | Domain-specific rendering. They should not bypass the data layers. |

> **Deliberate exception: Emergency Billing.** It uses its own device-local cart/held-bill storage and its own database RPCs for checkout and refunds. Do not fold it into the generalized pipeline without accounting for the inventory bridge, refund RPC, local storage, and reconciliation requirements.

### Navigation

- One unified **Search & All Sections** panel, generated from `js/nav-sections.js`.
- Desktop: **☰ Menu**. Mobile: bottom nav → **☰ Menu**. Long-press Cover also opens it.
- Nested groups, fuzzy search (including Staff Registry), URL-hash routing, back-button support.

### Storage

- **Core business data** goes through `Repository`.
- **Intentionally local data** stays in browser storage: auth bootstrap state, UI/theme preferences, Drive token cache, bridge caches, Inventory and STR preferences, Emergency Billing cart, held bills and settings. Do not treat these as business-data migration candidates.

### ES-module migration

The migration is incremental, so some `window.*` bridges remain. Do not remove one just because a module export exists (see [Development rules](#development-rules)).

---

## Features

### Cover & Herald

**Cover** is the operational hub: domain cards (reorderable), cross-domain signals, inventory/sales/manager/audit indicators, Herald headlines, and shortcuts to companion apps.

**IC Herald** (`js/herald/`) generates daily headlines from Sales, Manager, Inventory, Closing, and Audit data. It is **deterministic business rules, not generative AI**.

### Sales

| Feature | Notes |
|---|---|
| **Dashboard** | Daily sales, period comparisons, MTD/YTD, target pace, staff signals, alerts, forecasts. A renderer over the analytics layer, not a separate data source. |
| **Sale Data** | Index (Year → Month → Day), Daily Data, Add Entry |
| **Sale Report** | Standard reporting and analysis |
| **Payments** | Cash, Card, Credit, credit-customer detail |
| **DIFF** | Reconciliation and difference analysis |
| **Cash Deposit** | Calculation and reporting |

**Add Entry prefill** (`entry-prefill.js`) pulls from Closing Sheets (Cash Sale, Bank Alfalah, Bank Alfalah 2, Cash Returns) and the Sale Payments bridge (Total Sale, COMP SALE, matching credit customers). Prefilled and manually entered values are tracked separately, so changing the date never overwrites manual input.

**Sale Payments bridge** is a read-only view of the separate *Candela POS → Dropbox → Supabase* pipeline. It is not the PWA's source of truth.

### Daily Check List

The native **Daily Check List** page sits beside **Sale Report** in the Sales sub-navigation. It brings the branch's daily operational checklist into the PWA rather than relying on the former external page.

- **Checklist workflow:** section-based checklist, completion progress, navigation to the next incomplete section, and per-day draft saving.
- **Editable dropdowns:** items **25, 29A, 29B and 29C** use option lists that can be edited and reset to defaults. Custom option lists are saved on the current device.
- **Sales prefill:** pulls the selected date's sales figures from the app and uses the Sale Report's `dayData()` calculation when available, including custom fields such as **Bank Alfalah 2**. Prefill fills eligible fields without overwriting manual edits.
- **Stock prefill:** yesterday's received-stock value is sourced from STR data; today's opening/closing stock and negative-value figures use available inventory totals where supported. Historical closing-stock values must be entered manually.
- **Output:** copy, print and email-friendly report actions.
- **Local draft storage:** checklist drafts use `bt_daily_checklist_v1`; editable dropdown options use a separate device-local key. These are UI-local drafts/settings, not a synced business-data source.

**Files:** `js/daily-checklist.js` and `css/daily-checklist.css`.

### Emergency Billing

A break-glass counter-billing system, separate from Daily Sale Entry. It is a supplement, not a replacement: emergency transactions still need reconciliation against normal sales entry.

**Files:** `js/emergency-billing-native.js`, `js/emergency-billing-bridge.js`, `css/emergency-billing.css`, and the three `supabase/migrations/2026092*_emergency_billing*.sql` migrations.

- **Cart:** search by name, generic or code. Live availability comes from the read-only inventory bridge. If availability can't be verified, adding to cart is **blocked**.
- **Quantity editing:** +/− buttons or direct entry. `F9` quick-edit: Enter opens the field with the value selected, a digit starts typing, Enter commits, Escape reverts.
- **Discounts:** flat (Rs.) or percentage (1–5% presets). Either resolves to a single rupee amount before reaching receipt, checkout RPC or held-bill storage.
- **Held bills:** stored in `localStorage` (`eb_active_cart_v1`, `eb_held_bills_v1`). Convenience state only; clearing storage loses them. Discounts are always frozen as flat rupees.
- **Checkout & receipts:** written via the Emergency Billing DB layer. 58 mm and 80 mm thermal formats, configurable header/footer, optional round-to-nearest-rupee.
- **History:** filters (Today / Yesterday / 7 days / Month / All, invoice, product, payment, staff), read-only detail, XLSX export. Reprints keep the original timestamp.
- **Refunds:** validated in a database RPC (`record_emergency_refund()`): confirms invoice and line exist, rejects non-positive quantities, deducts previous refunds, rejects over-refunds, restores stock against the current inventory-bridge sync context.
- **Settings (device-local):** branch/business identity, receipt format, default payment, low-stock threshold, staff-name requirement, auto-print, confirm-before-clear.

### Manager

| Module | Notes |
|---|---|
| **Staff Registry** | Staff CRUD, identity, timestamped notes. Source of truth for staff identity across modules. |
| **Targets** | Feeds target pace, comparisons, and staff performance views |
| **Ledger** | Date/range filters, category grouping, custom sections, JazzCash records, inline editing |
| **Petty Cash** | Deliberate legacy implementation in `manager-petty.js`, not rendered through `ledger-store.js` |
| **Salary / Payslip** | Kept separate from ledger presentation. Attendance is **not** wired to automatic deductions. |
| **Credit / Incentive** | Reporting and calculations; credit also surfaces in dashboard and closing views |

#### Attendance

Web management (`js/manager-attendance.js`) plus a native Android app.

- **Tabs:** Today (including visible absences), Monthly (present/absent/late), Raw Log, Manual Entry, Location (geofence), Notifications, iPhone Setup.
- **Late detection** is optional and only applies to staff with an explicit `shiftStart`, with a 5-minute grace period. Schedules are never guessed.

### Inventory

Built for large pharmacy datasets.

- **BT Inventory:** search, manufacturer/supplier grouping, pagination, 100-row views, column picker. Read-only from the Pharmacy Audit Hub dataset.
- **Stock Ledger:** panels for Never Sold, Dead Stock, Excess, Pack Issues, Zero Stock. Each keeps its own search/filter/sort state.
- **Excess Working:** configurable logic (default **90+ days of cover**), Working and Retain lists, adjustments, reported-HO-value variance, Top-N Excel export.
- **Reorder Report:** Top N or all; 30/60/90-day sales windows; cover-days threshold; optional live today's sales; supplier grouping; print/export. Inbound STR quantities count as **In Transit**.
- **Inventory Health:** classification, movers and trend charts, supplier breakdown, KPI cards, searchable table.
- **Alerts:** low-cover-value, excess-item and dead-stock aggregates can appear on Cover without opening Inventory.

### STR

A standalone top-level domain. Data is read-only, from the Pharmacy Audit Hub Supabase project.

- **List / Detail:** dispatch/receive direction, Awaited / Dispatched / Received, date filters, supplier grouping, detail modal with Previous/Next, printing. Lifecycle is derived from dispatch/receive state, not only the raw `str_status`.
- **Report:** flattened *Dispatch Branch → STR → Comments → Supplier → Line Items*, same filter engine, column picker, print.
- **Zero Dispatch:** line items where STR Qty > 0 and Dispatch Qty = 0, with selectable blocks for printing.
- **Quantities** are shown as pack quantities using `conversion_factor` with the same floor rounding as Inventory (falls back to `1` when no reliable factor exists).

### Closing & Audit

- **Closing Book** and **Credit Ledger** (Credit, Misc/Ongoing): native, deliberately read-only. The standalone Closing app lives outside this repo.
- **Audit:** read-only Assignments view over shared Audit Hub data, plus a link to the external Pharmacy Audit Hub.

### Notes & Sheets

Multiple files and sheets, editable grid, notes, sheet management, import/export, and a **Data** tab that materialises live app data into editable sheets.

### Platform utilities

- **Sync Center:** single-active-device model to reduce edit conflicts. Tabs: Session, Devices, Controls, Health, Logs, Settings. Conflict UI is isolated in `conflict-ui.js`.
- **Backup:** *Supabase Sync* (cross-device) and *Google Drive* (independent backup) are separate mechanisms.
- **PDF Library:** generated PDFs are viewable, downloadable and retrievable across devices via Supabase Storage. An expiry sweep runs on unlock.
- **Activity Log:** cross-device change feed (time, section, add/edit/delete), fed by the EventBus so pages don't log individually.
- **Global search:** fuzzy search over navigation sections and Staff Registry.

---

## Android apps

Two native Kotlin projects, each with its own Gradle setup and GitHub Actions workflow.

### `android-widget/`: 22 home-screen widgets

Covers Closing, Sales & Target Pace, Aggregated Final Closing, Month totals, live POS sale, recent shifts, Credit, ledger aging, Inventory Health, Reorder, Excess, Top-running, Negative / Dead / Never-sold stock, product search shortcut, and STR Awaited / Dispatched / Inbound.

Widgets mirror key web calculations so they work without the PWA open. See [`android-widget/README.md`](android-widget/README.md).

### `android-attendance/`: geofencing app

- **Staff mode:** geofence ENTER → check-in, EXIT → check-out; QR manual fallback; device registration; background operation; re-registration after reboot; mock-location flag; boundary-flap debounce; offline queue with automatic retry.
- **Manager mode:** receives attendance notifications without taking part in geofencing.
- **Location** comes from the active row in `attendance_locations`, cached for reboot/network resilience.

See [`android-attendance/README.md`](android-attendance/README.md).

> The former `android-app/` Trusted Web Activity wrapper has been removed.

---

## Definitions and conventions

- **Official sale = `TOTAL`.** `COMP SALE` is a comparison figure and `DIFF = TOTAL − COMP SALE`. The dashboard, targets, the daily push briefing and the AI assistant all use `TOTAL`.
- **This repository is public.** Never commit secrets, ntfy topic names (on ntfy.sh a topic name works like a password), cron/shared secrets or service keys. Supabase publishable/anon keys are fine. `tests/static/ntfy-functions.test.js` scans `supabase/functions/` for leaked topics and secrets.
- **Supabase Edge Functions** are pinned in `supabase/config.toml` (`verify_jwt` per function) and documented in each function's `DEPLOY.md`. Secrets live only in Supabase.

---

## BT Intelligence (AI Center)

Route `#ai-center` (nav label **BT Intelligence** 🛰). A control room over the existing assistant: it owns **no business logic, no second data layer and no write path of its own**. Every number is copied from an existing read tool, bridge or the agent's own telemetry; a missing source shows as unknown, never as an invented value. Architecture map: [`docs/ai-center-architecture.md`](docs/ai-center-architecture.md); KPI cross-check: [`docs/ai-center-kpi-verification.md`](docs/ai-center-kpi-verification.md); status: [`docs/ai-center-final-report.md`](docs/ai-center-final-report.md).

**Command Deck** (`js/ai-center/ui.js`, `deck-model.js`, `css/ai-center-*.css`) has six tabs: **Overview**, **Sales & Forecast**, **Inventory**, **Operations**, **Audit**, **More**. Same layout on phone, tablet and desktop (two-column Overview).

| Area | What it shows |
|---|---|
| **Dua (global assistant)** | **The one chat**, available on every page from a floating *Ask Dua* button (hidden on Emergency Billing). It opens as a compact panel over the page you are on (card on desktop, bottom sheet on phone) and knows which page that is, with starter questions for Sales, Inventory, Cash and Audit (`js/agent/core/page-suggestions.js`). The ⋯ menu holds history, memory + house rules, usage, voice settings, the writes lock, the kill switch and new chat. Approvals, undo and voice work as before; an approval left waiting stays waiting (amber count on the button). BT Intelligence keeps the talking Dua avatar (the chat panel has none) and has no chat of its own: its *Ask Dua* buttons open this panel. |
| **Voice** | Browser-native Web Speech API (`js/agent/ui/voice.js`). Dua speaks replies (on by default on first visit; the speaker button turns it off and the choice is remembered) and the mic feeds the same path as typing. **Voice can never approve anything**: approvals need a real user tap. |
| **Overview / Needs attention** | Prioritised findings with evidence, impact, recommendation and what-happens-if-I-act, from `daily_briefing`, `closing_recent_days`, `str_overview`, `get_target_pace` and the inventory bridge. Rule text is labelled as rules, not AI. |
| **Sales & Forecast** | Target pace and month projection (same function as the Dashboard), weekday forecast, money overview, and the **AI Forecast Game**. |
| **Inventory** | Stockout / low-cover / not-sold views, reorder drafts, STR fill rate. |
| **Operations** | Action Center (pending approvals, session undo), investigations, agent fleet and recent runs. |
| **Audit** | **Audit & Variance**, **Near Expiry** and **Payments**, read through `js/audit-bridge.js` from the Audit Hub function `ai_audit_overview()` (`supabase/audit-project/ai_audit_overview.sql`; aggregates only, no customer or auditor names) and the read-only tools `audit_overview`, `audit_expiry`, `payment_breakdown`. |
| **More** | Six business-system cards, correlations (rule-based, labelled not-proof), health (measured, else UNKNOWN), activity timeline, tool intelligence, repository index search. |

**AI Forecast Game** (`js/ai-center/forecast-game.js`, maths in `js/shared/today-forecast.js`). While the app is open, on any page, about every 90 s it reads the live POS total, records an intraday sample, **locks the AI's call for today once** (from weekday history plus a learned time-of-day pace), projects the close, and grades earlier days against their final POS total. It tracks streak, hit rate and points, and celebrates (confetti, banner, Dua speaks) when the live sale reaches the call or a finished day was called within 5%. Device-local (`bt_sales_curve_v1`, `bt_forecast_game_v1`); it writes nothing to business data. The assistant exposes it through the `todays_forecast` tool.

**Safety model.** The Center reads through `runTool(..., {allow:['read']})`; the kill switch and hard blocks still apply. `BTAgent.decide()` refuses any approval that is not a trusted user gesture, so scripts and voice cannot approve. Arguments are redacted before storage; the device history keeps an allow-list of metadata only. **Repository index** (`js/ai-center/repo-index.json`, built by `npm run index:repo`) holds names, line numbers and one-line summaries only, skips secret-bearing files, and is a snapshot that must be rebuilt after code changes.


---

## AI systems

Deterministic business logic (Dashboard, Herald, calculators) stays AI-free. AI is **additive** and never computes figures itself: it calls read-only tools that use the app's own calculators. The old Assistant/CommandHub (removed in `196bf8d`) kept provider keys in the browser; the current design does not.

| System | Where | Behaviour |
|---|---|---|
| **BT Assistant** | `js/agent/**`, `css/agent.css`, `bt-agent` Edge Function | The Dua assistant is surfaced through BT Intelligence; the ✨ entry point on other pages opens that experience. Its registered tools cover read-only analysis and approval-gated operations. Ask **"What needs my attention today?"** for a deterministic morning briefing (missing sales days, yesterday vs average, target pace, out-of-stock sellers, items running out, dead stock). **Reads** Sales, Staff (no CNIC/phone/address), Ledgers, Staff credit balances, Inventory via registered tools and can open pages. **Changes are locked by default** (🔒 in the header, device-local). Once unlocked it can propose these changes (all approval-gated): add staff credit/payment (Credit Ledger, bucketed by the entry date's month, same shape as Quick Add; warns when a new month row won't carry last month's balance), add ledger entry, add staff note, set monthly target, add a new daily-sales entry (mirrors the Entry page: returns stored negative, TOTAL/DIFF computed, month recomputed, refuses existing dates), correct one field of an existing daily-sales entry, **roll the staff Credit Ledger forward** to the next month (never overwrites a different non-zero opening balance), and save a fact to memory (`remember_fact`). After a change it refreshes dashboards and honours `bt_auto_save` (same as the app's own pages). **Deletes** (one ledger entry, staff note, credit entry or sales day per call; never staff, months or sections) are `critical`: the person must **type DELETE** on the card (enforced in `runTool`, a bare tap is rejected), the model must name the exact record it read first (id / entry number + amount / date + total, mismatches are refused), and each is undoable for the session. Every change shows an **approval card** (large amounts, duplicates, >50% edits and all daily-sales edits need a second confirming tap), is written through `Actions`/`LedgerActions`, is audited (`agent_audit`, incl. approved/rejected) and has a session **Undo**. The gate is enforced in `tool-registry.runTool` (not the prompt): locked, no-approver or rejected ⇒ `run()` never executes; max 5 proposals per request. Browser drives the tool loop; the Edge Function does one model step per call over a free-provider pool (Groq, Cerebras, Gemini, OpenRouter) with fail-over; needs a session **and** an active `bt_authorized_users` row; ledger/staff conversations never go to providers that may train on free-tier prompts. **Gaps A–E (Oct 2026):** server-side **kill switch** (⛔, all devices), **hard blocks** in code for salary finalisation, refunds and bulk deletes (`core/hard-blocks.js`), **reload-proof undo** (recipes stored in `agent_audit`, rebuilt via each tool's `makeUndo`), 📊 **usage + activity** screen, 🧠 **Memory + "how I run this pharmacy"** (owner-written only), **STR** and **Closing** read tools + specialists, an **instant path** for common one-liners with no model call (`core/instant.js`), and **duplicate / carried-over credit** alerts shared by the app and the ntfy push (`js/shared/credit-alerts.js`). `agent_schedules` exists but nothing executes it yet. **Phase 4 (Oct 2026):** **streaming** replies, saved **conversation history** (🕘, 90 days), **Emergency Billing** (read-only) and **Documents** (notes, sheets) specialists, **model-assisted routing** for clue-less questions and an **advisory model reviewer** on large changes (both fall back to the rules), a **knowledge index** with `search_knowledge` (pgvector; owner-triggered, redacted, staff notes only with a non-training embedder) and an approval-gated **remember_fact**. See `supabase/functions/bt-agent/DEPLOY.md`. |
| **BT Intelligence (AI Center)** | `js/ai-center/**`, `css/ai-center*.css`, `docs/ai-center-*.md` | The control room and talking Dua described [above](#bt-intelligence-ai-center). Read-only over the assistant; includes the Forecast Game and the Audit tab. |
| **Medicine reference** | `inventory-search/` → `medicine-ai-info` Edge Function | Groq first, Gemini fallback; results cached ~30 days; no login required. Reference-only, not clinical decision support. |
| **Inventory chat** | `inventory-search/` → `inventory-chat` Edge Function | Limited to product context supplied by the client; keeps no server-side inventory copy. |
| **Daily briefing (push)** | `supabase/functions/send-daily-ntfy-briefing/` (production **v20**) | pg_cron fires it at **11:00 and 23:00 PKT** (`briefing-ntfy-11am-pkt`, `briefing-ntfy-11pm-pkt`) with an `x-cron-secret` header and it pushes Sales / Candela POS / Manager / STR / Inventory / **Manager intelligence** (money-at-risk stockouts, STR dispatched-vs-received mismatches, cash reconciliation, 7/30-day trends; `manager-intelligence.ts`) (+ optional Groq insight) to ntfy in byte-safe chunks plus an alert message. **The sale is the day's `TOTAL`** (the official figure, same as the app and the AI assistant; before v20 it used `COMP SALE`). `?dry=1` returns the messages without sending. Alert rules (also used by the in-app briefing): cash DIFF ≥ Rs 10,000, sale ≥ 30% below the same weekday last week, projection < 90% of target (from day 10), incoming STR unreceived for 3+ days. See its `DEPLOY.md`. |
| **Closing alerts (push)** | `supabase/functions/closing-ntfy-notify/` | Called by the `trg_notify_admin_shift_saved_*` DB triggers when a closing shift is saved; sends the shift summary to ntfy. The repo copy has **no built-in topic** (this repository is public): it requires the `NTFY_CLOSING_TOPIC` secret and fails closed. Read its `DEPLOY.md` before deploying from git. |
| **Staff logins (Closing App)** | `supabase/functions/set-staff-login/` | "Set/Reset PIN" in the Staff Registry. **Requires a signed-in active `bt_authorized_users` session** (v21; before that it had no authentication). |
| **Drive backup** | `supabase/functions/google-drive/` | Versioned Google Drive backup/restore for Closing App data; every action needs the Admin PIN (or the auto-backup key for `backup`). Google credentials are Supabase secrets. |

**Specialists & auditor (Phase 3).** Each turn `core/specialists.js` picks a specialist (Sales, Staff & money, Inventory, or the Analyst when 2+ areas match; briefing/date/page questions get app tools only). That narrows the tool list (smaller prompts, fewer wrong picks) and the server adds a short domain briefing chosen **by id from a server-side table** (clients can't inject prompt text). `core/auditor.js` reviews every change proposal against the session (3+ changes in 10 min, the identical change repeated within 30 min, Rs 200,000+ changed in an hour) and can only add warnings / force the strong confirmation; if it crashes the card fails *safe*. **Evaluation:** `tests/eval/` holds 60+ cases (incl. Roman Urdu) with a known dataset: routing, tools offered (change tools only when unlocked), golden answers, and a coverage rule (**every tool must appear in at least one case**). It runs in `npm test`, so it also gates the Supabase deploy. `npm run eval` runs just the suite; `npm run eval:live` (needs `GROQ_API_KEY`) measures how often the real model picks the right tool first.

**Proactive in-app briefing (Phase 5).** Without any AI call (zero tokens) the app computes the same checks as the push alerts: cash DIFF of Rs 10,000+ on the latest day, a sale 30%+ below the same weekday last week, month projection under 90% of target (only from day 10), missing entry days, plus stock checks. The ✨ button shows a red badge with the number of warnings (hidden once seen, re-shown if more appear or on a new day) and opening the panel shows a **Today** card. The in-app briefing uses `TOTAL` like the rest of the app.

**One definition per metric.** "Not sold in N days" lives in `js/shared/inventory-metrics.js` and is used by the daily briefing, the `slow_moving_stock` tool, the Stock Ledger rule alert and the AI Center, so the Dashboard, the briefing and the AI Center show the same count and value. (Inventory Health's *Dead Stock* is a deliberately different metric: no sale in 60+ days and no net sales in 90 days.) The AI Center's per-source freshness uses the source's own sync time, falling back to the app's last pull time (labelled "app pull time"); a source with no signal is reported as not measured and is never counted as healthy.

Names (`js/agent/tools/_names.js`): every tool that takes a person matches by **words** ("Mian Usman" finds "Mian Muhammad Usman"), ignores stray tabs/spaces, de-duplicates identical names, asks which person when ambiguous, and credit writes reuse the existing sheet row (this month, else last month's spelling) so one person is never split across two rows.

Agent layout: `js/agent/core/` (tool registry, loop, audit, transport), `js/agent/tools/<domain>.js` (one file per domain), `js/agent/ui/` (panel). New tools are registered with a `risk` level (`read`/`ui`/`write`/`critical`). `write`/`critical` tools must supply `preview()` (validation + approval-card content) and should supply `makeUndo()`; they must write only through `Actions`/`LedgerActions`.

Provider secrets must stay server-side. Deployment notes are in each function's `DEPLOY.md`.

---

## Authentication & security

### Sign-in flow

1. User starts **Google Sign-In**.
2. Google returns an ID token.
3. The authorised-email list syncs from Supabase.
4. A client-side check gives an early UX gate.
5. The token is exchanged with Supabase via `signInWithIdToken`.
6. Supabase issues a session, so RLS-aware operations use the authenticated identity.

> The client-side email list is a fast-fail UX gate, **not** the security boundary. Server-side Supabase Auth and RLS are.

Password/PIN unlock is **disabled**. Some legacy markup and helpers remain for compatibility only.

### Attendance security

Attendance tables use the anon role with accepted RLS tradeoffs, so the public client key is **not** a full per-device authentication boundary. A manager PIN is protected server-side but is not equivalent to user authentication. For multi-branch or higher-security use, move to authenticated users, device identity, Edge-Function-controlled writes and branch-level policies.

### Secrets

This repo handles real financial and operational data. **Never commit:** Supabase service-role keys, private API keys, AI provider or WhatsApp secrets, Google private credentials, database passwords, GitHub tokens, or any other privileged credential.

Public Supabase client keys are acceptable only when protected by proper RLS. If a credential is ever pasted into a commit, issue, chat or document, treat it as compromised: revoke, rotate, reissue.

`android-attendance/shared-debug.keystore` is intentionally committed as a low-stakes shared dev/sideload key. `release.keystore` is decoded from a CI secret and must never be committed.

---

## Testing

```bash
npm ci                   # clean, lockfile-based install
npm test                 # run everything
npm run test:verbose     # spec reporter
npm run test:watch       # re-run on change
```

**Historical baseline (2026-10-12, Node 22.22.2, HEAD `c789064`):** 207 suites and 1,086 tests passed at that time. This is not a claim about the current checkout; use the live [GitHub Actions test status](https://github.com/sysalmanyasin/BT-Sale-Data2/actions/workflows/test.yml) for the latest CI result.

**Coverage:** AI agent (core, tools, writes/deletes/approvals, undo, kill switch, streaming, routing, 60+ case eval suite), AI Center (model, deck, voice, avatar, forecast game, audit tab, repo index, DOM behaviour), Edge Function and secret-leak checks, static file integrity, script references, manifest validation, service-worker shell consistency, JS syntax, pure modules, EventBus, print API surface, Staff Registry (Repository + Actions), DOM and navigation behaviour.

**Not covered** (needs real-device testing): live Supabase, real Google auth, printer hardware and thermal receipts, browser rendering, Android geofencing and background execution, OEM battery management, physical GPS. Test Attendance and Emergency Billing on real devices before release.

More detail in [`tests/README.md`](tests/README.md).

---

## Deployment & PWA versioning

- The web app deploys as static files via GitHub Pages (`.nojekyll`, `CNAME`). The service-worker cache version changes as part of the release build. Check `sw.js` and `build-manifest.json` for the current generated value rather than treating this README as the version source.
- `sw.js` defines a versioned `CACHE_NAME` with an inline changelog comment above it. Check the live value in `sw.js` rather than trusting any number in documentation.
- When shipped files change, run `npm run build`. It stamps every local script/stylesheet in `index.html` with a content-hash `?v=`, bumps `CACHE_NAME` (`bt-sales-vX.Y`) and updates `build-manifest.json`. CI runs `npm run build:check` and fails if you forgot. Nothing is bundled or minified: the app is served straight from the repo root and relies on script load order.
- A module that another module **imports** (not only ones `index.html` loads with a tag) must also be in `APP_SHELL`, or it may be missing on a first offline start. `tests/static/file-references.test.js` checks the tag-loaded files.
- Database changes ship as dated files in `supabase/migrations/`. Pushes to `main` that touch `supabase/**` run `supabase-deploy.yml` (tests first, then changed functions and new migrations; needs repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_URL`). The Audit Hub SQL in `supabase/audit-project/` is applied by hand to that other project.

---

## Known limitations

**Main PWA**
- Single pharmacy, not multi-tenant.
- ES-module migration incomplete; some `window.*` bridges remain on purpose.
- Petty Cash keeps a separate legacy implementation.
- Several integrations are read-only bridges.

**Attendance**
- Anon-role/RLS tradeoff (see [security](#attendance-security)).
- One primary pharmacy geofence; multi-branch needs redesign.
- OEM battery management can affect background geofencing.
- Not connected to Salary deductions.
- QR fallback is part of the physical security model.

**Emergency Billing**
- Break-glass only; needs separate reconciliation.
- Cart, held bills and settings are device-local.
- Availability depends on inventory-bridge freshness.
- **Anon-role RLS tradeoff (same as Attendance):** `emergency_invoices`, `emergency_invoice_items` and `emergency_stock_deltas` have `anon_all` policies (`using (true)`), so anyone holding the public client key can read/write them. Sale and refund *logic* is protected by RPCs, but the tables themselves are not an authentication boundary. Fix before relying on them beyond a single trusted device: authenticated users or Edge-Function-controlled writes.
- Thermal receipts need real-hardware testing.
- Sits outside the Repository/Actions/EventBus pipeline by design.

**BT Intelligence (AI Center)**
- Reads only; every change goes through the assistant's approval card, lock and kill switch.
- Voice and the AI Center avatar depend on the browser's Web Speech API; lip-sync is a speech-like rhythm, not frame-accurate. Spoken replies are optional and off by default.
- Forecast Game, intraday curve, history and avatar photo are per device; a forecast needs the app open to track the day.
- Free-provider pool: quality and availability vary; sensitive (salary/credit/staff) prompts never go to providers that may train on free-tier data.
- Push briefing, closing push and Drive backup have no heartbeat, so health shows them as UNKNOWN.
- Repository index is a snapshot; rebuild with `npm run index:repo`.
- `agent_schedules` exists but nothing executes it yet.

**Inventory Search AI**
- Reference-oriented, not clinical; not a substitute for a pharmacist, doctor or official source.
- Chat only knows inventory the client supplies.

**External integrations**
Before changing a bridge, verify the Supabase project, table, schema, read/write direction, cache behaviour and source-of-truth owner. Similarly named datasets may be different systems.

---

## Development rules

1. **Read the code first.** Don't rely on this README alone.
2. **Preserve the architecture.** New business-data writes go `Action → Repository → State → EventBus` (Emergency Billing excepted).
3. **Don't mutate state directly** without a documented reason.
4. **Keep EventBus events stable.** Other modules depend on them.
5. **Make storage migrations lossless:** old key → migration → new key, keeping the old path until verified.
6. **Before removing a `window.*` bridge,** search repo-wide, including inline HTML handlers, legacy scripts, external consumers and Android/WebView assumptions.
7. **Service worker:** review app-shell caching, bump the cache version, verify update behaviour.
8. **Printing:** test on real Android/hardware, including thermal receipts.
9. **Attendance:** test on actual staff phones (background, reboot, weak network, GPS boundary, permissions, battery optimisation, OEM quirks).
10. **Database changes:** add a dated migration. Validate financial/inventory-sensitive operations (e.g. refunds) in the database/RPC layer, not only the frontend.
11. **After refactors,** search the whole repo for stale references.
12. **Secrets hygiene:** never commit or paste tokens anywhere persistent; rotate immediately if exposed.

**Order of truth** when things disagree: running code → DB schema & migrations → automated tests → module comments → this README → commit history.

---

## Philosophy

Operational reliability, data integrity, simple workflows, offline resilience, cross-device continuity, conservative financial calculations, and pharmacy-specific practicality. Native Android is used where browser limits matter, deterministic business intelligence stays separate from AI-assisted companions, and the synced business-data layer stays separate from intentionally device-local systems.

The goal isn't another dashboard. It's a single operational intelligence layer connecting sales, staff, inventory, closing, STR, audit, emergency billing and supporting workflows without duplicating the systems underneath.
