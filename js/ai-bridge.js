// ══════════════════════════════════════════════════════════════════════
// AIBridge v3 — Universal voice-to-action for Bahria Town Sales IC
//
// Works WITHOUT a key: credit commands, expense/petty commands,
//   credit-balance queries, and navigation all work rule-based.
//
// Works WITH a key (Gemini or Groq in Settings): full natural-language
//   understanding — ANY sentence is parsed into an app action.
// ══════════════════════════════════════════════════════════════════════

// ── Safe intent whitelist ─────────────────────────────────────────────────
const AI_SAFE_INTENTS = new Set([
  'showPage',
  'switchMgrTab',
  'openDayModal',
  'openMonthModal',
  'printMonthReport',
  'printYearlyReport',
  'printMgrReport',
  'addCredit',
  'addExpense',
  'addPettyItem',
  'setDailyField',
]);

// ── Settings ──────────────────────────────────────────────────────────────
const AI_SETTINGS_KEY = 'bt_ai_settings';
function getAiSettings() {
  try { const r = localStorage.getItem(AI_SETTINGS_KEY); if (r) return JSON.parse(r); } catch (_) {}
  return { provider: 'gemini', apiKey: '' };
}
function saveAiSettings(s) { try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s)); } catch (_) {} }
function clearAiSettings() { try { localStorage.removeItem(AI_SETTINGS_KEY); } catch (_) {} }
function aiHasKey() { const s = getAiSettings(); return !!(s && s.apiKey && s.apiKey.trim()); }

// ── Date helper ───────────────────────────────────────────────────────────
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

// ── Staff fuzzy match ─────────────────────────────────────────────────────
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

// ── Field alias map (colloquial → form field ID) ──────────────────────────
// Lets users say "Jazz Cash", "HBL", "Meezan", "PSO", etc.
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
// RULE-BASED PARSERS (work without API key)
// ══════════════════════════════════════════════════════════════════════

// ── 1. Credit entry ───────────────────────────────────────────────────────
// "note credit 2500 for Kashif", "Ali ko 3000 advance do"
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

// ── 2. Credit balance query ───────────────────────────────────────────────
// "Kashif ka credit kitna hai", "what is Ali's balance"
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
    // Try in-memory first, then storage
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
    const n      = v => Math.round(Number(v) || 0);
    const total  = emp.entries.reduce((s, e) => s + n(e.amount), 0);
    const net    = n(emp.prevBal) + total - n(emp.salary) - n(emp.lessGeneric);
    const absAmt = Math.abs(net).toLocaleString('en-PK');
    let status;
    if (net > 0)      status = '<b>' + emp.name + '</b> owes <b>\u20a8' + absAmt + '</b> (credit outstanding).';
    else if (net < 0) status = '<b>' + emp.name + '</b> has <b>\u20a8' + absAmt + '</b> over-settled or credit returned.';
    else              status = '<b>' + emp.name + '</b> is fully settled \u2014 zero balance.';
    const recent = emp.entries.slice(-3).map(e => '\u2022 ' + e.date + ': ' + (e.desc || '?') + ' \u20a8' + Math.abs(n(e.amount)).toLocaleString('en-PK') + (n(e.amount) < 0 ? ' (deduction)' : '')).join('<br>');
    return status + (recent ? '<br><em style="font-size:11px;color:var(--muted)">Recent: </em><br>' + recent : '');
  } catch (_) { return null; }
}

