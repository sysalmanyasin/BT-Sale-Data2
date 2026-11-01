// COVER DASHBOARD — Inventory cards: current-state doughnut, weekday chart, reorder-now and top-running cards.

import { DAILY, n, fc, ff } from '../platform/config.js';
import { computeInventoryHealth } from '../shared/summary-calc.js';
import { chartTheme, applyChartDefaults } from '../shared/chart-theme.js';
import { escapeHtml as _esc } from '../shared/html.js';
import { act, registerActions } from '../shared/dom-actions.js';
import { MONTH_SHORT, _currentMonthYear, _dailyDateVal, _getReorderThreshold, _getReorderWindow, _getTopRunCount, _getTopRunWindow, _setReorderThreshold, _setReorderWindow, _setTopRunCount, _setTopRunWindow } from './cover-prefs.js';

// Phase 3.1 — current-state inventory doughnut. Held at module scope (not
// local to renderCoverDashboard) so re-renders (every showPage('cover'),
// every closing/audit/inventory bridge refresh — see call sites) destroy
// the previous Chart.js instance before building a new one on the fresh
// canvas; container.innerHTML replacement below orphans the old <canvas>
// element itself, but not the Chart.js object bound to it, which keeps
// its RAF loop / listeners alive unless explicitly destroyed.
export let _invChart = null;
// Sales-by-weekday chart instance holder (see _renderWeekdayChart below) —
// same destroy-before-rebuild rule as _invChart above.
export let _weekdayChart = null;

