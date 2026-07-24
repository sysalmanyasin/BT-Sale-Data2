// ══════════════════════════════════════════════════════════════════════
// CLOSING NATIVE  —  Closing Book + Credit Ledger, ported into BT Sales
//
// Read-only pages built directly off the full Closing db (see
// closing-bridge.js's getFullDb()) — the exact same file Closing itself
// reads/writes over Dropbox, already downloaded for the Cover Dashboard
// tile, nothing extra fetched here. Nothing in this file writes back to
// it; this is a pure reporting layer, same "read + re-analyze" rule as
// every other bridge in this app.
//
// The business logic below (daySlots/timelineStep/findLastFinal/
// aggregateSinceLastFinal/credit-snapshot building) is a direct,
// deliberate line-for-line port of Closing's own state.js / components.js
// / actions.js / ledger-engine.js — not reimplemented from scratch, so
// it can't silently drift from what Closing itself would compute for
// the same data.
//
// UPDATE (full parity pass): the paginated flip-book reader —
// print-quality register pages (ps-* markup ported from Closing's
// buildPrintSheet()), cover page, placeholder pages, pinch/zoom/swipe,
// and PDF export via jsPDF + html2canvas — is now ALSO ported below.
// Crucially this does NOT re-derive Closing's financial math from
// scratch: every "out-*"/"final*" figure buildPrintSheet() would have
// read off the live edit form is already sitting on the saved sheet
// record itself (buildSheetRecord() in Closing's actions.js persists
// every one of them), so the shift page is built by reading rec.* the
// same way clBuildSnapshot() above already does — no separate calc()
// port, no risk of silently drifting from what Closing itself saved.
// The one piece of real logic that IS ported (not just read off rec)
// is aggregateSinceLastFinalFull() below, for the Final Aggregation
// page's Part 1 / Part 2 breakdown rows — a direct line-for-line port
// of Closing's own aggregateSinceLastFinal() in actions.js. The
// page's headline figures (finalNetSale/finalNetCash/finalDiff) still
// prefer the persisted rec.final* values where present, so the
// breakdown rows explain the real saved numbers rather than a
// recomputation that could drift from them.
// ══════════════════════════════════════════════════════════════════════

import * as ClosingBridge from './closing-bridge.js';

function n(v) { return parseFloat(v) || 0; }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ── Ported from Closing's state.js (pure, no DOM) ───────────────────
const SHIFT_SR = { Night: 1, Morning: 2, Evening: 3 };
function srLabel(shift) { return `Closing ${SHIFT_SR[shift] || '?'} — ${shift}`; }
function baseSeq(shift) {
  if (shift === 'Night') return 10;
  if (shift === 'Evening') return 9999;
  return 20;
}
function getSeq(cdb, ds, shift) {
  const rec = cdb.sheets[`${ds}_${shift}`];
  if (rec && typeof rec.seq === 'number') return rec.seq;
  return baseSeq(shift);
}
function daySlots(cdb, ds) {
  const prefix = ds + '_';
  const found = new Set(
    Object.keys(cdb.sheets)
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length))
  );
  found.add('Night'); found.add('Morning'); found.add('Evening');
  return Array.from(found)
    .map(shift => ({ shift, seq: getSeq(cdb, ds, shift) }))
    .sort((a, b) => a.seq - b.seq);
}
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Ported from Closing's components.js (pure) ──────────────────────
function isRealSheet(rec) { return !!rec && rec.draft !== true; }
function getRealSheet(cdb, key) { const rec = cdb.sheets[key]; return isRealSheet(rec) ? rec : null; }
function stepOneSlot(cdb, ds, shift, dir) {
  const slots = daySlots(cdb, ds);
  const idx = slots.findIndex(s => s.shift === shift);
  const curIdx = idx === -1 ? (dir > 0 ? -1 : slots.length) : idx;
  const nextIdx = curIdx + dir;
  if (nextIdx >= 0 && nextIdx < slots.length) return { date: ds, shift: slots[nextIdx].shift };
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + dir);
  return dir > 0 ? { date: localDateStr(d), shift: 'Night' } : { date: localDateStr(d), shift: 'Evening' };
}
function timelineStep(cdb, ds, shift, steps) {
  const dir = steps >= 0 ? 1 : -1;
  let cur = { date: ds, shift };
  for (let i = 0; i < Math.abs(steps); i++) cur = stepOneSlot(cdb, cur.date, cur.shift, dir);
  return { key: `${cur.date}_${cur.shift}`, date: cur.date, shift: cur.shift };
}
function sheetSortKey(cdb, k) {
  const parts = k.split('_');
  return parts[0] + '_' + String(getSeq(cdb, parts[0], parts[1])).padStart(6, '0');
}

// ── Ported from Closing's actions.js (pure) ─────────────────────────
function findLastFinal(cdb, ds, shift) {
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
    const rec = getRealSheet(cdb, cur.key || `${cur.date}_${cur.shift}`);
    if (rec && rec.profileMode === 'final') return { key: `${cur.date}_${cur.shift}`, rec };
    if (!rec && i > 200) break;
  }
  return null;
}
// Trimmed to the two fields the Closing Book summary card needs — full
// aggregateSinceLastFinal() in Closing also tracks customers/shift
// sale/system returns/net cash for the sheet's own working card, which
// this read-only report has no use for.
function aggregateBooksAndReturnsSinceLastFinal(cdb, ds, shift) {
  const lastFinal = findLastFinal(cdb, ds, shift);
  let totalBookBills = 0, totalManualReturns = 0;
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    const key = `${cur.date}_${cur.shift}`;
    if (lastFinal && key === lastFinal.key) break;
    const rec = getRealSheet(cdb, key);
    if (!rec) { if (!lastFinal) break; else { cur = timelineStep(cdb, cur.date, cur.shift, -1); continue; } }
    if (rec.profileMode === 'final') break;
    totalManualReturns += n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
    totalBookBills += n(rec.inBook1) + n(rec.inBook2);
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
  }
  return { totalBookBills, totalManualReturns };
}

