// REORDER REPORT — settings, shared state, row computation (cover days, flags) and the in-transit / StockLedger refresh.

const WINDOW_KEY = 'bt_reorder_window_v1';
const COVERDAYS_KEY = 'bt_reorder_coverdays_v1';
const MIGRATED_60_30_KEY = 'bt_reorder_migrated_60_30_v1';
const TOPN_KEY = 'bt_reorder_topn_v1';
const GROUP_KEY = 'bt_reorder_group_v1';
const INCLUDETODAY_KEY = 'bt_reorder_includetoday_v1';
const HIDDENCOLS_KEY = 'bt_reorder_hiddencols_v1';

export const WINDOWS = [30, 60, 90];

// In-transit qty per product code (2026-08 addition): STR lines
// inbound to BT (direction 'in') whose header is currently in the
// Dispatched stage — physically moving, not just requested (Awaited,
// packDispatchQty is 0 by definition) and not yet arrived (Received,
// already landed in stock so no longer "in transit"). Dispatched-only
// by deliberate decision — see buildInTransitMap(). Module-scope, not
// part of `state`, since it's rebuilt from StrBridge rather than
// persisted, and computeAllRows() reads it directly (same pattern as
// reading window.StockLedgerApp) rather than threading it through
// every call site (getFlaggedRowsFor/getSummaryFor included).
let inTransitByCode = {};

export const state = {
  tab: 'topn',            // 'topn' | 'all'
  window: 90,              // primary window: 30 | 60 | 90
  coverDays: 15,            // "less than N days stock" threshold
  topN: 50,
  search: '',
  groupBySupplier: false,
  includeToday: true,      // fold today's live sales into the w-day window (toggle) — see header note
  collapsedGroups: new Set(),
  sort: { key: 'saleValueP', dir: -1 },
  hiddenCols: new Set(),    // column keys currently hidden from the table AND the print view
  colsMenuOpen: false,      // transient (not persisted) — whether the Columns dropdown is open
  rawRows: [],
  computed: [],             // every qualifying row (no Top N cap)
  asOf: '',
  dataReady: false,
};

