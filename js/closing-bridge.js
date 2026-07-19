// ══════════════════════════════════════════════════════════════════════
// CLOSING BRIDGE  —  V2 plan §6, "read + re-analyze"
//
// A one-way, read-only peek into the standalone Closing app's data —
// NOT a merge, NOT a second copy of its business logic. Reads a few
// already-computed tables straight from Supabase (sheets / credit_ledger
// / settings / activity_log) and reassembles the same `{settings,
// sheets, creditLedger, activityLog}` shape Closing's own db object
// uses, then reads a few already-computed fields off it (outNetSale /
// finalNetSale, draft/locked) to show on the Cover Dashboard tile. It
// never recomputes Closing's financial math itself — variance/target-
// pace formulas live in Closing's own actions.js and are deliberately
// not reproduced here, so there's zero risk of this app quietly
// drifting out of sync with how Closing actually calculates something.
//
// Also reads staff_presence (see Closing's supabase/staff_presence.sql)
// on its own, faster refresh cadence — Closing's auth.js heartbeats a
// row every 30s while a staff member is logged in; getOnlineStaff()
// below just filters that by recency, same "online = seen in the last
// 2 min" convention BT's own bt_sessions/sync-center.js already uses.
//
// HISTORY: this used to pair with Closing over Dropbox (a manually
// pasted "Export Connection" token decoding to {appKey, refreshToken},
// downloading a single JSON blob file). Closing migrated its own sync
// engine to Supabase (see its js/sync.js — Project URL + anon key,
// four real Postgres tables instead of one blob) and its Export
// Connection token now decodes to {url, anonKey} instead — the two
// bridges no longer speak the same protocol, which is why re-pasting
// a freshly-exported token kept failing with "Token is incomplete."
// This file now mirrors audit-bridge.js instead: same Supabase
// project Closing itself already writes to, queried directly.
//
// Same trust model as audit-bridge.js: the anon/publishable key below
// is safe to expose by design — Row Level Security (not key secrecy)
// is what actually scopes what an anonymous/publishable-key request
// can see. This bridge never authenticates as anyone; it only ever
// runs SELECTs.
//
// Real ES module — only the entry points HTML/other modules need are
// bridged to `window` at the bottom, same pattern as audit-bridge.js.
// ══════════════════════════════════════════════════════════════════════

const CLOSING_SUPABASE_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const CLOSING_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

const CACHE_KEY      = 'bt_closing_cache_v1';     // local-only summary cache
const FULLDB_CACHE_KEY = 'bt_closing_fulldb_v1';  // local-only, best-effort persistence across reloads
const MIN_REFRESH_MS = 5 * 60 * 1000;             // don't hit Supabase more than once per 5 min

const PRESENCE_CACHE_KEY    = 'bt_closing_presence_v1';
const PRESENCE_MIN_REFRESH_MS = 60 * 1000;  // presence should feel live — refresh more often than the shift summary
const PRESENCE_STALE_MS     = 2 * 60 * 1000; // "online" = a heartbeat in the last 2 min, same window sync-center.js uses

let _client = null;
let _inFlight = null;
let _fullDb = null; // in-memory cache of the reassembled Closing db — see getFullDb()
let _presenceInFlight = null;

function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _client = supabase.createClient(CLOSING_SUPABASE_URL, CLOSING_SUPABASE_ANON_KEY);
  return _client;
}

// Always "connected" — baked-in key, no manual pairing step needed
// anymore. Kept as a function so cover-dashboard.js/closing-native.js
// don't need to change how they call it.
export function isConnected() { return true; }

