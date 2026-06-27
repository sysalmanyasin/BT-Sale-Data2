// ══════════════════════════════════════════════════════════════════════
// AI Instructions UI — Panel renderer & interaction handlers
// BT Sales App  v1.0
// Depends on: ai-instructions.js (AIInstructions)
// ══════════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────
var _ainState = {
  activeTab:  'all',          // category id or "all"
  searchQ:    '',
  showForm:   false,
  formCat:    'business_profile',
  formText:   '',
  editingId:  null,
};

// ── Open / Close ──────────────────────────────────────────────────────
function ainOpen(defaultCat) {
  if (defaultCat) _ainState.activeTab = defaultCat;
  _ainState.showForm  = false;
  _ainState.editingId = null;
  _ainState.searchQ   = '';

  var overlay = document.getElementById('ain-overlay');
  if (!overlay) { _ainCreateOverlay(); overlay = document.getElementById('ain-overlay'); }

  renderAiInstructionsPanel();

  requestAnimationFrame(function () {
    var ov = document.getElementById('ain-overlay');
    if (ov) ov.classList.add('open');
    var searchEl = document.getElementById('ain-search');
    if (searchEl) setTimeout(function(){ searchEl.focus(); }, 250);
  });
}

function ainClose() {
  var ov = document.getElementById('ain-overlay');
  if (!ov) return;
  ov.classList.remove('open');
}

function _ainCreateOverlay() {
  var div = document.createElement('div');
  div.id        = 'ain-overlay';
  div.className = 'ain-overlay';
  div.innerHTML = '<div class="ain-panel" id="ain-panel"></div>';
  div.addEventListener('click', function(e) {
    if (e.target === div) ainClose();
  });
  document.body.appendChild(div);
}

// ══════════════════════════════════════════════════════════════════════
// MAIN RENDER
// ══════════════════════════════════════════════════════════════════════
function renderAiInstructionsPanel() {
  var panel = document.getElementById('ain-panel');
  if (!panel) return;

  var cats  = AIInstructions.getCategories();
  var stats = AIInstructions.getStats();

  // Gather instructions to show
  var all = _ainState.searchQ
    ? AIInstructions.search(_ainState.searchQ)
    : AIInstructions.getAll();

  var filtered = _ainState.activeTab === 'all'
    ? all
    : all.filter(function(i){ return i.category === _ainState.activeTab; });

  panel.innerHTML =
    _ainRenderHeader(stats) +
    _ainRenderStats(stats) +
    _ainRenderToolbar() +
    _ainRenderCatTabs(cats, stats) +
    _ainRenderContent(filtered, cats) +
    _ainRenderFooter();

  // Bind events
  _ainBindEvents();
}

// ── Header ────────────────────────────────────────────────────────────
function _ainRenderHeader(stats) {
  return '<div class="ain-header">' +
    '<div>' +
      '<div class="ain-title"><span style="font-size:24px">🤖</span>' +
        '<div><div>AI Instructions</div><div class="ain-title-sub">' + stats.active + ' active instruction' + (stats.active !== 1 ? 's' : '') + ' · teach the AI your business</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="ain-header-actions">' +
      '<button class="ain-hbtn" onclick="ainExportUI()">⬇ Export</button>' +
      '<button class="ain-hbtn" onclick="ainImportUI()">⬆ Import</button>' +
      '<button class="ain-close-btn" onclick="ainClose()">✕</button>' +
    '</div>' +
  '</div>';
}

// ── Stats strip ───────────────────────────────────────────────────────
function _ainRenderStats(stats) {
  return '<div class="ain-stats">' +
    '<div class="ain-stat"><b>' + stats.total + '</b> total</div>' +
    '<div class="ain-stat"><b>' + stats.active + '</b> active</div>' +
    '<div class="ain-stat"><b>' + (stats.total - stats.active) + '</b> paused</div>' +
    '</div>';
}

// ── Toolbar ───────────────────────────────────────────────────────────
function _ainRenderToolbar() {
  return '<div class="ain-toolbar">' +
    '<div class="ain-search-wrap">' +
      '<input class="ain-search" id="ain-search" type="text" ' +
        'placeholder="Search instructions…" ' +
        'value="' + _ainEsc(_ainState.searchQ) + '" ' +
        'oninput="ainOnSearch(this.value)">' +
    '</div>' +
    '<button class="ain-add-btn" onclick="ainShowAddForm()">＋ Add</button>' +
  '</div>';
}

