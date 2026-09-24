Bahria Town Sales Intelligence Centre

BT Sales IC is a personal, single-user pharmacy operations PWA for Bahria Town. It combines daily sales capture, reporting, management tools, inventory intelligence, closing/audit read-only bridges, attendance, spreadsheets, PDF archiving, cross-device sync, and native Android companions in one codebase.

Live app: "bt.duapharma.com"
Repository: "sysalmanyasin/BT-Sale-Data2"
Default branch: "main"

«Documentation note: This README describes the current codebase rather than its historical evolution. When documentation conflicts with implementation, the code and database schema are the source of truth.»

---

📌 At a Glance

Area| What it provides
📊 Sales| Dashboard, daily sales entry, history/index, reports, payments, DIFF/reconciliation, cash-deposit reporting
👔 Manager| Staff Registry, staff notes, Ledger, Targets, Salary, Petty, Credit, Incentive, Manager Overview, Payslip, Attendance
📦 Inventory| BT Inventory, Stock Ledger, Excess Working, Reorder Report, Inventory Health
🚚 STR| Awaited/Dispatched/Received workflow, detail view, flattened report, Zero Dispatch
📖 Closing| Native read-only Closing Book + Credit Ledger views
🧾 Audit| Native read-only Assignments view + external Pharmacy Audit Hub
📑 Notes & Sheets| Multi-file spreadsheet-style workbooks and live-data materialisation
🛠️ Utilities| Sync Center, PDF Library, Activity Log, global navigation/search, settings
🔎 Inventory Search| Standalone Inventory Search PWA with medicine reference AI/chat
📱 Android| Home-screen widget app + native attendance/geofence app
🔄 Backup & Sync| Supabase multi-device sync + independent Google Drive backup
📲 PWA| Installable offline-capable Progressive Web App
📰 Herald| Deterministic daily operational intelligence across major domains

The application is intentionally designed around a single pharmacy / single primary operational environment. It is not currently a general-purpose multi-tenant SaaS architecture.

---

🧰 Tech Stack

Frontend

- Vanilla JavaScript
- ES modules
- Legacy "<script>" modules where migration is still in progress
- HTML/CSS
- No frontend build step
- GitHub Pages/custom-domain deployment

Backend

- Supabase PostgreSQL
- Supabase Authentication
- Supabase Storage
- Supabase Edge Functions
- Supabase REST APIs

PWA

- "manifest.json"
- Root "sw.js"
- Service-worker caching
- Offline application shell
- Automatic update detection
- Safe reload handling

Libraries

- Chart.js
- jsPDF
- jsPDF-AutoTable
- html2canvas
- XLSX
- qrcode-generator
- jsdom for testing

Android

- Kotlin
- Gradle
- Native Android widgets
- Native Android attendance/geofencing application

Testing

- Node.js built-in test runner
- jsdom
- Static integrity checks
- JavaScript parsing checks
- DOM/navigation tests
- Pure-module tests

---

🧭 Navigation Architecture

The application uses a unified Search & All Sections / BT Navigation Panel.

Access

- Desktop: ☰ Menu
- Mobile: bottom navigation → ☰ Menu
- Long-pressing Cover can open navigation

Navigation is generated from:

"js/nav-sections.js"

rather than maintaining multiple independent navigation lists.

Navigation features

- Nested groups
- Fuzzy navigation search
- Staff Registry search integration
- URL-hash routing
- Browser back-button support
- Shared navigation tree
- Mobile and desktop layouts

The previous Recents drawer and old always-visible tab-strip architecture have been retired.

---

🏠 Cover

Cover acts as the main operational hub.

It provides:

- Major domain cards
- Cross-domain operational signals
- Quick navigation
- Inventory alerts
- Sales indicators
- Manager indicators
- Audit signals
- Herald headlines
- External companion-app shortcuts

Cards can be reordered.

---

📰 IC Herald

The IC Herald is a deterministic daily operational intelligence layer.

It aggregates signals from areas such as:

- Sales
- Manager
- Inventory
- Closing
- Audit

