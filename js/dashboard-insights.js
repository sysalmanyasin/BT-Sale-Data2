/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DASHBOARD INSIGHTS  —  BT Sales App  ·  Phase 3                   ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Adds to Dashboard (above existing KPI row):                        ║
 * ║   1. Daily Briefing card  — rotates on strongest signal             ║
 * ║   2. Target Pace card     — ₨/day needed to hit target              ║
 * ║   3. Rotating insight strip — weekday comp / staff outlier /        ║
 * ║                               expense spike / target pace           ║
 * ║   4. "Since You Last Looked" diff badge                             ║
 * ║   5. Rule Alerts stack    — surfaced from aimRulesCheckAll()        ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Public API:                                                        ║
 * ║    buildDashboardInsights()  — call from buildDashboard() at top    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════════════════════
   STYLES (injected once)
══════════════════════════════════════════════════════════════════════ */
(function _dbiInjectStyles() {
  if (document.getElementById('dbi-styles')) return;
  const el = document.createElement('style');
  el.id = 'dbi-styles';
  el.textContent = `
/* ── Insights wrap ── */
#dash-insights-wrap {
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Briefing card ── */
.dbi-briefing-card {
  background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
  border-radius: 14px;
  padding: 14px 16px;
  color: #fff;
  position: relative;
  overflow: hidden;
}
.dbi-briefing-card::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at top right, rgba(59,130,246,.25) 0%, transparent 65%);
  pointer-events: none;
}
.dbi-briefing-label {
  font-size: 9px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #7dd3fc; margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
}
.dbi-briefing-label::after {
  content: ''; flex: 1; height: 1px; background: rgba(125,211,252,.25);
}
.dbi-briefing-text {
  font-size: 13px; line-height: 1.6; color: #e2e8f0;
}
.dbi-briefing-text b { color: #fff; }
.dbi-briefing-dismiss {
  position: absolute; top: 10px; right: 12px;
  background: none; border: none; color: rgba(255,255,255,.4);
  font-size: 16px; cursor: pointer; padding: 0; line-height: 1;
}
.dbi-briefing-dismiss:hover { color: rgba(255,255,255,.8); }

/* ── Target Pace card ── */
.dbi-pace-card {
  border-radius: 12px;
  padding: 12px 14px;
  border: 1.5px solid;
  display: flex;
  align-items: center;
  gap: 12px;
}
.dbi-pace-card.on-pace {
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #86efac;
}
.dbi-pace-card.behind {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border-color: #93c5fd;
}
.dbi-pace-card.at-risk {
  background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);
  border-color: #fcd34d;
}
.dbi-pace-card.achieved {
  background: linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%);
  border-color: #4ade80;
}
.dbi-pace-icon { font-size: 26px; flex-shrink: 0; }
.dbi-pace-body { flex: 1; min-width: 0; }
.dbi-pace-title {
  font-size: 11px; font-weight: 700; color: var(--muted);
  letter-spacing: .06em; text-transform: uppercase; margin-bottom: 2px;
}
.dbi-pace-value {
  font-size: 18px; font-weight: 800; font-family: var(--mono);
  color: var(--text); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.dbi-pace-sub {
  font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.4;
}
.dbi-pace-bar-wrap {
  flex-shrink: 0; width: 52px;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
}
.dbi-pace-bar {
  width: 6px; height: 44px;
  background: rgba(0,0,0,.08); border-radius: 3px;
  overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
}
.dbi-pace-fill {
  width: 100%; border-radius: 3px;
  transition: height .4s ease;
}
.dbi-pace-pct {
  font-size: 10px; font-weight: 700; color: var(--muted);
}

/* ── Insight strip ── */
.dbi-insight-strip {
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--s2, #f8fafc);
  padding: 10px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.dbi-insight-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
.dbi-insight-body { flex: 1; min-width: 0; }
.dbi-insight-title {
  font-size: 11px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: .07em; margin-bottom: 3px;
}
.dbi-insight-text { font-size: 13px; color: var(--text); line-height: 1.5; }
.dbi-insight-text b { color: var(--text); font-weight: 700; }
.dbi-insight-cta {
  display: inline-block; margin-top: 5px;
  font-size: 11px; color: var(--accent); font-weight: 600;
  background: none; border: none; cursor: pointer; padding: 0;
  text-decoration: underline; text-underline-offset: 2px;
}
.dbi-insight-dots {
  display: flex; gap: 5px; margin-top: 8px;
}
.dbi-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--border); cursor: pointer;
  transition: background .2s;
}
.dbi-dot.active { background: var(--accent); }

/* ── Diff badge ── */
.dbi-diff-badge {
  background: var(--s2, #f8fafc);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--muted);
}
.dbi-diff-badge strong { color: var(--text); }
.dbi-diff-ago { font-size: 11px; margin-left: auto; flex-shrink: 0; }

/* ── Rule alerts stack ── */
.dbi-rules-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dbi-rule-alert {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: #92400e;
  line-height: 1.5;
}
`;
  document.head.appendChild(el);
})();

