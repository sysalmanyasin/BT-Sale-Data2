/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  NOTES & SHEETS  —  BT Sales App  ·  Phase 6                       ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Three sub-panels, toggled by a pill nav inside mgr-sheets:         ║
 * ║   📝 Notes  — rich notepad with pinned notes, tags, search          ║
 * ║   📊 Sheets — lightweight editable grid (custom rows + formulas)    ║
 * ║   🔗 Data   — read-only live view of DAILY / MONTHLY / STAFF        ║
 * ║                                                                      ║
 * ║  Storage keys:                                                       ║
 * ║    bt_notes_v1       — array of note objects                        ║
 * ║    bt_sheets_v1      — object: {grids: {id: gridObj}}               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════════ */
(function _nsInjectStyles() {
  if (document.getElementById('ns-styles')) return;
  const el = document.createElement('style');
  el.id = 'ns-styles';
  el.textContent = `
/* ── Shell ── */
#mgr-sheets { padding: 0 !important; background: var(--s2, #f8fafc); }
.ns-shell { display: flex; flex-direction: column; height: 100%; min-height: 500px; }

/* ── Pill nav ── */
.ns-nav {
  display: flex; gap: 4px; padding: 10px 12px 0;
  border-bottom: 1px solid var(--border); background: var(--s1, #fff);
  flex-shrink: 0;
}
.ns-pill {
  padding: 6px 14px; border-radius: 20px 20px 0 0;
  border: 1px solid var(--border); border-bottom: none;
  font-size: 12px; font-weight: 600; color: var(--muted);
  background: var(--s2); cursor: pointer; transition: all .15s;
}
.ns-pill.active {
  background: var(--s1, #fff); color: var(--text);
  border-color: var(--border); border-bottom-color: var(--s1, #fff);
  margin-bottom: -1px; z-index: 1; position: relative;
}

/* ── Panel host ── */
.ns-panel { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

/* ─────────────────────────────────────────────
   NOTES PANEL
───────────────────────────────────────────── */
.ns-notes-toolbar {
  display: flex; gap: 6px; padding: 10px 12px;
  background: var(--s1,#fff); border-bottom: 1px solid var(--border);
  flex-shrink: 0; flex-wrap: wrap; align-items: center;
}
.ns-search-box {
  flex: 1; min-width: 140px; padding: 7px 10px; border-radius: 8px;
  border: 1.5px solid var(--border); font-size: 13px;
  background: var(--s2); color: var(--text); outline: none;
}
.ns-search-box:focus { border-color: var(--accent); }
.ns-btn {
  padding: 7px 14px; border-radius: 8px; border: 1.5px solid var(--border);
  background: var(--s2); font-size: 12px; font-weight: 600;
  color: var(--text); cursor: pointer; white-space: nowrap;
  transition: background .15s;
}
.ns-btn:hover { background: var(--border); }
.ns-btn.primary { background: var(--accent,#2563eb); color: #fff; border-color: var(--accent,#2563eb); }
.ns-btn.primary:hover { opacity: .9; }
.ns-btn.danger { color: #dc2626; border-color: #fca5a5; }

.ns-notes-list {
  flex: 1; overflow-y: auto; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.ns-note-card {
  background: var(--s1,#fff); border: 1.5px solid var(--border);
  border-radius: 10px; padding: 11px 14px; cursor: pointer;
  transition: border-color .15s, box-shadow .15s; position: relative;
}
.ns-note-card:hover { border-color: var(--accent); box-shadow: 0 2px 12px rgba(37,99,235,.08); }
.ns-note-card.pinned { border-color: #f59e0b; background: #fffbeb; }
.ns-note-card.pinned::before {
  content: '📌'; position: absolute; top: 8px; right: 10px; font-size: 13px;
}
.ns-note-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 3px; }
.ns-note-preview { font-size: 11.5px; color: var(--muted); line-height: 1.5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ns-note-meta { font-size: 10px; color: var(--muted); margin-top: 5px;
  display: flex; gap: 8px; align-items: center; }
.ns-tag { display: inline-block; padding: 1px 7px; border-radius: 10px;
  background: #eff6ff; color: #1d4ed8; font-size: 10px; font-weight: 600; }
.ns-tag.orange { background: #fff7ed; color: #c2410c; }
.ns-tag.green  { background: #f0fdf4; color: #16a34a; }
.ns-tag.purple { background: #faf5ff; color: #7c3aed; }

/* Note editor sheet */
.ns-editor-sheet {
  position: fixed; inset: 0; z-index: 18000;
  background: rgba(15,23,42,.5); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
}
.ns-editor-inner {
  width: 100%; max-width: 600px; max-height: 90vh;
  background: var(--s1, #fff); border-radius: 18px 18px 0 0;
  padding: 18px 16px 32px;
  display: flex; flex-direction: column; gap: 10px;
}
.ns-editor-header { display: flex; align-items: center; gap: 8px; }
.ns-editor-title-input {
  flex: 1; border: none; font-size: 16px; font-weight: 700; color: var(--text);
  background: none; outline: none; padding: 0;
}
.ns-editor-title-input::placeholder { color: #cbd5e1; }
.ns-editor-body {
  flex: 1; resize: none; border: 1.5px solid var(--border); border-radius: 9px;
  padding: 10px 12px; font-size: 13px; color: var(--text); line-height: 1.7;
  background: var(--s2); outline: none; min-height: 200px; font-family: inherit;
}
.ns-editor-body:focus { border-color: var(--accent); }
.ns-tag-input {
  border: 1.5px solid var(--border); border-radius: 8px; padding: 6px 10px;
  font-size: 12px; color: var(--text); background: var(--s2); outline: none; width: 100%;
}
.ns-editor-footer { display: flex; gap: 8px; flex-wrap: wrap; }

/* Empty state */
.ns-empty {
  text-align: center; padding: 48px 20px; color: var(--muted);
}
.ns-empty-icon { font-size: 36px; margin-bottom: 10px; }
.ns-empty-title { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.ns-empty-sub { font-size: 12px; line-height: 1.7; max-width: 300px; margin: 0 auto; }

/* ─────────────────────────────────────────────
   SHEETS PANEL
───────────────────────────────────────────── */
.ns-sheets-sidebar {
  display: flex; gap: 4px; padding: 10px 12px 6px;
  overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid var(--border);
  background: var(--s1,#fff); align-items: center;
}
.ns-sheet-tab {
  padding: 5px 12px; border-radius: 7px; border: 1.5px solid var(--border);
  font-size: 12px; font-weight: 600; color: var(--muted);
  background: var(--s2); cursor: pointer; white-space: nowrap;
  flex-shrink: 0;
}
.ns-sheet-tab.active { background: var(--accent,#2563eb); color: #fff; border-color: var(--accent); }

.ns-grid-wrap {
  flex: 1; overflow: auto;
}
.ns-grid {
  border-collapse: collapse; min-width: 100%; font-size: 12px;
}
.ns-grid th {
  background: var(--s2); color: var(--muted); font-weight: 700;
  font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
  padding: 6px 8px; border: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1; white-space: nowrap;
  text-align: left;
}
.ns-grid td {
  border: 1px solid var(--border); padding: 0;
  vertical-align: middle; min-width: 80px;
}
.ns-grid td input {
  width: 100%; border: none; padding: 6px 8px;
  font-size: 12px; color: var(--text); background: transparent;
  outline: none; font-family: inherit;
}
.ns-grid td input:focus { background: #eff6ff; }
.ns-grid td.row-num {
  background: var(--s2); color: var(--muted); font-size: 10px;
  text-align: center; padding: 4px; min-width: 28px; cursor: default;
  border-right: 2px solid var(--border);
}
.ns-grid td.formula { background: #f0fdf4; }
.ns-grid tr:hover td:not(.row-num) { background: rgba(37,99,235,.03); }

.ns-sheets-toolbar {
  display: flex; gap: 6px; padding: 8px 12px;
  background: var(--s1,#fff); border-top: 1px solid var(--border);
  flex-shrink: 0; flex-wrap: wrap;
}

/* ─────────────────────────────────────────────
   DATA PANEL
───────────────────────────────────────────── */
.ns-data-toolbar {
  display: flex; gap: 8px; padding: 10px 12px;
  background: var(--s1,#fff); border-bottom: 1px solid var(--border);
  flex-shrink: 0; flex-wrap: wrap; align-items: center;
}
.ns-data-select {
  padding: 6px 10px; border-radius: 8px; border: 1.5px solid var(--border);
  background: var(--s2); font-size: 12px; color: var(--text); outline: none;
}
.ns-data-table-wrap { flex: 1; overflow: auto; }
.ns-data-table {
  border-collapse: collapse; min-width: 100%; font-size: 12px;
}
.ns-data-table th {
  background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px;
  text-transform: uppercase; letter-spacing: .05em; padding: 7px 10px;
  border: 1px solid #2d4a6f; position: sticky; top: 0; white-space: nowrap;
}
.ns-data-table td {
  padding: 5px 10px; border: 1px solid var(--border);
  color: var(--text); font-size: 12px; white-space: nowrap;
}
.ns-data-table tr:nth-child(even) td { background: var(--s2); }
.ns-data-table tr:hover td { background: #eff6ff; }
`;
  document.head.appendChild(el);
})();