The Herald generates headlines and operational summaries from application data.

Important

The main Herald system is not generative AI.

It uses deterministic application calculations and business rules.

Implementation:

"js/herald/"

---

📊 Sales

Dashboard

The Sales Dashboard provides operational analytics including:

- Daily sales
- Period comparisons
- MTD/YTD information
- Target pace
- Staff-related signals
- Operational alerts
- Forecast calculations
- Herald signals

The dashboard is a renderer over the application's analytics/business-data layer rather than a separate data source.

---

Sale Data

Index

Year → Month → Day navigation for historical sales.

Daily Data

Raw day-by-day sales records.

Add Entry

Daily sales entry interface with intelligent date-aware prefill.

Sale Report

Standard sales reporting and analysis.

Payments

Handles:

- Cash
- Card
- Credit
- Credit-customer detail

DIFF

Reconciliation and difference analysis.

Cash Deposit

Cash-deposit calculation and reporting.

---

✍️ Add Entry Prefill

"entry-prefill.js" reduces duplicate manual entry.

Current automatic sources include:

Closing Sheets

Prefills values such as:

- Cash Sale
- Bank Alfalah
- Bank Alfalah 2
- Cash Returns

Sale Payments Bridge

Can supply:

- Total Sale
- COMP SALE
- Matching credit-customer information

Manual entry remains available when no reliable live source exists.

Important design

Prefill-owned values are tracked separately from manually entered values.

This prevents changing the selected date from unintentionally overwriting information manually entered by the user.

---

💳 Sale Payments Bridge

The Sale Payments integration is a read-only bridge to the separate:

Candela POS → Dropbox → Supabase

pipeline.

It is not the main PWA's primary source of truth.

---

👔 Manager

The Manager domain provides the operational management layer.

Staff Registry

Provides employee management including:

- Staff CRUD
- Employee identity
- Staff information
- Timestamped staff notes
- Integration with Attendance
- Integration with Manager modules

Staff Registry is the source of truth for staff identity used by related systems.

---

📅 Attendance

Attendance is a major integrated domain with both:

1. Web management
2. Native Android application

---

Manager Attendance

Implementation:

"js/manager-attendance.js"

Today

Displays every active staff member, including visible absences.

Monthly

Provides:

- Present count
- Absent count
- Late count
- Monthly summaries

Raw Log

Recent attendance events.

Manual Entry

Manager-controlled attendance corrections.

Location

Pharmacy geofence/location management.

Notifications

Attendance notification configuration/status.

iPhone Setup

Guidance for devices that cannot use the native Android geofencing application.

---

📱 Native Android Attendance

Location:

"android-attendance/"

The native application is designed for:

- Staff phones
- Manager notification phone

Staff features

- Pharmacy geofence ENTER → Check-in
- Pharmacy geofence EXIT → Check-out
- QR manual fallback
- Device registration
- Background operation
- Reboot geofence re-registration
- Mock-location detection flag
- Boundary-flapping debounce
- Offline event queue
- Automatic retry when connectivity returns

Manager mode

Manager devices can receive attendance notifications without participating in staff geofencing.

Location source

The application uses the active row from:

"attendance_locations"

for the primary pharmacy geofence.

The last known location is cached for reboot/network resilience.

---

Attendance Logic

Late detection is optional.

It only activates when a staff member has an explicit:

"shiftStart"

A five-minute grace period is applied.

The system does not attempt to guess employee schedules.

---

Attendance Security Considerations

The current attendance architecture is designed around the application's existing single-pharmacy environment.

The attendance tables currently use an anon-role access model with the project's accepted RLS tradeoffs.

Therefore:

«The public client key should not be considered a complete per-device authentication boundary.»

A manager PIN is protected server-side for manager-control functionality, but this is not equivalent to full device/user authentication.

Future security direction

For a future multi-branch or higher-security deployment, attendance should move toward:

- Supabase authenticated users
- Device identity
- Server-side authorization
- Edge Function controlled writes
- Branch-level access policies

---

🎯 Manager Targets

Target management feeds calculations used by dashboard and management surfaces.

