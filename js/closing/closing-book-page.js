// CLOSING (native) — Closing Book page: latest summary, entries, shortcut controls and page render.

import * as ClosingBridge from './closing-bridge.js';
import { escapeHtml as esc } from '../shared/html.js';
import { aggregateBooksAndReturnsSinceLastFinal, clFmt, daySlots, isRealSheet, localDateStr, n, sheetSortKey, srLabel, timelineStep } from './closing-engine.js';

// ═══════════════════════════════════════════════════════════════════
// CLOSING BOOK
// ═══════════════════════════════════════════════════════════════════

function buildLatestSummary(cdb) {
  const savedKeys = Object.keys(cdb.sheets || {}).filter(k => isRealSheet(cdb.sheets[k]));
  if (!savedKeys.length) return null;
  savedKeys.sort((a, b) => sheetSortKey(cdb, a).localeCompare(sheetSortKey(cdb, b)));
  const latestKey = savedKeys[savedKeys.length - 1];
  const rec = cdb.sheets[latestKey];
  const [ds, shift] = latestKey.split('_');
  let totalBooks, totalManRet;
  if (rec.profileMode === 'final') {
    totalBooks = n(rec.inBook1) + n(rec.inBook2);
    totalManRet = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
  } else {
    const agg = aggregateBooksAndReturnsSinceLastFinal(cdb, ds, shift);
    totalBooks = agg.totalBookBills; totalManRet = agg.totalManualReturns;
  }
  return { key: latestKey, date: ds, shift, label: srLabel(shift), carriedCC: n(rec.outPrevCC), totalDeposits: n(rec.outTotalF), totalBooks, totalManRet };
}

// Ported from closing-book.js's enumerateClosingBookEntries()
export function enumerateEntries(cdb, fromDs, fromShift, toDs, toShift) {
  const entries = [];
  let d = new Date(fromDs + 'T00:00:00');
  const end = new Date(toDs + 'T00:00:00');
  while (d <= end) {
    const ds = localDateStr(d);
    const isFirstDay = ds === fromDs, isLastDay = ds === toDs;
    const slots = daySlots(cdb, ds);
    const fromIdx = isFirstDay ? slots.findIndex(s => s.shift === fromShift) : -1;
    const toIdx = isLastDay ? slots.findIndex(s => s.shift === toShift) : -1;
    slots.forEach((s, idx) => {
      if (isFirstDay && fromIdx !== -1 && idx < fromIdx) return;
      if (isLastDay && toIdx !== -1 && idx > toIdx) return;
      entries.push({ date: ds, shift: s.shift, key: `${ds}_${s.shift}` });
    });
    d.setDate(d.getDate() + 1);
  }
  return entries;
}

const cbState = { fromDs: '', fromShift: 'Night', toDs: '', toShift: 'Evening' };

export function cbSetShortcutDays(days) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  cbState.fromDs = localDateStr(from); cbState.fromShift = 'Night';
  cbState.toDs = localDateStr(today); cbState.toShift = 'Evening';
  _cbSyncInputs();
}
export function cbSetShortcutClosings(cdb, count) {
  const savedKeys = Object.keys(cdb.sheets || {}).filter(k => isRealSheet(cdb.sheets[k]));
  let toDs, toShift;
  if (savedKeys.length) {
    savedKeys.sort((a, b) => sheetSortKey(cdb, a).localeCompare(sheetSortKey(cdb, b)));
    const parts = savedKeys[savedKeys.length - 1].split('_');
    toDs = parts[0]; toShift = parts[1];
  } else { toDs = localDateStr(new Date()); toShift = 'Evening'; }
  const start = timelineStep(cdb, toDs, toShift, -(count - 1));
  cbState.fromDs = start.date; cbState.fromShift = start.shift;
  cbState.toDs = toDs; cbState.toShift = toShift;
  _cbSyncInputs();
}
function _cbSyncInputs() {
  const g = id => document.getElementById(id);
  if (g('cln-cb-from-date')) g('cln-cb-from-date').value = cbState.fromDs;
  if (g('cln-cb-from-shift')) g('cln-cb-from-shift').value = cbState.fromShift;
  if (g('cln-cb-to-date')) g('cln-cb-to-date').value = cbState.toDs;
  if (g('cln-cb-to-shift')) g('cln-cb-to-shift').value = cbState.toShift;
}

export function renderClosingBookPage() {
  const container = document.getElementById('page-closing-book');
  if (!container) return;
  const cdb = ClosingBridge.getFullDb();
  const summaryEl = document.getElementById('cln-cb-summary');
  if (!cdb) {
    if (summaryEl) summaryEl.innerHTML = `<div class="cln-empty">⏳ Waiting for the first sync from Closing…</div>`;
    return;
  }
  const summary = buildLatestSummary(cdb);
  if (summaryEl) {
    summaryEl.innerHTML = !summary ? `<div class="cln-empty">📭 No closings recorded yet.</div>` : `
      <div class="cb-summary-head">📊 LATEST CLOSING SUMMARY</div>
      <div class="cb-summary-date">${esc(summary.date)} — ${esc(summary.label)}</div>
      <div class="cb-summary-grid">
        <div class="cb-summary-cell"><div class="cb-summary-label">Carried CC</div><div class="cb-summary-val">${clFmt(summary.carriedCC)}</div></div>
        <div class="cb-summary-cell"><div class="cb-summary-label">Total Deposits</div><div class="cb-summary-val">${clFmt(summary.totalDeposits)}</div></div>
        <div class="cb-summary-cell"><div class="cb-summary-label">Book Bills</div><div class="cb-summary-val">${clFmt(summary.totalBooks)}</div></div>
        <div class="cb-summary-cell"><div class="cb-summary-label">Manual Returns</div><div class="cb-summary-val">${clFmt(summary.totalManRet)}</div></div>
      </div>`;
  }
  if (!cbState.fromDs) cbSetShortcutDays(3);
  else _cbSyncInputs();
}
