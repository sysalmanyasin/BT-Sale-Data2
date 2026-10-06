// In-memory undo stack for AI changes in this session. Reload-proof undo lives in undo-store.js
// (recipes in agent_audit are rebuilt into functions); this stack just runs whichever function is current.
const MAX = 20;
let _stack = [];
let _seq = 0;

export function pushUndo({ tool, label, fn, key = null }) {
  const item = { id: 'u' + (++_seq), key, tool, label, fn, at: Date.now(), used: false };
  _stack.unshift(item);
  _stack.length = Math.min(_stack.length, MAX);
  return item;
}
export function listUndo() { return _stack.filter(u => !u.used).map(({ id, key, tool, label, at }) => ({ id, key, tool, label, at })); }
export async function runUndo(id) {
  const item = _stack.find(u => u.id === id);
  if (!item) return { ok: false, error: 'Nothing to undo (it may be from before a reload).' };
  if (item.used) return { ok: false, error: 'Already undone.' };
  try { await item.fn(); item.used = true; return { ok: true, label: item.label, key: item.key }; }
  catch (e) { return { ok: false, error: (e && e.message) || 'Undo failed' }; }
}
export function clearUndo() { _stack = []; }