Target information can contribute to:

- Target pace
- Sales comparisons
- Manager analytics
- Staff performance views

---

📒 Manager Ledger

The generalized Ledger architecture supports:

- Date filtering
- Date ranges
- Category grouping
- Reusable ledger rendering
- Custom ledger sections
- JazzCash-related records
- Inline editing

Important exception

Petty Cash remains a deliberate legacy/separate implementation in:

"manager-petty.js"

It is not currently rendered through the generalized Petty category in:

"ledger-store.js"

---

💰 Salary

Manager Salary functionality includes salary-related reporting and payslip functionality.

The architecture keeps salary-related data separate from general ledger presentation.

Important

Attendance is not currently wired as an automatic salary deduction engine.

---

🧾 Credit

Manager Credit functionality supports credit-related operational records and reporting.

Credit information is also surfaced through relevant dashboard/closing views.

---

🎁 Incentive

Manager Incentive functionality handles incentive-related reporting and calculations.

---

📦 Inventory

The Inventory domain is designed for large pharmacy datasets.

---

BT Inventory

Provides:

- Product search
- Manufacturer/supplier grouping
- Pagination
- 100-row views
- Optional-column picker
- Large-SKU support
- Read-only integration with the Pharmacy Audit Hub inventory dataset

---

📚 Stock Ledger

Stock Ledger provides multiple analytical panels:

Never Sold

Products with no recorded sales.

Dead Stock

Products meeting the application's dead-stock criteria.

Excess

Products with excessive inventory cover.

Pack Issues

Potential packaging/conversion inconsistencies.

Zero Stock

Products currently showing zero inventory.

Each analytical panel maintains its own:

- Search
- Filter
- Sort
- Display state

---

📈 Excess Working

Excess Working identifies inventory with excessive stock cover.

Features include:

- Configurable excess logic
- Working list
- Retain List
- Adjustments
- Reported-HO-value variance
- Top-N Excel export

Default threshold

The current default excess threshold is:

90+ days of cover

---

🔄 Reorder Report

The Reorder Report is designed to identify stock requiring replenishment.

Features:

- Top N
- All items
- 30-day sales-value window
- 60-day sales-value window
- 90-day sales-value window
- Cover-days threshold
- Optional live today's sales
- Supplier grouping
- Column visibility
- Print/export
- In-Transit quantities

In Transit

Inbound STR quantities can be incorporated into reorder calculations.

This prevents stock already moving toward the pharmacy from being treated identically to stock with no incoming supply.

---

❤️ Inventory Health

Inventory Health provides a management-level inventory dashboard.

Includes:

- Health classification chart
- Movers chart
- Trend chart
- Supplier breakdown
- KPI cards
- Searchable detail table
- Local reorder-value trend

---

🚨 Inventory Alerts

The application can surface inventory-related operational alerts.

Examples include:

- Low-cover-value
- Excess-item
- Dead-stock aggregate

These can appear on Cover without requiring the Inventory module to be opened.

---

🚚 STR Report

STR is a standalone top-level domain.

The source data is read-only and comes from the Pharmacy Audit Hub Supabase environment.

---

STR List / Detail

Supports:

- Dispatch / Receive direction
- Awaited
- Dispatched
- Received
- Date filtering
- Supplier grouping
- Product-code ordering
- Detail modal
- Previous/Next navigation
- Printing

The application derives the business lifecycle from dispatch/receive state rather than relying only on the raw "str_status" field.

---

📋 STR Report

The flattened report follows:

Dispatch Branch → STR → Comments → Supplier → Line Items

It supports:

- Same filtering engine as List
- Column picker
- Print
- Detailed operational reporting

---

0️⃣ Zero Dispatch

Zero Dispatch isolates STR line items where:

- STR Qty > 0
- Dispatch Qty = 0

Users can select STR blocks for printing.

---

📦 STR Quantity Convention

STR quantities are displayed as pack quantities rather than raw loose units.

Conversion uses:

"conversion_factor"

The same floor/down-rounding convention used by Inventory analysis is applied.

If a reliable conversion factor does not exist:

