// Persistent undo. Closures can't survive a reload, but every undo function in this app depends only
// on the tool's arguments and result. So the audit row stores that "recipe" and, after a reload, the
// function is rebuilt through the tool's own makeUndo(args, out). Nothing executable is ever stored.
import { getTool } from './tool-registry.js';

export const UNDO_WINDOW_MS = 48 * 3600 * 1000; // older changes are no longer offered for one-tap undo
const MAX_RECIPE_CHARS = 20000;

export const newUndoKey = () => 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Recipe stored on the audit row, or null when too large to keep. */
export function makeRecipe({ key, tool, label, args, out }) {
  const r = { key, tool, label, args, out };
  try { return JSON.stringify(r).length <= MAX_RECIPE_CHARS ? JSON.parse(JSON.stringify(r)) : null; } catch (_) { return null; }
}

/** Rebuild {label, fn} from a stored recipe. Null if the tool no longer exists or has no undo. */
export function rehydrate(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const tool = getTool(recipe.tool);
  if (!tool || typeof tool.makeUndo !== 'function') return null;
  try {
    const u = tool.makeUndo(recipe.args || {}, recipe.out || {});
    return u && typeof u.fn === 'function' ? { key: recipe.key, tool: recipe.tool, label: u.label || recipe.label || tool.name, fn: u.fn } : null;
  } catch (_) { return null; }
}

/** Changes from the last 48h that are still undoable, newest first. @returns {Promise<Array>} */
export async function loadPendingUndos(sb, now = Date.now()) {
  if (!sb) return [];
  try {
    const since = new Date(now - UNDO_WINDOW_MS).toISOString();
    const { data, error } = await sb.from('agent_audit').select('undo, created_at')
      .not('undo', 'is', null).is('undone_at', null).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(10);
    if (error || !Array.isArray(data)) return [];
    return data.map(r => { const h = rehydrate(r.undo); return h ? { ...h, at: Date.parse(r.created_at) || now } : null; }).filter(Boolean);
  } catch (_) { return []; }
}

/** Stamp the audit row as undone so it is not offered again (any device). */
export async function markUndone(sb, key) {
  if (!sb || !key) return false;
  try {
    const { error } = await sb.from('agent_audit').update({ undone_at: new Date().toISOString() }).eq('undo_key', key).is('undone_at', null);
    return !error;
  } catch (_) { return false; }
}
