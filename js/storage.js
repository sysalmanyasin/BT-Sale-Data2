// ══════════════════════════════════════════
// NAV
// ══════════════════════════════════════════
// NOTE: _curPage stays a true bare global (not wrapped below) because
// ui.js reassigns it directly (`_curPage = id`), not just reads it —
// wrapping it would silently desync ui.js's writes from this file's
// copy, since a bare reassignment elsewhere would just create a new,
// disconnected window property instead of updating the real binding.
let _curPage = '';

// Read-only getter, safe to bridge to window: this doesn't touch the
// reassignment concern above (ui.js still writes the bare `_curPage`
// directly, in the same shared classic-script scope as before) — it
// just gives modules (which can't see that shared scope at all) a way
// to read the current live value. Added for app-context.js's module
// conversion; harmless to any existing classic-script consumer.
function getCurrentPage() { return _curPage; }
window.getCurrentPage = getCurrentPage;

(function() {
'use strict';

// ══════════════════════════════════════════
// RENDER CACHE (instant tab switching)
// ══════════════════════════════════════════
const _rc = {};  // {page: {key, html}}

function _rcKey(page) {
  if (page === 'index') {
    return (document.getElementById('idx-search')?.value||'') + '|' +
           (document.getElementById('idx-year')?.value||'') + '|' +
           (document.getElementById('idx-sort')?.value||'date') + '|' + MONTHLY.length;
  }
  if (page === 'data') {
    return (document.getElementById('data-search')?.value||'') + '|' +
           (document.getElementById('data-month')?.value||'') + '|' +
           (document.getElementById('data-col')?.value||'TOTAL') + '|' + DAILY.length;
  }
  return null;
}

function invalidateRenderCache() { _rc.index = null; _rc.data = null; }

// ══════════════════════════════════════════
// INDEXEDDB CACHE (persist synced data)
// ══════════════════════════════════════════
const IDB_NAME = 'BT_SalesIC', IDB_VER = 2, IDB_STORE = 'cache';

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = e => res(e.target.result);
    req.onerror    = e => rej(e.target.error);
  });
}

async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror    = e => rej(e.target.error);
    });
  } catch(e) { /* non-fatal */ }
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  } catch(e) { return undefined; }
}

async function idbSaveData() {
  await idbSet('monthly_synced', JSON.stringify(MONTHLY));
  await idbSet('daily_synced',   JSON.stringify(DAILY));
  await idbSet('synced_at', Date.now());
}

async function idbLoadData() {
  try {
    const ms = await idbGet('monthly_synced');
    const ds = await idbGet('daily_synced');
    const at = await idbGet('synced_at');
    if (!ms || !ds) return false;
    // Only use cache if less than 24 hours old
    if (Date.now() - (at||0) > 86400000) return false;
    const mArr = JSON.parse(ms);
    const dArr = JSON.parse(ds);
    // Routed through Repository for consistency with the Supabase pull path —
    // this runs at app boot (before the user has made any edits this session),
    // so genuine conflicts here should be rare, but the same safety net applies.
    Repository.mergePulledMonthly(mArr);
    Repository.mergePulledDaily(dArr);
    return true;
  } catch(e) { return false; }
}

// Bridge only what's actually used elsewhere. IDB_NAME/IDB_VER/IDB_STORE,
// idbOpen, idbSet, and idbGet are all genuinely private — only
// idbSaveData (drive.js, supabase.js) and idbLoadData (auth.js) are
// consumed externally, alongside the render-cache helpers.
window._rc = _rc;
window._rcKey = _rcKey;
window.invalidateRenderCache = invalidateRenderCache;
window.idbSaveData = idbSaveData;
window.idbLoadData = idbLoadData;

})();
