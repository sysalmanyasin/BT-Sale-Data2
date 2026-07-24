// ══════════════════════════════════════════════════════════════════════
// AIBridge v5 — Full Personal Assistant for Bahria Town Sales IC
//
// AI calls go through js/ai/core/ai-client.js's callAI(), which loops a
// configured provider list (js/ai/core/ai-providers.config.js) with
// automatic fallback — this file no longer knows or cares which
// model/provider actually serves a given request.
// Rule-based parsers run first for instant responses.
//
// Module-migration: converted from classic <script defer> to a real ES
// module. Consumers checked via grep: ai-context.js, ai-helpers.js, and
// commandhub-page.js all call this file's functions as bare identifiers
// (e.g. `aiBridgeAnswer(text)`, `typeof _callGroqVision === 'function'`)
// rather than `window.aiBridgeAnswer`. All three are still classic
// scripts, and a bare-identifier read in ANY script (classic or module)
// falls back to the global object when nothing local shadows it — so
// the `window.X = X` bridges at the bottom of this file are kept
// exactly as before; those three files need no changes.
//
// Real imports below replace the `typeof X !== 'undefined'` guards for
// Repository/BTDate/LedgerStore/LedgerActions/STAFF/MONTHLY — those six
// now have real module exports. The guards themselves are left in place
// rather than stripped: unlike the BTSearch/BTFormat/BTDate cleanup in
// commandhub.js, none of them wrap a duplicate fallback implementation
// here — they're just defensive early-returns/toasts, so removing them
// would be pure churn for zero behavior change. getAppContext/
// getAppContextSummary (app-context.js), showPage/toast (ui.js), and
// every Manager/print/report function are left as bare identifiers —
// those source files don't export real ES bindings yet, so they still
// resolve via their own window bridges, same as before this change.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { BTDate } from './bt-date.js';
import * as LedgerStore from './ledger-store.js';
import { LedgerActions } from './ledger-actions.js';
import { STAFF, MONTHLY } from './config.js';
import { callAI, getProviderKey, saveProviderKey } from './ai/core/ai-client.js';
import { InventoryDomain } from './ai/domains/inventory-domain.js';
import { allPageSynonyms } from './ai/core/registry.js';
import {
  _aiTodayStr, _aiCurrentMonthYear, _aiResolveMonth, _aiMonthYearFor,
  _aiIsoMonthOf, _aiIsoTodayStr, _aiToIsoDate
} from './ai/core/ai-datetime.js';
// Phase 5.2 — Manager and Sales domain handlers now live in their own
// files (verbatim move, see each file's header). Imported back by name
// so this file's switch statement and every other call site below is
// unchanged.
import {
  _aiFuzzyStaff, _aiFuzzyStaffIndex, _aiReadStaffInfo, _aiParseStaffQuery,
  _aiAddStaff, _aiDeactivateStaff, _aiReactivateStaff, _aiDeleteStaff, _aiEditStaffField,
  _aiReadNetSalary, _aiReadTotalSalaryPayout, _aiParseSalaryQuery, _aiAddSalaryRow,
  _aiEditSalaryRow, _aiDeleteSalaryRow, _aiReadGenericDetail, _aiReadTotalIncentive,
  _aiParseGenericQuery, _aiAddGenericRow, _aiEditGenericRow, _aiDeleteGenericRow,
  _aiParseExpenseCommand, _aiReadExpenseSummary, _aiParseExpenseQuery, _aiAddExpenseRow,
  _aiParsePettyCommand, _aiAddPettyItem, _aiAddPettyGroup, _aiDeletePettyRow, _aiDeletePettyGroup,
  _aiParseCreditCommand, _aiParseCreditQuery, _aiReadCreditBalance, _aiAddCreditEntry,
  _aiAddCreditEmployee, _aiDeleteCreditEntry, _aiDeleteCreditEmployee, _aiSetCreditEmpField,
  _aiPrintMgrReport
} from './ai/domains/manager-domain.js';
import {
  _aiParseDailyFieldCommand, _aiSetDailyField, _aiSaveNewDailyEntry, _aiEditDailyEntry,
  _aiDeleteDailyEntry, _aiParseDateReport, _aiSwitchMonth, _aiSetMonthTarget, _aiDeleteMonthTarget,
  _aiParseTargetCommand
} from './ai/domains/sales-domain.js';

// ── Field alias map (must be a top-level export — `export` is illegal
// inside the IIFE below, which caused this whole module to fail to
// parse/load, which in turn left window.aiBridgeAnswer undefined) ────
export const _AI_FIELD_ALIASES = {
  'jazz cash':        'Meezan_Bank',
  'jazzcash':         'Meezan_Bank',
  'jazz':             'Meezan_Bank',
  'paysa':            'Meezan_Bank',
  'meezan':           'Meezan_Bank',
  'meezan bank':      'Meezan_Bank',
  'hbl':              'HBL',
  'mcb':              'MCB',
  'alfalah':          'Alfala_Bank',
  'bank alfalah':     'Alfala_Bank',
  'alfala':           'Alfala_Bank',
  'al habib':         'Bank_Al_Habib',
  'bank al habib':    'Bank_Al_Habib',
  'habib':            'Bank_Al_Habib',
  'askari':           'Askari_Bank',
  'pso':              'PSO',
  'pso returns':      'PSO_Returns',
  'nespak':           'NESPAK',
  'parco':            'PARCO',
  'tepa':             'TEPA',
  'lda':              'LDA',
  'gourmet':          'Gourmet',
  'cash':             'Cash_Sale',
  'cash sale':        'Cash_Sale',
  'cash returns':     'Cash_Returns',
  'customers':        'Customers',
  'fdpp':             'FDPP',
  'fdpp consumer':    'FDPP_Con',
  'load sale':        'Load_Sale',
  'amount received':  'Amount_Received',
  'comp sale':        'COMP_SALE',
};

// ── Groq key storage (Settings-panel key; read by ai-client.js) ───────
(function() {
'use strict';

const _AI_KEY_STORAGE = 'BT_Groq_Key_v1';

function getAiSettings() {
  let key = '';
  try { key = localStorage.getItem(_AI_KEY_STORAGE) || ''; } catch (_) {}
  return { provider: 'groq', apiKey: key };
}
function saveAiSettings(apiKey) {
  try {
    if (apiKey) localStorage.setItem(_AI_KEY_STORAGE, apiKey.trim());
    else localStorage.removeItem(_AI_KEY_STORAGE);
  } catch (_) {}
}
function clearAiSettings() {
  try { localStorage.removeItem(_AI_KEY_STORAGE); } catch (_) {}
}
function aiHasKey() { return !!getAiSettings().apiKey; }

// ── Prompt cache — rebuilt only when staff count or current month changes ──
// Avoids re-reading localStorage + rebuilding staff/section strings on every Groq call.
var _promptCache = { staffList: null, customSections: null, cacheKey: '' };

function _buildStaticPromptParts() {
  var staffLen = 0;
  try { staffLen = (typeof STAFF !== 'undefined' && STAFF) ? STAFF.length : 0; } catch (_) {}
  var cacheKey = staffLen + '|' + _aiCurrentMonthYear();
  if (_promptCache.cacheKey === cacheKey) {
    return { staffList: _promptCache.staffList, customSections: _promptCache.customSections };
  }
  var staffList = '';
  try {
    if (typeof STAFF !== 'undefined' && STAFF.length) {
      var names = STAFF.filter(function(s){ return s.active !== false; })
                       .map(function(s){ return s.name; }).filter(Boolean);
      if (names.length) staffList = '\nACTIVE STAFF: ' + names.join(', ');
    }
  } catch (_) {}
  var customSections = '';
  try {
    var _csTypes = (typeof LedgerStore !== 'undefined') ? LedgerStore.getAllLedgerTypes().filter(function(x){ return x.isCustom; }) : [];
    var _csSecs = _csTypes.map(function(x){
      var cats = LedgerStore.getCategoryList(x.id);
      var icon = (cats[0] && cats[0].icon) || '📋';
      return icon + ' ' + x.label;
    }).join(', ');
    if (_csSecs) customSections = '\nCUSTOM SECTIONS IN MANAGER: ' + _csSecs;
  } catch (_) {}
  _promptCache = { staffList: staffList, customSections: customSections, cacheKey: cacheKey };
  return { staffList: staffList, customSections: customSections };
}

// ── Safe intent whitelist (ALL intents) ───────────────────────────────
const AI_SAFE_INTENTS = new Set([
  // Navigation
  'showPage', 'switchMgrTab',
  // Modals / Reports
  'openDayModal', 'openMonthModal',
  'printMonthReport', 'printYearlyReport', 'printMgrReport',
  'printDayReport', 'printIncentiveReport',
  // Daily Entry
  'setDailyField', 'saveNewDailyEntry', 'editDailyEntry', 'deleteDailyEntry', 'clearEntryForm',
  // Staff
  'addStaff', 'editStaffField', 'deactivateStaff', 'reactivateStaff', 'deleteStaff', 'openStaffCard',
  // Salary
  'addSalaryRow', 'editSalaryRow', 'deleteSalaryRow', 'setSalaryField', 'autoFillSalary',
  // Generic
  'addGenericRow', 'editGenericRow', 'deleteGenericRow', 'setGenericSale',
  // Expense
  'addExpense', 'editExpenseRow', 'deleteExpenseRow',
  // Credit Ledger
  'addCredit', 'addCreditEmployee', 'editCreditEntry', 'deleteCreditEntry',
  'deleteCreditEmployee', 'setCreditEmpField', 'copyToNextMonth',
  // Petty Cash
  'addPettyItem', 'addPettyGroup', 'editPettyRow', 'deletePettyRow', 'deletePettyGroup',
  // Incentive
  'recalcIncentive', 'printIncentiveReport',
  // Targets
  'setMonthTarget', 'deleteMonthTarget',
  // Custom Sections
  'addCustomSectionRow', 'editCustomSectionRow', 'createCustomSection', 'deleteCustomSectionRow', 'deleteCustomSection',
  // Field Manager
  'openFieldManager', 'toggleFieldVisibility', 'addCustomField', 'resetAllFields',
  // Sync / Backup
  'pushToSupabase', 'pullFromSupabase', 'backupToDrive',
  // Month
  'switchMonth', 'copyManagerToNextMonth',
  // AI Memory / Rules / Section AI Config
  'addMemoryFact', 'deleteMemoryFact', 'addRule', 'deleteRule', 'setSectionAiConfig',
  // Jazz Cash Ledger
  'addJazzCashEntry', 'editJazzCashEntry', 'deleteJazzCashEntry',
  // Notes & Sheets
  'addNote', 'showNotesPanel', 'openSheetFile',
  // Memory (Phase 5)
  'openMemoryPanel',
]);

// ── Destructive intents — always require confirm chip ──────────────────
const AI_DESTRUCTIVE_INTENTS = new Set([
  'deleteDailyEntry', 'deleteStaff', 'deactivateStaff',
  'deleteSalaryRow', 'deleteGenericRow', 'deleteExpenseRow',
  'deleteCreditEntry', 'deleteCreditEmployee', 'copyToNextMonth',
  'deletePettyRow', 'deletePettyGroup',
  'deleteMonthTarget', 'deleteCustomSectionRow', 'deleteCustomSection',
  'resetAllFields', 'pullFromSupabase', 'copyManagerToNextMonth',
  'autoFillSalary',
  // Jazz Cash — destructive
  'deleteJazzCashEntry', 'editJazzCashEntry',
]);

// ── Date helpers ──────────────────────────────────────────────────────

// ── Shared month resolver — used by every Manager-section read/edit ────
// Recognizes: "this month", "last month", "June", "June 2026", or falls
// back to current month. Keeps all 6 sections reading the SAME month
// whenever the user doesn't say one explicitly.
// Ledger entries store ISO dates (YYYY-MM-DD, from <input type="date">) —
// this converts one to the "Month YYYY" format _aiResolveMonth() returns,
// so Ledger data (Expense, Jazz Cash, custom sections) can be filtered by
// the same month strings the rest of this file already works with.
// The Ledger (Expense/Custom Sections/Jazz Cash) needs ISO dates
// (YYYY-MM-DD, from <input type="date">) for correct chronological sort
// and month-matching — distinct from _aiTodayStr()'s DD/Mon/YYYY, which
// matches DAILY[].Date and stays that way for Salary/Credit/Generic.
// Mixing the two formats into the same field silently breaks sort order
// (string-comparing "05/Mar/2026" vs "12/Jan/2026" puts March first).
// Converts whatever date format the Groq system prompt might still hand
// back (its EXPENSE/CUSTOM SECTION docs currently ask for DD-Mon-YYYY,
// a holdover from the old row-based models) into ISO, so Ledger data
// never ends up storing anything but ISO regardless of prompt drift.

// ── Staff fuzzy match ─────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════
// RULE-BASED PARSERS (instant — no API call needed)
// ══════════════════════════════════════════════════════════════════════



// ── Custom section fuzzy resolver (shared by add/edit/delete/read) ─────
// Resolves against the Ledger's custom "Other Sections" types now
// (ledger-store.js's createCustomLedgerType registry) — the old
// mw_custom_sections_v1 blob this used to read is retired and no longer
// written to by the live UI (see custom-sections.js's retired-code note).
function _aiResolveCustomSection(rawName) {
  if (typeof LedgerStore === 'undefined') return null;
  const norm = s => (s || '').trim().toLowerCase();
  const t = norm(rawName);
  const custom = LedgerStore.getAllLedgerTypes().filter(x => x.isCustom);
  const hit = custom.find(x => {
    const n = norm(x.label);
    return n === t || n.includes(t) || t.includes(n);
  });
  return hit ? { ledgerType: hit.id, name: hit.label } : null;
}

// ── Staff Registry — read ───────────────────────────────────────────────





function _aiParseCustomSectionCommand(text) {
  const t = text.trim();
  const amtMatch = t.match(/(-?\d[\d,]*)\s*(?:rs|rupees|₨)?\s*$/i) || t.match(/(?:rs|rupees|₨)\s*(-?\d[\d,]*)/i);
  if (!amtMatch) return null;
  const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
  if (!amount) return null;

  if (typeof LedgerStore === 'undefined') return null;
  const custom = LedgerStore.getAllLedgerTypes().filter(x => x.isCustom);
  if (!custom.length) return null;

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tNorm = norm(t.replace(amtMatch[0], ''));
  if (!tNorm) return null;

  let best = null, bestScore = 0;
  custom.forEach(function (x) {
    const words = norm(x.label).split(' ').filter(Boolean);
    if (!words.length) return;
    const hits = words.filter(function (w) { return tNorm.includes(w); }).length;
    const score = hits / words.length;
    if (score > bestScore) { bestScore = score; best = x; }
  });
  if (!best || bestScore < 0.6) return null;

  return {
    text: '\u2705 Adding \u20a8' + Math.abs(amount).toLocaleString('en-PK') + ' to <b>' + best.label + '</b>.',
    intent: { action: 'addCustomSectionRow', params: [best.label, '', amount, ''] },
  };
}

// ── Expenses / Patty — read (reads the generalized Ledger now; the old
// mgrLoad().expense[monthStr] shape this used to read no longer exists —
// see jazz-cash.js/manager.js's retired-code notes) ─────────────────────

// ── Custom Sections — read ──────────────────────────────────────────────
function _aiReadCustomSectionTotal(rawName, monthStr) {
  try {
    const resolved = _aiResolveCustomSection(rawName);
    if (!resolved) return null;
    const monthRows = LedgerStore.getEntries(resolved.ledgerType).filter(e => _aiIsoMonthOf(e.date) === monthStr);
    if (!monthRows.length) return '<b>' + resolved.name + '</b> (' + monthStr + '): no entries found.';
    const cats = LedgerStore.getCategoryList(resolved.ledgerType);
    const signOf = id => { const c = cats.find(x => x.id === id); return c ? c.sign : -1; };
    const total = monthRows.reduce((s, r) => s + signOf(r.categoryId) * (parseFloat(r.amount) || 0), 0);
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    let out = '<b>' + resolved.name + '</b> \u2014 ' + monthStr + ': ' + (total < 0 ? '-' : '') + fmt(total) + '<br>';
    const recent = monthRows.slice(-3).map(r => {
      const signed = signOf(r.categoryId) < 0 ? '-' : '';
      return '\u2022 ' + (r.desc || '?') + ': ' + signed + fmt(r.amount);
    }).join('<br>');
    return out + '<em style="font-size:11px;color:var(--muted)">Recent:</em><br>' + recent;
  } catch (_) { return null; }
}
function _aiParseCustomSectionQuery(text) {
  const month = _aiResolveMonth(text);
  // Strip any month phrase from the text first, so "Jazz Cash total June 2026"
  // still matches the section-name pattern (which anchors on $).
  const stripped = text
    .replace(/\b(?:this month|last month|is mahine|pichla mahine|pichle mahine)\b/i, '')
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+\d{4})?/i, '')
    .trim();
  const pats = [
    /(?:total|show|check|batao|dekho)\s+(.+?)\s+(?:total|entries|section)?(?:\s+for\s+(.+))?$/i,
    /(.+?)\s+(?:total|kitna|kya)$/i,
  ];
  for (const pat of pats) {
    const m = stripped.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const resolved = _aiResolveCustomSection(name);
    if (!resolved) continue;
    const result = _aiReadCustomSectionTotal(name, month);
    if (result) return { text: result, intent: null };
  }
  return null;
}
// ── Custom Sections — edit a specific row (add/delete already existed) ──
// "rowIndex" no longer maps to a real stored index (the old month-scoped
// row array is gone) — this is a best-effort approximation: position
// within LedgerStore.getEntries() for that section, which returns entries
// sorted by date. Good enough for "edit the entry I just added" (chat's
// dominant real use case), not a guarantee for older/reordered entries.
function _aiEditCustomSectionRow(sectionName, rowIndex, field, value) {
  const resolved = _aiResolveCustomSection(sectionName);
  if (!resolved) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  const entries = LedgerStore.getEntries(resolved.ledgerType);
  const entry = entries[rowIndex];
  if (!entry) { if (typeof toast === 'function') toast('\u26a0 Row index ' + rowIndex + ' not found.', 'w'); return; }
  const changes = {};
  if (field === 'amount') changes.amount = parseFloat(value) || 0;
  else if (field === 'desc' || field === 'notes') changes.desc = value;
  else if (field === 'date') changes.date = value;
  else { if (typeof toast === 'function') toast('\u26a0 Unknown field "' + field + '".', 'w'); return; }
  try {
    LedgerActions.updateEntry(entry.id, changes);
    if (typeof toast === 'function') toast('\u2705 ' + resolved.name + ' row ' + rowIndex + ' updated.');
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 ' + e.message, 'e');
  }
}