// ── Ported from Closing's ledger-engine.js (pure) ───────────────────
function clBuildSnapshot(key, rec) {
  const parts = key.split('_');
  const lines = [];
  (rec.namedCredits || []).forEach(o => { const v = n(o.val); if (v !== 0) lines.push({ category: 'named', lbl: o.lbl || 'Named Account', desc: o.desc || '', val: v }); });
  (rec.tierCredits || []).forEach(o => { const v = n(o.val); if (v !== 0 && o.name) lines.push({ category: 'tier', lbl: o.name, val: v }); });
  (rec.auxCredits || []).forEach(o => { const v = n(o.val); if (v !== 0) lines.push({ category: 'aux', lbl: o.lbl || 'Credit Entry', val: v }); });
  return {
    key, date: parts[0] || '', shift: parts[1] || '',
    mode: rec.profileMode || 'shift', savedAt: rec.savedAt || Date.now(),
    openingCredit: n(rec.outPrevCredit), creditAdj: n(rec.creditAdj), totalCredit: n(rec.outTotalE),
    lines
  };
}
// Live-derived every render rather than trusting cdb.creditLedger as
// persisted — a pure map over cdb.sheets is simpler and can't go stale
// relative to whatever's actually in the synced file, same reasoning
// mlAllSnapshots() below already uses for Misc/Ongoing.
function clAllSnapshotsLive(cdb) {
  return Object.entries(cdb.sheets || {}).filter(([, rec]) => isRealSheet(rec)).map(([key, rec]) => clBuildSnapshot(key, rec));
}
function clAllLabels(snapshots) {
  const seen = new Set();
  snapshots.forEach(s => s.lines.forEach(l => seen.add(l.lbl)));
  return Array.from(seen).sort();
}
function clGroupByDate(cdb, snapshots) {
  const sorted = [...snapshots].sort((a, b) => b.date !== a.date ? b.date.localeCompare(a.date) : getSeq(cdb, b.date, b.shift) - getSeq(cdb, a.date, a.shift));
  const groups = [], seen = {};
  sorted.forEach(s => { if (!seen[s.date]) { seen[s.date] = { date: s.date, snaps: [] }; groups.push(seen[s.date]); } seen[s.date].snaps.push(s); });
  return groups;
}
function mlAllSnapshots(cdb) {
  const out = [];
  Object.entries(cdb.sheets || {}).forEach(([key, rec]) => {
    if (!rec || rec.draft) return;
    const rows = (rec.miscRows || []).filter(r => n(r.val) !== 0 || (r.label || '').trim());
    if (!rows.length) return;
    const parts = key.split('_');
    out.push({ key, date: parts[0] || '', shift: parts[1] || '', mode: rec.profileMode || 'shift',
      lines: rows.map(r => ({ lbl: (r.label || '').trim() || 'Untitled', val: n(r.val) })),
      total: rows.reduce((s, r) => s + n(r.val), 0) });
  });
  return out;
}

