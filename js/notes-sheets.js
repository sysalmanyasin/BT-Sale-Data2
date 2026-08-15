/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  NOTES & SHEETS  —  BT Sales App  ·  Phase 6 (Full Spreadsheet)     ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  Three sub-panels:                                                   ║
 * ║   📝 Notes  — rich notepad with pinned notes, tags, search           ║
 * ║   📊 Sheets — real Google Sheets (js/sheets-app.js), linked/synced   ║
 * ║   🔗 Data   — read-only live view of DAILY / MONTHLY / STAFF        ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Module-migration: converted from classic <script defer> to a real ES
 * module, together with manager-page.js and jazz-cash.js (the three
 * files were entangled via a monkey-patch, now untangled — see
 * manager-page.js's header comment). Repository/Actions/STAFF/MONTHLY/
 * DAILY below are real imports now (Repository/Actions were called
 * unconditionally before this change, with no `typeof` guard — pure
 * correctness upgrade, not a behavior change; STAFF/MONTHLY/DAILY did
 * have guards, left in place since they're harmless once the import
 * guarantees the value exists). XLSX/toast/pushToSupabase are left as
 * bare identifiers guarded by `typeof`, same as before.
 *
 * This file's own functions are called two ways from outside its own
 * module scope, both needing an explicit `window.X = X` bridge now
 * that top-level declarations are module-scoped instead of implicitly
 * global: (1) manager-page.js calls renderNotesSheets() directly; (2)
 * this file's own generated HTML dispatches through inline
 * onclick/onchange/oninput attributes, which always execute in global
 * scope regardless of where the HTML came from. _nsNoteSearch/
 * _nsDataSource/_nsDataSearch route through small setter functions
 * (`_nsSetDataSource`, etc.) rather than being assigned directly from
 * inline handlers, since a bare assignment from global-scope HTML
 * can't update a module-scoped var — same pattern as jazz-cash.js's
 * `_jcSelectTallyDate`.
 */

import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { STAFF, MONTHLY, DAILY } from './config.js';
// ── Manager domain sources (Data tab / Send to Sheets) — all real ES
// imports, so these are live bindings, not one-time snapshots. Salary/
// Generic/Petty/Incentive reflect whichever month is currently loaded
// in their respective Manager tab this session (same "current working
// copy" every other consumer of these already relies on — e.g.
// ai-bridge.js's assistant commands); Credit Ledger and Unmatched are
// independent of that since _crdData_cur re-syncs on every load and
// unmatchedLoad() reads Repository fresh each call. No circular import:
// none of these six modules — nor inventory-bridge.js below — import
// notes-sheets.js, directly or transitively (verified via grep before
// adding this). ──────────────────────────────────────────────────────
import { _salRows_cur, _salNet } from './manager-salary.js';
import { _genRows_cur, _genIncentive, _genFinal } from './manager-generic.js';
import { _crdData_cur, _crdNet } from './manager-credit.js';
import { _pettyData } from './manager-petty.js';
import { _incData, _incMonth } from './manager-incentive.js';
import { unmatchedLoad } from './manager-unmatched.js';
// ── Inventory domain source — inventory-bridge.js is a standalone
// module (no imports of its own), getFullData() reads its own local
// cache synchronously (null until Inventory's own page has fetched at
// least once this browser). ─────────────────────────────────────────
import { getFullData as _invGetFullData } from './inventory-bridge.js';

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
/* .ns-nav retired from view (Aug 2026), same as Manager's #mgr-tabs and
   Credit Ledger's .cl-mode-tabs — its 4 destinations are covered by the
   rail/drawer (js/nav-sections.js's '.ns-pill[href]' scraper is still
   the one real source of those rows). Not in the mobile sub-tab strip's
   scope (that covers Sales/Manager/Inventory/Closing only), so on
   mobile this is reachable via the Menu drawer's Notes & Sheets group. */
.ns-nav { display: none; }
.ns-pill {
  padding: 6px 14px; border-radius: 20px 20px 0 0;
  border: 1px solid var(--border); border-bottom: none;
  font-size: 12px; font-weight: 600; color: var(--muted);
  background: var(--s2); cursor: pointer; transition: all .15s;
  text-decoration: none; display: inline-block;
}
.ns-pill.active {
  background: var(--s1, #fff); color: var(--text);
  border-color: var(--border); border-bottom-color: var(--s1, #fff);
  margin-bottom: -1px; z-index: 1; position: relative;
}
.ns-panel { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }

/* ─── Notes Panel ─────────────────────────────────────────────────── */
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
.ns-note-card.pinned::before { content: '📌'; position: absolute; top: 8px; right: 10px; font-size: 13px; }
.ns-note-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 3px; }
.ns-note-preview { font-size: 11.5px; color: var(--muted); line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ns-note-meta { font-size: 10px; color: var(--muted); margin-top: 5px; display: flex; gap: 8px; align-items: center; }
.ns-tag { display: inline-block; padding: 1px 7px; border-radius: 10px; background: #eff6ff; color: #1d4ed8; font-size: 10px; font-weight: 600; }
.ns-tag.orange { background: #fff7ed; color: #c2410c; }
.ns-tag.green  { background: #f0fdf4; color: #16a34a; }
.ns-tag.purple { background: #faf5ff; color: #7c3aed; }
.ns-editor-sheet {
  position: fixed; inset: 0; z-index: 18000;
  background: rgba(15,23,42,.5); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
}
.ns-editor-inner {
  width: 100%; max-width: 600px; max-height: 90vh;
  background: var(--s1, #fff); border-radius: 18px 18px 0 0;
  padding: 18px 16px 32px; display: flex; flex-direction: column; gap: 10px;
}
.ns-editor-header { display: flex; align-items: center; gap: 8px; }
.ns-editor-title-input { flex: 1; border: none; font-size: 16px; font-weight: 700; color: var(--text); background: none; outline: none; padding: 0; }
.ns-editor-title-input::placeholder { color: #cbd5e1; }
.ns-editor-body { flex: 1; resize: none; border: 1.5px solid var(--border); border-radius: 9px; padding: 10px 12px; font-size: 13px; color: var(--text); line-height: 1.7; background: var(--s2); outline: none; min-height: 200px; font-family: inherit; }
.ns-editor-body:focus { border-color: var(--accent); }
.ns-tag-input { border: 1.5px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 12px; color: var(--text); background: var(--s2); outline: none; width: 100%; }
.ns-editor-footer { display: flex; gap: 8px; flex-wrap: wrap; }
.ns-empty { text-align: center; padding: 48px 20px; color: var(--muted); }
.ns-empty-icon { font-size: 36px; margin-bottom: 10px; }
.ns-empty-title { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.ns-empty-sub { font-size: 12px; line-height: 1.7; max-width: 300px; margin: 0 auto; }

/* Data panel */
.ns-data-toolbar { display: flex; gap: 8px; padding: 10px 12px; background: var(--s1,#fff); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; align-items: center; }
.ns-data-select { padding: 6px 10px; border-radius: 8px; border: 1.5px solid var(--border); background: var(--s2); font-size: 12px; color: var(--text); outline: none; }
.ns-data-hint { padding: 7px 12px; font-size: 11.5px; color: var(--muted); background: var(--alt,#eff6ff); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ns-data-more-hint { padding: 10px 12px; font-size: 11.5px; color: var(--muted); text-align: center; }
.ns-data-table-wrap { flex: 1; overflow: auto; }
.ns-data-table { border-collapse: collapse; min-width: 100%; font-size: 12px; }
.ns-data-table th { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 10px; border: 1px solid #2d4a6f; position: sticky; top: 0; white-space: nowrap; }
.ns-data-table td { padding: 5px 10px; border: 1px solid var(--border); color: var(--text); font-size: 12px; white-space: nowrap; }
.ns-data-table tr:nth-child(even) td { background: var(--s2); }
.ns-data-table tr:hover td { background: #eff6ff; }

`;
  document.head.appendChild(el);
})();

/* ══════════════════════════════════════════════════════════════════════
   STORAGE

   Notes only, below. The old local workbook system (bt_sheets_v2 /
   bt_sheet_files_v1 / bt_sheet_workbooks_v1 and every _nsWB / _nsSF /
   _nsSp / _nsRenderManage function that read or wrote them) was fully
   retired (Aug 2026) now that the Sheets panel talks to real Google
   Sheets (js/sheets-app.js). Those old localStorage keys are simply no
   longer read — nothing was deleted from a user's browser storage,
   just the code that used to look at them.
══════════════════════════════════════════════════════════════════════ */
const NS_NOTES_KEY      = 'bt_notes_v1';

function _nsNotesLoad()  { try { return JSON.parse(Repository.getItem(NS_NOTES_KEY) || '[]'); } catch(_){ return []; } }
function _nsNotesSave(a) {
  try { Actions.saveNotes(JSON.stringify(a)); } catch(_){}
  if (Repository.getItem('bt_auto_save') === '1' && typeof pushToSupabase === 'function') pushToSupabase();
}
function _nsUid()        { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function _nsEsc(s)       { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ══════════════════════════════════════════════════════════════════════
   MAIN RENDERER
══════════════════════════════════════════════════════════════════════ */
var _nsActivePanel = 'notes';

function renderNotesSheets() {
  const host = document.getElementById('mgr-sheets');
  if (!host) return;
  host.innerHTML = `
    <div class="ns-shell">
      <div class="ns-nav">
        <a class="ns-pill ${_nsActivePanel==='notes'?'active':''}" data-panel="notes" href="#notesheets/notes">📝 Notes</a>
        <a class="ns-pill ${_nsActivePanel==='sheets'?'active':''}" data-panel="sheets" href="#notesheets/sheets">📊 Sheets</a>
        <a class="ns-pill ${_nsActivePanel==='data'?'active':''}" data-panel="data" href="#notesheets/data">🔗 Live Data</a>
      </div>
      <div class="ns-panel" id="ns-panel-host"></div>
    </div>`;
  _nsRenderPanel();
}

function _nsSetPanel(name) {
  _nsActivePanel = name;
  document.querySelectorAll('.ns-pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-panel') === name);
  });
  _nsRenderPanel();
}

function _nsRenderPanel() {
  const host = document.getElementById('ns-panel-host');
  if (!host) return;
  if (_nsActivePanel === 'notes')  _nsRenderNotes(host);
  // 'sheets' renders real Google Sheets (js/sheets-app.js, loaded before
  // this file — see index.html). The old custom grid this used to fall
  // back to (_nsSpBuild) — and the 'manage' panel that managed its local
  // saved files (_nsRenderManage) — were both fully retired (Aug 2026)
  // now that Sheets is confirmed working live; see git history for what
  // was removed.
  if (_nsActivePanel === 'sheets') {
    if (typeof sheetsAppBuild === 'function') sheetsAppBuild(host);
    else host.innerHTML = '<div style="padding:20px;color:var(--muted)">⚠ Sheets failed to load. Try refreshing.</div>';
  }
  if (_nsActivePanel === 'data')   _nsRenderData(host);
}

/* ══════════════════════════════════════════════════════════════════════
   NOTES PANEL  (unchanged from original)
══════════════════════════════════════════════════════════════════════ */
var _nsNoteSearch = '';
function _nsSetNoteSearch(v) { _nsNoteSearch = v; _nsRenderPanel(); } // inline onchange/oninput can't assign a module-scoped var directly (see file header)

function _nsRenderNotes(host) {
  const notes = _nsNotesLoad();
  const q     = _nsNoteSearch.toLowerCase();
  const filtered = q ? notes.filter(n => (n.title+n.body+n.tags).toLowerCase().includes(q)) : notes;
  const pinned   = filtered.filter(n => n.pinned);
  const rest     = filtered.filter(n => !n.pinned);
  const sorted   = [...pinned, ...rest];
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
          oninput="_nsSetNoteSearch(this.value)">
        <button class="ns-btn primary" onclick="_nsNewNote()">+ New Note</button>
      </div>
      <div class="ns-notes-list">${cards}</div>
    </div>`;
}

function _nsNewNote() { _nsOpenNote(null); }
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
        <input class="ns-editor-title-input" id="nse-title" placeholder="Note title…" value="${_nsEsc(note ? note.title : '')}">
        <button class="ns-btn" onclick="_nsTogglePin('${note?note.id:''}')" title="${note&&note.pinned?'Unpin':'Pin'}">${note&&note.pinned?'📌 Pinned':'📌 Pin'}</button>
        <button class="ns-btn" onclick="_nsCloseEditor()">✕</button>
      </div>
      <textarea class="ns-editor-body" id="nse-body" placeholder="Write anything here…">${_nsEsc(note ? note.body : '')}</textarea>
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Tags (comma-separated)</div>
        <input class="ns-tag-input" id="nse-tags" placeholder="e.g. sale, urgent, staff" value="${_nsEsc(note ? note.tags : '')}">
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
function _nsCloseEditor() { const el = document.getElementById('ns-editor-sheet'); if (el) el.remove(); }
function _nsSaveNote(id) {
  const title = (document.getElementById('nse-title')||{}).value || '';
  const body  = (document.getElementById('nse-body')||{}).value  || '';
  const tags  = (document.getElementById('nse-tags')||{}).value  || '';
  const notes = _nsNotesLoad();
  if (id) {
    const idx = notes.findIndex(n => n.id === id);
    if (idx !== -1) { notes[idx].title = title; notes[idx].body = body; notes[idx].tags = tags; notes[idx].updatedAt = new Date().toISOString(); }
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
  const n = notes.find(x => x.id === id);
  if (n) { n.pinned = !n.pinned; _nsNotesSave(notes); }
  _nsCloseEditor();
  _nsRenderPanel();
  if (id) _nsOpenNote(id);
}

const _NS_DOMAINS = [
  { id: 'sales',     label: '💵 Sales',     sources: ['monthly', 'daily'] },
  { id: 'manager',   label: '👔 Manager',   sources: ['staff', 'salary', 'generic', 'credit', 'petty', 'incentive', 'unmatched'] },
  { id: 'inventory', label: '📦 Inventory', sources: ['inventory', 'stockledger_raw', 'stockledger_excess', 'reorder'] },
];

const _NS_SOURCE_META = {
  monthly:            { label: '📅 Monthly Summary',  icon: '📅', empty: 'No monthly data' },
  daily:               { label: '📆 Daily Records',    icon: '📆', empty: 'No daily data' },
  staff:               { label: '👤 Staff Registry',   icon: '👤', empty: 'No staff' },
  salary:              { label: '💰 Salary Sheet',     icon: '💰', empty: 'No salary data loaded — open Manager → Salary for a month first', hint: 'Shows the month currently open in Manager → Salary Sheet.' },
  generic:             { label: '🧮 Generic Working',  icon: '🧮', empty: 'No generic working data loaded — open Manager → Generic Working for a month first', hint: 'Shows the month currently open in Manager → Generic Working.' },
  credit:              { label: '💳 Credit Ledger',    icon: '💳', empty: 'No credit ledger data loaded — open Manager → Credit Ledger for a month first', hint: 'One row per employee, for the month currently open in Manager → Credit Ledger.' },
  petty:               { label: '🧾 Petty Cash',       icon: '🧾', empty: 'No petty cash entries loaded — open Manager → Petty Cash for a month first', hint: 'Shows the month currently open in Manager → Petty Cash.' },
  incentive:           { label: '🎯 Incentive',        icon: '🎯', empty: 'No incentive data loaded — open Manager → Incentive for a month first', hint: 'Shows the month currently open in Manager → Incentive.' },
  unmatched:           { label: '❓ Unmatched',        icon: '❓', empty: 'Nothing unresolved — all clear ✅' },
  inventory:           { label: '📦 BT Inventory',     icon: '📦', empty: 'No inventory data yet — open BT Inventory once to pull it', hint: 'Live product list, synced from Supabase.' },
  stockledger_raw:     { label: '📋 Stock Ledger (Raw)', icon: '📋', empty: 'No Stock Ledger data — pull or upload it on the Stock Ledger page first', hint: 'The raw item list Stock Ledger works from.' },
  stockledger_excess:  { label: '♻️ Excess Stock',     icon: '♻️', empty: 'No excess-stock items flagged', hint: '100-day excess items, computed by Stock Ledger.' },
  reorder:             { label: '🔔 Reorder Flagged',  icon: '🔔', empty: 'No items currently flagged for reorder', hint: "Uses Reorder Report's own saved window / cover-days / Top-N settings." },
};

const _NS_SOURCE_COLS = {
  monthly: [
    ['Month_Year', 'text', 'Month'], ['TOTAL', 'money', 'Total'], ['Customers', 'num', 'Customers'],
    ['Cash Sale', 'money', 'Cash Sale'], ['PSO', 'money', 'PSO'], ['NESPAK', 'money', 'NESPAK'],
    ['PARCO', 'money', 'PARCO'], ['Jazz Cash', 'money', 'Jazz Cash'], ['Load Sale', 'money', 'Load Sale'],
  ],
  daily: [
    ['Date', 'text', 'Date'], ['Month_Year', 'text', 'Month'], ['TOTAL', 'money', 'Total'], ['Customers', 'num', 'Customers'],
    ['Cash Sale', 'money', 'Cash Sale'], ['Jazz Cash', 'money', 'Jazz Cash'], ['Load Sale', 'money', 'Load Sale'],
  ],
  staff: [
    ['name', 'text', 'Name'], ['staffId', 'text', 'Staff ID'], ['role', 'text', 'Role'],
    ['phone', 'text', 'Phone'], ['cnic', 'text', 'CNIC'], ['joinDate', 'text', 'Join Date'],
  ],
  salary: [
    ['staffId', 'text', 'Staff ID'], ['name', 'text', 'Name'], ['desig', 'text', 'Designation'], ['days', 'num', 'Days'],
    ['hoSal', 'money', 'HO Salary'], ['advance', 'money', 'Advance'], ['generic', 'money', 'Generic'], ['net', 'money', 'Net Pay'],
  ],
  generic: [
    ['staffId', 'text', 'Staff ID'], ['name', 'text', 'Name'], ['desig', 'text', 'Designation'],
    ['genericSale', 'money', 'Generic Sale'], ['extra', 'money', 'Extra'], ['incentive', 'money', 'Incentive (4%)'], ['final', 'money', 'Final'],
  ],
  credit: [
    ['name', 'text', 'Name'], ['prevBal', 'money', 'Opening Balance'], ['entriesCount', 'num', 'Entries'],
    ['entriesTotal', 'money', 'Entries Total'], ['salary', 'money', 'Salary'], ['lessGeneric', 'money', 'Less Generic'], ['net', 'money', 'Net Balance'],
  ],
  petty: [
    ['period', 'text', 'Period'], ['desc', 'text', 'Description'], ['amount', 'money', 'Amount'],
  ],
  incentive: [
    ['month', 'text', 'Month'], ['saleVal', 'money', 'Sale Value'], ['genSale', 'money', 'Generic Sale'],
    ['pilferage', 'money', 'Pilferage'], ['unapproved', 'money', 'Unapproved'], ['tillShort', 'money', 'Till Short'],
    ['cashTarget', 'money', 'Cash Target'], ['excessFine', 'money', 'Excess Fine'], ['plusFine', 'money', 'Plus Fine'],
    ['paperFine', 'money', 'Paper Fine'], ['panelFine', 'money', 'Panel Fine'], ['tax', 'money', 'Tax'],
  ],
  unmatched: [
    ['date', 'text', 'Date'], ['name', 'text', 'Name'], ['amount', 'money', 'Amount'],
    ['shift', 'text', 'Shift'], ['desc', 'text', 'Note'], ['resolved', 'text', 'Resolved'],
  ],
  inventory: [
    ['code', 'text', 'Code'], ['name', 'text', 'Item'], ['qty', 'num', 'Qty'], ['price', 'money', 'Price'],
    ['company', 'text', 'Company'], ['generic', 'text', 'Generic'], ['supplier', 'text', 'Supplier'], ['conversionFactor', 'num', 'Pack Size'],
  ],
  stockledger_raw: [
    ['code', 'text', 'Code'], ['name', 'text', 'Item'], ['stock', 'num', 'Stock'], ['unitPrice', 'money', 'Unit Price'],
    ['company', 'text', 'Company'], ['supplier', 'text', 'Supplier'], ['netQty90Days', 'num', 'Sold /90d'],
  ],
  stockledger_excess: [
    ['code', 'text', 'Code'], ['name', 'text', 'Item'], ['company', 'text', 'Company'], ['stock', 'num', 'Stock'],
    ['net100', 'num', 'Sold /90d'], ['target100', 'num', 'Target 100d Stock'], ['excessQty', 'num', 'Excess Qty'],
    ['unitPrice', 'money', 'Unit Price'], ['excessValue', 'money', 'Excess Value'],
  ],
  reorder: [
    ['code', 'text', 'Code'], ['name', 'text', 'Item'], ['supplier', 'text', 'Supplier'], ['company', 'text', 'Company'],
    ['stock', 'num', 'Stock'], ['unitPrice', 'money', 'Unit Price'], ['saleQtyP', 'num', 'Sold (window)'],
    ['daysCoverP', 'num', 'Days Cover'], ['demandQtyP', 'num', 'Reorder Qty'], ['demandValueP', 'money', 'Reorder Value'],
  ],
};

// The one place that knows how to pull each table's actual rows.
// Every source is defensive about its data not existing yet (module
// never loaded that month/page this session, bridge not populated,
// etc.) — always returns [] rather than throwing, same convention
// StockLedgerApp.getRawRows()/getExcessRows() already use.
function _nsSourceRows(id) {
  switch (id) {
    case 'monthly': return (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY.slice().reverse() : [];
    case 'daily':   return (typeof DAILY !== 'undefined' && DAILY) ? DAILY.slice().sort((a, b) => (b.Date || '') > (a.Date || '') ? 1 : -1) : [];
    case 'staff':   return (typeof STAFF !== 'undefined' && STAFF) ? STAFF : [];

    case 'salary':
      return (_salRows_cur || []).map(r => Object.assign({}, r, { net: _salNet(r) }));
    case 'generic':
      return (_genRows_cur || []).map(r => Object.assign({}, r, { incentive: _genIncentive(r), final: _genFinal(r) }));
    case 'credit':
      return (_crdData_cur || []).map(e => ({
        name: e.name, prevBal: e.prevBal,
        entriesCount: (e.entries || []).length,
        entriesTotal: (e.entries || []).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
        salary: e.salary, lessGeneric: e.lessGeneric, net: _crdNet(e),
      }));
    case 'petty': {
      const out = [];
      ((_pettyData && _pettyData.groups) || []).forEach(g => {
        (g.rows || []).forEach(r => { if (r.desc || r.amount) out.push({ period: g.period || '', desc: r.desc || '', amount: r.amount || 0 }); });
      });
      return out;
    }
    case 'incentive':
      return (_incMonth && _incData && Object.keys(_incData).length) ? [Object.assign({ month: _incMonth }, _incData)] : [];
    case 'unmatched':
      return ((unmatchedLoad().entries) || []).filter(e => !e.resolved);

    case 'inventory': {
      const d = _invGetFullData();
      return (d && d.products) || [];
    }
    case 'stockledger_raw':
      return (window.StockLedgerApp && typeof window.StockLedgerApp.getRawRows === 'function') ? window.StockLedgerApp.getRawRows() : [];
    case 'stockledger_excess':
      return (window.StockLedgerApp && typeof window.StockLedgerApp.getExcessRows === 'function') ? window.StockLedgerApp.getExcessRows() : [];
    case 'reorder':
      return (window.ReorderReportApp && typeof window.ReorderReportApp.getFlaggedRows === 'function') ? window.ReorderReportApp.getFlaggedRows() : [];

    default: return [];
  }
}

var _nsDataDomain = 'sales';
var _nsDataSource = 'monthly';
var _nsDataSearch = '';

function _nsSetDataDomain(v) {
  _nsDataDomain = v;
  const dom = _NS_DOMAINS.find(d => d.id === v);
  _nsDataSource = dom ? dom.sources[0] : _nsDataSource;
  _nsRenderPanel();
} // inline onchange/oninput can't assign a module-scoped var directly (see file header)
function _nsSetDataSource(v) { _nsDataSource = v; _nsRenderPanel(); }
function _nsSetDataSearch(v) { _nsDataSearch = v; _nsRenderPanel(); }

function _nsRenderData(host) {
  const dom = _NS_DOMAINS.find(d => d.id === _nsDataDomain) || _NS_DOMAINS[0];
  const domainOpts = _NS_DOMAINS.map(d => `<option value="${d.id}" ${d.id === _nsDataDomain ? 'selected' : ''}>${d.label}</option>`).join('');
  const sourceOpts = dom.sources.map(id => `<option value="${id}" ${id === _nsDataSource ? 'selected' : ''}>${_NS_SOURCE_META[id].label}</option>`).join('');
  const meta = _NS_SOURCE_META[_nsDataSource] || {};
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="ns-data-toolbar">
        <select class="ns-data-select" onchange="_nsSetDataDomain(this.value)">${domainOpts}</select>
        <select class="ns-data-select" onchange="_nsSetDataSource(this.value)">${sourceOpts}</select>
        <input class="ns-search-box" style="flex:1;min-width:100px" placeholder="Filter…"
          value="${_nsEsc(_nsDataSearch)}"
          oninput="_nsSetDataSearch(this.value)">
        <button class="ns-btn" onclick="_nsSendToSheets()">📥 Send to Sheets</button>
        <button class="ns-btn" onclick="_nsExportDataXLSX()">⬇ XLSX</button>
      </div>
      ${meta.hint ? `<div class="ns-data-hint">ℹ️ ${_nsEsc(meta.hint)}</div>` : ''}
      <div class="ns-data-table-wrap" id="ns-data-table-host"></div>
    </div>`;
  _nsRenderDataTable();
}

function _nsFmt(v) { const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n).toLocaleString('en-PK'); }
function _nsCell(v, type) {
  if (type === 'money') { const n = parseFloat(v); return (!isNaN(n) && n !== 0) ? '₨' + _nsFmt(n) : _nsEsc(v || ''); }
  if (type === 'num')   { const n = parseFloat(v); return !isNaN(n) ? _nsFmt(n) : _nsEsc(v || ''); }
  return _nsEsc(v == null ? '' : v);
}

// Shared by the on-screen table, XLSX export, and Send to Sheets — the
// on-screen table caps at 300 rows for DOM size, the other two go up to
// 5000 (a sane ceiling so a runaway table can't hang the browser).
function _nsFilteredRows(cap) {
  const q = _nsDataSearch.toLowerCase();
  let rows = _nsSourceRows(_nsDataSource);
  if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  return typeof cap === 'number' ? rows.slice(0, cap) : rows;
}

function _nsRenderDataTable() {
  const host = document.getElementById('ns-data-table-host');
  if (!host) return;
  const cols = _NS_SOURCE_COLS[_nsDataSource] || [];
  const meta = _NS_SOURCE_META[_nsDataSource] || {};
  const fullCount = _nsFilteredRows().length;
  const rows = _nsFilteredRows(300);
  if (!rows.length) {
    host.innerHTML = `<div class="ns-empty"><div class="ns-empty-icon">${meta.icon || '📄'}</div><div class="ns-empty-title">${_nsEsc(meta.empty || 'No data')}</div></div>`;
    return;
  }
  const th = cols.map(c => `<th>${_nsEsc(c[2] || c[0])}</th>`).join('');
  const trs = rows.map(r => '<tr>' + cols.map(c => `<td>${_nsCell(r[c[0]], c[1])}</td>`).join('') + '</tr>').join('');
  host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  if (fullCount > rows.length) {
    host.insertAdjacentHTML('beforeend', `<div class="ns-data-more-hint">Showing first ${rows.length} of ${fullCount} rows — use 📥 Send to Sheets or ⬇ XLSX for the full set.</div>`);
  }
}

function _nsExportDataXLSX() {
  const cols = _NS_SOURCE_COLS[_nsDataSource] || [];
  const rows = _nsFilteredRows(5000);
  if (!rows.length) { if (typeof toast === 'function') toast('⚠ No data to export.', 'w'); return; }
  if (typeof XLSX === 'undefined') { if (typeof toast === 'function') toast('⚠ Excel export library failed to load.', 'w'); return; }
  const aoa = [cols.map(c => c[2] || c[0]), ...rows.map(r => cols.map(c => r[c[0]] !== undefined ? r[c[0]] : ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, _nsDataSource.slice(0, 31));
  XLSX.writeFile(wb, _nsDataSource + '-export.xlsx');
  if (typeof toast === 'function') toast('✅ XLSX exported.');
}

// Materializes whatever the Data tab is currently showing (filtered,
// full set up to 5000 rows) into a timestamped tab in the designated
// "App Data" Google Sheet — independent of any one source's
// live-binding caveats above, since once sent it's a snapshot, safe to
// keep even after the source month changes in Manager.
// See js/sheets-app.js → sheetsPushRows / _saGetOrCreateAppDataSheet.
function _nsSendToSheets() {
  const cols = _NS_SOURCE_COLS[_nsDataSource] || [];
  const meta = _NS_SOURCE_META[_nsDataSource] || {};
  const rows = _nsFilteredRows(5000);
  if (!rows.length) { if (typeof toast === 'function') toast('⚠ No data to send — nothing loaded for this table.', 'w'); return; }

  const sheetName = (meta.label || _nsDataSource).replace(/^\S+\s/, ''); // strip the leading emoji for a clean tab name
  const headerRow = cols.map(c => String(c[2] || c[0]));
  const dataRows = rows.map(r => cols.map(c => {
    const raw = r[c[0]];
    return (raw !== undefined && raw !== null) ? String(raw) : '';
  }));

  if (typeof sheetsPushRows !== 'function') {
    if (typeof toast === 'function') toast('⚠ Sheets integration not loaded — check js/sheets-app.js', 'w');
    return;
  }
  sheetsPushRows(sheetName, headerRow, dataRows).then(result => {
    if (result) _nsSetPanel('sheets');
  });
}

/* renderNotesSheets() is called directly from manager-page.js's
   switchMgrTab() now — see that file. This used to instead
   monkey-patch `switchMgrTab` from here, which was the reason this
   file (and manager-page.js, and jazz-cash.js) had to stay classic
   scripts; see manager-page.js's header comment for the full history
   of why that's no longer necessary. */

// ── Window bridge ────────────────────────────────────────────────
// renderNotesSheets: called by manager-page.js as a bare identifier.
// The rest: called from this file's own generated HTML via inline
// onclick/onchange/oninput, which always runs in global scope, so a
// plain module-scoped function declaration is invisible to it without
// this bridge.
window._nsCloseEditor = _nsCloseEditor;
window._nsDeleteNote = _nsDeleteNote;
window._nsExportDataXLSX = _nsExportDataXLSX;
window._nsSendToSheets = _nsSendToSheets;
window._nsSetDataDomain = _nsSetDataDomain;
window._nsNewNote = _nsNewNote;
window._nsOpenNote = _nsOpenNote;
window._nsSaveNote = _nsSaveNote;
window._nsSetDataSearch = _nsSetDataSearch;
window._nsSetDataSource = _nsSetDataSource;
window._nsSetNoteSearch = _nsSetNoteSearch;
window._nsSetPanel = _nsSetPanel;
window._nsTogglePin = _nsTogglePin;
window.renderNotesSheets = renderNotesSheets;
