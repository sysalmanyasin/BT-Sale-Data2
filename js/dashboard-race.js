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
//   2. Bar Race — animated, replayable bar race with two tabs, each with
//      its own lookback controls:
//      "Weekdays" (last N occurrences of each weekday, all 7 at once —
//      generalizes computeInsightCandidates()'s single-weekday check,
//      which only ever looks at today's weekday — N is user-picked:
//      4/8/12/26/52) and "<Month> × years" (any month name, last N years
//      — N user-picked: 3/5/7/10/all).
//
//   3. Manual forecast override — an optional "your own ₨/day for the
//      remaining days" input on the Race the Forecast card. When set, a
//      second marker (●, accent-colored) shows where that plan would
//      land next to the algorithm's own 🏃 pace-based marker, and the
//      bar's on-track color follows the plan instead of the algorithm
//      once one is entered. Persisted per Month_Year (Repository, via
//      Actions.saveFeatureData — UI-state persistence, not business
//      data, same door dashboard-insights.js's own diff-badge/briefing
//      state already uses).
//
// Pure DOM renderer — no computation lives here beyond picking which tab/
// lookback to show and the flat-rate arithmetic for #3 (latAct + rate ×
// daysLeft — the same shape as Analytics.getTargetPaceForMonth()'s own
// neededPerDay math, just solved the other direction). The two Analytics
// functions this depends on (getRecentWeekdayAverages, getSameMonthAcrossYears)
// are Floor 3, added alongside getTargetPaceForMonth/computeInsightCandidates
// in analytics.js. Reads DAILY/MONTHLY/n/ff/fc as bare globals — same
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
// dashboard-heatmap.js's _dashHeatmapYear. Manual forecast rate is the
// one exception — see _RACE_MANUAL_KEY below, that one IS persisted
// (per Month_Year) since it's a plan worth remembering across a session.
let _raceTab             = 'weekday'; // 'weekday' | 'samemonth'
let _raceWeekdayCount    = 8;         // last N occurrences per weekday
let _raceSameMonthYears  = 5;         // last N years for the same-month tab

const _RACE_MN_FULL = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

let _raceSameMonth = _RACE_MN_FULL[new Date().getMonth()]; // defaults to current month

/* ══════════════════════════════════════════════════════════════════════
   1. RACE THE FORECAST  (+ optional manual forecast override)
══════════════════════════════════════════════════════════════════════ */
const _RACE_MANUAL_KEY = 'bt_race_manual_rate'; // { [Month_Year]: ratePerDay }

function _raceGetManualRate(monthYear) {
  try {
    const all = JSON.parse(Repository.getItem(_RACE_MANUAL_KEY) || '{}');
    const v = all[monthYear];
    return (v === undefined || v === null || v === '') ? null : Number(v);
  } catch (_) { return null; }
}

// Persists + does a full rebuild (correct final rescale). Fired on the
// input's onchange (blur/Enter), NOT oninput — rebuilding on every
// keystroke would replace the <input> node mid-type and steal focus/
// cursor position. Live per-keystroke feedback is _racePreviewManualRate
// below instead, which only moves the marker, no rebuild.
function _raceSetManualRate(value) {
  const kd = (typeof Analytics !== 'undefined') ? Analytics.getDashboardKPIs() : null;
  if (!kd || !kd.lat) return;
  const my = kd.lat.Month_Year;
  try {
    const all = JSON.parse(Repository.getItem(_RACE_MANUAL_KEY) || '{}');
    if (value === '' || value == null || isNaN(Number(value))) {
      delete all[my];
    } else {
      all[my] = Number(value);
    }
    Actions.saveFeatureData(_RACE_MANUAL_KEY, JSON.stringify(all));
  } catch (_) {}
  buildRaceForecast();
}

// Live preview while typing — moves only the custom marker + its label,
// clamped to the bar's existing scale (no rescale mid-type; onchange
// above does a proper full rebuild/rescale once typing is done).
function _racePreviewManualRate(value) {
  const kd = (typeof Analytics !== 'undefined') ? Analytics.getDashboardKPIs() : null;
  if (!kd || !kd.latTgt) return;
  const { latTgt, latAct, latDays, daysInMon, forecastTotal } = kd;
  const daysLeft = Math.max(0, daysInMon - latDays);
  const rate = Number(value);
  const hasRate = value !== '' && !isNaN(rate);
  const customForecast = hasRate ? (latAct + rate * daysLeft) : null;
  const maxScale = Math.max(latTgt, forecastTotal, latAct) * 1.06 || 1;

  const marker = document.getElementById('race-fc-custom-marker');
  const label  = document.getElementById('race-fc-custom-total');
  if (marker) {
    marker.style.display = customForecast != null ? '' : 'none';
    if (customForecast != null) marker.style.left = Math.min(100, Math.round(customForecast / maxScale * 100)) + '%';
  }
  if (label) label.textContent = customForecast != null ? ('₨' + ff(customForecast)) : '—';
}

