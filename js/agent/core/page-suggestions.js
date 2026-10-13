// Page awareness for the global Jarvis panel. Pure: maps the page the person is looking at to an area (Sales, Inventory, Cash,
// Audit, BT Intelligence), a readable name for the "Viewing ..." line, and a few starter questions that suit that page.
// The questions are ordinary typed questions: they go through the same ask() path as anything the person types, so the router,
// tools, permissions and approvals are unchanged. Nothing here reads data or writes anything.

const AREA_OF = Object.freeze({
  dashboard: 'sales', index: 'sales', data: 'sales', entry: 'sales', report: 'sales', diff: 'sales',
  'closing-book': 'cash', 'credit-ledger': 'cash', cashdeposit: 'cash', 'sale-payments': 'cash',
  inventory: 'inventory', stockledger: 'inventory', excess: 'inventory', reorder: 'inventory', 'inv-health': 'inventory',
  str: 'inventory', 'str-report': 'inventory', 'str-zero-dispatch': 'inventory',
  assignments: 'audit',
  'ai-center': 'intel',
});

const PAGE_NAME = Object.freeze({
  cover: 'Cover', dashboard: 'Sales Dashboard', index: 'Sale Data', data: 'Daily Data', entry: 'Add Entry', report: 'Sale Report', diff: 'DIFF Report',
  cashdeposit: 'Cash Deposit', 'sale-payments': 'Payments', 'closing-book': 'Closing Book', 'credit-ledger': 'Credit Ledger',
  inventory: 'Inventory', stockledger: 'Stock Ledger', excess: 'Excess Working', reorder: 'Reorder Report', 'inv-health': 'Inventory Health',
  str: 'STR Report', 'str-report': 'STR Report', 'str-zero-dispatch': '0-Dispatch', assignments: 'Audit Assignments',
  manager: 'Manager', 'manager-dashboard': 'Manager Dashboard', notesheets: 'Notes & Sheets', tools: 'Tools', 'pdf-library': 'PDF Library',
  'activity-log': 'Activity Log', 'ai-center': 'BT Intelligence', 'emergency-billing': 'Emergency Billing',
});

export const AREA_LABEL = Object.freeze({ sales: 'Sales', inventory: 'Inventory', cash: 'Cash', audit: 'Audit', intel: 'BT Intelligence', general: 'BT' });

export const GENERAL_SUGGESTIONS = Object.freeze([
  'What needs my attention today?',
  "How are today's sales?",
  'Target pace this month',
  'What is low on stock?',
]);

const BY_AREA = Object.freeze({
  sales: ["How are today's sales?", 'Target pace this month', 'Compare this month with last month', "Today's forecast"],
  inventory: ['What is low on stock?', 'Which items have under 7 days of cover?', 'Draft a reorder list', 'Which stock is slow moving?'],
  cash: ['What is blocking closing?', "Explain today's cash difference", "Today's payments breakdown", 'Which staff credit balances need review?'],
  audit: ['Summarise the audit variance', 'What expires soon?', 'Which items need a recount?', 'Which audit gaps are the biggest?'],
  intel: ['What needs my attention today?', 'Which inventory risks are most urgent?', 'What is blocking closing?', 'What is Jarvis proposing right now?'],
});

const clean = id => String(id == null ? '' : id).replace(/^page-/, '').trim().toLowerCase();

/** 'sales' | 'inventory' | 'cash' | 'audit' | 'intel' | 'general' */
export function areaOf(pageId) { return AREA_OF[clean(pageId)] || 'general'; }

/** Readable page name for the "Viewing ..." line; unknown pages are title-cased from their id. */
export function pageName(pageId) {
  const id = clean(pageId);
  if (!id) return 'this page';
  return PAGE_NAME[id] || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** "Sales · Daily Data", or just the page name on pages that belong to no area. */
export function viewingLabel(pageId) {
  const area = areaOf(pageId), name = pageName(pageId);
  return area === 'general' || area === 'intel' ? name : AREA_LABEL[area] + ' · ' + name;
}

/** Starter questions for the page (always a fresh array of 3-4 strings). */
export function suggestionsFor(pageId) { return [...(BY_AREA[areaOf(pageId)] || GENERAL_SUGGESTIONS)]; }

/** The Emergency Billing counter-sale screen: Jarvis never floats over it (the person can still open it deliberately). */
export const hidesButton = pageId => clean(pageId) === 'emergency-billing';
