// ══════════════════════════════════════════════════════════════════════
// STAFF CREDIT — PURE MERGE / IDENTITY HELPERS  (no DOM, no storage)
//
// WHY THIS EXISTS
// Credit months used to sync as ONE opaque array per month:
//   pull → remote array replaced the local array wholesale
//   push → local array replaced the remote array wholesale
// so whichever side wrote last silently erased the other side's entries
// (an entry typed on this device vs. one folded in server-side from the
// Closing App inbox by bt_fold_staff_credit_inbox(), or typed on another
// device). This module merges at ENTRY level instead: the result is the
// union of both sides, so a credit entry can only disappear when someone
// explicitly deleted it (and that delete travels as a tombstone).
//
// IDENTITY
//   row   → staffId (EMP-xxx), falling back to normalised name
//   entry → `id`. Entries written before ids existed (or by the server
//           trigger, or by AI tools) get a DETERMINISTIC derived id from
//           their content, so both devices derive the same id for the
//           same legacy entry without having to coordinate.
//
// Tombstone keys (see sync-tombstones.js):
//   'crde:<entryId>'            entry deleted
//   'crdr:<month>|<rowKey>'     whole employee row removed for that month
// ══════════════════════════════════════════════════════════════════════

const _norm = s => String(s == null ? '' : s).trim().toLowerCase();

// FNV-1a, 32-bit — tiny, dependency-free, good enough for an id suffix.
function _fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Fresh id for a newly created entry. */
export function newEntryId() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Returns a copy of `entries` in which every entry has an `id`.
 * Id-less entries get 'h<hash>_<n>' derived from their content, where n
 * disambiguates identical entries inside the same row. Existing ids are
 * never changed. Non-object junk is dropped.
 */
export function withEntryIds(entries) {
  const seen = Object.create(null);
  return (Array.isArray(entries) ? entries : []).filter(e => e && typeof e === 'object').map(e => {
    if (e.id) return e;
    const content = [e.date || '', e.desc || '', Math.round(Number(e.amount) || 0), e.source || ''].join('|');
    const base = 'h' + _fnv(content);
    const n = seen[base] = (seen[base] || 0) + 1;
    return { ...e, id: base + '_' + n };
  });
}

/** Stable identity of an employee row inside one month. */
export function rowKey(row) {
  if (row && row.staffId) return 'id:' + row.staffId;
  return 'n:' + _norm(row && row.name);
}

export function hasCreditData(row) {
  if (!row) return false;
  return !!((Number(row.prevBal) || 0) || (Number(row.salary) || 0) || (Number(row.lessGeneric) || 0) ||
            (Array.isArray(row.entries) && row.entries.length));
}

function _normRow(row) {
  return { ...row, entries: withEntryIds(row.entries) };
}

function _findMatch(row, byStaffId, byName) {
  if (row.staffId && byStaffId.has(row.staffId)) return byStaffId.get(row.staffId);
  const n = _norm(row.name);
  if (n && byName.has(n)) return byName.get(n);
  return null;
}

/**
 * Merge two copies of one month's credit rows.
 *
 * opts.isPull     true  → remote is the "newer" side for fields both sides have
 *                 false → local wins for fields both sides have
 * opts.dirty      true  → this month has local edits not yet pushed; local keeps
 *                         priority even on pull (remote can still ADD entries/rows)
 * opts.month      month label, only used to build row tombstone keys
 * opts.isDeleted  (key) => boolean; tombstone lookup
 *
 * Never returns fewer entries than exist on either side, except for entries
 * that carry a tombstone. Pure: inputs are not mutated.
 */