/* ══════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
══════════════════════════════════════════════════════════════════════ */
const _DBI_BRIEF_KEY    = 'bt_dbi_brief_dismissed'; // date string when dismissed
const _DBI_LAST_KEY     = 'bt_dbi_last_session';    // { date, totalMonths, lastMonthTotal }
const _DBI_INSIGHT_IDX  = 'bt_dbi_insight_idx';     // current rotating insight index

function _dbiN(v) { return isNaN(parseFloat(v)) ? 0 : parseFloat(v); }
function _dbiFF(v) { return Math.round(v).toLocaleString('en-PK'); }
function _dbiToday() { return new Date().toDateString(); }
function _dbiCurrentMonthYear() {
  const d = new Date();
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return MN[d.getMonth()] + ' ' + d.getFullYear();
}
function _dbiTgts() {
  try { return JSON.parse(localStorage.getItem('bt_targets') || '{}'); } catch(_) { return {}; }
}

/* ══════════════════════════════════════════════════════════════════════
   1. BRIEFING CARD
══════════════════════════════════════════════════════════════════════ */
function _dbiBuildBriefing() {
  // Skip if dismissed today
  const dismissed = localStorage.getItem(_DBI_BRIEF_KEY);
  if (dismissed === _dbiToday()) return '';

  const briefText = (typeof aimBriefingGenerate === 'function') ? aimBriefingGenerate() : null;
  if (!briefText) return '';

  return `
    <div class="dbi-briefing-card" id="dbi-briefing-card">
      <button class="dbi-briefing-dismiss" onclick="_dbiDismissBriefing()" title="Dismiss for today">✕</button>
      <div class="dbi-briefing-label">☀️ Daily Briefing</div>
      <div class="dbi-briefing-text">${briefText}</div>
    </div>`;
}

