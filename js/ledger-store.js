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

const LEDGER_KEY = 'bt_ledger_v1';

// ── Category config, one array per ledgerType ───────────────────────────
// Each category carries its own sign, so `amount` in an entry is always
// stored as a positive magnitude — exactly the pattern already proven in
// jazz-cash.js's JC_TYPES, not a signed-amount model. New ledgers (e.g.
// "Other Sections") are added here as a new entry in this config object,
// not new code.
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
  // 'custom:<sectionId>' ledgers get their category list added here at
  // the point a section is actually created — see addCustomLedgerType().
};

const _customLedgerTypes = {}; // populated at runtime for 'custom:*' ledgers

export function getCategoryList(ledgerType) {
  return LEDGER_CATEGORIES[ledgerType] || _customLedgerTypes[ledgerType] || [];
}

export function getCategory(ledgerType, categoryId) {
  const list = getCategoryList(ledgerType);
  return list.find(c => c.id === categoryId) || null;
}

// Lets a future "Other Sections" feature register a brand new ledger
// type at runtime without touching this file's code — exactly the
// "add features without breaking existing code" golden rule.
export function registerLedgerType(ledgerType, categories) {
  _customLedgerTypes[ledgerType] = categories;
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

export function _removeEntry(id) {
  _ensureLoaded();
  const idx = _entries.findIndex(e => e.id === id);
  if (idx === -1) return null;
  const removed = _entries.splice(idx, 1)[0];
  _persist();
  return removed;
}
