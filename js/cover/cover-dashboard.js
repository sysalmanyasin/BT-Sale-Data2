// COVER DASHBOARD — Floor 5

import { fc } from '../platform/config.js';
import * as ClosingBridge from '../closing/closing-bridge.js';
import * as AuditBridge from '../audit/audit-bridge.js';
import * as InventoryBridge from '../inventory/inventory-bridge.js';
import * as SalePaymentsBridge from '../sales/sale-payments-bridge.js';
import * as StrBridge from '../str/str-bridge.js';
import { escapeHtml as _esc } from '../shared/html.js';
import { act } from '../shared/dom-actions.js';
import { GROUP_META, GROUP_ORDER, _currentMonthYear, _getCollapsed, _getOrder, _getPins, _getView, _setCollapsed, _setOrder, _setPins, _setView } from './cover-prefs.js';
import { _greetingText, _groupSubtitle, _last7DayTotals, _managerCreditRankedHtml, _managerStatus, _monthSaleBreakdown, _noteTiles, _notesheetsStatus, _renderPinsRow, _salesHeadline, _salesStatus, _sparklineSvg, _staffRegistryHtml, _targetPace, _todaySaleBreakdown, _totalOutstandingCredits, _trendBadge } from './cover-sales-manager.js';
import { _auditStatus, _closingLatestCredit, _closingLatestMisc, _closingLatestSummary, _closingStatus, _inventoryStatus } from './cover-closing-status.js';
import { _excessStockRows, _invChart, _inventoryHeroStats, _inventoryMiniTableHtml, _renderInventoryChart, _renderWeekdayChart, _reorderNowCardInnerHtml, _reorderUrgentStats, _topRunningCardInnerHtml, _weekdayChart } from './cover-inventory.js';
import { _strAwaitedRows, _strData, _strHeroHtml, _strStatus } from './cover-str.js';
import { _renderKpiRow } from './cover-kpi.js';
export { showOnlineStaffDetail } from './cover-closing-status.js';

let _closingRefreshInFlight = false;
let _auditRefreshInFlight = false;
let _inventoryRefreshInFlight = false;
let _salePaymentsRefreshInFlight = false;
let _strRefreshInFlight = false;

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
    { page: 'str', icon: '📋', title: 'STR Report', status: _strStatus(), enabled: true, group: 'STR Report' },
    { page: 'str-report', icon: '🧾', title: 'STR – Report', status: 'Flattened all-STRs view, filterable & printable', enabled: true, group: 'STR Report' },
    { page: 'str-zero-dispatch', icon: '🚫', title: 'STR – 0-Dispatch', status: 'Zero-dispatch line items, pick & print', enabled: true, group: 'STR Report' },
    { href: 'https://reports.duapharma.com/daily_report.html', icon: '✅', title: 'Daily Check List', status: 'Fazal Din\'s Pharma Plus — standalone checklist app', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/excess-stock-control.html', icon: '📦', title: 'Excess Stock Control', status: 'Fazal Din\'s Pharma Plus — excess stock control', enabled: true, group: 'Reports' },
    { href: 'https://reports.duapharma.com/invoice-desk.html', icon: '🧮', title: 'Branch Invoice Desk', status: 'Fazal Din\'s Pharma Plus — branch invoice desk', enabled: true, group: 'Reports' },
  ];
}
let _deckOpenSlug = null;

function _applyView() {
  const page = document.getElementById('page-cover');
  if (!page) return;
  const v = _getView();
  page.dataset.view = v;
  document.querySelectorAll('#cover-view-seg [data-cover-view]').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.coverView === v ? 'true' : 'false');
  });
}

