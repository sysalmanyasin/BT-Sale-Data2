// ══════════════════════════════════════════════════════════════════════
// AIContext — Context Engine  v1.0
// BT Sales App
//
// Remembers the user's working context across messages so they can say
// "2500" instead of "credit 2500 for Kashif" once a staff member is open.
//
// Context slots:
//   employee   { name, staffIndex, via, setAt }   — current person in focus
//   section    { id, label, via, setAt }           — current tab / section
//   page       { id, label, via, setAt }           — current app page
//   month      { value, setAt }                    — current working month
//   lastAction { text, intentAction, params, setAt }
//
// Public API:
//   AIContext.setEmployee(name, staffIndex, via)
//   AIContext.setSection(id, label, via)
//   AIContext.setPage(id)
//   AIContext.setMonth(value)
//   AIContext.setLastAction(text, intentAction, params)
//   AIContext.get()               → full context snapshot
//   AIContext.getConfidence()     → 0-100 score (decays with time)
//   AIContext.clear(slot?)        → clear one slot or all
//   AIContext.isFollowUp(text)    → boolean
//   AIContext.resolveFollowUp(text) → {text,intent,requiresConfirm} | null
//   AIContext.updateFromIntent(intent) → infer context from executed intent
//   AIContext.buildPromptBlock()  → text block for LLM injection
// ══════════════════════════════════════════════════════════════════════