export function mergeCreditMonth(localRows, remoteRows, opts = {}) {
  const { isPull = false, dirty = false, month = '', isDeleted = () => false } = opts;
  // Unexpected shapes (not an array of rows) can't be merged row-by-row —
  // fall back to the plain "newer side wins / fill the gap" rule.
  if ((localRows != null && !Array.isArray(localRows)) || (remoteRows != null && !Array.isArray(remoteRows))) {
    return (isPull && !dirty) ? (remoteRows != null ? remoteRows : localRows) : (localRows != null ? localRows : remoteRows);
  }
  const local = Array.isArray(localRows) ? localRows.filter(r => r && typeof r === 'object').map(_normRow) : null;
  const remote = Array.isArray(remoteRows) ? remoteRows.filter(r => r && typeof r === 'object').map(_normRow) : null;

  const dropDeleted = row => ({ ...row, entries: row.entries.filter(e => !isDeleted('crde:' + e.id)) });
  if (!remote) return local ? local.map(dropDeleted) : localRows;
  if (!local) return remote.filter(r => !isDeleted('crdr:' + month + '|' + rowKey(r))).map(dropDeleted);

  const remoteWins = isPull && !dirty;
  const byStaffId = new Map(), byName = new Map();
  local.forEach(r => {
    if (r.staffId && !byStaffId.has(r.staffId)) byStaffId.set(r.staffId, r);
    const n = _norm(r.name);
    if (n && !byName.has(n)) byName.set(n, r);
  });

  const matchedLocal = new Set();
  const extraRemote = [];
  const mergedByLocal = new Map();

  remote.forEach(rr => {
    const lr = _findMatch(rr, byStaffId, byName);
    if (!lr) {
      if (!isDeleted('crdr:' + month + '|' + rowKey(rr))) extraRemote.push(dropDeleted(rr));
      return;
    }
    matchedLocal.add(lr);

    // scalar fields
    const out = { ...lr };
    Object.keys(rr).forEach(k => {
      if (k === 'entries') return;
      if (remoteWins) out[k] = rr[k];
      else if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = rr[k];
    });

    // entries: union by id
    const byId = new Map();
    lr.entries.forEach(e => byId.set(e.id, e));
    rr.entries.forEach(e => {
      if (!byId.has(e.id)) byId.set(e.id, e);        // remote-only → add
      else if (remoteWins) byId.set(e.id, e);         // both → newer side
    });
    out.entries = [...byId.values()].filter(e => !isDeleted('crde:' + e.id));
    mergedByLocal.set(lr, out);
  });

  const result = local.map(lr => mergedByLocal.get(lr) || dropDeleted(lr));
  return result.concat(extraRemote);
}

/** Tombstone every entry of a row (used when a whole employee row is removed). */
export function entryTombstoneKeys(row) {
  return withEntryIds(row && row.entries).map(e => 'crde:' + e.id);
}

/**
 * Merge the remote manager blob's per-month sections into a copy of the local
 * blob. Pure — returns a new object, mutates nothing.
 *
 *   credit                    → entry-level union (mergeCreditMonth), both directions
 *   salary / generic / expense →
 *        pull : remote month replaces local, EXCEPT a month with unpushed local edits
 *        push : local wins; remote only fills months missing locally
 */
export function mergeManagerSections(localBlob, remoteBlob, { isPull = false, isDirty = () => false, isDeleted = () => false } = {}) {
  const merged = JSON.parse(JSON.stringify(localBlob || {}));
  ['salary', 'generic', 'expense', 'credit'].forEach(sec => {
    const remoteSec = remoteBlob && remoteBlob[sec];
    if (!remoteSec || typeof remoteSec !== 'object') return;
    if (!merged[sec]) merged[sec] = {};
    Object.keys(remoteSec).forEach(month => {
      if (sec === 'credit') {
        merged.credit[month] = mergeCreditMonth(merged.credit[month], remoteSec[month], {
          isPull, month, dirty: isDirty('credit', month), isDeleted,
        });
      } else if (isPull) {
        if (!(month in merged[sec]) || !isDirty(sec, month)) merged[sec][month] = remoteSec[month];
      } else if (!(month in merged[sec])) {
        merged[sec][month] = remoteSec[month];
      }
    });
  });
  return merged;
}