function _setLocal(key, val) {
  try { localStorage.setItem(key, val); } catch (e) { /* best-effort */ }
}
function _getLocal(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function _loadCache() {
  try { return JSON.parse(_getLocal(CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function _saveCache(summary) { _setLocal(CACHE_KEY, JSON.stringify(summary)); }

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

// ── Public: cached summary for Cover Dashboard (sync, no network) ───
export function getCachedSummary() { return _loadCache(); }

// ── Public: the full reassembled Closing db — Closing Book and Credit
// Ledger (closing-native.js) read this directly. Same shape Closing's
// own sync.js pull assembles: {settings, sheets, creditLedger, activityLog}.
export function getFullDb() {
  if (_fullDb) return _fullDb;
  try { const raw = _getLocal(FULLDB_CACHE_KEY); if (raw) return (_fullDb = JSON.parse(raw)); } catch (e) { /* fall through */ }
  return null;
}

// ── Public: who saved a given sheet — the most recent 'save' or
// 'save-final' Activity Log entry for that key, if any. Draft-only
// keys (autosave never logs, see Closing's activity-log.js) have no
// entry, so this returns null for those, same as "no closing yet".
export function getSavedBy(key) {
  const cdb = getFullDb();
  const entries = (cdb && cdb.activityLog) || [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.key === key && (e.action === 'save' || e.action === 'save-final')) return e.actor || null;
  }
  return null;
}

// ── Public: staff currently logged into Closing — see
// supabase/staff_presence.sql. Filters by recency at read time (not
// baked into the cache) so "online" stays accurate between the
// heartbeat's own 30s ticks and this reader's slower refresh cadence.
export function getOnlineStaff() {
  let rows = [];
  try { rows = JSON.parse(_getLocal(PRESENCE_CACHE_KEY) || '[]'); } catch (e) { rows = []; }
  const now = Date.now();
  return rows.filter(r => (now - new Date(r.last_seen).getTime()) < PRESENCE_STALE_MS);
}

export async function refreshOnlineStaff(force) {
  const lastAt = Number(_getLocal(PRESENCE_CACHE_KEY + '_at') || 0);
  if (!force && lastAt && (Date.now() - lastAt) < PRESENCE_MIN_REFRESH_MS) return getOnlineStaff();
  if (_presenceInFlight) return _presenceInFlight; // de-dupe concurrent callers

  _presenceInFlight = (async () => {
    try {
      const client = _getClient();
      if (!client) return getOnlineStaff();
      const { data, error } = await client.from('staff_presence').select('staff_id, name, last_seen');
      if (error) throw error;
      _setLocal(PRESENCE_CACHE_KEY, JSON.stringify(data || []));
      _setLocal(PRESENCE_CACHE_KEY + '_at', String(Date.now()));
      if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard();
      return getOnlineStaff();
    } catch (e) {
      return getOnlineStaff();
    } finally {
      _presenceInFlight = null;
    }
  })();
  return _presenceInFlight;
}

// ── Public: refresh from Supabase (async, rate-limited) ──────────────
export async function refresh(force) {
  const cached = _loadCache();
  if (!force && cached && (Date.now() - cached.fetchedAt) < MIN_REFRESH_MS) return cached;
  if (_inFlight) return _inFlight; // de-dupe concurrent callers

  _inFlight = (async () => {
    try {
      _renderStatusLine('Syncing…');
      const client = _getClient();
      if (!client) { _renderStatusLine('Supabase not loaded yet'); return cached; }

      const [sheetsRes, clRes, settingsRes, alRes] = await Promise.all([
        client.from('sheets').select('key, data'),
        client.from('credit_ledger').select('key, data'),
        client.from('settings').select('data, updated_at').eq('id', 1).maybeSingle(),
        client.from('activity_log').select('ts, actor, key, action, changes').order('ts', { ascending: true }),
      ]);
      if (sheetsRes.error) throw sheetsRes.error;
      if (clRes.error) throw clRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (alRes.error) throw alRes.error;

      const closingDb = {
        settings:     settingsRes.data?.data || null,
        sheets:       Object.fromEntries((sheetsRes.data || []).map(r => [r.key, r.data])),
        creditLedger: (clRes.data || []).map(r => r.data),
        activityLog:  alRes.data || [],
      };

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
  if (el) el.textContent = text;
}

// Called once when the Closing page is shown (see ui.js's showPage).
export function refreshOnPageShow() { refresh(false); }

// Bridged — see header note.
window.closingBridgeRefresh = refreshOnPageShow;
window.closingBridgeIsConnected = isConnected;
window.closingBridgeGetCachedSummary = getCachedSummary;
window.closingBridgeGetOnlineStaff = getOnlineStaff;

// ── Auto-refresh, always on — baked-in key means there's no
// connect/disconnect state to gate this behind anymore, same as
// audit-bridge.js. Cover Dashboard tile stays fresh even if the user
// never taps into a page that would otherwise trigger a refresh.
refresh(false);
setInterval(() => { refresh(false); }, MIN_REFRESH_MS);

// Presence refreshes on its own, faster loop — see PRESENCE_MIN_REFRESH_MS.
refreshOnlineStaff(false);
setInterval(() => { refreshOnlineStaff(false); }, PRESENCE_MIN_REFRESH_MS);
