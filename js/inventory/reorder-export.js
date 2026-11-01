// REORDER REPORT — Excel / PDF exports and print pages.

import { escapeHtml as esc } from '../shared/html.js';
import { fmt, fmtDays, say, state, todayStamp } from './reorder-data.js';
import { allCols, exportExcelSheet, exportPdfTable, rowToAoa, rowToPdf, sortRows, summaryLines, visibleCols } from './reorder-table.js';

export function exportTopNExcel() {
  const rows = state.topNFlagged;
  if (!rows.length) { say('No flagged items to export yet', 'e'); return; }
  const cols = allCols();
  const aoa = [
    ['Reorder Report — Top ' + rows.length + ' by Sale Value (' + state.window + 'd window)'],
    ['Reference date', state.asOf || ''],
    ['Cover threshold (days)', state.coverDays],
    [],
    ['Rank'].concat(cols.map(c => c.label)),
  ];
  rows.forEach((r, i) => aoa.push(rowToAoa(r, cols, i + 1)));
  exportExcelSheet(aoa, 'Reorder Top ' + rows.length, 'reorder_top' + rows.length + '_' + todayStamp() + '.xlsx');
  say('Top ' + rows.length + ' reorder items exported (.xlsx)');
}

export function exportTopNPdf() {
  const rows = state.topNFlagged;
  if (!rows.length) { say('No flagged items to export yet', 'e'); return; }
  const cols = allCols();
  const body = rows.map((r, i) => rowToPdf(r, cols, i + 1));
  exportPdfTable(
    'Reorder Report — Top ' + rows.length + ' by Sale Value',
    summaryLines(),
    ['#'].concat(cols.map(c => c.label)),
    body,
    'reorder_top' + rows.length + '_' + todayStamp() + '.pdf'
  );
  say('Top ' + rows.length + ' reorder items exported (.pdf)');
}

export function exportAllExcel() {
  if (!state.computed.length) { say('No flagged items to export yet', 'e'); return; }
  const rows = sortRows(state.computed, { key: 'saleValueP', dir: -1 });
  const cols = allCols();
  const aoa = [
    ['Reorder Report — All Flagged (' + state.window + 'd window, cover < ' + state.coverDays + 'd)'],
    ['Reference date', state.asOf || ''],
    [],
    cols.map(c => c.label),
  ];
  rows.forEach(r => aoa.push(rowToAoa(r, cols, null)));
  exportExcelSheet(aoa, 'Reorder All Flagged', 'reorder_all_flagged_' + todayStamp() + '.xlsx');
  say('All flagged items exported (.xlsx)');
}

export function exportAllPdf() {
  if (!state.computed.length) { say('No flagged items to export yet', 'e'); return; }
  const rows = sortRows(state.computed, { key: 'saleValueP', dir: -1 });
  const cols = allCols();
  const body = rows.map(r => rowToPdf(r, cols, null));
  exportPdfTable(
    'Reorder Report — All Flagged Items',
    summaryLines(),
    cols.map(c => c.label),
    body,
    'reorder_all_flagged_' + todayStamp() + '.pdf'
  );
  say('All flagged items exported (.pdf)');
}

// ---------- RENDER ----------
// ---------- PRINT (visible columns only) ----------
// Uses the shared Print engine (js/lib/print.js) — same as every other
// report in the app — instead of window.print(), so it gets the
// standard Generating…/View/Download/Save-to-Library popup. Unlike
// Excel/PDF export (which always include every column), this respects
// whatever the Columns dropdown currently has checked.
function printRowHtml(r, cols) {
  return '<tr>' + cols.map(c => {
    let v = r[c.key];
    let content = c.days ? fmtDays(v) : (c.num ? fmt(v) : esc(v));
    return `<td${c.num ? ' class="r"' : ''}>${content}</td>`;
  }).join('') + '</tr>';
}

function printGroupedBody(list, cols) {
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
    const header = `<tr><td colspan="${cols.length}" style="font-weight:700;background:#f1f5f9;padding:6px 10px;">${esc(g.supplier)} <span style="font-weight:400;color:#64748b">(${g.items.length} item${g.items.length === 1 ? '' : 's'})</span></td></tr>`;
    return header + g.items.map(r => printRowHtml(r, cols)).join('');
  }).join('');
}

function buildPrintHtml(rows, cols, title, subLine) {
  const q = (state.search || '').trim();
  let list = rows;
  if (q) {
    list = (typeof window.BTSearch !== 'undefined')
      ? window.BTSearch.filterAndRank(list, q, ['code', 'name'])
      : list.filter(r => (r.code || '').toLowerCase().includes(q.toLowerCase()) || (r.name || '').toLowerCase().includes(q.toLowerCase()));
  }
  list = sortRows(list, state.sort);
  const today = todayStamp();
  const theadRow = '<tr>' + cols.map(c => `<th${c.num ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('') + '</tr>';
  const bodyRows = state.groupBySupplier ? printGroupedBody(list, cols) : list.map(r => printRowHtml(r, cols)).join('');
  return `<div style="max-width:960px;margin:0 auto">
      <div class="pr-header">
        <div><h1>BAHRIA TOWN SALES IC</h1><p>${esc(title)}</p></div>
        <div class="pr-meta">Printed: ${today}${subLine ? ' · ' + esc(subLine) : ''}</div>
      </div>
      <table class="pr-tbl">
        <thead>${theadRow}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

export function printTopN() {
  const rows = state.topNFlagged || [];
  if (!rows.length) { say('Nothing to print', 'w'); return; }
  const cols = visibleCols(allCols());
  const html = buildPrintHtml(rows, cols, 'Reorder Report — Top ' + state.topN + ' by Sale Value',
    state.window + 'd window · cover under ' + state.coverDays + 'd');
  if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
  else say('Print engine not loaded', 'e');
}

export function printAllFlagged() {
  const rows = state.computed || [];
  if (!rows.length) { say('Nothing to print', 'w'); return; }
  const cols = visibleCols(allCols());
  const html = buildPrintHtml(rows, cols, 'Reorder Report — All Flagged Items',
    state.window + 'd window · cover under ' + state.coverDays + 'd');
  if (window.Print && typeof window.Print.render === 'function') window.Print.render(html);
  else say('Print engine not loaded', 'e');
}