"conversion_factor = 1"

---

📖 Closing

The application contains native read-only views over the standalone Closing system.

Closing Book

Native read-only Closing Book interface.

Credit Ledger

Native Credit Ledger views include:

- Credit
- Misc/Ongoing

These are deliberately read-only bridges.

The standalone Closing application remains external to this repository.

---

🧾 Audit

The application includes a native read-only Assignments view backed by shared Audit Hub data.

The external Pharmacy Audit Hub is also accessible from the navigation.

---

📑 Notes & Sheets

A lightweight spreadsheet/workbook environment is built into the PWA.

Features include:

- Multiple files
- Multiple sheets
- Editable grid
- Notes
- Sheet management
- Live Data materialisation
- Spreadsheet import/export

---

Live Data

The Data tab can materialise live application data into editable sheet data.

This reduces the need to manually copy operational information between systems.

---

🔄 Sync Center

The application uses a single-active-device/control model to reduce simultaneous editing conflicts.

Sync Center provides areas for:

- Session
- Devices
- Controls
- Health
- Logs
- Settings

Conflict handling is separated into:

"conflict-ui.js"

This keeps conflict presentation separate from the underlying business logic.

---

💾 Backup

The application has two conceptually different persistence mechanisms.

Supabase Sync

Used for application synchronization across supported devices.

Google Drive

Used as an independent backup mechanism.

Google Drive backup should not be confused with Supabase synchronization.

---

📚 PDF Library

Generated PDFs can be:

- Viewed
- Downloaded
- Saved
- Retrieved across supported devices

The PDF Library uses Supabase Storage/metadata.

An expiry sweep is triggered during application unlock.

---

📝 Activity Log

The Activity Log provides a cross-device change feed.

It records:

- Date/time
- Section
- Add
- Edit
- Delete activity

It listens to the application's EventBus instead of requiring every Action/page to independently implement logging.

---

🔎 Global Search

The unified navigation system provides fuzzy search.

It can search:

- Navigation sections
- Staff Registry
- Relevant application destinations

Staff search can fuzzy-rank employee results and help jump toward the relevant Staff Card.

---

🔐 Authentication

The main PWA is protected by Google Sign-In.

Current authentication architecture:

1. User initiates Google Sign-In.
2. Google provides an identity token.
3. Authorised email configuration is synchronised from Supabase.
4. Client-side authorization provides an early UX gate.
5. The Google ID token is exchanged through Supabase "signInWithIdToken".
6. Supabase establishes an authenticated session.
7. RLS-aware backend operations can use the authenticated identity.

Security boundary

The client-side authorized-email list is a fast-fail UX gate, not the sole security boundary.

Server-side Supabase authentication/RLS is the important security layer for protected operations.

---

🔑 Password / PIN Legacy UI

Some legacy password/reset markup and helper functions remain in the codebase.

However:

«Password/PIN unlock is disabled.»

The supported application unlock mechanism is:

Google Sign-In

The legacy password functions are retained primarily for compatibility with existing UI/code structure and do not provide the active authentication path.

---

🤖 AI Architecture

The main PWA is intentionally AI-free.

Previous client-side AI systems such as:

- Assistant
- Context Engine
- Daily AI Briefing

have been removed from the main PWA.

Current main-PWA intelligence systems such as Dashboard calculations and Herald are deterministic application logic.

---

🧠 AI Companion Systems

AI exists in separate companion/server-side systems.

---

🔎 Inventory Search — Medicine Reference

The standalone:

"inventory-search/"

application can request medicine reference information through:

"medicine-ai-info"

Current provider strategy:

1. Groq
2. Gemini fallback

Results may be cached for approximately 30 days.

The companion PWA does not require login, therefore the Edge Function is designed accordingly.

Safety boundary

The feature is intended for reference information.

It is not a patient-specific prescribing or clinical decision-making system.

---

💬 Inventory Search — AI Chat

The Inventory Search companion also provides a conversational interface.

For inventory questions, the assistant is intentionally limited to product context supplied by the client.

It does not maintain an independent server-side copy of the inventory.

