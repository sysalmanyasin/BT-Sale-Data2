# Inventory Widget (Android home-screen widget) — starter scaffold

A native Android app whose only real job is hosting one home-screen
widget: **Low Stock**, pulled straight from the same Supabase project
+ table the `inventory-search` PWA reads (`inventory_products`,
project `vtcrdkqhuvxatclobsby`), using the same public/publishable
anon key already in `inventory-search/app.js`. Tapping the widget
opens `bt.duapharma.com/inventory-search/` in the browser.

This is **not** built or tested — I don't have Android build tooling
(Android Studio / a device or emulator / a way to sign & install an
APK) in the environment I write code in. Everything here is real,
correctly-structured Kotlin/XML/Gradle written to compile, but the
first real build is the first time it'll actually be verified.

## What you need to actually get a widget on your phone

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
