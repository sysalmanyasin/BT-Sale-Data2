// ══════════════════════════════════════════════════════════════════════
// AUDIT BRIDGE  —  V2 plan §12, "read + re-analyze"
//
// A one-way, read-only peek into Pharmacy Audit Hub's Supabase data —
// NOT a merge, NOT a second copy of its business logic. Reads a few
// already-computed rows (open engagements, active round states,
// assignment/submission counts) straight from Supabase to show on the
// Cover Dashboard tile. Compile/variance/difference logic lives
// entirely in Pharmacy Audit Hub's own actions/ and is deliberately
// not reproduced here — same non-negotiable rule closing-bridge.js
// follows for Closing's financial math.
//
// Unlike Closing (Dropbox, no queryable backend — needs a manual
// "Export Connection" token pasted once), Pharmacy Audit Hub already
// runs on Supabase with Row Level Security as the real isolation
// mechanism, so this bridge queries it directly. The anon/publishable
// key below is the same one already baked into the standalone app
// (js/actions/auth-actions.js's DEFAULT_SUPABASE_ANON_KEY) — safe to
// expose by design, since RLS (not key secrecy) is what actually
// protects the data. This bridge never authenticates as anyone; it
// only ever runs SELECTs, scoped by whatever RLS already allows an
// anonymous/publishable-key request to see.
//
// Real ES module — only the entry points HTML/other modules need are
// bridged to `window` at the bottom, same pattern as closing-bridge.js.
// ══════════════════════════════════════════════════════════════════════

import { AUDIT_HUB_URL, AUDIT_HUB_PUBLISHABLE_KEY } from '../shared/backend-config.js';
import { isPaused } from '../platform/hub-gate.js';
const AUDIT_SUPABASE_URL = AUDIT_HUB_URL;
const AUDIT_SUPABASE_ANON_KEY = AUDIT_HUB_PUBLISHABLE_KEY;
const CACHE_KEY = 'bt_audit_cache_v1'; // local-only summary cache
const MIN_REFRESH_MS = 5 * 60 * 1000;  // don't hit Supabase more than once per 5 min, same rate limit as Closing

let _client = null;
let _inFlight = null;

function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  // persistSession/autoRefreshToken/detectSessionInUrl: false — pure anon
  // client, isolated from the session inventory-bridge.js's client shares
  // via localStorage with the Google sign-in flow (same project URL).
  _client = supabase.createClient(AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return _client;
}

// Always "connected" — no manual pairing step needed, unlike Closing's
// Dropbox token. Kept as a function (not a constant) so cover-dashboard.js
// can call it the same way it calls ClosingBridge.isConnected().
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

// ── Summarize (reads already-computed rows only — see header note) ──
function _summarize(engagements, rounds, assignments, submissions) {
  const roundsByEngagement = {};
  (rounds || []).forEach(r => {
    (roundsByEngagement[r.engagement_id] = roundsByEngagement[r.engagement_id] || []).push(r);
  });
  const submittedByRound = {};
  (submissions || []).forEach(s => {
    submittedByRound[s.round_id] = (submittedByRound[s.round_id] || 0) + 1;
  });
  const assignedByRound = {};
  (assignments || []).forEach(a => {
    if (a.status === 'revoked') return;
    assignedByRound[a.round_id] = (assignedByRound[a.round_id] || 0) + 1;
  });

  const items = (engagements || []).map(e => {
    const rs = roundsByEngagement[e.id] || [];
    const active = rs.find(r => ['draft', 'locked', 'counting'].includes(r.state))
                || rs.sort((a, b) => b.round_number - a.round_number)[0];
    const assigned = active ? (assignedByRound[active.id] || 0) : 0;
    const submitted = active ? (submittedByRound[active.id] || 0) : 0;
    return {
      name: e.name,
      roundState: active ? active.state : 'no rounds yet',
      roundNumber: active ? active.round_number : null,
      assigned, submitted,
    };
  });

  return { fetchedAt: Date.now(), items };
}

// ── Public: cached summary for Cover Dashboard (sync, no network) ───
export function getCachedSummary() { return _loadCache(); }

