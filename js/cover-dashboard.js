// COVER DASHBOARD — Floor 5

import { MONTHLY, DAILY, n, fc } from './config.js';
import { Repository } from './repository.js';
import * as LedgerStore from './ledger-store.js';
import * as ClosingBridge from './closing-bridge.js';
import * as AuditBridge from './audit-bridge.js';
import * as InventoryBridge from './inventory-bridge.js';
import { computeInventoryHealth } from './shared/summary-calc.js';

const TGT_KEY = 'bt_targets';
let _closingRefreshInFlight = false;
let _auditRefreshInFlight = false;
let _inventoryRefreshInFlight = false;
// Phase 3.1 — current-state inventory doughnut. Held at module scope (not
// local to renderCoverDashboard) so re-renders (every showPage('cover'),
// every closing/audit/inventory bridge refresh — see call sites) destroy
// the previous Chart.js instance before building a new one on the fresh
// canvas; container.innerHTML replacement below orphans the old <canvas>
// element itself, but not the Chart.js object bound to it, which keeps
// its RAF loop / listeners alive unless explicitly destroyed.
let _invChart = null;
const MONTH_NAMES = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _currentMonthYear() {
  const d = new Date();
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}
function _isoMonthPrefix() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function _daysInMonth(y, mi) { return new Date(y, mi + 1, 0).getDate(); }

function _dailyDateVal(dateStr) {
  const [dd, mon, yyyy] = String(dateStr || '').split('/');
  const mi = MONTH_SHORT.indexOf(mon);
  return (parseInt(yyyy, 10) || 0) * 10000 + (mi >= 0 ? mi : 0) * 100 + (parseInt(dd, 10) || 0);
}

function _lastFilledDay(monthYear) {
  return Math.max(0, ...DAILY
    .filter(d => n(d.TOTAL) > 0 && d.Month_Year === monthYear)
    .map(d => parseInt((d.Date || '').split('/')[0], 10) || 0));
}

function _getTargets() {
  try { return JSON.parse(Repository.getItem(TGT_KEY) || '{}'); } catch (e) { return {}; }
}

const PIN_KEY = 'bt_cover_pins_v1';
const COLLAPSE_KEY = 'bt_cover_collapsed_v1';
function _getPins() { try { return JSON.parse(Repository.getItem(PIN_KEY) || '[]'); } catch (e) { return []; } }
function _setPins(arr) { try { Repository.setItem(PIN_KEY, JSON.stringify(arr)); } catch (e) {} }
function _getCollapsed() { try { return JSON.parse(Repository.getItem(COLLAPSE_KEY) || '[]'); } catch (e) { return []; } }
function _setCollapsed(arr) { try { Repository.setItem(COLLAPSE_KEY, JSON.stringify(arr)); } catch (e) {} }

function _greetingText() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Working late';
  const online = ClosingBridge.getOnlineStaff();
  return part + ' 👋' + (online.length ? ' · ' + online.length + ' online now' : '');
}

// Last 7 filled-day totals (oldest→newest), for the sales headline sparkline + trend arrow.
function _last7DayTotals() {
  const filled = DAILY.filter(d => n(d.TOTAL) > 0)
    .sort((a, b) => _dailyDateVal(a.Date) - _dailyDateVal(b.Date));
  return filled.slice(-7).map(d => n(d.TOTAL));
}

