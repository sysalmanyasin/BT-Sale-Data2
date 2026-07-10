// ══════════════════════════════════════════════════════════════════════
// LEDGER STORE  —  Floor 1/2 of the architecture
//
// A single generalized ledger model, replacing what used to be three
// separate builds: Jazz Cash (jazz-cash.js), Petty/Expenses (part of
// manager.js), and — potentially — Cash Closing's credit ledger. One
// entry shape, one category config per ledger type, one balance
// calculation, reused everywhere instead of rebuilt per feature.
//
// Real ES module from day one — no window-bridge compromise, since
// nothing in the existing app depends on this yet. Pages/Actions that
// want to use this import it directly: `import { LedgerStore } from
// './ledger-store.js'`.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { EventBus } from './event-bus.js';

export const LEDGER_KEY = 'bt_ledger_v1';

// Shift options — only meaningful for ledger types that opt in below
// (currently just 'jazzcash', migrated from jazz-cash.js's JC_SHIFTS).
export const SHIFTS = ['Morning', 'Evening', 'Night', 'Both', 'Off'];
const LEDGER_TYPES_WITH_SHIFT = { jazzcash: true };
export function ledgerUsesShift(ledgerType) { return !!LEDGER_TYPES_WITH_SHIFT[ledgerType]; }

// ── Category config, one array per ledgerType ───────────────────────────
// Each category carries its own sign, so `amount` in an entry is always
// stored as a positive magnitude — exactly the pattern already proven in
// jazz-cash.js's JC_TYPES, not a signed-amount model. New built-in
// ledgers are added here as a new entry in this config object, not new
// code. User-created "Other Sections" ledgers go through the persisted
// custom-type registry below instead, since their categories aren't
// known ahead of time.
export const LEDGER_CATEGORIES = {
  jazzcash: [
    { id: 'credit',     label: 'Received (+)',            sign: +1, color: 'var(--green)',  icon: '⬆' },
    { id: 'debit',      label: 'Patty Incentive (−)',      sign: -1, color: 'var(--red)',    icon: '⬇' },
    { id: 'withdrawal', label: 'Generic Incentive (−)',    sign: -1, color: 'var(--amber)',  icon: '💸' },
    { id: 'commission', label: 'Strips / Adjustments (−)', sign: -1, color: 'var(--purple)', icon: '🏅' },
    { id: 'transfer',   label: 'Transfer (−)',             sign: -1, color: 'var(--muted)',  icon: '↔' },
  ],
  petty: [
    { id: 'expense', label: 'Expense', sign: -1, color: 'var(--red)', icon: '🧾' },
  ],
  // Matches the real, currently-used Expense tab exactly (Bill Amt /
  // Fuel-HO / Soap-Tissue / Refreshment / Extra / Patty H/O) — same
  // mental model, now continuous instead of month-scoped, and each
  // entry writes immediately instead of sitting unsaved in memory
  // until a manual Save click (the actual root cause of the data-loss
  // bug reported against the old Expense tab).
  // SIGN CONVENTION (flipped per explicit request): an expense you pay
  // out of pocket (Bill Amount, Fuel/HO, Soap/Tissue, Refreshment,
  // Extra) now shows as a POSITIVE (+) entry and ADDS to the Patty
  // balance; receiving petty-cash reimbursement from Head Office
  // (Patty H/O) now shows as NEGATIVE (−) and SUBTRACTS from the
  // balance. So "Patty / Expenses" now reads as "how much you're
  // currently owed by HO" — e.g. the same activity that used to show
  // +281 now shows -281. Sign is looked up dynamically from this
  // config everywhere (dashboard, ledger table, print summaries, AI
  // bridge) — nothing else needs to change for this to take effect.
  expense: [
    { id: 'bill',      label: 'Bill Amount',   sign: +1, color: 'var(--red)',    icon: '🧾' },
    { id: 'fuel',      label: 'Fuel/HO',       sign: +1, color: 'var(--amber)',  icon: '⛽' },
    { id: 'soap',      label: 'Soap/Tissue',   sign: +1, color: 'var(--purple)', icon: '🧼' },
    { id: 'refresh',   label: 'Refreshment',   sign: +1, color: 'var(--blue)',   icon: '☕' },
    { id: 'extra',     label: 'Extra',         sign: +1, color: 'var(--muted)',  icon: '➕' },
    { id: 'pattyHO',   label: 'Patty H/O (received)', sign: -1, color: 'var(--green)', icon: '⬆' },
  ],
};

