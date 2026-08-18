// ══════════════════════════════════════════════════════════════════════
// STR REPORT NATIVE  —  "Report" sub-tab under STR (Aug 2026)
//
// Same read-only StrBridge data as str-native.js's list + detail modal,
// but flattened: every STR currently matching the filters, open at
// once, nested:
//
//   Dispatch Branch (e.g. WAREHOUSE / WAREHOUSE-2 / BAHRIA TOWN)
//     └─ STR # (+ its Comments, if any)
//          └─ Supplier (product code ascending)
//               └─ line items
//
// All the same filters as the list page (search / stage / branch /
// date range — see str-shared.js's filterHeaders, the one engine both
// pages call) plus a manageable-columns picker (persisted per-device)
// and a printable version via print.js's Print.render(), same "one
// door" every other report in this app funnels through.
//
// Pack-qty conversion, supplier grouping, and diff math are all
// str-shared.js's — this file only ever adds one more grouping level
// (by dispatch branch, then by STR) on top of what that module already
// gives str-native.js's per-STR detail modal.
// ══════════════════════════════════════════════════════════════════════

import * as StrBridge from './str-bridge.js';
import * as S from './str-shared.js';

const COLS_KEY = 'bt_str_report_cols_v1';
// Product is always shown (it's the row identity); these five are
// togglable. Order here is display order.
const COLUMN_DEFS = [
  { key: 'price', label: 'R. Price' },
  { key: 'strQty', label: 'STR Qty (Pack)' },
  { key: 'dispatchQty', label: 'Dispatch Qty (Pack)' },
  { key: 'receiveQty', label: 'Receive Qty (Pack)' },
  { key: 'diff', label: 'Difference' },
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
  try { localStorage.setItem(COLS_KEY, JSON.stringify(rptState.cols)); } catch (e) { /* best-effort */ }
}

// ── Page state — same filter shape as str-native.js's strState (all of
// it just gets handed straight to str-shared.js's filterHeaders), plus
// this page's own column-visibility + columns-panel-open state.
const rptState = {
  search: '', stageFilter: 'all', branchFilter: 'all',
  dateFrom: '', dateTo: '', cols: _loadCols(), colsOpen: false,
};

function _colCount() { return 2 + COLUMN_DEFS.filter(c => rptState.cols[c.key]).length; } // Sr# + Product + enabled

function _colHeadHtml() {
  return COLUMN_DEFS.filter(c => rptState.cols[c.key])
    .map(c => `<th style="text-align:right">${c.label}</th>`).join('');
}

