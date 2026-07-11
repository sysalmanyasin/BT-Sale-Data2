// ══════════════════════════════════════════════════════════════════════
// CLOSING BRIDGE  —  V2 plan §6, "read + re-analyze"
//
// A one-way, read-only peek into the standalone Closing app's data —
// NOT a merge, NOT a second copy of its business logic. Closing
// (closing.duapharma.com) already pushes its full `db` blob to Dropbox
// at a fixed path after every save; this module just downloads that
// same file and reads a few already-computed fields straight off it
// (outNetSale / finalNetSale, draft/locked) to show on the Cover
// Dashboard tile. It never recomputes Closing's financial math itself
// — variance/target-pace formulas live in Closing's own actions.js and
// are deliberately not reproduced here, so there's zero risk of this
// app quietly drifting out of sync with how Closing actually
// calculates something.
//
// Auth: uses the SAME "Export Connection" token Closing's own Settings
// page already generates for moving a connection between devices (see
// its sync.js — dbxExportConnection/_dbxApplyImportToken). Paste that
// token once here; nothing new needs registering on Dropbox's side.
// The decoded {appKey, refreshToken} is stored local-only (never sent
// through Supabase sync) — same treatment Closing itself gives it.
//
// Real ES module — imports Repository directly for local-only storage.
// Only the two entry points HTML onclick handlers need are bridged to
// `window` at the bottom, same pattern as every other Floor 5 module.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';

const APPKEY_KEY  = 'bt_closing_dbx_appkey';   // local-only, not synced
const REFRESH_KEY = 'bt_closing_dbx_refresh';  // local-only, not synced
const CACHE_KEY    = 'bt_closing_cache_v1';     // local-only summary cache
const SYNC_FILE_PATH = '/pharmpos_sync_data.json';
const MIN_REFRESH_MS = 5 * 60 * 1000; // don't hit Dropbox more than once per 5 min

let _accessToken = null;
let _accessTokenExpiresAt = 0;
let _inFlight = null;

function _getAppKey()  { return Repository.getItem(APPKEY_KEY)  || ''; }
function _getRefresh() { return Repository.getItem(REFRESH_KEY) || ''; }
function _setLocal(key, val) {
  // Deliberately NOT Actions.saveFeatureData — this is a local secret,
  // same as how Closing's own sync.js keeps its Dropbox token local-only
  // and never pushes it through cloud sync.
  try { localStorage.setItem(key, val); } catch (e) { /* best-effort */ }
}
function _getLocal(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

export function isConnected() { return !!(_getAppKey() && _getRefresh()); }

// ── Connect / disconnect ────────────────────────────────────────────
export function connectPrompt() {
  const raw = window.prompt(
    'Paste the connection token exported from Closing:\n\n' +
    'On closing.duapharma.com → ⚙️ Settings → Cloud Sync → Export Connection\n' +
    '(copies to clipboard automatically — just paste it here)'
  );
  if (!raw) return;
  let parsed;
  try { parsed = JSON.parse(atob(raw.trim())); } catch (e) {
    alert('That doesn\'t look like a valid connection token — copy it again from Closing\'s Settings.');
    return;
  }
  if (!parsed.appKey || !parsed.refreshToken) {
    alert('Token is incomplete — export it again from Closing.');
    return;
  }
  _setLocal(APPKEY_KEY, parsed.appKey);
  _setLocal(REFRESH_KEY, parsed.refreshToken);
  _accessToken = null; // force re-exchange
  if (typeof window.toast === 'function') window.toast('✓ Connected — fetching latest closing data…');
  refresh(true);
}

export function disconnect() {
  if (!window.confirm('Disconnect the Closing data bridge? The embedded app itself is unaffected.')) return;
  try {
    localStorage.removeItem(APPKEY_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(CACHE_KEY);
  } catch (e) { /* best-effort */ }
  _accessToken = null;
  _renderStatusLine('Not connected');
  if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();
}

// ── OAuth: exchange refresh token for a short-lived access token ────
async function _getAccessToken() {
  if (_accessToken && Date.now() < _accessTokenExpiresAt) return _accessToken;
  const appKey = _getAppKey();
  const refreshToken = _getRefresh();
  if (!appKey || !refreshToken) throw new Error('not connected');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey,
  });
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('Dropbox token exchange failed (' + res.status + ')');
  const json = await res.json();
  _accessToken = json.access_token;
  _accessTokenExpiresAt = Date.now() + ((json.expires_in || 14400) - 60) * 1000; // 1 min safety margin
  return _accessToken;
}