// Phase 3.1 — Current-state Inventory doughnut: Never Sold / Dead Stock /
// Excess / Healthy, as a % of totalInventoryValue, right now. Single
// snapshot only — no history, no time axis, per the build plan's scope.
//
// Data source: the same getCoverStats() + ExcessWorkingApp.getSummary()
// already read below for the hero cards — no separate calc, no re-derive.
// "Excess" uses correctedExcessValue (after retain-list + misc buffer),
// matching the "Corrected Excess Stock" hero card rather than the raw
// figure. Never Sold and Dead Stock are mutually exclusive by definition
// (see stockledger.js computeAll(), section 2's own comment); Excess is a
// separate 90-day-velocity calc that in rare edge cases could overlap a
// day or two with Dead Stock — negligible for a share-of-total visual,
// not worth a cross-filter re-derivation the plan didn't ask for.
// Colors match Stock Ledger's own category tags (stockledger.css
// .card.rust/.amber/.indigo) so the same category reads the same color
// on both pages.
// ══════════════════════════════════════════════════════════════════════
export function _renderInventoryChart(invSl, invEw) {
  const canvas = document.getElementById('cover-inventory-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Phase 4.1 — bucket math now lives in shared/summary-calc.js so the
  // WhatsApp briefing (Phase 4.2) computes the identical figures instead
  // of a second hand-rolled copy. No behavior change from the inline
  // version this replaces.
  const { total, never, dead, excess, healthy } = computeInventoryHealth({
    totalInventoryValue:  invSl.totalInventoryValue,
    neverSold60Value:     invSl.neverSold60Value,
    deadStock60Value:     invSl.deadStock60Value,
    correctedExcessValue: invEw ? invEw.correctedExcessValue : 0,
  });

  if (_invChart) { _invChart.destroy(); _invChart = null; }
  if (total <= 0) return; // nothing to show a share-of-total slice against

  const pct = v => total ? Math.round(v / total * 1000) / 10 : 0;

  // Colours come from the shared --st-* status tokens (css/variables.css) so
  // the same category is the same colour on Cover, Inventory Health and in
  // dark mode, instead of hard-coded hex values.
  applyChartDefaults(Chart);
  const th = chartTheme();
  _invChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Never Sold (60D)', 'Dead Stock (60D)', 'Excess (corrected)', 'Healthy'],
      datasets: [{
        data: [never, dead, excess, healthy],
        backgroundColor: [th.status.never, th.status.dead, th.status.excess, th.status.healthy],
        borderWidth: 2, borderColor: th.surface,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: th.text, font: { size: 12 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: { label: c => c.label + ': ₨ ' + fc(c.raw) + ' (' + pct(c.raw) + '%)' } },
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════════════
// Sales by Weekday chart — same destroy-before-rebuild + "if no Chart.js /
// no canvas / no data, bail quietly" pattern as _renderInventoryChart above.
// ══════════════════════════════════════════════════════════════════════

function _currentMonthDailyFilled() {
  const my = _currentMonthYear();
  return DAILY.filter(d => d.Month_Year === my && n(d.TOTAL) > 0)
    .sort((a, b) => _dailyDateVal(a.Date) - _dailyDateVal(b.Date));
}

// Sum of this month's daily TOTAL grouped by weekday (Sun→Sat) — spots
// which days of the week run strong/weak. Weekday is derived from each
// DAILY record's own Date string (DD/Mon/YYYY), not assumed.
export function _renderWeekdayChart() {
  const canvas = document.getElementById('cover-weekday-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_weekdayChart) { _weekdayChart.destroy(); _weekdayChart = null; }

  const days = _currentMonthDailyFilled();
  if (!days.length) return;

  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  days.forEach(rec => {
    const [dd, mon, yyyy] = String(rec.Date || '').split('/');
    const mi = MONTH_SHORT.indexOf(mon);
    if (mi < 0) return;
    const wd = new Date(parseInt(yyyy, 10), mi, parseInt(dd, 10)).getDay();
    sums[wd] += n(rec.TOTAL);
    counts[wd]++;
  });

  // Themed + meaningful colour: strongest weekday = green, weakest = amber,
  // the rest a quiet accent tint (was one flat orange for every bar).
  applyChartDefaults(Chart);
  const th = chartTheme();
  const entered = sums.map((v, i) => (counts[i] ? v : null));
  const hi = Math.max(...entered.filter(v => v != null));
  const lo = Math.min(...entered.filter(v => v != null));
  const barColor = v => (v === hi ? th.status.healthy : (v === lo && hi !== lo ? th.status.reorder : th.accent + '99'));
  _weekdayChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: WD, datasets: [{ label: 'Total sales', data: sums, backgroundColor: sums.map((v, i) => counts[i] ? barColor(v) : th.accent + '33'), borderWidth: 0, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => '₨' + fc(c.raw) + ' across ' + counts[c.dataIndex] + ' day' + (counts[c.dataIndex] === 1 ? '' : 's') + ' entered' } },
      },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { font: { size: 11 }, callback: v => '₨' + ff(v) } },
      },
    },
  });
}

// the (classic-script, window-exposed) Stock Ledger / Excess Working /
// Reorder Report apps, same "read the one existing computation, don't
// re-derive it" rule as AuditBridge/ClosingBridge above. Each bridge call
// is itself cheap (pure re-read of already-computed in-memory state) —
// see stockledger.js/inventory/excess-working.js/inventory/reorder-report.js's own comments
// on their getCoverStats()/getSummary()/getSummaryFor() functions.
export function _inventoryHeroStats() {
  let slStats = null, ewSummary = null, rrSummary = null;
  try {
    const SL = window.StockLedgerApp;
    slStats = (SL && typeof SL.getCoverStats === 'function') ? SL.getCoverStats() : null;
  } catch (e) { console.error('Cover Dashboard: StockLedgerApp.getCoverStats() failed', e); }
  try {
    const EW = window.ExcessWorkingApp;
    ewSummary = (EW && typeof EW.getSummary === 'function') ? EW.getSummary() : null;
  } catch (e) { console.error('Cover Dashboard: ExcessWorkingApp.getSummary() failed', e); }
  try {
    const RR = window.ReorderReportApp;
    rrSummary = (RR && typeof RR.getSummaryFor === 'function') ? RR.getSummaryFor(60, 30, 500) : null;
  } catch (e) { console.error('Cover Dashboard: ReorderReportApp.getSummaryFor() failed', e); }
  return { slStats, ewSummary, rrSummary };
}

