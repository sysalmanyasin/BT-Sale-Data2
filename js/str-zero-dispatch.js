// ══════════════════════════════════════════════════════════════════════
// STR ZERO DISPATCH — 3rd sub-tab under STR (Aug 2026)
//
// Same read-only StrBridge data + str-shared.js engine as str-native.js
// and str-report-native.js, but line-item filtered: only rows where
// packStrQty > 0 AND packDispatchQty === 0 survive (per line item, not
// per whole STR — a partially-dispatched STR can still surface its own
// zero-dispatch lines here). An STR with no surviving lines after that
// filter is dropped from the page entirely; a supplier group with no
// surviving rows is dropped too.
//
// Nesting mirrors str-report-native.js: Dispatch Branch > STR # (+
// Comments) > Supplier (product code ascending) > line items — same
// "one door" every STR view shares (str-shared.js).
//
// New here: a checkbox per STR block, unchecked by default. Print
// (via print.js's Print.render(), same single door every report in
// this app funnels through) only includes checked STRs — the whole
// point of this page is picking which zero-dispatch STRs to chase up
// on paper, not printing all of them every time.
// ══════════════════════════════════════════════════════════════════════

import * as StrBridge from './str-bridge.js';
import * as S from './str-shared.js';

const COLS_KEY = 'bt_str_zd_cols_v1';
// Dispatch Qty is always 0 on this page by definition, but it's kept
// visible (not force-hidden) since seeing the literal "0" next to a
// positive STR Qty is the whole point being illustrated on screen/print.
const COLUMN_DEFS = [
  { key: 'price', label: 'R. Price' },
  { key: 'strQty', label: 'STR Qty (Pack)' },
  { key: 'dispatchQty', label: 'Dispatch Qty (Pack)' },
];

function _defaultCols() {
  const o = {};
  COLUMN_DEFS.forEach(c => { o[c.key] = true; });
  return o;
}
function _loadCols() {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return Object.assign(_defaultCols(), JSON.parse(raw));
  } catch (e) { /* best-effort */ }
  return _defaultCols();
}
function _saveCols() {
  try { localStorage.setItem(COLS_KEY, JSON.stringify(zdState.cols)); } catch (e) { /* best-effort */ }
}

// ── Page state — same filter shape as str-native.js/str-report-native.js
// (handed straight to str-shared.js's filterHeaders), plus this page's
// own column-visibility state and the print-selection Set (strIds the
// user has checked). Selection intentionally does NOT persist across a
// page revisit or refresh — it's a "what am I printing right now" pick,
// not a saved preference, and stale-checked STRs (dispatched since the
// last look) silently dropping off the list would be confusing if the
// checkbox itself stuck around implying they were still relevant.
const zdState = {
  search: '', stageFilter: 'all', branchFilter: 'all',
  dateFrom: '', dateTo: '', cols: _loadCols(), colsOpen: false,
  selected: new Set(),
};

// ── Core filter: per STR header, keep only line items with
// packStrQty > 0 && packDispatchQty === 0, grouped by supplier same as
// str-shared.js's groupedLineItems, minus any supplier group / STR that
// ends up empty after the line-item filter.
function _zeroDispatchGroups(data, strId) {
  const groups = S.groupedLineItems(data, strId);
  return groups
    .map(g => ({ supplier: g.supplier, rows: g.rows.filter(li => (li.packStrQty || 0) > 0 && (li.packDispatchQty || 0) === 0) }))
    .filter(g => g.rows.length > 0);
}

// Headers matching the shared filters AND having at least one
// zero-dispatch line, each carrying its own pre-filtered groups so
// downstream renderers never re-derive them.
function _matchingHeaders(data) {
  const base = S.filterHeaders(data, zdState);
  return base
    .map(h => ({ h, groups: _zeroDispatchGroups(data, h.strId) }))
    .filter(x => x.groups.length > 0);
}

function _colCount() { return 2 + COLUMN_DEFS.filter(c => zdState.cols[c.key]).length; } // Sr# + Product + enabled

function _colHeadHtml() {
  return COLUMN_DEFS.filter(c => zdState.cols[c.key])
    .map(c => `<th style="text-align:center">${c.label}</th>`).join('');
}

function _lineRowCellsHtml(li) {
  const cells = {
    price: `<td style="text-align:center">${S.fmtMoney(li.productPrice)}</td>`,
    strQty: `<td style="text-align:center">${S.fmtQty(li.packStrQty)}</td>`,
    dispatchQty: `<td style="text-align:center">${S.fmtQty(li.packDispatchQty)}</td>`,
  };
  return COLUMN_DEFS.filter(c => zdState.cols[c.key]).map(c => cells[c.key]).join('');
}

