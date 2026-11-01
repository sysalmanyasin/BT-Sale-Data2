// COVER DASHBOARD — STR Report hero: received value, awaited, dispatched and inbound cards.

import { fc } from '../platform/config.js';
import * as StrBridge from '../str/str-bridge.js';
import * as StrShared from '../str/str-shared.js';
import { escapeHtml as _esc } from '../shared/html.js';
import { act } from '../shared/dom-actions.js';

// ── STR Report hero (Cover, Aug 2026) — four glance cards built on the
// exact same read-only StrBridge.getFullData() + str-shared.js stage/
// direction helpers that str-native.js/str/str-report-native.js/
// str-zero-dispatch.js already use, so "awaited"/"dispatched" and which
// side of a transfer Bahria Town is on can never drift from what those
// pages show for the same STR. StrBridge only ever holds a rolling
// last-7-days window (see that file's header note) — that's a property
// of the source sync, not something this hero re-derives or extends.
export function _strData() {
  try { return StrBridge.getFullData(); } catch (e) { console.error('Cover Dashboard: StrBridge.getFullData() failed', e); return null; }
}

// Card 1 — received value per day, retail price (same R.Price field
// every other STR screen shows) × receive qty, summed per receiveDate,
// only for STRs actually marked Received at BT (direction 'in'). Only
// days that actually have received stock are returned — a quiet day is
// omitted rather than shown as a zero row.
function _strReceivedByDay(data) {
  if (!data) return [];
  const byDate = new Map();
  data.headers
    .filter(h => StrShared.isReceivedAtBT(h) && h.receiveStatus === 'Received' && h.receiveDate)
    .forEach(h => {
      const value = StrShared.lineItemsForStr(data, h.strId)
        .reduce((s, li) => s + (Number(li.receiveQty) || 0) * (Number(li.productPrice) || 0), 0);
      byDate.set(h.receiveDate, (byDate.get(h.receiveDate) || 0) + value);
    });
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
// Read-only bridge for the Daily Check List (js/sales/daily-checklist.js): the same
// "Stock Received Value" figure the card below shows, for one ISO date. Returns
// null when STR data isn't loaded or the date is older than StrBridge's rolling
// 7-day window (a 0 there would be "unknown", not "nothing received").
window.btStrReceivedValueOn = function (iso) {
  const data = _strData();
  if (!data || !iso) return null;
  const o = new Date(); o.setDate(o.getDate() - 6);
  const oldest = o.getFullYear() + '-' + String(o.getMonth() + 1).padStart(2, '0') + '-' + String(o.getDate()).padStart(2, '0');
  if (iso < oldest) return null;
  const hit = _strReceivedByDay(data).find(d => d.date === iso);
  return hit ? hit.value : 0;
};
function _strDayLabel(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { date: dateStr, day: '' };
  return {
    date: d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }),
    day: d.toLocaleDateString('en-PK', { weekday: 'long' }),
  };
}

// Cards 2/3/4 — same three-stage lifecycle str-native.js badges use
// (strStage), split by direction (isDispatchedFromBT / isReceivedAtBT).
// Card 2: created at BT, not dispatched out yet. Card 3: dispatched out
// of BT, not yet received wherever it's going. Card 4: dispatched from
// a warehouse/other branch (Bahria Town is the *receiving* side), not
// yet received at BT. All three drop an STR the moment it's Received —
// that's the point, these are "still needs chasing" lists.
export function _strAwaitedRows(data) {
  if (!data) return [];
  return data.headers.filter(h => StrShared.isDispatchedFromBT(h) && StrShared.strStage(h) === 'awaited')
    .sort((a, b) => (b.strDate || '').localeCompare(a.strDate || ''));
}
function _strDispatchedFromBTRows(data) {
  if (!data) return [];
  return data.headers.filter(h => StrShared.isDispatchedFromBT(h) && StrShared.strStage(h) === 'dispatched')
    .sort((a, b) => (b.dispatchedDate || b.strDate || '').localeCompare(a.dispatchedDate || a.strDate || ''));
}
function _strInboundPendingRows(data) {
  if (!data) return [];
  return data.headers.filter(h => StrShared.isReceivedAtBT(h) && StrShared.strStage(h) === 'dispatched')
    .sort((a, b) => (b.dispatchedDate || b.strDate || '').localeCompare(a.dispatchedDate || a.strDate || ''));
}

