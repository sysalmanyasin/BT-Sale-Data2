// ══════════════════════════════════════════════════════════════════════
// SYNC DIRTY TRACKER — "which manager months have local edits that have
// NOT reached Supabase yet?"
//
// WHY: a pull used to replace local manager months (salary / generic /
// expense / credit) with the remote copy unconditionally. If you had just
// typed something and a background pull (realtime event, 'online',
// foreground) landed BEFORE your push completed, the remote copy erased
// your edit — then your next push uploaded the already-reverted data.
//
// HOW: Repository.setItem() calls noteManagerWrite(old, new) for the
// manager blob, which diffs per section/month and stamps changed months
// as dirty. A successful push clears every stamp that was taken before
// that push started. mergeIncomingData() consults isDirty() so a pull
// never overwrites a dirty month's own values.
//
// Deliberately a LEAF module (no imports) so repository.js can import it
// without creating a cycle; it talks to localStorage directly for the
// same reason.
// ══════════════════════════════════════════════════════════════════════

export const MGR_BLOB_KEY = 'BT_ManagerWork_v1';
export const DIRTY_KEY = 'bt_mgr_dirty_v1';
const INIT_KEY = 'bt_mgr_dirty_init_v1';
export const TRACKED_SECTIONS = ['salary', 'generic', 'expense', 'credit'];

let _mergeDepth = 0;

function _read() {
  try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function _write(map) {
  try {
    if (Object.keys(map).length) localStorage.setItem(DIRTY_KEY, JSON.stringify(map));
    else localStorage.removeItem(DIRTY_KEY);
  } catch (_) { /* storage full / unavailable — tracking is best-effort */ }
}
const _k = (section, month) => section + '|' + month;
function _parse(s) { try { return s ? JSON.parse(s) : {}; } catch (_) { return {}; } }

/** Run fn while sync-merge writes are happening — those must not mark anything dirty. */
export function runAsMerge(fn) {
  _mergeDepth++;
  try { return fn(); } finally { _mergeDepth = Math.max(0, _mergeDepth - 1); }
}

/** Called by Repository.setItem for the manager blob, BEFORE the write lands. */
export function noteManagerWrite(oldStr, newStr) {
  if (_mergeDepth > 0) return;
  const a = _parse(oldStr), b = _parse(newStr);
  const map = _read();
  const now = Date.now();
  let changed = false;
  TRACKED_SECTIONS.forEach(sec => {
    const A = (a && a[sec]) || {}, B = (b && b[sec]) || {};
    new Set([...Object.keys(A), ...Object.keys(B)]).forEach(month => {
      if (JSON.stringify(A[month]) !== JSON.stringify(B[month])) { map[_k(sec, month)] = now; changed = true; }
    });
  });
  if (changed) _write(map);
}

/**
 * One-time bootstrap for installs that already hold unsynced local data from
 * before this tracker existed: treat every existing month as dirty so the
 * first pull cannot clobber it. Cleared by the first successful push.
 */
export function ensureBootstrapped(mgrObj) {
  try {
    if (localStorage.getItem(INIT_KEY)) return;
    localStorage.setItem(INIT_KEY, '1');
  } catch (_) { return; }
  const map = _read();
  const now = Date.now();
  TRACKED_SECTIONS.forEach(sec => Object.keys((mgrObj && mgrObj[sec]) || {}).forEach(m => { map[_k(sec, m)] = now; }));
  _write(map);
}

export function isDirty(section, month) {
  return !!_read()[_k(section, month)];
}

/** Clear every stamp taken at or before `ts` (call with the timestamp captured when the push STARTED). */
export function clearDirtyUpTo(ts) {
  const map = _read();
  let changed = false;
  Object.keys(map).forEach(k => { if (map[k] <= ts) { delete map[k]; changed = true; } });
  if (changed) _write(map);
}

export function getDirtyMap() { return _read(); }

window.SyncDirty = { runAsMerge, noteManagerWrite, ensureBootstrapped, isDirty, clearDirtyUpTo, getDirtyMap };
