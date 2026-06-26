// ══════════════════════════════════════════════════════════════════════
// AI PAGE — Dedicated full-page AI tab
// Separate chat history from the floating panel; shares aiBridgeAnswer()
// ══════════════════════════════════════════════════════════════════════

var _aipHistory  = [];
var _aipInited   = false;
var _aipMicActive = false;
var _aipMicRec    = null;

// ── Entry point called by showPage('ai') ─────────────────────────────
function loadAiPage() {
  _aipRenderChips();
  _aipRenderInsights();
  if (!_aipInited) {
    _aipInited = true;
    _aipHistory.push({
      role: 'bot',
      text: '\uD83D\uDC4B <b>Hello!</b> I am your Groq AI assistant, fully loaded with your sales data.' +
            '<br><br>I know everything about your petrol station:' +
            '<br>\u2022 Every day\u2019s sale, cash, credit, load sale, DIFF' +
            '<br>\u2022 Monthly totals and year-over-year trends' +
            '<br>\u2022 Staff, credits, expenses, petty cash' +
            '<br>\u2022 Jazz Cash and custom sections in Manager' +
            '<br><br><b>Just ask me anything\u2014 in English, Urdu, or both.</b>',
    });
  }
  _aipRender();
  setTimeout(function () {
    var inp = document.getElementById('aip-input');
    if (inp) inp.focus();
  }, 200);
}

