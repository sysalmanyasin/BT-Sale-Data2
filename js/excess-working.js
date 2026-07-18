// ══════════════════════════════════════════════════════════════════════
// EXCESS WORKING  —  native port of "Excess Stock Control"'s branch-level
// calculation engine, wired to this app's own data instead of a pasted/
// uploaded spreadsheet export.
//
// Source of the raw rows: Stock Ledger's own "100-Day Excess" tab
// (js/stockledger.js, computeAll() section 3 — excessQty/excessValue per
// SKU, no pack rounding). This page does NOT re-fetch or re-derive that —
// it reads it live through window.StockLedgerApp.getExcessRows(), so
// there is exactly one inventory load per session, one source of truth.
//
// Everything downstream of that — pack-correction, Retained/Loose/Excess
// classification, misc buffer, corrected excess value — is the same
// arithmetic as the original Excess Stock Control tool's computeRows()/
// summarize() (see that file's own comment: "CALCULATION ENGINE —
// unchanged from the original spreadsheet logic"). The one deliberate
// adaptation: the original looked up each item's pack size (conversion
// factor) from a separate uploaded catalog; here every inventory row
// already carries its own conversionFactor, so that's read directly
// instead — same fallback-to-1 behaviour when it's missing/invalid.
// ══════════════════════════════════════════════════════════════════════