// ── Custom ledger types ("Other Sections") — persisted registry ────────
// Unlike the built-in types above (known ahead of time, defined in code),
// user-created sections aren't known until the user creates one — so
// their definitions (label + category list) are stored, not hardcoded,
// and reloaded on every app start. This is what makes "Other Sections"
// genuinely add-able from the UI without touching this file's code —
// the actual "add features without breaking existing code" golden rule
// in practice, not just in principle.
const CUSTOM_TYPES_KEY = 'bt_ledger_custom_types_v1';
let _customLedgerTypes = null; // { [ledgerType]: { label, categories: [...] } }

// One-time sign-flip migration (per explicit request): "Outflow (−)"
// categories in every custom "Other Section" now mean + and add to the
// section's total, "Inflow (+)" categories now mean − and subtract.
// This runs exactly once, the first time custom types load after this
// change ships — guarded by a flag so re-loading the app (or this
// function running again) never flips signs a second time. Only the
// sign is flipped here; label text is handled separately by the
// Outflow/Inflow dropdown in ledger-page.js for any category added or
// edited going forward.
const SIGN_FLIP_DONE_KEY = 'bt_ledger_signflip_v1_done';
function _runSignFlipMigrationOnce() {
  if (Repository.getItem(SIGN_FLIP_DONE_KEY)) return;
  Object.keys(_customLedgerTypes).forEach(ledgerType => {
    const def = _customLedgerTypes[ledgerType];
    (def.categories || []).forEach(cat => {
      cat.sign = -cat.sign;
      cat.color = cat.sign > 0 ? 'var(--green)' : 'var(--red)';
      cat.icon = cat.sign > 0 ? '⬆' : '⬇';
    });
  });
  Repository.setItem(SIGN_FLIP_DONE_KEY, '1');
  Repository.setItem(CUSTOM_TYPES_KEY, JSON.stringify(_customLedgerTypes));
}

function _ensureCustomTypesLoaded() {
  if (_customLedgerTypes !== null) return;
  try {
    const raw = Repository.getItem(CUSTOM_TYPES_KEY);
    _customLedgerTypes = raw ? JSON.parse(raw) : {};
  } catch (e) {
    _customLedgerTypes = {};
  }
  _runSignFlipMigrationOnce();
}

function _persistCustomTypes() {
  Repository.setItem(CUSTOM_TYPES_KEY, JSON.stringify(_customLedgerTypes));
  EventBus.notify('ledger:customTypesChanged', { types: _customLedgerTypes });
}

export function getCategoryList(ledgerType) {
  if (LEDGER_CATEGORIES[ledgerType]) return LEDGER_CATEGORIES[ledgerType];
  _ensureCustomTypesLoaded();
  return (_customLedgerTypes[ledgerType] && _customLedgerTypes[ledgerType].categories) || [];
}

export function getCategory(ledgerType, categoryId) {
  const list = getCategoryList(ledgerType);
  return list.find(c => c.id === categoryId) || null;
}

