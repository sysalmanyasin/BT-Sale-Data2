// ══════════════════════════════════════════════════════════════════════════
// REPOSITORY  —  Floor 1 of the new architecture
//
// THE ONE DOOR for reading/writing DAILY and MONTHLY data.
//
// STATUS: Step 1 of migration. This file is ADDITIVE ONLY.
//   - Nothing in the app calls this yet.
//   - MONTHLY/DAILY still work exactly as before, everywhere else.
//   - This is the new door being built next to the old ones,
//     before we start moving traffic through it.
//
// WHY IT EXISTS:
//   Today, 8 files (config.js, ui.js, storage.js, supabase.js, manager.js,
//   drive.js, data-page.js, ai-bridge.js) each independently search/merge/
//   mutate the MONTHLY and DAILY arrays. Every one of them has slightly
//   different merge logic. This file becomes the ONLY place that logic
//   lives, going forward.
//
// WHAT IT DOES NOT DO YET:
//   - Does not yet talk to Supabase/Drive/IndexedDB directly (Step 3).
//   - Does not yet enforce the Conflict Resolution Policy (Step 3).
//   - Does not yet replace any existing file's logic (Step 2+).
//   It only wraps the in-memory MONTHLY/DAILY arrays safely, and stamps
//   every record with metadata the later steps will need.
// ══════════════════════════════════════════════════════════════════════════