// ── Salary — read ────────────────────────────────────────────────────────

// ── Generic Working — read ───────────────────────────────────────────────

/* ══════════════════════════════════════════════════════════════════════
   PHASE 4A — NOTES & SHEETS LOCAL PARSER
══════════════════════════════════════════════════════════════════════ */
function _aiParseNotesCommand(text) {
  const t = text.toLowerCase().trim();

  // ── Navigate to Notes/Sheets page ─────────────────────────────────
  // BUG FIX: this used to emit { action:'showPage', params:['notes-sheets'] }
  // — but there's no page-notes-sheets element, so showPage() hid every
  // page and showed a blank screen. Now routes through the fixed
  // 'showNotesPanel' action, which opens the Notes & Sheets peer
  // dashboard directly (V2 plan §5 — no longer a Manager sub-tab).
  if (/^(open|go to|show|kholo|jao)\s+(notes|sheets|notes.?(and|&)?.?sheets|notebook)/i.test(t) ||
      t === 'notes' || t === 'sheets') {
    return {
      text: '→ Opening <b>Notes & Sheets</b>.',
      intent: { action: 'showNotesPanel', params: ['notes'] },
    };
  }

  // ── Open Sheets tab specifically ──────────────────────────────────
  if (/\b(open|show|go to)\s+sheets?\b/.test(t) || t === 'open sheets' || t === 'sheets tab') {
    return {
      text: '→ Opening <b>Sheets</b> tab.',
      intent: { action: 'showNotesPanel', params: ['sheets'] },
    };
  }

  // ── Open Manage Sheets ────────────────────────────────────────────
  if (/\b(manage\s+sheets?|sheet\s+manager|sheet\s+files?|all\s+sheets?)\b/.test(t)) {
    return {
      text: '→ Opening <b>Manage Sheets</b>.',
      intent: { action: 'showNotesPanel', params: ['manage'] },
    };
  }

  // ── Show today's notes ────────────────────────────────────────────
  const todayNoteMatch = /\b(today.?s?\s*notes?|aaj\s*k[ia]\s*notes?|notes?\s*today)\b/.test(t);
  if (todayNoteMatch) {
    return _aiQueryTodayNotes();
  }

  // ── Show all notes ────────────────────────────────────────────────
  if (/\b(show\s+all\s+notes?|list\s+notes?|all\s+notes?|sab\s+notes?)\b/.test(t)) {
    return _aiQueryAllNotes();
  }

  // ── Show pinned notes ─────────────────────────────────────────────
  if (/\bpinned\s+notes?\b/.test(t) || /\bnotes?\s+pinned\b/.test(t)) {
    return _aiQueryPinnedNotes();
  }

  // ── Show sheet groups ─────────────────────────────────────────────
  if (/\b(sheet\s+groups?|groups?\s+of\s+sheets?|sheet\s+categories)\b/.test(t)) {
    return _aiQuerySheetGroups();
  }

  // ── Add note ──────────────────────────────────────────────────────
  const addNoteMatch = t.match(/^(?:add|create|new|banao|likho)\s+(?:a\s+)?note\s*[:\-]?\s*(.+)$/i);
  if (addNoteMatch) {
    const content = addNoteMatch[1].trim();
    return {
      text: '→ Opening note editor with your text pre-filled.',
      intent: { action: 'addNote', params: [content] },
    };
  }

  // ── Add note (simple: "note: ...") ───────────────────────────────
  const noteColonMatch = t.match(/^note\s*[:\-]\s*(.+)$/i);
  if (noteColonMatch) {
    const content = noteColonMatch[1].trim();
    return {
      text: '→ Opening note editor.',
      intent: { action: 'addNote', params: [content] },
    };
  }

  // ── Search notes ──────────────────────────────────────────────────
  const searchMatch = t.match(/\bsearch\s+notes?\s+(?:for\s+)?(.+)$/i) ||
                      t.match(/\bnote\s+(?:about|for|with)\s+(.+)$/i);
  if (searchMatch) {
    return _aiSearchNotes(searchMatch[1].trim());
  }

  // ── Open specific sheet by name ───────────────────────────────────
  const openSheetMatch = t.match(/\bopen\s+sheet\s+[""']?(.+?)[""']?\s*$/i) ||
                          t.match(/\bload\s+sheet\s+[""']?(.+?)[""']?\s*$/i);
  if (openSheetMatch) {
    return _aiOpenSheetByName(openSheetMatch[1].trim());
  }

  return null;
}

// ── Notes query helpers ───────────────────────────────────────────────
function _aiQueryTodayNotes() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const today = new Date().toISOString().slice(0, 10);
    const todayNotes = notes.filter(function (n) { return n.updatedAt && n.updatedAt.startsWith(today); });
    if (!todayNotes.length) {
      return { text: "📝 No notes updated today yet. <button class='ai-chip' onclick=\"_aiAddNoteFromChat()\">+ New Note</button>", intent: null };
    }
    const html = "<b>Today's notes</b> (" + todayNotes.length + "):<br>" +
      todayNotes.map(function (n) {
        const preview = (n.body || '').replace(/<[^>]+>/g, '').slice(0, 80);
        return '📝 <b>' + (n.title || 'Untitled') + '</b>' + (preview ? ' — ' + preview : '');
      }).join('<br>') +
      '<br><button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\')},250)">Open Notes →</button>';
    return { text: html, intent: null };
  } catch (_) {
    return { text: '⚠ Could not load notes.', intent: null };
  }
}

function _aiQueryAllNotes() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    if (!notes.length) {
      return { text: "📝 No notes yet. <button class='ai-chip' onclick=\"_aiAddNoteFromChat()\">+ New Note</button>", intent: null };
    }
    const pinned = notes.filter(function (n) { return n.pinned; });
    const rest   = notes.filter(function (n) { return !n.pinned; });
    let html = '<b>All notes</b> (' + notes.length + '):<br>';
    if (pinned.length) {
      html += '<em>Pinned:</em><br>' + pinned.map(function (n) { return '📌 <b>' + (n.title || 'Untitled') + '</b>' + (n.tags ? ' [' + n.tags + ']' : ''); }).join('<br>') + '<br>';
    }
    html += rest.slice(0, 12).map(function (n) { return '📝 ' + (n.title || 'Untitled') + (n.tags ? ' [' + n.tags + ']' : ''); }).join('<br>');
    if (rest.length > 12) html += '<br><em>…and ' + (rest.length - 12) + ' more</em>';
    html += '<br><button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\')},250)">Open Notes →</button>';
    return { text: html, intent: null };
  } catch (_) {
    return { text: '⚠ Could not load notes.', intent: null };
  }
}

function _aiQueryPinnedNotes() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const pinned = notes.filter(function (n) { return n.pinned; });
    if (!pinned.length) {
      return { text: '📌 No pinned notes. Pin a note by opening it and tapping 📌 Pin.', intent: null };
    }
    const html = '<b>Pinned notes</b> (' + pinned.length + '):<br>' +
      pinned.map(function (n) {
        const preview = (n.body || '').replace(/<[^>]+>/g, '').slice(0, 80);
        return '📌 <b>' + (n.title || 'Untitled') + '</b>' + (preview ? ' — ' + preview : '');
      }).join('<br>') +
      '<br><button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\')},250)">Open Notes →</button>';
    return { text: html, intent: null };
  } catch (_) {
    return { text: '⚠ Could not load notes.', intent: null };
  }
}

function _aiSearchNotes(query) {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const q = query.toLowerCase();
    const matches = notes.filter(function (n) {
      return (n.title + ' ' + n.body + ' ' + n.tags).toLowerCase().includes(q);
    });
    if (!matches.length) {
      return { text: '🔍 No notes found matching <b>"' + query + '"</b>.', intent: null };
    }
    const html = '🔍 <b>Notes matching "' + query + '"</b> (' + matches.length + '):<br>' +
      matches.slice(0, 8).map(function (n) {
        const preview = (n.body || '').replace(/<[^>]+>/g, '').slice(0, 60);
        return '📝 <b>' + (n.title || 'Untitled') + '</b>' + (preview ? ' — ' + preview : '');
      }).join('<br>') +
      '<br><button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\')},250)">Open Notes →</button>';
    return { text: html, intent: null };
  } catch (_) {
    return { text: '⚠ Could not search notes.', intent: null };
  }
}

