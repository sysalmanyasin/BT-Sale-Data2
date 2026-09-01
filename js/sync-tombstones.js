// ══════════════════════════════════════════════════════════════════════
// SYNC TOMBSTONES
//
// ROOT CAUSE of "deleted row comes back after refresh/sync": every ledger
// merge in supabase.js (js/supabase.js's mergeIncomingData) works by
// unioning local entries with remote entries by id — "remote wins on
// pull", "local wins on push but fill gaps from remote". That union has
// no concept of a delete: removing an id from the LOCAL array just looks
// like "this id is missing locally", which the merge treats as a gap to
// be refilled FROM REMOTE — on pull (remote still has it, nothing ever
// told it not to), and even on push (push starts by pulling remote into
// local to "fill gaps" before re-uploading — see supabase.js _doPush,
// which calls mergeIncomingData(remote.payload, false) BEFORE building
// the payload it uploads). Either way the deleted row is silently
// resurrected.
//
// The fix is a tombstone: when something is deleted, record "this id was
// deleted at time T" in a small persisted map that itself gets synced
// alongside the data. Every merge then checks the tombstone map first and
// refuses to resurrect any id listed there, on push AND on pull, from
// local AND from remote. This is the standard fix for last-write-wins /
// union-merge sync systems that need to support deletion.
//
// Used by: ledger-store.js (generalized ledger entries + Misc Sections
// custom ledger types), jazz-cash.js (Balance Tally accounts/snapshots),
// and read/merged by supabase.js on every push/pull.
//
// Classic-script bridge: supabase.js is a non-module `<script defer>`
// (see index.html), so this also hangs itself off `window.SyncTombstones`
// — same established pattern as LEDGER_KEY/JC_KEY elsewhere in this app.
// Load this BEFORE ledger-store.js/jazz-cash.js/supabase.js in index.html.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';

export const TOMBSTONES_KEY = 'bt_sync_tombstones_v1';

// How long a tombstone is kept around after being recorded. Once every
// device has had a chance to sync (30s auto-push + pull-on-unlock, this
// app's normal cadence), the tombstone has done its job — the id is gone
// everywhere. Kept for a generous 180 days rather than pruned eagerly, so
// a device that's been offline for months still gets the memo instead of
// resurrecting old deletions the moment it reconnects.
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

let _cache = null;

function _load() {
  if (_cache !== null) return _cache;
  try {
    const raw = Repository.getItem(TOMBSTONES_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch (e) {
    _cache = {};
  }
  return _cache;
}

function _save() {
  Repository.setItem(TOMBSTONES_KEY, JSON.stringify(_cache));
}

function _prune() {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  let changed = false;
  Object.keys(_cache).forEach(k => {
    if (_cache[k] < cutoff) { delete _cache[k]; changed = true; }
  });
  if (changed) _save();
}

// Records `key` as deleted right now. `key` should be namespaced by the
// caller so ids from different entities can never collide, e.g.
// 'led:' + entryId, 'sec:' + ledgerType, 'jca:' + accountId,
// 'jcs:' + date. Call this at the SAME TIME the row is actually removed
// from its own store (same function, before/after the splice) so the
// tombstone always exists by the time a save/push can fire.
export function markDeleted(key) {
  if (!key) return;
  _load();
  _cache[key] = Date.now();
  _save();
}

export function isDeleted(key) {
  return !!_load()[key];
}

export function deletedAt(key) {
  return _load()[key] || 0;
}

// Returns a shallow copy of the whole tombstone map, for embedding in the
// sync payload (_buildPayload() in supabase.js).
export function getAllTombstones() {
  _load();
  return Object.assign({}, _cache);
}

// Merges an incoming (remote) tombstone map into the local one — a
// tombstone is a "was deleted at time T" fact, never an update, so the
// only sane merge is "keep whichever timestamp is present / newest".
// Call this FIRST, before merging any actual data, so every entity merge
// that runs afterward sees the up-to-date combined tombstone set.
export function mergeTombstones(remote) {
  if (!remote) return _load();
  _load();
  let changed = false;
  Object.keys(remote).forEach(k => {
    const ts = remote[k];
    if (typeof ts !== 'number') return;
    if (!_cache[k] || ts > _cache[k]) { _cache[k] = ts; changed = true; }
  });
  if (changed) _save();
  _prune();
  return _cache;
}

window.SyncTombstones = {
  TOMBSTONES_KEY, markDeleted, isDeleted, deletedAt, getAllTombstones, mergeTombstones,
};
