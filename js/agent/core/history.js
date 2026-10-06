// Saved conversations (tables agent_conversations / agent_messages). Only the visible turns are stored:
// what the owner asked and the assistant's final answer. Raw tool results are never saved.
// Owner-only (RLS). Everything fails soft: if saving fails the chat itself keeps working.
export const KEEP_DAYS = 90;
export const MAX_LOADED = 40;
const MAX_MSG = 12000;

export const titleFrom = text => {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
};

/** @returns {Promise<string|null>} new conversation id */
export async function createConversation(sb, firstQuestion, specialist = null) {
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('agent_conversations').insert({ title: titleFrom(firstQuestion), specialist: specialist || null }).select('id');
    return error || !data || !data[0] ? null : data[0].id;
  } catch (_) { return null; }
}

/** Saves one question + answer. @returns {Promise<boolean>} */
export async function appendTurn(sb, conversationId, userText, assistantText) {
  if (!sb || !conversationId) return false;
  const rows = [];
  if (String(userText || '').trim()) rows.push({ conversation_id: conversationId, role: 'user', content: String(userText).slice(0, MAX_MSG) });
  if (String(assistantText || '').trim()) rows.push({ conversation_id: conversationId, role: 'assistant', content: String(assistantText).slice(0, MAX_MSG) });
  if (!rows.length) return false;
  try {
    const { error } = await sb.from('agent_messages').insert(rows);
    if (error) return false;
    await sb.from('agent_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    return true;
  } catch (_) { return false; }
}

export async function listConversations(sb, limit = 15) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('agent_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(limit);
    return error || !Array.isArray(data) ? [] : data;
  } catch (_) { return []; }
}

/** The last MAX_LOADED messages, oldest first, as chat messages ready to continue from. */
export async function loadConversation(sb, id) {
  if (!sb || !id) return [];
  try {
    const { data, error } = await sb.from('agent_messages').select('role, content').eq('conversation_id', id).order('id', { ascending: false }).limit(MAX_LOADED);
    if (error || !Array.isArray(data)) return [];
    return data.reverse().filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  } catch (_) { return []; }
}

export async function deleteConversation(sb, id) {
  if (!sb || !id) return false;
  try { const { error } = await sb.from('agent_conversations').delete().eq('id', id); return !error; } catch (_) { return false; }
}

export async function deleteAllConversations(sb) {
  if (!sb) return false;
  try { const { error } = await sb.from('agent_conversations').delete().not('id', 'is', null); return !error; } catch (_) { return false; }
}

/** Housekeeping: drop conversations not touched for KEEP_DAYS days. */
export async function pruneOld(sb, now = Date.now()) {
  if (!sb) return false;
  try { const { error } = await sb.from('agent_conversations').delete().lt('updated_at', new Date(now - KEEP_DAYS * 86400000).toISOString()); return !error; } catch (_) { return false; }
}
