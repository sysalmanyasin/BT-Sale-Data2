// ══════════════════════════════════════════════════════════════════════
// AIBridge v5 — Full Personal Assistant for Bahria Town Sales IC
//
// Groq (Llama 3.3 70B) is the permanent AI — no setup needed.
// Rule-based parsers run first for instant responses.
// Groq handles everything else — natural language, analytics, actions.
// ══════════════════════════════════════════════════════════════════════

// ── Groq Configuration ────────────────────────────────────────────────
const _AI_KEY_STORAGE = 'BT_Groq_Key_v1';
const _GROQ_MODEL     = 'llama-3.3-70b-versatile';
const _GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const _GROQ_ENDPOINT  = 'https://api.groq.com/openai/v1/chat/completions';

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
  'addCustomSectionRow', 'createCustomSection', 'deleteCustomSectionRow', 'deleteCustomSection',
  // Field Manager
  'openFieldManager', 'toggleFieldVisibility', 'addCustomField', 'resetAllFields',
  // Sync / Backup
  'pushToSupabase', 'pullFromSupabase', 'backupToDrive',
  // Month
  'switchMonth', 'copyManagerToNextMonth',
  // AI Memory / Rules / Section AI Config
  'addMemoryFact', 'deleteMemoryFact', 'addRule', 'deleteRule', 'setSectionAiConfig',
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
]);

// ── Date helpers ──────────────────────────────────────────────────────
function _aiTodayStr() {
  const d = new Date();
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2,'0') + '-' + M[d.getMonth()] + '-' + d.getFullYear();
}
function _aiCurrentMonthYear() {
  const d = new Date();
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}

// ── Staff fuzzy match ─────────────────────────────────────────────────
function _aiFuzzyStaff(rawName) {
  try {
    if (typeof STAFF === 'undefined' || !STAFF.length) return rawName;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(rawName);
    const hit  = STAFF.filter(s => s.active !== false).find(s => {
      const n = norm(s.name);
      return n === t || n.includes(t) || t.includes(n);
    });
    return hit ? hit.name : rawName;
  } catch (_) { return rawName; }
}

function _aiFuzzyStaffIndex(rawName) {
  try {
    if (typeof STAFF === 'undefined' || !STAFF.length) return -1;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(rawName);
    return STAFF.findIndex(s => {
      const n = norm(s.name);
      return n === t || n.includes(t) || t.includes(n);
    });
  } catch (_) { return -1; }
}

