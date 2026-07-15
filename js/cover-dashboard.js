// COVER DASHBOARD — Floor 5

import { MONTHLY, DAILY, n, fc } from './config.js';
import { Repository } from './repository.js';
import * as LedgerStore from './ledger-store.js';
import * as ClosingBridge from './closing-bridge.js';
import * as AuditBridge from './audit-bridge.js';
import * as InventoryBridge from './inventory-bridge.js';

const TGT_KEY = 'bt_targets';
let _closingRefreshInFlight = false;
let _auditRefreshInFlight = false;
let _inventoryRefreshInFlight = false;
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

function _closingLatestSummary() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Closing Summary', value: 'Waiting for Closing…', sub: '' };
  const latest = _latestRealSheet(cdb);
  if (!latest) return { label: 'Latest Closing Summary', value: 'No closings yet', sub: '' };
  const rec = latest.rec;
  let totalBooks = 0, totalManRet = 0;
  if (rec.profileMode === 'final') {
    totalBooks = n(rec.inBook1) + n(rec.inBook2);
    totalManRet = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
  }
  const val = `${_clFmtDate(latest.date)} · ${latest.shift}`;
  const sub = `Carried CC: Rs. ${fc(n(rec.outPrevCC))} · Deposits: Rs. ${fc(n(rec.outTotalF))} · Book Bills: Rs. ${fc(totalBooks)} · Manual Returns: Rs. ${fc(totalManRet)}`;
  return { label: 'Latest Closing Summary', value: val, sub };
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

function _tiles() {
  return [
    { page: 'dashboard', icon: '📊', title: 'Sales',           status: _salesStatus(),   enabled: true, group: 'Sales' },
    { page: 'manager',   icon: '👔', title: 'Manager',          status: _managerStatus(), enabled: true, group: 'Manager' },
    { page: 'notesheets',icon: '📑', title: 'Notes & Sheets',   status: _notesheetsStatus(), enabled: true, group: 'Notes & Sheets' },
    { href: 'https://closing.duapharma.com', icon: '🔒', title: 'Closing', status: _closingStatus(), enabled: true, bridgeAction: 'closingBridgeButtonClick', group: 'Closing' },
    { page: 'closing-book',   icon: '📖', title: 'Closing Book',  status: 'Every closing, laid out like a printed register', enabled: true, group: 'Closing' },
    { page: 'credit-ledger',  icon: '💳', title: 'Credit Ledger', status: 'Credit + Misc/Ongoing snapshot history',           enabled: true, group: 'Closing' },
    { href: 'https://random.duapharma.com',  icon: '🧾', title: 'Audit',   status: _auditStatus(),   enabled: true, group: 'Audit' },
    { page: 'assignments', icon: '📋', title: 'Assignments', status: 'Auditor progress + company coverage, every engagement', enabled: true, group: 'Audit' },
    { page: 'inventory', icon: '📦', title: 'BT Inventory',    status: _inventoryStatus(), enabled: true, group: 'Audit' },
    { href: 'https://reports.duapharma.com/daily_report.html', icon: '✅', title: 'Daily Check List', status: 'Fazal Din\'s Pharma Plus — standalone checklist app', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/excess-stock-control.html', icon: '📦', title: 'Excess Stock Control', status: 'Fazal Din\'s Pharma Plus — excess stock control', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/invoice-desk.html', icon: '🧮', title: 'Branch Invoice Desk', status: 'Fazal Din\'s Pharma Plus — branch invoice desk', enabled: true, group: 'Reports' },
  ];
}

const GROUP_ORDER = ['Sales', 'Manager', 'Notes & Sheets', 'Closing', 'Audit', 'Reports'];
const GROUP_META = {
  'Sales':           { slug: 'sales',   icon: '📊' },
  'Manager':         { slug: 'manager', icon: '👔' },
  'Notes & Sheets':  { slug: 'notes',   icon: '📑' },
  'Closing':         { slug: 'closing', icon: '🔒' },
  'Audit':           { slug: 'audit',   icon: '🧾' },
  'Reports':         { slug: 'reports', icon: '📚' },
};

function _updateHeroDate() {
  const el = document.getElementById('cover-hero-date');
  if (!el) return;
  const d = new Date();
  const dayName = d.toLocaleDateString('en-PK', { weekday: 'long' });
  const dateStr = d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
  el.innerHTML = `<div class="d-day">${_esc(dayName)}</div><div>${_esc(dateStr)} · ${_esc(timeStr)}</div>`;
}

export function renderCoverDashboard() {
  const container = document.getElementById('cover-container');
  if (!container) return;

  const headline = _salesHeadline();
  const pace = _targetPace();
  const credits = _totalOutstandingCredits();
  const tiles = _tiles();

  const heroCard = h => `
    <div class="cover-hero-card">
      <div class="cover-hero-label">${_esc(h.label)}</div>
      <div class="cover-hero-value">${_esc(h.value)}</div>
      <div class="cover-hero-sub">${_esc(h.sub)}</div>
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
    <div class="cover-hero-row">
      ${heroCard(closingLatestSummary)}
      ${heroCard(closingLatestCredit)}
      ${heroCard(closingLatestMisc)}
    </div>`;

  const tileCardHtml = (t, i) => `
    <div class="cover-tile${t.enabled ? '' : ' cover-tile-disabled'}"
         ${t.enabled ? `data-goto-idx="${i}" role="button" tabindex="0"` : ''}>
      <div class="cover-tile-icon">${t.icon}</div>
      <div class="cover-tile-title">${_esc(t.title)}${t.href ? ' <span class="ext">↗</span>' : ''}</div>
      <div class="cover-tile-status">${_esc(t.status)}</div>
      ${t.bridgeAction ? `<button class="cover-tile-bridge" data-bridge-idx="${i}">Bridge</button>` : ''}
    </div>`;

  const GROUP_HERO = { Sales: heroHtml, Manager: managerHeroHtml, Closing: closingHeroHtml };
  const groupsHtml = GROUP_ORDER.map(groupName => {
    const members = tiles.map((t, i) => ({ t, i })).filter(x => x.t.group === groupName);
    if (!members.length) return '';
    const meta = GROUP_META[groupName] || { slug: 'sales', icon: '•' };
    return `
      <div class="cover-group" data-group="${meta.slug}">
        <div class="cover-group-header">
          <div class="cover-group-icon">${meta.icon}</div>
          <div class="cover-group-title">${_esc(groupName)}</div>
          <div class="cover-group-line"></div>
        </div>
        ${GROUP_HERO[groupName] || ''}
        <div class="cover-tile-grid">
          ${members.map(({ t, i }) => tileCardHtml(t, i)).join('')}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
  _updateHeroDate();
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
