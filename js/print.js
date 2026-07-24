// ══════════════════════════════════════════════════════════════════════
// PRINT  —  Floor 4, the one and only print engine (V2 plan §7)
//
// Every report in the app (Sales: Daily/Monthly/Yearly/Dashboard, Manager:
// Salary/Credit/Incentive/Petty Cash/Manager Dashboard, Notes Sheets,
// CommandHub quick-print chips, Manager Summary export) funnels through
// Print.render() or Print.renderNewTab() — both engines live ONLY here.
//
// Both now build a real PDF (jsPDF + html2canvas, already loaded globally
// in index.html) instead of calling window.print():
//   1. The report HTML is captured to a print-quality image.
//   2. It's paginated onto Letter pages — landscape for any block marked
//      .pr-landscape (the wide daily-breakdown tables), portrait for the
//      rest, sliced across extra pages automatically if content is tall.
//   3. The finished PDF opens in a new tab as an overview (the browser's
//      built-in PDF viewer — Print/Download buttons live right there),
//      and is also saved to the user's Downloads so a copy is ready for
//      printing without needing to revisit the app.
//
// No other file may call window.print(), document.write(), or touch
// #print-area directly. A future report just builds its HTML and calls
// one of these two functions, same as every existing report already does.
// ══════════════════════════════════════════════════════════════════════

const PAGE_MM = {
  portrait:  { w: 215.9, h: 279.4 },
  landscape: { w: 279.4, h: 215.9 },
};
const MARGIN_MM = 8;
// Capture width in px for each orientation — chosen generously; the
// resulting image is scaled down to fit the mm page width, so this only
// affects capture crispness/wrap-width, not final print size.
const CAPTURE_W_PX = { portrait: 860, landscape: 1300 };

// Extra CSS forced into every capture host, on top of whatever the report
// HTML already brings (pages.css's .pr-* classes for fragments, or the
// full doc's own <style> for standalone reports). Keeps html2canvas on
// the safe, well-supported subset of CSS (flex instead of grid) so the
// captured image matches what the on-screen preview always looked like.
const _CAPTURE_SAFE_CSS = `
  .pr-kpis{display:flex!important;flex-wrap:wrap!important;gap:8px!important;}
  .pr-kpis .pr-kpi{flex:1 1 28%!important;min-width:0!important;}
  .ms-kpi-grid{display:flex!important;flex-wrap:wrap!important;}
  .ms-kpi-grid .ms-kpi{flex:1 1 45%!important;}
`;

// ── Pull { bodyHTML, styleCSS, title } out of either a bare fragment
// (Sale/Monthly/Yearly/Manager/Dashboard reports — styled by pages.css,
// already loaded on the live page) or a full standalone document
// (Manager Summary export, Notes Sheets — bring their own <style>).
function _extractDoc(html) {
  if (/<html[\s>]/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styleCSS = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
    const title = (doc.querySelector('title')?.textContent || '').trim();
    return { bodyHTML: doc.body ? doc.body.innerHTML : html, styleCSS, title };
  }
  return { bodyHTML: html, styleCSS: '', title: '' };
}

// ── Split top-level nodes into pages: a node carrying .pr-landscape is
// its own single landscape page (matches how reports-print.js already
// emits one such div per daily-breakdown page); a node carrying
// .pr-page-break starts a fresh portrait page; everything else piles
// onto the current portrait page.
function _splitSegments(root) {
  const segments = [];
  let current = null;
  Array.from(root.childNodes).forEach(node => {
    if (node.nodeType !== 1) return; // skip text/comment nodes
    const isLandscape = node.classList && node.classList.contains('pr-landscape');
    const isBreak = node.classList && node.classList.contains('pr-page-break');
    if (isLandscape) {
      if (current && current.nodes.length) segments.push(current);
      segments.push({ orientation: 'landscape', nodes: [node] });
      current = null;
      return;
    }
    if (isBreak || !current) {
      if (current && current.nodes.length) segments.push(current);
      current = { orientation: 'portrait', nodes: [] };
    }
    current.nodes.push(node);
  });
  if (current && current.nodes.length) segments.push(current);
  if (!segments.length) {
    const nodes = Array.from(root.childNodes).filter(n => n.nodeType === 1);
    segments.push({ orientation: 'portrait', nodes });
  }
  return segments;
}