// ── Field alias map ───────────────────────────────────────────────────
const _AI_FIELD_ALIASES = {
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
function _aiResolveField(rawField) {
  const k = (rawField || '').trim().toLowerCase();
  return _AI_FIELD_ALIASES[k] || rawField;
}

// ══════════════════════════════════════════════════════════════════════
// RULE-BASED PARSERS (instant — no API call needed)
// ══════════════════════════════════════════════════════════════════════

function _aiParseCreditCommand(text) {
  const t = text.trim();
  const pats = [
    /(?:note|add|record|enter|log|do)?\s*(?:credit|advance|loan|qarz)\s+(?:of\s+)?(\d[\d,]*)\s+(?:for|to|ko)\s+(.+)/i,
    /(?:note|add|record|enter|log|do)?\s*(?:credit|advance|loan|qarz)\s+(?:for|to|ko)\s+(.+?)\s+(?:of\s+)?(\d[\d,]*)/i,
    /^([a-zA-Z\u0600-\u06FF ]+?)\s+(?:ko|ka)?\s*(?:credit|advance|loan|qarz)\s+(?:of\s+)?(\d[\d,]*)/i,
    /^(\d[\d,]*)\s+(?:credit|advance|loan)\s+(?:for|to|ko)\s+(.+)/i,
    /(.+?)\s+(?:ko)\s+(\d[\d,]*)\s+(?:credit|advance|loan|qarz)/i,
  ];
  for (let pi = 0; pi < pats.length; pi++) {
    const m = t.match(pats[pi]);
    if (!m) continue;
    let rawName, rawAmt;
    if (pi === 0 || pi === 3) { rawAmt = m[1]; rawName = m[2]; }
    else if (pi === 1)         { rawName = m[1]; rawAmt = m[2]; }
    else if (pi === 2)         { rawName = m[1]; rawAmt = m[2]; }
    else                       { rawName = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    const name   = (rawName || '').trim();
    if (!name || isNaN(amount) || amount <= 0) continue;
    const matchedName = _aiFuzzyStaff(name);
    const amtFmt = Math.round(amount).toLocaleString('en-PK');
    return {
      text: '\u2705 Adding credit \u20a8' + amtFmt + ' for <b>' + matchedName + '</b> today (' + _aiTodayStr() + ').',
      intent: { action: 'addCredit', params: [matchedName, Math.round(amount), 'credit', _aiTodayStr()] },
    };
  }
  return null;
}

function _aiParseCreditQuery(text) {
  const pats = [
    /(.+?)(?:'s|ka|ki)?\s+(?:credit|advance|balance|baqi|kitna|kya|udhaar)(?:\s+kitna|\s+kya|\s+hai|\s+check|\s+batao|\s+dekho)?/i,
    /(?:what(?:'s|\s+is)|check|show|batao|dekho|tell me)\s+(.+?)(?:'s|ka|ki)?\s+(?:credit|balance|advance|udhaar)/i,
    /(?:credit|balance|advance|udhaar)\s+(?:of|for|ka)\s+(.+)/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const matchedName = _aiFuzzyStaff(name);
    const result = _aiReadCreditBalance(matchedName);
    if (result) return { text: result, intent: null };
  }
  return null;
}

function _aiReadCreditBalance(name) {
  try {
    let crdData = (typeof _crdData_cur !== 'undefined' && _crdData_cur && _crdData_cur.length)
      ? _crdData_cur : null;
    if (!crdData && typeof mgrLoad === 'function') {
      const d = mgrLoad();
      if (d && d.credit) {
        const months = Object.keys(d.credit);
        if (months.length) crdData = d.credit[months[months.length - 1]];
      }
    }
    if (!crdData || !crdData.length) return null;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(name);
    const emp  = crdData.find(e => { const n = norm(e.name); return n === t || n.includes(t) || t.includes(n); });
    if (!emp) return null;
    const nv     = v => Math.round(Number(v) || 0);
    const total  = emp.entries.reduce((s, e) => s + nv(e.amount), 0);
    const net    = nv(emp.prevBal) + total - nv(emp.salary) - nv(emp.lessGeneric);
    const absAmt = Math.abs(net).toLocaleString('en-PK');
    let status;
    if (net > 0)      status = '<b>' + emp.name + '</b> owes <b>\u20a8' + absAmt + '</b> (credit outstanding).';
    else if (net < 0) status = '<b>' + emp.name + '</b> has <b>\u20a8' + absAmt + '</b> over-settled.';
    else              status = '<b>' + emp.name + '</b> is fully settled \u2014 zero balance.';
    const recent = emp.entries.slice(-3).map(e => '\u2022 ' + e.date + ': ' + (e.desc || '?') + ' \u20a8' + Math.abs(nv(e.amount)).toLocaleString('en-PK')).join('<br>');
    return status + (recent ? '<br><em style="font-size:11px;color:var(--muted)">Recent:</em><br>' + recent : '');
  } catch (_) { return null; }
}

function _aiParseExpenseCommand(text) {
  const expPats = [
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(?:for\s+)?(.+?)\s+(?:of\s+)?(\d[\d,]*)/i,
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(\d[\d,]*)\s+(?:for\s+)?(.+)/i,
  ];
  for (let pi = 0; pi < expPats.length; pi++) {
    const m = text.match(expPats[pi]);
    if (!m) continue;
    let desc, rawAmt;
    if (pi === 1) { rawAmt = m[1]; desc = m[2]; }
    else          { desc = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    desc = (desc || '').trim();
    if (!desc || isNaN(amount) || amount <= 0) continue;
    const dl = desc.toLowerCase();
    let bill = 0, fuel = 0, soap = 0, refresh = 0, extra = 0;
    if (/bill|bijli|electric|water|gas|utility/.test(dl))        bill    = Math.round(amount);
    else if (/fuel|petrol|diesel|oil/.test(dl))                  fuel    = Math.round(amount);
    else if (/soap|tissue|clean|washing/.test(dl))               soap    = Math.round(amount);
    else if (/tea|chai|refresh|lunch|food|khana|snack/.test(dl)) refresh = Math.round(amount);
    else                                                          extra   = Math.round(amount);
    return {
      text: '\u2705 Adding expense: <b>' + desc + ' \u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'addExpense', params: [_aiTodayStr(), desc, bill, fuel, soap, refresh, extra, 0] },
    };
  }
  return null;
}

function _aiParsePettyCommand(text) {
  const pats = [
    /(?:add|note|record|enter)?\s*(?:patty|petty)\s+(?:detail|item|cash)?\s+(?:item\s+)?(.+?)\s+(\d[\d,]*)/i,
    /(?:add|note|record|enter)?\s*(?:patty|petty)\s+(\d[\d,]*)\s+(?:for\s+)?(.+)/i,
  ];
  for (let pi = 0; pi < pats.length; pi++) {
    const m = text.match(pats[pi]);
    if (!m) continue;
    let desc, rawAmt;
    if (pi === 1) { rawAmt = m[1]; desc = m[2]; }
    else          { desc = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    desc = (desc || '').trim();
    if (!desc || isNaN(amount) || amount <= 0) continue;
    return {
      text: '\u2705 Adding petty item: <b>' + desc + ' \u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'addPettyItem', params: [desc, Math.round(amount), ''] },
    };
  }
  return null;
}

function _aiParseDailyFieldCommand(text) {
  for (const [alias, fieldId] of Object.entries(_AI_FIELD_ALIASES)) {
    const patterns = [
      new RegExp('(?:set|enter|add|note|fill)?\\s*' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?:of\\s+)?(\\d[\\d,]*)', 'i'),
      new RegExp('(\\d[\\d,]*)\\s+(?:in\\s+|for\\s+)?' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (!m) continue;
      const amount = Number(String(m[1] || 0).replace(/,/g, ''));
      if (isNaN(amount)) continue;
      return {
        text: '\u2705 Going to Daily Entry \u2014 setting <b>' + alias + '</b> to <b>\u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
        intent: { action: 'setDailyField', params: [fieldId, Math.round(amount)] },
      };
    }
  }
  return null;
}

function _aiParseCustomSectionCommand(text) {
  const t = text.trim();
  const amtMatch = t.match(/(-?\d[\d,]*)\s*(?:rs|rupees|₨)?\s*$/i) || t.match(/(?:rs|rupees|₨)\s*(-?\d[\d,]*)/i);
  if (!amtMatch) return null;
  const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
  if (!amount) return null;

  let all;
  try { all = JSON.parse(localStorage.getItem('mw_custom_sections_v1') || '{}'); } catch (_) { return null; }
  const ids = Object.keys(all);
  if (!ids.length) return null;

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tNorm = norm(t.replace(amtMatch[0], ''));
  if (!tNorm) return null;

  let best = null, bestScore = 0;
  ids.forEach(function (id) {
    const name = all[id].name || '';
    const words = norm(name).split(' ').filter(Boolean);
    if (!words.length) return;
    const hits = words.filter(function (w) { return tNorm.includes(w); }).length;
    const score = hits / words.length;
    if (score > bestScore) { bestScore = score; best = id; }
  });
  if (!best || bestScore < 0.6) return null;

  const secName = all[best].name;
  // LLM prompt specifies DD/Mon/YYYY (slash) for addCustomSectionRow — use BTDate.today().
  const today   = (typeof BTDate !== 'undefined') ? BTDate.today() : _aiTodayStr();
  return {
    text: '\u2705 Adding \u20a8' + Math.abs(amount).toLocaleString('en-PK') + ' to <b>' + secName + '</b>.',
    intent: { action: 'addCustomSectionRow', params: [secName, today, amount, ''] },
  };
}

function _aiParseNavCommand(text) {
  const t = text.toLowerCase().trim();
  const isNavPhrase = /^(open|go to|goto|show|switch to|navigate to|take me to|jao|kholo)\b/.test(t) ||
                       t.split(/\s+/).filter(Boolean).length <= 4;
  if (!isNavPhrase) return null;

  const pages = {
    dashboard: ['dashboard','home','ghar','main','summary'],
    index:     ['index','month index','all months'],
    data:      ['data','daily data','records','daily records'],
    entry:     ['entry','add entry','daily entry','enter data','data entry'],
    report:    ['report','sale report','sales report','monthly report'],
    diff:      ['diff','diff report','difference'],
    tools:     ['tools','settings page','supabase'],
    manager:   ['manager','mgr','management'],
  };
  for (const [page, keywords] of Object.entries(pages)) {
    if (keywords.some(kw => t.includes(kw))) {
      return {
        text: '\u2192 Opening <b>' + page.charAt(0).toUpperCase() + page.slice(1) + '</b>.',
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

// ── Target commands ───────────────────────────────────────────────────
function _aiParseTargetCommand(text) {
  const t = text.toLowerCase().trim();
  // Set target: "set target for June 2026 to 5000000" / "target June 2026 50 lakh"
  const setMatch = text.match(/(?:set|add|update)?\s*target\s+(?:for\s+)?([a-z]+ \d{4})\s+(?:to\s+|=\s*|:?\s*)(\d[\d,.]*\s*(?:lakh|lac)?)/i);
  if (setMatch) {
    let rawAmt = setMatch[2].trim().toLowerCase();
    let amount = parseFloat(rawAmt.replace(/,/g,''));
    if (/lakh|lac/.test(rawAmt)) amount *= 100000;
    if (isNaN(amount) || amount <= 0) return null;
    const mon = setMatch[1].trim();
    return {
      text: '\u2705 Setting monthly target for <b>' + mon + '</b> to <b>\u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'setMonthTarget', params: [mon, Math.round(amount)] },
    };
  }
  // Delete target
  const delMatch = text.match(/(?:delete|remove|clear)\s+target\s+(?:for\s+)?([a-z]+ \d{4})/i);
  if (delMatch) {
    const mon = delMatch[1].trim();
    return {
      text: '\u26a0\ufe0f Delete target for <b>' + mon + '</b>?',
      intent: { action: 'deleteMonthTarget', params: [mon] },
      requiresConfirm: true,
    };
  }
  return null;
}

// ── Sync commands ─────────────────────────────────────────────────────
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

  let staffList = '';
  try {
    if (typeof STAFF !== 'undefined' && STAFF.length) {
      const names = STAFF.filter(function(s){ return s.active !== false; }).map(function(s){ return s.name; }).filter(Boolean);
      if (names.length) staffList = '\nACTIVE STAFF: ' + names.join(', ');
    }
  } catch (_) {}

  let customSections = '';
  try {
    const all  = JSON.parse(localStorage.getItem('mw_custom_sections_v1') || '{}');
    const secs = Object.entries(all).map(function(e){ return e[1].emoji + ' ' + e[1].name + ' (id:' + e[0] + ')'; }).join(', ');
    if (secs) customSections = '\nCUSTOM SECTIONS IN MANAGER: ' + secs;
  } catch (_) {}

  let ctx = '';
  try {
    // If DAILY/MONTHLY are empty, attempt a silent Supabase pull first
    const _hasDat = (typeof MONTHLY !== 'undefined' && MONTHLY && MONTHLY.length > 0);
    if (!_hasDat && typeof pullFromSupabase === 'function') {
      pullFromSupabase(true).catch(function(){});
    }
    const snap = (typeof getAppContextSummary === 'function') ? getAppContextSummary({ fullMonths: 'all' }) : null;
    if (snap) ctx = '\nDATA SNAPSHOT:\n' + snap;
    else if (!_hasDat) ctx = '\nDATA SNAPSHOT: No data loaded yet. Supabase pull triggered — user should retry in a moment.';
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
    const mgrKey = Object.keys(localStorage).find(function(k){ return k.startsWith('mw_mgr_') || k === 'mw_manager'; });
    if (mgrKey) {
      const mgr  = JSON.parse(localStorage.getItem(mgrKey) || '{}');
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
    '• switchMgrTab → params: ["salary"|"generic"|"expense"|"credit"|"petty"|"incentive"|"staff"]',
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
    'ADD EXPENSE → addExpense  params: ["DD-Mon-YYYY","desc",bill,fuel,soap,refresh,extra,pattyHO]',
    'EDIT EXPENSE ROW → editExpenseRow  requiresConfirm: true  params: [rowIndex,"field",value]  fields: date|desc|bill|fuel|soap|refresh|extra|pattyHO',
    'DELETE EXPENSE ROW → deleteExpenseRow  requiresConfirm: true  params: [rowIndex]',
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
    'ADD ROW → addCustomSectionRow  params: ["sectionName","'+today+'",amount,"notes"]',
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
    '4. "Jazz Cash" without "daily entry" → addCustomSectionRow (not setDailyField).',
    '5. Multi-field day fill → saveNewDailyEntry (not multiple setDailyField calls).',
    '6. Always set requiresConfirm:true for any delete/destructive action.',
    '7. Answer in same language mix as user (English/Urdu mix fine).',
    '8. Never make up data — only use DATA SNAPSHOT or CURRENT ENTRY.',
    '9. Keep "text" concise (max 180 words). Use <b>bold</b> for numbers/names.',
    '10. For edits/deletes, always tell user WHAT will change so they can confirm.',
    '',
    'USER INPUT: ' + question,
  ];
  return lines.filter(function(l){ return l !== null && l !== undefined; }).join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// GROQ API CALLER
// ══════════════════════════════════════════════════════════════════════
async function _callGroq(question) {
  const apiKey = getAiSettings().apiKey;
  if (!apiKey) throw new Error('No Groq API key set. Tap the ⚙ gear in the AI page to add yours.');
  const res = await fetch(_GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: _GROQ_MODEL,
      messages: [{ role: 'user', content: _buildLlmPrompt(question) }],
      max_tokens: 700,
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error('Groq ' + res.status + ': ' + ((e.error && e.error.message) || res.statusText));
  }
  const data = await res.json();
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq returned an empty response.');
  return _parseLlmResponse(raw);
}

// ══════════════════════════════════════════════════════════════════════
// GROQ VISION CALLER
// ══════════════════════════════════════════════════════════════════════
async function _callGroqVision(base64DataUrl, extraNote) {
  const apiKey = getAiSettings().apiKey;
  if (!apiKey) throw new Error('No Groq API key set. Tap the ⚙ gear in the AI page to add yours.');

  const sysPrompt = [
    'You read photos of handwritten/printed closing sheets, credit registers, receipts, or WhatsApp chat screenshots',
    'for a petrol station / retail business, and extract every distinct entry you can find.',
    '',
    'Return ONLY a JSON object, no markdown, no commentary, in this exact shape:',
    '{"entries":[{"name":"person or client name (or empty)","amount":1234,"description":"short description / item / context","type":"credit|expense|petty|cash|other"}]}',
    '',
    '• "amount" must be a plain number (no commas, no currency symbol).',
    '• "type":"credit" for money owed by/lent to a person or client.',
    '• "type":"expense" for money spent (electricity, repairs, salary, etc).',
    '• "type":"petty" for small day-to-day petty-cash items.',
    '• "type":"cash" for a plain cash/sale figure with no clear person/category.',
    '• If unsure, use "other".',
    '• Skip totals/subtotal lines — only list individual entries.',
    '• If a line has no amount, skip it.',
    extraNote ? ('• Extra context from user: ' + extraNote) : null,
  ].filter(Boolean).join('\n');

  const res = await fetch(_GROQ_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: _GROQ_VISION_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: [
            { type: 'text', text: 'Extract all entries from this image as JSON.' },
            { type: 'image_url', image_url: { url: base64DataUrl } },
          ] },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error('Groq ' + res.status + ': ' + ((e.error && e.error.message) || res.statusText));
  }
  const data = await res.json();
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq returned an empty response.');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch (_) { throw new Error('Could not parse AI response. Try a clearer photo.'); }
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return entries
    .map(function (e) {
      return {
        name: (e.name || '').toString().trim(),
        amount: parseFloat(String(e.amount || '0').replace(/,/g, '')) || 0,
        description: (e.description || '').toString().trim(),
        type: ['credit','expense','petty','cash','other'].includes(e.type) ? e.type : 'other',
      };
    })
    .filter(function (e) { return e.amount > 0; });
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
      // Enrich short ambiguous messages before LLM so it understands context
      if (AIContext.isFollowUp(text)) {
        text = AIContext.enrichText(text);
      }
    }

    // Persistent memory / custom rules / correction-training commands — instant, no Groq.
    if (typeof aimHandleChatCommand === 'function') {
      const memHit = aimHandleChatCommand(text, window._aiLastIntent || null);
      if (memHit) return memHit;
    }

    const creditCmd  = _aiParseCreditCommand(text);     if (creditCmd)  return creditCmd;
    const creditQry  = _aiParseCreditQuery(text);       if (creditQry)  return creditQry;
    const expenseCmd = _aiParseExpenseCommand(text);    if (expenseCmd) return expenseCmd;
    const pettyCmd   = _aiParsePettyCommand(text);      if (pettyCmd)   return pettyCmd;
    const fieldCmd   = _aiParseDailyFieldCommand(text); if (fieldCmd)   return fieldCmd;
    const csecCmd    = _aiParseCustomSectionCommand(text); if (csecCmd) return csecCmd;
    const printCmd   = _aiParsePrintCommand(text);      if (printCmd)   return printCmd;
    const navCmd     = _aiParseNavCommand(text);        if (navCmd)     return navCmd;
    const tgtCmd     = _aiParseTargetCommand(text);     if (tgtCmd)     return tgtCmd;
    const syncCmd    = _aiParseSyncCommand(text);       if (syncCmd)    return syncCmd;
    const clearCmd   = _aiParseClearCommand(text);      if (clearCmd)   return clearCmd;
    const analytics  = _aiDeepSalesAnalysis(text);      if (analytics)  return { text: analytics, intent: null };

    try {
      const result = await _callGroq(text);
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

function _aiAddCreditEntry(rawName, rawAmount, rawDesc, rawDate) {
  const amount  = Math.round(Number(rawAmount) || 0);
  const desc    = rawDesc  || 'credit';
  const dateStr = rawDate  || _aiTodayStr();
  const norm    = s => (s || '').trim().toLowerCase();
  const target  = norm(rawName);
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined' || !_crdData_cur) {
        if (typeof toast === 'function') toast('\u26a0 Credit data not loaded — try again.', 'w'); return;
      }
      const ei = _crdData_cur.findIndex(function (e) {
        const n = norm(e.name); return n === target || n.includes(target) || target.includes(n);
      });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + rawName + '" not found in Credit sheet.', 'w'); return; }
      _crdData_cur[ei].entries.push({ date: dateStr, desc: desc, amount: amount });
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      setTimeout(function () {
        const body = document.getElementById('crd-body-' + ei);
        const chev = document.getElementById('crd-chev-' + ei);
        if (body) body.style.display = '';
        if (chev) chev.style.transform = 'rotate(90deg)';
        const el = document.getElementById('crd-emp-' + ei);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.style.transition = 'box-shadow .4s'; el.style.boxShadow = '0 0 0 3px var(--green)'; setTimeout(function () { el.style.boxShadow = ''; }, 2200); }
        // Closed-loop: read back the new net balance
        const emp = _crdData_cur[ei];
        const nv = v => Math.round(Number(v) || 0);
        const newTotal = emp.entries.reduce((s, e) => s + nv(e.amount), 0);
        const newNet = nv(emp.prevBal) + newTotal - nv(emp.salary) - nv(emp.lessGeneric);
        if (typeof toast === 'function') toast('\u2705 Credit \u20a8' + amount.toLocaleString('en-PK') + ' added for ' + emp.name + ' \u2014 balance now \u20a8' + Math.abs(newNet).toLocaleString('en-PK') + (newNet > 0 ? ' owed' : ' settled') + '.');
      }, 120);
    }, 280);
  }, 280);
}

function _aiAddExpenseRow(date, desc, bill, fuel, soap, refresh, extra, pattyHO) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('expense');
    setTimeout(function () {
      if (typeof _expRows_cur === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Expense data not loaded — try again.', 'w'); return;
      }
      const row = {
        date: date || _aiTodayStr(), desc: desc || '',
        bill: Math.round(Number(bill)||0), fuel: Math.round(Number(fuel)||0),
        soap: Math.round(Number(soap)||0), refresh: Math.round(Number(refresh)||0),
        extra: Math.round(Number(extra)||0), pattyHO: Math.round(Number(pattyHO)||0),
      };
      _expRows_cur.push(row);
      if (typeof renderExpenseTable === 'function') renderExpenseTable(_expRows_cur);
      if (typeof saveExpenseData    === 'function') saveExpenseData();
      setTimeout(function () {
        const tbody = document.getElementById('exp-tbody');
        if (tbody) { const rows = tbody.querySelectorAll('tr'); if (rows.length) { const last = rows[rows.length-1]; last.scrollIntoView({behavior:'smooth',block:'center'}); last.style.transition='background .4s'; last.style.background='#eff6ff'; setTimeout(function(){last.style.background='';},2000); } }
        const total = row.bill+row.fuel+row.soap+row.refresh+row.extra;
        if (typeof toast === 'function') toast('\u2705 Expense added: '+(desc||'entry')+' \u20a8'+total.toLocaleString('en-PK')+' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

function _aiAddPettyItem(desc, amount, period) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Petty data not loaded — try again.', 'w'); return;
      }
      if (!_pettyData.groups) _pettyData.groups = [];
      if (!_pettyData.groups.length) _pettyData.groups.push({ period: period || _aiCurrentMonthYear(), rows: [] });
      const gi = _pettyData.groups.length - 1;
      _pettyData.groups[gi].rows.push({ desc: desc || '', amount: Math.round(Number(amount)||0) });
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData    === 'function') savePettyData();
      setTimeout(function () {
        const grp = document.getElementById('petty-grp-'+gi);
        if (grp) { grp.scrollIntoView({behavior:'smooth',block:'start'}); grp.style.transition='box-shadow .4s'; grp.style.boxShadow='0 0 0 3px var(--accent)'; setTimeout(function(){grp.style.boxShadow='';},2200); }
        if (typeof toast === 'function') toast('\u2705 Petty item: '+(desc||'item')+' \u20a8'+Math.round(Number(amount)||0).toLocaleString('en-PK')+' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

function _aiSetDailyField(fieldId, amount) {
  if (typeof showPage === 'function') showPage('entry');
  setTimeout(function () {
    const inp = document.getElementById('e-' + fieldId);
    if (!inp) { if (typeof toast === 'function') toast('\u26a0 Field "'+fieldId+'" not found.', 'w'); return; }
    inp.value = Math.round(Number(amount)||0);
    if (typeof calcTotal === 'function') calcTotal();
    inp.focus(); inp.select();
    inp.style.transition = 'background .4s'; inp.style.background = '#dbeafe';
    setTimeout(function(){inp.style.background='';},2500);
    if (typeof toast === 'function') toast('\u2705 '+fieldId+' set to \u20a8'+Math.round(Number(amount)||0).toLocaleString('en-PK')+'.');
  }, 350);
}

function _aiPrintMgrReport(type) {
  if (typeof showPage === 'function') showPage('manager');
  const fnMap = {
    credit:    function(){if(typeof switchMgrTab==='function')switchMgrTab('credit');setTimeout(function(){if(typeof printCreditReport==='function')printCreditReport();},300);},
    salary:    function(){if(typeof switchMgrTab==='function')switchMgrTab('salary');setTimeout(function(){if(typeof printSalaryReport==='function')printSalaryReport();},300);},
    generic:   function(){if(typeof switchMgrTab==='function')switchMgrTab('generic');setTimeout(function(){if(typeof printGenericReport==='function')printGenericReport();},300);},
    expense:   function(){if(typeof switchMgrTab==='function')switchMgrTab('expense');setTimeout(function(){if(typeof printExpenseReport==='function')printExpenseReport();},300);},
    petty:     function(){if(typeof switchMgrTab==='function')switchMgrTab('petty');setTimeout(function(){if(typeof printPettyReport==='function')printPettyReport();},300);},
    incentive: function(){if(typeof switchMgrTab==='function')switchMgrTab('incentive');setTimeout(function(){if(typeof printIncentiveReport==='function')printIncentiveReport();},300);},
    month:     function(){if(typeof printMonthReport==='function')printMonthReport();},
    year:      function(){if(typeof printYearlyReport==='function')printYearlyReport();},
  };
  setTimeout(function(){const fn=fnMap[type];if(fn)fn();},300);
}

function _aiAddCustomSectionRow(sectionName, desc, amount, notes) {
  const CSEC_KEY = 'mw_custom_sections_v1';
  const norm = s => (s || '').trim().toLowerCase();
  const t    = norm(sectionName);
  let all;
  try { all = JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'); } catch(_){ all={}; }

  const sid = Object.keys(all).find(k => {
    const n = norm(all[k].name);
    return n === t || n.includes(t) || t.includes(n);
  });

  if (!sid) {
    if (typeof toast === 'function') toast('\u26a0 Section "'+sectionName+'" not found. Create it first in Manager \u2192 C. New Sections.','w');
    return;
  }

  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    document.querySelectorAll('button,[data-tab]').forEach(function(el){
      const txt = (el.textContent || '').trim();
      if (txt.includes('New Section') || txt.includes('Custom') || (el.dataset && el.dataset.tab === 'csec')) el.click();
    });

    setTimeout(function () {
      const sel = document.getElementById('csec-month-sel') || document.getElementById('mgr-month-sel');
      const curMon = (sel && sel.value) ? sel.value : _aiCurrentMonthYear();

      if (!all[sid].months) all[sid].months = {};
      if (!all[sid].months[curMon]) all[sid].months[curMon] = [];
      all[sid].months[curMon].push({
        // Use slash-format date (DD/Mon/YYYY) to match LLM prompt spec and app conventions.
        desc:   desc   || ((typeof BTDate !== 'undefined') ? BTDate.today() : _aiTodayStr()),
        amount: parseFloat(amount) || 0,
        notes:  notes  || '',
      });
      localStorage.setItem(CSEC_KEY, JSON.stringify(all));

      if (typeof renderAllCustomSections === 'function') renderAllCustomSections();

      setTimeout(function () {
        const block = document.querySelector('.csec-block[data-sid="' + sid + '"]');
        if (block) {
          block.scrollIntoView({behavior:'smooth',block:'start'});
          block.style.transition='box-shadow .4s';
          block.style.boxShadow='0 0 0 3px var(--green)';
          setTimeout(function(){block.style.boxShadow='';},2500);
        }
        if (typeof toast === 'function') toast('\u2705 '+all[sid].name+': \u20a8'+Math.abs(parseFloat(amount)||0).toLocaleString('en-PK')+' added for '+(desc||_aiTodayStr())+' \u2014 saved.');
      }, 200);
    }, 350);
  }, 300);
}

// ══════════════════════════════════════════════════════════════════════
// NEW INTENT EXECUTORS
// ══════════════════════════════════════════════════════════════════════

function _aiSaveNewDailyEntry(isoDate, fields) {
  if (typeof showPage === 'function') showPage('entry');
  setTimeout(function () {
    // Fill date
    const dateEl = document.getElementById('e-date');
    if (dateEl) { dateEl.value = isoDate; if (typeof syncEntryMonthFromDate === 'function') syncEntryMonthFromDate(); }
    // Fill each field
    if (fields && typeof fields === 'object') {
      Object.entries(fields).forEach(function([fid, val]) {
        const inp = document.getElementById('e-' + fid);
        if (inp) {
          inp.value = Math.round(Number(val) || 0);
          inp.style.transition = 'background .3s';
          inp.style.background = '#dbeafe';
          setTimeout(function(){ inp.style.background = ''; }, 2000);
        }
      });
    }
    if (typeof calcTotal === 'function') calcTotal();
    setTimeout(function () {
      if (typeof saveEntry === 'function') saveEntry();
    }, 300);
  }, 350);
}

function _aiEditDailyEntry(date, monthYear, fieldId, newValue) {
  // Open the edit modal for that date/month, then set the field
  if (typeof showPage === 'function') showPage('data');
  setTimeout(function () {
    if (typeof openEditModal === 'function') openEditModal(date, monthYear);
    setTimeout(function () {
      const safeId = fieldId.replace(/[^a-z0-9]/gi, '_');
      const inp = document.getElementById('em-' + safeId);
      if (inp) {
        inp.value = newValue;
        inp.style.background = '#dbeafe';
        setTimeout(function(){ inp.style.background = ''; }, 2000);
        if (typeof editCalcTotal === 'function') editCalcTotal();
      }
      if (typeof saveEditModal === 'function') saveEditModal();
    }, 400);
  }, 350);
}

function _aiDeleteDailyEntry(date, monthYear) {
  try {
    if (typeof DAILY === 'undefined' || !DAILY) { if (typeof toast === 'function') toast('\u26a0 Data not loaded.', 'w'); return; }
    const di = DAILY.findIndex(function(d){ return d.Date === date && d.Month_Year === monthYear; });
    if (di === -1) { if (typeof toast === 'function') toast('\u26a0 Entry not found: ' + date, 'w'); return; }
    DAILY.splice(di, 1);
    if (typeof newEntries !== 'undefined') {
      const ni = newEntries.findIndex(function(d){ return d.Date === date && d.Month_Year === monthYear; });
      if (ni !== -1) newEntries.splice(ni, 1);
      localStorage.setItem('bt_entries', JSON.stringify(newEntries));
    }
    if (typeof recomputeMonthly === 'function') recomputeMonthly(monthYear);
    if (typeof renderEntryList === 'function') renderEntryList();
    if (typeof rebuildAll === 'function') rebuildAll();
    if (typeof toast === 'function') toast('\u2705 Entry for ' + date + ' deleted.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Delete failed: ' + e.message, 'w'); }
}

function _aiAddStaff(name, designation) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof STAFF === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Staff data not loaded.', 'w'); return; }
      const num = STAFF.length + 1;
      const sid = 'EMP-' + String(num).padStart(3, '0');
      const maxSr = STAFF.reduce(function(m, e){ return Math.max(m, Number(e.srNum) || 0); }, 0);
      STAFF.push({
        id: 'emp_' + Date.now(),
        staffId: sid,
        srNum: maxSr + 1,
        name: name || '',
        designation: designation || 'Salesman',
        fatherName: '', cnic: '', phone: '', address: '', bloodGroup: '',
        doj: new Date().toISOString().split('T')[0],
        active: true,
      });
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (name) setTimeout(function(){ if (typeof openStaffCard === 'function') openStaffCard(STAFF.length - 1); }, 200);
      if (typeof toast === 'function') toast('\u2705 Staff added: ' + (name || 'New Employee') + ' \u2014 ID: ' + sid);
    }, 280);
  }, 280);
}

function _aiDeactivateStaff(nameOrIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
      if (i === -1 || !STAFF[i]) { if (typeof toast === 'function') toast('\u26a0 Staff "' + nameOrIndex + '" not found.', 'w'); return; }
      STAFF[i].active = false;
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + STAFF[i].name + ' deactivated \u2014 they won\'t appear in new months.');
    }, 280);
  }, 280);
}