/* ══════════════════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════════════════ */
const NS_NOTES_KEY  = 'bt_notes_v1';
const NS_SHEETS_KEY = 'bt_sheets_v1';

function _nsNotesLoad()  { try { return JSON.parse(localStorage.getItem(NS_NOTES_KEY) || '[]'); } catch(_){ return []; } }
function _nsNotesSave(a) {
  try { localStorage.setItem(NS_NOTES_KEY, JSON.stringify(a)); } catch(_){}
  if (localStorage.getItem('bt_auto_save') === '1' && typeof pushToSupabase === 'function') pushToSupabase();
}
function _nsSheetsLoad() { try { return JSON.parse(localStorage.getItem(NS_SHEETS_KEY) || '{}'); } catch(_){ return {}; } }
function _nsSheetsSave(o){ try { localStorage.setItem(NS_SHEETS_KEY, JSON.stringify(o)); } catch(_){} }
function _nsUid()        { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function _nsEsc(s)       { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _nsFmt(v)       { const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n).toLocaleString('en-PK'); }

/* ══════════════════════════════════════════════════════════════════════
   MAIN RENDERER — called by switchMgrTab('sheets')
══════════════════════════════════════════════════════════════════════ */
var _nsActivePanel = 'notes';
var _nsActiveSheet = null;

function renderNotesSheets() {
  const host = document.getElementById('mgr-sheets');
  if (!host) return;

  host.innerHTML = `
    <div class="ns-shell">
      <div class="ns-nav">
        <button class="ns-pill ${_nsActivePanel==='notes'?'active':''}" onclick="_nsSetPanel('notes')">📝 Notes</button>
        <button class="ns-pill ${_nsActivePanel==='sheets'?'active':''}" onclick="_nsSetPanel('sheets')">📊 Sheets</button>
        <button class="ns-pill ${_nsActivePanel==='data'?'active':''}" onclick="_nsSetPanel('data')">🔗 Live Data</button>
      </div>
      <div class="ns-panel" id="ns-panel-host"></div>
    </div>`;

  _nsRenderPanel();
}

function _nsSetPanel(name) {
  _nsActivePanel = name;
  document.querySelectorAll('.ns-pill').forEach(p => p.classList.toggle('active', p.textContent.toLowerCase().includes(name)));
  _nsRenderPanel();
}

function _nsRenderPanel() {
  const host = document.getElementById('ns-panel-host');
  if (!host) return;
  if (_nsActivePanel === 'notes')  _nsRenderNotes(host);
  if (_nsActivePanel === 'sheets') _nsRenderSheets(host);
  if (_nsActivePanel === 'data')   _nsRenderData(host);
}

/* ══════════════════════════════════════════════════════════════════════
   NOTES PANEL
══════════════════════════════════════════════════════════════════════ */
var _nsNoteSearch = '';

function _nsRenderNotes(host) {
  const notes = _nsNotesLoad();
  const q     = _nsNoteSearch.toLowerCase();
  const filtered = q
    ? notes.filter(n => (n.title+n.body+n.tags).toLowerCase().includes(q))
    : notes;
  const pinned = filtered.filter(n => n.pinned);
  const rest   = filtered.filter(n => !n.pinned);
  const sorted = [...pinned, ...rest];

  const tagColors = { sale:'', urgent:'orange', staff:'green', finance:'purple' };

  const cards = sorted.length ? sorted.map(n => {
    const preview = (n.body || '').replace(/<[^>]+>/g,'').slice(0, 90) + ((n.body||'').length > 90 ? '…' : '');
    const tagHtml = (n.tags||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,3)
      .map(t=>`<span class="ns-tag ${tagColors[t]||''}">${_nsEsc(t)}</span>`).join(' ');
    const d = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('en-PK',{day:'2-digit',month:'short'}) : '';
    return `<div class="ns-note-card${n.pinned?' pinned':''}" onclick="_nsOpenNote('${n.id}')">
      <div class="ns-note-title">${_nsEsc(n.title || 'Untitled')}</div>
      <div class="ns-note-preview">${_nsEsc(preview) || '<em style="color:#cbd5e1">Empty note</em>'}</div>
      <div class="ns-note-meta">${tagHtml}<span style="margin-left:auto">${d}</span></div>
    </div>`;
  }).join('') : `<div class="ns-empty">
    <div class="ns-empty-icon">${q ? '🔍' : '📝'}</div>
    <div class="ns-empty-title">${q ? 'No matching notes' : 'No notes yet'}</div>
    <div class="ns-empty-sub">${q ? 'Try a different search term.' : 'Tap <strong>+ New Note</strong> to create your first note.'}</div>
  </div>`;

  host.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="ns-notes-toolbar">
        <input class="ns-search-box" placeholder="Search notes…" value="${_nsEsc(_nsNoteSearch)}"
          oninput="_nsNoteSearch=this.value;_nsRenderPanel()">
        <button class="ns-btn primary" onclick="_nsNewNote()">+ New Note</button>
      </div>
      <div class="ns-notes-list">${cards}</div>
    </div>`;
}

function _nsQuickSaveNote(title, body, tags) {
  const notes = _nsNotesLoad();
  const note = {
    id: _nsUid(),
    title: title || ('Note — ' + new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })),
    body: body || '',
    tags: tags || '',
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.unshift(note);
  _nsNotesSave(notes);
  if (_nsActivePanel === 'notes' && document.getElementById('mgr-sheets')) _nsRenderPanel();
  return note;
}

function _nsNewNote() {
  _nsOpenNote(null);
}

function _nsOpenNote(id) {
  const notes = _nsNotesLoad();
  const note  = id ? notes.find(n => n.id === id) : null;
  const isNew = !note;

  const sheet = document.createElement('div');
  sheet.className = 'ns-editor-sheet';
  sheet.id = 'ns-editor-sheet';
  sheet.innerHTML = `
    <div class="ns-editor-inner">
      <div class="ns-editor-header">
        <input class="ns-editor-title-input" id="nse-title" placeholder="Note title…"
          value="${_nsEsc(note ? note.title : '')}">
        <button class="ns-btn" onclick="${note && note.pinned ? '_nsTogglePin(\'' + (note?note.id:'') + '\')' : '_nsTogglePin(\'' + (note?note.id:'') + '\')'}" title="${note&&note.pinned?'Unpin':'Pin'}">
          ${note && note.pinned ? '📌 Pinned' : '📌 Pin'}
        </button>
        <button class="ns-btn" onclick="_nsCloseEditor()">✕</button>
      </div>
      <textarea class="ns-editor-body" id="nse-body" placeholder="Write anything here…">${_nsEsc(note ? note.body : '')}</textarea>
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Tags (comma-separated)</div>
        <input class="ns-tag-input" id="nse-tags" placeholder="e.g. sale, urgent, staff"
          value="${_nsEsc(note ? note.tags : '')}">
      </div>
      <div class="ns-editor-footer">
        <button class="ns-btn primary" onclick="_nsSaveNote('${id||''}')">💾 Save</button>
        ${!isNew ? `<button class="ns-btn danger" onclick="_nsDeleteNote('${id}')">🗑 Delete</button>` : ''}
        <button class="ns-btn" onclick="_nsCloseEditor()" style="margin-left:auto">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  setTimeout(() => { const t = document.getElementById('nse-title'); if (t) t.focus(); }, 80);
}

function _nsCloseEditor() {
  const el = document.getElementById('ns-editor-sheet');
  if (el) el.remove();
}

function _nsSaveNote(id) {
  const title = (document.getElementById('nse-title')||{}).value || '';
  const body  = (document.getElementById('nse-body')||{}).value  || '';
  const tags  = (document.getElementById('nse-tags')||{}).value  || '';
  const notes = _nsNotesLoad();

  if (id) {
    const idx = notes.findIndex(n => n.id === id);
    if (idx !== -1) {
      notes[idx].title     = title;
      notes[idx].body      = body;
      notes[idx].tags      = tags;
      notes[idx].updatedAt = new Date().toISOString();
    }
  } else {
    notes.unshift({ id: _nsUid(), title, body, tags, pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  _nsNotesSave(notes);
  _nsCloseEditor();
  _nsRenderPanel();
  if (typeof toast === 'function') toast('✅ Note saved.');
}

function _nsDeleteNote(id) {
  if (!confirm('Delete this note? This cannot be undone.')) return;
  const notes = _nsNotesLoad().filter(n => n.id !== id);
  _nsNotesSave(notes);
  _nsCloseEditor();
  _nsRenderPanel();
  if (typeof toast === 'function') toast('🗑 Note deleted.');
}

function _nsTogglePin(id) {
  const notes = _nsNotesLoad();
  const n     = notes.find(x => x.id === id);
  if (n) { n.pinned = !n.pinned; _nsNotesSave(notes); }
  // Refresh pin button label in open editor
  _nsCloseEditor();
  _nsRenderPanel();
  // Re-open if was editing
  if (id) _nsOpenNote(id);
}

/* ══════════════════════════════════════════════════════════════════════
   SHEETS PANEL
══════════════════════════════════════════════════════════════════════ */
const NS_SHEET_COLS = 6;  // A–F
const NS_SHEET_ROWS = 20;

function _nsDefaultGrid(name) {
  return {
    id: _nsUid(), name,
    cols: ['A','B','C','D','E','F'],
    data: Array.from({length: NS_SHEET_ROWS}, () => Array(NS_SHEET_COLS).fill('')),
    header: ['','','','','',''],
  };
}

function _nsGetSheets() {
  const s = _nsSheetsLoad();
  if (!s.grids || !Object.keys(s.grids).length) {
    const g = _nsDefaultGrid('Sheet 1');
    s.grids = { [g.id]: g };
    _nsSheetsSave(s);
  }
  return s;
}

function _nsRenderSheets(host) {
  const s       = _nsGetSheets();
  const grids   = s.grids || {};
  const ids     = Object.keys(grids);
  if (!_nsActiveSheet || !grids[_nsActiveSheet]) _nsActiveSheet = ids[0];
  const grid    = grids[_nsActiveSheet];

  const tabs = ids.map(id =>
    `<button class="ns-sheet-tab${id===_nsActiveSheet?' active':''}" onclick="_nsActiveSheet='${id}';_nsRenderPanel()">${_nsEsc(grids[id].name)}</button>`
  ).join('');

  // Build grid HTML
  const colLetters = grid.cols || ['A','B','C','D','E','F'];
  const headerCells = colLetters.map((c,ci) =>
    `<th><input style="border:none;background:transparent;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;width:100%;padding:0;outline:none;text-align:left;letter-spacing:.05em"
      value="${_nsEsc(grid.header[ci]||c)}"
      onchange="_nsUpdateHeader('${_nsActiveSheet}',${ci},this.value)"
      placeholder="${c}"></th>`
  ).join('');

  const rows = (grid.data || []).map((row, ri) => {
    const cells = colLetters.map((_,ci) => {
      const val   = row[ci] || '';
      const isF   = String(val).startsWith('=');
      const disp  = isF ? _nsEvalFormula(val, grid.data, ri, ci) : val;
      return `<td class="${isF?'formula':''}">
        <input value="${_nsEsc(disp)}"
          onchange="_nsUpdateCell('${_nsActiveSheet}',${ri},${ci},this.value)"
          onfocus="if(this.value!='${_nsEsc(val)}')this.value='${_nsEsc(val)}'"
          placeholder="">
      </td>`;
    }).join('');
    return `<tr><td class="row-num">${ri+1}</td>${cells}</tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="ns-sheets-sidebar">
        ${tabs}
        <button class="ns-btn" style="flex-shrink:0;padding:4px 10px;font-size:11px" onclick="_nsAddSheet()">+ Sheet</button>
      </div>
      <div class="ns-grid-wrap">
        <table class="ns-grid">
          <thead><tr><th style="min-width:28px;background:#1e3a5f;color:#fff">#</th>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="ns-sheets-toolbar">
        <button class="ns-btn" onclick="_nsAddSheetRow('${_nsActiveSheet}')">+ Row</button>
        <button class="ns-btn" onclick="_nsRenameSheet('${_nsActiveSheet}')">✏ Rename</button>
        <button class="ns-btn danger" onclick="_nsDeleteSheet('${_nsActiveSheet}')">🗑 Delete Sheet</button>
        <div style="margin-left:auto;font-size:10px;color:var(--muted);align-self:center">
          💡 Start a cell with = for formulas: =SUM(A1:A5), =A1+B1, =CONCAT(A1," ",B1), =IF(A1&gt;100,"High","Low"), =ROUND(A1/3,2)
        </div>
      </div>
    </div>`;
}

function _nsUpdateCell(sheetId, ri, ci, val) {
  const s = _nsGetSheets();
  if (!s.grids[sheetId]) return;
  s.grids[sheetId].data[ri][ci] = val;
  _nsSheetsSave(s);
}

function _nsUpdateHeader(sheetId, ci, val) {
  const s = _nsGetSheets();
  if (!s.grids[sheetId]) return;
  s.grids[sheetId].header[ci] = val;
  _nsSheetsSave(s);
}

function _nsAddSheet() {
  const name = prompt('New sheet name:', 'Sheet ' + (Object.keys(_nsGetSheets().grids).length + 1));
  if (!name) return;
  const s = _nsGetSheets();
  const g = _nsDefaultGrid(name);
  s.grids[g.id] = g;
  _nsActiveSheet = g.id;
  _nsSheetsSave(s);
  _nsRenderPanel();
}

function _nsAddSheetRow(sheetId) {
  const s = _nsGetSheets();
  if (!s.grids[sheetId]) return;
  s.grids[sheetId].data.push(Array(NS_SHEET_COLS).fill(''));
  _nsSheetsSave(s);
  _nsRenderPanel();
}

function _nsRenameSheet(sheetId) {
  const s = _nsGetSheets();
  if (!s.grids[sheetId]) return;
  const name = prompt('Rename sheet:', s.grids[sheetId].name);
  if (!name) return;
  s.grids[sheetId].name = name;
  _nsSheetsSave(s);
  _nsRenderPanel();
}

function _nsDeleteSheet(sheetId) {
  const s = _nsGetSheets();
  const ids = Object.keys(s.grids||{});
  if (ids.length <= 1) { if (typeof toast === 'function') toast('⚠ Cannot delete the last sheet.','w'); return; }
  if (!confirm('Delete this sheet? All data will be lost.')) return;
  delete s.grids[sheetId];
  _nsActiveSheet = Object.keys(s.grids)[0];
  _nsSheetsSave(s);
  _nsRenderPanel();
}

/* ── Formula evaluator (SUM, AVG, COUNT, MIN, MAX, arithmetic) ── */
function _nsSplitArgs(s) {
  // Top-level comma split (formulas here don't nest parens inside args)
  return String(s).split(',').map(function(x){ return x.trim(); });
}

function _nsEvalFormula(formula, data, curRow, curCol) {
  try {
    var expr = formula.slice(1).trim(); // strip =
    var roundDecimals = null; // set when ROUND(...,n) used, so display keeps decimals

    function cellRaw(col, row) {
      const ci = col.toUpperCase().charCodeAt(0) - 65;
      const ri = parseInt(row, 10) - 1;
      return (data[ri] && data[ri][ci] !== undefined) ? data[ri][ci] : '';
    }
    function cellNum(col, row) {
      const v = parseFloat(cellRaw(col, row));
      return isNaN(v) ? 0 : v;
    }

    // Phase 7: range functions FIRST — must run before plain single-cell
    // substitution below, otherwise "A1:A5" gets mangled into "0:0" and the
    // range never matches (this was a Phase 6 ordering bug).
    expr = expr.replace(/(SUM|AVG|COUNT|MIN|MAX)\(([A-F])(\d+):([A-F])(\d+)\)/gi, function(_, fn, c1, r1, c2, r2) {
      const ci1 = c1.toUpperCase().charCodeAt(0) - 65;
      const ci2 = c2.toUpperCase().charCodeAt(0) - 65;
      const ri1 = parseInt(r1,10) - 1, ri2 = parseInt(r2,10) - 1;
      const vals = [];
      for (let r = Math.min(ri1,ri2); r <= Math.max(ri1,ri2); r++) {
        for (let c = Math.min(ci1,ci2); c <= Math.max(ci1,ci2); c++) {
          if (data[r] && data[r][c] !== undefined) {
            const v = parseFloat(data[r][c]);
            if (!isNaN(v)) vals.push(v);
          }
        }
      }
      const upper = fn.toUpperCase();
      if (upper === 'SUM')   return String(vals.reduce((a,b)=>a+b,0));
      if (upper === 'AVG')   return String(vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0);
      if (upper === 'COUNT') return String(vals.length);
      if (upper === 'MIN')   return String(vals.length ? Math.min(...vals) : 0);
      if (upper === 'MAX')   return String(vals.length ? Math.max(...vals) : 0);
      return '0';
    });

    // Phase 7: CONCAT(a, b, ...) — string-aware, resolves raw (non-numeric) cell values
    expr = expr.replace(/CONCAT\(([^()]*)\)/gi, function(_, args) {
      const out = _nsSplitArgs(args).map(function(p) {
        const ref = p.match(/^([A-F])(\d+)$/i);
        if (ref) return String(cellRaw(ref[1], ref[2]));
        const lit = p.match(/^["'](.*)["']$/);
        if (lit) return lit[1];
        return p;
      }).join('');
      return JSON.stringify(out);
    });

    // Phase 7: IF(condition, thenVal, elseVal) — basic ternary, string or numeric branches
    expr = expr.replace(/IF\(([^()]*)\)/gi, function(_, args) {
      const parts = _nsSplitArgs(args);
      if (parts.length < 2) return '0';
      const condStr  = parts[0];
      const thenStr  = parts[1];
      const elseStr  = parts.length > 2 ? parts[2] : '""';
      const condResolved = condStr.replace(/\b([A-F])(\d+)\b/gi, function(__,c,r){ return String(cellNum(c,r)); });
      let condVal;
      try { condVal = Function('"use strict"; return (' + condResolved + ')')(); } catch(e) { condVal = false; }
      const branch = (condVal ? thenStr : elseStr).trim();
      const lit = branch.match(/^["'](.*)["']$/);
      if (lit) return JSON.stringify(lit[1]);
      const ref = branch.match(/^([A-F])(\d+)$/i);
      if (ref) {
        const raw = cellRaw(ref[1], ref[2]);
        const n = parseFloat(raw);
        return isNaN(n) ? JSON.stringify(String(raw)) : String(n);
      }
      return branch; // plain numeric expression — let the final substitution/eval handle it
    });

    // Phase 7: ROUND(expr, decimals?) — decimals defaults to 0
    expr = expr.replace(/ROUND\(([^()]*)\)/gi, function(_, args) {
      const parts = _nsSplitArgs(args);
      const inner = parts[0].replace(/\b([A-F])(\d+)\b/gi, function(__,c,r){ return String(cellNum(c,r)); });
      const decimals = parts[1] !== undefined ? parseInt(parts[1], 10) : 0;
      let val;
      try { val = Function('"use strict"; return (' + inner + ')')(); } catch(e) { val = NaN; }
      if (isNaN(val)) return '0';
      const factor = Math.pow(10, decimals);
      roundDecimals = decimals;
      return String(Math.round(val * factor) / factor);
    });

    // Resolve any remaining plain cell references like A1, B3 → numbers
    expr = expr.replace(/\b([A-F])(\d+)\b/gi, function(_, col, row) {
      return String(cellNum(col, row));
    });

    // Safe eval
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result === 'number' && !isNaN(result)) {
      return roundDecimals !== null ? result.toFixed(roundDecimals) : _nsFmt(result);
    }
    return result; // string result from CONCAT/IF, or non-numeric fallback
  } catch(_) {
    return '#ERR';
  }
}

/* ══════════════════════════════════════════════════════════════════════
   DATA PANEL — live read-only view of DAILY / MONTHLY / STAFF
══════════════════════════════════════════════════════════════════════ */
var _nsDataSource = 'monthly';
var _nsDataSearch = '';

function _nsRenderData(host) {
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="ns-data-toolbar">
        <select class="ns-data-select" onchange="_nsDataSource=this.value;_nsRenderPanel()">
          <option value="monthly" ${_nsDataSource==='monthly'?'selected':''}>📅 Monthly Summary</option>
          <option value="daily"   ${_nsDataSource==='daily'?'selected':''}>📆 Daily Records</option>
          <option value="staff"   ${_nsDataSource==='staff'?'selected':''}>👤 Staff Registry</option>
        </select>
        <input class="ns-search-box" style="flex:1;min-width:100px" placeholder="Filter…"
          value="${_nsEsc(_nsDataSearch)}"
          oninput="_nsDataSearch=this.value;_nsRenderPanel()">
        <button class="ns-btn" onclick="_nsExportDataCSV()">⬇ CSV</button>
      </div>
      <div class="ns-data-table-wrap" id="ns-data-table-host"></div>
    </div>`;
  _nsRenderDataTable();
}

function _nsRenderDataTable() {
  const host = document.getElementById('ns-data-table-host');
  if (!host) return;
  const q   = _nsDataSearch.toLowerCase();

  if (_nsDataSource === 'monthly') {
    const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
    const cols = ['Month_Year','TOTAL','Customers','Cash Sale','PSO','NESPAK','PARCO','Jazz Cash','Load Sale'];
    const rows = M.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)).reverse();
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">📅</div><div class="ns-empty-title">No data</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r =>
      '<tr>' + cols.map(c => {
        const v = r[c];
        const n = parseFloat(v);
        const disp = (c !== 'Month_Year' && c !== 'Customers' && !isNaN(n) && n !== 0) ? '₨'+_nsFmt(n) : _nsEsc(v||'');
        return `<td>${disp}</td>`;
      }).join('') + '</tr>'
    ).join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;

  } else if (_nsDataSource === 'daily') {
    const D = (typeof DAILY !== 'undefined' && DAILY) ? DAILY : [];
    const cols = ['Date','Month_Year','TOTAL','Customers','Cash Sale','Jazz Cash','Load Sale'];
    const rows = D.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q))
                  .sort((a,b) => (b.Date||'') > (a.Date||'') ? 1 : -1).slice(0, 200);
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">📆</div><div class="ns-empty-title">No data</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r =>
      '<tr>' + cols.map(c => {
        const v = r[c];
        const n = parseFloat(v);
        const disp = (['Date','Month_Year'].includes(c)) ? _nsEsc(v||'') : (!isNaN(n) && n !== 0 ? '₨'+_nsFmt(n) : _nsEsc(v||''));
        return `<td>${disp}</td>`;
      }).join('') + '</tr>'
    ).join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;

  } else if (_nsDataSource === 'staff') {
    const S = (typeof STAFF !== 'undefined' && STAFF) ? STAFF : [];
    const cols = ['name','staffId','role','phone','cnic','joinDate'];
    const rows = S.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">👤</div><div class="ns-empty-title">No staff</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r =>
      '<tr>' + cols.map(c=>`<td>${_nsEsc(r[c]||'')}</td>`).join('') + '</tr>'
    ).join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
}

function _nsExportDataCSV() {
  let data = [], cols = [];
  if (_nsDataSource === 'monthly') {
    data = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY.slice().reverse() : [];
    cols = data.length ? Object.keys(data[0]) : [];
  } else if (_nsDataSource === 'daily') {
    data = (typeof DAILY !== 'undefined' && DAILY) ? DAILY.slice().sort((a,b)=>(b.Date||'')>(a.Date||'')?1:-1) : [];
    cols = data.length ? Object.keys(data[0]) : [];
  } else {
    data = (typeof STAFF !== 'undefined' && STAFF) ? STAFF : [];
    cols = ['name','staffId','role','phone','cnic','joinDate'];
  }
  if (!data.length) { if (typeof toast === 'function') toast('⚠ No data to export.','w'); return; }
  const csv = [cols.join(','), ...data.map(r => cols.map(c => JSON.stringify(r[c]||'')).join(','))].join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = _nsDataSource + '-export.csv';
  a.click();
  if (typeof toast === 'function') toast('✅ CSV exported.');
}

/* ══════════════════════════════════════════════════════════════════════
   HOOK INTO switchMgrTab
══════════════════════════════════════════════════════════════════════ */
var _nsSwitchMgrTabOrig = (typeof switchMgrTab === 'function') ? switchMgrTab : null;
if (_nsSwitchMgrTabOrig) {
  switchMgrTab = function(tab) {
    _nsSwitchMgrTabOrig(tab);
    if (tab === 'sheets') renderNotesSheets();
  };
}
