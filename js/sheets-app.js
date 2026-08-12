// ══════════════════════════════════════════════════════════════════
// SHEETS APP — the new "Sheets" panel inside Notes & Sheets
// ══════════════════════════════════════════════════════════════════
// Replaces the old hand-rolled grid (_nsSpBuild in notes-sheets.js —
// left in place but unreachable, pending deletion once this is
// confirmed working live). Entry point: sheetsAppBuild(host), called
// from notes-sheets.js's _nsRenderPanel() when panel === 'sheets'.
//
// Split by device (plan §0, confirmed by the iframe spike):
//  - Desktop → real Sheets, embedded, fully editable.
//  - Mobile  → styled read-only table from the Supabase cache, with an
//    "Open to edit" handoff — the spike confirmed viewing works fine
//    inside a mobile iframe, but typing does not, so editing happens
//    in the real Sheets app/browser tab, not in-app.
// ══════════════════════════════════════════════════════════════════
(function () {
'use strict';

const POLL_MS = 90_000; // plan §4
let _saHost = null;
let _saPollTimer = null;
let _saCurrentId = null;

function _saIsMobile() {
  return window.innerWidth < 820 || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer:fine)').matches);
}

function _saEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function _saAgo(iso) {
  if (!iso) return 'never synced';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'synced just now';
  if (m < 60) return `synced ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `synced ${h}h ago`;
  return `synced ${Math.floor(h / 24)}d ago`;
}

// ══════════════════════════════════════════════════════════════════
// LIST SCREEN
// ══════════════════════════════════════════════════════════════════
async function sheetsAppBuild(host) {
  _saHost = host;
  host.innerHTML = `
    <div class="sa-list-wrap">
      <div class="sa-list-hd">
        <button class="ns-btn primary" onclick="_saCreate()">➕ New sheet</button>
        <button class="ns-btn" onclick="sheetsAppBuild(document.getElementById('ns-panel-host'))">↻ Refresh list</button>
      </div>
      <div id="sa-list-body"><div style="padding:24px;text-align:center;color:var(--muted);font-size:12px">Loading sheets…</div></div>
    </div>`;
  try {
    const rows = await sbSheetsList();
    _saRenderList(rows);
  } catch (e) {
    document.getElementById('sa-list-body').innerHTML = `<div class="sa-empty">⚠ Couldn't load the sheets list: ${_saEsc(e.message)}</div>`;
  }
}

function _saRenderList(rows) {
  const body = document.getElementById('sa-list-body');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<div class="sa-empty">No sheets yet. Tap "New sheet" to create your first one.</div>`;
    return;
  }
  body.innerHTML = rows.map(r => `
    <div class="sa-card" onclick="_saOpen('${r.spreadsheet_id}','${_saEsc(r.title).replace(/'/g, "\\'")}')">
      <div class="sa-card-main">
        <div class="sa-card-title">${r.pinned ? '📌 ' : ''}${_saEsc(r.title)}</div>
        <div class="sa-card-sub">${_saAgo(r.last_synced_at)}</div>
      </div>
      <div class="sa-card-actions" onclick="event.stopPropagation()">
        <button class="sa-icon-btn" title="${r.pinned ? 'Unpin' : 'Pin'}" onclick="_saTogglePin('${r.spreadsheet_id}', ${!r.pinned})">${r.pinned ? '📌' : '📍'}</button>
        <button class="sa-icon-btn" title="Delete (moves to Drive trash)" onclick="_saDelete('${r.spreadsheet_id}','${_saEsc(r.title).replace(/'/g, "\\'")}')">🗑</button>
      </div>
    </div>`).join('');
}

async function _saTogglePin(id, pinned) {
  try { await sbSheetsSetPinned(id, pinned); sheetsAppBuild(_saHost); } catch (e) { toast('⚠ ' + e.message, 'w'); }
}

async function _saDelete(id, title) {
  if (!confirm(`Move "${title}" to Drive trash? It'll stay recoverable there for 30 days.`)) return;
  try {
    await sheetsTrash(id);
    await sbSheetsSoftDelete(id);
    toast('🗑 Moved to Drive trash');
    sheetsAppBuild(_saHost);
  } catch (e) { toast('⚠ ' + e.message, 'w'); }
}