// ── Auto-Insights sidebar ─────────────────────────────────────────────
function _aipRenderInsights() {
  var sb = document.getElementById('aip-sidebar');
  if (!sb) return;

  var M = (typeof window.MONTHLY !== 'undefined' && window.MONTHLY) ? window.MONTHLY : [];
  var D = (typeof window.DAILY   !== 'undefined' && window.DAILY)   ? window.DAILY   : [];

  if (!M.length) {
    sb.innerHTML = '<div class="aip-no-data">' +
      '<div style="font-size:48px;margin-bottom:12px">\uD83D\uDCC2</div>' +
      '<div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:6px">No Data Yet</div>' +
      '<div style="color:#64748b;font-size:13px;line-height:1.6">Load your sales data or add entries to see AI-powered insights here.</div>' +
      '</div>';
    return;
  }

  var n  = (typeof BTFormat !== 'undefined') ? BTFormat.num   : function(v){ return isNaN(parseFloat(v)) ? 0 : parseFloat(v); };
  var fc = (typeof BTFormat !== 'undefined') ? BTFormat.plain : function(v){ return Math.round(v).toLocaleString('en-PK'); };

  var last   = M[M.length - 1];
  var prev   = M.length > 1 ? M[M.length - 2] : null;
  var grand  = M.reduce(function(s, m){ return s + n(m.TOTAL); }, 0);
  var lastT  = n(last.TOTAL);
  var prevT  = prev ? n(prev.TOTAL) : 0;
  var chg    = prevT > 0 ? Math.round((lastT - prevT) / prevT * 100) : null;

  // Best month
  var bestM  = M.reduce(function(a, b){ return n(b.TOTAL) > n(a.TOTAL) ? b : a; }, M[0]);
  // Best day
  var bestD  = D.length ? D.reduce(function(a, b){ return n(b.TOTAL) > n(a.TOTAL) ? b : a; }, D[0]) : null;
  // Average monthly
  var avgM   = Math.round(grand / M.length);
  // Last 6 months trend
  var last6  = M.slice(-6).map(function(m){ return n(m.TOTAL); });
  var maxL6  = Math.max.apply(null, last6);
  // Cash vs credit (last month)
  var ctx    = (typeof getAppContext === 'function') ? getAppContext() : {};
  var cCols  = ctx.clientCols || [];
  var cashT  = n(last['Cash_Sale'] || last['Cash Sale'] || 0);
  var credT  = cCols.reduce(function(s, c){ return s + n(last[c]); }, 0);
  var totalT = cashT + credT;
  var cashPct  = totalT > 0 ? Math.round(cashT / totalT * 100) : 0;
  var credPct  = 100 - cashPct;

  // Current month progress vs target
  var tgts   = (typeof window.getTgts === 'function') ? window.getTgts() : {};
  var curMY  = last.Month_Year;
  var curTgt = n(tgts[curMY]);
  var pctTgt = (curTgt > 0) ? Math.round(lastT / curTgt * 100) : null;

  // Active credit clients (last 3 months)
  var activeCred = cCols.filter(function(c){
    return M.slice(-3).some(function(m){ return n(m[c]) > 0; });
  });

  // Streak: consecutive months ≥ avgM
  var streak = 0;
  for (var i = M.length - 1; i >= 0; i--) {
    if (n(M[i].TOTAL) >= avgM) streak++;
    else break;
  }

  // Load Sale (last month)
  var loadLast = n(last['Load_Sale'] || last['Load Sale'] || 0);

  // ── Build HTML ───────────────────────────────────────────────────
  var chgHtml = '';
  if (chg !== null) {
    var chgColor = chg >= 0 ? '#16a34a' : '#dc2626';
    var chgArrow = chg >= 0 ? '\u2191' : '\u2193';
    chgHtml = '<span style="color:' + chgColor + ';font-size:12px;font-weight:600;margin-left:5px">' + chgArrow + Math.abs(chg) + '% vs ' + (prev ? prev.Month_Year : 'prev') + '</span>';
  }

  var tgtHtml = '';
  if (pctTgt !== null) {
    var tgtColor = pctTgt >= 100 ? '#16a34a' : pctTgt >= 80 ? '#2563eb' : pctTgt >= 60 ? '#d97706' : '#dc2626';
    tgtHtml = '<div class="aip-insight-row" style="margin-top:6px;padding:8px 10px;background:' +
      (pctTgt >= 100 ? '#f0fdf4' : '#eff6ff') +
      ';border-radius:8px;border:1px solid ' + (pctTgt >= 100 ? '#bbf7d0' : '#dbeafe') + '">' +
      '<span style="font-size:11.5px;color:#64748b">Target progress</span>' +
      '<span style="font-size:13px;font-weight:700;color:' + tgtColor + ';margin-left:auto">' + pctTgt + '% of \u20a8' + fc(curTgt) + '</span>' +
      '</div>';
  }

  // Sparkline (simple bar chart using divs)
  var sparkHtml = last6.map(function(v, i) {
    var h = maxL6 > 0 ? Math.max(4, Math.round((v / maxL6) * 38)) : 4;
    var isLast = i === last6.length - 1;
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">' +
      '<div style="width:100%;border-radius:3px 3px 0 0;height:' + h + 'px;background:' + (isLast ? '#2563eb' : '#bfdbfe') + '"></div>' +
      '</div>';
  }).join('');

  var html = '<div class="aip-section-title">\u26a1 Live Insights</div>';

  // Grand total card
  html += '<div class="aip-card aip-card-accent">' +
    '<div class="aip-card-label">Total All-Time</div>' +
    '<div class="aip-card-val">\u20a8' + fc(grand) + '</div>' +
    '<div class="aip-card-sub">' + M.length + ' months of data</div>' +
    '</div>';

  // Last month card
  html += '<div class="aip-card">' +
    '<div class="aip-card-label">Last Month — ' + last.Month_Year + '</div>' +
    '<div class="aip-card-val">\u20a8' + fc(lastT) + chgHtml + '</div>' +
    (tgtHtml || '') +
    '</div>';

  // Best month
  html += '<div class="aip-card">' +
    '<div class="aip-card-label">\uD83C\uDFC6 Best Month Ever</div>' +
    '<div class="aip-card-val">\u20a8' + fc(n(bestM.TOTAL)) + '</div>' +
    '<div class="aip-card-sub">' + bestM.Month_Year + '</div>' +
    '</div>';

  // Best day
  if (bestD) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">\uD83D\uDD25 Best Day Ever</div>' +
      '<div class="aip-card-val">\u20a8' + fc(n(bestD.TOTAL)) + '</div>' +
      '<div class="aip-card-sub">' + bestD.Date + ' [' + bestD.Month_Year + ']</div>' +
      '</div>';
  }

  // Avg monthly
  html += '<div class="aip-card">' +
    '<div class="aip-card-label">\uD83D\uDCCA Avg Monthly Sale</div>' +
    '<div class="aip-card-val">\u20a8' + fc(avgM) + '</div>' +
    (streak > 1 ? '<div class="aip-card-sub">\uD83D\uDD25 ' + streak + ' consecutive months \u2265 avg</div>' : '') +
    '</div>';

  // Cash vs Credit
  if (totalT > 0) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">Cash vs Credit — ' + last.Month_Year + '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin:6px 0">' +
        '<div style="flex:' + cashPct + ';height:10px;background:#2563eb;border-radius:5px 0 0 5px"></div>' +
        '<div style="flex:' + credPct + ';height:10px;background:#bfdbfe;border-radius:0 5px 5px 0"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b">' +
        '<span>\uD83D\uDCB5 Cash ' + cashPct + '%</span>' +
        '<span>\uD83C\uDFE6 Credit ' + credPct + '%</span>' +
      '</div>' +
      '</div>';
  }

  // Load Sale
  if (loadLast > 0) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">\u26FD Load Sale — ' + last.Month_Year + '</div>' +
      '<div class="aip-card-val">\u20a8' + fc(loadLast) + '</div>' +
      '</div>';
  }

  // Last 6 months sparkline
  html += '<div class="aip-card">' +
    '<div class="aip-card-label">Last 6 Months Trend</div>' +
    '<div style="display:flex;align-items:flex-end;gap:4px;height:44px;margin-top:8px">' + sparkHtml + '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
      '<span style="font-size:10px;color:#94a3b8">' + (M.slice(-6)[0] || {Month_Year:''}).Month_Year + '</span>' +
      '<span style="font-size:10px;color:#2563eb;font-weight:600">' + last.Month_Year + '</span>' +
    '</div>' +
    '</div>';

  // Active credit clients
  if (activeCred.length) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">\uD83C\uDFE6 Active Credit Clients</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">' +
        activeCred.map(function(c){
          return '<span style="font-size:11px;padding:3px 9px;background:#eff6ff;color:#1d4ed8;border-radius:12px;border:1px solid #dbeafe">' + c + '</span>';
        }).join('') +
      '</div>' +
      '</div>';
  }

  // Quick ask buttons
  html += '<div class="aip-section-title" style="margin-top:4px">\uD83D\uDCA1 Quick Ask</div>';
  var quickAsks = [
    'Highest sale day this year?',
    'Compare last two months',
    'Best month ever?',
    'Load sale total this month',
    'Cash vs credit breakdown',
    'DIFF report kya hai?',
    'Average daily sale?',
    'Which credit client is biggest?',
  ];
  html += '<div style="display:flex;flex-direction:column;gap:6px">';
  quickAsks.forEach(function(q) {
    html += '<button class="aip-quick-btn" onclick="aiPageAsk(\'' + q.replace(/'/g, "\\'") + '\')">' + q + '</button>';
  });
  html += '</div>';

  sb.innerHTML = html;
}

