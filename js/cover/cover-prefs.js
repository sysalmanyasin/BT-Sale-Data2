// COVER DASHBOARD — preferences, month/date helpers and stored layout choices (pins, collapsed groups, thresholds, order, view).

import { DAILY, n } from '../platform/config.js';
import { Repository } from '../platform/repository.js';

const TGT_KEY = 'bt_targets';
export const MONTH_NAMES = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
export const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];


export function _currentMonthYear() {
  const d = new Date();
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}
export function _isoMonthPrefix() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
export function _daysInMonth(y, mi) { return new Date(y, mi + 1, 0).getDate(); }

export function _dailyDateVal(dateStr) {
  const [dd, mon, yyyy] = String(dateStr || '').split('/');
  const mi = MONTH_SHORT.indexOf(mon);
  return (parseInt(yyyy, 10) || 0) * 10000 + (mi >= 0 ? mi : 0) * 100 + (parseInt(dd, 10) || 0);
}

export function _lastFilledDay(monthYear) {
  return Math.max(0, ...DAILY
    .filter(d => n(d.TOTAL) > 0 && d.Month_Year === monthYear)
    .map(d => parseInt((d.Date || '').split('/')[0], 10) || 0));
}

export function _getTargets() {
  try { return JSON.parse(Repository.getItem(TGT_KEY) || '{}'); } catch (e) { return {}; }
}

const PIN_KEY = 'bt_cover_pins_v1';
const COLLAPSE_KEY = 'bt_cover_collapsed_v1';
const TOPRUN_WINDOW_KEY = 'bt_cover_toprun_window_v1';
const TOPRUN_COUNT_KEY = 'bt_cover_toprun_count_v1';
const REORDER_THRESHOLD_KEY = 'bt_cover_reorder_threshold_v1';
const REORDER_WINDOW_KEY = 'bt_cover_reorder_window_v1';
export function _getReorderThreshold() {
  const v = parseInt(Repository.getItem(REORDER_THRESHOLD_KEY), 10);
  return [7, 14, 30].indexOf(v) !== -1 ? v : 30;
}
export function _setReorderThreshold(v) { try { Repository.setItem(REORDER_THRESHOLD_KEY, String(v)); } catch (e) { console.warn('[cover-dashboard] _setReorderThreshold', e); } }
export function _getReorderWindow() {
  const v = parseInt(Repository.getItem(REORDER_WINDOW_KEY), 10);
  return [30, 60, 90].indexOf(v) !== -1 ? v : 60;
}
export function _setReorderWindow(v) { try { Repository.setItem(REORDER_WINDOW_KEY, String(v)); } catch (e) { console.warn('[cover-dashboard] _setReorderWindow', e); } }
export function _getTopRunWindow() {
  const v = parseInt(Repository.getItem(TOPRUN_WINDOW_KEY), 10);
  return [30, 60, 90].indexOf(v) !== -1 ? v : 30;
}
export function _setTopRunWindow(v) { try { Repository.setItem(TOPRUN_WINDOW_KEY, String(v)); } catch (e) { console.warn('[cover-dashboard] _setTopRunWindow', e); } }
export function _getTopRunCount() {
  const v = parseInt(Repository.getItem(TOPRUN_COUNT_KEY), 10);
  return [10, 20].indexOf(v) !== -1 ? v : 10;
}
export function _setTopRunCount(v) { try { Repository.setItem(TOPRUN_COUNT_KEY, String(v)); } catch (e) { console.warn('[cover-dashboard] _setTopRunCount', e); } }
// Every group slug that exists today (must mirror GROUP_META's .slug values
// below). Used only to seed the very first render — once a user has
// expanded/collapsed anything, their real stored preference (even an empty
// array, meaning "everything expanded") always wins over this default.
const ALL_GROUP_SLUGS = ['sales', 'manager', 'notes', 'closing', 'audit', 'inventory', 'str', 'reports'];
export function _getPins() { try { return JSON.parse(Repository.getItem(PIN_KEY) || '[]'); } catch (e) { return []; } }
export function _setPins(arr) { try { Repository.setItem(PIN_KEY, JSON.stringify(arr)); } catch (e) { console.warn('[cover-dashboard] _setPins', e); } }
export function _getCollapsed() {
  try {
    const raw = Repository.getItem(COLLAPSE_KEY);
    if (raw == null) { _setCollapsed(ALL_GROUP_SLUGS); return ALL_GROUP_SLUGS.slice(); }
    return JSON.parse(raw || '[]');
  } catch (e) { return ALL_GROUP_SLUGS.slice(); }
}
export function _setCollapsed(arr) { try { Repository.setItem(COLLAPSE_KEY, JSON.stringify(arr)); } catch (e) { console.warn('[cover-dashboard] _setCollapsed', e); } }

// Ordered by decision-urgency, not by module — things that need action
// today (stock problems, cash/credit) come before performance tracking,
// which comes before compliance, which comes before pure navigation/
// reference material. The "Needs Attention" strip above still surfaces
// the single most urgent items regardless of this order; this just makes
// the full scroll match the same priority.
// "Quick Access" (PDF Library) was dropped entirely — it had no hero
// content of its own, just a single shortcut tile, which Cover no longer
// renders; PDF Library still lives in the bottom nav / All Sections menu.
export const GROUP_ORDER = ['Inventory', 'STR Report', 'Manager', 'Closing', 'Sales', 'Reports', 'Notes & Sheets', 'Audit'];
export const GROUP_META = {
  'Sales':           { slug: 'sales',   icon: '📊' },
  'Manager':         { slug: 'manager', icon: '👔' },
  'Notes & Sheets':  { slug: 'notes',   icon: '📑' },
  'Closing':         { slug: 'closing', icon: '🔒' },
  'Audit':           { slug: 'audit',   icon: '🧾' },
  'Inventory':       { slug: 'inventory', icon: '📦' },
  'STR Report':      { slug: 'str',     icon: '📋' },
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
export function _getOrder() {
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
    // De-dupe first — a slug that somehow got written twice into a saved
    // order (e.g. "manager" appearing twice) used to render its Cover
    // card twice forever, since the old logic below only ever *added*
    // missing slugs and *removed* unknown ones, never collapsed repeats
    // of a slug that was already known-good.
    saved = [...new Set(saved)];
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
export function _setOrder(arr) { try { Repository.setItem(ORDER_KEY, JSON.stringify(arr)); } catch (e) { console.warn('[cover-dashboard] _setOrder', e); } }
// Resolves the saved slug order back to group names for renderCoverDashboard's
// own iteration — GROUP_ORDER itself is left untouched as the permanent
// "this is the full known set" default/reconciliation source, same role
// ALL_GROUP_SLUGS plays for collapse state.
// ── Summary / Detailed view (Cover "Command Deck") ───────────────────────────
// Summary (default): the page is one short screen — KPIs, Herald, pins, then one colour-coded tile
// per section. Tapping a tile opens THAT SECTION'S EXISTING GROUP as a bottom sheet (the same
// .cover-group element, so every card/button/handler is unchanged and nothing can drift).
// Detailed: the classic long page. The choice persists via Repository (synced like other Cover prefs).
const VIEW_KEY = 'bt_cover_view_v1';
export function _getView() {
  try { return Repository.getItem(VIEW_KEY) === 'detailed' ? 'detailed' : 'summary'; } catch (e) { return 'summary'; }
}
export function _setView(v) { try { Repository.setItem(VIEW_KEY, v === 'detailed' ? 'detailed' : 'summary'); } catch (e) { console.warn('[cover-dashboard] _setView', e); } }
