// Best-effort audit trail: local ring buffer + Supabase `agent_audit`
// (RLS: owner-only insert/select). Never blocks or breaks the chat.
const LOCAL_KEY = 'bt_agent_audit_local_v1'; // intentionally device-local, not business data
const MAX_LOCAL = 100;

export function logToolCall(entry, { conversationId = null } = {}) {
  const row = { ...entry, at: new Date().toISOString(), conversationId };
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    arr.unshift(row); arr.length = Math.min(arr.length, MAX_LOCAL);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
  } catch (_) { /* storage full/blocked */ }
  try {
    const sb = typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null;
    if (!sb) return;
    sb.from('agent_audit').insert({
      conversation_id: conversationId, tool: entry.tool, risk: entry.risk || 'read',
      args: entry.args || {}, ok: !!entry.ok, result_chars: entry.resultChars || 0, error: entry.error || null,
    }).then(() => {}, () => {});
  } catch (_) { /* ignore */ }
}

export function getLocalAudit() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (_) { return []; }
}
