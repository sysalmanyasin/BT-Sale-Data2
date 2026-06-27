// ══════════════════════════════════════════════════════════════════════
// AI PAGE — Dedicated full-page AI tab
// Separate chat history from the floating panel; shares aiBridgeAnswer()
// ══════════════════════════════════════════════════════════════════════

var _aipHistory   = [];
var _aipInited    = false;
var _aipMicActive = false;
var _aipMicRec    = null;

// ── Entry point called by showPage('ai') ─────────────────────────────
function loadAiPage() {
  // ── Auto-load data if arrays are empty ─────────────────────────
  var _hasData = (typeof MONTHLY !== 'undefined' && MONTHLY && MONTHLY.length > 0);
  if (!_hasData && typeof pullFromSupabase === 'function') {
    var _sb = document.getElementById('aip-sidebar');
    if (_sb) _sb.innerHTML = '<div class="aip-no-data"><div style="font-size:36px;margin-bottom:10px">\u23F3</div><div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:6px">Loading your data\u2026</div><div style="color:#64748b;font-size:12px">Pulling from Supabase</div></div>';
    pullFromSupabase(true).then(function() {
      setTimeout(function() {
        _aipRenderInsights();
        if (MONTHLY && MONTHLY.length > 0) {
          _aipHistory.push({ role: 'bot', text: '\u2705 <b>Data loaded!</b> ' + MONTHLY.length + ' months \u00b7 ' + DAILY.length + ' daily records ready.<br>Ask me anything about your sales.' });
          _aipRender();
        }
      }, 700);
    }).catch(function() { _aipRenderInsights(); });
  }

  // Render the smart home screen (shortcut grid) in the chips area
  _aipRenderHome();
  _aipRenderInsights();

  var badge = document.getElementById('aip-live-badge');
  var hasKey = (typeof aiHasKey === 'function') ? aiHasKey() : true;
  if (badge) {
    badge.textContent = hasKey ? 'LIVE' : 'NO KEY';
    badge.style.background = hasKey ? '' : '#dc2626';
  }
  if (!_aipInited) {
    _aipInited = true;
    var briefing = (typeof aimBriefingGenerate === 'function') ? aimBriefingGenerate() : null;
    var ruleAlerts = '';
    try {
      var fired = (typeof aimRulesCheckAll === 'function') ? aimRulesCheckAll() : [];
      if (fired.length) ruleAlerts = '<br><br>' + fired.map(function(f){ return f.msg; }).join('<br>');
    } catch (_) {}
    _aipHistory.push({
      role: 'bot',
      text: hasKey ?
        (briefing ?
          ('\u2600\uFE0F <b>Daily Briefing</b><br>' + briefing + ruleAlerts) :
          ('\uD83D\uDC4B <b>Hello!</b> I\'m your full personal assistant for Bahria Town Sales IC.' +
            '<br><br>I can <b>read, write, and act</b> on everything in the app:' +
            '<br>\u2022 \uD83D\uDCCA Daily entries, edits, analytics' +
            '<br>\u2022 \uD83D\uDC65 Staff \u2014 add, edit, activate/deactivate' +
            '<br>\u2022 \uD83D\uDCB0 Salary, Generic, Expense, Credit, Petty Cash' +
            '<br>\u2022 \uD83C\uDFAF Targets, Custom Sections, Sync &amp; Backup' +
            '<br>\u2022 \uD83E\uDDE0 Memory, Rules &amp; Training \u2014 tap \uD83E\uDDE0 above' +
            '<br><br><b>Use the shortcuts below or just type/speak!</b>' +
            '<br><span style="font-size:11px;color:var(--muted)">\u26a0\ufe0f Destructive actions (delete, overwrite) will always ask for confirmation first.</span>' + ruleAlerts)) :
        ('\u26a0\ufe0f <b>No API key set.</b> Tap the \u2699\ufe0f gear icon above to add your free Groq API key ' +
            '(get one at <b>console.groq.com/keys</b>) before chatting or scanning images.'),
    });
  }
  _aipRender();
  setTimeout(function () {
    var inp = document.getElementById('aip-input');
    if (inp) inp.focus();
  }, 200);
}

// ══════════════════════════════════════════════════════════════════════
// HOME SCREEN — Shortcut Grid (replaces the plain chips bar)
// ══════════════════════════════════════════════════════════════════════

// Group config for the 2x4 grid (order matches design spec)
var _IGS_GRID_ORDER = [
  'sales',    'payroll',
  'expenses', 'staff',
  'records',  'reports',
  'navigation','ai',
];

// Drawer starts collapsed — the 8-shortcut grid is tucked away behind a
// permanent side tab and only slides into view when the user taps it.
var _igsDrawerOpen = false;

function _aipRenderHome() {
  var wrap = document.getElementById('aip-chips');
  if (!wrap) return;

  // If user has typed something, show the regular chip suggestions instead
  var inp = document.getElementById('aip-input');
  var hasText = inp && inp.value.trim().length > 0;
  if (hasText) { _aipRenderChips(); return; }

  if (typeof IntentGroupRegistry === 'undefined') {
    _aipRenderChips(); return;
  }

  var groups = IntentGroupRegistry.getAllGroups();

  // Build lookup by id
  var byId = {};
  groups.forEach(function(g){ byId[g.id] = g; });

  // Suggested groups (usage-based)
  var suggested = IntentGroupRegistry.getSuggestedGroups(3);
  // Only show suggestions if there's any usage history
  var hasUsage = suggested.some(function(g) {
    try {
      var u = JSON.parse(localStorage.getItem('bt_igr_usage') || '{}');
      return (u[g.id] || 0) > 0;
    } catch(_){ return false; }
  });

  var html = '<div class="igs-home" id="igs-home-panel">';

  // ── Speak button ──
  html += '<div class="igs-speak-row">';
  html += '<button class="igs-speak-btn" id="igs-speak-btn" onclick="aiPageToggleMic()" title="Voice input">';
  html += '<span style="font-size:20px">🎤</span>';
  html += '<span>Speak</span>';
  html += '</button>';
  html += '</div>';

  // ── Shortcut grid — tucked behind a permanent collapsible side tab ──
  html += '<div class="igs-drawer-wrap">';
  html += '<button class="igs-drawer-tab' + (_igsDrawerOpen ? ' igs-drawer-tab-active' : '') + '" ' +
    'id="igs-drawer-tab" onclick="igsToggleDrawer()" aria-expanded="' + (_igsDrawerOpen?'true':'false') + '">' +
    '<span class="igs-drawer-tab-icon">' + (_igsDrawerOpen ? '✕' : '⚡') + '</span>' +
    '<span class="igs-drawer-tab-label">Shortcuts</span>' +
    '</button>';
  html += '<div class="igs-drawer-panel' + (_igsDrawerOpen ? ' igs-drawer-open' : '') + '" id="igs-drawer-panel">';
  html += '<div class="igs-grid">';
  _IGS_GRID_ORDER.forEach(function(gid) {
    var g = byId[gid];
    if (!g) return;
    html += '<button class="igs-btn" onclick="igsOpenGroup(\'' + _aipEsc(gid) + '\')" ' +
      'style="background:' + _aipEsc(g.bg) + ';border-color:' + _aipEsc(g.border) + ';color:' + _aipEsc(g.color) + '">' +
      '<span class="igs-btn-emoji">' + g.emoji + '</span>' +
      '<span class="igs-btn-label">' +
        '<span class="igs-btn-name">' + _aipEsc(g.label) + '</span>' +
        '<span class="igs-btn-sub">' + _aipEsc(g.name) + '</span>' +
      '</span>' +
      '</button>';
  });
  html += '</div>'; // .igs-grid
  html += '</div>'; // .igs-drawer-panel
  html += '</div>'; // .igs-drawer-wrap

  // ── Suggested shortcuts (usage-based) ──
  if (hasUsage) {
    html += '<div class="igs-suggestions">';
    html += '<div class="igs-sug-label">⚡ Frequent</div>';
    html += '<div class="igs-sug-row">';
    suggested.forEach(function(g) {
      html += '<button class="igs-sug-chip" onclick="igsOpenGroup(\'' + _aipEsc(g.id) + '\')">' +
        g.shortcut + '</button>';
    });
    html += '</div></div>';
  }

  html += '</div>';

  wrap.innerHTML = html;

  // Sync mic button state if already recording
  if (_aipMicActive) {
    var spkBtn = document.getElementById('igs-speak-btn');
    if (spkBtn) spkBtn.classList.add('recording');
  }
}

