// COVER DASHBOARD — Floor 5

import { MONTHLY, DAILY, STAFF, n, fc, ff, negR, mBanks, creditSales } from './config.js';
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
// Sales-by-weekday chart instance holder (see _renderWeekdayChart below) —
// same destroy-before-rebuild rule as _invChart above.
let _weekdayChart = null;
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
const TOPRUN_WINDOW_KEY = 'bt_cover_toprun_window_v1';
const TOPRUN_COUNT_KEY = 'bt_cover_toprun_count_v1';
const REORDER_THRESHOLD_KEY = 'bt_cover_reorder_threshold_v1';
const REORDER_WINDOW_KEY = 'bt_cover_reorder_window_v1';
function _getReorderThreshold() {
  const v = parseInt(Repository.getItem(REORDER_THRESHOLD_KEY), 10);
  return [7, 14, 30].indexOf(v) !== -1 ? v : 30;
}
function _setReorderThreshold(v) { try { Repository.setItem(REORDER_THRESHOLD_KEY, String(v)); } catch (e) {} }
function _getReorderWindow() {
  const v = parseInt(Repository.getItem(REORDER_WINDOW_KEY), 10);
  return [30, 60, 90].indexOf(v) !== -1 ? v : 60;
}
function _setReorderWindow(v) { try { Repository.setItem(REORDER_WINDOW_KEY, String(v)); } catch (e) {} }
function _getTopRunWindow() {
  const v = parseInt(Repository.getItem(TOPRUN_WINDOW_KEY), 10);
  return [30, 60, 90].indexOf(v) !== -1 ? v : 30;
}
function _setTopRunWindow(v) { try { Repository.setItem(TOPRUN_WINDOW_KEY, String(v)); } catch (e) {} }
function _getTopRunCount() {
  const v = parseInt(Repository.getItem(TOPRUN_COUNT_KEY), 10);
  return [10, 20].indexOf(v) !== -1 ? v : 10;
}
function _setTopRunCount(v) { try { Repository.setItem(TOPRUN_COUNT_KEY, String(v)); } catch (e) {} }
// Every group slug that exists today (must mirror GROUP_META's .slug values
// below). Used only to seed the very first render — once a user has
// expanded/collapsed anything, their real stored preference (even an empty
// array, meaning "everything expanded") always wins over this default.
const ALL_GROUP_SLUGS = ['sales', 'manager', 'notes', 'closing', 'audit', 'inventory', 'reports'];
function _getPins() { try { return JSON.parse(Repository.getItem(PIN_KEY) || '[]'); } catch (e) { return []; } }
function _setPins(arr) { try { Repository.setItem(PIN_KEY, JSON.stringify(arr)); } catch (e) {} }
function _getCollapsed() {
  try {
    const raw = Repository.getItem(COLLAPSE_KEY);
    if (raw == null) { _setCollapsed(ALL_GROUP_SLUGS); return ALL_GROUP_SLUGS.slice(); }
    return JSON.parse(raw || '[]');
  } catch (e) { return ALL_GROUP_SLUGS.slice(); }
}
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

  // Rule-Based Intelligence Plan §3.4: "Alert banner area fed by the
  // shared rule engine, one line per fired rule, click-through to the
  // relevant table." Appended after the checks above rather than
  // replacing them — those pre-date the rule engine (which didn't
  // exist as a working function until this pass; see rules-engine.js's
  // header) and cover slightly different ground (e.g. negative-value
  // stock isn't one of the registered rules). Both sets can coexist;
  // consolidating the older ones into registered rules is a clean
  // follow-up, not required for this banner to do its job today.
  try {
    if (typeof window.aimRulesCheckAll === 'function') {
      const fired = window.aimRulesCheckAll();
      const PAGE_BY_RULE = {
        'inventory.lowCoverValue': 'reorder',
        'inventory.excessItem': 'inventory',
        'inventory.deadStockAggregate': 'inventory',
        'manager.advanceExceedsSalary': 'manager',
        'manager.salarySwing': 'manager',
        'sales.diffTolerance': 'dashboard',
        'sales.paceAtRisk': 'dashboard',
      };
      const ICON_BY_SEVERITY = { red: '🔴', amber: '🟠', info: 'ℹ️' };
      fired.forEach(a => {
        const page = PAGE_BY_RULE[a.domain + '.' + a.id] || 'dashboard';
        // Strip the rule's own leading emoji (already has one per
        // rules-registrations.js) — the chip supplies its own severity
        // icon instead, keeping this strip visually consistent with
        // the hand-rolled chips above it.
        const text = String(a.msg || '').replace(/^\S+\s*/, '').replace(/<\/?b>/g, '');
        items.push({ icon: ICON_BY_SEVERITY[a.severity] || '🟠', text, cls: a.severity === 'red' ? 'red' : 'amber', page });
      });
    }
  } catch (e) { /* one broken domain's alerts must not blank the whole strip */ }

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

// Picks the chronologically-latest MONTHLY record — comparing by Month_Year
// itself rather than trusting array order, since MONTHLY can arrive from
// Supabase in whatever order it was last upserted in, not necessarily
// sorted. Used as a fallback when the current calendar month has no
// MONTHLY record yet (e.g. first entry of the month not saved yet).
function _latestMonthlyRecord() {
  if (!MONTHLY.length) return null;
  return MONTHLY.reduce((best, m) => {
    const [bn, by] = String(best.Month_Year || '').split(' ');
    const [mn, my] = String(m.Month_Year || '').split(' ');
    const bVal = (parseInt(by, 10) || 0) * 100 + MONTH_NAMES.indexOf(bn);
    const mVal = (parseInt(my, 10) || 0) * 100 + MONTH_NAMES.indexOf(mn);
    return mVal > bVal ? m : best;
  });
}

