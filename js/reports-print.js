// PRINT REPORTS — Monthly & Yearly
// ══════════════════════════════════════════

(function() {
'use strict';

function _prRow(lbl, val, opts='') {
  const v = Math.round(n(val));
  const s = v === 0 ? '—' : '₨ ' + Math.abs(v).toLocaleString('en-PK');
  return `<tr${opts}><td class="l">${lbl}</td><td class="r">${s}</td></tr>`;
}
function _prRowOpt(lbl, val, opts='') { return n(val) !== 0 ? _prRow(lbl, val, opts) : ''; }

// Candidate daily columns for the landscape breakdown page. Only columns
// with at least one non-zero value in the selected month are rendered.
const DAILY_COL_DEFS = [
  ['Cash Sale','Cash Sale'], ['Cash Returns','Cash Returns'],
  ['HBL','HBL'], ['MCB','MCB'], ['Alfala Bank','Bank Alfalah'],
  ['Bank Al Habib','Bank Al Habib'], ['Meezan Bank (Paysa)','Meezan Bank'],
  ['Askari Bank','Askari'], ['Askari Bank Returns','Askari Returns'],
  ['PSO','PSO'], ['PSO Returns','PSO Returns'],
  ['NESPAK','NESPAK'], ['NESPAK Returns','NESPAK Returns'],
  ['PARCO','PARCO'], ['PARCO Returns','PARCO Returns'],
  ['TEPA','TEPA'], ['TEPA Returns','TEPA Returns'],
  ['LDA','LDA'], ['LDA Returns','LDA Returns'],
  ['Gourmet','Gourmet'], ['Wapda Hospital','Wapda Hosp.'], ['BTH','BTH'],
  ['Berger Paints','Berger Paints'], ['Ecolean PK','Ecolean PK'],
  ['Style Textile','Style Textile'], ['Syed Babar Ali Foundation','SBA Fdn'],
  ['Rahnuma NGO','Rahnuma NGO'], ['Health Pass','Health Pass'],
  ['Nisar Spinning Mills','Nisar Spinning'], ['Food Panda','Food Panda'],
  ['F/Issue','F/Issue'], ['COMP SALE','COMP Sale'],
  ['FDPP','FDPP POS'], ['FDPP Con','FDPP Consumer'],
  ['Amount Received','Amount Received'], ['Load Sale','Load Sale'],
  ['Cash to be Deposited','Cash to Deposit'],
];


// ── Monthly print ─────────────────────────────────────────────────────────────
function buildMonthlyPrintHTML(my) {
  const m = MONTHLY.find(x => x.Month_Year === my);
  if (!m) return null;
  const days = DAILY.filter(d => d.Month_Year === my && (n(d.TOTAL) !== 0 || d['Low Sale Reason']));
  days.sort((a, b) => _dateVal(a.Date) - _dateVal(b.Date));
  const tgts = getTgts(), tgt = tgts[my];
  const total = n(m.TOTAL), cust = n(m.Customers);
  const pct = tgt ? Math.min(100, Math.round(total / tgt * 100)) : null;
  const today = new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});

  const kpiHtml = `<div class="pr-kpis">
    <div class="pr-kpi"><div class="pr-kpi-l">Total Sales</div><div class="pr-kpi-v">₨${(total/1e6).toFixed(2)}M</div></div>
    <div class="pr-kpi"><div class="pr-kpi-l">Customers</div><div class="pr-kpi-v">${Math.round(cust).toLocaleString('en-PK')}</div></div>
    <div class="pr-kpi"><div class="pr-kpi-l">Target Progress</div><div class="pr-kpi-v">${pct !== null ? pct + '%' : 'N/A'}</div></div>
  </div>`;

  const summHtml = `<table class="pr-tbl">
    <thead><tr><th>Category</th><th class="r">Amount (₨)</th></tr></thead>
    <tbody>
    <tr class="grp"><td colspan="2">Cash</td></tr>
    ${_prRow('Cash Sale', m['Cash Sale'])}
    ${_prRowOpt('Cash Returns', m['Cash Returns'])}
    ${_prRowOpt('Bank Alfalah', m['Alfala Bank'])}
    ${_prRowOpt('Bank Al Habib', m['Bank Al Habib'])}
    ${_prRowOpt('Meezan Bank', m['Meezan Bank (Paysa)'])}
    ${_prRowOpt('HBL', m.HBL)}
    ${_prRowOpt('MCB', m.MCB)}
    <tr class="grp"><td colspan="2">Credit Clients</td></tr>
    ${_prRowOpt('PSO', m.PSO)}
    ${_prRowOpt('NESPAK', m.NESPAK)}
    ${_prRowOpt('PARCO', m.PARCO)}
    ${_prRowOpt('TEPA', m.TEPA)}
    ${_prRowOpt('LDA', m.LDA)}
    ${_prRowOpt('Gourmet', m.Gourmet)}
    ${_prRowOpt('Wapda Hospital', m['Wapda Hospital'])}
    ${_prRowOpt('BTH', m.BTH)}
    ${_prRowOpt('Berger Paints', m['Berger Paints'])}
    ${_prRowOpt('Ecolean PK', m['Ecolean PK'])}
    ${_prRowOpt('Style Textile', m['Style Textile'])}
    ${_prRowOpt('Syed Babar Ali Fdn', m['Syed Babar Ali Foundation'])}
    ${_prRowOpt('Rahnuma NGO', m['Rahnuma NGO'])}
    ${_prRowOpt('Health Pass', m['Health Pass'])}
    ${_prRowOpt('Nisar Spinning', m['Nisar Spinning Mills'])}
    ${_prRowOpt('Food Panda', m['Food Panda'])}
    ${_prRowOpt('Askari', m['Askari Bank'])}
    ${_prRowOpt('Askari Returns', m['Askari Bank Returns'])}
    ${_prRowOpt('PSO Returns', negR(m['PSO Returns']))}
    ${_prRowOpt('NESPAK Returns', negR(m['NESPAK Returns']))}
    ${_prRowOpt('PARCO Returns', negR(m['PARCO Returns']))}
    ${_prRowOpt('TEPA Returns', negR(m['TEPA Returns']))}
    ${_prRowOpt('LDA Returns', negR(m['LDA Returns']))}
    ${_prRowOpt('F/Issue', m['F/Issue'])}
    <tr class="tot"><td>GRAND TOTAL</td><td class="r">₨${Math.round(total).toLocaleString('en-PK')}</td></tr>
    <tr><td class="l">Customers</td><td class="r">${Math.round(cust).toLocaleString('en-PK')}</td></tr>
    ${tgt ? `<tr><td class="l">Monthly Target</td><td class="r">₨${Math.round(tgt).toLocaleString('en-PK')} (${pct}%)</td></tr>` : ''}
    </tbody>
  </table>`;

  // Page 2+: landscape daily breakdown — only columns with real data.
  // Rows are explicitly chunked into fixed-size pages rather than letting
  // one huge table overflow naturally. Letting the browser handle overflow
  // across a landscape page caused two bugs in testing: (1) any rows past
  // what fit on the first landscape page got silently pushed onto a 3rd
  // page that reverted to portrait (named @page rules don't reliably
  // re-apply to browser-generated continuation pages), and (2) faint
  // ghosted content from page 1 bled through behind that broken page.
  // Giving every page its own explicit .pr-landscape wrapper sidesteps
  // both issues entirely — each page is independently forced to landscape.
  const ROWS_PER_PAGE = 26; // fits comfortably on a Letter landscape page with ~9 columns
  // Returns-type columns must always display/sum as negative, regardless of
  // how the underlying record happens to be signed (see RETURN_FIELDS /
  // negR in config.js) — this is what keeps the printed report correct
  // even for records edited before that bug was fixed at the source.
  const colVal = (d, key) => RETURN_FIELDS.has(key) ? negR(d[key]) : n(d[key]);
  const activeCols = DAILY_COL_DEFS.filter(([key]) => days.some(d => colVal(d, key) !== 0));
  const hasNotes = days.some(d => d['Low Sale Reason']);
  const colCount = 3 + activeCols.length + (hasNotes ? 1 : 0);

  const dayHeadCells = [
    '<th>Date</th>', '<th class="r">Total</th>', '<th class="r">Customers</th>',
    ...activeCols.map(([,label]) => `<th class="r">${label}</th>`),
    ...(hasNotes ? ['<th>Note</th>'] : []),
  ].join('');

  function rowHtml(d) {
    const cells = [
      `<td class="l">${d.Date}</td>`,
      `<td class="r">${n(d.TOTAL) ? '₨ ' + Math.round(n(d.TOTAL)).toLocaleString('en-PK') : '—'}</td>`,
      `<td class="r">${n(d.Customers) ? Math.round(n(d.Customers)).toLocaleString('en-PK') : '—'}</td>`,
      ...activeCols.map(([key]) => { const v = colVal(d, key); return `<td class="r">${v ? '₨ ' + Math.round(v).toLocaleString('en-PK') : '—'}</td>`; }),
      ...(hasNotes ? [`<td class="l" style="font-size:9px;color:#64748b">${d['Low Sale Reason'] || ''}</td>`] : []),
    ];
    return `<tr>${cells.join('')}</tr>`;
  }

  function totalsRowHtml() {
    return `<tr class="tot">
      <td class="l">TOTAL</td>
      <td class="r">₨ ${Math.round(total).toLocaleString('en-PK')}</td>
      <td class="r">${Math.round(cust).toLocaleString('en-PK')}</td>
      ${activeCols.map(([key]) => `<td class="r">₨ ${Math.round(days.reduce((s,d)=>s+colVal(d,key),0)).toLocaleString('en-PK')}</td>`).join('')}
      ${hasNotes ? '<td></td>' : ''}
    </tr>`;
  }

  // Split days into fixed-size chunks, one per landscape page.
  const dayChunks = [];
  for (let i = 0; i < days.length; i += ROWS_PER_PAGE) dayChunks.push(days.slice(i, i + ROWS_PER_PAGE));
  if (!dayChunks.length) dayChunks.push([]); // still render an empty page if no data

  const totalPages = dayChunks.length;
  const landscapePages = dayChunks.map((chunk, idx) => {
    const isLast = idx === dayChunks.length - 1;
    const rows = chunk.map(rowHtml).join('')
      || `<tr><td colspan="${colCount}" style="text-align:center;padding:12px;color:#94a3b8">No daily records</td></tr>`;
    const tbody = rows + (isLast && days.length ? totalsRowHtml() : '');
    const pageNote = totalPages > 1 ? ` — Page ${idx + 1} of ${totalPages}` : '';
    return `<div class="pr-landscape">
      <div class="pr-land-title">Daily Breakdown — ${my} (${days.length} day${days.length===1?'':'s'})${pageNote}</div>
      <table class="pr-tbl">
        <thead><tr>${dayHeadCells}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<div style="max-width:680px;margin:0 auto">
    <div class="pr-header">
      <div><h1>BAHRIA TOWN SALES IC</h1><p>Monthly Sales Report — ${my}</p></div>
      <div class="pr-meta">Printed: ${today}</div>
    </div>
    ${kpiHtml}
    <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:6px">Summary</div>
    ${summHtml}
  </div>
  ${landscapePages}`;
}

function printMonthReport(my) {
  if (!my) { toast('⚠ No month selected', 'w'); return; }
  const html = buildMonthlyPrintHTML(my);
  if (!html) { toast('⚠ No data for ' + my, 'e'); return; }
  btPrint(html);
}

// ── Yearly print ──────────────────────────────────────────────────────────────
function buildYearlyPrintHTML(yr) {
  const MONTH_ORDER = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mons = MONTHLY.filter(m => m.Month_Year.endsWith(yr))
    .sort((a, b) => MONTH_ORDER.indexOf(a.Month_Year.split(' ')[0]) - MONTH_ORDER.indexOf(b.Month_Year.split(' ')[0]));
  if (!mons.length) return null;
  const tgts = getTgts();
  const total = mons.reduce((s, m) => s + n(m.TOTAL), 0);
  const totalCust = mons.reduce((s, m) => s + n(m.Customers), 0);
  const totalCash = mons.reduce((s, m) => s + n(m['Cash Sale']) + negR(m['Cash Returns']), 0);
  const today = new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  const avgMon = mons.length ? total / mons.length : 0;
  const bestMon = mons.reduce((best, m) => n(m.TOTAL) > n(best.TOTAL) ? m : best, mons[0]);

  const kpiHtml = `<div class="pr-kpis">
    <div class="pr-kpi"><div class="pr-kpi-l">Total Sales ${yr}</div><div class="pr-kpi-v">₨${(total/1e6).toFixed(2)}M</div></div>
    <div class="pr-kpi"><div class="pr-kpi-l">Total Customers</div><div class="pr-kpi-v">${Math.round(totalCust).toLocaleString('en-PK')}</div></div>
    <div class="pr-kpi"><div class="pr-kpi-l">Monthly Average</div><div class="pr-kpi-v">₨${(avgMon/1e6).toFixed(2)}M</div></div>
  </div>`;

  const monRows = mons.map(m => {
    const t = n(m.TOTAL), tgt = tgts[m.Month_Year];
    const pct = tgt ? Math.min(100, Math.round(t / tgt * 100)) : null;
    return `<tr>
      <td class="l">${m.Month_Year.split(' ')[0]}</td>
      <td class="r">₨ ${Math.round(t).toLocaleString('en-PK')}</td>
      <td class="r">₨ ${Math.round(n(m['Cash Sale'])).toLocaleString('en-PK')}</td>
      <td class="r">${Math.round(n(m.Customers)).toLocaleString('en-PK')}</td>
      <td class="r">${tgt ? '₨ ' + Math.round(tgt).toLocaleString('en-PK') : '—'}</td>
      <td class="r">${pct !== null ? pct + '%' : '—'}</td>
    </tr>`;
  }).join('');

  const clientCols = ['PSO','PSO Returns','NESPAK','NESPAK Returns','PARCO','PARCO Returns','TEPA','TEPA Returns','LDA','LDA Returns','Gourmet','Wapda Hospital','BTH','Berger Paints','Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','Askari Bank','Askari Bank Returns','F/Issue'];
  const clientRows = clientCols.map(c => {
    const pick = RETURN_FIELDS.has(c) ? negR : n;
    const v = mons.reduce((s, m) => s + pick(m[c]), 0);
    return v !== 0 ? _prRow(c, v) : '';
  }).join('');
  const bankCols = ['HBL','MCB','Alfala Bank','Bank Al Habib','Meezan Bank (Paysa)'];
  const bankRows = bankCols.map(c => {
    const v = mons.reduce((s, m) => s + n(m[c]), 0);
    return v !== 0 ? _prRow(c, v) : '';
  }).join('');

  return `<div style="max-width:720px;margin:0 auto">
    <div class="pr-header">
      <div><h1>BAHRIA TOWN SALES IC</h1><p>Annual Sales Report — ${yr} &nbsp;·&nbsp; ${mons.length} months &nbsp;·&nbsp; Best: ${bestMon.Month_Year.split(' ')[0]}</p></div>
      <div class="pr-meta">Printed: ${today}</div>
    </div>
    ${kpiHtml}
    <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:6px">Month-by-Month Breakdown</div>
    <table class="pr-tbl">
      <thead><tr><th>Month</th><th class="r">Total</th><th class="r">Cash Sale</th><th class="r">Customers</th><th class="r">Target</th><th class="r">% Achieved</th></tr></thead>
      <tbody>
        ${monRows}
        <tr class="tot">
          <td class="l">TOTAL ${yr}</td>
          <td class="r">₨ ${Math.round(total).toLocaleString('en-PK')}</td>
          <td class="r">₨ ${Math.round(totalCash).toLocaleString('en-PK')}</td>
          <td class="r">${Math.round(totalCust).toLocaleString('en-PK')}</td>
          <td class="r">—</td><td class="r">—</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin:10px 0 6px">Banks (Annual Total)</div>
    <table class="pr-tbl"><thead><tr><th>Bank</th><th class="r">Amount (₨)</th></tr></thead><tbody>${bankRows || '<tr><td colspan="2" style="padding:10px;color:#94a3b8">No bank data</td></tr>'}</tbody></table>
    <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin:10px 0 6px">Credit Clients (Annual Total)</div>
    <table class="pr-tbl"><thead><tr><th>Client</th><th class="r">Amount (₨)</th></tr></thead><tbody>${clientRows || '<tr><td colspan="2" style="padding:10px;color:#94a3b8">No credit data</td></tr>'}</tbody></table>
  </div>`;
}

function printYearlyReport(yr) {
  if (!yr) { toast('⚠ Select a year', 'w'); return; }
  const html = buildYearlyPrintHTML(yr);
  if (!html) { toast('⚠ No data for ' + yr, 'e'); return; }
  btPrint(html);
}

// ── Tools card helpers ────────────────────────────────────────────────────────
function printDailyFromTools() {
  const dateInput = document.getElementById('pr-daily-date').value;
  if (!dateInput) { toast('⚠ Select a date', 'w'); return; }
  const d = new Date(dateInput + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = String(d.getDate()).padStart(2,'0') + '/' + months[d.getMonth()] + '/' + d.getFullYear();
  const rec = Repository.findDailyByDate(dateStr);
  if (!rec) { toast('⚠ No data for ' + dateStr, 'e'); return; }
  const till = n(document.getElementById('pr-daily-till').value);
  const patty = n(document.getElementById('pr-daily-patty').value);
  const html = buildPrintHTML(dateStr, rec.Month_Year, till, patty);
  if (!html) { toast('⚠ Record not found', 'e'); return; }
  btPrint(html);
}

function printMonthFromTools() {
  const sel = document.getElementById('pr-month-sel').value;
  if (!sel) { toast('⚠ Select a month', 'w'); return; }
  printMonthReport(sel);
}

function printYearFromTools() {
  const sel = document.getElementById('pr-year-sel').value;
  if (!sel) { toast('⚠ Select a year', 'w'); return; }
  printYearlyReport(sel);
}

// Populate print tool card selectors when it opens
function _populatePrintSelectors() {
  const mons = [...months()].reverse();
  const ms = document.getElementById('pr-month-sel');
  if (ms) { const v = ms.value; ms.innerHTML = '<option value="">Select…</option>' + mons.map(m => `<option value="${m}">${m}</option>`).join(''); ms.value = v; }
  const yrs = years().slice().reverse();
  const ys = document.getElementById('pr-year-sel');
  if (ys) { const v = ys.value; ys.innerHTML = '<option value="">Select…</option>' + yrs.map(y => `<option value="${y}">${y}</option>`).join(''); ys.value = v; }
  // Set today as default for daily
  const di = document.getElementById('pr-daily-date');
  if (di && !di.value) { di.value = new Date().toISOString().split('T')[0]; }
}


// Bridge what's used externally or from index.html.
window.printMonthReport = printMonthReport;
window.printYearlyReport = printYearlyReport;
window.printDailyFromTools = printDailyFromTools;
window.printMonthFromTools = printMonthFromTools;
window.printYearFromTools = printYearFromTools;
window._populatePrintSelectors = _populatePrintSelectors;

})();