// ── Category tabs ─────────────────────────────────────────────────────
function _ainRenderCatTabs(cats, stats) {
  var allCount = AIInstructions.getAll().length;
  var html = '<div class="ain-cat-tabs">';

  html += '<button class="ain-cat-tab' + (_ainState.activeTab === 'all' ? ' active' : '') + '" ' +
    'onclick="ainSwitchTab(\'all\')">' +
    '🗂 All <span class="ain-cat-cnt">' + allCount + '</span></button>';

  cats.forEach(function(c) {
    var cnt = stats.byCategory[c.id] || 0;
    html += '<button class="ain-cat-tab' + (_ainState.activeTab === c.id ? ' active' : '') + '" ' +
      'onclick="ainSwitchTab(\'' + c.id + '\')">' +
      c.emoji + ' ' + c.label + ' <span class="ain-cat-cnt">' + cnt + '</span></button>';
  });

  html += '</div>';
  return html;
}

// ── Content ───────────────────────────────────────────────────────────
function _ainRenderContent(filtered, cats) {
  var html = '<div class="ain-content" id="ain-content">';

  // Add form (shown at top when active)
  if (_ainState.showForm && !_ainState.editingId) {
    html += _ainRenderAddForm(cats);
  }

  // Category header with hint + examples (single-category view only)
  if (_ainState.activeTab !== 'all' && !_ainState.searchQ) {
    var activeCat = cats.find(function(c){ return c.id === _ainState.activeTab; });
    if (activeCat) {
      html += '<div class="ain-cat-header" style="' +
        '--cat-bg:' + activeCat.bg + ';--cat-border:' + activeCat.border + ';--cat-color:' + activeCat.color + '">' +
        '<div class="ain-cat-header-title" style="color:' + activeCat.color + '">' +
          '<span>' + activeCat.emoji + '</span>' + _ainEsc(activeCat.label) +
        '</div>' +
        '<div class="ain-cat-header-hint">' + _ainEsc(activeCat.hint) + '</div>' +
        '<div class="ain-cat-examples">' +
          activeCat.examples.map(function(ex) {
            return '<button class="ain-example-chip" ' +
              'style="--cat-bg:' + activeCat.bg + ';--cat-border:' + activeCat.border + ';--cat-color:' + activeCat.color + '" ' +
              'onclick="ainFillExample(\'' + _ainEsc(ex).replace(/'/g, '&#39;') + '\',\'' + activeCat.id + '\')" ' +
              'title="Click to use this example">' + _ainEsc(ex) + '</button>';
          }).join('') +
        '</div>' +
        '</div>';
    }
  }

  // Instruction cards
  if (!filtered.length) {
    html += '<div class="ain-empty">' +
      '<div class="ain-empty-icon">📭</div>' +
      '<div class="ain-empty-title">' + (_ainState.searchQ ? 'No matching instructions' : 'No instructions yet') + '</div>' +
      '<div class="ain-empty-sub">' +
        (_ainState.searchQ
          ? 'Try a different search term.'
          : 'Tap <b>＋ Add</b> to teach the AI about your business.<br>Or click an example above to get started quickly.') +
      '</div>' +
    '</div>';
  } else {
    filtered.forEach(function(instr) {
      html += _ainRenderCard(instr, cats);
    });
  }

  html += '</div>';
  return html;
}

// ── Instruction card ──────────────────────────────────────────────────
function _ainRenderCard(instr, cats) {
  var cat     = cats.find(function(c){ return c.id === instr.category; }) || cats[0];
  var isEdit  = _ainState.editingId === instr.id;
  var inactive = instr.active === false;

  return '<div class="ain-card' + (inactive ? ' inactive' : '') + '" id="ain-card-' + instr.id + '">' +
    '<button class="ain-card-toggle' + (inactive ? '' : ' on') + '" ' +
      'onclick="ainToggle(\'' + instr.id + '\')" ' +
      'title="' + (inactive ? 'Enable' : 'Disable') + ' this instruction">' +
      (inactive ? '' : '✓') +
    '</button>' +
    '<div class="ain-card-body">' +
      '<div class="ain-card-cat" style="color:' + cat.color + '">' +
        cat.emoji + ' ' + _ainEsc(cat.label) +
      '</div>' +
      (isEdit
        ? '<textarea class="ain-card-edit-inp" id="ain-edit-' + instr.id + '" rows="2">' + _ainEsc(instr.text) + '</textarea>' +
          '<div class="ain-card-edit-actions">' +
            '<button class="ain-btn ain-btn-primary" onclick="ainSaveEdit(\'' + instr.id + '\')">Save</button>' +
            '<button class="ain-btn ain-btn-ghost" onclick="ainCancelEdit()">Cancel</button>' +
          '</div>'
        : '<div class="ain-card-text">' + _ainEsc(instr.text) + '</div>'
      ) +
    '</div>' +
    '<div class="ain-card-actions">' +
      '<button class="ain-icon-btn" onclick="ainStartEdit(\'' + instr.id + '\')" title="Edit">✏️</button>' +
      '<button class="ain-icon-btn del" onclick="ainDeletePrompt(\'' + instr.id + '\')" title="Delete">🗑</button>' +
    '</div>' +
  '</div>';
}

// ── Add form ──────────────────────────────────────────────────────────
function _ainRenderAddForm(cats) {
  var selOpts = cats.map(function(c) {
    return '<option value="' + c.id + '"' +
      (_ainState.formCat === c.id ? ' selected' : '') + '>' +
      c.emoji + ' ' + c.label + '</option>';
  }).join('');

  var activeCat = cats.find(function(c){ return c.id === _ainState.formCat; });
  var placeholder = activeCat
    ? 'e.g. ' + activeCat.examples[0]
    : 'Enter your instruction…';

  return '<div class="ain-form-card" id="ain-add-form">' +
    '<div class="ain-form-card-title">✏️ New Instruction</div>' +
    '<div class="ain-form-row">' +
      '<label class="ain-form-label">Category</label>' +
      '<select class="ain-form-select" id="ain-form-cat" onchange="ainFormCatChange(this.value)">' +
        selOpts +
      '</select>' +
    '</div>' +
    '<div class="ain-form-row">' +
      '<label class="ain-form-label">Instruction</label>' +
      '<textarea class="ain-form-textarea" id="ain-form-text" ' +
        'placeholder="' + _ainEsc(placeholder) + '" ' +
        'rows="3">' + _ainEsc(_ainState.formText) + '</textarea>' +
    '</div>' +
    '<div class="ain-form-actions">' +
      '<button class="ain-btn ain-btn-ghost" onclick="ainHideAddForm()">Cancel</button>' +
      '<button class="ain-btn ain-btn-primary" onclick="ainSubmitAdd()">Save Instruction</button>' +
    '</div>' +
  '</div>';
}

// ── Footer ────────────────────────────────────────────────────────────
function _ainRenderFooter() {
  var lastSync   = AIInstructions.getLastSyncTime();
  var syncLabel  = lastSync
    ? 'Synced ' + _ainRelTime(lastSync)
    : 'Not synced';

  return '<div class="ain-footer">' +
    '<button class="ain-footer-btn sync" onclick="ainSyncToCloud()">☁ Push to Cloud</button>' +
    '<button class="ain-footer-btn sync" onclick="ainSyncFromCloud()">↙ Pull from Cloud</button>' +
    '<button class="ain-footer-btn" onclick="ainExportUI()">⬇ Export</button>' +
    '<button class="ain-footer-btn" onclick="ainImportUI()">⬆ Import</button>' +
    '<button class="ain-footer-btn danger" onclick="ainClearAllPrompt()">🗑 Clear All</button>' +
    '<span class="ain-sync-status">☁ ' + syncLabel + '</span>' +
  '</div>';
}

// ══════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ══════════════════════════════════════════════════════════════════════

function _ainBindEvents() {
  // Keyboard shortcut: Escape closes panel
  document.addEventListener('keydown', _ainKeyHandler, { once: true });
}

function _ainKeyHandler(e) {
  if (e.key === 'Escape') ainClose();
}

function ainSwitchTab(catId) {
  _ainState.activeTab = catId;
  _ainState.showForm  = false;
  _ainState.editingId = null;
  renderAiInstructionsPanel();
}

function ainOnSearch(q) {
  _ainState.searchQ = q;
  _ainState.editingId = null;
  renderAiInstructionsPanel();
}

function ainShowAddForm() {
  _ainState.showForm  = true;
  _ainState.editingId = null;
  _ainState.formText  = '';
  if (_ainState.activeTab !== 'all') _ainState.formCat = _ainState.activeTab;
  renderAiInstructionsPanel();
  setTimeout(function() {
    var ta = document.getElementById('ain-form-text');
    if (ta) ta.focus();
  }, 50);
}

function ainHideAddForm() {
  _ainState.showForm = false;
  _ainState.formText = '';
  renderAiInstructionsPanel();
}

function ainFormCatChange(val) {
  _ainState.formCat = val;
}

function ainFillExample(text, catId) {
  _ainState.showForm = true;
  _ainState.formCat  = catId;
  _ainState.formText = text;
  renderAiInstructionsPanel();
  setTimeout(function() {
    var ta = document.getElementById('ain-form-text');
    if (ta) { ta.focus(); ta.select(); }
  }, 50);
}

function ainSubmitAdd() {
  var ta  = document.getElementById('ain-form-text');
  var sel = document.getElementById('ain-form-cat');
  var text = ta ? ta.value.trim() : '';
  var cat  = sel ? sel.value : _ainState.formCat;
  if (!text) { if (ta) { ta.style.borderColor = '#ef4444'; setTimeout(function(){ ta.style.borderColor = ''; }, 1500); } return; }
  AIInstructions.add(text, cat);
  _ainState.showForm = false;
  _ainState.formText = '';
  if (typeof toast === 'function') toast('✅ Instruction saved — AI will follow it from now on.');
}

function ainStartEdit(id) {
  _ainState.editingId = id;
  _ainState.showForm  = false;
  renderAiInstructionsPanel();
  setTimeout(function() {
    var ta = document.getElementById('ain-edit-' + id);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, 50);
}

function ainCancelEdit() {
  _ainState.editingId = null;
  renderAiInstructionsPanel();
}

function ainSaveEdit(id) {
  var ta = document.getElementById('ain-edit-' + id);
  var text = ta ? ta.value.trim() : '';
  if (!text) return;
  AIInstructions.update(id, { text: text });
  _ainState.editingId = null;
  if (typeof toast === 'function') toast('✅ Instruction updated.');
}

function ainToggle(id) {
  var result = AIInstructions.toggle(id);
  var msg = result && result.active ? '✅ Instruction enabled.' : '⏸ Instruction paused.';
  if (typeof toast === 'function') toast(msg);
}

function ainDeletePrompt(id) {
  var instr = AIInstructions.getAll().find(function(i){ return i.id === id; });
  if (!instr) return;

  // Inline confirm: replace card with confirmation
  var card = document.getElementById('ain-card-' + id);
  if (!card) return;
  var orig = card.innerHTML;
  card.style.background = '#fff1f2';
  card.style.borderColor = '#fecaca';
  card.innerHTML = '<div style="flex:1;padding:4px 0">' +
    '<div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px">🗑 Delete this instruction?</div>' +
    '<div style="font-size:13px;color:#1e293b">' + _ainEsc(instr.text) + '</div>' +
    '</div>' +
    '<div style="display:flex;gap:7px;flex-shrink:0;align-items:center">' +
      '<button class="ain-btn ain-btn-ghost" onclick="renderAiInstructionsPanel()">Cancel</button>' +
      '<button class="ain-btn ain-btn-primary" style="background:linear-gradient(135deg,#dc2626,#b91c1c)" ' +
        'onclick="ainConfirmDelete(\'' + id + '\')">Delete</button>' +
    '</div>';
  card.style.display = 'flex';
  card.style.gap = '10px';
}

function ainConfirmDelete(id) {
  AIInstructions.delete(id);
  if (typeof toast === 'function') toast('🗑️ Instruction deleted.');
}

// ── Export ────────────────────────────────────────────────────────────
function ainExportUI() {
  var json     = AIInstructions.exportJSON();
  var stats    = AIInstructions.getStats();
  var filename = 'bt-ai-instructions-' + new Date().toISOString().slice(0,10) + '.json';

  var blob = new Blob([json], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  if (typeof toast === 'function') toast('⬇ Exported ' + stats.total + ' instructions.');
}

// ── Import ────────────────────────────────────────────────────────────

function ainImportUI() {
  var wrap = document.getElementById('ain-io-wrap');
  if (wrap) wrap.remove();
  var div = document.createElement('div');
  div.id  = 'ain-io-wrap';
  div.style.cssText = 'position:fixed;inset:0;z-index:21000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
  div.innerHTML =
    '<div class="ain-io-modal" style="max-width:480px;width:100%">' +
      '<div class="ain-io-modal-title">\u2B06 Import Instructions</div>' +
      '<div style="font-size:12.5px;color:#64748b;margin-bottom:12px">' +
        'Import from a <code>.json</code> file <strong>or</strong> paste JSON directly (e.g. from the AI Instructions guide).' +
      '</div>' +
      // Merge / Replace radio
      '<div style="display:flex;gap:12px;margin-bottom:14px">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">' +
          '<input type="radio" name="ain-import-mode" value="merge" checked> Merge (keep existing)' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">' +
          '<input type="radio" name="ain-import-mode" value="replace"> Replace all' +
        '</label>' +
      '</div>' +
      // Tabs: File vs Paste
      '<div style="display:flex;border-bottom:2px solid #e2e8f0;margin-bottom:14px;gap:0">' +
        '<button id="ain-tab-file"  onclick="ainImportTabSwitch(\'file\')"  style="flex:1;padding:8px 0;font-size:12.5px;font-weight:700;background:none;border:none;border-bottom:3px solid #2563eb;margin-bottom:-2px;color:#2563eb;cursor:pointer;font-family:inherit">\uD83D\uDCC1 From File</button>' +
        '<button id="ain-tab-paste" onclick="ainImportTabSwitch(\'paste\')" style="flex:1;padding:8px 0;font-size:12.5px;font-weight:600;background:none;border:none;border-bottom:3px solid transparent;margin-bottom:-2px;color:#94a3b8;cursor:pointer;font-family:inherit">\uD83D\uDCCB Paste JSON</button>' +
      '</div>' +
      // File tab
      '<div id="ain-pane-file">' +
        '<input type="file" id="ain-import-file" accept=".json" style="display:block;margin-bottom:14px;width:100%">' +
      '</div>' +
      // Paste tab (hidden by default)
      '<div id="ain-pane-paste" style="display:none">' +
        '<textarea id="ain-import-paste" rows="7" placeholder=\'Paste the JSON array here, e.g.:\n[{"category":"business_profile","text":"Currency = PKR","active":true},...]\'' +
          ' style="width:100%;font-size:12px;font-family:monospace;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 10px;resize:vertical;outline:none;line-height:1.5"></textarea>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:5px">Paste the JSON block from the BT-Sales-AI-Instructions.md guide, then click Import.</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button class="ain-btn ain-btn-ghost" onclick="document.getElementById(\'ain-io-wrap\').remove()">Cancel</button>' +
        '<button class="ain-btn ain-btn-primary" onclick="ainDoImport()">\u2B06 Import</button>' +
      '</div>' +
    '</div>';
  div.addEventListener('click', function(e){ if (e.target === div) div.remove(); });
  document.body.appendChild(div);
}

function ainImportTabSwitch(tab) {
  var filePane  = document.getElementById('ain-pane-file');
  var pastePane = document.getElementById('ain-pane-paste');
  var fileTab   = document.getElementById('ain-tab-file');
  var pasteTab  = document.getElementById('ain-tab-paste');
  if (!filePane) return;
  if (tab === 'file') {
    filePane.style.display  = 'block';
    pastePane.style.display = 'none';
    fileTab.style.color     = '#2563eb'; fileTab.style.borderBottomColor  = '#2563eb'; fileTab.style.fontWeight = '700';
    pasteTab.style.color    = '#94a3b8'; pasteTab.style.borderBottomColor = 'transparent'; pasteTab.style.fontWeight = '600';
  } else {
    filePane.style.display  = 'none';
    pastePane.style.display = 'block';
    pasteTab.style.color    = '#2563eb'; pasteTab.style.borderBottomColor  = '#2563eb'; pasteTab.style.fontWeight = '700';
    fileTab.style.color     = '#94a3b8'; fileTab.style.borderBottomColor  = 'transparent'; fileTab.style.fontWeight = '600';
    setTimeout(function(){ var t = document.getElementById('ain-import-paste'); if(t) t.focus(); }, 50);
  }
}

function ainDoImport() {
  var modeRadio = document.querySelector('input[name="ain-import-mode"]:checked');
  var mode = modeRadio ? modeRadio.value : 'merge';

  // Determine source: file or paste
  var pastePane = document.getElementById('ain-pane-paste');
  var isPaste   = pastePane && pastePane.style.display !== 'none';

  if (isPaste) {
    var textarea = document.getElementById('ain-import-paste');
    var raw = textarea ? textarea.value.trim() : '';
    if (!raw) { if (typeof toast === 'function') toast('\u26a0 Please paste JSON first.', 'w'); return; }
    // Strip markdown fences if user copied the whole code block
    raw = raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    var result = AIInstructions.importJSON(raw, mode);
    var wrap = document.getElementById('ain-io-wrap');
    if (wrap) wrap.remove();
    if (!result.ok) { if (typeof toast === 'function') toast('\u26a0 Import failed: ' + result.error, 'w'); return; }
    var msg = mode === 'replace'
      ? '\u2705 Imported ' + result.count + ' instructions (replaced existing).'
      : '\u2705 Merged ' + result.count + ' new instruction' + (result.count !== 1 ? 's' : '') + '.';
    if (typeof toast === 'function') toast(msg);
    renderAiInstructionsPanel();
    return;
  }

  // File source
  var fileInp = document.getElementById('ain-import-file');
  if (!fileInp || !fileInp.files.length) {
    if (typeof toast === 'function') toast('\u26a0 Please select a JSON file.', 'w'); return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var result = AIInstructions.importJSON(e.target.result, mode);
    var wrap = document.getElementById('ain-io-wrap');
    if (wrap) wrap.remove();
    if (!result.ok) { if (typeof toast === 'function') toast('\u26a0 Import failed: ' + result.error, 'w'); return; }
    var msg = mode === 'replace'
      ? '\u2705 Imported ' + result.count + ' instructions (replaced existing).'
      : '\u2705 Merged ' + result.count + ' new instruction' + (result.count !== 1 ? 's' : '') + '.';
    if (typeof toast === 'function') toast(msg);
    renderAiInstructionsPanel();
  };
  reader.readAsText(fileInp.files[0]);
}


function ainSyncToCloud() {
  if (typeof toast === 'function') toast('☁ Syncing to cloud…');
  AIInstructions.syncToSupabase().then(function(r) {
    if (typeof toast === 'function') toast(r.ok ? '✅ Instructions pushed to Supabase.' : '⚠ Sync failed: ' + r.error, r.ok ? '' : 'w');
    renderAiInstructionsPanel();
  });
}

function ainSyncFromCloud() {
  if (typeof toast === 'function') toast('↙ Pulling from cloud…');
  AIInstructions.syncFromSupabase().then(function(r) {
    if (typeof toast === 'function') toast(r.ok ? '✅ Pulled ' + r.count + ' instructions from cloud.' : '⚠ Sync failed: ' + r.error, r.ok ? '' : 'w');
    renderAiInstructionsPanel();
  });
}

// ── Clear all ─────────────────────────────────────────────────────────
function ainClearAllPrompt() {
  var cnt = AIInstructions.getAll().length;
  if (!cnt) { if (typeof toast === 'function') toast('No instructions to clear.'); return; }
  if (!confirm('Delete all ' + cnt + ' instruction' + (cnt !== 1 ? 's' : '') + '? This cannot be undone.')) return;
  AIInstructions.importJSON('[]', 'replace');
  if (typeof toast === 'function') toast('🗑️ All instructions cleared.');
  renderAiInstructionsPanel();
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════
function _ainEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _ainRelTime(iso) {
  try {
    var diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60)   return 'just now';
    if (diff < 3600) return Math.round(diff/60) + 'm ago';
    if (diff < 86400) return Math.round(diff/3600) + 'h ago';
    return Math.round(diff/86400) + 'd ago';
  } catch(_) { return ''; }
}