function _sparklineSvg(values) {
  if (!values || values.length < 2) return '';
  const w = 84, hgt = 28, pad = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const range = (max - min) || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => `${(pad + i * step).toFixed(1)},${(hgt - pad - ((v - min) / range) * (hgt - pad * 2)).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return `<svg class="cover-hero-spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
    <polyline points="${pts}" fill="none" stroke="${up ? '#059669' : '#dc2626'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function _trendBadge(values) {
  if (!values || values.length < 2) return '';
  const prev = values[values.length - 2], cur = values[values.length - 1];
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return `<span class="cover-hero-trend ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

// Aggregates only genuinely actionable items across modules — the whole
// point is that this stays short; a quiet day should show almost nothing.
function _needsAttention() {
  const items = [];
  try {
    const pace = _targetPace();
    if (/behind pace/.test(pace.sub || '')) {
      items.push({ icon: '📉', text: 'Behind sales target this month', cls: 'amber', page: 'dashboard' });
    }
  } catch (e) {}
  try {
    const credits = _totalOutstandingCredits();
    const v = parseFloat(String(credits.value || '').replace(/[^0-9.-]/g, ''));
    if (v > 0) items.push({ icon: '💳', text: 'Rs. ' + fc(v) + ' outstanding credit', cls: 'amber', page: 'manager' });
  } catch (e) {}
  try {
    const inv = _inventoryHeroStats();
    if (inv.slStats && inv.slStats.dataReady && n(inv.slStats.negativeValue) > 0) {
      items.push({ icon: '⚠️', text: 'Negative-value stock in Inventory', cls: 'red', page: 'inventory' });
    }
    if (inv.rrSummary && n(inv.rrSummary.totalReorderValue) > 0) {
      items.push({ icon: '🛒', text: inv.rrSummary.itemsShown + ' items need reorder', cls: 'amber', page: 'reorder' });
    }
  } catch (e) {}
  return items;
}

function _renderAttentionStrip() {
  const el = document.getElementById('cover-attention-strip');
  if (!el) return;
  const items = _needsAttention();
  if (!items.length) {
    el.innerHTML = '<div class="cover-attn-empty">✅ All clear — nothing needs attention right now.</div>';
    return;
  }
  el.innerHTML = `<div class="cover-attn-row">
    ${items.map((it, i) => `<div class="cover-attn-chip cls-${it.cls}" data-attn-idx="${i}">${it.icon} ${_esc(it.text)}</div>`).join('')}
  </div>`;
  el.querySelectorAll('[data-attn-idx]').forEach(chip => {
    chip.addEventListener('click', () => {
      const it = items[+chip.dataset.attnIdx];
      if (it && typeof window.showPage === 'function') window.showPage(it.page);
    });
  });
}

function _renderPinsRow(tiles) {
  const el = document.getElementById('cover-pins-row');
  if (!el) return;
  const pins = _getPins();
  const pinned = pins.map(p => tiles.find(t => t.page === p || t.href === p)).filter(Boolean);
  if (!pinned.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="cover-pins-title">📌 Your Shortcuts</div>
    <div class="cover-pins-row">
      ${pinned.map(t => `<div class="cover-pin-tile" data-pin-goto="${_esc(t.page || t.href)}">
        <div class="cover-pin-icon">${t.icon}</div>
        <div class="cover-pin-label">${_esc(t.title)}</div>
      </div>`).join('')}
    </div>`;
  el.querySelectorAll('[data-pin-goto]').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.pinGoto;
      const t = tiles.find(x => x.page === key || x.href === key);
      if (!t) return;
      if (t.href) window.open(t.href, '_blank', 'noopener');
      else if (t.page && typeof window.showPage === 'function') window.showPage(t.page);
    });
  });
}

function _salesHeadline() {
  const filled = DAILY.filter(d => n(d.TOTAL) > 0);
  if (!filled.length) return { label: 'Latest sale', value: 'No entries yet', sub: '' };
  const latest = filled.reduce((best, d) => _dailyDateVal(d.Date) > _dailyDateVal(best.Date) ? d : best);
  return { label: 'Latest sale', value: '₨' + fc(n(latest.TOTAL)), sub: latest.Date };
}

function _targetPace() {
  const my = _currentMonthYear();
  const target = n(_getTargets()[my]);
  const actualRec = MONTHLY.find(m => m.Month_Year === my);
  const actual = actualRec ? n(actualRec.TOTAL) : 0;
  if (!target) return { label: 'Target pace — ' + my, value: 'No target set', sub: 'Set one in Tools' };
  const d = new Date();
  const totalDays = _daysInMonth(d.getFullYear(), d.getMonth());
  const elapsedDays = _lastFilledDay(my);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const expectedSoFar = target * (elapsedDays / totalDays);
  const diff = actual - expectedSoFar;
  const pct = Math.round(actual / target * 100);
  const remainingTarget = Math.max(0, target - actual);
  const neededPerDay = remainingDays > 0 ? Math.ceil(remainingTarget / remainingDays) : 0;
  const paceLine = diff >= 0 ? '+₨' + fc(diff) + ' ahead of pace' : '-₨' + fc(Math.abs(diff)) + ' behind pace';
  const sub = paceLine + ' · Day ' + elapsedDays + '/' + totalDays + ' entered' +
              (remainingDays > 0 ? ' · ₨' + fc(neededPerDay) + '/day for remaining ' + remainingDays + ' days' : '');
  return { label: 'Target pace — ' + my, value: pct + '% of target', sub };
}