// ── Format helpers (ported) ──────────────────────────────────────────
function clFmt(v) { return 'Rs. ' + Math.round(Math.abs(v)).toLocaleString(); }
function clFmtSigned(v) { return (v >= 0 ? '+' : '−') + ' Rs. ' + Math.round(Math.abs(v)).toLocaleString(); }
function clFmtDate(ds) { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ds; } }

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
function enumerateEntries(cdb, fromDs, fromShift, toDs, toShift) {
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

function cbSetShortcutDays(days) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  cbState.fromDs = localDateStr(from); cbState.fromShift = 'Night';
  cbState.toDs = localDateStr(today); cbState.toShift = 'Evening';
  _cbSyncInputs();
}
function cbSetShortcutClosings(cdb, count) {
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

function renderClosingBookPage() {
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

// ═══════════════════════════════════════════════════════════════════
// PRINT-SHEET ENGINE — ported from Closing's components.js buildPrintSheet()
// + actions.js calc()/aggregateSinceLastFinal(), but data-driven off the
// already-saved rec fields instead of a live edit form (see header note).
// ═══════════════════════════════════════════════════════════════════

const DENOMS = [
  { label: 'Rs. 5,000 notes', mult: 5000 },
  { label: 'Rs. 1,000 notes', mult: 1000 },
  { label: 'Rs. 500 notes', mult: 500 },
  { label: 'Rs. 100 notes', mult: 100 },
  { label: 'Rs. 50 notes', mult: 50 },
  { label: 'Rs. 20 notes', mult: 20 },
  { label: 'Rs. 10 notes', mult: 10 },
  { label: 'Coins / loose change', mult: 1 }
];

function psRow(label, value, cls = '') { return `<div class="ps-row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`; }
function psRowOrEmpty(label, raw, cls = '') {
  const v = n(raw);
  return v !== 0 ? psRow(label, v.toLocaleString('en-PK'), cls) : psRow(label, '—', cls + ' ps-empty');
}
function psGenStamp() { return new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

// Full port of Closing's aggregateSinceLastFinal() (actions.js) — unlike
// aggregateBooksAndReturnsSinceLastFinal() above (trimmed to the 2 fields
// the summary card needs), this keeps every field the Final Aggregation
// print page displays. Deliberately excludes the CURRENT shift's own
// contribution, same as the original — callers add that back in
// themselves (see buildFinalPrintPage below), mirroring how Closing's
// own calc() adds shiftSaleVal/book1/book2/custVal/ret1-3/retSys on top.
function aggregateSinceLastFinalFull(cdb, ds, shift) {
  const lastFinal = findLastFinal(cdb, ds, shift);
  let totalManualReturns = 0, totalBookBills = 0, totalExtraCash = 0, shiftCount = 0;
  let sameDateShiftSale = 0, preDateShiftSale = 0;
  let sameDateCustomers = 0, preDateCustomers = 0;
  let sameDateSysReturns = 0, preDateSysReturns = 0;
  const labels = [];
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
    if (lastFinal && cur.key === lastFinal.key) break;
    const rec = getRealSheet(cdb, cur.key);
    if (!rec) { if (!lastFinal) break; else continue; }
    if (rec.profileMode === 'final') break;
    const shiftSale = n(rec.outShiftSale), customers = n(rec.outCust), sysRet = n(rec.posRetSys);
    const manRet = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
    const books = n(rec.inBook1) + n(rec.inBook2);
    const isToday = (cur.date === ds);
    totalManualReturns += manRet; totalExtraCash += n(rec.extraCash); totalBookBills += books; shiftCount++;
    labels.unshift(srLabel(cur.shift).replace('Closing', 'C') + ' ' + cur.date);
    if (isToday) { sameDateShiftSale += shiftSale; sameDateCustomers += customers; sameDateSysReturns += sysRet; }
    else { preDateShiftSale += shiftSale; preDateCustomers += customers; preDateSysReturns += sysRet; }
  }
  let lfSameDateSale = 0, lfPreDateSale = 0, lfSameDateCust = 0, lfPreDateCust = 0, lfSameDateSysRet = 0, lfPreDateSysRet = 0;
  if (lastFinal) {
    const lf = lastFinal.rec, lfDate = lastFinal.key.split('_')[0];
    const lfSale = n(lf.outShiftSale), lfCust = n(lf.outCust), lfSysR = n(lf.posRetSys);
    if (lfDate === ds) { lfSameDateSale = lfSale; lfSameDateCust = lfCust; lfSameDateSysRet = lfSysR; }
    else { lfPreDateSale = lfSale; lfPreDateCust = lfCust; lfPreDateSysRet = lfSysR; }
    totalManualReturns += n(lf.posRet1) + n(lf.posRet2) + n(lf.posRet3);
    totalBookBills += n(lf.inBook1) + n(lf.inBook2);
    totalExtraCash += n(lf.extraCash);
  }
  return {
    lastFinal, totalManualReturns, totalBookBills, totalExtraCash, shiftCount, labels,
    sameDateShiftSale, preDateShiftSale, sameDateCustomers, preDateCustomers, sameDateSysReturns, preDateSysReturns,
    lfSameDateSale, lfPreDateSale, lfSameDateCust, lfPreDateCust, lfSameDateSysRet, lfPreDateSysRet
  };
}

// ── PAGE 1 — Shift Closing (ported from buildPrintSheet()'s page1) ──
function buildShiftPrintPage(cdb, key, rec) {
  const [ds, shift] = key.split('_');
  const settings = cdb.settings || {};
  const branchName = settings.branchName || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const mode = rec.profileMode || 'shift';
  const isLocked = rec.draft !== true;
  const num = v => n(v).toLocaleString('en-PK');

  let infoRows = '';
  infoRows += psRow('Computer Cash Sale', num(rec.inSysCash));
  infoRows += psRow('Shift Sale (POS delta)', num(rec.outShiftSale));
  infoRows += psRow('Sale Book 1', num(rec.inBook1));
  infoRows += psRow('Sale Book 2', num(rec.inBook2));
  infoRows += psRow('Customers', num(rec.outCust));
  infoRows += psRow('Last Bill #', rec.inLastBillNum || '—');
  infoRows += psRow('Last Bill Amount', num(rec.inLastBillAmt));

  const totalReturns = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3) + n(rec.posRetSys);
  let retRows = '';
  retRows += psRowOrEmpty('Return 1', rec.posRet1);
  retRows += psRowOrEmpty('Return 2', rec.posRet2);
  retRows += psRowOrEmpty('Return 3', rec.posRet3);
  retRows += psRowOrEmpty('System Return', rec.posRetSys);
  retRows += psRow('TOTAL RETURNS', num(totalReturns), 'ps-total');
  retRows += psRow('NET SHIFT SALE', num(rec.outNetSale), 'ps-highlight');

  const ccB = n(rec.outPrevCC) + n(rec.outCurrCC);
  let ccRows = '';
  ccRows += psRow('Bank Alfalah', num(rec.inAlfalah));
  ccRows += psRow('Keenu Machine', num(rec.inKeenu));
  ccRows += psRowOrEmpty('Computer Card Sale (−)', rec.inCompSale);
  ccRows += psRow('Current CC', num(rec.outCurrCC));
  ccRows += psRow('Previous Day CC (carried)', num(rec.outPrevCC));
  ccRows += psRow('TOTAL CC', ccB.toLocaleString('en-PK'), 'ps-total');

  let tillRows = '', totalC = 0;
  (rec.tillValues || []).forEach((v, i) => {
    const d = DENOMS[i]; if (!d) return;
    totalC += n(v) * d.mult;
    if (n(v) !== 0) tillRows += psRow(d.label, n(v).toLocaleString('en-PK'));
  });
  if (!tillRows) tillRows = psRow('— no denominations counted —', '', 'ps-empty');
  tillRows += psRow('TOTAL TILL CASH', totalC.toLocaleString('en-PK'), 'ps-total');

  let drawRows = '', totalD = 0;
  (rec.vaultValues || []).forEach((v, i) => {
    const d = DENOMS[i]; if (!d) return;
    totalD += n(v) * d.mult;
    if (n(v) !== 0) drawRows += psRow(d.label, n(v).toLocaleString('en-PK'));
  });
  if (!drawRows) drawRows = psRow('— no vault cash counted —', '', 'ps-empty');
  drawRows += psRow('TOTAL DRAW CASH', totalD.toLocaleString('en-PK'), 'ps-total');

  let stripRows = '', hsTotal = 0, totalA = 0;
  (rec.hsRows || []).forEach(r => {
    const v = n(r.val); hsTotal += v;
    if (r.lbl && v !== 0) stripRows += psRow(r.lbl, v.toLocaleString('en-PK'));
  });
  (settings.strips || []).forEach((st, i) => {
    const qty = n((rec.stripQtys || [])[i]), price = n((rec.stripPrices || [])[i]), line = price * qty;
    totalA += line;
    if (qty !== 0) stripRows += psRow(`${st.name} ×${qty}`, line.toLocaleString('en-PK'));
  });
  (rec.auxStrips || []).forEach(r => {
    const qty = n(r.q), price = n(r.p), line = price * qty;
    totalA += line;
    if (qty !== 0) stripRows += psRow(`${r.label} ×${qty}`, line.toLocaleString('en-PK'));
  });
  if (!stripRows) stripRows = psRow('— no items —', '', 'ps-empty');
  stripRows += psRow('TOTAL HS + STRIPS', (hsTotal + totalA).toLocaleString('en-PK'), 'ps-total');

  let credRows = '';
  credRows += psRow('Carried from Previous', num(rec.outPrevCredit));
  if (n(rec.creditAdj) !== 0) credRows += psRow('Credit Adjustment', num(rec.creditAdj));
  (rec.namedCredits || []).forEach(o => {
    const v = n(o.val); if (v === 0) return;
    const rowLbl = o.desc ? `${o.lbl || 'Named Account'} — ${o.desc}` : (o.lbl || 'Named Account');
    credRows += psRow(rowLbl, v.toLocaleString('en-PK'));
  });
  (rec.tierCredits || []).forEach(t => {
    const v = n(t.val); if (v === 0) return;
    const grp = settings.subTiers && settings.subTiers[parseInt(t.tIdx)];
    credRows += psRow(`${grp ? grp.type : ''} — ${t.name || ''}`, v.toLocaleString('en-PK'));
  });
  (rec.auxCredits || []).forEach(o => {
    const v = n(o.val); if (v === 0) return;
    credRows += psRow(o.lbl || 'Credit Entry', v.toLocaleString('en-PK'));
  });
  credRows += psRow('TOTAL CREDIT', num(rec.outTotalE), 'ps-total');

  let depRows = '';
  depRows += psRow('Carried from Previous', num(rec.outPrevDep));
  (rec.deposits || []).forEach(o => {
    const v = n(o.val); if (!o.lbl || v === 0) return;
    depRows += psRow(o.lbl, v.toLocaleString('en-PK'));
  });
  depRows += psRow('TOTAL DEPOSITS', num(rec.outTotalF), 'ps-total');

  let miscRows = '', totalG = 0;
  (rec.miscRows || []).forEach(r => {
    const v = n(r.val); totalG += v;
    if (r.label) miscRows += psRow(r.label, v.toLocaleString('en-PK'));
  });
  if (!miscRows) miscRows = psRow('— no items —', '', 'ps-empty');
  miscRows += psRow('TOTAL MISC', totalG.toLocaleString('en-PK'), 'ps-total');

  const liquid = rec.outTotalCash !== undefined ? n(rec.outTotalCash) : (hsTotal + totalA + totalG + ccB + totalC + totalD + n(rec.outTotalE) + n(rec.outTotalF) - 45000);
  const grand = liquid + 45000;
  let sumRows = '';
  sumRows += psRow('HS + Strips', (hsTotal + totalA).toLocaleString('en-PK'));
  sumRows += psRow('Misc', totalG.toLocaleString('en-PK'));
  sumRows += psRow('CC (Card Sales)', ccB.toLocaleString('en-PK'));
  sumRows += psRow('Till Cash', totalC.toLocaleString('en-PK'));
  sumRows += psRow('Draw Cash', totalD.toLocaleString('en-PK'));
  sumRows += psRow('Credit', num(rec.outTotalE));
  sumRows += psRow('Deposits', num(rec.outTotalF));
  sumRows += psRow('GRAND TOTAL', grand.toLocaleString('en-PK'), 'ps-total');
  sumRows += psRow('Less: Cash Reserve (float)', '45,000', 'ps-minus');
  sumRows += psRow('Liquid Cash', liquid.toLocaleString('en-PK'));
  sumRows += psRow('Less: Previous Cash Position', num(rec.outPrevCash), 'ps-minus');
  if (n(rec.extraCash) !== 0) sumRows += psRow('Less: Extra Cash Added', num(rec.extraCash), 'ps-minus');
  sumRows += psRow('NET CASH AVAILABLE', num(rec.outNetCash), 'ps-highlight');

  const diff1 = n(rec.outNetCash) - n(rec.outNetSale);
  const diffLbl1 = diff1 === 0 ? 'Variance' : diff1 > 0 ? 'Plus' : 'Less';
  const isShort1 = diffLbl1 === 'Less';
  const hero1 = `
    <div class="ps-hero ${isShort1 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${diffLbl1} — Net Cash vs Net Sale</div>
        <div class="ps-hero-val">Rs. ${Math.abs(diff1).toLocaleString('en-PK')}</div>
      </div>
      <div class="ps-hero-sub">Net Cash Available minus Net Shift Sale. Zero means the till matches exactly.</div>
    </div>`;

  let ticks1 = ''; for (let t = 60; t < 1100; t += 46) ticks1 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  return `
    <div class="ps-page ps-page-shift">
      <div class="ps-spine"><div class="ps-spine-ticks">${ticks1}</div><div class="ps-spine-label">${srLabel(shift)} · ${ds || ''}</div></div>
      <div class="ps-content">
        <div class="ps-letterhead">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">${mode === 'final' ? 'Final Closing' : 'Shift Closing'}</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)} · ${isLocked ? 'CLOSED' : 'DRAFT'} · Generated ${genStamp}</div>
          </div>
        </div>
        <div class="ps-main3">
          <div class="ps-col">
            <div class="ps-box"><h4>Till Cash</h4>${tillRows}</div>
            <div class="ps-box"><h4>Draw / Vault Cash</h4>${drawRows}</div>
            <div class="ps-box"><h4>Deposit Details</h4>${depRows}</div>
            <div class="ps-box ps-box-accent"><h4>Grand Summary</h4>${sumRows}</div>
          </div>
          <div class="ps-col">
            <div class="ps-box"><h4>HS Details &amp; Strips</h4>${stripRows}</div>
            <div class="ps-box"><h4>Miscellaneous Credits</h4>${miscRows}</div>
          </div>
          <div class="ps-col">
            <div class="ps-box"><h4>Sale Info</h4>${infoRows}</div>
            <div class="ps-box"><h4>Credit Card Sales (CC)</h4>${ccRows}</div>
            <div class="ps-box ps-box-accent"><h4>Returns &amp; Net Sale</h4>${retRows}</div>
            <div class="ps-box"><h4>Credit Detail</h4>${credRows}</div>
          </div>
        </div>
        ${hero1}
      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 1 of 2</span></div>
    </div>`;
}

// ── PAGE 2 — Final Aggregation (ported from buildPrintSheet()'s page2) ──
function buildFinalPrintPage(cdb, ds, shift, rec) {
  const settings = cdb.settings || {};
  const branchName = settings.branchName || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const mode = rec.profileMode || 'shift';
  const isLocked = rec.draft !== true;
  const isFinalMode = mode === 'final';
  const agg = aggregateSinceLastFinalFull(cdb, ds, shift);
  const shiftsLabel = agg.shiftCount ? `${agg.shiftCount} — ${agg.labels.join(', ')}` : '— none —';
  const chipsSrc = shiftsLabel.includes('—') ? shiftsLabel.split('—')[1] : shiftsLabel;
  const shiftChips = chipsSrc.split(',').map(s => s.trim()).filter(Boolean).map(s => `<span class="ps-chip">${esc(s)}</span>`).join('') || `<span class="ps-chip">— none yet —</span>`;

  const shiftSaleVal = n(rec.outShiftSale), book1 = n(rec.inBook1), book2 = n(rec.inBook2), custVal = n(rec.outCust);
  const ret1 = n(rec.posRet1), ret2 = n(rec.posRet2), ret3 = n(rec.posRet3), retSys = n(rec.posRetSys);
  const extraCash = n(rec.extraCash);
  const liquid = rec.outTotalCash !== undefined ? n(rec.outTotalCash) : 0;

  let totalSameDateSys, totalBooks, totalSameDateCust, totalManRet, totalSameSysRet;
  let preDateSys, preDateCust, preDateSysRet, totalExtraCashPeriod;
  if (isFinalMode) {
    totalSameDateSys = shiftSaleVal; totalBooks = book1 + book2; totalSameDateCust = custVal;
    totalManRet = ret1 + ret2 + ret3; totalSameSysRet = retSys;
    preDateSys = 0; preDateCust = 0; preDateSysRet = 0; totalExtraCashPeriod = extraCash;
  } else {
    totalSameDateSys = agg.sameDateShiftSale + agg.lfSameDateSale + shiftSaleVal;
    totalBooks = agg.totalBookBills + book1 + book2;
    totalSameDateCust = agg.sameDateCustomers + agg.lfSameDateCust + custVal;
    totalManRet = agg.totalManualReturns + ret1 + ret2 + ret3;
    totalSameSysRet = agg.sameDateSysReturns + agg.lfSameDateSysRet + retSys;
    preDateSys = agg.preDateShiftSale + agg.lfPreDateSale;
    preDateCust = agg.preDateCustomers + agg.lfPreDateCust;
    preDateSysRet = agg.preDateSysReturns + agg.lfPreDateSysRet;
    totalExtraCashPeriod = agg.totalExtraCash + extraCash;
  }
  const finalExtraRet = n(rec.finalSysReturns);
  const computedNetSale = totalSameDateSys + totalBooks + totalSameDateCust - totalManRet - totalSameSysRet - finalExtraRet;
  const finalNetSale = rec.finalNetSale !== undefined ? n(rec.finalNetSale) : computedNetSale;
  const preDateTotal = preDateSys + preDateCust - preDateSysRet;
  const computedNetCash = liquid - preDateTotal - totalExtraCashPeriod - finalNetSale;
  const finalNetCash = rec.finalNetCash !== undefined ? n(rec.finalNetCash) : computedNetCash;
  const finalDiff = rec.finalDiff !== undefined ? n(rec.finalDiff) : finalNetCash;
  const finalDiffLabel = rec.finalDiffLabel || (finalDiff === 0 ? 'Variance (Final Audit):' : finalDiff > 0 ? 'Plus (Final Audit):' : 'Less (Final Audit):');

  let part1Rows = '';
  part1Rows += psRow('POS Sale', totalSameDateSys.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Book Bills', totalBooks.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Customers', totalSameDateCust.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Manual Returns', totalManRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part1Rows += psRow('System Returns', totalSameSysRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part1Rows += psRowOrEmpty('Additional System Returns', finalExtraRet, 'ps-minus ps-red');
  part1Rows += psRow('NET FINAL SALE', finalNetSale.toLocaleString('en-PK'), 'ps-highlight');

  let part2Rows = '';
  part2Rows += psRow('Net Cash Available (after float)', liquid.toLocaleString('en-PK'));
  part2Rows += psRow('Pre-date POS Sales', preDateSys.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date Customers', preDateCust.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date System Returns', preDateSysRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Extra Cash Added to Pharmacy', totalExtraCashPeriod.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Target Net Sale (Part 1 result)', finalNetSale.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('NET FINAL CASH AVAILABLE', finalNetCash.toLocaleString('en-PK'), 'ps-highlight');

  let varRows = '';
  varRows += psRow('Pre-date Total (POS + Cust − SysRet)', preDateTotal.toLocaleString('en-PK'));
  const isShort2 = String(finalDiffLabel).toLowerCase().includes('less');
  varRows += psRow(finalDiffLabel, Math.abs(finalDiff).toLocaleString('en-PK'), isShort2 ? 'ps-red' : 'ps-highlight');

  const hero2 = `
    <div class="ps-hero ${isShort2 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${esc(finalDiffLabel)} — Period Reconciliation</div>
        <div class="ps-hero-val">Rs. ${Math.abs(finalDiff).toLocaleString('en-PK')}</div>
      </div>
      <div class="ps-hero-sub">Net Final Cash Available compared to Net Final Sale across the full period since the last Final Closing.</div>
    </div>`;

  const idStrip = `
    <div class="ps-idstrip">
      <div class="ps-idchip"><div class="ps-idchip-label">Date</div><div class="ps-idchip-val">${ds || '—'}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Closing</div><div class="ps-idchip-val">${srLabel(shift)}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Mode</div><div class="ps-idchip-val">${mode.toUpperCase()}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Status</div><div class="ps-idchip-val">${isLocked ? 'CLOSED' : 'DRAFT'}</div></div>
    </div>`;

  let ticks2 = ''; for (let t = 60; t < 1100; t += 46) ticks2 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  return `
    <div class="ps-page ps-page-final">
      <div class="ps-spine ps-spine-final"><div class="ps-spine-ticks">${ticks2}</div><div class="ps-spine-label">Final Closing · ${ds || ''}</div></div>
      <div class="ps-content">
        <div class="ps-letterhead">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">Final Closing</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)}</div>
          </div>
        </div>
        ${idStrip}
        <div class="ps-box"><h4><span class="ps-box-icon">🗂️</span>Shifts Since Last Final</h4>
          <div style="padding:10px 12px;"><div class="ps-chiprow">${shiftChips}</div></div>
        </div>
        <div class="ps-grid2">
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">📊</span>Part 1 — Net Final Sale</h4>${part1Rows}</div>
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">💵</span>Part 2 — Net Final Cash Available</h4>${part2Rows}</div>
        </div>
        <div class="ps-box"><h4><span class="ps-box-icon">⚖️</span>Variance (Final Audit)</h4>${varRows}</div>
        ${hero2}
      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 2 of 2 · Generated ${genStamp}</span></div>
    </div>`;
}

// ── Cover & placeholder pages (ported from closing-book.js) ──
function buildClosingBookCoverPage(cdb, entries, fromDs, fromShift, toDs, toShift) {
  const recorded = entries.filter(e => cdb.sheets[e.key]).length;
  const finals = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].profileMode === 'final').length;
  const drafts = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].draft === true).length;
  const missing = entries.length - recorded;
  const branchName = (cdb.settings && cdb.settings.branchName) || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const stat = (label, val) => `<div class="cb-stat"><div class="cb-stat-val">${val}</div><div class="cb-stat-label">${esc(label)}</div></div>`;
  return `
    <div class="ps-page cb-cover-page">
      <div class="ps-content" style="margin-left:0;padding:70px 55px;">
        <div class="ps-letterhead" style="border-bottom:2px solid #1c2b2b;padding-bottom:16px;">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
        </div>
        <div class="cb-cover-title">📖 Closing Book</div>
        <div class="cb-cover-range">${esc(fromDs)} · ${esc(srLabel(fromShift))}<br><span class="cb-cover-arrow">↓</span><br>${esc(toDs)} · ${esc(srLabel(toShift))}</div>
        <div class="cb-cover-stats">
          ${stat('Shifts in Range', entries.length)}
          ${stat('Recorded', recorded)}
          ${stat('Final Closings', finals)}
          ${stat('Still Draft', drafts)}
          ${stat('Missing', missing)}
        </div>
        <div class="cb-cover-gen">Generated ${genStamp}</div>
      </div>
    </div>`;
}
function buildClosingBookPlaceholderPage(e) {
  return `
    <div class="ps-page cb-placeholder-page">
      <div class="ps-content" style="margin-left:0;height:100%;display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:3.2rem;">🗒️</div>
          <div style="font-size:1.15rem;font-weight:700;margin-top:14px;color:#64748b;">No closing recorded</div>
          <div style="font-size:1rem;margin-top:6px;">${esc(e.date)} · ${esc(srLabel(e.shift))}</div>
        </div>
      </div>
    </div>`;
}

