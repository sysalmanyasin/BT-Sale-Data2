/* ── DIFF REPORT ─────────────────────────────────────────────────── */
/* Cumulative Difference (Total Sale − COMP SALE) by month + running  */
/* Each month row expands into a day-wise sub-report (same 4 metric   */
/* columns), running total reset to 0 at the start of each month.    */
import { MONTHLY, DAILY, n, fc } from './config.js';
import { BTDate } from './bt-date.js';

// Remembers which months are expanded across a rebuild (mirrors the
// data-page.js openMonths pattern) so a background sync event doesn't
// silently collapse whatever the user had open.
const _diffOpenMonths = new Set();

function _diffRowHTML(label, total, comp, diff, running, opts) {
  opts = opts || {};
  const dSign  = diff    > 0 ? '+' : '';
  const rSign  = running > 0 ? '+' : '';
  const dColor = diff    > 0 ? 'var(--green)' : diff    < 0 ? 'var(--red)' : 'var(--muted)';
  const rColor = running > 0 ? 'var(--green)' : running < 0 ? 'var(--red)' : 'var(--muted)';
  const labelStyle = opts.indent
    ? 'padding-left:30px;font-weight:500;white-space:nowrap;color:var(--muted)'
    : 'font-weight:600;white-space:nowrap';
  return `<td style="${labelStyle}">${opts.chevron || ''}${label}</td>
    <td class="dr-num">₨${fc(total)}</td>
    <td class="dr-num">₨${fc(comp)}</td>
    <td class="dr-num" style="color:${dColor};font-weight:700">${dSign}${fc(diff)}</td>
    <td class="dr-num" style="color:${rColor};font-weight:700">${rSign}${fc(running)}</td>`;
}

// Builds the day-wise sub-table for one month: TOTAL/COMP SALE per day,
// sorted chronologically, with its own running total reset to 0.
function _buildDayTable(monthYear) {
  const days = DAILY
    .filter(d => d.Month_Year === monthYear)
    .slice()
    .sort((a, b) => BTDate.parseDate(a.Date) - BTDate.parseDate(b.Date));

  if (!days.length) {
    return '<p style="color:var(--muted);text-align:center;padding:16px;font-size:12px">No daily records for this month.</p>';
  }

  let dRunning = 0;
  const dayRows = days.map(d => {
    const total = Math.round(n(d.TOTAL));
    const comp  = Math.round(n(d['COMP SALE']));
    const diff  = total - comp;
    dRunning   += diff;
    return `<tr>${_diffRowHTML(d.Date, total, comp, diff, dRunning, { indent: true })}</tr>`;
  }).join('');

  return `<div class="mon-tbl-wrap" style="padding:2px 12px 10px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="padding:6px 12px;text-align:left;font-weight:700;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase">Date</th>
          <th style="padding:6px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase">Total Sale</th>
          <th style="padding:6px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase">COMP SALE</th>
          <th style="padding:6px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase">Difference</th>
          <th style="padding:6px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase">Running Total</th>
        </tr>
      </thead>
      <tbody>${dayRows}</tbody>
    </table>
  </div>`;
}