function _salesStatus() {
  if (!MONTHLY.length) return 'No sales data loaded yet';
  const lat = MONTHLY[MONTHLY.length - 1];
  return lat.Month_Year + ' · ₨' + fc(n(lat.TOTAL)) + ' so far';
}

function _managerStatus() {
  try {
    const jcBal = LedgerStore.getCurrentBalance('jazzcash');
    const monthPrefix = _isoMonthPrefix();
    const expCount = LedgerStore.getEntries('expense').filter(e => (e.date || '').slice(0, 7) === monthPrefix).length;
    return 'Jazz Cash ₨' + fc(jcBal) + ' · ' + expCount + ' expense entries this month';
  } catch (e) {
    return 'Ledger status unavailable';
  }
}

function _totalOutstandingCredits() {
  try {
    const A = window.Analytics;
    if (!A) return { label: 'Total Outstanding Credits', value: 'Unavailable', sub: '' };
    const my = A.latestManagerMonth();
    const data = A.getCreditSectionData(my);
    const v = data.grandTotal;
    const sign = v < 0 ? '−' : '';
    return {
      label: 'Total Outstanding Credits',
      value: sign + '₨' + fc(Math.abs(v)),
      sub: 'Staff (' + (my || '—') + ') + Jazz Cash + Patty/Expenses + Other Sections, all-time',
    };
  } catch (e) {
    return { label: 'Total Outstanding Credits', value: 'Unavailable', sub: '' };
  }
}

function _notesheetsStatus() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const sheetFiles = (typeof _nsSFLoad === 'function') ? _nsSFLoad() : JSON.parse(Repository.getItem('bt_sheet_files_v1') || '[]');
    if (!notes.length && !sheetFiles.length) return 'No notes or sheets yet';
    return notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' · ' +
           sheetFiles.length + ' file' + (sheetFiles.length === 1 ? '' : 's');
  } catch (e) {
    return 'Notes & Sheets status unavailable';
  }
}

const SHIFT_ICON = { pending: '⚪', draft: '🟡', closed: '✅' };

// Turns a Closing shift key ("2026-07-19_Night") into "19 Jul · Night".
// Falls back to raw text for anything that doesn't parse (e.g. a
// Settings/Dashboard page with no shift key — see auth.js's
// active_key, only ever set while a shift is actually open).
function _activeKeyLabel(key) {
  if (!key) return 'Browsing (no shift open)';
  const m = /^(\d{4})-(\d{2})-(\d{2})_(.+)$/.exec(key);
  if (!m) return key;
  const [, , mo, dd, shift] = m;
  return dd + ' ' + MONTH_SHORT[parseInt(mo, 10) - 1] + ' · ' + shift;
}

function _onlineStaffBadge() {
  const online = ClosingBridge.getOnlineStaff();
  if (!online.length) return '';
  const names = online.map(s => s.name).join(', ');
  return '🟢 ' + names;
}

// Called by the badge's onclick (bridged to window below). Shows what
// each online staff member is currently doing, derived from their
// presence row's active_key — same data BT's own collision-free
// dashboard already polls, just surfaced instead of only aggregated
// into a name list.
export function showOnlineStaffDetail() {
  const online = ClosingBridge.getOnlineStaff();
  if (!online.length) { alert('Nobody is currently signed into Closing.'); return; }
  const lines = online.map(s => '• ' + s.name + ' — ' + _activeKeyLabel(s.active_key));
  alert('Online in Closing right now:\n\n' + lines.join('\n'));
}
window.showOnlineStaffDetail = showOnlineStaffDetail;
function _closingStatus() {
  if (!ClosingBridge.isConnected()) {
    return 'Not connected — tap 🔗 Data Bridge below to link';
  }
  const summary = ClosingBridge.getCachedSummary();
  const badge = _onlineStaffBadge();
  if (!summary) return (badge || 'Live shift register — Fazal Din\u2019s Pharma Plus');
  const parts = summary.shifts.map(s => SHIFT_ICON[s.status] + ' ' + s.shift);
  if (badge) parts.push(badge);
  return parts.join('  ·  ');
}