// Toggle the shortcut-grid drawer open/closed. Called by the permanent
// side tab; re-render is unnecessary — we just flip classes directly so
// scroll position / focus elsewhere on the page isn't disturbed.
function igsToggleDrawer(forceState) {
  var panel = document.getElementById('igs-drawer-panel');
  var tab   = document.getElementById('igs-drawer-tab');
  if (!panel || !tab) return;
  _igsDrawerOpen = (typeof forceState === 'boolean') ? forceState : !_igsDrawerOpen;
  panel.classList.toggle('igs-drawer-open', _igsDrawerOpen);
  tab.classList.toggle('igs-drawer-tab-active', _igsDrawerOpen);
  tab.setAttribute('aria-expanded', _igsDrawerOpen ? 'true' : 'false');
  var icon = tab.querySelector('.igs-drawer-tab-icon');
  if (icon) icon.textContent = _igsDrawerOpen ? '✕' : '⚡';
}

// Called when user taps a group shortcut
function igsOpenGroup(groupId) {
  if (typeof IntentGroupRegistry === 'undefined') return;
  var g = IntentGroupRegistry.getGroupById(groupId);
  if (!g) return;

  // Track usage
  IntentGroupRegistry.trackUsage(groupId);

  // Inject a group exploration message into chat
  var groupIntentsHtml = g.intents.slice(0,8).map(function(id){
    return '<span class="igs-intent-tag">' + _aipEsc(id) + '</span>';
  }).join('');
  if (g.intents.length > 8) {
    groupIntentsHtml += ' <span class="igs-intent-tag">+' + (g.intents.length - 8) + ' more</span>';
  }

  var card = '<div class="igs-group-card">' +
    '<div class="igs-group-card-header">' +
      '<div class="igs-group-card-icon" style="background:' + _aipEsc(g.bg) + ';border:1.5px solid ' + _aipEsc(g.border) + '">' + g.emoji + '</div>' +
      '<div>' +
        '<div class="igs-group-card-title">' + _aipEsc(g.name) + '</div>' +
        '<div class="igs-group-card-sub">Shortcut: <b>' + _aipEsc(g.shortcut) + '</b> &nbsp;&bull;&nbsp; ' + g.intents.length + ' actions</div>' +
      '</div>' +
    '</div>' +
    '<div class="igs-group-intents">' + groupIntentsHtml + '</div>' +
    '</div>';

  var prompt = 'Tell me what I can do in the <b>' + _aipEsc(g.name) + '</b> group. ' +
    'Show example commands I can say for: ' + g.intents.slice(0,4).join(', ') + '.';

  _aipHistory.push({ role: 'user', text: g.shortcut + ' — ' + _aipEsc(g.name) });
  _aipHistory.push({ role: 'bot', text: card + '<div style="margin-top:8px;font-size:12.5px;color:#475569">Here\'s what you can do in this group. Try saying something like:<br>' + _igsGetGroupExamples(groupId) + '</div>' });
  _aipRender();

  // Collapse the drawer back to its tab so the chat reclaims the space
  _igsDrawerOpen = false;
  igsToggleDrawer(false);

  // Re-render home without the open group highlighted
  setTimeout(_aipRenderHome, 0);
}

// Quick example commands per group
function _igsGetGroupExamples(groupId) {
  var examples = {
    navigation: '"Open dashboard" &nbsp;&bull;&nbsp; "Go to manager" &nbsp;&bull;&nbsp; "Switch to salary tab"',
    sales:      '"Jazz Cash 5000" &nbsp;&bull;&nbsp; "Set cash sale to 80000" &nbsp;&bull;&nbsp; "Edit yesterday\'s entry"',
    staff:      '"Add staff Ali Raza" &nbsp;&bull;&nbsp; "Deactivate Kashif" &nbsp;&bull;&nbsp; "Open staff card for Usman"',
    payroll:    '"Credit 2500 for Kashif" &nbsp;&bull;&nbsp; "Add salary row for Ali" &nbsp;&bull;&nbsp; "Copy to next month"',
    expenses:   '"Add expense fuel 1200" &nbsp;&bull;&nbsp; "Add petty chai 300" &nbsp;&bull;&nbsp; "Add expense electricity 8000"',
    records:    '"Add 5000 to Wapda section" &nbsp;&bull;&nbsp; "Create section NBP" &nbsp;&bull;&nbsp; "Delete row in PSO register"',
    reports:    '"Open month report" &nbsp;&bull;&nbsp; "Print yearly report" &nbsp;&bull;&nbsp; "Set target June 2026 50 lakh"',
    ai:         '"Push to Supabase" &nbsp;&bull;&nbsp; "Remember: target is 5M" &nbsp;&bull;&nbsp; "Backup to Drive"',
  };
  return examples[groupId] || 'Type a command to get started.';
}

// ── Regular chips (shown when user is typing) ─────────────────────────
function _aipRenderChips() {
  var chips = document.getElementById('aip-chips');
  if (!chips) return;

  // If the home panel is currently shown, replace it
  var homeEl = document.getElementById('igs-home-panel');
  if (homeEl) {
    chips.innerHTML = '';
  }

  var opts = [
    'Jazz Cash 5000',
    'Credit 2500 for Kashif',
    'Add expense fuel 800',
    'Set target June 2026 50 lakh',
    'Add staff Muhammad Usman',
    'Highest sale day?',
    'Compare last two months',
    'Push to Supabase',
  ];
  chips.innerHTML = '<div class="igs-chips-mode">' +
    opts.map(function(o) {
      return '<button class="ai-chip" onclick="aiPageAsk(\'' + o.replace(/'/g, "\\'") + '\')">' + o + '</button>';
    }).join('') +
    '</div>';
}

// Watch input field to switch between home screen and chip suggestions
function _aipBindInputWatch() {
  var inp = document.getElementById('aip-input');
  if (!inp || inp._igsWatching) return;
  inp._igsWatching = true;
  inp.addEventListener('input', function() {
    if (inp.value.trim().length > 0) {
      // Show chips when typing
      var homeEl = document.getElementById('igs-home-panel');
      if (homeEl) _aipRenderChips();
    } else {
      // Show home screen when cleared
      var homeEl = document.getElementById('igs-home-panel');
      if (!homeEl) _aipRenderHome();
    }
  });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { inp.value = ''; _aipRenderHome(); }
  });
}

