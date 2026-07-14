// ══════════════════════════════════════════════════════════════════════
// COVER DASHBOARD  —  Floor 5 of the architecture (V2 plan §2)
//
// New landing page. Concise cross-domain summary + one tile per peer
// dashboard (Sales, Manager, Notes & Sheets, Closing/Inventory). No
// business logic of its own — reads Floor 2 state (MONTHLY/DAILY) and
// Floor 1 Repository directly, and reuses LedgerStore (Floor 1/2) for
// the Manager tile's status line instead of re-deriving ledger math
// here. Pages only call into Repository/Store modules, never reach into
// another page directly — the rule V2 plan §1 sets for all new code.
//
// Bridged to `window.renderCoverDashboard` at the bottom so ui.js's
// showPage() (still a classic script) can call it — same low-risk
// bridge pattern already used by ledger-page.js's renderLedgerView.
// ══════════════════════════════════════════════════════════════════════

import { MONTHLY, DAILY, n, fc } from './config.js';
import { Repository } from './repository.js';
import * as LedgerStore from './ledger-store.js';
import * as ClosingBridge from './closing-bridge.js';
import * as AuditBridge from './audit-bridge.js';

const TGT_KEY = 'bt_targets';
let _closingRefreshInFlight = false;
let _auditRefreshInFlight = false;
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

// Comparable numeric value for DAILY's "DD/Mon/YYYY" Date strings (e.g.
// "12/Jul/2026") — DAILY isn't guaranteed to be in date order, and a plain
// string comparison sorts wrong (e.g. "9/Jul/2026" > "12/Jul/2026"
// lexically), so finding "the latest filled day" needs real parsing.
function _dailyDateVal(dateStr) {
  const [dd, mon, yyyy] = String(dateStr || '').split('/');
  const mi = MONTH_SHORT.indexOf(mon);
  return (parseInt(yyyy, 10) || 0) * 10000 + (mi >= 0 ? mi : 0) * 100 + (parseInt(dd, 10) || 0);
}

// Last calendar day-of-month with an actual (non-zero) DAILY entry —
// mirrors analytics.js's _lastFilledDay(), reimplemented locally rather
// than importing since analytics.js is still a classic script and not
// reachable from an ES module (same reasoning as _todayDMY() above).
// "Days elapsed" for pace math is this, not today's calendar date — the
// day's sale is typically entered the next day, so if today is the 10th
// but only the 9th has been entered, elapsed is 9 and the remaining-days
// math below is over the true 22 days left in the month, not 21.
function _lastFilledDay(monthYear) {
  return Math.max(0, ...DAILY
    .filter(d => d.Month_Year === monthYear && n(d.TOTAL) > 0)
    .map(d => parseInt((d.Date || '').split('/')[0], 10) || 0));
}

function _getTargets() {
  try { return JSON.parse(Repository.getItem(TGT_KEY) || '{}'); } catch (e) { return {}; }
}

// ── Hero numbers ─────────────────────────────────────────────────────
// Previously showed strictly TODAY's entry, so this read "No entry yet"
// for most of the day (the day's sale is typically entered the next
// morning — see _lastFilledDay's comment below). Now always shows the
// most recent day that actually has a filled entry, whichever day that
// was, so the card is never just "no data" by default.
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

// ── Per-domain one-line status ──────────────────────────────────────
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

// Same figure as the Manager page's own "Total Outstanding Credits" strip
// (Staff Credit for the latest manager month + Jazz Cash + Patty/Expenses
// + Other Sections, all-time) — reuses Analytics.getCreditSectionData
// rather than re-deriving the math here, so this can never drift from what
// the Manager page itself shows. Analytics is a classic script's top-level
// `const`, not an ES export, so it's read via the window.Analytics bridge
// (see analytics.js) rather than import.
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
    // Read via _nsSFLoad() (notes-sheets.js) rather than the legacy
    // bt_sheet_files_v1 key directly — V2 plan §5's multi-file workbook
    // migration leaves that key frozen at whatever it held the moment
    // migration ran, so reading it directly here would go stale.
    const sheetFiles = (typeof _nsSFLoad === 'function') ? _nsSFLoad() : JSON.parse(Repository.getItem('bt_sheet_files_v1') || '[]');
    if (!notes.length && !sheetFiles.length) return 'No notes or sheets yet';
    return notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' · ' +
           sheetFiles.length + ' file' + (sheetFiles.length === 1 ? '' : 's');
  } catch (e) {
    return 'Notes & Sheets status unavailable';
  }
}