window.ExcessWorkingApp = (function () {
  "use strict";
  let initialized = false;

  const RETAIN_KEY = 'bt_excess_retain_v1';
  const MISC_KEY = 'bt_excess_misc_v1';
  const HOVALUE_KEY = 'bt_excess_hovalue_v1';

  const state = {
    tab: 'working',        // 'retain' | 'adjustments' | 'working' | 'export'
    retainList: [],
    misc: 0,
    hoValue: '',
    filter: 'All',
    search: '',
    groupByCompany: false,
    collapsedGroups: new Set(),
    topN: 20,
    rawExcess: [],
    computed: [],
    summary: null,
    asOf: '',
    dataReady: false,
  };

  // ---------- helpers ----------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
  function fmt(n) { return (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
  function todayStamp() { return new Date().toISOString().slice(0, 10); }
  function say(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type); }

  function repoGet(key) {
    try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
    catch (e) { return null; }
  }
  function repoSet(key, value) {
    try { if (window.Repository) window.Repository.setItem(key, value); else localStorage.setItem(key, value); }
    catch (e) { /* ignore */ }
  }

  function loadRetain() {
    try {
      const raw = repoGet(RETAIN_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveRetain() { repoSet(RETAIN_KEY, JSON.stringify(state.retainList)); }
  function loadMisc() { const v = parseFloat(repoGet(MISC_KEY)); return isNaN(v) ? 0 : v; }
  function saveMisc() { repoSet(MISC_KEY, String(state.misc || 0)); }
  function loadHoValue() { const v = repoGet(HOVALUE_KEY); return v == null ? '' : v; }
  function saveHoValue() { repoSet(HOVALUE_KEY, state.hoValue == null ? '' : String(state.hoValue)); }

  // ---------- CALCULATION ENGINE — same arithmetic as excess-stock-control.html ----------
  function computeRows(rawExcess, retainSet) {
    return rawExcess.map(r => {
      const qty = Number(r.excessQty) || 0;
      const value = Number(r.excessValue) || 0;
      let factor = Number(r.conversionFactor);
      const packUnreliable = !(factor && factor > 0 && Number.isFinite(factor));
      if (packUnreliable) factor = 1;
      // ROUNDDOWN(qty/factor,0) — how many whole packs the excess qty makes up
      const packQty = Math.floor(qty / factor);
      let correctedValue = 0;
      if (qty > 0) {
        // ROUNDDOWN( (value/qty) * (packQty*factor), 0 ) — re-price to only
        // the portion of stock that forms whole packs. Math.floor matches
        // Excel's ROUNDDOWN (truncate toward zero), not Math.round.
        correctedValue = Math.floor((value / qty) * (packQty * factor));
      }
      let status;
      const nameKey = String(r.name || '').trim().toLowerCase();
      if (retainSet.has(nameKey)) status = 'Retained';
      else if (packQty === 0) status = 'Loose';
      else status = 'Excess';
      const excessContribution = status === 'Excess' ? correctedValue : 0;
      return {
        code: r.code, name: r.name, company: r.company || r.supplier || '',
        qty, value, factor, packUnreliable, packQty, correctedValue, status, excessContribution
      };
    });
  }

  function summarize(computed, misc, hoValue) {
    const totalRawValue = computed.reduce((s, r) => s + (r.value || 0), 0);
    const totalExcess = computed.filter(r => r.status === 'Excess').reduce((s, r) => s + r.excessContribution, 0);
    const totalRetained = computed.filter(r => r.status === 'Retained').reduce((s, r) => s + r.correctedValue, 0);
    // Residual, not a per-row sum — matches the source tool's "Loose Value"
    // (captures true loose items AND the fractional remainder rounded away
    // from every Excess/Retained row).
    const totalLoose = totalRawValue - totalRetained - totalExcess;
    const top10 = computed.filter(r => r.status === 'Excess').map(r => r.excessContribution).sort((a, b) => b - a).slice(0, 10).reduce((s, v) => s + v, 0);
    const correctedExcessStockValue = totalExcess - (misc || 0);
    let variance = null;
    if (hoValue !== null && hoValue !== '' && !isNaN(hoValue)) {
      variance = Number(hoValue) - totalRawValue;
    }
    return { totalRawValue, totalExcess, totalRetained, totalLoose, top10, correctedExcessStockValue, variance, misc: misc || 0, hoValue };
  }

  function recompute() {
    const retainSet = new Set(state.retainList.map(x => x.toLowerCase()));
    state.computed = computeRows(state.rawExcess, retainSet);
    state.summary = summarize(state.computed, Number(state.misc) || 0, state.hoValue);
  }

  function refreshFromStockLedger(silent) {
    const SL = window.StockLedgerApp;
    if (SL && typeof SL.hasData === 'function' && SL.hasData()) {
      state.rawExcess = typeof SL.getExcessRows === 'function' ? SL.getExcessRows() : [];
      state.asOf = typeof SL.getAsOfLabel === 'function' ? SL.getAsOfLabel() : '';
      state.dataReady = true;
    } else {
      state.rawExcess = [];
      state.dataReady = false;
    }
    recompute();
    if (!silent) say(state.dataReady ? ('Pulled ' + state.rawExcess.length + ' excess rows from Stock Ledger') : 'No Stock Ledger data loaded yet');
  }

  function topExcessRows(rows, n) {
    return [...rows].filter(r => r.status === 'Excess').sort((a, b) => b.correctedValue - a.correctedValue).slice(0, Math.max(1, n || 20));
  }

  // ---------- EXPORTS ----------
  function exportExcelSheet(aoa, sheetName, colWidths, filename) {
    if (!window.XLSX) { say('Excel library not loaded', 'e'); return; }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename);
  }

  function exportPdfTable(title, subLines, headers, rows, filename, orientation) {
    if (!window.jspdf) { say('PDF library not loaded', 'e'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: orientation || 'landscape', unit: 'pt', format: 'a4' });
    const margin = 32;
    let y = 40;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(title, margin, y);
    y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
    (subLines || []).forEach(line => { doc.text(line, margin, y); y += 13; });
    doc.setTextColor(0);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [headers],
      body: rows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [26, 34, 38] },
      alternateRowStyles: { fillColor: [245, 247, 246] },
    });
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('Excess Working — Bahria Town · auto-generated, figures reflect live data at time of export.', margin, doc.internal.pageSize.getHeight() - 18);
    doc.save(filename);
  }

  function summaryLines() {
    const s = state.summary;
    return [
      'Reference date: ' + (state.asOf || '—'),
      'Corrected Excess Value: Rs ' + fmt(s.correctedExcessStockValue) + '   ·   Retained: Rs ' + fmt(s.totalRetained) + '   ·   Loose: Rs ' + fmt(s.totalLoose) + '   ·   Misc buffer: Rs ' + fmt(s.misc),
    ];
  }

  function exportWorkingExcel() {
    if (!state.computed.length) { say('No excess rows to export yet', 'e'); return; }
    const rows = [...state.computed].sort((a, b) => b.correctedValue - a.correctedValue);
    const s = state.summary;
    const aoa = [
      ['Excess Working — Bahria Town'],
      ['Reference date', state.asOf || ''],
      ['Corrected Excess Value', s.correctedExcessStockValue],
      ['Retained Value', s.totalRetained],
      ['Loose Value', s.totalLoose],
      ['Misc buffer', s.misc],
      [],
      ['Code', 'Product Name', 'Excess Qty', 'Pack Qty', 'Raw Excess Value', 'Corrected Value', 'Status'],
    ];
    rows.forEach(r => aoa.push([r.code, r.name, r.qty, r.packQty, r.value, r.correctedValue, r.status]));
    exportExcelSheet(aoa, 'Excess Working', [12, 40, 12, 10, 16, 16, 12], 'excess_working_' + todayStamp() + '.xlsx');
    say('Excess Working exported (.xlsx)');
  }

  function exportWorkingPdf() {
    if (!state.computed.length) { say('No excess rows to export yet', 'e'); return; }
    const rows = [...state.computed].sort((a, b) => b.correctedValue - a.correctedValue)
      .map(r => [r.code, r.name, fmt(r.qty), fmt(r.packQty), fmt(r.value), fmt(r.correctedValue), r.status]);
    exportPdfTable(
      'Excess Working — Bahria Town',
      summaryLines(),
      ['Code', 'Product Name', 'Excess Qty', 'Pack Qty', 'Raw Value', 'Corrected Value', 'Status'],
      rows,
      'excess_working_' + todayStamp() + '.pdf',
      'landscape'
    );
    say('Excess Working exported (.pdf)');
  }

  function exportTopNExcel(n) {
    const top = topExcessRows(state.computed, n);
    if (!top.length) { say('No excess items to export yet', 'e'); return; }
    const aoa = [['Rank', 'Code', 'Product Name', 'Excess Qty', 'Pack Qty', 'Corrected Excess Value']];
    top.forEach((r, i) => aoa.push([i + 1, r.code, r.name, r.qty, r.packQty, r.correctedValue]));
    exportExcelSheet(aoa, 'Top ' + top.length + ' Excess', [6, 14, 40, 12, 10, 20], 'excess_top' + top.length + '_' + todayStamp() + '.xlsx');
    say('Top ' + top.length + ' excess items exported (.xlsx)');
  }

  function exportTopNPdf(n) {
    const top = topExcessRows(state.computed, n);
    if (!top.length) { say('No excess items to export yet', 'e'); return; }
    const rows = top.map((r, i) => [i + 1, r.code, r.name, fmt(r.qty), fmt(r.packQty), fmt(r.correctedValue)]);
    exportPdfTable(
      'Top ' + top.length + ' Excess Items — Bahria Town',
      summaryLines(),
      ['#', 'Code', 'Product Name', 'Excess Qty', 'Pack Qty', 'Corrected Value'],
      rows,
      'excess_top' + top.length + '_' + todayStamp() + '.pdf',
      'portrait'
    );
    say('Top ' + top.length + ' excess items exported (.pdf)');
  }

  // ---------- RENDER ----------
  function donutSvg(parts) {
    const total = parts.reduce((s, p) => s + Math.max(p.value, 0), 0) || 1;
    let acc = 0;
    const stops = parts.map(p => {
      const start = acc / total * 100;
      acc += Math.max(p.value, 0);
      const end = acc / total * 100;
      return p.color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%';
    }).join(', ');
    return 'background: conic-gradient(' + stops + '); border-radius:50%; -webkit-mask: radial-gradient(circle, transparent 42%, black 43%); mask: radial-gradient(circle, transparent 42%, black 43%);';
  }

  function renderRetainTab() {
    const chips = state.retainList.map((name, idx) => `
      <div class="chip"><span>${esc(name)}</span><button data-action="ew-retain-remove" data-idx="${idx}"><span class="material-symbols-outlined">close</span></button></div>
    `).join('');
    const names = Array.from(new Set(state.rawExcess.map(r => r.name).filter(Boolean))).sort().slice(0, 3000);
    return `
      <div class="card">
        <div class="card-head"><h3>Retain Stock List</h3><span class="hint">${state.retainList.length} item${state.retainList.length === 1 ? '' : 's'}</span></div>
        <div class="note">Items you always want to keep in stock — excluded from Excess regardless of pack quantity. Add or remove freely; the list is saved on this device.</div>
        <div class="add-row" style="margin-top:12px;">
          <input type="text" id="ewRetainInput" list="ewMasterNames" placeholder="Type a product name…">
          <datalist id="ewMasterNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          <button class="btn btn-primary btn-sm" data-action="ew-retain-add">Add</button>
        </div>
        <div class="chip-list" id="ewRetainChips">${chips || '<span class="hint">No retained items yet.</span>'}</div>
      </div>`;
  }

  function renderAdjustmentsTab() {
    const s = state.summary;
    let varianceHtml;
    if (s && s.variance !== null && s.variance !== undefined) {
      const ok = Math.abs(s.variance) < 1;
      varianceHtml = `<div class="note ${ok ? 'ok' : 'warn'}">${ok ? 'Matches. ' : 'Does not match. '}Reported HO value − sum of ledger rows (${fmt(s.totalRawValue)}): <b class="mono">${fmt(s.variance)}</b></div>`;
    } else {
      varianceHtml = `<div class="note">Sum of current excess rows: <b class="mono">${fmt(s ? s.totalRawValue : 0)}</b>. Optionally enter a reported HO figure below to check it matches.</div>`;
    }
    return `
      <div class="card">
        <div class="card-head"><h3>Adjustments</h3></div>
        <div class="field-row">
          <div class="field"><label class="field-label">Misc buffer</label><input type="number" id="ewMiscInput" value="${state.misc ?? 0}"></div>
          <div class="field"><label class="field-label">Reported HO value <span style="font-weight:400;">(optional)</span></label><input type="number" id="ewHoValueInput" placeholder="paste-in total, if given by HO" value="${state.hoValue ?? ''}"></div>
        </div>
        ${varianceHtml}
      </div>
      <div class="card">
        <div class="card-head"><h3>Pack size notes</h3></div>
        <div class="note">${state.computed.filter(r => r.packUnreliable).length} of ${state.computed.length} rows have a missing/invalid pack size and were treated as pack size 1 (matches the original spreadsheet's fallback behaviour).</div>
      </div>`;
  }

  function renderWorkingTab() {
    const s = state.summary || { totalExcess: 0, totalRetained: 0, totalLoose: 0, top10: 0, correctedExcessStockValue: 0 };
    const maxStat = Math.max(Math.abs(s.correctedExcessStockValue), s.totalRetained, s.totalLoose, s.top10, 1);
    const donutStyle = donutSvg([
      { value: Math.max(s.totalExcess, 0), color: 'var(--rust)' },
      { value: Math.max(s.totalRetained, 0), color: 'var(--indigo)' },
      { value: Math.max(s.totalLoose, 0), color: 'var(--slate)' },
    ]);
    let rows = state.computed;
    if (state.filter !== 'All') rows = rows.filter(r => r.status === state.filter);
    const q = (state.search || '').toLowerCase();
    if (q) rows = rows.filter(r => (r.code || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
    rows = [...rows].sort((a, b) => b.correctedValue - a.correctedValue);

    function retainBtnHtml(r) {
      const isRetained = r.status === 'Retained';
      const icon = isRetained ? 'bookmark' : 'bookmark_add';
      const title = isRetained ? 'Click to remove from retain list' : 'Click to add to retain list';
      return `<button class="retain-toggle-btn${isRetained ? ' active' : ''}" data-action="ew-retain-toggle" data-name="${esc(r.name)}" title="${title}"><span class="material-symbols-outlined">${icon}</span></button>`;
    }
    function rowHtml(r) {
      return `
      <tr>
        <td class="mono">${esc(r.code)}</td>
        <td class="wrap">${esc(r.name)}</td>
        <td class="num">${fmt(r.qty)}</td>
        <td class="num">${fmt(r.packQty)}</td>
        <td class="num">${fmt(r.correctedValue)}</td>
        <td><span class="status-pill ${r.status}">${r.status}</span></td>
        <td class="retain-col">${retainBtnHtml(r)}</td>
      </tr>`;
    }
    function groupedBody(list) {
      const groups = new Map();
      list.forEach(r => {
        const key = (r.company && String(r.company).trim()) || 'Unspecified';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
      const groupArr = Array.from(groups.entries()).map(([company, items]) => ({
        company, items, total: items.reduce((s, r) => s + r.correctedValue, 0)
      })).sort((a, b) => b.total - a.total);
      return groupArr.map(g => {
        const collapsed = state.collapsedGroups.has(g.company);
        const header = `
      <tr class="group-header" data-action="ew-group-toggle" data-company="${esc(g.company)}">
        <td colspan="7">
          <span class="material-symbols-outlined group-chev">${collapsed ? 'chevron_right' : 'expand_more'}</span>
          <span class="group-name">${esc(g.company)}</span>
          <span class="hint group-count">${g.items.length} item${g.items.length === 1 ? '' : 's'}</span>
          <span class="num group-total">${fmt(g.total)}</span>
        </td>
      </tr>`;
        const body = collapsed ? '' : g.items.map(rowHtml).join('');
        return header + body;
      }).join('');
    }

    const tableBody = rows.length
      ? (state.groupByCompany ? groupedBody(rows) : rows.map(rowHtml).join(''))
      : '<tr class="empty-row"><td colspan="7" class="no-data-note">No rows match.</td></tr>';

    return `
      <div class="stat-grid">
        <div class="stat excess"><div class="stat-top"><div class="hint">Corrected Excess Value</div></div><div class="val">${fmt(s.correctedExcessStockValue)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.abs(s.correctedExcessStockValue) / maxStat * 100)}%;"></div></div></div>
        <div class="stat retained"><div class="stat-top"><div class="hint">Retained Value</div></div><div class="val">${fmt(s.totalRetained)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, s.totalRetained / maxStat * 100)}%;"></div></div></div>
        <div class="stat loose"><div class="stat-top"><div class="hint">Loose Value</div></div><div class="val">${fmt(s.totalLoose)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, s.totalLoose / maxStat * 100)}%;"></div></div></div>
        <div class="stat corrected"><div class="stat-top"><div class="hint">Top 10 High Value</div></div><div class="val">${fmt(s.top10)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, s.top10 / maxStat * 100)}%;"></div></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Value composition</h3><span class="hint">share of raw excess value</span></div>
        <div class="chart-row">
          <div class="donut" style="${donutStyle}"></div>
          <div class="donut-legend">
            <div class="li"><span class="sw" style="background:var(--rust);"></span><span class="lbl">Excess</span><span class="lv mono">${fmt(s.totalExcess)}</span></div>
            <div class="li"><span class="sw" style="background:var(--indigo);"></span><span class="lbl">Retained</span><span class="lv mono">${fmt(s.totalRetained)}</span></div>
            <div class="li"><span class="sw" style="background:var(--slate);"></span><span class="lbl">Loose</span><span class="lv mono">${fmt(s.totalLoose)}</span></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="filter-row">
          <button class="ftab${state.filter === 'All' ? ' active' : ''}" data-f="All" data-action="ew-filter">All</button>
          <button class="ftab${state.filter === 'Excess' ? ' active' : ''}" data-f="Excess" data-action="ew-filter">Excess</button>
          <button class="ftab${state.filter === 'Loose' ? ' active' : ''}" data-f="Loose" data-action="ew-filter">Loose</button>
          <button class="ftab${state.filter === 'Retained' ? ' active' : ''}" data-f="Retained" data-action="ew-filter">Retained</button>
          <div class="search-box"><span class="material-symbols-outlined">search</span><input type="text" id="ewSearchBox" placeholder="Search code or name…" value="${esc(state.search)}"></div>
          <div class="toggle-group" id="ewGroupToggle">
            <button class="${!state.groupByCompany ? 'active' : ''}" data-action="ew-group" data-group="0">List</button>
            <button class="${state.groupByCompany ? 'active' : ''}" data-action="ew-group" data-group="1">By Company</button>
          </div>
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr><th>Code</th><th>Product Name</th><th class="num">Excess Qty</th><th class="num">Pack Qty</th><th class="num">Value</th><th>Status</th><th class="retain-col-h">Retain</th></tr></thead>
            <tbody id="ewTableBody">${tableBody}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderExportTab() {
    const top = topExcessRows(state.computed, state.topN);
    const rowsHtml = top.length ? top.map((r, i) => `
      <tr><td>${i + 1}</td><td class="mono">${esc(r.code)}</td><td class="wrap">${esc(r.name)}</td><td class="num">${fmt(r.qty)}</td><td class="num">${fmt(r.packQty)}</td><td class="num">${fmt(r.correctedValue)}</td></tr>
    `).join('') : '<tr class="empty-row"><td colspan="6" class="no-data-note">No excess items yet.</td></tr>';
    return `
      <div class="card">
        <div class="card-head"><h3>View &amp; Export Top Excess Items</h3><span class="hint">ranked by corrected excess value</span></div>
        <div class="filter-row">
          <label class="field-label" style="margin:0;">Top</label>
          <input type="number" id="ewTopNInput" value="${state.topN}" min="1" step="1" style="width:80px; padding:8px 10px; border:1px solid var(--line); border-radius:5px; font-family:var(--mono);">
          <button class="btn btn-sm" data-topn-preset="10">10</button>
          <button class="btn btn-sm" data-topn-preset="20">20</button>
          <button class="btn btn-sm" data-topn-preset="50">50</button>
          <div class="export-actions">
            <button class="btn btn-primary" data-action="ew-export-topn-excel"><span class="material-symbols-outlined">table_view</span>Top N Excel</button>
            <button class="btn" data-action="ew-export-topn-pdf"><span class="material-symbols-outlined">picture_as_pdf</span>Top N PDF</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap tablewrap">
          <table>
            <thead><tr><th>#</th><th>Code</th><th>Product Name</th><th class="num">Excess Qty</th><th class="num">Pack Qty</th><th class="num">Corrected Value</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Full working sheet</h3><span class="hint">every row, all statuses</span></div>
        <div class="btn-group">
          <button class="btn btn-primary" data-action="ew-export-working-excel"><span class="material-symbols-outlined">table_view</span>Export full (.xlsx)</button>
          <button class="btn" data-action="ew-export-working-pdf"><span class="material-symbols-outlined">picture_as_pdf</span>Export full (.pdf)</button>
        </div>
      </div>`;
  }

  function render() {
    const root = document.getElementById('page-excess');
    if (!root) return;

    if (!state.dataReady) {
      const body = $('#ew-body', root);
      if (body) {
        body.innerHTML = `
          <div class="no-data-note">
            <strong>No Stock Ledger data loaded yet</strong>
            Excess Working reads its rows straight from the Stock Ledger page's "100-Day Excess" tab.
            Load your inventory file there first (Supabase, Dropbox, or upload), then come back here.
          </div>
          <div class="reload-row" style="justify-content:center;">
            <button class="btn btn-primary" data-action="ew-goto-stockledger">Go to Stock Ledger</button>
            <button class="btn" data-action="ew-refresh">Check again</button>
          </div>`;
      }
      const asof = $('#ew-asofLine', root);
      if (asof) asof.textContent = '';
      return;
    }

    const asof = $('#ew-asofLine', root);
    if (asof) asof.textContent = 'Reference date: ' + (state.asOf || '—') + ' · ' + state.rawExcess.length + ' excess rows from Stock Ledger';

    const tabTitles = { retain: 'Retain Stock List', adjustments: 'Adjustments', working: 'Working', export: 'View & Export Top Excess Items' };
    $$('.ew-tab', root).forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    let body;
    if (state.tab === 'retain') body = renderRetainTab();
    else if (state.tab === 'adjustments') body = renderAdjustmentsTab();
    else if (state.tab === 'export') body = renderExportTab();
    else body = renderWorkingTab();

    const bodyEl = $('#ew-body', root);
    if (bodyEl) bodyEl.innerHTML = `
      <div class="reload-row">
        <span class="badge">${tabTitles[state.tab]}</span>
        <button class="btn btn-sm" data-action="ew-refresh"><span class="material-symbols-outlined">refresh</span>Refresh from Stock Ledger</button>
      </div>
      ${body}`;
  }

  // ---------- EVENTS (delegated once on the page container) ----------
  function wireOnce(root) {
    root.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action],[data-tab],[data-f],[data-topn-preset]');
      if (!btn) return;

      const tabBtn = e.target.closest('.ew-tab');
      if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); return; }

      const action = btn.dataset.action;
      if (action === 'ew-refresh') { refreshFromStockLedger(false); render(); return; }
      if (action === 'ew-goto-stockledger') { if (typeof window.navigateTo === 'function') window.navigateTo('stockledger'); return; }
      if (action === 'ew-retain-add') {
        const input = $('#ewRetainInput', root);
        const val = (input && input.value || '').trim();
        if (!val) return;
        if (!state.retainList.some(x => x.toLowerCase() === val.toLowerCase())) {
          state.retainList.push(val);
          saveRetain();
          recompute();
          say('Added to retain list: ' + val);
        }
        if (input) input.value = '';
        render();
        return;
      }
      if (action === 'ew-retain-remove') {
        const idx = Number(btn.dataset.idx);
        const removed = state.retainList.splice(idx, 1);
        saveRetain();
        recompute();
        if (removed[0]) say('Removed from retain list: ' + removed[0]);
        render();
        return;
      }
      if (action === 'ew-retain-toggle') {
        const name = btn.dataset.name || '';
        if (!name) return;
        const key = name.toLowerCase();
        const idx = state.retainList.findIndex(x => x.toLowerCase() === key);
        if (idx >= 0) {
          state.retainList.splice(idx, 1);
          saveRetain(); recompute();
          say('Removed from retain list: ' + name);
        } else {
          state.retainList.push(name);
          saveRetain(); recompute();
          say('Added to retain list: ' + name);
        }
        render();
        return;
      }
      if (action === 'ew-group') { state.groupByCompany = btn.dataset.group === '1'; render(); return; }
      if (action === 'ew-group-toggle') {
        const company = btn.dataset.company || '';
        if (state.collapsedGroups.has(company)) state.collapsedGroups.delete(company);
        else state.collapsedGroups.add(company);
        render();
        return;
      }
      if (action === 'ew-filter') { state.filter = btn.dataset.f; render(); return; }
      if (action === 'ew-export-working-excel') { exportWorkingExcel(); return; }
      if (action === 'ew-export-working-pdf') { exportWorkingPdf(); return; }
      if (action === 'ew-export-topn-excel') { exportTopNExcel(state.topN); return; }
      if (action === 'ew-export-topn-pdf') { exportTopNPdf(state.topN); return; }
      if (btn.dataset.topnPreset) { state.topN = Number(btn.dataset.topnPreset); render(); return; }
    });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'ewRetainInput') {
        e.preventDefault();
        const addBtn = root.querySelector('[data-action="ew-retain-add"]');
        if (addBtn) addBtn.click();
      }
    });

    root.addEventListener('input', function (e) {
      if (e.target.id === 'ewSearchBox') { state.search = e.target.value; render(); return; }
      if (e.target.id === 'ewMiscInput') {
        state.misc = parseFloat(e.target.value) || 0;
        saveMisc(); recompute();
        // re-render only the working/adjustments numbers, not the whole tab
        // (cheap enough to just re-render fully — dataset sizes here are
        // hundreds, not thousands, of rows).
        render();
        return;
      }
      if (e.target.id === 'ewHoValueInput') {
        state.hoValue = e.target.value;
        saveHoValue(); recompute();
        render();
        return;
      }
      if (e.target.id === 'ewTopNInput') {
        const v = parseInt(e.target.value, 10);
        state.topN = (v && v > 0) ? v : 20;
        render();
        return;
      }
    });
  }

  // ---------- INIT ----------
  function init() {
    const root = document.getElementById('page-excess');
    if (!root) { console.error('ExcessWorkingApp.init(): #page-excess not found in the DOM yet.'); return; }
    if (!initialized) {
      initialized = true;
      state.retainList = loadRetain();
      state.misc = loadMisc();
      state.hoValue = loadHoValue();
      wireOnce(root);
    }
    refreshFromStockLedger(true);
    render();
  }

  return { init: init };
})();