function buildRaceForecast() {
  const el = document.getElementById('dash-race-forecast');
  if (!el) return;

  const kd = (typeof Analytics !== 'undefined') ? Analytics.getDashboardKPIs() : null;
  if (!kd || !kd.latTgt) { el.innerHTML = ''; return; }

  const { lat, latTgt, latAct, latDays, daysInMon, forecastTotal, isLive } = kd;
  const daysLeft   = Math.max(0, daysInMon - latDays);
  const manualRate = _raceGetManualRate(lat.Month_Year);
  const customForecast = manualRate != null ? (latAct + manualRate * daysLeft) : null;

  const scaleCandidates = [latTgt, forecastTotal, latAct];
  if (customForecast != null) scaleCandidates.push(customForecast);
  const maxScale     = Math.max(...scaleCandidates) * 1.06 || 1;
  const actualPct    = Math.round(latAct / maxScale * 100);
  const targetPct    = Math.round(latTgt / maxScale * 100);
  const forecastPct  = Math.round(forecastTotal / maxScale * 100);
  const customPct    = customForecast != null ? Math.round(customForecast / maxScale * 100) : 0;

  // Once a manual plan is entered, "on track" follows the plan — that's
  // the whole point of typing one in — otherwise it follows the
  // algorithm's own pace-based forecast, same as before.
  const effectiveForecast = customForecast != null ? customForecast : forecastTotal;
  const onTrack   = effectiveForecast >= latTgt;
  const fillColor = onTrack ? 'var(--green)' : (effectiveForecast / latTgt >= .85 ? 'var(--amber)' : 'var(--red)');

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
        <div id="race-fc-custom-marker" style="position:absolute;left:0%;top:-11px;font-size:18px;line-height:1;color:var(--accent);transition:left 1.1s cubic-bezier(.22,.9,.35,1);display:${customForecast != null ? '' : 'none'}">●</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:var(--muted)">
        <span>Day ${latDays} of ${daysInMon} · ${daysLeft} left</span>
        <span>${isLive ? 'in progress' : 'closed'}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">So far</div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">₨${ff(latAct)}</div></div>
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Target</div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">₨${ff(latTgt)}</div></div>
        <div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">🏃 Algorithm forecast</div><div style="font-size:13px;font-weight:700;font-family:var(--mono)">₨${ff(forecastTotal)}</div></div>
      </div>
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">● Your own ₨/day estimate for the remaining ${daysLeft} day${daysLeft === 1 ? '' : 's'}</label>
        <div style="display:flex;gap:8px">
          <input id="race-fc-manual-input" type="number" inputmode="numeric" placeholder="e.g. 55000"
            value="${manualRate != null ? manualRate : ''}"
            oninput="_racePreviewManualRate(this.value)"
            onchange="_raceSetManualRate(this.value)"
            style="flex:1;min-width:0;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--s2,#f8fafc);color:var(--text);font-family:var(--mono);font-size:12px">
          ${manualRate != null ? `<button type="button" onclick="document.getElementById('race-fc-manual-input').value='';_raceSetManualRate('')" style="font-size:10px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">Clear</button>` : ''}
        </div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:10px;color:var(--muted)">Your forecast</span>
          <span id="race-fc-custom-total" style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--accent)">${customForecast != null ? '₨' + ff(customForecast) : '—'}</span>
        </div>
      </div>
    </div>`;

  _raceAnimateForecast(actualPct, forecastPct, customForecast != null ? customPct : null);
}

// Three nested-rAF-driven transitions (fill / algorithm marker / custom
// marker). Two nested rAFs so the browser paints the 0%/start state
// first — a single rAF can land in the same frame the style was reset,
// which some browsers coalesce and skip the transition entirely.
function _raceAnimateForecast(actualPct, forecastPct, customPct) {
  const fill    = document.getElementById('race-fc-fill');
  const marker  = document.getElementById('race-fc-marker');
  const custom  = document.getElementById('race-fc-custom-marker');
  if (!fill || !marker) return;
  fill.style.width  = '0%';
  marker.style.left = '0%';
  if (custom) custom.style.left = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.width  = actualPct + '%';
    marker.style.left = forecastPct + '%';
    if (custom && customPct != null) custom.style.left = customPct + '%';
  }));
}

/* ══════════════════════════════════════════════════════════════════════
   2. BAR RACE  —  Weekdays / Same Month Across Years
══════════════════════════════════════════════════════════════════════ */
function _raceSetTab(tab) { _raceTab = tab; buildBarRace(); }
function _raceSetWeekdayCount(v)   { _raceWeekdayCount   = parseInt(v, 10) || 8; buildBarRace(); }
function _raceSetSameMonthName(v)  { _raceSameMonth      = v; buildBarRace(); }
function _raceSetSameMonthYears(v) { _raceSameMonthYears = parseInt(v, 10) || 5; buildBarRace(); }

function _raceReplay() {
  buildRaceForecast();
  _racePlayBars();
}

// Options shown in the two lookback dropdowns below.
const _RACE_WD_COUNTS   = [4, 8, 12, 26, 52];
const _RACE_YEAR_COUNTS = [3, 5, 7, 10, 999]; // 999 renders as "All years"

function buildBarRace() {
  const el = document.getElementById('dash-bar-race');
  if (!el || typeof Analytics === 'undefined') return;

  let rows, unitLabel;
  if (_raceTab === 'samemonth') {
    const data = Analytics.getSameMonthAcrossYears(_raceSameMonth, _raceSameMonthYears);
    rows = data.map(d => ({ label: String(d.year), value: d.total }));
    unitLabel = rows.length ? ('Every ' + _raceSameMonth + ', last ' + rows.length + ' years') : '';
  } else {
    const avgs  = Analytics.getRecentWeekdayAverages(_raceWeekdayCount);
    const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, same order buildDayOfWeek() uses
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    rows = order.map((dow, i) => ({ label: labels[i], value: avgs[dow].avg })).filter(r => r.value > 0);
    unitLabel = 'Avg of last ' + _raceWeekdayCount + ' of each weekday';
  }

  const tabBtn = (tab, label) => `
    <button type="button" onclick="_raceSetTab('${tab}')"
      style="flex:1;padding:6px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;
             border:1px solid ${_raceTab === tab ? 'var(--accent)' : 'var(--border)'};
             background:${_raceTab === tab ? 'var(--accent)' : 'var(--surface)'};
             color:${_raceTab === tab ? '#fff' : 'var(--muted)'}">${label}</button>`;

  const controlsHtml = _raceTab === 'samemonth'
    ? `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <select onchange="_raceSetSameMonthName(this.value)" style="flex:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:11px">
          ${_RACE_MN_FULL.map(m => `<option value="${m}" ${m === _raceSameMonth ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <select onchange="_raceSetSameMonthYears(this.value)" style="width:112px;flex-shrink:0;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:11px">
          ${_RACE_YEAR_COUNTS.map(y => `<option value="${y}" ${y === _raceSameMonthYears ? 'selected' : ''}>${y === 999 ? 'All years' : 'Last ' + y + ' yrs'}</option>`).join('')}
        </select>
      </div>`
    : `
      <div style="margin-bottom:12px">
        <select onchange="_raceSetWeekdayCount(this.value)" style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:11px">
          ${_RACE_WD_COUNTS.map(c => `<option value="${c}" ${c === _raceWeekdayCount ? 'selected' : ''}>Last ${c} of each weekday</option>`).join('')}
        </select>
      </div>`;

  if (!rows.length) {
    el.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px">🏆 Bar Race</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
        <div style="display:flex;gap:6px;margin-bottom:12px">
          ${tabBtn('weekday', 'Weekdays')}
          ${tabBtn('samemonth', _raceSameMonth + ' × years')}
        </div>
        ${controlsHtml}
        <div style="font-size:11px;color:var(--muted)">Not enough data yet for this range.</div>
      </div>`;
    return;
  }

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

  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:8px">
      <span>🏆 Bar Race</span>
      <span style="flex:1;height:1px;background:var(--border);opacity:.4;display:inline-block"></span>
      <button type="button" onclick="_raceReplay()" style="font-size:10px;padding:2px 9px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">↻ Replay</button>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${tabBtn('weekday', 'Weekdays')}
        ${tabBtn('samemonth', _raceSameMonth + ' × years')}
      </div>
      ${controlsHtml}
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
window.buildRaceForecast      = buildRaceForecast;
window.buildBarRace           = buildBarRace;
window._raceSetTab            = _raceSetTab;
window._raceReplay            = _raceReplay;
window._raceSetWeekdayCount   = _raceSetWeekdayCount;
window._raceSetSameMonthName  = _raceSetSameMonthName;
window._raceSetSameMonthYears = _raceSetSameMonthYears;
window._raceSetManualRate     = _raceSetManualRate;
window._racePreviewManualRate = _racePreviewManualRate;

})();