function _auditStatus() {
  const summary = AuditBridge.getCachedSummary();
  if (!summary) return 'Live inventory audit — Fazal Din\u2019s Pharma Plus';
  if (!summary.items.length) return 'No open engagements';
  return summary.items.map(it =>
    it.name + ' — ' + it.roundState + (it.assigned ? ' (' + it.submitted + '/' + it.assigned + ' submitted)' : '')
  ).join('  ·  ');
}

function _inventoryStatus() {
  const data = InventoryBridge.getFullData();
  if (!data) return 'Live from Random — Supabase-synced inventory';
  if (!data.products.length) return 'No inventory synced yet';
  const syncedLabel = data.lastSync
    ? 'last sync ' + new Date(data.lastSync.syncedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
    : 'synced ' + new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return data.products.length.toLocaleString() + ' item(s) · ' + syncedLabel;
}

function _clFmtDate(ds) { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ds; } }
function _shiftSeq(shift) { if (shift === 'Night') return 10; if (shift === 'Evening') return 9999; return 20; }
function _sheetSortKey(cdb, key) {
  const parts = key.split('_');
  const rec = (cdb.sheets && cdb.sheets[key]) || {};
  const seq = (typeof rec.seq === 'number') ? rec.seq : _shiftSeq(parts[1]);
  return parts[0] + '_' + String(seq).padStart(6, '0');
}
function _latestRealSheet(cdb) {
  if (!cdb || !cdb.sheets) return null;
  const keys = Object.keys(cdb.sheets).filter(k => {
    const rec = cdb.sheets[k]; return !!rec && rec.draft !== true;
  });
  if (!keys.length) return null;
  keys.sort((a, b) => _sheetSortKey(cdb, a).localeCompare(_sheetSortKey(cdb, b)));
  const key = keys[keys.length - 1]; const rec = cdb.sheets[key]; const parts = key.split('_');
  return { key, rec, date: parts[0], shift: parts[1] };
}

function _closingBookBillsAndReturnsSince(cdb, uptoKey) {
  // Mirrors Closing app's own aggregateSinceLastFinal (js/pages.js / js/actions.js):
  // Book Bills & Manual Returns accumulate across shift closings until the
  // most recent "Final" closing, whose own totals are included, then stop.
  // Only counting rec.inBook1+inBook2 on 'final'-mode records (the old bug
  // here) reads 0 on every ordinary Night/Morning/Evening shift closing —
  // which is nearly all of them.
  const keys = Object.keys(cdb.sheets || {}).filter(k => {
    const r = cdb.sheets[k]; return !!r && r.draft !== true;
  });
  keys.sort((a, b) => _sheetSortKey(cdb, a).localeCompare(_sheetSortKey(cdb, b)));
  const uptoIdx = keys.indexOf(uptoKey);
  if (uptoIdx === -1) return { totalBooks: 0, totalManRet: 0 };
  let totalBooks = 0, totalManRet = 0;
  for (let i = uptoIdx; i >= 0; i--) {
    const rec = cdb.sheets[keys[i]];
    if (!rec) continue;
    totalBooks += n(rec.inBook1) + n(rec.inBook2);
    totalManRet += n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
    if (rec.profileMode === 'final') break; // include the Final itself, then stop
  }
  return { totalBooks, totalManRet };
}

function _closingLatestSummary() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Closing Summary', value: 'Waiting for Closing…', stats: [] };
  const latest = _latestRealSheet(cdb);
  if (!latest) return { label: 'Latest Closing Summary', value: 'No closings yet', stats: [] };
  const rec = latest.rec;
  const { totalBooks, totalManRet } = _closingBookBillsAndReturnsSince(cdb, latest.key);
  const val = `${_clFmtDate(latest.date)} · ${latest.shift}`;
  const savedBy = ClosingBridge.getSavedBy(latest.key);
  const stats = [
    { icon: '💳', cls: 'cc', label: 'Carried CC',      value: n(rec.outPrevCC) },
    { icon: '🏦', cls: 'dep', label: 'Deposits',        value: n(rec.outTotalF) },
    { icon: '📚', cls: 'books', label: 'Book Bills',    value: totalBooks },
    { icon: '↩️', cls: 'ret', label: 'Manual Returns',  value: totalManRet },
  ];
  return { label: 'Latest Closing Summary', value: val, sub: savedBy ? `Saved by ${savedBy}` : '', stats };
}

