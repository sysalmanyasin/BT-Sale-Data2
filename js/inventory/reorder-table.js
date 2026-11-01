// REORDER REPORT — sorting, column model and the table / grouped-body HTML builders.

import { escapeHtml as esc } from '../shared/html.js';
import { fmt, fmtDays, say, state } from './reorder-data.js';

export function sortRows(rows, sort) {
  const key = sort.key, dir = sort.dir;
  const isDaysCover = key.indexOf('daysCover') === 0;
  return [...rows].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av || '').localeCompare(String(bv || '')) * dir;
    }
    if (av == null) av = isDaysCover ? Infinity : 0;
    if (bv == null) bv = isDaysCover ? Infinity : 0;
    return (Number(av) - Number(bv)) * dir;
  });
}

// ---------- COLUMNS ----------
const BASE_COLS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Product Name', wrap: true },
  { key: 'supplier', label: 'Supplier' },
  { key: 'stock', label: 'Stock', num: true },
  { key: 'inTransitQty', label: 'In Transit', num: true },
  { key: 'saleQtyToday', label: 'Sold Today', num: true },
];
function windowCols(w) {
  return [
    { key: 'saleQty' + w, label: 'Sale Qty ' + w + 'd', num: true },
    { key: 'daysCover' + w, label: 'Cover ' + w + 'd', num: true, days: true },
    { key: 'demandQty' + w, label: 'Demand Qty ' + w + 'd', num: true },
  ];
}
export function allCols() {
  return [].concat(BASE_COLS, windowCols(30), windowCols(60), windowCols(90),
    [{ key: 'saleValueP', label: 'Sale Value', num: true, strong: true }]);
}
function isPrimaryWinCol(c, primaryWindow) {
  return /^(saleQty|daysCover|demandQty)\d+$/.test(c.key) && c.key.endsWith(String(primaryWindow));
}
// Cols actually shown in the on-screen table AND fed into Print — hiding
// a column via the Columns dropdown removes it from both in one step.
export function visibleCols(cols) {
  return cols.filter(c => !state.hiddenCols.has(c.key));
}

// ---------- COLUMNS DROPDOWN ----------
export function columnsMenuHtml(allColsList) {
  return `
      <div class="colmenu-wrap${state.colsMenuOpen ? ' open' : ''}" id="rorColMenuWrap">
        <button class="btn btn-sm" type="button" data-action="ror-cols-toggle">
          <span class="material-symbols-outlined">view_column</span>Columns
        </button>
        <div class="colmenu">
          ${allColsList.map(c => `
            <label>
              <input type="checkbox" data-colkey="${esc(c.key)}" ${state.hiddenCols.has(c.key) ? '' : 'checked'}>
              ${esc(c.label)}
            </label>`).join('')}
          <div class="colmenu-foot">
            <button type="button" data-action="ror-cols-all">Show all</button>
          </div>
        </div>
      </div>`;
}

export function theadHtml(cols, sort, primaryWindow) {
  return '<tr>' + cols.map(c => {
    const arrow = sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '';
    const cls = 'sortable' + (c.num ? ' num' : '') + (isPrimaryWinCol(c, primaryWindow) ? ' win-primary' : '');
    return `<th class="${cls}" data-key="${c.key}">${esc(c.label)}<span class="arrow">${arrow}</span></th>`;
  }).join('') + '</tr>';
}

export function rowHtml(r, cols, primaryWindow) {
  // Green highlight = something's already dispatched and physically
  // moving toward this SKU's stock — see buildInTransitMap().
  const trCls = (Number(r.inTransitQty) > 0) ? ' class="row-intransit"' : '';
  return `<tr${trCls}>` + cols.map(c => {
    let v = r[c.key];
    let content = c.days ? fmtDays(v) : (c.num ? fmt(v) : esc(v));
    if (c.key === 'name') content = `${esc(v)}<div class="sub">${esc(r.company || '')}</div>`;
    if (c.key === 'saleValueP') {
      // Sale Value is tax-aware (2026-07-30 fix): incl-tax for taxable
      // products, excl-tax (no tax to add) for exempt ones — surface
      // which one this row is so it's not ambiguous at a glance.
      content += `<div class="hint" style="font-weight:400">${r.isTaxable ? 'incl. tax' : 'no tax'}</div>`;
    }
    const cls = (c.num ? 'num ' : '') + (c.strong ? 'val ' : '') + (c.wrap ? 'wrap ' : '') + (isPrimaryWinCol(c, primaryWindow) ? 'win-primary ' : '');
    return `<td class="${cls.trim()}">${content}</td>`;
  }).join('') + '</tr>';
}

export function groupedBody(list, cols, primaryWindow) {
  const groups = new Map();
  list.forEach(r => {
    const key = r.supplier || 'Unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const groupArr = Array.from(groups.entries()).map(([supplier, items]) => ({
    supplier, items, total: items.reduce((s, r) => s + r.saleValueP, 0)
  })).sort((a, b) => b.total - a.total);
  return groupArr.map(g => {
    const collapsed = state.collapsedGroups.has(g.supplier);
    const header = `
      <tr class="group-header" data-action="ror-group-toggle" data-supplier="${esc(g.supplier)}">
        <td colspan="${cols.length}">
          <span class="material-symbols-outlined group-chev">${collapsed ? 'chevron_right' : 'expand_more'}</span>
          <span class="group-name">${esc(g.supplier)}</span>
          <span class="hint group-count">${g.items.length} item${g.items.length === 1 ? '' : 's'}</span>
          <span class="num group-total">${fmt(g.total)}</span>
        </td>
      </tr>`;
    const body = collapsed ? '' : g.items.map(r => rowHtml(r, cols, primaryWindow)).join('');
    return header + body;
  }).join('');
}

// ---------- EXPORTS ----------
export function exportExcelSheet(aoa, sheetName, filename) {
  if (!window.XLSX) { say('Excel library not loaded', 'e'); return; }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

export function exportPdfTable(title, subLines, headers, rows, filename) {
  if (!window.jspdf) { say('PDF library not loaded', 'e'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 28;
  let y = 38;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(title, margin, y);
  y += 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  (subLines || []).forEach(line => { doc.text(line, margin, y); y += 12; });
  doc.setTextColor(0);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [headers],
    body: rows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [26, 34, 38] },
    alternateRowStyles: { fillColor: [245, 247, 246] },
  });
  doc.setFontSize(7.5); doc.setTextColor(120);
  doc.text('Reorder Report — Bahria Town · auto-generated, figures reflect live data at time of export.', margin, doc.internal.pageSize.getHeight() - 16);
  doc.save(filename);
}

export function rowToAoa(r, cols, rank) {
  const line = rank != null ? [rank] : [];
  cols.forEach(c => line.push(c.days ? (r[c.key] == null ? '' : Math.round(r[c.key] * 10) / 10) : r[c.key]));
  return line;
}
export function rowToPdf(r, cols, rank) {
  const line = rank != null ? [rank] : [];
  cols.forEach(c => line.push(c.days ? fmtDays(r[c.key]) : (c.num ? fmt(r[c.key]) : r[c.key])));
  return line;
}

export function summaryLines() {
  return [
    'Reference date: ' + (state.asOf || '—'),
    'Window: ' + state.window + 'd  ·  Cover threshold: <' + state.coverDays + 'd  ·  Items flagged: ' + state.computed.length,
    'Sale qty/value basis: ' + (state.includeToday ? 'historical window + today (live)' : 'historical window only'),
  ];
}