async function _downloadSyncFile() {
  const token = await _getAccessToken();
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({ path: SYNC_FILE_PATH }),
    },
  });
  if (!res.ok) throw new Error('Dropbox download failed (' + res.status + ')');
  return res.json();
}

// ── Summarize (reads already-computed fields only — see header note) ─
const SHIFT_ORDER = ['Night', 'Morning', 'Evening']; // Night starts the day, per Closing's own convention
function _todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _summarize(closingDb) {
  const today = _todayISO();
  const sheets = (closingDb && closingDb.sheets) || {};
  const shifts = SHIFT_ORDER.map(shift => {
    const rec = sheets[today + '_' + shift];
    if (!rec) return { shift, status: 'pending' };
    if (rec.draft && !rec.locked) return { shift, status: 'draft' };
    const netSale = rec.profileMode === 'final' ? rec.finalNetSale : rec.outNetSale;
    return { shift, status: 'closed', netSale: netSale || 0 };
  });
  return { fetchedAt: Date.now(), today, shifts };
}

function _loadCache() {
  try { return JSON.parse(_getLocal(CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function _saveCache(summary) { _setLocal(CACHE_KEY, JSON.stringify(summary)); }

// ── Public: cached summary for Cover Dashboard (sync, no network) ───
export function getCachedSummary() { return _loadCache(); }

// ── Public: refresh from Dropbox (async, rate-limited) ──────────────
export async function refresh(force) {
  if (!isConnected()) return null;
  const cached = _loadCache();
  if (!force && cached && (Date.now() - cached.fetchedAt) < MIN_REFRESH_MS) return cached;
  if (_inFlight) return _inFlight; // de-dupe concurrent callers

  _inFlight = (async () => {
    try {
      _renderStatusLine('Syncing…');
      const closingDb = await _downloadSyncFile();
      const summary = _summarize(closingDb);
      _saveCache(summary);
      _renderStatusLine('Synced ' + new Date(summary.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }));
      if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();
      return summary;
    } catch (e) {
      _renderStatusLine('Sync failed — ' + e.message);
      return _loadCache();
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

function _renderStatusLine(text) {
  const el = document.getElementById('closing-bridge-status');
  if (el) el.textContent = isConnected() ? text : 'Not connected';
}

// Called once when the Closing page is shown (see ui.js's showPage).
export function refreshOnPageShow() {
  if (!isConnected()) { _renderStatusLine('Not connected'); return; }
  refresh(false);
}

// Toolbar button — behaves differently depending on connection state,
// so one button covers connect / refresh / disconnect without clutter.
export function buttonClick() {
  if (!isConnected()) { connectPrompt(); return; }
  const choice = window.prompt(
    'Closing data bridge is connected.\n\nType:\n  "refresh" to sync now\n  "disconnect" to remove the connection\n\n(or Cancel to do nothing)'
  );
  if (!choice) return;
  const c = choice.trim().toLowerCase();
  if (c === 'refresh') refresh(true);
  else if (c === 'disconnect') disconnect();
}

// Bridged — see header note.
window.closingBridgeConnectPrompt = connectPrompt;
window.closingBridgeDisconnect = disconnect;
window.closingBridgeRefresh = refreshOnPageShow;
window.closingBridgeButtonClick = buttonClick;
window.closingBridgeIsConnected = isConnected;
window.closingBridgeGetCachedSummary = getCachedSummary;