General medicine questions may be answered using model knowledge with reference-oriented framing.

---

📲 Daily WhatsApp Briefing

The repository also contains:

"send-daily-whatsapp-briefing"

This is a separate server-side Edge Function.

It can:

1. Read closing/inventory information.
2. Generate a short briefing using the configured AI provider.
3. Send the briefing through WhatsApp.

This system is separate from the main PWA's deterministic Herald engine.

---

📱 Android Applications

The repository currently contains two native Android projects.

---

1. "android-widget/"

A Kotlin application providing 22 home-screen widgets.

Widget categories include:

- Closing summaries
- Sales/target pace
- Final closing
- Month totals
- Live POS sale
- Recent shifts
- Credit
- Ledger aging
- Inventory health
- Reorder urgency
- Excess
- Top-running products
- Negative stock
- Dead stock
- Never-sold products
- Native product search shortcut
- STR Awaited
- STR Dispatched
- STR Inbound

The Android implementation mirrors important web business calculations where required so widgets can operate without the main PWA being open.

It has its own Gradle project and GitHub Actions build workflow.

---

2. "android-attendance/"

Native attendance/geofencing application.

Primary capabilities:

- Staff geofencing
- Check-in
- Check-out
- QR fallback
- Offline queue
- Background processing
- Device registration
- Manager notifications
- Reboot recovery
- Mock-location flagging

---

❌ Retired Android Wrapper

The former:

"android-app/"

Trusted Web Activity wrapper has been removed.

The repository now contains:

- "android-widget/"
- "android-attendance/"

---

🧱 Application Architecture

The main PWA follows a layered architecture:

User
  ↓
Action
  ↓
Repository
  ↓
Data / State
  ↓
EventBus
  ↓
Pages / Components

---

Repository

The Repository acts as the primary business-data storage boundary.

---

State

State contains the application's in-memory working data.

---

Actions

Actions provide the primary mutation boundary.

Business-data writes should normally pass through Actions.

---

EventBus

EventBus broadcasts meaningful application changes.

This allows:

- UI updates
- Activity logging
- Cross-module reactions
- Cache invalidation
- Other observers

without tightly coupling individual modules.

---

Components

Reusable UI and utility functionality.

---

Pages

Domain-specific rendering and interaction.

Pages should avoid bypassing the business/data layers.

---

🔧 ES Module Migration

The application is undergoing an incremental migration toward ES modules.

Therefore some compatibility bridges remain using:

"window.*"

Important

Do not remove a global bridge merely because an equivalent module export exists.

Before removing one, search for:

- Other JavaScript consumers
- HTML inline handlers
- Legacy modules
- Android/WebView assumptions
- Cross-module references

---

💾 Storage Architecture

The application primarily separates:

Core business data

Managed through:

"Repository"

and related application state/actions.

Non-business/local data

Some information intentionally remains in browser storage.

Examples include:

- Authentication bootstrap state
- UI preferences
- Theme settings
- Drive token caching
- Bridge caches
- Inventory preferences
- STR preferences

These should not automatically be treated as business-data migration candidates.

---

📁 Repository Structure

/
├── index.html
├── manifest.json
├── sw.js
├── CNAME
├── package.json
│
├── js/
│   ├── shared/
│   ├── herald/
│   └── application modules
│
├── css/
│
├── inventory-search/
│
├── android-widget/
│
├── android-attendance/
│
├── supabase/
│   ├── functions/
│   ├── migrations/
│   ├── pdf_library/
│   └── activity_log/
│
├── tests/
│
└── .github/
    └── workflows/

---

🧪 Testing

The project uses Node's built-in test runner with jsdom.

Install

npm install

Run tests

npm test

Verbose tests

npm run test:verbose

Watch mode

npm run test:watch

---

Testing Coverage

The test suite covers areas including:

- Static file integrity
- Script integrity
- Manifest validation
- Service-worker app-shell consistency
- JavaScript parsing
- Pure module behaviour
- EventBus behaviour
- Printing API surface
- Staff Registry integration
- DOM behaviour
- Navigation behaviour

