/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  NOTES & SHEETS  —  BT Sales App  ·  Phase 6 (Full Spreadsheet)     ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║  Three sub-panels:                                                   ║
 * ║   📝 Notes  — rich notepad with pinned notes, tags, search           ║
 * ║   📊 Sheets — Google Sheets-quality grid with ribbon & formulas      ║
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
 * global: (1) manager-page.js calls renderNotesSheets() directly, and
 * a handful of other classic scripts call a few Sheets-file functions
 * (see the bridge list at the bottom for exactly which); (2) this
 * file's own generated HTML — 2700+ lines of it — dispatches almost
 * everything through inline onclick/onchange/oninput attributes, which
 * always execute in global scope regardless of where the HTML came
 * from. Found and fixed 6 real bugs this conversion would otherwise
 * have introduced: _nsMgsSearch/_nsMgsSort/_nsMgsGroup/_nsNoteSearch/
 * _nsDataSource/_nsDataSearch were all assigned directly from inline
 * handlers (e.g. `onchange="_nsDataSource=this.value;..."`), which
 * would have silently created disconnected `window.*` globals instead
 * of updating this module's own state, once top-level `var` stopped
 * being implicitly global. Each now routes through a small setter
 * function instead (`_nsSetDataSource`, etc.) — same pattern as
 * jazz-cash.js's `_jcSelectTallyDate`, added for the same reason.
 */

import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { STAFF, MONTHLY, DAILY } from './config.js';

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

/* ─── Sheets Panel ────────────────────────────────────────────────── */
.ns-sp { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fff; }

