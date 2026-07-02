// ══════════════════════════════════════════════════════════════════════
// AI Context UI — Panel renderer & context strip
// BT Sales App  v1.0
// Depends on: ai-context.js (AIContext)
// ══════════════════════════════════════════════════════════════════════

// ── Open / Close ──────────────────────────────────────────────────────
function actxOpen() {
  var overlay = document.getElementById('actx-overlay');
  if (!overlay) { _actxCreateOverlay(); overlay = document.getElementById('actx-overlay'); }
  renderAiContextPanel();
  requestAnimationFrame(function() {
    if (overlay) overlay.classList.add('open');
  });
}

function actxClose() {
  var ov = document.getElementById('actx-overlay');
  if (ov) ov.classList.remove('open');
}

function _actxCreateOverlay() {
  var div = document.createElement('div');
  div.id = 'actx-overlay';
  div.className = 'actx-overlay';
  div.innerHTML = '<div class="actx-panel" id="actx-panel"></div>';
  div.addEventListener('click', function(e) { if (e.target === div) actxClose(); });
  document.body.appendChild(div);
}

// ══════════════════════════════════════════════════════════════════════
// MAIN PANEL RENDER
// ══════════════════════════════════════════════════════════════════════
function renderAiContextPanel() {
  var panel = document.getElementById('actx-panel');
  if (!panel) return;

  var s    = AIContext.getSummary();
  var conf = s.confidence;

  var confColor = conf >= 70 ? '#10b981' : conf >= 40 ? '#f59e0b' : '#ef4444';

  panel.innerHTML =
    _actxHeader(s, conf) +
    _actxConfBand(conf, confColor) +
    _actxPinGroups(s) +
    _actxContent(s, conf) +
    _actxFooter(s);

  // Also refresh the strip
  actxRenderStrip();
}

// ── Pin Context Groups (5 main groups) ──────────────────────────────────
var ACTX_GROUPS = [
  { id: 'sale',     icon: '💰', label: 'Sale' },
  { id: 'staff',    icon: '👔', label: 'Staff' },
  { id: 'expense',  icon: '📋', label: 'Expenses' },
  { id: 'jazzcash', icon: '🏦', label: 'Jazz Cash' },
  { id: 'notes',    icon: '📝', label: 'Notes & Sheets' },
];

function _actxPinGroups(s) {
  var pinnedId = (s.section && s.section.via === 'pinned') ? s.section.id : null;
  return '<div class="actx-pin-groups">' +
    '<div class="actx-pin-title">📌 Pin a context group — all chat will relate to it</div>' +
    '<div class="actx-pin-grid">' +
      ACTX_GROUPS.map(function (g) {
        var active = g.id === pinnedId;
        return '<button class="actx-pin-chip' + (active ? ' active' : '') + '" ' +
          'onclick="actxTogglePin(\'' + g.id + '\',' + JSON.stringify(g.label) + ')">' +
          g.icon + ' ' + _actxEsc(g.label) + (active ? ' ✓' : '') +
        '</button>';
      }).join('') +
    '</div>' +
  '</div>';
}

function actxTogglePin(id, label) {
  var s = AIContext.getSummary();
  var alreadyPinned = s.section && s.section.via === 'pinned' && s.section.id === id;
  if (alreadyPinned) {
    AIContext.clear('section');
    if (typeof toast === 'function') toast('📌 Unpinned ' + label + ' context.');
  } else {
    AIContext.pinGroup(id, label);
    if (typeof toast === 'function') toast('📌 Pinned context: ' + label + '.');
  }
  renderAiContextPanel();
}

// ── Header ────────────────────────────────────────────────────────────
function _actxHeader(s, conf) {
  var statusLabel = s.isEmpty ? 'No active context' :
    conf >= 70 ? 'Active & fresh' :
    conf >= 30 ? 'Active (aging)' : 'Stale — will expire soon';

  return '<div class="actx-header">' +
    '<div>' +
      '<div class="actx-title">' +
        '<span style="font-size:26px">🗺</span>' +
        '<div>' +
          '<div>Working Context</div>' +
          '<div class="actx-title-sub">' + statusLabel + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<button class="actx-hclose" onclick="actxClose()">✕</button>' +
  '</div>';
}

// ── Confidence band ───────────────────────────────────────────────────
function _actxConfBand(conf, confColor) {
  return '<div class="actx-conf-band">' +
    '<span class="actx-conf-label">Confidence</span>' +
    '<div class="actx-conf-track">' +
      '<div class="actx-conf-inner" style="width:' + conf + '%;background:' + confColor + '"></div>' +
    '</div>' +
    '<span class="actx-conf-pct">' + conf + '%</span>' +
  '</div>';
}