function _aiQuerySheetGroups() {
  try {
    // Read via _nsSFLoad() (notes-sheets.js) rather than the legacy
    // bt_sheet_files_v1 key directly — that key is frozen at whatever
    // it held the moment the multi-file workbook migration ran (V2 plan
    // §5), so reading it directly here would silently go stale the
    // moment a user created, renamed, or deleted a file afterward.
    const files = (typeof _nsSFLoad === 'function') ? _nsSFLoad() : JSON.parse(Repository.getItem('bt_sheet_files_v1') || '[]');
    if (!files.length) {
      return { text: '📊 No files yet. Open Sheets and use <b>Save As…</b> to create one.', intent: null };
    }
    const groups = {};
    files.forEach(function (f) {
      const cat = f.category || 'General';
      (groups[cat] = groups[cat] || []).push(f.name);
    });
    const html = '<b>File groups</b> (' + files.length + ' files):<br>' +
      Object.entries(groups).map(function (e) {
        return '🗂 <b>' + e[0] + '</b>: ' + e[1].join(', ');
      }).join('<br>') +
      '<br><button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\');setTimeout(function(){if(typeof _nsSetPanel===\'function\')_nsSetPanel(\'manage\');},200)},250)">Manage Sheets →</button>';
    return { text: html, intent: null };
  } catch (_) {
    return { text: '⚠ Could not load sheet files.', intent: null };
  }
}

function _aiOpenSheetByName(name) {
  try {
    const files = (typeof _nsSFLoad === 'function') ? _nsSFLoad() : JSON.parse(Repository.getItem('bt_sheet_files_v1') || '[]');
    const q = name.toLowerCase();
    const match = files.find(function (f) {
      return (f.name || '').toLowerCase().includes(q);
    });
    if (!match) {
      return { text: '📊 No file matching <b>"' + name + '"</b>. <button class=\'ai-chip\' onclick="showPage(\'manager\');setTimeout(function(){switchMgrTab(\'sheets\');setTimeout(function(){if(typeof _nsSetPanel===\'function\')_nsSetPanel(\'manage\');},200)},250)">View All Sheets →</button>', intent: null };
    }
    return {
      text: '→ Opening <b>"' + match.name + '"</b>.',
      intent: { action: 'openSheetFile', params: [match.id] },
    };
  } catch (_) {
    return { text: '⚠ Could not find that sheet.', intent: null };
  }
}

// Called from the chat "add note" button / intent
function _aiAddNoteFromChat() {
  if (typeof showPage === 'function') showPage('notesheets');
  setTimeout(function () {
    if (typeof _nsSetPanel === 'function') _nsSetPanel('notes');
    setTimeout(function () {
      if (typeof _nsNewNote === 'function') _nsNewNote();
    }, 200);
  }, 250);
}

function _aiParseNavCommand(text) {
  const t = text.toLowerCase().trim();
  const isNavPhrase = /^(open|go to|goto|show|switch to|navigate to|take me to|jao|kholo)\b/.test(t) ||
                       t.split(/\s+/).filter(Boolean).length <= 4;
  if (!isNavPhrase) return null;

  const pages = {
    dashboard:  ['dashboard','home','ghar','main','summary'],
    index:      ['index','month index','all months'],
    data:       ['data','daily data','records','daily records'],
    entry:      ['entry','add entry','daily entry','enter data','data entry'],
    report:     ['report','sale report','sales report','monthly report'],
    diff:       ['diff','diff report','difference'],
    tools:      ['tools','settings page','supabase'],
    manager:    ['manager','mgr','management'],
    // Notes & Sheets is its own peer dashboard now (V2 plan §5), not a
    // Manager sub-tab — so it belongs in this showPage() table, not the
    // switchMgrTab() `tabs` table below.
    notesheets: ['notes-sheets', 'notes sheets', 'notepad', 'spreadsheet', 'notes', 'sheets'],
    // Domain registry (V2 plan §5.3) — every registered domain's own
    // pageSynonyms, merged in. Today that's just Inventory (V2 plan
    // §2.2) — Manager/Sales domains don't add page-level synonyms (their
    // nav is the `tabs` table below) — but a future domain that does
    // needs no edit here.
    ...Object.assign({}, ...allPageSynonyms()),
  };
  const _pageLabels = { notesheets: 'Notes & Sheets', stockledger: 'Stock Ledger' };
  for (const [page, keywords] of Object.entries(pages)) {
    if (keywords.some(kw => t.includes(kw))) {
      const label = _pageLabels[page] || (page.charAt(0).toUpperCase() + page.slice(1));
      return {
        text: '\u2192 Opening <b>' + label + '</b>.',
        intent: { action: 'showPage', params: [page] },
      };
    }
  }
  const tabs = {
    salary:    ['salary','salari','tankhwa'],
    generic:   ['generic','generic working','generic sale'],
    expense:   ['expense','patty cash','expense patty','kharcha'],
    credit:    ['credit ledger','credit sheet','credit tab','advances'],
    petty:     ['petty detail','petty cash detail'],
    incentive: ['incentive','incentive calculator'],
    staff:     ['staff','employees','staff list','staff registry'],
  };
  for (const [tab, keywords] of Object.entries(tabs)) {
    if (keywords.some(kw => t.includes(kw))) {
      return {
        text: '\u2192 Opening Manager \u2192 <b>' + tab.charAt(0).toUpperCase() + tab.slice(1) + '</b>.',
        intent: { action: 'switchMgrTab', params: [tab] },
      };
    }
  }
  return null;
}

function _aiParsePrintCommand(text) {
  const t = text.toLowerCase();
  if (!/print|report|chalao|nikalo/.test(t)) return null;
  const reportTypes = {
    credit:    ['credit report','credit sheet','credit ledger'],
    salary:    ['salary report','salary sheet','tankhwa'],
    generic:   ['generic report','generic working'],
    expense:   ['expense report','patty cash report','patty report'],
    petty:     ['petty detail report','petty report'],
    incentive: ['incentive report','incentive'],
    month:     ['monthly report','month report','sale report'],
    year:      ['yearly report','year report','annual report'],
  };
  for (const [type, keywords] of Object.entries(reportTypes)) {
    if (keywords.some(kw => t.includes(kw))) {
      return {
        text: '\uD83D\uDDA8\uFE0F Printing <b>' + type + '</b> report.',
        intent: { action: 'printMgrReport', params: [type] },
      };
    }
  }
  return null;
}

// ── Jazz Cash local parser ────────────────────────────────────────────
// Handles all Jazz Cash commands without a Groq API call.
//
// JC_TYPES reference (must stay in sync with jazz-cash.js):
//   credit      → Received (+)            money IN
//   debit       → Patty Incentive (−)
//   withdrawal  → Generic Incentive (−)
//   commission  → Strips / Adjustments (−)
//   transfer    → Transfer (−)
//
// JC date format is ISO (YYYY-MM-DD) — defaulted via _aiTodayStr() when
// no date is supplied to the addJazzCashEntry executor below.
// which calls _jcTodayStr() when no date is provided.
function _aiParseJazzCashCommand(text) {
  const t = text.toLowerCase().trim();

  // Must be Jazz Cash related
  if (!/jazz\s*cash|jazzcash|\bjc\b/.test(t)) return null;

  // ── Helpers ──────────────────────────────────────────────────────────
  function extractAmount(str) {
    // "3000", "rs 3000", "₨3,000", "3k" etc.
    const kM = str.match(/(\d+(?:\.\d+)?)\s*k\b/i);
    if (kM) return parseFloat(kM[1]) * 1000;
    const m = str.match(/(?:rs\.?|₨|pkr)?\s*(\d[\d,]*(?:\.\d+)?)/i);
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  }

  function extractDesc(raw) {
    // Capture "for <name>" / "say <name>" patterns
    const forM = raw.match(/\bfor\s+([a-zA-Z][a-zA-Z\s]{1,24})(?:\s+(?:ka|ki|ke|ko|shift|morning|evening|night)|$)/i);
    if (forM) return forM[1].trim();
    // Strip noise words and numbers to get remaining context
    const cleaned = raw
      .replace(/\d[\d,]*/g, '')
      .replace(/\b(?:add|plus|jazz\s*cash|jazzcash|\bjc\b|received|mila|diya|aaya|credit|debit|transfer|less|minus|nikalo|send|bhejo|patty|petti|generic|incentive|strip|commission|adjustment|rs|pkr|rupees|morning|evening|night|both|off|for|ka|ki|ke|ko|shift|report|balance|balanc|kitna|baki|open|tab|ledger|tally|kholo|dekho)\b/gi, '')
      .replace(/\s+/g, ' ').trim();
    return cleaned || '';
  }

  function extractShift(str) {
    if (/\bevening\b/i.test(str)) return 'Evening';
    if (/\bnight\b/i.test(str))   return 'Night';
    if (/\bboth\b/i.test(str))    return 'Both';
    if (/\boff\b/i.test(str))     return 'Off';
    return 'Morning';  // default
  }

  function fmtAmt(n) { return Math.round(n).toLocaleString('en-PK'); }

  const amount = extractAmount(t);
  const shift  = extractShift(t);

  // ── 1. Balance query ─────────────────────────────────────────────────
  if (/\bbalance\b|\bbalanc\b|\bkitna\b|\bbaki\b|\bhow much\b/.test(t) &&
      !/\badd\b|\bplus\b|\bless\b|\bminus\b|\btransfer\b|\bdeduct\b|\breceived\b|\bmila\b/.test(t)) {
    const bal = (typeof _jcCurrentBalance === 'function') ? _jcCurrentBalance() : null;
    if (bal !== null) {
      const fmt  = fmtAmt(Math.abs(bal));
      const sign = bal < 0 ? '−' : '';
      return {
        text: '🏦 <strong>Jazz Cash balance:</strong> ' + sign + '₨' + fmt +
              ' <button class="chp-state-btn" onclick="showPage(\'manager\');' +
              'setTimeout(function(){switchMgrTab(\'jazzcash\')},250)">Open Ledger →</button>',
        intent: null,
      };
    }
    // Balance function not reachable — just navigate
    return {
      text: '🏦 Opening Jazz Cash ledger…',
      intent: { action: 'switchMgrTab', params: ['jazzcash'] },
    };
  }

  // ── 2. Open tab / Balance Tally (no amount) ──────────────────────────
  if (!amount && /\b(?:open|tab|ledger|tally|kholo|dekho|show)\b/.test(t)) {
    const goTally = /\btally\b/.test(t);
    return {
      text: goTally ? '⚖️ Opening Balance Tally…' : '📒 Opening Jazz Cash Ledger…',
      intent: { action: 'switchMgrTab', params: ['jazzcash'] },
    };
  }

  // ── 3. Amount required for all entry types below ─────────────────────
  if (!amount || amount <= 0) return null;

  // ── 4. Transfer / Less Jazz Cash (−) ─────────────────────────────────
  if (/\b(?:transfer|less|minus|nikalo|send|bhejo)\b/.test(t)) {
    const desc = extractDesc(text) || 'Transfer';
    return {
      text: '↔️ <strong>Jazz Cash Transfer</strong> −₨' + fmtAmt(amount) +
            (desc && desc !== 'Transfer' ? ' — <em>' + desc + '</em>' : '') +
            ' <span class="chp-badge-local">Local</span>',
      intent: { action: 'addJazzCashEntry',
                params: [{ amount, type: 'transfer', desc, shift }] },
    };
  }

  // ── 5. Patty Incentive / debit (−) ───────────────────────────────────
  if (/\b(?:patty|petti|patty\s+incentive)\b/.test(t)) {
    const desc = extractDesc(text) || 'Patty Incentive';
    return {
      text: '⬇ <strong>Patty Incentive</strong> −₨' + fmtAmt(amount) +
            ' — <em>' + desc + '</em>' +
            ' <span class="chp-badge-local">Local</span>',
      intent: { action: 'addJazzCashEntry',
                params: [{ amount, type: 'debit', desc, shift }] },
    };
  }

  // ── 6. Generic Incentive / withdrawal (−) ────────────────────────────
  if (/\b(?:generic|generic\s+incentive|withdrawal)\b/.test(t)) {
    const desc = extractDesc(text) || 'Generic Incentive';
    return {
      text: '💸 <strong>Generic Incentive</strong> −₨' + fmtAmt(amount) +
            ' — <em>' + desc + '</em>' +
            ' <span class="chp-badge-local">Local</span>',
      intent: { action: 'addJazzCashEntry',
                params: [{ amount, type: 'withdrawal', desc, shift }] },
    };
  }

  // ── 7. Strips / Adjustments / Commission (−) ─────────────────────────
  if (/\b(?:strip|adjust|commission)\b/.test(t)) {
    const desc = extractDesc(text) || 'Strip/Adjustment';
    return {
      text: '🏅 <strong>Strip/Adjustment</strong> −₨' + fmtAmt(amount) +
            ' — <em>' + desc + '</em>' +
            ' <span class="chp-badge-local">Local</span>',
      intent: { action: 'addJazzCashEntry',
                params: [{ amount, type: 'commission', desc, shift }] },
    };
  }

  // ── 8. Default: Credit / Received (+) ────────────────────────────────
  const desc = extractDesc(text);
  return {
    text: '⬆ <strong>Jazz Cash +₨' + fmtAmt(amount) + '</strong>' +
          (desc ? ' — <em>' + desc + '</em>' : '') +
          ' <span class="chp-badge-local">Local</span>',
    intent: { action: 'addJazzCashEntry',
              params: [{ amount, type: 'credit', desc: desc || '', shift }] },
  };
}