function _salesStatus() {
  if (!MONTHLY.length) return 'No sales data loaded yet';
  const my = _currentMonthYear();
  const rec = MONTHLY.find(m => m.Month_Year === my) || _latestMonthlyRecord();
  if (!rec) return 'No sales data loaded yet';
  const lastDay = _lastFilledDay(rec.Month_Year);
  const till = lastDay ? ' (till ' + lastDay + ' ' + rec.Month_Year.split(' ')[0].slice(0, 3) + ')' : '';
  return rec.Month_Year + till + ' · ₨' + fc(n(rec.TOTAL)) + ' so far';
}

// Breaks the latest month's TOTAL down into how it was actually collected —
// Cash, Banks, Cash & Banks combined, Credit Clients (including free issue),
// and customer footfall — for the hero card at the top of the Sales section.
// Mirrors _salesStatus()'s month-record fallback so it stays in sync with
// whichever month that status line is describing.
function _monthSaleBreakdown() {
  if (!MONTHLY.length) return null;
  const my = _currentMonthYear();
  const rec = MONTHLY.find(m => m.Month_Year === my) || _latestMonthlyRecord();
  if (!rec) return null;
  const cash = n(rec['Cash Sale']) + negR(rec['Cash Returns']);
  const banks = mBanks(rec);
  const cashBanks = cash + banks;
  const credit = creditSales(rec) + n(rec['F/Issue']);
  const customers = n(rec['Customers']);
  const lastDay = _lastFilledDay(rec.Month_Year);
  const label = 'Latest Month Total Sale — ' + rec.Month_Year +
    (lastDay ? ' (till ' + lastDay + ' ' + rec.Month_Year.split(' ')[0].slice(0, 3) + ')' : '');
  return { label, value: '₨' + fc(n(rec.TOTAL)), cash, banks, cashBanks, credit, customers };
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
    // Staff Credit specifically needs its own latest-month lookup, not
    // latestManagerMonth() — that one also counts Salary/Generic/Petty/
    // Incentive activity, any of which can exist for the new month
    // already while Staff Credit itself is still empty (its own
    // "Copy -> Next Month" rollover lags the calendar by ~10-12 days).
    // See analytics.js's latestStaffCreditMonth() header for the full
    // reasoning — same fix applied on the Manager Dashboard side.
    const my = (typeof A.latestStaffCreditMonth === 'function' && A.latestStaffCreditMonth())
      || A.latestManagerMonth();
    const data = A.getCreditSectionData(my);
    const v = data.grandTotal;
    const sign = v < 0 ? '−' : '';
    return {
      label: 'Total Outstanding Credits',
      value: sign + '₨' + fc(Math.abs(v)),
      sub: 'Staff (' + (my || '—') + ') + Jazz Cash + Patty/Expenses + Misc Sections, all-time',
    };
  } catch (e) {
    return { label: 'Total Outstanding Credits', value: 'Unavailable', sub: '' };
  }
}

// ── Manager dashboard extras (Rule-Based Intelligence Plan §3.3) ──────
// Ranked Staff Credit table, Salary trend + swing flags, Advance aging —
// built into the Manager group's existing hero section, same reasoning
// as the Inventory extras above (Cover's group sections already ARE
// this app's per-domain dashboard; a separate route would duplicate it).

function _currentMgrMonthYear() {
  const d = new Date();
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return MN[d.getMonth()] + ' ' + d.getFullYear();
}

// "Staff Credit Ledger, ranked" — cross-staff, sorted by net descending,
// directly answering "who owes the most" (plan §3.3) without narration.
//
// Deliberately does NOT use _currentMgrMonthYear() (today's literal
// calendar month) as its month — same reasoning as _totalOutstandingCredits()
// and dashboard.js's _dashDefaultCreditMonth(): Staff Credit's own
// "Copy -> Next Month" rollover lags the calendar by ~10-12 days (salaries
// settled on the 10th-12th), so on day 1 of a new month this widget would
// read an empty month and wrongly claim "No outstanding credit this
// month" even though last month's balances are still genuinely owed.
// Uses Analytics.latestStaffCreditMonth() (credit-bucket-only, not the
// broader latestManagerMonth() which also counts Salary/Generic/Petty/
// Incentive activity — see that function's own header in analytics.js),
// falling back to the literal current month only if there's no credit
// data anywhere yet.
function _managerCreditRanked() {
  try {
    if (typeof window._crdData !== 'function' || typeof window._crdNet !== 'function') return [];
    const A = window.Analytics;
    const my = (A && typeof A.latestStaffCreditMonth === 'function' && A.latestStaffCreditMonth())
      || _currentMgrMonthYear();
    const emps = window._crdData(my) || [];
    return emps
      .map(e => ({ name: e.name, net: window._crdNet(e) }))
      .filter(e => e.net !== 0)
      .sort((a, b) => b.net - a.net);
  } catch (e) { console.error('Cover Dashboard: _managerCreditRanked failed', e); return []; }
}