// ── Content ───────────────────────────────────────────────────────────
function _actxContent(s, conf) {
  var html = '<div class="actx-content">';

  if (s.isEmpty) {
    html += '<div class="actx-empty">' +
      '<div class="actx-empty-icon">🗺</div>' +
      '<div class="actx-empty-title">No Context Yet</div>' +
      '<div class="actx-empty-sub">' +
        'Context is set automatically as you work.<br>' +
        'Open a staff member, switch a section, or perform an action —<br>' +
        'then follow-up commands like <b>"2500"</b> or <b>"balance"</b> will resolve instantly.' +
      '</div>' +
    '</div>';
  } else {
    // Slot cards
    if (s.employee) {
      html += _actxSlot({
        slot: 'employee', icon: '👤', iconBg: '#f0fdf4', iconBorder: '#86efac',
        label: 'Current Employee',
        value: s.employee.name,
        age: AIContext.getAgeLabel(s.employee.setAt),
        via: s.employee.via,
        conf: conf,
      });
    }
    if (s.section) {
      html += _actxSlot({
        slot: 'section', icon: '📁', iconBg: '#fffbeb', iconBorder: '#fde68a',
        label: 'Current Section',
        value: s.section.label,
        age: AIContext.getAgeLabel(s.section.setAt),
        via: s.section.via,
        conf: conf,
      });
    }
    if (s.page) {
      html += _actxSlot({
        slot: 'page', icon: '📄', iconBg: '#faf5ff', iconBorder: '#e9d5ff',
        label: 'Current Page',
        value: s.page.label,
        age: AIContext.getAgeLabel(s.page.setAt),
        via: null,
        conf: conf,
      });
    }
    if (s.month) {
      html += _actxSlot({
        slot: 'month', icon: '📅', iconBg: '#ecfeff', iconBorder: '#a5f3fc',
        label: 'Working Month',
        value: s.month.value,
        age: AIContext.getAgeLabel(s.month.setAt),
        via: null,
        conf: conf,
      });
    }
    if (s.lastAction) {
      html += _actxSlot({
        slot: 'lastAction', icon: '✅', iconBg: '#eff6ff', iconBorder: '#bfdbfe',
        label: 'Last Action',
        value: s.lastAction.text,
        age: AIContext.getAgeLabel(s.lastAction.setAt),
        via: s.lastAction.intentAction,
        conf: conf,
      });
    }

    // Follow-up examples (only when employee context active)
    if (s.employee && conf >= 30) {
      html += _actxFollowUpExamples(s);
    }
  }

  html += '</div>';
  return html;
}