// ── 3. Expense / Patty Cash row ───────────────────────────────────────────
// "add expense electricity 1200", "patty bill 500"
function _aiParseExpenseCommand(text) {
  // Expense types: bill, fuel, soap/tissue, refreshment, extra
  const expPats = [
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(?:for\s+)?(.+?)\s+(?:of\s+)?(\d[\d,]*)/i,
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(\d[\d,]*)\s+(?:for\s+)?(.+)/i,
    /(?:patty|petty)\s+(?:cash\s+)?(?:bill|fuel|soap|refresh|extra)\s+(.+?)\s+(\d[\d,]*)/i,
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
    // Determine expense category
    const dl = desc.toLowerCase();
    let bill = 0, fuel = 0, soap = 0, refresh = 0, extra = 0;
    if (/bill|bijli|electric|water|gas|utility/.test(dl))      bill = Math.round(amount);
    else if (/fuel|petrol|diesel|oil|gas/.test(dl))            fuel = Math.round(amount);
    else if (/soap|tissue|clean|washing/.test(dl))             soap = Math.round(amount);
    else if (/tea|chai|refresh|lunch|food|khana|snack/.test(dl)) refresh = Math.round(amount);
    else                                                         extra = Math.round(amount);
    const amtFmt = Math.round(amount).toLocaleString('en-PK');
    return {
      text: '\u2705 Adding expense: <b>' + desc + ' \u20a8' + amtFmt + '</b> \u2192 Expense sheet today.',
      intent: { action: 'addExpense', params: [_aiTodayStr(), desc, bill, fuel, soap, refresh, extra, 0] },
    };
  }
  return null;
}

// ── 4. Petty Detail item ──────────────────────────────────────────────────
// "add patty item tea 200", "petty detail soap 150"
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

