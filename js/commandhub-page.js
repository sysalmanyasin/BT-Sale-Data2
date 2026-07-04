/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CommandHub PAGE  —  BT Sales App  ·  Phase 2                      ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Embedded full-page AI command interface.                            ║
 * ║  Layer 1: Typed text, voice (mic), image scan                       ║
 * ║  Layer 2: Local-parser-first routing via aiBridgeAnswer()           ║
 * ║           (Groq fallback still works when key is set)               ║
 * ║  Layer 3: Conversation thread + intent confirm/execute              ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Public API (called from ui.js + index.html):                       ║
 * ║    loadCommandHubPage()  — init/refresh when page opens             ║
 * ║    chpSend()             — process current input                    ║
 * ║    chpToggleMic()        — start/stop voice recognition             ║
 * ║    chpOpenScan()         — open image-attach sheet (overridden by   ║
 * ║                             ai-helpers.js with the richer UI)        ║
 * ║    chpHandleScanFile(f)  — process a scan image                     ║
 * ║    chpAsk(text)          — programmatic "type + send"               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

(function _chpInjectStyles() {
  if (document.getElementById('chp-styles')) return;
  const el = document.createElement('style');
  el.id = 'chp-styles';
  el.textContent = `
/* ── Layout ── */
#page-commandhub {
  flex-direction: column; height: 100%; overflow: hidden;
  background: var(--bg, #f8fafc);
}
.page.on#page-commandhub {
  display: flex;
}
.chp-layout {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
}

/* ── Live State Banner ── */
.chp-live-banner {
  flex-shrink: 0; padding: 0 12px 8px; 
}
.chp-live-card {
  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
  border: 1.5px solid #bfdbfe; border-radius: 12px;
  padding: 10px 14px; font-size: 13px; color: #1e3a5f;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  line-height: 1.45;
}
.chp-live-card.warn {
  background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);
  border-color: #fcd34d; color: #78350f;
}
.chp-live-card.success {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #86efac; color: #14532d;
}
.chp-state-btn {
  background: #2563eb; color: #fff; border: none;
  padding: 3px 10px; border-radius: 6px; font-size: 12px;
  cursor: pointer; font-weight: 600; white-space: nowrap;
}
.chp-state-btn:hover { background: #1d4ed8; }
.chp-dismiss-btn {
  margin-left: auto; background: none; border: none;
  color: #94a3b8; cursor: pointer; font-size: 16px; line-height: 1;
  padding: 0 2px;
}

/* ── Quick Action Chips ── */
.chp-chips-wrap {
  flex-shrink: 0; padding: 0 12px 8px; overflow-x: auto;
  scrollbar-width: none;
}
.chp-chips-wrap::-webkit-scrollbar { display: none; }
.chp-chips-row {
  display: flex; gap: 7px; padding-bottom: 2px;
}
.chp-chip {
  flex-shrink: 0; background: #fff; border: 1.5px solid #e2e8f0;
  border-radius: 20px; padding: 5px 13px; font-size: 12px;
  cursor: pointer; color: #334155; font-weight: 500;
  transition: all 0.12s; white-space: nowrap; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.chp-chip:hover, .chp-chip:active { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
.chp-chip.recent {
  background: #f8fafc; border-style: dashed; color: #64748b;
}

/* ── Thread ── */
.chp-thread {
  flex: 1; overflow-y: auto; padding: 8px 12px 4px;
  scroll-behavior: smooth; overscroll-behavior: contain;
}
.chp-thread:empty::before {
  content: attr(data-placeholder);
  display: block; text-align: center; color: #94a3b8;
  font-size: 13px; padding: 32px 16px; line-height: 1.6;
}

/* ── Messages ── */
.chp-msg {
  display: flex; margin-bottom: 10px;
  animation: chpFadeIn 0.18s ease;
}
@keyframes chpFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.chp-msg.user { justify-content: flex-end; }
.chp-msg.bot  { justify-content: flex-start; }
.chp-bubble {
  max-width: 82%; padding: 9px 13px; border-radius: 14px;
  font-size: 13.5px; line-height: 1.5; word-break: break-word;
}
.chp-msg.user .chp-bubble {
  background: #2563eb; color: #fff; border-bottom-right-radius: 4px;
}
.chp-msg.bot .chp-bubble {
  background: #fff; color: #0f172a; border: 1.5px solid #e2e8f0;
  border-bottom-left-radius: 4px;
}

/* ── Typing indicator ── */
.chp-typing { display: flex; gap: 4px; align-items: center; padding: 4px 2px; }
.chp-typing span {
  width: 7px; height: 7px; border-radius: 50%; background: #94a3b8;
  display: inline-block; animation: chpDot 1.2s infinite;
}
.chp-typing span:nth-child(2) { animation-delay: 0.2s; }
.chp-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes chpDot { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }

/* ── Intent action row ── */
.chp-intent-row {
  display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;
}
.chp-exec-btn {
  padding: 5px 13px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.1s;
}
.chp-exec-btn:hover { opacity: 0.85; }
.chp-exec-btn.safe { background: #d1fae5; color: #065f46; }
.chp-exec-btn.destructive { background: #fee2e2; color: #991b1b; }
.chp-cancel-btn {
  padding: 5px 11px; border-radius: 8px; border: 1.5px solid #e2e8f0;
  background: #f8fafc; color: #64748b; font-size: 12px; cursor: pointer;
}

/* ── Input Bar ── */
.chp-inputbar {
  flex-shrink: 0; display: flex; align-items: center; gap: 8px;
  padding: 8px 12px 12px; background: #fff;
  border-top: 1.5px solid #e2e8f0;
}
.chp-icon-btn {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #f8fafc;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; cursor: pointer; transition: all 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.chp-icon-btn:hover { background: #eff6ff; border-color: #93c5fd; }
.chp-icon-btn.active { background: #fee2e2; border-color: #fca5a5; }
#chp-input {
  flex: 1; border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 9px 13px; font-size: 14px; outline: none;
  font-family: 'Inter', system-ui, sans-serif; color: #0f172a;
  background: #f8fafc; transition: border-color 0.12s;
}
#chp-input:focus { border-color: #93c5fd; background: #fff; }
#chp-input::placeholder { color: #94a3b8; }
.chp-send-btn {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px;
  background: #2563eb; color: #fff; border: none; font-size: 17px;
  cursor: pointer; display: flex; align-items: center;
  justify-content: center; transition: background 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.chp-send-btn:hover { background: #1d4ed8; }
.chp-send-btn:disabled { background: #cbd5e1; cursor: default; }

/* ── Section label inside thread ── */
.chp-thread-label {
  text-align: center; font-size: 10px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: #94a3b8;
  margin: 6px 0 10px; user-select: none;
}

/* ── Safe-mode badge ── */
.chp-badge-groq {
  display: inline-block; font-size: 10px; font-weight: 700;
  background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0;
  border-radius: 5px; padding: 1px 6px; margin-left: 6px;
  vertical-align: middle;
}
.chp-badge-local {
  display: inline-block; font-size: 10px; font-weight: 700;
  background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;
  border-radius: 5px; padding: 1px 6px; margin-left: 6px;
  vertical-align: middle;
}

/* ── Quick Shortcuts popup ── */
.chp-quick-trigger {
  font-weight: 700; background: #eff6ff; border-color: #bfdbfe; color: #1e40af;
}
.chp-quick-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 9000;
  display: flex; align-items: flex-end; justify-content: center;
}
.chp-quick-sheet {
  width: 100%; max-width: 520px; max-height: 78vh; background: var(--s1,#fff);
  border-radius: 18px 18px 0 0; box-shadow: 0 -4px 32px rgba(0,0,0,.18);
  display: flex; flex-direction: column; overflow: hidden;
}
.chp-quick-head {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 12px; border-bottom: 1.5px solid var(--border,#e2e8f0);
}
.chp-quick-body { flex: 1; overflow-y: auto; padding: 12px 16px 28px; }
.chp-quick-group { margin-bottom: 16px; }
.chp-quick-group-title {
  font-size: 12px; font-weight: 700; letter-spacing: .04em; color: #475569;
  margin-bottom: 8px;
}
.chp-quick-group-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.chp-quick-item {
  background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 8px 12px; font-size: 12.5px; color: #334155; font-weight: 500;
  cursor: pointer; transition: all 0.12s; -webkit-tap-highlight-color: transparent;
}
.chp-quick-item:hover, .chp-quick-item:active { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
`;
  document.head.appendChild(el);
})();

