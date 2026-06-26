// ══════════════════════════════════════════════════════════════════════
// AIBridge v4 — Groq-Powered Personal Assistant for Bahria Town Sales IC
//
// Groq (Llama 3.3 70B) is the permanent AI — no setup needed.
// Rule-based parsers run first for instant responses.
// Groq handles everything else — natural language, analytics, actions.
// ══════════════════════════════════════════════════════════════════════

// ── Permanent Groq Configuration ─────────────────────────────────────────
const _GROQ_KEY      = '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';
const _GROQ_MODEL    = 'llama-3.3-70b-versatile';
const _GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

function getAiSettings() {
  return { provider: 'groq', apiKey: _GROQ_KEY };
}
function saveAiSettings() {}
function clearAiSettings() {}
function aiHasKey() { return true; }

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
  'addCustomSectionRow',
]);

// ── Date helpers ──────────────────────────────────────────────────────────
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

// ── Field alias map ───────────────────────────────────────────────────────
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
    credit:  ['credit report','credit sheet','credit ledger'],
    salary:  ['salary report','salary sheet','tankhwa'],
    generic: ['generic report','generic working'],
    expense: ['expense report','patty cash report','patty report'],
    petty:   ['petty detail report','petty report'],
    month:   ['monthly report','month report','sale report'],
    year:    ['yearly report','year report','annual report'],
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
      const recent = D.slice(-30), vals = recent.map(d=>n(d.TOTAL));
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

  // ── Staff list ────────────────────────────────────────────────────
  let staffList = '';
  try {
    if (typeof STAFF !== 'undefined' && STAFF.length) {
      const names = STAFF.filter(function(s){ return s.active !== false; }).map(function(s){ return s.name; }).filter(Boolean);
      if (names.length) staffList = '\nACTIVE STAFF: ' + names.join(', ');
    }
  } catch (_) {}

  // ── Custom sections ───────────────────────────────────────────────
  let customSections = '';
  try {
    const all  = JSON.parse(localStorage.getItem('mw_custom_sections_v1') || '{}');
    const secs = Object.entries(all).map(function(e){ return e[1].emoji + ' ' + e[1].name + ' (id:' + e[0] + ')'; }).join(', ');
    if (secs) customSections = '\nCUSTOM SECTIONS IN MANAGER: ' + secs;
  } catch (_) {}

  // ── App data snapshot ─────────────────────────────────────────────
  let ctx = '';
  try {
    const snap = (typeof getAppContextSummary === 'function') ? getAppContextSummary({ fullMonths: 3 }) : null;
    if (snap) ctx = '\nDATA SNAPSHOT:\n' + snap;
  } catch (_) {}

  // ── Current entry values (if on entry page) ───────────────────────
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

  // ── Manager data summary ──────────────────────────────────────────
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

  const lines = [
    'You are the AI brain of "Bahria Town Sales IC" \u2014 a petrol station management app for a petrol pump in Bahria Town.',
    'The user is the owner/manager. They speak English, Urdu, or a mix (Urdu words like "kitna","mein","daalo","batao","aaj"). You understand everything.',
    'You are a PERSONAL ASSISTANT \u2014 you take actions, answer questions, and analyze sales data.',
    '',
    'TODAY: ' + today + '   CURRENT MONTH: ' + curMonth,
    staffList,
    customSections,
    entryCtx,
    mgrCtx,
    ctx,
    '',
    '\u2550\u2550\u2550 RESPONSE FORMAT (strict JSON only \u2014 no markdown, no code fences, no explanation outside JSON) \u2550\u2550\u2550',
    '{"text":"<your answer, max 180 words, HTML allowed for formatting>","intent":null}',
    'OR: {"text":"<short confirmation>","intent":{"action":"<ACTION>","params":[...]}}',
    '',
    '\u2550\u2550\u2550 NAVIGATION ACTIONS \u2550\u2550\u2550',
    '\u2022 showPage \u2192 params: ["dashboard"|"index"|"data"|"entry"|"report"|"diff"|"tools"|"manager"]',
    '  diff page = DIFF Report (Total Sale vs Computer Sale gap)',
    '\u2022 switchMgrTab \u2192 params: ["salary"|"generic"|"expense"|"credit"|"petty"|"incentive"|"staff"]',
    '',
    '\u2550\u2550\u2550 REPORT ACTIONS \u2550\u2550\u2550',
    '\u2022 openDayModal \u2192 params: ["DD/Mon/YYYY","Month YYYY"]',
    '\u2022 openMonthModal \u2192 params: ["Month YYYY"]',
    '\u2022 printMonthReport \u2192 params: ["Month YYYY"]',
    '\u2022 printYearlyReport \u2192 params: ["YYYY"]',
    '\u2022 printMgrReport \u2192 params: ["credit"|"salary"|"generic"|"expense"|"petty"|"month"|"year"]',
    '',
    '\u2550\u2550\u2550 DATA ENTRY ACTIONS \u2550\u2550\u2550',
    '',
    'STAFF CREDIT LEDGER \u2192 addCredit',
    '  params: ["EmployeeName", amountNumber, "description", "DD-Mon-YYYY"]',
    '  Triggers: "credit X for Y", "Y ko X advance do", "Y ka credit check karo"',
    '  Rule: fuzzy-match name to ACTIVE STAFF. Use today if no date given.',
    '',
    'EXPENSE SHEET \u2192 addExpense',
    '  params: ["DD-Mon-YYYY","description",bill,fuel,soap,refresh,extra,pattyHO]',
    '  bill=electricity/utility/WAPDA, fuel=petrol/diesel, soap=cleaning/washing,',
    '  refresh=tea/chai/food/snacks, extra=miscellaneous/other, pattyHO=HO received',
    '',
    'PETTY DETAIL \u2192 addPettyItem',
    '  params: ["description", amountNumber, "period"]',
    '  Triggers: "patty mein X daalo", "petty cash X for Y"',
    '',
    'DAILY ENTRY FIELD \u2192 setDailyField',
    '  params: ["fieldId", amountNumber]',
    '  Use only when user says "daily entry mein" or "entry form mein" — otherwise use addCustomSectionRow for Jazz Cash.',
    '',
    '  COMPLETE FIELD REFERENCE (Daily Entry form):',
    '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    '  CASH SALES:',
    '    Cash_Sale       = Cash sales amount (petrol/diesel bought with cash)',
    '    Cash_Returns    = Cash returns (refunds; usually 0 or negative)',
    '    Amount_Received = Cash amount physically received/deposited',
    '  ',
    '  BANK/DIGITAL PAYMENTS (credit clients):',
    '    HBL             = HBL Bank voucher sales',
    '    MCB             = MCB Bank voucher sales',
    '    Alfala_Bank     = Bank Alfalah voucher sales',
    '    Bank_Al_Habib   = Bank Al Habib voucher sales',
    '    Meezan_Bank     = Meezan Bank / JazzCash / Paysa digital payments',
    '    Askari_Bank     = Askari Bank voucher sales',
    '  ',
    '  GOVERNMENT/CORPORATE CLIENTS:',
    '    PSO             = PSO card/account sales',
    '    PSO_Returns     = PSO returns/refunds',
    '    NESPAK          = NESPAK government org sales',
    '    PARCO           = PARCO refinery/company sales',
    '    TEPA             = TEPA government sales',
    '    LDA             = LDA (Lahore Development Authority) sales',
    '    Gourmet         = Gourmet Foods/restaurant chain sales',
    '    BTH             = BTH sales',
    '    FDPP            = FDPP (Fuel Delivery) sales',
    '    FDPP_Con        = FDPP Consumer sales',
    '  ',
    '  SPECIAL FIELDS:',
    '    Load_Sale       = Litres/volume of fuel loaded/dispensed today (load = petrol loaded in underground tank)',
    '    COMP_SALE       = Computer Sale = what the pump computer recorded (should match TOTAL)',
    '    TOTAL           = Sum of all sales fields (auto-calculated)',
    '    Customers       = Number of unique customers served today',
    '  ',
    '  DIFF (Difference) = TOTAL minus COMP_SALE. Measures gap between ledger and pump computer.',
    '    Positive DIFF = more on ledger than computer (over-recorded)',
    '    Negative DIFF = less on ledger (under-recorded) — needs investigation',
    '    The "diff" page shows cumulative DIFF history by month.',
    '',
    'CUSTOM SECTION ROW (Manager \u2192 C. New Sections) \u2192 addCustomSectionRow',
    '  params: ["sectionName","description",amountNumber,"notes"]',
    '  Use for: "Jazz Cash 5000", "custom section mein X daalo", "[section name] X"',
    '  Fuzzy-match sectionName to CUSTOM SECTIONS IN MANAGER.',
    '  description = today (' + today + ') unless user says otherwise.',
    '  Example: "Jazz Cash mein 5000" \u2192 params: ["Jazz Cash","' + today + '",5000,""]',
    '',
    '\u2550\u2550\u2550 ANALYTICS (answer as text, intent: null) \u2550\u2550\u2550',
    'Use DATA SNAPSHOT to answer any sales question:',
    '\u2022 Sale of specific date/month/year \u2022 Highest/lowest day or month',
    '\u2022 Month vs month comparison with % change \u2022 Year totals \u2022 Average daily/monthly',
    '\u2022 Load sale total \u2022 Credit client breakdown \u2022 Customer trends',
    '\u2022 Cash vs credit ratio \u2022 Forecast month-end \u2022 Best/worst performers',
    'For specific dates: look in the daily records section of DATA SNAPSHOT.',
    'If asked "sale of 22nd June" \u2192 find June 22 in the daily records.',
    '',
    '\u2550\u2550\u2550 KEY RULES \u2550\u2550\u2550',
    '1. Fuzzy-match staff names to ACTIVE STAFF list.',
    '2. Fuzzy-match section names to CUSTOM SECTIONS IN MANAGER.',
    '3. Default date = today (' + today + ').',
    '4. "Jazz Cash" without "daily entry" \u2192 addCustomSectionRow (not setDailyField).',
    '5. "Load sale" questions \u2192 look at Load_Sale field in daily records.',
    '6. "DIFF" or "difference" questions \u2192 explain DIFF = TOTAL - COMP_SALE, navigate to diff page.',
    '7. Answer in same language mix as user (English/Urdu mix is fine).',
    '8. Never make up data \u2014 only use DATA SNAPSHOT or CURRENT ENTRY.',
    '9. Keep "text" concise (max 180 words). Use <b>bold</b> for numbers/names.',
    '',
    'USER INPUT: ' + question,
  ];
  return lines.filter(function(l){ return l !== null && l !== undefined; }).join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// GROQ API CALLER — permanent key