// ── 5. Daily entry field setter ───────────────────────────────────────────
// "set Jazz Cash 5000", "HBL 12000", "enter MCB 8000"
function _aiParseDailyFieldCommand(text) {
  // Alias lookup
  for (const [alias, fieldId] of Object.entries(_AI_FIELD_ALIASES)) {
    const patterns = [
      new RegExp('(?:set|enter|add|note|fill)?\\s*' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?:of\\s+)?(\\d[\\d,]*)', 'i'),
      new RegExp('(\\d[\\d,]*)\\s+(?:in\\s+|for\\s+)?' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (!m) continue;
      const rawAmt = m[1];
      const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
      if (isNaN(amount)) continue;
      return {
        text: '\u2705 Navigating to Daily Entry \u2014 setting <b>' + alias + '</b> to <b>\u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
        intent: { action: 'setDailyField', params: [fieldId, Math.round(amount)] },
      };
    }
  }
  return null;
}

// ── 6. Navigation ─────────────────────────────────────────────────────────
// "go to dashboard", "manager kholo", "open report"
function _aiParseNavCommand(text) {
  const t = text.toLowerCase().trim();
  const pages = {
    dashboard: ['dashboard','home','ghar','main','summary'],
    index:     ['index','month index','all months'],
    data:      ['data','daily data','records','daily records'],
    entry:     ['entry','add entry','daily entry','enter data','data entry'],
    report:    ['report','sale report','sales report','monthly report'],
    diff:      ['diff','diff report','difference'],
    tools:     ['tools','settings page','supabase'],
    manager:   ['manager','mgr','management','salary','credit','expense','patty','petty','generic'],
  };
  for (const [page, keywords] of Object.entries(pages)) {
    if (keywords.some(kw => t.includes(kw))) {
      const label = page.charAt(0).toUpperCase() + page.slice(1);
      return {
        text: '\u2192 Opening <b>' + label + '</b> page.',
        intent: { action: 'showPage', params: [page] },
      };
    }
  }
  // Manager sub-tabs
  const tabs = {
    salary:    ['salary','salari','tankhwa'],
    generic:   ['generic','generic working','generic sale'],
    expense:   ['expense','patty cash','expense patty','kharcha'],
    credit:    ['credit ledger','credit sheet','credit tab','advances'],
    petty:     ['petty detail','petty','petty cash detail'],
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

// ── 7. Print commands ─────────────────────────────────────────────────────
function _aiParsePrintCommand(text) {
  const t = text.toLowerCase();
  if (!/print|report|chalao|nikalo/.test(t)) return null;
  const reportTypes = {
    credit:   ['credit report','credit sheet','credit ledger'],
    salary:   ['salary report','salary sheet','tankhwa'],
    generic:  ['generic report','generic working'],
    expense:  ['expense report','patty cash report','patty report'],
    petty:    ['petty detail report','petty report'],
    month:    ['monthly report','month report','sale report'],
    year:     ['yearly report','year report','annual report'],
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

// ══════════════════════════════════════════════════════════════════════
// LLM PROMPT BUILDER
// ══════════════════════════════════════════════════════════════════════
function _buildLlmPrompt(question) {
  const today    = _aiTodayStr();
  const curMonth = _aiCurrentMonthYear();

  // Staff names
  let staffList = '';
  try {
    if (typeof STAFF !== 'undefined' && STAFF.length) {
      const names = STAFF.filter(s => s.active !== false).map(s => s.name).filter(Boolean);
      if (names.length) staffList = '\nACTIVE STAFF: ' + names.join(', ');
    }
  } catch (_) {}

  // Sales snapshot
  let ctx = '';
  try {
    const snap = (typeof getAppContextSummary === 'function') ? getAppContextSummary({ fullMonths: 2 }) : null;
    if (snap) ctx = '\nDATA SNAPSHOT: ' + JSON.stringify(snap).slice(0, 3500);
  } catch (_) {}

  return `You are the AI command centre for "Bahria Town Sales IC" — a petrol station sales and staff management app.
The user speaks in plain language (English, Urdu, or mix). Your job: parse the request and return a JSON object.

RESPONSE FORMAT (strict JSON, no markdown, no code fences):
{"text":"<short confirmation or answer, max 120 words>","intent":null}
OR:
{"text":"<confirmation>","intent":{"action":"<ACTION>","params":[...]}}

TODAY: ${today}   CURRENT MONTH: ${curMonth}
${staffList}${ctx}

═══ ALL AVAILABLE ACTIONS ═══

NAVIGATION:
• showPage       → params: ["dashboard"|"index"|"data"|"entry"|"report"|"diff"|"tools"|"manager"]
  Trigger: "go to X", "open X", "X page dikhao"

• switchMgrTab   → params: ["salary"|"generic"|"expense"|"credit"|"petty"|"incentive"|"staff"]
  Trigger: "open salary sheet", "credit tab", "patty/petty section", "expense sheet"

REPORTS / MODALS:
• openDayModal   → params: ["DD/Mon/YYYY", "Month YYYY"]   Trigger: "open [date] day"
• openMonthModal → params: ["Month YYYY"]                   Trigger: "open [month] report"
• printMonthReport  → params: ["Month YYYY"]                Trigger: "print [month] report"
• printYearlyReport → params: ["YYYY"]                      Trigger: "print yearly report"
• printMgrReport    → params: ["credit"|"salary"|"generic"|"expense"|"petty"|"month"|"year"]
  Trigger: "print credit report", "salary sheet print karo"

STAFF CREDIT LEDGER:
• addCredit → params: ["EmployeeName", amountNumber, "description", "DD-Mon-YYYY"]
  Trigger: "credit 2500 for Kashif", "Ali ko advance 3000 do", "note credit of X for Y"
  Rules: match name to ACTIVE STAFF list; use today's date if not stated; amount is a positive integer.

EXPENSE / PATTY CASH (Manager → Expense tab):
• addExpense → params: ["DD-Mon-YYYY", "description", bill, fuel, soap, refresh, extra, pattyHO]
  All amounts are integers (₨). Only fill the relevant category; leave others 0.
  Categories: bill (electricity/gas/utilities), fuel (petrol/HO fuel), soap (cleaning),
              refresh (tea/food/refreshment), extra (anything else), pattyHO (Head Office received).
  Trigger: "add expense electricity 1200", "patty fuel 500", "note kharcha tea 150"

PETTY DETAIL (Manager → Petty tab):
• addPettyItem → params: ["description", amountNumber, "period (optional)"]
  Trigger: "add patty item soap 200", "petty detail tea 100", "petty 500 washing"

DAILY ENTRY FIELD FILL (Daily Entry form):
• setDailyField → params: ["fieldId", amountNumber]
  Field IDs: Cash_Sale, Cash_Returns, HBL, MCB, Alfala_Bank, Bank_Al_Habib,
             Meezan_Bank (= Jazz Cash / JazzCash / Paysa), Askari_Bank,
             PSO, NESPAK, PARCO, TEPA, LDA, Gourmet, BTH, Customers,
             FDPP, FDPP_Con, Load_Sale, Amount_Received, COMP_SALE
  Trigger: "Jazz Cash 5000", "set HBL to 12000", "MCB mein 8000 enter karo"
  Note: Navigate to entry page first; field will be pre-filled.

SALES QUERIES (answer as text, intent: null):
  Trigger: "total sales this month", "top client", "compare June vs May",
           "Kashif ka credit kitna hai", "unusual days", "forecast", "average"
  For credit balance: look up from DATA SNAPSHOT or say data not loaded.

═══ RULES ═══
1. Always match employee names to ACTIVE STAFF (fuzzy match).
2. If action needs Manager page first, still only return the specific intent — the handler navigates automatically.
3. For ambiguous commands: prefer the most specific action.
4. If the question is just a sales query (not an action), answer it from DATA SNAPSHOT and set intent: null.
5. Keep "text" concise and friendly — confirm what you're doing or answer the question.

USER INPUT: ${question}`;
}

// ══════════════════════════════════════════════════════════════════════
// LLM CALLERS
// ══════════════════════════════════════════════════════════════════════
async function _callGemini(apiKey, question) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: _buildLlmPrompt(question) }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.15 },
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error('Gemini ' + res.status + ': ' + ((e.error && e.error.message) || res.statusText)); }
  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini returned an empty response.');
  return _parseLlmResponse(raw);
}

async function _callGroq(apiKey, question) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: _buildLlmPrompt(question) }],
      max_tokens: 600,
      temperature: 0.15,
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error('Groq ' + res.status + ': ' + ((e.error && e.error.message) || res.statusText)); }
  const data = await res.json();
  const raw  = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq returned an empty response.');
  return _parseLlmResponse(raw);
}