function _aiReactivateStaff(nameOrIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
      if (i === -1 || !STAFF[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
      STAFF[i].active = true;
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + STAFF[i].name + ' reactivated.');
    }, 280);
  }, 280);
}

function _aiDeleteStaff(nameOrIndex) {
  const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
  if (i === -1 || !STAFF[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
  const name = STAFF[i].name;
  STAFF.splice(i, 1);
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from staff list.');
    }, 280);
  }, 280);
}

function _aiEditStaffField(nameOrIndex, field, value) {
  const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
  if (i === -1 || !STAFF[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
  STAFF[i][field] = value;
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + STAFF[i].name + ' \u2014 ' + field + ' updated to: ' + value);
    }, 280);
  }, 280);
}

function _aiAddSalaryRow(name, designation, hoSal, advance, generic) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const _nowD = new Date();
      const _daysInMonth = new Date(_nowD.getFullYear(), _nowD.getMonth() + 1, 0).getDate();
      _salRows_cur.push({ name: name || '', desig: designation || 'Salesman', days: _daysInMonth, hoSal: Math.round(Number(hoSal)||0), advance: Math.round(Number(advance)||0), generic: Math.round(Number(generic)||0) });
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 Salary row added for ' + (name || 'new employee') + '.');
    }, 280);
  }, 280);
}

