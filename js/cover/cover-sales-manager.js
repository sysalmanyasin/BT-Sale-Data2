// COVER DASHBOARD — Sales and Manager glance cards: greeting, trend, pins, sales/manager status, notes, online staff, Staff Registry strip.

import { MONTHLY, DAILY, STAFF, n, fc, negR, mBanks, creditSales } from '../platform/config.js';
import { Repository } from '../platform/repository.js';
import * as LedgerStore from '../ledger/ledger-store.js';
import * as ClosingBridge from '../closing/closing-bridge.js';
import * as SalePaymentsBridge from '../sales/sale-payments-bridge.js';
import { escapeHtml as _esc } from '../shared/html.js';
import { act } from '../shared/dom-actions.js';
import { MONTH_NAMES, _currentMonthYear, _dailyDateVal, _daysInMonth, _getPins, _getTargets, _isoMonthPrefix, _lastFilledDay } from './cover-prefs.js';
import { _auditStatus, _clFmtDate, _closingLatestSummary } from './cover-closing-status.js';
import { _inventoryHeroStats } from './cover-inventory.js';
import { _strStatus } from './cover-str.js';

export function _greetingText() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Working late';
  const online = ClosingBridge.getOnlineStaff();
  return part + ' 👋' + (online.length ? ' · ' + online.length + ' online now' : '');
}

// Last 7 filled-day totals (oldest→newest), for the sales headline sparkline + trend arrow.
export function _last7DayTotals() {
  const filled = DAILY.filter(d => n(d.TOTAL) > 0)
    .sort((a, b) => _dailyDateVal(a.Date) - _dailyDateVal(b.Date));
  return filled.slice(-7).map(d => n(d.TOTAL));
}