const Repository = (function () {

  // ── Internal: simple event bus (Floor 3 preview, lives here for now) ──
  // Later this gets promoted to its own file. For Step 1, it's just here
  // so every Repository write can announce itself.
  const _listeners = [];

  function _notify(eventName, payload) {
    _listeners.forEach(fn => {
      try { fn(eventName, payload); } catch (e) { /* one bad listener should not break others */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
    return function unsubscribe() {
      const idx = _listeners.indexOf(fn);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }

  // ── Internal: stamp every record with metadata for future conflict checks ──
  // _updatedAt: when this record was last touched, in this browser.
  // _source: which device touched it (uses Sync Center's UDID if available).
  // Neither field is used for conflict decisions yet (that's Step 3) —
  // we start recording it now so we have real history by the time we need it.
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
    // Returns a live reference today (matches old behavior).
    // Step 2 will tighten this to return copies, once nothing outside
    // the Repository needs to mutate the array directly anymore.
    return DAILY;
  }

  function findDailyIndex(date, monthYear) {
    return DAILY.findIndex(d => d.Date === date && d.Month_Year === monthYear);
  }

  function getDailyEntry(date, monthYear) {
    const idx = findDailyIndex(date, monthYear);
    return idx === -1 ? null : DAILY[idx];
  }

  // Add new, or merge into existing — replaces the "findIndex + push/merge"
  // pattern currently duplicated in storage.js, supabase.js, manager.js,
  // drive.js, ui.js, and data-page.js.
  function upsertDaily(entry) {
    if (!entry || !entry.Date || !entry.Month_Year) {
      throw new Error('Repository.upsertDaily requires Date and Month_Year on the entry');
    }
    _stamp(entry);
    const idx = findDailyIndex(entry.Date, entry.Month_Year);
    if (idx === -1) {
      DAILY.push(entry);
      _notify('daily:added', entry);
    } else {
      Object.assign(DAILY[idx], entry);
      _notify('daily:updated', DAILY[idx]);
    }
    invalidateRenderCache && invalidateRenderCache(); // keep existing render-cache behavior working
    return entry;
  }

  function deleteDaily(date, monthYear) {
    const idx = findDailyIndex(date, monthYear);
    if (idx === -1) return false;
    const removed = DAILY[idx];
    DAILY.splice(idx, 1);
    _notify('daily:deleted', removed);
    invalidateRenderCache && invalidateRenderCache();
    return true;
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
  }

  function deleteMonthly(monthYear) {
    const idx = findMonthlyIndex(monthYear);
    if (idx === -1) return false;
    const removed = MONTHLY[idx];
    MONTHLY.splice(idx, 1);
    _notify('monthly:deleted', removed);
    invalidateRenderCache && invalidateRenderCache();
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // CONFLICT DETECTION  (Step 3 — added after discovering supabase.js
  // already has working "local wins on push / remote wins on pull" logic)
  //
  // DECISION WITH OWNER: keep that existing behavior as the default for
  // routine syncs. Only interrupt the user for a genuine double-edit:
  // the SAME record changed on both local and remote since the last
  // successful sync, with different values.
  // ──────────────────────────────────────────────────────────────────────
  const LAST_SYNC_KEY = 'bt_repo_last_synced_at';
  const _conflicts = []; // pending conflicts awaiting user decision, this session

  function getLastSyncedAt() {
    return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
  }
  function markSynced() {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  }

  // Compares the fields that actually matter (ignore our own bookkeeping
  // fields) so we don't flag a "conflict" over metadata that never differs
  // in any way a person would care about.
  function _valuesDiffer(a, b) {
    const ignore = new Set(['_updatedAt', '_source']);
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (ignore.has(k)) continue;
      if ((a ? a[k] : undefined) !== (b ? b[k] : undefined)) return true;
    }
    return false;
  }

  // local: the record currently in DAILY/MONTHLY (may be undefined if new).
  // incoming: the record arriving from a pull (Supabase/Drive).
  // Returns true only for a genuine double-edit; false for routine merges
  // (new record, or only one side changed since last sync).
  function isGenuineConflict(local, incoming) {
    if (!local || !incoming) return false; // one side is brand new — not a conflict
    const lastSync = getLastSyncedAt();
    const localChangedSinceSync   = (local._updatedAt    || 0) > lastSync;
    const incomingChangedSinceSync = (incoming._updatedAt || 0) > lastSync;
    if (!localChangedSinceSync || !incomingChangedSinceSync) return false;
    return _valuesDiffer(local, incoming);
  }

  // Queue a conflict for the user to resolve, keeping BOTH versions —
  // nothing is discarded automatically. UI layer (Step 4+) will read this
  // queue and show the "Conflict — choose which to keep" prompt.
  function queueConflict(kind, key, local, incoming) {
    _conflicts.push({
      kind,                 // 'daily' | 'monthly'
      key,                  // e.g. "12/Jun/2026|June 2026"
      local, incoming,
      queuedAt: Date.now(),
    });
    _notify('conflict:queued', _conflicts[_conflicts.length - 1]);
  }

  function getPendingConflicts() {
    return _conflicts.slice();
  }

  // User picked which version to keep. 'choice' is 'local' or 'incoming'.
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
  // PULL MERGE  (consolidates the logic previously duplicated across
  // storage.js idbLoadData, supabase.js mergeIncomingData, drive.js pull,
  // and manager.js's legacy restore — all of which did their own
  // findIndex+push/assign with no conflict awareness at all)
  //
  // Routine case (no genuine conflict): same behavior as before —
  // new record → add; existing record on pull → remote overwrites local.
  // Genuine conflict case: do NOT overwrite. Queue it, keep both.
  // ──────────────────────────────────────────────────────────────────────
  function mergePulledDaily(incomingArr) {
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
        Object.assign(DAILY[idx], incoming); // routine: remote wins on pull, as before
        updated++;
      }
    });
    if (added || updated) { _notify('daily:pulled', { added, updated, conflicts }); invalidateRenderCache && invalidateRenderCache(); }
    return { added, updated, conflicts };
  }

  function mergePulledMonthly(incomingArr) {
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
        Object.assign(MONTHLY[idx], incoming); // routine: remote wins on pull, as before
        updated++;
      }
    });
    if (added || updated) { _notify('monthly:pulled', { added, updated, conflicts }); invalidateRenderCache && invalidateRenderCache(); }
    return { added, updated, conflicts };
  }

  // ── Floor 2 observability: track mutations that bypassed Repository ──
  // Not a hard block (would break the intentional direct push in
  // supabase.js's push-direction gap-fill) — but every raw mutation is
  // now counted and notified, instead of being invisible.
  let _rawMutationCounts = { MONTHLY: 0, DAILY: 0 };
  function _noteRawMutation(label) {
    _rawMutationCounts[label] = (_rawMutationCounts[label] || 0) + 1;
    _notify('raw:mutation', { label, count: _rawMutationCounts[label] });
  }
  function getRawMutationStats() {
    return { ..._rawMutationCounts };
  }

  // ──────────────────────────────────────────────────────────────────────
  // GENERIC KEY/VALUE STORE  (Floor 1 extension)
  //
  // DAILY/MONTHLY have their own CRUD above because they're arrays of
  // records found by composite key (Date+Month_Year). Every OTHER feature
  // (Manager Work, Notes/Sheets, Targets, Custom Sections, AI Memory/
  // Instructions, Field Manager config, Command Hub recents, app settings)
  // stores its entire state as a single JSON blob under one localStorage
  // key — so they don't need find/upsert/delete, just get/set.
  //
  // This wrapper mirrors localStorage.getItem/setItem's exact string-in/
  // string-out contract, so every existing call site's JSON.parse(...)/
  // JSON.stringify(...) code keeps working unchanged — only the function
  // being called changes (Repository.getItem instead of localStorage.
  // getItem). Every set is stamped and announced on the event bus, same
  // as DAILY/MONTHLY, closing the "many doors" gap for these 9 features.
  // ──────────────────────────────────────────────────────────────────────
  function getItem(key) {
    return localStorage.getItem(key);
  }
  function setItem(key, value) {
    localStorage.setItem(key, value);
    // Event payload includes the value itself, not just the key — any
    // future subscriber can react without an extra read. Deliberately NOT
    // auto-triggering re-renders here: notes-sheets.js writes on nearly
    // every keystroke while editing a cell, so wiring automatic re-render
    // on every 'item:changed' event risks a render-triggers-write-
    // triggers-render storm. Each feature's page still controls when it
    // re-renders — this just guarantees the announcement always happens.
    _notify('item:changed', { key, value });
  }
  function removeItem(key) {
    localStorage.removeItem(key);
    _notify('item:removed', { key });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────
  return {
    // daily
    getDaily, getDailyEntry, upsertDaily, deleteDaily,
    // monthly
    getMonthly, getMonthlyEntry, upsertMonthly, deleteMonthly,
    // pull/merge (Step 3)
    mergePulledDaily, mergePulledMonthly,
    // conflicts (Step 3)
    isGenuineConflict, getPendingConflicts, resolveConflict,
    markSynced, getLastSyncedAt,
    // generic key/value (Floor 1 extension)
    getItem, setItem, removeItem,
    // event bus (Floor 3)
    onChange,
    // Floor 2 observability
    _noteRawMutation, getRawMutationStats,
  };

})();