// Salary trend, last 6 months side by side per staff, with a swing flag
// on any month-over-month move beyond SALARY_SWING_PCT — same threshold
// as rules-registrations.js's manager.salarySwing rule, so the flag here
// and the alert on Cover's attention strip always agree.
function _managerCreditRankedHtml() {
  const rows = _managerCreditRanked().slice(0, 8);
  if (!rows.length) return `<div style="font-size:11px;color:var(--muted);padding:8px 0">No outstanding credit this month.</div>`;
  return rows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="showPage('manager')">
      <span style="font-size:11.5px;color:var(--text);font-weight:600">${_esc(r.name)}</span>
      <span style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:${r.net > 0 ? '#AE3B2C' : '#15803d'}">₨${fc(Math.abs(r.net))}</span>
    </div>`).join('');
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

// Most-recently-updated pinned note, for the Notes & Sheets group subtitle.
// Reads the same bt_notes_v1 list notes-sheets.js itself owns (.pinned flag
// toggled by its own _nsTogglePin) — no separate pin store, so it can never
// drift from what the Notes page actually shows as pinned.
function _pinnedNoteSubtitle() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const pinned = notes.filter(n => n && n.pinned);
    if (!pinned.length) return 'No pinned note';
    const top = pinned.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
    const text = (top.title && top.title.trim()) || (top.body || '').trim() || 'Untitled note';
    const snippet = text.length > 46 ? text.slice(0, 46).trim() + '…' : text;
    return '📌 ' + snippet;
  } catch (e) {
    return '';
  }
}

// Up to 3 notes for the Notes & Sheets group's own hero preview — pinned
// notes first (most-recently-updated first among those), then filled out
// with the most-recently-updated remaining notes. Same bt_notes_v1 list
// as _pinnedNoteSubtitle above, so it can never drift from the real Notes
// page.
function _noteTiles() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    if (!notes.length) return [];
    const byRecency = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    const pinned = notes.filter(n => n && n.pinned).sort(byRecency);
    const rest = notes.filter(n => n && !n.pinned).sort(byRecency);
    return pinned.concat(rest).slice(0, 3);
  } catch (e) { return []; }
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
function _renderWeekdayChart() {
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

  _weekdayChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: WD, datasets: [{ label: 'Total sales', data: sums, backgroundColor: 'rgba(217,119,6,.65)', borderColor: '#d97706', borderWidth: 1.5, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => '₨' + fc(c.raw) + ' across ' + counts[c.dataIndex] + ' day' + (counts[c.dataIndex] === 1 ? '' : 's') + ' entered' } },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#f1f5f9' } },
        y: { ticks: { color: '#64748b', font: { size: 9 }, callback: v => '₨' + ff(v) }, grid: { color: '#e2e8f0' } },
      },
    },
  });
}

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
function _reorderUrgentStats() {
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
function _excessStockRows() {
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
function _inventoryMiniTableHtml(rows, kind) {
  if (!rows || !rows.length) {
    return `<div style="font-size:11px;color:var(--muted);padding:8px 0">No items to show right now.</div>`;
  }
  const row = r => {
    if (kind === 'reorder') {
      const cover = r.daysCoverP != null ? r.daysCoverP.toFixed(1) + 'd' : '—';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="showPage('reorder')">
          <div style="min-width:0">
            <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px">${_esc(r.name || r.code)}</div>
            <div style="font-size:10px;color:var(--muted)">${cover} cover · reorder ${fc(r.demandQtyP)} units</div>
            <div style="font-size:10px;color:var(--muted)">sold 30d: ${fc(r.saleQty30)} units · Rs. ${fc(r.saleValue30)}</div>
          </div>
          <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:#AE3B2C;flex-shrink:0">Rs. ${fc(r.demandValueP)}</div>
        </div>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="showPage('excess')">
        <div style="min-width:0">
          <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px">${_esc(r.name)}</div>
          <div style="font-size:10px;color:var(--muted)">${_esc(r.company || 'Unspecified')}${r.daysOld != null ? ' · ' + r.daysOld + 'd old' : ''}</div>
        </div>
        <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:#A8762A;flex-shrink:0">Rs. ${fc(r.excessContribution)}</div>
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
        <span style="font-size:10px;color:var(--muted);width:16px;flex-shrink:0">${i + 1}</span>
        <div style="min-width:0">
          <div style="font-size:11.5px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px">${_esc(r.name || r.code)}</div>
          <div style="font-size:10px;color:var(--muted)">${fc(r.saleQtyP)} units sold</div>
        </div>
      </div>
      <div style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:#33507D;flex-shrink:0">Rs. ${fc(r.saleValueP)}</div>
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

function _reorderNowCardInnerHtml() {
  const th = _getReorderThreshold();
  const win = _getReorderWindow();
  const rows = _reorderNowRows();
  const totalFlagged = _reorderTotalFlagged();
  const pill = (active, label, onclick) => `<span onclick="${onclick}" style="cursor:pointer;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:4px;${active ? 'background:#AE3B2C;color:#fff' : 'background:#e2e8f0;color:#475569'}">${label}</span>`;
  return `
    <div class="ctitle" style="flex-wrap:wrap;row-gap:6px">
      <span class="cdot" style="background:#AE3B2C"></span>Reorder Now — most urgent (${rows.length} of ${totalFlagged} flagged)
      <span style="margin-left:auto;display:flex;align-items:center">${pill(win === 30, '30D', '_coverSetReorderWindow(30)')}${pill(win === 60, '60D', '_coverSetReorderWindow(60)')}${pill(win === 90, '90D', '_coverSetReorderWindow(90)')}</span>
      <span style="display:flex;align-items:center">${pill(th === 7, '<7D', '_coverSetReorderThreshold(7)')}${pill(th === 14, '<14D', '_coverSetReorderThreshold(14)')}${pill(th === 30, '<30D', '_coverSetReorderThreshold(30)')}</span>
      <span onclick="showPage('reorder')" style="font-size:9px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;margin-left:6px;cursor:pointer;font-weight:700">FULL REPORT ↗</span>
    </div>
    <div id="cover-reorder-now-table">${_inventoryMiniTableHtml(rows, 'reorder')}</div>`;
}

function _renderReorderNowCard() {
  const card = document.getElementById('cover-reorder-now-card');
  if (card) card.innerHTML = _reorderNowCardInnerHtml();
}

function _topRunningCardInnerHtml() {
  const win = _getTopRunWindow();
  const cnt = _getTopRunCount();
  const pill = (active, label, onclick) => `<span onclick="${onclick}" style="cursor:pointer;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;${active ? 'background:#33507D;color:#fff' : 'background:#e2e8f0;color:#475569'}">${label}</span>`;
  return `
    <div class="ctitle" style="flex-wrap:wrap;row-gap:6px">
      <span class="cdot" style="background:#33507D"></span>Top Running Items — value-wise
      <span style="margin-left:auto;display:flex;align-items:center">${pill(cnt === 10, 'Top 10', '_coverSetTopRunCount(10)')}${pill(cnt === 20, 'Top 20', '_coverSetTopRunCount(20)')}</span>
      <span style="display:flex;align-items:center">${pill(win === 30, '30D', '_coverSetTopRunWindow(30)')}${pill(win === 60, '60D', '_coverSetTopRunWindow(60)')}${pill(win === 90, '90D', '_coverSetTopRunWindow(90)')}</span>
    </div>
    <div id="cover-top-running-table">${_topRunningTableHtml(_topRunningRows())}</div>`;
}

function _renderTopRunningCard() {
  const card = document.getElementById('cover-top-running-card');
  if (card) card.innerHTML = _topRunningCardInnerHtml();
}

// ── Staff Registry strip (Manager group) ──────────────────────────────
// Replaces the old Quick Add panel on the cover page. Shows every active
// employee as a small horizontally-scrollable card; tapping one opens the
// same Staff Card modal used by Manager → Staff Registry (openStaffCard,
// from manager-staff.js — index must match the live STAFF array, so we
// carry origIdx through the sort exactly like activeStaff() does there).
function _staffRegistryHtml() {
  const active = STAFF.map((emp, i) => ({ emp, i }))
    .filter(({ emp }) => emp && emp.active !== false)
    .sort((a, b) => (Number(a.emp.srNum) || 999) - (Number(b.emp.srNum) || 999));
  if (!active.length) {
    return `
    <div class="cover-staff-strip-title">👥 Staff Registry</div>
    <div class="cover-staff-empty">No staff yet — add employees in Manager → Staff Registry.</div>`;
  }
  const initials = name => (String(name || '?').trim().match(/\S+/g) || ['?'])
    .slice(0, 2).map(w => w[0].toUpperCase()).join('');
  return `
    <div class="cover-staff-strip-title">👥 Staff Registry <span class="cover-staff-count">${active.length}</span></div>
    <div class="cover-staff-strip" id="cover-staff-strip">
      ${active.map(({ emp, i }) => {
        const sid = emp.staffId || ('EMP-' + String(i + 1).padStart(3, '0'));
        return `
        <div class="cover-staff-card" data-staff-idx="${i}" role="button" tabindex="0" title="Open Staff Card">
          <div class="cover-staff-avatar">${_esc(initials(emp.name))}</div>
          <div class="cover-staff-name">${_esc(emp.name || '(unnamed)')}</div>
          <div class="cover-staff-desig">${_esc(emp.designation || '—')}</div>
          <div class="cover-staff-id">${_esc(sid)}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// One-line, live "what's inside" teaser shown under each group's title in
// the collapsed header — so a collapsed section still tells you something
// real instead of just a label. Every branch re-reads the same helper the
// section's own hero card already uses, so the collapsed teaser can never
// show a different number than what you'd see on expanding it.
function _groupSubtitle(groupName) {
  try {
    switch (groupName) {
      case 'Sales': {
        const p = _targetPace();
        return p.value + (p.sub ? ' · ' + p.sub : '');
      }
      case 'Manager': {
        const c = _totalOutstandingCredits();
        return c.value + ' outstanding credit';
      }
      case 'Notes & Sheets':
        return _pinnedNoteSubtitle();
      case 'Closing': {
        const s = _closingLatestSummary();
        return s.value + (s.sub ? ' · ' + s.sub : '');
      }
      case 'Audit':
        return _auditStatus();
      case 'Inventory': {
        const { slStats } = _inventoryHeroStats();
        if (!slStats || !slStats.dataReady) return 'Syncing inventory…';
        return 'Rs. ' + fc(slStats.totalInventoryValue) + ' total · Rs. ' + fc(slStats.negativeValue) + ' negative';
      }
      case 'Reports':
        return '3 reports — Daily Check List · Excess Stock Control · Branch Invoice Desk';
      default:
        return '';
    }
  } catch (e) {
    console.error('Cover Dashboard: _groupSubtitle(' + groupName + ') failed', e);
    return '';
  }
}

function _tiles() {
  return [
    { page: 'dashboard', icon: '📊', title: 'Sales',           status: _salesStatus(),   enabled: true, group: 'Sales' },
    { page: 'manager',   icon: '👔', title: 'Manager',          status: _managerStatus(), enabled: true, group: 'Manager' },
    { page: 'pdf-library', icon: '📚', title: 'PDF Library', status: 'Every generated report, cross-device, search + category filter', enabled: true, group: 'Quick Access' },
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
    { page: 'purchase-order', icon: '🧾', title: 'Purchase Order', status: 'Schedule-driven buy list — Top N per supplier at the 30/60/90d level', enabled: true, group: 'Inventory' },
    { href: 'https://reports.duapharma.com/daily_report.html', icon: '✅', title: 'Daily Check List', status: 'Fazal Din\'s Pharma Plus — standalone checklist app', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/excess-stock-control.html', icon: '📦', title: 'Excess Stock Control', status: 'Fazal Din\'s Pharma Plus — excess stock control', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/invoice-desk.html', icon: '🧮', title: 'Branch Invoice Desk', status: 'Fazal Din\'s Pharma Plus — branch invoice desk', enabled: true, group: 'Reports' },
  ];
}

// Ordered by decision-urgency, not by module — things that need action
// today (stock problems, cash/credit) come before performance tracking,
// which comes before compliance, which comes before pure navigation/
// reference material. The "Needs Attention" strip above still surfaces
// the single most urgent items regardless of this order; this just makes
// the full scroll match the same priority.
// "Quick Access" (PDF Library) was dropped entirely — it had no hero
// content of its own, just a single shortcut tile, which Cover no longer
// renders; PDF Library still lives in the bottom nav / All Sections menu.
const GROUP_ORDER = ['Inventory', 'Manager', 'Closing', 'Sales', 'Reports', 'Notes & Sheets', 'Audit'];
const GROUP_META = {
  'Sales':           { slug: 'sales',   icon: '📊' },
  'Manager':         { slug: 'manager', icon: '👔' },
  'Notes & Sheets':  { slug: 'notes',   icon: '📑' },
  'Closing':         { slug: 'closing', icon: '🔒' },
  'Audit':           { slug: 'audit',   icon: '🧾' },
  'Inventory':       { slug: 'inventory', icon: '📦' },
  'Reports':         { slug: 'reports', icon: '📚' },
};

// Custom drag-to-reorder position for Cover's own dashboard groups (the
// big Inventory/Manager/Closing/Sales/Audit/... cards) — separate from
// COLLAPSE_KEY (open/closed) and PIN_KEY (shortcut tiles), same
// mirrored getter/setter/Repository pattern as both of those.
const ORDER_KEY = 'bt_cover_order_v1';
// One-time flag: Audit and Reports swapped priority, and Quick Access was
// retired (July 2026). Devices that already have a saved drag-order from
// before that change need a single migration pass — see _getOrder below —
// rather than a blanket reset, so any other custom position someone has
// already dragged into place (e.g. Manager ahead of Inventory) is left
// exactly as they set it.
const ORDER_MIGRATION_KEY = 'bt_cover_order_migrated_v2';
function _defaultOrderSlugs() { return GROUP_ORDER.map(name => (GROUP_META[name] || {}).slug).filter(Boolean); }
function _getOrder() {
  try {
    const raw = Repository.getItem(ORDER_KEY);
    let saved = raw == null ? _defaultOrderSlugs() : JSON.parse(raw || '[]');
    // A group that's shipped since this was last saved won't be in the
    // saved array — append it at the end rather than dropping it
    // silently, same "never lose a group" reasoning as _getCollapsed's
    // ALL_GROUP_SLUGS seeding above. A group that's since been retired
    // (e.g. Quick Access) is the mirror case — drop it so it doesn't
    // linger forever in a saved order it can no longer resolve back to
    // a name (_orderedGroupNames already filters it, this just keeps
    // what gets re-saved clean too).
    const defaults = _defaultOrderSlugs();
    const known = new Set(saved);
    defaults.forEach(slug => { if (!known.has(slug)) saved.push(slug); });
    saved = saved.filter(slug => defaults.includes(slug));

    if (!Repository.getItem(ORDER_MIGRATION_KEY)) {
      const ai = saved.indexOf('audit'), ri = saved.indexOf('reports');
      if (ai !== -1 && ri !== -1 && ai < ri) { const tmp = saved[ai]; saved[ai] = saved[ri]; saved[ri] = tmp; }
      Repository.setItem(ORDER_MIGRATION_KEY, '1');
      _setOrder(saved);
    }
    return saved;
  } catch (e) { return _defaultOrderSlugs(); }
}
function _setOrder(arr) { try { Repository.setItem(ORDER_KEY, JSON.stringify(arr)); } catch (e) {} }
// Resolves the saved slug order back to group names for renderCoverDashboard's
// own iteration — GROUP_ORDER itself is left untouched as the permanent
// "this is the full known set" default/reconciliation source, same role
// ALL_GROUP_SLUGS plays for collapse state.
function _orderedGroupNames() {
  const order = _getOrder();
  const bySlug = {};
  Object.keys(GROUP_META).forEach(name => { bySlug[GROUP_META[name].slug] = name; });
  const names = order.map(slug => bySlug[slug]).filter(Boolean);
  GROUP_ORDER.forEach(name => { if (!names.includes(name)) names.push(name); }); // defensive; _getOrder already reconciles this
  return names;
}

// Drag-to-reorder for .cover-group cards — grabbed only via the small
// ⠿ handle in each header (not the whole header, which still needs to
// toggle collapse/expand on a plain tap). Pointer events cover mouse +
// touch in one code path; touch-action:none on the handle (css) stops
// the page from also trying to scroll underneath a touch-drag.
function _wireGroupDragReorder() {
  const container = document.getElementById('cover-container');
  if (!container) return;
  const allGroups = () => Array.from(container.querySelectorAll(':scope > .cover-group'));

  container.querySelectorAll('[data-drag-handle]').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const groupEl = handle.closest('.cover-group');
      if (!groupEl) return;
      groupEl.classList.add('dragging');
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (_) {} }

      const onMove = (ev) => {
        const y = ev.clientY;
        let target = null;
        for (const sib of allGroups()) {
          if (sib === groupEl) continue;
          const r = sib.getBoundingClientRect();
          if (y < r.top + r.height / 2) { target = sib; break; }
        }
        if (target) container.insertBefore(groupEl, target);
        else container.appendChild(groupEl);
      };
      const onUp = () => {
        groupEl.classList.remove('dragging');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        _setOrder(allGroups().map(g => g.dataset.group).filter(Boolean));
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
  });
}

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

// Every group slug currently rendered on the page — read live from the DOM
// rather than ALL_GROUP_SLUGS so the toggle only ever affects groups that
// actually exist for this user (no dangling slugs from removed groups).
function _renderedGroupSlugs() {
  return Array.from(document.querySelectorAll('#cover-container .cover-group'))
    .map(el => el.dataset.group)
    .filter(Boolean);
}

function _updateCollapseToggleLabel() {
  const btn = document.getElementById('cover-collapse-toggle');
  if (!btn) return;
  const slugs = _renderedGroupSlugs();
  const collapsed = _getCollapsed();
  const allCollapsed = slugs.length > 0 && slugs.every(s => collapsed.includes(s));
  btn.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
}

function _wireCollapseToggle() {
  const btn = document.getElementById('cover-collapse-toggle');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const slugs = _renderedGroupSlugs();
    const collapsed = _getCollapsed();
    const allCollapsed = slugs.length > 0 && slugs.every(s => collapsed.includes(s));
    _setCollapsed(allCollapsed ? [] : slugs.slice());
    renderCoverDashboard();
  });
}

// ── KPI header row ─────────────────────────────────────────────────────
// The four numbers that actually drive today's decisions, in one glance
// row above everything else: are we on pace, is cash/credit under
// control, is inventory healthy, does anything need reordering. Each
// tile is tappable straight through to the page that explains it. Reuses
// the exact same helpers the hero cards below already call — no second
// derivation of any figure, so this row can never disagree with the
// detail underneath it.
function _kpiTiles() {
  const out = [];

  try {
    const pace = _targetPace();
    const m = /^(-?\d+)% of target$/.exec(pace.value || '');
    const pct = m ? parseInt(m[1], 10) : null;
    out.push({
      icon: '📊', label: 'Sales vs Target',
      value: pct == null ? '—' : pct + '%',
      cls: pct == null ? 'neutral' : (pct >= 95 ? 'green' : pct >= 75 ? 'amber' : 'red'),
      page: 'dashboard',
    });
  } catch (e) { out.push({ icon: '📊', label: 'Sales vs Target', value: '—', cls: 'neutral', page: 'dashboard' }); }

  try {
    const credits = _totalOutstandingCredits();
    const v = parseFloat(String(credits.value || '').replace(/[^0-9.-]/g, ''));
    out.push({
      icon: '💳', label: 'Outstanding Credit',
      value: isNaN(v) ? '—' : 'Rs. ' + fc(v),
      cls: isNaN(v) ? 'neutral' : (v <= 0 ? 'green' : v < 50000 ? 'amber' : 'red'),
      page: 'manager',
    });
  } catch (e) { out.push({ icon: '💳', label: 'Outstanding Credit', value: '—', cls: 'neutral', page: 'manager' }); }

  try {
    const { slStats, ewSummary } = _inventoryHeroStats();
    if (slStats && slStats.dataReady) {
      const health = computeInventoryHealth({
        totalInventoryValue:  slStats.totalInventoryValue,
        neverSold60Value:     slStats.neverSold60Value,
        deadStock60Value:     slStats.deadStock60Value,
        correctedExcessValue: ewSummary ? ewSummary.correctedExcessValue : 0,
      });
      out.push({
        icon: '📦', label: 'Inventory Health',
        value: health.pctHealthy + '%',
        cls: health.pctHealthy >= 90 ? 'green' : health.pctHealthy >= 75 ? 'amber' : 'red',
        page: 'inventory',
      });
    } else {
      out.push({ icon: '📦', label: 'Inventory Health', value: '—', cls: 'neutral', page: 'inventory' });
    }
  } catch (e) { out.push({ icon: '📦', label: 'Inventory Health', value: '—', cls: 'neutral', page: 'inventory' }); }

  try {
    const { rrSummary } = _inventoryHeroStats();
    const items = rrSummary ? n(rrSummary.itemsShown) : null;
    const urgent = rrSummary ? _reorderUrgentStats() : null;
    out.push({
      icon: '🛒', label: 'Items to Reorder',
      value: items == null ? '—' : String(items),
      sub: urgent && urgent.urgentCount > 0 ? `${urgent.urgentCount} <7d cover (${urgent.zeroStock} stockout)` : '',
      cls: items == null ? 'neutral' : (items === 0 ? 'green' : items < 100 ? 'amber' : 'red'),
      page: 'reorder',
    });
  } catch (e) { out.push({ icon: '🛒', label: 'Items to Reorder', value: '—', cls: 'neutral', page: 'reorder' }); }

  return out;
}

function _renderKpiRow() {
  const el = document.getElementById('cover-kpi-row');
  if (!el) return;
  const tiles = _kpiTiles();
  el.innerHTML = tiles.map((t, i) => `
    <div class="cover-kpi-tile cls-${t.cls}" data-kpi-idx="${i}" role="button" tabindex="0">
      <div class="cover-kpi-icon">${t.icon}</div>
      <div class="cover-kpi-value">${_esc(t.value)}</div>
      <div class="cover-kpi-label">${_esc(t.label)}</div>
      ${t.sub ? `<div class="cover-kpi-sub">${_esc(t.sub)}</div>` : ''}
    </div>`).join('');
  el.querySelectorAll('[data-kpi-idx]').forEach(tile => {
    const goTo = () => {
      const t = tiles[+tile.dataset.kpiIdx];
      if (t && t.page && typeof window.showPage === 'function') window.showPage(t.page);
    };
    tile.addEventListener('click', goTo);
    tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(); } });
  });
}

function _wireCoverSearch() {
  const input = document.getElementById('cover-search');
  if (!input || input.dataset.wired) return;
  input.dataset.wired = '1';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('#cover-container .cover-group').forEach(groupEl => {
      const title = (groupEl.querySelector('.cover-group-title')?.textContent || '').toLowerCase();
      const subtitle = (groupEl.querySelector('.cover-group-subtitle')?.textContent || '').toLowerCase();
      let match = !q || title.includes(q) || subtitle.includes(q);

      // Audit/Reports still have real tiles (see TILE_GRID_GROUPS) — also
      // match/highlight against each tile's own title+status, same as
      // every group used to before the rest went hero-only.
      const tileEls = groupEl.querySelectorAll('.cover-tile');
      if (tileEls.length) {
        let anyTileVisible = false;
        tileEls.forEach(tileEl => {
          const tTitle = (tileEl.querySelector('.cover-tile-title')?.textContent || '').toLowerCase();
          const tStatus = (tileEl.querySelector('.cover-tile-status')?.textContent || '').toLowerCase();
          const tMatch = !q || tTitle.includes(q) || tStatus.includes(q);
          tileEl.classList.toggle('cover-tile-hidden', !tMatch);
          tileEl.classList.toggle('cover-tile-match', !!q && tMatch);
          if (tMatch) anyTileVisible = true;
        });
        match = match || anyTileVisible;
      }

      groupEl.classList.toggle('cover-group-hidden', !!q && !match);
      if (q && match) groupEl.classList.remove('collapsed');
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

  const monthSale = _monthSaleBreakdown();
  const monthSaleCard = h => `
    <div class="cover-hero-card cover-closing-summary-card cover-month-sale-card">
      <div class="cover-hero-label">${_esc(h.label)}</div>
      <div class="cover-hero-value">${_esc(h.value)}</div>
      <div class="ccs-stat-grid">
        <div class="ccs-stat ccs-cash">
          <span class="ccs-ic">💵</span>
          <div class="ccs-text"><div class="ccs-lbl">Cash</div><div class="ccs-val">Rs. ${_esc(fc(h.cash))}</div></div>
        </div>
        <div class="ccs-stat ccs-bank">
          <span class="ccs-ic">🏦</span>
          <div class="ccs-text"><div class="ccs-lbl">Banks</div><div class="ccs-val">Rs. ${_esc(fc(h.banks))}</div></div>
        </div>
        <div class="ccs-stat ccs-cashbank">
          <span class="ccs-ic">💰</span>
          <div class="ccs-text"><div class="ccs-lbl">Cash &amp; Banks</div><div class="ccs-val">Rs. ${_esc(fc(h.cashBanks))}</div></div>
        </div>
        <div class="ccs-stat ccs-credit">
          <span class="ccs-ic">📋</span>
          <div class="ccs-text"><div class="ccs-lbl">Credit Clients (incl. free issue)</div><div class="ccs-val">Rs. ${_esc(fc(h.credit))}</div></div>
        </div>
        <div class="ccs-stat ccs-cust">
          <span class="ccs-ic">👥</span>
          <div class="ccs-text"><div class="ccs-lbl">Customers</div><div class="ccs-val">${_esc(fc(h.customers))}</div></div>
        </div>
      </div>
    </div>`;

  const heroHtml = `
    ${monthSale ? `<div class="cover-hero-row-single">${monthSaleCard(monthSale)}</div>` : ''}
    <div class="cover-hero-row">
      ${heroCard(headline)}
      ${heroCard(pace)}
    </div>
    <div class="cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:#d97706"></span>Sales by Weekday — ${_esc(_currentMonthYear())}</div>
        <div style="height:200px"><canvas id="cover-weekday-chart"></canvas></div>
      </div>
    </div>`;

  const managerHeroHtml = `
    <div class="cover-hero-row">
      ${heroCard(credits)}
    </div>
    <div class="cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:#AE3B2C"></span>Staff Credit — ranked, who owes the most
          <span onclick="showPage('manager')" style="font-size:9px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;margin-left:6px;cursor:pointer;font-weight:700">OPEN ↗</span>
        </div>
        <div id="cover-credit-ranked-table">${_managerCreditRankedHtml()}</div>
      </div>
    </div>`;

  const noteTiles = _noteTiles();
  const noteHeroCard = nt => {
    const text = (nt.title && nt.title.trim()) || (nt.body || '').trim() || 'Untitled note';
    const snippet = text.length > 60 ? text.slice(0, 60).trim() + '…' : text;
    const when = nt.updatedAt ? new Date(nt.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    return `
      <div class="cover-hero-card" data-note-goto="${_esc(nt.id || '')}" role="button" tabindex="0" style="cursor:pointer">
        <div class="cover-hero-label">${nt.pinned ? '📌 Pinned Note' : '📝 Recent Note'}</div>
        <div class="cover-hero-value" style="font-size:14.5px;font-family:inherit;font-weight:600;line-height:1.35;margin-top:6px">${_esc(snippet)}</div>
        ${when ? `<div class="cover-hero-sub">${_esc(when)}</div>` : ''}
      </div>`;
  };
  const notesHeroHtml = noteTiles.length ? `
    <div class="cover-hero-row">
      ${noteTiles.map(noteHeroCard).join('')}
    </div>` : '';

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
    <div class="cover-hero-row cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:#33507D"></span>Inventory Health — right now</div>
        <div style="height:220px"><canvas id="cover-inventory-chart"></canvas></div>
      </div>
    </div>
    <div class="cover-hero-row">
      ${heroCard({ label: 'Total Inventory Level', value: 'Rs. ' + fc(invSl.totalInventoryValue), sub: 'as of ' + invSl.asOf })}
      ${heroCard({ label: 'Negative Value', value: 'Rs. ' + fc(invSl.negativeValue), sub: 'negative qty × retail price' })}
      ${heroCard({ label: 'Never Sold (60D)', value: 'Rs. ' + fc(invSl.neverSold60Value), sub: '>60 days received, zero sales' })}
      ${heroCard({ label: 'Dead Stock (60D)', value: 'Rs. ' + fc(invSl.deadStock60Value), sub: 'quiet 60+ days' })}
    </div>
    <div class="cover-hero-row">
      ${heroCard({ label: 'Excess Stock Total', value: invEw ? 'Rs. ' + fc(invEw.rawExcessValue) : '—', sub: 'raw, before correction' })}
      ${heroCard({ label: 'Corrected Excess Stock', value: invEw ? 'Rs. ' + fc(invEw.correctedExcessValue) : '—', sub: 'after retain list + misc buffer' })}
      ${(() => {
        const u = invRr ? _reorderUrgentStats() : null;
        return heroCard({
          label: 'Reorder Alert (<30d cover · Top 500 by 60d value)',
          value: u ? u.urgentCount + ' items <7d cover' : '—',
          sub: u ? `${u.zeroStock} stockout now · ${u.critical} still stocked, <7d left · ${invRr.itemsShown} items <30d total · Rs. ${fc(invRr.totalReorderValue)} to reorder` : 'no data yet',
        });
      })()}
    </div>
    <div class="cover-hero-row">
      <div class="card" id="cover-reorder-now-card">
        ${_reorderNowCardInnerHtml()}
      </div>
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:#A8762A"></span>Excess Stock — highest value
          <span onclick="showPage('excess')" style="font-size:9px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:4px;margin-left:6px;cursor:pointer;font-weight:700">FULL REPORT ↗</span>
        </div>
        <div id="cover-excess-stock-table">${_inventoryMiniTableHtml(_excessStockRows(), 'excess')}</div>
      </div>
    </div>
    <div class="cover-hero-row cover-hero-row-single">
      <div class="card" id="cover-top-running-card">
        ${_topRunningCardInnerHtml()}
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

  const collapsed = _getCollapsed();
  const pins = _getPins();

  // Every group card still leads with its own live header (icon, title,
  // one-line status, drag-to-reorder) exactly as before. Sections with
  // real hero content (Sales/Manager/Closing/Inventory/Notes & Sheets)
  // stay hero-only, no page tiles. Audit and Reports have no hero
  // content of their own yet, so — per request — they keep their old
  // tile-grid (page/external links) exactly as it was before; every
  // other group had its tile-grid removed in favor of the glance-only
  // hero treatment.
  const TILE_GRID_GROUPS = new Set(['Audit', 'Reports']);
  const tileCardHtml = (t, i) => `
    <div class="cover-tile${t.enabled ? '' : ' cover-tile-disabled'}"
         ${t.enabled ? `data-goto-idx="${i}" role="button" tabindex="0"` : ''}>
      <button class="cover-tile-pin${pins.includes(t.page || t.href) ? ' pinned' : ''}" data-pin-key="${_esc(t.page || t.href)}" title="Pin to shortcuts">📌</button>
      <div class="cover-tile-icon">${t.icon}</div>
      <div class="cover-tile-title">${_esc(t.title)}${t.href ? ' <span class="ext">↗</span>' : ''}</div>
      <div class="cover-tile-status">${_esc(t.status)}</div>
      ${t.bridgeAction ? `<button class="cover-tile-bridge" data-bridge-idx="${i}">Bridge</button>` : ''}
    </div>`;

  const GROUP_HERO = { Sales: heroHtml, Manager: managerHeroHtml, Closing: closingHeroHtml, Inventory: inventoryHeroHtml, 'Notes & Sheets': notesHeroHtml };
  // New home for the old per-tile "Bridge" button: one ↻ on each
  // bridge-backed group's own header, force-refreshing past the normal
  // 5-min cache — available regardless of whether that group's body is
  // collapsed, instead of being buried inside a tile that no longer exists.
  const GROUP_BRIDGE_REFRESH = {
    Closing: () => ClosingBridge.refresh(true),
    Audit: () => AuditBridge.refresh(true),
    Inventory: () => InventoryBridge.refreshFullData(true),
  };
  const groupsHtml = _orderedGroupNames().map(groupName => {
    const members = tiles.map((t, i) => ({ t, i })).filter(x => x.t.group === groupName);
    if (!members.length) return '';
    const meta = GROUP_META[groupName] || { slug: 'sales', icon: '•' };
    const isCollapsed = collapsed.includes(meta.slug);
    const subtitle = _groupSubtitle(groupName);
    const refreshFn = GROUP_BRIDGE_REFRESH[groupName];
    const showTiles = TILE_GRID_GROUPS.has(groupName);
    return `
      <div class="cover-group${isCollapsed ? ' collapsed' : ''}" data-group="${meta.slug}">
        <div class="cover-group-header" data-group-toggle="${meta.slug}">
          <div class="cover-group-drag" data-drag-handle="${meta.slug}" title="Drag to reorder" onclick="event.stopPropagation()">⠿</div>
          <div class="cover-group-icon">${meta.icon}</div>
          <div class="cover-group-head-text">
            <div class="cover-group-title">${_esc(groupName)}</div>
            ${subtitle ? `<div class="cover-group-subtitle">${_esc(subtitle)}</div>` : ''}
          </div>
          ${refreshFn ? `<button type="button" class="cover-group-refresh" data-bridge-refresh="${_esc(groupName)}" title="Refresh ${_esc(groupName)} data now" onclick="event.stopPropagation()">↻</button>` : ''}
          <div class="cover-group-line"></div>
          <div class="cover-group-chevron">▾</div>
        </div>
        <div class="cover-group-body"><div>
          ${GROUP_HERO[groupName] || ''}
          ${groupName === 'Manager' ? _staffRegistryHtml() : ''}
          ${showTiles ? `<div class="cover-tile-grid">${members.map(({ t, i }) => tileCardHtml(t, i)).join('')}</div>` : ''}
        </div></div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
  _renderKpiRow();
  _renderAttentionStrip();
  _renderPinsRow(tiles);
  _updateHeroDate();
  if (invSl && invSl.dataReady) { _renderInventoryChart(invSl, invEw); }
  _renderWeekdayChart();
  container.querySelectorAll('[data-staff-idx]').forEach(card => {
    const openIt = () => {
      if (typeof window.openStaffCard === 'function') window.openStaffCard(+card.dataset.staffIdx);
    };
    card.addEventListener('click', openIt);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } });
  });
  container.querySelectorAll('[data-note-goto]').forEach(card => {
    const goTo = () => {
      const id = card.dataset.noteGoto;
      if (!id) return;
      location.hash = '#notesheets/note/' + encodeURIComponent(id);
    };
    card.addEventListener('click', goTo);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(); } });
  });
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
  _wireCoverSearch();
  _wireCollapseToggle();
  _updateCollapseToggleLabel();
  _wireGroupDragReorder();
  container.querySelectorAll('[data-bridge-refresh]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const fn = GROUP_BRIDGE_REFRESH[btn.dataset.bridgeRefresh];
      if (!fn) return;
      btn.classList.add('spinning');
      Promise.resolve(fn()).finally(() => renderCoverDashboard());
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
// nav-sections.js (classic script, not a module) reads this to mirror
// Cover's own drag-reordered group sequence in the All Sections menu —
// see its header comment for the domain-group -> Cover-slug mapping.
window.btGetCoverOrder = _getOrder;