/* ══════════════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════════════ */
var _chHistory   = [];           // [{role, text, _id?}]
var _chRecent    = [];           // recent command strings
var _chMicActive = false;
var _chMicRec    = null;
var _chInited    = false;
var _chDismissed = false;        // live banner dismiss state (session)

var CHP_RECENT_KEY = 'bt_chp_recent'; // chat-page commands (strings)
var CHP_RECENT_MAX = 12;

/* ══════════════════════════════════════════════════════════════════════
   QUICK ACTIONS
══════════════════════════════════════════════════════════════════════ */
var _chQuickGroups = [
  {
    id: 'sale', icon: '💰', label: 'Sale',
    items: [
      { label: '📊 Today\'s total',         fn: 'hubPrintTodayReport()' },
      { label: '🎯 Pace check',             fn: 'hubPrintPaceReport()' },
      { label: '💳 Credit balance',         fn: 'hubPrintCreditSummary()' },
      { label: '📅 Print This Month',       fn: 'hubPrintMonthSummary()' },
      { label: '📆 Print This Year',        fn: 'hubPrintYearReport()' },
      { label: '📄 Export summary',         cmd: 'export manager summary' },
      { label: '➕ Add today\'s entry',     cmd: null, nav: 'entry' },
    ],
  },
  {
    id: 'staff', icon: '👔', label: 'Staff',
    items: [
      { label: '👔 Staff registry',         cmd: null, nav: 'manager', tab: 'staff' },
      { label: '💵 Salary tab',             cmd: null, nav: 'manager', tab: 'salary' },
      { label: '🏅 Incentive tab',          cmd: null, nav: 'manager', tab: 'incentive' },
      { label: '📋 Incentive summary',      fn: 'printIncentiveReport()' },
    ],
  },
  {
    id: 'expenses', icon: '📋', label: 'Expenses',
    items: [
      { label: '📋 Expense summary',        fn: 'hubPrintExpenseSummary()' },
      { label: '💸 Petty expenses',         cmd: null, nav: 'manager', tab: 'petty' },
      { label: '➕ Add expense',            cmd: 'add expense' },
    ],
  },
  {
    id: 'jazzcash', icon: '🏦', label: 'Jazz Cash',
    items: [
      { label: '🏦 JC Balance',            fn: 'hubShowJazzCashBalance()' },
      { label: '➕ Add JC Credit',          cmd: 'jazz cash received' },
      { label: '↔️ JC Transfer',            cmd: 'jazz cash transfer' },
      { label: '⬇ Patty Incentive',        cmd: 'jazz cash patty incentive' },
      { label: '💸 Generic Incentive',     cmd: 'jazz cash generic incentive' },
      { label: '📒 Open JC Ledger',        cmd: null, nav: 'manager', tab: 'jazzcash' },
    ],
  },
  {
    id: 'notes', icon: '📝', label: 'Notes & Sheets',
    items: [
      { label: '📝 Today\'s Notes',         cmd: 'show today notes' },
      { label: '➕ Add Note',               cmd: 'add note' },
      { label: '📌 Pinned Notes',           cmd: 'show pinned notes' },
      { label: '🔍 Search Notes',           cmd: 'search notes' },
      { label: '📊 Open Sheets',            cmd: null, nav: 'manager', tab: 'sheets' },
      { label: '🗂 Manage Sheets',          fn: "showPage('manager');setTimeout(function(){switchMgrTab('sheets');setTimeout(function(){if(typeof _nsSetPanel==='function')_nsSetPanel('manage')},300)},250)" },
      { label: '🧠 Memory Panel',           fn: 'if(typeof aimOpenPanel===\'function\')aimOpenPanel()' },
      { label: '📋 Daily Briefing',         fn: 'chpShowBriefing()' },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════
   INIT / LOAD
══════════════════════════════════════════════════════════════════════ */
function loadCommandHubPage() {
  _chRecent = _chpLoadRecent();
  _chRenderLiveBanner();
  _chRenderThread();
  _chRenderChips();
  if (!_chInited) {
    _chInited = true;

    // ── Phase 5: Memory briefing + rule alerts on first open ──────────
    var msgs = [];

    // 1. Daily briefing from ai-memory.js
    if (typeof aimBriefingGenerate === 'function') {
      try {
        var briefing = aimBriefingGenerate();
        if (briefing) {
          msgs.push({ role: 'bot', text: '📋 <strong>Daily Briefing</strong><br>' + briefing.replace(/</g, '&lt;').replace(/&lt;br&gt;/g, '<br>') });
        }
      } catch (_) {}
    }

    // 2. Rule alerts
    if (typeof aimRulesCheckAll === 'function') {
      try {
        var fired = aimRulesCheckAll();
        if (fired && fired.length) {
          var alertHtml = fired.map(function (f) { return f.msg; }).join('<br>');
          msgs.push({ role: 'bot', text: '<div style="border-left:3px solid #f59e0b;padding-left:8px">' + alertHtml + '</div>' });
        }
      } catch (_) {}
    }

    _chHistory = msgs;
    _chRenderThread();
  }
  // Focus input after paint
  requestAnimationFrame(function () {
    var inp = document.getElementById('chp-input');
    if (inp && document.activeElement !== inp) inp.focus();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   MEMORY HELPERS  (Phase 5)
══════════════════════════════════════════════════════════════════════ */
function chpShowBriefing() {
  if (typeof aimBriefingGenerate !== 'function') {
    _chHistory.push({ role: 'bot', text: '⚠ Briefing engine not loaded yet. Try again in a moment.' });
    _chRenderThread();
    return;
  }
  var briefing = aimBriefingGenerate(true); // force=true → always regenerate
  if (!briefing) {
    _chHistory.push({ role: 'bot', text: 'ℹ No briefing data available — enter at least one daily record first.' });
    _chRenderThread();
    return;
  }
  _chHistory.push({ role: 'bot', text: '📋 <strong>Daily Briefing</strong><br>' + briefing.replace(/</g, '&lt;') });
  _chRenderThread();
}

/* ══════════════════════════════════════════════════════════════════════
   LIVE STATE BANNER
══════════════════════════════════════════════════════════════════════ */
function _chRenderLiveBanner() {
  var wrap = document.getElementById('chp-live-banner');
  if (!wrap) return;
  if (_chDismissed) { wrap.innerHTML = ''; return; }
  var state = _chGetLiveState();
  if (!state) { wrap.innerHTML = ''; return; }
  wrap.innerHTML =
    '<div class="chp-live-card ' + (state.type || '') + '">' +
      state.html +
      '<button class="chp-dismiss-btn" onclick="_chDismissBanner()" title="Dismiss">✕</button>' +
    '</div>';
}

function _chDismissBanner() {
  _chDismissed = true;
  var wrap = document.getElementById('chp-live-banner');
  if (wrap) wrap.innerHTML = '';
}

function _chGetLiveState() {
  var now   = new Date();
  var hour  = now.getHours();
  var today = _chTodayStr();

  // ── 1. Unfilled entry after 11 AM ─────────────────────────────────
  if (hour >= 11 && typeof DAILY !== 'undefined') {
    var hasEntry = DAILY.some(function (d) {
      return d.Date === today && (Number(d['TOTAL'] || d['Total'] || 0) > 0);
    });
    if (!hasEntry) {
      return {
        type: 'warn',
        html: '⚠️ <strong>No entry for today yet</strong> — it\'s past 11 AM.' +
              ' <button class="chp-state-btn" onclick="showPage(\'entry\')">Fill Now →</button>'
      };
    }
  }

  // ── 2. Target pace ─────────────────────────────────────────────────
  if (typeof MONTHLY !== 'undefined' && MONTHLY.length) {
    var my   = _chCurrentMonthYear();
    var tgts = (function () { try { return JSON.parse(Repository.getItem('bt_targets') || '{}'); } catch (e) { return {}; } })();
    var tgt  = Number(tgts[my] || 0);
    if (tgt > 0) {
      var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      var daysElapsed = now.getDate();
      var daysLeft    = daysInMonth - daysElapsed;
      var monthRec    = MONTHLY.find(function (m) { return m.Month_Year === my; });
      var soFar       = Number((monthRec && monthRec.TOTAL) || 0);
      var remaining   = tgt - soFar;

      if (remaining <= 0) {
        return {
          type: 'success',
          html: '🏆 <strong>Target achieved!</strong> ₨' + _chFmt(soFar) + ' / ₨' + _chFmt(tgt)
        };
      } else if (daysLeft > 0) {
        var perDay = Math.ceil(remaining / daysLeft);
        return {
          type: '',
          html: '🎯 Need <strong>₨' + _chFmt(perDay) + '/day</strong> for ' + daysLeft + ' days to hit ₨' + _chFmt(tgt) + ' target. So far: ₨' + _chFmt(soFar) +
                ' <button class="chp-state-btn" onclick="chpAsk(\'am I on pace?\')">Details →</button>'
        };
      }
    }
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════════════
   QUICK ACTION CHIPS
══════════════════════════════════════════════════════════════════════ */
function _chRenderChips() {
  var wrap = document.getElementById('chp-chips-wrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<button class="chp-chip chp-quick-trigger" onclick="chpOpenQuick()">⚡ Quick Shortcuts</button>';
}

/* ══════════════════════════════════════════════════════════════════════
   QUICK SHORTCUTS POPUP  (5 grouped categories)
══════════════════════════════════════════════════════════════════════ */
function chpOpenQuick() {
  var modal = document.getElementById('chp-quick-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chp-quick-modal';
    document.body.appendChild(modal);
  }
  modal.style.display = 'block';
  modal.innerHTML =
    '<div class="chp-quick-overlay" onclick="if(event.target===this)chpCloseQuick()">' +
      '<div class="chp-quick-sheet">' +
        '<div class="chp-quick-head">' +
          '<div style="font-size:15px;font-weight:700;color:var(--text,#0f172a)">⚡ Quick Shortcuts</div>' +
          '<button onclick="chpCloseQuick()" style="background:none;border:none;font-size:20px;color:var(--muted,#64748b);cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div class="chp-quick-body">' +
          _chQuickGroups.map(function (g) {
            return '<div class="chp-quick-group">' +
              '<div class="chp-quick-group-title">' + g.icon + ' ' + _chEsc(g.label) + '</div>' +
              '<div class="chp-quick-group-grid">' +
                g.items.map(function (a) { return _chQuickActionBtn(a); }).join('') +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
}

function chpCloseQuick() {
  var modal = document.getElementById('chp-quick-modal');
  if (modal) modal.style.display = 'none';
}

function _chQuickActionBtn(a) {
  var onclick;
  if (a.fn) {
    onclick = a.fn + ';chpCloseQuick()';
  } else if (a.cmd) {
    onclick = 'chpCloseQuick();chpAsk(' + JSON.stringify(a.cmd) + ')';
  } else {
    onclick = 'chpCloseQuick();showPage(\'' + a.nav + '\')';
    if (a.tab) onclick += ';setTimeout(function(){switchMgrTab(\'' + a.tab + '\')},250)';
  }
  return '<button class="chp-quick-item" onclick="' + onclick + '">' + a.label + '</button>';
}

/* ══════════════════════════════════════════════════════════════════════
   THREAD RENDER
══════════════════════════════════════════════════════════════════════ */
function _chRenderThread() {
  var box = document.getElementById('chp-thread');
  if (!box) return;
  if (!_chHistory.length) {
    box.dataset.placeholder = 'Ask anything about your sales, staff, or finances…';
    box.innerHTML = '';
    return;
  }
  box.dataset.placeholder = '';
  box.innerHTML = _chHistory.map(function (m) {
    return '<div class="chp-msg ' + m.role + '">' +
      '<div class="chp-bubble">' + m.text + '</div>' +
    '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

/* ══════════════════════════════════════════════════════════════════════
   SEND
══════════════════════════════════════════════════════════════════════ */
async function chpSend() {
  var inp  = document.getElementById('chp-input');
  var text = inp ? inp.value.trim() : '';
  if (!text) return;

  if (inp) { inp.value = ''; inp.disabled = true; }
  var sendBtn = document.getElementById('chp-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // Save to recent
  _chSaveRecent(text);
  _chRenderChips();

  // Add user bubble
  _chHistory.push({ role: 'user', text: _chEsc(text) });
  _chRenderThread();

  // Typing indicator
  var thinkId = '_chp_' + Date.now();
  _chHistory.push({
    role: 'bot',
    text: '<div class="chp-typing"><span></span><span></span><span></span></div>',
    _id: thinkId
  });
  _chRenderThread();

  try {
    // ── Phase 5: Local command shortcuts (bypass aiBridgeAnswer) ──
    var lower = text.toLowerCase().trim();
    var localResult = null;

    if (/export.*summary|print.*summary|manager.*summary|summary.*export/.test(lower)) {
      if (typeof exportManagerSummary === 'function') exportManagerSummary();
      localResult = '📄 <strong>Manager Summary</strong> opened for print/share. If no window appeared, please allow pop-ups in your browser settings.';
    }

    // Phase 7: "save this/that as a note" → drop the last bot reply into Notes & Sheets
    if (/^(save (this|that)( reply| response| answer)? as a note|note this|remember this as a note)\b/.test(lower)) {
      if (typeof _nsQuickSaveNote === 'function') {
        var lastBot = '';
        for (var bi = _chHistory.length - 1; bi >= 0; bi--) {
          if (_chHistory[bi].role === 'bot' && !_chHistory[bi]._id) { lastBot = _chHistory[bi].text; break; }
        }
        var plainBody = lastBot.replace(/<[^>]*>/g, '').trim();
        if (!plainBody) {
          localResult = '⚠️ Nothing to save yet — ask something first, then say "save this as a note".';
        } else {
          var savedNote = _nsQuickSaveNote('CommandHub — ' + new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short' }), plainBody, 'commandhub');
          localResult = '📝 Saved to <strong>Notes &amp; Sheets</strong> as "<em>' + _chEsc(savedNote.title) + '</em>".';
        }
      } else {
        localResult = '⚠️ Notes module not loaded.';
      }
    }

    if (localResult !== null) {
      var idxLoc = _chHistory.findIndex(function(m){ return m._id === thinkId; });
      if (idxLoc !== -1) _chHistory.splice(idxLoc, 1);
      _chHistory.push({ role: 'bot', text: localResult });
      if (inp) inp.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      _chRenderThread();
      if (inp) inp.focus();
      return;
    }

    var result = await aiBridgeAnswer(text);

    // Remove typing indicator
    var idx = _chHistory.findIndex(function (m) { return m._id === thinkId; });
    if (idx !== -1) _chHistory.splice(idx, 1);

    var displayText = result.text || '(no response)';

    // Detect if local (no API call) vs Groq — heuristic: Groq results tend to be longer
    // We can't know for sure, so just badge every response silently

    // Intent confirm/execute row
    if (result.intent) {
      var isDestruct = !!result.requiresConfirm || (typeof AI_DESTRUCTIVE_INTENTS !== 'undefined' && AI_DESTRUCTIVE_INTENTS.has(result.intent.action));
      var label = _chIntentLabel(result.intent);
      var btnClass = isDestruct ? 'destructive' : 'safe';
      var btnIcon  = isDestruct ? '⚠️' : '✅';
      var iJson = _chEscAttr(JSON.stringify(result.intent));
      displayText +=
        '<div class="chp-intent-row">' +
          '<button class="chp-exec-btn ' + btnClass + '" onclick="aiBridgeExecuteIntent(JSON.parse(this.dataset.i));this.closest(\'.chp-intent-row\').remove()" data-i="' + iJson + '">' +
            btnIcon + ' ' + _chEsc(label) +
          '</button>' +
          '<button class="chp-cancel-btn" onclick="this.closest(\'.chp-intent-row\').remove()">Cancel</button>' +
        '</div>';
    }

    _chHistory.push({ role: 'bot', text: displayText });
  } catch (err) {
    var idx2 = _chHistory.findIndex(function (m) { return m._id === thinkId; });
    if (idx2 !== -1) _chHistory.splice(idx2, 1);
    _chHistory.push({ role: 'bot', text: '⚠️ Error: ' + _chEsc(err.message) });
  }

  if (inp) inp.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  _chRenderThread();
  if (inp) inp.focus();
}

/* Programmatic send (from chips, banner, etc.) */
function chpAsk(text) {
  var inp = document.getElementById('chp-input');
  if (inp) inp.value = text;
  chpSend();
}

/* ══════════════════════════════════════════════════════════════════════
   VOICE — MIC
══════════════════════════════════════════════════════════════════════ */
function chpToggleMic() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('⚠ Speech recognition not supported in this browser', 'w'); return; }

  if (_chMicActive) {
    // Stop
    _chMicActive = false;
    if (_chMicRec) { try { _chMicRec.stop(); } catch (e) {} _chMicRec = null; }
    _chSetMicUI(false);
    return;
  }

  _chMicActive = true;
  _chSetMicUI(true);
  toast('🎤 Listening…');

  var rec = new SR();
  _chMicRec = rec;
  rec.lang = 'en-PK';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = function (e) {
    var transcript = e.results[0][0].transcript;
    var inp = document.getElementById('chp-input');
    if (inp) inp.value = transcript;
    _chMicActive = false;
    _chMicRec = null;
    _chSetMicUI(false);
    chpSend();
  };
  rec.onerror = function (e) {
    _chMicActive = false; _chMicRec = null;
    _chSetMicUI(false);
    toast('⚠ Mic error: ' + (e.error || 'unknown'), 'w');
  };
  rec.onend = function () {
    if (_chMicActive) { _chMicActive = false; _chMicRec = null; _chSetMicUI(false); }
  };
  rec.start();
}

function _chSetMicUI(active) {
  var btn = document.getElementById('chp-mic');
  if (!btn) return;
  btn.textContent = active ? '🛑' : '🎤';
  btn.title = active ? 'Stop listening' : 'Voice input';
  if (active) btn.classList.add('active'); else btn.classList.remove('active');
}

/* ══════════════════════════════════════════════════════════════════════
   IMAGE SCAN
   chpOpenScan() itself now lives in ai-helpers.js (the richer
   camera/gallery/file attach-sheet). This file still owns the actual
   file-handling once a scan comes in.
══════════════════════════════════════════════════════════════════════ */async function chpHandleScanFile(file) {
  if (!file) return;
  // Reset input so same file can be selected again
  var fi = document.getElementById('chp-scan-file');
  if (fi) fi.value = '';

  // Phase 6: delegate to ai-helpers.js full scan pipeline
  // (sale-report detection, structured import, generic entry scan)
  if (typeof aihScanFile === 'function') {
    aihScanFile(file);
    return;
  }

  // Fallback: plain text extraction (if ai-helpers not loaded)
  var reader = new FileReader();
  reader.onload = async function (e) {
    var dataUrl = e.target.result;
    _chHistory.push({ role: 'user', text: '📷 <em>Image scan submitted</em>' });
    var thinkId = '_chp_scan_' + Date.now();
    _chHistory.push({ role: 'bot', text: '<div class="chp-typing"><span></span><span></span><span></span></div>', _id: thinkId });
    _chRenderThread();
    try {
      if (typeof _callGroqVision !== 'function') throw new Error('Vision not available — set a Groq API key first.');
      var text = await _callGroqVision(dataUrl, 'Extract all readable text, numbers, and amounts from this image.');
      var idx = _chHistory.findIndex(function (m) { return m._id === thinkId; });
      if (idx !== -1) _chHistory.splice(idx, 1);
      _chHistory.push({ role: 'bot', text: '📷 <strong>Scan result:</strong><br>' + _chEsc(text) });
    } catch (err) {
      var idx2 = _chHistory.findIndex(function (m) { return m._id === thinkId; });
      if (idx2 !== -1) _chHistory.splice(idx2, 1);
      _chHistory.push({ role: 'bot', text: '⚠️ Scan failed: ' + _chEsc(err.message) });
    }
    _chRenderThread();
  };
  reader.readAsDataURL(file);
}

/* ══════════════════════════════════════════════════════════════════════
   CLEAR
══════════════════════════════════════════════════════════════════════ */
function chpClear() {
  _chHistory = [];
  _chInited  = false;
  loadCommandHubPage();
}

/* ══════════════════════════════════════════════════════════════════════
   RECENT COMMANDS
══════════════════════════════════════════════════════════════════════ */
function _chpLoadRecent() {
  try {
    // Merge chat recents (strings) with palette recents (objects) so the chips panel
    // shows commands from BOTH surfaces — fixes the split-history problem.
    var chatRaw    = JSON.parse(Repository.getItem(CHP_RECENT_KEY) || '[]');
    var paletteRaw = JSON.parse(Repository.getItem('bt_cmdhub_recent') || '[]');
    // Chat stores plain strings; palette stores {id, title, ...} objects.
    var chatStrings    = chatRaw.filter(function(r){ return typeof r === 'string'; });
    var paletteTitles  = paletteRaw.map(function(r){
      return (typeof r === 'string') ? r : (r.title || '');
    }).filter(Boolean);
    // Deduplicate: chat strings first (most recent typed commands), then palette
    var seen = new Set();
    var merged = [];
    chatStrings.concat(paletteTitles).forEach(function(s) {
      if (!seen.has(s)) { seen.add(s); merged.push(s); }
    });
    return merged;
  } catch (e) { return []; }
}

function _chSaveRecent(cmd) {
  _chRecent = _chRecent.filter(function (c) { return c !== cmd; });
  _chRecent.unshift(cmd);
  if (_chRecent.length > CHP_RECENT_MAX) _chRecent = _chRecent.slice(0, CHP_RECENT_MAX);
  try { Actions.saveFeatureData(CHP_RECENT_KEY, JSON.stringify(_chRecent)); } catch (e) {}
}

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════ */
function _chEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _chEscAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}
function _chFmt(n) {
  return Number(n || 0).toLocaleString('en-PK');
}
function _chTodayStr() {
  // Use BTDate.today() → "29/Jun/2026" — matches DAILY[].Date format exactly.
  // Fallback in case BTDate isn't loaded yet (should never happen in normal flow).
  if (typeof BTDate !== 'undefined' && BTDate.today) return BTDate.today();
  var d = new Date();
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2,'0') + '/' + M[d.getMonth()] + '/' + d.getFullYear();
}
function _chCurrentMonthYear() {
  // Use BTDate.currentMonthYear() → "June 2026" — matches MONTHLY[].Month_Year exactly.
  if (typeof BTDate !== 'undefined' && BTDate.currentMonthYear) return BTDate.currentMonthYear();
  var d = new Date();
  var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}

function _chIntentLabel(intent) {
  var labels = {
    showPage:'Open page', switchMgrTab:'Switch tab', openStaffCard:'Open staff card',
    openFieldManager:'Open field manager', switchMonth:'Switch month',
    openDayModal:'Open day report', openMonthModal:'Open month report',
    printMonthReport:'Print month', printYearlyReport:'Print year',
    printMgrReport:'Print report', printDayReport:'Print day',
    printIncentiveReport:'Print incentive', setDailyField:'Fill field',
    saveNewDailyEntry:'Save daily entry', editDailyEntry:'Edit entry',
    deleteDailyEntry:'DELETE entry', clearEntryForm:'Clear form',
    addStaff:'Add staff', editStaffField:'Edit staff field',
    deactivateStaff:'DEACTIVATE staff', reactivateStaff:'Reactivate staff',
    deleteStaff:'DELETE staff', addSalaryRow:'Add salary row',
    editSalaryRow:'Edit salary row', setSalaryField:'Set salary field',
    deleteSalaryRow:'DELETE salary row', autoFillSalary:'Auto-fill salary',
    addGenericRow:'Add generic row', editGenericRow:'Edit generic row',
    setGenericSale:'Set generic sale', deleteGenericRow:'DELETE generic row',
    addExpense:'Add expense', editExpenseRow:'Edit expense row',
    deleteExpenseRow:'DELETE expense row', addCredit:'Add credit',
    addCreditEmployee:'Add to credit ledger', editCreditEntry:'Edit credit entry',
    deleteCreditEntry:'DELETE credit entry', deleteCreditEmployee:'DELETE credit employee',
    setCreditEmpField:'Set credit field', copyToNextMonth:'COPY to next month',
    addPettyItem:'Add petty item', addPettyGroup:'Add petty group',
    editPettyRow:'Edit petty row', deletePettyRow:'DELETE petty row',
    deletePettyGroup:'DELETE petty group', recalcIncentive:'Recalc incentives',
    setMonthTarget:'Set target', deleteMonthTarget:'DELETE target',
    addCustomSectionRow:'Add to section', createCustomSection:'Create section',
    deleteCustomSectionRow:'DELETE section row', deleteCustomSection:'DELETE section',
    toggleFieldVisibility:'Toggle field', addCustomField:'Add custom field',
    resetAllFields:'RESET all fields', pushToSupabase:'Sync to cloud',
    pullFromSupabase:'Load from cloud', backupToDrive:'Backup to Drive',
    addMemoryFact:'Add memory', deleteMemoryFact:'DELETE memory',
    addRule:'Add rule', deleteRule:'DELETE rule',
    setSectionAiConfig:'Configure AI section',
    addJazzCashEntry:'Add Jazz Cash entry', deleteJazzCashEntry:'DELETE Jazz Cash entry',
    editJazzCashEntry:'Edit Jazz Cash entry',
  };
  return labels[intent.action] || intent.action;
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 4 — SETTINGS PANEL (Groq API key + status indicator)
══════════════════════════════════════════════════════════════════════ */

/**
 * Update the ⚙ AI button in the toolbar to reflect key status.
 * Green dot = key set, grey = not set.
 */
function _chUpdateSettingsIndicator() {
  var btn = document.getElementById('chp-settings-btn');
  if (!btn) return;
  var hasKey = (typeof aiHasKey === 'function') ? aiHasKey() : false;
  btn.innerHTML = hasKey
    ? '⚙ AI <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-left:2px"></span>'
    : '⚙ AI <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#cbd5e1;margin-left:2px"></span>';
  btn.title = hasKey ? 'Groq AI key set ✓ — click to update' : 'No Groq API key — click to add';
}

/**
 * Open the settings modal inside the CommandHub page.
 */
function chpOpenSettings() {
  var modal = document.getElementById('chp-settings-modal');
  if (!modal) return;

  var cur = (typeof getAiSettings === 'function') ? getAiSettings().apiKey : '';
  var masked = cur ? (cur.slice(0, 8) + '…' + cur.slice(-4)) : '';

  modal.style.display = 'block';
  modal.innerHTML = [
    '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:flex-end;justify-content:center"',
    '  onclick="if(event.target===this)chpCloseSettings()">',
    '  <div style="width:100%;max-width:500px;background:var(--s1,#fff);border-radius:18px 18px 0 0;',
    '    padding:20px 20px 32px;box-shadow:0 -4px 32px rgba(0,0,0,.18);position:relative">',

    '    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">',
    '      <div style="font-size:15px;font-weight:700;color:var(--text)">⚙ AI Settings</div>',
    '      <button onclick="chpCloseSettings()" style="background:none;border:none;font-size:20px;',
    '        color:var(--muted);cursor:pointer;line-height:1">✕</button>',
    '    </div>',

    // Status badge
    cur
      ? '<div style="display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #86efac;border-radius:9px;padding:8px 12px;margin-bottom:14px">'
        + '<span style="font-size:18px">✅</span>'
        + '<div><div style="font-size:12px;font-weight:700;color:#16a34a">Groq API key active</div>'
        + '<div style="font-size:11px;color:#64748b;margin-top:1px">' + masked + '</div></div>'
        + '</div>'
      : '<div style="display:flex;align-items:center;gap:8px;background:#fff7ed;border:1px solid #fed7aa;border-radius:9px;padding:8px 12px;margin-bottom:14px">'
        + '<span style="font-size:18px">⚠️</span>'
        + '<div><div style="font-size:12px;font-weight:700;color:#92400e">No API key set</div>'
        + '<div style="font-size:11px;color:#78350f;margin-top:1px">Local parsers work without a key. Add one for full AI responses.</div></div>'
        + '</div>',

    // Input
    '    <label style="display:block;font-size:12px;font-weight:600;color:var(--muted);',
    '      letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px">',
    '      Groq API Key</label>',
    '    <input id="chp-key-input" type="password"',
    '      placeholder="gsk_…"',
    '      value="' + (cur || '') + '"',
    '      style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:9px;',
    '        border:1.5px solid var(--border,#e2e8f0);font-size:14px;',
    '        font-family:var(--mono,monospace);outline:none;background:var(--s2,#f8fafc);color:var(--text)">',

    '    <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5">',
    '      Free key at <a href="https://console.groq.com" target="_blank" ',
    '        style="color:var(--accent)">console.groq.com</a> — stored locally, never sent anywhere except Groq.',
    '    </div>',

    // Buttons
    '    <div style="display:flex;gap:8px;margin-top:16px">',
    '      <button onclick="chpSaveSettings()" style="flex:1;padding:10px;border-radius:9px;',
    '        border:none;background:var(--accent,#2563eb);color:#fff;',
    '        font-size:13px;font-weight:700;cursor:pointer">Save Key</button>',
    cur
      ? '<button onclick="chpClearSettings()" style="padding:10px 16px;border-radius:9px;'
        + 'border:1.5px solid #fca5a5;background:#fff;color:#dc2626;'
        + 'font-size:13px;cursor:pointer">Remove</button>'
      : '',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  // Auto-show key (toggle visibility button)
  var inp = document.getElementById('chp-key-input');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') chpSaveSettings();
      if (e.key === 'Escape') chpCloseSettings();
    });
    setTimeout(function() { inp.focus(); inp.select(); }, 80);
  }
}

function chpCloseSettings() {
  var modal = document.getElementById('chp-settings-modal');
  if (modal) modal.style.display = 'none';
}

function chpSaveSettings() {
  var inp = document.getElementById('chp-key-input');
  var val = inp ? inp.value.trim() : '';
  if (typeof saveAiSettings === 'function') saveAiSettings(val);
  chpCloseSettings();
  _chUpdateSettingsIndicator();
  // Confirm in thread
  _chHistory.push({
    role: 'bot',
    text: val
      ? '✅ <strong>Groq API key saved.</strong> Full AI responses are now active for questions I can\'t answer locally.'
      : '⚠️ API key removed. Local parsers still work for all direct commands.'
  });
  _chRenderThread();
}

function chpClearSettings() {
  if (typeof clearAiSettings === 'function') clearAiSettings();
  chpCloseSettings();
  _chUpdateSettingsIndicator();
  _chHistory.push({ role: 'bot', text: '🗑 API key removed.' });
  _chRenderThread();
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 4 — GREETING UPDATE (show key status on first open)
══════════════════════════════════════════════════════════════════════ */

// Patch loadCommandHubPage to also update settings indicator (greeting bubble removed per design update)
var _chLoadOrig = loadCommandHubPage;
loadCommandHubPage = function() {
  _chLoadOrig();
  _chUpdateSettingsIndicator();
};

// Bridge what's used externally, from index.html, or via a same-file
// onclick attribute.
window.loadCommandHubPage = loadCommandHubPage;
window._chRenderThread = _chRenderThread;
window.chpSend = chpSend;
window.chpAsk = chpAsk;
window.chpToggleMic = chpToggleMic;
window.chpClear = chpClear;
window.chpOpenSettings = chpOpenSettings;
window._chDismissBanner = _chDismissBanner;
window.chpOpenQuick = chpOpenQuick;
window.chpCloseQuick = chpCloseQuick;
window.chpCloseSettings = chpCloseSettings;
window.chpSaveSettings = chpSaveSettings;
window.chpClearSettings = chpClearSettings;

})();
