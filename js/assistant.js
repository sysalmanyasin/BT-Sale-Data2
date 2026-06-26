// ══════════════════════════════════════════════════════════════════════
// AI ASSISTANT — voice + text commands
// • Mic button uses Web Speech API (Chrome / Edge, no account needed)
// • Credit commands work without an API key (rule-based parser)
// • Gemini / Groq keys can be added in ⚙ Settings for smarter answers
// ══════════════════════════════════════════════════════════════════════

let _aiOpen     = false;
let _aiSettings = false;
let _aiHistory  = [];

// Mic state
let _aiMicActive = false;
let _aiMicRec    = null;

// ── Boot ─────────────────────────────────────────────────────────────────
window.addEventListener('load', function () {
  _aiInjectUI();
  _aiHistory.push({
    role: 'bot',
    text: 'Hi! I\u2019m your Sales Assistant \u2014 tap \uD83C\uDFA4 or type a command.' +
          '<br><br><b>What I can do:</b>' +
          '<br>\u2022 <em>Credit:</em> \u201cnote credit 2500 for Kashif\u201d' +
          '<br>\u2022 <em>Expense:</em> \u201cadd expense electricity 1200\u201d' +
          '<br>\u2022 <em>Petty:</em> \u201cadd patty item tea 150\u201d' +
          '<br>\u2022 <em>Jazz Cash / banks:</em> \u201cJazz Cash 5000\u201d' +
          '<br>\u2022 <em>Balance query:</em> \u201cKashif ka credit kitna hai\u201d' +
          '<br>\u2022 <em>Reports:</em> \u201cprint credit report\u201d' +
          '<br>\u2022 <em>Navigate:</em> \u201copen salary sheet\u201d' +
          '<br>\u2022 <em>Sales:</em> \u201ctotal this month\u201d, \u201ccompare June vs May\u201d' +
          (!aiHasKey()
            ? '<br><br><span style="color:var(--amber);font-size:11px;">\u26a1 Tip: add a Gemini or Groq key in \u2699\ufe0f Settings for full natural-language support.</span>'
            : ''),
  });
  _aiRender();
});

