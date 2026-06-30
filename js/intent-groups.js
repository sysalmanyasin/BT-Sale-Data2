// ══════════════════════════════════════════════════════════════════════
// IntentGroupRegistry — Centralized Intent Grouping & Smart Shortcuts
// BT Sales App  ·  v1.0
//
// Organises every intent into 8 major business groups and exposes:
//   IntentGroupRegistry.getGroup(intentId)          → group object | null
//   IntentGroupRegistry.enrichIntent(intentObj)     → adds groupId/groupName/shortcut
//   IntentGroupRegistry.getAllGroups()               → array of 8 group objects
//   IntentGroupRegistry.getGroupById(groupId)       → group object | null
//   IntentGroupRegistry.searchGroup(query)          → best-matching group | null
//   IntentGroupRegistry.trackUsage(groupId)         → records a use (localStorage)
//   IntentGroupRegistry.getSuggestedGroups(n)       → top-n groups by usage count
//   IntentGroupRegistry.resetUsage()               → clears usage stats
// ══════════════════════════════════════════════════════════════════════

var IntentGroupRegistry = (function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────
     GROUP DEFINITIONS
  ────────────────────────────────────────────────────────────────── */
  var GROUPS = [
    {
      id:        'navigation',
      name:      'Navigation',
      shortcut:  '🧭 Go',
      emoji:     '🧭',
      label:     'Go',
      color:     '#0ea5e9',
      bg:        '#f0f9ff',
      border:    '#bae6fd',
      searchTerms: ['navigation','go','open','page','switch','tab','navigate','move'],
      intents: [
        'showPage', 'switchMgrTab', 'openStaffCard', 'switchMonth',
        'openFieldManager', 'toggleFieldVisibility', 'addCustomField', 'resetAllFields',
      ],
    },
    {
      id:        'sales',
      name:      'Sales & Daily Entry',
      shortcut:  '💰 Sale',
      emoji:     '💰',
      label:     'Sale',
      color:     '#16a34a',
      bg:        '#f0fdf4',
      border:    '#bbf7d0',
      searchTerms: ['sale','daily','entry','cash','data','add entry','save entry','clear form'],
      intents: [
        'saveNewDailyEntry', 'setDailyField', 'editDailyEntry',
        'deleteDailyEntry', 'clearEntryForm',
        'setGenericSale', 'addGenericRow', 'editGenericRow', 'deleteGenericRow',
      ],
    },
    {
      id:        'staff',
      name:      'Staff Management',
      shortcut:  '👥 Staff',
      emoji:     '👥',
      label:     'Staff',
      color:     '#d97706',
      bg:        '#fffbeb',
      border:    '#fde68a',
      searchTerms: ['staff','employee','hr','team','worker','people','profile','add staff'],
      intents: [
        'addStaff', 'editStaffField', 'deactivateStaff',
        'reactivateStaff', 'deleteStaff',
      ],
    },
    {
      id:        'payroll',
      name:      'Payroll & Credits',
      shortcut:  '💵 Ledger',
      emoji:     '💵',
      label:     'Ledger',
      color:     '#7c3aed',
      bg:        '#faf5ff',
      border:    '#e9d5ff',
      searchTerms: ['payroll','ledger','credit','salary','advance','loan','copy month','wages'],
      intents: [
        'addCredit', 'addCreditEmployee', 'editCreditEntry', 'deleteCreditEntry',
        'deleteCreditEmployee', 'setCreditEmpField', 'copyToNextMonth',
        'addSalaryRow', 'editSalaryRow', 'deleteSalaryRow', 'setSalaryField',
        'autoFillSalary', 'copyManagerToNextMonth',
      ],
    },
    {
      id:        'expenses',
      name:      'Expenses & Petty Cash',
      shortcut:  '🧾 Expense',
      emoji:     '🧾',
      label:     'Expense',
      color:     '#dc2626',
      bg:        '#fff1f2',
      border:    '#fecaca',
      searchTerms: ['expense','petty','cash','kharcha','patty','spending','cost','bill','fuel'],
      intents: [
        'addExpense', 'editExpenseRow', 'deleteExpenseRow',
        'addPettyItem', 'addPettyGroup', 'editPettyRow',
        'deletePettyRow', 'deletePettyGroup',
      ],
    },
    {
      id:        'records',
      name:      'Business Records',
      shortcut:  '📁 Records',
      emoji:     '📁',
      label:     'Records',
      color:     '#0891b2',
      bg:        '#ecfeff',
      border:    '#a5f3fc',
      searchTerms: ['records','register','section','custom','business','document','files'],
      intents: [
        'createCustomSection', 'addCustomSectionRow',
        'deleteCustomSectionRow', 'deleteCustomSection',
      ],
    },
    {
      id:        'reports',
      name:      'Reports & Analytics',
      shortcut:  '📊 Reports',
      emoji:     '📊',
      label:     'Reports',
      color:     '#2563eb',
      bg:        '#eff6ff',
      border:    '#bfdbfe',
      searchTerms: ['report','analytics','print','month report','year report','day report','target','incentive'],
      intents: [
        'openDayModal', 'openMonthModal', 'printMonthReport', 'printYearlyReport',
        'printMgrReport', 'printDayReport', 'printIncentiveReport',
        'recalcIncentive', 'setMonthTarget', 'deleteMonthTarget',
      ],
    },
    {
      id:        'ai',
      name:      'AI & Automation',
      shortcut:  '🤖 AI',
      emoji:     '🤖',
      label:     'AI',
      color:     '#6d28d9',
      bg:        '#f5f3ff',
      border:    '#ddd6fe',
      searchTerms: ['ai','memory','rules','training','sync','backup','automation','supabase','drive','learning'],
      intents: [
        'addMemoryFact', 'deleteMemoryFact', 'addRule', 'deleteRule',
        'setSectionAiConfig', 'pushToSupabase', 'pullFromSupabase', 'backupToDrive',
      ],
    },
  ];

  /* ──────────────────────────────────────────────────────────────────
     BUILD FAST LOOKUP MAP  (intentId → group)
  ────────────────────────────────────────────────────────────────── */
  var _map = {};
  GROUPS.forEach(function (g) {
    g.intents.forEach(function (id) {
      _map[id] = g;
    });
  });

  /* ──────────────────────────────────────────────────────────────────
     USAGE TRACKING  (localStorage: bt_igr_usage)
  ────────────────────────────────────────────────────────────────── */
  var USAGE_KEY = 'bt_igr_usage';

  function _loadUsage() {
    try { return JSON.parse(Repository.getItem(USAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function _saveUsage(u) {
    try { Repository.setItem(USAGE_KEY, JSON.stringify(u)); } catch (_) {}
  }

  function trackUsage(groupId) {
    if (!groupId) return;
    var u = _loadUsage();
    u[groupId] = (u[groupId] || 0) + 1;
    _saveUsage(u);
  }

  function getSuggestedGroups(n) {
    var u = _loadUsage();
    return GROUPS
      .slice()
      .sort(function (a, b) { return (u[b.id] || 0) - (u[a.id] || 0); })
      .slice(0, n || 3);
  }

  function resetUsage() {
    try { Repository.removeItem(USAGE_KEY); } catch (_) {}
  }

  /* ──────────────────────────────────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────────────────────────────────── */

  function getGroup(intentId) {
    return _map[intentId] || null;
  }

  function getGroupById(groupId) {
    return GROUPS.find(function (g) { return g.id === groupId; }) || null;
  }

  function getAllGroups() {
    return GROUPS;
  }

  function enrichIntent(intentObj) {
    if (!intentObj || !intentObj.action) return intentObj;
    var g = _map[intentObj.action];
    if (g) {
      intentObj.groupId   = g.id;
      intentObj.groupName = g.name;
      intentObj.shortcut  = g.shortcut;
    }
    return intentObj;
  }

  /* ──────────────────────────────────────────────────────────────────
     GROUP SEARCH
     Returns the best-matching group for a natural-language query,
     or null if no reasonable match is found.
  ────────────────────────────────────────────────────────────────── */
  function searchGroup(query) {
    if (!query) return null;
    var q = query.toLowerCase().trim();
    var best = null, bestScore = 0;

    GROUPS.forEach(function (g) {
      var score = 0;

      // Direct match on group name
      var gName = g.name.toLowerCase();
      if (gName === q) { score = 100; }
      else if (gName.includes(q) || q.includes(gName)) { score = 90; }

      // Match on label / shortcut
      var lbl = g.label.toLowerCase();
      if (q.includes(lbl) || lbl.includes(q)) { score = Math.max(score, 85); }

      // Match on search terms
      g.searchTerms.forEach(function (term) {
        var t = term.toLowerCase();
        if (q === t) { score = Math.max(score, 95); }
        else if (q.includes(t) || t.includes(q)) { score = Math.max(score, 75); }
        else {
          // word-overlap
          var qw = q.split(/\s+/);
          var tw = t.split(/\s+/);
          var hits = qw.filter(function (w) { return tw.some(function (tw2) { return tw2.includes(w) || w.includes(tw2); }); }).length;
          if (hits > 0) { score = Math.max(score, 50 + hits * 5); }
        }
      });

      if (score > bestScore) { bestScore = score; best = g; }
    });

    return bestScore >= 50 ? best : null;
  }

  /* ──────────────────────────────────────────────────────────────────
     DETECT GROUP SEARCH PHRASE
     Returns true when the user's query looks like a "navigate to group"
     phrase rather than a data question or command.
  ────────────────────────────────────────────────────────────────── */
  var _NAV_PREFIXES = /^(open|show|go to|goto|navigate|switch to|take me to|browse)\b/i;

  function isGroupSearchQuery(query) {
    if (!query) return false;
    var q = query.trim();
    // Must start with a navigation word and be fairly short
    if (!_NAV_PREFIXES.test(q)) return false;
    // Strip the nav word and see if remainder matches a group
    var remainder = q.replace(_NAV_PREFIXES, '').trim();
    return !!searchGroup(remainder);
  }

  function resolveGroupQuery(query) {
    var remainder = query.trim().replace(_NAV_PREFIXES, '').trim();
    return searchGroup(remainder);
  }

  /* ──────────────────────────────────────────────────────────────────
     EXPORT
  ────────────────────────────────────────────────────────────────── */
  return {
    getGroup:           getGroup,
    getGroupById:       getGroupById,
    getAllGroups:       getAllGroups,
    enrichIntent:       enrichIntent,
    searchGroup:        searchGroup,
    isGroupSearchQuery: isGroupSearchQuery,
    resolveGroupQuery:  resolveGroupQuery,
    trackUsage:         trackUsage,
    getSuggestedGroups: getSuggestedGroups,
    resetUsage:         resetUsage,
  };

}());