// ---------- helpers ----------
export function $(sel, ctx) { return (ctx || document).querySelector(sel); }
export function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
export function fmt(n) { return (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
export function fmtDays(v) { if (v == null) return '—'; if (!isFinite(v)) return '∞'; return (Math.round(v * 10) / 10).toLocaleString('en-PK'); }
export function todayStamp() { return new Date().toISOString().slice(0, 10); }
export function say(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type); }

function repoGet(key) {
  try { return window.Repository ? window.Repository.getItem(key) : localStorage.getItem(key); }
  catch (e) { return null; }
}
function repoSet(key, value) {
  try { if (window.Repository) window.Repository.setItem(key, value); else localStorage.setItem(key, value); }
  catch (e) { /* ignore */ }
}

export function loadSettings() {
  const w = parseInt(repoGet(WINDOW_KEY), 10);
  state.window = WINDOWS.indexOf(w) !== -1 ? w : 60;
  const cd = parseFloat(repoGet(COVERDAYS_KEY));
  state.coverDays = (cd && cd > 0) ? cd : 30;
  // One-time migration (2026-07-31): this page's Window/Cover controls
  // are user-adjustable and persist per browser, so a browser that had
  // already saved an old value (e.g. 30d/7d from before Cover's
  // 60d-velocity/30d-cover convention existed) would otherwise keep
  // silently diverging from Cover forever — the "different numbers,
  // same engine" mismatch this was reported for. Runs once per
  // browser; any Window/Cover change made after this still sticks,
  // same as before.
  if (repoGet(MIGRATED_60_30_KEY) !== '1') {
    state.window = 60;
    state.coverDays = 30;
    repoSet(WINDOW_KEY, '60');
    repoSet(COVERDAYS_KEY, '30');
    repoSet(MIGRATED_60_30_KEY, '1');
  }
  const tn = parseInt(repoGet(TOPN_KEY), 10);
  state.topN = (tn && tn > 0) ? tn : 50;
  state.groupBySupplier = repoGet(GROUP_KEY) === '1';
  const it = repoGet(INCLUDETODAY_KEY);
  state.includeToday = (it === null) ? true : (it === '1'); // default on, matches pre-toggle behavior
  const hc = repoGet(HIDDENCOLS_KEY);
  state.hiddenCols = new Set(hc ? hc.split(',').filter(Boolean) : []);
}
export function saveWindow() { repoSet(WINDOW_KEY, String(state.window)); }
export function saveCoverDays() { repoSet(COVERDAYS_KEY, String(state.coverDays)); }
export function saveTopN() { repoSet(TOPN_KEY, String(state.topN)); }
export function saveGroup() { repoSet(GROUP_KEY, state.groupBySupplier ? '1' : '0'); }
export function saveIncludeToday() { repoSet(INCLUDETODAY_KEY, state.includeToday ? '1' : '0'); }
export function saveHiddenCols() { repoSet(HIDDENCOLS_KEY, Array.from(state.hiddenCols).join(',')); }

// ---------- CALCULATION ENGINE ----------
// Computes every window's metrics for every raw row, unfiltered.
// coverDays is still needed here even though nothing gets filtered on
// it in this function — demandQty (how much to buy to reach the
// target cover) is computed per-row against it.
// 2026-07-30 update: sale windows now include today's live activity,
// not just the clean w-day historical figure. sync.ps1 / the
// inventory sync deliberately keeps netQtyWDays / saleValueExclTaxWDays
// ending at yesterday 23:59:59 (so those numbers stay stable no matter
// what time of day a sync runs), and reports today's sales separately
// as netQtyToday / saleValueExclTaxToday. Reorder Report needs the
// opposite property — the most current demand signal, right now — so
// it adds the two together here. They never overlap (the w-day window
// stops at yesterday, "today" starts at today 00:00), so this is a
// straight sum, not double-counting.
//
// The daily rate then divides by effectiveDays = w + todayFraction
// (how much of today has elapsed, e.g. 0.5 at noon) instead of plain
// w — dividing today's partial-day sales by a whole extra day would
// understate the rate early in the day and overstate it as the day
// goes on. This is what "daysCover"/"demandQty" are computed from, so
// this is the fix that makes the actual buy-quantity recommendation
// correct, not just the sale-qty/value columns.
//
// includeToday (toggle added after user feedback that this should be
// switchable, not fixed on): when true, behaves exactly as described
// above. When false, every window's saleQty/saleValue/daysCover/
// demandQty is the clean historical figure only (today's activity
// excluded from the fold-in, effectiveDays back to plain w) — this is
// what matches Candela's own C-19 report, which runs off historical
// windows only. The "Sold Today" column (saleQtyToday/saleValueToday)
// always reflects real today's activity regardless of this toggle —
// it's an informational figure, not part of the filtered/ranked math.
export function computeAllRows(rawRows, primaryWindow, coverDays, includeToday) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayFraction = Math.min(1, Math.max(0, (now - startOfToday) / 86400000));
  const foldToday = includeToday !== false; // default true — matches pre-toggle behavior

  const rows = rawRows.map(r => {
    const stock = Number(r.stock) || 0;
    const unitPrice = Number(r.unitPrice) || 0;
    const isTaxable = !!r.isTaxable;

    // Which historical field is the "real" sale value for this row:
    // taxable items should show the customer-facing, tax-inclusive
    // figure; tax-exempt items show the (identical either way, but
    // named correctly) tax-exclusive figure. Non-taxable rows have
    // InclTax === ExclTax anyway (see inventory-bridge.js's header
    // note), so this only changes which field name is read for
    // taxable rows — it's not a numeric change for exempt items like
    // Panadol, just the correct field for ones that do carry VAT.
    const valueField = isTaxable ? 'saleValueInclTax' : 'saleValueExclTax';

    const todayQty = Number(r.netQtyToday) || 0;
    // Same "prefer real computed value, fall back to qty × unitPrice
    // only if the field is genuinely absent" pattern as the w-day
    // windows below — undefined/null means "field predates this sync",
    // not "zero sales today". Computed regardless of includeToday —
    // it's what "Sold Today" always displays, and it's what the
    // window fold-in adds in when the toggle is on.
    const rawTodayValue = r[valueField + 'Today'];
    const todayValue = (rawTodayValue !== undefined && rawTodayValue !== null)
      ? Number(rawTodayValue)
      : todayQty * unitPrice;

    // What actually gets folded into the window math — zeroed out
    // when the toggle is off, so saleQty/saleValue below reduce to
    // the pure historical figures.
    const foldQty = foldToday ? todayQty : 0;
    const foldValue = foldToday ? todayValue : 0;

    const out = {
      code: r.code || '', name: r.name || '',
      supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unspecified',
      company: r.company || '',
      stock, unitPrice,
      inTransitQty: (inTransitByCode[r.code] || 0),
      saleQtyToday: todayQty,
      saleValueToday: todayValue,
      isTaxable,
      taxPercent: Number(r.taxPercent) || 0,
    };
    WINDOWS.forEach(w => {
      const historicalQty = Number(r['netQty' + w + 'Days']) || 0;
      // Prefer the real historical sale value (qty × pack-aware,
      // discount-adjusted price) computed server-side in sync.ps1,
      // reading the incl-tax field for taxable products and the
      // excl-tax field for exempt ones (see valueField above). Falls
      // back to qty × current unit price only for rows that predate
      // this field (e.g. an older cached Dropbox upload) — undefined/
      // null means "field never existed on this row", not "zero
      // sales", so it's checked explicitly rather than with a falsy
      // check (0 is a legitimate real value here).
      const rawSaleValue = r[valueField + w + 'Days'];
      const historicalValue = (rawSaleValue !== undefined && rawSaleValue !== null)
        ? Number(rawSaleValue)
        : historicalQty * unitPrice;

      const saleQty = historicalQty + foldQty;
      const saleValue = historicalValue + foldValue;
      const windowEffectiveDays = w + (foldToday ? todayFraction : 0);
      const dailyRate = saleQty / windowEffectiveDays;
      const daysCover = dailyRate > 0 ? (stock / dailyRate) : null;
      const demandQty = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0;

      out['saleQty' + w] = saleQty;
      out['saleQty' + w + 'Historical'] = historicalQty; // pre-today reference, e.g. for exports
      out['saleValue' + w] = saleValue;
      out['saleValue' + w + 'Historical'] = historicalValue;
      out['daysCover' + w] = daysCover;
      out['demandQty' + w] = demandQty;
    });
    out.saleQtyP = out['saleQty' + primaryWindow];
    out.saleValueP = out['saleValue' + primaryWindow];
    out.daysCoverP = out['daysCover' + primaryWindow];
    out.demandQtyP = out['demandQty' + primaryWindow];
    out.demandValueP = out.demandQtyP * unitPrice;
    return out;
  });
  return rows;
}

