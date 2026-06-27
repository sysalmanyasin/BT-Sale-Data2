// ══════════════════════════════════════════════════════════════════════
// AI MEMORY — Persistent Memory · Custom Rules · Correction Training ·
//             Custom Section AI Config · Voice Log · Daily Briefing
//
// Everything here lives in localStorage AND is folded into the single
// Supabase payload row (bt_salesdata / id="main") so a browser-storage
// wipe never loses it — pullFromSupabase() restores it like any other
// section of the app.
// ══════════════════════════════════════════════════════════════════════

const AIMEM_K_FACTS       = 'bt_ai_memory';        // persistent facts
const AIMEM_K_RULES       = 'bt_ai_rules';          // IF -> THEN rules
const AIMEM_K_CORR        = 'bt_ai_corrections';    // training corrections
const AIMEM_K_VOICE       = 'bt_ai_voice_log';      // voice command transcripts
const AIMEM_K_BRIEF       = 'bt_ai_briefing_cache'; // last daily briefing
const AIMEM_K_RULEFLAGS   = 'bt_ai_rule_fired';     // which rules already alerted today

function _aimUid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function _aimNow()  { return new Date().toISOString(); }
function _aimToday() { return (typeof _aiTodayStr === 'function') ? _aiTodayStr() : new Date().toDateString(); }

function _aimGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch (_) { return fallback; }
}
function _aimSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  if (typeof _markPending === 'function') _markPending(); // queue for Supabase push
}

// ══════════════════════════════════════════════════════════════════════
// 1. PERSISTENT MEMORY — facts the AI remembers forever
// ══════════════════════════════════════════════════════════════════════
function aimFactList() { return _aimGet(AIMEM_K_FACTS, []); }

function aimFactAdd(fact) {
  fact = (fact || '').trim();
  if (!fact) return null;
  const list = aimFactList();
  // avoid near-duplicates
  const norm = s => s.trim().toLowerCase();
  const dupe = list.find(f => norm(f.fact) === norm(fact));
  if (dupe) { dupe.addedOn = _aimNow(); _aimSet(AIMEM_K_FACTS, list); return dupe; }
  const entry = { id: _aimUid(), fact, addedOn: _aimNow(), usedCount: 0 };
  list.unshift(entry);
  _aimSet(AIMEM_K_FACTS, list);
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
  return entry;
}

function aimFactDelete(id) {
  const list = aimFactList().filter(f => f.id !== id);
  _aimSet(AIMEM_K_FACTS, list);
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
}

function aimFactTouch(id) {
  const list = aimFactList();
  const f = list.find(x => x.id === id);
  if (f) { f.usedCount = (f.usedCount || 0) + 1; _aimSet(AIMEM_K_FACTS, list); }
}

// Build the block injected into every Groq prompt
function aimFactsPromptBlock() {
  const list = aimFactList();
  if (!list.length) return '';
  list.forEach(f => aimFactTouch(f.id));
  return '\nREMEMBERED FACTS ABOUT THIS BUSINESS (told to you by the owner — always honor these):\n' +
    list.map(f => '• ' + f.fact).join('\n');
}

// Detect "remember that / yaad rakho / note that ..." and store it.
// Returns a chat-style {text,intent:null} result, or null if not a memory command.
function _aimParseRememberCommand(text) {
  const t = (text || '').trim();
  const m = t.match(/^(?:remember|note|yaad rakho|yaad rakhna|please remember)\s+(?:that\s+)?(.+)$/i);
  if (!m) return null;
  const fact = m[1].trim().replace(/[.!]+$/, '');
  if (!fact) return null;
  aimFactAdd(fact);
  return { text: '🧠 Got it — I\'ll remember: <b>' + fact.replace(/</g, '&lt;') + '</b>', intent: null };
}

function _aimParseForgetCommand(text) {
  const t = (text || '').trim();
  const m = t.match(/^(?:forget|delete memory|remove memory)\s+(?:that\s+)?(.+)$/i);
  if (!m) return null;
  const needle = m[1].trim().toLowerCase();
  const list = aimFactList();
  const hit = list.find(f => f.fact.toLowerCase().includes(needle) || needle.includes(f.fact.toLowerCase()));
  if (!hit) return { text: '🤷 I don\'t have a memory matching that.', intent: null };
  aimFactDelete(hit.id);
  return { text: '🗑️ Forgotten: <b>' + hit.fact.replace(/</g, '&lt;') + '</b>', intent: null };
}

// ══════════════════════════════════════════════════════════════════════
// 2. CUSTOM RULES — IF -> THEN business logic, checked silently on load
// ══════════════════════════════════════════════════════════════════════
function aimRuleList() { return _aimGet(AIMEM_K_RULES, []); }