function _aiEditSalaryRow(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _salRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found in salary sheet.', 'w'); return; }
      _salRows_cur[i][field] = Math.round(Number(value) || 0);
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 ' + staffName + ' \u2014 ' + field + ' updated to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

function _aiDeleteSalaryRow(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _salRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _salRows_cur[i].name;
      _salRows_cur.splice(i, 1);
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from salary sheet.');
    }, 280);
  }, 280);
}

function _aiAddGenericRow(name, designation, genericSale, extra) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      _genRows_cur.push({ name: name || '', desig: designation || 'Salesman', genericSale: Math.round(Number(genericSale)||0), extra: Math.round(Number(extra)||0) });
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 Generic row added for ' + (name || 'new employee') + '.');
    }, 280);
  }, 280);
}

function _aiEditGenericRow(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _genRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found in generic sheet.', 'w'); return; }
      _genRows_cur[i][field] = Math.round(Number(value) || 0);
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 ' + staffName + ' generic ' + field + ' updated to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

function _aiDeleteGenericRow(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _genRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _genRows_cur[i].name;
      _genRows_cur.splice(i, 1);
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from generic sheet.');
    }, 280);
  }, 280);
}

function _aiDeleteExpenseRow(rowIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('expense');
    setTimeout(function () {
      if (typeof _expRows_cur === 'undefined' || !_expRows_cur[rowIndex]) { if (typeof toast === 'function') toast('\u26a0 Expense row not found.', 'w'); return; }
      const desc = _expRows_cur[rowIndex].desc;
      _expRows_cur.splice(rowIndex, 1);
      if (typeof renderExpenseTable === 'function') renderExpenseTable(_expRows_cur);
      if (typeof saveExpenseData === 'function') saveExpenseData();
      if (typeof toast === 'function') toast('\u2705 Expense row deleted: ' + desc);
    }, 280);
  }, 280);
}