function _dbiDismissBriefing() {
  localStorage.setItem(_DBI_BRIEF_KEY, _dbiToday());
  const el = document.getElementById('dbi-briefing-card');
  if (el) {
    el.style.transition = 'opacity .25s, max-height .3s, margin .3s, padding .3s';
    el.style.opacity = '0';
    el.style.maxHeight = '0';
    el.style.padding = '0';
    el.style.marginBottom = '0';
    setTimeout(() => el.remove(), 350);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   2. TARGET PACE CARD
══════════════════════════════════════════════════════════════════════ */
function _dbiBuildTargetPace() {
  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  if (!M.length) return '';

  const now         = new Date();
  const my          = _dbiCurrentMonthYear();
  const tgts        = _dbiTgts();
  const tgt         = _dbiN(tgts[my]);
  if (!tgt) return '';

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const daysLeft    = daysInMonth - daysElapsed;
  const monthRec    = M.find(m => m.Month_Year === my);
  const soFar       = _dbiN((monthRec && monthRec.TOTAL) || 0);
  const pct         = tgt > 0 ? Math.min(100, Math.round(soFar / tgt * 100)) : 0;
  const remaining   = tgt - soFar;

  // Already hit
  if (remaining <= 0) {
    return `
      <div class="dbi-pace-card achieved">
        <div class="dbi-pace-icon">🏆</div>
        <div class="dbi-pace-body">
          <div class="dbi-pace-title">Target — ${my}</div>
          <div class="dbi-pace-value" style="color:#16a34a">Achieved! ₨${_dbiFF(soFar)}</div>
          <div class="dbi-pace-sub">Goal was ₨${_dbiFF(tgt)} · Exceeded by ₨${_dbiFF(-remaining)}</div>
        </div>
        <div class="dbi-pace-bar-wrap">
          <div class="dbi-pace-bar">
            <div class="dbi-pace-fill" style="height:100%;background:#4ade80"></div>
          </div>
          <div class="dbi-pace-pct">100%</div>
        </div>
      </div>`;
  }

  // Calculate pace
  const idealPerDay  = tgt / daysInMonth;
  const actualPerDay = daysElapsed > 0 ? soFar / daysElapsed : 0;
  const neededPerDay = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
  const paceRatio    = idealPerDay > 0 ? actualPerDay / idealPerDay : 0;

  let cardClass, icon, statusText;
  if (paceRatio >= 1) {
    cardClass = 'on-pace'; icon = '✅';
    statusText = `On pace — running <b>₨${_dbiFF(actualPerDay)}/day</b> vs ideal ₨${_dbiFF(idealPerDay)}/day`;
  } else if (paceRatio >= 0.8) {
    cardClass = 'behind'; icon = '🎯';
    statusText = `Slightly behind — need <b>₨${_dbiFF(neededPerDay)}/day</b> over ${daysLeft} days left`;
  } else {
    cardClass = 'at-risk'; icon = '⚠️';
    statusText = `At risk — need <b>₨${_dbiFF(neededPerDay)}/day</b> over ${daysLeft} days left`;
  }

  const fillColor = paceRatio >= 1 ? '#22c55e' : paceRatio >= 0.8 ? '#2563eb' : '#f59e0b';

  return `
    <div class="dbi-pace-card ${cardClass}">
      <div class="dbi-pace-icon">${icon}</div>
      <div class="dbi-pace-body">
        <div class="dbi-pace-title">Target Pace — ${my}</div>
        <div class="dbi-pace-value">₨${_dbiFF(neededPerDay)}<span style="font-size:12px;font-weight:500;color:var(--muted)">/day needed</span></div>
        <div class="dbi-pace-sub">${statusText.replace(/<b>/g,'').replace(/<\/b>/g,'')}</div>
        <div class="dbi-pace-sub" style="margin-top:2px">So far ₨${_dbiFF(soFar)} of ₨${_dbiFF(tgt)} target</div>
      </div>
      <div class="dbi-pace-bar-wrap">
        <div class="dbi-pace-bar">
          <div class="dbi-pace-fill" style="height:${pct}%;background:${fillColor}"></div>
        </div>
        <div class="dbi-pace-pct">${pct}%</div>
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   3. ROTATING INSIGHT STRIP
══════════════════════════════════════════════════════════════════════ */
let _dbiInsightIdx = 0;

function _dbiComputeInsights() {
  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  const D = (typeof DAILY !== 'undefined' && DAILY)   ? DAILY   : [];
  if (M.length < 2 || !D.length) return [];

  const n  = _dbiN;
  const ff = _dbiFF;
  const insights = [];
  const now = new Date();
  const curMY = _dbiCurrentMonthYear();

  // ── A. Target pace insight (only if target set & current month live)
  const tgts = _dbiTgts();
  const tgt  = n(tgts[curMY]);
  if (tgt > 0) {
    const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed  = now.getDate();
    const daysLeft     = daysInMonth - daysElapsed;
    const monthRec     = M.find(m => m.Month_Year === curMY);
    const soFar        = n((monthRec && monthRec.TOTAL) || 0);
    const pct          = tgt > 0 ? Math.round(soFar / tgt * 100) : 0;
    const neededPerDay = daysLeft > 0 ? Math.ceil((tgt - soFar) / daysLeft) : 0;
    if (soFar < tgt) {
      insights.push({
        icon: '🎯', title: 'Target Pace',
        text: `You've hit <b>${pct}%</b> of your ${curMY} target. Need ₨${ff(neededPerDay)}/day for ${daysLeft} days remaining.`,
        cta: null
      });
    }
  }

  // ── B. Weekday comparison (today vs same weekday 4-week avg)
  const dow     = now.getDay(); // 0=Sun
  const dowNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  // Sort DAILY by date
  const sortedD = D.slice().sort((a, b) => {
    const pa = a.Date || '', pb = b.Date || '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  // Last 5 occurrences of same weekday
  const sameDay = sortedD.filter(d => {
    try {
      // Date format: "20/Jun/2026"
      const parts = (d.Date || '').split('/');
      if (parts.length < 3) return false;
      const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      const dt = new Date(parseInt(parts[2]), months[parts[1]] || 0, parseInt(parts[0]));
      return dt.getDay() === dow;
    } catch(_) { return false; }
  }).slice(-5);

  if (sameDay.length >= 3) {
    const sameDayAvg = sameDay.slice(0,-1).reduce((s,d)=>s+n(d.TOTAL),0) / (sameDay.length - 1);
    const latestSameDay = sameDay[sameDay.length - 1];
    const latestVal     = n(latestSameDay.TOTAL);
    if (sameDayAvg > 0 && latestVal > 0) {
      const diffPct = Math.round((latestVal - sameDayAvg) / sameDayAvg * 100);
      const dir = diffPct >= 0 ? 'above' : 'below';
      const color = diffPct >= 0 ? '#16a34a' : '#dc2626';
      insights.push({
        icon: '📅', title: `${dowNames[dow]} Pattern`,
        text: `Last ${dowNames[dow]} (${latestSameDay.Date}): ₨${ff(latestVal)} — <b style="color:${color}">${Math.abs(diffPct)}% ${dir}</b> your typical ${dowNames[dow]} average of ₨${ff(sameDayAvg)}.`,
        cta: null
      });
    }
  }

  // ── C. Biggest MoM swing (last 2 months)
  if (M.length >= 2) {
    const last = M[M.length - 1], prev = M[M.length - 2];
    const lastT = n(last.TOTAL), prevT = n(prev.TOTAL);
    if (prevT > 0) {
      const swingPct = Math.round((lastT - prevT) / prevT * 100);
      const dir      = swingPct >= 0 ? 'up' : 'down';
      const icon     = swingPct >= 0 ? '📈' : '📉';
      const color    = swingPct >= 0 ? '#16a34a' : '#dc2626';
      insights.push({
        icon, title: 'Month-on-Month',
        text: `${last.Month_Year} vs ${prev.Month_Year}: <b style="color:${color}">₨${ff(Math.abs(lastT-prevT))} ${dir} (${Math.abs(swingPct)}%)</b>. From ₨${ff(prevT)} → ₨${ff(lastT)}.`,
        cta: null
      });
    }
  }

  // ── D. Best day this month vs last month's best day
  if (M.length >= 2 && D.length) {
    const curMon = M[M.length - 1].Month_Year;
    const prvMon = M[M.length - 2].Month_Year;
    const curDays = D.filter(d => d.Month_Year === curMon && n(d.TOTAL) > 0);
    const prvDays = D.filter(d => d.Month_Year === prvMon && n(d.TOTAL) > 0);
    if (curDays.length && prvDays.length) {
      const curBest = curDays.reduce((a,b)=>n(b.TOTAL)>n(a.TOTAL)?b:a, curDays[0]);
      const prvBest = prvDays.reduce((a,b)=>n(b.TOTAL)>n(a.TOTAL)?b:a, prvDays[0]);
      const diffPct = n(prvBest.TOTAL) > 0 ? Math.round((n(curBest.TOTAL) - n(prvBest.TOTAL)) / n(prvBest.TOTAL) * 100) : 0;
      const dir     = diffPct >= 0 ? 'better' : 'lower';
      const color   = diffPct >= 0 ? '#16a34a' : '#dc2626';
      insights.push({
        icon: '🔥', title: 'Best Day Comparison',
        text: `Best day this month (${curBest.Date}): ₨${ff(n(curBest.TOTAL))} — <b style="color:${color}">${Math.abs(diffPct)}% ${dir}</b> than ${prvMon}'s best (₨${ff(n(prvBest.TOTAL))} on ${prvBest.Date}).`,
        cta: null
      });
    }
  }

  // ── E. Avg bill size trend
  if (M.length >= 2) {
    const last = M[M.length - 1], prev = M[M.length - 2];
    const avgLast = n(last.Customers) > 0 ? n(last.TOTAL) / n(last.Customers) : 0;
    const avgPrev = n(prev.Customers) > 0 ? n(prev.TOTAL) / n(prev.Customers) : 0;
    if (avgLast > 0 && avgPrev > 0) {
      const diffPct = Math.round((avgLast - avgPrev) / avgPrev * 100);
      const dir     = diffPct >= 0 ? 'up' : 'down';
      const color   = diffPct >= 0 ? '#16a34a' : '#dc2626';
      insights.push({
        icon: '🧾', title: 'Avg Bill Size',
        text: `Average bill in ${last.Month_Year}: ₨${ff(avgLast)} — <b style="color:${color}">${Math.abs(diffPct)}% ${dir}</b> vs ${prev.Month_Year} (₨${ff(avgPrev)}).`,
        cta: null
      });
    }
  }

  return insights;
}

function _dbiBuildInsightStrip() {
  const insights = _dbiComputeInsights();
  if (!insights.length) return '';

  // Restore or advance index (once per day)
  try {
    const stored = JSON.parse(localStorage.getItem(_DBI_INSIGHT_IDX) || '{}');
    if (stored.date === _dbiToday()) {
      _dbiInsightIdx = stored.idx % insights.length;
    } else {
      _dbiInsightIdx = ((stored.idx || 0) + 1) % insights.length;
      localStorage.setItem(_DBI_INSIGHT_IDX, JSON.stringify({ date: _dbiToday(), idx: _dbiInsightIdx }));
    }
  } catch(_) { _dbiInsightIdx = 0; }

  const ins = insights[_dbiInsightIdx];

  const dots = insights.map((_, i) =>
    `<div class="dbi-dot${i === _dbiInsightIdx ? ' active' : ''}" onclick="_dbiGoInsight(${i})" title="Insight ${i+1}"></div>`
  ).join('');

  return `
    <div class="dbi-insight-strip" id="dbi-insight-strip">
      <div class="dbi-insight-icon">${ins.icon}</div>
      <div class="dbi-insight-body">
        <div class="dbi-insight-title">💡 ${ins.title}</div>
        <div class="dbi-insight-text" id="dbi-insight-text">${ins.text}</div>
        ${ins.cta ? `<button class="dbi-insight-cta" onclick="${ins.cta.fn}">${ins.cta.label} →</button>` : ''}
        <div class="dbi-insight-dots" id="dbi-insight-dots">${dots}</div>
      </div>
    </div>`;
}

function _dbiGoInsight(idx) {
  const insights = _dbiComputeInsights();
  if (!insights.length) return;
  _dbiInsightIdx = idx % insights.length;
  try { localStorage.setItem(_DBI_INSIGHT_IDX, JSON.stringify({ date: _dbiToday(), idx: _dbiInsightIdx })); } catch(_) {}
  const ins = insights[_dbiInsightIdx];
  const textEl = document.getElementById('dbi-insight-text');
  const dotsEl = document.getElementById('dbi-insight-dots');
  const iconEl = document.querySelector('.dbi-insight-strip .dbi-insight-icon');
  if (textEl) { textEl.style.opacity = '0'; setTimeout(() => { textEl.innerHTML = ins.text; textEl.style.opacity = '1'; }, 150); }
  if (iconEl) iconEl.textContent = ins.icon;
  if (dotsEl) dotsEl.innerHTML = insights.map((_,i) =>
    `<div class="dbi-dot${i===_dbiInsightIdx?' active':''}" onclick="_dbiGoInsight(${i})"></div>`
  ).join('');
  if (textEl) textEl.style.transition = 'opacity .15s ease';
}

/* ══════════════════════════════════════════════════════════════════════
   4. "SINCE YOU LAST LOOKED" DIFF BADGE
══════════════════════════════════════════════════════════════════════ */
function _dbiBuildDiffBadge() {
  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  if (!M.length) return '';

  const now        = Date.now();
  const lastTotal  = M.reduce((s,m)=>s+_dbiN(m.TOTAL),0);
  const lastMonths = M.length;

  let html = '';
  try {
    const prev = JSON.parse(localStorage.getItem(_DBI_LAST_KEY) || 'null');
    if (prev && prev.totalMonths === lastMonths) {
      const diff = lastTotal - prev.totalSales;
      if (diff !== 0) {
        const sign  = diff > 0 ? '+' : '';
        const color = diff > 0 ? '#16a34a' : '#dc2626';
        const ago   = _dbiTimeAgo(prev.ts);
        html = `
          <div class="dbi-diff-badge">
            <span>🕐</span>
            <span>Since you last looked: <strong style="color:${color}">${sign}₨${_dbiFF(Math.abs(diff))}</strong></span>
            <span class="dbi-diff-ago">${ago}</span>
          </div>`;
      }
    }
  } catch(_) {}

  // Save current state for next visit
  try {
    localStorage.setItem(_DBI_LAST_KEY, JSON.stringify({
      ts: now, totalSales: lastTotal, totalMonths: lastMonths
    }));
  } catch(_) {}

  return html;
}

function _dbiTimeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ══════════════════════════════════════════════════════════════════════
   5. RULE ALERTS STACK
══════════════════════════════════════════════════════════════════════ */
function _dbiBuildRuleAlerts() {
  if (typeof aimRulesCheckAll !== 'function') return '';
  let fired = [];
  try { fired = aimRulesCheckAll(); } catch(_) {}
  if (!fired.length) return '';

  const items = fired.map(f =>
    `<div class="dbi-rule-alert">${f.msg}</div>`
  ).join('');
  return `<div class="dbi-rules-stack">${items}</div>`;
}

/* ══════════════════════════════════════════════════════════════════════
   PUBLIC ENTRY POINT
══════════════════════════════════════════════════════════════════════ */
function buildDashboardInsights() {
  let wrap = document.getElementById('dash-insights-wrap');
  if (!wrap) {
    // Insert before the KPI row
    const krow = document.getElementById('krow');
    if (!krow) return;
    wrap = document.createElement('div');
    wrap.id = 'dash-insights-wrap';
    krow.parentNode.insertBefore(wrap, krow);
  }

  const M = (typeof MONTHLY !== 'undefined' && MONTHLY) ? MONTHLY : [];
  if (!M.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = [
    _dbiBuildDiffBadge(),
    _dbiBuildBriefing(),
    _dbiBuildTargetPace(),
    _dbiBuildInsightStrip(),
    _dbiBuildRuleAlerts(),
  ].filter(Boolean).join('');
}