// ── Auto-Insights sidebar ─────────────────────────────────────────────
function _aipRenderInsights() {
  var sb = document.getElementById('aip-sidebar');
  if (!sb) return;

  var M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  var D = (typeof DAILY !== 'undefined' && DAILY)   ? DAILY   : [];

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

  var bestM  = M.reduce(function(a, b){ return n(b.TOTAL) > n(a.TOTAL) ? b : a; }, M[0]);
  var bestD  = D.length ? D.reduce(function(a, b){ return n(b.TOTAL) > n(a.TOTAL) ? b : a; }, D[0]) : null;
  var avgM   = Math.round(grand / M.length);
  var last6  = M.slice(-6).map(function(m){ return n(m.TOTAL); });
  var maxL6  = Math.max.apply(null, last6);
  var ctx    = (typeof getAppContext === 'function') ? getAppContext() : {};
  var cCols  = ctx.clientCols || [];
  var cashT  = n(last['Cash_Sale'] || last['Cash Sale'] || 0);
  var credT  = cCols.reduce(function(s, c){ return s + n(last[c]); }, 0);
  var totalT = cashT + credT;
  var cashPct  = totalT > 0 ? Math.round(cashT / totalT * 100) : 0;
  var credPct  = 100 - cashPct;

  var tgts   = (typeof window.getTgts === 'function') ? window.getTgts() : {};
  var curMY  = last.Month_Year;
  var curTgt = n(tgts[curMY]);
  var pctTgt = (curTgt > 0) ? Math.round(lastT / curTgt * 100) : null;

  var activeCred = cCols.filter(function(c){
    return M.slice(-3).some(function(m){ return n(m[c]) > 0; });
  });

  var streak = 0;
  for (var i = M.length - 1; i >= 0; i--) {
    if (n(M[i].TOTAL) >= avgM) streak++;
    else break;
  }

  var loadLast = n(last['Load_Sale'] || last['Load Sale'] || 0);

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

  var sparkHtml = last6.map(function(v, i) {
    var h = maxL6 > 0 ? Math.max(4, Math.round((v / maxL6) * 38)) : 4;
    var isLast = i === last6.length - 1;
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1">' +
      '<div style="width:100%;border-radius:3px 3px 0 0;height:' + h + 'px;background:' + (isLast ? '#2563eb' : '#bfdbfe') + '"></div>' +
      '</div>';
  }).join('');

  var html = '<div class="aip-section-title">\u26a1 Live Insights</div>';

  html += '<div class="aip-card aip-card-accent">' +
    '<div class="aip-card-label">Total All-Time</div>' +
    '<div class="aip-card-val">\u20a8' + fc(grand) + '</div>' +
    '<div class="aip-card-sub">' + M.length + ' months of data</div>' +
    '</div>';

  html += '<div class="aip-card">' +
    '<div class="aip-card-label">Last Month \u2014 ' + last.Month_Year + '</div>' +
    '<div class="aip-card-val">\u20a8' + fc(lastT) + chgHtml + '</div>' +
    (tgtHtml || '') +
    '</div>';

  html += '<div class="aip-card">' +
    '<div class="aip-card-label">\uD83C\uDFC6 Best Month Ever</div>' +
    '<div class="aip-card-val">\u20a8' + fc(n(bestM.TOTAL)) + '</div>' +
    '<div class="aip-card-sub">' + bestM.Month_Year + '</div>' +
    '</div>';

  if (bestD) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">\uD83D\uDD25 Best Day Ever</div>' +
      '<div class="aip-card-val">\u20a8' + fc(n(bestD.TOTAL)) + '</div>' +
      '<div class="aip-card-sub">' + bestD.Date + ' [' + bestD.Month_Year + ']</div>' +
      '</div>';
  }

  html += '<div class="aip-card">' +
    '<div class="aip-card-label">\uD83D\uDCCA Avg Monthly Sale</div>' +
    '<div class="aip-card-val">\u20a8' + fc(avgM) + '</div>' +
    (streak > 1 ? '<div class="aip-card-sub">\uD83D\uDD25 ' + streak + ' consecutive months \u2265 avg</div>' : '') +
    '</div>';

  if (totalT > 0) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">Cash vs Credit \u2014 ' + last.Month_Year + '</div>' +
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

  if (loadLast > 0) {
    html += '<div class="aip-card">' +
      '<div class="aip-card-label">\u26FD Load Sale \u2014 ' + last.Month_Year + '</div>' +
      '<div class="aip-card-val">\u20a8' + fc(loadLast) + '</div>' +
      '</div>';
  }

  html += '<div class="aip-card">' +
    '<div class="aip-card-label">Last 6 Months Trend</div>' +
    '<div style="display:flex;align-items:flex-end;gap:4px;height:44px;margin-top:8px">' + sparkHtml + '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
      '<span style="font-size:10px;color:#94a3b8">' + (M.slice(-6)[0] || {Month_Year:''}).Month_Year + '</span>' +
      '<span style="font-size:10px;color:#2563eb;font-weight:600">' + last.Month_Year + '</span>' +
    '</div>' +
    '</div>';

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

