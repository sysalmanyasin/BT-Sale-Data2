// ══════════════════════════════════════════════════════════════════════
// STR NATIVE  —  STR Report tab (Stock Transfer Records)
//
// Read-only browser over Pharmacy Audit Hub's shared, Supabase-synced
// STR data (see str-bridge.js's header note — rolling last-7-days
// window only). Same "read-only bridge" principle as BT Inventory
// (inventory-native.js) and Assignments (audit-native.js): list page +
// tap-a-row detail modal, no writes.
//
// Formatting/stage/pack/grouping/filter logic lives in str-shared.js
// now (Aug 2026) — shared with str-report-native.js's flattened,
// all-STRs "Report" sub-tab, so the two pages can never drift on what
// "Awaited" or "pack qty" means. This file just wires that shared
// logic to this page's DOM.
//
// Detail modal reproduces the source system's own "Stock Transfer
// Report" printout (see the sample PDF this was built against) as
// closely as the synced columns allow, with two deliberate differences
// asked for over that original layout:
//   1. No warranty/signature block — that's specific to a physical,
//      hand-signed copy, not this read-only digital view.
//   2. Line items are grouped by supplier (joined client-side from
//      inventory_products via str-bridge.js's supplierByCode map — see
//      that file's header note on why the join has to happen here
//      rather than at the DB) and sorted by product code ascending
//      within each supplier group, instead of the source system's
//      original per-line order.
// ══════════════════════════════════════════════════════════════════════

import * as StrBridge from './str-bridge.js';
import * as S from './str-shared.js';

// ── Page state ────────────────────────────────────────────────────────
const strState = {
  search: '', stageFilter: 'all', branchFilter: 'all', // 'all' | 'dispatched' | 'received'
  dateFrom: '', dateTo: '', detailStrId: null,
};

function _visibleHeaders(data) {
  return S.filterHeaders(data, strState);
}

function _rowHtml(h, itemCount) {
  const stage = S.strStage(h);
  return `<tr class="str-row" onclick="strOpenDetail(${h.strId})">
    <td>
      <div style="font-size:13px;font-weight:700;color:var(--text)">${S.esc(h.strNumber || '—')}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">Master ${S.esc(h.masterStrId || '—')}</div>
    </td>
    <td style="font-size:12px;color:var(--text)">${S.fmtDate(h.strDate)}</td>
    <td style="font-size:11.5px;color:var(--t2)">${S.esc(h.dispatchBranch || '—')} → ${S.esc(h.receiveBranch || '—')}</td>
    <td><span class="str-badge ${S.STAGE_BADGE_CLASS[stage]}">${S.STAGE_LABEL[stage]}</span></td>
    <td style="font-size:11.5px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${S.esc(h.comments || '')}">${S.esc(h.comments || '—')}</td>
    <td style="text-align:left;font-size:12px;color:var(--text)">${itemCount}</td>
  </tr>`;
}

function renderStrPage() {
  const tbody = document.getElementById('str-table-body');
  const statusEl = document.getElementById('str-status');
  const emptyEl = document.getElementById('str-empty-state');
  const wrapEl = document.getElementById('str-table-wrap');
  const dispChip = document.getElementById('str-chip-dispatched');
  const recvChip = document.getElementById('str-chip-received');
  if (!tbody) return;

  const data = StrBridge.getFullData();
  if (!data) {
    if (statusEl) statusEl.textContent = '⏳ Loading STR data…';
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '⏳ Loading STR data…'; }
    if (wrapEl) wrapEl.style.display = 'none';
    return;
  }

  const dispatchedCount = data.headers.filter(S.isDispatchedFromBT).length;
  const receivedCount = data.headers.filter(S.isReceivedAtBT).length;
  if (dispChip) dispChip.querySelector('.str-chip-count').textContent = dispatchedCount;
  if (recvChip) recvChip.querySelector('.str-chip-count').textContent = receivedCount;

  if (statusEl) {
    statusEl.textContent = `${data.headers.length.toLocaleString()} STR(s) · synced ${new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} · rolling 7-day window`;
  }

  const visible = _visibleHeaders(data);
  if (!visible.length) {
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = '🔍 No STRs match these filters.'; }
    if (wrapEl) wrapEl.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (wrapEl) wrapEl.style.display = 'block';

  tbody.innerHTML = visible.map(h => _rowHtml(h, S.lineItemsForStr(data, h.strId).length)).join('');
}

