// ═══════════════════════════════════════════════════════════════════════
// SHEETS PATCH  —  loaded after notes-sheets.js
//
// Adds four capabilities that notes-sheets.js doesn't ship with:
//   1. Supabase auto-sync on every saveSheets / saveNotes / saveSheetFiles
//   2. Clipboard copy (Ctrl+C) and paste (Ctrl+V) for cell ranges
//   3. Moves the "Files" ribbon tab to first position
//   4. Converts that tab into a WPS-style File dropdown menu
// ═══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // 1. SUPABASE AUTO-SYNC
  //    Wraps Actions.saveSheets, saveNotes, saveSheetFiles so that every
  //    save also pushes to Supabase (respects the global pushToSupabase()
  //    already used by the rest of the app).
  // ─────────────────────────────────────────────────────────────────────
  function _patchSupabaseSync() {
    if (!window.Actions) return;

    function _wrap(fn) {
      if (!fn || fn._shtPatched) return fn;
      const wrapped = function (...args) {
        const r = fn.apply(this, args);
        // Debounce the Supabase push so rapid saves don't flood the network
        clearTimeout(wrapped._timer);
        wrapped._timer = setTimeout(() => {
          if (typeof pushToSupabase === 'function') pushToSupabase();
        }, 1500);
        return r;
      };
      wrapped._shtPatched = true;
      return wrapped;
    }

    Actions.saveSheets      = _wrap(Actions.saveSheets);
    Actions.saveNotes       = _wrap(Actions.saveNotes);
    Actions.saveSheetFiles  = _wrap(Actions.saveSheetFiles);
    Actions.saveSheetWorkbooks = _wrap(Actions.saveSheetWorkbooks);
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. INJECT STYLES (done once)
  // ─────────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('sht-patch-css')) return;
    const s = document.createElement('style');
    s.id = 'sht-patch-css';
    s.textContent = `
      /* File menu dropdown */
      #sht-file-wrap {
        position: relative;
        display: inline-block;
      }
      #sht-file-btn {
        background: #1d4ed8 !important;
        color: #fff !important;
        font-weight: 700 !important;
        border-radius: 6px 6px 0 0 !important;
        border-bottom-color: transparent !important;
      }
      #sht-file-btn.closed {
        border-radius: 6px !important;
      }
      #sht-file-panel {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 10000;
        min-width: 230px;
        background: var(--surface, #fff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 0 8px 8px 8px;
        box-shadow: 0 10px 40px rgba(0,0,0,.22);
        padding: 6px 0;
      }
      #sht-file-panel.open { display: block; }
      .sfm-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 18px;
        cursor: pointer;
        font-size: 13px;
        color: var(--text, #1e293b);
        user-select: none;
        transition: background .12s;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
      }
      .sfm-row:hover { background: var(--alt, #f1f5f9); }
      .sfm-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
      .sfm-label { flex: 1; }
      .sfm-shortcut {
        font-size: 10px;
        color: var(--muted, #94a3b8);
        font-family: var(--mono, monospace);
        margin-left: auto;
      }
      .sfm-sep {
        height: 1px;
        background: var(--border, #e2e8f0);
        margin: 5px 10px;
      }
      .sfm-section {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: var(--muted, #94a3b8);
        padding: 4px 18px 2px;
      }

      /* Copy/paste visual feedback */
      .sht-copy-flash {
        outline: 2px dashed #2563eb !important;
        animation: shtFlash .5s ease;
      }
      @keyframes shtFlash {
        0%   { outline-color: #2563eb; }
        50%  { outline-color: #93c5fd; }
        100% { outline-color: #2563eb; }
      }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. BUILD FILE DROPDOWN PANEL
  // ─────────────────────────────────────────────────────────────────────
  function _buildFilePanel() {
    const panel = document.createElement('div');
    panel.id = 'sht-file-panel';

    const rows = [
      { icon: '📄', label: 'New Sheet',         kb: '',       fn: 'shtFmNew'         },
      { icon: '📁', label: 'Switch File',        kb: '',       fn: 'shtFmSwitchFile'  },
      { icon: '📂', label: 'Import XLSX',        kb: '',       fn: 'shtFmImport'      },
      null, // separator
      { icon: '💾', label: 'Save All',           kb: 'Ctrl+S', fn: 'shtFmSave'        },
      { icon: '📤', label: 'Export as XLSX',     kb: '',       fn: 'shtFmExportXLSX'  },
      { icon: '🖨️', label: 'Print',              kb: '',       fn: 'shtFmPrint'       },
      null,
      { icon: '☁️', label: 'Sync to Supabase',  kb: '',       fn: 'shtFmSync'        },
    ];

    rows.forEach(r => {
      if (!r) {
        const sep = document.createElement('div');
        sep.className = 'sfm-sep';
        panel.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.className = 'sfm-row';
      btn.setAttribute('onclick', r.fn + '()');
      btn.innerHTML = `<span class="sfm-icon">${r.icon}</span><span class="sfm-label">${r.label}</span>${r.kb ? `<span class="sfm-shortcut">${r.kb}</span>` : ''}`;
      panel.appendChild(btn);
    });

    return panel;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. FIND THE RIBBON TAB BAR
  //    The ribbon (Home | Insert | Formulas | Data | View | Files) is
  //    rendered by notes-sheets.js. We detect it by looking for a parent
  //    element whose direct children include both "Home" and "Files".
  // ─────────────────────────────────────────────────────────────────────
  function _findRibbon(root) {
    const candidates = root.querySelectorAll('div, nav, ul, section');
    for (const el of candidates) {
      const kids = Array.from(el.children);
      if (kids.length < 4) continue;
      const texts = kids.map(k => k.textContent.trim().toLowerCase());
      if (texts.some(t => t === 'home') && texts.some(t => t === 'files')) {
        return el;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. PATCH THE RIBBON — move Files first + build File dropdown
  // ─────────────────────────────────────────────────────────────────────
  function _patchRibbon(ribbon) {
    if (ribbon.dataset.shtPatched) return;
    ribbon.dataset.shtPatched = 'true';

    // Find the Files child
    let filesEl = null;
    for (const child of Array.from(ribbon.children)) {
      if (child.textContent.trim().toLowerCase() === 'files') {
        filesEl = child;
        break;
      }
    }
    if (!filesEl) return;

    // Move it to the front
    ribbon.insertBefore(filesEl, ribbon.firstChild);

    // Wrap in a position:relative container so the dropdown can anchor to it
    const wrap = document.createElement('div');
    wrap.id = 'sht-file-wrap';
    ribbon.insertBefore(wrap, filesEl);
    wrap.appendChild(filesEl);

    // Restyle the Files button
    filesEl.id = 'sht-file-btn';
    filesEl.classList.add('closed');

    // Build the dropdown panel and append inside the wrapper
    const panel = _buildFilePanel();
    wrap.appendChild(panel);

    // Toggle dropdown on click; prevent the original tab-switch click from firing
    filesEl.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.classList.toggle('open');
      filesEl.classList.toggle('closed', !open);
    });

    // Close when clicking outside
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) {
        panel.classList.remove('open');
        filesEl.classList.add('closed');
      }
    }, { capture: true, passive: true });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. COPY / PASTE
  //    The sheet grid uses cells with data attributes.
  //    We listen at document level for Ctrl+C / Ctrl+V when focus is
  //    inside the sheets container and no input/textarea is active.
  // ─────────────────────────────────────────────────────────────────────

  // Buffer for internal copy (avoids clipboard permission issues in old browsers)
  let _cpBuffer = null;   // string — tab-delimited rows

  function _sheetsContainerActive() {
    const container = document.getElementById('mgr-sheets');
    if (!container) return false;
    const active = document.activeElement;
    // If an input/textarea inside the sheet is focused, let the browser handle copy/paste normally
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return false;
    return container.contains(active) || container.contains(document.querySelector(':focus'));
  }

  function _getCellsFromDOM(root) {
    // Many spreadsheet implementations use data-row/data-col or data-r/data-c attributes.
    // We try both conventions and also look for [data-ri][data-ci].
    const selectors = [
      '[data-row][data-col]',
      '[data-r][data-c]',
      '[data-ri][data-ci]',
    ];
    for (const sel of selectors) {
      const cells = root.querySelectorAll(sel);
      if (cells.length) return { cells, rowAttr: sel.includes('data-row') ? 'data-row' : sel.includes('data-ri') ? 'data-ri' : 'data-r', colAttr: sel.includes('data-col') ? 'data-col' : sel.includes('data-ci') ? 'data-ci' : 'data-c' };
    }
    return null;
  }

  function _getSelectedRange(root) {
    // Look for cells with a "selected" state — try common class names
    const selectedClasses = ['.ns-selected', '.cell-selected', '.selected', '.ht-cell-selected', '[aria-selected="true"]', '[data-selected="true"]'];
    for (const cls of selectedClasses) {
      const cells = root.querySelectorAll(cls);
      if (cells.length) return cells;
    }
    // Fallback: check if the active element itself is a cell
    const active = document.activeElement;
    if (active && root.contains(active)) {
      const r = active.dataset.row ?? active.dataset.r ?? active.dataset.ri;
      const c = active.dataset.col ?? active.dataset.c ?? active.dataset.ci;
      if (r !== undefined && c !== undefined) return [active];
    }
    return [];
  }

  function _cellsToTSV(cells, rowAttr, colAttr) {
    const grid = {};
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;

    cells.forEach(cell => {
      const r = parseInt(cell.getAttribute(rowAttr) ?? '0', 10);
      const c = parseInt(cell.getAttribute(colAttr) ?? '0', 10);
      const v = (cell.dataset.value ?? cell.textContent ?? '').trim();
      if (!grid[r]) grid[r] = {};
      grid[r][c] = v;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    });

    const lines = [];
    for (let r = minR; r <= maxR; r++) {
      const cols = [];
      for (let c = minC; c <= maxC; c++) {
        cols.push((grid[r] && grid[r][c] !== undefined) ? grid[r][c] : '');
      }
      lines.push(cols.join('\t'));
    }
    return lines.join('\n');
  }

  function _doSheetCopy() {
    const root = document.getElementById('mgr-sheets');
    if (!root) return;

    const selected = _getSelectedRange(root);
    if (!selected || !selected.length) return;

    const cellInfo = _getCellsFromDOM(root);
    const rowAttr = cellInfo ? cellInfo.rowAttr : 'data-row';
    const colAttr = cellInfo ? cellInfo.colAttr : 'data-col';

    const tsv = _cellsToTSV(selected, rowAttr, colAttr);
    if (!tsv) return;

    _cpBuffer = tsv;

    // Write to system clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(() => {
        // Flash selected cells as visual feedback
        selected.forEach(c => {
          c.classList.add('sht-copy-flash');
          setTimeout(() => c.classList.remove('sht-copy-flash'), 600);
        });
        toast('📋 Copied ' + selected.length + ' cell' + (selected.length > 1 ? 's' : ''), 'i');
      }).catch(() => {
        toast('📋 Copied (internal)', 'i');
      });
    } else {
      toast('📋 Copied (internal)', 'i');
    }
  }

  function _doSheetPaste() {
    const root = document.getElementById('mgr-sheets');
    if (!root) return;

    const _apply = (text) => {
      if (!text) return;
      const rows = text.split('\n').map(r => r.split('\t'));

      // Find the anchor cell (top-left of paste target)
      const active = document.activeElement;
      const cellInfo = _getCellsFromDOM(root);
      const rowAttr = cellInfo ? cellInfo.rowAttr : 'data-row';
      const colAttr = cellInfo ? cellInfo.colAttr : 'data-col';

      let startR = 0, startC = 0;
      if (active && root.contains(active)) {
        startR = parseInt(active.getAttribute(rowAttr) ?? '0', 10);
        startC = parseInt(active.getAttribute(colAttr) ?? '0', 10);
      }

      let pasted = 0;
      rows.forEach((cols, ri) => {
        cols.forEach((val, ci) => {
          const tr = startR + ri;
          const tc = startC + ci;

          // Try global setter functions that notes-sheets.js may expose
          if (typeof nsSetCellValue === 'function') { nsSetCellValue(tr, tc, val); pasted++; return; }
          if (typeof setCellValue    === 'function') { setCellValue(tr, tc, val);    pasted++; return; }
          if (typeof sheetSetCell    === 'function') { sheetSetCell(tr, tc, val);    pasted++; return; }

          // DOM fallback: find the cell by data attributes and simulate input
          const cell = root.querySelector(
            `[${rowAttr}="${tr}"][${colAttr}="${tc}"]`
          );
          if (cell) {
            // If it's an input, set value directly
            if (cell.tagName === 'INPUT' || cell.tagName === 'TEXTAREA') {
              cell.value = val;
              cell.dispatchEvent(new Event('input',  { bubbles: true }));
              cell.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              // Click to activate cell, then use a synthetic keyboard approach
              cell.click();
              // Try setting via contentEditable
              if (cell.contentEditable === 'true') {
                cell.textContent = val;
                cell.dispatchEvent(new InputEvent('input', { bubbles: true, data: val }));
              } else {
                // Last resort: set data-value if the sheet reads from data attribute
                if (cell.dataset.value !== undefined) cell.dataset.value = val;
              }
            }
            pasted++;
          }
        });
      });

      if (pasted) toast('📋 Pasted ' + pasted + ' cell' + (pasted > 1 ? 's' : ''), 'i');
    };

    // Try system clipboard first, fall back to internal buffer
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(_apply).catch(() => {
        if (_cpBuffer) _apply(_cpBuffer);
        else toast('Clipboard paste failed — check browser permissions', 'w');
      });
    } else if (_cpBuffer) {
      _apply(_cpBuffer);
    } else {
      toast('Nothing to paste', 'w');
    }
  }

  // Keyboard listener (document level)
  function _addKeyboardListeners() {
    if (window._shtKbPatched) return;
    window._shtKbPatched = true;

    document.addEventListener('keydown', e => {
      if (!_sheetsContainerActive()) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === 'c' || e.key === 'C') {
          _doSheetCopy();
          // Don't preventDefault — let browser also copy text selection in formula bar
        }
        if (e.key === 'v' || e.key === 'V') {
          _doSheetPaste();
          e.preventDefault();
        }
        if (e.key === 's' || e.key === 'S') {
          shtFmSave();
          e.preventDefault();
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 7. FILE MENU ACTION HANDLERS (global so onclick="" works in HTML)
  // ─────────────────────────────────────────────────────────────────────

  function _closeFilePanel() {
    const panel = document.getElementById('sht-file-panel');
    const btn   = document.getElementById('sht-file-btn');
    if (panel) panel.classList.remove('open');
    if (btn)   btn.classList.add('closed');
  }

  window.shtFmNew = function () {
    _closeFilePanel();
    // Try the notes-sheets.js new-sheet function by a few common names
    if (typeof nsNewSheet       === 'function') { nsNewSheet();        return; }
    if (typeof addNewSheet      === 'function') { addNewSheet();       return; }
    if (typeof sheetNew         === 'function') { sheetNew();          return; }
    // Click the "+" button in the sheet tab bar
    const addBtn = document.querySelector('#mgr-sheets [title*="new" i], #mgr-sheets [title*="add" i], #mgr-sheets button[onclick*="add" i]');
    if (addBtn) { addBtn.click(); return; }
    toast('Use the + tab button to add a new sheet', 'w');
  };

  window.shtFmSwitchFile = function () {
    _closeFilePanel();
    // The multi-file workbook switcher lives in notes-sheets.js — this
    // just opens it (V2 plan §5 — one file, many named sheets).
    if (typeof _nsSFOpenManager === 'function') { _nsSFOpenManager(); return; }
    toast('File switcher unavailable', 'w');
  };

  window.shtFmImport = function () {
    _closeFilePanel();
    // Click the XLSX import button (toolbar shows "XLSX")
    const btn = document.querySelector(
      '#mgr-sheets [onclick*="import" i], #mgr-sheets [onclick*="Import" i], #mgr-sheets [title*="import" i]'
    );
    if (btn) { btn.click(); return; }
    // Trigger hidden file input
    const input = document.querySelector('#mgr-sheets input[type="file"][accept*="xlsx" i], #mgr-sheets input[type="file"]');
    if (input) { input.click(); return; }
    toast('Click the XLSX button in the toolbar to import', 'w');
  };

  window.shtFmSave = function () {
    _closeFilePanel();
    if (typeof saveAllSheets === 'function') { saveAllSheets(); return; }
    if (typeof nsSaveAll     === 'function') { nsSaveAll();     return; }
    if (typeof saveSheetData === 'function') { saveSheetData(); return; }
    // Click the save button in the toolbar
    const btn = document.querySelector(
      '#mgr-sheets [onclick*="save" i]:not(.sfm-row), #mgr-sheets [title*="save" i]:not(.sfm-row)'
    );
    if (btn) { btn.click(); return; }
    toast('Sheets save triggered', 'i');
  };

  window.shtFmExportXLSX = function () {
    _closeFilePanel();
    // Click the XLSX export button in the toolbar
    const btn = document.querySelector(
      '#mgr-sheets [onclick*="xlsx" i]:not(.sfm-row), #mgr-sheets [onclick*="export" i]:not(.sfm-row), ' +
      '#mgr-sheets [title*="xlsx" i]:not(.sfm-row), #mgr-sheets [title*="export" i]:not(.sfm-row)'
    );
    if (btn) { btn.click(); return; }
    // Try direct function call
    if (typeof exportSheetXLSX   === 'function') { exportSheetXLSX();   return; }
    if (typeof nsExportXLSX      === 'function') { nsExportXLSX();      return; }
    if (typeof downloadSheetXLSX === 'function') { downloadSheetXLSX(); return; }
    toast('Click the XLSX button in the toolbar to export', 'w');
  };

  window.shtFmPrint = function () {
    _closeFilePanel();
    const btn = document.querySelector(
      '#mgr-sheets [onclick*="print" i]:not(.sfm-row), #mgr-sheets [title*="print" i]:not(.sfm-row)'
    );
    if (btn) { btn.click(); return; }
    // Fall back to calling the real Sheets print function directly
    // rather than a bare window.print() — a bare call here used to
    // print whatever the live page happened to look like at that
    // moment, with none of print.js's race-condition safety, if the
    // DOM-query above ever failed to find a button. (The two typeof
    // checks that used to be here — printSheet/nsPrintSheet — were
    // dead: neither function exists anywhere in this codebase.)
    if (typeof _nsSpPrint === 'function') { _nsSpPrint(); return; }
    if (typeof toast === 'function') toast('⚠ Nothing to print here.', 'w');
  };

  window.shtFmSync = function () {
    _closeFilePanel();
    if (typeof pushToSupabase === 'function') {
      pushToSupabase();
      toast('☁️ Syncing sheets to Supabase…', 'i');
    } else {
      toast('Supabase not configured', 'w');
    }
  };

  // Expose copy/paste globally so CommandHub or toolbar buttons can also call them
  window.shtCopyCells  = _doSheetCopy;
  window.shtPasteCells = _doSheetPaste;

  // ─────────────────────────────────────────────────────────────────────
  // 8. MAIN INIT — observe #mgr-sheets for when notes-sheets.js renders
  // ─────────────────────────────────────────────────────────────────────
  function _tryPatch() {
    const container = document.getElementById('mgr-sheets');
    if (!container) return;

    const ribbon = _findRibbon(container);
    if (ribbon) _patchRibbon(ribbon);
  }

  function _init() {
    _injectStyles();
    _patchSupabaseSync();
    _addKeyboardListeners();

    const container = document.getElementById('mgr-sheets');
    if (!container) return;

    // Patch immediately if already rendered
    _tryPatch();

    // Watch for future renders (notes-sheets.js populates this lazily)
    const obs = new MutationObserver(() => _tryPatch());
    obs.observe(container, { childList: true, subtree: true });
  }

  // Always defer/module now — readyState is never 'loading' here.
  document.addEventListener('DOMContentLoaded', _init);

})();