// ── Date-aware report parser ──────────────────────────────────────────
// Handles: "print 21 Oct 2021", "load October 2021", "today's report",
// "this month", "last month", "2022 yearly", etc. — all without Groq.

// ── Target commands ───────────────────────────────────────────────────

// ── Sync commands ─────────────────────────────────────────────────────
// ── Memory / Briefing chat commands (Phase 5) ─────────────────────────
function _aiParseMemoryCommand(text) {
  const t = text.toLowerCase().trim();

  // Open memory panel
  if (/\b(open|show|view)\s+(memory|mem|facts|rules|training|ai memory)\b/.test(t) ||
      t === 'memory' || t === 'memories') {
    return {
      text: '→ Opening <b>AI Memory Panel</b>.',
      intent: { action: 'openMemoryPanel', params: [] },
    };
  }

  // Show briefing
  if (/\b(show|get|give me|daily)\s+briefing\b/.test(t) || t === 'briefing') {
    if (typeof aimBriefingGenerate === 'function') {
      const brief = aimBriefingGenerate(true);
      if (brief) return { text: '📋 <strong>Daily Briefing</strong><br>' + brief.replace(/</g, '&lt;'), intent: null };
      return { text: 'ℹ No briefing data yet — add at least one daily entry first.', intent: null };
    }
    return null;
  }

  // List memory facts inline
  if (/\bwhat do you remember\b/.test(t) || /\bmy memories\b/.test(t) || /\blist\s+(my\s+)?facts\b/.test(t)) {
    if (typeof aimFactList === 'function') {
      const facts = aimFactList();
      if (!facts.length) return { text: '🧠 No memories stored yet. Tell me to "remember" something!', intent: null };
      return {
        text: '🧠 <strong>I remember:</strong><br>' + facts.map(function (f) { return '• ' + f.fact.replace(/</g, '&lt;'); }).join('<br>') +
              '<br><button class="ai-chip" onclick="if(typeof aimOpenPanel===\'function\')aimOpenPanel()">Memory Panel →</button>',
        intent: null,
      };
    }
    return null;
  }

  // Check rules
  if (/\b(check|run|show)\s+(rules?|alerts?)\b/.test(t) || t === 'check rules') {
    if (typeof aimRulesCheckAll === 'function') {
      const fired = aimRulesCheckAll();
      if (!fired.length) return { text: '✅ No rules triggered right now.', intent: null };
      return { text: '⚠️ <strong>Rule alerts:</strong><br>' + fired.map(function (f) { return f.msg.replace(/</g, '&lt;'); }).join('<br>'), intent: null };
    }
    return null;
  }

  return null;
}

function _aiParseSyncCommand(text) {
  const t = text.toLowerCase().trim();
  if (/(?:push|sync|upload|save)\s*(?:to)?\s*(?:supabase|cloud|server|online)/.test(t)) {
    return { text: '\u2601\ufe0f Pushing data to Supabase\u2026', intent: { action: 'pushToSupabase', params: [] } };
  }
  if (/backup\s*(?:to)?\s*(?:drive|google drive)/.test(t) || /(?:google\s*)?drive\s*backup/.test(t)) {
    return { text: '\u2601\ufe0f Starting Google Drive backup\u2026', intent: { action: 'backupToDrive', params: [] } };
  }
  if (/(?:pull|fetch|restore|download)\s*(?:from)?\s*(?:supabase|cloud|server|online)/.test(t)) {
    return {
      text: '\u26a0\ufe0f Pull from Supabase? This will <b>overwrite local data</b> with the server copy.',
      intent: { action: 'pullFromSupabase', params: [] },
      requiresConfirm: true,
    };
  }
  if (/save\s+all|save\s+manager|save\s+everything/.test(t)) {
    return { text: '\u2705 Saving all manager sections\u2026', intent: { action: 'pushToSupabase', params: [] } };
  }
  return null;
}