const SHIFT_ICON = { pending: '⚪', draft: '🟡', closed: '✅' };
function _closingStatus() {
  if (!ClosingBridge.isConnected()) {
    return 'Not connected — tap 🔗 Data Bridge below to link';
  }
  const summary = ClosingBridge.getCachedSummary();
  if (!summary) return 'Live shift register — Fazal Din\u2019s Pharma Plus';
  const parts = summary.shifts.map(s => SHIFT_ICON[s.status] + ' ' + s.shift);
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

// ── Tiles (V2 plan §2's confirmed shape, + standalone sub-apps) ────
// Each tile carries a `group` — the render function sections tiles by
// group instead of one flat grid (see GROUP_ORDER / renderCoverDashboard).
function _tiles() {
  return [
    { page: 'dashboard', icon: '📊', title: 'Sales',           status: _salesStatus(),   enabled: true, group: 'Sales' },
    { page: 'manager',   icon: '👔', title: 'Manager',          status: _managerStatus(), enabled: true, group: 'Manager' },
    { page: 'notesheets',icon: '📑', title: 'Notes & Sheets',   status: _notesheetsStatus(), enabled: true, group: 'Notes & Sheets' },
    // Closing and Audit's own standalone apps (the tiles with `href`
    // below) are separate sibling apps — own repo, own PWA, own data;
    // tapping those opens the real thing in a new tab. But Closing
    // Book/Credit Ledger and Assignments ARE embedded pages in this
    // app — native ports (closing-native.js / audit-native.js) reading
    // through a read-only bridge, each its own domain now (V2 plan §2 —
    // hidden from nav except while inside it, same as every other
    // domain; see nav.css). The status line below still comes from the
    // live read-only bridge (closing-bridge.js / audit-bridge.js), so
    // the dashboard summary keeps working exactly as before. Closing's
    // bridge needs a one-time manual pairing step (Dropbox has no
    // queryable API); that lives behind bridgeAction on the tile
    // itself. Audit's bridge reads Supabase directly with a baked-in
    // key — no pairing step needed.
    { href: 'https://closing.duapharma.com', icon: '🔒', title: 'Closing', status: _closingStatus(), enabled: true, bridgeAction: 'closingBridgeButtonClick', group: 'Closing' },
    // Native reports built off the same Closing data the tile above
    // reads — not an iframe, not an external link. See closing-native.js.
    { page: 'closing-book',   icon: '📖', title: 'Closing Book',  status: 'Every closing, laid out like a printed register', enabled: true, group: 'Closing' },
    { page: 'credit-ledger',  icon: '💳', title: 'Credit Ledger', status: 'Credit + Misc/Ongoing snapshot history',           enabled: true, group: 'Closing' },
    { href: 'https://random.duapharma.com',  icon: '🧾', title: 'Audit',   status: _auditStatus(),   enabled: true, group: 'Audit' },
    { page: 'assignments', icon: '📋', title: 'Assignments', status: 'Auditor progress + company coverage, every engagement', enabled: true, group: 'Audit' },
    { page: null,        icon: '📦', title: 'Inventory Audit',  status: 'Not built yet — Dropbox-fed, planned (V2 plan §6)', enabled: false, group: 'Audit' },
    // Standalone sub-apps at reports.duapharma.com — own files, own storage,
    // not part of this app's data model. Open in a new tab rather than
    // routing through showPage(), since none of them are a Floor 5 page of
    // this app. (Previously "Daily Check List" pointed at a local
    // checklist.html shipped inside this repo — that file has been removed;
    // all three checklist/report tools now live on reports.duapharma.com.)
    { href: 'https://reports.duapharma.com/daily_report.html', icon: '✅', title: 'Daily Check List', status: 'Fazal Din\'s Pharma Plus — standalone checklist app', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/excess-stock-control.html', icon: '📦', title: 'Excess Stock Control', status: 'Fazal Din\'s Pharma Plus — excess stock control', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/invoice-desk.html', icon: '🧮', title: 'Branch Invoice Desk', status: 'Fazal Din\'s Pharma Plus — branch invoice desk', enabled: true, group: 'Reports' },
  ];
}

// Display order for the Cover page's sections. The Sales section also
// carries the two hero cards (Today's sales / Target pace) — see
// renderCoverDashboard.
const GROUP_ORDER = ['Sales', 'Manager', 'Notes & Sheets', 'Closing', 'Audit', 'Reports'];

export function renderCoverDashboard() {
  const container = document.getElementById('cover-container');
  if (!container) return;

  const headline = _salesHeadline();
  const pace = _targetPace();
  const credits = _totalOutstandingCredits();
  const tiles = _tiles();

  const heroCard = h => `
    <div class="kpi">
      <div style="font-size:12px;color:var(--muted)">${_esc(h.label)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${_esc(h.value)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${_esc(h.sub)}</div>
    </div>`;

  const heroHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px">
      ${heroCard(headline)}
      ${heroCard(pace)}
    </div>`;

  const managerHeroHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:14px">
      ${heroCard(credits)}
    </div>`;

  const tileCardHtml = (t, i) => `
    <div class="card cover-tile${t.enabled ? '' : ' cover-tile-disabled'}"
         ${t.enabled ? `data-goto-idx="${i}" role="button" tabindex="0"` : ''}>
      <div style="font-size:22px">${t.icon}</div>
      <div style="font-weight:600;margin-top:6px">${_esc(t.title)}${t.href ? ' <span style="font-size:11px;color:var(--muted);font-weight:400">↗</span>' : ''}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${_esc(t.status)}</div>
      ${t.bridgeAction ? `<button data-bridge-idx="${i}" style="margin-top:8px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--s2);color:inherit;cursor:pointer">🔗 Data Bridge</button>` : ''}
    </div>`;

  // Group tiles by section, preserving each tile's original array index
  // (data-goto-idx / data-bridge-idx below still point into the flat
  // `tiles` array — grouping is purely visual). Each group may carry its
  // own hero card(s), rendered above its tile grid.
  const GROUP_HERO = { Sales: heroHtml, Manager: managerHeroHtml };
  const groupsHtml = GROUP_ORDER.map(groupName => {
    const members = tiles.map((t, i) => ({ t, i })).filter(x => x.t.group === groupName);
    if (!members.length) return '';
    return `
      <div class="cover-group" style="margin-bottom:22px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">${_esc(groupName)}</div>
        ${GROUP_HERO[groupName] || ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
          ${members.map(({ t, i }) => tileCardHtml(t, i)).join('')}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
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
      e.stopPropagation(); // don't also trigger the tile's own click → new tab
      const t = tiles[+btn.dataset.bridgeIdx];
      if (t && typeof window[t.bridgeAction] === 'function') window[t.bridgeAction]();
    });
  });

  // Background refresh of the Closing summary (rate-limited to once per
  // 5 min inside the bridge itself — see closing-bridge.js). One-shot,
  // not recursive: only re-renders if the fetch actually returns new
  // data, and refresh() de-dupes concurrent callers on its own.
  if (ClosingBridge.isConnected() && !_closingRefreshInFlight) {
    _closingRefreshInFlight = true;
    ClosingBridge.refresh(false).finally(() => { _closingRefreshInFlight = false; });
  }

  // Background refresh of the Audit summary — rate-limited to once per
  // 5 min inside the bridge itself (see audit-bridge.js). Always
  // "connected" since it's a direct Supabase read, no pairing step.
  if (!_auditRefreshInFlight) {
    _auditRefreshInFlight = true;
    AuditBridge.refresh(false).finally(() => { _auditRefreshInFlight = false; });
  }
}

// Bridged, since this is called from ui.js's showPage (still a classic
// script) — not from a generated onclick string, so this is a plain,
// low-risk bridge, same reasoning as ledger-page.js's renderLedgerView.
window.renderCoverDashboard = renderCoverDashboard;
