// ══════════════════════════════════════════════════════════════════════
// ACTIONS  —  Floor 3 of the architecture (promoted out of repository.js)
//
// The named, intention-revealing API that Pages (Floor 5) call.
// EVERY data change enters through here. No page/component touches
// Repository, localStorage, DAILY, MONTHLY, or STAFF directly.
//
// Load order requirement: repository.js → actions.js → all pages/features
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { computeDailyTotals } from './config.js';
import { EventBus } from './event-bus.js';

export const Actions = (function () {

  // ── DAILY ────────────────────────────────────────────────────────────

  function addDailyEntry(entry) {
    return Repository.upsertDaily(entry);
  }

  function editDailyEntry(date, monthYear, changes) {
    const existing = Repository.getDailyEntry(date, monthYear);
    if (!existing) throw new Error('Actions.editDailyEntry: no entry found for ' + date + '/' + monthYear);
    Object.assign(existing, changes);
    computeDailyTotals(existing); // single source of truth (config.js) — Pages no longer compute this
    return Repository.upsertDaily(existing);
  }

  function removeDailyEntry(date, monthYear) {
    return Repository.deleteDaily(date, monthYear);
  }

  // Session pending-entries log (the "newEntries" list) — a UI convenience
  // list of what this device added this session, kept separate from the
  // authoritative DAILY writes above. Closes the ghost-state gap where
  // pages used to splice/push the `newEntries` array directly.
  function recordPendingEntry(entry) {
    return Repository.upsertPendingEntry(entry);
  }
  function forgetPendingEntry(date, monthYear) {
    return Repository.removePendingEntry(date, monthYear);
  }

  // ── MONTHLY ──────────────────────────────────────────────────────────

  function addOrUpdateMonth(entry) {
    return Repository.upsertMonthly(entry);
  }

  function removeMonth(monthYear) {
    return Repository.deleteMonthly(monthYear);
  }

  // ── STAFF ────────────────────────────────────────────────────────────

  function addEmployee(empObj) {
    const staff = Repository.getStaff();
    const num   = staff.length + 1;
    const maxSr = staff.reduce((m, e) => Math.max(m, Number(e.srNum) || 0), 0);
    const newEmp = Object.assign({
      id:          'emp_' + Date.now(),
      staffId:     'EMP-' + String(num).padStart(3, '0'),
      srNum:       maxSr + 1,
      name:        '',
      designation: 'Salesman',
      fatherName:  '',
      cnic:        '',
      phone:       '',
      address:     '',
      bloodGroup:  '',
      doj:         new Date().toISOString().split('T')[0],
      active:      true,
    }, empObj || {});
    Repository.addStaffMember(newEmp);
    EventBus.notify('staff:added', newEmp);
    return newEmp;
  }

  // Update one or more fields on employee at index i.
  // i is the current position in Repository.getStaff() — caller is
  // responsible for passing a valid, current index.
  function updateEmployee(i, changes) {
    const updated = Repository.updateStaffMember(i, changes);
    EventBus.notify('staff:updated', updated);
    return updated;
  }

  function removeEmployee(i) {
    const removed = Repository.removeStaffMember(i);
    EventBus.notify('staff:removed', { index: i, employee: removed });
    return removed;
  }

  // Replace the entire staff array (used by Supabase pull merge).
  function setStaff(newArr) {
    return Repository.setStaff(newArr);
  }

  // ── CONFLICT RESOLUTION ──────────────────────────────────────────────

  function resolveConflict(index, choice) {
    return Repository.resolveConflict(index, choice);
  }

  // ── GENERIC FEATURE DATA (localStorage key/value blobs) ──────────────

  function saveFeatureData(key, value) {
    return Repository.setItem(key, value);
  }
  function loadFeatureData(key) {
    return Repository.getItem(key);
  }
  function clearFeatureData(key) {
    return Repository.removeItem(key);
  }

  // Named per-feature verbs (Floor 3 requirement: reads like a business
  // operation, not a raw "saveSomething(key)". Each wraps saveFeatureData.)
  function saveManagerWork(data)       { return saveFeatureData('BT_ManagerWork_v1', JSON.stringify(data)); }
  function saveTargets(json)           { return saveFeatureData('bt_targets', json); }
  function saveCustomSections(json)    { return saveFeatureData('mw_custom_sections_v1', json); }
  function saveFieldConfig(key, json)  { return saveFeatureData(key, json); } // key: bt_col_config | bt_custom_cols
  function saveNotes(json)             { return saveFeatureData('bt_notes_v1', json); }
  function saveSheets(json)            { return saveFeatureData('bt_sheets_v2', json); } // v2 = new format with cell formatting — was hardcoded to v1, a stale key (audit-caught bug)
  function saveSheetFiles(json)        { return saveFeatureData('bt_sheet_files_v1', json); }
  function saveAiInstructions(json)    { return saveFeatureData('bt_ai_instructions_v1', json); }
  function saveAiMemoryItem(key, val)  { return saveFeatureData(key, val); }
  function saveCommandHubRecents(json) { return saveFeatureData('bt_cmdhub_recent', json); }
  function saveAppSetting(key, value)  { return saveFeatureData(key, value); }

  // ── NAVIGATION ───────────────────────────────────────────────────────
  // Pages should use Actions.navigate() rather than calling showPage()
  // directly, keeping the architecture's "all changes through actions"
  // rule consistent for navigation state too (closes audit MF-01 gap on
  // _curPage being a raw `let` with no announcement).
  function navigate(pageId) {
    if (typeof showPage === 'function') showPage(pageId);
  }

  // ── DERIVED-DATA RECOMPUTE ───────────────────────────────────────────
  // MONTHLY records are DERIVED from DAILY (sums of daily fields), not
  // independent user input. Whenever a daily entry changes, the parent
  // month must be recalculated. This wraps config.js's recomputeMonthly
  // (the computation engine) so callers go through Actions instead of
  // calling the Floor-2 computation function directly (closes the
  // recompute bypass previously present in data-page.js / ai-bridge.js).
  function recomputeMonth(monthYear) {
    if (typeof recomputeMonthly === 'function') recomputeMonthly(monthYear);
  }
  function recomputeAllMonths() {
    if (typeof window.recomputeAllMonths === 'function') window.recomputeAllMonths();
  }

  return {
    // daily
    addDailyEntry, editDailyEntry, removeDailyEntry,
    recordPendingEntry, forgetPendingEntry,
    // monthly
    addOrUpdateMonth, removeMonth,
    // staff
    addEmployee, updateEmployee, removeEmployee, setStaff,
    // conflict
    resolveConflict,
    // feature data
    saveFeatureData, loadFeatureData, clearFeatureData,
    saveManagerWork, saveTargets, saveCustomSections, saveFieldConfig,
    saveNotes, saveSheets, saveSheetFiles, saveAiInstructions,
    saveAiMemoryItem, saveCommandHubRecents, saveAppSetting,
    // navigation
    navigate,
    // derived-data recompute
    recomputeMonth, recomputeAllMonths,
  };

})();

// Bridge onto window — remove once every consumer imports Actions directly.
window.Actions = Actions;

// ══════════════════════════════════════════════════════════════════════
// NOTE ON CONFLICT UI:
// Conflict modal rendering (openConflictModal, _conflictChoose) and the
// reviewConflicts() legacy fallback live in conflict-ui.js (Floor 4/5),
// NOT here. actions.js is a Floor 3 business module and must never touch
// the DOM (Golden Rule 3). conflict-ui.js subscribes to the EventBus
// 'conflict:queued' event itself — actions.js does not need to forward it.
// ══════════════════════════════════════════════════════════════════════