// ══════════════════════════════════════════════════════════════════════
// CHAT SEND — with group search interception & intent enrichment
// ══════════════════════════════════════════════════════════════════════
async function aiPageSend() {
  var input = document.getElementById('aip-input');
  var text  = (input ? input.value : '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.disabled = true; }

  // ── Restore home screen when input is cleared ──
  setTimeout(_aipRenderHome, 0);

  _aipHistory.push({ role: 'user', text: _aipEsc(text) });
  _aipRender();

  // ── Group Search Interception ──────────────────────────────────────
  if (typeof IntentGroupRegistry !== 'undefined') {
    // Check for "open reports", "show ledger", "go to records" etc.
    if (IntentGroupRegistry.isGroupSearchQuery(text)) {
      var matchedGroup = IntentGroupRegistry.resolveGroupQuery(text);
      if (matchedGroup) {
        // Track usage
        IntentGroupRegistry.trackUsage(matchedGroup.id);

        var groupIntentsHtml2 = matchedGroup.intents.slice(0,8).map(function(id){
          return '<span class="igs-intent-tag">' + _aipEsc(id) + '</span>';
        }).join('');
        if (matchedGroup.intents.length > 8) {
          groupIntentsHtml2 += ' <span class="igs-intent-tag">+' + (matchedGroup.intents.length - 8) + ' more</span>';
        }

        var groupCard = '<div class="igs-group-card">' +
          '<div class="igs-group-card-header">' +
            '<div class="igs-group-card-icon" style="background:' + _aipEsc(matchedGroup.bg) + ';border:1.5px solid ' + _aipEsc(matchedGroup.border) + '">' + matchedGroup.emoji + '</div>' +
            '<div>' +
              '<div class="igs-group-card-title">' + _aipEsc(matchedGroup.name) + '</div>' +
              '<div class="igs-group-card-sub">Shortcut: <b>' + _aipEsc(matchedGroup.shortcut) + '</b></div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:#475569;margin-bottom:8px">' + _igsGetGroupExamples(matchedGroup.id) + '</div>' +
          '<div class="igs-group-intents">' + groupIntentsHtml2 + '</div>' +
          '</div>';

        _aipHistory.push({ role: 'bot', text: '\uD83D\uDCCC Showing <b>' + _aipEsc(matchedGroup.name) + '</b> group:<br>' + groupCard });
        if (input) input.disabled = false;
        _aipRender();
        return;
      }
    }
  }

  // ── Normal AI processing ───────────────────────────────────────────
  var thinkId = '_aip_' + Date.now();
  _aipHistory.push({
    role: 'bot',
    text: '<div class="ai-typing"><span></span><span></span><span></span></div>',
    _id: thinkId,
  });
  _aipRender();

  try {
    var result = await aiBridgeAnswer(text);

    // ── Group enrichment ──────────────────────────────────────────────
    if (result && result.intent && typeof IntentGroupRegistry !== 'undefined') {
      IntentGroupRegistry.enrichIntent(result.intent);
      if (result.intent.groupId) {
        IntentGroupRegistry.trackUsage(result.intent.groupId);
      }
    }

    var idx = _aipHistory.findIndex(function(m){ return m._id === thinkId; });
    if (idx !== -1) _aipHistory.splice(idx, 1);

    var displayText = result.text;

    // ── Group badge on intent ──────────────────────────────────────
    if (result.intent && result.intent.groupId && typeof IntentGroupRegistry !== 'undefined') {
      var g = IntentGroupRegistry.getGroupById(result.intent.groupId);
      if (g) {
        displayText += '<span class="igs-intent-badge" style="background:' + g.bg + ';color:' + g.color + ';border:1px solid ' + g.border + '">' + g.emoji + ' ' + _aipEsc(g.name) + '</span>';
      }
    }

    if (result.intent) {
      var label      = _aipIntentLabel(result.intent);
      var isDestruct = !!result.requiresConfirm;
      var btnClass   = isDestruct ? 'ai-chip ai-chip-red' : 'ai-chip ai-chip-green';
      var btnLabel   = isDestruct ? ('\u26a0\ufe0f ' + label) : ('\u2705 ' + label);
      displayText += '<div class="ai-intent-row">' +
        '<button class="' + btnClass + '" onclick="aiBridgeExecuteIntent(JSON.parse(this.dataset.i));this.parentNode.remove()" data-i="' + JSON.stringify(result.intent).replace(/"/g,'&quot;') + '">' + btnLabel + '</button>' +
        '<button class="ai-chip-dim" onclick="this.parentNode.remove()">Cancel</button>' +
        '</div>';
    }
    _aipHistory.push({ role: 'bot', text: displayText });

    setTimeout(_aipRenderInsights, 400);
  } catch(err) {
    var idx2 = _aipHistory.findIndex(function(m){ return m._id === thinkId; });
    if (idx2 !== -1) _aipHistory.splice(idx2, 1);
    _aipHistory.push({ role: 'bot', text: '\u26a0\ufe0f Error: ' + _aipEsc(err.message) });
  }

  if (input) input.disabled = false;
  _aipRender();
  _aipRenderHome();
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

  // Bind input watcher after DOM is ready
  setTimeout(_aipBindInputWatch, 0);
}

function _aipEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════════════════════════════════
// INTENT LABELS
// ══════════════════════════════════════════════════════════════════════
function _aipIntentLabel(intent) {
  var labels = {
    showPage:              'Open page',
    switchMgrTab:          'Switch tab',
    openStaffCard:         'Open staff card',
    openFieldManager:      'Open field manager',
    switchMonth:           'Switch month',
    openDayModal:          'Open day report',
    openMonthModal:        'Open month report',
    printMonthReport:      'Print month',
    printYearlyReport:     'Print year',
    printMgrReport:        'Print report',
    printDayReport:        'Print day',
    printIncentiveReport:  'Print incentive',
    setDailyField:         'Fill field',
    saveNewDailyEntry:     'Save daily entry',
    editDailyEntry:        'Edit entry',
    deleteDailyEntry:      'DELETE entry',
    clearEntryForm:        'Clear form',
    addStaff:              'Add staff',
    editStaffField:        'Edit staff field',
    deactivateStaff:       'DEACTIVATE staff',
    reactivateStaff:       'Reactivate staff',
    deleteStaff:           'DELETE staff',
    addSalaryRow:          'Add salary row',
    editSalaryRow:         'Edit salary row',
    setSalaryField:        'Set salary field',
    deleteSalaryRow:       'DELETE salary row',
    autoFillSalary:        'Auto-fill salary',
    addGenericRow:         'Add generic row',
    editGenericRow:        'Edit generic row',
    setGenericSale:        'Set generic sale',
    deleteGenericRow:      'DELETE generic row',
    addExpense:            'Add expense',
    editExpenseRow:        'Edit expense row',
    deleteExpenseRow:      'DELETE expense row',
    addCredit:             'Add credit',
    addCreditEmployee:     'Add to credit ledger',
    editCreditEntry:       'Edit credit entry',
    deleteCreditEntry:     'DELETE credit entry',
    deleteCreditEmployee:  'DELETE credit employee',
    setCreditEmpField:     'Set credit field',
    copyToNextMonth:       'COPY to next month',
    copyManagerToNextMonth:'COPY to next month',
    addPettyItem:          'Add petty item',
    addPettyGroup:         'Add petty group',
    editPettyRow:          'Edit petty row',
    deletePettyRow:        'DELETE petty row',
    deletePettyGroup:      'DELETE petty group',
    setMonthTarget:        'Set target',
    deleteMonthTarget:     'DELETE target',
    addCustomSectionRow:   'Add to section',
    createCustomSection:   'Create section',
    deleteCustomSectionRow:'DELETE section row',
    deleteCustomSection:   'DELETE section',
    toggleFieldVisibility: 'Toggle field',
    addCustomField:        'Add custom field',
    resetAllFields:        'RESET all fields',
    recalcIncentive:       'Recalculate incentive',
    pushToSupabase:        'Push to Supabase',
    pullFromSupabase:      'PULL from Supabase',
    backupToDrive:         'Backup to Drive',
    addMemoryFact:         'Remember fact',
    deleteMemoryFact:      'Forget fact',
    addRule:               'Add rule',
    deleteRule:            'DELETE rule',
    setSectionAiConfig:    'Update section AI config',
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
  var micBtn  = document.getElementById('aip-mic');
  var spkBtn  = document.getElementById('igs-speak-btn');
  var inp     = document.getElementById('aip-input');
  _aipMicRec.onstart = function() {
    _aipMicActive = true;
    if (micBtn) { micBtn.textContent = '\uD83D\uDD34'; micBtn.classList.add('recording'); }
    if (spkBtn) spkBtn.classList.add('recording');
    if (inp) inp.placeholder = 'Listening\u2026';
  };
  _aipMicRec.onresult = function(e) {
    var t = Array.from(e.results).map(function(r){ return r[0].transcript; }).join('');
    if (inp) inp.value = t;
  };
  _aipMicRec.onend = function() {
    _aipMicActive = false;
    if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
    if (spkBtn) spkBtn.classList.remove('recording');
    if (inp) inp.placeholder = 'Ask anything\u2026';
    _aipMicRec = null;
    if (inp && inp.value.trim()) {
      if (typeof aimVoiceLogAdd === 'function') aimVoiceLogAdd(inp.value.trim());
      aiPageSend();
    } else {
      _aipRenderHome();
    }
  };
  _aipMicRec.onerror = function() {
    _aipMicActive = false;
    if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
    if (spkBtn) spkBtn.classList.remove('recording');
    _aipMicRec = null;
  };
  _aipMicRec.start();
}

function _aipStopMic() {
  if (_aipMicRec) { try { _aipMicRec.stop(); } catch(_) {} _aipMicRec = null; }
  _aipMicActive = false;
  var micBtn = document.getElementById('aip-mic');
  if (micBtn) { micBtn.textContent = '\uD83C\uDFA4'; micBtn.classList.remove('recording'); }
  var spkBtn = document.getElementById('igs-speak-btn');
  if (spkBtn) spkBtn.classList.remove('recording');
}

// ══════════════════════════════════════════════════════════════════════
// SETTINGS — Groq API key (gear icon)
// ══════════════════════════════════════════════════════════════════════
function aipOpenSettings() {
  var cur = (typeof getAiSettings === 'function') ? getAiSettings().apiKey : '';
  var box = document.getElementById('aip-settings-modal');
  if (!box) return;
  box.innerHTML =
    '<div class="ai-modal-backdrop" onclick="aipCloseSettings()">' +
      '<div class="ai-modal-card" onclick="event.stopPropagation()">' +
        '<div class="ai-modal-title">\u2699\uFE0F AI Settings</div>' +
        '<div style="font-size:12.5px;color:#64748b;margin-bottom:10px">' +
          'Enter your own Groq API key. Get a free key at <b>console.groq.com/keys</b>. ' +
          'It is stored only on this device.' +
        '</div>' +
        '<label style="font-size:12px;font-weight:600;color:#334155;display:block;margin-bottom:4px">Groq API Key</label>' +
        '<input id="aip-key-input" type="password" placeholder="gsk_..." value="' + (cur ? cur.replace(/"/g,'&quot;') : '') + '" ' +
          'style="width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:12px">' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          (cur ? '<button class="ai-chip-dim" onclick="aipClearKey()">Remove Key</button>' : '') +
          '<button class="ai-chip-dim" onclick="aipCloseSettings()">Cancel</button>' +
          '<button class="ai-chip ai-chip-green" onclick="aipSaveKey()">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}
function aipCloseSettings() {
  var box = document.getElementById('aip-settings-modal');
  if (box) box.innerHTML = '';
}
function aipSaveKey() {
  var inp = document.getElementById('aip-key-input');
  var val = inp ? inp.value.trim() : '';
  if (!val) { if (typeof toast === 'function') toast('\u26a0 Enter a key first.', 'w'); return; }
  if (typeof saveAiSettings === 'function') saveAiSettings(val);
  aipCloseSettings();
  if (typeof toast === 'function') toast('\u2705 API key saved.');
  var badge = document.getElementById('aip-live-badge');
  if (badge) { badge.textContent = 'LIVE'; badge.style.background = ''; }
}
function aipClearKey() {
  if (typeof clearAiSettings === 'function') clearAiSettings();
  aipCloseSettings();
  if (typeof toast === 'function') toast('\uD83D\uDDD1\uFE0F API key removed.');
}

// ══════════════════════════════════════════════════════════════════════
// IMAGE SCAN
// ══════════════════════════════════════════════════════════════════════
function aipOpenScan() {
  var inp = document.getElementById('aip-scan-file');
  if (inp) inp.click();
}

async function aipHandleScanFile(file) {
  if (!file) return;
  var modal = document.getElementById('aip-scan-modal');
  if (!modal) return;
  modal.innerHTML = '<div class="ai-modal-backdrop"><div class="ai-modal-card"><div style="text-align:center;padding:24px"><div class="ai-typing"><span></span><span></span><span></span></div><div style="margin-top:12px;font-size:13px;color:#64748b">Analysing image\u2026</div></div></div></div>';
  try {
    var reader = new FileReader();
    var dataUrl = await new Promise(function(res, rej) { reader.onload = function(e){ res(e.target.result); }; reader.onerror = rej; reader.readAsDataURL(file); });
    var result = await (typeof _callGroqVision === 'function' ? _callGroqVision(dataUrl, '') : Promise.reject(new Error('Vision not available')));
    // Sale Report mode returns an object with _isSaleReport flag
    if (result && result._isSaleReport) {
      _aipShowSaleReportResults(result, modal);
    } else {
      // Generic entries array
      var entries = Array.isArray(result) ? result : [];
      if (!entries.length) { modal.innerHTML = ''; if (typeof toast === 'function') toast('\u26a0 No entries found in image.', 'w'); return; }
      _aipShowScanResults(entries, modal);
    }
  } catch(e) {
    modal.innerHTML = '';
    if (typeof toast === 'function') toast('\u26a0 Scan failed: ' + e.message, 'w');
  }
}

// ── SALE REPORT: structured preview + Daily Entry import ─────────────
function _aipShowSaleReportResults(result, modal) {
  var fields  = result.fields  || {};
  var expenses = result.expenses || [];
  var petty   = result.petty   || [];
  var date    = result.date;  // YYYY-MM-DD or null

  // Format date nicely for display
  var dateLabel = date ? date : 'Today (date not detected)';
  var fieldCount = Object.keys(fields).length;
  var extraCount = expenses.length + petty.length;

  // Build field rows display
  var fieldNames = {
    Cash_Sale:'Cash Sale', Cash_Returns:'Cash Returns', Meezan_Bank:'Meezan Bank',
    Alfala_Bank:'Bank Alfalah', Bank_Al_Habib:'Bank Al Habib', HBL:'HBL', MCB:'MCB',
    PSO:'PSO', PSO_Returns:'PSO Returns', NESPAK:'NESPAK', NESPAK_Returns:'NESPAK Returns',
    PARCO:'PARCO', PARCO_Returns:'PARCO Returns', TEPA:'TEPA', TEPA_Returns:'TEPA Returns',
    LDA:'LDA', LDA_Returns:'LDA Returns', Askari_Bank:'Askari', Askari_Bank_Returns:'Askari Returns',
    F_Issue:'Free Issue', Customers:'Customers', FDPP:'FDPP POS', FDPP_Con:'FDPP Consumer',
    Load_Sale:'Load Sale', Amount_Received:'Amount Received', Cash_to_Deposit:'Cash to Deposit',
    COMP_SALE:'Comp Sale',
  };

  var rows = Object.keys(fields).map(function(fid) {
    var val = fields[fid];
    var label = fieldNames[fid] || fid.replace(/_/g,' ');
    var isNeg = val < 0;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px">' +
      '<span style="color:#475569">' + label + '</span>' +
      '<span style="font-family:monospace;font-weight:700;color:' + (isNeg?'#dc2626':'#1e293b') + '">' + (isNeg?'-':'') + '\u20a8' + Math.abs(Math.round(val)).toLocaleString('en-PK') + '</span>' +
    '</div>';
  }).join('');

  var extraRows = '';
  if (expenses.length) extraRows += expenses.map(function(e){ return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12px"><span style="color:#d97706">\u26a0 ' + e.name + ' (Expense)</span><span style="font-family:monospace;font-weight:700">\u20a8' + Math.round(e.amount).toLocaleString('en-PK') + '</span></div>'; }).join('');
  if (petty.length)    extraRows += petty.map(function(e){    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12px"><span style="color:#16a34a">\u26a0 ' + e.name + ' (Petty Cash)</span><span style="font-family:monospace;font-weight:700">\u20a8' + Math.round(e.amount).toLocaleString('en-PK') + '</span></div>'; }).join('');

  var safeResult = JSON.stringify(result).replace(/"/g,'&quot;');

  modal.innerHTML =
    '<div class="ai-modal-backdrop" onclick="if(event.target===this){document.getElementById(\'aip-scan-modal\').innerHTML=\'\'}">' +
    '<div class="ai-modal-card" style="max-width:480px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="font-size:22px">📊</span>' +
        '<div>' +
          '<div class="ai-modal-title" style="margin-bottom:0">Sale Report Detected</div>' +
          '<div style="font-size:11.5px;color:#64748b">Date: <strong>' + dateLabel + '</strong> &nbsp;·&nbsp; ' + fieldCount + ' fields extracted' + (extraCount?' + '+extraCount+' extras':'') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="max-height:320px;overflow-y:auto;margin:12px 0;padding:0 2px">' + rows + extraRows + '</div>' +
      (extraCount ? '<div style="font-size:11.5px;color:#d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:10px">' +
        '\u26a0 Till Short / Patty Cash detected — use the buttons below to also send those to Expenses or Petty Cash.' +
      '</div>' : '') +
      '<div style="font-size:12px;color:#64748b;margin-bottom:10px">Tap <strong>\u2192 Daily Entry</strong> to fill the entry form for ' + dateLabel + '. You can also save extras separately.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="ai-chip-dim" onclick="document.getElementById(\'aip-scan-modal\').innerHTML=\'\'">Cancel</button>' +
        (expenses.length ? '<button class="ai-chip" style="background:#fffbeb;color:#d97706;border:1px solid #fde68a" onclick="_aipImportSaleReportExtras(' + safeResult + ',\'expense\')">+ Expenses</button>' : '') +
        (petty.length    ? '<button class="ai-chip" style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0" onclick="_aipImportSaleReportExtras(' + safeResult + ',\'petty\')">+ Petty Cash</button>' : '') +
        '<button class="ai-chip ai-chip-green" style="font-size:13px;padding:9px 18px" onclick="_aipImportSaleReport(' + safeResult + ')">\u2192 Daily Entry</button>' +
      '</div>' +
    '</div>' +
    '</div>';
}

function _aipImportSaleReport(result) {
  var modal = document.getElementById('aip-scan-modal');
  if (modal) modal.innerHTML = '';
  if (!result || !result.fields || !Object.keys(result.fields).length) {
    if (typeof toast === 'function') toast('\u26a0 No fields to import.', 'w'); return;
  }
  // Convert YYYY-MM-DD to the app's date format (DD-Mon-YYYY)
  var isoDate = result.date;
  var entryDate = isoDate;
  if (isoDate) {
    var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var parts = isoDate.split('-');
    if (parts.length === 3) entryDate = parts[2]+'-'+M[parseInt(parts[1],10)-1]+'-'+parts[0];
  }
  if (!entryDate) {
    var d = new Date();
    var M2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    entryDate = String(d.getDate()).padStart(2,'0')+'-'+M2[d.getMonth()]+'-'+d.getFullYear();
  }
  if (typeof _aiSaveNewDailyEntry === 'function') {
    _aiSaveNewDailyEntry(entryDate, result.fields);
    var count = Object.keys(result.fields).length;
    if (typeof toast === 'function') toast('\u2705 ' + count + ' fields imported to Daily Entry for ' + entryDate + '.');
    _aipHistory.push({ role:'bot', text:'\u2705 Sale report imported: <b>' + count + ' fields</b> filled in Daily Entry for <b>' + entryDate + '</b>.' +
      (result.expenses.length||result.petty.length ? '<br><span style="color:#d97706">\u26a0 Also save Till Short / Patty Cash separately using the import buttons.</span>' : '') });
    _aipRender();
    setTimeout(_aipRenderInsights, 600);
  } else {
    if (typeof toast === 'function') toast('\u26a0 Daily entry function not available.', 'w');
  }
}

function _aipImportSaleReportExtras(result, dest) {
  var items = dest === 'expense' ? (result.expenses||[]) : (result.petty||[]);
  if (!items.length) return;
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = new Date(); var today = String(d.getDate()).padStart(2,'0')+'-'+M[d.getMonth()]+'-'+d.getFullYear();
  items.forEach(function(e) {
    if (dest === 'expense' && typeof _aiAddExpenseRow === 'function') {
      _aiAddExpenseRow(today, e.description||e.name||'Sale report expense', 0,0,0,0, Math.round(e.amount), 0);
    } else if (dest === 'petty' && typeof _aiAddPettyItem === 'function') {
      _aiAddPettyItem(e.description||e.name||'Sale report petty', Math.round(e.amount), '');
    }
  });
  if (typeof toast === 'function') toast('\u2705 ' + items.length + ' item(s) added to ' + dest + '.');
  _aipHistory.push({ role:'bot', text:'\u2705 <b>'+items.length+'</b> extra item(s) saved to <b>'+dest+'</b> from sale report.' });
  _aipRender();
}

// ── GENERIC SCAN: original entries display ────────────────────────────
function _aipShowScanResults(entries, modal) {
  var rows = entries.map(function(e, i) {
    var typeColor = { credit:'#eff6ff', expense:'#fef3c7', petty:'#f0fdf4', cash:'#f5f3ff', other:'#f8fafc' };
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      '<input type="checkbox" id="sc-r-'+i+'" checked style="width:auto;margin:0">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12.5px;font-weight:600;color:#0f172a">' + _aipEsc(e.name || e.description || 'Entry') + '</div>' +
        '<div style="font-size:11px;color:#64748b">' + _aipEsc(e.description || '') + '</div>' +
      '</div>' +
      '<div style="font-size:13px;font-weight:700;color:#1e293b;flex-shrink:0">\u20a8' + Math.round(e.amount).toLocaleString('en-PK') + '</div>' +
      '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;background:' + (typeColor[e.type]||'#f8fafc') + ';color:#334155">' + e.type + '</span>' +
    '</div>';
  }).join('');

  modal.innerHTML = '<div class="ai-modal-backdrop" onclick="if(event.target===this){document.getElementById(\'aip-scan-modal\').innerHTML=\'\'}">' +
    '<div class="ai-modal-card">' +
      '<div class="ai-modal-title">\uD83D\uDCF7 Scan Results (' + entries.length + ' entries)</div>' +
      '<div style="max-height:340px;overflow-y:auto;margin-bottom:12px">' + rows + '</div>' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:12px">Select entries to import, then choose a destination.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="ai-chip-dim" onclick="document.getElementById(\'aip-scan-modal\').innerHTML=\'\'">Cancel</button>' +
        '<button class="ai-chip ai-chip-green" onclick="_aipImportScanEntries(' + JSON.stringify(entries).replace(/"/g,'&quot;') + ',\'credit\')">&#8594; Credit Ledger</button>' +
        '<button class="ai-chip ai-chip-green" onclick="_aipImportScanEntries(' + JSON.stringify(entries).replace(/"/g,'&quot;') + ',\'expense\')">&#8594; Expenses</button>' +
        '<button class="ai-chip ai-chip-green" onclick="_aipImportScanEntries(' + JSON.stringify(entries).replace(/"/g,'&quot;') + ',\'petty\')">&#8594; Petty Cash</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _aipImportScanEntries(entries, dest) {
  var modal = document.getElementById('aip-scan-modal');
  var checked = entries.filter(function(e, i) { var cb = document.getElementById('sc-r-'+i); return cb && cb.checked; });
  if (!checked.length) { if (typeof toast === 'function') toast('\u26a0 No entries selected.', 'w'); return; }
  if (modal) modal.innerHTML = '';
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = new Date(); var today = String(d.getDate()).padStart(2,'0')+'-'+M[d.getMonth()]+'-'+d.getFullYear();
  checked.forEach(function(e) {
    if (dest === 'credit' && typeof _aiAddCreditEntry === 'function') {
      _aiAddCreditEntry(e.name || 'Unknown', e.amount, e.description, today);
    } else if (dest === 'expense' && typeof _aiAddExpenseRow === 'function') {
      _aiAddExpenseRow(today, e.description || e.name || 'Scanned expense', 0,0,0,0, Math.round(e.amount), 0);
    } else if (dest === 'petty' && typeof _aiAddPettyItem === 'function') {
      _aiAddPettyItem(e.description || e.name || 'Scanned item', Math.round(e.amount), '');
    }
  });
  if (typeof toast === 'function') toast('\u2705 ' + checked.length + ' entr' + (checked.length===1?'y':'ies') + ' imported to ' + dest + '.');
  _aipHistory.push({ role:'bot', text:'\u2705 <b>' + checked.length + '</b> scanned entr' + (checked.length===1?'y':'ies') + ' imported to <b>' + dest + '</b>.' });
  _aipRender();
  setTimeout(_aipRenderInsights, 500);
}


// AI PAGE NAV RAIL — aipNavSelect + attach picker
// ══════════════════════════════════════════════════════════════════════

// Track active nav tab
var _aipActiveNav = 'chat';

function aipNavSelect(tab) {
  _aipActiveNav = tab;

  // Update active state on ALL nav buttons (desktop rail + mobile bar)
  ['chat','context','knowledge','settings'].forEach(function(t) {
    var desktop = document.getElementById('aip-nav-' + t);
    var mobile  = document.getElementById('aip-mob-' + t);
    var active = (t === tab);
    if (desktop) desktop.classList.toggle('active', active);
    if (mobile)  mobile.classList.toggle('active', active);
  });

  // Open the corresponding panel
  switch (tab) {
    case 'chat':      /* do nothing – chat is always visible */ break;
    case 'context':   if (typeof actxOpen === 'function') actxOpen(); break;
    case 'knowledge': aipOpenKnowledge(); break;
    case 'settings':  if (typeof aipOpenSettings === 'function') aipOpenSettings(); break;
  }

  // Reset to 'chat' after panel opens (so tap→open→close leaves chat highlighted)
  if (tab !== 'chat') {
    setTimeout(function() {
      _aipActiveNav = 'chat';
      var dc = document.getElementById('aip-nav-chat');
      var mc = document.getElementById('aip-mob-chat');
      if (dc) dc.classList.add('active');
      if (mc) mc.classList.add('active');
      ['context','knowledge','settings'].forEach(function(t) {
        var d = document.getElementById('aip-nav-' + t);
        var m = document.getElementById('aip-mob-' + t);
        if (d) d.classList.remove('active');
        if (m) m.classList.remove('active');
      });
    }, 400);
  }
}

// ── Knowledge panel — unified Instructions + Memory picker ────────────
function aipOpenKnowledge() {
  var existing = document.getElementById('aip-knowledge-sheet');
  if (existing) { existing.remove(); }

  var sheet = document.createElement('div');
  sheet.id = 'aip-knowledge-sheet';
  sheet.style.cssText = [
    'position:fixed;inset:0;z-index:22000;',
    'background:rgba(15,23,42,.55);backdrop-filter:blur(4px);',
    '-webkit-backdrop-filter:blur(4px);',
    'display:flex;align-items:flex-end;justify-content:center;',
    'opacity:0;transition:opacity .18s ease;',
  ].join('');

  sheet.innerHTML = [
    '<div style="',
      'width:100%;max-width:480px;',
      'background:#fff;border-radius:22px 22px 0 0;',
      'padding:0 0 env(safe-area-inset-bottom,0) 0;',
      'box-shadow:0 -8px 40px rgba(0,0,0,.18);',
      'transform:translateY(20px);transition:transform .22s cubic-bezier(.34,1.2,.64,1);',
    '" id="aip-kn-inner">',

      /* drag handle */
      '<div style="display:flex;justify-content:center;padding:12px 0 4px">',
        '<div style="width:40px;height:4px;border-radius:3px;background:#e2e8f0"></div>',
      '</div>',

      /* header */
      '<div style="padding:8px 20px 16px;border-bottom:1px solid #f1f5f9">',
        '<div style="font-size:18px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:9px">',
          '<span style="font-size:22px">📚</span> Knowledge Base',
        '</div>',
        '<div style="font-size:12px;color:#64748b;margin-top:3px">',
          'Everything you\u2019ve taught the AI about your business',
        '</div>',
      '</div>',

      /* two big choice tiles */
      '<div style="padding:16px 16px 10px;display:flex;flex-direction:column;gap:10px">',

        /* Instructions tile */
        '<button onclick="aipCloseKnowledge();setTimeout(function(){ainOpen&&ainOpen()},120)" style="',
          'display:flex;align-items:center;gap:14px;',
          'background:linear-gradient(135deg,#eff6ff,#dbeafe);',
          'border:1.5px solid #bfdbfe;border-radius:14px;',
          'padding:16px 18px;cursor:pointer;text-align:left;width:100%;',
          'transition:background .13s,border-color .13s;',
        '" onmouseenter="this.style.background=\'linear-gradient(135deg,#dbeafe,#bfdbfe)\'" ',
           'onmouseleave="this.style.background=\'linear-gradient(135deg,#eff6ff,#dbeafe)\'">',
          '<span style="font-size:32px;line-height:1;flex-shrink:0">🤖</span>',
          '<div>',
            '<div style="font-size:14px;font-weight:700;color:#1e40af">Instructions</div>',
            '<div style="font-size:12px;color:#3b82f6;margin-top:2px;line-height:1.45">',
              'Static facts &amp; rules you type once — always injected into every AI prompt.',
              '<br>E.g. \u201cWe close on Fridays\u201d or \u201cTarget is 5M\u201d',
            '</div>',
          '</div>',
        '</button>',

        /* Memory tile */
        '<button onclick="aipCloseKnowledge();setTimeout(function(){aimOpenPanel&&aimOpenPanel()},120)" style="',
          'display:flex;align-items:center;gap:14px;',
          'background:linear-gradient(135deg,#f5f3ff,#ede9fe);',
          'border:1.5px solid #c4b5fd;border-radius:14px;',
          'padding:16px 18px;cursor:pointer;text-align:left;width:100%;',
          'transition:background .13s,border-color .13s;',
        '" onmouseenter="this.style.background=\'linear-gradient(135deg,#ede9fe,#ddd6fe)\'" ',
           'onmouseleave="this.style.background=\'linear-gradient(135deg,#f5f3ff,#ede9fe)\'">',
          '<span style="font-size:32px;line-height:1;flex-shrink:0">🧠</span>',
          '<div>',
            '<div style="font-size:14px;font-weight:700;color:#6d28d9">Memory</div>',
            '<div style="font-size:12px;color:#7c3aed;margin-top:2px;line-height:1.45">',
              'AI\u2019s learned facts, IF\u2192THEN rules, correction training &amp; voice log.',
              '<br>Say \u201cRemember: Usman handles jazz cash\u201d to add here.',
            '</div>',
          '</div>',
        '</button>',

      '</div>',

      /* hint footer */
      '<div style="padding:4px 20px 18px;font-size:11px;color:#94a3b8;text-align:center">',
        'Tip: say \u201cRemember \u2026\u201d in chat to add a memory instantly &nbsp;\u00b7&nbsp; ',
        'say \u201cForget \u2026\u201d to remove one',
      '</div>',

    '</div>',
  ].join('');

  sheet.addEventListener('click', function(e) {
    if (e.target === sheet) aipCloseKnowledge();
  });

  document.body.appendChild(sheet);

  requestAnimationFrame(function() {
    sheet.style.opacity = '1';
    var inner = document.getElementById('aip-kn-inner');
    if (inner) inner.style.transform = 'translateY(0)';
  });
}

function aipCloseKnowledge() {
  var sheet = document.getElementById('aip-knowledge-sheet');
  if (!sheet) return;
  sheet.style.opacity = '0';
  var inner = document.getElementById('aip-kn-inner');
  if (inner) inner.style.transform = 'translateY(20px)';
  setTimeout(function() { if (sheet.parentNode) sheet.remove(); }, 200);
}

// ── Attach / image picker ────────────────────────────────────────────
function aipOpenAttach() {
  var existing = document.getElementById('aip-attach-sheet');
  if (existing) { existing.classList.add('open'); return; }

  var sheet = document.createElement('div');
  sheet.id = 'aip-attach-sheet';
  sheet.className = 'aip-attach-sheet';
  sheet.innerHTML =
    '<div class="aip-attach-inner">' +
      '<div class="aip-attach-title">📎 Attach Image</div>' +
      '<div class="aip-attach-grid">' +
        '<button class="aip-attach-opt" onclick="aipAttachPick(\'camera\')">' +
          '<span class="aip-attach-opt-icon">📷</span>Camera' +
        '</button>' +
        '<button class="aip-attach-opt" onclick="aipAttachPick(\'gallery\')">' +
          '<span class="aip-attach-opt-icon">🖼️</span>Gallery' +
        '</button>' +
        '<button class="aip-attach-opt" onclick="aipAttachPick(\'file\')">' +
          '<span class="aip-attach-opt-icon">📁</span>File' +
        '</button>' +
      '</div>' +
      '<div style="margin-top:14px;padding:10px 12px;background:#eff6ff;border-radius:10px;border:1.5px solid #bfdbfe">' +
        '<div style="font-size:11.5px;font-weight:700;color:#1d4ed8;margin-bottom:5px">📋 What can I scan?</div>' +
        '<div style="font-size:11px;color:#3730a3;line-height:1.7">' +
          '• Handwritten ledger sheets &amp; credit lists<br>' +
          '• Screenshots of expense tables<br>' +
          '• Photos of written entries<br>' +
          '• Any document with names &amp; amounts' +
        '</div>' +
      '</div>' +
      '<button class="aip-attach-cancel" onclick="aipCloseAttach()">Cancel</button>' +
    '</div>';

  sheet.addEventListener('click', function(e) { if (e.target === sheet) aipCloseAttach(); });
  document.body.appendChild(sheet);
  requestAnimationFrame(function() { sheet.classList.add('open'); });
}

function aipCloseAttach() {
  var sheet = document.getElementById('aip-attach-sheet');
  if (sheet) { sheet.classList.remove('open'); }
}

function aipAttachPick(source) {
  aipCloseAttach();
  // Re-use the existing hidden file input, adjusting capture attribute
  var inp = document.getElementById('aip-scan-file');
  if (!inp) return;
  if (source === 'camera') {
    inp.setAttribute('capture', 'environment');
    inp.setAttribute('accept', 'image/*');
  } else if (source === 'gallery') {
    inp.removeAttribute('capture');
    inp.setAttribute('accept', 'image/*');
  } else {
    inp.removeAttribute('capture');
    inp.setAttribute('accept', 'image/*,application/pdf,.pdf');
  }
  setTimeout(function() { inp.click(); }, 120);
}

// ── Auto-init nav rail active state ──────────────────────────────────
(function _aipNavInit() {
  function _setInitial() {
    var btn = document.getElementById('aip-nav-chat');
    var mob = document.getElementById('aip-mob-chat');
    if (btn) btn.classList.add('active');
    if (mob) mob.classList.add('active');
    // Ensure non-chat tabs start inactive
    ['context','knowledge','settings'].forEach(function(t) {
      var d = document.getElementById('aip-nav-' + t);
      var m = document.getElementById('aip-mob-' + t);
      if (d) d.classList.remove('active');
      if (m) m.classList.remove('active');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setInitial);
  } else {
    setTimeout(_setInitial, 100);
  }
}());