function _parseLlmResponse(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.intent && !AI_SAFE_INTENTS.has(parsed.intent.action)) parsed.intent = null;
    return { text: parsed.text || cleaned, intent: parsed.intent || null };
  } catch (_) {
    return { text: cleaned, intent: null };
  }
}

// ══════════════════════════════════════════════════════════════════════
// MAIN BRIDGE
// ══════════════════════════════════════════════════════════════════════
async function aiBridgeAnswer(text) {
  try {
    // ── Rule-based parsers (no key required) ──────────────────────────
    const creditCmd  = _aiParseCreditCommand(text);   if (creditCmd)  return creditCmd;
    const creditQry  = _aiParseCreditQuery(text);     if (creditQry)  return creditQry;
    const expenseCmd = _aiParseExpenseCommand(text);  if (expenseCmd) return expenseCmd;
    const pettyCmd   = _aiParsePettyCommand(text);    if (pettyCmd)   return pettyCmd;
    const fieldCmd   = _aiParseDailyFieldCommand(text); if (fieldCmd) return fieldCmd;
    const printCmd   = _aiParsePrintCommand(text);    if (printCmd)   return printCmd;
    const navCmd     = _aiParseNavCommand(text);      if (navCmd)     return navCmd;

    // ── LLM (with key) ─────────────────────────────────────────────────
    const settings = getAiSettings();
    if (settings.apiKey && settings.apiKey.trim()) {
      try {
        return settings.provider === 'groq'
          ? await _callGroq(settings.apiKey.trim(), text)
          : await _callGemini(settings.apiKey.trim(), text);
      } catch (llmErr) {
        return {
          text: '\u26a0\ufe0f AI call failed: ' + llmErr.message + ' \u2014 falling back to built-in answers.',
          intent: null,
        };
      }
    }

    // ── Rule-based sales Q&A ────────────────────────────────────────────
    const reply = (typeof _aiAnswer === 'function')
      ? _aiAnswer(text)
      : 'Data not loaded yet. Please wait and try again.';
    return { text: reply, intent: null };

  } catch (err) {
    return { text: 'Sorry, I hit a snag (' + err.message + '). Please try again.', intent: null };
  }
}