// ── Cheap content fingerprint for cache invalidation (ported) ──
function _cbHashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function cbComputeFingerprint(cdb, entries) {
  return entries.map(e => { const rec = cdb.sheets[e.key]; return rec ? (e.key + ':' + _cbHashStr(JSON.stringify(rec))) : (e.key + ':none'); }).join('|');
}

// ── Assembly + reader state ──
const cbBookState = { cache: {}, currentCacheKey: null, currentPage: 0, zoom: 1 };

async function cbAssembleBook() {
  const cdb = ClosingBridge.getFullDb();
  const statusEl = document.getElementById('cln-cb-status');
  const genBtn = document.getElementById('cln-cb-generate-btn');
  if (!cdb) { if (statusEl) statusEl.textContent = 'Waiting for the first sync from Closing…'; return; }
  const g = id => document.getElementById(id);
  const fromDs = g('cln-cb-from-date').value, fromShift = g('cln-cb-from-shift').value;
  const toDs = g('cln-cb-to-date').value, toShift = g('cln-cb-to-shift').value;
  if (!fromDs || !toDs) { if (statusEl) statusEl.textContent = 'Pick a from/to date first.'; return; }
  if (fromDs + '_' + fromShift > toDs + '_' + toShift && fromDs === toDs) { /* same-day ordering handled by getSeq below */ }

  const entries = enumerateEntries(cdb, fromDs, fromShift, toDs, toShift);
  if (!entries.length) { if (statusEl) statusEl.textContent = 'No shifts fall in that range.'; return; }
  if (entries.length > 120 && !window.confirm(`This range covers ${entries.length} shifts and may take a little while to assemble. Continue?`)) return;

  const cacheKey = `${fromDs}_${fromShift}__${toDs}_${toShift}`;
  const fingerprint = cbComputeFingerprint(cdb, entries);
  const cached = cbBookState.cache[cacheKey];
  if (cached && cached.fingerprint === fingerprint) { cbOpenReader(cacheKey); return; }

  if (genBtn) genBtn.disabled = true;
  if (statusEl) { statusEl.classList.remove('hidden'); statusEl.textContent = `Assembling book… 0 / ${entries.length}`; }

  try {
    const pages = [{ type: 'cover', html: buildClosingBookCoverPage(cdb, entries, fromDs, fromShift, toDs, toShift), label: 'Cover' }];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const rec = cdb.sheets[e.key];
      const pageLabel = `${e.date} · ${srLabel(e.shift)}`;
      if (!rec) {
        pages.push({ type: 'placeholder', html: buildClosingBookPlaceholderPage(e), date: e.date, shift: e.shift, label: pageLabel });
      } else {
        pages.push({ type: 'shift', html: buildShiftPrintPage(cdb, e.key, rec), date: e.date, shift: e.shift, label: pageLabel });
        if (i === entries.length - 1) {
          pages.push({ type: 'final', html: buildFinalPrintPage(cdb, e.date, e.shift, rec), date: e.date, shift: e.shift, label: pageLabel + ' — Final Aggregation' });
        }
      }
      if (statusEl) statusEl.textContent = `Assembling book… ${i + 1} / ${entries.length}`;
      if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));
    }
    cbBookState.cache[cacheKey] = { pages, fingerprint, builtAt: Date.now() };
  } catch (err) {
    console.error('Closing Book assembly failed:', err);
    alert('Something went wrong assembling the book. Please try again — if it keeps happening, try a smaller date range.');
    return;
  } finally {
    if (genBtn) genBtn.disabled = false;
    if (statusEl) statusEl.classList.add('hidden');
  }
  cbOpenReader(cacheKey);
}

