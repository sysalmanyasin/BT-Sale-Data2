// ══════════════════════════════════════════════════════════════════════
// NAV RECENTS  —  "recently used sections" drawer (V2 nav combo, part 3
// of 3 alongside the existing bottom tab bar and the pushState-based
// back button added in ui.js's showPage()).
//
// Listens to the EventBus 'nav:changed' event ui.js's showPage() already
// emits on every navigation — no changes to showPage() needed for this
// part. Keeps the last MAX_RECENTS distinct pages, most-recent first,
// in sessionStorage (cleared when the tab/session ends — "what have I
// had open this session", not a permanent history log).
// ══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const MAX_RECENTS = 8;
  const STORAGE_KEY = 'bt_nav_recents';
  // Cover/CommandHub are the hub you navigate FROM, not sections you
  // "used" — recording them would just clutter the drawer with the
  // entry point itself every time.
  const _SKIP = new Set(['cover', 'commandhub']);

  let _recents = [];

  function _load() {
    try { _recents = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { _recents = []; }
  }

  function _save() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_recents)); }
    catch (_) { /* storage unavailable — recents just won't persist across reload */ }
  }

  // Pages that used to live in #bnav and now live as Cover tiles instead
  // (moved there so the bottom bar stays short) — .bnav-item lookup below
  // can't find them anymore, so give them a fixed fallback here.
  const _MOVED_TO_COVER = {
    commandhub:   { label: 'Hub',         icon: '🧭' },
    'pdf-library': { label: 'PDF Library', icon: '📚' },
  };

  // Pull the label/icon straight off whichever nav element already
  // advertises this page (bnav-item first, then sub-items/ntabs) so
  // the drawer never drifts out of sync with the real nav labels.
  function _labelFor(id) {
    if (_MOVED_TO_COVER[id]) return _MOVED_TO_COVER[id].label;
    const el = document.querySelector(
      '.bnav-item[data-page="' + id + '"] .blabel, ' +
      '.bnav-sub-item[data-page="' + id + '"], ' +
      '.ntab[data-page="' + id + '"]'
    );
    return el ? el.textContent.trim() : id;
  }

  function _iconFor(id) {
    if (_MOVED_TO_COVER[id]) return _MOVED_TO_COVER[id].icon;
    const el = document.querySelector('.bnav-item[data-page="' + id + '"] .bicon');
    return el ? el.textContent.trim() : '📄';
  }

  function _record(id) {
    if (!id || _SKIP.has(id)) return;
    _load();
    _recents = _recents.filter(r => r.id !== id);
    _recents.unshift({ id: id, label: _labelFor(id), icon: _iconFor(id), ts: Date.now() });
    if (_recents.length > MAX_RECENTS) _recents.length = MAX_RECENTS;
    _save();
  }

  if (typeof EventBus !== 'undefined') {
    EventBus.onChange(function (evt, payload) {
      if (evt === 'nav:changed' && payload && payload.page) _record(payload.page);
    });
  }

  function _fmtAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _render() {
    _load();
    const list = document.getElementById('recents-list');
    if (!list) return;
    const cur = typeof _curPage !== 'undefined' ? _curPage : null;
    const rows = _recents.filter(r => r.id !== cur && document.getElementById('page-' + r.id));
    list.innerHTML = rows.length
      ? rows.map(r => `
          <div class="recents-row" onclick="showPage('${r.id}');closeRecentsDrawer();">
            <span class="recents-icon">${_esc(r.icon)}</span>
            <span class="recents-label">${_esc(r.label)}</span>
            <span class="recents-time">${_fmtAgo(r.ts)}</span>
          </div>`).join('')
      : '<div class="recents-empty">No other sections visited yet this session</div>';
  }

  function openRecentsDrawer() {
    _render();
    const bg = document.getElementById('recentsbg');
    if (bg) bg.classList.add('on');
  }

  function closeRecentsDrawer() {
    const bg = document.getElementById('recentsbg');
    if (bg) bg.classList.remove('on');
  }

  window.openRecentsDrawer = openRecentsDrawer;
  window.closeRecentsDrawer = closeRecentsDrawer;

})();
