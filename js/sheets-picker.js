// ══════════════════════════════════════════════════════════════════
// GOOGLE PICKER — link a spreadsheet that already exists in Drive
// (owned by you, or shared with you), instead of only ever creating
// new ones. Coding-boss feature list addition.
// ══════════════════════════════════════════════════════════════════
// Why Picker instead of widening the OAuth scope:
// The app only holds the narrow `drive.file` scope (js/auth.js line 372
// — no new consent screen, no Google verification review). `drive.file`
// normally only sees files the app itself created. Google's Picker is
// the sanctioned bridge: the user explicitly *picks* a file through
// Google's own UI, and that grants the app `drive.file`-scoped access
// to just that one file — no scope upgrade needed.
//
// Picker also needs either a developer API key or an app ID. We use
// setAppId() with the OAuth client's project number (same one from
// js/auth.js's GAUTH_CID_FALLBACK, 36704237826) — the documented
// no-API-key path when the caller already holds a valid OAuth token.
// ══════════════════════════════════════════════════════════════════
(function () {
'use strict';

const PICKER_APP_ID = '36704237826'; // project number — see js/auth.js GAUTH_CID_FALLBACK
let _pickerApiLoaded = false;
let _pickerApiLoading = null;

function _loadPickerApi() {
  if (_pickerApiLoaded) return Promise.resolve();
  if (_pickerApiLoading) return _pickerApiLoading;
  _pickerApiLoading = new Promise((resolve, reject) => {
    const finish = () => {
      if (!window.gapi || !window.gapi.load) { reject(new Error('Google API loader unavailable')); return; }
      window.gapi.load('picker', { callback: () => { _pickerApiLoaded = true; resolve(); } });
    };
    if (window.gapi && window.gapi.load) { finish(); return; }
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.defer = true;
    s.onload = finish;
    s.onerror = () => reject(new Error('Could not load Google Picker script — check your connection'));
    document.head.appendChild(s);
  });
  return _pickerApiLoading;
}

// Opens the picker filtered to Google Sheets, spanning both "My Drive"
// and "Shared with me" so sheets you don't own are reachable too.
// Resolves with { id, name } of the chosen file, or null if cancelled.
function sheetsOpenPicker() {
  return new Promise(async (resolve, reject) => {
    if (!_driveAccessToken) { reject(new Error('Connect Google Drive first (Tools → Drive)')); return; }
    try {
      await _loadPickerApi();
    } catch (e) { reject(e); return; }

    const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    const sharedView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setOwnedByMe(false)
      .setLabel('Shared with me');

    const picker = new google.picker.PickerBuilder()
      .setAppId(PICKER_APP_ID)
      .setOAuthToken(_driveAccessToken)
      .addView(sheetsView)
      .addView(sharedView)
      .setTitle('Link a Google Sheet')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs && data.docs[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

window.sheetsOpenPicker = sheetsOpenPicker;

})();
