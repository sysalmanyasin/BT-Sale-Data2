// ══════════════════════════════════════════════════════════════════════
// TELEMETRY STORE — makes the activity history survive a reload.
//
// DEVICE-LOCAL by design (same stance as the local audit ring buffer in audit.js): nothing here is sent
// anywhere, and cross-device history already exists in the `agent_audit` table (tool calls + changes).
// What is stored is a SLIM, REDACTED copy of real events only:
//   • tool arguments are dropped, answer text is dropped, approval lines are dropped
//   • only an allow-list of small metadata fields per event type is kept
//   • AI Center monitoring reads (source 'ai-center' tool_start/tool_end) are not stored (they are noise)
//   • bounded: 7 days and 300 events
// Several tabs are safe: each tab owns the events of its own session id and merges instead of overwriting.
// Pure + injectable storage → unit-testable. Never throws.
// ══════════════════════════════════════════════════════════════════════
export const KEY = 'bt_agent_events_v1';
export const KEEP_MS = 7 * 86400000;
export const MAX_STORED = 300;

const clip = (v, n = 100) => (v == null ? v : String(v).slice(0, n));
const num = v => (Number.isFinite(Number(v)) ? Number(v) : undefined);

// Allow-list: the ONLY metadata fields that are ever persisted, per event type.
const META = {
  request_start: m => ({ question: clip(m.question), specialist: clip(m.specialist, 24) }),
  routed: m => ({ specialist: clip(m.specialist, 24), domains: Array.isArray(m.domains) ? m.domains.slice(0, 4).map(d => clip(d, 24)) : undefined, by: clip(m.by, 12) }),
  step: m => ({ step: num(m.step), max: num(m.max) }),
  tool_start: m => ({ risk: clip(m.risk, 12) }),
  tool_end: m => ({ risk: clip(m.risk, 12), error: clip(m.error, 120), verified: typeof m.verified === 'boolean' ? m.verified : undefined, undoable: typeof m.undoable === 'boolean' ? m.undoable : undefined }),
  approval_requested: m => ({ title: clip(m.title, 80), risk: clip(m.risk, 12), strong: !!m.strong, amount: num(m.amount), reversible: !!m.reversible }),
  approval_resolved: m => ({ risk: clip(m.risk, 12) }),
  specialist_start: m => ({ specialist: clip(m.specialist, 24), domains: Array.isArray(m.domains) ? m.domains.slice(0, 4).map(d => clip(d, 24)) : undefined, mode: clip(m.mode, 16) }),
  specialist_end: m => ({ specialist: clip(m.specialist, 24), mode: clip(m.mode, 16), steps: num(m.steps) }),
  recommendation: m => ({ kind: clip(m.kind, 24), basis: clip(m.basis, 24), title: clip(m.title, 80), risk: clip(m.risk, 12), requires_approval: !!m.requires_approval, reversible: !!m.reversible, specialist: clip(m.specialist, 24) }),
  audit: m => ({ risk: clip(m.risk, 12), approval: clip(m.approval, 16), ok: !!m.ok, undoable: !!m.undoable, sink: clip(m.sink, 12), error: clip(m.error, 120) }),
  undo: m => ({ label: clip(m.label, 80), error: clip(m.error, 120) }),
  verify_start: () => ({}),
  verify_end: m => ({ passed: Array.isArray(m.checks) ? m.checks.filter(c => c && c.ok).length : undefined, total: Array.isArray(m.checks) ? m.checks.length : undefined }),
  answer: m => ({ steps: num(m.steps), chars: num(m.chars) }),
  instant: m => ({ question: clip(m.question), model_used: false }),
  error: m => ({ message: clip(m.message, 140), http_status: num(m.http_status) }),
  retry: m => ({ http_status: num(m.http_status), delay_ms: num(m.delay_ms) }),
  cancelled: () => ({}),
  writes_killed: () => ({}),
  finding_new: m => ({ title: clip(m.title, 120) }),
  finding_cleared: m => ({ title: clip(m.title, 120) }),
  snapshot: m => ({ reads: num(m.reads), findings: num(m.findings), failed: num(m.failed) }),
  voice: m => ({ state: clip(m.state, 16), engine: clip(m.engine, 16) }),
};

/** One live event → its slim storable form, or null if it must not be stored. */
export function toStored(e) {
  if (!e || typeof e.type !== 'string' || !META[e.type] || e.historical) return null;
  if (e.source === 'ai-center' && (e.type === 'tool_start' || e.type === 'tool_end')) return null;
  const meta = META[e.type](e.metadata || {});
  Object.keys(meta).forEach(k => meta[k] === undefined && delete meta[k]);
  return { event_id: e.event_id, timestamp: e.timestamp, type: e.type, source: clip(e.source, 24), agent: clip(e.agent, 32), tool: clip(e.tool, 64), domain: clip(e.domain, 24),
    status: clip(e.status, 16), duration: Number.isFinite(e.duration) ? e.duration : null, severity: clip(e.severity, 12), entity_reference: clip(e.entity_reference, 64), request_id: clip(e.request_id, 32), metadata: meta };
}

function readAll(storage) {
  try { const v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

/** Stored events from earlier sessions, within the retention window, oldest first. */
export function loadStored(storage, now = Date.now()) {
  if (!storage) return [];
  return readAll(storage).filter(e => e && Number.isFinite(e.timestamp) && now - e.timestamp <= KEEP_MS && typeof e.type === 'string');
}

/** Merge this session's live events into storage (other sessions' events are kept). Returns the count stored. */
export function saveSession(storage, sessionId, liveEvents, now = Date.now()) {
  if (!storage) return 0;
  try {
    const mine = (liveEvents || []).map(toStored).filter(Boolean).map(e => ({ ...e, session: sessionId, event_id: sessionId + ':' + e.event_id }));
    const others = readAll(storage).filter(e => e && e.session !== sessionId && Number.isFinite(e.timestamp) && now - e.timestamp <= KEEP_MS);
    const merged = [...others, ...mine].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_STORED);
    storage.setItem(KEY, JSON.stringify(merged));
    return merged.length;
  } catch (_) { return 0; } // storage full or blocked: history just is not kept
}

export function clearStored(storage) { if (!storage) return false; try { storage.removeItem(KEY); return true; } catch (_) { return false; } }

/**
 * Wire it up: load earlier events into the live buffer, then save (debounced) whenever something real happens.
 * @param {{storage, telemetry:{hydrate,subscribe,recent}, setTimeoutFn?, delayMs?}} o
 */
export function startPersistence({ storage, telemetry, setTimeoutFn = setTimeout, delayMs = 800, now = Date.now } = {}) {
  if (!storage || !telemetry) return { stop() {}, flush() {}, sessionId: null };
  const sessionId = 's' + now().toString(36) + Math.random().toString(36).slice(2, 5);
  const loaded = telemetry.hydrate(loadStored(storage, now()).filter(e => e.session !== sessionId));
  let timer = null, stopped = false;
  const flush = () => { timer = null; if (!stopped) saveSession(storage, sessionId, telemetry.recent(1000).reverse(), now()); };
  const unsub = telemetry.subscribe(() => { if (!timer && !stopped) timer = setTimeoutFn(flush, delayMs); });
  return { sessionId, loaded, flush, stop() { stopped = true; unsub(); } };
}