// ── Slot card ─────────────────────────────────────────────────────────
function _actxSlot(opts) {
  var isFaded = opts.conf < 30;
  return '<div class="actx-slot' + (isFaded ? ' faded' : '') + '">' +
    '<div class="actx-slot-icon" style="background:' + opts.iconBg + ';border:1.5px solid ' + opts.iconBorder + '">' + opts.icon + '</div>' +
    '<div class="actx-slot-body">' +
      '<div class="actx-slot-label">' + opts.label + '</div>' +
      '<div class="actx-slot-value">' + _actxEsc(opts.value) + '</div>' +
      '<div class="actx-slot-meta">' +
        '🕐 ' + opts.age +
        (opts.via ? '<span class="actx-slot-via">' + _actxEsc(opts.via) + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<button class="actx-slot-clear" onclick="actxClearSlot(\'' + opts.slot + '\')" title="Clear this slot">✕</button>' +
  '</div>';
}

// ── Follow-up examples ────────────────────────────────────────────────
function _actxFollowUpExamples(s) {
  var emp = s.employee ? s.employee.name : '?';
  var examples = [
    '"2500"',
    '"another 500"',
    '"balance"',
    '"deduct 1000"',
    '"same again"',
    '"uska balance"',
  ];

  // Add section-specific examples
  if (s.section) {
    if (/credit/i.test(s.section.id)) {
      examples = ['"2500"', '"another 500"', '"balance"', '"deduct 1000"', '"3500 credit"', '"kitna hai"'];
    } else if (/expense/i.test(s.section.id)) {
      examples = ['"1200"', '"8000 fuel"', '"same again"', '"delete last"'];
    }
  }

  return '<div class="actx-followups">' +
    '<div class="actx-followups-title">⚡ Follow-up commands for <b>' + _actxEsc(emp) + '</b></div>' +
    '<div class="actx-followups-grid">' +
    examples.map(function(ex) {
      var clean = ex.replace(/"/g, '');
      return '<button class="actx-fu-chip" onclick="actxSendFollowUp(\'' + clean.replace(/'/g, "\\'") + '\')">' + ex + '</button>';
    }).join('') +
    '</div>' +
  '</div>';
}

// ── Footer ────────────────────────────────────────────────────────────
function _actxFooter(s) {
  var expiryLabel = '';
  if (!s.isEmpty && s.confidence > 0) {
    var conf = s.confidence;
    if (conf < 30) expiryLabel = 'Expires soon';
    else if (conf < 60) expiryLabel = 'Good for ~10 min';
    else expiryLabel = 'Fresh context';
  }

  return '<div class="actx-footer">' +
    '<button class="actx-footer-btn danger" onclick="actxClearAll()">🗑 Clear All</button>' +
    '<button class="actx-footer-btn ghost" onclick="actxClose()">Close</button>' +
    (expiryLabel ? '<span class="actx-expiry">⏳ ' + expiryLabel + '</span>' : '') +
  '</div>';
}

// ══════════════════════════════════════════════════════════════════════
// CONTEXT STRIP (below chat header, above messages)
// ══════════════════════════════════════════════════════════════════════
function actxRenderStrip() {
  var strip = document.getElementById('actx-strip');
  if (!strip) return;

  var s    = AIContext.getSummary();
  var conf = s.confidence;

  if (s.isEmpty || conf === 0) {
    strip.className = 'actx-strip';
    strip.innerHTML = '<span class="actx-strip-empty" onclick="actxOpen()" title="Tap to set active context">🗺 No context — tap to set who/what you\'re talking about</span>';
    return;
  }

  strip.className = 'actx-strip has-context';

  var chips = '';
  if (s.employee) {
    chips += '<span class="actx-chip employee" onclick="actxOpen()" title="Current employee">👤 ' + _actxEsc(s.employee.name) + '</span>';
  }
  if (s.section) {
    var pinIcon = s.section.via === 'pinned' ? '📌' : '📁';
    chips += '<span class="actx-chip section" onclick="actxOpen()" title="Current section">' + pinIcon + ' ' + _actxEsc(s.section.label) + '</span>';
  }
  if (s.page) {
    chips += '<span class="actx-chip page" onclick="actxOpen()" title="Current page">📄 ' + _actxEsc(s.page.label) + '</span>';
  }
  if (s.month) {
    chips += '<span class="actx-chip month" onclick="actxOpen()" title="Working month">📅 ' + _actxEsc(s.month.value) + '</span>';
  }

  var confColor = conf >= 70 ? '#10b981' : conf >= 40 ? '#f59e0b' : '#ef4444';
  var confBar = '<div class="actx-conf-bar" title="Context confidence: ' + conf + '%"><div class="actx-conf-fill" style="width:' + conf + '%;background:' + confColor + '"></div></div>';
  var clearBtn = '<button class="actx-clear-btn" onclick="actxClearAll()" title="Clear context">✕</button>';

  strip.innerHTML = chips + confBar + clearBtn;
}

// Refresh strip every 60 seconds to update confidence decay
(function _actxStripTimer() {
  setInterval(function() {
    var strip = document.getElementById('actx-strip');
    if (strip) actxRenderStrip();
  }, 60000);
}());

// ══════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ══════════════════════════════════════════════════════════════════════
function actxClearSlot(slot) {
  AIContext.clear(slot);
  renderAiContextPanel();
  actxRenderStrip();
  if (typeof toast === 'function') toast('Context cleared: ' + slot + '.');
}

function actxClearAll() {
  AIContext.clear();
  actxClose();
  actxRenderStrip();
  if (typeof toast === 'function') toast('🗑️ Context cleared.');
}

function actxSendFollowUp(text) {
  actxClose();
  var inp = document.getElementById('aip-input');
  if (inp) {
    inp.value = text;
    if (typeof aiPageSend === 'function') setTimeout(aiPageSend, 80);
  }
}

// ── Helper ────────────────────────────────────────────────────────────
function _actxEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ══════════════════════════════════════════════════════════════════════
// NATIVE NAVIGATION HOOKS
// Wrap existing global functions so context stays in sync even when
// the user clicks a page button instead of using AI commands.
// ══════════════════════════════════════════════════════════════════════
(function _actxHookNav() {
  function _wrapFn(fnName, cb) {
    var orig = window[fnName];
    if (typeof orig !== 'function') return;
    window[fnName] = function() {
      var result = orig.apply(this, arguments);
      try { cb.apply(null, arguments); } catch (_) {}
      return result;
    };
  }

  // showPage(pageId) → update page context
  _wrapFn('showPage', function(pageId) {
    if (typeof AIContext === 'undefined') return;
    AIContext.setPage(pageId);
    actxRenderStrip();
  });

  // switchMgrTab(tabId) → update section context
  _wrapFn('switchMgrTab', function(tabId) {
    if (typeof AIContext === 'undefined') return;
    var labels = {
      credit: 'Credit Ledger', expense: 'Expenses', petty: 'Petty Cash',
      salary: 'Salary', generic: 'Generic Working', incentive: 'Incentive',
      staff: 'Staff', tools: 'Tools',
    };
    AIContext.setSection(tabId, labels[tabId] || tabId, 'tab-click');
    actxRenderStrip();
  });

  // openStaffCard(idx) → update employee context
  _wrapFn('openStaffCard', function(idx) {
    if (typeof AIContext === 'undefined') return;
    try {
      var staffName = '';
      if (typeof STAFF !== 'undefined' && STAFF && STAFF[idx]) staffName = STAFF[idx].name || '';
      if (staffName) { AIContext.setEmployee(staffName, idx, 'card-click'); actxRenderStrip(); }
    } catch (_) {}
  });
}());

// ── Init strip on page load ───────────────────────────────────────────
(function _actxInitStrip() {
  function _tryInit() {
    var strip = document.getElementById('actx-strip');
    if (strip) { actxRenderStrip(); return; }
    setTimeout(_tryInit, 500);
  }
  // Always defer/module now — readyState is never 'loading' here.
  document.addEventListener('DOMContentLoaded', _tryInit);
}());