function cbOpenReader(cacheKey) {
  cbBookState.currentCacheKey = cacheKey;
  const reader = document.getElementById('cln-cb-reader');
  if (reader) reader.classList.remove('hidden');
  cbPopulateJumpSelect();
  const pages = cbBookState.cache[cacheKey].pages;
  let lastPage = 0;
  try { const saved = parseInt(localStorage.getItem('bt_cb_last_page:' + cacheKey), 10); if (!isNaN(saved) && saved >= 0 && saved < pages.length) lastPage = saved; } catch (e) { /* best-effort */ }
  cbBookState.currentPage = lastPage;
  cbBookState.zoom = 1;
  cbRenderReaderPage();
}
function cbCloseReader() { const reader = document.getElementById('cln-cb-reader'); if (reader) reader.classList.add('hidden'); }
function cbPopulateJumpSelect() {
  const sel = document.getElementById('cln-cb-jump-select');
  if (!sel) return;
  const pages = cbBookState.cache[cbBookState.currentCacheKey].pages;
  sel.innerHTML = pages.map((p, i) => `<option value="${i}">${i === 0 ? '📕 Cover' : (i + 1) + '. ' + p.label}</option>`).join('');
}
function cbComputeFitScale() {
  const vp = document.getElementById('cln-cb-viewport');
  if (!vp || !vp.clientWidth) return 0.4;
  return Math.max(0.18, (vp.clientWidth - 20) / 794);
}
function cbApplyStageScale() {
  const scale = cbComputeFitScale() * cbBookState.zoom;
  const stage = document.getElementById('cln-cb-page-stage');
  const sizer = document.getElementById('cln-cb-page-sizer');
  if (stage) stage.style.transform = `scale(${scale})`;
  if (sizer) { sizer.style.width = (794 * scale) + 'px'; sizer.style.height = (1123 * scale) + 'px'; }
  const vp = document.getElementById('cln-cb-viewport');
  if (vp) vp.classList.toggle('cb-viewport-zoomed', cbBookState.zoom > 1);
}
function cbRenderReaderPage() {
  const cache = cbBookState.cache[cbBookState.currentCacheKey];
  if (!cache) return;
  const pages = cache.pages;
  const stage = document.getElementById('cln-cb-page-stage');
  if (stage) stage.innerHTML = pages[cbBookState.currentPage].html;
  cbApplyStageScale();
  const counterEl = document.getElementById('cln-cb-page-counter');
  if (counterEl) counterEl.textContent = `${cbBookState.currentPage + 1} / ${pages.length}`;
  const selEl = document.getElementById('cln-cb-jump-select'); if (selEl) selEl.value = cbBookState.currentPage;
  const prevBtn = document.getElementById('cln-cb-btn-prev'); if (prevBtn) prevBtn.disabled = (cbBookState.currentPage === 0);
  const nextBtn = document.getElementById('cln-cb-btn-next'); if (nextBtn) nextBtn.disabled = (cbBookState.currentPage === pages.length - 1);
  const vp = document.getElementById('cln-cb-viewport'); if (vp) { vp.scrollTop = 0; vp.scrollLeft = 0; }
  try { localStorage.setItem('bt_cb_last_page:' + cbBookState.currentCacheKey, String(cbBookState.currentPage)); } catch (e) { /* best-effort */ }
}
function cbNext() { const pages = cbBookState.cache[cbBookState.currentCacheKey]?.pages; if (pages && cbBookState.currentPage < pages.length - 1) { cbBookState.currentPage++; cbRenderReaderPage(); } }
function cbPrev() { if (cbBookState.currentPage > 0) { cbBookState.currentPage--; cbRenderReaderPage(); } }
function cbJump(idxStr) { const idx = parseInt(idxStr, 10); if (!isNaN(idx)) { cbBookState.currentPage = idx; cbRenderReaderPage(); } }
function cbZoom(z) { cbBookState.zoom = z; cbRenderReaderPage(); }

