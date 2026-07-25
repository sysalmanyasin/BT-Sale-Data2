// ══════════════════════════════════════════════════════════════════════
// MANAGER — SHARED  (ES module, split from the old manager.js monolith)
//
// Utilities every Manager sub-tab (Staff/Salary/Generic/Credit/Petty/
// Incentive/Unmatched) depends on: the MGR_KEY feature-data blob,
// month-list building, and small formatting/DOM helpers.
//
// Every export here is also bridged onto `window` — not because this
// file needs it, but because index.html's generated HTML still uses
// inline oninput="..."/onclick="..." attributes (looked up as bare
// globals at click-time, never through an import), and several sibling
// files (ai-bridge.js, custom-sections.js, jazz-cash.js, notes-sheets.js)
// are still classic scripts that reference these as bare globals too.
// Same temporary-bridge pattern as config.js/repository.js — remove the
// bridge once every consumer is itself a module that imports directly.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { MONTHLY, months } from './config.js';

const MGR_KEY = 'BT_ManagerWork_v1';

// Routed through Repository (Floor 1) instead of calling localStorage
// directly — closes the gap where drive.js and supabase.js were
// independently reading/writing this same key with their own raw
// localStorage calls (the same "many doors" pattern fixed for sales
// data, now closed for Manager Work too).
function mgrLoad() {
  try { return JSON.parse(Repository.getItem(MGR_KEY)) || {}; } catch(e) { return {}; }
}
function mgrSave(data) { Actions.saveFeatureData(MGR_KEY, JSON.stringify(data)); }

// Returns a continuous newest-first month list, so blank months do not disappear.
function mgrMonths() {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const toVal = my => {
    const p = String(my || '').split(' ');
    const mi = names.indexOf(p[0]);
    const yr = parseInt(p[1], 10);
    return mi >= 0 && !isNaN(yr) ? yr * 12 + mi : null;
  };
  const toLabel = val => names[val % 12] + ' ' + Math.floor(val / 12);
  const seen = new Set();

  months().forEach(m => seen.add(m));
  MONTHLY.forEach(m => { if (m.Month_Year) seen.add(m.Month_Year); });

  try {
    const mgr = mgrLoad();
    ['salary','generic','expense','credit'].forEach(k => Object.keys(mgr[k] || {}).forEach(m => seen.add(m)));
  } catch(e) {}
  try {
    Repository.getKeysByPrefix('mw_petty_').forEach(k => seen.add(k.slice('mw_petty_'.length)));
    Repository.getKeysByPrefix('mw_incentive_').forEach(k => seen.add(k.slice('mw_incentive_'.length)));
  } catch(e) {}
  try {
    const all = typeof _csecLoad === 'function' ? _csecLoad() : JSON.parse(Repository.getItem('mw_custom_sections_v1') || '{}');
    Object.values(all || {}).forEach(sec => Object.keys((sec && sec.months) || {}).forEach(m => seen.add(m)));
  } catch(e) {}

  const now = new Date();
  const currentVal = now.getFullYear() * 12 + now.getMonth();
  for (let delta = -1; delta <= 0; delta++) {
    const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
    seen.add(names[d.getMonth()] + ' ' + d.getFullYear());
  }

  const vals = Array.from(seen).map(toVal).filter(v => v != null && v <= currentVal);
  if (!vals.length) return [];
  const min = Math.min(...vals);
  const max = Math.min(currentVal, Math.max(...vals));
  const out = [];
  for (let v = max; v >= min; v--) out.push(toLabel(v));
  return out;
}

function _mgrPopSel(selId, current) {
  const el = document.getElementById(selId);
  if (!el) return;
  const mons = mgrMonths();
  el.innerHTML = mons.map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${m}</option>`).join('');
}



// ─── helpers ───────────────────────────────────────────────────────
function _ni(v) { return Math.round(Number(v) || 0); }
function _fc2(v) { return _ni(v).toLocaleString('en-PK'); }
function _inp(type, val, cls, oninput, ph) {
  return `<input type="${type}" value="${val}" class="mgr-inp${cls ? ' ' + cls : ''}" placeholder="${ph||''}" ${oninput ? 'oninput="' + oninput + '"' : ''}>`;
}

// ─── staff-row reconciliation ─────────────────────────────────────
// Every per-staff month sheet (Salary / Generic / Credit) stores its own
// snapshot of rows, keyed loosely by name. Over time that snapshot can
// drift from the Staff Registry: someone gets removed/renamed in the
// registry but their old row lingers ("orphan"), or the same person ends
// up with two rows (e.g. one row saved before a rename, one after —
// "duplicate"). reconcileStaffRows() is the single place that heals this:
// given the registry's current active list and a sheet's stored rows, it
// (1) merges any duplicate rows for the same person into one, (2) drops
// rows that no longer match anyone active in the registry, and (3) adds a
// fresh blank row for any active staff member missing one — always
// returned in registry (Sr#) order, so Salary/Generic/Credit and the
// Staff Registry itself always show the exact same people.
function _rsrNorm(s) { return (s || '').trim().toLowerCase(); }
function _mergeStaffRow(a, b) {
  const out = { ...a };
  Object.keys(b).forEach(k => {
    const av = out[k], bv = b[k];
    if (Array.isArray(bv)) { out[k] = [...(Array.isArray(av) ? av : []), ...bv]; return; }
    if (typeof bv === 'number') { out[k] = _ni(av) + _ni(bv); return; }
    if (av === undefined || av === null || av === '') out[k] = bv;
  });
  return out;
}
function reconcileStaffRows(activeList, storedRows, blankFactory) {
  const rows = Array.isArray(storedRows) ? storedRows : [];
  const byId = new Map();
  const byName = new Map();
  rows.forEach(r => {
    if (r.staffId) {
      byId.set(r.staffId, byId.has(r.staffId) ? _mergeStaffRow(byId.get(r.staffId), r) : r);
    }
    const key = _rsrNorm(r.name);
    if (key) byName.set(key, byName.has(key) ? _mergeStaffRow(byName.get(key), r) : r);
  });
  return (activeList || []).map(emp => {
    const key = _rsrNorm(emp.name);
    const match = (emp.staffId && byId.get(emp.staffId)) || byName.get(key);
    return match
      ? { ...match, name: emp.name, staffId: emp.staffId || match.staffId }
      : blankFactory(emp);
  });
}

Object.assign(window, { MGR_KEY, mgrLoad, mgrSave, mgrMonths, _mgrPopSel, _ni, _fc2, _inp, reconcileStaffRows });

export { MGR_KEY, mgrLoad, mgrSave, mgrMonths, _mgrPopSel, _ni, _fc2, _inp, reconcileStaffRows };