async function _saCreate() {
  if (!_driveAccessToken) { toast('⚠ Connect Google Drive first (Tools → Drive)', 'w'); return; }
  const title = prompt('Name this sheet:', 'New sheet — ' + new Date().toLocaleDateString('en-PK'));
  if (title === null) return;
  toast('Creating sheet…');
  try {
    const created = await sheetsCreate(title || 'Untitled sheet');
    await sbSheetsInsert(created.spreadsheetId, created.title);
    toast('✅ Sheet created');
    if (_saIsMobile()) {
      _saOpen(created.spreadsheetId, created.title); // nothing to view yet — falls into the "open on desktop / open to edit" mobile view
    } else {
      _saOpenDesktopModal(created.spreadsheetId, created.title);
    }
  } catch (e) { toast('⚠ ' + e.message, 'w'); }
}

function _saOpen(id, title) {
  if (_saIsMobile()) _saOpenMobileView(id, title);
  else _saOpenDesktopModal(id, title);
}

// ══════════════════════════════════════════════════════════════════
// DESKTOP — iframe modal (plan §3 "Edit (desktop)")
// ══════════════════════════════════════════════════════════════════
function _saOpenDesktopModal(id, title) {
  _saCurrentId = id;
  const modal = document.createElement('div');
  modal.className = 'sa-modal';
  modal.id = 'sa-modal';
  modal.innerHTML = `
    <div class="sa-modal-hd">
      <button class="sa-icon-btn" onclick="_saCloseDesktopModal()">← Back</button>
      <div class="sa-modal-title">${_saEsc(title)}</div>
      <div class="sa-modal-status" id="sa-sync-status">syncing…</div>
      <button class="ns-btn" onclick="_saManualSync()">↻ Sync now</button>
    </div>
    <iframe class="sa-iframe" src="https://docs.google.com/spreadsheets/d/${id}/edit?rm=minimal&embedded=true"></iframe>`;
  document.body.appendChild(modal);
  _saPollTimer = setInterval(() => _saSnapshotPull(id, true), POLL_MS);
  _saSnapshotPull(id, true); // initial pull so cache isn't empty if closed immediately
}

function _saCloseDesktopModal() {
  const m = document.getElementById('sa-modal');
  if (m) m.remove();
  if (_saPollTimer) { clearInterval(_saPollTimer); _saPollTimer = null; }
  if (_saCurrentId) _saSnapshotPull(_saCurrentId, false); // force pull on close, plan §4
  _saCurrentId = null;
  sheetsAppBuild(_saHost); // back to list, refreshed
}

async function _saManualSync() {
  if (!_saCurrentId) return;
  await _saSnapshotPull(_saCurrentId, true);
}

async function _saSnapshotPull(id, showBadge) {
  const badge = document.getElementById('sa-sync-status');
  try {
    if (badge) badge.textContent = 'syncing…';
    const data = await sheetsGetAllValues(id);
    await sbCacheWrite(id, data.tabs);
    if (data.title) await sbSheetsTouch(id, { title: data.title });
    if (badge) badge.textContent = '✓ synced just now';
  } catch (e) {
    if (badge) badge.textContent = '⚠ sync failed';
    console.warn('Sheets snapshot pull failed', e);
  }
}

// ══════════════════════════════════════════════════════════════════
// MOBILE — read-only cached view + "Open to edit" handoff (plan §3 "View (mobile/offline)")
// ══════════════════════════════════════════════════════════════════
let _saMobTabs = [];
let _saMobActiveTab = 0;

async function _saOpenMobileView(id, title) {
  _saCurrentId = id;
  _saHost.innerHTML = `
    <div class="sa-mob-wrap">
      <div class="sa-mob-hd">
        <button class="sa-icon-btn" onclick="_saCloseMobileView()">← Back</button>
        <div class="sa-modal-title">${_saEsc(title)}</div>
        <button class="ns-btn primary" onclick="_saOpenToEdit('${id}')">✎ Open to edit</button>
      </div>
      <div class="sa-mob-tabs" id="sa-mob-tabs"></div>
      <div id="sa-mob-table"><div style="padding:24px;text-align:center;color:var(--muted);font-size:12px">Loading cached view…</div></div>
    </div>`;
  try {
    const rows = await sbCacheGet(id);
    if (!rows.length) {
      document.getElementById('sa-mob-table').innerHTML = `<div class="sa-empty">Not available offline yet — open on desktop once, or reconnect and tap "Sync now" there first.</div>`;
      document.getElementById('sa-mob-tabs').innerHTML = '';
      return;
    }
    _saMobTabs = rows;
    _saMobActiveTab = 0;
    _saRenderMobileTabs();
    _saRenderMobileTable();
  } catch (e) {
    document.getElementById('sa-mob-table').innerHTML = `<div class="sa-empty">⚠ Not available offline yet — open on desktop or reconnect. (${_saEsc(e.message)})</div>`;
  }
}