// ══════════════════════════════════════════════════════════════════════
// FLOOR 3 — ACTIONS
//
// The named, intention-revealing API that Pages (Floor 5) should call.
// Today this is a thin wrapper over Repository (since Repository already
// IS the one door for data + the event bus) — but it gives every future
// page a single, documented set of verbs to call instead of reaching
// into Repository's lower-level CRUD directly. New pages/components
// should call Actions.*, not Repository.* or DAILY/MONTHLY directly.
// ══════════════════════════════════════════════════════════════════════
const Actions = (function () {

  function addDailyEntry(entry) {
    return Repository.upsertDaily(entry);
  }
  function editDailyEntry(date, monthYear, changes) {
    const existing = Repository.getDailyEntry(date, monthYear);
    if (!existing) throw new Error('Actions.editDailyEntry: no entry found for ' + date + '/' + monthYear);
    Object.assign(existing, changes);
    return Repository.upsertDaily(existing);
  }
  function removeDailyEntry(date, monthYear) {
    return Repository.deleteDaily(date, monthYear);
  }
  function addOrUpdateMonth(entry) {
    return Repository.upsertMonthly(entry);
  }
  function removeMonth(monthYear) {
    return Repository.deleteMonthly(monthYear);
  }
  function resolveConflict(index, choice) {
    return Repository.resolveConflict(index, choice);
  }

  function saveFeatureData(key, value) {
    // Generic save for the 9 features that store one JSON blob per key
    // (Manager Work, Notes/Sheets, Targets, Custom Sections, AI Memory/
    // Instructions, Field Manager config, Command Hub recents, settings).
    return Repository.setItem(key, value);
  }
  function loadFeatureData(key) {
    return Repository.getItem(key);
  }
  function clearFeatureData(key) {
    return Repository.removeItem(key);
  }

  // Named, intention-revealing verbs per feature (Floor 3 requirement:
  // Actions should read like documented business operations, not a single
  // generic "saveSomething(key)" call). Each is a thin wrapper over
  // saveFeatureData — zero behavior change, just a clearer, discoverable
  // API for any future page/component to call instead of remembering
  // raw storage key strings.
  function saveManagerWork(data)      { return saveFeatureData('BT_ManagerWork_v1', JSON.stringify(data)); }
  function saveTargets(json)          { return saveFeatureData('bt_targets', json); }
  function saveCustomSections(json)   { return saveFeatureData('mw_custom_sections_v1', json); }
  function saveFieldConfig(key, json) { return saveFeatureData(key, json); } // key: bt_col_config | bt_custom_cols
  function saveNotes(json)            { return saveFeatureData('bt_notes_v1', json); }
  function saveSheets(json)           { return saveFeatureData('bt_sheets_v1', json); }
  function saveSheetFiles(json)       { return saveFeatureData('bt_sheet_files_v1', json); }
  function saveAiInstructions(json)   { return saveFeatureData('bt_ai_instructions_v1', json); }
  function saveAiMemoryItem(key, value) { return saveFeatureData(key, value); }
  function saveCommandHubRecents(json){ return saveFeatureData('bt_cmdhub_recent', json); }
  function saveAppSetting(key, value) { return saveFeatureData(key, value); } // bt_auto_load | bt_auto_save | bt_view_mode

  return {
    addDailyEntry, editDailyEntry, removeDailyEntry,
    addOrUpdateMonth, removeMonth,
    resolveConflict,
    saveFeatureData, loadFeatureData, clearFeatureData,
    // named per-feature verbs
    saveManagerWork, saveTargets, saveCustomSections, saveFieldConfig,
    saveNotes, saveSheets, saveSheetFiles, saveAiInstructions,
    saveAiMemoryItem, saveCommandHubRecents, saveAppSetting,
  };

})();