---

Testing Limitations

The Node/jsdom suite does not completely reproduce:

- Live Supabase
- Real Google authentication
- Real printer hardware
- Browser rendering
- Real Android geofencing
- Android background execution
- OEM battery management
- Physical GPS behaviour

Therefore real-device testing remains essential.

---

⚠️ Known Limitations & Design Tradeoffs

Main PWA

- Designed around a single pharmacy environment.
- Not currently a general multi-tenant SaaS architecture.
- ES-module migration is incomplete.
- Some global bridges remain intentionally.
- Petty Cash retains a separate legacy implementation.
- Some external integrations are read-only bridges.
- Main PWA does not use generative AI.

---

Attendance

- Current attendance security uses the existing anon-role/RLS tradeoff.
- Native attendance is designed around one primary pharmacy geofence.
- Multi-branch attendance requires architectural expansion.
- Android OEM battery-management settings can affect background geofencing.
- Attendance is not yet automatically connected to Salary deductions.
- QR fallback should be treated as part of the physical security model.
- Device/user authentication can be strengthened in a future version.

---

Inventory Search AI

- Reference-oriented rather than clinical decision-making.
- Provider secrets must remain server-side.
- Inventory chat only knows live inventory information explicitly supplied as context by the client.
- The assistant should not be treated as a substitute for a pharmacist/doctor or official medicine information source.

---

External Integrations

The repository contains bridges to several separate systems/projects.

Before modifying an integration, verify:

- Supabase project
- Table name
- Schema
- Read/write direction
- Cache behaviour
- Source-of-truth ownership

Two similarly named datasets do not necessarily represent the same underlying system.

---

🔒 Security Rules

This repository handles real operational and financial information.

Never commit:

- Supabase service-role keys
- Private API keys
- AI provider secrets
- WhatsApp secrets
- Google private credentials
- Database passwords
- Other privileged credentials

Client-side public Supabase keys may be required for browser functionality, but they must always be protected by appropriate RLS and backend authorization.

---

🛠️ Safe Development Rules

Before changing the application:

1. Read the implementation

Do not rely solely on README documentation.

2. Preserve architecture

New business-data writes should normally use:

Action → Repository → State → EventBus

3. Avoid direct state mutation

Do not bypass the established mutation layer without a documented reason.

4. Preserve EventBus events

Other modules may depend on them.

5. Storage migrations should be lossless

Prefer:

Old key
   ↓
Migration
   ↓
New key

Keep the old path until the new system is verified.

6. Module migration

Before removing a "window.*" bridge:

- Search repository-wide
- Check inline HTML
- Check legacy scripts
- Check external consumers

7. Service worker

When changing application files:

- Review "sw.js"
- Review app-shell caching
- Review cache versioning
- Verify update behaviour

8. Printing

Test print functionality on actual Android devices before release.

9. Attendance

Test on the actual staff phones, especially:

- Background mode
- Reboot
- Weak network
- GPS boundary
- Permissions
- Battery optimization
- OEM-specific restrictions

10. Database changes

For production Supabase schema changes:

«Add a dated migration.»

Do not silently modify production assumptions.

11. Repository-wide cleanup

After refactoring, search the entire repository for stale references before declaring the change complete.

---

🧭 Source of Truth

When determining how the application actually works, use this order:

1. Running code
2. Database schema and migrations
3. Automated tests
4. Feature/module comments
5. This README
6. Historical commits/comments

The README documents the system.

It is not the system itself.

---

🚀 Development Philosophy

This project prioritizes:

- Operational reliability
- Data integrity
- Simple workflows
- Offline resilience
- Cross-device continuity
- Conservative financial calculations
- Reusable architecture
- Pharmacy-specific practicality
- Native Android integration where browser limitations matter
- Clear separation between deterministic business intelligence and AI-assisted companion tools

The goal is not simply to create another dashboard.

The goal is to create a single operational intelligence layer for pharmacy management that connects sales, staff, inventory, closing, STR, audit and supporting workflows without unnecessarily duplicating the underlying systems.
