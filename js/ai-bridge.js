// ══════════════════════════════════════════════════════════════════════
// AIBridge — Direct browser AI calls (Gemini / Groq)
// API key entered once in Settings → stored in localStorage only.
// Falls back to the rule-based engine (_aiAnswer) when no key is set
// or when the LLM call fails.
// ══════════════════════════════════════════════════════════════════════

// ── Intent whitelist — AI may only trigger actions from this approved list.
const AI_SAFE_INTENTS = new Set([
  'showPage',
  'openDayModal',
  'openMonthModal',
  'printMonthReport',
  'printYearlyReport',
  'switchMgrTab',
]);

// ── Settings helpers ──────────────────────────────────────────────────────
const AI_SETTINGS_KEY = 'bt_ai_settings';

function getAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { provider: 'gemini', apiKey: '' };
}

function saveAiSettings(settings) {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}

function clearAiSettings() {
  try { localStorage.removeItem(AI_SETTINGS_KEY); } catch (_) {}
}

function aiHasKey() {
  const s = getAiSettings();
  return !!(s && s.apiKey && s.apiKey.trim().length > 0);
}

// ── Prompt builder ────────────────────────────────────────────────────────
function _buildLlmPrompt(question) {
  let ctx = '';
  try {
    const snap = (typeof getAppContextSummary === 'function')
      ? getAppContextSummary({ fullMonths: 3 })
      : null;
    if (snap) ctx = '\n\nDATA CONTEXT (JSON):\n' + JSON.stringify(snap).slice(0, 6000);
  } catch (_) {}

  return (
    'You are an AI assistant for "Bahria Town Sales IC", a petrol station sales tracking app.' +
    ' The app tracks daily and monthly sales data including cash sales, bank deposits, credit clients, and customer counts.' +
    ' Answer the user\'s question concisely using the data context below.' +
    ' If the question asks to navigate to a page or open a report, include an intent object.' +
    ' Reply ONLY with a JSON object in this exact shape:' +
    ' {"text":"<your answer>","intent":null}' +
    ' OR {"text":"<your answer>","intent":{"action":"showPage","params":["dashboard"]}}' +
    ' Valid intent actions: showPage (params: page name), openDayModal (params: [date, monthYear]),' +
    ' openMonthModal (params: [monthYear]), printMonthReport (params: [monthYear]),' +
    ' printYearlyReport (params: [year]), switchMgrTab (params: [tabName]).' +
    ' If no navigation is needed, intent must be null.' +
    ' Keep "text" under 200 words. Do not wrap in markdown.' +
    ctx +
    '\n\nUSER QUESTION: ' + question
  );
}

// ── Gemini (generativelanguage.googleapis.com) ────────────────────────────
async function _callGemini(apiKey, question) {
  const model = 'gemini-2.0-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              model + ':generateContent?key=' + encodeURIComponent(apiKey);
  const prompt = _buildLlmPrompt(question);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Gemini ' + res.status + ': ' + (err.error && err.error.message ? err.error.message : res.statusText));
  }

  const data = await res.json();
  const raw = data.candidates &&
              data.candidates[0] &&
              data.candidates[0].content &&
              data.candidates[0].content.parts &&
              data.candidates[0].content.parts[0] &&
              data.candidates[0].content.parts[0].text;
  if (!raw) throw new Error('Gemini returned an empty response.');
  return _parseLlmResponse(raw);
}

// ── Groq (OpenAI-compatible) ──────────────────────────────────────────────
async function _callGroq(apiKey, question) {
  const model = 'llama-3.3-70b-versatile';
  const prompt = _buildLlmPrompt(question);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Groq ' + res.status + ': ' + (err.error && err.error.message ? err.error.message : res.statusText));
  }

  const data = await res.json();
  const raw = data.choices &&
              data.choices[0] &&
              data.choices[0].message &&
              data.choices[0].message.content;
  if (!raw) throw new Error('Groq returned an empty response.');
  return _parseLlmResponse(raw);
}

// ── Response parser ───────────────────────────────────────────────────────
function _parseLlmResponse(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.intent && !AI_SAFE_INTENTS.has(parsed.intent.action)) {
      parsed.intent = null;
    }
    return { text: parsed.text || cleaned, intent: parsed.intent || null };
  } catch (_) {
    return { text: cleaned, intent: null };
  }
}

// ── Main bridge ───────────────────────────────────────────────────────────
async function aiBridgeAnswer(text) {
  try {
    const settings = getAiSettings();

    if (settings.apiKey && settings.apiKey.trim()) {
      try {
        if (settings.provider === 'groq') {
          return await _callGroq(settings.apiKey.trim(), text);
        } else {
          return await _callGemini(settings.apiKey.trim(), text);
        }
      } catch (llmErr) {
        return {
          text: '\u26a0\ufe0f AI call failed: ' + llmErr.message +
                ' \u2014 falling back to built-in answers. Check your key in Settings.',
          intent: null,
        };
      }
    }

    // No key — use rule-based engine
    const reply = (typeof _aiAnswer === 'function')
      ? _aiAnswer(text)
      : 'Data not loaded yet. Please wait and try again.';
    return { text: reply, intent: null };

  } catch (err) {
    return { text: 'Sorry, I hit a snag (' + err.message + '). Please try again.', intent: null };
  }
}

// ── Intent executor (called by the app shell, never by AI directly) ───────
function aiBridgeExecuteIntent(intent) {
  if (!intent || !AI_SAFE_INTENTS.has(intent.action)) return;
  const params = intent.params || [];
  try {
    switch (intent.action) {
      case 'showPage':
        if (typeof showPage === 'function') showPage(params[0]);
        break;
      case 'openDayModal':
        if (typeof openDayModal === 'function') openDayModal(params[0], params[1]);
        break;
      case 'openMonthModal':
        if (typeof openMonthModal === 'function') openMonthModal(params[0]);
        break;
      case 'printMonthReport':
        if (typeof printMonthReport === 'function') printMonthReport(params[0]);
        break;
      case 'printYearlyReport':
        if (typeof printYearlyReport === 'function') printYearlyReport(params[0]);
        break;
      case 'switchMgrTab':
        if (typeof switchMgrTab === 'function') switchMgrTab(params[0]);
        break;
    }
  } catch (e) {
    if (typeof toast === 'function') toast('\u26a0 Could not execute action: ' + e.message, 'w');
  }
}