function _aiAddCreditEmployee(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      _crdData_cur.push({ name: staffName || 'New Employee', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 });
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + (staffName || 'New employee') + ' added to credit ledger.');
    }, 280);
  }, 280);
}

function _aiDeleteCreditEntry(staffName, entryIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      if (!_crdData_cur[ei].entries[entryIndex]) { if (typeof toast === 'function') toast('\u26a0 Entry index out of range.', 'w'); return; }
      _crdData_cur[ei].entries.splice(entryIndex, 1);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 Credit entry deleted for ' + _crdData_cur[ei].name + '.');
    }, 280);
  }, 280);
}

function _aiDeleteCreditEmployee(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _crdData_cur[ei].name;
      _crdData_cur.splice(ei, 1);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from credit ledger.');
    }, 280);
  }, 280);
}

function _aiSetCreditEmpField(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      _crdData_cur[ei][field] = Math.round(Number(value) || 0);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + _crdData_cur[ei].name + ' ' + field + ' set to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

function _aiAddPettyGroup(period) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Petty data not loaded.', 'w'); return; }
      if (!_pettyData.groups) _pettyData.groups = [];
      _pettyData.groups.push({ period: period || _aiCurrentMonthYear(), rows: [] });
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty group added for ' + (period || _aiCurrentMonthYear()) + '.');
    }, 280);
  }, 280);
}