// ── Clear / reset shortcut ────────────────────────────────────────────
function _aiParseClearCommand(text) {
  const t = text.toLowerCase().trim();
  if (/clear\s+(?:the\s+)?(?:entry\s+)?form|reset\s+form|naya\s+entry|form\s+clear/.test(t)) {
    return { text: '\u2705 Clearing the daily entry form.', intent: { action: 'clearEntryForm', params: [] } };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// DEEP SALES ANALYTICS (instant rule-based)
// ══════════════════════════════════════════════════════════════════════
function _aiDeepSalesAnalysis(text) {
  const t = text.toLowerCase();
  try {
    const ctx = (typeof getAppContext === 'function') ? getAppContext() : null;
    if (!ctx) return null;
    const M = ctx.monthly || [];
    const D = ctx.daily   || [];
    const n = v => (v == null || v === '' || isNaN(parseFloat(v))) ? 0 : parseFloat(v);

    if (/highest|best|maximum|max|top day|sabse zyada|sabse bada/.test(t) && /day|date|din/.test(t)) {
      if (!D.length) return 'No daily data loaded yet.';
      const top5 = [...D].sort((a, b) => n(b.TOTAL) - n(a.TOTAL)).slice(0, 5);
      return '\uD83C\uDFC6 <b>Highest Sale Days:</b><br>' +
        top5.map((d, i) => (i+1) + '. <b>' + d.Date + '</b> (' + d.Month_Year + ') \u2014 \u20a8' + Math.round(n(d.TOTAL)).toLocaleString('en-PK') + ' | Customers: ' + Math.round(n(d.Customers))).join('<br>');
    }
    if (/lowest|worst|minimum|min|bottom day|sabse kam/.test(t) && /day|date|din/.test(t)) {
      if (!D.length) return 'No daily data loaded yet.';
      const bot5 = D.filter(d => n(d.TOTAL) > 0).sort((a, b) => n(a.TOTAL) - n(b.TOTAL)).slice(0, 5);
      return '\uD83D\uDCC9 <b>Lowest Sale Days:</b><br>' +
        bot5.map((d, i) => (i+1) + '. <b>' + d.Date + '</b> (' + d.Month_Year + ') \u2014 \u20a8' + Math.round(n(d.TOTAL)).toLocaleString('en-PK')).join('<br>');
    }
    if (/year|saal|annual|yearly/.test(t) && /total|sale|kitna/.test(t)) {
      const byYear = {};
      M.forEach(m => { const yr = (m.Month_Year || '').split(' ')[1]; if (yr) byYear[yr] = (byYear[yr] || 0) + n(m.TOTAL); });
      if (!Object.keys(byYear).length) return 'No yearly data available.';
      const lines = Object.entries(byYear).sort(([a],[b]) => parseInt(b)-parseInt(a)).map(([yr,tot]) => '\u2022 <b>' + yr + '</b>: \u20a8' + Math.round(tot).toLocaleString('en-PK'));
      return '\uD83D\uDCC5 <b>Yearly Sales Totals:</b><br>' + lines.join('<br>');
    }
    if (/best|highest|top|sabse zyada/.test(t) && /month|mahina/.test(t)) {
      if (!M.length) return 'No monthly data.';
      const top3 = [...M].sort((a,b) => n(b.TOTAL)-n(a.TOTAL)).slice(0,3);
      return '\uD83C\uDFC6 <b>Best Months Ever:</b><br>' +
        top3.map((m,i) => (i+1) + '. <b>' + m.Month_Year + '</b> \u2014 \u20a8' + Math.round(n(m.TOTAL)).toLocaleString('en-PK')).join('<br>');
    }
    if (/worst|lowest|bottom|sabse kam/.test(t) && /month|mahina/.test(t)) {
      if (!M.length) return 'No monthly data.';
      const bot3 = M.filter(m=>n(m.TOTAL)>0).sort((a,b)=>n(a.TOTAL)-n(b.TOTAL)).slice(0,3);
      return '\uD83D\uDCC9 <b>Worst Months:</b><br>' +
        bot3.map((m,i) => (i+1) + '. <b>' + m.Month_Year + '</b> \u2014 \u20a8' + Math.round(n(m.TOTAL)).toLocaleString('en-PK')).join('<br>');
    }
    if (/compare|vs\b|versus|comparison|maqabla/.test(t)) {
      if (M.length < 2) return 'Need at least 2 months of data to compare.';
      const found = [];
      const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      for (const nm of names) {
        if (t.includes(nm.toLowerCase())) {
          const match = M.filter(m => m.Month_Year.toLowerCase().startsWith(nm.toLowerCase()));
          if (match.length) found.push(match[match.length-1]);
        }
      }
      const a = found[0] || M[M.length-1], b = found[1] || M[M.length-2];
      const ta = n(a.TOTAL), tb = n(b.TOTAL), diff = ta - tb;
      const pctChange = tb > 0 ? ((diff/tb)*100).toFixed(1) : '\u2014';
      return '\uD83D\uDCCA <b>Comparison:</b><br>\u2022 ' + a.Month_Year + ': \u20a8' + Math.round(ta).toLocaleString('en-PK') + '<br>\u2022 ' + b.Month_Year + ': \u20a8' + Math.round(tb).toLocaleString('en-PK') + '<br>\u2022 Difference: \u20a8' + Math.abs(Math.round(diff)).toLocaleString('en-PK') + ' (' + (diff>=0?'\u25b2':'\u25bc') + ' ' + Math.abs(parseFloat(pctChange||0)) + '%)';
    }
    if (/average|avg|avarij/.test(t)) {
      if (!M.length) return 'No data.';
      const avg = M.reduce((s,m)=>s+n(m.TOTAL),0)/M.length;
      return '\uD83D\uDCCA Average monthly sales across ' + M.length + ' months: <b>\u20a8' + Math.round(avg).toLocaleString('en-PK') + '</b>';
    }
    if (/(this month|current|abhi|so far)/.test(t) && /total|sale|kitna/.test(t)) {
      if (!M.length) return 'No data loaded yet.';
      const m = M[M.length-1];
      const daysInMonth = D.filter(d=>d.Month_Year===m.Month_Year).length;
      return '\uD83D\uDCCB <b>' + m.Month_Year + '</b>: \u20a8' + Math.round(n(m.TOTAL)).toLocaleString('en-PK') + ' (' + daysInMonth + ' days recorded)';
    }
    if (/unusual|anomal|outlier|odd day|khaas/.test(t)) {
      if (D.length < 5) return 'Not enough daily data yet.';
      // Sort by actual date before slicing — DAILY insertion order is not guaranteed
      const _sortedD30 = D.slice().sort(function(a,b){ return BTDate.parseDate(a.Date) - BTDate.parseDate(b.Date); });
      const recent = _sortedD30.slice(-30), vals = recent.map(d=>n(d.TOTAL));
      const avg = vals.reduce((s,v)=>s+v,0)/vals.length;
      const sd  = Math.sqrt(vals.reduce((s,v)=>s+(v-avg)**2,0)/vals.length)||1;
      const flagged = recent.filter(d=>Math.abs(n(d.TOTAL)-avg)>1.8*sd);
      if (!flagged.length) return 'Nothing unusual in last ' + recent.length + ' days (avg \u20a8' + Math.round(avg).toLocaleString('en-PK') + ').';
      return '\u26a0\ufe0f Found ' + flagged.length + ' unusual day(s):<br>' +
        flagged.slice(0,6).map(function(d){ return '\u2022 ' + d.Date + ': \u20a8' + Math.round(n(d.TOTAL)).toLocaleString('en-PK'); }).join('<br>');
    }
  } catch (e) { return null; }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// LLM PROMPT — trained for deep app knowledge
// ══════════════════════════════════════════════════════════════════════
function _buildLlmPrompt(question) {
  const today    = _aiTodayStr();
  const curMonth = _aiCurrentMonthYear();

  // Use cached staff list + custom sections (rebuilt only when staff count or month changes)
  const _static = _buildStaticPromptParts();
  const staffList      = _static.staffList;
  const customSections = _static.customSections;

  let ctx = '';
  try {
    // Do NOT fire a silent Supabase pull here — that hides a network call inside a
    // string-building function and can cause race conditions. If data isn't loaded,
    // tell the LLM plainly; the user can trigger a manual sync.
    const _hasDat = (typeof MONTHLY !== 'undefined' && MONTHLY && MONTHLY.length > 0);
    // Was `fullMonths: 'all'` — sent every daily record + every Manager
    // (credit/salary/generic/ledger/petty) entry ever recorded on EVERY
    // AI call, regardless of question. On an account with enough history
    // that alone requested ~99,869 tokens against Groq's 8000 TPM cap
    // (413 Request too large), even for something as simple as an
    // inventory question. Bounding to the last few months keeps normal
    // "today/this month" questions accurate while staying under the
    // limit; the compact all-time MONTHLY BREAKDOWN (one line/month,
    // unbounded) still covers longer-range "yearly"/"compare months"
    // questions cheaply.
    const snap = (typeof getAppContextSummary === 'function') ? getAppContextSummary({ fullMonths: 3 }) : null;
    if (snap) ctx = '\nDATA SNAPSHOT:\n' + snap;
    else if (!_hasDat) ctx = '\nDATA SNAPSHOT: No sales data loaded yet. Ask the user to sync from Supabase (Tools page) before querying totals.';
  } catch (_) {}

  let entryCtx = '';
  try {
    if (document.getElementById('e-TOTAL')) {
      const gv = function(id){ const el=document.getElementById('e-'+id); return el&&el.value?parseFloat(el.value)||0:0; };
      const fields = [
        ['Cash_Sale','Cash Sales'],['Cash_Returns','Cash Returns'],
        ['HBL','HBL'],['MCB','MCB'],['Alfala_Bank','Alfalah'],
        ['Bank_Al_Habib','Bank Al Habib'],['Meezan_Bank','Meezan/JazzCash'],
        ['Askari_Bank','Askari'],['PSO','PSO'],['NESPAK','NESPAK'],
        ['PARCO','PARCO'],['TEPA','TEPA'],['LDA','LDA'],['Gourmet','Gourmet'],
        ['BTH','BTH'],['FDPP','FDPP'],['FDPP_Con','FDPP Consumer'],
        ['Load_Sale','Load Sale'],['Amount_Received','Amount Received'],
        ['COMP_SALE','Computer Sale'],['Customers','Customers'],['TOTAL','TOTAL'],
      ];
      const vals = fields.filter(function(f){ return gv(f[0])!==0; }).map(function(f){ return f[1]+': '+gv(f[0]).toLocaleString('en-PK'); });
      if (vals.length) entryCtx = '\nCURRENT ENTRY (today\'s open form): ' + vals.join(' | ');
    }
  } catch (_) {}

  let mgrCtx = '';
  try {
    const mgrKey = Repository.getKeysByPrefix('mw_mgr_').concat(Repository.getItem('mw_manager') ? ['mw_manager'] : [])[0] || null;
    if (mgrKey) {
      const mgr  = JSON.parse(Repository.getItem(mgrKey) || '{}');
      const curM = curMonth;
      const parts = [];
      if (mgr.expense && mgr.expense[curM]) {
        const rows = mgr.expense[curM];
        const tot  = rows.reduce(function(s,r){ return s+(parseFloat(r.bill||0)+parseFloat(r.fuel||0)+parseFloat(r.soap||0)+parseFloat(r.refresh||0)+parseFloat(r.extra||0)); },0);
        if (tot>0) parts.push('Expenses this month: \u20a8'+Math.round(tot).toLocaleString('en-PK')+'('+rows.length+' entries)');
      }
      if (mgr.credit) {
        const creditMonths = Object.keys(mgr.credit);
        if (creditMonths.length) {
          const crd = mgr.credit[creditMonths[creditMonths.length-1]];
          const outstanding = crd.filter(function(e){ return (parseFloat(e.prevBal||0)+e.entries.reduce(function(s,x){return s+(parseFloat(x.amount)||0);},0)) > 0; });
          if (outstanding.length) parts.push('Credit outstanding: '+outstanding.length+' staff member(s)');
        }
      }
      if (parts.length) mgrCtx = '\nMANAGER DATA: ' + parts.join('; ');
    }
  } catch (_) {}

  const memBlock   = (typeof aimFullPromptBlock  === 'function') ? aimFullPromptBlock()           : '';
  const instrBlock = (typeof AIInstructions !== 'undefined') ? AIInstructions.buildPromptBlock() : '';
  const ctxBlock   = (typeof AIContext      !== 'undefined') ? AIContext.buildPromptBlock()      : '';

  const lines = [
    'You are the AI brain of "Bahria Town Sales IC" — a petrol station management app for a petrol pump in Bahria Town.',
    'The user is the owner/manager. They speak English, Urdu, or a mix (Urdu words like "kitna","mein","daalo","batao","aaj"). You understand everything.',
    'You are a PERSONAL ASSISTANT — you take actions, answer questions, and analyze sales data.',
    instrBlock,
    ctxBlock,
    '',
    'TODAY: ' + today + '   CURRENT MONTH: ' + curMonth,
    staffList,
    customSections,
    entryCtx,
    mgrCtx,
    ctx,
    memBlock,
    '',
    '══════════ RESPONSE FORMAT (strict JSON only — no markdown, no code fences) ══════════',
    '{"text":"<answer, max 180 words, HTML allowed>","intent":null}',
    'OR: {"text":"<short confirmation>","intent":{"action":"<ACTION>","params":[...]},"requiresConfirm":false}',
    'For destructive actions always add: "requiresConfirm":true',
    '',
    '══════════ NAVIGATION ACTIONS ══════════',
    '• showPage → params: ["dashboard"|"index"|"data"|"entry"|"report"|"diff"|"tools"|"manager"]',
    '• switchMgrTab → params: ["salary"|"generic"|"expense"|"credit"|"petty"|"incentive"|"staff"|"jazzcash"]',
    '• openFieldManager → params: []',
    '• openStaffCard → params: [staffIndex_number]',
    '• switchMonth → params: ["Month YYYY"]',
    '',
    '══════════ REPORT ACTIONS ══════════',
    '• openDayModal → params: ["DD/Mon/YYYY","Month YYYY"]',
    '• openMonthModal → params: ["Month YYYY"]',
    '• printMonthReport → params: ["Month YYYY"]',
    '• printYearlyReport → params: ["YYYY"]',
    '• printMgrReport → params: ["credit"|"salary"|"generic"|"expense"|"petty"|"month"|"year"|"incentive"]',
    '• printDayReport → params: ["DD/Mon/YYYY","Month YYYY"]',
    '• printIncentiveReport → params: []',
    '',
    '══════════ DAILY ENTRY ACTIONS ══════════',
    '',
    'SAVE NEW DAILY ENTRY → saveNewDailyEntry',
    '  params: ["YYYY-MM-DD", {Cash_Sale,Cash_Returns,HBL,MCB,Alfala_Bank,Bank_Al_Habib,Meezan_Bank,Askari_Bank,PSO,PSO_Returns,NESPAK,PARCO,TEPA,LDA,Gourmet,BTH,FDPP,FDPP_Con,Load_Sale,COMP_SALE,Amount_Received,Customers}]',
    '  Use when user provides multiple fields for a day. Only include fields mentioned; omit the rest.',
    '',
    'EDIT ONE FIELD IN DAILY ENTRY → editDailyEntry',
    '  params: ["DD/Mon/YYYY","Month YYYY","fieldId",newValue]',
    '  requiresConfirm: true',
    '',
    'DELETE DAILY ENTRY → deleteDailyEntry  requiresConfirm: true',
    '  params: ["DD/Mon/YYYY","Month YYYY"]',
    '',
    'SET FIELD (entry form open) → setDailyField',
    '  params: ["fieldId", amountNumber]',
    '',
    'CLEAR ENTRY FORM → clearEntryForm  params: []',
    '',
    '══════════ STAFF REGISTRY ACTIONS ══════════',
    '',
    'ADD STAFF → addStaff  params: ["name","designation"]  designation default: "Salesman"',
    'EDIT STAFF FIELD → editStaffField  requiresConfirm: true',
    '  params: [staffIndex,"field","newValue"]',
    '  fields: name | designation | phone | cnic | address | doj | bloodGroup',
    'DEACTIVATE STAFF → deactivateStaff  requiresConfirm: true  params: [staffIndex]',
    'REACTIVATE STAFF → reactivateStaff  params: [staffIndex]',
    'DELETE STAFF → deleteStaff  requiresConfirm: true  params: [staffIndex]',
    'OPEN STAFF CARD → openStaffCard  params: [staffIndex]',
    '',
    '══════════ SALARY SHEET ACTIONS ══════════',
    '',
    'ADD SALARY ROW → addSalaryRow',
    '  params: ["staffName","designation",hoSalary,advance,generic]  (use 0 for unknown)',
    'EDIT SALARY FIELD → editSalaryRow  requiresConfirm: true',
    '  params: ["staffName","field",value]  fields: hoSal | advance | generic',
    'DELETE SALARY ROW → deleteSalaryRow  requiresConfirm: true  params: ["staffName"]',
    'SET SALARY FIELD (shorthand) → setSalaryField  params: ["staffName","field",value]',
    'AUTO-FILL FROM SHEETS → autoFillSalary  requiresConfirm: true  params: []',
    '',
    '══════════ GENERIC WORKING ACTIONS ══════════',
    '',
    'ADD GENERIC ROW → addGenericRow  params: ["staffName","designation",genericSale,extra]',
    'EDIT GENERIC ROW → editGenericRow  requiresConfirm: true  params: ["staffName","field",value]  fields: genericSale | extra',
    'DELETE GENERIC ROW → deleteGenericRow  requiresConfirm: true  params: ["staffName"]',
    'SET GENERIC SALE → setGenericSale  params: ["staffName",amount]',
    '',
    '══════════ EXPENSE SHEET ACTIONS ══════════',
    '',
    'ADD EXPENSE → addExpense  params: ["DD-Mon-YYYY","desc",bill,fuel,soap,refresh,extra,pattyHO,guardIncentive]',
    'EDIT/DELETE EXPENSE ENTRY → not available via chat (each expense category is its own ledger entry now, not an indexed row) \u2014 tell the user to tap the entry in Manager \u2192 Patty/Expenses to edit or delete it.',
    '',
    '══════════ CREDIT LEDGER ACTIONS ══════════',
    '',
    'ADD CREDIT ENTRY → addCredit  params: ["EmployeeName",amountNumber,"description","DD-Mon-YYYY"]',
    'ADD CREDIT EMPLOYEE → addCreditEmployee  params: ["staffName"]',
    'EDIT CREDIT ENTRY → editCreditEntry  requiresConfirm: true  params: ["staffName",entryIndex,"field",value]  fields: date|desc|amount',
    'DELETE CREDIT ENTRY → deleteCreditEntry  requiresConfirm: true  params: ["staffName",entryIndex]',
    'DELETE CREDIT EMPLOYEE → deleteCreditEmployee  requiresConfirm: true  params: ["staffName"]',
    'SET CREDIT EMP FIELD → setCreditEmpField  params: ["staffName","field",value]  fields: prevBal|salary|lessGeneric',
    'COPY TO NEXT MONTH → copyToNextMonth  requiresConfirm: true  params: []',
    '',
    '══════════ PETTY CASH ACTIONS ══════════',
    '',
    'ADD PETTY ITEM → addPettyItem  params: ["desc",amount,"period"]',
    'ADD PETTY GROUP → addPettyGroup  params: ["period"]  e.g. "June 2026"',
    'EDIT PETTY ROW → editPettyRow  requiresConfirm: true  params: [groupIndex,rowIndex,"field",value]  fields: desc|amount',
    'DELETE PETTY ROW → deletePettyRow  requiresConfirm: true  params: [groupIndex,rowIndex]',
    'DELETE PETTY GROUP → deletePettyGroup  requiresConfirm: true  params: [groupIndex]',
    '',
    '══════════ TARGETS ══════════',
    '',
    'SET TARGET → setMonthTarget  params: ["Month YYYY",amountNumber]',
    'DELETE TARGET → deleteMonthTarget  requiresConfirm: true  params: ["Month YYYY"]',
    '',
    '══════════ CUSTOM SECTIONS ══════════',
    '',
    'ADD ROW → addCustomSectionRow  params: ["sectionName","desc",amount,"notes"]  (dated today automatically)',
    'CREATE SECTION → createCustomSection  params: ["name","emoji"]',
    'DELETE ROW → deleteCustomSectionRow  requiresConfirm: true  params: ["sectionName",rowIndex]',
    'DELETE SECTION → deleteCustomSection  requiresConfirm: true  params: ["sectionName"]',
    '',
    '══════════ FIELD MANAGER ══════════',
    '',
    'OPEN → openFieldManager  params: []',
    'TOGGLE FIELD → toggleFieldVisibility  params: ["fieldId",true|false]',
    'ADD CUSTOM FIELD → addCustomField  params: ["label","add"|"sub"|"none"]',
    'RESET ALL → resetAllFields  requiresConfirm: true  params: []',
    '',
    '══════════ SYNC / BACKUP ══════════',
    '',
    'PUSH → pushToSupabase  params: []',
    'PULL → pullFromSupabase  requiresConfirm: true  params: []',
    'BACKUP TO DRIVE → backupToDrive  params: []',
    '',
    '══════════ AI MEMORY / RULES / SECTION CONFIG ══════════',
    '',
    'Use these ONLY if the rule-based parser did not already catch a "remember/forget/rule/correct" command.',
    'ADD MEMORY FACT → addMemoryFact  params: ["fact text"]',
    'DELETE MEMORY FACT → deleteMemoryFact  requiresConfirm: true  params: ["fact text or keyword"]',
    'ADD RULE → addRule  params: ["plain-English IF/THEN rule"]',
    'DELETE RULE → deleteRule  requiresConfirm: true  params: ["keyword from rule text"]',
    'SET SECTION AI CONFIG → setSectionAiConfig  params: ["sectionName", {aliases:[...], default_desc:"...", alert_if_zero:true|false}]',
    '',
    '══════════ FIELD REFERENCE (Daily Entry) ══════════',
    'Cash_Sale | Cash_Returns | HBL | MCB | Alfala_Bank | Bank_Al_Habib | Meezan_Bank',
    'Askari_Bank | PSO | PSO_Returns | NESPAK | PARCO | TEPA | LDA | Gourmet | BTH',
    'FDPP | FDPP_Con | Load_Sale | COMP_SALE | Amount_Received | Customers | TOTAL',
    '',
    '══════════ ANALYTICS (answer as text, intent: null) ══════════',
    'Use DATA SNAPSHOT for: daily/monthly/yearly totals, best/worst days or months,',
    'comparisons, averages, DIFF analysis, load sale, credit client breakdown, targets.',
    '',
    '══════════ KEY RULES ══════════',
    '1. Fuzzy-match staff names to ACTIVE STAFF list.',
    '2. Fuzzy-match section names to CUSTOM SECTIONS IN MANAGER.',
    '3. Default date = today (' + today + ').',
    '4. Jazz Cash — dedicated tab (id: "jazzcash"). Use addJazzCashEntry for any entry, NOT addCustomSectionRow.',
    '   addJazzCashEntry → params: [{ amount:NUMBER, type:"credit"|"debit"|"withdrawal"|"commission"|"transfer", desc:"string", shift:"Morning"|"Evening"|"Night"|"Both"|"Off" }]',
    '   Type guide: credit=Received(+)  debit=Patty Incentive(−)  withdrawal=Generic Incentive(−)  commission=Strips/Adj(−)  transfer=Transfer(−)',
    '   editJazzCashEntry → params: [entryId]   deleteJazzCashEntry → params: [entryId]  (both requiresConfirm:true)',
    '   For balance queries or ledger navigation → switchMgrTab("jazzcash").',
    '5. Multi-field day fill → saveNewDailyEntry (not multiple setDailyField calls).',
    '6. Always set requiresConfirm:true for any delete/destructive action.',
    '7. Answer in same language mix as user (English/Urdu mix fine).',
    '8. Never make up data — only use DATA SNAPSHOT or CURRENT ENTRY.',
    '9. Keep "text" concise (max 180 words). Use <b>bold</b> for numbers/names.',
    '10. For edits/deletes, always tell user WHAT will change so they can confirm.',
    '',
    'USER INPUT: ' + question,
  ];
  // Filter out null, undefined, AND empty strings — empty entries waste tokens
  return lines.filter(function(l){ return l !== null && l !== undefined && l !== ''; }).join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// GROQ API CALLER
// ══════════════════════════════════════════════════════════════════════
async function _callGroq(question) {
  const raw = await callAI({
    kind: 'text',
    messages: [{ role: 'user', content: _buildLlmPrompt(question) }],
    maxTokens: 700,
    temperature: 0.1,
  });
  return _parseLlmResponse(raw);
}

// ══════════════════════════════════════════════════════════════════════
// GROQ VISION CALLER

// ══════════════════════════════════════════════════════════════════════
// GROQ VISION CALLER — dual-mode: Sale Report + Generic
// ══════════════════════════════════════════════════════════════════════
// ── Field-name → entry form ID mapping for daily sale reports ──────────
var _SALE_REPORT_FIELD_MAP = {
  'cash sale': 'Cash_Sale',
  'cash sale (sales only)': 'Cash_Sale',
  'cash returns': 'Cash_Returns',
  'cash returns (returns only)': 'Cash_Returns',
  'meezan bank': 'Meezan_Bank',
  'meezan': 'Meezan_Bank',
  'bank alfalah': 'Alfala_Bank',
  'alfalah': 'Alfala_Bank',
  'bank al habib': 'Bank_Al_Habib',
  'al habib': 'Bank_Al_Habib',
  'hbl': 'HBL',
  'mcb': 'MCB',
  'pso': 'PSO',
  'pso (sales only)': 'PSO',
  'nespak': 'NESPAK',
  'nespak (sales only)': 'NESPAK',
  'parco': 'PARCO',
  'parco (sales only)': 'PARCO',
  'askari': 'Askari_Bank',
  'askari bank': 'Askari_Bank',
  'lda': 'LDA',
  'lda (sales only)': 'LDA',
  'tepa': 'TEPA',
  'tepa (sales only)': 'TEPA',
  'free issue': 'F_Issue',
  'f/issue': 'F_Issue',
  'credit return pso': 'PSO_Returns',
  'credit return nespak': 'NESPAK_Returns',
  'credit return parco': 'PARCO_Returns',
  'credit return tepa': 'TEPA_Returns',
  'credit return lda': 'LDA_Returns',
  'askari returns': 'Askari_Bank_Returns',
  'customers': 'Customers',
  'fdpp pos sale': 'FDPP',
  'fdpp pos': 'FDPP',
  'fdpp': 'FDPP',
  'fdpp consumer pos sale': 'FDPP_Con',
  'fdpp consumer pos': 'FDPP_Con',
  'fdpp consumer': 'FDPP_Con',
  'fdpp con': 'FDPP_Con',
  'load sale': 'Load_Sale',
  'till short': '_till_short',
  'patty cash': '_patty_cash',
  'petty cash': '_patty_cash',
  'amount received': 'Amount_Received',
  'cash to deposit': 'Cash_to_Deposit',
  'cash to be deposited': 'Cash_to_Deposit',
  'comp sale': 'COMP_SALE',
};

var _SALE_REPORT_SKIP = { 'net cash sale': 1, 'net credit sale': 1, 'grand total': 1, 'total': 1 };

// Vision degradation: a failure here surfaces this fixed message rather
// than throwing the raw provider error, and never falls through to a
// text-only model — a text model inventing numbers for a receipt photo
// is worse than a clear "try manual entry" error. See ai-providers.config.js.
const _VISION_UNAVAILABLE_MSG = 'Photo scan is temporarily unavailable — you can still enter this manually.';

async function _callGroqVision(base64DataUrl, extraNote) {
  // STEP 1: detect report type
  let detectAnswer;
  try {
    const detectRaw = await callAI({
      kind: 'vision',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Is this a structured Bahria Town Sale Report with rows like Cash Sale, Net Cash Sale, Grand Total, credit clients? Reply ONLY: SALE_REPORT or OTHER.' },
        { type: 'image_url', image_url: { url: base64DataUrl } },
      ]}],
      maxTokens: 10, temperature: 0,
    });
    detectAnswer = (detectRaw || '').trim().toUpperCase();
  } catch (e) {
    console.warn('[ai-bridge] vision detect step failed:', e);
    throw new Error(_VISION_UNAVAILABLE_MSG);
  }
  const isSaleReport = detectAnswer.includes('SALE_REPORT');

  // STEP 2a: SALE REPORT — extract structured rows
  if (isSaleReport) {
    let raw;
    try {
      raw = await callAI({
        kind: 'vision',
        messages: [
          { role: 'system', content: [
            'Extract every labelled row from this daily sale report.',
            'Return ONLY JSON, no markdown:',
            '{"report_type":"daily_sale","date":"YYYY-MM-DD","rows":[{"label":"exact label text","amount":12345}]}',
            '"date": ISO date shown on report, or null if not visible.',
            '"label": exact text from left column.',
            '"amount": plain number, negative for returns. Include rows with 0.',
            'Do NOT include Net Cash Sale, Net Credit Sale, Grand Total — those are calculated.',
            'DO include: Customers, FDPP, Till Short, Patty Cash, all bank rows, all credit client rows.',
            extraNote ? ('Extra context: ' + extraNote) : '',
          ].filter(Boolean).join('\n') },
          { role: 'user', content: [
            { type: 'text', text: 'Extract all rows as JSON.' },
            { type: 'image_url', image_url: { url: base64DataUrl } },
          ]},
        ],
        maxTokens: 2000, temperature: 0.1,
      });
    } catch (e) {
      console.warn('[ai-bridge] vision sale-report extract failed:', e);
      throw new Error(_VISION_UNAVAILABLE_MSG);
    }
    if (!raw) throw new Error('Groq returned an empty response.');
    let parsed;
    try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
    catch(_) { throw new Error('Could not parse sale report. Try a clearer photo.'); }

    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const fields = {}, expenses = [], petty = [];

    rows.forEach(function(row) {
      var lk = (row.label || '').toLowerCase().trim();
      if (_SALE_REPORT_SKIP[lk]) return;
      var amount = parseFloat(String(row.amount||'0').replace(/,/g,'')) || 0;
      var fid = _SALE_REPORT_FIELD_MAP[lk];
      if (!fid) {
        var keys = Object.keys(_SALE_REPORT_FIELD_MAP);
        for (var k=0; k<keys.length; k++) {
          if (lk.indexOf(keys[k])!==-1 || keys[k].indexOf(lk)!==-1) { fid=_SALE_REPORT_FIELD_MAP[keys[k]]; break; }
        }
      }
      if (fid === '_till_short') {
        if (amount) expenses.push({ name:'Till Short', amount:Math.abs(amount), description:'Till Short from sale report', type:'expense' });
      } else if (fid === '_patty_cash') {
        if (amount) petty.push({ name:'Patty Cash', amount:Math.abs(amount), description:'Patty Cash from sale report', type:'petty' });
      } else if (fid) {
        fields[fid] = amount;
      }
    });

    return { _isSaleReport:true, date:(parsed.date && parsed.date!=='null' ? parsed.date : null), fields:fields, expenses:expenses, petty:petty, rawRows:rows };
  }

  // STEP 2b: GENERIC — receipts, credit registers, etc.
  const sysPrompt = [
    'You read photos of handwritten/printed closing sheets, credit registers, receipts, or WhatsApp chat screenshots for a petrol station / retail business, and extract every distinct entry you can find.',
    'Return ONLY a JSON object, no markdown, no commentary, in this exact shape:',
    '{"entries":[{"name":"person or client name (or empty)","amount":1234,"description":"short description / item / context","type":"credit|expense|petty|cash|other"}]}',
    '* "amount" must be a plain number (no commas, no currency symbol).',
    '* "type":"credit" for money owed by/lent to a person or client.',
    '* "type":"expense" for money spent (electricity, repairs, salary, etc).',
    '* "type":"petty" for small day-to-day petty-cash items.',
    '* "type":"cash" for a plain cash/sale figure with no clear person/category.',
    '* If unsure, use "other". Skip totals/subtotal lines. Skip lines with no amount.',
    extraNote ? ('* Extra context: ' + extraNote) : null,
  ].filter(Boolean).join('\n');

  let raw2;
  try {
    raw2 = await callAI({
      kind: 'vision',
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: [{ type: 'text', text: 'Extract all entries from this image as JSON.' }, { type: 'image_url', image_url: { url: base64DataUrl } }] },
      ],
      maxTokens: 1500, temperature: 0.1,
    });
  } catch (e) {
    console.warn('[ai-bridge] vision generic extract failed:', e);
    throw new Error(_VISION_UNAVAILABLE_MSG);
  }
  if (!raw2) throw new Error('Groq returned an empty response.');
  let parsed2;
  try { parsed2 = JSON.parse(raw2.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')); }
  catch(_) { throw new Error('Could not parse AI response. Try a clearer photo.'); }
  return (Array.isArray(parsed2.entries)?parsed2.entries:[])
    .map(function(e){ return { name:(e.name||'').toString().trim(), amount:parseFloat(String(e.amount||'0').replace(/,/g,''))||0, description:(e.description||'').toString().trim(), type:['credit','expense','petty','cash','other'].includes(e.type)?e.type:'other' }; })
    .filter(function(e){ return e.amount>0; });
}

function _parseLlmResponse(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.intent && !AI_SAFE_INTENTS.has(parsed.intent.action)) parsed.intent = null;
    // Enforce requiresConfirm for known destructive intents
    if (parsed.intent && AI_DESTRUCTIVE_INTENTS.has(parsed.intent.action)) {
      parsed.requiresConfirm = true;
    }
    return {
      text: parsed.text || cleaned,
      intent: parsed.intent || null,
      requiresConfirm: !!parsed.requiresConfirm,
    };
  } catch (_) {
    return { text: cleaned, intent: null, requiresConfirm: false };
  }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN BRIDGE