// ── Export as one multi-page PDF (ported) ──
async function cbExportPdf() {
  const cache = cbBookState.cache[cbBookState.currentCacheKey];
  if (!cache) return;
  const btn = document.getElementById('cln-cb-btn-export');
  const originalText = btn ? btn.textContent : '';
  if (btn) btn.disabled = true;
  const holder = document.createElement('div');
  holder.className = 'ps-sheet-scope';
  holder.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;background:#fff;';
  document.body.appendChild(holder);
  try {
    if (!window.jspdf || !window.html2canvas) { alert('PDF export libraries failed to load — check your connection and try again.'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = 210, pageH = 297;
    const pages = cache.pages;
    for (let i = 0; i < pages.length; i++) {
      if (btn) btn.textContent = `⏳ Rendering PDF… ${Math.round((i / pages.length) * 100)}%`;
      holder.innerHTML = pages[i].html;
      const pageEl = holder.firstElementChild;
      await new Promise(r => setTimeout(r, 30));
      const canvas = await window.html2canvas(pageEl, { scale: 2, useCORS: true, width: 794, height: 1123, windowWidth: 794 });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageW, pageH);
    }
    const [fromKey, toKey] = cbBookState.currentCacheKey.split('__');
    const [fromDs, fromShift] = fromKey.split('_');
    const [toDs, toShift] = toKey.split('_');
    const cdb = ClosingBridge.getFullDb();
    const brand = (cdb && cdb.settings && cdb.settings.bookBrandCode) || 'FDPP BT';
    const fmtDate = ds => new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const filename = `${brand} Closing ${fromShift} ${fmtDate(fromDs)} to ${toShift} ${fmtDate(toDs)}.pdf`;
    pdf.save(filename);
  } catch (err) {
    console.error('Closing Book PDF export failed:', err);
    alert('Something went wrong exporting the PDF. Please try again.');
  } finally {
    document.body.removeChild(holder);
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// ── Keyboard + swipe/pinch nav, scoped to the reader (ported) ──
document.addEventListener('keydown', (e) => {
  const reader = document.getElementById('cln-cb-reader');
  if (!reader || reader.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); cbNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); cbPrev(); }
  else if (e.key === 'Escape') { e.preventDefault(); cbCloseReader(); }
});
(function initCbGestures() {
  let swipeStartX = 0, swipeStartY = 0, swiping = false, pinchStartDist = 0, pinchStartZoom = 1;
  const dist = t => { const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); };
  document.addEventListener('touchstart', (e) => {
    const vp = document.getElementById('cln-cb-viewport');
    if (!vp || !vp.contains(e.target)) return;
    if (e.touches.length === 2) { swiping = false; pinchStartDist = dist(e.touches); pinchStartZoom = cbBookState.zoom; }
    else if (e.touches.length === 1 && cbBookState.zoom === 1) { swiping = true; swipeStartX = e.touches[0].clientX; swipeStartY = e.touches[0].clientY; }
    else swiping = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      const scale = dist(e.touches) / pinchStartDist;
      cbBookState.zoom = Math.min(8, Math.max(1, pinchStartZoom * scale));
      cbApplyStageScale();
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const vp = document.getElementById('cln-cb-viewport');
    if (!vp) return;
    if (e.touches.length < 2) pinchStartDist = 0;
    if (swiping && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - swipeStartX;
      const dy = e.changedTouches[0].clientY - swipeStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) cbNext(); else cbPrev(); }
    }
    swiping = false;
    if (pinchStartDist === 0) cbApplyStageScale();
  }, { passive: true });
  window.addEventListener('resize', () => { if (cbBookState.currentCacheKey) cbApplyStageScale(); });
})();