function _aiDeletePettyRow(groupIndex, rowIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined' || !_pettyData.groups || !_pettyData.groups[groupIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty group not found.', 'w'); return; }
      const rows = _pettyData.groups[groupIndex].rows;
      if (!rows || !rows[rowIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty row not found.', 'w'); return; }
      const desc = rows[rowIndex].desc;
      rows.splice(rowIndex, 1);
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty item deleted: ' + desc);
    }, 280);
  }, 280);
}

function _aiDeletePettyGroup(groupIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined' || !_pettyData.groups || !_pettyData.groups[groupIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty group not found.', 'w'); return; }
      const period = _pettyData.groups[groupIndex].period;
      _pettyData.groups.splice(groupIndex, 1);
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty group "' + period + '" deleted.');
    }, 280);
  }, 280);
}

function _aiSetMonthTarget(monthYear, amount) {
  try {
    const TGT_K = 'bt_targets';
    const t = (function(){ try{return JSON.parse(localStorage.getItem(TGT_K)||'{}')}catch{return{}} })();
    t[monthYear] = Math.round(Number(amount) || 0);
    localStorage.setItem(TGT_K, JSON.stringify(t));
    if (typeof renderTargetList === 'function') renderTargetList();
    if (typeof buildDashboard === 'function') buildDashboard();
    if (typeof renderIndex === 'function') renderIndex();
    if (typeof toast === 'function') toast('\u2705 Target for ' + monthYear + ' set to \u20a8' + Math.round(Number(amount)||0).toLocaleString('en-PK') + '.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to set target: ' + e.message, 'w'); }
}