// Creates a brand new "Other Section" ledger type — e.g.
// createCustomLedgerType('office-supplies', 'Office Supplies',
//   [{id:'amount', label:'Amount', sign:-1, color:'var(--red)', icon:'📦'}])
// ledgerType passed to everything else should be `'custom:' + sectionId`
// to keep custom types visually distinct from built-ins at a glance.
export function createCustomLedgerType(sectionId, label, categories) {
  _ensureCustomTypesLoaded();
  const ledgerType = 'custom:' + sectionId;
  if (LEDGER_CATEGORIES[ledgerType] || _customLedgerTypes[ledgerType]) {
    throw new Error('LedgerStore: a ledger type already exists for "' + sectionId + '"');
  }
  if (!Array.isArray(categories) || !categories.length) {
    throw new Error('LedgerStore: createCustomLedgerType requires at least one category');
  }
  _customLedgerTypes[ledgerType] = { label: label || sectionId, categories };
  _persistCustomTypes();
  return ledgerType;
}

// Renames a custom section and/or replaces its category list. Existing
// entries keep their categoryId as-is — if a category was removed in
// `categories`, those entries fall back to "unknown category" rendering
// (see ledger-page.js's `cat ? ... : '<em>unknown</em>'`) rather than
// being deleted, so no historical entry ever silently disappears.
export function updateCustomLedgerType(ledgerType, { label, categories } = {}) {
  _ensureCustomTypesLoaded();
  const existing = _customLedgerTypes[ledgerType];
  if (!existing) throw new Error('LedgerStore: no custom ledger type found for "' + ledgerType + '"');
  if (categories !== undefined) {
    if (!Array.isArray(categories) || !categories.length) {
      throw new Error('LedgerStore: at least one category is required');
    }
    existing.categories = categories;
  }
  if (label !== undefined && label !== null && String(label).trim()) {
    existing.label = String(label).trim();
  }
  _persistCustomTypes();
  return existing;
}

// `force`, when true, also deletes every entry belonging to this ledger
// type first — the explicit, opt-in escape hatch for a user who really
// does want to remove a section along with its data (surfaced in the UI
// as a second, clearly-worded confirmation before this is ever called).
export function deleteCustomLedgerType(ledgerType, force) {
  _ensureCustomTypesLoaded();
  if (!_customLedgerTypes[ledgerType]) return false;
  const existingEntries = getEntries(ledgerType);
  if (existingEntries.length > 0) {
    if (!force) {
      throw new Error('LedgerStore: cannot delete "' + ledgerType + '" — it still has entries. Remove them first.');
    }
    _ensureLoaded();
    _entries = _entries.filter(e => e.ledgerType !== ledgerType);
    _persist();
  }
  delete _customLedgerTypes[ledgerType];
  delete _openingBalances[ledgerType];
  _persistCustomTypes();
  return true;
}

// Enumerates every ledger type that currently exists — built-in and
// custom — so a future "Other Sections" navigation page can list them
// without needing to know their ids ahead of time.
export function getAllLedgerTypes() {
  _ensureCustomTypesLoaded();
  const builtIn = Object.keys(LEDGER_CATEGORIES).map(id => ({ id, label: id, isCustom: false }));
  const custom = Object.keys(_customLedgerTypes).map(id => ({ id, label: _customLedgerTypes[id].label, isCustom: true }));
  return [...builtIn, ...custom];
}

// ── State ────────────────────────────────────────────────────────────
// One flat array for every ledger type. Loaded lazily on first access
// (not at module-load time), same reasoning as the rest of this app's
// data: nothing should assume Repository has finished its own load
// sequence before this module is even imported.
let _entries = null;
let _openingBalances = null; // { [ledgerType]: number }

