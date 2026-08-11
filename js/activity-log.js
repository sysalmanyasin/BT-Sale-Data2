// ══════════════════════════════════════════════════════════════════════
// ACTIVITY LOG  —  Utility → Activity Log (js/activity-log.js)
//
// A cross-device, Supabase-synced feed of "what changed, where, and
// when" across the whole app: Date/time, section, and add/edit/delete.
// Single-user app, multiple devices (see README's Navigation model) —
// this is the record of what happened on any of them, not a
// per-account audit trail.
//
// Source of truth for WHAT changed: this file subscribes to the
// EventBus (js/event-bus.js) — the one channel every real data
// mutation already announces itself on (see js/repository.js's
// `_notify()` calls for DAILY/MONTHLY/STAFF/generic item writes, and
// js/actions.js's staff:added/updated/removed). No page or Action had
// to be touched to wire this up; it just listens, the same way
// js/conflict-ui.js already listens for 'conflict:queued'.
//
// Deliberately NOT logged (see the switch in the EventBus listener
// below for the full reasoning): daily:pulled/monthly:pulled/
// *:gapfilled (sync-driven merges, not a local edit), pending:changed
// (a session-local UI list, not a saved record), conflict:*/
// raw:mutation (sync/dev internals), nav:changed (navigation), and
// staff:changed (repository.js's generic staff event — actions.js's
// staff:added/updated/removed already cover the same writes with a
// clearer verb, so listening to both would double-log every edit).
//
// Same Supabase project + anon key this app already uses everywhere
// else (js/supabase.js) — table is `bt_activity_log`, schema in
// supabase/activity_log/schema.sql. Same lazy-client / prefer-the-
// authenticated-client trust model as pdf-library.js and the
// closing/audit/inventory bridges: RLS scopes access, not key secrecy.
//
// Local cache (LOCAL_KEY below) is read/written straight through
// localStorage, NOT Repository/Actions — same documented exception as
// ai-memory.js's briefing cache (README's "Known gaps"): this is a
// cache of data whose authoritative copy lives in Supabase, not
// primary app business data. It also sidesteps a feedback loop:
// Repository.setItem() would itself fire 'item:changed' on the very
// EventBus this file listens to.
// ══════════════════════════════════════════════════════════════════════

import { EventBus } from './event-bus.js';