function _lineRowCellsHtml(li) {
  const diff = S.diffQty(li);
  const diffHtml = diff === null ? '' : `<span style="color:${diff === 0 ? 'var(--muted)' : diff < 0 ? '#dc2626' : '#047857'}">${diff > 0 ? '+' : ''}${diff}</span>`;
  const cells = {
    price: `<td style="text-align:right">${S.fmtMoney(li.productPrice)}</td>`,
    strQty: `<td style="text-align:right">${S.fmtQty(li.packStrQty)}</td>`,
    dispatchQty: `<td style="text-align:right">${S.fmtQty(li.packDispatchQty)}</td>`,
    receiveQty: `<td style="text-align:right">${S.fmtQty(li.packReceiveQty)}</td>`,
    diff: `<td style="text-align:right">${diffHtml}</td>`,
  };
  return COLUMN_DEFS.filter(c => rptState.cols[c.key]).map(c => cells[c.key]).join('');
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

// One STR's block: header strip (STR #, date, status, To/From, item
// count) + its Comments (if any) + its supplier groups.
function _strBlockHtml(data, h) {
  const groups = S.groupedLineItems(data, h.strId);
  let sr = 1;
  const groupsHtml = groups.map(g => { const html = _supplierGroupHtml(g, sr); sr += g.rows.length; return html; }).join('');
  const stage = S.strStage(h);
  const itemCount = groups.reduce((s, g) => s + g.rows.length, 0);

  return `
    <div class="str-rpt-str-block">
      <div class="str-rpt-str-head" onclick="strReportOpenDetail(${h.strId})">
        <div class="str-rpt-str-head-main">
          <span class="str-rpt-str-num">STR #${S.esc(h.strNumber || h.strId)}</span>
          <span class="str-badge ${S.STAGE_BADGE_CLASS[stage]}">${S.STAGE_LABEL[stage]}</span>
        </div>
        <div class="str-rpt-str-head-sub">
          ${S.fmtDate(h.strDate)} · ${S.esc(h.dispatchBranch || '—')} → ${S.esc(h.receiveBranch || '—')} · ${itemCount} item(s)
        </div>
        ${h.comments ? `<div class="str-rpt-str-comment"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
      </div>
      <table class="str-detail-table str-rpt-table">
        <thead><tr>
          <th style="width:32px">Sr#</th><th>Product</th>
          ${_colHeadHtml()}
        </tr></thead>
        <tbody>
          ${groupsHtml || `<tr><td colspan="${_colCount()}" style="text-align:center;color:var(--muted);padding:12px">No line items synced for this STR.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// Top grouping level: dispatch branch. Each branch group lists every
// matching STR (newest first, same order str-shared.js's
// filterHeaders already sorts in) as its own block.
function _branchGroupHtml(data, branchName, headers) {
  const strCount = headers.length;
  const blocksHtml = headers.map(h => _strBlockHtml(data, h)).join('');
  return `
    <div class="str-rpt-branch-group">
      <div class="str-rpt-branch-head">
        <span>${S.esc(branchName)}</span>
        <span class="str-rpt-branch-count">${strCount} STR(s)</span>
      </div>
      ${blocksHtml}
    </div>`;
}

function _groupedByBranch(data, headers) {
  const byBranch = new Map();
  headers.forEach(h => {
    const branch = h.dispatchBranch || 'Unknown Branch';
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(h);
  });
  return Array.from(byBranch.entries())
    .map(([branch, hs]) => ({ branch, headers: hs }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
}

function renderReportPage() {
  const body = document.getElementById('str-report-body');
  const statusEl = document.getElementById('str-report-status');
  const emptyEl = document.getElementById('str-report-empty');
  if (!body) return;

  const data = StrBridge.getFullData();
  if (!data) {
    if (statusEl) statusEl.textContent = '⏳ Loading STR data…';
    body.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '⏳ Loading STR data…'; }
    return;
  }

  const visible = S.filterHeaders(data, rptState);
  if (statusEl) {
    statusEl.textContent = `${visible.length.toLocaleString()} of ${data.headers.length.toLocaleString()} STR(s) · synced ${new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} · rolling 7-day window`;
  }

  if (!visible.length) {
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '🔍 No STRs match these filters.'; }
    body.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const branchGroups = _groupedByBranch(data, visible);
  body.innerHTML = branchGroups.map(g => _branchGroupHtml(data, g.branch, g.headers)).join('');

  _renderColsPanel();
}

// ── Filters — identical shape/behavior to str-native.js's, just aimed
// at this page's own DOM ids and re-rendering this page instead.
function strReportSetSearch(value) { rptState.search = value; renderReportPage(); }
function strReportSetStage(mode) {
  rptState.stageFilter = mode;
  document.querySelectorAll('#page-str-report .str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === mode));
  renderReportPage();
}
function strReportSetBranchFilter(mode) {
  rptState.branchFilter = rptState.branchFilter === mode ? 'all' : mode;
  document.getElementById('str-report-chip-dispatched')?.classList.toggle('str-chip-active', rptState.branchFilter === 'dispatched');
  document.getElementById('str-report-chip-received')?.classList.toggle('str-chip-active', rptState.branchFilter === 'received');
  renderReportPage();
}
function strReportSetDateFrom(value) { rptState.dateFrom = value; renderReportPage(); }
function strReportSetDateTo(value) { rptState.dateTo = value; renderReportPage(); }
function strReportClearFilters() {
  rptState.search = ''; rptState.stageFilter = 'all'; rptState.branchFilter = 'all';
  rptState.dateFrom = ''; rptState.dateTo = '';
  const s = document.getElementById('str-report-search-input'); if (s) s.value = '';
  const df = document.getElementById('str-report-date-from'); if (df) df.value = '';
  const dt = document.getElementById('str-report-date-to'); if (dt) dt.value = '';
  document.querySelectorAll('#page-str-report .str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === 'all'));
  document.getElementById('str-report-chip-dispatched')?.classList.remove('str-chip-active');
  document.getElementById('str-report-chip-received')?.classList.remove('str-chip-active');
  renderReportPage();
}
async function strReportRefresh() {
  const statusEl = document.getElementById('str-report-status');
  if (statusEl) statusEl.textContent = '⏳ Syncing…';
  await StrBridge.refreshFullData(true);
  renderReportPage();
}

// ── Manageable columns — small toggle panel, persisted in
// localStorage (per-device — same pattern used elsewhere in this app
// for UI prefs, e.g. excess-working.js's retain list).
function _renderColsPanel() {
  const panel = document.getElementById('str-report-cols-panel');
  if (!panel) return;
  panel.style.display = rptState.colsOpen ? 'block' : 'none';
  panel.innerHTML = COLUMN_DEFS.map(c => `
    <label class="str-rpt-col-toggle">
      <input type="checkbox" ${rptState.cols[c.key] ? 'checked' : ''} onchange="strReportToggleCol('${c.key}', this.checked)">
      ${c.label}
    </label>`).join('');
}
function strReportToggleColsPanel() {
  rptState.colsOpen = !rptState.colsOpen;
  _renderColsPanel();
}
function strReportToggleCol(key, checked) {
  rptState.cols[key] = !!checked;
  _saveCols();
  renderReportPage();
  rptState.colsOpen = true; // renderReportPage's _renderColsPanel would otherwise hide it after a re-render
  _renderColsPanel();
}

// Tapping a STR block header jumps to the existing list page's detail
// modal — same tap-to-drill pattern as the list rows, no need for a
// second copy of the full-detail view here.
function strReportOpenDetail(strId) {
  window.location.hash = '#str';
  setTimeout(() => { if (typeof window.strOpenDetail === 'function') window.strOpenDetail(strId); }, 60);
}

// ── Print — flattened, all-currently-filtered-STRs version of
// str-native.js's strPrintDetail, same branch → STR → supplier nesting
// as the on-screen report, respecting the same column selection.
function strReportPrint() {
  const data = StrBridge.getFullData();
  if (!data || typeof window.Print === 'undefined') return;
  const visible = S.filterHeaders(data, rptState);
  if (!visible.length) return;

  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const cols = COLUMN_DEFS.filter(c => rptState.cols[c.key]);
  const colCount = 2 + cols.length;

  const cellsHtml = li => {
    const diff = S.diffQty(li);
    const map = {
      price: S.fmtMoney(li.productPrice),
      strQty: S.fmtQty(li.packStrQty),
      dispatchQty: S.fmtQty(li.packDispatchQty),
      receiveQty: S.fmtQty(li.packReceiveQty),
      diff: diff === null ? '' : (diff > 0 ? '+' : '') + diff,
    };
    return cols.map(c => `<td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:right">${map[c.key]}</td>`).join('');
  };

  const branchGroups = _groupedByBranch(data, visible);
  const branchesHtml = branchGroups.map(bg => {
    const strsHtml = bg.headers.map(h => {
      const groups = S.groupedLineItems(data, h.strId);
      let sr = 1;
      const groupsHtml = groups.map(g => {
        const rows = g.rows.map(li => {
          const cur = sr++;
          return `<tr>
            <td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:center">${cur}</td>
            <td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px">[${S.esc(li.productCode)}] ${S.esc(li.productName)}</td>
            ${cellsHtml(li)}
          </tr>`;
        }).join('');
        return `<tr><td colspan="${colCount}" style="padding:6px 6px 3px;font-size:11px;font-weight:800;background:#f3f4f6">${S.esc(g.supplier)}</td></tr>${rows}`;
      }).join('');
      return `
        <div style="margin:10px 0 4px;padding:6px 8px;background:#fafafa;border:1px solid #e5e5e5;border-radius:6px">
          <strong style="font-size:12px">STR #${S.esc(h.strNumber || h.strId)}</strong>
          <span style="font-size:11px;color:#555"> · ${S.fmtDate(h.strDate)} · ${S.esc(h.dispatchBranch || '—')} → ${S.esc(h.receiveBranch || '—')} · ${S.STAGE_LABEL[S.strStage(h)]}</span>
          ${h.comments ? `<div style="font-size:11px;color:#444;margin-top:2px"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
          <thead><tr style="background:#111;color:#fff">
            <th style="padding:5px;font-size:10px;text-align:center">Sr#</th>
            <th style="padding:5px;font-size:10px;text-align:left">Product</th>
            ${cols.map(c => `<th style="padding:5px;font-size:10px;text-align:right">${c.label}</th>`).join('')}
          </tr></thead>
          <tbody>${groupsHtml}</tbody>
        </table>`;
    }).join('');
    return `
      <div style="margin-top:14px;padding:6px 0;border-top:2px solid #111;border-bottom:1px solid #111;font-size:13px;font-weight:800;display:flex;justify-content:space-between">
        <span>${S.esc(bg.branch)}</span><span>${bg.headers.length} STR(s)</span>
      </div>
      ${strsHtml}`;
  }).join('');

  const html = `<div style="max-width:960px;margin:0 auto;font-family:Arial,sans-serif;color:#111">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:6px">
      <div><h2 style="margin:0;font-size:16px">STR REPORT — ALL TRANSFERS</h2><p style="margin:2px 0 0;font-size:11px;color:#666">Printed ${today}</p></div>
      <div style="text-align:right;font-size:12px">${visible.length} STR(s) in this report</div>
    </div>
    ${branchesHtml}
  </div>`;

  window.Print.render(html);
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowStrReportAll() {
  renderReportPage();
  StrBridge.refreshFullData(false).then(renderReportPage);
}
export function onBridgeRefresh() {
  const pg = document.getElementById('page-str-report');
  if (pg && pg.classList.contains('on')) renderReportPage();
}

window.strReportSetSearch = strReportSetSearch;
window.strReportSetStage = strReportSetStage;
window.strReportSetBranchFilter = strReportSetBranchFilter;
window.strReportSetDateFrom = strReportSetDateFrom;
window.strReportSetDateTo = strReportSetDateTo;
window.strReportClearFilters = strReportClearFilters;
window.strReportRefresh = strReportRefresh;
window.strReportToggleColsPanel = strReportToggleColsPanel;
window.strReportToggleCol = strReportToggleCol;
window.strReportOpenDetail = strReportOpenDetail;
window.strReportPrint = strReportPrint;
window.strReportOnShow = onShowStrReportAll;
window.strReportNativeOnRefresh = onBridgeRefresh;
