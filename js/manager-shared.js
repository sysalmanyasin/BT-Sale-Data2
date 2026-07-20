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

Object.assign(window, { MGR_KEY, mgrLoad, mgrSave, mgrMonths, _mgrPopSel, _ni, _fc2, _inp });

export { MGR_KEY, mgrLoad, mgrSave, mgrMonths, _mgrPopSel, _ni, _fc2, _inp };