function _safeFilename(title, opts) {
  const raw = (opts && opts.filename) || title || 'BT-Report';
  const base = raw.replace(/\.pdf$/i, '').replace(/[^a-z0-9\-_ ]+/gi, '').trim().replace(/\s+/g, '-') || 'BT-Report';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${base}_${stamp}.pdf`;
}

// ── Core builder: HTML string → jsPDF document, paginated. ────────────
async function _buildPdf(html, opts) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF failed to load — check your connection.');
  if (!window.html2canvas) throw new Error('html2canvas failed to load — check your connection.');

  const { bodyHTML, styleCSS, title } = _extractDoc(html);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = bodyHTML;
  const segments = _splitSegments(wrapper);

  const styleTag = document.createElement('style');
  styleTag.textContent = (styleCSS || '') + _CAPTURE_SAFE_CSS;
  document.head.appendChild(styleTag);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-99999px;background:#fff;z-index:-1;';
  document.body.appendChild(host);

  const { jsPDF } = window.jspdf;
  let doc = null;
  let pageIndex = 0;

  try {
    for (const seg of segments) {
      const widthPx = CAPTURE_W_PX[seg.orientation];
      host.style.width = widthPx + 'px';
      host.innerHTML = '';
      const inner = document.createElement('div');
      inner.style.cssText = 'background:#fff;';
      seg.nodes.forEach(n => inner.appendChild(n.cloneNode(true)));
      host.appendChild(inner);

      // Let layout/webfonts settle before snapshotting (double-rAF, same
      // reasoning as the old render()'s pre-print wait — a fixed-ms guess
      // isn't reliable for content of very different sizes).
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvas = await window.html2canvas(inner, { scale: 2, backgroundColor: '#ffffff', useCORS: true });

      const pg = PAGE_MM[seg.orientation];
      const usableWmm = pg.w - MARGIN_MM * 2;
      const usableHmm = pg.h - MARGIN_MM * 2;
      const pxPerMM = canvas.width / usableWmm;
      const chunkPxH = Math.max(1, Math.floor(usableHmm * pxPerMM));

      for (let offsetPx = 0; offsetPx < canvas.height; offsetPx += chunkPxH) {
        const sliceH = Math.min(chunkPxH, canvas.height - offsetPx);
        const chunkCanvas = document.createElement('canvas');
        chunkCanvas.width = canvas.width;
        chunkCanvas.height = sliceH;
        const ctx = chunkCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, chunkCanvas.width, chunkCanvas.height);
        ctx.drawImage(canvas, 0, offsetPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const imgData = chunkCanvas.toDataURL('image/jpeg', 0.92);
        const chunkHmm = sliceH / pxPerMM;

        if (pageIndex === 0) {
          doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: seg.orientation });
        } else {
          doc.addPage('letter', seg.orientation);
        }
        doc.addImage(imgData, 'JPEG', MARGIN_MM, MARGIN_MM, usableWmm, chunkHmm);
        pageIndex++;
      }
    }
  } finally {
    host.remove();
    styleTag.remove();
  }

  return { doc, title };
}

// ── Shared finish step for both public entry points: open the PDF as an
// overview in the tab reserved before the async work started (dodges
// popup blockers, same trick the old renderNewTab used for window.open),
// and save a copy for printing. ──────────────────────────────────────
async function _generateAndDeliver(html, opts, previewWin) {
  try {
    const { doc, title } = await _buildPdf(html, opts);
    const filename = _safeFilename(title, opts);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);

    if (previewWin && !previewWin.closed) {
      previewWin.location.href = url;
    } else if (typeof window.toast === 'function') {
      window.toast('⚠️ Pop-up blocked — allow pop-ups to see the PDF overview. Downloading it instead.', 'w');
    }
    doc.save(filename);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (previewWin && !previewWin.closed) previewWin.close();
    if (typeof window.toast === 'function') window.toast('⚠️ Could not generate PDF: ' + (err && err.message || err), 'e');
  }
}

function _reservePreviewTab() {
  const win = window.open('', '_blank');
  if (win && !win.closed) {
    try {
      win.document.write('<title>Generating PDF…</title><body style="font-family:system-ui,sans-serif;padding:60px 40px;color:#64748b">Preparing your PDF report…</body>');
    } catch (e) { /* best-effort */ }
  }
  return win;
}

// ── Public API ──────────────────────────────────────────────────────
// Same signatures as before, so every existing caller (reports.js,
// reports-print.js, manager.js, manager-export.js, dashboard.js,
// hub-actions.js, notes-sheets.js, sheets-patch.js) keeps working
// unchanged — they just get a PDF overview + download now instead of
// the native print dialog.
export function render(html, opts) {
  opts = opts || {};
  const previewWin = _reservePreviewTab();
  _generateAndDeliver(html, opts, previewWin);
  return true;
}

export function renderNewTab(html, opts) {
  opts = opts || {};
  const previewWin = _reservePreviewTab();
  _generateAndDeliver(html, opts, previewWin);
  return true;
}

export const Print = { render, renderNewTab };

// Bridged — see header note. Remove once every consumer imports Print
// directly (blocked on the same ui.js/manager.js circular-dependency
// call already made for the rest of Floor 4/5 — see BLUEPRINT.md).
window.Print = Print;
