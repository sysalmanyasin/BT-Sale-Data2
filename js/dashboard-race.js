// ══════════════════════════════════════════════════════════════════════
// BT GAME PLAY  —  BT Sales App
//
// Two playful, replayable dashboard widgets built entirely on numbers the
// app already computes elsewhere — no new business data, no new storage:
//
//   1. Race the Forecast — a single bar racing MTD actual against the
//      target line and this month's forecast-at-current-pace marker.
//      Reuses Analytics.getDashboardKPIs()'s own latTgt/latAct/
//      forecastTotal — the same numbers already behind the "Forecast vs
//      Target" KPI card (dashboard.js) and the Target Pace card
//      (dashboard-insights.js) — just drawn as a race instead of a
//      sentence/percentage.
//
//   2. Bar Race — animated, replayable bar race with two tabs:
//      "Weekdays" (last N occurrences of each weekday, all 7 at once —
//      generalizes computeInsightCandidates()'s single-weekday check,
//      which only ever looks at today's weekday) and "<Month> × years"
//      (e.g. every August for the last 5 years).
//
// Pure DOM renderer — no computation lives here beyond picking which tab
// to show. The two new Analytics functions this depends on
// (getRecentWeekdayAverages, getSameMonthAcrossYears) are Floor 3, added
// alongside getTargetPaceForMonth/computeInsightCandidates in
// analytics.js. Reads DAILY/MONTHLY/n/ff/fc as bare globals — same
// window bridge every other classic-script dashboard file already
// relies on (see js/config.js's own bridge block).
//
// Wired into buildDashboard()'s existing render sequence (js/dashboard.js)
// behind a typeof guard, same convention as buildSalesHeatmap/
// buildDashboardInsights.
// ══════════════════════════════════════════════════════════════════════
(function () {
'use strict';

// Session-only UI state (not persisted) — same pattern as
// dashboard-heatmap.js's _dashHeatmapYear.
let _raceTab = 'weekday'; // 'weekday' | 'samemonth'

const _RACE_MN_FULL = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

/* ══════════════════════════════════════════════════════════════════════
   1. RACE THE FORECAST
══════════════════════════════════════════════════════════════════════ */
function buildRaceForecast() {
  const el = document.getElementById('dash-race-forecast');
  if (!el) return;

  const kd = (typeof Analytics !== 'undefined') ? Analytics.getDashboardKPIs() : null;
  if (!kd || !kd.latTgt) { el.innerHTML = ''; return; }

  const { lat, latTgt, latAct, latDays, daysInMon, forecastTotal, isLive } = kd;
  const maxScale     = Math.max(latTgt, forecastTotal, latAct) * 1.06 || 1;
  const actualPct    = Math.round(latAct / maxScale * 100);
  const targetPct    = Math.round(latTgt / maxScale * 100);
  const forecastPct  = Math.round(forecastTotal / maxScale * 100);
  const onTrack      = forecastTotal >= latTgt;
  const fillColor    = onTrack ? 'var(--green)' : (forecastTotal / latTgt >= .85 ? 'var(--amber)' : 'var(--red)');

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>🏁 Race the Forecast — ${lat.Month_Year}</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
      <button type="button" onclick="_raceReplay()" style="font-size:10px;padding:2px 9px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">↻ Replay</button>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="position:relative;height:26px;background:var(--s2,#f8fafc);border-radius:99px;overflow:visible;margin-top:6px">
        <div id="race-fc-fill" style="position:absolute;left:0;top:0;height:100%;width:0%;background:${fillColor};border-radius:99px;transition:width 1.1s cubic-bezier(.22,.9,.35,1)"></div>
        <div style="position:absolute;left:${targetPct}%;top:-6px;bottom:-6px;width:2px;background:var(--text)"></div>
        <div id="race-fc-marker" style="position:absolute;left:0%;top:-9px;font-size:13px;transition:left 1.1s cubic-bezier(.22,.9,.35,1)">🏃</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:var(--muted)">
        <span>Day ${latDays} of ${daysInMon}</span>
        <span>${isLive ? 'in progress' : 'closed'}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">So far</div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">₨${ff(latAct)}</div></div>
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Target</div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">₨${ff(latTgt)}</div></div>
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Forecast finish</div><div style="font-size:13px;font-weight:700;font-family:var(--mono);color:${fillColor}">₨${ff(forecastTotal)}</div></div>
      </div>
    </div>`;

  _raceAnimateForecast(actualPct, forecastPct);
}

// Two nested rAFs so the browser paints the 0% state first — a single
// rAF can land in the same frame the width was set to 0%, which some
// browsers coalesce and skip the transition entirely.
function _raceAnimateForecast(actualPct, forecastPct) {
  const fill   = document.getElementById('race-fc-fill');
  const marker = document.getElementById('race-fc-marker');
  if (!fill || !marker) return;
  fill.style.width  = '0%';
  marker.style.left = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.width  = actualPct + '%';
    marker.style.left = forecastPct + '%';
  }));
}

/* ══════════════════════════════════════════════════════════════════════
   2. BAR RACE  —  Weekdays / Same Month Across Years
══════════════════════════════════════════════════════════════════════ */
function _raceSetTab(tab) { _raceTab = tab; buildBarRace(); }

function _raceReplay() {
  buildRaceForecast();
  _racePlayBars();
}

function buildBarRace() {
  const el = document.getElementById('dash-bar-race');
  if (!el || typeof Analytics === 'undefined') return;

  const now = new Date();
  const curMonthName = _RACE_MN_FULL[now.getMonth()];

  let rows, unitLabel;
  if (_raceTab === 'samemonth') {
    const data = Analytics.getSameMonthAcrossYears(curMonthName, 5);
    rows = data.map(d => ({ label: String(d.year), value: d.total }));
    unitLabel = rows.length ? ('Every ' + curMonthName + ', last ' + rows.length + ' years') : '';
  } else {
    const avgs  = Analytics.getRecentWeekdayAverages(8);
    const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, same order buildDayOfWeek() uses
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    rows = order.map((dow, i) => ({ label: labels[i], value: avgs[dow].avg })).filter(r => r.value > 0);
    unitLabel = 'Avg of last 8 of each weekday';
  }

  if (!rows.length) { el.innerHTML = ''; return; }

  const max = Math.max(...rows.map(r => r.value)) || 1;
  const bars = rows.map(r => `
    <div style="margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px">
        <span style="font-weight:600;color:var(--text)">${r.label}</span>
        <span class="race-bar-val" data-final="${r.value}" style="font-family:var(--mono)">₨0</span>
      </div>
      <div style="height:14px;background:var(--s2,#f8fafc);border-radius:99px;overflow:hidden">
        <div class="race-bar" data-pct="${Math.round(r.value / max * 100)}" style="height:100%;width:0%;background:var(--accent);border-radius:99px;transition:width 900ms cubic-bezier(.22,.9,.35,1)"></div>
      </div>
    </div>`).join('');

  const tabBtn = (tab, label) => `
    <button type="button" onclick="_raceSetTab('${tab}')"
      style="flex:1;padding:6px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;
             border:1px solid ${_raceTab === tab ? 'var(--accent)' : 'var(--border)'};
             background:${_raceTab === tab ? 'var(--accent)' : 'var(--surface)'};
             color:${_raceTab === tab ? '#fff' : 'var(--muted)'}">${label}</button>`;

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>🏆 Bar Race</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
      <button type="button" onclick="_raceReplay()" style="font-size:10px;padding:2px 9px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">↻ Replay</button>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${tabBtn('weekday', 'Weekdays')}
        ${tabBtn('samemonth', curMonthName + ' × years')}
      </div>
      <div id="race-bars-wrap">${bars}</div>
      ${unitLabel ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">${unitLabel}</div>` : ''}
    </div>`;

  _racePlayBars();
}

function _racePlayBars() {
  const bars = document.querySelectorAll('#race-bars-wrap .race-bar');
  const vals = document.querySelectorAll('#race-bars-wrap .race-bar-val');

  bars.forEach((b, i) => {
    b.style.width = '0%';
    setTimeout(() => { b.style.width = b.getAttribute('data-pct') + '%'; }, i * 90);
  });

  vals.forEach(valEl => {
    const final = parseInt(valEl.getAttribute('data-final'), 10) || 0;
    const steps = 16;
    const inc = final / steps;
    let step = 0;
    const t = setInterval(() => {
      step++;
      const v = step >= steps ? final : Math.round(inc * step);
      valEl.textContent = '₨' + fc(v);
      if (step >= steps) clearInterval(t);
    }, 45);
  });
}

// Bridge — buildDashboard() (dashboard.js) calls buildRaceForecast/
// buildBarRace as bare globals behind a typeof guard, same convention as
// buildSalesHeatmap; the tab/replay buttons above call _raceSetTab/
// _raceReplay via inline onclick, which also needs them on window
// (inline onclick attributes run in global scope, not this IIFE's — see
// reports.js's own window.openDayModal bridge for why).
window.buildRaceForecast = buildRaceForecast;
window.buildBarRace      = buildBarRace;
window._raceSetTab       = _raceSetTab;
window._raceReplay       = _raceReplay;

})();