// ── Chips above input ─────────────────────────────────────────────────
function _aipRenderChips() {
  var chips = document.getElementById('aip-chips');
  if (!chips) return;
  var opts = ['Jazz Cash 5000', 'Credit 2500 for Kashif', 'Highest sale day?', 'Yearly totals', 'Average daily?', 'Open June report'];
  chips.innerHTML = opts.map(function(o) {
    return '<button class="ai-chip" onclick="aiPageAsk(\'' + o.replace(/'/g, "\\'") + '\')">' + o + '</button>';
  }).join('');
}

// ── Chat send ─────────────────────────────────────────────────────────
async function aiPageSend() {
  var input = document.getElementById('aip-input');
  var text  = (input ? input.value : '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.disabled = true; }

  _aipHistory.push({ role: 'user', text: _aipEsc(text) });
  _aipRender();

  var thinkId = '_aip_' + Date.now();
  _aipHistory.push({
    role: 'bot',
    text: '<div class="ai-typing"><span></span><span></span><span></span></div>',
    _id: thinkId,
  });
  _aipRender();

  try {
    var result = await aiBridgeAnswer(text);
    var idx = _aipHistory.findIndex(function(m){ return m._id === thinkId; });
    if (idx !== -1) _aipHistory.splice(idx, 1);

    var displayText = result.text;
    if (result.intent) {
      var label = _aipIntentLabel(result.intent);
      displayText += '<div class="ai-intent-row">' +
        '<button class="ai-chip ai-chip-green" onclick="aiBridgeExecuteIntent(JSON.parse(this.dataset.i));this.parentNode.remove()" data-i="' + JSON.stringify(result.intent).replace(/"/g,'&quot;') + '">' + label + '</button>' +
        '<button class="ai-chip-dim" onclick="this.parentNode.remove()">No thanks</button>' +
        '</div>';
    }
    _aipHistory.push({ role: 'bot', text: displayText });

    // Refresh insights after any action
    setTimeout(_aipRenderInsights, 400);
  } catch(err) {
    var idx2 = _aipHistory.findIndex(function(m){ return m._id === thinkId; });
    if (idx2 !== -1) _aipHistory.splice(idx2, 1);
    _aipHistory.push({ role: 'bot', text: '\u26a0\ufe0f Error: ' + _aipEsc(err.message) });
  }

  if (input) input.disabled = false;
  _aipRender();
}

function aiPageAsk(text) {
  var inp = document.getElementById('aip-input');
  if (inp) inp.value = text;
  aiPageSend();
}

function aiPageClear() {
  _aipHistory = [];
  _aipInited  = false;
  loadAiPage();
}

function _aipRender() {
  var box = document.getElementById('aip-msgs');
  if (!box) return;
  box.innerHTML = _aipHistory.map(function(m) {
    return '<div class="ai-msg ' + m.role + '"><div class="ai-bubble">' + m.text + '</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function _aipEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _aipIntentLabel(intent) {
  var labels = {
    showPage:'→ Open page', openDayModal:'📋 Open day report',
    openMonthModal:'📋 Open month report', printMonthReport:'🖨️ Print',
    printYearlyReport:'🖨️ Print year', switchMgrTab:'→ Switch tab',
    addCredit:'✅ Yes, add credit', addExpense:'✅ Yes, add expense',
    addPettyItem:'✅ Yes, add petty', setDailyField:'✅ Yes, fill field',
    addCustomSectionRow:'✅ Yes, add to section',
  };
  return labels[intent.action] || intent.action;
}

// ── Voice (page mic) ──────────────────────────────────────────────────
function aiPageToggleMic() {
  if (_aipMicActive) { _aipStopMic(); return; }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Voice input not supported. Use Chrome or Edge.'); return; }
  _aipMicRec = new SR();
  _aipMicRec.lang = 'en-US';
  _aipMicRec.interimResults = true;
  var micBtn = document.getElementById('aip-mic');
  var inp    = document.getElementById('aip-input');
  _aipMicRec.onstart = function() {
    _aipMicActive = true;
    if (micBtn) { micBtn.textContent = '🔴'; micBtn.classList.add('recording'); }
    if (inp) inp.placeholder = 'Listening…';
  };
  _aipMicRec.onresult = function(e) {
    var t = Array.from(e.results).map(function(r){ return r[0].transcript; }).join('');
    if (inp) inp.value = t;
  };
  _aipMicRec.onend = function() {
    _aipMicActive = false;
    if (micBtn) { micBtn.textContent = '🎤'; micBtn.classList.remove('recording'); }
    if (inp) inp.placeholder = 'Ask anything\u2026';
    _aipMicRec = null;
    if (inp && inp.value.trim()) aiPageSend();
  };
  _aipMicRec.onerror = function() {
    _aipMicActive = false;
    if (micBtn) { micBtn.textContent = '🎤'; micBtn.classList.remove('recording'); }
    _aipMicRec = null;
  };
  _aipMicRec.start();
}
function _aipStopMic() {
  if (_aipMicRec) { try { _aipMicRec.stop(); } catch(_) {} _aipMicRec = null; }
  _aipMicActive = false;
  var micBtn = document.getElementById('aip-mic');
  if (micBtn) { micBtn.textContent = '🎤'; micBtn.classList.remove('recording'); }
}
