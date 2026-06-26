// ══════════════════════════════════════════════════════════════════════
// AI ASSISTANT v5 — Groq-Powered, redesigned UI
// ══════════════════════════════════════════════════════════════════════

let _aiOpen     = false;
let _aiHistory  = [];
let _aiMicActive = false;
let _aiMicRec    = null;

// ── Boot ─────────────────────────────────────────────────────────────────
window.addEventListener('load', function () {
  _aiInjectUI();
  _aiHistory.push({
    role: 'bot',
    text: '\uD83D\uDC4B I\u2019m your <b>Groq AI assistant</b> for Bahria Town Sales IC.' +
          '<br><br><b>Try asking:</b>' +
          '<br>\u2022 \u201cSale of 22nd June?\u201d' +
          '<br>\u2022 \u201cWhich day had highest sale?\u201d' +
          '<br>\u2022 \u201cJazz Cash 5000\u201d \u2192 adds to custom section' +
          '<br>\u2022 \u201cCredit 2500 for Kashif\u201d' +
          '<br>\u2022 \u201cAdd expense electricity 1500\u201d' +
          '<br>\u2022 \u201cLoad sale kitna hai is mahine?\u201d' +
          '<br>\u2022 \u201cYearly sales totals\u201d' +
          '<br>\u2022 \u201cCompare June vs May\u201d' +
          '<br>\u2022 \u201cPrint credit report\u201d',
  });
  _aiRender();
});