// ── UI injection ──────────────────────────────────────────────────────────
function _aiInjectUI() {
  if (document.getElementById('ai-fab')) return;

  const fab = document.createElement('button');
  fab.id        = 'ai-fab';
  fab.className = 'ai-fab';
  fab.title     = 'Sales Assistant';
  fab.innerHTML = '&#x1F916;';
  fab.onclick   = aiToggle;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id        = 'ai-panel';
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <!-- ── Chat view ── -->
    <div id="ai-chat-view" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
      <div class="ai-head">
        <div class="ai-head-title">&#x1F916; Sales Assistant</div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="ai-close" onclick="aiOpenSettings()" title="AI Settings">&#9881;</button>
          <button class="ai-close" onclick="aiToggle()">&#x2715;</button>
        </div>
      </div>
      <div id="ai-msgs" class="ai-msgs"></div>
      <div id="ai-quick" class="ai-quick"></div>
      <div class="ai-input-row">
        <button id="ai-mic-btn" class="ai-mic-btn" onclick="aiToggleMic()" title="Voice input (Chrome / Edge)">&#x1F3A4;</button>
        <input id="ai-input" type="text"
          placeholder="Ask or say: &#x201C;credit 2500 for Kashif&#x201D;\u2026"
          onkeydown="if(event.key==='Enter')aiSend()">
        <button class="btn btn-p" onclick="aiSend()" style="padding:0 14px;border-radius:9px">&#x27A4;</button>
      </div>
      <div id="ai-mic-status" style="font-size:10px;color:var(--muted);text-align:center;padding:0 12px 6px;display:none"></div>
    </div>

    <!-- ── Settings view ── -->
    <div id="ai-settings-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="ai-head">
        <div class="ai-head-title">&#9881; AI Settings</div>
        <button class="ai-close" onclick="aiCloseSettings()">&#x2715;</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 14px 8px">

        <div id="ai-key-status" style="margin-bottom:14px"></div>

        <div style="margin-bottom:12px">
          <label style="display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">Provider</label>
          <select id="ai-provider-select" style="width:100%;padding:9px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:var(--sans)">
            <option value="gemini">Gemini (Google) \u2014 Free tier available</option>
            <option value="groq">Groq (Llama 3.3) \u2014 Free tier available</option>
          </select>
        </div>

        <div style="margin-bottom:12px">
          <label style="display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">API Key</label>
          <div style="position:relative">
            <input id="ai-key-input" type="password"
              placeholder="Paste your API key here\u2026"
              style="width:100%;padding:9px 38px 9px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:var(--mono)">
            <button onclick="_aiToggleKeyVis()" title="Show/hide"
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0">&#x1F441;</button>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn btn-p" onclick="aiSaveSettings()" style="flex:1;font-size:13px;padding:9px 0">Save Key</button>
          <button class="btn" onclick="aiClearSettings()" style="border:1px solid var(--border);font-size:13px;padding:9px 14px;color:var(--muted)">Clear</button>
        </div>

        <div style="background:var(--alt);border:1px solid #bfdbfe;border-radius:9px;padding:10px 12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px">&#x1F512; Key stays on your device</div>
          <div style="font-size:11px;color:var(--t2);line-height:1.6">Saved in browser localStorage only. Sent directly to the AI provider — never to any other server.</div>
        </div>

        <div style="background:var(--glt);border:1px solid #6ee7b7;border-radius:9px;padding:10px 12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:4px">&#x1F3A4; Voice works without a key</div>
          <div style="font-size:11px;color:var(--t2);line-height:1.6">Credit commands like <em>\u201cnote credit 2500 for Kashif\u201d</em> are understood even with no API key.</div>
        </div>

        <div id="ai-get-key-links" style="margin-bottom:10px"></div>
      </div>
    </div>`;
  document.body.appendChild(panel);
  _aiSettingsPopulate();
}

// ── Panel toggle ──────────────────────────────────────────────────────────
function aiToggle() {
  _aiOpen = !_aiOpen;
  const panel = document.getElementById('ai-panel');
  if (panel) panel.classList.toggle('on', _aiOpen);
  if (_aiOpen) {
    _aiRenderQuick();
    setTimeout(function () { const i = document.getElementById('ai-input'); if (i) i.focus(); }, 150);
  } else {
    _aiStopMic();
    _aiSettings = false;
    _aiShowView('chat');
  }
}

// ── View switcher ─────────────────────────────────────────────────────────
function _aiShowView(which) {
  const chat = document.getElementById('ai-chat-view');
  const sett = document.getElementById('ai-settings-view');
  if (!chat || !sett) return;
  chat.style.display = which === 'chat' ? 'flex' : 'none';
  sett.style.display = which === 'settings' ? 'flex' : 'none';
}

// ── Settings open / close ─────────────────────────────────────────────────
function aiOpenSettings() {
  _aiSettings = true;
  _aiSettingsPopulate();
  _aiShowView('settings');
}
function aiCloseSettings() {
  _aiSettings = false;
  _aiShowView('chat');
}

function _aiSettingsPopulate() {
  const s = getAiSettings();
  const provSel = document.getElementById('ai-provider-select');
  const keyInp  = document.getElementById('ai-key-input');
  if (provSel) provSel.value = s.provider || 'gemini';
  if (keyInp)  keyInp.value  = s.apiKey   || '';
  _aiUpdateKeyStatus(s);
  const linksEl = document.getElementById('ai-get-key-links');
  if (linksEl) linksEl.innerHTML =
    '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Get a free key</div>' +
    '<div style="display:flex;flex-direction:column;gap:5px">' +
      '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent)">&#8599; Google AI Studio \u2014 Gemini keys</a>' +
      '<a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent)">&#8599; Groq Console \u2014 Llama 3 keys</a>' +
    '</div>';
}

function _aiUpdateKeyStatus(s) {
  const badge = document.getElementById('ai-key-status');
  if (!badge) return;
  const cur     = s || getAiSettings();
  const hasKey  = !!(cur.apiKey && cur.apiKey.trim());
  const provSel = document.getElementById('ai-provider-select');
  const prov    = (provSel ? provSel.value : cur.provider) || 'gemini';
  const label   = prov === 'groq' ? 'Groq (Llama 3.3)' : 'Gemini Flash';
  badge.innerHTML = hasKey
    ? '<div style="display:flex;align-items:center;gap:7px;background:var(--glt);border:1px solid #6ee7b7;border-radius:9px;padding:9px 12px"><span style="font-size:16px">&#x2705;</span><div><div style="font-size:12px;font-weight:700;color:var(--green)">' + label + ' key saved</div><div style="font-size:10px;color:var(--muted)">The assistant will use this key for all questions.</div></div></div>'
    : '<div style="display:flex;align-items:center;gap:7px;background:var(--alt2);border:1px solid #fcd34d;border-radius:9px;padding:9px 12px"><span style="font-size:16px">&#x26A0;&#xFE0F;</span><div><div style="font-size:12px;font-weight:700;color:var(--amber)">No key set</div><div style="font-size:10px;color:var(--muted)">Using built-in rule-based answers. Voice credit commands work without a key.</div></div></div>';
}

function aiSaveSettings() {
  const provSel = document.getElementById('ai-provider-select');
  const keyInp  = document.getElementById('ai-key-input');
  const provider = provSel ? provSel.value : 'gemini';
  const apiKey   = keyInp  ? keyInp.value.trim() : '';
  if (!apiKey) { _aiToast('Please paste an API key first.'); return; }
  saveAiSettings({ provider, apiKey });
  _aiUpdateKeyStatus({ provider, apiKey });
  _aiToast('\u2705 Key saved! Using ' + (provider === 'groq' ? 'Groq' : 'Gemini') + '.');
  setTimeout(aiCloseSettings, 900);
}

function aiClearSettings() {
  clearAiSettings();
  const keyInp = document.getElementById('ai-key-input');
  if (keyInp) keyInp.value = '';
  _aiUpdateKeyStatus({ provider: 'gemini', apiKey: '' });
  _aiToast('Key cleared. Using built-in answers.');
}

function _aiToggleKeyVis() {
  const inp = document.getElementById('ai-key-input');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── Voice input (Web Speech API) ──────────────────────────────────────────
function aiToggleMic() {
  if (_aiMicActive) { _aiStopMic(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _aiToast('Voice input not supported in this browser. Try Chrome or Edge.');
    return;
  }

  _aiMicRec      = new SR();
  _aiMicRec.lang = 'en-US';   // recognises mixed English; Urdu words are usually phonetically close
  _aiMicRec.interimResults = true;
  _aiMicRec.continuous     = false;
  _aiMicRec.maxAlternatives = 1;

  const micBtn    = document.getElementById('ai-mic-btn');
  const micStatus = document.getElementById('ai-mic-status');
  const inp       = document.getElementById('ai-input');

  _aiMicRec.onstart = function () {
    _aiMicActive = true;
    if (micBtn)    { micBtn.textContent = '\uD83D\uDD34'; micBtn.style.color = 'var(--red)'; }
    if (micStatus) { micStatus.textContent = '\uD83C\uDFA4 Listening\u2026 speak now'; micStatus.style.display = 'block'; }
    if (inp)       { inp.value = ''; inp.placeholder = 'Listening\u2026'; }
  };

  _aiMicRec.onresult = function (e) {
    const transcript = Array.from(e.results).map(function (r) { return r[0].transcript; }).join('');
    if (inp) inp.value = transcript;
  };

  _aiMicRec.onend = function () {
    _aiMicActive = false;
    if (micBtn)    { micBtn.textContent = '\uD83C\uDFA4'; micBtn.style.color = ''; }
    if (micStatus) { micStatus.style.display = 'none'; }
    if (inp)       { inp.placeholder = 'Ask or say: \u201Ccredit 2500 for Kashif\u201D\u2026'; }
    _aiMicRec = null;
    // Auto-send if something was recognised
    if (inp && inp.value.trim()) aiSend();
  };

  _aiMicRec.onerror = function (e) {
    _aiMicActive = false;
    if (micBtn)    { micBtn.textContent = '\uD83C\uDFA4'; micBtn.style.color = ''; }
    if (micStatus) { micStatus.style.display = 'none'; }
    if (inp)       { inp.placeholder = 'Ask or say: \u201Ccredit 2500 for Kashif\u201D\u2026'; }
    _aiMicRec = null;
    const friendly = {
      'not-allowed': 'Microphone permission denied. Allow mic access and try again.',
      'no-speech':   'No speech detected. Try again.',
      'network':     'Network error during voice recognition.',
    };
    _aiToast('\uD83C\uDFA4 ' + (friendly[e.error] || ('Voice error: ' + e.error)));
  };

  _aiMicRec.start();
}

function _aiStopMic() {
  if (_aiMicRec) {
    try { _aiMicRec.stop(); } catch (_) {}
    _aiMicRec = null;
  }
  _aiMicActive = false;
  const micBtn    = document.getElementById('ai-mic-btn');
  const micStatus = document.getElementById('ai-mic-status');
  if (micBtn)    { micBtn.textContent = '\uD83C\uDFA4'; micBtn.style.color = ''; }
  if (micStatus) { micStatus.style.display = 'none'; }
}

// ── Quick chips ───────────────────────────────────────────────────────────
function _aiRenderQuick() {
  const onEntry  = !!document.getElementById('e-TOTAL');
  const onMgr    = !!document.getElementById('mgr-tabs');
  let opts;
  if (onEntry) {
    opts = ['Check this entry', 'Jazz Cash 5000', 'HBL 12000', 'What is Cash to be Deposited?'];
  } else if (onMgr) {
    opts = ['Credit 2500 for Kashif', 'Kashif ka credit kitna hai', 'Add patty tea 150', 'Print credit report'];
  } else {
    opts = ['Credit 2500 for Kashif', 'Add expense electricity 1200', 'Total sales this month', 'Open salary sheet'];
  }
  const q = document.getElementById('ai-quick');
  if (!q) return;
  q.innerHTML = opts.map(function (o) {
    return '<button class="ai-chip" onclick="aiAsk(\'' + o.replace(/'/g, "\\'") + '\')">' + o + '</button>';
  }).join('');
}

function aiAsk(text) {
  const inp = document.getElementById('ai-input');
  if (inp) inp.value = text;
  aiSend();
}

// ── Send ──────────────────────────────────────────────────────────────────
async function aiSend() {
  const input = document.getElementById('ai-input');
  const text  = (input ? input.value : '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.disabled = true; }

  _aiHistory.push({ role: 'user', text: text });
  _aiRender();

  const thinkId = '_think_' + Date.now();
  _aiHistory.push({ role: 'bot', text: '\u2026', _id: thinkId });
  _aiRender();

  try {
    const result = await aiBridgeAnswer(text);
    const idx = _aiHistory.findIndex(function (m) { return m._id === thinkId; });
    if (idx !== -1) _aiHistory.splice(idx, 1);

    let displayText = result.text;
    if (result.intent) {
      const label      = _aiIntentLabel(result.intent);
      const safeIntent = JSON.stringify(result.intent).replace(/"/g, '&quot;');
      displayText += '<div class="ai-intent-row">' +
        '<button class="ai-chip" onclick="aiBridgeExecuteIntent(' + safeIntent + ');this.parentNode.remove()">' + label + '</button>' +
        '<button class="ai-chip ai-chip-dim" onclick="this.parentNode.remove()">No thanks</button>' +
        '</div>';
    }
    _aiHistory.push({ role: 'bot', text: displayText });
  } catch (err) {
    const idx = _aiHistory.findIndex(function (m) { return m._id === thinkId; });
    if (idx !== -1) _aiHistory.splice(idx, 1);
    _aiHistory.push({ role: 'bot', text: 'Sorry, something went wrong (' + err.message + ').' });
  }

  if (input) input.disabled = false;
  _aiRender();
}

function _aiIntentLabel(intent) {
  const labels = {
    showPage:          'Open page',
    openDayModal:      'Open day report',
    openMonthModal:    'Open month report',
    printMonthReport:  'Print month report',
    printYearlyReport: 'Print yearly report',
    switchMgrTab:      'Switch manager tab',
    addCredit:         '\u2705 Yes, add this credit',
  };
  return labels[intent.action] || intent.action;
}

function _aiRender() {
  const box = document.getElementById('ai-msgs');
  if (!box) return;
  box.innerHTML = _aiHistory.map(function (m) {
    return '<div class="ai-msg ' + m.role + '"><div class="ai-bubble">' + m.text + '</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// ── Inline toast ──────────────────────────────────────────────────────────
function _aiToast(msg) {
  let t = document.getElementById('ai-settings-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ai-settings-toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
      'background:#1e293b;color:#fff;font-size:12px;padding:8px 16px;border-radius:20px;' +
      'z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.3)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(function () { t.style.opacity = '0'; }, 2600);
}

// ── Rule-based engine (fallback when no LLM key is set) ───────────────────
function _aiAnswer(q) {
  try {
    const ctx = getAppContext();
    const ql  = q.toLowerCase();
    if (document.getElementById('e-TOTAL') && /check|review|look at|this entry/.test(ql)) return _aiCheckCurrentEntry(ctx);
    if (/cash to be deposited/.test(ql)) return 'Cash to be Deposited = Cash Sale (after Cash Returns) minus Amount Received \u2014 the physical cash left to bank after settlements.';
    if (/comp sale|diff/.test(ql)) return 'DIFF = Total Sale \u2212 COMP SALE. It flags mismatches between your recorded total and the pump computer reading for that month.';
    if (/top client/.test(ql)) return _aiTopClient(ql, ctx);
    if (/compare|vs\b|versus/.test(ql)) return _aiCompareMonths(ql, ctx);
    if (/unusual|anomal|outlier|odd day/.test(ql)) return _aiFindAnomalies(ctx);
    if (/total|sales?\b/.test(ql) && /(this month|today|so far|current)/.test(ql)) return _aiThisMonthTotal(ctx);
    if (/total|sales?\b/.test(ql)) return _aiGeneralTotal(ql, ctx);
    if (/average|avg/.test(ql)) return _aiAverage(ctx);
    if (/forecast|project|predict/.test(ql)) return _aiForecast(ctx);
    if (/help|what can you/.test(ql)) return 'I can: answer sales questions, compare months, spot anomalies, add staff credit entries (say \u201ccredit 2500 for Kashif\u201d), and navigate the app. Add a Gemini or Groq key in \u2699\ufe0f Settings for full natural-language support.';
    return "I didn\u2019t quite catch that. Try: \u201ctotal sales last month\u201d, \u201ctop client this month\u201d, \u201ccredit 2500 for Kashif\u201d, or \u201ccheck this entry\u201d while filling the Daily Entry form.";
  } catch (e) {
    return 'Sorry, I hit a snag reading the data (' + e.message + '). Make sure your data has loaded, then try again.';
  }
}

function _aiFindMonthByName(ql, M) {
  if (!M || !M.length) return null;
  for (const m of M) if (ql.includes(m.Month_Year.toLowerCase())) return m;
  for (const nm of BTDate.monthNames) {
    if (ql.includes(nm.toLowerCase())) {
      const matches = M.filter(function (m) { return m.Month_Year.toLowerCase().startsWith(nm.toLowerCase()); });
      if (matches.length) return matches[matches.length - 1];
    }
  }
  if (/this month|current/.test(ql)) return M[M.length - 1];
  if (/last month|previous/.test(ql)) return M[M.length - 2] || null;
  return null;
}

function _aiThisMonthTotal(ctx) {
  const M = ctx.monthly;
  if (!M.length) return 'No monthly data loaded yet.';
  const m = M[M.length - 1];
  return m.Month_Year + ': total sales so far are <b>' + BTFormat.plain(BTFormat.num(m.TOTAL)) + '</b>.';
}

function _aiGeneralTotal(ql, ctx) {
  const M = ctx.monthly;
  const m = _aiFindMonthByName(ql, M);
  if (m) return 'Total sales for <b>' + m.Month_Year + '</b>: <b>\u20a8 ' + BTFormat.plain(BTFormat.num(m.TOTAL)) + '</b>.';
  if (!M.length) return 'No monthly data loaded yet.';
  return "I couldn\u2019t spot a specific month. Grand total across all " + M.length + " months: <b>\u20a8 " + BTFormat.plain(BTCalc.grandTotal(M)) + "</b>.";
}

function _aiAverage(ctx) {
  const M = ctx.monthly;
  if (!M.length) return 'No monthly data loaded yet.';
  return 'Average monthly sales across ' + M.length + ' months: <b>\u20a8 ' + BTFormat.plain(BTCalc.monthlyAverage(M)) + '</b>.';
}

function _aiForecast(ctx) {
  const M = ctx.monthly, D = ctx.daily;
  if (!M.length) return 'No monthly data loaded yet.';
  const latest = M[M.length - 1];
  return 'Projected month-end for <b>' + latest.Month_Year + '</b>: <b>\u20a8 ' + BTFormat.plain(BTCalc.forecastTotal(latest, D)) + '</b> (currently \u20a8 ' + BTFormat.plain(BTFormat.num(latest.TOTAL)) + ').';
}

function _aiTopClient(ql, ctx) {
  const M = ctx.monthly;
  const m = _aiFindMonthByName(ql, M) || M[M.length - 1];
  if (!m) return 'No monthly data loaded yet.';
  let best = null, bestVal = -Infinity;
  (ctx.clientCols || []).forEach(function (c) { const v = BTFormat.num(m[c]); if (v > bestVal) { bestVal = v; best = c; } });
  if (!best || bestVal <= 0) return 'No positive credit-client sales for ' + m.Month_Year + '.';
  return 'Top client in <b>' + m.Month_Year + '</b>: <b>' + best + '</b> at <b>\u20a8 ' + BTFormat.plain(bestVal) + '</b>.';
}

function _aiCompareMonths(ql, ctx) {
  const M = ctx.monthly;
  if (M.length < 2) return 'Need at least two months of data to compare.';
  const found = [];
  for (const nm of BTDate.monthNames) {
    if (ql.includes(nm.toLowerCase())) {
      const match = M.filter(function (m) { return m.Month_Year.toLowerCase().startsWith(nm.toLowerCase()); });
      if (match.length) found.push(match[match.length - 1]);
    }
  }
  const a = found[0] || M[M.length - 1], b = found[1] || M[M.length - 2];
  const ta = BTFormat.num(a.TOTAL), tb = BTFormat.num(b.TOTAL), diff = ta - tb;
  return '<b>' + a.Month_Year + '</b>: \u20a8 ' + BTFormat.plain(ta) + ' vs <b>' + b.Month_Year + '</b>: \u20a8 ' + BTFormat.plain(tb) + ' \u2014 ' + (diff >= 0 ? 'up' : 'down') + ' \u20a8 ' + BTFormat.plain(Math.abs(diff)) + ' (' + (tb ? (diff/tb*100).toFixed(1) : '\u2014') + '%).';
}

function _aiFindAnomalies(ctx) {
  const D = ctx.daily;
  if (D.length < 5) return 'Not enough daily data yet.';
  const recent = D.slice(-30), vals = recent.map(function (d) { return BTFormat.num(d.TOTAL); });
  const avg = vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
  const sd  = Math.sqrt(vals.reduce(function (s, v) { return s + (v - avg) ** 2; }, 0) / vals.length) || 1;
  const flagged = recent.filter(function (d) { return Math.abs(BTFormat.num(d.TOTAL) - avg) > 1.8 * sd; });
  if (!flagged.length) return 'Nothing unusual in the last ' + recent.length + ' days (avg \u20a8 ' + BTFormat.plain(avg) + ').';
  return 'Found ' + flagged.length + ' day(s) outside normal range:<br>' + flagged.slice(0, 5).map(function (d) { return '\u2022 ' + d.Date + ': \u20a8 ' + BTFormat.plain(BTFormat.num(d.TOTAL)); }).join('<br>');
}

function _aiCheckCurrentEntry(ctx) {
  const get    = function (id) { const el = document.getElementById('e-' + id); return el ? BTFormat.num(el.value) : 0; };
  const issues = [];
  if (get('Cash_Returns') > 0) issues.push('\u201cCash Returns\u201d is positive \u2014 it should usually be 0 or negative.');
  const total = (function () { const el = document.getElementById('e-TOTAL'); return el ? BTFormat.num(el.value) : 0; })();
  if (total === 0) issues.push('Total is 0 \u2014 no values entered yet.');
  if (get('Customers') === 0 && total > 0) issues.push('Customers is 0 but total is non-zero \u2014 worth double-checking.');
  const M = ctx.monthly;
  if (M.length) {
    const m = M[M.length - 1];
    const days = ctx.daily.filter(function (d) { return d.Month_Year === m.Month_Year; });
    if (days.length >= 3) {
      const avg = days.reduce(function (s, d) { return s + BTFormat.num(d.TOTAL); }, 0) / days.length;
      if (avg > 0 && total > 0 && Math.abs(total - avg) > avg * 0.5)
        issues.push("Today\u2019s total (\u20a8 " + BTFormat.plain(total) + ") is notably " + (total > avg ? 'higher' : 'lower') + " than the monthly average (\u20a8 " + BTFormat.plain(avg) + ").");
    }
  }
  return issues.length ? 'A few things to double-check:<br>' + issues.map(function (i) { return '\u2022 ' + i; }).join('<br>') : 'Looks good \u2014 no obvious issues.';
}
