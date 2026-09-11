// ══════════════════════════════════════════════════════════════════════
// SALES CALENDAR HEATMAP  —  BT Sales App
//
// GitHub-style year grid of daily sales (DAILY.TOTAL), one cell per
// calendar day, shaded by which quartile that day's total falls into
// relative to this branch's OWN sale days that year — not a fixed rupee
// threshold, which would look permanently empty in a slow year and
// solid-max in a record one.
//
// Own year-toggle state, independent of the #dash-year select above it
// (same reasoning as buildTotalChart's own preset/compare state in
// dashboard.js: a calendar is inherently annual, while Top 10 Days /
// Day-of-Week / Best-Worst-Per-Year sitting next to it are deliberately
// all-time — tying this one to #dash-year would be wrong for at least
// one of those three).
//
// Pure DOM renderer — no computation lives anywhere else, nothing here
// mutates DAILY/MONTHLY. Reads DAILY / n / ff / fc as bare globals (the
// same window bridge js/config.js's own file-footer sets up for every
// other classic-script consumer — see that file's "TEMPORARY WINDOW
// BRIDGE" block).
// ══════════════════════════════════════════════════════════════════════
(function () {
'use strict';

let _dashHeatmapYear = ''; // '' = auto (latest year that actually has data)

const _HM_MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const _HM_MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _HM_MON_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// "DD/Mon/YYYY" -> real Date (local midnight). Kept self-contained
// rather than reusing reports.js's _dateVal — that file loads later in
// index.html's script order, and buildDayOfWeek() just above this same
// pattern in dashboard.js already inlines its own parser for the same
// reason.
function _hmParseDate(s) {
  const p = s ? s.split('/') : [];
  if (p.length !== 3 || !(p[1] in _HM_MON)) return null;
  const d = new Date(parseInt(p[2], 10), _HM_MON[p[1]], parseInt(p[0], 10));
  return isNaN(d.getTime()) ? null : d;
}

function _dashSetHeatmapYear(y) { _dashHeatmapYear = String(y); buildSalesHeatmap(); }

function buildSalesHeatmap() {
  const el = document.getElementById('dash-heatmap');
  if (!el) return;

  // Every year with at least one real sale day (TOTAL > 0), newest first.
  const yearsWithData = [...new Set(
    DAILY.filter(d => n(d.TOTAL) > 0 && d.Date)
         .map(d => { const dt = _hmParseDate(d.Date); return dt ? dt.getFullYear() : null; })
         .filter(y => y !== null)
  )].sort((a, b) => b - a);

  if (!yearsWithData.length) { el.innerHTML = ''; return; }
  if (!_dashHeatmapYear || !yearsWithData.includes(+_dashHeatmapYear)) {
    _dashHeatmapYear = String(yearsWithData[0]);
  }
  const year = +_dashHeatmapYear;

  // Real DAILY record for every day this year (keyed by calendar date,
  // not the raw Date string, so leading-zero/format quirks can't cause
  // a miss).
  const byDate = {};
  DAILY.forEach(d => {
    if (!d.Date) return;
    const dt = _hmParseDate(d.Date);
    if (!dt || dt.getFullYear() !== year) return;
    byDate[dt.toDateString()] = d;
  });

  // Quartile buckets over this year's own sale days (>0 only) — same
  // "relative to this branch's own history" spirit as buildDayOfWeek's
  // best/worst-day-of-week highlighting just above this on the page.
  const positives = Object.values(byDate).map(d => n(d.TOTAL)).filter(t => t > 0).sort((a, b) => a - b);
  const qAt = p => positives.length ? positives[Math.min(positives.length - 1, Math.floor(p * positives.length))] : 0;
  const q1 = qAt(0.25), q2 = qAt(0.5), q3 = qAt(0.75);
  const levelOf = t => !t || t <= 0 ? 0 : t <= q1 ? 1 : t <= q2 ? 2 : t <= q3 ? 3 : 4;

  // color-mix against --accent/--surface (same technique variables.css's
  // own dot-grid texture uses) — automatically correct in dark mode with
  // zero extra rules, since both tokens already flip there.
  const LEVEL_BG = [
    'var(--border)',
    'color-mix(in srgb, var(--accent) 25%, var(--surface))',
    'color-mix(in srgb, var(--accent) 50%, var(--surface))',
    'color-mix(in srgb, var(--accent) 75%, var(--surface))',
    'var(--accent)',
  ];

  // Grid runs Jan 1 → Dec 31, columns = weeks (Sun-start), padded with
  // leading blank cells so Jan 1 lands in its real weekday row — the
  // same layout convention GitHub's own contribution graph uses.
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const startPad = jan1.getDay(); // 0=Sun
  const totalCells = startPad + Math.round((dec31 - jan1) / 86400000) + 1;
  const weeks = Math.ceil(totalCells / 7);

  const cols = [];
  const cursor = new Date(jan1);
  cursor.setDate(cursor.getDate() - startPad);
  let lastLabeledMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const cellsHtml = [];
    let colMonth = null;
    for (let dow = 0; dow < 7; dow++) {
      const inYear = cursor.getFullYear() === year;
      if (inYear) {
        if (colMonth === null) colMonth = cursor.getMonth();
        const rec = byDate[cursor.toDateString()];
        const total = rec ? n(rec.TOTAL) : 0;
        const lvl = levelOf(total);
        const humanDate = `${String(cursor.getDate()).padStart(2, '0')} ${_HM_MON_FULL[cursor.getMonth()]} ${year}`;
        const title = total > 0 ? `${humanDate} — ₨${fc(total)}` : `${humanDate} — no entry`;
        const clickable = !!rec && total > 0;
        const onclickAttr = clickable ? ` onclick="openDayModal('${rec.Date}','${rec.Month_Year}')"` : '';
        cellsHtml.push(`<div title="${title}" style="width:11px;height:11px;border-radius:3px;background:${LEVEL_BG[lvl]};${clickable ? 'cursor:pointer' : ''}"${onclickAttr}></div>`);
      } else {
        cellsHtml.push(`<div style="width:11px;height:11px"></div>`);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    let label = '';
    if (colMonth !== null && colMonth !== lastLabeledMonth) {
      label = _HM_MON_ABBR[colMonth];
      lastLabeledMonth = colMonth;
    }
    cols.push({ label, cellsHtml });
  }

  const monthRow = cols.map(c => `<div style="width:11px;font-size:9px;color:var(--muted);white-space:nowrap">${c.label}</div>`).join('');
  const grid = cols.map(c => `<div style="display:flex;flex-direction:column;gap:3px">${c.cellsHtml.join('')}</div>`).join('');

  const saleDays = positives.length;
  const yearTotal = Object.values(byDate).reduce((s, d) => s + n(d.TOTAL), 0);

  const yearChips = yearsWithData.map(y => `
    <button type="button" onclick="_dashSetHeatmapYear(${y})"
      style="padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;cursor:pointer;
             border:1px solid ${y === year ? 'var(--accent)' : 'var(--border)'};
             background:${y === year ? 'var(--accent)' : 'var(--surface)'};
             color:${y === year ? '#fff' : 'var(--muted)'}">${y}</button>`).join('');

  const legendChips = LEVEL_BG.map(bg => `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${bg}"></span>`).join('');

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span>🗓️ Sales Calendar — ${year}</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block;min-width:20px"></span>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${yearChips}</div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;overflow-x:auto">
      <div style="display:inline-flex;flex-direction:column;gap:4px;min-width:max-content">
        <div style="display:flex;gap:3px">${monthRow}</div>
        <div style="display:flex;gap:3px">${grid}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--muted)">₨${ff(yearTotal)} across ${saleDays} sale day${saleDays === 1 ? '' : 's'} in ${year} · tap a filled day to open it</div>
        <div style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted)">Less ${legendChips} More</div>
      </div>
    </div>`;
}

// Bridge — buildDashboard() (dashboard.js) calls this as a bare global
// behind a typeof guard, same convention as buildDashboardInsights /
// populateDashWorking; the year-chip buttons above call
// _dashSetHeatmapYear via an inline onclick, which also needs it on
// window (see reports.js's own window.openDayModal bridge for why —
// inline onclick attributes run in global scope, not this IIFE's).
window.buildSalesHeatmap = buildSalesHeatmap;
window._dashSetHeatmapYear = _dashSetHeatmapYear;

})();
