// ══════════════════════════════════════════════════════════════════════
// CASH TO BE DEPOSITED REPORT  —  new Sale Data report.
//
// Value = Cash Sale − Cash Returns + FDPP POS + FDPP Consumer, computed
// fresh for every day on record (start of data → today). This is a
// DERIVED figure, separate from the manually-typed "Cash to be
// Deposited" entry field elsewhere in the app (fields.js/reports.js) —
// that one is whatever a person typed in; this one is always the live
// arithmetic result, so it can never drift from the four inputs it's
// built from.
//
// Every day is listed with a checkbox. Ticking one or more opens a
// popup showing the combined total plus a day-by-day breakdown, with a
// Print button that renders straight to a 72mm thermal receipt via
// Print.renderThermal() (js/print.js) — a single page sized to the
// content, not a paginated Letter-size document like every other
// report in this app.
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  let _cdrRows = [];             // every day on record, chronological (oldest → newest)
  const _cdrSelected = new Set(); // selected Date strings

  // ---------- data ----------
  function _cdrCompute(d) {
    const cashSale = n(d['Cash Sale']);
    const cashRet  = negR(d['Cash Returns']);   // always stored/returned negative
    const fdpp     = n(d['FDPP']);
    const fdppCon  = n(d['FDPP Con']);
    const total    = cashSale + cashRet + fdpp + fdppCon;
    return { cashSale, cashRet, fdpp, fdppCon, total };
  }

  function _cdrBuildRows() {
    // Same "has data" signal Daily Data / Sale Report already use
    // (TOTAL!==0, or a Low Sale Reason note on an otherwise-zero day) —
    // keeps blank template rows out without inventing a new rule.
    return DAILY.filter(d => n(d.TOTAL) !== 0 || d['Low Sale Reason'])
      .map(d => Object.assign({ Date: d.Date, Month_Year: d.Month_Year }, _cdrCompute(d)))
      .sort((a, b) => _dateVal(a.Date) - _dateVal(b.Date)); // start → now
  }

  // ---------- init / filters ----------
  function cdrInit() {
    _cdrRows = _cdrBuildRows();
    _cdrSelected.clear();
    _cdrPopulateMonthFilter();
    cdrRender();
  }

  function _cdrPopulateMonthFilter() {
    const sel = document.getElementById('cdr-month');
    if (!sel) return;
    const cur = sel.value;
    const monthsList = [...new Set(_cdrRows.map(r => r.Month_Year))].reverse(); // newest first
    sel.innerHTML = '<option value="">All Months</option>' + monthsList.map(m => `<option value="${m}">${m}</option>`).join('');
    sel.value = monthsList.includes(cur) ? cur : '';
  }

  function _cdrFiltered() {
    const q = (document.getElementById('cdr-search')?.value || '').toLowerCase();
    const mon = document.getElementById('cdr-month')?.value || '';
    return _cdrRows.filter(r =>
      (!mon || r.Month_Year === mon) &&
      (!q || (r.Date || '').toLowerCase().includes(q) || (r.Month_Year || '').toLowerCase().includes(q))
    );
  }

  // ---------- render ----------
  function cdrRender() {
    const tbody = document.getElementById('cdr-tbody');
    if (!tbody) return;
    const rows = _cdrFiltered();
    tbody.innerHTML = rows.map(r => `
      <tr class="${_cdrSelected.has(r.Date) ? 'cdr-row-sel' : ''}">
        <td><input type="checkbox" ${_cdrSelected.has(r.Date) ? 'checked' : ''} onchange="cdrToggleRow('${r.Date}',this.checked)" style="width:16px;height:16px;accent-color:var(--accent)"></td>
        <td style="text-align:left">${r.Date}</td>
        <td style="text-align:left;color:var(--muted);font-size:11px">${r.Month_Year}</td>
        <td style="font-family:var(--mono)">${fv(r.cashSale)}</td>
        <td style="font-family:var(--mono)">${fv(r.cashRet)}</td>
        <td style="font-family:var(--mono)">${fv(r.fdpp)}</td>
        <td style="font-family:var(--mono)">${fv(r.fdppCon)}</td>
        <td style="font-family:var(--mono);font-weight:700">${fv(r.total)}</td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">No daily records yet</td></tr>';

    const allCb = document.getElementById('cdr-check-all');
    if (allCb) allCb.checked = rows.length > 0 && rows.every(r => _cdrSelected.has(r.Date));
    _cdrUpdateSelbar();
  }

  function cdrToggleRow(date, checked) {
    if (checked) _cdrSelected.add(date); else _cdrSelected.delete(date);
    // Re-render fully rather than patching the one row/checkbox-all state by
    // hand — dataset here is hundreds of rows, not thousands, so a full
    // rebuild stays cheap (same call this file already makes from
    // cdrToggleAll/cdrInit).
    cdrRender();
  }

  function cdrToggleAll(checked) {
    _cdrFiltered().forEach(r => { if (checked) _cdrSelected.add(r.Date); else _cdrSelected.delete(r.Date); });
    cdrRender();
  }

  function _cdrUpdateSelbar() {
    const bar = document.getElementById('cdr-selbar');
    const label = document.getElementById('cdr-sel-label');
    const totalEl = document.getElementById('cdr-sel-total');
    if (!bar) return;
    const selRows = _cdrRows.filter(r => _cdrSelected.has(r.Date));
    if (!selRows.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const total = selRows.reduce((s, r) => s + r.total, 0);
    if (label) label.textContent = selRows.length + (selRows.length === 1 ? ' day selected' : ' days selected');
    if (totalEl) totalEl.textContent = '₨' + fv(total);
  }

  function _cdrSelectedRows() {
    return _cdrRows.filter(r => _cdrSelected.has(r.Date)).sort((a, b) => _dateVal(a.Date) - _dateVal(b.Date));
  }

  // ---------- popup: totals + detail ----------
  function cdrOpenPopup() {
    const rows = _cdrSelectedRows();
    if (!rows.length) { toast('⚠ Select at least one day first', 'w'); return; }
    const total = rows.reduce((s, r) => s + r.total, 0);
    const titleEl = document.getElementById('cdr-modal-title');
    const bodyEl = document.getElementById('cdr-modal-body');
    const bgEl = document.getElementById('cdrbg');
    if (!titleEl || !bodyEl || !bgEl) return;
    titleEl.textContent = (rows.length === 1 ? '1 Day' : rows.length + ' Days') + ' · Cash to be Deposited';
    bodyEl.innerHTML = _cdrBuildDetailHTML(rows, total);
    bgEl.classList.add('on');
  }

  function closeCdrPopup() { document.getElementById('cdrbg')?.classList.remove('on'); }

  function _cdrDmRow(lbl, val) {
    const cls = val > 0 ? 'p' : val < 0 ? 'n' : 'z';
    return `<div class="dmrow"><span class="dml">${lbl}</span><span class="dmv ${cls}">${fv(val)}</span></div>`;
  }

  function _cdrBuildDetailHTML(rows, total) {
    const days = rows.map(r => `
      <div class="cdr-daycard">
        <div class="cdr-daycard-hdr">${r.Date} <span>${r.Month_Year}</span></div>
        ${_cdrDmRow('Cash Sale', r.cashSale)}
        ${_cdrDmRow('Cash Returns', r.cashRet)}
        ${_cdrDmRow('FDPP POS', r.fdpp)}
        ${_cdrDmRow('FDPP Consumer', r.fdppCon)}
        <div class="dmnet"><span>Cash to be Deposited</span><span style="font-family:var(--mono)">${fv(r.total)}</span></div>
      </div>`).join('');
    return `
      <div class="cdr-grandbar"><span>Total — ${rows.length} ${rows.length === 1 ? 'day' : 'days'}</span><span>₨${fv(total)}</span></div>
      ${days}`;
  }

  // ---------- print: 72mm thermal ----------
  function _cdrThermalHTML(rows, total) {
    const now = new Date();
    const stamp = now.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    const line = (l, v, bold) => `<tr><td style="padding:1px 0;font-size:11px;${bold ? 'font-weight:700' : ''}">${l}</td><td style="padding:1px 0;font-size:11px;text-align:right;font-family:monospace;${bold ? 'font-weight:700' : ''}">${fv(v)}</td></tr>`;
    const dayBlocks = rows.map(r => `
      <div style="border-top:1px dashed #000;margin-top:5px;padding-top:4px">
        <div style="font-size:12px;font-weight:700">${r.Date}</div>
        <table style="width:100%;border-collapse:collapse">
          ${line('Cash Sale', r.cashSale)}
          ${line('Cash Returns', r.cashRet)}
          ${line('FDPP POS', r.fdpp)}
          ${line('FDPP Consumer', r.fdppCon)}
          ${line('Cash to Deposit', r.total, true)}
        </table>
      </div>`).join('');
    return `
      <div style="width:100%;box-sizing:border-box;padding:6px 10px;font-family:Arial,sans-serif;color:#000">
        <div style="text-align:center;font-size:13px;font-weight:700;letter-spacing:.03em">BAHRIA TOWN</div>
        <div style="text-align:center;font-size:11px;font-weight:600;margin-bottom:2px">CASH TO BE DEPOSITED</div>
        <div style="text-align:center;font-size:10px;color:#333;margin-bottom:2px">${rows.length} ${rows.length === 1 ? 'day' : 'days'} · ${rows[0].Date}${rows.length > 1 ? ' – ' + rows[rows.length - 1].Date : ''}</div>
        ${dayBlocks}
        <div style="border-top:1px solid #000;margin-top:6px;padding-top:5px;display:flex;justify-content:space-between;font-size:13px;font-weight:700">
          <span>TOTAL</span><span style="font-family:monospace">₨${fv(total)}</span>
        </div>
        <div style="text-align:center;font-size:9px;color:#555;margin-top:8px">Printed ${stamp}</div>
      </div>`;
  }

  function cdrPrintPopup() {
    const rows = _cdrSelectedRows();
    if (!rows.length) { toast('⚠ Select at least one day first', 'w'); return; }
    const total = rows.reduce((s, r) => s + r.total, 0);
    const html = _cdrThermalHTML(rows, total);
    if (window.Print && typeof window.Print.renderThermal === 'function') {
      window.Print.renderThermal(html, { filename: 'Cash-Deposit-Report' });
    } else {
      toast('⚠ Print engine unavailable', 'e');
    }
  }

  // ---------- bridge ----------
  window.cdrInit = cdrInit;
  window.cdrRender = cdrRender;
  window.cdrToggleRow = cdrToggleRow;
  window.cdrToggleAll = cdrToggleAll;
  window.cdrOpenPopup = cdrOpenPopup;
  window.closeCdrPopup = closeCdrPopup;
  window.cdrPrintPopup = cdrPrintPopup;

})();