function _supplierGroupHtml(group, srStart) {
  const rowsHtml = group.rows.map((li, i) => `<tr class="str-detail-row">
    <td style="text-align:center;color:var(--muted)">${srStart + i}</td>
    <td>
      <span style="color:var(--muted);font-size:11px">[${S.esc(li.productCode || '—')}]</span>
      <span style="font-weight:600">${S.esc(li.productName)}</span>
    </td>
    ${_lineRowCellsHtml(li)}
  </tr>`).join('');
  return `<tr class="str-detail-supplier-row"><td colspan="${_colCount()}">${S.esc(group.supplier)}</td></tr>${rowsHtml}`;
}

function _strBlockHtml(h, groups) {
  let sr = 1;
  const groupsHtml = groups.map(g => { const html = _supplierGroupHtml(g, sr); sr += g.rows.length; return html; }).join('');
  const stage = S.strStage(h);
  const itemCount = groups.reduce((s, g) => s + g.rows.length, 0);
  const checked = zdState.selected.has(h.strId);

  return `
    <div class="str-rpt-str-block">
      <div class="str-zd-str-head-row">
        <label class="str-zd-checkbox-wrap" onclick="event.stopPropagation()">
          <input type="checkbox" class="str-zd-checkbox" ${checked ? 'checked' : ''} onchange="strZdToggleSelect(${h.strId}, this.checked)">
        </label>
        <div class="str-rpt-str-head" style="flex:1" onclick="strZdOpenDetail(${h.strId})">
          <div class="str-rpt-str-head-main">
            <span class="str-rpt-str-num">STR #${S.esc(h.strNumber || h.strId)}</span>
            <span class="str-badge ${S.STAGE_BADGE_CLASS[stage]}">${S.STAGE_LABEL[stage]}</span>
            <span class="str-zd-badge">${itemCount} zero-dispatch item(s)</span>
          </div>
          <div class="str-rpt-str-head-sub">
            ${S.fmtDate(h.strDate)} · ${S.esc(h.dispatchBranch || '—')} → ${S.esc(h.receiveBranch || '—')}
          </div>
          ${h.comments ? `<div class="str-rpt-str-comment"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
        </div>
      </div>
      <div class="str-rpt-table-wrap">
        <table class="str-detail-table str-rpt-table">
          <thead><tr>
            <th style="width:32px;text-align:center">Sr#</th><th>Product</th>
            ${_colHeadHtml()}
          </tr></thead>
          <tbody>${groupsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function _branchGroupHtml(branchName, entries) {
  const blocksHtml = entries.map(x => _strBlockHtml(x.h, x.groups)).join('');
  return `
    <div class="str-rpt-branch-group">
      <div class="str-rpt-branch-head">
        <span>${S.esc(branchName)}</span>
        <span class="str-rpt-branch-count">${entries.length} STR(s)</span>
      </div>
      ${blocksHtml}
    </div>`;
}

function _groupedByBranch(entries) {
  const byBranch = new Map();
  entries.forEach(x => {
    const branch = x.h.dispatchBranch || 'Unknown Branch';
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(x);
  });
  return Array.from(byBranch.entries())
    .map(([branch, list]) => ({ branch, entries: list }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
}

function _updateSelectionStatus(matchedCount) {
  const el = document.getElementById('str-zd-select-status');
  if (el) el.textContent = `${zdState.selected.size} of ${matchedCount} selected for print`;
}

function renderZdPage() {
  const body = document.getElementById('str-zd-body');
  const statusEl = document.getElementById('str-zd-status');
  const emptyEl = document.getElementById('str-zd-empty');
  if (!body) return;

  const data = StrBridge.getFullData();
  if (!data) {
    if (statusEl) statusEl.textContent = '⏳ Loading STR data…';
    body.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '⏳ Loading STR data…'; }
    return;
  }

  const matched = _matchingHeaders(data);
  // Drop stale selections (STR no longer matches, e.g. it got
  // dispatched since the last look) so the print/status counts never
  // lie about what's actually still on screen.
  const matchedIds = new Set(matched.map(x => x.h.strId));
  Array.from(zdState.selected).forEach(id => { if (!matchedIds.has(id)) zdState.selected.delete(id); });

  if (statusEl) {
    statusEl.textContent = `${matched.length.toLocaleString()} STR(s) with zero-dispatch lines · synced ${new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} · rolling 7-day window`;
  }
  _updateSelectionStatus(matched.length);

  if (!matched.length) {
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '✅ No zero-dispatch lines match these filters.'; }
    body.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const branchGroups = _groupedByBranch(matched);
  body.innerHTML = branchGroups.map(g => _branchGroupHtml(g.branch, g.entries)).join('');

  _renderColsPanel();
}

// ── Filters — identical shape/behavior to the other two STR pages.
function strZdSetSearch(value) { zdState.search = value; renderZdPage(); }
function strZdSetStage(mode) {
  zdState.stageFilter = mode;
  document.querySelectorAll('#page-str-zero-dispatch .str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === mode));
  renderZdPage();
}
function strZdSetBranchFilter(mode) {
  zdState.branchFilter = zdState.branchFilter === mode ? 'all' : mode;
  document.getElementById('str-zd-chip-dispatched')?.classList.toggle('str-chip-active', zdState.branchFilter === 'dispatched');
  document.getElementById('str-zd-chip-received')?.classList.toggle('str-chip-active', zdState.branchFilter === 'received');
  renderZdPage();
}
function strZdSetDateFrom(value) { zdState.dateFrom = value; renderZdPage(); }
function strZdSetDateTo(value) { zdState.dateTo = value; renderZdPage(); }
function strZdClearFilters() {
  zdState.search = ''; zdState.stageFilter = 'all'; zdState.branchFilter = 'all';
  zdState.dateFrom = ''; zdState.dateTo = '';
  const s = document.getElementById('str-zd-search-input'); if (s) s.value = '';
  const df = document.getElementById('str-zd-date-from'); if (df) df.value = '';
  const dt = document.getElementById('str-zd-date-to'); if (dt) dt.value = '';
  document.querySelectorAll('#page-str-zero-dispatch .str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === 'all'));
  document.getElementById('str-zd-chip-dispatched')?.classList.remove('str-chip-active');
  document.getElementById('str-zd-chip-received')?.classList.remove('str-chip-active');
  renderZdPage();
}
async function strZdRefresh() {
  const statusEl = document.getElementById('str-zd-status');
  if (statusEl) statusEl.textContent = '⏳ Syncing…';
  await StrBridge.refreshFullData(true);
  renderZdPage();
}

// ── Manageable columns — same pattern as str-report-native.js.
function _renderColsPanel() {
  const panel = document.getElementById('str-zd-cols-panel');
  if (!panel) return;
  panel.style.display = zdState.colsOpen ? 'block' : 'none';
  panel.innerHTML = COLUMN_DEFS.map(c => `
    <label class="str-rpt-col-toggle">
      <input type="checkbox" ${zdState.cols[c.key] ? 'checked' : ''} onchange="strZdToggleCol('${c.key}', this.checked)">
      ${c.label}
    </label>`).join('');
}
function strZdToggleColsPanel() {
  zdState.colsOpen = !zdState.colsOpen;
  _renderColsPanel();
}
function strZdToggleCol(key, checked) {
  zdState.cols[key] = !!checked;
  _saveCols();
  renderZdPage();
  zdState.colsOpen = true; // renderZdPage's _renderColsPanel would otherwise hide it after a re-render
  _renderColsPanel();
}

// ── Print selection — per-STR checkbox + Select All/None.
function strZdToggleSelect(strId, checked) {
  if (checked) zdState.selected.add(strId); else zdState.selected.delete(strId);
  const data = StrBridge.getFullData();
  const matched = data ? _matchingHeaders(data) : [];
  _updateSelectionStatus(matched.length);
}
function strZdSelectAll() {
  const data = StrBridge.getFullData();
  if (!data) return;
  const matched = _matchingHeaders(data);
  matched.forEach(x => zdState.selected.add(x.h.strId));
  renderZdPage();
}
function strZdSelectNone() {
  zdState.selected.clear();
  renderZdPage();
}

// Tapping a STR block header jumps to the list page's existing detail
// modal — same tap-to-drill pattern as the other two STR pages.
function strZdOpenDetail(strId) {
  window.location.hash = '#str';
  setTimeout(() => { if (typeof window.strOpenDetail === 'function') window.strOpenDetail(strId); }, 60);
}

// ── Print — only the checked STRs, same branch > STR > supplier
// nesting and print.js door as str-report-native.js's strReportPrint.
function strZdPrint() {
  const data = StrBridge.getFullData();
  if (!data || typeof window.Print === 'undefined') return;
  const matched = _matchingHeaders(data).filter(x => zdState.selected.has(x.h.strId));
  if (!matched.length) { alert('Select at least one STR to print (tick its checkbox above).'); return; }

  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const cols = COLUMN_DEFS.filter(c => zdState.cols[c.key]);
  const colCount = 2 + cols.length;

  const cellsHtml = li => {
    const map = {
      price: S.fmtMoney(li.productPrice),
      strQty: S.fmtQty(li.packStrQty),
      dispatchQty: S.fmtQty(li.packDispatchQty),
    };
    return cols.map(c => `<td style="padding:5px 6px;border:1px solid #ddd;font-size:11px;text-align:center">${map[c.key]}</td>`).join('');
  };

  const branchGroups = _groupedByBranch(matched);
  const branchesHtml = branchGroups.map(bg => {
    const strsHtml = bg.entries.map(x => {
      const h = x.h;
      let sr = 1;
      const groupsHtml = x.groups.map(g => {
        const rows = g.rows.map((li, i) => {
          const cur = sr++;
          const zebra = i % 2 === 1 ? 'background:#fafafa;' : '';
          return `<tr style="${zebra}">
            <td style="padding:5px 6px;border:1px solid #ddd;font-size:11px;text-align:center">${cur}</td>
            <td style="padding:5px 6px;border:1px solid #ddd;font-size:11px;text-align:left">[${S.esc(li.productCode)}] ${S.esc(li.productName)}</td>
            ${cellsHtml(li)}
          </tr>`;
        }).join('');
        return `<tr><td colspan="${colCount}" style="padding:6px 6px 3px;font-size:11px;font-weight:800;background:#eef0f3;border:1px solid #ddd">${S.esc(g.supplier)}</td></tr>${rows}`;
      }).join('');
      return `
        <div style="margin:0 0 20px;border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid;break-inside:avoid">
          <div style="padding:8px 10px;background:#fafafa;border-bottom:1px solid #ddd">
            <strong style="font-size:12.5px">STR #${S.esc(h.strNumber || h.strId)}</strong>
            <span style="font-size:11px;color:#555"> · ${S.fmtDate(h.strDate)} · ${S.esc(h.dispatchBranch || '—')} → ${S.esc(h.receiveBranch || '—')} · ${S.STAGE_LABEL[S.strStage(h)]}</span>
            ${h.comments ? `<div style="font-size:11px;color:#444;margin-top:3px"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #ddd">
            <thead><tr style="background:#111;color:#fff">
              <th style="padding:5px;font-size:10px;text-align:center;border:1px solid #333">Sr#</th>
              <th style="padding:5px;font-size:10px;text-align:left;border:1px solid #333">Product</th>
              ${cols.map(c => `<th style="padding:5px;font-size:10px;text-align:center;border:1px solid #333">${c.label}</th>`).join('')}
            </tr></thead>
            <tbody>${groupsHtml}</tbody>
          </table>
        </div>`;
    }).join('');
    return `
      <div style="margin:22px 0 14px;padding:8px 0;border-top:3px solid #111;border-bottom:1px solid #111;font-size:13.5px;font-weight:800;display:flex;justify-content:space-between">
        <span>${S.esc(bg.branch)}</span><span>${bg.entries.length} STR(s)</span>
      </div>
      ${strsHtml}`;
  }).join('');

  const html = `<div style="max-width:960px;margin:0 auto;font-family:Arial,sans-serif;color:#111">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:6px">
      <div><h2 style="margin:0;font-size:16px">ZERO DISPATCH STR REPORT</h2><p style="margin:2px 0 0;font-size:11px;color:#666">Printed ${today} · STR Qty &gt; 0, Dispatch Qty = 0</p></div>
      <div style="text-align:right;font-size:12px">${matched.length} STR(s) selected</div>
    </div>
    ${branchesHtml}
  </div>`;

  window.Print.render(html);
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowStrZeroDispatch() {
  renderZdPage();
  StrBridge.refreshFullData(false).then(renderZdPage);
}
export function onBridgeRefresh() {
  const pg = document.getElementById('page-str-zero-dispatch');
  if (pg && pg.classList.contains('on')) renderZdPage();
}

window.strZdSetSearch = strZdSetSearch;
window.strZdSetStage = strZdSetStage;
window.strZdSetBranchFilter = strZdSetBranchFilter;
window.strZdSetDateFrom = strZdSetDateFrom;
window.strZdSetDateTo = strZdSetDateTo;
window.strZdClearFilters = strZdClearFilters;
window.strZdRefresh = strZdRefresh;
window.strZdToggleColsPanel = strZdToggleColsPanel;
window.strZdToggleCol = strZdToggleCol;
window.strZdToggleSelect = strZdToggleSelect;
window.strZdSelectAll = strZdSelectAll;
window.strZdSelectNone = strZdSelectNone;
window.strZdOpenDetail = strZdOpenDetail;
window.strZdPrint = strZdPrint;
window.strZdOnShow = onShowStrZeroDispatch;
window.strZdNativeOnRefresh = onBridgeRefresh;