function strSetSearch(value) {
  strState.search = value;
  renderStrPage();
}
function strSetStage(mode) {
  strState.stageFilter = mode;
  document.querySelectorAll('.str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === mode));
  renderStrPage();
}
function strSetBranchFilter(mode) {
  strState.branchFilter = strState.branchFilter === mode ? 'all' : mode;
  document.getElementById('str-chip-dispatched')?.classList.toggle('str-chip-active', strState.branchFilter === 'dispatched');
  document.getElementById('str-chip-received')?.classList.toggle('str-chip-active', strState.branchFilter === 'received');
  renderStrPage();
}
function strSetDateFrom(value) { strState.dateFrom = value; renderStrPage(); }
function strSetDateTo(value) { strState.dateTo = value; renderStrPage(); }
function strClearFilters() {
  strState.search = ''; strState.stageFilter = 'all'; strState.branchFilter = 'all';
  strState.dateFrom = ''; strState.dateTo = '';
  const s = document.getElementById('str-search-input'); if (s) s.value = '';
  const df = document.getElementById('str-date-from'); if (df) df.value = '';
  const dt = document.getElementById('str-date-to'); if (dt) dt.value = '';
  document.querySelectorAll('.str-stage-btn').forEach(b => b.classList.toggle('str-stage-btn-active', b.dataset.stage === 'all'));
  document.getElementById('str-chip-dispatched')?.classList.remove('str-chip-active');
  document.getElementById('str-chip-received')?.classList.remove('str-chip-active');
  renderStrPage();
}

async function strRefresh() {
  const statusEl = document.getElementById('str-status');
  if (statusEl) statusEl.textContent = '⏳ Syncing…';
  await StrBridge.refreshFullData(true);
  renderStrPage();
  if (strState.detailStrId != null) renderStrDetail();
}

// ── Detail modal ─────────────────────────────────────────────────────
function _detailLineRowHtml(li, sr) {
  const diff = S.diffQty(li);
  const diffHtml = diff === null ? '' : `<span style="color:${diff === 0 ? 'var(--muted)' : diff < 0 ? '#dc2626' : '#047857'}">${diff > 0 ? '+' : ''}${diff}</span>`;
  return `<tr class="str-detail-row">
    <td style="text-align:center;color:var(--muted)">${sr}</td>
    <td>
      <span style="color:var(--muted);font-size:11px">[${S.esc(li.productCode || '—')}]</span>
      <span style="font-weight:600">${S.esc(li.productName)}</span>
    </td>
    <td style="text-align:left">${S.fmtMoney(li.productPrice)}</td>
    <td style="text-align:left">${S.fmtQty(li.packStrQty)}</td>
    <td style="text-align:left">${S.fmtQty(li.packDispatchQty)}</td>
    <td style="text-align:left">${S.fmtQty(li.packReceiveQty)}</td>
    <td style="text-align:left">${diffHtml}</td>
  </tr>`;
}

function _detailGroupHtml(group, srStart) {
  const subStr = group.rows.reduce((s, r) => s + (r.packStrQty || 0), 0);
  const subDisp = group.rows.reduce((s, r) => s + (r.packDispatchQty || 0), 0);
  const rowsHtml = group.rows.map((li, i) => _detailLineRowHtml(li, srStart + i)).join('');
  return `
    <tr class="str-detail-supplier-row"><td colspan="7">${S.esc(group.supplier)}</td></tr>
    ${rowsHtml}
    <tr class="str-detail-subtotal-row">
      <td colspan="3">Subtotal — ${group.rows.length} item(s)</td>
      <td style="text-align:left">${S.fmtQty(subStr)}</td>
      <td style="text-align:left">${S.fmtQty(subDisp)}</td>
      <td></td><td></td>
    </tr>`;
}

function _detailHeaderFieldsHtml(h) {
  const field = (label, val) => `<div class="str-detail-field"><span class="str-detail-field-label">${label}</span><span class="str-detail-field-val">${S.esc(val || '—')}</span></div>`;
  return `
    <div class="str-detail-fields-grid">
      ${field('From', h.dispatchBranch)}
      ${field('To', h.receiveBranch)}
      ${field('Master STR #', h.masterStrId)}
      ${field('STR #', h.strNumber)}
      ${field('Media', h.media)}
      ${field('Ref #', h.refNo)}
      ${field('STR Date', S.fmtDate(h.strDate))}
      ${field('STR Status', h.strStatus)}
      ${field('Issued By', h.issuedBy)}
      ${field('Dispatched Date', S.fmtDate(h.dispatchedDate))}
      ${field('Dispatch Status', h.dispatchStatus)}
      ${field('Dispatched By', h.dispatchedBy)}
      ${field('Receive Date', S.fmtDate(h.receiveDate))}
      ${field('Receive Status', h.receiveStatus)}
      ${field('Received By', h.receivedBy)}
      ${field('Cartons', h.noOfBoxes)}
    </div>`;
}

function renderStrDetail() {
  const body = document.getElementById('str-detail-body');
  const titleEl = document.getElementById('str-detail-title');
  if (!body) return;
  const data = StrBridge.getFullData();
  const h = data && data.headers.find(x => x.strId === strState.detailStrId);
  if (!h) {
    body.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:20px 0;text-align:center">Could not load this STR — it may have rolled out of the 7-day sync window.</div>`;
    _updateDetailNavButtons();
    return;
  }

  const groups = S.groupedLineItems(data, h.strId);
  let sr = 1;
  const groupsHtml = groups.map(g => { const html = _detailGroupHtml(g, sr); sr += g.rows.length; return html; }).join('');
  const grandStr = groups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + (r.packStrQty || 0), 0), 0);
  const grandDisp = groups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + (r.packDispatchQty || 0), 0), 0);
  const totalItems = groups.reduce((s, g) => s + g.rows.length, 0);

  if (titleEl) titleEl.textContent = `STR #${h.strNumber || h.strId}`;
  body.innerHTML = `
    ${_detailHeaderFieldsHtml(h)}
    <div class="str-detail-table-wrap">
      <table class="str-detail-table">
        <thead><tr>
          <th style="width:32px">Sr#</th><th>Product</th>
          <th style="text-align:left">R. Price</th>
          <th style="text-align:left">STR Qty (Pack)</th>
          <th style="text-align:left">Dispatch Qty (Pack)</th>
          <th style="text-align:left">Receive Qty (Pack)</th>
          <th style="text-align:left">Difference</th>
        </tr></thead>
        <tbody>
          ${groupsHtml || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">No line items synced for this STR.</td></tr>`}
        </tbody>
        <tfoot><tr class="str-detail-grand-row">
          <td colspan="3">Grand Total — ${totalItems} item(s)</td>
          <td style="text-align:left">${S.fmtQty(grandStr)}</td>
          <td style="text-align:left">${S.fmtQty(grandDisp)}</td>
          <td></td><td></td>
        </tr></tfoot>
      </table>
    </div>
    ${h.comments ? `<div class="str-detail-comments"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
  `;

  _updateDetailNavButtons();
}

