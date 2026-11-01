// COVER DASHBOARD — Closing / Audit / Inventory status lines, online-staff badge and the closing-sheet helpers they use.

import { n, fc } from '../platform/config.js';
import * as ClosingBridge from '../closing/closing-bridge.js';
import * as AuditBridge from '../audit/audit-bridge.js';
import * as InventoryBridge from '../inventory/inventory-bridge.js';
import { MONTH_SHORT } from './cover-prefs.js';

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
export function _closingStatus() {
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

export function _auditStatus() {
  const summary = AuditBridge.getCachedSummary();
  if (!summary) return 'Live inventory audit — Fazal Din\u2019s Pharma Plus';
  if (!summary.items.length) return 'No open engagements';
  return summary.items.map(it =>
    it.name + ' — ' + it.roundState + (it.assigned ? ' (' + it.submitted + '/' + it.assigned + ' submitted)' : '')
  ).join('  ·  ');
}

export function _inventoryStatus() {
  const data = InventoryBridge.getFullData();
  if (!data) return 'Live from Random — Supabase-synced inventory';
  if (!data.products.length) return 'No inventory synced yet';
  const syncedLabel = data.lastSync
    ? 'last sync ' + new Date(data.lastSync.syncedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })
    : 'synced ' + new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  return data.products.length.toLocaleString() + ' item(s) · ' + syncedLabel;
}

export function _clFmtDate(ds) { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ds; } }
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
  // Mirrors Closing app's own aggregateSinceLastFinal (js/pages.js / js/platform/actions.js):
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

export function _closingLatestSummary() {
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

export function _closingLatestCredit() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Credit', value: 'Waiting for Closing…', sub: '' };
  const latest = _latestRealSheet(cdb);
  if (!latest) return { label: 'Latest Credit', value: 'No credit records', sub: '' };
  const rec = latest.rec;
  const credit = n(rec.outTotalE);
  return { label: 'Latest Credit', value: '₨ ' + fc(credit), sub: `${_clFmtDate(latest.date)} · ${latest.shift}` };
}

export function _closingLatestMisc() {
  const cdb = ClosingBridge.getFullDb();
  if (!cdb) return { label: 'Latest Misc / Ongoing', value: 'Waiting for Closing…', sub: '' };
  const keys = Object.keys(cdb.sheets || {}).filter(k => { const r = cdb.sheets[k]; return r && r.draft !== true && Array.isArray(r.miscRows) && r.miscRows.length; });
  if (!keys.length) return { label: 'Latest Misc / Ongoing', value: 'No misc entries', sub: '' };
  keys.sort((a, b) => _sheetSortKey(cdb, a).localeCompare(_sheetSortKey(cdb, b)));
  const key = keys[keys.length - 1]; const rec = cdb.sheets[key]; const parts = key.split('_'); const date = parts[0], shift = parts[1];
  const total = (rec.miscRows || []).reduce((s, r) => s + (parseFloat(r.val) || 0), 0);
  return { label: 'Latest Misc / Ongoing', value: '₨ ' + fc(total), sub: `${_clFmtDate(date)} · ${shift}` };
}
