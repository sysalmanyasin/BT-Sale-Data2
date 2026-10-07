// ══════════════════════════════════════════════════════════════════════
// AGENT TELEMETRY — the smallest possible real-event layer.
//
// runAgent() (agent-client.js) and the panel emit an event for things that
// ACTUALLY happen: a request starting, a specialist being routed, a tool
// starting / ending, an approval being asked for / answered, an answer, an
// error. The AI Center subscribes. Nothing here invents events.
//
// Pure module (no DOM, no Supabase, no storage): unit-testable, in-memory
// only (a ring buffer), so nothing sensitive is persisted by this layer.
// Tool arguments are REDACTED before they are stored.
//
// Event shape (matches the AI Center spec):
//   { event_id, timestamp, type, source, agent, tool, domain, status,
//     duration, severity, entity_reference, request_id, metadata }
// ══════════════════════════════════════════════════════════════════════

export const MAX_EVENTS = 400;
const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|bearer|service[_-]?role|credential|cnic|phone|mobile|address|email|pin\b/i;
const MAX_STR = 140;

let _events = [];
let _seq = 0;
const _subs = new Set();

/** Deep-copy `v` with secret-looking keys masked and long strings clipped. */
export function redact(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
  if (typeof v !== 'object') return v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) return v.slice(0, 8).map(x => redact(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(val, depth + 1);
  return out;
}

/** Record one real event. Returns the stored event. Never throws. */
export function emit(evt) {
  try {
    const e = {
      event_id: 'ev_' + (++_seq),
      timestamp: Date.now(),
      type: String((evt && evt.type) || 'event'),
      source: evt.source || 'agent',
      agent: evt.agent || null,
      tool: evt.tool || null,
      domain: evt.domain || null,
      status: evt.status || null,
      duration: Number.isFinite(evt.duration) ? Math.round(evt.duration) : null,
      severity: evt.severity || 'info',
      entity_reference: evt.entity_reference || null,
      request_id: evt.request_id || null,
      metadata: redact(evt.metadata || {}),
    };
    _events.push(e);
    if (_events.length > MAX_EVENTS) _events = _events.slice(-MAX_EVENTS);
    _subs.forEach(fn => { try { fn(e); } catch (_) { /* one bad listener must not break others */ } });
    return e;
  } catch (_) { return null; }
}

/**
 * Load events recorded in EARLIER sessions (from telemetry-store.js) in front of this session's events.
 * They are flagged `historical`: they feed history, stats and the timeline, but never make the Center think a
 * request is still running (a tab closed mid-request must not look like BT is working forever).
 */
export function hydrate(events) {
  try {
    const old = (events || []).filter(e => e && typeof e.type === 'string' && Number.isFinite(e.timestamp)).map((e, i) => ({
      event_id: 'h_' + (e.event_id || i), timestamp: e.timestamp, type: e.type, source: e.source || 'agent', agent: e.agent || null, tool: e.tool || null, domain: e.domain || null,
      status: e.status || null, duration: Number.isFinite(e.duration) ? e.duration : null, severity: e.severity || 'info', entity_reference: e.entity_reference || null,
      request_id: e.request_id || null, metadata: e.metadata && typeof e.metadata === 'object' ? e.metadata : {}, historical: true,
    }));
    const seen = new Set(_events.filter(e => e.historical).map(e => e.event_id));
    const fresh = old.filter(e => !seen.has(e.event_id));
    _events = [...fresh, ..._events].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_EVENTS);
    return fresh.length;
  } catch (_) { return 0; }
}

export function subscribe(fn) { _subs.add(fn); return () => _subs.delete(fn); }
export function recent(limit = 100, predicate = null) {
  const list = predicate ? _events.filter(predicate) : _events;
  return list.slice(-limit).reverse(); // newest first
}
export function clear() { _events = []; _seq = 0; }

/** Per-tool stats from tool_end events: calls, ok, failed, avg ms, last used. */
export function toolStats() {
  const by = new Map();
  for (const e of _events) {
    if (e.type !== 'tool_end' || !e.tool) continue;
    const o = by.get(e.tool) || { tool: e.tool, calls: 0, ok: 0, failed: 0, rejected: 0, ms: 0, msN: 0, lastAt: 0, lastStatus: null };
    o.calls++;
    if (e.status === 'ok') o.ok++; else if (e.status === 'rejected') o.rejected++; else o.failed++;
    if (e.duration != null) { o.ms += e.duration; o.msN++; }
    if (e.timestamp >= o.lastAt) { o.lastAt = e.timestamp; o.lastStatus = e.status; }
    by.set(e.tool, o);
  }
  const out = {};
  by.forEach((o, k) => { out[k] = { calls: o.calls, ok: o.ok, failed: o.failed, rejected: o.rejected, avgMs: o.msN ? Math.round(o.ms / o.msN) : null, lastAt: o.lastAt, lastStatus: o.lastStatus, successRate: o.calls - o.rejected ? Math.round((o.ok / (o.calls - o.rejected)) * 100) : null }; });
  return out;
}

/**
 * What is happening RIGHT NOW, derived only from emitted events.
 * An open request = a request_start with no later answer/error for the same request_id.
 */
export function liveState(now = Date.now()) {
  const closed = new Set(), started = new Map();
  for (const e of _events) {
    if (!e.request_id || e.historical) continue;
    if (e.type === 'request_start') started.set(e.request_id, e);
    if (e.type === 'answer' || e.type === 'error' || e.type === 'cancelled') closed.add(e.request_id);
  }
  const open = [...started.values()].filter(e => !closed.has(e.request_id)).pop() || null;
  const lastClosed = [..._events].reverse().find(e => e.type === 'answer' || e.type === 'error') || null;
  if (!open) return { open: null, lastClosed, pendingApproval: null, activeTool: null, verifying: null, steps: 0, tools: [], elapsedMs: 0 };
  const mine = _events.filter(e => e.request_id === open.request_id);
  const activeCalls = new Map();
  let pendingApproval = null, steps = 0, verifying = null;
  const tools = [];
  for (const e of mine) {
    if (e.type === 'step') steps = Math.max(steps, Number(e.metadata && e.metadata.step) || 0);
    if (e.type === 'tool_start') { activeCalls.set(e.tool + '#' + e.entity_reference, e); }
    if (e.type === 'tool_end') { activeCalls.delete(e.tool + '#' + e.entity_reference); tools.push({ tool: e.tool, status: e.status, duration: e.duration, domain: e.domain }); }
    if (e.type === 'approval_requested') pendingApproval = e;
    if (e.type === 'approval_resolved') pendingApproval = null;
    if (e.type === 'verify_start') verifying = e;
    if (e.type === 'verify_end') verifying = null;
  }
  const act = [...activeCalls.values()].pop() || null;
  const routed = mine.filter(e => e.type === 'routed').pop() || null;
  return { open, lastClosed, pendingApproval, activeTool: act, verifying, steps, tools, routed, elapsedMs: now - open.timestamp };
}
