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

const AUDIT_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const AUDIT_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';
const CACHE_KEY = 'bt_audit_cache_v1'; // local-only summary cache
const MIN_REFRESH_MS = 5 * 60 * 1000;  // don't hit Supabase more than once per 5 min, same rate limit as Closing

let _client = null;
let _inFlight = null;

function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _client = supabase.createClient(AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY);
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

// Bridged — see header note.
window.auditBridgeRefresh = refreshOnPageShow;
window.auditBridgeIsConnected = isConnected;
window.auditBridgeGetCachedSummary = getCachedSummary;
