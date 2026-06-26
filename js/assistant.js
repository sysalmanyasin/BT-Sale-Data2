// ══════════════════════════════════════════════════════════════════════
// AI ASSISTANT — uses AppContext + BTFormat + AIBridge
// Supports direct Gemini / Groq calls via user-supplied API key.
// Key is stored in localStorage only — never sent to any server.
// ══════════════════════════════════════════════════════════════════════

let _aiOpen     = false;
let _aiSettings = false; // true when settings sub-panel is visible
let _aiHistory  = []; // [{role:'user'|'bot', text, _id?}]

// ── Boot ─────────────────────────────────────────────────────────────────
window.addEventListener('load', function () {
  _aiInjectUI();
  _aiHistory.push({
    role: 'bot',
    text: "Hi! I\u2019m your Sales Assistant. Ask me things like \u201ctotal sales this month\u201d, \u201ctop client last month\u201d, \u201ccompare June vs May\u201d, or open the Daily Entry form and I\u2019ll flag anything unusual as you type." +
          (!aiHasKey()
            ? '<br><br><span style="color:var(--amber);font-size:11px;">&#9889; Tip: tap &#9881; Settings to add a Gemini or Groq key for smarter AI answers.</span>'
            : ''),
  });
  _aiRender();
});

// ── UI injection ──────────────────────────────────────────────────────────
function _aiInjectUI() {
  if (document.getElementById('ai-fab')) return;

  // Floating action button
  const fab = document.createElement('button');
  fab.id        = 'ai-fab';
  fab.className = 'ai-fab';
  fab.title     = 'Sales Assistant';
  fab.innerHTML = '&#x1F916;';
  fab.onclick   = aiToggle;
  document.body.appendChild(fab);

  // Panel
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
        <input id="ai-input" type="text" placeholder="Ask about your sales data\u2026" onkeydown="if(event.key==='Enter')aiSend()">
        <button class="btn btn-p" onclick="aiSend()">&#x27A4;</button>
      </div>
    </div>

    <!-- ── Settings view ── -->
    <div id="ai-settings-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
      <div class="ai-head">
        <div class="ai-head-title">&#9881; AI Settings</div>
        <button class="ai-close" onclick="aiCloseSettings()">&#x2715;</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 14px 8px">

        <!-- Status badge -->
        <div id="ai-key-status" style="margin-bottom:14px"></div>

        <!-- Provider picker -->
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">Provider</label>
          <select id="ai-provider-select" style="width:100%;padding:9px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:var(--sans)">
            <option value="gemini">Gemini (Google) — Free tier available</option>
            <option value="groq">Groq (Llama 3.3) — Free tier available</option>
          </select>
        </div>

        <!-- API key input -->
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:5px">API Key</label>
          <div style="position:relative">
            <input id="ai-key-input" type="password"
              placeholder="Paste your API key here\u2026"
              style="width:100%;padding:9px 38px 9px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:13px;font-family:var(--mono)">
            <button onclick="_aiToggleKeyVis()" title="Show/hide key"
              style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0">&#x1F441;</button>
          </div>
        </div>

        <!-- Save / Clear buttons -->
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn btn-p" onclick="aiSaveSettings()" style="flex:1;font-size:13px;padding:9px 0">Save Key</button>
          <button class="btn" onclick="aiClearSettings()" style="border:1px solid var(--border);font-size:13px;padding:9px 14px;color:var(--muted)">Clear</button>
        </div>

        <!-- Privacy note -->
        <div style="background:var(--alt);border:1px solid #bfdbfe;border-radius:9px;padding:10px 12px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:4px">&#x1F512; Your key stays on your device</div>
          <div style="font-size:11px;color:var(--t2);line-height:1.6">The API key is saved in your browser\u2019s localStorage only. It is sent directly to the AI provider \u2014 never to any other server.</div>
        </div>

        <!-- Get key links -->
        <div id="ai-get-key-links" style="margin-bottom:10px"></div>

      </div>
    </div>`;
  document.body.appendChild(panel);

  // Populate settings view with saved values
  _aiSettingsPopulate();
}

// ── Panel toggle ──────────────────────────────────────────────────────────
function aiToggle() {
  _aiOpen = !_aiOpen;
  const panel = document.getElementById('ai-panel');
  if (panel) panel.classList.toggle('on', _aiOpen);
  if (_aiOpen) {
    _aiRenderQuick();
    setTimeout(() => { const i = document.getElementById('ai-input'); if (i) i.focus(); }, 150);
  } else {
    _aiSettings = false;
    _aiShowView('chat');
  }
}

// ── Settings open/close ───────────────────────────────────────────────────
function aiOpenSettings() {
  _aiSettings = true;
  _aiSettingsPopulate();
  _aiShowView('settings');
}

function aiCloseSettings() {
  _aiSettings = false;
  _aiShowView('chat');
}

function _aiShowView(which) {
  const chat = document.getElementById('ai-chat-view');
  const sett = document.getElementById('ai-settings-view');
  if (!chat || !sett) return;
  if (which === 'settings') {
    chat.style.display = 'none';
    sett.style.display = 'flex';
  } else {
    chat.style.display = 'flex';
    sett.style.display = 'none';
  }
}

// ── Populate settings form from stored values ─────────────────────────────
function _aiSettingsPopulate() {
  const s = getAiSettings();
  const provSel = document.getElementById('ai-provider-select');
  const keyInp  = document.getElementById('ai-key-input');
  if (provSel) provSel.value = s.provider || 'gemini';
  if (keyInp)  keyInp.value  = s.apiKey   || '';

  // Update status badge
  _aiUpdateKeyStatus(s);

  // Update get-key links
  const linksEl = document.getElementById('ai-get-key-links');
  if (linksEl) {
    linksEl.innerHTML =
      '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Get a free key</div>' +
      '<div style="display:flex;flex-direction:column;gap:5px">' +
        '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);text-decoration:none">' +
          '&#8599; Google AI Studio &mdash; Gemini keys</a>' +
        '<a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent);text-decoration:none">' +
          '&#8599; Groq Console &mdash; Llama 3 keys</a>' +
      '</div>';
  }

  // Also update provider selector listener
  const sel = document.getElementById('ai-provider-select');
  if (sel) sel.onchange = function () { _aiUpdateKeyStatus(null); };
}

function _aiUpdateKeyStatus(s) {
  const badge = document.getElementById('ai-key-status');
  if (!badge) return;
  const current = s || getAiSettings();
  const hasKey  = !!(current.apiKey && current.apiKey.trim());
  const provSel = document.getElementById('ai-provider-select');
  const prov    = (provSel ? provSel.value : current.provider) || 'gemini';
  const provLabel = prov === 'groq' ? 'Groq (Llama 3.3)' : 'Gemini Flash';

  if (hasKey) {
    badge.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;background:var(--glt);border:1px solid #6ee7b7;border-radius:9px;padding:9px 12px">' +
        '<span style="font-size:16px">&#x2705;</span>' +
        '<div>' +
          '<div style="font-size:12px;font-weight:700;color:var(--green)">' + provLabel + ' key saved</div>' +
          '<div style="font-size:10px;color:var(--muted)">The assistant will use this key for all questions.</div>' +
        '</div>' +
      '</div>';
  } else {
    badge.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;background:var(--alt2);border:1px solid #fcd34d;border-radius:9px;padding:9px 12px">' +
        '<span style="font-size:16px">&#x26A0;&#xFE0F;</span>' +
        '<div>' +
          '<div style="font-size:12px;font-weight:700;color:var(--amber)">No key set</div>' +
          '<div style="font-size:10px;color:var(--muted)">Using built-in rule-based answers only.</div>' +
        '</div>' +
      '</div>';
  }
}

// ── Save / clear ──────────────────────────────────────────────────────────
function aiSaveSettings() {
  const provSel = document.getElementById('ai-provider-select');
  const keyInp  = document.getElementById('ai-key-input');
  const provider = provSel ? provSel.value : 'gemini';
  const apiKey   = keyInp  ? keyInp.value.trim() : '';

  if (!apiKey) {
    _aiToast('Please paste an API key first.');
    return;
  }

  saveAiSettings({ provider, apiKey });
  _aiUpdateKeyStatus({ provider, apiKey });
  _aiToast('\u2705 Key saved! The assistant will now use ' + (provider === 'groq' ? 'Groq' : 'Gemini') + '.');

  // Update welcome message hint
  setTimeout(aiCloseSettings, 800);
}

function aiClearSettings() {
  clearAiSettings();
  const keyInp = document.getElementById('ai-key-input');
  if (keyInp) keyInp.value = '';
  _aiUpdateKeyStatus({ provider: 'gemini', apiKey: '' });
  _aiToast('Key cleared. Using built-in answers.');
}

// ── Key visibility toggle ─────────────────────────────────────────────────
function _aiToggleKeyVis() {
  const inp = document.getElementById('ai-key-input');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── Quick chips ───────────────────────────────────────────────────────────
function _aiRenderQuick() {
  const onEntry = !!document.getElementById('e-TOTAL');
  const opts = onEntry
    ? ['Check this entry', 'What does Cash to be Deposited mean?', 'Total this month so far']
    : ['Total sales this month', 'Top client last month', 'Compare this month vs last month', 'Any unusual days recently?'];
  const q = document.getElementById('ai-quick');
  if (!q) return;
  q.innerHTML = opts.map(o =>
    '<button class="ai-chip" onclick="aiAsk(\'' + o.replace(/'/g, "\\'") + '\')">' + o + '</button>'
  ).join('');
}

function aiAsk(text) {
  const inp = document.getElementById('ai-input');
  if (inp) inp.value = text;
  aiSend();
}

// ── Send message ──────────────────────────────────────────────────────────
async function aiSend() {
  const input = document.getElementById('ai-input');
  const text  = (input ? input.value : '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.disabled = true; }

  _aiHistory.push({ role: 'user', text });
  _aiRender();

  const thinkId = '_think_' + Date.now();
  _aiHistory.push({ role: 'bot', text: '\u2026', _id: thinkId });
  _aiRender();

  try {
    const result = await aiBridgeAnswer(text);

    const idx = _aiHistory.findIndex(m => m._id === thinkId);
    if (idx !== -1) _aiHistory.splice(idx, 1);

    let displayText = result.text;
    if (result.intent) {
      const label = _aiIntentLabel(result.intent);
      const safeIntent = JSON.stringify(result.intent).replace(/"/g, '&quot;');
      displayText += '<div class="ai-intent-row">'
        + '<button class="ai-chip" onclick="aiBridgeExecuteIntent(' + safeIntent + ');this.parentNode.remove()">' + label + '</button>'
        + '<button class="ai-chip ai-chip-dim" onclick="this.parentNode.remove()">No thanks</button>'
        + '</div>';
    }
    _aiHistory.push({ role: 'bot', text: displayText });
  } catch (err) {
    const idx = _aiHistory.findIndex(m => m._id === thinkId);
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
  };
  return labels[intent.action] || intent.action;
}

function _aiRender() {
  const box = document.getElementById('ai-msgs');
  if (!box) return;
  box.innerHTML = _aiHistory.map(m =>
    '<div class="ai-msg ' + m.role + '"><div class="ai-bubble">' + m.text + '</div></div>'
  ).join('');
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
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}

// ── Rule-based engine (called by AIBridge when no LLM key is set) ─────────
function _aiAnswer(q) {
  try {
    const ctx = getAppContext();
    const ql  = q.toLowerCase();

    if (document.getElementById('e-TOTAL') && /check|review|look at|this entry/.test(ql)) {
      return _aiCheckCurrentEntry(ctx);
    }
    if (/cash to be deposited/.test(ql)) {
      return 'Cash to be Deposited = Cash Sale (after Cash Returns) minus Amount Received \u2014 the physical cash left to bank after settlements.';
    }
    if (/comp sale|diff/.test(ql)) {
      return 'DIFF = Total Sale \u2212 COMP SALE. It flags mismatches between your recorded total and the pump computer reading for that month.';
    }
    if (/top client/.test(ql)) return _aiTopClient(ql, ctx);
    if (/compare|vs\b|versus/.test(ql)) return _aiCompareMonths(ql, ctx);
    if (/unusual|anomal|outlier|odd day/.test(ql)) return _aiFindAnomalies(ctx);
    if (/total|sales?\b/.test(ql) && /(this month|today|so far|current)/.test(ql)) return _aiThisMonthTotal(ctx);
    if (/total|sales?\b/.test(ql)) return _aiGeneralTotal(ql, ctx);
    if (/average|avg/.test(ql)) return _aiAverage(ctx);
    if (/forecast|project|predict/.test(ql)) return _aiForecast(ctx);
    if (/help|what can you/.test(ql)) {
      return 'I can: total/average sales for a month or year, compare two months, name the top client, spot unusual days, forecast the current month, and sanity-check a Daily Entry form. Try \u201ctotal sales June 2026\u201d or \u201ccompare June vs May\u201d.';
    }
    return "I didn\u2019t quite catch that. Try things like: \u201ctotal sales last month\u201d, \u201ctop client this month\u201d, \u201ccompare June vs May\u201d, or \u201ccheck this entry\u201d while filling the Daily Entry form.";
  } catch (e) {
    return 'Sorry, I hit a snag reading the data (' + e.message + '). Make sure your data has loaded, then try again.';
  }
}

function _aiFindMonthByName(ql, M) {
  if (!M || !M.length) return null;
  for (const m of M) if (ql.includes(m.Month_Year.toLowerCase())) return m;
  for (const nm of BTDate.monthNames) {
    if (ql.includes(nm.toLowerCase())) {
      const matches = M.filter(m => m.Month_Year.toLowerCase().startsWith(nm.toLowerCase()));
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
  const grand = BTCalc.grandTotal(M);
  return "I couldn\u2019t spot a specific month in your question, so here\u2019s the grand total across all " + M.length + " months: <b>\u20a8 " + BTFormat.plain(grand) + "</b>. You can also ask \u201ctotal sales June 2026\u201d.";
}

function _aiAverage(ctx) {
  const M = ctx.monthly;
  if (!M.length) return 'No monthly data loaded yet.';
  const avg = BTCalc.monthlyAverage(M);
  return 'Average monthly sales across ' + M.length + ' months: <b>\u20a8 ' + BTFormat.plain(avg) + '</b>.';
}

function _aiForecast(ctx) {
  const M = ctx.monthly;
  const D = ctx.daily;
  if (!M.length) return 'No monthly data loaded yet.';
  const latest   = M[M.length - 1];
  const forecast = BTCalc.forecastTotal(latest, D);
  const current  = BTFormat.num(latest.TOTAL);
  return 'Based on the current daily average in <b>' + latest.Month_Year + '</b>, the projected month-end total is <b>\u20a8 ' + BTFormat.plain(forecast) + '</b> (currently \u20a8 ' + BTFormat.plain(current) + ').';
}

function _aiTopClient(ql, ctx) {
  const M = ctx.monthly;
  const m = _aiFindMonthByName(ql, M) || M[M.length - 1];
  if (!m) return 'No monthly data loaded yet.';
  let best = null, bestVal = -Infinity;
  (ctx.clientCols || []).forEach(c => {
    const v = BTFormat.num(m[c]);
    if (v > bestVal) { bestVal = v; best = c; }
  });
  if (!best || bestVal <= 0) return 'No positive credit-client sales found for ' + m.Month_Year + '.';
  return 'Top credit client in <b>' + m.Month_Year + '</b> was <b>' + best + '</b> with <b>\u20a8 ' + BTFormat.plain(bestVal) + '</b>.';
}

function _aiCompareMonths(ql, ctx) {
  const M = ctx.monthly;
  if (M.length < 2) return 'Need at least two months of data to compare.';
  const found = [];
  for (const nm of BTDate.monthNames) {
    if (ql.includes(nm.toLowerCase())) {
      const match = M.filter(m => m.Month_Year.toLowerCase().startsWith(nm.toLowerCase()));
      if (match.length) found.push(match[match.length - 1]);
    }
  }
  let a, b;
  if (found.length >= 2) { [a, b] = found; }
  else { a = M[M.length - 1]; b = M[M.length - 2]; }
  const ta   = BTFormat.num(a.TOTAL);
  const tb   = BTFormat.num(b.TOTAL);
  const diff = ta - tb;
  const pctv = tb ? (diff / tb * 100).toFixed(1) : '\u2014';
  const dir  = diff >= 0 ? 'up' : 'down';
  return '<b>' + a.Month_Year + '</b>: \u20a8 ' + BTFormat.plain(ta) + ' vs <b>' + b.Month_Year + '</b>: \u20a8 ' + BTFormat.plain(tb) + ' \u2014 that\u2019s ' + dir + ' \u20a8 ' + BTFormat.plain(Math.abs(diff)) + ' (' + pctv + '%).';
}

function _aiFindAnomalies(ctx) {
  const D = ctx.daily;
  if (D.length < 5) return 'Not enough daily data yet to detect patterns.';
  const recent = D.slice(-30);
  const vals   = recent.map(d => BTFormat.num(d.TOTAL));
  const avg    = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd     = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length) || 1;
  const flagged = recent.filter(d => Math.abs(BTFormat.num(d.TOTAL) - avg) > 1.8 * sd);
  if (!flagged.length) return 'Nothing stands out in the last ' + recent.length + ' days \u2014 totals are within normal range (avg \u20a8 ' + BTFormat.plain(avg) + ').';
  const lines = flagged.slice(0, 5).map(d =>
    '\u2022 ' + d.Date + ': \u20a8 ' + BTFormat.plain(BTFormat.num(d.TOTAL)) + ' (avg is \u20a8 ' + BTFormat.plain(avg) + ')'
  );
  return 'Found ' + flagged.length + ' day(s) that deviate noticeably from the recent average:<br>' + lines.join('<br>');
}

function _aiCheckCurrentEntry(ctx) {
  const get    = id => { const el = document.getElementById('e-' + id); return el ? BTFormat.num(el.value) : 0; };
  const issues = [];

  const cashRet = get('Cash_Returns');
  if (cashRet > 0) issues.push('\u201cCash Returns\u201d is positive \u2014 it should usually be 0 or negative since it reduces the total.');

  const total = (() => { const el = document.getElementById('e-TOTAL'); return el ? BTFormat.num(el.value) : 0; })();
  if (total === 0) issues.push('Total is currently 0 \u2014 looks like no values have been entered yet.');

  const customers = get('Customers');
  if (customers === 0 && total > 0) issues.push('Customers is 0 but there\u2019s a non-zero total \u2014 worth double-checking the customer count.');

  const M = ctx.monthly;
  if (M.length) {
    const m    = M[M.length - 1];
    const days = ctx.daily.filter(d => d.Month_Year === m.Month_Year);
    if (days.length >= 3) {
      const avg = days.reduce((s, d) => s + BTFormat.num(d.TOTAL), 0) / days.length;
      if (avg > 0 && total > 0 && Math.abs(total - avg) > avg * 0.5) {
        const dir = total > avg ? 'higher' : 'lower';
        issues.push("Today\u2019s total (\u20a8 " + BTFormat.plain(total) + ") is notably " + dir + " than this month\u2019s daily average (\u20a8 " + BTFormat.plain(avg) + ") \u2014 just flagging in case it\u2019s a typo.");
      }
    }
  }

  if (!issues.length) return 'Looks good \u2014 no obvious issues with the numbers entered so far.';
  return 'A few things to double-check:<br>' + issues.map(i => '\u2022 ' + i).join('<br>');
}