function _saRenderMobileTabs() {
  const el = document.getElementById('sa-mob-tabs');
  if (!el) return;
  el.innerHTML = _saMobTabs.map((t, i) => `<button class="sa-tab-pill ${i === _saMobActiveTab ? 'active' : ''}" onclick="_saSwitchMobileTab(${i})">${_saEsc(t.tab_name)}</button>`).join('');
}

function _saSwitchMobileTab(i) { _saMobActiveTab = i; _saRenderMobileTabs(); _saRenderMobileTable(); }

function _saRenderMobileTable() {
  const el = document.getElementById('sa-mob-table');
  if (!el) return;
  const tab = _saMobTabs[_saMobActiveTab];
  const values = (tab && tab.values_json) || [];
  if (!values.length) { el.innerHTML = `<div class="sa-empty">This tab is empty.</div>`; return; }
  const maxCols = Math.max(...values.map(r => r.length));
  let html = '<div class="sa-table-scroll"><table class="sa-table"><tbody>';
  values.forEach(row => {
    html += '<tr>';
    for (let c = 0; c < maxCols; c++) html += `<td>${_saEsc(row[c] || '')}</td>`;
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  const tab2 = _saMobTabs[_saMobActiveTab];
  html += `<div class="sa-mob-stamp">${_saAgo(tab2 && tab2.snapshot_at)}</div>`;
  el.innerHTML = html;
}

function _saCloseMobileView() { _saCurrentId = null; sheetsAppBuild(_saHost); }

function _saOpenToEdit(id) {
  // Deep link to the Sheets app if installed, else falls through to browser —
  // the OS handles that fallback natively for docs.google.com links.
  window.open(`https://docs.google.com/spreadsheets/d/${id}/edit`, '_blank');
}

// ══════════════════════════════════════════════════════════════════
// PUSH — "Send to Sheets" (plan §3 "Push app data into a sheet", step 7)
// ══════════════════════════════════════════════════════════════════
// One designated "App Data" spreadsheet, auto-created on first use.
// Every push writes a FRESH, timestamped tab rather than overwriting —
// per the explicit decision to keep history (plan §6 decision 3) —
// so past Credit/Petty/Incentive exports stay available for reference.
const APP_DATA_KEY = 'bt_sheets_app_data_id';

async function _saGetOrCreateAppDataSheet() {
  const existing = Repository.getItem(APP_DATA_KEY);
  if (existing) {
    try { await sheetsGetMeta(existing); return existing; } catch (e) { /* file gone/trashed — fall through and recreate */ }
  }
  const created = await sheetsCreate('App Data');
  await sbSheetsInsert(created.spreadsheetId, created.title);
  Actions.saveFeatureData(APP_DATA_KEY, created.spreadsheetId);
  return created.spreadsheetId;
}

// headerRow: array of column labels. dataRows: array of arrays (already
// stringified/formatted — caller decides formatting, same as before).
async function sheetsPushRows(sourceLabel, headerRow, dataRows) {
  if (!_driveAccessToken) { toast('⚠ Connect Google Drive first (Tools → Drive)', 'w'); return; }
  toast('Sending to Sheets…');
  try {
    const spreadsheetId = await _saGetOrCreateAppDataSheet();
    const stamp = new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tabName = `${sourceLabel} — ${stamp}`.slice(0, 100); // Sheets tab-name length limit
    await sheetsWriteTab(spreadsheetId, tabName, [headerRow, ...dataRows]);
    await sbPushRecord(spreadsheetId, tabName, sourceLabel, dataRows.length);
    // Immediate snapshot pull so the cache reflects the push without
    // waiting for the next poll cycle (plan §3 step 3).
    const data = await sheetsGetAllValues(spreadsheetId);
    await sbCacheWrite(spreadsheetId, data.tabs);
    toast(`✅ Sent ${dataRows.length} rows to Sheets → "${tabName}"`);
    return { spreadsheetId, tabName };
  } catch (e) {
    toast('⚠ Send to Sheets failed: ' + e.message, 'w');
  }
}

window.sheetsPushRows    = sheetsPushRows;
window.sheetsAppBuild    = sheetsAppBuild;
window._saCreate         = _saCreate;
window._saOpen           = _saOpen;
window._saTogglePin      = _saTogglePin;
window._saDelete         = _saDelete;
window._saCloseDesktopModal = _saCloseDesktopModal;
window._saManualSync     = _saManualSync;
window._saCloseMobileView = _saCloseMobileView;
window._saSwitchMobileTab = _saSwitchMobileTab;
window._saOpenToEdit     = _saOpenToEdit;

})();
