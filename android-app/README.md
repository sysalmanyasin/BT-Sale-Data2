# BT Sale Data — standalone Android app

A **Trusted Web Activity (TWA)** wrapper around the live PWA at
`https://bt.duapharma.com` — a real installable Android app with its
own icon and app-switcher entry, running full-screen with no browser
chrome. There is no custom app code: the entire app is Google's
`androidbrowserhelper` library (`LauncherActivity`) plus manifest
configuration pointing it at the site.

## Why a TWA and not a WebView

A plain `WebView`-wrapped app was considered and rejected: **Google
blocks Google Sign-In / OAuth inside embedded WebViews** (a security
policy, not a bug), and this app's Auth gate is Google Sign-In. A TWA
is different — it's not a WebView at all, it's actually Chrome (or the
device's default TWA-capable browser) running full-screen inside your
app's process. Sign-In, Sync, offline caching via the existing service
worker, everything works exactly as it does in the browser, because
under the hood it *is* the browser.

## How the "no URL bar" part works

That full-screen, chrome-less mode is not automatic — it's gated by
**Digital Asset Links verification**. On first install, Android
fetches `https://bt.duapharma.com/.well-known/assetlinks.json` and
checks it lists this app's package name (`com.duapharma.btsaledata`)
and this app's signing certificate's SHA-256 fingerprint. Only if that
check passes does the TWA drop the URL bar; otherwise it silently
falls back to a normal Custom Tab (same content, just with a URL bar
showing). The fingerprint has to match in **three** places, and this
repo keeps all three in sync:
1. `app/build.gradle.kts`'s `signingConfigs` → `app-debug.keystore`
2. `app/src/main/res/values/strings.xml`'s `asset_statements`
3. `/.well-known/assetlinks.json` at the **repo root** (served at
   `bt.duapharma.com/.well-known/assetlinks.json` via GitHub Pages,
   since `CNAME` already points this repo at that domain — no separate
   hosting needed)

If you ever regenerate `app-debug.keystore`, you must update the
fingerprint in all three places or the app will quietly downgrade to
"URL bar visible" instead of failing loudly.

`app-debug.keystore` is committed to the repo intentionally, for the
same two reasons `android-widget/shared-debug.keystore` is: (1) so
every CI build signs identically and installs as a clean update
instead of forcing an uninstall, and (2) here specifically, so the
Digital Asset Links fingerprint never drifts out of sync with what's
published at `/.well-known/assetlinks.json`. It's a debug-only,
internal-sideload key, not a Play Store release key.

## Building locally

Requires Android Studio (or the command-line SDK) with SDK 34 and
JDK 17.

```
cd android-app
gradle assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

## Building via GitHub Actions

Any push to `main` touching `android-app/**` triggers
`.github/workflows/build-app-apk.yml`, which builds a debug APK and
uploads it as a workflow artifact (Actions tab → latest run →
Artifacts). It's unsigned for the Play Store (debug-signed only) —
fine for sideloading onto your own device.

## Installing on your phone

1. Download `app-debug.apk` from the workflow run's Artifacts.
2. Enable "Install unknown apps" for whatever app you download it
   with.
3. Install and open it. It should launch straight into the app with
   no URL bar. If you do see a URL bar, Digital Asset Links
   verification hasn't succeeded yet — see
   [Troubleshooting](#troubleshooting).

## Troubleshooting

- **URL bar is visible instead of full-screen** — almost always a
  Digital Asset Links mismatch. Confirm
  `https://bt.duapharma.com/.well-known/assetlinks.json` is reachable
  in a browser and its `sha256_cert_fingerprints` value matches the
  one in `strings.xml`/`build.gradle.kts` above. GitHub Pages can take
  a few minutes to redeploy after a push, and Android caches a failed
  verification result — clearing this app's storage (Settings → Apps
  → BT Sale Data → Storage → Clear storage) and reopening forces a
  re-check.
- **`.well-known/assetlinks.json` 404s** — GitHub Pages runs Jekyll by
  default, which excludes dot-directories unless a `.nojekyll` file
  exists at the repo root (it does, added alongside this app — if it's
  ever removed, this file silently stops being served).
- **Sign-In fails inside the app** — shouldn't happen with a TWA (see
  [above](#why-a-twa-and-not-a-webview)); if it does, check that
  `https://bt.duapharma.com` is still an authorized origin in the
  Google OAuth Client ID config, same as it needs to be for the
  regular browser/PWA flow.