function _closingLatestCredit() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Credit', value: 'Waiting for Closing…', sub: '' };
  const latest = _latestRealSheet(cdb);
  if (!latest) return { label: 'Latest Credit', value: 'No credit records', sub: '' };
  const rec = latest.rec;
  const credit = n(rec.outTotalE);
  return { label: 'Latest Credit', value: 'Rs. ' + fc(credit), sub: `${_clFmtDate(latest.date)} · ${latest.shift}` };
}

function _closingLatestMisc() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Misc / Ongoing', value: 'Waiting for Closing…', sub: '' };
  const keys = Object.keys(cdb.sheets || {}).filter(k => { const r = cdb.sheets[k]; return r && r.draft !== true && Array.isArray(r.miscRows) && r.miscRows.length; });
  if (!keys.length) return { label: 'Latest Misc / Ongoing', value: 'No misc entries', sub: '' };
  keys.sort((a, b) => _sheetSortKey(cdb, a).localeCompare(_sheetSortKey(cdb, b)));
  const key = keys[keys.length - 1]; const rec = cdb.sheets[key]; const parts = key.split('_'); const date = parts[0], shift = parts[1];
  const total = (rec.miscRows || []).reduce((s, r) => s + (parseFloat(r.val) || 0), 0);
  return { label: 'Latest Misc / Ongoing', value: 'Rs. ' + fc(total), sub: `${_clFmtDate(date)} · ${shift}` };
}

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
function _renderInventoryChart(invSl, invEw) {
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

  _invChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Never Sold (60D)', 'Dead Stock (60D)', 'Excess (corrected)', 'Healthy'],
      datasets: [{
        data: [never, dead, excess, healthy],
        backgroundColor: ['#AE3B2C', '#A8762A', '#33507D', '#059669'],
        borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#334155', font: { size: 10 }, boxWidth: 10, padding: 5 } },
        tooltip: { callbacks: { label: c => c.label + ': Rs. ' + fc(c.raw) + ' (' + pct(c.raw) + '%)' } },
      },
    },
  });
}

// Inventory domain hero stats — all three come from bridge functions on
// the (classic-script, window-exposed) Stock Ledger / Excess Working /
// Reorder Report apps, same "read the one existing computation, don't
// re-derive it" rule as AuditBridge/ClosingBridge above. Each bridge call
// is itself cheap (pure re-read of already-computed in-memory state) —
// see stockledger.js/excess-working.js/reorder-report.js's own comments
// on their getCoverStats()/getSummary()/getSummaryFor() functions.
function _inventoryHeroStats() {
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
    rrSummary = (RR && typeof RR.getSummaryFor === 'function') ? RR.getSummaryFor(30, 7, 500) : null;
  } catch (e) { console.error('Cover Dashboard: ReorderReportApp.getSummaryFor() failed', e); }
  return { slStats, ewSummary, rrSummary };
}

function _tiles() {
  return [
    { page: 'dashboard', icon: '📊', title: 'Sales',           status: _salesStatus(),   enabled: true, group: 'Sales' },
    { page: 'manager',   icon: '👔', title: 'Manager',          status: _managerStatus(), enabled: true, group: 'Manager' },
    { page: 'notesheets',icon: '📑', title: 'Notes & Sheets',   status: _notesheetsStatus(), enabled: true, group: 'Notes & Sheets' },
    { href: 'https://closing.duapharma.com', icon: '🔒', title: 'Closing', status: _closingStatus(), enabled: true, group: 'Closing' },
    { page: 'closing-book',   icon: '📖', title: 'Closing Book',  status: 'Every closing, laid out like a printed register', enabled: true, group: 'Closing' },
    { page: 'credit-ledger',  icon: '💳', title: 'Credit Ledger', status: 'Credit + Misc/Ongoing snapshot history',           enabled: true, group: 'Closing' },
    { href: 'https://random.duapharma.com',  icon: '🧾', title: 'Audit',   status: _auditStatus(),   enabled: true, group: 'Audit' },
    { page: 'assignments', icon: '📋', title: 'Assignments', status: 'Auditor progress + company coverage, every engagement', enabled: true, group: 'Audit' },
    { page: 'inventory', icon: '📦', title: 'BT Inventory',    status: _inventoryStatus(), enabled: true, group: 'Inventory' },
    { page: 'stockledger', icon: '📒', title: 'Stock Ledger', status: 'Never-sold, dead stock, excess & pack-issue analysis', enabled: true, group: 'Inventory' },
    { page: 'excess', icon: '📉', title: 'Excess Working', status: 'Corrected excess value, retain list & Top N export', enabled: true, group: 'Inventory' },
    { page: 'reorder', icon: '🛒', title: 'Reorder Report', status: 'Low stock-cover items ranked by sale value, Top N + export', enabled: true, group: 'Inventory' },
    { href: 'https://reports.duapharma.com/daily_report.html', icon: '✅', title: 'Daily Check List', status: 'Fazal Din\'s Pharma Plus — standalone checklist app', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/excess-stock-control.html', icon: '📦', title: 'Excess Stock Control', status: 'Fazal Din\'s Pharma Plus — excess stock control', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/invoice-desk.html', icon: '🧮', title: 'Branch Invoice Desk', status: 'Fazal Din\'s Pharma Plus — branch invoice desk', enabled: true, group: 'Reports' },
  ];
}