// ── Temporary conflict review flow (functional placeholder) ───────────────
// A proper modal UI is planned for the final UI pass. Until then, this
// gives a real way to resolve a flagged conflict instead of leaving it
// stuck with no path to act on it. Call from the console or wire a button
// to it: reviewConflicts()
function reviewConflicts() {
  const pending = Repository.getPendingConflicts();
  if (!pending.length) { if (typeof toast === 'function') toast('No pending conflicts'); return; }
  pending.forEach((c, i) => {
    const label = c.kind === 'daily' ? `Daily entry ${c.key}` : `Monthly ${c.key}`;
    const localTotal = c.local.TOTAL, incomingTotal = c.incoming.TOTAL;
    const msg = `${label} was edited on two devices.\n\n`
      + `This device:  TOTAL = ${localTotal}\n`
      + `Other device: TOTAL = ${incomingTotal}\n\n`
      + `Click OK to keep THIS device's version, Cancel to keep the OTHER device's version.`;
    const keepLocal = window.confirm(msg);
    Repository.resolveConflict(0, keepLocal ? 'local' : 'incoming'); // index 0: list shrinks as we resolve
  });
  if (typeof rebuildAll === 'function') rebuildAll();
  if (typeof toast === 'function') toast('✓ Conflicts resolved');
}
