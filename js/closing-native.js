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
// the same data. Only ONE thing was deliberately left out of the port:
// Closing's full paginated flip-book PDF reader (jsPDF + html2canvas,
// pinch-zoom, print-quality register replica — ~500 lines on its own).
// The Closing Book page here shows the same "Latest Closing Summary"
// card and the same range/shortcut picker, but renders the range as a
// scrollable list instead of a print-page-accurate PDF — there's an
// "Open in Closing ↗" link on every entry for the exact printed layout
// or an actual PDF export.
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

function cbGenerateBook() {
  const cdb = ClosingBridge.getFullDb();
  const resultsEl = document.getElementById('cln-cb-results');
  const statusEl = document.getElementById('cln-cb-status');
  if (!cdb || !resultsEl) return;
  const g = id => document.getElementById(id);
  const fromDs = g('cln-cb-from-date').value, fromShift = g('cln-cb-from-shift').value;
  const toDs = g('cln-cb-to-date').value, toShift = g('cln-cb-to-shift').value;
  if (!fromDs || !toDs) { if (statusEl) statusEl.textContent = 'Pick a from/to date first.'; return; }

  const entries = enumerateEntries(cdb, fromDs, fromShift, toDs, toShift);
  const recorded = entries.filter(e => cdb.sheets[e.key]).length;
  const finals = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].profileMode === 'final').length;
  const drafts = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].draft === true).length;
  if (statusEl) statusEl.textContent = `${entries.length} shifts in range · ${recorded} recorded · ${finals} final · ${drafts} draft · ${entries.length - recorded} missing`;

  resultsEl.innerHTML = entries.map(e => {
    const rec = cdb.sheets[e.key];
    if (!rec) return `<div class="cb-entry cb-entry-missing"><span class="cb-entry-date">${esc(e.date)} · ${esc(srLabel(e.shift))}</span><span class="cb-entry-empty">No closing recorded</span></div>`;
    const isFinal = rec.profileMode === 'final';
    const isDraft = rec.draft === true;
    return `<div class="cb-entry">
      <div class="cb-entry-head">
        <span class="cb-entry-date">${esc(e.date)} · ${esc(srLabel(e.shift))}</span>
        ${isDraft ? '<span class="cl-badge-shift" style="background:#fef3c7;color:#92400e">🟡 Draft</span>' : isFinal ? '<span class="cl-badge-final">🟡 Final</span>' : '<span class="cl-badge-shift">🔵 Shift</span>'}
      </div>
      <div class="cb-entry-grid">
        <div><span>Carried CC</span><b>${clFmt(n(rec.outPrevCC))}</b></div>
        <div><span>Total Deposits</span><b>${clFmt(n(rec.outTotalF))}</b></div>
        <div><span>Net Sale</span><b>${clFmt(n(rec.finalNetSale) || n(rec.outNetSale))}</b></div>
        <div><span>Total Credit</span><b>${clFmt(n(rec.outTotalE))}</b></div>
      </div>
    </div>`;
  }).join('') || `<div class="cln-empty">Nothing in that range.</div>`;
}

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
window.clnGenerateBook = cbGenerateBook;
window.clnSwitchMode = clSwitchMode;
window.clnToggleDateCard = clToggleDateCard;
window.clnToggleAll = clToggleAll;
window.clnShowMore = clShowMore;
window.clnSetFilter = clSetFilter;
window.closingNativeOnRefresh = onBridgeRefresh;
window.clnOnShowClosingBook = onShowClosingBook;
window.clnOnShowCreditLedger = onShowCreditLedger;