// ── Public: refresh from Supabase (async, rate-limited) ─────────────
export async function refresh(force) {
  const cached = _loadCache();
  if (isPaused()) { _renderStatusLine('Hub paused'); return cached; } // egress gate: no network while paused
  if (!force && cached && (Date.now() - cached.fetchedAt) < MIN_REFRESH_MS) return cached;
  if (_inFlight) return _inFlight; // de-dupe concurrent callers

  _inFlight = (async () => {
    try {
      _renderStatusLine('Syncing…');
      const client = _getClient();
      if (!client) { _renderStatusLine('Supabase not loaded yet'); return cached; }

      const { data: engagements } = await client
        .from('engagements').select('id,name,status').eq('status', 'open');
      const { data: rounds } = await client
        .from('rounds').select('id,engagement_id,round_number,state');
      const { data: assignments } = await client
        .from('assignments').select('id,round_id,status');
      const { data: submissions } = await client
        .from('submissions').select('id,round_id');

      const summary = _summarize(engagements, rounds, assignments, submissions);
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
  const el = document.getElementById('audit-bridge-status');
  if (el) el.textContent = text;
}

// Called once when the Audit page is shown (see ui.js's showPage).
export function refreshOnPageShow() { refresh(false); }

// ═══════════════════════════════════════════════════════════════════
// FULL DATA — Assignments Overview + Live Snapshot popup (audit-native.js)
// Deliberately separate from refresh()/getCachedSummary() above: this
// pulls item_snapshot/live_snapshot, which can be a real amount of data
// on a big engagement — only fetched when the Assignments page is
// actually opened, not on every 5-min Cover Dashboard tile refresh.
// ═══════════════════════════════════════════════════════════════════
let _fullData = null;
let _fullInFlight = null;
const FULLDATA_CACHE_KEY = 'bt_audit_fulldata_v1';
const FULLDATA_MIN_REFRESH_MS = 60 * 1000; // 1 min — this is opened deliberately, so keep it fresher than the tile

export function getFullData() {
  if (_fullData) return _fullData;
  try { const raw = _getLocal(FULLDATA_CACHE_KEY); if (raw) return (_fullData = JSON.parse(raw)); } catch (e) { /* fall through */ }
  return null;
}

export async function refreshFullData(force) {
  if (isPaused()) return getFullData(); // egress gate: no network while paused
  const cached = _fullData;
  if (!force && cached && (Date.now() - cached.fetchedAt) < FULLDATA_MIN_REFRESH_MS) return cached;
  if (_fullInFlight) return _fullInFlight;

  _fullInFlight = (async () => {
    try {
      const client = _getClient();
      if (!client) return cached;

      // (2026-11 egress cleanup) rounds.item_snapshot and final_snapshots.report are the
      // heaviest columns here and are IMMUTABLE once a row exists (Random never updates
      // either: updateRound has no item_snapshot field, final_snapshots is insert-only).
      // So fetch only the light columns every time, and the heavy ones only for ids this
      // device has not downloaded yet. assignments.items and compiled_rounds.variances CAN
      // change (manual transfers, recompiles) and there is no updated_at to detect that,
      // so those are still fetched in full, exactly as before.
      const known = getFullData() || {};
      const knownSnap = new Map((known.rounds || []).filter(r => r.item_snapshot !== undefined).map(r => [r.id, r.item_snapshot]));
      const knownReport = new Map((known.finalSnapshots || []).filter(f => f.report !== undefined).map(f => [f.id, f.report]));

      const [{ data: engagements }, { data: roundsLight }, { data: assignments }, { data: compiledRounds }, { data: snapsLight }] = await Promise.all([
        client.from('engagements').select('id,name,status,scope_type,scope_companies,scope_codes,created_at'),
        client.from('rounds').select('id,engagement_id,round_number,round_suffix,unit,state,base_round_id,created_at,locked_at,compiled_at,finalized_at'),
        client.from('assignments').select('id,round_id,engagement_id,auditor_id,auditor_name,unit,companies,items,method,status,progress_count,live_snapshot,created_at'),
        client.from('compiled_rounds').select('id,round_id,variances,compiled_with_missing,missing_assignment_ids,compiled_at'),
        client.from('final_snapshots').select('id,engagement_id,generated_at').order('generated_at', { ascending: false }),
      ]);

      // Heavy column for ids we do not hold yet (chunked so the .in() URL stays short). Any
      // error throws -> outer catch keeps the last good copy, never a half-empty one.
      async function fetchHeavy(table, col, ids, into) {
        for (let i = 0; i < ids.length; i += 40) {
          const { data: part, error } = await client.from(table).select('id,' + col).in('id', ids.slice(i, i + 40));
          if (error) throw error;
          (part || []).forEach(row => into.set(row.id, row[col]));
        }
      }
      await fetchHeavy('rounds', 'item_snapshot', (roundsLight || []).filter(r => !knownSnap.has(r.id)).map(r => r.id), knownSnap);
      await fetchHeavy('final_snapshots', 'report', (snapsLight || []).filter(f => !knownReport.has(f.id)).map(f => f.id), knownReport);

      const rounds = (roundsLight || []).map(r => Object.assign({}, r, { item_snapshot: knownSnap.has(r.id) ? knownSnap.get(r.id) : null }));
      const finalSnapshots = (snapsLight || []).map(f => Object.assign({}, f, { report: knownReport.has(f.id) ? knownReport.get(f.id) : null }));

      const data = { engagements: engagements || [], rounds, assignments: assignments || [], compiledRounds: compiledRounds || [], finalSnapshots, fetchedAt: Date.now() };
      _fullData = data;
      try { _setLocal(FULLDATA_CACHE_KEY, JSON.stringify(data)); } catch (e) { /* best-effort — fine if too big, _fullData in-memory still works this session */ }
      if (typeof window.auditNativeOnRefresh === 'function') window.auditNativeOnRefresh();
      return data;
    } catch (e) {
      return _fullData;
    } finally {
      _fullInFlight = null;
    }
  })();
  return _fullInFlight;
}

// ═══════════════════════════════════════════════════════════════════
// AI OVERVIEW — one read-only Postgres function (ai_audit_overview, see supabase/audit-project/ai_audit_overview.sql)
// that returns ONLY aggregates: open-audit progress, shortage/excess value, top variance items, pending variance
// suggestions, near-expiry stock, barcode conflicts, staff access. No customer/auditor names, no raw count rows.
// Read by the BT Intelligence Audit tab and the assistant's audit_overview / audit_expiry tools.
// ═══════════════════════════════════════════════════════════════════
const AI_CACHE_KEY = 'bt_audit_ai_v1';
const AI_MIN_REFRESH_MS = 2 * 60 * 1000;
let _ai = null, _aiInFlight = null;

export function getAiOverview() {
  if (_ai) return _ai;
  try { const raw = _getLocal(AI_CACHE_KEY); if (raw) return (_ai = JSON.parse(raw)); } catch (e) { /* fall through */ }
  return null;
}

export async function refreshAiOverview(force) {
  const cached = getAiOverview();
  if (isPaused()) return cached; // egress gate: no network while paused
  if (!force && cached && (Date.now() - cached.fetchedAt) < AI_MIN_REFRESH_MS) return cached;
  if (_aiInFlight) return _aiInFlight;
  _aiInFlight = (async () => {
    try {
      const client = _getClient();
      if (!client) return cached;
      const { data, error } = await client.rpc('ai_audit_overview');
      if (error) throw error;
      const out = Object.assign({}, data || {}, { fetchedAt: Date.now() });
      _ai = out; _setLocal(AI_CACHE_KEY, JSON.stringify(out));
      return out;
    } catch (e) {
      return cached; // keep showing the last good copy; the page marks it stale by fetchedAt
    } finally { _aiInFlight = null; }
  })();
  return _aiInFlight;
}

// Bridged — see header note.
window.auditBridgeGetAiOverview = getAiOverview;
window.auditBridgeRefreshAiOverview = refreshAiOverview;
window.auditBridgeRefresh = refreshOnPageShow;
window.auditBridgeIsConnected = isConnected;
window.auditBridgeGetCachedSummary = getCachedSummary;