// ══════════════════════════════════════════════════════════════════════
async function aiBridgeAnswer(text) {
  try {
    // ── Context follow-up resolution (highest priority, rule-based, instant) ──
    if (typeof AIContext !== 'undefined') {
      const fu = AIContext.resolveFollowUp(text);
      if (fu) {
        if (fu._rewrite) {
          // pronoun rewrite — recurse with enriched text
          return aiBridgeAnswer(fu._rewrite);
        }
        if (fu.text !== null) {
          if (fu.intent) {
            window._aiLastIntent = fu.intent;
            AIContext.updateFromIntent(fu.intent);
          }
          return fu;
        }
      }
      // NOTE: enrichText is intentionally NOT called here.
      // It used to prepend "[Context: ...]" before local parsers ran, which broke
      // regex patterns (e.g. "add 500 expense for tea" → "[Context:...] add 500 ...").
      // enrichText is now applied only just before the Groq call, below.
    }

    // Persistent memory / custom rules / correction-training commands — instant, no Groq.
    if (typeof aimHandleChatCommand === 'function') {
      const memHit = aimHandleChatCommand(text, window._aiLastIntent || null);
      if (memHit) return memHit;
    }

    const jazzCmd    = _aiParseJazzCashCommand(text);   if (jazzCmd)    return jazzCmd;
    const notesCmd   = _aiParseNotesCommand(text);       if (notesCmd)   return notesCmd;
    const creditCmd  = _aiParseCreditCommand(text);     if (creditCmd)  return creditCmd;
    const creditQry  = _aiParseCreditQuery(text);       if (creditQry)  return creditQry;
    const staffQry   = _aiParseStaffQuery(text);        if (staffQry)   return staffQry;
    const expenseQry = _aiParseExpenseQuery(text);      if (expenseQry) return expenseQry;
    const csecQry    = _aiParseCustomSectionQuery(text); if (csecQry)   return csecQry;
    const salaryQry  = _aiParseSalaryQuery(text);       if (salaryQry)  return salaryQry;
    const genericQry = _aiParseGenericQuery(text);      if (genericQry) return genericQry;
    const expenseCmd = _aiParseExpenseCommand(text);    if (expenseCmd) return expenseCmd;
    const pettyCmd   = _aiParsePettyCommand(text);      if (pettyCmd)   return pettyCmd;
    const fieldCmd   = _aiParseDailyFieldCommand(text); if (fieldCmd)   return fieldCmd;
    const csecCmd    = _aiParseCustomSectionCommand(text); if (csecCmd) return csecCmd;
    const printCmd   = _aiParsePrintCommand(text);      if (printCmd)   return printCmd;
    const dateRpt    = _aiParseDateReport(text);         if (dateRpt)    return dateRpt;
    const navCmd     = _aiParseNavCommand(text);        if (navCmd)     return navCmd;
    const tgtCmd     = _aiParseTargetCommand(text);     if (tgtCmd)     return tgtCmd;
    const syncCmd    = _aiParseSyncCommand(text);       if (syncCmd)    return syncCmd;
    const memCmd     = _aiParseMemoryCommand(text);      if (memCmd)     return memCmd;
    const clearCmd   = _aiParseClearCommand(text);      if (clearCmd)   return clearCmd;
    const analytics  = _aiDeepSalesAnalysis(text);      if (analytics)  return { text: analytics, intent: null };

    try {
      // Enrich short context-dependent messages NOW — after all local parsers had a chance
      // to run on clean text. Only the LLM sees the enriched version.
      var _llmText = text;
      if (typeof AIContext !== 'undefined' && AIContext.isFollowUp(text)) {
        _llmText = AIContext.enrichText(text);
      }
      const result = await _callGroq(_llmText);
      if (result && result.intent) window._aiLastIntent = result.intent;
      return result;
    } catch (llmErr) {
      return { text: '\u26a0\ufe0f AI call failed: ' + llmErr.message, intent: null };
    }
  } catch (err) {
    return { text: 'Sorry, I hit a snag (' + err.message + '). Please try again.', intent: null };
  }
}