function aimRuleAdd(plainText, conditionObj) {
  const list = aimRuleList();
  const entry = {
    id: _aimUid(),
    rule: plainText,
    condition: conditionObj || null, // { type, field, op, value, section, days } — best-effort structured form
    createdOn: _aimNow(),
    lastChecked: null,
    active: true,
  };
  list.unshift(entry);
  _aimSet(AIMEM_K_RULES, list);
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
  return entry;
}

function aimRuleDelete(id) {
  _aimSet(AIMEM_K_RULES, aimRuleList().filter(r => r.id !== id));
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
}

function aimRuleToggle(id) {
  const list = aimRuleList();
  const r = list.find(x => x.id === id);
  if (r) { r.active = !r.active; _aimSet(AIMEM_K_RULES, list); if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel(); }
}

// Convert plain-English rule text into a best-effort structured condition.
// This is intentionally simple/regex-based so it works with no Groq call;
// Groq is used as a fallback only when nothing matches (handled by caller).
function aimRuleParseCondition(text) {
  const t = (text || '').toLowerCase();
  let m;

  // "if <client/staff>'s credit crosses/exceeds N" / "above/below N"
  m = t.match(/if\s+([a-z\s]+?)'?s?\s*credit\s*(?:crosses|exceeds|is above|goes above|above)\s*(?:rs\.?|₨|pkr)?\s*([\d,]+)/);
  if (m) return { type: 'creditAbove', who: m[1].trim(), value: parseFloat(m[2].replace(/,/g, '')) };

  // "if cash sale is below/under N" (daily)
  m = t.match(/if\s+(?:any\s+day'?s?\s+)?cash\s*sale\s*(?:is\s*)?(?:below|under|less than)\s*(?:rs\.?|₨|pkr)?\s*([\d,]+)/);
  if (m) return { type: 'dailyFieldBelow', field: 'Cash_Sale', value: parseFloat(m[1].replace(/,/g, '')) };

  // "if total sale is below/under N"
  m = t.match(/if\s+(?:total\s+)?sale\s*(?:is\s*)?(?:below|under|less than)\s*(?:rs\.?|₨|pkr)?\s*([\d,]+)/);
  if (m) return { type: 'dailyFieldBelow', field: 'TOTAL', value: parseFloat(m[1].replace(/,/g, '')) };

  // "if <section name> is zero for N days"
  m = t.match(/if\s+([a-z\s]+?)\s+(?:is\s+)?zero\s+for\s+(\d+)\s+days?/);
  if (m) return { type: 'sectionZeroDays', section: m[1].trim(), days: parseInt(m[2], 10) };

  // "if load sale is zero for N days"
  m = t.match(/load\s*sale.*?zero\s*for\s*(\d+)\s*days?/);
  if (m) return { type: 'dailyFieldZeroDays', field: 'Load_Sale', days: parseInt(m[1], 10) };

  // "every <weekday>, remind me to ..."
  m = t.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*,?\s*(?:remind me to\s*)?(.+)/);
  if (m) return { type: 'weeklyReminder', day: m[1], message: m[2].trim() };

  return null; // Groq will be asked to structure it (see aimRuleAddFromText)
}

// High-level entry: user typed "rule: ..." or "create rule ..." in chat.
function _aimParseRuleCommand(text) {
  const t = (text || '').trim();
  const m = t.match(/^(?:rule|create rule|add rule|new rule)\s*:?\s*(.+)$/i);
  if (!m) return null;
  const ruleText = m[1].trim();
  const cond = aimRuleParseCondition(ruleText);
  aimRuleAdd(ruleText, cond);
  return {
    text: '📐 Rule saved: <b>' + ruleText.replace(/</g, '&lt;') + '</b>' +
      (cond ? '' : '<br><span style="font-size:11px;color:#94a3b8">(I\'ll keep checking with AI since I couldn\'t auto-structure this one — it still works.)</span>'),
    intent: null,
  };
}

function _aimParseDeleteRuleCommand(text) {
  const t = (text || '').trim();
  const m = t.match(/^(?:delete rule|remove rule)\s*:?\s*(.+)$/i);
  if (!m) return null;
  const needle = m[1].trim().toLowerCase();
  const list = aimRuleList();
  const hit = list.find(r => r.rule.toLowerCase().includes(needle));
  if (!hit) return { text: '🤷 No matching rule found.', intent: null };
  aimRuleDelete(hit.id);
  return { text: '🗑️ Rule removed: <b>' + hit.rule.replace(/</g, '&lt;') + '</b>', intent: null };
}

// Run every active rule against current data. Returns array of fired alerts.
// Called silently on AI page load — fired ones show as a warning chip.
function aimRulesCheckAll() {
  const rules = aimRuleList().filter(r => r.active !== false);
  const fired = [];
  const today = _aimToday();
  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  const D = (typeof DAILY !== 'undefined' && DAILY)   ? DAILY   : [];
  const n = v => isNaN(parseFloat(v)) ? 0 : parseFloat(v);

  rules.forEach(r => {
    r.lastChecked = _aimNow();
    const c = r.condition;
    if (!c) return; // unstructured rules just sit there informing the AI's prompt; not auto-fired
    try {
      if (c.type === 'creditAbove') {
        const mgrKey = Object.keys(localStorage).find(k => k.startsWith('mw_mgr_') || k === 'mw_manager');
        if (!mgrKey) return;
        const mgr = JSON.parse(localStorage.getItem(mgrKey) || '{}');
        const months = Object.keys(mgr.credit || {});
        if (!months.length) return;
        const crd = mgr.credit[months[months.length - 1]] || [];
        const norm = s => (s || '').trim().toLowerCase();
        const who = norm(c.who);
        crd.forEach(e => {
          const nm = norm(e.name);
          if (!(nm.includes(who) || who.includes(nm))) return;
          const bal = n(e.prevBal) + (e.entries || []).reduce((s, x) => s + n(x.amount), 0);
          if (bal > c.value) fired.push({ id: r.id, msg: '⚠️ ' + e.name + '\'s credit is ₨' + Math.round(bal).toLocaleString('en-PK') + ' — crossed your rule of ₨' + c.value.toLocaleString('en-PK') + '.' });
        });
      } else if (c.type === 'dailyFieldBelow') {
        const todays = D.filter(d => d.Date === today);
        todays.forEach(d => {
          const v = n(d[c.field]);
          if (v > 0 && v < c.value) fired.push({ id: r.id, msg: '⚠️ Today\'s ' + c.field.replace(/_/g, ' ') + ' is ₨' + Math.round(v).toLocaleString('en-PK') + ' — below your rule threshold of ₨' + c.value.toLocaleString('en-PK') + '.' });
        });
      } else if (c.type === 'dailyFieldZeroDays' || c.type === 'sectionZeroDays') {
        // Sort by date before slicing so we get the actual last N calendar days,
        // not the last N array positions (DAILY insertion order isn't guaranteed)
        const recentSorted = D.slice().sort((a, b) => BTDate.parseDate(a.Date) - BTDate.parseDate(b.Date));
        const recent = recentSorted.slice(-c.days);
        if (recent.length < c.days) return;
        const field = c.field || null;
        const allZero = field ? recent.every(d => n(d[field]) === 0) : false;
        if (allZero) fired.push({ id: r.id, msg: '⚠️ ' + (field || c.section) + ' has been zero for ' + c.days + ' day(s) in a row.' });
      } else if (c.type === 'weeklyReminder') {
        const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        if (new Date().getDay() === dayNames.indexOf(c.day)) {
          const flagKey = c.day + '-' + new Date().toDateString();
          const flags = _aimGet(AIMEM_K_RULEFLAGS, {});
          if (!flags[r.id] || flags[r.id] !== flagKey) {
            fired.push({ id: r.id, msg: '🔔 Reminder: ' + c.message });
            flags[r.id] = flagKey;
            _aimSet(AIMEM_K_RULEFLAGS, flags);
          }
        }
      }
    } catch (_) { /* never let one bad rule break the rest */ }
  });
  _aimSet(AIMEM_K_RULES, rules); // persist lastChecked
  return fired;
}

// ══════════════════════════════════════════════════════════════════════
// 3. CORRECTION TRAINING — few-shot learning stored locally
// ══════════════════════════════════════════════════════════════════════
function aimCorrList() { return _aimGet(AIMEM_K_CORR, []); }

function aimCorrAdd(trigger, action, params) {
  trigger = (trigger || '').trim().toLowerCase();
  if (!trigger || !action) return null;
  const list = aimCorrList();
  const existing = list.find(c => c.trigger === trigger);
  const entry = existing || { id: _aimUid(), trigger, createdOn: _aimNow(), hits: 0 };
  entry.action = action;
  entry.params = params || [];
  entry.updatedOn = _aimNow();
  if (!existing) list.unshift(entry);
  _aimSet(AIMEM_K_CORR, list);
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
  return entry;
}

function aimCorrDelete(id) {
  _aimSet(AIMEM_K_CORR, aimCorrList().filter(c => c.id !== id));
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
}

// Check if incoming chat text matches a learned correction.
// Returns {text,intent,requiresConfirm} like aiBridgeAnswer, or null.
function aimCorrMatch(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return null;
  const list = aimCorrList();
  const hit = list.find(c => t.includes(c.trigger) || c.trigger.includes(t));
  if (!hit) return null;
  hit.hits = (hit.hits || 0) + 1;
  _aimSet(AIMEM_K_CORR, list);
  const isDestruct = (typeof AI_DESTRUCTIVE_INTENTS !== 'undefined') && AI_DESTRUCTIVE_INTENTS.has(hit.action);
  return {
    text: '✅ (learned) Routing "' + hit.trigger + '" → ' + hit.action,
    intent: { action: hit.action, params: hit.params },
    requiresConfirm: isDestruct,
  };
}

// Chat command: "no, jazz cash goes to load commission section" style corrections,
// also explicit form: "correct: <trigger> => <actionName> | param1 | param2".
function _aimParseCorrectionCommand(text, lastIntent) {
  const t = (text || '').trim();

  // Explicit syntax
  let m = t.match(/^correct\s*:?\s*(.+?)\s*=>\s*([a-zA-Z]+)\s*(?:\|(.*))?$/);
  if (m) {
    const trigger = m[1].trim().toLowerCase();
    const action  = m[2].trim();
    const params  = m[3] ? m[3].split('|').map(s => { const v = s.trim(); const num = parseFloat(v); return (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(v)) ? num : v; }) : [];
    aimCorrAdd(trigger, action, params);
    return { text: '🎓 Learned! Next time "' + trigger + '" will instantly route to <b>' + action + '</b> — no AI call needed.', intent: null };
  }

  // Natural correction right after a bot action: "no, X goes to Y section"
  m = t.match(/^no,?\s*(.+?)\s+goes?\s+to\s+(.+?)(?:\s+section)?$/i);
  if (m && lastIntent) {
    const trigger = m[1].trim().toLowerCase();
    aimCorrAdd(trigger, lastIntent.action === 'addCustomSectionRow' ? 'addCustomSectionRow' : lastIntent.action,
      lastIntent.action === 'addCustomSectionRow' ? [m[2].trim(), '{{date}}', '{{amount}}', '{{notes}}'] : lastIntent.params);
    return { text: '🎓 Got it — "' + trigger + '" will route to <b>' + m[2].trim() + '</b> from now on.', intent: null };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// 4. CUSTOM SECTION AI CONFIG — personality per custom section
//    Stored as an `aiConfig` sub-object on each section inside the
//    EXISTING mw_custom_sections_v1 key, so it rides along with that
//    key's own Supabase sync automatically — no separate sync needed.
// ══════════════════════════════════════════════════════════════════════
const AIMEM_CSEC_KEY = 'mw_custom_sections_v1';

function aimSectionConfigGetAll() {
  const all = _aimGet(AIMEM_CSEC_KEY, {});
  return all;
}

function aimSectionConfigGet(sectionId) {
  const all = aimSectionConfigGetAll();
  const sec = all[sectionId];
  if (!sec) return null;
  return sec.aiConfig || { aliases: [], default_desc: '', auto_date: true, monthly_summary: true, alert_if_zero: false };
}

function aimSectionConfigSet(sectionId, config) {
  const all = aimSectionConfigGetAll();
  if (!all[sectionId]) return false;
  all[sectionId].aiConfig = Object.assign({}, all[sectionId].aiConfig || {}, config);
  _aimSet(AIMEM_CSEC_KEY, all);
  if (typeof renderAiMemoryPanel === 'function') renderAiMemoryPanel();
  return true;
}

// Build prompt lines describing every section's aliases so Groq (and the
// instant fuzzy router) can route to the right section without guessing.
function aimSectionConfigPromptBlock() {
  const all = aimSectionConfigGetAll();
  const lines = [];
  Object.keys(all).forEach(id => {
    const sec = all[id];
    const cfg = sec.aiConfig;
    if (!cfg) return;
    const bits = [];
    if (cfg.aliases && cfg.aliases.length) bits.push('aliases: ' + cfg.aliases.join(', '));
    if (cfg.default_desc) bits.push('default note: "' + cfg.default_desc + '"');
    if (bits.length) lines.push('• "' + sec.name + '" (id:' + id + ') — ' + bits.join('; '));
  });
  if (!lines.length) return '';
  return '\nCUSTOM SECTION AI CONFIG (use these aliases to route amounts to the right section):\n' + lines.join('\n');
}

// Sections configured with alert_if_zero: true and nothing entered this month.
function aimSectionZeroAlerts() {
  const all = aimSectionConfigGetAll();
  const curM = (typeof _aiCurrentMonthYear === 'function') ? _aiCurrentMonthYear() : '';
  const alerts = [];
  Object.keys(all).forEach(id => {
    const sec = all[id];
    if (!sec.aiConfig || !sec.aiConfig.alert_if_zero) return;
    const rows = (sec.months && sec.months[curM]) || [];
    if (!rows.length) alerts.push('⚠️ "' + sec.name + '" has no entries yet this month (' + curM + ').');
  });
  return alerts;
}

// ══════════════════════════════════════════════════════════════════════
// 5. DAILY BRIEFING — proactive, rule-based, no Groq needed
// ══════════════════════════════════════════════════════════════════════
function aimBriefingGenerate(force) {
  const today = _aimToday();
  const cache = _aimGet(AIMEM_K_BRIEF, {});
  if (!force && cache.date === today && cache.text) return cache.text;

  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  const D = (typeof DAILY !== 'undefined' && DAILY)   ? DAILY   : [];
  if (!M.length || !D.length) return null;

  const n  = v => isNaN(parseFloat(v)) ? 0 : parseFloat(v);
  const fc = v => Math.round(v).toLocaleString('en-PK');

  // Sort by actual date value so slice(-N) reliably gives the N most-recent days
  // (_sortKey may be absent; BTDate.parseDate handles the DD/Mon/YYYY format used in DAILY)
  const sortedD = D.slice().sort((a, b) => BTDate.parseDate(a.Date) - BTDate.parseDate(b.Date));
  const yesterday = sortedD[sortedD.length - 1]; // most recent recorded day
  if (!yesterday) return null;

  const last30 = sortedD.slice(-30); // use sortedD — D is not guaranteed to be in date order
  const avg30  = last30.length ? last30.reduce((s, d) => s + n(d.TOTAL), 0) / last30.length : 0;
  const yT     = n(yesterday.TOTAL);
  const diffPct = avg30 > 0 ? Math.round(((yT - avg30) / avg30) * 100) : 0;

  const cashS = n(yesterday.Cash_Sale || yesterday['Cash Sale']);
  const loadS = n(yesterday.Load_Sale || yesterday['Load Sale']);

  const curM   = (typeof _aiCurrentMonthYear === 'function') ? _aiCurrentMonthYear() : '';
  const curMonObj = M.find(m => m.Month_Year === curM);
  const monTotal  = curMonObj ? n(curMonObj.TOTAL) : 0;
  const tgts   = (typeof window.getTgts === 'function') ? window.getTgts() : {};
  const target = n(tgts[curM]);

  let parts = [];
  parts.push('Good morning! Yesterday (' + yesterday.Date + ') total was ₨' + fc(yT) +
    (diffPct !== 0 ? (' — ' + Math.abs(diffPct) + '% ' + (diffPct >= 0 ? 'above' : 'below') + ' your 30-day average') : ' — right around your average') + '.');

  if (cashS > 0) parts.push('Cash sales were ₨' + fc(cashS) + '.');
  if (loadS === 0) parts.push('Load sale was zero — worth a check.');
  else if (loadS > 0) parts.push('Load sale: ₨' + fc(loadS) + '.');

  // Credit due reminder (from memory facts mentioning "due" + staff names, lightweight)
  try {
    const mgrKey = Object.keys(localStorage).find(k => k.startsWith('mw_mgr_') || k === 'mw_manager');
    if (mgrKey) {
      const mgr = JSON.parse(localStorage.getItem(mgrKey) || '{}');
      const months = Object.keys(mgr.credit || {});
      if (months.length) {
        const crd = mgr.credit[months[months.length - 1]] || [];
        const outstanding = crd.map(e => ({ name: e.name, bal: n(e.prevBal) + (e.entries || []).reduce((s, x) => s + n(x.amount), 0) })).filter(e => e.bal > 0);
        if (outstanding.length) {
          const top = outstanding.sort((a, b) => b.bal - a.bal)[0];
          parts.push('Credit outstanding for ' + top.name + ' is ₨' + fc(top.bal) + '.');
        }
      }
    }
  } catch (_) {}

  if (target > 0) {
    const pct = Math.round((monTotal / target) * 100);
    parts.push(curM + ' target: ' + pct + '% hit, ₨' + fc(Math.max(0, target - monTotal)) + ' remaining.');
  }

  // Section zero alerts
  aimSectionZeroAlerts().forEach(a => parts.push(a));

  // Rule-fired alerts
  aimRulesCheckAll().forEach(f => parts.push(f.msg));

  const text = parts.join(' ');
  _aimSet(AIMEM_K_BRIEF, { date: today, text });
  return text;
}

// ══════════════════════════════════════════════════════════════════════
// 6. VOICE INPUT MEMORY — log transcripts, suggest shortcuts
// ══════════════════════════════════════════════════════════════════════
function aimVoiceLogAdd(transcript) {
  transcript = (transcript || '').trim();
  if (!transcript) return;
  const log = _aimGet(AIMEM_K_VOICE, []);
  log.push({ text: transcript, at: _aimNow() });
  // keep last 500
  if (log.length > 500) log.splice(0, log.length - 500);
  _aimSet(AIMEM_K_VOICE, log);
}

// Returns [{ phrase, count }] for phrases said >=8 times in the last 30 days,
// excluding ones already learned as corrections.
function aimVoiceSuggestions() {
  const log = _aimGet(AIMEM_K_VOICE, []);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const counts = {};
  log.forEach(e => {
    if (new Date(e.at).getTime() < cutoff) return;
    const key = norm(e.text);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  const learned = new Set(aimCorrList().map(c => c.trigger));
  return Object.entries(counts)
    .filter(([phrase, count]) => count >= 8 && !learned.has(phrase))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase, count]) => ({ phrase, count }));
}

// ══════════════════════════════════════════════════════════════════════
// SUPABASE INTEGRATION — fold all of the above into the shared payload
// ══════════════════════════════════════════════════════════════════════
function aimBuildAssistantPayload() {
  return {
    facts:        aimFactList(),
    rules:        aimRuleList(),
    corrections:  aimCorrList(),
    voiceLog:     _aimGet(AIMEM_K_VOICE, []),
    briefing:     _aimGet(AIMEM_K_BRIEF, {}),
    updatedAt:    _aimNow(),
  };
}

// remote wins on pull, local wins on push (only fills gaps) — same
// convention used everywhere else in supabase.js's mergeIncomingData.
function aimMergeAssistantIncoming(assistant, isPull) {
  if (!assistant || typeof assistant !== 'object') return;

  function mergeListById(key, remoteList) {
    if (!Array.isArray(remoteList)) return;
    const local = _aimGet(key, []);
    const byId = {};
    local.forEach(item => { byId[item.id] = item; });
    remoteList.forEach(item => {
      if (!item || !item.id) return;
      if (isPull) byId[item.id] = item;                 // remote wins on pull
      else if (!byId[item.id]) byId[item.id] = item;     // local wins on push — fill gaps only
    });
    _aimSet(key, Object.values(byId));
  }

  mergeListById(AIMEM_K_FACTS, assistant.facts);
  mergeListById(AIMEM_K_RULES, assistant.rules);
  mergeListById(AIMEM_K_CORR,  assistant.corrections);

  if (Array.isArray(assistant.voiceLog)) {
    // voice log: just union by (text+at), cap at 500
    const local = _aimGet(AIMEM_K_VOICE, []);
    const seen = new Set(local.map(e => e.text + '|' + e.at));
    assistant.voiceLog.forEach(e => {
      const key = e.text + '|' + e.at;
      if (!seen.has(key)) { local.push(e); seen.add(key); }
    });
    local.sort((a, b) => new Date(a.at) - new Date(b.at));
    if (local.length > 500) local.splice(0, local.length - 500);
    _aimSet(AIMEM_K_VOICE, local);
  }

  if (assistant.briefing && isPull) {
    const local = _aimGet(AIMEM_K_BRIEF, {});
    // newer briefing wins
    if (!local.date || new Date(assistant.updatedAt || 0) > new Date(local._mergedAt || 0)) {
      _aimSet(AIMEM_K_BRIEF, assistant.briefing);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// COMBINED PROMPT BLOCK — call this from ai-bridge._buildLlmPrompt()
// ══════════════════════════════════════════════════════════════════════
function aimFullPromptBlock() {
  return (aimFactsPromptBlock() || '') + (aimSectionConfigPromptBlock() || '');
}

// ══════════════════════════════════════════════════════════════════════
// MASTER CHAT HOOK — call before Groq in aiBridgeAnswer()
// Handles: remember/forget, rule/delete-rule, correction commands.
// Returns a result object, or null if nothing matched.
// ══════════════════════════════════════════════════════════════════════
function aimHandleChatCommand(text, lastIntent) {
  const corrHit = aimCorrMatch(text); if (corrHit) return corrHit;
  const r1 = _aimParseRememberCommand(text);      if (r1) return r1;
  const r2 = _aimParseForgetCommand(text);        if (r2) return r2;
  const r3 = _aimParseRuleCommand(text);          if (r3) return r3;
  const r4 = _aimParseDeleteRuleCommand(text);    if (r4) return r4;
  const r5 = _aimParseCorrectionCommand(text, lastIntent); if (r5) return r5;
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// MEMORY PANEL UI — "🧠 Memory" button on the AI page
// One place to see/add/delete: facts, rules, corrections, section
// configs and voice-based shortcut suggestions. Everything here is
// already synced to Supabase via aimBuildAssistantPayload().
// ══════════════════════════════════════════════════════════════════════
function _aimEsc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }

var _aimPanelTab = 'facts';

function aimOpenPanel() {
  _aimPanelTab = 'facts';
  renderAiMemoryPanel();
}
function aimClosePanel() {
  const box = document.getElementById('aim-panel-modal');
  if (box) box.innerHTML = '';
}
function aimSwitchPanelTab(tab) {
  _aimPanelTab = tab;
  renderAiMemoryPanel();
}

function renderAiMemoryPanel() {
  const box = document.getElementById('aim-panel-modal');
  if (!box) return; // not on AI page right now — nothing to render

  const tabs = [
    ['facts', '🧠 Memory'], ['rules', '📐 Rules'], ['corrections', '🎓 Training'],
    ['sections', '🏷️ Sections'], ['voice', '🎤 Voice'],
  ];
  const tabHtml = tabs.map(function(t) {
    return '<button class="ai-chip' + (t[0]===_aimPanelTab?' ai-chip-green':'-dim') + '" onclick="aimSwitchPanelTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  }).join('');

  let body = '';
  if (_aimPanelTab === 'facts') body = _aimRenderFactsTab();
  else if (_aimPanelTab === 'rules') body = _aimRenderRulesTab();
  else if (_aimPanelTab === 'corrections') body = _aimRenderCorrectionsTab();
  else if (_aimPanelTab === 'sections') body = _aimRenderSectionsTab();
  else if (_aimPanelTab === 'voice') body = _aimRenderVoiceTab();

  box.innerHTML =
    '<div class="ai-modal-backdrop" onclick="if(event.target===this)aimClosePanel()">' +
      '<div class="ai-modal-card" style="max-width:560px;width:94vw">' +
        '<div class="ai-modal-title">🧠 AI Memory &amp; Training</div>' +
        '<div style="font-size:11.5px;color:#64748b;margin-bottom:10px">Synced to Supabase automatically — survives browser storage being cleared.</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' + tabHtml + '</div>' +
        '<div style="max-height:55vh;overflow-y:auto">' + body + '</div>' +
        '<div style="margin-top:12px;text-align:right"><button class="ai-chip-dim" onclick="aimClosePanel()">Close</button></div>' +
      '</div>' +
    '</div>';
}

function _aimRenderFactsTab() {
  const list = aimFactList();
  let html = '<div style="display:flex;gap:6px;margin-bottom:10px">' +
    '<input id="aim-new-fact" type="text" placeholder="e.g. Salman always gets credit on the 5th" ' +
    'style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px">' +
    '<button class="ai-chip ai-chip-green" onclick="_aimUiAddFact()">Add</button></div>';
  if (!list.length) {
    html += '<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:20px 0">No memories yet. Anything you tell the AI to "remember" lands here.</div>';
  } else {
    html += list.map(function(f) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#f8fafc">' +
        '<div style="font-size:12.5px;color:#1e293b;flex:1">' + _aimEsc(f.fact) + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">used ' + (f.usedCount||0) + 'x · added ' + new Date(f.addedOn).toLocaleDateString('en-PK') + '</div></div>' +
        '<button class="ai-chip-dim" style="white-space:nowrap" onclick="aimFactDelete(\'' + f.id + '\')">🗑️</button>' +
        '</div>';
    }).join('');
  }
  return html;
}
function _aimUiAddFact() {
  const inp = document.getElementById('aim-new-fact');
  const val = inp ? inp.value.trim() : '';
  if (!val) return;
  aimFactAdd(val);
  if (inp) inp.value = '';
}

function _aimRenderRulesTab() {
  const list = aimRuleList();
  let html = '<div style="display:flex;gap:6px;margin-bottom:10px">' +
    '<input id="aim-new-rule" type="text" placeholder="e.g. If cash sale is below 200000 flag it" ' +
    'style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px">' +
    '<button class="ai-chip ai-chip-green" onclick="_aimUiAddRule()">Add</button></div>';
  if (!list.length) {
    html += '<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:20px 0">No rules yet. Rules run silently every time the AI page opens.</div>';
  } else {
    html += list.map(function(r) {
      const structured = r.condition ? '✅ auto-checked' : '🤖 informational only';
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:' + (r.active===false?'#f1f5f9':'#f8fafc') + '">' +
        '<div style="font-size:12.5px;color:#1e293b;flex:1">' + _aimEsc(r.rule) + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + structured + (r.active===false?' · paused':'') + '</div></div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0">' +
        '<button class="ai-chip-dim" onclick="aimRuleToggle(\'' + r.id + '\')">' + (r.active===false?'▶️':'⏸️') + '</button>' +
        '<button class="ai-chip-dim" onclick="aimRuleDelete(\'' + r.id + '\')">🗑️</button>' +
        '</div></div>';
    }).join('');
  }
  return html;
}
function _aimUiAddRule() {
  const inp = document.getElementById('aim-new-rule');
  const val = inp ? inp.value.trim() : '';
  if (!val) return;
  aimRuleAdd(val, aimRuleParseCondition(val));
  if (inp) inp.value = '';
}

function _aimRenderCorrectionsTab() {
  const list = aimCorrList();
  let html = '<div style="font-size:11.5px;color:#64748b;margin-bottom:10px">' +
    'Type <code>correct: trigger phrase =&gt; actionName | param1 | param2</code> in chat, or right after a wrong action say <code>"no, X goes to Y"</code> — it\'s saved here and never needs Groq again.</div>';
  if (!list.length) {
    html += '<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:20px 0">No trained corrections yet.</div>';
  } else {
    html += list.map(function(c) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#f8fafc">' +
        '<div style="font-size:12.5px;color:#1e293b;flex:1"><b>"' + _aimEsc(c.trigger) + '"</b> → ' + _aimEsc(c.action) +
        '<div style="font-size:10px;color:#94a3b8;margin-top:2px">used ' + (c.hits||0) + 'x</div></div>' +
        '<button class="ai-chip-dim" onclick="aimCorrDelete(\'' + c.id + '\')">🗑️</button>' +
        '</div>';
    }).join('');
  }
  return html;
}

function _aimRenderSectionsTab() {
  const all = aimSectionConfigGetAll();
  const ids = Object.keys(all);
  if (!ids.length) return '<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:20px 0">No custom sections yet. Create one in Manager → Custom Sections first.</div>';
  return ids.map(function(id) {
    const sec = all[id];
    const cfg = sec.aiConfig || {};
    const aliasesStr = (cfg.aliases || []).join(', ');
    return '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px;background:#f8fafc">' +
      '<div style="font-weight:700;font-size:13px;color:#1e293b;margin-bottom:6px">' + (sec.emoji||'') + ' ' + _aimEsc(sec.name) + '</div>' +
      '<label style="font-size:10.5px;color:#64748b">Aliases (comma-separated)</label>' +
      '<input type="text" value="' + _aimEsc(aliasesStr) + '" id="aim-sec-alias-' + id + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;margin-bottom:6px">' +
      '<label style="font-size:10.5px;color:#64748b">Default note</label>' +
      '<input type="text" value="' + _aimEsc(cfg.default_desc||'') + '" id="aim-sec-desc-' + id + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;margin-bottom:6px">' +
      '<label style="font-size:11px;display:flex;align-items:center;gap:6px;margin-bottom:8px"><input type="checkbox" id="aim-sec-zero-' + id + '" ' + (cfg.alert_if_zero?'checked':'') + '> Alert if no entries this month</label>' +
      '<button class="ai-chip ai-chip-green" onclick="_aimUiSaveSection(\'' + id + '\')">Save</button>' +
      '</div>';
  }).join('');
}
function _aimUiSaveSection(id) {
  const aliasInp = document.getElementById('aim-sec-alias-' + id);
  const descInp  = document.getElementById('aim-sec-desc-' + id);
  const zeroInp  = document.getElementById('aim-sec-zero-' + id);
  const aliases  = aliasInp ? aliasInp.value.split(',').map(function(s){return s.trim().toLowerCase();}).filter(Boolean) : [];
  aimSectionConfigSet(id, {
    aliases: aliases,
    default_desc: descInp ? descInp.value.trim() : '',
    alert_if_zero: !!(zeroInp && zeroInp.checked),
    auto_date: true,
    monthly_summary: true,
  });
  if (typeof toast === 'function') toast('✅ Section AI config saved.');
}

function _aimRenderVoiceTab() {
  const suggestions = aimVoiceSuggestions();
  const log = _aimGet(AIMEM_K_VOICE, []);
  let html = '<div style="font-size:11.5px;color:#64748b;margin-bottom:10px">' + log.length + ' voice command(s) logged in total.</div>';
  if (!suggestions.length) {
    html += '<div style="text-align:center;color:#94a3b8;font-size:12.5px;padding:20px 0">No repeated phrases yet. Say something 8+ times in 30 days and I\'ll suggest a shortcut here.</div>';
  } else {
    html += '<div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px">💡 Shortcut suggestions</div>';
    html += suggestions.map(function(s) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#f8fafc">' +
        '<div style="font-size:12.5px;color:#1e293b;flex:1">"' + _aimEsc(s.phrase) + '" <span style="color:#94a3b8;font-size:11px">×' + s.count + '</span></div>' +
        '<button class="ai-chip ai-chip-green" onclick="_aimUiPromoteVoice(\'' + s.phrase.replace(/'/g,"\\'") + '\')">Make shortcut</button>' +
        '</div>';
    }).join('');
  }
  return html;
}
function _aimUiPromoteVoice(phrase) {
  const inp = document.getElementById('aim-new-rule');
  // Promote to a one-tap chip by saving it as a quick-ask style memory fact note
  aimFactAdd('Frequent voice command: "' + phrase + '" — consider a one-tap shortcut for this.');
  if (typeof toast === 'function') toast('🎤 Saved as a memory note. Add a quick-chip for it from the Tools/Manager UI if you\'d like.');
}
