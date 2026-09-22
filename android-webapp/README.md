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

## Known limitation: Google Sign-In

Google's OAuth endpoints reject sign-in attempts from generic embedded
WebViews (`Error 403: disallowed_useragent`) — see `js/auth.js` in the repo
root, which uses both a full-page redirect and `google.accounts.oauth2`
for sign-in. Every other part of the app works the same as in a mobile
browser tab. Making Google sign-in work from inside this shell would need
a Chrome Custom Tabs–based auth flow instead of a plain WebView — a
separate piece of work if you want it.

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