const GROUP_ORDER = ['Sales', 'Manager', 'Notes & Sheets', 'Closing', 'Audit', 'Inventory', 'Reports'];
const GROUP_META = {
  'Sales':           { slug: 'sales',   icon: '📊' },
  'Manager':         { slug: 'manager', icon: '👔' },
  'Notes & Sheets':  { slug: 'notes',   icon: '📑' },
  'Closing':         { slug: 'closing', icon: '🔒' },
  'Audit':           { slug: 'audit',   icon: '🧾' },
  'Inventory':       { slug: 'inventory', icon: '📦' },
  'Reports':         { slug: 'reports', icon: '📚' },
};

function _updateHeroDate() {
  const el = document.getElementById('cover-hero-date');
  const greetEl = document.getElementById('cover-greeting');
  if (greetEl) greetEl.textContent = _greetingText();
  if (!el) return;
  const d = new Date();
  const dayName = d.toLocaleDateString('en-PK', { weekday: 'long' });
  const dateStr = d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
  el.innerHTML = `<div class="d-day">${_esc(dayName)}</div><div>${_esc(dateStr)} · ${_esc(timeStr)}</div>`;
}

function _updateOnlinePill() {
  const pill = document.getElementById('cover-online-pill');
  if (!pill) return;
  const online = ClosingBridge.getOnlineStaff();
  if (!online.length) { pill.style.display = 'none'; return; }
  pill.textContent = '🟢 ' + online.length + ' online in Closing — tap for details';
  pill.style.display = 'inline-flex';
}

function _wireCoverSearch(tiles) {
  const input = document.getElementById('cover-search');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('#cover-container .cover-group').forEach(groupEl => {
      let anyVisible = false;
      groupEl.querySelectorAll('.cover-tile').forEach(tileEl => {
        const title = (tileEl.querySelector('.cover-tile-title')?.textContent || '').toLowerCase();
        const status = (tileEl.querySelector('.cover-tile-status')?.textContent || '').toLowerCase();
        const match = !q || title.includes(q) || status.includes(q);
        tileEl.classList.toggle('cover-tile-hidden', !match);
        tileEl.classList.toggle('cover-tile-match', !!q && match);
        if (match) anyVisible = true;
      });
      groupEl.classList.toggle('cover-group-hidden', !!q && !anyVisible);
      if (q && anyVisible) groupEl.classList.remove('collapsed');
    });
  });
}

