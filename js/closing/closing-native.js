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
import { openLedgerQuickAdd } from '../ledger/ledger-quick-add.js';
import { fetchMarks, getMark } from './closing-ledger-marks.js';
import { escapeHtml as esc } from '../shared/html.js';
import { act, arg } from '../shared/dom-actions.js';
import { clAllLabels, clAllSnapshotsLive, clFmt, clFmtDate, clFmtSigned, clGroupByDate, mlAllSnapshots } from './closing-engine.js';
import { cbSetShortcutClosings, cbSetShortcutDays, renderClosingBookPage } from './closing-book-page.js';
import { cbAssembleBook, cbCloseReader, cbExportPdf, cbJump, cbNext, cbPrev, cbZoom } from './closing-book-reader.js';

// ═══════════════════════════════════════════════════════════════════
// CREDIT LEDGER  (Credit tab + Misc/Ongoing tab)
// ═══════════════════════════════════════════════════════════════════

const clState = { activeMode: 'credit', visibleCount: 3, mlVisibleCount: 3, filter: '', expanded: new Set() };

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
  } catch(_) { /* best-effort: failure is intentionally non-fatal here */ }
  renderCreditLedgerPage();
}

// Expand state now lives in clState.expanded (a Set of "mode:date" keys),
// not just the DOM's 'open' class — closing-bridge.js polls every 15s and
// fully rebuilds this page's HTML on every poll (see its MIN_REFRESH_MS),
// which was silently collapsing every open card back to closed on every
// poll. Toggling here updates both the visible DOM and the persisted set;
// the render templates below read from the set so a rebuild restores
// whatever was open instead of resetting it.
function clToggleDateCard(el) {
  const card = el.closest('.cl-date-card');
  if (!card) return;
  const key = card.dataset.key;
  const nowOpen = card.classList.toggle('open');
  if (key) { if (nowOpen) clState.expanded.add(key); else clState.expanded.delete(key); }
}
function clToggleAll(open) {
  document.querySelectorAll('#cln-cl-cards .cl-date-card').forEach(c => {
    c.classList.toggle('open', open);
    const key = c.dataset.key;
    if (key) { if (open) clState.expanded.add(key); else clState.expanded.delete(key); }
  });
}
function clShowMore() { if (clState.activeMode === 'misc') clState.mlVisibleCount += 10; else clState.visibleCount += 10; renderCreditLedgerPage(); }
function clSetFilter(v) { clState.filter = v || ''; renderCreditLedgerPage(); }

function clBuildShiftBlock(snap, activeFilter) {
  const isFinal = snap.mode === 'final';
  const badge = isFinal ? `<span class="cl-badge-final">🟡 Final</span>` : `<span class="cl-badge-shift">🔵 Shift</span>`;
  const snapKey = snap.key || `${snap.date}_${snap.shift}`;
  // Stable per-line id for the "already added to Ledger" mark — snap.lines
  // is an immutable saved snapshot (never re-ordered after the shift is
  // closed), so index-into-the-full-array is a safe, stable key even
  // though individual lines carry no id of their own.
  const linesWithIdx = snap.lines.map((l, i) => ({ ...l, _rowKey: `${snapKey}::L${i}` }));
  let displayLines = linesWithIdx;
  if (activeFilter) displayLines = displayLines.filter(l => l.lbl === activeFilter);
  const named = displayLines.filter(l => l.category === 'named');
  const tier = displayLines.filter(l => l.category === 'tier');
  const aux = displayLines.filter(l => l.category === 'aux');

  let linesHtml = '';
  if (!activeFilter) linesHtml += `<div class="cl-opening-row"><span>Opening Credit (carried in)</span><span>${clFmt(snap.openingCredit)}</span></div>`;
  const renderGroup = (items, label) => !items.length ? '' : `<div class="cl-cat-label">${esc(label)}</div>` + items.map(l => {
    const descStr = l.desc ? `${l.lbl} — ${l.desc}` : l.lbl;
    const mark = getMark(l._rowKey);
    const rightSide = mark
      ? `<span class="cl-added-badge" title="Added to ${esc(mark.ledgerType)} · ${mark.addedAt ? new Date(mark.addedAt).toLocaleDateString() : ''}">✓ Added</span>`
      : `<button type="button" class="cl-qa-btn" title="Add to BT Ledger"${act('click', 'clnQuickAdd', String(l._rowKey), snap.date, snap.shift, l.val, descStr)}>+ Ledger</button>`;
    return `<div class="cl-line${mark ? ' cl-line-added' : ''}"><span class="cl-lbl">${esc(l.lbl)}${l.desc ? ` <span class="cl-lbl-desc">(${esc(l.desc)})</span>` : ''}</span><span class="cl-line-right"><span class="cl-val">${clFmt(l.val)}</span>${rightSide}</span></div>`;
  }).join('');
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
  const key = `credit:${group.date}`;
  return `<div class="cl-date-card${clState.expanded.has(key) ? ' open' : ''}" data-key="${esc(key)}">
    <div class="cl-date-head"${act('click', 'clnToggleDateCard', arg.self)}>
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
  const key = `misc:${group.date}`;
  return `<div class="cl-date-card${clState.expanded.has(key) ? ' open' : ''}" data-key="${esc(key)}">
    <div class="cl-date-head"${act('click', 'clnToggleDateCard', arg.self)}>
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
export function onShowCreditLedger() {
  ClosingBridge.refresh(false);
  renderCreditLedgerPage();
  // Marks are fetched async and re-render once loaded — first paint
  // doesn't wait on them, same "cheap idempotent rebuild" pattern as
  // onBridgeRefresh below. Rows just show their "+ Ledger" button until
  // this resolves, then flip to "✓ Added" for anything already marked.
  fetchMarks().then(() => renderCreditLedgerPage());
}

// Re-render whichever of these pages exists whenever the bridge finishes
// a background sync (see closing-bridge.js's refresh()). Both render
// functions are cheap, idempotent template rebuilds — safe to always run
// even if the relevant page isn't the one currently visible.
export function onBridgeRefresh() {
  renderClosingBookPage();
  renderCreditLedgerPage();
}

// Opens the manual Quick Add modal (ledger-quick-add.js) for one Credit
// Ledger row. Date/shift/amount/description arrive pre-filled from the
// row; Ledger + Category are always left blank inside the modal itself —
// see ledger-quick-add.js's header for why. On save, re-fetches marks
// (force) and re-renders so the row flips to "✓ Added".
function clQuickAddFromRow(rowKey, date, shift, amount, desc) {
  openLedgerQuickAdd({ rowKey, date, shift, amount, desc }, () => {
    fetchMarks(true).then(() => renderCreditLedgerPage());
  });
}

// Bridged for the data-on-* action handlers in the generated HTML above.
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
window.clnQuickAdd = clQuickAddFromRow;
window.closingNativeOnRefresh = onBridgeRefresh;
window.clnOnShowClosingBook = onShowClosingBook;
window.clnOnShowCreditLedger = onShowCreditLedger;
