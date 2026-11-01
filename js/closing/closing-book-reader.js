// CLOSING (native) — book assembly, reader (zoom / paging), PDF export, keyboard and swipe navigation.

import * as ClosingBridge from './closing-bridge.js';
import { srLabel } from './closing-engine.js';
import { enumerateEntries } from './closing-book-page.js';
import { buildClosingBookCoverPage, buildClosingBookPlaceholderPage, buildFinalPrintPage, buildShiftPrintPage } from './closing-print-pages.js';

// ── Cheap content fingerprint for cache invalidation (ported) ──
function _cbHashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function cbComputeFingerprint(cdb, entries) {
  return entries.map(e => { const rec = cdb.sheets[e.key]; return rec ? (e.key + ':' + _cbHashStr(JSON.stringify(rec))) : (e.key + ':none'); }).join('|');
}

// ── Assembly + reader state ──
const cbBookState = { cache: {}, currentCacheKey: null, currentPage: 0, zoom: 1 };

export async function cbAssembleBook() {
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
export function cbCloseReader() { const reader = document.getElementById('cln-cb-reader'); if (reader) reader.classList.add('hidden'); }
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
export function cbNext() { const pages = cbBookState.cache[cbBookState.currentCacheKey]?.pages; if (pages && cbBookState.currentPage < pages.length - 1) { cbBookState.currentPage++; cbRenderReaderPage(); } }
export function cbPrev() { if (cbBookState.currentPage > 0) { cbBookState.currentPage--; cbRenderReaderPage(); } }
export function cbJump(idxStr) { const idx = parseInt(idxStr, 10); if (!isNaN(idx)) { cbBookState.currentPage = idx; cbRenderReaderPage(); } }
export function cbZoom(z) { cbBookState.zoom = z; cbRenderReaderPage(); }

// ── Export as one multi-page PDF (ported) ──
export async function cbExportPdf() {
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
