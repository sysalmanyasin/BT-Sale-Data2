# BT Sales App (WebView wrapper)

A thin native Android shell around the PWA hosted at `bt.duapharma.com`
(the root of this repo). It doesn't bundle a copy of the front end — it
just opens that URL in a WebView, so the app always reflects whatever is
currently deployed to the site, with no separate release step for content
changes.

## What it handles

- File inputs (`<input type="file">`) via the system file/camera chooser
- Downloads (PDFs, exports) via Android's `DownloadManager`
- `window.open()` / popup navigation (e.g. the Google sign-in token flow)
  routed back into the main WebView
- Back button navigates WebView history before exiting
- Pull-to-refresh

## Google Sign-In

Google's OAuth endpoints reject sign-in attempts from generic embedded
WebViews (`Error 403: disallowed_useragent`) — a real anti-phishing
protection, not a bug, since an embedded WebView can read cookies and
inject JavaScript into the login page in ways a real browser tab can't.
Spoofing the WebView's user agent to dodge that check would work today
and quietly break tomorrow, so this app doesn't do that. Instead:

1. `MainActivity` intercepts navigation to `accounts.google.com` and opens
   it in a **Chrome Custom Tab** instead of the WebView — a real Chrome
   context, so Google accepts it normally.
2. When sign-in finishes, Google redirects back to `https://bt.duapharma.com/...`
   exactly as it would for a browser tab (see `js/auth.js`'s
   `_gauthOAuthSignIn`/`_gauthHandleRedirectToken`).
3. An Android **App Link** (`autoVerify` intent-filter in
   `AndroidManifest.xml`, backed by `/.well-known/assetlinks.json` at the
   repo root) routes that redirect back into the app instead of leaving
   it open in Chrome. `MainActivity` then loads that URL into the WebView,
   so the site's existing token handler picks it up unchanged.

**For this to verify on a device**, `assetlinks.json`'s
`sha256_cert_fingerprints` must match whatever key actually signs the
installed APK. It currently lists the fingerprint of the shared debug
keystore checked into this repo (`shared-debug.keystore`, same one
`android-attendance`/`android-widget` use) — fine for these debug builds.
If this app is ever signed for release with a different key, add that
key's SHA-256 fingerprint (`keytool -list -v -keystore <your-release.keystore>`)
to `assetlinks.json` alongside the debug one.

If App Link verification hasn't finished on a given device yet (it can
take a short time after install) or the fingerprint doesn't match, this
degrades safely rather than breaking: sign-in still completes, it just
finishes in Chrome instead of hopping back into the app.

## Building

Same pattern as `android-attendance/` and `android-widget/`:

```
cd android-webapp
gradle assembleDebug
```

CI: `.github/workflows/build-webapp-apk.yml` builds a debug APK on every
push that touches `android-webapp/**`, and uploads it as a workflow
artifact (`bt-sales-app-debug-apk`). Trigger it manually from the Actions
tab (`workflow_dispatch`) to build without changing anything first.

Signed with the same shared debug keystore as the other two subprojects,
so repeat installs upgrade in place rather than needing an uninstall.