var AIContext = (function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────────
     CONFIGURATION
  ────────────────────────────────────────────────────────────────── */
  var EXPIRY_MS       = 30 * 60 * 1000;   // context expires after 30 min
  var STORE_KEY       = 'bt_ai_context_v1';
  var CONF_FULL_MS    = 5  * 60 * 1000;   // 100% confidence within 5 min
  var CONF_MID_MS     = 15 * 60 * 1000;   // 60% at 15 min
  var CONF_LOW_MS     = 25 * 60 * 1000;   // 30% at 25 min

  /* ──────────────────────────────────────────────────────────────────
     STATE
  ────────────────────────────────────────────────────────────────── */
  var _empty = function () {
    return {
      employee:   null,   // { name, staffIndex, via, setAt }
      section:    null,   // { id, label, via, setAt }
      page:       null,   // { id, label, setAt }
      month:      null,   // { value, setAt }
      lastAction: null,   // { text, intentAction, params, setAt }
    };
  };

  var _ctx = _load();

  function _load() {
    try { return JSON.parse(Repository.getItem(STORE_KEY) || 'null') || _empty(); }
    catch (_) { return _empty(); }
  }
  function _save() {
    try { Repository.setItem(STORE_KEY, JSON.stringify(_ctx)); } catch (_) {}
    if (typeof renderAiContextPanel === 'function') {
      try { renderAiContextPanel(); } catch(_) {}
    }
  }
  function _now() { return Date.now(); }

  /* ──────────────────────────────────────────────────────────────────
     SETTERS — call these from page navigation & intent execution
  ────────────────────────────────────────────────────────────────── */
  function setEmployee(name, staffIndex, via) {
    if (!name) return;
    _ctx.employee = { name: String(name).trim(), staffIndex: staffIndex || null, via: via || 'direct', setAt: _now() };
    _save();
  }

  function setSection(id, label, via) {
    _ctx.section = { id: id || '', label: label || id || '', via: via || 'direct', setAt: _now() };
    _save();
  }

  // Pin a context group so it persists until explicitly unpinned/cleared
  function pinGroup(id, label) {
    setSection(id, label, 'pinned');
  }

  function setPage(id) {
    var labels = {
      dashboard: 'Dashboard', index: 'Year Overview', data: 'Data Table',
      entry: 'Daily Entry', report: 'Reports', diff: 'Diff Report',
      tools: 'Tools', manager: 'Manager', ai: 'AI Assistant',
    };
    _ctx.page = { id: id || '', label: labels[id] || id || '', setAt: _now() };
    _save();
  }

  function setMonth(value) {
    if (!value) return;
    _ctx.month = { value: String(value).trim(), setAt: _now() };
    _save();
  }

  function setLastAction(text, intentAction, params) {
    _ctx.lastAction = { text: text || '', intentAction: intentAction || '', params: params || [], setAt: _now() };
    _save();
  }

  /* ──────────────────────────────────────────────────────────────────
     GETTERS
  ────────────────────────────────────────────────────────────────── */
  function get() {
    _ctx = _load();
    // Expire stale slots (pinned sections never auto-expire)
    var now = _now();
    ['employee','section','lastAction'].forEach(function(slot) {
      if (_ctx[slot] && _ctx[slot].setAt && (now - _ctx[slot].setAt) > EXPIRY_MS) {
        if (slot === 'section' && _ctx[slot].via === 'pinned') return;
        _ctx[slot] = null;
      }
    });
    return _ctx;
  }

  function getEmployee() { var c = get(); return c.employee || null; }
  function getSection()  { var c = get(); return c.section  || null; }
  function getPage()     { var c = get(); return c.page     || null; }
  function getMonth()    { var c = get(); return c.month    || null; }
  function getLastAction(){ var c = get(); return c.lastAction || null; }

  // 0-100 score based on how recently context was set
  function getConfidence() {
    var c = get();
    if (c.section && c.section.via === 'pinned') return 100;
    if (!c.employee && !c.lastAction) return 0;
    var anchor = c.lastAction ? c.lastAction.setAt : (c.employee ? c.employee.setAt : 0);
    if (!anchor) return 0;
    var age = _now() - anchor;
    if (age <= 0)            return 100;
    if (age <= CONF_FULL_MS) return 100;
    if (age <= CONF_MID_MS)  return Math.round(100 - (age - CONF_FULL_MS) / (CONF_MID_MS - CONF_FULL_MS) * 40);
    if (age <= CONF_LOW_MS)  return Math.round(60  - (age - CONF_MID_MS)  / (CONF_LOW_MS - CONF_MID_MS)  * 30);
    if (age <= EXPIRY_MS)    return Math.round(30  - (age - CONF_LOW_MS)  / (EXPIRY_MS   - CONF_LOW_MS)  * 30);
    return 0;
  }

  function getAgeLabel(setAt) {
    if (!setAt) return '';
    var secs = Math.round((_now() - setAt) / 1000);
    if (secs < 60)   return secs + 's ago';
    if (secs < 3600) return Math.round(secs / 60) + 'min ago';
    return Math.round(secs / 3600) + 'h ago';
  }

  /* ──────────────────────────────────────────────────────────────────
     CLEAR
  ────────────────────────────────────────────────────────────────── */
  function clear(slot) {
    if (slot) { _ctx[slot] = null; }
    else { _ctx = _empty(); }
    _save();
  }

  /* ──────────────────────────────────────────────────────────────────
     UPDATE FROM INTENT — infer context from executed intents
  ────────────────────────────────────────────────────────────────── */
  var _INTENT_LABELS = {
    addCredit: 'Added credit', addCreditEmployee: 'Added to credit',
    editCreditEntry: 'Edited credit', deleteCreditEntry: 'Deleted credit entry',
    addExpense: 'Added expense', deleteExpenseRow: 'Deleted expense',
    addPettyItem: 'Added petty item', addPettyGroup: 'Added petty group',
    addSalaryRow: 'Added salary row', editSalaryRow: 'Edited salary',
    saveNewDailyEntry: 'Saved daily entry', editDailyEntry: 'Edited entry',
    deleteDailyEntry: 'Deleted entry', setDailyField: 'Set field',
    addStaff: 'Added staff', editStaffField: 'Edited staff',
    showPage: 'Opened page', switchMgrTab: 'Switched tab',
    openStaffCard: 'Opened staff card',
    addCustomSectionRow: 'Added to section', createCustomSection: 'Created section',
    setMonthTarget: 'Set target', printMonthReport: 'Printed month report',
    pushToSupabase: 'Synced to cloud', backupToDrive: 'Backed up',
  };

  var _SECTION_FROM_ACTION = {
    addCredit: 'credit', addCreditEmployee: 'credit', editCreditEntry: 'credit',
    addExpense: 'expense', editExpenseRow: 'expense', deleteExpenseRow: 'expense',
    addPettyItem: 'petty', addPettyGroup: 'petty',
    addSalaryRow: 'salary', editSalaryRow: 'salary', deleteSalaryRow: 'salary',
    addGenericRow: 'generic', editGenericRow: 'generic',
  };

  var _SECTION_LABELS = {
    credit: 'Credit Ledger', expense: 'Expenses', petty: 'Petty Cash',
    salary: 'Salary', generic: 'Generic Working', incentive: 'Incentive',
    staff: 'Staff', tools: 'Tools',
  };

  function updateFromIntent(intent) {
    if (!intent || !intent.action) return;
    var p = intent.params || [];
    var label = _INTENT_LABELS[intent.action] || intent.action;
    var actionText = label;

    // Update employee context
    var empActions = ['addCredit','editCreditEntry','deleteCreditEntry','setCreditEmpField',
      'addCreditEmployee','deleteCreditEmployee','addSalaryRow','editSalaryRow','deleteSalaryRow',
      'editStaffField','deactivateStaff','reactivateStaff','deleteStaff','addGenericRow','editGenericRow'];
    if (empActions.includes(intent.action) && p[0] && typeof p[0] === 'string') {
      setEmployee(p[0], null, intent.action);
      actionText += ' — ' + p[0];
      if (p[1] && typeof p[1] === 'number') actionText += ' ₨' + Math.round(p[1]).toLocaleString('en-PK');
    }

    // Update staff card context
    if (intent.action === 'openStaffCard' && p[0] !== undefined) {
      try {
        var staffName = '';
        if (typeof STAFF !== 'undefined' && STAFF[p[0]]) staffName = STAFF[p[0]].name || '';
        if (staffName) setEmployee(staffName, p[0], 'openStaffCard');
      } catch(_) {}
    }

    // Update section context
    var secId = _SECTION_FROM_ACTION[intent.action];
    if (secId) setSection(secId, _SECTION_LABELS[secId] || secId, intent.action);

    if (intent.action === 'switchMgrTab' && p[0]) {
      setSection(p[0], _SECTION_LABELS[p[0]] || p[0], 'tab');
    }

    // Update page context
    var pageActions = { showPage: p[0], switchMgrTab: 'manager' };
    if (pageActions[intent.action]) setPage(pageActions[intent.action]);

    // Update custom section context
    if ((intent.action === 'addCustomSectionRow' || intent.action === 'deleteCustomSectionRow') && p[0]) {
      setSection(p[0], p[0], intent.action);
      actionText += ' — ' + p[0];
    }
    if (intent.action === 'createCustomSection' && p[0]) {
      setSection(p[0], p[0], 'create');
    }

    // Update month context
    if (intent.action === 'switchMonth' && p[0]) setMonth(p[0]);
    if (intent.action === 'setMonthTarget' && p[0]) setMonth(p[0]);

    // Always set last action
    setLastAction(actionText, intent.action, p);
  }

  /* ──────────────────────────────────────────────────────────────────
     FOLLOW-UP DETECTION
     Returns true if the text looks like a short follow-up that needs
     context to be understood.
  ────────────────────────────────────────────────────────────────── */
  var _FOLLOW_UP_PATTERNS = [
    /^[\d,\s]+(?:rupees?|pkr|rs\.?)?$/i,          // number only: "2500", "2,500 rupees"
    /^another\s+[\d,]+/i,                           // "another 500"
    /^(?:same|again|repeat)$/i,                     // "same", "again"
    /^(?:balance|kitna|baqi|check|dekho|batao|show|kitna hai)[\s?]*$/i, // balance queries
    /^(?:uska|uski|his|her|their)\s+/i,             // pronoun-reference
    /^(?:yes|confirm|ok|haan|done|go|kar do)$/i,    // confirmations
    /^(?:undo|wapis|cancel|na)$/i,                  // undo-like
    /^(?:deduct|minus|less)\s+[\d,]+/i,             // "deduct 500"
    /^[\d,]+\s+(?:credit|advance|loan|qarz)$/i,     // "500 credit"
    /^[\d,]+\s+(?:ka|ki|ke)?\s*(?:entry|daalo|add|record)$/i, // "5000 daalo"
  ];

  function isFollowUp(text) {
    var t = (text || '').trim();
    if (!t || t.length > 80) return false;
    var conf = getConfidence();
    if (conf < 20) return false;   // context too stale
    return _FOLLOW_UP_PATTERNS.some(function(p){ return p.test(t); });
  }

  /* ──────────────────────────────────────────────────────────────────
     FOLLOW-UP RESOLUTION
     Tries to turn a context-dependent short phrase into a full intent.
     Returns {text, intent, requiresConfirm} or null.
  ────────────────────────────────────────────────────────────────── */
  function resolveFollowUp(text) {
    var t = (text || '').trim();
    if (!t) return null;
    var conf = getConfidence();
    if (conf < 20) return null;

    var c     = get();
    var emp   = c.employee;
    var sec   = c.section;
    var last  = c.lastAction;
    var today = (function() {
      if (typeof _aiTodayStr === 'function') return _aiTodayStr();
      var d = new Date(), M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return String(d.getDate()).padStart(2,'0') + '-' + M[d.getMonth()] + '-' + d.getFullYear();
    }());

    /* ── Pure number → credit/section/salary entry ── */
    var numMatch = t.match(/^(?:another\s+)?([\d,]+)\s*(?:rupees?|pkr|rs\.?)?$/i);
    if (numMatch) {
      var amount = parseInt(numMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(amount) && amount > 0) {

        // Credit context: employee + (section=credit OR last action=credit)
        var isCreditCtx = (sec && /credit/i.test(sec.id)) ||
          (last && /addCredit|credit/i.test(last.intentAction));
        if (emp && isCreditCtx) {
          return {
            text: '✅ Adding credit <b>₨' + amount.toLocaleString('en-PK') + '</b> for <b>' + emp.name + '</b> <span style="color:#64748b;font-size:11px">(from context · ' + conf + '% conf)</span>',
            intent: { action: 'addCredit', params: [emp.name, amount, 'credit', today], groupId: 'payroll', groupName: 'Payroll & Credits', shortcut: '💵 Ledger' },
            requiresConfirm: false,
          };
        }

        // Expense context
        var isExpCtx = sec && /expense/i.test(sec.id);
        if (isExpCtx) {
          var expDesc = (last && last.intentAction === 'addExpense' && last.params[1]) || 'Expense';
          return {
            text: '✅ Adding expense <b>₨' + amount.toLocaleString('en-PK') + '</b> (<b>' + expDesc + '</b>) <span style="color:#64748b;font-size:11px">(from context · ' + conf + '% conf)</span>',
            intent: { action: 'addExpense', params: [today, expDesc, amount, 0, 0, 0, 0, 0], groupId: 'expenses' },
            requiresConfirm: false,
          };
        }

        // Custom section context
        var isSecCtx = sec && sec.id && !/^(credit|expense|petty|salary|generic|incentive|staff|tools)$/.test(sec.id);
        if (isSecCtx) {
          var desc2 = (last && last.params[3]) || '';
          return {
            text: '✅ Adding <b>₨' + amount.toLocaleString('en-PK') + '</b> to <b>' + sec.label + '</b> <span style="color:#64748b;font-size:11px">(from context · ' + conf + '% conf)</span>',
            intent: { action: 'addCustomSectionRow', params: [sec.id, today, amount, desc2], groupId: 'records' },
            requiresConfirm: false,
          };
        }
      }
    }

    /* ── "another [amount]" → repeat last credit/expense ── */
    var anotherMatch = t.match(/^another\s+([\d,]+)/i);
    if (anotherMatch && last && emp) {
      var aAmt = parseInt(anotherMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(aAmt) && aAmt > 0 && /addCredit/i.test(last.intentAction)) {
        return {
          text: '✅ Adding another credit <b>₨' + aAmt.toLocaleString('en-PK') + '</b> for <b>' + emp.name + '</b>',
          intent: { action: 'addCredit', params: [emp.name, aAmt, 'credit', today], groupId: 'payroll' },
          requiresConfirm: false,
        };
      }
    }

    /* ── "same" / "again" → repeat last action ── */
    if (/^(?:same|again|repeat)$/i.test(t) && last && last.params.length) {
      return {
        text: '🔁 Repeating: <b>' + last.text + '</b>',
        intent: { action: last.intentAction, params: last.params },
        requiresConfirm: true,
      };
    }

    /* ── Balance / credit check ── */
    if (/^(?:balance|kitna|baqi|check|dekho|batao|show|kitna hai)[\s?]*$/i.test(t) && emp) {
      var balResult = null;
      try {
        if (typeof _aiReadCreditBalance === 'function') balResult = _aiReadCreditBalance(emp.name);
      } catch(_) {}
      if (balResult) {
        return { text: balResult, intent: null };
      }
      return {
        text: '📊 Checking balance for <b>' + emp.name + '</b>… <span style="color:#64748b;font-size:11px">(from context)</span>',
        intent: { action: 'switchMgrTab', params: ['credit'], groupId: 'payroll' },
        requiresConfirm: false,
      };
    }

    /* ── Pronoun "uska", "his" → replace with employee name ── */
    var pronounMatch = t.match(/^(?:uska|uski|his|her|their)\s+(.+)/i);
    if (pronounMatch && emp) {
      // Return enriched text for re-processing (caller should re-send as normal query)
      return {
        _rewrite: emp.name + ' ' + pronounMatch[1],
        text: null,
        intent: null,
      };
    }

    /* ── "deduct 500" / "minus 500" → negative credit ── */
    var deductMatch = t.match(/^(?:deduct|minus|less|kam|wapis)\s+([\d,]+)/i);
    if (deductMatch && emp) {
      var dAmt = parseInt(deductMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(dAmt) && dAmt > 0) {
        return {
          text: '✅ Deducting <b>₨' + dAmt.toLocaleString('en-PK') + '</b> from <b>' + emp.name + '</b>\'s credit',
          intent: { action: 'addCredit', params: [emp.name, -dAmt, 'deduction', today], groupId: 'payroll' },
          requiresConfirm: true,
        };
      }
    }

    /* ── "[amount] credit" (shorthand) ── */
    var shortCredit = t.match(/^([\d,]+)\s+(?:credit|advance|loan|qarz)$/i);
    if (shortCredit && emp) {
      var scAmt = parseInt(shortCredit[1].replace(/,/g, ''), 10);
      if (!isNaN(scAmt) && scAmt > 0) {
        return {
          text: '✅ Adding credit <b>₨' + scAmt.toLocaleString('en-PK') + '</b> for <b>' + emp.name + '</b>',
          intent: { action: 'addCredit', params: [emp.name, scAmt, 'credit', today] , groupId: 'payroll' },
          requiresConfirm: false,
        };
      }
    }

    return null;
  }

  /* ──────────────────────────────────────────────────────────────────
     CONTEXT-AWARE TEXT ENRICHMENT
     Prepends context hints to short ambiguous messages before they
     go to the LLM (so the LLM doesn't need to guess).
  ────────────────────────────────────────────────────────────────── */
  function enrichText(text) {
    var conf = getConfidence();
    if (conf < 30) return text;
    var c   = get();
    var emp = c.employee;
    var sec = c.section;
    var last = c.lastAction;
    var t   = (text || '').trim();

    // Only enrich very short, likely-ambiguous messages
    var words = t.split(/\s+/);
    if (words.length > 12) return text;

    var hints = [];
    if (emp)  hints.push('Current employee in focus: ' + emp.name);
    if (sec)  hints.push('Current section: ' + sec.label);
    if (last) hints.push('Last action was: ' + last.text);

    if (!hints.length) return text;
    return '[Context: ' + hints.join(' | ') + '] ' + text;
  }

  /* ──────────────────────────────────────────────────────────────────
     PROMPT BLOCK — injected into every LLM call (after instructions)
  ────────────────────────────────────────────────────────────────── */
  function buildPromptBlock() {
    var c    = get();
    var conf = getConfidence();
    if (conf === 0 && !c.employee && !c.section && !c.lastAction) return '';

    var lines = ['\n══════════ ACTIVE WORKING CONTEXT (use for follow-up resolution) ══════════'];
    if (conf > 0) lines.push('Context confidence: ' + conf + '% (decays over time)');

    if (c.employee) {
      lines.push('👤 Current employee in focus: ' + c.employee.name +
        ' (set ' + getAgeLabel(c.employee.setAt) + ' via ' + c.employee.via + ')');
      lines.push('  → If user says a number without naming anyone, it likely refers to ' + c.employee.name);
    }
    if (c.section) {
      lines.push('📁 Current section: ' + c.section.label + ' (' + c.section.id + ')');
    }
    if (c.page) {
      lines.push('📄 Current page: ' + c.page.label);
    }
    if (c.month) {
      lines.push('📅 Working month: ' + c.month.value);
    }
    if (c.lastAction) {
      lines.push('✅ Last action: ' + c.lastAction.text + ' (action: ' + c.lastAction.intentAction + ')');
      if (c.lastAction.intentAction === 'addCredit' && c.employee) {
        lines.push('  → "another [amount]" means add more credit for ' + c.employee.name);
        lines.push('  → "balance" or "kitna" means show ' + c.employee.name + "'s credit balance");
      }
    }

    lines.push('IMPORTANT: Use context to resolve pronouns (uska/his/her) and bare numbers without re-asking.');
    lines.push('══════════════════════════════════════════════════════════════════');
    return lines.join('\n');
  }

  /* ──────────────────────────────────────────────────────────────────
     PUBLIC SUMMARY (for UI display)
  ────────────────────────────────────────────────────────────────── */
  function getSummary() {
    var c    = get();
    var conf = getConfidence();
    return {
      employee:   c.employee,
      section:    c.section,
      page:       c.page,
      month:      c.month,
      lastAction: c.lastAction,
      confidence: conf,
      isEmpty:    !c.employee && !c.section && !c.lastAction,
    };
  }

  /* ──────────────────────────────────────────────────────────────────
     EXPORT
  ────────────────────────────────────────────────────────────────── */
  return {
    setEmployee:      setEmployee,
    setSection:       setSection,
    pinGroup:         pinGroup,
    setPage:          setPage,
    setMonth:         setMonth,
    setLastAction:    setLastAction,
    get:              get,
    getEmployee:      getEmployee,
    getSection:       getSection,
    getPage:          getPage,
    getMonth:         getMonth,
    getLastAction:    getLastAction,
    getConfidence:    getConfidence,
    getAgeLabel:      getAgeLabel,
    getSummary:       getSummary,
    clear:            clear,
    isFollowUp:       isFollowUp,
    resolveFollowUp:  resolveFollowUp,
    enrichText:       enrichText,
    updateFromIntent: updateFromIntent,
    buildPromptBlock: buildPromptBlock,
  };

}());