export const ActivityLog = (function () {
  'use strict';

  const SB_URL = 'https://wetbugzzchkghpzmowod.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';
  const TABLE     = 'bt_activity_log';
  const LOCAL_KEY = 'bt_activity_log_cache_v1';
  const MAX_LOCAL = 500;

  let _client = null;
  let _pageInitialized = false;
  let _rows = [];             // newest-first; merged local + remote
  let _prevLedgerById = null; // baseline for diffing 'ledger:changed' payloads

  function _getClient() {
    // Prefer the app's real authenticated client (see pdf-library.js's
    // _getClient() for why) — falls back to the plain anon key only if
    // supabase.js hasn't set up window.btGetSupabaseClient yet.
    if (typeof window.btGetSupabaseClient === 'function') {
      const c = window.btGetSupabaseClient();
      if (c) return c;
    }
    if (_client) return _client;
    if (typeof supabase === 'undefined' || !supabase.createClient) return null;
    _client = supabase.createClient(SB_URL, SB_KEY);
    return _client;
  }

  function _deviceId() {
    try { return (typeof window._sc_getUDID === 'function') ? window._sc_getUDID() : 'unknown'; }
    catch (e) { return 'unknown'; }
  }
  function _deviceLabel() {
    try { return (typeof window._sc_detectDeviceName === 'function') ? window._sc_detectDeviceName() : ''; }
    catch (e) { return ''; }
  }

  // ── Local cache ──────────────────────────────────────────────────
  function _loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function _saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(_rows.slice(0, MAX_LOCAL))); }
    catch (e) { /* storage full/unavailable — cache is best-effort only */ }
  }

  // ── Section labels for the small, known set of generic feature-data
  // keys Actions.saveXxx() persists (see actions.js's "GENERIC FEATURE
  // DATA" block) — item:changed/item:removed fire with {key, value},
  // and nothing in this app emits those for anything outside this
  // named set, so an allowlist here is safe. Unmapped keys are
  // intentionally left out of the log rather than logged generically,
  // to avoid noise from internal bookkeeping.
  const FEATURE_KEY_SECTIONS = {
    bt_targets:            'Manager · Targets',
    mw_custom_sections_v1: 'Manager · Custom Sections',
    bt_col_config:         'Sale Data · Field Config',
    bt_custom_cols:        'Sale Data · Custom Fields',
    bt_notes_v1:           'Notes & Sheets · Notes',
    bt_staff_notes_v1:     'Manager · Staff Notes',
    bt_sheets_v2:          'Notes & Sheets · Sheets',
    bt_sheet_files_v1:     'Notes & Sheets · Files',
    bt_sheet_workbooks_v1: 'Notes & Sheets · Workbooks',
    BT_ManagerWork_v1:     'Manager · Jazz Cash / Petty / Sections',
  };

  const LEDGER_TYPE_LABELS = { jazzcash: 'Jazz Cash', petty: 'Petty / Expenses', expense: 'Expense' };
  function _ledgerTypeLabel(t) { return LEDGER_TYPE_LABELS[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Custom'); }
  function _fmtAmount(n) { return 'Rs. ' + (Number(n) || 0).toLocaleString('en-PK'); }

  // ── Record + push one entry ──────────────────────────────────────
  function _record(section, action, summary, details) {
    const entry = {
      id: 'al_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      occurred_at: new Date().toISOString(),
      section, action, summary,
      details: details || null,
      device: _deviceLabel(),
      device_id: _deviceId(),
      _synced: false,
    };
    _rows.unshift(entry);
    _rows = _rows.slice(0, MAX_LOCAL);
    _saveLocal();
    if (_pageInitialized) _renderList();
    _push(entry);
  }

  async function _push(entry) {
    const client = _getClient();
    if (!client) return; // stays _synced:false locally; retried next onShow()
    try {
      const { error } = await client.from(TABLE).insert({
        occurred_at: entry.occurred_at,
        section: entry.section,
        action: entry.action,
        summary: entry.summary,
        details: entry.details,
        device: entry.device,
        device_id: entry.device_id,
      });
      if (error) throw error;
      entry._synced = true;
      _saveLocal();
    } catch (e) {
      console.warn('ActivityLog: push failed, will retry on next view of the page', e);
    }
  }

  function _flushPending() {
    _rows.filter(r => !r._synced).forEach(_push);
  }

  // ── Ledger diff — 'ledger:changed' (js/ledger-store.js) fires with
  // the FULL current entries array on every write, not a verb. Diffing
  // by id against the previous snapshot recovers add/edit/delete the
  // same way ledger-actions.js's addEntry/updateEntry/removeEntry
  // callers already think about it, without changing that file. Note:
  // unlike daily/monthly, ledger-store.js has no separate "pulled from
  // sync" event, so a change made on one device can occasionally also
  // get one log line on a second device shortly after (once the pull
  // lands there) — a minor, accepted trade-off, not a bug.
  function _onLedgerChanged(payload) {
    const entries = (payload && payload.entries) || [];
    const nowById = new Map(entries.map(e => [e.id, e]));
    if (_prevLedgerById) {
      nowById.forEach((e, id) => {
        const section = 'Manager · Ledger (' + _ledgerTypeLabel(e.ledgerType) + ')';
        if (!_prevLedgerById.has(id)) {
          _record(section, 'add', 'Added ' + (e.desc || e.categoryId || 'entry') + ' — ' + _fmtAmount(e.amount));
        } else if (JSON.stringify(_prevLedgerById.get(id)) !== JSON.stringify(e)) {
          _record(section, 'edit', 'Edited ' + (e.desc || e.categoryId || 'entry') + ' — ' + _fmtAmount(e.amount));
        }
      });
      _prevLedgerById.forEach((e, id) => {
        if (!nowById.has(id)) {
          _record('Manager · Ledger (' + _ledgerTypeLabel(e.ledgerType) + ')', 'delete',
            'Deleted ' + (e.desc || e.categoryId || 'entry') + ' — ' + _fmtAmount(e.amount));
        }
      });
    }
    _prevLedgerById = nowById;
  }

  // ── EventBus subscription ────────────────────────────────────────
  EventBus.onChange(function (eventName, payload) {
    switch (eventName) {
      case 'daily:added':    _record('Sale Data', 'add',    'Added daily entry — ' + (payload && payload.Date)); break;
      case 'daily:updated':  _record('Sale Data', 'edit',   'Edited daily entry — ' + (payload && payload.Date)); break;
      case 'daily:deleted':  _record('Sale Data', 'delete', 'Deleted daily entry — ' + (payload && payload.Date)); break;

      case 'monthly:added':   _record('Sale Data · Monthly', 'add',    'Added monthly record — ' + (payload && payload.Month_Year)); break;
      case 'monthly:updated': _record('Sale Data · Monthly', 'edit',   'Edited monthly record — ' + (payload && payload.Month_Year)); break;
      case 'monthly:deleted': _record('Sale Data · Monthly', 'delete', 'Deleted monthly record — ' + (payload && payload.Month_Year)); break;

      case 'staff:added':   _record('Manager · Staff', 'add',  'Added staff member — ' + (payload && (payload.name || payload.staffId))); break;
      case 'staff:updated': _record('Manager · Staff', 'edit', 'Updated staff member — ' + (payload && (payload.name || payload.staffId))); break;
      case 'staff:removed': {
        const emp = payload && payload.employee;
        _record('Manager · Staff', 'delete', 'Removed staff member — ' + ((emp && (emp.name || emp.staffId)) || ''));
        break;
      }

      case 'ledger:changed': _onLedgerChanged(payload); break;

      case 'item:changed': {
        const label = payload && FEATURE_KEY_SECTIONS[payload.key];
        if (label) _record(label, 'edit', 'Updated ' + label.split(' · ').pop().toLowerCase());
        break;
      }
      case 'item:removed': {
        const label = payload && FEATURE_KEY_SECTIONS[payload.key];
        if (label) _record(label, 'delete', 'Cleared ' + label.split(' · ').pop().toLowerCase());
        break;
      }

      default: break; // not a loggable change — see file header for the full skip list
    }
  });

  // ── Page (Utility → Activity Log) ────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '';
    return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }
  const ACTION_META = {
    add:    { label: 'Add',    cls: 'al-add' },
    edit:   { label: 'Edit',   cls: 'al-edit' },
    delete: { label: 'Delete', cls: 'al-delete' },
    other:  { label: 'Other',  cls: 'al-other' },
  };

  function _populateSectionFilter() {
    const sel = document.getElementById('al-filter-section');
    if (!sel) return;
    const current = sel.value;
    const sections = Array.from(new Set(_rows.map(r => r.section))).sort();
    const optionsHtml = '<option value="">All sections</option>' +
      sections.map(s => `<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
    if (sel.dataset.built !== String(sections.length)) {
      sel.innerHTML = optionsHtml;
      sel.dataset.built = String(sections.length);
      sel.value = current; // keep whatever the user had picked, if it still exists
    }
  }

  function _renderList() {
    const list = document.getElementById('al-list');
    if (!list) return;
    _populateSectionFilter();

    const search = (document.getElementById('al-search').value || '').toLowerCase().trim();
    const sectionFilter = document.getElementById('al-filter-section').value;
    const actionFilter = document.getElementById('al-filter-action').value;

    let rows = _rows.slice();
    if (sectionFilter) rows = rows.filter(r => r.section === sectionFilter);
    if (actionFilter) rows = rows.filter(r => r.action === actionFilter);
    if (search) rows = rows.filter(r =>
      (r.summary || '').toLowerCase().includes(search) ||
      (r.section || '').toLowerCase().includes(search));

    if (!rows.length) {
      list.innerHTML = `<div class="al-empty">No activity ${search || sectionFilter || actionFilter ? 'matches this filter' : 'logged yet'}.</div>`;
      return;
    }

    list.innerHTML = rows.map(r => {
      const meta = ACTION_META[r.action] || ACTION_META.other;
      return `
        <div class="al-row">
          <div class="al-when">${_esc(_fmtWhen(r.occurred_at))}</div>
          <div class="al-main">
            <div class="al-top">
              <span class="al-section">${_esc(r.section)}</span>
              <span class="al-action ${meta.cls}">${meta.label}</span>
            </div>
            <div class="al-summary">${_esc(r.summary)}</div>
          </div>
          <div class="al-device">${_esc(r.device || '')}</div>
        </div>`;
    }).join('');
  }

  async function _fetchAndMerge() {
    const list = document.getElementById('al-list');
    const client = _getClient();
    if (!client) { _renderList(); return; } // fall back to whatever's cached locally
    if (list && !_rows.length) list.innerHTML = '<div class="al-empty">Loading…</div>';
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(MAX_LOCAL);
      if (error) throw error;
      const remote = (data || []).map(r => Object.assign({}, r, { _synced: true }));
      // Keep any not-yet-synced local-only rows that haven't shown up
      // in the remote fetch yet (matched on device+time+summary, since
      // they don't have a real server id until the push succeeds).
      const stillPending = _rows.filter(r => !r._synced && !remote.some(x =>
        x.device_id === r.device_id && x.summary === r.summary && x.occurred_at === r.occurred_at));
      _rows = stillPending.concat(remote).slice(0, MAX_LOCAL);
      _saveLocal();
      _renderList();
      _flushPending();
    } catch (e) {
      console.error('ActivityLog fetch failed:', e);
      if (list && !_rows.length) list.innerHTML = '<div class="al-empty">Could not load the activity log. Check your connection and try again.</div>';
      else _renderList();
    }
  }

  function _wirePageOnce() {
    if (_pageInitialized) return;
    const page = document.getElementById('page-activity-log');
    if (!page) return; // page shell not in the DOM yet
    _pageInitialized = true;

    document.getElementById('al-search').addEventListener('input', _renderList);
    document.getElementById('al-filter-section').addEventListener('change', _renderList);
    document.getElementById('al-filter-action').addEventListener('change', _renderList);
    document.getElementById('al-refresh').addEventListener('click', _fetchAndMerge);
  }

  // Called from ui.js's showPage() when the Activity Log nav tab is
  // opened — same "wire once, safe to call every visit" pattern
  // PdfLibrary.onShow() already uses.
  function onShow() {
    _wirePageOnce();
    if (_pageInitialized) _fetchAndMerge();
  }

  // Load whatever's cached locally immediately at boot (no Supabase
  // round-trip needed just to start listening), so entries recorded
  // before the Activity Log page has ever been opened this session
  // still count, and so the ledger-diff baseline is seeded correctly.
  _rows = _loadLocal();

  return { onShow };
})();

// Bridge onto window — ui.js (a classic script) calls
// window.ActivityLog.onShow(), same as window.PdfLibrary.onShow().
window.ActivityLog = ActivityLog;