// One short headline + status per section for its tile. Every figure comes from the helper the
// section's own card already uses; anything unavailable falls back to the group subtitle.
// status: 'ok' | 'warn' | 'bad' | '' (no dot when we can't judge honestly).
const _STATUS_FROM_CLS = { green: 'ok', amber: 'warn', red: 'bad' };
function _deckInfo(groupName) {
  try {
    switch (groupName) {
      case 'Sales': {
        const p = _targetPace();
        return { text: p.value, status: _STATUS_FROM_CLS[p.cls] || '' };
      }
      case 'Manager':
        const cr = _totalOutstandingCredits().value;
        return { text: /^unavailable$/i.test(String(cr)) ? 'Credit unavailable' : cr + ' credit', status: '' };
      case 'Closing': {
        const s = _closingLatestSummary();
        return { text: s.value || _groupSubtitle(groupName), status: '' };
      }
      case 'Audit': {
        const sum = AuditBridge.getCachedSummary();
        if (!sum) return { text: 'Syncing…', status: '' };
        const open = sum.items.length;
        return { text: open ? open + ' open' : 'No open audits', status: open ? 'warn' : 'ok' };
      }
      case 'Inventory': {
        const RR = window.ReorderReportApp;
        if (!RR || typeof RR.getFlaggedRowsFor !== 'function') return { text: _groupSubtitle(groupName), status: '' };
        const st = _reorderUrgentStats();
        return { text: st.total + ' to reorder', status: st.urgentCount > 0 ? 'bad' : (st.total > 0 ? 'warn' : 'ok') };
      }
      case 'STR Report': {
        const data = _strData();
        if (!data) return { text: 'Syncing…', status: '' };
        const awaited = _strAwaitedRows(data).length;
        return { text: awaited + ' awaited', status: awaited > 0 ? 'warn' : 'ok' };
      }
      case 'Reports':
        return { text: '3 tools', status: '' };
      case 'Notes & Sheets':
      default:
        return { text: _groupSubtitle(groupName), status: '' };
    }
  } catch (e) {
    console.error('Cover Dashboard: _deckInfo(' + groupName + ') failed', e);
    return { text: _groupSubtitle(groupName), status: '' };
  }
}

const _STATUS_LABEL = { ok: 'All good', warn: 'Needs a look', bad: 'Needs attention' };
function _deckHtml(groupNames) {
  return groupNames.map(name => {
    const meta = GROUP_META[name];
    if (!meta) return '';
    const info = _deckInfo(name);
    const dot = info.status
      ? `<span class="cover-deck-dot is-${info.status}" role="img" aria-label="${_STATUS_LABEL[info.status]}"></span>` : '';
    return `<button type="button" class="cover-deck-tile" data-group="${meta.slug}" data-deck-open="${meta.slug}" aria-haspopup="dialog">
      <span class="cover-deck-top"><span class="cover-deck-icon" aria-hidden="true">${meta.icon}</span>${dot}</span>
      <span class="cover-deck-name">${_esc(name)}</span>
      <span class="cover-deck-line">${_esc(info.text || '')}</span>
    </button>`;
  }).join('');
}

function _deckBackdrop() { return document.getElementById('cover-sheet-backdrop'); }
function _closeDeck(returnFocus) {
  const slug = _deckOpenSlug;
  _deckOpenSlug = null;
  document.querySelectorAll('#cover-container .cover-group.deck-open').forEach(g => g.classList.remove('deck-open'));
  const bd = _deckBackdrop(); if (bd) bd.classList.remove('on');
  if (returnFocus && slug) {
    const t = document.querySelector('.cover-deck-tile[data-deck-open="' + slug + '"]');
    if (t) t.focus();
  }
}
function _openDeck(slug) {
  const container = document.getElementById('cover-container');
  const g = container && container.querySelector('.cover-group[data-group="' + slug + '"]');
  if (!g) return;
  container.querySelectorAll('.cover-group.deck-open').forEach(x => { if (x !== g) x.classList.remove('deck-open'); });
  g.classList.add('deck-open');
  _deckOpenSlug = slug;
  const bd = _deckBackdrop(); if (bd) bd.classList.add('on');
  g.scrollTop = 0;
  // Charts built while the group was display:none have no size yet — resize now that it's visible.
  try { if (_invChart) _invChart.resize(); if (_weekdayChart) _weekdayChart.resize(); } catch (e) { /* non-fatal */ }
  const close = g.querySelector('[data-sheet-close]');
  if (close) close.focus({ preventScroll: true });
}
let _deckWired = false;
function _wireDeck() {
  if (_deckWired) return;
  _deckWired = true;
  const deck = document.getElementById('cover-deck');
  if (deck) deck.addEventListener('click', e => {
    const t = e.target.closest('[data-deck-open]');
    if (t) _openDeck(t.dataset.deckOpen);
  });
  const container = document.getElementById('cover-container');
  if (container) container.addEventListener('click', e => {
    if (e.target.closest('[data-sheet-close]')) { e.stopPropagation(); _closeDeck(true); }
  });
  const bd = _deckBackdrop(); if (bd) bd.addEventListener('click', () => _closeDeck(true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _deckOpenSlug) _closeDeck(true); });
  document.querySelectorAll('#cover-view-seg [data-cover-view]').forEach(b => {
    b.addEventListener('click', () => {
      _closeDeck(false);
      _setView(b.dataset.coverView);
      _applyView();
      _updateCollapseToggleLabel();
    });
  });
  // Leaving Cover must not leave a sheet "open" for when the user comes back.
  const page = document.getElementById('page-cover');
  if (page && typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (_deckOpenSlug && !page.classList.contains('active')) _closeDeck(false); })
      .observe(page, { attributes: true, attributeFilter: ['class'] });
  }
}

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
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (_) { /* vibration unsupported: cosmetic only */ } }

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