// ── Inventory dashboard extras (Rule-Based Intelligence Plan §3.2) ────
// Reorder Now / Excess Stock compact tables + a velocity chart, built into
// the Inventory group's own hero section (above) rather than a new page
// — Cover already IS this app's "dashboard per domain" pattern (see the
// Sales/Manager/Closing hero sections alongside this one), so a second,
// separate "Inventory Dashboard" route would just duplicate this one.

// Same (60d window, <30d cover, Top 500 by sale value, includeToday) params
// as Cover's own "Reorder Alert" hero stat and ReorderReportApp.getSummaryFor()
// — so the count here always equals that stat's itemsShown (e.g. "42 of 449
// flagged"), matching the Reorder Report's Top N tab with those filters
// exactly, not this page's own persisted (possibly different) settings.
// Reorder-qty target is deliberately a 30-day cover level computed off
// 60-day sale quantity (a longer, steadier velocity read than 30d alone),
// applied consistently everywhere this "Reorder Now"/"Reorder Alert"
// figure shows up on Cover.
// Same explicit params, uncapped — the "of 449 flagged in total" half of
// the header count next to Reorder Now's "N flagged" (itemsShown).
// Reorder-qty target/threshold defaults to 60d window/30 days (see
// convention above) but this widget's window AND cover threshold are
// both user-toggleable (30/60/90d window, 7/14/30d cover) — pick the
// same combination shown on the full Reorder Report page and this
// widget's numbers match it exactly (identical calculation pipeline).
// The Reorder Alert hero stat above stays fixed at 60d/30d regardless,
// since that one's meant as a stable headline figure, not a toggled view.
function _reorderTotalFlagged() {
  try {
    const RR = window.ReorderReportApp;
    if (!RR || typeof RR.getFlaggedTotalFor !== 'function') return 0;
    return RR.getFlaggedTotalFor(_getReorderWindow(), _getReorderThreshold(), true);
  } catch (e) { console.error('Cover Dashboard: _reorderTotalFlagged failed', e); return 0; }
}

function _reorderNowRows() {
  try {
    const RR = window.ReorderReportApp;
    if (!RR || typeof RR.getFlaggedRowsFor !== 'function') return [];
    return RR.getFlaggedRowsFor(_getReorderWindow(), _getReorderThreshold(), 500, true);
  } catch (e) { console.error('Cover Dashboard: _reorderNowRows failed', e); return []; }
}

// Stricter urgency cut within that same <30d-cover/Top-500-by-60d-value
// pool: items with under 7 days of cover left, split into already-zero
// stock (stockout right now) vs still holding some stock but running out
// inside a week (critical). daysCoverP here is the 60d-based cover
// (window=60 was passed into getFlaggedRowsFor above), consistent with
// the 60d-velocity convention used everywhere else on this page.
export function _reorderUrgentStats() {
  try {
    const RR = window.ReorderReportApp;
    const rows = (RR && typeof RR.getFlaggedRowsFor === 'function') ? RR.getFlaggedRowsFor(60, 30, 500, true) : [];
    const urgent = rows.filter(r => r.daysCoverP != null && r.daysCoverP < 7);
    const zeroStock = urgent.filter(r => (Number(r.stock) || 0) <= 0).length;
    return { total: rows.length, urgentCount: urgent.length, zeroStock, critical: urgent.length - zeroStock };
  } catch (e) { console.error('Cover Dashboard: _reorderUrgentStats failed', e); return { total: 0, urgentCount: 0, zeroStock: 0, critical: 0 }; }
}

// This is Excess Stock (status === 'Excess'), not Dead Stock — Dead Stock
// is a separate 60-day-quiet metric already shown as its own hero card
// ("Dead Stock (60D)") above. excessContribution sums to exactly
// ExcessWorkingApp.getSummary().rawExcessValue (the "Excess Stock Total"
// hero card), confirming this table is Excess Stock, highest value first.
export function _excessStockRows() {
  try {
    const EW = window.ExcessWorkingApp;
    if (!EW || typeof EW.getRows !== 'function') return [];
    return EW.getRows()
      .filter(r => r.status === 'Excess')
      .sort((a, b) => n(b.excessContribution) - n(a.excessContribution));
  } catch (e) { console.error('Cover Dashboard: _excessStockRows failed', e); return []; }
}