// ══════════════════════════════════════════════════════════════════════
// INTENT EXECUTORS — existing (unchanged)
// ══════════════════════════════════════════════════════════════════════


// Old model had one multi-field "row" (bill/fuel/soap/refresh/extra/
// pattyHO all on the same row); the Ledger has no row concept — each
// category is its own entry. Splits the single addExpense call into up
// to 6 separate LedgerActions.addEntry calls, one per nonzero field,
// sharing the same date/desc. (_expRows_cur/renderExpenseTable/
// saveExpenseData this used to call no longer exist — see manager.js's
// retired-code note; this was a silent no-op until this rewrite.)




function _aiAddCustomSectionRow(sectionName, desc, amount, notes) {
  const resolved = _aiResolveCustomSection(sectionName);
  if (!resolved) {
    if (typeof toast === 'function') toast('\u26a0 Section "'+sectionName+'" not found. Create it first in Manager \u2192 C. New Sections.','w');
    return;
  }
  const cats = LedgerStore.getCategoryList(resolved.ledgerType);
  // The old AI command never specified a category (custom sections used
  // to be single-field) — default to the section's first category, same
  // simplification renderOtherSectionsManager's own UI assumes for
  // single-category sections.
  const categoryId = cats.length ? cats[0].id : null;
  if (!categoryId) { if (typeof toast === 'function') toast('\u26a0 Section "'+resolved.name+'" has no categories.', 'w'); return; }
  try {
    LedgerActions.addEntry(resolved.ledgerType, {
      date: _aiIsoTodayStr(),
      categoryId,
      amount: parseFloat(amount) || 0,
      desc: desc || notes || '',
    });
    if (typeof showPage === 'function') showPage('manager');
    setTimeout(function () {
      if (typeof switchMgrTab === 'function') switchMgrTab('custom');
      if (typeof toast === 'function') toast('\u2705 Added to ' + resolved.name + ': \u20a8' + (parseFloat(amount)||0).toLocaleString('en-PK'));
    }, 250);
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 ' + e.message, 'e');
  }
}

// ══════════════════════════════════════════════════════════════════════
// NEW INTENT EXECUTORS
// ══════════════════════════════════════════════════════════════════════
























