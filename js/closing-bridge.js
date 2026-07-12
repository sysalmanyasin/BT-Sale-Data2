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

const APPKEY_KEY   = 'bt_closing_dbx_appkey';   // local-only, not synced
const REFRESH_KEY  = 'bt_closing_dbx_refresh';  // local-only, not synced
const DISABLED_KEY = 'bt_closing_dbx_disabled'; // explicit user opt-out flag
const CACHE_KEY     = 'bt_closing_cache_v1';     // local-only summary cache
const SYNC_FILE_PATH = '/pharmpos_sync_data.json';
const MIN_REFRESH_MS = 5 * 60 * 1000; // don't hit Dropbox more than once per 5 min

// No baked-in default connection — unlike the Supabase anon key in
// audit-bridge.js (safe to expose by design; RLS is the real
// protection), a Dropbox app key + refresh token grants real account
// access and must never be committed to source. Each device must pair
// via connectPrompt() (the "Export Connection" token from Closing's
// own Settings page); the pairing is then stored local-only.

let _accessToken = null;
let _accessTokenExpiresAt = 0;
let _inFlight = null;
let _fullDb = null; // in-memory cache of the full downloaded Closing db — see getFullDb()
const FULLDB_CACHE_KEY = 'bt_closing_fulldb_v1'; // local-only, best-effort persistence across reloads

function _isDisabled()   { return _getLocal(DISABLED_KEY) === '1'; }
function _getAppKey()    { return _isDisabled() ? '' : (Repository.getItem(APPKEY_KEY)  || ''); }
function _getRefresh()   { return _isDisabled() ? '' : (Repository.getItem(REFRESH_KEY) || ''); }
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
  try { localStorage.removeItem(DISABLED_KEY); } catch (e) { /* best-effort */ }
  _accessToken = null; // force re-exchange
  if (typeof window.toast === 'function') window.toast('✓ Connected — fetching latest closing data…');
  refresh(true);
}

export function disconnect() {
  if (!window.confirm('Disconnect the Closing data bridge? Closing itself is unaffected.')) return;
  try {
    localStorage.removeItem(APPKEY_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(CACHE_KEY);
    // Explicit opt-out — without this the baked-in default connection
    // (see DEFAULT_APPKEY/DEFAULT_REFRESH) would just take back over.
    localStorage.setItem(DISABLED_KEY, '1');
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

// ── Public: the full downloaded Closing db — Closing Book and Credit
// Ledger (closing-native.js) read this directly. Same download as the
// tile summary above, nothing extra fetched; this just stops discarding
// everything except the 3 shift statuses after computing that summary.
export function getFullDb() {
  if (_fullDb) return _fullDb;
  try { const raw = _getLocal(FULLDB_CACHE_KEY); if (raw) return (_fullDb = JSON.parse(raw)); } catch (e) { /* fall through */ }
  return null;
}

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
      _fullDb = closingDb;
      try { _setLocal(FULLDB_CACHE_KEY, JSON.stringify(closingDb)); } catch (e) { /* best-effort — fine if it's too big for localStorage, _fullDb in-memory still works this session */ }
      const summary = _summarize(closingDb);
      _saveCache(summary);
      _renderStatusLine('Synced ' + new Date(summary.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }));
      if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();
      if (typeof window.closingNativeOnRefresh === 'function') window.closingNativeOnRefresh();
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

// ── Auto-refresh once connected ─────────────────────────────────────
// If this device has already paired via connectPrompt(), kick off an
// immediate fetch and keep it current on the same cadence refresh()
// itself rate-limits to — so the Cover Dashboard tile is fresh even if
// the user never taps into the Sales/Manager pages that would
// otherwise trigger a refresh. On a fresh install/device, isConnected()
// is false until the user pastes an Export Connection token.
if (isConnected()) {
  refresh(false);
  setInterval(() => { refresh(false); }, MIN_REFRESH_MS);
}
