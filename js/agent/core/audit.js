// Best-effort audit trail: local ring buffer + Supabase `agent_audit`
// (RLS: owner-only insert/select). Never blocks or breaks the chat.
const LOCAL_KEY = 'bt_agent_audit_local_v1'; // intentionally device-local, not business data
const MAX_LOCAL = 100;

/**
 * Records one tool call. Still best-effort and never throws, but now RETURNS a promise describing what really
 * happened, so telemetry can report the truth instead of assuming:
 *   { sink: 'cloud' | 'local_only' | 'failed', local: boolean, error?: string }
 *   cloud      = the agent_audit insert came back without an error
 *   local_only = no Supabase client available (only the device ring buffer was written)
 *   failed     = the insert was attempted and returned/raised an error
 */
export function logToolCall(entry, { conversationId = null } = {}) {
  const { undo, ...entryNoUndo } = entry; // the recipe goes to Supabase only, never into the local ring buffer
  const row = { ...entryNoUndo, at: new Date().toISOString(), conversationId };
  let local = false;
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    arr.unshift(row); arr.length = Math.min(arr.length, MAX_LOCAL);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
    local = true;
  } catch (_) { /* storage full/blocked */ }
  try {
    const sb = typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null;
    if (!sb) return Promise.resolve({ sink: 'local_only', local });
    return Promise.resolve(sb.from('agent_audit').insert({
      conversation_id: conversationId, tool: entry.tool, risk: entry.risk || 'read',
      args: entry.args || {}, ok: !!entry.ok, result_chars: entry.resultChars || 0, error: entry.error || null,
      ...(undo ? { undo, undo_key: undo.key } : {}),
    })).then(
      r => (r && r.error ? { sink: 'failed', local, error: String(r.error.message || r.error).slice(0, 120) } : { sink: 'cloud', local }),
      e => ({ sink: 'failed', local, error: String((e && e.message) || e).slice(0, 120) }),
    );
  } catch (e) { return Promise.resolve({ sink: 'failed', local, error: String((e && e.message) || e).slice(0, 120) }); }
}

export function getLocalAudit() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (_) { return []; }
}
