// In-memory undo stack for AI changes. Closures can't survive a reload, so
// undo is available for the current session only (every change is also in the
// audit trail and the app's own Activity Log, so nothing is lost).
const MAX = 20;
let _stack = [];
let _seq = 0;

export function pushUndo({ tool, label, fn }) {
  const item = { id: 'u' + (++_seq), tool, label, fn, at: Date.now(), used: false };
  _stack.unshift(item);
  _stack.length = Math.min(_stack.length, MAX);
  return item;
}
export function listUndo() { return _stack.filter(u => !u.used).map(({ id, tool, label, at }) => ({ id, tool, label, at })); }
export async function runUndo(id) {
  const item = _stack.find(u => u.id === id);
  if (!item) return { ok: false, error: 'Nothing to undo (it may be from before a reload).' };
  if (item.used) return { ok: false, error: 'Already undone.' };
  try { await item.fn(); item.used = true; return { ok: true, label: item.label }; }
  catch (e) { return { ok: false, error: (e && e.message) || 'Undo failed' }; }
}
export function clearUndo() { _stack = []; }
