// ══════════════════════════════════════════════════════════════════════
// LEDGER ACTIONS  —  Floor 3 of the architecture
//
// The only door Pages should use to change ledger data. Wraps
// ledger-store.js's internal write functions with validation and
// naming that matches the rest of this app's Actions API
// (Actions.addDailyEntry, Actions.addEmployee, etc.).
// ══════════════════════════════════════════════════════════════════════

import { _addEntry, _updateEntry, _removeEntry, _getEntryById, getCategory } from './ledger-store.js';
import * as LedgerStore from './ledger-store.js';

export const LedgerActions = (function () {

  function addEntry(ledgerType, { date, categoryId, amount, desc, groupLabel, shift, source } = {}) {
    if (!ledgerType) throw new Error('LedgerActions.addEntry: ledgerType is required');
    if (!date) throw new Error('LedgerActions.addEntry: date is required');
    const cat = getCategory(ledgerType, categoryId);
    if (!cat) throw new Error('LedgerActions.addEntry: unknown category "' + categoryId + '" for ledger "' + ledgerType + '"');
    return _addEntry({
      ledgerType, date, categoryId,
      amount: Math.abs(parseFloat(amount) || 0), // always a positive magnitude — sign lives on the category
      desc: desc || '',
      groupLabel: groupLabel || null,
      shift: shift || null,
      source: source || null,
    });
  }

  function updateEntry(id, changes) {
    if (changes && 'amount' in changes) changes.amount = Math.abs(parseFloat(changes.amount) || 0);
    if (changes && 'categoryId' in changes) {
      const existing = _getEntryById(id);
      if (existing && !getCategory(existing.ledgerType, changes.categoryId)) {
        throw new Error('LedgerActions.updateEntry: unknown category "' + changes.categoryId + '" for ledger "' + existing.ledgerType + '"');
      }
    }
    return _updateEntry(id, changes);
  }

  function removeEntry(id) {
    return _removeEntry(id);
  }

  // Create/edit/delete an "Other Section" — the section-management half
  // of the Ledger, distinct from entry-level add/update/remove above.
  // Kept behind this same "one door" so Pages never call LedgerStore's
  // custom-type functions directly.
  function createSection(sectionId, label, categories) {
    return LedgerStore.createCustomLedgerType(sectionId, label, categories);
  }

  function updateSection(ledgerType, changes) {
    return LedgerStore.updateCustomLedgerType(ledgerType, changes);
  }

  // `force` deletes every entry under this section first — the caller
  // (ledger-page.js) is responsible for getting explicit user
  // confirmation before ever passing force:true.
  function deleteSection(ledgerType, force) {
    return LedgerStore.deleteCustomLedgerType(ledgerType, !!force);
  }

  return { addEntry, updateEntry, removeEntry, createSection, updateSection, deleteSection };

})();

// ── Window bridge — classic-script consumers (ai-bridge.js's Jazz Cash
// intent executors, ledger-migration's callers) use LedgerActions the
// same way Repository/Actions are used elsewhere: the one door for
// writes, never LedgerStore's underscore-prefixed internals directly.
window.LedgerActions = LedgerActions;