export function _sparklineSvg(values) {
  if (!values || values.length < 2) return '';
  const w = 84, hgt = 28, pad = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const range = (max - min) || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => `${(pad + i * step).toFixed(1)},${(hgt - pad - ((v - min) / range) * (hgt - pad * 2)).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return `<svg class="cover-hero-spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">
    <polyline points="${pts}" fill="none" style="stroke:${up ? 'var(--green)' : 'var(--red)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function _trendBadge(values) {
  if (!values || values.length < 2) return '';
  const prev = values[values.length - 2], cur = values[values.length - 1];
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return `<span class="cover-hero-trend ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

// _needsAttention()/_renderAttentionStrip() used to live here (target
// pace + outstanding credit + inventory hero flags + aimRulesCheckAll()
// rendered as a chip row into #cover-attention-strip). Replaced by IC
// Herald (js/herald/herald-engine.js + herald-page.js), which covers all
// of that plus Sales/Closing/Audit desks, streaks/records, and a
// scoring + anti-repeat engine so the lead story rotates instead of
// showing the same chip every day. Mount point is now #cover-herald —
// see the guarded window.renderICHerald() call in renderCoverDashboard()
// below. _targetPace()/_totalOutstandingCredits()/_inventoryHeroStats()
// are untouched; Herald re-derives its own numbers from the same bridges
// rather than reaching into this file's private helpers.

export function _renderPinsRow(tiles) {
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

export function _salesHeadline() {
  const filled = DAILY.filter(d => n(d.TOTAL) > 0);
  if (!filled.length) return { label: 'Latest sale', value: 'No entries yet', sub: '' };
  const latest = filled.reduce((best, d) => _dailyDateVal(d.Date) > _dailyDateVal(best.Date) ? d : best);
  return { label: 'Latest sale', value: '₨' + fc(n(latest.TOTAL)), sub: latest.Date };
}

export function _targetPace() {
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
  // Same red/amber/green thresholds the KPI strip's "Sales vs Target"
  // tile uses (see _kpiTiles below) — kept in one place logically so
  // this card and that tile can never disagree about whether a given
  // % of target counts as on-track, since they're both driven by pct.
  // Colour by PACE (actual vs expected so far), not by raw % of the whole month:
  // 29% of target on day 8 of 31 is ahead of pace and must not read red.
  const paceRatio = expectedSoFar > 0 ? actual / expectedSoFar : 1;
  const cls = paceRatio >= 0.95 ? 'green' : paceRatio >= 0.75 ? 'amber' : 'red';
  return { label: 'Target pace — ' + my, value: pct + '% of target', sub, cls };
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

export function _salesStatus() {
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
export function _monthSaleBreakdown() {
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

// Today's live POS payment split (Cash/Card/Credit), straight from
// Candela via sale-payments-bridge.js's sales_payment_summary table —
// deliberately separate from _monthSaleBreakdown() above, which reads
// the manually-entered Sale Data ledger (Cash Sale/Bank/Credit fields
// staff type in). This one is what Candela itself recorded for today,
// synced automatically; no typing involved, and it can legitimately
// disagree with the manual entry until that day's entry is filled in
// (or ever, if reconciliation differences exist) — that's expected,
// not a bug, so no cross-check against MONTHLY/DAILY is attempted here.
export function _todaySaleBreakdown() {
  const data = SalePaymentsBridge.getFullData();
  if (!data || !data.paymentSummary || !data.paymentSummary.length) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const rec = data.paymentSummary.find(r => r.saleDay === todayIso)
    || data.paymentSummary.slice().sort((a, b) => (a.saleDay < b.saleDay ? 1 : -1))[0];
  if (!rec) return null;
  const isToday = rec.saleDay === todayIso;
  const label = isToday ? "Today's Sale — POS Live" : 'Latest POS Sale — ' + _clFmtDate(rec.saleDay);
  const syncedLabel = data.fetchedAt
    ? 'synced ' + new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
    : '';
  return { label, value: '₨' + fc(n(rec.totalSale)), cash: n(rec.cashSale), card: n(rec.cardSale), credit: n(rec.creditSale), sub: syncedLabel };
}

export function _managerStatus() {
  try {
    const jcBal = LedgerStore.getCurrentBalance('jazzcash');
    const monthPrefix = _isoMonthPrefix();
    const expCount = LedgerStore.getEntries('expense').filter(e => (e.date || '').slice(0, 7) === monthPrefix).length;
    return 'Jazz Cash ₨' + fc(jcBal) + ' · ' + expCount + ' expense entries this month';
  } catch (e) {
    return 'Ledger status unavailable';
  }
}

export function _totalOutstandingCredits() {
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
      cls: v > 0 ? 'amber' : 'green',
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
export function _managerCreditRankedHtml() {
  const rows = _managerCreditRanked().slice(0, 8);
  if (!rows.length) return `<div style="font-size:11px;color:var(--muted);padding:8px 0">No outstanding credit this month.</div>`;
  return rows.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer"${act('click', 'showPage', 'manager')}>
      <span style="font-size:11.5px;color:var(--text);font-weight:600">${_esc(r.name)}</span>
      <span style="font-size:11.5px;font-weight:700;font-family:var(--mono);color:${r.net > 0 ? 'var(--red)' : 'var(--green)'}">₨${fc(Math.abs(r.net))}</span>
    </div>`).join('');
}

export function _notesheetsStatus() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    if (!notes.length) return 'No notes yet';
    return notes.length + ' note' + (notes.length === 1 ? '' : 's');
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
export function _noteTiles() {
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    if (!notes.length) return [];
    const byRecency = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    const pinned = notes.filter(n => n && n.pinned).sort(byRecency);
    const rest = notes.filter(n => n && !n.pinned).sort(byRecency);
    return pinned.concat(rest).slice(0, 3);
  } catch (e) { return []; }
}

// ── Staff Registry strip (Manager group) ──────────────────────────────
// Replaces the old Quick Add panel on the cover page. Shows every active
// employee as a small horizontally-scrollable card; tapping one opens the
// same Staff Card modal used by Manager → Staff Registry (openStaffCard,
// from manager-staff.js — index must match the live STAFF array, so we
// carry origIdx through the sort exactly like activeStaff() does there).
export function _staffRegistryHtml() {
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
export function _groupSubtitle(groupName) {
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
        return '₨ ' + fc(slStats.totalInventoryValue) + ' total · ₨ ' + fc(slStats.negativeValue) + ' negative';
      }
      case 'STR Report':
        return _strStatus();
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