// ══════════════════════════════════════════════════════════════════════
// INTENT EXECUTORS
// ══════════════════════════════════════════════════════════════════════

// ── addCredit ─────────────────────────────────────────────────────────────
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
        if (typeof toast === 'function') toast('\u2705 Credit \u20a8' + amount.toLocaleString('en-PK') + ' added for ' + _crdData_cur[ei].name + ' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

// ── addExpense ────────────────────────────────────────────────────────────
function _aiAddExpenseRow(date, desc, bill, fuel, soap, refresh, extra, pattyHO) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('expense');
    setTimeout(function () {
      if (typeof _expRows_cur === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Expense data not loaded — try again.', 'w'); return;
      }
      const row = {
        date:    date    || _aiTodayStr(),
        desc:    desc    || '',
        bill:    Math.round(Number(bill)    || 0),
        fuel:    Math.round(Number(fuel)    || 0),
        soap:    Math.round(Number(soap)    || 0),
        refresh: Math.round(Number(refresh) || 0),
        extra:   Math.round(Number(extra)   || 0),
        pattyHO: Math.round(Number(pattyHO) || 0),
      };
      _expRows_cur.push(row);
      if (typeof renderExpenseTable === 'function') renderExpenseTable(_expRows_cur);
      if (typeof saveExpenseData === 'function') saveExpenseData();
      setTimeout(function () {
        const tbody = document.getElementById('exp-tbody');
        if (tbody) { const rows = tbody.querySelectorAll('tr'); if (rows.length) { const last = rows[rows.length - 1]; last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.style.transition = 'background .4s'; last.style.background = '#eff6ff'; setTimeout(function () { last.style.background = ''; }, 2000); } }
        const total = row.bill + row.fuel + row.soap + row.refresh + row.extra;
        if (typeof toast === 'function') toast('\u2705 Expense added: ' + (desc || 'entry') + ' \u20a8' + total.toLocaleString('en-PK') + ' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

// ── addPettyItem ──────────────────────────────────────────────────────────
function _aiAddPettyItem(desc, amount, period) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Petty data not loaded — try again.', 'w'); return;
      }
      if (!_pettyData.groups) _pettyData.groups = [];
      // Use last group if exists, otherwise create one
      if (!_pettyData.groups.length) {
        _pettyData.groups.push({ period: period || _aiCurrentMonthYear(), rows: [] });
      }
      const gi = _pettyData.groups.length - 1;
      _pettyData.groups[gi].rows.push({ desc: desc || '', amount: Math.round(Number(amount) || 0) });
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      setTimeout(function () {
        const grp = document.getElementById('petty-grp-' + gi);
        if (grp) { grp.scrollIntoView({ behavior: 'smooth', block: 'start' }); grp.style.transition = 'box-shadow .4s'; grp.style.boxShadow = '0 0 0 3px var(--accent)'; setTimeout(function () { grp.style.boxShadow = ''; }, 2200); }
        if (typeof toast === 'function') toast('\u2705 Petty item added: ' + (desc || 'item') + ' \u20a8' + Math.round(Number(amount) || 0).toLocaleString('en-PK') + ' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

// ── setDailyField ─────────────────────────────────────────────────────────
function _aiSetDailyField(fieldId, amount) {
  if (typeof showPage === 'function') showPage('entry');
  setTimeout(function () {
    const inp = document.getElementById('e-' + fieldId);
    if (!inp) { if (typeof toast === 'function') toast('\u26a0 Field "' + fieldId + '" not found on this form.', 'w'); return; }
    inp.value = Math.round(Number(amount) || 0);
    // Trigger recalculation
    if (typeof calcTotal === 'function') calcTotal();
    inp.focus();
    inp.select();
    // Highlight the field
    inp.style.transition = 'background .4s';
    inp.style.background = '#dbeafe';
    setTimeout(function () { inp.style.background = ''; }, 2500);
    if (typeof toast === 'function') toast('\u2705 ' + fieldId + ' set to \u20a8' + Math.round(Number(amount) || 0).toLocaleString('en-PK') + '.');
  }, 350);
}

// ── printMgrReport ────────────────────────────────────────────────────────
function _aiPrintMgrReport(type) {
  // Navigate to manager first
  if (typeof showPage === 'function') showPage('manager');
  const fnMap = {
    credit:  function () { if (typeof switchMgrTab === 'function') switchMgrTab('credit');  setTimeout(function () { if (typeof printCreditReport  === 'function') printCreditReport();  }, 300); },
    salary:  function () { if (typeof switchMgrTab === 'function') switchMgrTab('salary');  setTimeout(function () { if (typeof printSalaryReport  === 'function') printSalaryReport();  }, 300); },
    generic: function () { if (typeof switchMgrTab === 'function') switchMgrTab('generic'); setTimeout(function () { if (typeof printGenericReport === 'function') printGenericReport(); }, 300); },
    expense: function () { if (typeof switchMgrTab === 'function') switchMgrTab('expense'); setTimeout(function () { if (typeof printExpenseReport === 'function') printExpenseReport(); }, 300); },
    petty:   function () { if (typeof switchMgrTab === 'function') switchMgrTab('petty');   setTimeout(function () { if (typeof printPettyReport   === 'function') printPettyReport();   }, 300); },
    month:   function () { if (typeof printMonthReport  === 'function') printMonthReport();  },
    year:    function () { if (typeof printYearlyReport === 'function') printYearlyReport(); },
  };
  setTimeout(function () { const fn = fnMap[type]; if (fn) fn(); }, 300);
}

// ── Master executor ───────────────────────────────────────────────────────
function aiBridgeExecuteIntent(intent) {
  if (!intent || !AI_SAFE_INTENTS.has(intent.action)) return;
  const p = intent.params || [];
  try {
    switch (intent.action) {
      case 'showPage':            if (typeof showPage      === 'function') showPage(p[0]);          break;
      case 'switchMgrTab':        if (typeof showPage      === 'function') showPage('manager');
                                  setTimeout(function () { if (typeof switchMgrTab === 'function') switchMgrTab(p[0]); }, 250); break;
      case 'openDayModal':        if (typeof openDayModal  === 'function') openDayModal(p[0], p[1]);break;
      case 'openMonthModal':      if (typeof openMonthModal=== 'function') openMonthModal(p[0]);    break;
      case 'printMonthReport':    if (typeof printMonthReport  === 'function') printMonthReport(p[0]);  break;
      case 'printYearlyReport':   if (typeof printYearlyReport === 'function') printYearlyReport(p[0]); break;
      case 'printMgrReport':      _aiPrintMgrReport(p[0]);   break;
      case 'addCredit':           _aiAddCreditEntry(p[0], p[1], p[2], p[3]); break;
      case 'addExpense':          _aiAddExpenseRow(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]); break;
      case 'addPettyItem':        _aiAddPettyItem(p[0], p[1], p[2]); break;
      case 'setDailyField':       _aiSetDailyField(p[0], p[1]); break;
    }
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 Action failed: ' + e.message, 'w');
  }
}