export function renderCoverDashboard() {
  const container = document.getElementById('cover-container');
  if (!container) return;

  _updateOnlinePill();

  const headline = _salesHeadline();
  const week = _last7DayTotals();
  headline.spark = _sparklineSvg(week);
  headline.trend = _trendBadge(week);
  const pace = _targetPace();
  const credits = _totalOutstandingCredits();
  const tiles = _tiles();

  const heroCard = h => `
    <div class="cover-hero-card">
      <div class="cover-hero-label">${_esc(h.label)}</div>
      <div class="cover-hero-value">${_esc(h.value)}${h.trend || ''}</div>
      <div class="cover-hero-sub">${_esc(h.sub)}</div>
      ${h.spark || ''}
    </div>`;

  const closingSummaryCard = h => `
    <div class="cover-hero-card cover-closing-summary-card">
      <div class="cover-hero-label">${_esc(h.label)}</div>
      <div class="cover-hero-value">${_esc(h.value)}</div>
      ${h.sub ? `<div class="cover-hero-sub">${_esc(h.sub)}</div>` : ''}
      ${h.stats && h.stats.length ? `
      <div class="ccs-stat-grid">
        ${h.stats.map(s => `
          <div class="ccs-stat ccs-${s.cls}">
            <span class="ccs-ic">${s.icon}</span>
            <div class="ccs-text">
              <div class="ccs-lbl">${_esc(s.label)}</div>
              <div class="ccs-val">Rs. ${_esc(fc(s.value))}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    </div>`;

  const heroHtml = `
    <div class="cover-hero-row">
      ${heroCard(headline)}
      ${heroCard(pace)}
    </div>`;

  const managerHeroHtml = `
    <div class="cover-hero-row">
      ${heroCard(credits)}
    </div>`;

  const closingLatestSummary = _closingLatestSummary();
  const closingLatestCredit = _closingLatestCredit();
  const closingLatestMisc = _closingLatestMisc();
  const closingHeroHtml = `
    <div class="cover-hero-row cover-hero-row-single">
      ${closingSummaryCard(closingLatestSummary)}
    </div>
    <div class="cover-hero-row">
      ${heroCard(closingLatestCredit)}
      ${heroCard(closingLatestMisc)}
    </div>`;

  const invStats = _inventoryHeroStats();
  const invSl = invStats.slStats, invEw = invStats.ewSummary, invRr = invStats.rrSummary;
  let inventoryHeroHtml;
  try {
    inventoryHeroHtml = (invSl && invSl.dataReady) ? `
    <div class="cover-hero-row">
      ${heroCard({ label: 'Total Inventory Level', value: 'Rs. ' + fc(invSl.totalInventoryValue), sub: 'as of ' + invSl.asOf })}
      ${heroCard({ label: 'Negative Value', value: 'Rs. ' + fc(invSl.negativeValue), sub: 'negative qty × retail price' })}
      ${heroCard({ label: 'Never Sold (60D)', value: 'Rs. ' + fc(invSl.neverSold60Value), sub: '>60 days received, zero sales' })}
      ${heroCard({ label: 'Dead Stock (60D)', value: 'Rs. ' + fc(invSl.deadStock60Value), sub: 'quiet 60+ days' })}
    </div>
    <div class="cover-hero-row">
      ${heroCard({ label: 'Excess Stock Total', value: invEw ? 'Rs. ' + fc(invEw.rawExcessValue) : '—', sub: 'raw, before correction' })}
      ${heroCard({ label: 'Corrected Excess Stock', value: invEw ? 'Rs. ' + fc(invEw.correctedExcessValue) : '—', sub: 'after retain list + misc buffer' })}
      ${heroCard({ label: 'Reorder Alert (<7d cover · Top 500 by 30d value)', value: invRr ? fc(invRr.totalReorderQty) + ' units' : '—', sub: invRr ? invRr.itemsShown + ' items · Rs. ' + fc(invRr.totalReorderValue) + ' to reorder' : 'no data yet' })}
    </div>
    <div class="cover-hero-row cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:#33507D"></span>Inventory Health — right now</div>
        <div style="height:220px"><canvas id="cover-inventory-chart"></canvas></div>
      </div>
    </div>` : `
    <div class="cover-skel-row">
      <div class="cover-skel-card"></div><div class="cover-skel-card"></div>
      <div class="cover-skel-card"></div><div class="cover-skel-card"></div>
    </div>`;
  } catch (e) {
    console.error('Cover Dashboard: building Inventory hero HTML failed', e);
    inventoryHeroHtml = `
    <div class="cover-hero-row cover-hero-row-single">
      ${heroCard({ label: 'Inventory', value: 'Unavailable', sub: 'something went wrong reading Inventory stats — Sales/Manager/Closing are unaffected' })}
    </div>`;
  }

  const pins = _getPins();
  const collapsed = _getCollapsed();
  const tileCardHtml = (t, i) => `
    <div class="cover-tile${t.enabled ? '' : ' cover-tile-disabled'}"
         ${t.enabled ? `data-goto-idx="${i}" role="button" tabindex="0"` : ''}>
      <button class="cover-tile-pin${pins.includes(t.page || t.href) ? ' pinned' : ''}" data-pin-key="${_esc(t.page || t.href)}" title="Pin to shortcuts">📌</button>
      <div class="cover-tile-icon">${t.icon}</div>
      <div class="cover-tile-title">${_esc(t.title)}${t.href ? ' <span class="ext">↗</span>' : ''}</div>
      <div class="cover-tile-status">${_esc(t.status)}</div>
      ${t.bridgeAction ? `<button class="cover-tile-bridge" data-bridge-idx="${i}">Bridge</button>` : ''}
    </div>`;

  const GROUP_HERO = { Sales: heroHtml, Manager: managerHeroHtml, Closing: closingHeroHtml, Inventory: inventoryHeroHtml };
  const groupsHtml = GROUP_ORDER.map(groupName => {
    const members = tiles.map((t, i) => ({ t, i })).filter(x => x.t.group === groupName);
    if (!members.length) return '';
    const meta = GROUP_META[groupName] || { slug: 'sales', icon: '•' };
    const isCollapsed = collapsed.includes(meta.slug);
    return `
      <div class="cover-group${isCollapsed ? ' collapsed' : ''}" data-group="${meta.slug}">
        <div class="cover-group-header" data-group-toggle="${meta.slug}">
          <div class="cover-group-icon">${meta.icon}</div>
          <div class="cover-group-title">${_esc(groupName)}</div>
          <div class="cover-group-line"></div>
          <div class="cover-group-chevron">▾</div>
        </div>
        <div class="cover-group-body"><div>
          ${GROUP_HERO[groupName] || ''}
          ${groupName === 'Manager' ? '<div id="qa-panel-cover"></div>' : ''}
          <div class="cover-tile-grid">
            ${members.map(({ t, i }) => tileCardHtml(t, i)).join('')}
          </div>
        </div></div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
  _renderAttentionStrip();
  _renderPinsRow(tiles);
  _updateHeroDate();
  if (invSl && invSl.dataReady) _renderInventoryChart(invSl, invEw);
  if (document.getElementById('qa-panel-cover') && typeof window.renderQuickAdd === 'function') {
    window.renderQuickAdd('qa-panel-cover');
  }
  container.querySelectorAll('[data-pin-key]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.pinKey;
      let pinsNow = _getPins();
      if (pinsNow.includes(key)) pinsNow = pinsNow.filter(p => p !== key);
      else pinsNow = [...pinsNow, key];
      _setPins(pinsNow);
      renderCoverDashboard();
    });
  });
  container.querySelectorAll('[data-group-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const slug = header.dataset.groupToggle;
      const groupEl = header.closest('.cover-group');
      if (groupEl) groupEl.classList.toggle('collapsed');
      let coll = _getCollapsed();
      coll = (groupEl && groupEl.classList.contains('collapsed'))
        ? [...new Set([...coll, slug])]
        : coll.filter(s => s !== slug);
      _setCollapsed(coll);
    });
  });
  _wireCoverSearch(tiles);
  container.querySelectorAll('[data-goto-idx]').forEach(card => {
    const goTo = () => {
      const t = tiles[+card.dataset.gotoIdx];
      if (!t) return;
      if (t.href) window.open(t.href, '_blank', 'noopener');
      else if (t.page && typeof window.showPage === 'function') window.showPage(t.page);
    };
    card.addEventListener('click', goTo);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(); } });
  });
  container.querySelectorAll('[data-bridge-idx]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = tiles[+btn.dataset.bridgeIdx];
      if (t && typeof window[t.bridgeAction] === 'function') window[t.bridgeAction]();
    });
  });

  if (ClosingBridge.isConnected() && !_closingRefreshInFlight) {
    _closingRefreshInFlight = true;
    ClosingBridge.refresh(false).finally(() => { _closingRefreshInFlight = false; });
  }

  if (!_auditRefreshInFlight) {
    _auditRefreshInFlight = true;
    AuditBridge.refresh(false).finally(() => { _auditRefreshInFlight = false; });
  }

  if (!_inventoryRefreshInFlight) {
    _inventoryRefreshInFlight = true;
    InventoryBridge.refreshFullData(false).finally(() => { _inventoryRefreshInFlight = false; });
  }
}

window.renderCoverDashboard = renderCoverDashboard;