// One shared compact-table renderer for both cards — `kind` picks which
// columns matter (cover/demand for Reorder, value/age for Dead Stock).
// Click-through per row jumps straight to that item's full page; the
// item name isn't independently searchable there today, so this opens
// the report rather than pre-filtering to the single row — still far
// faster than hunting for it manually.
export function _inventoryMiniTableHtml(rows, kind) {
  if (!rows || !rows.length) {
    return `<div style="font-size:11px;color:var(--muted);padding:8px 0">No items to show right now.</div>`;
  }
  const row = r => {
    if (kind === 'reorder') {
      const cover = r.daysCoverP != null ? r.daysCoverP.toFixed(1) + 'd' : '—';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer"${act('click', 'showPage', 'reorder')}>
          <div style="min-width:0">
            <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px">${_esc(r.name || r.code)}</div>
            <div style="font-size:11px;color:var(--muted)">${cover} cover · reorder ${fc(r.demandQtyP)} units</div>
            <div style="font-size:11px;color:var(--muted)">sold 30d: ${fc(r.saleQty30)} units · ₨ ${fc(r.saleValue30)}</div>
          </div>
          <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:var(--red);flex-shrink:0">₨ ${fc(r.demandValueP)}</div>
        </div>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer"${act('click', 'showPage', 'excess')}>
        <div style="min-width:0">
          <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px">${_esc(r.name)}</div>
          <div style="font-size:11px;color:var(--muted)">${_esc(r.company || 'Unspecified')}${r.daysOld != null ? ' · ' + r.daysOld + 'd old' : ''}</div>
        </div>
        <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:var(--amber);flex-shrink:0">₨ ${fc(r.excessContribution)}</div>
      </div>`;
  };
  return `<div style="max-height:280px;overflow-y:auto">${rows.map(row).join('')}</div>`;
}

// Top Running Items (replaces the old Sale Velocity units/day chart per
// user feedback: a value-ranked list with a window toggle reads faster
// than a per-item rate comparison). Same underlying data source as
// before — ReorderReportApp.getTopSellersFor() — just re-run for
// whichever window (30/60/90d) and Top N (10/20) the user has toggled,
// both persisted so the choice survives a reload.
function _topRunningRows() {
  try {
    const RR = window.ReorderReportApp;
    if (!RR || typeof RR.getTopSellersFor !== 'function') return [];
    return RR.getTopSellersFor(_getTopRunWindow(), _getTopRunCount(), true);
  } catch (e) { console.error('Cover Dashboard: _topRunningRows failed', e); return []; }
}

function _topRunningTableHtml(rows) {
  if (!rows || !rows.length) {
    return `<div style="font-size:11px;color:var(--muted);padding:8px 0">No sales data yet.</div>`;
  }
  return `<div style="max-height:280px;overflow-y:auto">${rows.map((r, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0;display:flex;gap:8px;align-items:center">
        <span style="font-size:11px;color:var(--muted);width:16px;flex-shrink:0">${i + 1}</span>
        <div style="min-width:0">
          <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px">${_esc(r.name || r.code)}</div>
          <div style="font-size:11px;color:var(--muted)">${fc(r.saleQtyP)} units sold</div>
        </div>
      </div>
      <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:var(--accent);flex-shrink:0">₨ ${fc(r.saleValueP)}</div>
    </div>`).join('')}</div>`;
}

// Toggle buttons call these (must be on window — they're wired via
// inline onclick so this card can re-render itself in place without
// touching the rest of the page).
window._coverSetTopRunWindow = function (w) { _setTopRunWindow(w); _renderTopRunningCard(); };
window._coverSetTopRunCount = function (n) { _setTopRunCount(n); _renderTopRunningCard(); };

// Reorder Now card — same toggle-pill pattern as Top Running Items,
// swapping the hardcoded 30-day cover threshold for a 7D/14D/30D toggle
// (persisted). Rebuilt as one innerHTML block (title + toggle + table)
// so a click re-renders the whole card in place.
window._coverSetReorderThreshold = function (d) { _setReorderThreshold(d); _renderReorderNowCard(); };
window._coverSetReorderWindow = function (w) { _setReorderWindow(w); _renderReorderNowCard(); };

// Actions for the cover page's STR links (replace multi-statement inline handlers).
registerActions({
  coverOpenStrDetail(id) { window.showPage('str'); setTimeout(() => { window.strOpenDetail && window.strOpenDetail(id); }, 30); },
  coverOpenStrStage(stage) {
    window.showPage('str');
    window.strClearFilters && window.strClearFilters();
    window.strSetStage && window.strSetStage(stage);
  },
});

export function _reorderNowCardInnerHtml() {
  const th = _getReorderThreshold();
  const win = _getReorderWindow();
  const rows = _reorderNowRows();
  const totalFlagged = _reorderTotalFlagged();
  const pill = (active, label, fn, fnArg) => `<button type="button" class="cover-pill cover-pill--red${active ? ' is-on' : ''}" aria-pressed="${active}"${act('click', fn, fnArg)}>${label}</button>`;
  return `
    <div class="ctitle" style="flex-wrap:wrap;row-gap:6px">
      <span class="cdot" style="background:var(--red)"></span>Reorder Now — most urgent (${rows.length} of ${totalFlagged} flagged)
      <span style="margin-left:auto;display:flex;align-items:center">${pill(win === 30, '30D', '_coverSetReorderWindow', 30)}${pill(win === 60, '60D', '_coverSetReorderWindow', 60)}${pill(win === 90, '90D', '_coverSetReorderWindow', 90)}</span>
      <span style="display:flex;align-items:center">${pill(th === 7, '<7D', '_coverSetReorderThreshold', 7)}${pill(th === 14, '<14D', '_coverSetReorderThreshold', 14)}${pill(th === 30, '<30D', '_coverSetReorderThreshold', 30)}</span>
      <button type="button" class="cover-chip-link"${act('click', 'showPage', 'reorder')}>FULL REPORT ↗</button>
    </div>
    <div id="cover-reorder-now-table">${_inventoryMiniTableHtml(rows, 'reorder')}</div>`;
}

function _renderReorderNowCard() {
  const card = document.getElementById('cover-reorder-now-card');
  if (card) card.innerHTML = _reorderNowCardInnerHtml();
}

export function _topRunningCardInnerHtml() {
  const win = _getTopRunWindow();
  const cnt = _getTopRunCount();
  const pill = (active, label, fn, fnArg) => `<button type="button" class="cover-pill cover-pill--accent${active ? ' is-on' : ''}" aria-pressed="${active}"${act('click', fn, fnArg)}>${label}</button>`;
  return `
    <div class="ctitle" style="flex-wrap:wrap;row-gap:6px">
      <span class="cdot" style="background:var(--accent)"></span>Top Running Items — value-wise
      <span style="margin-left:auto;display:flex;align-items:center">${pill(cnt === 10, 'Top 10', '_coverSetTopRunCount', 10)}${pill(cnt === 20, 'Top 20', '_coverSetTopRunCount', 20)}</span>
      <span style="display:flex;align-items:center">${pill(win === 30, '30D', '_coverSetTopRunWindow', 30)}${pill(win === 60, '60D', '_coverSetTopRunWindow', 60)}${pill(win === 90, '90D', '_coverSetTopRunWindow', 90)}</span>
    </div>
    <div id="cover-top-running-table">${_topRunningTableHtml(_topRunningRows())}</div>`;
}

function _renderTopRunningCard() {
  const card = document.getElementById('cover-top-running-card');
  if (card) card.innerHTML = _topRunningCardInnerHtml();
}