// ══════════════════════════════════════════════════════════════════════
async function _callGroq(question) {
  const res = await fetch(_GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + _GROQ_KEY,
    },
    body: JSON.stringify({
      model:       _GROQ_MODEL,
      messages:    [{ role: 'user', content: _buildLlmPrompt(question) }],
      max_tokens:  700,
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
    const creditCmd  = _aiParseCreditCommand(text);     if (creditCmd)  return creditCmd;
    const creditQry  = _aiParseCreditQuery(text);       if (creditQry)  return creditQry;
    const expenseCmd = _aiParseExpenseCommand(text);    if (expenseCmd) return expenseCmd;
    const pettyCmd   = _aiParsePettyCommand(text);      if (pettyCmd)   return pettyCmd;
    const fieldCmd   = _aiParseDailyFieldCommand(text); if (fieldCmd)   return fieldCmd;
    const printCmd   = _aiParsePrintCommand(text);      if (printCmd)   return printCmd;
    const navCmd     = _aiParseNavCommand(text);        if (navCmd)     return navCmd;
    const analytics  = _aiDeepSalesAnalysis(text);      if (analytics)  return { text: analytics, intent: null };

    try {
      return await _callGroq(text);
    } catch (llmErr) {
      return { text: '\u26a0\ufe0f AI call failed: ' + llmErr.message, intent: null };
    }
  } catch (err) {
    return { text: 'Sorry, I hit a snag (' + err.message + '). Please try again.', intent: null };
  }
}

// ══════════════════════════════════════════════════════════════════════
// INTENT EXECUTORS
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
        if (typeof toast === 'function') toast('\u26a0 Credit data not loaded \u2014 try again.', 'w'); return;
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

function _aiAddExpenseRow(date, desc, bill, fuel, soap, refresh, extra, pattyHO) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('expense');
    setTimeout(function () {
      if (typeof _expRows_cur === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Expense data not loaded \u2014 try again.', 'w'); return;
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
        if (typeof toast === 'function') toast('\u26a0 Petty data not loaded \u2014 try again.', 'w'); return;
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
    credit:  function(){if(typeof switchMgrTab==='function')switchMgrTab('credit');setTimeout(function(){if(typeof printCreditReport==='function')printCreditReport();},300);},
    salary:  function(){if(typeof switchMgrTab==='function')switchMgrTab('salary');setTimeout(function(){if(typeof printSalaryReport==='function')printSalaryReport();},300);},
    generic: function(){if(typeof switchMgrTab==='function')switchMgrTab('generic');setTimeout(function(){if(typeof printGenericReport==='function')printGenericReport();},300);},
    expense: function(){if(typeof switchMgrTab==='function')switchMgrTab('expense');setTimeout(function(){if(typeof printExpenseReport==='function')printExpenseReport();},300);},
    petty:   function(){if(typeof switchMgrTab==='function')switchMgrTab('petty');setTimeout(function(){if(typeof printPettyReport==='function')printPettyReport();},300);},
    month:   function(){if(typeof printMonthReport==='function')printMonthReport();},
    year:    function(){if(typeof printYearlyReport==='function')printYearlyReport();},
  };
  setTimeout(function(){const fn=fnMap[type];if(fn)fn();},300);
}

// ── addCustomSectionRow — enters a row into a custom section ──────────────
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
    // Try to click the custom sections tab
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
        desc:   desc   || _aiTodayStr(),
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

// ── Master executor ───────────────────────────────────────────────────────
function aiBridgeExecuteIntent(intent) {
  if (!intent || !AI_SAFE_INTENTS.has(intent.action)) return;
  const p = intent.params || [];
  try {
    switch (intent.action) {
      case 'showPage':           if (typeof showPage === 'function') showPage(p[0]); break;
      case 'switchMgrTab':       if (typeof showPage === 'function') showPage('manager'); setTimeout(function(){if(typeof switchMgrTab==='function')switchMgrTab(p[0]);},250); break;
      case 'openDayModal':       if (typeof openDayModal === 'function') openDayModal(p[0],p[1]); break;
      case 'openMonthModal':     if (typeof openMonthModal === 'function') openMonthModal(p[0]); break;
      case 'printMonthReport':   if (typeof printMonthReport === 'function') printMonthReport(p[0]); break;
      case 'printYearlyReport':  if (typeof printYearlyReport === 'function') printYearlyReport(p[0]); break;
      case 'printMgrReport':     _aiPrintMgrReport(p[0]); break;
      case 'addCredit':          _aiAddCreditEntry(p[0],p[1],p[2],p[3]); break;
      case 'addExpense':         _aiAddExpenseRow(p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]); break;
      case 'addPettyItem':       _aiAddPettyItem(p[0],p[1],p[2]); break;
      case 'setDailyField':      _aiSetDailyField(p[0],p[1]); break;
      case 'addCustomSectionRow':_aiAddCustomSectionRow(p[0],p[1],p[2],p[3]); break;
    }
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 Action failed: ' + e.message, 'w');
  }
}