/* Ribbon */
.ns-ribbon-tabs {
  display: flex; gap: 0; background: #f1f3f4; border-bottom: 1px solid #dadce0;
  flex-shrink: 0; overflow-x: auto; scrollbar-width: none;
}
.ns-ribbon-tabs::-webkit-scrollbar { display: none; }
.ns-rtab {
  padding: 7px 14px; font-size: 11.5px; font-weight: 500; color: #444;
  cursor: pointer; border: none; background: transparent; white-space: nowrap;
  border-bottom: 2px solid transparent; transition: all .15s;
}
.ns-rtab.active { color: #1a73e8; border-bottom-color: #1a73e8; background: #fff; }
.ns-rtab:hover:not(.active) { background: #e8eaed; }

.ns-ribbon-bar {
  display: flex; align-items: center; gap: 2px; padding: 4px 6px;
  background: #fff; border-bottom: 1px solid #dadce0; flex-shrink: 0;
  overflow-x: auto; scrollbar-width: none; min-height: 36px;
}
.ns-ribbon-bar::-webkit-scrollbar { display: none; }
.ns-rb-sep { width: 1px; background: #dadce0; height: 22px; margin: 0 3px; flex-shrink: 0; }
.ns-rb-btn {
  display: flex; align-items: center; justify-content: center;
  min-width: 28px; height: 28px; border-radius: 4px; border: none;
  background: transparent; cursor: pointer; font-size: 12px; padding: 0 5px;
  color: #444; transition: background .12s; white-space: nowrap; flex-shrink: 0;
}
.ns-rb-btn:hover { background: #f1f3f4; }
.ns-rb-btn.active { background: #d2e3fc; color: #1a73e8; }
.ns-rb-btn:disabled { opacity: .4; cursor: default; }
.ns-rb-select {
  height: 26px; border: 1px solid #dadce0; border-radius: 4px;
  font-size: 11.5px; padding: 0 4px; background: #fff; color: #444;
  cursor: pointer; outline: none; flex-shrink: 0;
}
.ns-rb-input {
  height: 26px; border: 1px solid #dadce0; border-radius: 4px;
  font-size: 11.5px; padding: 0 6px; width: 38px; text-align: center; outline: none;
}
.ns-rb-input:focus { border-color: #1a73e8; }

/* Formula bar */
.ns-fbar {
  display: flex; align-items: center; border-bottom: 1px solid #dadce0;
  background: #fff; flex-shrink: 0; min-height: 30px;
}
.ns-fbar-ref {
  width: 72px; flex-shrink: 0; text-align: center; font-size: 12px;
  font-weight: 600; color: #444; border-right: 1px solid #dadce0;
  padding: 4px 6px; font-family: 'Courier New', monospace;
}
.ns-fbar-fx { color: #1a73e8; font-size: 13px; font-weight: 700; padding: 4px 8px; flex-shrink: 0; font-style: italic; }
.ns-fbar-input {
  flex: 1; border: none; outline: none; font-size: 12px; padding: 4px 6px;
  font-family: inherit; color: #202124; background: transparent;
}

/* Grid */
.ns-grid-outer { flex: 1; overflow: auto; position: relative; min-height: 0; }
.ns-grid-table { border-collapse: collapse; table-layout: fixed; user-select: none; }
.ns-grid-table * { box-sizing: border-box; }

/* Corner / Column headers */
.ns-col-hdr, .ns-corner {
  position: sticky; top: 0; z-index: 3;
  background: #f8f9fa; border: 1px solid #e0e0e0;
  font-size: 11px; font-weight: 600; color: #666;
  text-align: center; padding: 3px 2px; white-space: nowrap;
  user-select: none; cursor: default;
}
.ns-corner { left: 0; z-index: 4; min-width: 40px; width: 40px; }
.ns-col-hdr { min-width: 80px; }
.ns-col-hdr.selected { background: #d2e3fc; color: #1a73e8; }

/* Row headers */
.ns-row-hdr {
  position: sticky; left: 0; z-index: 2;
  background: #f8f9fa; border: 1px solid #e0e0e0;
  font-size: 11px; color: #666; text-align: center;
  padding: 0 4px; min-width: 40px; width: 40px;
  user-select: none; cursor: default; white-space: nowrap;
}
.ns-row-hdr.selected { background: #d2e3fc; color: #1a73e8; }

/* Cells */
.ns-cell {
  border: 1px solid #e0e0e0; padding: 0; min-width: 80px;
  height: 22px; max-height: 22px; position: relative; cursor: cell;
}
.ns-cell.selected-range { background: #e8f0fe !important; }
.ns-cell.selected { outline: 2px solid #1a73e8; outline-offset: -2px; z-index: 1; }
.ns-cell.formula-cell { background: #f0fdf4 !important; }
.ns-cell-inner {
  display: block; width: 100%; height: 100%; padding: 2px 4px;
  font-size: 12px; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; line-height: 18px;
  font-family: inherit; color: #202124;
}
.ns-cell.wrap-cell { height: auto; max-height: none; white-space: normal; }
.ns-cell.wrap-cell .ns-cell-inner { white-space: normal; word-break: break-word; overflow: visible; }
.ns-cell-edit {
  position: absolute; inset: -1px; z-index: 10;
  border: 2px solid #1a73e8; outline: none;
  font-size: 12px; font-family: inherit; padding: 2px 4px;
  background: #fff; resize: none; overflow: hidden;
  min-height: 22px; line-height: 18px;
}

/* Sheet tabs */
.ns-sheet-tabs-bar {
  display: flex; align-items: center; background: #f1f3f4;
  border-top: 1px solid #dadce0; flex-shrink: 0; min-height: 34px;
  overflow-x: auto; scrollbar-width: none; padding: 0 6px; gap: 2px;
}
.ns-sheet-tabs-bar::-webkit-scrollbar { display: none; }
.ns-stab {
  padding: 5px 14px; font-size: 12px; font-weight: 500;
  border-radius: 4px 4px 0 0; border: 1px solid transparent;
  cursor: pointer; white-space: nowrap; color: #666;
  background: transparent; transition: all .12s; flex-shrink: 0;
}
.ns-stab.active { background: #fff; color: #1a73e8; border-color: #dadce0; border-bottom-color: #fff; font-weight: 600; }
.ns-stab:hover:not(.active) { background: #e8eaed; }
.ns-stab-add {
  padding: 4px 10px; font-size: 16px; color: #666; cursor: pointer;
  border: none; background: transparent; border-radius: 4px; flex-shrink: 0;
}
.ns-stab-add:hover { background: #e8eaed; }

/* ─── Sheet File Manager ──────────────────────────────────────────── */
.ns-sfm-overlay {
  position: fixed; inset: 0; z-index: 19000;
  background: rgba(15,23,42,.5); backdrop-filter: blur(3px);
  display: flex; align-items: flex-end; justify-content: center;
}
.ns-sfm-panel {
  width: 100%; max-width: 600px; max-height: 85vh;
  background: var(--s1,#fff); border-radius: 18px 18px 0 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.ns-sfm-header {
  display: flex; align-items: center; padding: 16px 16px 10px;
  border-bottom: 1px solid var(--border); gap: 8px; flex-shrink: 0;
}
.ns-sfm-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text); }
.ns-sfm-list { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.ns-sfm-card {
  background: var(--s2,#f8fafc); border: 1.5px solid var(--border);
  border-radius: 10px; padding: 12px 14px;
  display: flex; align-items: center; gap: 10px; transition: border-color .15s;
}
.ns-sfm-card:hover { border-color: #1a73e8; }
.ns-sfm-card-icon { font-size: 22px; flex-shrink: 0; }
.ns-sfm-card-body { flex: 1; min-width: 0; }
.ns-sfm-card-name { font-size: 13px; font-weight: 700; color: var(--text); }
.ns-sfm-card-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
.ns-sfm-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
.ns-sfm-btn {
  padding: 5px 12px; border-radius: 7px; border: 1.5px solid var(--border);
  background: var(--s1,#fff); font-size: 11.5px; font-weight: 600;
  color: var(--text); cursor: pointer; white-space: nowrap;
}
.ns-sfm-btn.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.ns-sfm-btn.danger  { color: #dc2626; border-color: #fca5a5; background: #fff5f5; }
.ns-sfm-empty { text-align: center; padding: 40px 20px; color: var(--muted); }

/* ─── Manage Sheets Panel (full section) ─────────────────────────── */
.ns-mgs { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ns-mgs-toolbar {
  display: flex; gap: 6px; padding: 10px 12px; flex-wrap: wrap; align-items: center;
  background: var(--s1,#fff); border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.ns-mgs-select {
  padding: 7px 10px; border-radius: 8px; border: 1.5px solid var(--border);
  background: var(--s2); color: var(--text); font-size: 12px; font-weight: 600; outline: none;
}
.ns-mgs-stats { font-size: 11px; color: var(--muted); padding: 4px 12px 0; flex-shrink: 0; }
.ns-mgs-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.ns-mgs-group { margin-bottom: 14px; }
.ns-mgs-group-head {
  display: flex; align-items: center; gap: 8px; padding: 6px 4px; cursor: pointer;
  font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em;
}
.ns-mgs-group-head .chev { transition: transform .15s; font-size: 10px; }
.ns-mgs-group-head.collapsed .chev { transform: rotate(-90deg); }
.ns-mgs-group-count {
  background: var(--s2); border-radius: 10px; padding: 1px 8px; font-size: 10.5px; color: var(--text);
}
.ns-mgs-grid {
  display: flex; flex-direction: column; gap: 8px;
}
.ns-mgs-card {
  background: var(--s1,#fff); border: 1.5px solid var(--border); border-radius: 10px;
  padding: 12px 14px; display: flex; align-items: center; gap: 12px; transition: border-color .15s, box-shadow .15s;
}
.ns-mgs-card:hover { border-color: #1a73e8; box-shadow: 0 2px 12px rgba(37,99,235,.08); }
.ns-mgs-card.ns-mgs-card-active { border-color: #16a34a; background: #f0fdf4; }
.ns-mgs-card-icon { font-size: 24px; flex-shrink: 0; }
.ns-mgs-card-body { flex: 1; min-width: 0; }
.ns-mgs-card-name { font-size: 13.5px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ns-mgs-card-meta { font-size: 11px; color: var(--muted); margin-top: 3px; }
.ns-mgs-card-tag {
  display: inline-block; font-size: 9.5px; font-weight: 700; padding: 1px 7px;
  border-radius: 10px; background: #eff6ff; color: #1d4ed8;
}
.ns-mgs-card-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.ns-mgs-btn {
  padding: 5px 11px; border-radius: 7px; border: 1.5px solid var(--border);
  background: var(--s2,#f8fafc); font-size: 11px; font-weight: 600;
  color: var(--text); cursor: pointer; white-space: nowrap;
}
.ns-mgs-btn:hover { background: var(--border); }
.ns-mgs-btn.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.ns-mgs-btn.danger  { color: #dc2626; border-color: #fca5a5; background: #fff5f5; }
.ns-mgs-search {
  flex: 1; min-width: 140px; padding: 7px 10px; border-radius: 8px;
  border: 1.5px solid var(--border); font-size: 13px; background: var(--s2); color: var(--text); outline: none;
}
.ns-mgs-search:focus { border-color: var(--accent); }

/* Context menu */
.ns-ctx {
  position: fixed; z-index: 20000; background: #fff;
  border: 1px solid #dadce0; border-radius: 6px;
  box-shadow: 0 4px 20px rgba(0,0,0,.18); padding: 4px 0; min-width: 180px;
}
.ns-ctx-item {
  padding: 8px 16px; font-size: 13px; color: #202124;
  cursor: pointer; display: flex; align-items: center; gap: 8px;
}
.ns-ctx-item:hover { background: #f1f3f4; }
.ns-ctx-sep { height: 1px; background: #e0e0e0; margin: 3px 0; }
.ns-ctx-item.danger { color: #d93025; }

/* Sort dialog */
.ns-sort-dlg {
  position: fixed; inset: 0; z-index: 20000; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center;
}
.ns-sort-inner {
  background: #fff; border-radius: 10px; padding: 20px;
  width: 300px; box-shadow: 0 8px 30px rgba(0,0,0,.2);
}

/* Data panel */
.ns-data-toolbar { display: flex; gap: 8px; padding: 10px 12px; background: var(--s1,#fff); border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; align-items: center; }
.ns-data-select { padding: 6px 10px; border-radius: 8px; border: 1.5px solid var(--border); background: var(--s2); font-size: 12px; color: var(--text); outline: none; }
.ns-data-table-wrap { flex: 1; overflow: auto; }
.ns-data-table { border-collapse: collapse; min-width: 100%; font-size: 12px; }
.ns-data-table th { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 10px; border: 1px solid #2d4a6f; position: sticky; top: 0; white-space: nowrap; }
.ns-data-table td { padding: 5px 10px; border: 1px solid var(--border); color: var(--text); font-size: 12px; white-space: nowrap; }
.ns-data-table tr:nth-child(even) td { background: var(--s2); }
.ns-data-table tr:hover td { background: #eff6ff; }

@media print {
  body > *:not(#ns-print-frame) { display: none !important; }
  #ns-print-frame { display: block !important; }
}
`;
  document.head.appendChild(el);
})();

/* ══════════════════════════════════════════════════════════════════════
   STORAGE

   V2 plan §5 — multi-sheet workbook model. Before this: ONE global set
   of sheet-tabs shared by the whole app (bt_sheets_v2), plus a
   completely separate "Sheet Files" snapshot list (bt_sheet_files_v1)
   where each entry was a flat, point-in-time copy of a single sheet's
   cells — loading one *destructively overwrote* whatever was currently
   on screen. Neither was "one file, many named sheets."

   Now: bt_sheet_workbooks_v1 holds { activeFileId, files } — each file
   is its own independent workbook with its own `grids` dict and its
   own sheet-tabs, using the exact same grid shape (and exact same
   sheet-tab CRUD functions — _nsSpAddSheet/_nsSpSwitchSheet/etc. — all
   below, completely unchanged) that already worked before this. Only
   the storage underneath them changed: _nsGetSheets()/_nsSheetsSave()
   keep their old signature (a bare {grids} object) but now read/write
   the ACTIVE FILE's grids instead of one global set, so none of the
   ~15 call sites that already used them needed to change.

   Old keys (bt_sheets_v2, bt_sheet_files_v1) are read once for
   migration and never written again — nothing is deleted, they stay as
   an untouched safety net.
══════════════════════════════════════════════════════════════════════ */
const NS_NOTES_KEY      = 'bt_notes_v1';
const NS_SHEETS_KEY     = 'bt_sheets_v2';       // legacy — read-only now, migration source
const NS_SHEET_FILES_KEY = 'bt_sheet_files_v1'; // legacy — read-only now, migration source
const NS_WORKBOOKS_KEY  = 'bt_sheet_workbooks_v1';

function _nsNotesLoad()  { try { return JSON.parse(Repository.getItem(NS_NOTES_KEY) || '[]'); } catch(_){ return []; } }
function _nsNotesSave(a) {
  try { Actions.saveNotes(JSON.stringify(a)); } catch(_){}
  if (Repository.getItem('bt_auto_save') === '1' && typeof pushToSupabase === 'function') pushToSupabase();
}
function _nsUid()        { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function _nsDefaultGrid(name) {
  return {
    id: _nsUid(), name,
    numRows: 100, numCols: 26,
    colWidths: {},
    cells: {}
  };
}

/* ── Workbook (file) storage — the new home for everything ─────────── */
function _nsWBLoadRaw() {
  try { return JSON.parse(Repository.getItem(NS_WORKBOOKS_KEY) || '{}'); } catch(_) { return {}; }
}
function _nsWBSaveRaw(o) { try { Actions.saveSheetWorkbooks(JSON.stringify(o)); } catch(_) {} }

// One-time, lossless migration. Runs at most once per install: once
// bt_sheet_workbooks_v1 has any files in it, this returns immediately.
function _nsWBMigrate() {
  const wb = _nsWBLoadRaw();
  if (wb.files && Object.keys(wb.files).length) return wb;

  const files = {};
  let activeFileId = null;

  // 1) The old single global workbook becomes the first file, keeping
  //    every existing sheet/tab exactly as it was.
  let oldSheets = null;
  try { oldSheets = JSON.parse(Repository.getItem(NS_SHEETS_KEY) || 'null'); } catch(_) {}
  if (oldSheets && oldSheets.grids && Object.keys(oldSheets.grids).length) {
    const fid = _nsUid();
    files[fid] = {
      id: fid, name: 'My Workbook', category: 'General',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      grids: oldSheets.grids,
      activeSheet: Object.keys(oldSheets.grids)[0],
    };
    activeFileId = fid;
  }

  // 2) Each old "Sheet File" snapshot becomes its own one-sheet file.
  let oldFiles = [];
  try { oldFiles = JSON.parse(Repository.getItem(NS_SHEET_FILES_KEY) || '[]'); } catch(_) {}
  oldFiles.forEach(f => {
    const gid = _nsUid();
    const grid = {
      id: gid, name: f.sheetName || 'Sheet 1',
      numRows: f.numRows || 100, numCols: f.numCols || 26,
      colWidths: f.colWidths || {}, cells: f.cells || {},
    };
    const fid = _nsUid();
    files[fid] = {
      id: fid, name: f.name || 'Untitled', category: f.category || f.sheetName || 'General',
      createdAt: f.createdAt || new Date().toISOString(),
      updatedAt: f.updatedAt || f.createdAt || new Date().toISOString(),
      grids: { [gid]: grid },
      activeSheet: gid,
    };
    if (!activeFileId) activeFileId = fid;
  });

  // 3) Brand new install, nothing to migrate — bootstrap one empty file.
  if (!Object.keys(files).length) {
    const gid = _nsUid(), fid = _nsUid();
    files[fid] = {
      id: fid, name: 'My Workbook', category: 'General',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      grids: { [gid]: _nsDefaultGrid('Sheet 1') },
      activeSheet: gid,
    };
    activeFileId = fid;
  }

  const result = { activeFileId, files };
  _nsWBSaveRaw(result);
  return result;
}

function _nsWBActiveFile() {
  const wb = _nsWBMigrate();
  let f = wb.files[wb.activeFileId];
  if (!f) { // stale/missing pointer — fall back to the first available file
    const firstId = Object.keys(wb.files)[0];
    wb.activeFileId = firstId;
    f = wb.files[firstId];
    _nsWBSaveRaw(wb);
  }
  return f;
}

function _nsWBList() { return Object.values(_nsWBMigrate().files); }

function _nsWBSheetCount(f) { return Object.keys(f.grids || {}).length; }
function _nsWBCellCount(f)  { return Object.values(f.grids || {}).reduce((s,g) => s + _nsSFCountCells(g.cells), 0); }

/* ── Bridges: every existing sheet-tab function below (grids CRUD, cell
   edit, formulas — everything that already worked) still calls these
   two exactly as before; they just now operate on the active file's
   grids instead of one global set. ── */
function _nsGetSheets() {
  const f = _nsWBActiveFile();
  if (!f.grids || !Object.keys(f.grids).length) {
    const g = _nsDefaultGrid('Sheet 1');
    f.grids = { [g.id]: g };
    f.activeSheet = g.id;
    _nsSheetsSave({ grids: f.grids });
  }
  return { grids: f.grids };
}
function _nsSheetsSave(s) {
  const wb = _nsWBLoadRaw();
  const f = wb.files && wb.files[wb.activeFileId];
  if (!f) return;
  f.grids = s.grids;
  f.activeSheet = _spState.activeSheet || f.activeSheet;
  f.updatedAt = new Date().toISOString();
  _nsWBSaveRaw(wb);
}

// Manage Sheets panel state
var _nsMgsSort   = (Repository.getItem('bt_mgs_sort')  || 'created_desc');
var _nsMgsGroup  = (Repository.getItem('bt_mgs_group') || 'category');
var _nsMgsSearch = '';
var _nsMgsCollapsed = {};
// Setters for the three vars above — inline onchange/oninput handlers in
// the generated HTML below can't assign these module-scoped vars
// directly and have it stick (that HTML runs in global scope; a bare
// assignment would silently create a disconnected window.* global
// instead). Route through these instead. See jazz-cash.js's
// _jcSelectTallyDate for the same pattern with the same reasoning.
function _nsSetMgsSearch(v, host) { _nsMgsSearch = v; _nsRenderManage(host); }
function _nsSetMgsSort(v, host)   { _nsMgsSort = v; Actions.saveFeatureData('bt_mgs_sort', v); _nsRenderManage(host); }
function _nsSetMgsGroup(v, host)  { _nsMgsGroup = v; Actions.saveFeatureData('bt_mgs_group', v); _nsRenderManage(host); }
function _nsEsc(s)       { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ══════════════════════════════════════════════════════════════════════
   MAIN RENDERER
══════════════════════════════════════════════════════════════════════ */
var _nsActivePanel = 'notes';
var _nsActiveSheet = null;

function renderNotesSheets() {
  const host = document.getElementById('mgr-sheets');
  if (!host) return;
  host.innerHTML = `
    <div class="ns-shell">
      <div class="ns-nav">
        <button class="ns-pill ${_nsActivePanel==='notes'?'active':''}" data-panel="notes" onclick="_nsSetPanel('notes')">📝 Notes</button>
        <button class="ns-pill ${_nsActivePanel==='sheets'?'active':''}" data-panel="sheets" onclick="_nsSetPanel('sheets')">📊 Sheets</button>
        <button class="ns-pill ${_nsActivePanel==='manage'?'active':''}" data-panel="manage" onclick="_nsSetPanel('manage')">🗂 Manage Sheets</button>
        <button class="ns-pill ${_nsActivePanel==='data'?'active':''}" data-panel="data" onclick="_nsSetPanel('data')">🔗 Live Data</button>
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
  if (_nsActivePanel === 'sheets') _nsSpBuild(host);
  if (_nsActivePanel === 'manage') _nsRenderManage(host);
  if (_nsActivePanel === 'data')   _nsRenderData(host);
}

/* ══════════════════════════════════════════════════════════════════════
   NOTES PANEL  (unchanged from original)
══════════════════════════════════════════════════════════════════════ */
var _nsNoteSearch = '';
function _nsSetNoteSearch(v) { _nsNoteSearch = v; _nsRenderPanel(); } // see _nsSetMgsSearch for why this indirection is needed

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

/* ══════════════════════════════════════════════════════════════════════
   FORMULA ENGINE  — supports 40+ functions
══════════════════════════════════════════════════════════════════════ */
function _nsEvalFormula(formula, getCellRaw) {
  // getCellRaw(col0, row0) => raw string value for that cell
  try {
    const expr = formula.slice(1).trim();
    return _nsParseExpr(expr, getCellRaw);
  } catch(e) {
    return '#ERR';
  }
}

function _nsParseExpr(expr, getCR) {
  expr = expr.trim();

  // String literal
  if (expr.startsWith('"') && expr.endsWith('"')) return expr.slice(1, -1);

  // Function call: NAME(args)
  const fnMatch = expr.match(/^([A-Z_][A-Z0-9_]*)(\(.*\))$/s);
  if (fnMatch) {
    return _nsCallFn(fnMatch[1], fnMatch[2].slice(1, -1), getCR);
  }

  // Binary operators: lowest precedence first (& concat, comparisons, +-, */, ^)
  const result = _nsEvalOp(expr, getCR);
  if (result !== undefined) return result;

  // Cell reference: A1, Z99
  const cellRef = expr.match(/^([A-Z]+)(\d+)$/i);
  if (cellRef) {
    const ci = _nsColIndex(cellRef[1]);
    const ri = parseInt(cellRef[2], 10) - 1;
    const v = getCR(ri, ci);
    const n = parseFloat(v);
    return isNaN(n) ? v : n;
  }

  // Number
  const n = parseFloat(expr);
  if (!isNaN(n)) return n;

  return '#ERR';
}

function _nsEvalOp(expr, getCR) {
  // Find lowest-precedence binary operator outside parens/quotes
  const ops = [
    ['&'],
    ['=', '<>', '<=', '>=', '<', '>'],
    ['+', '-'],
    ['*', '/'],
    ['^']
  ];
  for (const group of ops) {
    for (const op of group) {
      const pos = _nsFindOpOutside(expr, op);
      if (pos !== -1) {
        const L = _nsParseExpr(expr.slice(0, pos).trim(), getCR);
        const R = _nsParseExpr(expr.slice(pos + op.length).trim(), getCR);
        if (op === '+') return (parseFloat(L)||0) + (parseFloat(R)||0);
        if (op === '-') return (parseFloat(L)||0) - (parseFloat(R)||0);
        if (op === '*') return (parseFloat(L)||0) * (parseFloat(R)||0);
        if (op === '/') { const d = parseFloat(R)||0; return d === 0 ? '#DIV/0!' : (parseFloat(L)||0) / d; }
        if (op === '^') return Math.pow(parseFloat(L)||0, parseFloat(R)||0);
        if (op === '&') return String(L===null||L===undefined?'':L) + String(R===null||R===undefined?'':R);
        if (op === '=')  return (String(L) === String(R)) ? 1 : 0;
        if (op === '<>') return (String(L) !== String(R)) ? 1 : 0;
        if (op === '<=') return (parseFloat(L)||0) <= (parseFloat(R)||0) ? 1 : 0;
        if (op === '>=') return (parseFloat(L)||0) >= (parseFloat(R)||0) ? 1 : 0;
        if (op === '<')  return (parseFloat(L)||0) <  (parseFloat(R)||0) ? 1 : 0;
        if (op === '>')  return (parseFloat(L)||0) >  (parseFloat(R)||0) ? 1 : 0;
      }
    }
  }
  // Parenthesized expression
  if (expr.startsWith('(') && expr.endsWith(')')) {
    return _nsParseExpr(expr.slice(1, -1), getCR);
  }
  // Unary minus
  if (expr.startsWith('-')) {
    return -(parseFloat(_nsParseExpr(expr.slice(1), getCR))||0);
  }
  return undefined;
}

function _nsFindOpOutside(expr, op) {
  let depth = 0, inStr = false;
  // Search from right for left-assoc, or left for right-assoc (^)
  const start = op === '^' ? 0 : expr.length - op.length;
  const step  = op === '^' ? 1 : -1;
  for (let i = start; op === '^' ? i <= expr.length - op.length : i >= 0; i += step) {
    const ch = expr[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === ')') depth++;
    if (ch === '(') depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      // Make sure it's not part of a longer op like >= when looking for >
      const after = expr[i + op.length];
      if (op === '<' && (after === '>' || after === '=')) continue;
      if (op === '>' && after === '=') continue;
      if (op === '=' && expr[i-1] === '<' ) continue;
      if (op === '=' && expr[i-1] === '>' ) continue;
      if (op === '-' && i === 0) continue; // unary minus
      return i;
    }
  }
  return -1;
}

function _nsColIndex(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + col.toUpperCase().charCodeAt(i) - 64;
  return n - 1;
}

function _nsColLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

// Parse a range like A1:B5 and return [[ri,ci], ...] cells
function _nsRangeCells(rangeStr) {
  const m = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const r1 = parseInt(m[2],10)-1, c1 = _nsColIndex(m[1]);
  const r2 = parseInt(m[4],10)-1, c2 = _nsColIndex(m[3]);
  const cells = [];
  for (let r = Math.min(r1,r2); r <= Math.max(r1,r2); r++)
    for (let c = Math.min(c1,c2); c <= Math.max(c1,c2); c++)
      cells.push([r, c]);
  return cells;
}

function _nsCallFn(name, argsStr, getCR) {
  // Split args respecting parens and quotes
  const args = _nsSplitTopArgs(argsStr);
  const fn = name.toUpperCase();

  // Helper to resolve value (number or string)
  function resolve(a) { return _nsParseExpr(a.trim(), getCR); }
  function resolveNum(a) { const v = resolve(a); return parseFloat(v)||0; }
  function resolveStr(a) { const v = resolve(a); return v===null||v===undefined?'':String(v); }

  // Collect numeric values from range or individual cells
  function numsFrom(a) {
    a = a.trim();
    // Range
    const rc = _nsRangeCells(a);
    if (rc) return rc.map(([r,c]) => parseFloat(getCR(r,c))).filter(n => !isNaN(n));
    // Single cell
    const cm = a.match(/^([A-Z]+)(\d+)$/i);
    if (cm) { const v = parseFloat(getCR(parseInt(cm[2],10)-1, _nsColIndex(cm[1]))); return isNaN(v)?[]:[v]; }
    // Number literal
    const n = parseFloat(a); return isNaN(n) ? [] : [n];
  }
  function rawsFrom(a) {
    a = a.trim();
    const rc = _nsRangeCells(a);
    if (rc) return rc.map(([r,c]) => getCR(r,c));
    const cm = a.match(/^([A-Z]+)(\d+)$/i);
    if (cm) return [getCR(parseInt(cm[2],10)-1, _nsColIndex(cm[1]))];
    return [a];
  }

  switch(fn) {
    case 'SUM':         return args.reduce((s,a) => s + numsFrom(a).reduce((x,y)=>x+y, 0), 0);
    case 'AVERAGE': case 'AVG': { const all = args.flatMap(numsFrom); return all.length ? all.reduce((a,b)=>a+b,0)/all.length : 0; }
    case 'MIN':         { const all = args.flatMap(numsFrom); return all.length ? Math.min(...all) : 0; }
    case 'MAX':         { const all = args.flatMap(numsFrom); return all.length ? Math.max(...all) : 0; }
    case 'COUNT':       return args.flatMap(numsFrom).length;
    case 'COUNTA':      return args.flatMap(rawsFrom).filter(v => v !== '' && v !== null && v !== undefined).length;
    case 'COUNTIF': {
      if (args.length < 2) return 0;
      const vals = rawsFrom(args[0]);
      const crit = resolveStr(args[1]);
      const m = crit.match(/^([<>]=?|<>)(.*)$/);
      return vals.filter(v => {
        if (m) {
          const n = parseFloat(v), c = parseFloat(m[2]);
          if (m[1]==='>')  return n > c;
          if (m[1]==='>=') return n >= c;
          if (m[1]==='<')  return n < c;
          if (m[1]==='<=') return n <= c;
          if (m[1]==='<>') return String(v) !== m[2];
        }
        return String(v).toLowerCase() === crit.toLowerCase();
      }).length;
    }
    case 'ROUND':     { const n = resolveNum(args[0]||'0'), d = args[1]!==undefined?parseInt(resolveNum(args[1]),10):0; const f=Math.pow(10,d); return Math.round(n*f)/f; }
    case 'ROUNDUP':   { const n = resolveNum(args[0]||'0'), d = args[1]!==undefined?parseInt(resolveNum(args[1]),10):0; const f=Math.pow(10,d); return Math.ceil(n*f)/f; }
    case 'ROUNDDOWN': { const n = resolveNum(args[0]||'0'), d = args[1]!==undefined?parseInt(resolveNum(args[1]),10):0; const f=Math.pow(10,d); return Math.floor(n*f)/f; }
    case 'ABS':       return Math.abs(resolveNum(args[0]||'0'));
    case 'SQRT':      return Math.sqrt(resolveNum(args[0]||'0'));
    case 'POWER':     return Math.pow(resolveNum(args[0]||'0'), resolveNum(args[1]||'0'));
    case 'MOD':       { const b = resolveNum(args[1]||'1'); return b===0?'#DIV/0!':resolveNum(args[0]||'0')%b; }
    case 'INT':       return Math.floor(resolveNum(args[0]||'0'));
    case 'CEILING':   { const n = resolveNum(args[0]||'0'), s = resolveNum(args[1]||'1'); return Math.ceil(n/s)*s; }
    case 'FLOOR':     { const n = resolveNum(args[0]||'0'), s = resolveNum(args[1]||'1'); return Math.floor(n/s)*s; }
    case 'TRUNC':     return Math.trunc(resolveNum(args[0]||'0'));
    case 'PI':        return Math.PI;
    case 'RAND':      return Math.random();
    case 'RANDBETWEEN': return Math.floor(Math.random()*(resolveNum(args[1]||'1')-resolveNum(args[0]||'0')+1)) + (resolveNum(args[0]||'0'));

    case 'LEFT':      { const s=resolveStr(args[0]), n=args[1]?parseInt(resolveNum(args[1])):1; return s.slice(0,n); }
    case 'RIGHT':     { const s=resolveStr(args[0]), n=args[1]?parseInt(resolveNum(args[1])):1; return s.slice(-n); }
    case 'MID':       { const s=resolveStr(args[0]), st=parseInt(resolveNum(args[1]))-1, n=parseInt(resolveNum(args[2])); return s.slice(st,st+n); }
    case 'LEN':       return resolveStr(args[0]).length;
    case 'UPPER':     return resolveStr(args[0]).toUpperCase();
    case 'LOWER':     return resolveStr(args[0]).toLowerCase();
    case 'PROPER':    return resolveStr(args[0]).replace(/\w\S*/g, w => w[0].toUpperCase()+w.slice(1).toLowerCase());
    case 'TRIM':      return resolveStr(args[0]).trim().replace(/\s+/g, ' ');
    case 'SUBSTITUTE':{ const s=resolveStr(args[0]), old=resolveStr(args[1]), rep=resolveStr(args[2]); return s.split(old).join(rep); }
    case 'REPLACE':   { const s=resolveStr(args[0]), st=parseInt(resolveNum(args[1]))-1, n=parseInt(resolveNum(args[2])), rep=resolveStr(args[3]); return s.slice(0,st)+rep+s.slice(st+n); }
    case 'FIND': case 'SEARCH': { const needle=resolveStr(args[0]).toLowerCase(), hay=resolveStr(args[1]).toLowerCase(); const p=hay.indexOf(needle); return p===-1?'#VALUE!':p+1; }
    case 'CONCATENATE': case 'CONCAT': return args.map(a => resolveStr(a)).join('');
    case 'TEXT':       { const n=resolveNum(args[0]), fmt=resolveStr(args[1]); if(fmt.includes('%')){return (n*100).toFixed(0)+'%';} if(fmt.includes('0.00')){return n.toFixed(2);} return n.toLocaleString(); }
    case 'VALUE':      return parseFloat(resolveStr(args[0]))||0;
    case 'REPT':       return resolveStr(args[0]).repeat(parseInt(resolveNum(args[1]))||0);

    case 'IF': {
      const cond = resolve(args[0]||'0');
      const condBool = cond && cond !== '0' && cond !== 0 && cond !== 'FALSE' && cond !== false;
      return resolve(condBool ? (args[1]||'') : (args[2]||''));
    }
    case 'IFS': {
      for (let i = 0; i < args.length - 1; i += 2) {
        const c = resolve(args[i]);
        if (c && c !== '0' && c !== 0) return resolve(args[i+1]);
      }
      return '#N/A';
    }
    case 'AND': return args.every(a => { const v=resolve(a); return v && v!=='0' && v!==0; }) ? 1 : 0;
    case 'OR':  return args.some(a =>  { const v=resolve(a); return v && v!=='0' && v!==0; }) ? 1 : 0;
    case 'NOT': { const v=resolveNum(args[0]||'0'); return v?0:1; }
    case 'IFERROR': { try { const v=resolve(args[0]); return (String(v).startsWith('#'))?resolve(args[1]||''):v; } catch(e){ return resolve(args[1]||''); } }
    case 'ISBLANK': { const v=rawsFrom(args[0]||'')[0]; return (v===''||v===null||v===undefined)?1:0; }
    case 'ISNUMBER': { const v=resolve(args[0]||''); return !isNaN(parseFloat(v))&&v!==''?1:0; }
    case 'ISTEXT':   { const v=resolve(args[0]||''); return (isNaN(parseFloat(v))||v==='')?1:0; }

    case 'VLOOKUP': {
      if (args.length < 3) return '#N/A';
      const lookVal = String(resolve(args[0])||'').toLowerCase();
      const tableRange = args[1].trim();
      const colIdx = parseInt(resolveNum(args[2]))-1;
      const exact = args[3] ? resolveNum(args[3])===0 : true;
      const rc = _nsRangeCells(tableRange);
      if (!rc) return '#N/A';
      const rows = {};
      rc.forEach(([r,c]) => { if (!rows[r]) rows[r]=[]; rows[r].push([r,c]); });
      for (const r of Object.keys(rows).map(Number).sort((a,b)=>a-b)) {
        const firstCell = rows[r][0];
        const cellVal = String(getCR(firstCell[0], firstCell[1])||'').toLowerCase();
        if (exact ? cellVal===lookVal : cellVal.includes(lookVal)) {
          const targetCell = rows[r][colIdx];
          return targetCell ? getCR(targetCell[0], targetCell[1]) : '#N/A';
        }
      }
      return '#N/A';
    }

    case 'TODAY': { const d=new Date(); return d.toLocaleDateString('en-PK'); }
    case 'NOW':   { return new Date().toLocaleString('en-PK'); }
    case 'DATE':  { const y=parseInt(resolveNum(args[0])),m=parseInt(resolveNum(args[1]))-1,d=parseInt(resolveNum(args[2])); return new Date(y,m,d).toLocaleDateString('en-PK'); }
    case 'YEAR':  { const d=new Date(resolveStr(args[0])); return isNaN(d)?'#VALUE!':d.getFullYear(); }
    case 'MONTH': { const d=new Date(resolveStr(args[0])); return isNaN(d)?'#VALUE!':d.getMonth()+1; }
    case 'DAY':   { const d=new Date(resolveStr(args[0])); return isNaN(d)?'#VALUE!':d.getDate(); }
    case 'DAYS':  { const d1=new Date(resolveStr(args[0])), d2=new Date(resolveStr(args[1])); return Math.round((d1-d2)/(864e5)); }

    case 'SUMIF': {
      if (args.length < 2) return 0;
      const rangeVals = rawsFrom(args[0]);
      const crit = resolveStr(args[1]);
      const sumVals = args[2] ? rawsFrom(args[2]) : rangeVals;
      const m = crit.match(/^([<>]=?|<>)(.*)$/);
      let total = 0;
      rangeVals.forEach((v, i) => {
        let match;
        if (m) {
          const n = parseFloat(v), c = parseFloat(m[2]);
          if (m[1]==='>')  match = n > c;
          else if (m[1]==='>=') match = n >= c;
          else if (m[1]==='<')  match = n < c;
          else if (m[1]==='<=') match = n <= c;
          else if (m[1]==='<>') match = String(v) !== m[2];
        } else { match = String(v).toLowerCase() === crit.toLowerCase(); }
        if (match && sumVals[i]) total += parseFloat(sumVals[i])||0;
      });
      return total;
    }

    default: return '#NAME?';
  }
}

function _nsSplitTopArgs(str) {
  const args = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur !== '') args.push(cur);
  return args;
}

/* ══════════════════════════════════════════════════════════════════════
   SPREADSHEET STATE
══════════════════════════════════════════════════════════════════════ */
var _spState = {
  activeSheet: null,
  selR: 0, selC: 0,           // active cell
  selR2: 0, selC2: 0,         // selection end (for range)
  selMode: false,              // mouse down
  editMode: false,
  ribbonTab: 'home',
  clipboard: null,             // { cells:{}, r1,c1,r2,c2, cut:bool }
  undoStack: [],
  redoStack: [],
  colWidths: {},               // cache
};

/* ══════════════════════════════════════════════════════════════════════
   SPREADSHEET BUILDER
══════════════════════════════════════════════════════════════════════ */
function _nsSpBuild(host) {
  const s = _nsGetSheets();
  const ids = Object.keys(s.grids);
  if (!_spState.activeSheet || !s.grids[_spState.activeSheet]) _spState.activeSheet = ids[0];
  const activeFile = _nsWBActiveFile();

  host.innerHTML = `<div class="ns-sp" id="ns-sp-root">
    <div onclick="_nsSFOpenManager()" title="Switch file" style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text,#1e293b);cursor:pointer;user-select:none;border-bottom:1px solid var(--border,#e2e8f0)">
      📁 <strong>${_nsEsc(activeFile.name)}</strong> <span style="opacity:.6">▾</span>
    </div>
    <div id="ns-ribbon-tabs" class="ns-ribbon-tabs"></div>
    <div id="ns-ribbon-bar" class="ns-ribbon-bar"></div>
    <div class="ns-fbar">
      <div class="ns-fbar-ref" id="ns-fbar-ref">A1</div>
      <div class="ns-fbar-fx">fx</div>
      <input class="ns-fbar-input" id="ns-fbar-input" placeholder="Enter a formula or value" autocomplete="off" spellcheck="false">
    </div>
    <div class="ns-grid-outer" id="ns-grid-outer"></div>
    <div class="ns-sheet-tabs-bar" id="ns-sheet-tabs-bar"></div>
  </div>`;

  _nsSpRenderRibbonTabs();
  _nsSpRenderRibbon();
  _nsSpRenderGrid();
  _nsSpRenderSheetTabs();
  _nsSpBindFormulaBar();
}

function _nsSpGetGrid() {
  return _nsGetSheets().grids[_spState.activeSheet];
}

// FLOOR 4 — pure helper: normalizes the current selection's row/col range
// (handles selecting bottom-to-top or right-to-left). Previously this exact
// 2-line calculation was copy-pasted in 4 different functions
// (_nsSpDeleteSelection, _nsSpCopy, _nsSpApplyFmt, _nsSpClearFmt) — any fix
// to the selection logic would have needed updating all 4 by hand.
function _nsSpSelRange() {
  return {
    r1: Math.min(_spState.selR, _spState.selR2), r2: Math.max(_spState.selR, _spState.selR2),
    c1: Math.min(_spState.selC, _spState.selC2), c2: Math.max(_spState.selC, _spState.selC2),
  };
}

function _nsSpCellKey(r, c) { return r + ',' + c; }

function _nsSpGetCell(grid, r, c) {
  return grid.cells[_nsSpCellKey(r,c)] || {};
}

function _nsSpSetCell(r, c, patch) {
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  const key = _nsSpCellKey(r, c);
  g.cells[key] = Object.assign({}, g.cells[key] || {}, patch);
  // Clean up empty cells
  const cell = g.cells[key];
  if ((cell.v === '' || cell.v === undefined || cell.v === null) &&
      !cell.b && !cell.i && !cell.u && !cell.fg && !cell.bg && !cell.ha && !cell.wrap && !cell.numFmt) {
    delete g.cells[key];
  }
  _nsSheetsSave(s);
}

// Evaluate a cell's display value
function _nsSpEvalCell(grid, r, c) {
  const cell = _nsSpGetCell(grid, r, c);
  const raw = cell.v !== undefined ? String(cell.v) : '';
  if (!raw.startsWith('=')) return _nsSpFormatValue(raw, cell.numFmt);
  const getCR = (ri, ci) => {
    const rc = _nsSpGetCell(grid, ri, ci);
    return rc.v !== undefined ? String(rc.v) : '';
  };
  const result = _nsEvalFormula(raw, getCR);
  const resultStr = (result === null || result === undefined) ? '' : String(result);
  return _nsSpFormatValue(resultStr, cell.numFmt);
}

function _nsSpFormatValue(v, numFmt) {
  if (!numFmt || v === '' || v === null) return v;
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  if (numFmt === 'number')   return n.toLocaleString('en-PK');
  if (numFmt === 'currency') return '₨' + n.toLocaleString('en-PK', {minimumFractionDigits:2,maximumFractionDigits:2});
  if (numFmt === 'percent')  return (n * 100).toFixed(1) + '%';
  if (numFmt === 'decimal2') return n.toFixed(2);
  return v;
}

/* ─── Grid Rendering ─────────────────────────────────────────────── */
function _nsSpRenderGrid() {
  const outer = document.getElementById('ns-grid-outer');
  if (!outer) return;
  const grid = _nsSpGetGrid();
  if (!grid) return;

  const nRows = grid.numRows || 100;
  const nCols = grid.numCols || 26;

  let html = '<table class="ns-grid-table" id="ns-grid-table">';

  // Header row
  html += '<tr>';
  html += `<th class="ns-corner" id="ns-corner" onclick="_nsSpSelectAll()"></th>`;
  for (let c = 0; c < nCols; c++) {
    const w = (grid.colWidths && grid.colWidths[c]) || 80;
    html += `<th class="ns-col-hdr" data-col="${c}" style="width:${w}px;min-width:${w}px" onclick="_nsSpSelectCol(${c})">${_nsColLetter(c)}</th>`;
  }
  html += '</tr>';

  // Data rows
  for (let r = 0; r < nRows; r++) {
    html += `<tr id="ns-row-${r}">`;
    html += `<td class="ns-row-hdr" data-row="${r}" onclick="_nsSpSelectRow(${r})">${r+1}</td>`;
    for (let c = 0; c < nCols; c++) {
      html += _nsSpCellHTML(grid, r, c);
    }
    html += '</tr>';
  }
  html += '</table>';
  outer.innerHTML = html;

  // Bind events
  outer.addEventListener('mousedown', _nsSpMouseDown, true);
  outer.addEventListener('mouseover', _nsSpMouseOver, true);
  outer.addEventListener('mouseup',   _nsSpMouseUp, true);
  outer.addEventListener('dblclick',  _nsSpDblClick, true);
  outer.addEventListener('contextmenu', _nsSpContextMenu, true);
  document.addEventListener('keydown', _nsSpKeyDown, true);

  _nsSpUpdateSelection();
  _nsSpScrollToCell(_spState.selR, _spState.selC);
}

function _nsSpCellHTML(grid, r, c) {
  const cell = _nsSpGetCell(grid, r, c);
  const raw  = cell.v !== undefined ? String(cell.v) : '';
  const disp = _nsSpEvalCell(grid, r, c);
  const isFormula = raw.startsWith('=');
  const w = (grid.colWidths && grid.colWidths[c]) || 80;

  let style = `width:${w}px;min-width:${w}px;`;
  if (cell.fg)  style += `color:${cell.fg};`;
  if (cell.bg)  style += `background:${cell.bg};`;
  const ha = cell.ha || (isNaN(parseFloat(disp)) || disp==='' ? 'left' : 'right');
  style += `text-align:${ha};`;
  if (cell.b) style += 'font-weight:700;';
  if (cell.i) style += 'font-style:italic;';
  if (cell.u) style += 'text-decoration:underline;';
  const cls = `ns-cell${isFormula?' formula-cell':''}${cell.wrap?' wrap-cell':''}`;

  return `<td class="${cls}" data-r="${r}" data-c="${c}" id="ns-c-${r}-${c}" style="${style}" title="${_nsEsc(raw)}">
    <span class="ns-cell-inner" style="${cell.wrap?'white-space:normal;':''}">${_nsEsc(disp)}</span>
  </td>`;
}

function _nsSpRefreshCell(r, c) {
  const td = document.getElementById(`ns-c-${r}-${c}`);
  if (!td) return;
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const cell = _nsSpGetCell(grid, r, c);
  const raw  = cell.v !== undefined ? String(cell.v) : '';
  const disp = _nsSpEvalCell(grid, r, c);
  const isFormula = raw.startsWith('=');
  const w = (grid.colWidths && grid.colWidths[c]) || 80;

  let style = `width:${w}px;min-width:${w}px;`;
  if (cell.fg)  style += `color:${cell.fg};`;
  if (cell.bg)  style += `background:${cell.bg};`;
  const ha = cell.ha || (isNaN(parseFloat(disp)) || disp==='' ? 'left' : 'right');
  style += `text-align:${ha};`;
  if (cell.b) style += 'font-weight:700;';
  if (cell.i) style += 'font-style:italic;';
  if (cell.u) style += 'text-decoration:underline;';

  td.className = `ns-cell${isFormula?' formula-cell':''}${cell.wrap?' wrap-cell':''}`;
  td.style.cssText = style;
  td.title = raw;
  const inner = td.querySelector('.ns-cell-inner');
  if (inner) { inner.textContent = disp; if (cell.wrap) inner.style.whiteSpace = 'normal'; }
  _nsSpUpdateSelection();
}

function _nsSpRefreshAllCells() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  Object.keys(grid.cells).forEach(key => {
    const [r,c] = key.split(',').map(Number);
    _nsSpRefreshCell(r, c);
  });
  // Also refresh cells with formulas that depend on others
  const nRows = grid.numRows || 100;
  const nCols = grid.numCols || 26;
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) {
    const cell = _nsSpGetCell(grid, r, c);
    if (cell.v && String(cell.v).startsWith('=')) _nsSpRefreshCell(r, c);
  }
}

/* ─── Selection ──────────────────────────────────────────────────── */
function _nsSpUpdateSelection() {
  // Clear old
  document.querySelectorAll('.ns-cell.selected,.ns-cell.selected-range').forEach(el => {
    el.classList.remove('selected','selected-range');
  });
  document.querySelectorAll('.ns-col-hdr.selected,.ns-row-hdr.selected').forEach(el => {
    el.classList.remove('selected');
  });

  const r1 = Math.min(_spState.selR, _spState.selR2);
  const r2 = Math.max(_spState.selR, _spState.selR2);
  const c1 = Math.min(_spState.selC, _spState.selC2);
  const c2 = Math.max(_spState.selC, _spState.selC2);

  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const td = document.getElementById(`ns-c-${r}-${c}`);
      if (td) td.classList.add(r===_spState.selR&&c===_spState.selC ? 'selected' : 'selected-range');
    }
  }

  // Update formula bar
  const ref = _nsColLetter(_spState.selC) + (_spState.selR + 1);
  const refEl = document.getElementById('ns-fbar-ref');
  if (refEl) refEl.textContent = ref;

  const grid = _nsSpGetGrid();
  const cell = grid ? _nsSpGetCell(grid, _spState.selR, _spState.selC) : {};
  const fbarInput = document.getElementById('ns-fbar-input');
  if (fbarInput && !_spState.editMode) fbarInput.value = cell.v !== undefined ? String(cell.v) : '';

  // Update ribbon state indicators
  _nsSpUpdateRibbonState();
}

function _nsSpSetSel(r, c, extend) {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const maxR = (grid.numRows||100) - 1;
  const maxC = (grid.numCols||26) - 1;
  r = Math.max(0, Math.min(r, maxR));
  c = Math.max(0, Math.min(c, maxC));
  if (extend) {
    _spState.selR2 = r;
    _spState.selC2 = c;
  } else {
    _spState.selR = r; _spState.selC = c;
    _spState.selR2 = r; _spState.selC2 = c;
  }
  _nsSpUpdateSelection();
}

function _nsSpSelectAll() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  _spState.selR = 0; _spState.selC = 0;
  _spState.selR2 = (grid.numRows||100)-1;
  _spState.selC2 = (grid.numCols||26)-1;
  _nsSpUpdateSelection();
}

function _nsSpSelectRow(r) {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  _spState.selR = r; _spState.selC = 0;
  _spState.selR2 = r; _spState.selC2 = (grid.numCols||26)-1;
  _nsSpUpdateSelection();
}

function _nsSpSelectCol(c) {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  _spState.selR = 0; _spState.selC = c;
  _spState.selR2 = (grid.numRows||100)-1; _spState.selC2 = c;
  _nsSpUpdateSelection();
}

function _nsSpScrollToCell(r, c) {
  const td = document.getElementById(`ns-c-${r}-${c}`);
  if (td && td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ─── Mouse Events ───────────────────────────────────────────────── */
function _nsSpMouseDown(e) {
  const td = e.target.closest('[data-r]');
  if (!td) return;
  const r = parseInt(td.dataset.r), c = parseInt(td.dataset.c);
  if (_spState.editMode) _nsSpCommitEdit();
  if (e.shiftKey) {
    _nsSpSetSel(r, c, true);
  } else {
    _nsSpSetSel(r, c, false);
    _spState.selMode = true;
  }
  e.preventDefault();
}

function _nsSpMouseOver(e) {
  if (!_spState.selMode) return;
  const td = e.target.closest('[data-r]');
  if (!td) return;
  _nsSpSetSel(parseInt(td.dataset.r), parseInt(td.dataset.c), true);
}

function _nsSpMouseUp(e) { _spState.selMode = false; }

function _nsSpDblClick(e) {
  const td = e.target.closest('[data-r]');
  if (!td) return;
  const r = parseInt(td.dataset.r), c = parseInt(td.dataset.c);
  _nsSpSetSel(r, c, false);
  _nsSpStartEdit(r, c);
}

/* ─── Keyboard Events ────────────────────────────────────────────── */
function _nsSpKeyDown(e) {
  // Only handle when sheets panel is visible
  if (!document.getElementById('ns-sp-root')) return;
  if (_nsActivePanel !== 'sheets') return;

  const grid = _nsSpGetGrid();
  if (!grid) return;
  const maxR = (grid.numRows||100)-1;
  const maxC = (grid.numCols||26)-1;

  if (_spState.editMode) {
    if (e.key === 'Escape') { _nsSpCancelEdit(); e.stopPropagation(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      _nsSpCommitEdit();
      _nsSpSetSel(Math.min(_spState.selR+1, maxR), _spState.selC, false);
      _nsSpScrollToCell(_spState.selR, _spState.selC);
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (e.key === 'Tab') {
      _nsSpCommitEdit();
      if (e.shiftKey) _nsSpSetSel(_spState.selR, Math.max(_spState.selC-1,0), false);
      else            _nsSpSetSel(_spState.selR, Math.min(_spState.selC+1,maxC), false);
      _nsSpScrollToCell(_spState.selR, _spState.selC);
      e.preventDefault(); e.stopPropagation(); return;
    }
    return; // let edit input handle everything else
  }

  // Navigation
  const navKeys = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (navKeys[e.key]) {
    const [dr, dc] = navKeys[e.key];
    const nr = Math.max(0,Math.min(_spState.selR+dr, maxR));
    const nc = Math.max(0,Math.min(_spState.selC+dc, maxC));
    _nsSpSetSel(nr, nc, e.shiftKey);
    _nsSpScrollToCell(_spState.selR, _spState.selC);
    e.preventDefault(); return;
  }
  if (e.key === 'Tab') {
    if (e.shiftKey) _nsSpSetSel(_spState.selR, Math.max(_spState.selC-1,0), false);
    else            _nsSpSetSel(_spState.selR, Math.min(_spState.selC+1,maxC), false);
    _nsSpScrollToCell(_spState.selR, _spState.selC);
    e.preventDefault(); return;
  }
  if (e.key === 'Enter') {
    _nsSpStartEdit(_spState.selR, _spState.selC);
    e.preventDefault(); return;
  }
  if (e.key === 'F2') {
    _nsSpStartEdit(_spState.selR, _spState.selC);
    e.preventDefault(); return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    _nsSpDeleteSelection();
    e.preventDefault(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { _nsSpCopy(false); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'x') { _nsSpCopy(true);  e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') { _nsSpPaste();     e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { _nsSpUndo();      e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') { _nsSpRedo();      e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Home') { _nsSpSetSel(0,0,false); _nsSpScrollToCell(0,0); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'End') { _nsSpSetSel(maxR,maxC,false); e.preventDefault(); return; }
  if (e.key === 'Home') { _nsSpSetSel(_spState.selR,0,e.shiftKey); e.preventDefault(); return; }
  if (e.key === 'End')  { _nsSpSetSel(_spState.selR,maxC,e.shiftKey); e.preventDefault(); return; }
  if (e.key === 'PageDown') { _nsSpSetSel(Math.min(_spState.selR+20,maxR),_spState.selC,e.shiftKey); e.preventDefault(); return; }
  if (e.key === 'PageUp')   { _nsSpSetSel(Math.max(_spState.selR-20,0),_spState.selC,e.shiftKey);   e.preventDefault(); return; }

  // Start typing -> begin edit
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    _nsSpStartEdit(_spState.selR, _spState.selC, e.key);
    e.preventDefault(); return;
  }
}

/* ─── Cell Editing ───────────────────────────────────────────────── */
var _spEditTA = null;
var _spEditR = -1, _spEditC = -1, _spEditOrigVal = '';

function _nsSpStartEdit(r, c, initChar) {
  if (_spState.editMode) _nsSpCommitEdit();
  const td = document.getElementById(`ns-c-${r}-${c}`);
  if (!td) return;

  _spState.editMode = true;
  _spEditR = r; _spEditC = c;
  const grid = _nsSpGetGrid();
  const cell = _nsSpGetCell(grid, r, c);
  _spEditOrigVal = cell.v !== undefined ? String(cell.v) : '';

  const ta = document.createElement('textarea');
  ta.className = 'ns-cell-edit';
  ta.value = initChar !== undefined ? initChar : _spEditOrigVal;
  ta.id = 'ns-cell-edit';
  ta.autocomplete = 'off';
  ta.spellcheck = false;
  ta.rows = 1;
  td.appendChild(ta);
  ta.focus();
  if (initChar === undefined) ta.select();
  else { ta.setSelectionRange(ta.value.length, ta.value.length); }

  // Sync with formula bar
  ta.addEventListener('input', () => {
    const fb = document.getElementById('ns-fbar-input');
    if (fb) fb.value = ta.value;
  });

  _spEditTA = ta;
}

function _nsSpCommitEdit() {
  if (!_spState.editMode || !_spEditTA) return;
  const val = _spEditTA.value;
  _spState.editMode = false;

  // Save undo
  const grid = _nsSpGetGrid();
  const oldCell = Object.assign({}, _nsSpGetCell(grid, _spEditR, _spEditC));
  _spState.undoStack.push({ r: _spEditR, c: _spEditC, cell: oldCell });
  if (_spState.undoStack.length > 100) _spState.undoStack.shift();
  _spState.redoStack = [];

  _nsSpSetCell(_spEditR, _spEditC, { v: val });
  if (_spEditTA.parentNode) _spEditTA.parentNode.removeChild(_spEditTA);
  _spEditTA = null;
  _nsSpRefreshCell(_spEditR, _spEditC);
  _nsSpRefreshAllCells(); // refresh dependent formula cells
  _nsSpUpdateSelection();
}

function _nsSpCancelEdit() {
  if (!_spState.editMode || !_spEditTA) return;
  _spState.editMode = false;
  if (_spEditTA.parentNode) _spEditTA.parentNode.removeChild(_spEditTA);
  _spEditTA = null;
  _nsSpUpdateSelection();
}

/* ─── Formula Bar ────────────────────────────────────────────────── */
function _nsSpBindFormulaBar() {
  const input = document.getElementById('ns-fbar-input');
  const refEl = document.getElementById('ns-fbar-ref');
  if (!input) return;

  // Click name box to jump to cell
  if (refEl) refEl.addEventListener('click', () => {
    const val = prompt('Go to cell:', refEl.textContent);
    if (!val) return;
    const m = val.toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (m) { _nsSpSetSel(parseInt(m[2])-1, _nsColIndex(m[1]), false); _nsSpScrollToCell(_spState.selR, _spState.selC); }
  });

  input.addEventListener('focus', () => {
    if (!_spState.editMode) _nsSpStartEdit(_spState.selR, _spState.selC);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      _nsSpCommitEdit();
      _nsSpSetSel(Math.min(_spState.selR+1, (_nsSpGetGrid().numRows||100)-1), _spState.selC, false);
      e.preventDefault();
    }
    if (e.key === 'Escape') { _nsSpCancelEdit(); input.blur(); }
  });
  input.addEventListener('input', () => {
    if (_spEditTA) _spEditTA.value = input.value;
  });
}

/* ─── Delete / Copy / Paste / Undo ──────────────────────────────── */
function _nsSpDeleteSelection() {
  const {r1, r2, c1, c2} = _nsSpSelRange();
  const grid = _nsSpGetGrid();
  const undo = [];
  for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) {
    undo.push({ r, c, cell: Object.assign({}, _nsSpGetCell(grid, r, c)) });
    _nsSpSetCell(r, c, { v: '' });
    _nsSpRefreshCell(r, c);
  }
  _spState.undoStack.push({ batch: undo });
  _spState.redoStack = [];
  _nsSpRefreshAllCells();
}

function _nsSpCopy(cut) {
  const {r1, r2, c1, c2} = _nsSpSelRange();
  const grid = _nsSpGetGrid();
  const cells = {};
  for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) cells[_nsSpCellKey(r-r1,c-c1)] = Object.assign({}, _nsSpGetCell(grid,r,c));
  _spState.clipboard = { cells, r1, c1, r2, c2, cut };
  if (typeof toast === 'function') toast(cut ? '✂ Cut' : '📋 Copied');
}

function _nsSpPaste() {
  if (!_spState.clipboard) return;
  const { cells, cut } = _spState.clipboard;
  const dr = _spState.selR, dc = _spState.selC;
  const grid = _nsSpGetGrid();
  const undo = [];
  Object.entries(cells).forEach(([key, cell]) => {
    const [ro, co] = key.split(',').map(Number);
    const r = dr + ro, c = dc + co;
    undo.push({ r, c, cell: Object.assign({}, _nsSpGetCell(grid,r,c)) });
    _nsSpSetCell(r, c, cell);
    _nsSpRefreshCell(r, c);
  });
  if (cut) {
    // Clear source
    for (let r = _spState.clipboard.r1; r <= _spState.clipboard.r2; r++)
      for (let c = _spState.clipboard.c1; c <= _spState.clipboard.c2; c++) {
        _nsSpSetCell(r, c, { v: '' });
        _nsSpRefreshCell(r, c);
      }
    _spState.clipboard = null;
  }
  _spState.undoStack.push({ batch: undo });
  _spState.redoStack = [];
  _nsSpRefreshAllCells();
}

function _nsSpUndo() {
  const entry = _spState.undoStack.pop();
  if (!entry) return;
  const grid = _nsSpGetGrid();
  const toRedo = [];
  const items = entry.batch || [entry];
  items.forEach(({ r, c, cell }) => {
    toRedo.push({ r, c, cell: Object.assign({}, _nsSpGetCell(grid,r,c)) });
    const s = _nsGetSheets();
    const g = s.grids[_spState.activeSheet];
    const key = _nsSpCellKey(r, c);
    if (cell && (cell.v !== '' || cell.b || cell.i || cell.u || cell.fg || cell.bg)) {
      g.cells[key] = cell;
    } else {
      delete g.cells[key];
    }
    _nsSheetsSave(s);
    _nsSpRefreshCell(r, c);
  });
  _spState.redoStack.push({ batch: toRedo });
  _nsSpRefreshAllCells();
}

function _nsSpRedo() {
  const entry = _spState.redoStack.pop();
  if (!entry) return;
  const grid = _nsSpGetGrid();
  const toUndo = [];
  const items = entry.batch || [entry];
  items.forEach(({ r, c, cell }) => {
    toUndo.push({ r, c, cell: Object.assign({}, _nsSpGetCell(grid,r,c)) });
    const s = _nsGetSheets();
    const g = s.grids[_spState.activeSheet];
    const key = _nsSpCellKey(r, c);
    if (cell && (cell.v !== '' || cell.b || cell.i || cell.u || cell.fg || cell.bg)) {
      g.cells[key] = cell;
    } else {
      delete g.cells[key];
    }
    _nsSheetsSave(s);
    _nsSpRefreshCell(r, c);
  });
  _spState.undoStack.push({ batch: toUndo });
  _nsSpRefreshAllCells();
}

/* ─── Apply Formatting to Selection ──────────────────────────────── */
function _nsSpApplyFmt(patch) {
  const {r1, r2, c1, c2} = _nsSpSelRange();
  for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) {
    _nsSpSetCell(r, c, patch);
    _nsSpRefreshCell(r, c);
  }
}

function _nsSpToggleFmt(prop) {
  const grid = _nsSpGetGrid();
  const cell = _nsSpGetCell(grid, _spState.selR, _spState.selC);
  _nsSpApplyFmt({ [prop]: !cell[prop] });
  _nsSpUpdateRibbonState();
}

/* ─── Context Menu ───────────────────────────────────────────────── */
function _nsSpContextMenu(e) {
  e.preventDefault();
  _nsSpCloseCtx();
  const td = e.target.closest('[data-r]');
  if (td) {
    const r = parseInt(td.dataset.r), c = parseInt(td.dataset.c);
    if (r < Math.min(_spState.selR,_spState.selR2) || r > Math.max(_spState.selR,_spState.selR2) ||
        c < Math.min(_spState.selC,_spState.selC2) || c > Math.max(_spState.selC,_spState.selC2)) {
      _nsSpSetSel(r, c, false);
    }
  }
  const menu = document.createElement('div');
  menu.className = 'ns-ctx'; menu.id = 'ns-ctx';
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 300) + 'px';
  menu.innerHTML = `
    <div class="ns-ctx-item" onclick="_nsSpCopy(false);_nsSpCloseCtx()">📋 Copy</div>
    <div class="ns-ctx-item" onclick="_nsSpCopy(true);_nsSpCloseCtx()">✂ Cut</div>
    <div class="ns-ctx-item" onclick="_nsSpPaste();_nsSpCloseCtx()">📌 Paste</div>
    <div class="ns-ctx-sep"></div>
    <div class="ns-ctx-item" onclick="_nsSpInsertRow();_nsSpCloseCtx()">➕ Insert Row Above</div>
    <div class="ns-ctx-item" onclick="_nsSpInsertCol();_nsSpCloseCtx()">➕ Insert Column Left</div>
    <div class="ns-ctx-sep"></div>
    <div class="ns-ctx-item" onclick="_nsSpDeleteRow();_nsSpCloseCtx()">🗑 Delete Row</div>
    <div class="ns-ctx-item" onclick="_nsSpDeleteCol();_nsSpCloseCtx()">🗑 Delete Column</div>
    <div class="ns-ctx-sep"></div>
    <div class="ns-ctx-item" onclick="_nsSpClearFmt();_nsSpCloseCtx()">🧹 Clear Formatting</div>
    <div class="ns-ctx-item danger" onclick="_nsSpDeleteSelection();_nsSpCloseCtx()">✕ Clear Contents</div>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', _nsSpCloseCtx, {once:true}), 0);
}
function _nsSpCloseCtx() { const m=document.getElementById('ns-ctx'); if(m) m.remove(); }

/* ─── Row / Column Operations ────────────────────────────────────── */
function _nsSpInsertRow() {
  const ri = _spState.selR;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  const newCells = {};
  Object.entries(g.cells).forEach(([key, cell]) => {
    const [r, c] = key.split(',').map(Number);
    newCells[_nsSpCellKey(r >= ri ? r+1 : r, c)] = cell;
  });
  g.cells = newCells;
  g.numRows = (g.numRows||100) + 1;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast('✅ Row inserted');
}

function _nsSpInsertCol() {
  const ci = _spState.selC;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  const newCells = {};
  Object.entries(g.cells).forEach(([key, cell]) => {
    const [r, c] = key.split(',').map(Number);
    newCells[_nsSpCellKey(r, c >= ci ? c+1 : c)] = cell;
  });
  g.cells = newCells;
  g.numCols = (g.numCols||26) + 1;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast('✅ Column inserted');
}

function _nsSpDeleteRow() {
  const ri = _spState.selR;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g || (g.numRows||100) <= 1) return;
  const newCells = {};
  Object.entries(g.cells).forEach(([key, cell]) => {
    const [r, c] = key.split(',').map(Number);
    if (r === ri) return;
    newCells[_nsSpCellKey(r > ri ? r-1 : r, c)] = cell;
  });
  g.cells = newCells;
  g.numRows = Math.max(1, (g.numRows||100)-1);
  _nsSheetsSave(s);
  _nsSpRenderGrid();
}

function _nsSpDeleteCol() {
  const ci = _spState.selC;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g || (g.numCols||26) <= 1) return;
  const newCells = {};
  Object.entries(g.cells).forEach(([key, cell]) => {
    const [r, c] = key.split(',').map(Number);
    if (c === ci) return;
    newCells[_nsSpCellKey(r, c > ci ? c-1 : c)] = cell;
  });
  g.cells = newCells;
  g.numCols = Math.max(1, (g.numCols||26)-1);
  _nsSheetsSave(s);
  _nsSpRenderGrid();
}

function _nsSpClearFmt() {
  const {r1, r2, c1, c2} = _nsSpSelRange();
  for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) {
    _nsSpSetCell(r, c, { b:false, i:false, u:false, fg:null, bg:null, ha:null, wrap:false, numFmt:null });
    _nsSpRefreshCell(r, c);
  }
}

/* ─── Sort ───────────────────────────────────────────────────────── */
function _nsSpShowSort() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const nCols = grid.numCols || 26;
  let colOpts = '';
  for (let c=0;c<nCols;c++) colOpts += `<option value="${c}">${_nsColLetter(c)}</option>`;
  const dlg = document.createElement('div');
  dlg.className = 'ns-sort-dlg'; dlg.id = 'ns-sort-dlg';
  dlg.innerHTML = `
    <div class="ns-sort-inner">
      <div style="font-weight:700;margin-bottom:14px;font-size:15px">Sort Range</div>
      <div style="margin-bottom:10px">
        <label style="font-size:12px;display:block;margin-bottom:4px">Sort by column:</label>
        <select id="ns-sort-col" style="width:100%;padding:6px;border-radius:6px;border:1px solid #dadce0;font-size:13px">${colOpts}</select>
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:12px;display:block;margin-bottom:4px">Order:</label>
        <select id="ns-sort-order" style="width:100%;padding:6px;border-radius:6px;border:1px solid #dadce0;font-size:13px">
          <option value="asc">A → Z / 1 → 9</option>
          <option value="desc">Z → A / 9 → 1</option>
        </select>
      </div>
      <div style="margin-bottom:10px">
        <label><input type="checkbox" id="ns-sort-hdr" checked> First row is header</label>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="ns-btn" onclick="_nsSpCloseSort()">Cancel</button>
        <button class="ns-btn primary" onclick="_nsSpDoSort()">Sort</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
}
function _nsSpCloseSort() { const d=document.getElementById('ns-sort-dlg'); if(d) d.remove(); }
function _nsSpDoSort() {
  const colIdx = parseInt(document.getElementById('ns-sort-col').value);
  const order   = document.getElementById('ns-sort-order').value;
  const hasHdr  = document.getElementById('ns-sort-hdr').checked;
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const nRows = grid.numRows||100, nCols = grid.numCols||26;
  const startRow = hasHdr ? 1 : 0;

  // Extract rows as arrays of cell objects
  const rows = [];
  for (let r = startRow; r < nRows; r++) {
    const row = [];
    for (let c = 0; c < nCols; c++) row.push(Object.assign({}, _nsSpGetCell(grid, r, c)));
    // Only include rows with any data
    if (row.some(cell => cell.v !== undefined && cell.v !== '')) rows.push({ r, row });
  }

  rows.sort((a, b) => {
    const va = (a.row[colIdx]||{}).v || '';
    const vb = (b.row[colIdx]||{}).v || '';
    const na = parseFloat(va), nb = parseFloat(vb);
    let cmp;
    if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
    else cmp = String(va).localeCompare(String(vb));
    return order === 'desc' ? -cmp : cmp;
  });

  // Write sorted rows back
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  rows.forEach(({ row }, i) => {
    const targetR = startRow + i;
    row.forEach((cell, c) => {
      const key = _nsSpCellKey(targetR, c);
      if (cell.v !== undefined && cell.v !== '') g.cells[key] = cell;
      else delete g.cells[key];
    });
  });
  _nsSheetsSave(s);
  _nsSpCloseSort();
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast('✅ Sorted');
}

/* ─── Export / Print ─────────────────────────────────────────────── */
function _nsSpExportXLSX() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  _nsExportGridToXLSX(grid, grid.name || 'sheet');
}

function _nsSpPrint() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const nRows = grid.numRows||100, nCols = grid.numCols||26;
  let tbl = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:11pt;font-family:Arial">`;
  // Header
  tbl += '<tr><th></th>';
  for (let c=0;c<nCols;c++) tbl += `<th style="background:#e8f0fe;min-width:60px">${_nsColLetter(c)}</th>`;
  tbl += '</tr>';
  let lastDataRow = 0;
  for (let r=0;r<nRows;r++) {
    for (let c=0;c<nCols;c++) { if (_nsSpGetCell(grid,r,c).v) lastDataRow = r; }
  }
  for (let r=0;r<=Math.min(lastDataRow+2,nRows-1);r++) {
    tbl += `<tr><td style="background:#e8f0fe;text-align:center;font-weight:bold;padding:2px 6px">${r+1}</td>`;
    for (let c=0;c<nCols;c++) {
      const cell = _nsSpGetCell(grid,r,c);
      const disp = _nsSpEvalCell(grid,r,c);
      let sty = '';
      if (cell.b)  sty += 'font-weight:bold;';
      if (cell.i)  sty += 'font-style:italic;';
      if (cell.u)  sty += 'text-decoration:underline;';
      if (cell.fg) sty += `color:${cell.fg};`;
      if (cell.bg) sty += `background:${cell.bg};`;
      tbl += `<td style="${sty}">${_nsEsc(disp||'')}</td>`;
    }
    tbl += '</tr>';
  }
  tbl += '</table>';
  const html = `<html><head><title>${grid.name}</title><style>body{margin:20px;font-family:Arial}</style></head><body>
    <h2 style="margin-bottom:12px">${grid.name}</h2>${tbl}</body></html>`;
  // Was its own window.open()+document.write()+fixed-500ms-setTimeout
  // here — the exact "guessed fixed delay" bug class that print.js's
  // header documents fixing elsewhere, just not caught yet for Sheets
  // specifically because a plain table rarely takes long enough to lay
  // out for the guess to matter in practice. Print.renderNewTab uses
  // win.onload (+ a fallback timeout) instead, same as every other
  // new-tab report in the app now.
  Print.renderNewTab(html, { windowFeatures: 'width=900,height=700' });
}

/* ─── Ribbon ─────────────────────────────────────────────────────── */
var _nsRibbonTabs = ['home','insert','formulas','data','view','files'];

function _nsSpRenderRibbonTabs() {
  const el = document.getElementById('ns-ribbon-tabs');
  if (!el) return;
  el.innerHTML = _nsRibbonTabs.map(t =>
    `<button class="ns-rtab${_spState.ribbonTab===t?' active':''}" onclick="_nsSpSetRibbonTab('${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
  ).join('');
  // Extra: Save / File options always visible
  el.innerHTML += `
    <div style="margin-left:auto;display:flex;gap:4px;align-items:center;padding-right:6px">
      <button class="ns-rtab" onclick="_nsSpExportXLSX()" title="Export XLSX">⬇ XLSX</button>
      <button class="ns-rtab" onclick="_nsSpPrint()" title="Print">🖨 Print</button>
    </div>`;
}

function _nsSpSetRibbonTab(tab) {
  _spState.ribbonTab = tab;
  _nsSpRenderRibbonTabs();
  _nsSpRenderRibbon();
}

function _nsSpRenderRibbon() {
  const el = document.getElementById('ns-ribbon-bar');
  if (!el) return;
  el.innerHTML = _nsSpRibbonHTML(_spState.ribbonTab);
}

function _nsSpUpdateRibbonState() {
  // Just re-render ribbon to reflect current cell state
  _nsSpRenderRibbon();
}

function _nsSpRibbonHTML(tab) {
  const grid = _nsSpGetGrid();
  const cell = grid ? _nsSpGetCell(grid, _spState.selR, _spState.selC) : {};

  if (tab === 'home') {
    const bold   = cell.b ? 'active' : '';
    const italic = cell.i ? 'active' : '';
    const under  = cell.u ? 'active' : '';
    const wrapCl = cell.wrap ? 'active' : '';
    const alL = cell.ha==='left'   ? 'active' : '';
    const alC = cell.ha==='center' ? 'active' : '';
    const alR = cell.ha==='right'  ? 'active' : '';
    return `
      <button class="ns-rb-btn" onclick="_nsSpUndo()" title="Undo (Ctrl+Z)">↩</button>
      <button class="ns-rb-btn" onclick="_nsSpRedo()" title="Redo (Ctrl+Y)">↪</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn ${bold}"   onclick="_nsSpToggleFmt('b')" title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="ns-rb-btn ${italic}" onclick="_nsSpToggleFmt('i')" title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="ns-rb-btn ${under}"  onclick="_nsSpToggleFmt('u')" title="Underline (Ctrl+U)"><u>U</u></button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpPickFgColor()" title="Text Color" style="color:${cell.fg||'#222'}">A</button>
      <button class="ns-rb-btn" onclick="_nsSpPickBgColor()" title="Fill Color" style="background:${cell.bg||'#fff5c0'};border:1px solid #ccc">🎨</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn ${alL}" onclick="_nsSpApplyFmt({ha:'left'})"   title="Align Left">⬛◻◻</button>
      <button class="ns-rb-btn ${alC}" onclick="_nsSpApplyFmt({ha:'center'})" title="Center">◻⬛◻</button>
      <button class="ns-rb-btn ${alR}" onclick="_nsSpApplyFmt({ha:'right'})"  title="Align Right">◻◻⬛</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn ${wrapCl}" onclick="_nsSpToggleFmt('wrap')" title="Wrap Text">↵</button>
      <div class="ns-rb-sep"></div>
      <select class="ns-rb-select" onchange="_nsSpApplyFmt({numFmt:this.value})" title="Number Format">
        <option value="" ${!cell.numFmt?'selected':''}>General</option>
        <option value="number"   ${cell.numFmt==='number'?'selected':''}>1,000</option>
        <option value="currency" ${cell.numFmt==='currency'?'selected':''}>₨ Currency</option>
        <option value="decimal2" ${cell.numFmt==='decimal2'?'selected':''}>0.00</option>
        <option value="percent"  ${cell.numFmt==='percent'?'selected':''}>%</option>
      </select>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpInsertRow()" title="Insert Row">+Row</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertCol()" title="Insert Col">+Col</button>
      <button class="ns-rb-btn" onclick="_nsSpDeleteRow()" title="Delete Row" style="color:#c00">-Row</button>
      <button class="ns-rb-btn" onclick="_nsSpDeleteCol()" title="Delete Col" style="color:#c00">-Col</button>`;
  }

  if (tab === 'insert') {
    return `
      <button class="ns-rb-btn" onclick="_nsSpInsertRow()">➕ Row</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertCol()">➕ Column</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpInsertCurrentDate()">📅 Today's Date</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertNow()">🕐 Now</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=SUM()')">∑ SUM</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=AVERAGE()')">≈ AVG</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=COUNT()')">① COUNT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=IF(,, )')">IF…</button>`;
  }

  if (tab === 'formulas') {
    return `
      <span style="font-size:11px;color:#666;padding:0 6px">Math:</span>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=SUM()')">SUM</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=AVERAGE()')">AVERAGE</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=MIN()')">MIN</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=MAX()')">MAX</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=COUNT()')">COUNT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=ROUND(,2)')">ROUND</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=ABS()')">ABS</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=SQRT()')">SQRT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=POWER(,2)')">POWER</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=MOD(,)')">MOD</button>
      <div class="ns-rb-sep"></div>
      <span style="font-size:11px;color:#666;padding:0 6px">Logic:</span>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=IF(,,)')">IF</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=AND(,)')">AND</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=OR(,)')">OR</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=IFERROR(,\"\")')">IFERROR</button>
      <div class="ns-rb-sep"></div>
      <span style="font-size:11px;color:#666;padding:0 6px">Text:</span>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=CONCAT(,)')">CONCAT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=LEFT(,)')">LEFT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=RIGHT(,)')">RIGHT</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=LEN()')">LEN</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=UPPER()')">UPPER</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=TRIM()')">TRIM</button>
      <div class="ns-rb-sep"></div>
      <span style="font-size:11px;color:#666;padding:0 6px">Lookup:</span>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=VLOOKUP(,,,0)')">VLOOKUP</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=COUNTIF(,)')">COUNTIF</button>
      <button class="ns-rb-btn" onclick="_nsSpInsertFormula('=SUMIF(,,)')">SUMIF</button>`;
  }

  if (tab === 'data') {
    return `
      <button class="ns-rb-btn" onclick="_nsSpShowSort()">🔢 Sort…</button>
      <button class="ns-rb-btn" onclick="_nsSpAutoFit()">⟺ Auto-Fit Cols</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpFreezeFirstRow()" title="Freeze / unfreeze first row">🧊 Freeze Row 1</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpExportXLSX()">⬇ Export XLSX</button>
      <button class="ns-rb-btn" onclick="_nsSpImportXLSX()">⬆ Import XLSX</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpClearAll()" style="color:#c00">🗑 Clear Sheet</button>`;
  }

  if (tab === 'view') {
    return `
      <button class="ns-rb-btn" onclick="_nsSpAddRows(20)">+20 Rows</button>
      <button class="ns-rb-btn" onclick="_nsSpAddCols(5)">+5 Cols</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSpGoToCell()">🔍 Go To Cell</button>
      <button class="ns-rb-btn" onclick="_nsSpPrint()">🖨 Print</button>
    `;
  }

  if (tab === 'files') {
    const files = _nsSFLoad();
    return `
      <button class="ns-rb-btn primary" onclick="_nsSFSaveAs()" style="background:#1a73e8;color:#fff;border-color:#1a73e8">💾 Save As New File…</button>
      <button class="ns-rb-btn" onclick="_nsSFOverwrite()" title="Sheets save automatically as you type">✅ Autosave On</button>
      <div class="ns-rb-sep"></div>
      <button class="ns-rb-btn" onclick="_nsSFOpenManager()">📁 Switch File… <span style="background:#1a73e8;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:2px">${files.length}</span></button>
      <button class="ns-rb-btn" onclick="_nsSetPanel('manage')" title="Full file management — sort, group, export">🗂 Manage Files</button>
    `;
  }
  return '';
}

/* ─── Ribbon Actions ─────────────────────────────────────────────── */
function _nsSpPickFgColor() {
  const cur = (_nsSpGetCell(_nsSpGetGrid()||{cells:{}}, _spState.selR, _spState.selC)||{}).fg || '#000000';
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = cur.startsWith('#') ? cur : '#000000';
  inp.addEventListener('input', e => _nsSpApplyFmt({ fg: e.target.value }));
  inp.click();
}

function _nsSpPickBgColor() {
  const cur = (_nsSpGetCell(_nsSpGetGrid()||{cells:{}}, _spState.selR, _spState.selC)||{}).bg || '#ffffff';
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = cur.startsWith('#') ? cur : '#ffffff';
  inp.addEventListener('input', e => _nsSpApplyFmt({ bg: e.target.value }));
  inp.click();
}

function _nsSpInsertFormula(template) {
  _nsSpStartEdit(_spState.selR, _spState.selC, template);
  // Place cursor inside parens
  setTimeout(() => {
    if (_spEditTA) {
      const p = template.indexOf('(') + 1;
      _spEditTA.setSelectionRange(p, p);
      _spEditTA.focus();
    }
  }, 30);
}

function _nsSpInsertCurrentDate() {
  const v = new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  _nsSpSetCell(_spState.selR, _spState.selC, { v });
  _nsSpRefreshCell(_spState.selR, _spState.selC);
  _nsSpSetSel(Math.min(_spState.selR+1, (_nsSpGetGrid().numRows||100)-1), _spState.selC, false);
}

function _nsSpInsertNow() {
  const v = new Date().toLocaleString('en-PK');
  _nsSpSetCell(_spState.selR, _spState.selC, { v });
  _nsSpRefreshCell(_spState.selR, _spState.selC);
}

function _nsSpAutoFit() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  g.colWidths = g.colWidths || {};
  // Auto-fit based on content length
  for (let c=0; c<(grid.numCols||26); c++) {
    let maxLen = 2; // column letter
    for (let r=0; r<(grid.numRows||100); r++) {
      const v = _nsSpEvalCell(grid, r, c) || '';
      if (v.length > maxLen) maxLen = v.length;
    }
    g.colWidths[c] = Math.min(200, Math.max(60, maxLen * 7 + 16));
  }
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast('✅ Columns auto-fitted');
}

function _nsSpFreezeFirstRow() {
  if (typeof toast === 'function') toast('ℹ Row 1 is already sticky (column headers always visible)');
}

function _nsSpImportXLSX() {
  if (typeof XLSX === 'undefined') { if (typeof toast === 'function') toast('⚠ Excel import library failed to load.', 'w'); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx,.xls';
  inp.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const s = _nsGetSheets();
      const g = s.grids[_spState.activeSheet];
      if (!g) return;
      g.cells = {};
      rows.forEach((row, r) => {
        (row||[]).forEach((v, c) => { if (v !== '' && v !== undefined && v !== null) g.cells[_nsSpCellKey(r,c)] = { v: String(v) }; });
      });
      g.numRows = Math.max(g.numRows||100, rows.length + 10);
      _nsSheetsSave(s);
      _nsSpRenderGrid();
      if (typeof toast === 'function') toast('✅ XLSX imported: ' + rows.length + ' rows');
    };
    reader.readAsArrayBuffer(file);
  });
  inp.click();
}

function _nsSpClearAll() {
  if (!confirm('Clear all data in this sheet? This cannot be undone.')) return;
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (g) { g.cells = {}; _nsSheetsSave(s); _nsSpRenderGrid(); }
}

function _nsSpAddRows(n) {
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  g.numRows = (g.numRows||100) + n;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast(`✅ Added ${n} rows`);
}

function _nsSpAddCols(n) {
  const s = _nsGetSheets();
  const g = s.grids[_spState.activeSheet];
  if (!g) return;
  g.numCols = (g.numCols||26) + n;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  if (typeof toast === 'function') toast(`✅ Added ${n} columns`);
}

function _nsSpGoToCell() {
  const val = prompt('Go to cell (e.g. A1, C5):', _nsColLetter(_spState.selC) + (_spState.selR+1));
  if (!val) return;
  const m = val.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (m) {
    _nsSpSetSel(parseInt(m[2])-1, _nsColIndex(m[1]), false);
    _nsSpScrollToCell(_spState.selR, _spState.selC);
  }
}

/* ─── Sheet Tabs ─────────────────────────────────────────────────── */
function _nsSpRenderSheetTabs() {
  const el = document.getElementById('ns-sheet-tabs-bar');
  if (!el) return;
  const s = _nsGetSheets();
  el.innerHTML = Object.values(s.grids).map(g =>
    `<button class="ns-stab${g.id===_spState.activeSheet?' active':''}"
      onclick="_nsSpSwitchSheet('${g.id}')"
      ondblclick="_nsSpRenameSheet('${g.id}')"
      oncontextmenu="_nsSpSheetTabCtx(event,'${g.id}')">${_nsEsc(g.name)}</button>`
  ).join('');
  el.innerHTML += `<button class="ns-stab-add" onclick="_nsSpAddSheet()" title="New sheet">＋</button>`;
}

function _nsSpSwitchSheet(id) {
  if (_spState.editMode) _nsSpCommitEdit();
  _spState.activeSheet = id;
  _spState.selR = 0; _spState.selC = 0;
  _spState.selR2 = 0; _spState.selC2 = 0;
  _nsSpRenderGrid();
  _nsSpRenderSheetTabs();
}

function _nsSpAddSheet() {
  const name = prompt('New sheet name:', 'Sheet ' + (Object.keys(_nsGetSheets().grids).length + 1));
  if (!name) return;
  const s = _nsGetSheets();
  const g = _nsDefaultGrid(name);
  s.grids[g.id] = g;
  _spState.activeSheet = g.id;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  _nsSpRenderSheetTabs();
}

function _nsSpRenameSheet(id) {
  const s = _nsGetSheets();
  const g = s.grids[id];
  if (!g) return;
  const name = prompt('Rename sheet:', g.name);
  if (!name) return;
  g.name = name;
  _nsSheetsSave(s);
  _nsSpRenderSheetTabs();
}

function _nsSpSheetTabCtx(e, id) {
  e.preventDefault();
  _nsSpCloseCtx();
  const s = _nsGetSheets();
  const menu = document.createElement('div');
  menu.className = 'ns-ctx'; menu.id = 'ns-ctx';
  menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
  menu.innerHTML = `
    <div class="ns-ctx-item" onclick="_nsSpRenameSheet('${id}');_nsSpCloseCtx()">✏ Rename</div>
    <div class="ns-ctx-item" onclick="_nsSpDuplicateSheet('${id}');_nsSpCloseCtx()">📋 Duplicate</div>
    <div class="ns-ctx-item danger" onclick="_nsSpDeleteSheet('${id}');_nsSpCloseCtx()">🗑 Delete Sheet</div>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', _nsSpCloseCtx, {once:true}), 0);
}

function _nsSpDuplicateSheet(id) {
  const s = _nsGetSheets();
  const g = s.grids[id];
  if (!g) return;
  const ng = JSON.parse(JSON.stringify(g));
  ng.id = _nsUid();
  ng.name = g.name + ' (copy)';
  s.grids[ng.id] = ng;
  _spState.activeSheet = ng.id;
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  _nsSpRenderSheetTabs();
}

function _nsSpDeleteSheet(id) {
  const s = _nsGetSheets();
  const ids = Object.keys(s.grids);
  if (ids.length <= 1) { if (typeof toast === 'function') toast('⚠ Cannot delete the last sheet.','w'); return; }
  if (!confirm('Delete this sheet? All data will be lost.')) return;
  delete s.grids[id];
  _spState.activeSheet = Object.keys(s.grids)[0];
  _nsSheetsSave(s);
  _nsSpRenderGrid();
  _nsSpRenderSheetTabs();
}

/* ══════════════════════════════════════════════════════════════════════
   SHEET FILE MANAGER  (now: independent multi-sheet workbooks)

   _nsSFLoad() below returns the array form of _nsWBList() so that every
   render/search/sort function in this section — none of which cared
   whether "file" meant a flat snapshot or a real workbook — keeps
   working completely unchanged. Only the functions that actually
   create/open/delete a file were rewritten.
══════════════════════════════════════════════════════════════════════ */

function _nsSFLoad() { return _nsWBList(); }
// Bridged to window: cover-dashboard.js (already a module) and
// app-context.js (being converted) both do `typeof _nsSFLoad ===
// 'function'` — a bare-identifier check that can only ever be true in a
// classic script sharing this file's scope. Neither of those two ever
// saw it before this bridge existed, so both were silently falling back
// to a legacy storage key that stops updating once the workbook
// migration above runs. Purely additive: nothing in this file's own
// behavior changes.
window._nsSFLoad = _nsSFLoad;
// Takes the same array shape _nsSFLoad() returns and writes it back as
// the workbook dict, preserving activeFileId — this is what lets
// _nsSFRename/_nsSFEditCategory/_nsSFDuplicate below stay so close to
// their original "load array, mutate one entry, save array" shape.
function _nsSFSave(arr) {
  const wb = _nsWBLoadRaw();
  const files = {};
  arr.forEach(f => { files[f.id] = f; });
  wb.files = files;
  _nsWBSaveRaw(wb);
}

function _nsSFCountCells(cells) {
  return Object.values(cells || {}).filter(c => c.v !== undefined && c.v !== '').length;
}

function _nsSFRefreshOpenViews() {
  if (document.getElementById('ns-sfm-overlay')) _nsSFOpenManager();
  if (_nsActivePanel === 'manage') _nsRenderManage(document.getElementById('ns-panel-host'));
}

// "Save As…" — saves the CURRENT active sheet as a new, independent
// one-sheet file (a copy; the current file/sheet you're on is
// untouched and stays open). More sheets can be added to the new file
// afterward with the usual + tab button, same as any file.
function _nsSFSaveAs() {
  const grid = _nsSpGetGrid();
  if (!grid) return;
  const defaultName = grid.name + ' — ' + new Date().toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
  const name = prompt('Save current sheet as a new file:', defaultName);
  if (!name) return;
  const category = prompt('Category (used to group files in Manage Sheets):', grid.name || 'General') || (grid.name || 'General');
  const wb = _nsWBLoadRaw();
  const gid = _nsUid(), fid = _nsUid();
  wb.files = wb.files || {};
  wb.files[fid] = {
    id: fid, name, category,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    grids: {
      [gid]: {
        id: gid, name: grid.name,
        numRows: grid.numRows || 100, numCols: grid.numCols || 26,
        colWidths: Object.assign({}, grid.colWidths || {}),
        cells: JSON.parse(JSON.stringify(grid.cells || {})),
      },
    },
    activeSheet: gid,
  };
  _nsWBSaveRaw(wb);
  _nsSpRenderRibbon();
  _nsSFRefreshOpenViews();
  if (typeof toast === 'function') toast('💾 Saved as new file "' + name + '"');
}

// Sheets already autosave on every edit (same as before this feature),
// so there's no separate "overwrite" step to perform any more — this
// button now just reassures the user of that instead of doing a
// destructive snapshot-overwrite of unrelated data.
function _nsSFOverwrite() {
  if (typeof toast === 'function') toast('✅ Sheets save automatically — nothing to overwrite.');
}

// Quick-access modal (still available from the ribbon for fast
// switching); the full management experience lives in the
// "Manage Sheets" nav panel (_nsRenderManage).
function _nsSFOpenManager() {
  _nsSFCloseManager();
  const files = _nsSFLoad();
  const activeFileId = _nsWBLoadRaw().activeFileId;
  const overlay = document.createElement('div');
  overlay.className = 'ns-sfm-overlay';
  overlay.id = 'ns-sfm-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) _nsSFCloseManager(); });

  const cards = files.length ? files.map(f => {
    const updated = new Date(f.updatedAt || f.createdAt);
    const dateStr = updated.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
    const timeStr = updated.toLocaleTimeString('en-PK', { hour:'2-digit', minute:'2-digit' });
    const sheetCount = _nsWBSheetCount(f), cellCount = _nsWBCellCount(f);
    const isCurrent = f.id === activeFileId;
    return `
      <div class="ns-sfm-card${isCurrent?' ns-sfm-card-active':''}">
        <div class="ns-sfm-card-icon">📊</div>
        <div class="ns-sfm-card-body">
          <div class="ns-sfm-card-name">${_nsEsc(f.name)}${isCurrent?' <span style="font-size:10px;background:#1a73e8;color:#fff;border-radius:6px;padding:1px 6px;font-weight:500">Current</span>':''}</div>
          <div class="ns-sfm-card-meta">${sheetCount} sheet${sheetCount!==1?'s':''} &nbsp;·&nbsp; ${cellCount} cell${cellCount!==1?'s':''} &nbsp;·&nbsp; ${dateStr} ${timeStr}</div>
        </div>
        <div class="ns-sfm-card-actions">
          <button class="ns-sfm-btn primary" onclick="_nsSFLoad_('${f.id}')">Open</button>
          <button class="ns-sfm-btn" onclick="_nsSFRename('${f.id}')">✏</button>
          <button class="ns-sfm-btn danger" onclick="_nsSFDelete('${f.id}')">🗑</button>
        </div>
      </div>`;
  }).join('') : `<div class="ns-sfm-empty">
    <div style="font-size:36px;margin-bottom:10px">📁</div>
    <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">No files yet</div>
    <div style="font-size:12px;color:var(--muted)">Go to the <strong>Files</strong> ribbon tab and tap <strong>Save As…</strong> to create your first file.</div>
  </div>`;

  overlay.innerHTML = `
    <div class="ns-sfm-panel">
      <div class="ns-sfm-header">
        <span style="font-size:20px">📁</span>
        <span class="ns-sfm-title">Files</span>
        <button class="ns-sfm-btn" onclick="_nsSFSaveAs();_nsSFCloseManager();" style="background:#1a73e8;color:#fff;border-color:#1a73e8">💾 Save As…</button>
        <button class="ns-sfm-btn" onclick="_nsSFCloseManager();_nsSetPanel('manage');" title="Open the full Manage Sheets section">🗂 Manage All</button>
        <button class="ns-sfm-btn" onclick="_nsSFCloseManager()">✕</button>
      </div>
      <div class="ns-sfm-list">${cards}</div>
    </div>`;
  document.body.appendChild(overlay);
}

function _nsSFCloseManager() {
  const el = document.getElementById('ns-sfm-overlay');
  if (el) el.remove();
}

// Switches to a different file (workbook) — non-destructive. Both the
// file you're leaving and the file you're opening keep their own data;
// nothing is overwritten, so no confirm() is needed (this used to
// destructively replace the current sheet's cells — that's the whole
// gap this feature closes).
function _nsSFLoad_(id) {
  const wb = _nsWBLoadRaw();
  const f = wb.files && wb.files[id];
  if (!f) return;
  wb.activeFileId = id;
  _nsWBSaveRaw(wb);
  _spState.activeSheet = (f.activeSheet && f.grids[f.activeSheet]) ? f.activeSheet : Object.keys(f.grids)[0];
  _nsSFCloseManager();
  _nsSetPanel('sheets');
  if (typeof toast === 'function') toast('📂 Switched to "' + f.name + '"');
}

function _nsSFRename(id) {
  const files = _nsSFLoad();
  const f = files.find(x => x.id === id);
  if (!f) return;
  const name = prompt('Rename file:', f.name);
  if (!name || name === f.name) return;
  f.name = name;
  _nsSFSave(files);
  _nsSFRefreshOpenViews();
}

function _nsSFEditCategory(id) {
  const files = _nsSFLoad();
  const f = files.find(x => x.id === id);
  if (!f) return;
  const category = prompt('Set category / group for "' + f.name + '":', f.category || 'General');
  if (!category || category === f.category) return;
  f.category = category;
  _nsSFSave(files);
  _nsSFRefreshOpenViews();
  if (typeof toast === 'function') toast('✅ Category updated');
}

function _nsSFDuplicate(id) {
  const files = _nsSFLoad();
  const f = files.find(x => x.id === id);
  if (!f) return;
  const copy = JSON.parse(JSON.stringify(f));
  copy.id = _nsUid();
  copy.name = f.name + ' (Copy)';
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  // Re-key every sheet inside so the duplicate doesn't share sheet ids
  // with the original file (editing one would otherwise silently edit
  // the other too, since they'd point at the same grid ids).
  const newGrids = {};
  Object.values(copy.grids || {}).forEach(g => {
    const ngid = _nsUid();
    g.id = ngid;
    newGrids[ngid] = g;
  });
  copy.grids = newGrids;
  copy.activeSheet = Object.keys(newGrids)[0];
  files.push(copy);
  _nsSFSave(files);
  _nsSFRefreshOpenViews();
  if (typeof toast === 'function') toast('📄 Duplicated "' + f.name + '"');
}

function _nsSFDelete(id) {
  const files = _nsSFLoad();
  if (files.length <= 1) { if (typeof toast === 'function') toast('⚠ Cannot delete the last file.', 'w'); return; }
  const f = files.find(x => x.id === id);
  if (!f) return;
  if (!confirm('Delete "' + f.name + '"? This cannot be undone.')) return;
  const wb = _nsWBLoadRaw();
  delete wb.files[id];
  if (wb.activeFileId === id) {
    wb.activeFileId = Object.keys(wb.files)[0];
    const nf = wb.files[wb.activeFileId];
    _spState.activeSheet = (nf.activeSheet && nf.grids[nf.activeSheet]) ? nf.activeSheet : Object.keys(nf.grids)[0];
  }
  _nsWBSaveRaw(wb);
  _nsSFRefreshOpenViews();
  if (typeof toast === 'function') toast('🗑 Deleted "' + f.name + '"');
}

// Exports the file's active sheet to .xlsx. (A full multi-sheet export
// — every sheet in the file as its own tab in one .xlsx — would be a
// nice follow-up; today's XLSX helper takes one grid at a time, so a
// file with several sheets exports its currently-active one.)
function _nsSFExportXLSX(id) {
  const files = _nsSFLoad();
  const f = files.find(x => x.id === id);
  if (!f) return;
  const g = (f.activeSheet && f.grids[f.activeSheet]) || Object.values(f.grids || {})[0];
  if (!g) return;
  _nsExportGridToXLSX(g, f.name);
}

/* ── Shared XLSX helper: builds a workbook from a {cells} grid and saves
   it directly to disk via SheetJS — single click, no browser confirm. ── */
function _nsExportGridToXLSX(grid, filename) {
  if (typeof XLSX === 'undefined') { if (typeof toast === 'function') toast('⚠ Excel export library failed to load.', 'w'); return; }
  const nRows = grid.numRows || 100, nCols = grid.numCols || 26;
  const aoa = [];
  let lastDataRow = -1;
  for (let r = 0; r < nRows; r++) {
    const row = [];
    let hasData = false;
    for (let c = 0; c < nCols; c++) {
      const cell = (grid.cells || {})[r + ',' + c] || {};
      const v = _nsSpEvalCellRaw(grid, cell);
      if (v !== '' && v !== undefined && v !== null) hasData = true;
      row.push(v === undefined ? '' : v);
    }
    aoa.push(row);
    if (hasData) lastDataRow = r;
  }
  const trimmed = aoa.slice(0, Math.max(1, lastDataRow + 1));
  const ws = XLSX.utils.aoa_to_sheet(trimmed);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (grid.name || 'Sheet').slice(0, 31));
  XLSX.writeFile(wb, (filename || grid.name || 'sheet') + '.xlsx');
  if (typeof toast === 'function') toast('✅ XLSX downloaded');
}

// Evaluate a single cell's display value when we only have a raw cells map
// (used for exporting saved snapshots that aren't the live active grid).
function _nsSpEvalCellRaw(grid, cell) {
  const raw = cell.v !== undefined ? String(cell.v) : '';
  if (!raw.startsWith('=')) return _nsSpFormatValue(raw, cell.numFmt);
  const getCR = (ri, ci) => {
    const rc = (grid.cells || {})[ri + ',' + ci] || {};
    return rc.v !== undefined ? String(rc.v) : '';
  };
  const result = _nsEvalFormula(raw, getCR);
  const resultStr = (result === null || result === undefined) ? '' : String(result);
  return _nsSpFormatValue(resultStr, cell.numFmt);
}

/* ══════════════════════════════════════════════════════════════════════
   MANAGE SHEETS  —  full dedicated section for all saved sheet files
   Sortable by date · Groupable by category · Open / Rename / Duplicate /
   Export to XLSX / Delete, all from one screen.
══════════════════════════════════════════════════════════════════════ */
function _nsRenderManage(host) {
  if (!host) return;
  const all = _nsSFLoad();
  const q = _nsMgsSearch.trim().toLowerCase();
  let files = all.filter(f => !q ||
    (f.name||'').toLowerCase().includes(q) ||
    (f.category||'').toLowerCase().includes(q));

  // Sort
  files = files.slice().sort((a, b) => {
    switch (_nsMgsSort) {
      case 'created_asc':  return new Date(a.createdAt) - new Date(b.createdAt);
      case 'created_desc': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'updated_asc':  return new Date(a.updatedAt||a.createdAt) - new Date(b.updatedAt||b.createdAt);
      case 'updated_desc': return new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt);
      case 'name_asc':     return (a.name||'').localeCompare(b.name||'');
      case 'name_desc':    return (b.name||'').localeCompare(a.name||'');
      default: return 0;
    }
  });

  const totalCells = all.reduce((s,f) => s + _nsWBCellCount(f), 0);

  host.innerHTML = `
    <div class="ns-mgs">
      <div class="ns-mgs-toolbar">
        <input class="ns-mgs-search" placeholder="🔍 Search files by name or category…"
          value="${_nsEsc(_nsMgsSearch)}" oninput="_nsSetMgsSearch(this.value,document.getElementById('ns-panel-host'))">
        <select class="ns-mgs-select" onchange="_nsSetMgsSort(this.value,document.getElementById('ns-panel-host'))">
          <option value="created_desc" ${_nsMgsSort==='created_desc'?'selected':''}>🕓 Newest Created</option>
          <option value="created_asc"  ${_nsMgsSort==='created_asc' ?'selected':''}>🕓 Oldest Created</option>
          <option value="updated_desc" ${_nsMgsSort==='updated_desc'?'selected':''}>✏ Recently Updated</option>
          <option value="updated_asc"  ${_nsMgsSort==='updated_asc' ?'selected':''}>✏ Least Recently Updated</option>
          <option value="name_asc"     ${_nsMgsSort==='name_asc'    ?'selected':''}>🔤 Name A–Z</option>
          <option value="name_desc"    ${_nsMgsSort==='name_desc'   ?'selected':''}>🔤 Name Z–A</option>
        </select>
        <select class="ns-mgs-select" onchange="_nsSetMgsGroup(this.value,document.getElementById('ns-panel-host'))">
          <option value="category" ${_nsMgsGroup==='category'?'selected':''}>🗂 Group by Type</option>
          <option value="none"     ${_nsMgsGroup==='none'    ?'selected':''}>📋 No Grouping</option>
        </select>
        <button class="ns-btn primary" onclick="_nsSetPanel('sheets');setTimeout(_nsSFSaveAs,50)">💾 Save Current Sheet As New File</button>
      </div>
      <div class="ns-mgs-stats">${all.length} file${all.length!==1?'s':''} &nbsp;·&nbsp; ${totalCells.toLocaleString('en-PK')} total cells${q?` &nbsp;·&nbsp; ${files.length} match${files.length!==1?'es':''}`:''}</div>
      <div class="ns-mgs-body" id="ns-mgs-body"></div>
    </div>`;
  _nsRenderManageList(files);
}

function _nsRenderManageList(files) {
  const body = document.getElementById('ns-mgs-body');
  if (!body) return;

  if (!files.length) {
    body.innerHTML = `<div class="ns-empty">
      <div class="ns-empty-icon">🗂</div>
      <div class="ns-empty-title">No files yet</div>
      <div class="ns-empty-sub">Open a sheet in the <strong>Sheets</strong> tab and use <strong>Save As…</strong> to create your first file. It will show up here, fully manageable.</div>
    </div>`;
    return;
  }

  if (_nsMgsGroup === 'none') {
    body.innerHTML = `<div class="ns-mgs-grid">${files.map(_nsMgsCardHTML).join('')}</div>`;
    return;
  }

  // Group by category
  const groups = {};
  files.forEach(f => {
    const key = f.category || 'General';
    (groups[key] = groups[key] || []).push(f);
  });
  const groupNames = Object.keys(groups).sort((a,b) => a.localeCompare(b));

  body.innerHTML = groupNames.map(name => {
    const collapsed = !!_nsMgsCollapsed[name];
    return `
      <div class="ns-mgs-group">
        <div class="ns-mgs-group-head${collapsed?' collapsed':''}" onclick="_nsMgsToggleGroup('${_nsEscJs(name)}')">
          <span class="chev">▾</span>
          <span>${_nsEsc(name)}</span>
          <span class="ns-mgs-group-count">${groups[name].length}</span>
        </div>
        ${collapsed ? '' : `<div class="ns-mgs-grid">${groups[name].map(_nsMgsCardHTML).join('')}</div>`}
      </div>`;
  }).join('');
}

function _nsEscJs(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function _nsMgsToggleGroup(name) {
  _nsMgsCollapsed[name] = !_nsMgsCollapsed[name];
  _nsRenderManageList(_nsMgsCurrentFiles());
}

// Re-derive the currently-filtered/sorted file list (used by group toggling
// so we don't have to re-render the whole toolbar).
function _nsMgsCurrentFiles() {
  const all = _nsSFLoad();
  const q = _nsMgsSearch.trim().toLowerCase();
  let files = all.filter(f => !q ||
    (f.name||'').toLowerCase().includes(q) ||
    (f.category||'').toLowerCase().includes(q));
  files = files.slice().sort((a, b) => {
    switch (_nsMgsSort) {
      case 'created_asc':  return new Date(a.createdAt) - new Date(b.createdAt);
      case 'created_desc': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'updated_asc':  return new Date(a.updatedAt||a.createdAt) - new Date(b.updatedAt||b.createdAt);
      case 'updated_desc': return new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt);
      case 'name_asc':     return (a.name||'').localeCompare(b.name||'');
      case 'name_desc':    return (b.name||'').localeCompare(a.name||'');
      default: return 0;
    }
  });
  return files;
}

function _nsMgsCardHTML(f) {
  const created = new Date(f.createdAt);
  const updated = new Date(f.updatedAt || f.createdAt);
  const createdStr = created.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
  const updatedStr  = updated.toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) +
                       ' ' + updated.toLocaleTimeString('en-PK', { hour:'2-digit', minute:'2-digit' });
  const sheetCount = _nsWBSheetCount(f), cellCount = _nsWBCellCount(f);
  const isCurrent = f.id === _nsWBLoadRaw().activeFileId;
  return `
    <div class="ns-mgs-card${isCurrent?' ns-mgs-card-active':''}">
      <div class="ns-mgs-card-icon">📊</div>
      <div class="ns-mgs-card-body">
        <div class="ns-mgs-card-name">
          ${_nsEsc(f.name)}
          ${isCurrent?'<span class="ns-mgs-card-tag" style="background:#dcfce7;color:#16a34a">Current</span>':''}
          <span class="ns-mgs-card-tag">${_nsEsc(f.category || 'General')}</span>
        </div>
        <div class="ns-mgs-card-meta">${sheetCount} sheet${sheetCount!==1?'s':''} &nbsp;·&nbsp; ${cellCount} cell${cellCount!==1?'s':''} &nbsp;·&nbsp; Created ${createdStr} &nbsp;·&nbsp; Updated ${updatedStr}</div>
      </div>
      <div class="ns-mgs-card-actions">
        <button class="ns-mgs-btn primary" onclick="_nsSFLoad_('${f.id}')">📂 Open</button>
        <button class="ns-mgs-btn" onclick="_nsSFExportXLSX('${f.id}')">⬇ XLSX</button>
        <button class="ns-mgs-btn" onclick="_nsSFDuplicate('${f.id}')">⧉ Duplicate</button>
        <button class="ns-mgs-btn" onclick="_nsSFRename('${f.id}')">✏ Rename</button>
        <button class="ns-mgs-btn" onclick="_nsSFEditCategory('${f.id}')">🗂 Group</button>
        <button class="ns-mgs-btn danger" onclick="_nsSFDelete('${f.id}')">🗑 Delete</button>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   DATA PANEL  (unchanged from original)
══════════════════════════════════════════════════════════════════════ */
var _nsDataSource = 'monthly';
var _nsDataSearch = '';
function _nsSetDataSource(v) { _nsDataSource = v; _nsRenderPanel(); } // see _nsSetMgsSearch for why this indirection is needed
function _nsSetDataSearch(v) { _nsDataSearch = v; _nsRenderPanel(); }

function _nsRenderData(host) {
  host.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="ns-data-toolbar">
        <select class="ns-data-select" onchange="_nsSetDataSource(this.value)">
          <option value="monthly" ${_nsDataSource==='monthly'?'selected':''}>📅 Monthly Summary</option>
          <option value="daily"   ${_nsDataSource==='daily'?'selected':''}>📆 Daily Records</option>
          <option value="staff"   ${_nsDataSource==='staff'?'selected':''}>👤 Staff Registry</option>
        </select>
        <input class="ns-search-box" style="flex:1;min-width:100px" placeholder="Filter…"
          value="${_nsEsc(_nsDataSearch)}"
          oninput="_nsSetDataSearch(this.value)">
        <button class="ns-btn" onclick="_nsExportDataXLSX()">⬇ XLSX</button>
      </div>
      <div class="ns-data-table-wrap" id="ns-data-table-host"></div>
    </div>`;
  _nsRenderDataTable();
}

function _nsFmt(v) { const n = parseFloat(v); return isNaN(n) ? '' : Math.round(n).toLocaleString('en-PK'); }

function _nsRenderDataTable() {
  const host = document.getElementById('ns-data-table-host');
  if (!host) return;
  const q = _nsDataSearch.toLowerCase();
  if (_nsDataSource === 'monthly') {
    const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
    const cols = ['Month_Year','TOTAL','Customers','Cash Sale','PSO','NESPAK','PARCO','Jazz Cash','Load Sale'];
    const rows = M.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)).reverse();
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">📅</div><div class="ns-empty-title">No data</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r => '<tr>' + cols.map(c => {
      const v=r[c]; const n=parseFloat(v);
      const disp=(c!=='Month_Year'&&c!=='Customers'&&!isNaN(n)&&n!==0)?'₨'+_nsFmt(n):_nsEsc(v||'');
      return `<td>${disp}</td>`;
    }).join('') + '</tr>').join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  } else if (_nsDataSource === 'daily') {
    const D = (typeof DAILY !== 'undefined' && DAILY) ? DAILY : [];
    const cols = ['Date','Month_Year','TOTAL','Customers','Cash Sale','Jazz Cash','Load Sale'];
    const rows = D.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q))
                  .sort((a,b)=>(b.Date||'')>(a.Date||'')?1:-1).slice(0,200);
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">📆</div><div class="ns-empty-title">No data</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r => '<tr>' + cols.map(c => {
      const v=r[c]; const n=parseFloat(v);
      const disp=(['Date','Month_Year'].includes(c))?_nsEsc(v||''):(!isNaN(n)&&n!==0?'₨'+_nsFmt(n):_nsEsc(v||''));
      return `<td>${disp}</td>`;
    }).join('') + '</tr>').join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  } else if (_nsDataSource === 'staff') {
    const S = (typeof STAFF !== 'undefined' && STAFF) ? STAFF : [];
    const cols = ['name','staffId','role','phone','cnic','joinDate'];
    const rows = S.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    if (!rows.length) { host.innerHTML = '<div class="ns-empty"><div class="ns-empty-icon">👤</div><div class="ns-empty-title">No staff</div></div>'; return; }
    const th = cols.map(c=>`<th>${_nsEsc(c)}</th>`).join('');
    const trs = rows.map(r => '<tr>' + cols.map(c=>`<td>${_nsEsc(r[c]||'')}</td>`).join('') + '</tr>').join('');
    host.innerHTML = `<table class="ns-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
}

function _nsExportDataXLSX() {
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
  if (typeof XLSX === 'undefined') { if (typeof toast === 'function') toast('⚠ Excel export library failed to load.', 'w'); return; }
  const aoa = [cols, ...data.map(r => cols.map(c => r[c] !== undefined ? r[c] : ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, _nsDataSource.slice(0,31));
  XLSX.writeFile(wb, _nsDataSource + '-export.xlsx');
  if (typeof toast === 'function') toast('✅ XLSX exported.');
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
// onclick/onchange/oninput, or (a handful) from other still-classic
// files (commandhub-page.js, ai-bridge.js) — see this file's header
// comment. All always run in global scope, so a plain module-scoped
// function declaration is invisible to them without this bridge.
window._nsCloseEditor = _nsCloseEditor;
window._nsDeleteNote = _nsDeleteNote;
window._nsExportDataXLSX = _nsExportDataXLSX;
window._nsMgsToggleGroup = _nsMgsToggleGroup;
window._nsNewNote = _nsNewNote;
window._nsOpenNote = _nsOpenNote;
window._nsSFCloseManager = _nsSFCloseManager;
window._nsSFDelete = _nsSFDelete;
window._nsSFDuplicate = _nsSFDuplicate;
window._nsSFEditCategory = _nsSFEditCategory;
window._nsSFExportXLSX = _nsSFExportXLSX;
window._nsSFLoad = _nsSFLoad;
window._nsSFLoad_ = _nsSFLoad_;
window._nsSFOpenManager = _nsSFOpenManager;
window._nsSFOverwrite = _nsSFOverwrite;
window._nsSFRename = _nsSFRename;
window._nsSFSaveAs = _nsSFSaveAs;
window._nsSaveNote = _nsSaveNote;
window._nsSetDataSearch = _nsSetDataSearch;
window._nsSetDataSource = _nsSetDataSource;
window._nsSetMgsGroup = _nsSetMgsGroup;
window._nsSetMgsSearch = _nsSetMgsSearch;
window._nsSetMgsSort = _nsSetMgsSort;
window._nsSetNoteSearch = _nsSetNoteSearch;
window._nsSetPanel = _nsSetPanel;
window._nsSpAddCols = _nsSpAddCols;
window._nsSpAddRows = _nsSpAddRows;
window._nsSpAddSheet = _nsSpAddSheet;
window._nsSpApplyFmt = _nsSpApplyFmt;
window._nsSpAutoFit = _nsSpAutoFit;
window._nsSpClearAll = _nsSpClearAll;
window._nsSpClearFmt = _nsSpClearFmt;
window._nsSpCloseCtx = _nsSpCloseCtx;
window._nsSpCloseSort = _nsSpCloseSort;
window._nsSpCopy = _nsSpCopy;
window._nsSpDeleteCol = _nsSpDeleteCol;
window._nsSpDeleteRow = _nsSpDeleteRow;
window._nsSpDeleteSelection = _nsSpDeleteSelection;
window._nsSpDeleteSheet = _nsSpDeleteSheet;
window._nsSpDoSort = _nsSpDoSort;
window._nsSpDuplicateSheet = _nsSpDuplicateSheet;
window._nsSpExportXLSX = _nsSpExportXLSX;
window._nsSpFreezeFirstRow = _nsSpFreezeFirstRow;
window._nsSpGoToCell = _nsSpGoToCell;
window._nsSpImportXLSX = _nsSpImportXLSX;
window._nsSpInsertCol = _nsSpInsertCol;
window._nsSpInsertCurrentDate = _nsSpInsertCurrentDate;
window._nsSpInsertFormula = _nsSpInsertFormula;
window._nsSpInsertNow = _nsSpInsertNow;
window._nsSpInsertRow = _nsSpInsertRow;
window._nsSpPaste = _nsSpPaste;
window._nsSpPickBgColor = _nsSpPickBgColor;
window._nsSpPickFgColor = _nsSpPickFgColor;
window._nsSpPrint = _nsSpPrint;
window._nsSpRedo = _nsSpRedo;
window._nsSpRenameSheet = _nsSpRenameSheet;
window._nsSpSelectAll = _nsSpSelectAll;
window._nsSpSelectCol = _nsSpSelectCol;
window._nsSpSelectRow = _nsSpSelectRow;
window._nsSpSetRibbonTab = _nsSpSetRibbonTab;
window._nsSpShowSort = _nsSpShowSort;
window._nsSpSwitchSheet = _nsSpSwitchSheet;
window._nsSpToggleFmt = _nsSpToggleFmt;
window._nsSpUndo = _nsSpUndo;
window._nsTogglePin = _nsTogglePin;
window.renderNotesSheets = renderNotesSheets;