// The Cover-page "Jump to anything" search box was removed (Aug 2026) —
// it only ever handed off to the same Search & All Sections drawer
// already one tap away via Menu, so it was a third redundant entry
// point into that same search (see index.html). _wireCoverSearch and
// its in-page filtering are gone with it.

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
    <div class="cover-hero-card${h.cls ? ' cls-' + _esc(h.cls) : ''}">
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
              <div class="ccs-val">₨ ${_esc(fc(s.value))}</div>
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
          <div class="ccs-text"><div class="ccs-lbl">Cash</div><div class="ccs-val">₨ ${_esc(fc(h.cash))}</div></div>
        </div>
        <div class="ccs-stat ccs-bank">
          <span class="ccs-ic">🏦</span>
          <div class="ccs-text"><div class="ccs-lbl">Banks</div><div class="ccs-val">₨ ${_esc(fc(h.banks))}</div></div>
        </div>
        <div class="ccs-stat ccs-cashbank">
          <span class="ccs-ic">💰</span>
          <div class="ccs-text"><div class="ccs-lbl">Cash &amp; Banks</div><div class="ccs-val">₨ ${_esc(fc(h.cashBanks))}</div></div>
        </div>
        <div class="ccs-stat ccs-credit">
          <span class="ccs-ic">📋</span>
          <div class="ccs-text"><div class="ccs-lbl">Credit Clients (incl. free issue)</div><div class="ccs-val">₨ ${_esc(fc(h.credit))}</div></div>
        </div>
        <div class="ccs-stat ccs-cust">
          <span class="ccs-ic">👥</span>
          <div class="ccs-text"><div class="ccs-lbl">Customers</div><div class="ccs-val">${_esc(fc(h.customers))}</div></div>
        </div>
      </div>
    </div>`;

  const todaySale = _todaySaleBreakdown();
  const todaySaleCard = h => `
    <div class="cover-hero-card cover-closing-summary-card cover-today-sale-card">
      <div class="cover-hero-label">${_esc(h.label)} <button type="button" class="cover-chip-link"${act('click', 'showPage', 'sale-payments')}>OPEN ↗</button></div>
      <div class="cover-hero-value">${_esc(h.value)}</div>
      <div class="ccs-stat-grid">
        <div class="ccs-stat ccs-cash">
          <span class="ccs-ic">💵</span>
          <div class="ccs-text"><div class="ccs-lbl">Cash</div><div class="ccs-val">₨ ${_esc(fc(h.cash))}</div></div>
        </div>
        <div class="ccs-stat ccs-cardpay">
          <span class="ccs-ic">💳</span>
          <div class="ccs-text"><div class="ccs-lbl">Card</div><div class="ccs-val">₨ ${_esc(fc(h.card))}</div></div>
        </div>
        <div class="ccs-stat ccs-credit">
          <span class="ccs-ic">📋</span>
          <div class="ccs-text"><div class="ccs-lbl">Credit</div><div class="ccs-val">₨ ${_esc(fc(h.credit))}</div></div>
        </div>
      </div>
      ${h.sub ? `<div class="cover-hero-sub" style="margin-top:8px">${_esc(h.sub)}</div>` : ''}
    </div>`;

  const heroHtml = `
    ${todaySale ? `<div class="cover-hero-row-single">${todaySaleCard(todaySale)}</div>` : ''}
    ${monthSale ? `<div class="cover-hero-row-single">${monthSaleCard(monthSale)}</div>` : ''}
    <div class="cover-hero-row">
      ${heroCard(headline)}
      ${heroCard(pace)}
    </div>
    <div class="cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--amber)"></span>Sales by Weekday — ${_esc(_currentMonthYear())}</div>
        <div style="height:200px"><canvas id="cover-weekday-chart"></canvas></div>
      </div>
    </div>`;

  const managerHeroHtml = `
    <div class="cover-hero-row">
      ${heroCard(credits)}
    </div>
    <div class="cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--red)"></span>Staff Credit — ranked, who owes the most
          <button type="button" class="cover-chip-link"${act('click', 'showPage', 'manager')}>OPEN ↗</button>
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
        <div class="ctitle"><span class="cdot" style="background:var(--accent)"></span>Inventory Health — right now</div>
        <div style="height:220px"><canvas id="cover-inventory-chart"></canvas></div>
      </div>
    </div>
    <div class="cover-hero-row">
      ${heroCard({ label: 'Total Inventory Level', value: '₨ ' + fc(invSl.totalInventoryValue), sub: 'as of ' + invSl.asOf })}
      ${heroCard({ label: 'Negative Value', value: '₨ ' + fc(invSl.negativeValue), sub: 'negative qty × retail price' })}
      ${heroCard({ label: 'Never Sold (60D)', value: '₨ ' + fc(invSl.neverSold60Value), sub: '>60 days received, zero sales' })}
      ${heroCard({ label: 'Dead Stock (60D)', value: '₨ ' + fc(invSl.deadStock60Value), sub: 'quiet 60+ days' })}
    </div>
    <div class="cover-hero-row">
      ${heroCard({ label: 'Excess Stock Total', value: invEw ? '₨ ' + fc(invEw.rawExcessValue) : '—', sub: 'raw, before correction' })}
      ${heroCard({ label: 'Corrected Excess Stock', value: invEw ? '₨ ' + fc(invEw.correctedExcessValue) : '—', sub: 'after retain list + misc buffer' })}
      ${(() => {
        const u = invRr ? _reorderUrgentStats() : null;
        return heroCard({
          label: 'Reorder Alert (<30d cover · Top 500 by 60d value)',
          value: u ? u.urgentCount + ' items <7d cover' : '—',
          sub: u ? `${u.zeroStock} stockout now · ${u.critical} still stocked, <7d left · ${invRr.itemsShown} items <30d total · ₨ ${fc(invRr.totalReorderValue)} to reorder` : 'no data yet',
        });
      })()}
    </div>
    <div class="cover-hero-row">
      <div class="card" id="cover-reorder-now-card">
        ${_reorderNowCardInnerHtml()}
      </div>
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--amber)"></span>Excess Stock — highest value
          <button type="button" class="cover-chip-link"${act('click', 'showPage', 'excess')}>FULL REPORT ↗</button>
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

  const strHeroHtml = _strHeroHtml();

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

  const GROUP_HERO = { Sales: heroHtml, Manager: managerHeroHtml, Closing: closingHeroHtml, Inventory: inventoryHeroHtml, 'STR Report': strHeroHtml, 'Notes & Sheets': notesHeroHtml };
  // New home for the old per-tile "Bridge" button: one ↻ on each
  // bridge-backed group's own header, force-refreshing past the normal
  // 5-min cache — available regardless of whether that group's body is
  // collapsed, instead of being buried inside a tile that no longer exists.
  const GROUP_BRIDGE_REFRESH = {
    Sales: () => SalePaymentsBridge.refreshFullData(true),
    Closing: () => ClosingBridge.refresh(true),
    Audit: () => AuditBridge.refresh(true),
    Inventory: () => InventoryBridge.refreshFullData(true),
    'STR Report': () => StrBridge.refreshFullData(true),
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
          <div class="cover-group-drag" data-drag-handle="${meta.slug}" title="Drag to reorder"${act('click', { stop: true }, 'noop')}>⠿</div>
          <div class="cover-group-icon">${meta.icon}</div>
          <div class="cover-group-head-text">
            <div class="cover-group-title">${_esc(groupName)}</div>
            ${subtitle ? `<div class="cover-group-subtitle">${_esc(subtitle)}</div>` : ''}
          </div>
          ${refreshFn ? `<button type="button" class="cover-group-refresh" data-bridge-refresh="${_esc(groupName)}" title="Refresh ${_esc(groupName)} data now"${act('click', { stop: true }, 'noop')}>↻</button>` : ''}
          <div class="cover-group-line"></div>
          <div class="cover-group-chevron">▾</div>
          <button type="button" class="cover-sheet-close" data-sheet-close aria-label="Close ${_esc(groupName)}">✕</button>
        </div>
        <div class="cover-group-body"><div>
          ${GROUP_HERO[groupName] || ''}
          ${groupName === 'Manager' ? _staffRegistryHtml() : ''}
          ${showTiles ? `<div class="cover-tile-grid">${members.map(({ t, i }) => tileCardHtml(t, i)).join('')}</div>` : ''}
        </div></div>
      </div>`;
  }).join('');

  container.innerHTML = groupsHtml;
  container.removeAttribute('aria-busy'); container.removeAttribute('aria-label');
  _applyView();
  const deckEl = document.getElementById('cover-deck');
  if (deckEl) { deckEl.innerHTML = _deckHtml(_orderedGroupNames().filter(nm => container.querySelector('.cover-group[data-group="' + (GROUP_META[nm] || {}).slug + '"]'))); deckEl.removeAttribute('aria-busy'); }
  if (_deckOpenSlug) { const keep = _deckOpenSlug; _deckOpenSlug = null; _openDeck(keep); }
  _wireDeck();
  _renderKpiRow();
  // IC Herald (js/herald/) replaces the old narrow attention-strip chip
  // row — same #cover-herald mount point index.html now provides, but
  // covering every desk (Sales/Manager/Closing/Inventory/Audit) instead
  // of just the rule-engine + hand-rolled inventory/credit/pace checks
  // _needsAttention() used to combine. Guarded the same way every other
  // cross-module Cover call already is (renderCoverDashboard itself,
  // closingBridgeRefresh, etc.) since herald-page.js loads after this file.
  if (typeof window.renderICHerald === 'function') window.renderICHerald();
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
      if (_getView() === 'summary') return;
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
  _wireCollapseToggle();
  _updateCollapseToggleLabel();
  _wireGroupDragReorder();
  container.querySelectorAll('[data-bridge-refresh]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const fn = GROUP_BRIDGE_REFRESH[btn.dataset.bridgeRefresh];
      if (!fn) return;
      // Audit Hub paused: a manual refresh tap is an explicit Resume (the gate then does one catch-up fetch).
      if (window.btHubGate && window.btHubGate.isPaused()) { window.btHubGate.resume(); return; }
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

  if (!_salePaymentsRefreshInFlight) {
    _salePaymentsRefreshInFlight = true;
    SalePaymentsBridge.refreshFullData(false).finally(() => { _salePaymentsRefreshInFlight = false; });
  }

  if (!_strRefreshInFlight) {
    _strRefreshInFlight = true;
    StrBridge.refreshFullData(false).finally(() => { _strRefreshInFlight = false; });
  }
}

_applyView();
window.renderCoverDashboard = renderCoverDashboard;
// nav-sections.js (classic script, not a module) reads this to mirror
// Cover's own drag-reordered group sequence in the All Sections menu —
// see its header comment for the domain-group -> Cover-slug mapping.
window.btGetCoverOrder = _getOrder;
// status-bar.js (classic script, not a module) reads these two so the
// persistent top status bar shows exactly the same Total Outstanding
// Credit / Today's Sale figures as Cover's own hero cards, computed by
// the exact same helpers — never a second, possibly-disagreeing copy.
window._totalOutstandingCredits = _totalOutstandingCredits;
window._todaySaleBreakdown = _todaySaleBreakdown;
