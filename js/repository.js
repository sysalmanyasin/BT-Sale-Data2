// ══════════════════════════════════════════════════════════════════════════
// REPOSITORY  —  Floor 1 of the architecture
//
// THE ONE DOOR for reading/writing DAILY, MONTHLY, STAFF, and every
// localStorage-backed feature blob.
//
// STATUS: Migration complete (Phase 1-8, June 2026). All known call sites
// route through Repository/Actions. The Floor-2 Proxy (config.js) now
// flags any write that did NOT originate from inside this file — see
// `_beginInternalWrite`/`_endInternalWrite` below.
// ══════════════════════════════════════════════════════════════════════════

import { MONTHLY, DAILY, STAFF, newEntries, STAFF_KEY } from './config.js';
import { EventBus } from './event-bus.js';

export const Repository = (function () {

  // ── Floor 2 enforcement hook ────────────────────────────────────────
  // Every mutation Repository makes to MONTHLY/DAILY/STAFF wraps itself
  // in this flag. config.js's Proxy checks the flag: if a mutation
  // happens while it's OFF, that mutation bypassed Repository, and the
  // Proxy reports it loudly (see CF-05 / Step 5 of the audit).
  let _internalWriteDepth = 0;
  function _beginInternalWrite() { _internalWriteDepth++; }
  function _endInternalWrite() { _internalWriteDepth = Math.max(0, _internalWriteDepth - 1); }
  function isInternalWrite() { return _internalWriteDepth > 0; }
  // Convenience wrapper: run fn with the flag held, always release it.
  function _withInternalWrite(fn) {
    _beginInternalWrite();
    try { return fn(); } finally { _endInternalWrite(); }
  }

  // ── Event bus (Floor 3) — now lives in event-bus.js ─────────────────
  function _notify(eventName, payload) { EventBus.notify(eventName, payload); }
  function onChange(fn) { return EventBus.onChange(fn); }

  // ── Internal: stamp every record with metadata for conflict checks ──
  function _stamp(record) {
    record._updatedAt = Date.now();
    try {
      record._source = (typeof _sc_getUDID === 'function') ? _sc_getUDID() : (record._source || 'unknown');
    } catch (e) {
      record._source = record._source || 'unknown';
    }
    return record;
  }

  // ──────────────────────────────────────────────────────────────────────
  // DAILY records
  // ──────────────────────────────────────────────────────────────────────

  function getDaily() {
    return DAILY;
  }

  function findDailyIndex(date, monthYear) {
    return DAILY.findIndex(d => d.Date === date && d.Month_Year === monthYear);
  }

  function getDailyEntry(date, monthYear) {
    const idx = findDailyIndex(date, monthYear);
    return idx === -1 ? null : DAILY[idx];
  }

  // Find a daily entry by date alone, regardless of month (used by
  // headless quick-actions that only know "today", not which month
  // record it lives in). Read-only — does not need internal-write guard.
  function findDailyByDate(date) {
    return DAILY.find(d => d.Date === date) || null;
  }

  function upsertDaily(entry) {
    if (!entry || !entry.Date || !entry.Month_Year) {
      throw new Error('Repository.upsertDaily requires Date and Month_Year on the entry');
    }
    return _withInternalWrite(() => {
      _stamp(entry);
      const idx = findDailyIndex(entry.Date, entry.Month_Year);
      if (idx === -1) {
        DAILY.push(entry);
        _notify('daily:added', entry);
      } else {
        Object.assign(DAILY[idx], entry);
        _notify('daily:updated', DAILY[idx]);
      }
      invalidateRenderCache && invalidateRenderCache();
      return entry;
    });
  }

  function deleteDaily(date, monthYear) {
    return _withInternalWrite(() => {
      const idx = findDailyIndex(date, monthYear);
      if (idx === -1) return false;
      const removed = DAILY[idx];
      DAILY.splice(idx, 1);
      _notify('daily:deleted', removed);
      invalidateRenderCache && invalidateRenderCache();
      return true;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // MONTHLY records
  // ──────────────────────────────────────────────────────────────────────

  function getMonthly() {
    return MONTHLY;
  }

  function findMonthlyIndex(monthYear) {
    return MONTHLY.findIndex(m => m.Month_Year === monthYear);
  }

  function getMonthlyEntry(monthYear) {
    const idx = findMonthlyIndex(monthYear);
    return idx === -1 ? null : MONTHLY[idx];
  }

  function upsertMonthly(entry) {
    if (!entry || !entry.Month_Year) {
      throw new Error('Repository.upsertMonthly requires Month_Year on the entry');
    }
    return _withInternalWrite(() => {
      _stamp(entry);
      const idx = findMonthlyIndex(entry.Month_Year);
      if (idx === -1) {
        MONTHLY.push(entry);
        _notify('monthly:added', entry);
      } else {
        Object.assign(MONTHLY[idx], entry);
        _notify('monthly:updated', MONTHLY[idx]);
      }
      invalidateRenderCache && invalidateRenderCache();
      return entry;
    });
  }

  function deleteMonthly(monthYear) {
    return _withInternalWrite(() => {
      const idx = findMonthlyIndex(monthYear);
      if (idx === -1) return false;
      const removed = MONTHLY[idx];
      MONTHLY.splice(idx, 1);
      _notify('monthly:deleted', removed);
      invalidateRenderCache && invalidateRenderCache();
      return true;
    });
  }

  // Sort MONTHLY chronologically in place. Internal-write-guarded because
  // a sort reassigns every index of the array (config.js's recomputeMonthly
  // needs this after inserting a new month out of order).
  function sortMonthlyChronological() {
    return _withInternalWrite(() => {
      const MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      MONTHLY.sort((a, b) => {
        const [am, ay] = a.Month_Year.split(' ');
        const [bm, by_] = b.Month_Year.split(' ');
        if (ay !== by_) return parseInt(ay) - parseInt(by_);
        return MO.indexOf(am) - MO.indexOf(bm);
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // CONFLICT DETECTION
  // ──────────────────────────────────────────────────────────────────────
  const LAST_SYNC_KEY = 'bt_repo_last_synced_at';
  const _conflicts = []; // pending conflicts awaiting user decision, this session

  function getLastSyncedAt() {
    return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
  }
  function markSynced() {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  }

  function _valuesDiffer(a, b) {
    const ignore = new Set(['_updatedAt', '_source']);
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (ignore.has(k)) continue;
      if ((a ? a[k] : undefined) !== (b ? b[k] : undefined)) return true;
    }
    return false;
  }

  function isGenuineConflict(local, incoming) {
    if (!local || !incoming) return false;
    const lastSync = getLastSyncedAt();
    const localChangedSinceSync   = (local._updatedAt    || 0) > lastSync;
    const incomingChangedSinceSync = (incoming._updatedAt || 0) > lastSync;
    if (!localChangedSinceSync || !incomingChangedSinceSync) return false;
    return _valuesDiffer(local, incoming);
  }

  function queueConflict(kind, key, local, incoming) {
    _conflicts.push({
      kind, key, local, incoming,
      queuedAt: Date.now(),
    });
    _notify('conflict:queued', _conflicts[_conflicts.length - 1]);
  }

  function getPendingConflicts() {
    return _conflicts.slice();
  }

  function resolveConflict(conflictIndex, choice) {
    const c = _conflicts[conflictIndex];
    if (!c) return false;
    const winner = choice === 'incoming' ? c.incoming : c.local;
    if (c.kind === 'daily') upsertDaily(winner);
    else upsertMonthly(winner);
    _conflicts.splice(conflictIndex, 1);
    _notify('conflict:resolved', { kind: c.kind, key: c.key, choice });
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // PULL MERGE  (remote wins on pull, with conflict detection)
  // ──────────────────────────────────────────────────────────────────────
  function mergePulledDaily(incomingArr) {
    return _withInternalWrite(() => {
      let added = 0, updated = 0, conflicts = 0;
      (incomingArr || []).forEach(incoming => {
        const idx = findDailyIndex(incoming.Date, incoming.Month_Year);
        if (idx === -1) {
          DAILY.push(incoming);
          added++;
        } else if (isGenuineConflict(DAILY[idx], incoming)) {
          queueConflict('daily', incoming.Date + '|' + incoming.Month_Year, DAILY[idx], incoming);
          conflicts++;
        } else {
          Object.assign(DAILY[idx], incoming);
          updated++;
        }
      });
      if (added || updated) { _notify('daily:pulled', { added, updated, conflicts }); invalidateRenderCache && invalidateRenderCache(); }
      return { added, updated, conflicts };
    });
  }

  function mergePulledMonthly(incomingArr) {
    return _withInternalWrite(() => {
      let added = 0, updated = 0, conflicts = 0;
      (incomingArr || []).forEach(incoming => {
        const idx = findMonthlyIndex(incoming.Month_Year);
        if (idx === -1) {
          MONTHLY.push(incoming);
          added++;
        } else if (isGenuineConflict(MONTHLY[idx], incoming)) {
          queueConflict('monthly', incoming.Month_Year, MONTHLY[idx], incoming);
          conflicts++;
        } else {
          Object.assign(MONTHLY[idx], incoming);
          updated++;
        }
      });
      if (added || updated) { _notify('monthly:pulled', { added, updated, conflicts }); invalidateRenderCache && invalidateRenderCache(); }
      return { added, updated, conflicts };
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // GAP-FILL MERGE  (push direction: local wins, remote only fills gaps —
  // this is the exact behavior supabase.js's push path always had; it now
  // lives in ONE place instead of being duplicated inline in supabase.js,
  // closing audit finding CF-01)
  // ──────────────────────────────────────────────────────────────────────
  function gapFillDaily(incomingArr) {
    return _withInternalWrite(() => {
      let added = 0;
      (incomingArr || []).forEach(d => {
        if (findDailyIndex(d.Date, d.Month_Year) === -1) { DAILY.push(d); added++; }
      });
      if (added) { _notify('daily:gapfilled', { added }); invalidateRenderCache && invalidateRenderCache(); }
      return { added };
    });
  }

  function gapFillMonthly(incomingArr) {
    return _withInternalWrite(() => {
      let added = 0;
      (incomingArr || []).forEach(m => {
        if (findMonthlyIndex(m.Month_Year) === -1) { MONTHLY.push(m); added++; }
      });
      if (added) { _notify('monthly:gapfilled', { added }); invalidateRenderCache && invalidateRenderCache(); }
      return { added };
    });
  }

  // ── Floor 2 observability: track mutations that bypassed Repository ──
  let _rawMutationCounts = { MONTHLY: 0, DAILY: 0, STAFF: 0 };
  function _noteRawMutation(label) {
    _rawMutationCounts[label] = (_rawMutationCounts[label] || 0) + 1;
    _notify('raw:mutation', { label, count: _rawMutationCounts[label] });
  }
  function getRawMutationStats() {
    return { ..._rawMutationCounts };
  }

  // ──────────────────────────────────────────────────────────────────────
  // STAFF  (Floor 1 extension — closes CF-02. STAFF is array-shaped like
  // DAILY/MONTHLY but indexed by position, not a composite key, so it
  // gets a simpler replace-whole-array + persist API rather than upsert.)
  // ──────────────────────────────────────────────────────────────────────
  const STAFF_KEY = 'BT_Staff_v1';

  function getStaff() {
    return STAFF;
  }

  // Replaces the contents of STAFF IN PLACE (so the existing Proxy
  // reference in config.js is preserved — reassigning `STAFF = newArr`
  // would silently swap in a brand-new, unprotected array). Persists to
  // localStorage and announces the change.
  function setStaff(newArr) {
    return _withInternalWrite(() => {
      STAFF.length = 0;
      (newArr || []).forEach(e => STAFF.push(e));
      localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
      _notify('staff:changed', { staff: STAFF });
      return STAFF;
    });
  }

  // Persist STAFF's current contents (used after an in-place edit, e.g.
  // a single field change) without replacing the array reference.
  function saveStaff() {
    return _withInternalWrite(() => {
      localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
      _notify('staff:changed', { staff: STAFF });
    });
  }

  // Add/update/remove a single staff member. These wrap the array
  // mutation itself (not just the persist step) in _withInternalWrite,
  // so the STAFF Proxy never flags them as a raw/unauthorized mutation
  // — closing the gap where Actions used to push/splice on the raw
  // array before calling saveStaff() (i.e. the mutation happened
  // outside the guard, only the persist step was inside it).
  function addStaffMember(emp) {
    return _withInternalWrite(() => {
      STAFF.push(emp);
      localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
      _notify('staff:changed', { staff: STAFF });
      return emp;
    });
  }

  function updateStaffMember(i, changes) {
    if (i < 0 || i >= STAFF.length) throw new Error('Repository.updateStaffMember: index ' + i + ' out of range');
    return _withInternalWrite(() => {
      Object.assign(STAFF[i], changes);
      localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
      _notify('staff:changed', { staff: STAFF });
      return STAFF[i];
    });
  }

  function removeStaffMember(i) {
    if (i < 0 || i >= STAFF.length) throw new Error('Repository.removeStaffMember: index ' + i + ' out of range');
    return _withInternalWrite(() => {
      const removed = STAFF.splice(i, 1)[0];
      localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
      _notify('staff:changed', { staff: STAFF });
      return removed;
    });
  }

  function loadStaff() {
    return _withInternalWrite(() => {
      let arr = [];
      try {
        const raw = localStorage.getItem(STAFF_KEY);
        if (raw) arr = JSON.parse(raw);
      } catch (e) { arr = []; }
      STAFF.length = 0;
      arr.forEach(e => STAFF.push(e));
      return STAFF;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // PENDING ENTRIES  (Floor 1 extension — closes the "newEntries ghost
  // state" gap. `newEntries` is this device's local record of daily
  // entries added this session, kept in sync with DAILY and persisted
  // to 'bt_entries' so a page refresh doesn't lose the session log.
  // It is NOT a second source of truth for sales data — DAILY remains
  // authoritative — it's purely a UI convenience list ("what did I add
  // today") that also happens to gate what pushToSupabase() sends.
  // All mutation now goes through here instead of pages splicing the
  // array directly.)
  // ──────────────────────────────────────────────────────────────────────
  const PENDING_KEY = 'bt_entries';

  function getPendingEntries() {
    return newEntries;
  }

  function loadPendingEntries() {
    return _withInternalWrite(() => {
      let arr = [];
      try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (raw) arr = JSON.parse(raw);
      } catch (e) { arr = []; }
      newEntries.length = 0;
      arr.forEach(e => newEntries.push(e));
      return newEntries;
    });
  }

  function _savePendingEntries() {
    localStorage.setItem(PENDING_KEY, JSON.stringify(newEntries));
  }

  // Add or overwrite a pending entry (find-or-push by Date+Month_Year).
  function upsertPendingEntry(entry) {
    return _withInternalWrite(() => {
      const idx = newEntries.findIndex(d => d.Date === entry.Date && d.Month_Year === entry.Month_Year);
      if (idx === -1) newEntries.push(entry);
      else newEntries[idx] = entry;
      _savePendingEntries();
      _notify('pending:changed', { entries: newEntries });
      return entry;
    });
  }

  function removePendingEntry(date, monthYear) {
    return _withInternalWrite(() => {
      const idx = newEntries.findIndex(d => d.Date === date && d.Month_Year === monthYear);
      if (idx === -1) return false;
      newEntries.splice(idx, 1);
      _savePendingEntries();
      _notify('pending:changed', { entries: newEntries });
      return true;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // GENERIC KEY/VALUE STORE  (Floor 1 extension)
  // ──────────────────────────────────────────────────────────────────────
  function getItem(key) {
    return localStorage.getItem(key);
  }
  function setItem(key, value) {
    localStorage.setItem(key, value);
    _notify('item:changed', { key, value });
  }
  function removeItem(key) {
    localStorage.removeItem(key);
    _notify('item:removed', { key });
  }
  // Wraps localStorage key enumeration so callers never iterate
  // `localStorage` directly (closes MF-04 / app-context.js, CF-04 /
  // dashboard.js's latestManagerMonth, and the petty-cash scan in
  // supabase.js's payload builder).
  function getKeysByPrefix(prefix) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) out.push(k);
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────
  return {
    // daily
    getDaily, getDailyEntry, findDailyByDate, upsertDaily, deleteDaily,
    // monthly
    getMonthly, getMonthlyEntry, upsertMonthly, deleteMonthly, sortMonthlyChronological,
    // pull/merge
    mergePulledDaily, mergePulledMonthly,
    // gap-fill (push direction)
    gapFillDaily, gapFillMonthly,
    // conflicts
    isGenuineConflict, getPendingConflicts, resolveConflict,
    markSynced, getLastSyncedAt,
    // staff
    getStaff, setStaff, saveStaff, loadStaff,
    addStaffMember, updateStaffMember, removeStaffMember,
    // pending entries (session log, gated push, ghost-state fix)
    getPendingEntries, loadPendingEntries, upsertPendingEntry, removePendingEntry,
    // generic key/value
    getItem, setItem, removeItem, getKeysByPrefix,
    // event bus
    onChange,
    // Floor 2 observability + enforcement
    _noteRawMutation, getRawMutationStats,
    isInternalWrite, _beginInternalWrite, _endInternalWrite,
  };

})();

// ══════════════════════════════════════════════════════════════════════
// TEMPORARY WINDOW BRIDGE — same reasoning as config.js. Remove once
// every consuming file has been converted to
// `import { Repository } from './repository.js'`.
// ══════════════════════════════════════════════════════════════════════
window.Repository = Repository;