// Cover-days filter, applied as its own explicit stage so callers can
// choose whether to run it before or after ranking/capping. Qualifies
// only if it actually sold something in the primary window (no rate,
// no meaningful "days cover") AND that cover is under the threshold —
// zero (or negative, e.g. a backorder) stock included on purpose,
// that's the most urgent case.
export function lowCoverWithin(rows, coverDays) {
  return rows.filter(r => r.saleQtyP > 0 && r.daysCoverP != null && r.daysCoverP < coverDays);
}

export function recompute() {
  const coverDays = Number(state.coverDays) || 15;
  const allRows = computeAllRows(state.rawRows, state.window, coverDays, state.includeToday);
  // "All Flagged" tab: every item under the cover threshold, unranked
  // and uncapped — a broader diagnostic view, not meant to reproduce
  // Candela's own report (see header comment).
  state.computed = lowCoverWithin(allRows, coverDays);
  // "Top N" tab: Candela's own order — rank ALL items by sale value,
  // cap at Top N, THEN filter that capped pool by cover days.
  state.topNFlagged = lowCoverWithin(topNByValue(allRows, state.topN), coverDays);
}

// Reads whatever StrBridge already has cached (sync, no network) —
// str-bridge.js is a real ES module and doesn't export str-shared.js's
// stage-derivation helpers to `window`, so the Dispatched-stage check
// (receiveStatus !== 'Received' && dispatchStatus === 'Dispatched') is
// reimplemented inline here rather than imported; kept identical to
// str-shared.js's strStage() so the two never drift on what
// "Dispatched" means.
function buildInTransitMap(data) {
  const map = {};
  if (!data || !Array.isArray(data.headers) || !Array.isArray(data.lineItems)) return map;
  const dispatchedInStrIds = new Set(
    data.headers
      .filter(h => h.direction === 'in' && h.dispatchStatus === 'Dispatched' && h.receiveStatus !== 'Received')
      .map(h => h.strId)
  );
  data.lineItems.forEach(li => {
    if (!li.productCode || !dispatchedInStrIds.has(li.strId)) return;
    const factorRaw = Number(data.packFactorByCode && data.packFactorByCode[li.productCode]);
    const factor = (factorRaw && factorRaw > 0 && Number.isFinite(factorRaw)) ? factorRaw : 1;
    const packQty = Math.floor((Number(li.dispatchQty) || 0) / factor);
    map[li.productCode] = (map[li.productCode] || 0) + packQty;
  });
  return map;
}

export function refreshInTransitMap() {
  const data = (typeof window.strBridgeGetFullData === 'function') ? window.strBridgeGetFullData() : null;
  inTransitByCode = buildInTransitMap(data);
}

// Ranks by sale value and caps at N. Only items that actually sold in
// the primary window are eligible to be ranked — previously this was
// guaranteed upstream by computeRows()'s own filter; now that ranking
// can run over the full unfiltered row set (see recompute()), the
// guard has to live here instead.
export function topNByValue(rows, n) {
  return rows.filter(r => r.saleQtyP > 0)
    .sort((a, b) => b.saleValueP - a.saleValueP)
    .slice(0, Math.max(1, n || 50));
}
