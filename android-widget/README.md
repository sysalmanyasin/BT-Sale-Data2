# BT Widgets (Android home-screen widgets) — starter scaffold

One native Android app hosting **four** home-screen widgets, each a
thin, read-only glance at data already synced to Supabase — no app
logic re-hosted server-side, no new backend. All four show up
separately in Android's widget picker (long-press home screen →
Widgets → look for each one by name below) since they're all part of
the same app/module.

| Widget | Shows | Data source |
| --- | --- | --- |
| **Inventory Widget** | Low Stock — 4 lowest-stock items | `inventory_products` table, project `vtcrdkqhuvxatclobsby` (same as `inventory-search` PWA) |
| **Sales Widget** | Latest month's sale total, split Cash / Banks / Credit Clients / Customers | `bt_salesdata.payload->monthly` (same project as Closing/Credits below, `wetbugzzchkghpzmowod`) |
| **Closing Widget** | Latest Closing shift — Carried CC, Deposits, Book Bills, Manual Returns | `sheets` table, same project ClosingBridge reads (`js/closing-bridge.js`) |
| **Outstanding Credits Widget** | Total Outstanding Credits (Staff + Jazz Cash + Patty/Expenses + Misc Sections) + who owes the most | `bt_salesdata.payload->manager` / `->ledger` / `->ledgerCustomTypes` |

Tapping any widget opens `bt.duapharma.com` (Inventory's opens the
`inventory-search/` sub-path specifically) in the browser.

**Why Sales/Closing/Credits query Supabase directly instead of calling
the app's own JS**: this app's business data (MONTHLY/DAILY/STAFF/
manager/ledger/etc.) all syncs as one JSON document in `bt_salesdata`'s
`payload` column (see `js/supabase.js`'s `_buildPayload()`), not
separate normalized tables. Rather than pull that whole blob, the
Sales and Credits widgets use a **PostgREST JSON-path select**
(`?select=payload->monthly`, etc.) so Postgres itself only returns the
one sub-tree each widget needs. Closing's data (`sheets` table) is
already normalized, so that widget queries it the same direct way
Inventory queries `inventory_products`.

Each widget's Kotlin file has its own header comment listing the exact
simplifications it makes vs. the web app's precise math (things like:
custom "Manage Fields" columns aren't folded into Sales' Banks/Credit
totals; Closing's Book-Bills/Manual-Returns lookback is bounded to the
last 30 shifts; Staff Credit month-selection doesn't fall back through
every manager domain the way the web tile's fallback chain does).
None of these change the common case — they're the same kind of
documented, non-urgent gap this repo already tracks elsewhere — but
worth reading before trusting a number that looks off.

I don't have Android build tooling in the environment I write code in
(no local SDK, emulator, or device), so I can't compile or install
this myself directly — but the GitHub Actions workflow above does
build it for real, in a genuine Android build environment, on every
push. That means this scaffold's actual correctness gets verified by
a real compiler, not just by me reading the code carefully.

## Getting an APK — two ways

### Easiest: let GitHub Actions build it (no Android Studio needed)

Every push touching `android-widget/**` triggers `.github/workflows/android-widget-build.yml`,
which builds a debug APK in the cloud and attaches it to the run as a
downloadable artifact:

1. On GitHub: **Actions tab → "Build Inventory Widget APK" → pick the
   latest run → Artifacts → `inventory-widget-debug-apk`** → download
   the zip, unzip it to get `app-debug.apk`.
2. Transfer that APK to your phone (e.g. email it to yourself, or a
   cloud-drive link) and tap it to install. Android will prompt to
   allow installing from that source the first time — that's normal
   for a side-loaded APK not from the Play Store.
3. Long-press your home screen → Widgets → "Inventory Widget" → drag
   it onto the screen.

This is a **debug** build (signed with Android's auto-generated debug
keystore) — right for installing directly on your own phone(s), not
suitable for a Google Play listing (that needs a release build signed
with your own keystore — a separate step, only worth doing if you want
that distribution route later).

### Alternative: build locally in Android Studio

1. **Install Android Studio** (free, from developer.android.com).
2. **Open this folder** (`android-widget/`) as an existing project —
   File → Open → select this directory. Let Gradle sync (first sync
   downloads the Android Gradle Plugin + Kotlin plugin, needs internet).
3. **Run it** on your phone (USB debugging enabled) or an emulator —
   the green ▶ Run button. This installs the APK.
4. **Add the widget**: long-press your home screen → Widgets →
   "Inventory Widget" → drag it onto the screen.
5. Tap the small refresh icon inside the widget any time you want a
   read newer than the last automatic update (Android won't run the
   automatic update more often than every ~30 minutes — that's an OS
   battery-life rule every app is bound by, not something adjustable).

## Files

```
android-widget/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/duapharma/inventorywidget/
│       │   └── InventoryWidgetProvider.kt   ← the widget's logic
│       └── res/
│           ├── layout/inventory_widget.xml  ← the widget's UI
│           ├── drawable/widget_background.xml
│           ├── values/strings.xml
│           └── xml/inventory_widget_info.xml ← size/update-interval config
├── build.gradle.kts
└── settings.gradle.kts
```

## Known gaps to close before relying on this daily

- **Background fetch reliability.** `onUpdate()` fetches over the
  network directly on a coroutine. That's fine for trying it out, but
  Android can kill background work like this under memory pressure or
  aggressive battery optimization on some phones (this is a
  widely-known widget gotcha, not specific to this code). The
  Android-recommended fix is a `WorkManager` `PeriodicWorkRequest` that
  does the fetch and caches the result (e.g. in `SharedPreferences`),
  with the widget provider just reading that cached result instead of
  fetching itself. Worth doing once the basic version is confirmed
  working.
- **Only 4 fixed rows.** A real scrollable list of every low-stock
  item needs a `ListView` + a `RemoteViewsService` — a separate, more
  involved API RemoteViews widgets use instead of a normal
  `RecyclerView`. Skipped here to keep the starter simple.
- **No app icon.** There's no `MainActivity`, so this APK won't show
  up in the app drawer — only the widget itself shows up in the widget
  picker. That's intentional (keeps this small and independent of
  whether the PWA ever gets wrapped as a Trusted Web Activity), but if
  you want a normal launchable app icon too, that's a small addition.
- **Distribution.** Side-loading the APK (via USB/Android Studio, or a
  direct APK file/link) is enough for personal/internal use. If you
  want other branch staff to install this easily, that's a Google Play
  listing — a one-time $25 developer account plus their review
  process, separate from anything here.
- **Not tested.** Said above, repeating because it matters: treat the
  first Gradle sync + first run as the real first check of this code,
  not something already verified.