// ═══════════════════════════════════════════════════════════════════
// CREDIT LEDGER  (Credit tab + Misc/Ongoing tab)
// ═══════════════════════════════════════════════════════════════════

const clState = { activeMode: 'credit', visibleCount: 3, mlVisibleCount: 3, filter: '' };

function clSwitchMode(mode) {
  clState.activeMode = mode;
  document.getElementById('cln-cl-tab-credit')?.classList.toggle('active', mode === 'credit');
  document.getElementById('cln-cl-tab-misc')?.classList.toggle('active', mode === 'misc');
  const filterRow = document.getElementById('cln-cl-filter-row');
  if (filterRow) filterRow.style.display = mode === 'credit' ? 'flex' : 'none';
  const title = document.getElementById('cln-cl-title');
  const sub = document.getElementById('cln-cl-sub');
  if (title) title.textContent = mode === 'credit' ? '💳 Credit' : '🧮 Misc / Ongoing';
  if (sub) sub.textContent = mode === 'credit' ? "Snapshot history of every shift's credit" : "Snapshot history of every shift's miscellaneous / ongoing charges";
  // Keep the address bar as #credit-ledger/<mode> so this sub-section can
  // be bookmarked or opened directly in a new tab, same as other pages.
  try {
    const _newHash = '#credit-ledger/' + mode;
    if (window.location.hash !== _newHash) history.replaceState(null, '', _newHash);
  } catch(_) {}
  renderCreditLedgerPage();
}

function clToggleDateCard(el) { el.closest('.cl-date-card')?.classList.toggle('open'); }
function clToggleAll(open) { document.querySelectorAll('#cln-cl-cards .cl-date-card').forEach(c => c.classList.toggle('open', open)); }
function clShowMore() { if (clState.activeMode === 'misc') clState.mlVisibleCount += 10; else clState.visibleCount += 10; renderCreditLedgerPage(); }
function clSetFilter(v) { clState.filter = v || ''; renderCreditLedgerPage(); }

function clBuildShiftBlock(snap, activeFilter) {
  const isFinal = snap.mode === 'final';
  const badge = isFinal ? `<span class="cl-badge-final">🟡 Final</span>` : `<span class="cl-badge-shift">🔵 Shift</span>`;
  let displayLines = snap.lines;
  if (activeFilter) displayLines = displayLines.filter(l => l.lbl === activeFilter);
  const named = displayLines.filter(l => l.category === 'named');
  const tier = displayLines.filter(l => l.category === 'tier');
  const aux = displayLines.filter(l => l.category === 'aux');

  let linesHtml = '';
  if (!activeFilter) linesHtml += `<div class="cl-opening-row"><span>Opening Credit (carried in)</span><span>${clFmt(snap.openingCredit)}</span></div>`;
  const renderGroup = (items, label) => !items.length ? '' : `<div class="cl-cat-label">${esc(label)}</div>` + items.map(l => `<div class="cl-line"><span class="cl-lbl">${esc(l.lbl)}${l.desc ? ` <span class="cl-lbl-desc">(${esc(l.desc)})</span>` : ''}</span><span class="cl-val">${clFmt(l.val)}</span></div>`).join('');
  linesHtml += renderGroup(named, 'Named Accounts') + renderGroup(tier, 'Staff / Tier Credits') + renderGroup(aux, 'Free Entries');
  if (!activeFilter && snap.creditAdj !== 0) linesHtml += `<div class="cl-line cl-adj-row"><span class="cl-lbl">Credit Adjustment</span><span class="cl-val">${clFmtSigned(snap.creditAdj)}</span></div>`;
  const totalRow = !activeFilter
    ? `<div class="cl-total-row"><span>TOTAL CREDIT</span><span>${clFmt(snap.totalCredit)}</span></div>`
    : `<div class="cl-total-row" style="color:#0f766e"><span>${esc(activeFilter)}</span><span>${clFmt(displayLines.reduce((s, l) => s + l.val, 0))}</span></div>`;

  return `<div class="cl-shift-block ${isFinal ? 'mode-final' : ''}">
    <div class="cl-shift-header">${badge}<span class="cl-shift-name">${esc(snap.shift)} Closing</span><span class="cl-shift-total">${clFmt(snap.totalCredit)}</span></div>
    <div class="cl-lines">${linesHtml}${totalRow}</div>
  </div>`;
}