// ── Prev / Next — walk the same filtered/sorted list currently on
// screen (_visibleHeaders order), so "next" always matches what the
// person would hit scrolling down the list themselves.
function _detailNavList() {
  const data = StrBridge.getFullData();
  return data ? _visibleHeaders(data) : [];
}
function _updateDetailNavButtons() {
  const list = _detailNavList();
  const idx = list.findIndex(h => h.strId === strState.detailStrId);
  const prevBtn = document.getElementById('str-detail-prev');
  const nextBtn = document.getElementById('str-detail-next');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx === -1 || idx >= list.length - 1;
}
function strPrevDetail() {
  const list = _detailNavList();
  const idx = list.findIndex(h => h.strId === strState.detailStrId);
  if (idx <= 0) return;
  strState.detailStrId = list[idx - 1].strId;
  renderStrDetail();
}
function strNextDetail() {
  const list = _detailNavList();
  const idx = list.findIndex(h => h.strId === strState.detailStrId);
  if (idx === -1 || idx >= list.length - 1) return;
  strState.detailStrId = list[idx + 1].strId;
  renderStrDetail();
}

function strOpenDetail(strId) {
  strState.detailStrId = strId;
  document.getElementById('str-detail-overlay')?.classList.add('str-open');
  renderStrDetail();
}
function strCloseDetail() {
  document.getElementById('str-detail-overlay')?.classList.remove('str-open');
  strState.detailStrId = null;
}