// Shared row renderer for cards 2/3/4 — STR #, date, comment, and (card
// 4 only) which branch it's coming from. Tapping a row jumps to the
// real STR page and opens that exact STR's detail modal (same
// strOpenDetail() the STR list page's own rows use) rather than
// duplicating detail rendering here.
function _strRowsListHtml(rows, opts) {
  opts = opts || {};
  if (!rows.length) return `<div style="font-size:11px;color:var(--muted);padding:8px 0">Nothing here right now.</div>`;
  return `<div style="max-height:230px;overflow-y:auto">${rows.map(h => `
    <div style="padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer"${act('click', 'coverOpenStrDetail', h.strId)}>
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <span style="font-size:12px;font-weight:700;color:var(--text)">${_esc(h.strNumber || ('STR-' + h.strId))}</span>
        <span style="font-size:11px;color:var(--muted);flex-shrink:0">${_esc(StrShared.fmtDate(h.strDate))}</span>
      </div>
      ${opts.showBranch ? `<div style="font-size:11px;color:var(--muted)">from ${_esc(h.dispatchBranch || '—')}</div>` : ''}
      ${h.comments ? `<div style="font-size:11px;color:var(--t2);margin-top:1px">${_esc(h.comments)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function _strReceivedValueCardHtml(data) {
  const days = _strReceivedByDay(data);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  const yEntry = days.find(d => d.date === yStr);
  return `
    <div class="card">
      <div class="ctitle"><span class="cdot" style="background:var(--green)"></span>Stock Received Value — Yesterday</div>
      <div class="cover-hero-value" style="margin:2px 0 10px">₨ ${fc(yEntry ? yEntry.value : 0)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Days with received stock, last 7 days</div>
      ${days.length ? days.map(d => {
        const lbl = _strDayLabel(d.date);
        return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:11.5px">
          <span style="color:var(--text)">${_esc(lbl.date)} <span style="color:var(--muted)">(${_esc(lbl.day)})</span></span>
          <span style="font-weight:700;font-family:var(--mono)">₨ ${fc(d.value)}</span>
        </div>`;
      }).join('') : `<div style="font-size:11px;color:var(--muted);padding:8px 0">No received-stock data in the last 7 days.</div>`}
    </div>`;
}

export function _strStatus() {
  try {
    const data = _strData();
    if (!data) return 'Syncing STR data…';
    const awaited = _strAwaitedRows(data).length;
    const dispBT = _strDispatchedFromBTRows(data).length;
    const inbound = _strInboundPendingRows(data).length;
    return `${awaited} awaited · ${dispBT} dispatched (BT) not received · ${inbound} inbound not received`;
  } catch (e) { console.error('Cover Dashboard: _strStatus failed', e); return ''; }
}

export function _strHeroHtml() {
  try {
    const data = _strData();
    if (!data) {
      return `<div class="cover-skel-row"><div class="cover-skel-card"></div><div class="cover-skel-card"></div></div>`;
    }
    const awaited = _strAwaitedRows(data);
    const dispatchedBT = _strDispatchedFromBTRows(data);
    const inboundPending = _strInboundPendingRows(data);
    return `
    <div class="cover-hero-row cover-hero-row-single">
      ${_strReceivedValueCardHtml(data)}
    </div>
    <div class="cover-hero-row">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--amber)"></span>Awaited — not dispatched (${awaited.length})
          <button type="button" class="cover-chip-link"${act('click', { stop: true }, 'coverOpenStrStage', 'awaited')}>FULL LIST ↗</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin:-4px 0 6px">Dispatch from Bahria Town</div>
        ${_strRowsListHtml(awaited)}
      </div>
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--accent)"></span>Dispatched — not received (${dispatchedBT.length})
          <button type="button" class="cover-chip-link"${act('click', { stop: true }, 'coverOpenStrStage', 'dispatched')}>FULL LIST ↗</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin:-4px 0 6px">Dispatch from Bahria Town</div>
        ${_strRowsListHtml(dispatchedBT)}
      </div>
    </div>
    <div class="cover-hero-row cover-hero-row-single">
      <div class="card">
        <div class="ctitle"><span class="cdot" style="background:var(--pink)"></span>Inbound — dispatched, not received at BT (${inboundPending.length})
          <button type="button" class="cover-chip-link"${act('click', { stop: true }, 'coverOpenStrStage', 'dispatched')}>FULL LIST ↗</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin:-4px 0 6px">Dispatch from warehouse / Warehouse 2 / other branches</div>
        ${_strRowsListHtml(inboundPending, { showBranch: true })}
      </div>
    </div>`;
  } catch (e) {
    console.error('Cover Dashboard: building STR Report hero HTML failed', e);
    return `<div class="cover-hero-row cover-hero-row-single">
      <div class="cover-hero-card"><div class="cover-hero-label">STR Report</div><div class="cover-hero-value">Unavailable</div></div>
    </div>`;
  }
}