function clBuildDateCard(cdb, group, activeFilter) {
  const latestTotal = group.snaps[0]?.totalCredit || 0;
  const shiftLabels = group.snaps.map(s => s.shift).join(' · ');
  return `<div class="cl-date-card">
    <div class="cl-date-head" onclick="clnToggleDateCard(this)">
      <span class="cl-date-icon">📅</span>
      <div style="flex:1"><div class="cl-date-label">${clFmtDate(group.date)}</div><div class="cl-date-sub">${esc(shiftLabels)}</div></div>
      <span class="cl-date-total">${clFmt(latestTotal)}</span>
      <span class="cl-chevron">▶</span>
    </div>
    <div class="cl-date-body">${group.snaps.map(s => clBuildShiftBlock(s, activeFilter)).join('')}</div>
  </div>`;
}

function mlBuildDateCard(group) {
  const total = group.snaps.reduce((s, sn) => s + sn.total, 0);
  const shiftLabels = group.snaps.map(s => s.shift).join(' · ');
  return `<div class="cl-date-card">
    <div class="cl-date-head" onclick="clnToggleDateCard(this)">
      <span class="cl-date-icon">📅</span>
      <div style="flex:1"><div class="cl-date-label">${clFmtDate(group.date)}</div><div class="cl-date-sub">${esc(shiftLabels)}</div></div>
      <span class="cl-date-total">${clFmt(total)}</span>
      <span class="cl-chevron">▶</span>
    </div>
    <div class="cl-date-body">${group.snaps.map(s => `
      <div class="cl-shift-block">
        <div class="cl-shift-header"><span class="cl-badge-shift">🔵 Shift</span><span class="cl-shift-name">${esc(s.shift)} Closing</span><span class="cl-shift-total">${clFmt(s.total)}</span></div>
        <div class="cl-lines">${s.lines.map(l => `<div class="cl-line"><span class="cl-lbl">${esc(l.lbl)}</span><span class="cl-val">${clFmt(l.val)}</span></div>`).join('')}
          <div class="cl-total-row"><span>TOTAL</span><span>${clFmt(s.total)}</span></div>
        </div>
      </div>`).join('')}</div>
  </div>`;
}

function renderCreditLedgerPage() {
  const cdb = ClosingBridge.getFullDb();
  const container = document.getElementById('cln-cl-cards');
  const countBadge = document.getElementById('cln-cl-count');
  const moreBtn = document.getElementById('cln-cl-more-btn');
  if (!container) return;
  if (!cdb) { container.innerHTML = `<div class="cln-empty">⏳ Waiting for the first sync from Closing…</div>`; if (moreBtn) moreBtn.classList.add('hidden'); return; }

  if (clState.activeMode === 'misc') {
    const groups = clGroupByDate(cdb, mlAllSnapshots(cdb).map(s => ({ ...s, totalCredit: s.total }))); // reuse the same date-sort
    if (countBadge) countBadge.textContent = `${mlAllSnapshots(cdb).length} shift${mlAllSnapshots(cdb).length !== 1 ? 's' : ''} · ${groups.length} date${groups.length !== 1 ? 's' : ''}`;
    if (!groups.length) { container.innerHTML = `<div class="cl-empty">📭 No misc/ongoing entries yet.</div>`; if (moreBtn) moreBtn.classList.add('hidden'); return; }
    const toShow = groups.slice(0, clState.mlVisibleCount);
    const hidden = groups.slice(clState.mlVisibleCount);
    container.innerHTML = toShow.map(mlBuildDateCard).join('');
    if (moreBtn) { if (hidden.length) { moreBtn.textContent = `Show ${hidden.length} more date${hidden.length !== 1 ? 's' : ''} ▼`; moreBtn.classList.remove('hidden'); } else moreBtn.classList.add('hidden'); }
    return;
  }

  // Credit mode
  const filterSel = document.getElementById('cln-cl-filter-select');
  const allSnaps = clAllSnapshotsLive(cdb);
  if (filterSel) {
    const prev = filterSel.value;
    const labels = clAllLabels(allSnaps);
    filterSel.innerHTML = '<option value="">All Accounts</option>' + labels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
    filterSel.value = labels.includes(prev) ? prev : '';
  }
  const activeFilter = clState.filter;
  let snapshots = allSnaps;
  if (activeFilter) snapshots = snapshots.filter(s => s.lines.some(l => l.lbl === activeFilter));
  const groups = clGroupByDate(cdb, snapshots);
  if (countBadge) countBadge.textContent = `${snapshots.length} shift${snapshots.length !== 1 ? 's' : ''} · ${groups.length} date${groups.length !== 1 ? 's' : ''}`;
  if (!groups.length) { container.innerHTML = `<div class="cl-empty">📭 No credit records yet.</div>`; if (moreBtn) moreBtn.classList.add('hidden'); return; }
  const toShow = groups.slice(0, clState.visibleCount);
  const hidden = groups.slice(clState.visibleCount);
  container.innerHTML = toShow.map(g => clBuildDateCard(cdb, g, activeFilter)).join('');
  if (moreBtn) { if (hidden.length) { moreBtn.textContent = `Show ${hidden.length} more date${hidden.length !== 1 ? 's' : ''} ▼`; moreBtn.classList.remove('hidden'); } else moreBtn.classList.add('hidden'); }
}

// ── Page-show hooks — called from ui.js's showPage() ────────────────
export function onShowClosingBook() { ClosingBridge.refresh(false); renderClosingBookPage(); }
export function onShowCreditLedger() { ClosingBridge.refresh(false); renderCreditLedgerPage(); }

// Re-render whichever of these pages exists whenever the bridge finishes
// a background sync (see closing-bridge.js's refresh()). Both render
// functions are cheap, idempotent template rebuilds — safe to always run
// even if the relevant page isn't the one currently visible.
export function onBridgeRefresh() {
  renderClosingBookPage();
  renderCreditLedgerPage();
}

// Bridged for onclick="" handlers in the generated HTML above.
window.clnSetShortcutDays = (d) => cbSetShortcutDays(d);
window.clnSetShortcutClosings = (c) => { const cdb = ClosingBridge.getFullDb(); if (cdb) cbSetShortcutClosings(cdb, c); };
window.clnGenerateBook = cbAssembleBook;
window.clnCbCloseReader = cbCloseReader;
window.clnCbNext = cbNext;
window.clnCbPrev = cbPrev;
window.clnCbJump = cbJump;
window.clnCbZoom = cbZoom;
window.clnCbExportPdf = cbExportPdf;
window.clnSwitchMode = clSwitchMode;
window.clnToggleDateCard = clToggleDateCard;
window.clnToggleAll = clToggleAll;
window.clnShowMore = clShowMore;
window.clnSetFilter = clSetFilter;
window.closingNativeOnRefresh = onBridgeRefresh;
window.clnOnShowClosingBook = onShowClosingBook;
window.clnOnShowCreditLedger = onShowCreditLedger;