// ── UI injection ──────────────────────────────────────────────────────────
function _aiInjectUI() {
  if (document.getElementById('ai-fab')) return;

  // Backdrop
  const bd = document.createElement('div');
  bd.id        = 'ai-backdrop';
  bd.className = 'ai-backdrop';
  bd.onclick   = aiToggle;
  document.body.appendChild(bd);

  // FAB
  const fab = document.createElement('button');
  fab.id        = 'ai-fab';
  fab.className = 'ai-fab';
  fab.title     = 'AI Assistant (Groq)';
  fab.innerHTML = '\uD83E\uDD16<span class="ai-fab-ping"></span>';
  fab.onclick   = aiToggle;
  document.body.appendChild(fab);

  // Panel
  const panel = document.createElement('div');
  panel.id        = 'ai-panel';
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <div class="ai-head">
      <div class="ai-head-title">
        \uD83E\uDD16 Sales AI Assistant
        <span class="ai-head-badge">GROQ</span>
      </div>
      <button class="ai-close" onclick="aiToggle()">\u2715</button>
    </div>

    <div id="ai-msgs" class="ai-msgs"></div>

    <div id="ai-ctx-strip" class="ai-ctx-strip" style="display:none">
      \u26a1 <span id="ai-ctx-label">Ready</span>
    </div>

    <div id="ai-quick" class="ai-quick"></div>

    <div class="ai-input-row">
      <button id="ai-mic-btn" class="ai-mic-btn" onclick="aiToggleMic()" title="Voice (Chrome/Edge)">\uD83C\uDFA4</button>
      <input id="ai-input" type="text"
        placeholder='Ask: \u201chighest sale day\u201d, \u201cJazz Cash 5000\u201d\u2026'
        onkeydown="if(event.key==='Enter')aiSend()">
      <button class="ai-send-btn" onclick="aiSend()">\u27A4</button>
    </div>`;
  document.body.appendChild(panel);
}

// ── Panel toggle ──────────────────────────────────────────────────────────
function aiToggle() {
  _aiOpen = !_aiOpen;
  const panel = document.getElementById('ai-panel');
  const bd    = document.getElementById('ai-backdrop');
  if (panel) panel.classList.toggle('on', _aiOpen);
  if (bd)    bd.classList.toggle('on', _aiOpen);
  if (_aiOpen) {
    _aiUpdateCtxStrip();
    _aiRenderQuick();
    setTimeout(function () { const i = document.getElementById('ai-input'); if (i) i.focus(); }, 200);
  } else {
    _aiStopMic();
  }
}

// ── Context strip (shows current page) ───────────────────────────────────
function _aiUpdateCtxStrip() {
  try {
    const page  = typeof window._curPage !== 'undefined' ? window._curPage : '';
    const strip = document.getElementById('ai-ctx-strip');
    const label = document.getElementById('ai-ctx-label');
    if (!strip || !label) return;
    const M = (typeof window.MONTHLY !== 'undefined' && window.MONTHLY) ? window.MONTHLY : [];
    const D = (typeof window.DAILY   !== 'undefined' && window.DAILY)   ? window.DAILY   : [];
    const info = M.length ? M.length + ' months, ' + D.length + ' days loaded' : 'No data loaded yet';
    label.textContent = info + (page ? ' \u2022 ' + page : '');
    strip.style.display = '';
  } catch (_) {}
}

// ── Voice input ───────────────────────────────────────────────────────────
function aiToggleMic() {
  if (_aiMicActive) { _aiStopMic(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _aiShowToast('Voice input not supported. Try Chrome or Edge.'); return; }
  _aiMicRec = new SR();
  _aiMicRec.lang = 'en-US';
  _aiMicRec.interimResults = true;
  _aiMicRec.continuous     = false;
  _aiMicRec.maxAlternatives = 1;
  const micBtn = document.getElementById('ai-mic-btn');
  const inp    = document.getElementById('ai-input');
  _aiMicRec.onstart = function () {
    _aiMicActive = true;
    if (micBtn) { micBtn.textContent = '\uD83D\uDD34'; micBtn.classList.add('recording'); }
    if (inp) { inp.value = ''; inp.placeholder = 'Listening\u2026'; }
  };
  _aiMicRec.onresult = function (e) {
    const t = Array.from(e.results).map(function (r) { return r[0].transcript; }).join('');
    if (inp) inp.value = t;
  };
  _aiMicRec.onend = function () {
    _aiMicActive = false;
    if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
    if (inp) inp.placeholder = 'Ask: \u201chighest sale day\u201d, \u201cJazz Cash 5000\u201d\u2026';
    _aiMicRec = null;
    if (inp && inp.value.trim()) aiSend();
  };
  _aiMicRec.onerror = function (e) {
    _aiMicActive = false;
    if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
    _aiMicRec = null;
    const friendly = { 'not-allowed': 'Mic permission denied.', 'no-speech': 'No speech detected.', 'network': 'Network error.' };
    _aiShowToast('\uD83C\uDFA4 ' + (friendly[e.error] || ('Error: ' + e.error)));
  };
  _aiMicRec.start();
}
function _aiStopMic() {
  if (_aiMicRec) { try { _aiMicRec.stop(); } catch (_) {} _aiMicRec = null; }
  _aiMicActive = false;
  const micBtn = document.getElementById('ai-mic-btn');
  if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
}

// ── Quick chips ───────────────────────────────────────────────────────────
function _aiRenderQuick() {
  const page = (typeof window._curPage !== 'undefined') ? window._curPage : '';
  let opts;
  if (page === 'entry') {
    opts = ['Check this entry', 'Jazz Cash 5000', 'HBL 12000', 'Load sale kitna?', 'What is DIFF?'];
  } else if (page === 'manager') {
    opts = ['Credit 2500 for Kashif', 'Jazz Cash custom 5000', 'Add petty tea 150', 'Print credit report'];
  } else if (page === 'dashboard' || page === 'index') {
    opts = ['Highest sale day?', 'Yearly totals', 'Compare June vs May', 'Best month ever?'];
  } else if (page === 'data' || page === 'report') {
    opts = ['Sale of 22nd June?', 'This month total', 'Unusual days?', 'Average daily sale?'];
  } else {
    opts = ['Highest sale day?', 'Jazz Cash 5000', 'Credit 2500 for Kashif', 'Yearly totals'];
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

  _aiHistory.push({ role: 'user', text: _aiEsc(text) });
  _aiRender();

  const thinkId = '_think_' + Date.now();
  _aiHistory.push({
    role: 'bot',
    text: '<div class="ai-typing"><span></span><span></span><span></span></div>',
    _id: thinkId,
  });
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
        '<button class="ai-chip ai-chip-green" onclick="aiBridgeExecuteIntent(JSON.parse(this.dataset.i));this.parentNode.remove()" data-i="' + JSON.stringify(result.intent).replace(/"/g,'&quot;') + '">' + label + '</button>' +
        '<button class="ai-chip-dim" onclick="this.parentNode.remove()">No thanks</button>' +
        '</div>';
    }
    _aiHistory.push({ role: 'bot', text: displayText });
  } catch (err) {
    const idx = _aiHistory.findIndex(function (m) { return m._id === thinkId; });
    if (idx !== -1) _aiHistory.splice(idx, 1);
    _aiHistory.push({ role: 'bot', text: '\u26a0\ufe0f Something went wrong: ' + _aiEsc(err.message) });
  }

  if (input) input.disabled = false;
  _aiRender();
  _aiUpdateCtxStrip();
}

function _aiIntentLabel(intent) {
  const labels = {
    showPage:             '\u2192 Open page',
    openDayModal:         '\uD83D\uDCCB Open day report',
    openMonthModal:       '\uD83D\uDCCB Open month report',
    printMonthReport:     '\uD83D\uDDA8\uFE0F Print month',
    printYearlyReport:    '\uD83D\uDDA8\uFE0F Print year',
    switchMgrTab:         '\u2192 Switch tab',
    addCredit:            '\u2705 Yes, add credit',
    addExpense:           '\u2705 Yes, add expense',
    addPettyItem:         '\u2705 Yes, add petty item',
    setDailyField:        '\u2705 Yes, fill field',
    addCustomSectionRow:  '\u2705 Yes, add to section',
    printMgrReport:       '\uD83D\uDDA8\uFE0F Print report',
  };
  return labels[intent.action] || intent.action;
}

function _aiEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _aiRender() {
  const box = document.getElementById('ai-msgs');
  if (!box) return;
  box.innerHTML = _aiHistory.map(function (m) {
    return '<div class="ai-msg ' + m.role + '"><div class="ai-bubble">' + m.text + '</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function _aiShowToast(msg) {
  let t = document.getElementById('ai-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ai-toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
      'background:#1e293b;color:#fff;font-size:12px;padding:9px 18px;border-radius:24px;' +
      'z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.3)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(function () { t.style.opacity = '0'; }, 2800);
}

// ── Public API ────────────────────────────────────────────────────────────
function aiOpenFromCommandHub(prefill) {
  if (!_aiOpen) aiToggle();
  if (prefill) {
    setTimeout(function () {
      const inp = document.getElementById('ai-input');
      if (inp) { inp.value = prefill; inp.focus(); }
    }, 250);
  }
}

// ── Settings stubs (no longer needed — Groq is permanent) ─────────────────
function aiOpenSettings()  {}
function aiCloseSettings() {}
function aiSaveSettings()  {}
function aiClearSettings() {}
