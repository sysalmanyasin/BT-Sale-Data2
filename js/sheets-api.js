// ══════════════════════════════════════════════════════════════════
// GOOGLE SHEETS API — thin wrapper around Sheets API v4
// ══════════════════════════════════════════════════════════════════
// Reuses the SAME access token drive.js already holds (_driveAccessToken).
// drive.file scope covers Sheets API calls on files this app creates —
// see js/auth.js line 372 for the granted scope. No new consent screen.
//
// This file is pure API plumbing — no DOM, no Supabase. sheets-sync.js
// and sheets-app.js build on top of it.
// ══════════════════════════════════════════════════════════════════
(function () {
'use strict';

const SHEETS_FOLDER_NAME = 'Sheets'; // subfolder under BT-SALE-DATA (plan §3)
const PARENT_FOLDER_ID   = '1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn'; // same BT-SALE-DATA folder drive.js uses
let _sheetsSubfolderId   = null;

function _authHeader() {
  if (!_driveAccessToken) throw new Error('Not authorized — connect Google Drive first (Tools → Drive).');
  return { Authorization: 'Bearer ' + _driveAccessToken };
}

async function _sheetsFindOrCreateSubfolder() {
  if (_sheetsSubfolderId) return _sheetsSubfolderId;
  const q = `name='${SHEETS_FOLDER_NAME}' and '${PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, { headers: _authHeader() });
  const d = await r.json();
  if (d.files && d.files[0]) { _sheetsSubfolderId = d.files[0].id; return _sheetsSubfolderId; }
  // Not found — create it
  const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ..._authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: SHEETS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [PARENT_FOLDER_ID] })
  });
  const cd = await cr.json();
  if (!cr.ok) throw new Error(cd.error?.message || 'Could not create Sheets folder');
  _sheetsSubfolderId = cd.id;
  return _sheetsSubfolderId;
}

// ── Create a new spreadsheet, place it in the Sheets subfolder ─────────
async function sheetsCreate(title) {
  const cr = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { ..._authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: title || 'Untitled sheet' } })
  });
  const cd = await cr.json();
  if (!cr.ok) throw new Error(cd.error?.message || 'Could not create spreadsheet');
  const spreadsheetId = cd.spreadsheetId;

  // Move it into the Sheets subfolder (Drive API addParents)
  try {
    const folderId = await _sheetsFindOrCreateSubfolder();
    await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}&removeParents=root`, {
      method: 'PATCH', headers: _authHeader()
    });
  } catch (e) {
    // Non-fatal — sheet still exists and is usable, just not filed under the subfolder
    console.warn('sheetsCreate: could not move into Sheets subfolder', e);
  }

  return { spreadsheetId, title: cd.properties?.title || title };
}

// ── Read metadata (tab names/order) for a spreadsheet ───────────────────
async function sheetsGetMeta(spreadsheetId) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`, { headers: _authHeader() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Could not read spreadsheet metadata');
  return {
    title: d.properties?.title,
    tabs: (d.sheets || []).map(s => ({ title: s.properties.title, index: s.properties.index, sheetId: s.properties.sheetId }))
  };
}

// ── Read all tabs' values (FORMATTED_VALUE — already display-ready) ────
async function sheetsGetAllValues(spreadsheetId) {
  const meta = await sheetsGetMeta(spreadsheetId);
  if (!meta.tabs.length) return { title: meta.title, tabs: [] };
  const ranges = meta.tabs.map(t => `ranges=${encodeURIComponent(t.title)}`).join('&');
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=FORMATTED_VALUE`, { headers: _authHeader() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Could not read spreadsheet values');
  const valueRanges = d.valueRanges || [];
  return {
    title: meta.title,
    tabs: meta.tabs.map((t, i) => ({
      tab_name: t.title,
      tab_index: t.index,
      values_json: (valueRanges[i] && valueRanges[i].values) || []
    }))
  };
}

// ── Write a block of values into a (possibly new) tab ───────────────────
// Used by the "Send to Sheets" push flow (plan §3, "Push app data").
async function sheetsWriteTab(spreadsheetId, tabName, rows) {
  // Make sure the tab exists first
  const meta = await sheetsGetMeta(spreadsheetId);
  const exists = meta.tabs.some(t => t.title === tabName);
  if (!exists) {
    const ar = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { ..._authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] })
    });
    if (!ar.ok) { const ad = await ar.json(); throw new Error(ad.error?.message || 'Could not create tab'); }
  }
  const range = `${tabName}!A1`;
  const ur = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { ..._authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: rows })
  });
  const ud = await ur.json();
  if (!ur.ok) throw new Error(ud.error?.message || 'Could not write values');
  return ud;
}

// ── Soft-delete: trash the Drive file (never hard-delete — plan §7) ────
async function sheetsTrash(spreadsheetId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}`, {
    method: 'PATCH',
    headers: { ..._authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true })
  });
  if (!r.ok) { const d = await r.json(); throw new Error(d.error?.message || 'Could not trash file'); }
}

window.sheetsCreate        = sheetsCreate;
window.sheetsGetMeta        = sheetsGetMeta;
window.sheetsGetAllValues  = sheetsGetAllValues;
window.sheetsWriteTab      = sheetsWriteTab;
window.sheetsTrash         = sheetsTrash;

})();