// ── Print — funnels through print.js's Print.render(), same "one door"
// every other report in the app uses (see print.js's header comment).
// No warranty/signature block by design (see this file's header note).
function strPrintDetail() {
  const data = StrBridge.getFullData();
  const h = data && data.headers.find(x => x.strId === strState.detailStrId);
  if (!h || typeof window.Print === 'undefined') return;

  const groups = S.groupedLineItems(data, h.strId);
  let sr = 1;
  const today = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });

  const fieldRow = (label, val) => `<td style="padding:3px 10px 3px 0;font-size:11px;color:#555;white-space:nowrap">${label}</td><td style="padding:3px 16px 3px 0;font-size:12px;font-weight:600">${S.esc(val || '—')}</td>`;

  const groupsHtml = groups.map(g => {
    const subStr = g.rows.reduce((s, r) => s + (r.packStrQty || 0), 0);
    const subDisp = g.rows.reduce((s, r) => s + (r.packDispatchQty || 0), 0);
    const rows = g.rows.map((li, i) => {
      const diff = S.diffQty(li);
      const cur = sr++;
      const zebra = i % 2 === 1 ? 'background:#fafafa;' : '';
      return `<tr style="${zebra}">
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:center">${cur}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px">[${S.esc(li.productCode)}] ${S.esc(li.productName)}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:left">${S.fmtMoney(li.productPrice)}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:left">${S.fmtQty(li.packStrQty)}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:left">${S.fmtQty(li.packDispatchQty)}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:left">${S.fmtQty(li.packReceiveQty)}</td>
        <td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:left">${diff === null ? '' : (diff > 0 ? '+' : '') + diff}</td>
      </tr>`;
    }).join('');
    return `<tr><td colspan="7" style="padding:8px 6px 4px;font-size:11.5px;font-weight:800;background:#eef0f3">${S.esc(g.supplier)}</td></tr>
      ${rows}
      <tr><td colspan="3" style="padding:4px 6px;font-size:11px;font-weight:700;text-align:left">Subtotal (${g.rows.length} item(s))</td>
        <td style="padding:4px 6px;font-size:11px;font-weight:700;text-align:left">${S.fmtQty(subStr)}</td>
        <td style="padding:4px 6px;font-size:11px;font-weight:700;text-align:left">${S.fmtQty(subDisp)}</td>
        <td></td><td></td></tr>`;
  }).join('');

  const grandStr = groups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + (r.packStrQty || 0), 0), 0);
  const grandDisp = groups.reduce((s, g) => s + g.rows.reduce((s2, r) => s2 + (r.packDispatchQty || 0), 0), 0);
  const totalItems = groups.reduce((s, g) => s + g.rows.length, 0);

  const html = `<div style="max-width:900px;margin:0 auto;font-family:Arial,sans-serif;color:#111">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:10px">
      <div><h2 style="margin:0;font-size:16px">STOCK TRANSFER REPORT</h2><p style="margin:2px 0 0;font-size:11px;color:#666">Printed ${today}</p></div>
      <div style="text-align:right;font-size:12px"><strong>STR #${S.esc(h.strNumber)}</strong><br><span style="color:#666;font-size:11px">Master ${S.esc(h.masterStrId)}</span></div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <tr>${fieldRow('From', h.dispatchBranch)}${fieldRow('To', h.receiveBranch)}${fieldRow('Media', h.media)}</tr>
      <tr>${fieldRow('STR Date', S.fmtDate(h.strDate))}${fieldRow('STR Status', h.strStatus)}${fieldRow('Ref #', h.refNo)}</tr>
      <tr>${fieldRow('Dispatched Date', S.fmtDate(h.dispatchedDate))}${fieldRow('Dispatch Status', h.dispatchStatus)}${fieldRow('Dispatched By', h.dispatchedBy)}</tr>
      <tr>${fieldRow('Receive Date', S.fmtDate(h.receiveDate))}${fieldRow('Receive Status', h.receiveStatus)}${fieldRow('Received By', h.receivedBy)}</tr>
      <tr>${fieldRow('Issued By', h.issuedBy)}${fieldRow('Cartons', h.noOfBoxes)}<td></td><td></td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#111;color:#fff">
        <th style="padding:6px;font-size:10.5px;text-align:center">Sr#</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">Product</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">R. Price</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">STR Qty</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">Dispatch Qty</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">Receive Qty</th>
        <th style="padding:6px;font-size:10.5px;text-align:left">Difference</th>
      </tr></thead>
      <tbody>${groupsHtml || `<tr><td colspan="7" style="padding:12px;text-align:center;color:#888;font-size:11px">No line items synced for this STR</td></tr>`}</tbody>
      <tfoot><tr style="border-top:2px solid #111">
        <td colspan="3" style="padding:6px;font-size:12px;font-weight:800">Grand Total — ${totalItems} item(s)</td>
        <td style="padding:6px;font-size:12px;font-weight:800;text-align:left">${S.fmtQty(grandStr)}</td>
        <td style="padding:6px;font-size:12px;font-weight:800;text-align:left">${S.fmtQty(grandDisp)}</td>
        <td></td><td></td>
      </tr></tfoot>
    </table>
    ${h.comments ? `<div style="margin-top:10px;font-size:11px;color:#444"><strong>Comments:</strong> ${S.esc(h.comments)}</div>` : ''}
  </div>`;

  window.Print.render(html);
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowStrReport() {
  renderStrPage();
  StrBridge.refreshFullData(false).then(renderStrPage);
}
export function onBridgeRefresh() {
  renderStrPage();
  if (strState.detailStrId != null) renderStrDetail();
}

window.strSetSearch = strSetSearch;
window.strSetStage = strSetStage;
window.strSetBranchFilter = strSetBranchFilter;
window.strSetDateFrom = strSetDateFrom;
window.strSetDateTo = strSetDateTo;
window.strClearFilters = strClearFilters;
window.strRefresh = strRefresh;
window.strOpenDetail = strOpenDetail;
window.strCloseDetail = strCloseDetail;
window.strPrintDetail = strPrintDetail;
window.strPrevDetail = strPrevDetail;
window.strNextDetail = strNextDetail;
window.strNativeOnRefresh = onBridgeRefresh;
window.strOnShowReport = onShowStrReport;