function _aiCreateCustomSection(name, emoji) {
  try {
    if (typeof LedgerStore === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Ledger not available.', 'w'); return; }
    const label = name || 'New Section';
    const sectionId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('section' + Date.now());
    // Old AI command only ever took a name + emoji (no categories) — every
    // section it created was implicitly single-field. Match that with one
    // default outflow category, same default renderOtherSectionsManager's
    // own "+Create Section" form falls back to for a single blank row.
    LedgerStore.createCustomLedgerType(sectionId, label, [
      { id: 'amount', label: 'Amount', sign: -1, color: 'var(--red)', icon: emoji || '📋' },
    ]);
    if (typeof showPage === 'function') showPage('manager');
    setTimeout(function(){
      if (typeof switchMgrTab === 'function') switchMgrTab('custom');
    }, 300);
    if (typeof toast === 'function') toast('\u2705 Custom section "' + (emoji||'📋') + ' ' + label + '" created.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to create section: ' + e.message, 'w'); }
}

function _aiDeleteCustomSectionRow(sectionName, rowIndex) {
  const resolved = _aiResolveCustomSection(sectionName);
  if (!resolved) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  const entries = LedgerStore.getEntries(resolved.ledgerType);
  const entry = entries[rowIndex];
  if (!entry) { if (typeof toast === 'function') toast('\u26a0 Row index ' + rowIndex + ' not found.', 'w'); return; }
  LedgerActions.removeEntry(entry.id);
  if (typeof toast === 'function') toast('\u2705 Row deleted from ' + resolved.name + ': ' + (entry.desc || ''));
}

function _aiDeleteCustomSection(sectionName) {
  const resolved = _aiResolveCustomSection(sectionName);
  if (!resolved) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  try {
    // deleteCustomLedgerType refuses to delete a section with entries
    // still in it — clear them first, same as the UI would require.
    LedgerStore.getEntries(resolved.ledgerType).forEach(e => LedgerActions.removeEntry(e.id));
    LedgerStore.deleteCustomLedgerType(resolved.ledgerType);
    if (typeof toast === 'function') toast('\u2705 Custom section "' + resolved.name + '" deleted.');
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 ' + e.message, 'e');
  }
}

function _aiToggleFieldVisibility(fieldId, visible) {
  if (typeof fmToggleField === 'function') { fmToggleField(fieldId, visible); if (typeof fmApply === 'function') fmApply(); }
  else { if (typeof toast === 'function') toast('\u26a0 Field manager not loaded. Open Entry page first.', 'w'); }
}

function _aiAddCustomField(label, calcType) {
  if (typeof fmAddCustom === 'function') {
    if (typeof openFieldManager === 'function') openFieldManager();
    setTimeout(function(){
      const nameInp = document.getElementById('fm-custom-name');
      const typeInp = document.getElementById('fm-custom-type');
      if (nameInp) nameInp.value = label || '';
      if (typeInp) typeInp.value = calcType || 'add';
      if (typeof fmAddCustom === 'function') fmAddCustom();
    }, 300);
  } else { if (typeof toast === 'function') toast('\u26a0 Field manager not available.', 'w'); }
}

function _aiResetAllFields() {
  if (typeof fmResetAll === 'function') { fmResetAll(); if (typeof toast === 'function') toast('\u2705 All fields reset to default visibility.'); }
  else { if (typeof toast === 'function') toast('\u26a0 Field manager not available.', 'w'); }
}


function _aiEditJazzCashEntry(id) {
  if (typeof LedgerStore === 'undefined' || typeof LedgerActions === 'undefined') return;
  const entry = LedgerStore.getEntries('jazzcash').find(function (e) { return e.id === id; });
  if (!entry) { if (typeof toast === 'function') toast('⚠ Entry not found', 'w'); return; }
  const a = prompt('Amount (current: ' + entry.amount + '):', entry.amount); if (a === null) return;
  const pa = parseFloat(a); if (isNaN(pa) || pa <= 0) { if (typeof toast === 'function') toast('⚠ Invalid', 'w'); return; }
  const d = prompt('Description:', entry.desc || ''); if (d === null) return;
  const cats = LedgerStore.getCategoryList('jazzcash').map(function (c) { return c.id; });
  const ty = prompt('Type (' + cats.join('/') + '):', entry.categoryId); if (ty === null) return;
  const nt = cats.find(function (c) { return c === (ty || '').toLowerCase().trim(); }) || entry.categoryId;
  const shifts = LedgerStore.SHIFTS;
  const s = prompt('Shift (' + shifts.join('/') + '):', entry.shift || 'Morning'); if (s === null) return;
  const ns = shifts.find(function (x) { return x.toLowerCase() === (s || '').toLowerCase().trim(); }) || entry.shift;
  try {
    LedgerActions.updateEntry(id, { amount: pa, desc: d, categoryId: nt, shift: ns });
    if (typeof toast === 'function') toast('✓ Entry updated');
  } catch (e) {
    if (typeof toast === 'function') toast('⚠ ' + e.message, 'e');
  }
}

// ── AI Memory / Rules / Section Config executors ──────────────────────
function _aiAddMemoryFact(fact) {
  if (typeof aimFactAdd !== 'function') return;
  aimFactAdd(fact);
  if (typeof toast === 'function') toast('\u{1F9E0} Remembered: ' + fact);
}
function _aiDeleteMemoryFact(needle) {
  if (typeof aimFactList !== 'function') return;
  const list = aimFactList();
  const n = (needle || '').toLowerCase();
  const hit = list.find(function(f){ return f.fact.toLowerCase().includes(n) || n.includes(f.fact.toLowerCase()); });
  if (!hit) { if (typeof toast === 'function') toast('\u26a0 No matching memory found.', 'w'); return; }
  aimFactDelete(hit.id);
  if (typeof toast === 'function') toast('\u{1F5D1}\uFE0F Forgotten: ' + hit.fact);
}
function _aiAddRule(ruleText) {
  if (typeof aimRuleAdd !== 'function') return;
  const cond = (typeof aimRuleParseCondition === 'function') ? aimRuleParseCondition(ruleText) : null;
  aimRuleAdd(ruleText, cond);
  if (typeof toast === 'function') toast('\u{1F4D0} Rule saved: ' + ruleText);
}
function _aiDeleteRule(needle) {
  if (typeof aimRuleList !== 'function') return;
  const list = aimRuleList();
  const n = (needle || '').toLowerCase();
  const hit = list.find(function(r){ return r.rule.toLowerCase().includes(n); });
  if (!hit) { if (typeof toast === 'function') toast('\u26a0 No matching rule found.', 'w'); return; }
  aimRuleDelete(hit.id);
  if (typeof toast === 'function') toast('\u{1F5D1}\uFE0F Rule removed: ' + hit.rule);
}
function _aiSetSectionAiConfig(sectionName, config) {
  if (typeof aimSectionConfigGetAll !== 'function') return;
  const all = aimSectionConfigGetAll();
  const norm = s => (s||'').trim().toLowerCase();
  const t    = norm(sectionName);
  const sid  = Object.keys(all).find(function(k){ const n=norm(all[k].name); return n===t||n.includes(t)||t.includes(n); });
  if (!sid) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  aimSectionConfigSet(sid, config || {});
  if (typeof toast === 'function') toast('\u2705 AI config updated for "' + all[sid].name + '".');
}

// ══════════════════════════════════════════════════════════════════════
// MASTER EXECUTOR
// ══════════════════════════════════════════════════════════════════════
function aiBridgeExecuteIntent(intent) {
  if (!intent || !AI_SAFE_INTENTS.has(intent.action)) return;
  const p = intent.params || [];
  try {
    switch (intent.action) {
      // Navigation
      case 'showPage':           if (typeof showPage === 'function') showPage(p[0]); break;
      case 'switchMgrTab':       if (typeof showPage === 'function') showPage('manager'); setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab(p[0]);},250); break;
      case 'openStaffCard':      if (typeof showPage === 'function') showPage('manager'); setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('staff');setTimeout(function(){if(typeof openStaffCard==='function')openStaffCard(p[0]);},280);},280); break;
      case 'openFieldManager':   if (typeof openFieldManager === 'function') openFieldManager(); break;
      case 'switchMonth':        _aiSwitchMonth(p[0]); break;
      // Modals / Reports
      case 'openDayModal':       if (typeof openDayModal === 'function') openDayModal(p[0],p[1]); break;
      case 'openMonthModal':     if (typeof openMonthModal === 'function') openMonthModal(p[0]); break;
      case 'printMonthReport':   if (typeof printMonthReport === 'function') printMonthReport(p[0]); break;
      case 'printYearlyReport':  if (typeof printYearlyReport === 'function') printYearlyReport(p[0]); break;
      case 'printMgrReport':     _aiPrintMgrReport(p[0]); break;
      case 'printDayReport':     if (typeof printDayDirectly === 'function') printDayDirectly(p[0],p[1]); break;
      case 'printIncentiveReport': _aiPrintMgrReport('incentive'); break;
      // Daily Entry
      case 'setDailyField':      _aiSetDailyField(p[0],p[1]); break;
      case 'saveNewDailyEntry':  _aiSaveNewDailyEntry(p[0], p[1]); break;
      case 'editDailyEntry':     _aiEditDailyEntry(p[0],p[1],p[2],p[3]); break;
      case 'deleteDailyEntry':   _aiDeleteDailyEntry(p[0],p[1]); break;
      case 'clearEntryForm':     if (typeof clearEntryForm === 'function') clearEntryForm(); if (typeof toast === 'function') toast('\u2705 Entry form cleared.'); break;
      // Staff
      case 'addStaff':           _aiAddStaff(p[0],p[1]); break;
      case 'editStaffField':     _aiEditStaffField(p[0],p[1],p[2]); break;
      case 'deactivateStaff':    _aiDeactivateStaff(p[0]); break;
      case 'reactivateStaff':    _aiReactivateStaff(p[0]); break;
      case 'deleteStaff':        _aiDeleteStaff(p[0]); break;
      // Salary
      case 'addSalaryRow':       _aiAddSalaryRow(p[0],p[1],p[2],p[3],p[4]); break;
      case 'editSalaryRow':      _aiEditSalaryRow(p[0],p[1],p[2]); break;
      case 'setSalaryField':     _aiEditSalaryRow(p[0],p[1],p[2]); break;
      case 'deleteSalaryRow':    _aiDeleteSalaryRow(p[0]); break;
      case 'autoFillSalary':     if (typeof showPage==='function')showPage('manager');setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('salary');setTimeout(function(){if(typeof autoFillSalaryFromSheets==='function')autoFillSalaryFromSheets();},280);},280); break;
      // Generic
      case 'addGenericRow':      _aiAddGenericRow(p[0],p[1],p[2],p[3]); break;
      case 'editGenericRow':     _aiEditGenericRow(p[0],p[1],p[2]); break;
      case 'setGenericSale':     _aiEditGenericRow(p[0],'genericSale',p[1]); break;
      case 'deleteGenericRow':   _aiDeleteGenericRow(p[0]); break;
      // Expense
      case 'addExpense':         _aiAddExpenseRow(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8]); break;
      case 'editExpenseRow':
      case 'deleteExpenseRow':
        // The old "row" concept (one row = up to 6 category amounts
        // together) has no equivalent in the Ledger, where each category
        // is its own independent entry -- there's no single rowIndex to
        // edit/delete anymore. Point to the UI, which has a real delete
        // button and (as of this session) inline edit per entry, rather
        // than silently doing nothing against retired storage.
        if (typeof showPage === 'function') showPage('manager');
        setTimeout(function () {
          if (typeof switchMgrTab === 'function') switchMgrTab('expense');
          if (typeof toast === 'function') toast('\u2139 Editing/deleting a specific expense entry isn\u2019t supported via chat \u2014 tap it in the table to edit, or use the delete button.', 'w');
        }, 250);
        break;
      // Credit
      case 'addCredit':          _aiAddCreditEntry(p[0],p[1],p[2],p[3]); break;
      case 'addCreditEmployee':  _aiAddCreditEmployee(p[0]); break;
      case 'editCreditEntry':    if(typeof showPage==='function')showPage('manager');setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('credit');setTimeout(function(){if(typeof _crdData_cur==='undefined')return;const norm=s=>(s||'').trim().toLowerCase();const t=norm(p[0]);const ei=_crdData_cur.findIndex(function(e){const n=norm(e.name);return n===t||n.includes(t)||t.includes(n);});if(ei===-1){if(typeof toast==='function')toast('\u26a0 Employee not found.','w');return;}const ent=_crdData_cur[ei].entries[p[1]];if(!ent){if(typeof toast==='function')toast('\u26a0 Entry index out of range.','w');return;}ent[p[2]]=p[3];if(typeof renderCreditLedger==='function')renderCreditLedger(_crdData_cur);if(typeof saveCreditData==='function')saveCreditData();if(typeof toast==='function')toast('\u2705 Credit entry updated.');},280);},280); break;
      case 'deleteCreditEntry':  _aiDeleteCreditEntry(p[0],p[1]); break;
      case 'deleteCreditEmployee': _aiDeleteCreditEmployee(p[0]); break;
      case 'setCreditEmpField':  _aiSetCreditEmpField(p[0],p[1],p[2]); break;
      case 'copyToNextMonth':    if(typeof copyToNextMonth==='function')copyToNextMonth(); break;
      case 'copyManagerToNextMonth': if(typeof copyToNextMonth==='function')copyToNextMonth(); break;
      // Petty
      case 'addPettyItem':       _aiAddPettyItem(p[0],p[1],p[2]); break;
      case 'addPettyGroup':      _aiAddPettyGroup(p[0]); break;
      case 'editPettyRow':       if(typeof showPage==='function')showPage('manager');setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('petty');setTimeout(function(){if(typeof _pettyData==='undefined'||!_pettyData.groups||!_pettyData.groups[p[0]])return;const rows=_pettyData.groups[p[0]].rows;if(!rows||!rows[p[1]])return;rows[p[1]][p[2]]=p[3];if(typeof renderPettyGroups==='function')renderPettyGroups();if(typeof savePettyData==='function')savePettyData();if(typeof toast==='function')toast('\u2705 Petty row updated.');},280);},280); break;
      case 'deletePettyRow':     _aiDeletePettyRow(p[0],p[1]); break;
      case 'deletePettyGroup':   _aiDeletePettyGroup(p[0]); break;
      // Incentive
      case 'recalcIncentive':    if(typeof showPage==='function')showPage('manager');setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('incentive');setTimeout(function(){if(typeof recalcIncentive==='function')recalcIncentive();},280);},280); break;
      // Targets
      case 'setMonthTarget':     _aiSetMonthTarget(p[0],p[1]); break;
      case 'deleteMonthTarget':  _aiDeleteMonthTarget(p[0]); break;
      // Custom Sections
      case 'addCustomSectionRow':  _aiAddCustomSectionRow(p[0],p[1],p[2],p[3]); break;
      case 'editCustomSectionRow': _aiEditCustomSectionRow(p[0],p[1],p[2],p[3]); break;
      case 'createCustomSection':  _aiCreateCustomSection(p[0],p[1]); break;
      case 'deleteCustomSectionRow': _aiDeleteCustomSectionRow(p[0],p[1]); break;
      case 'deleteCustomSection':  _aiDeleteCustomSection(p[0]); break;
      // Field Manager
      case 'toggleFieldVisibility': _aiToggleFieldVisibility(p[0],p[1]); break;
      case 'addCustomField':       _aiAddCustomField(p[0],p[1]); break;
      case 'resetAllFields':       _aiResetAllFields(); break;
      // Sync / Backup
      case 'pushToSupabase':     if(typeof pushToSupabase==='function')pushToSupabase(); else if(typeof toast==='function')toast('\u26a0 Supabase not configured.','w'); break;
      case 'pullFromSupabase':   if(typeof pullFromSupabase==='function')pullFromSupabase(); else if(typeof toast==='function')toast('\u26a0 Supabase not configured.','w'); break;
      case 'backupToDrive':      if(typeof driveBackupNow==='function')driveBackupNow(); else if(typeof toast==='function')toast('\u26a0 Google Drive not connected.','w'); break;
      // AI Memory / Rules / Section Config
      case 'addMemoryFact':      _aiAddMemoryFact(p[0]); break;
      case 'deleteMemoryFact':   _aiDeleteMemoryFact(p[0]); break;
      case 'addRule':            _aiAddRule(p[0]); break;
      case 'deleteRule':         _aiDeleteRule(p[0]); break;
      case 'setSectionAiConfig': _aiSetSectionAiConfig(p[0], p[1]); break;
      // Jazz Cash Ledger — routes through the generalized LedgerActions
      // now (jazz-cash.js's old jcAddEntry/jcEditEntry/jcDeleteEntry were
      // retired when the Daily Ledger sub-tab moved onto the unified
      // Ledger; see jazz-cash.js's header comment).
      case 'addJazzCashEntry': {
        // p[0] may be a full opts object (from Groq) or plain amount (from local parser)
        const jcOpts = (p[0] && typeof p[0] === 'object')
          ? p[0]
          : { amount: Number(p[0]) || 0, desc: p[1] || '', type: p[2] || 'credit' };
        const amount = Math.abs(parseFloat(jcOpts.amount) || 0);
        if (amount > 0 && typeof LedgerActions !== 'undefined') {
          try {
            LedgerActions.addEntry('jazzcash', {
              date: _aiToIsoDate(jcOpts.date),
              categoryId: jcOpts.type || jcOpts.categoryId || 'credit',
              amount,
              desc: jcOpts.desc || jcOpts.description || '',
              shift: jcOpts.shift || 'Morning',
            });
            if (typeof showPage === 'function') showPage('manager');
            setTimeout(function () { if (typeof switchMgrTab === 'function') switchMgrTab('jazzcash'); }, 200);
          } catch (e) {
            if (typeof toast === 'function') toast('⚠ ' + e.message, 'e');
          }
        }
        break;
      }
      case 'editJazzCashEntry':
        _aiEditJazzCashEntry(p[0]);
        break;
      case 'deleteJazzCashEntry':
        if (typeof LedgerActions !== 'undefined') LedgerActions.removeEntry(p[0]);
        break;
      // Notes & Sheets
      // BUG FIX (found during Repository migration audit): all three cases
      // below used to call showPage('notes-sheets') — but there is no
      // page-notes-sheets element anywhere in index.html. showPage() hides
      // EVERY page first, then fails to find the target and shows nothing —
      // leaving the user looking at a completely blank screen. Notes/Sheets
      // is its own peer dashboard now (V2 plan §5) — showPage('notesheets')
      // renders it directly, no Manager sub-tab hop needed anymore.
      case 'addNote': {
        // Navigate to Notes & Sheets, open editor with pre-filled content
        if (typeof showPage === 'function') showPage('notesheets');
        setTimeout(function () {
          if (typeof _nsSetPanel === 'function') _nsSetPanel('notes');
          setTimeout(function () {
            if (typeof _nsNewNote === 'function') {
              _nsNewNote();
              // Pre-fill body if content was provided
              if (p[0]) {
                setTimeout(function () {
                  const bodyEl = document.getElementById('nse-body');
                  if (bodyEl) bodyEl.value = p[0];
                  const titleEl = document.getElementById('nse-title');
                  // Auto-generate title from first line if no title
                  if (titleEl && !titleEl.value) {
                    titleEl.value = p[0].slice(0, 50).split('\n')[0];
                  }
                }, 150);
              }
            }
          }, 200);
        }, 250);
        break;
      }
      case 'showNotesPanel': {
        if (typeof showPage === 'function') showPage('notesheets');
        const panelTarget = p[0] || 'notes';
        setTimeout(function () {
          if (typeof _nsSetPanel === 'function') _nsSetPanel(panelTarget);
        }, 250);
        break;
      }
      case 'openSheetFile': {
        if (typeof showPage === 'function') showPage('notesheets');
        setTimeout(function () {
          if (typeof _nsSetPanel === 'function') _nsSetPanel('sheets');
          setTimeout(function () {
            if (typeof _nsSFLoad_ === 'function') _nsSFLoad_(p[0]);
          }, 200);
        }, 250);
        break;
      }
      // Memory (Phase 5)
      case 'openMemoryPanel':
        if (typeof aimOpenPanel === 'function') aimOpenPanel();
        break;
    }
    // ── Update working context after every intent ──
    if (typeof AIContext !== 'undefined') {
      try { AIContext.updateFromIntent(intent); } catch(_) {}
    }
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 Action failed: ' + e.message, 'w');
  }
}

// Bridge what's used externally (jazz-cash.js, commandhub-page.js,
// ai-context.js, ai-helpers.js) or via a same-file onclick attribute.
window.getAiSettings = getAiSettings;
window.saveAiSettings = saveAiSettings;
window.clearAiSettings = clearAiSettings;
window.aiHasKey = aiHasKey;
window.aiGetProviderKey = getProviderKey;
window.aiSaveProviderKey = saveProviderKey;
window.AI_DESTRUCTIVE_INTENTS = AI_DESTRUCTIVE_INTENTS;
window._aiTodayStr = _aiTodayStr;
window._aiReadCreditBalance = _aiReadCreditBalance;
window._aiAddNoteFromChat = _aiAddNoteFromChat;
window._callGroqVision = _callGroqVision;
window.aiBridgeAnswer = aiBridgeAnswer;
window._aiAddCreditEntry = _aiAddCreditEntry;
window._aiAddExpenseRow = _aiAddExpenseRow;
window._aiAddPettyItem = _aiAddPettyItem;
window._aiSaveNewDailyEntry = _aiSaveNewDailyEntry;
window.aiBridgeExecuteIntent = aiBridgeExecuteIntent;

})();