function renderDiffReport() {
  const wrap = document.getElementById('diff-report-wrap');
  if (!wrap) return;

  /* ── sort months chronologically ── */
  const _MO={January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
  const _myVal = my => { const [m,y]=my.split(' '); return parseInt(y)*12+(_MO[m]??0); };

  const sorted = [...MONTHLY]
    .filter(m => m.Month_Year)
    .sort((a, b) => _myVal(a.Month_Year) - _myVal(b.Month_Year));

  if (!sorted.length) {
    wrap.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px">No data yet.</p>';
    return;
  }

  /* ── remember which months are expanded before we rebuild ── */
  wrap.querySelectorAll('tr.diff-mon-row[data-month]').forEach(tr => {
    const chev = tr.querySelector('.mon-chevron');
    if (chev && chev.classList.contains('open')) _diffOpenMonths.add(tr.dataset.month);
    else _diffOpenMonths.delete(tr.dataset.month);
  });

  /* ── compute per-month diff + running cumulative ── */
  let running = 0;
  let totTotal = 0, totComp = 0, totDiff = 0;

  const rows = sorted.map(m => {
    const total = Math.round(n(m.TOTAL));
    const comp  = Math.round(n(m['COMP SALE']));
    const diff  = total - comp;
    running    += diff;
    totTotal   += total;
    totComp    += comp;
    totDiff    += diff;

    const isOpen = _diffOpenMonths.has(m.Month_Year);
    const chevron = `<span class="mon-chevron${isOpen ? ' open' : ''}" style="margin-right:8px">&#9654;</span>`;

    const monRow = `<tr class="diff-mon-row cl" data-mon-toggle data-month="${m.Month_Year}" style="cursor:pointer">
      ${_diffRowHTML(m.Month_Year, total, comp, diff, running, { chevron })}
    </tr>`;

    const bodyRow = `<tr class="diff-day-wrap" data-month-body="${m.Month_Year}" style="display:${isOpen ? 'table-row' : 'none'}">
      <td colspan="5" style="padding:0;background:var(--s2)">${_buildDayTable(m.Month_Year)}</td>
    </tr>`;

    return monRow + bodyRow;
  }).join('');

  /* ── footer totals ── */
  const fSign  = totDiff  > 0 ? '+' : '';
  const fColor = totDiff  > 0 ? 'var(--green)' : totDiff  < 0 ? 'var(--red)' : 'var(--muted)';
  const rFinal = running;
  const rfColor = rFinal  > 0 ? 'var(--green)' : rFinal   < 0 ? 'var(--red)' : 'var(--muted)';

  const foot = `<tr style="background:var(--s2);border-top:2px solid var(--border)">
    <td style="font-weight:700">ALL TIME</td>
    <td class="dr-num" style="font-weight:700">₨${fc(totTotal)}</td>
    <td class="dr-num" style="font-weight:700">₨${fc(totComp)}</td>
    <td class="dr-num" style="font-weight:700;color:${fColor}">${fSign}${fc(totDiff)}</td>
    <td class="dr-num" style="font-weight:700;color:${rfColor}">${fSign}${fc(rFinal)}</td>
  </tr>`;

  /* ── summary banner ── */
  const bannerColor = rFinal > 0 ? '#ecfdf5' : '#fef2f2';
  const bannerBorder = rFinal > 0 ? '#6ee7b7' : '#fca5a5';
  const bannerText  = rFinal > 0 ? 'var(--green)' : 'var(--red)';
  const bannerLabel = rFinal > 0
    ? '📈 Physical sales are ahead of computer records'
    : '📉 Computer records are ahead of physical sales';

  const nMonths = sorted.length;
  const avgDiff = Math.round(totDiff / nMonths);
  const avgSign = avgDiff >= 0 ? '+' : '';

  wrap.innerHTML = `
    <!-- Summary banner -->
    <div style="background:${bannerColor};border:1px solid ${bannerBorder};border-radius:12px;padding:16px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">CC Difference</div>
        <div style="font-size:28px;font-weight:800;font-family:var(--mono);color:${bannerText}">${rFinal>=0?'+':''}₨${fc(rFinal)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${bannerLabel}</div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:var(--text)">${nMonths}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Months</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;font-family:var(--mono);color:${bannerText}">${avgSign}₨${fc(avgDiff)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Avg / Month</div>
        </div>
      </div>
    </div>

    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Tap a month to see the day-wise breakdown ▸</div>

    <!-- Table -->
    <div class="twrap tscroll">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--s2);border-bottom:2px solid var(--border)">
            <th style="padding:10px 12px;text-align:left;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Month</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Total Sale</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">COMP SALE</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Difference</th>
            <th style="padding:10px 12px;text-align:right;font-weight:700;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase">Running Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>${foot}</tfoot>
      </table>
    </div>

    <style>
      .dr-num { padding: 9px 12px; text-align:right; font-family:var(--mono); font-size:12px; }
      #diff-report-wrap tbody tr.diff-mon-row { border-bottom:1px solid var(--border); }
      #diff-report-wrap tbody tr.diff-mon-row:hover { background:var(--s2); }
      #diff-report-wrap tbody tr.diff-day-wrap { border-bottom:1px solid var(--border); }
      #diff-report-wrap td { padding:9px 12px; }
      #diff-report-wrap tbody tr.diff-day-wrap td { padding:0; }
    </style>
  `;

  _bindDiffReportDelegation();
}

// Event delegation bound once to the stable #diff-report-wrap container —
// per-row onclick assignment doesn't survive innerHTML being reassigned
// on rebuild (same lesson as data-page.js's month-group toggle).
let _diffDelegationBound = false;
function _bindDiffReportDelegation() {
  if (_diffDelegationBound) return;
  const wrap = document.getElementById('diff-report-wrap');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const hdr = e.target.closest('[data-mon-toggle]');
    if (!hdr) return;
    const month = hdr.dataset.month;
    const bodyRow = wrap.querySelector(`tr.diff-day-wrap[data-month-body="${CSS.escape(month)}"]`);
    const chev = hdr.querySelector('.mon-chevron');
    if (!bodyRow) return;
    const isOpen = bodyRow.style.display !== 'none';
    bodyRow.style.display = isOpen ? 'none' : 'table-row';
    if (chev) chev.classList.toggle('open', !isOpen);
    if (isOpen) _diffOpenMonths.delete(month); else _diffOpenMonths.add(month);
  });
  _diffDelegationBound = true;
}

// ui.js (classic script) calls this as a bare global on every 'diff'
// tab open/rebuild — must stay window-bridged now that this file is a
// real ES module and no longer leaks a plain global by default.
window.renderDiffReport = renderDiffReport;
export { renderDiffReport };