function _aiDeleteMonthTarget(monthYear) {
  try {
    const TGT_K = 'bt_targets';
    const t = (function(){ try{return JSON.parse(localStorage.getItem(TGT_K)||'{}')}catch{return{}} })();
    delete t[monthYear];
    localStorage.setItem(TGT_K, JSON.stringify(t));
    if (typeof renderTargetList === 'function') renderTargetList();
    if (typeof buildDashboard === 'function') buildDashboard();
    if (typeof renderIndex === 'function') renderIndex();
    if (typeof toast === 'function') toast('\u2705 Target for ' + monthYear + ' deleted.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to delete target: ' + e.message, 'w'); }
}

function _aiCreateCustomSection(name, emoji) {
  try {
    const CSEC_KEY = 'mw_custom_sections_v1';
    let all;
    try { all = JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'); } catch(_){ all={}; }
    const sid = 'csec_' + Date.now();
    all[sid] = { name: name || 'New Section', emoji: emoji || '📋', months: {} };
    localStorage.setItem(CSEC_KEY, JSON.stringify(all));
    if (typeof showPage === 'function') showPage('manager');
    setTimeout(function(){
      document.querySelectorAll('button,[data-tab]').forEach(function(el){
        const txt = (el.textContent||'').trim();
        if (txt.includes('New Section')||txt.includes('Custom')||(el.dataset&&el.dataset.tab==='csec')) el.click();
      });
      setTimeout(function(){ if (typeof renderAllCustomSections === 'function') renderAllCustomSections(); }, 200);
    }, 300);
    if (typeof toast === 'function') toast('\u2705 Custom section "' + (emoji||'📋') + ' ' + name + '" created.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to create section: ' + e.message, 'w'); }
}

function _aiDeleteCustomSectionRow(sectionName, rowIndex) {
  const CSEC_KEY = 'mw_custom_sections_v1';
  let all;
  try { all = JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'); } catch(_){ all={}; }
  const norm = s => (s||'').trim().toLowerCase();
  const t    = norm(sectionName);
  const sid  = Object.keys(all).find(k => { const n=norm(all[k].name); return n===t||n.includes(t)||t.includes(n); });
  if (!sid) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  const sel = document.getElementById('csec-month-sel') || document.getElementById('mgr-month-sel');
  const curMon = (sel && sel.value) ? sel.value : _aiCurrentMonthYear();
  const rows = (all[sid].months && all[sid].months[curMon]) ? all[sid].months[curMon] : [];
  if (!rows[rowIndex]) { if (typeof toast === 'function') toast('\u26a0 Row index ' + rowIndex + ' not found.', 'w'); return; }
  const desc = rows[rowIndex].desc;
  rows.splice(rowIndex, 1);
  localStorage.setItem(CSEC_KEY, JSON.stringify(all));
  if (typeof renderAllCustomSections === 'function') renderAllCustomSections();
  if (typeof toast === 'function') toast('\u2705 Row deleted from ' + all[sid].name + ': ' + desc);
}

function _aiDeleteCustomSection(sectionName) {
  const CSEC_KEY = 'mw_custom_sections_v1';
  let all;
  try { all = JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'); } catch(_){ all={}; }
  const norm = s => (s||'').trim().toLowerCase();
  const t    = norm(sectionName);
  const sid  = Object.keys(all).find(k => { const n=norm(all[k].name); return n===t||n.includes(t)||t.includes(n); });
  if (!sid) { if (typeof toast === 'function') toast('\u26a0 Section "' + sectionName + '" not found.', 'w'); return; }
  const name = all[sid].name;
  delete all[sid];
  localStorage.setItem(CSEC_KEY, JSON.stringify(all));
  if (typeof renderAllCustomSections === 'function') renderAllCustomSections();
  if (typeof toast === 'function') toast('\u2705 Custom section "' + name + '" deleted.');
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

function _aiSwitchMonth(monthYear) {
  // Try all known month selects
  ['e-month','sal-month-sel','gen-month-sel','exp-month-sel','crd-month-sel','petty-month-sel','inc-month-sel','csec-month-sel'].forEach(function(id) {
    const sel = document.getElementById(id);
    if (sel) { sel.value = monthYear; sel.dispatchEvent(new Event('change')); }
  });
  if (typeof toast === 'function') toast('\u2192 Switched to ' + monthYear + '.');
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
      case 'addExpense':         _aiAddExpenseRow(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]); break;
      case 'editExpenseRow':     if(typeof showPage==='function')showPage('manager');setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab('expense');setTimeout(function(){if(typeof _expRows_cur!=='undefined'&&_expRows_cur[p[0]]){_expRows_cur[p[0]][p[1]]=p[2];if(typeof renderExpenseTable==='function')renderExpenseTable(_expRows_cur);if(typeof saveExpenseData==='function')saveExpenseData();if(typeof toast==='function')toast('\u2705 Expense row updated.');}},280);},280); break;
      case 'deleteExpenseRow':   _aiDeleteExpenseRow(p[0]); break;
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
    }
    // ── Update working context after every intent ──
    if (typeof AIContext !== 'undefined') {
      try { AIContext.updateFromIntent(intent); } catch(_) {}
    }
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 Action failed: ' + e.message, 'w');
  }
}