function _ensureLoaded() {
  if (_entries !== null) return;
  try {
    const raw = Repository.getItem(LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    _entries = (parsed && Array.isArray(parsed.entries)) ? parsed.entries : [];
    _openingBalances = (parsed && parsed.openingBalances) ? parsed.openingBalances : {};
  } catch (e) {
    _entries = [];
    _openingBalances = {};
  }
}

function _persist() {
  Repository.setItem(LEDGER_KEY, JSON.stringify({ entries: _entries, openingBalances: _openingBalances }));
  EventBus.notify('ledger:changed', { entries: _entries });
}

function _stamp(entry) {
  entry._updatedAt = Date.now();
  return entry;
}

// ── Reads ────────────────────────────────────────────────────────────
export function getEntries(ledgerType) {
  _ensureLoaded();
  return _entries
    .filter(e => e.ledgerType === ledgerType)
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export function getOpeningBalance(ledgerType) {
  _ensureLoaded();
  return _openingBalances[ledgerType] || 0;
}

export function setOpeningBalance(ledgerType, value) {
  _ensureLoaded();
  _openingBalances[ledgerType] = Number(value) || 0;
  _persist();
}

// Running balance — same math as jazz-cash.js's _jcRunningBalances,
// generalized to read the sign from the category config instead of a
// hardcoded per-file type list.
export function getEntriesWithBalance(ledgerType) {
  const opening = getOpeningBalance(ledgerType);
  let bal = opening;
  return getEntries(ledgerType).map(e => {
    const cat = getCategory(ledgerType, e.categoryId);
    const sign = cat ? cat.sign : -1;
    bal += sign * (parseFloat(e.amount) || 0);
    return { ...e, _balance: bal };
  });
}

export function getCurrentBalance(ledgerType) {
  const withBal = getEntriesWithBalance(ledgerType);
  return withBal.length ? withBal[withBal.length - 1]._balance : getOpeningBalance(ledgerType);
}

// ── Writes — internal, called only by ledger-actions.js ─────────────
// (Not exported as the public API on purpose — mirrors the rest of the
// app's "Actions is the one door" rule. ledger-actions.js is the only
// intended caller of these three.)
export function _addEntry(entry) {
  _ensureLoaded();
  const withId = { id: entry.id || ('ldg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)), ...entry };
  _stamp(withId);
  _entries.push(withId);
  _persist();
  return withId;
}

export function _updateEntry(id, changes) {
  _ensureLoaded();
  const idx = _entries.findIndex(e => e.id === id);
  if (idx === -1) throw new Error('LedgerStore: no entry found for id ' + id);
  Object.assign(_entries[idx], changes);
  _stamp(_entries[idx]);
  _persist();
  return _entries[idx];
}

// Looks up one entry by id regardless of ledgerType — used by
// LedgerActions.updateEntry to validate a categoryId change against the
// entry's *own* ledgerType (an edit form never lets ledgerType itself
// change, only its date/category/amount/desc/shift).
export function _getEntryById(id) {
  _ensureLoaded();
  return _entries.find(e => e.id === id) || null;
}

export function _removeEntry(id) {
  _ensureLoaded();
  const idx = _entries.findIndex(e => e.id === id);
  if (idx === -1) return null;
  const removed = _entries.splice(idx, 1)[0];
  _persist();
  return removed;
}

// ── Window bridge ────────────────────────────────────────────────────
// Classic-script consumers need this: jazz-cash.js's Balance Tally panel
// reads the live Jazz Cash ledger balance, and drive.js/supabase.js back
// up and sync the raw storage keys directly (same established pattern as
// JC_KEY/CSEC_KEY elsewhere in this app — a bare `const` in a module
// never reaches a classic script's global scope, only `window.X` does).
// Only the read-oriented + genuinely-safe-to-call-directly surface is
// bridged (not _addEntry/_updateEntry/_removeEntry — those stay behind
// LedgerActions, the one door, same as everywhere else in this app).
window.LEDGER_KEY = LEDGER_KEY;
window.LEDGER_CUSTOM_TYPES_KEY = CUSTOM_TYPES_KEY;
window.LedgerStore = {
  SHIFTS, ledgerUsesShift,
  getCategoryList, getCategory, getAllLedgerTypes,
  createCustomLedgerType, updateCustomLedgerType, deleteCustomLedgerType,
  getEntries, getEntriesWithBalance, getOpeningBalance, setOpeningBalance,
  getCurrentBalance,
};
