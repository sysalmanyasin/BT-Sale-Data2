// ══════════════════════════════════════════════════════════════════
// SUPABASE SYNC  —  complete replacement for github.js
// One table · one row · real-time push · offline queue · migration
// Sync History (last 10 events stored in localStorage)
// ══════════════════════════════════════════════════════════════════

const SB_URL     = 'https://wetbugzzchkghpzmowod.supabase.co';
const SB_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';
const SB_TABLE   = 'bt_salesdata';
const SB_ID      = 'main';
const SB_PENDING = 'bt_sb_pending';    // dirty flag for offline queue
const SB_HISTORY = 'bt_sync_history'; // last 10 sync events

let _sbClient      = null;
let _sbChannel     = null;
let _pushInFlight  = false;   // prevents concurrent pushes
let _pushQueued    = false;   // a second push was requested while one was running
let _pushDebounce  = null;    // debounce timer so rapid saves coalesce into one push
let _pullInFlight  = false;   // FIX 3: prevents concurrent pulls (mirrors push guard)
let _lastPullTime  = 0;       // FIX 3: timestamp of most recent pull start

// Expose a safe getter so sync-center.js can read the channel state
// (let variables don't become window properties, getter bridges the gap)
function _sbGetChannel() { return _sbChannel; }
window._sbGetChannel = _sbGetChannel;

function _sb() {
  if (!_sbClient) _sbClient = supabase.createClient(SB_URL, SB_KEY);
  return _sbClient;
}

// ══════════════════════════════════════════════════════════════════
// SYNC HISTORY
// ══════════════════════════════════════════════════════════════════
function _recordHistory(entry) {
  // entry: { type, status, monthly, daily, msg }
  const hist = JSON.parse(Repository.getItem(SB_HISTORY) || '[]');
  hist.unshift({ ...entry, time: new Date().toISOString() });
  if (hist.length > 10) hist.length = 10;
  Actions.saveFeatureData(SB_HISTORY, JSON.stringify(hist));
  renderSyncHistory();
}

function renderSyncHistory() {
  const el = document.getElementById('sync-history-list');
  if (!el) return;
  const hist = JSON.parse(Repository.getItem(SB_HISTORY) || '[]');
  if (!hist.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0">No sync events yet.</div>';
    return;
  }
  const icons = { push: '↑', pull: '↓', realtime: '⚡', migration: '⬆', offline: '⏳' };
  const typeLabels = { push: 'Push', pull: 'Pull', realtime: 'Real-time', migration: 'Migration', offline: 'Offline sync' };
  el.innerHTML = hist.map(h => {
    const d   = new Date(h.time);
    const ts  = d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })
              + ' ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
    const ok  = h.status === 'ok';
    const clr = ok ? 'var(--green)' : 'var(--red)';
    const ico = icons[h.type] || '☁';
    const lbl = typeLabels[h.type] || h.type;
    const rec = (h.monthly != null) ? `${h.monthly}M · ${h.daily}D` : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px">
        <span style="color:${clr};font-size:14px;flex-shrink:0">${ico}</span>
        <span style="font-weight:600;color:var(--text);min-width:68px">${lbl}</span>
        <span style="color:var(--muted);flex:1">${h.msg || ''}</span>
        ${rec ? `<span style="color:var(--accent);font-family:var(--mono);white-space:nowrap">${rec}</span>` : ''}
        <span style="color:var(--muted);white-space:nowrap">${ts}</span>
        <span style="color:${clr};font-weight:700">${ok ? '✓' : '✕'}</span>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// SYNC BADGE  (same HTML element IDs — no HTML change needed)
// ══════════════════════════════════════════════════════════════════
function setSyncBadge(state) {
  const wrap = document.getElementById('synci');
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');
  if (!wrap) return;
  wrap.className = 'syncbadge ' + state;
  if      (state === 'syncing') { icon.textContent = '↻';  text.textContent = 'Syncing…'; }
  else if (state === 'ok')      { icon.textContent = '✓';  text.textContent = 'Synced'; }
  else if (state === 'err')     { icon.textContent = '✕';  text.textContent = 'Error'; }
  else if (state === 'queue')   { icon.textContent = '⏳'; text.textContent = 'Queued'; }
  else                          { icon.textContent = '☁';  text.textContent = 'Supabase'; }
  if (state === 'ok' || state === 'err') setTimeout(() => setSyncBadge('idle'), 4000);
}

function sbLog(msg, cls = 'info') {
  const el = document.getElementById('ghlog');
  if (!el) return;
  const t     = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const color = cls === 'ok' ? 'var(--green)' : cls === 'err' ? 'var(--red)' : 'var(--t2)';
  el.innerHTML += `<div><span style="color:var(--accent)">[${t}]</span> <span style="color:${color}">${msg}</span></div>`;
  el.scrollTop = el.scrollHeight;
}

// ══════════════════════════════════════════════════════════════════
// OFFLINE QUEUE  (dirty flag — full state pushed on flush)
// ══════════════════════════════════════════════════════════════════
function _markPending()  { Actions.saveFeatureData(SB_PENDING, Date.now()); }
function _clearPending() { Actions.clearFeatureData(SB_PENDING); }
function _hasPending()   { return !!Repository.getItem(SB_PENDING); }

// ══════════════════════════════════════════════════════════════════
// PAYLOAD VERSION — monotonically incrementing counter so receivers
// can detect which push is newer when two devices conflict.
// ══════════════════════════════════════════════════════════════════
const SB_VERSION_KEY = 'bt_payload_version';
function _nextPayloadVersion() {
  const v = parseInt(Repository.getItem(SB_VERSION_KEY) || '0', 10) + 1;
  Actions.saveFeatureData(SB_VERSION_KEY, String(v));
  return v;
}

// ══════════════════════════════════════════════════════════════════
// BUILD PAYLOAD  (every section the app owns)
// ══════════════════════════════════════════════════════════════════
function _buildPayload() {
  const petty = {}, incentive = {};
  // Route through Repository.getKeysByPrefix so we never touch localStorage directly
  Repository.getKeysByPrefix('mw_petty_').forEach(k => {
    petty[k] = JSON.parse(Repository.getItem(k) || 'null');
  });
  Repository.getKeysByPrefix('mw_incentive_').forEach(k => {
    incentive[k] = JSON.parse(Repository.getItem(k) || 'null');
  });
  return {
    monthly:  MONTHLY,
    daily:    DAILY,
    staff:    STAFF,
    manager:  JSON.parse(Repository.getItem(MGR_KEY)  || '{}'),
    petty,
    incentive,
    custom:   JSON.parse(Repository.getItem(CSEC_KEY) || '{}'),
    targets:  JSON.parse(Repository.getItem(TGT_K)    || '{}'),
    assistant: (typeof aimBuildAssistantPayload === 'function') ? aimBuildAssistantPayload() : null,
    jazzcash: JSON.parse(Repository.getItem(JC_KEY)       || 'null'),
    jcTally:  JSON.parse(Repository.getItem(JC_TALLY_KEY) || 'null'),
    // Generalized Ledger (Expense, Jazz Cash's Daily Ledger, any custom
    // "Other Section") — was missing from sync entirely until now.
    ledger:            JSON.parse(Repository.getItem(LEDGER_KEY)            || 'null'),
    ledgerCustomTypes: JSON.parse(Repository.getItem(LEDGER_CUSTOM_TYPES_KEY) || 'null'),
    unmatched:         JSON.parse(Repository.getItem('bt_unmatched_v1')      || 'null'),
    notes:    JSON.parse(Repository.getItem('bt_notes_v1') || '[]'),
    // Staff Card Notes tab (V2 plan §4) — same id-merge convention as
    // the Notes & Sheets `notes` key above.
    staffNotes: JSON.parse(Repository.getItem('bt_staff_notes_v1') || '[]'),
    colConfig: {
      hidden: JSON.parse(Repository.getItem('bt_col_config')  || '[]'),
      custom: JSON.parse(Repository.getItem('bt_custom_cols') || '[]')
    },
    pushedAt:    new Date().toISOString(),
    payloadVersion: _nextPayloadVersion(),
    device_id:   (typeof _scGetUDID   === 'function') ? _scGetUDID()   : 'unknown',
    device_name: (typeof _scDeviceName !== 'undefined') ? _scDeviceName : 'unknown'
  };
}

// ══════════════════════════════════════════════════════════════════
// MERGE  (proven logic — local wins on push, remote wins on pull)
// ══════════════════════════════════════════════════════════════════
function mergeIncomingData(data, isPull = false) {
  let mN = 0, dN = 0, mU = 0, dU = 0;

  // Monthly/Daily merge now goes through Repository — this is the same
  // "local wins on push / remote wins on pull" behavior as before, but
  // with one addition: if the SAME record was independently edited on
  // both sides since the last sync, it's queued as a conflict instead of
  // being silently overwritten (see Repository.isGenuineConflict).
  if (isPull) {
    if (data.monthly) { const r = Repository.mergePulledMonthly(data.monthly); mN = r.added; mU = r.updated; }
    if (data.daily)   { const r = Repository.mergePulledDaily(data.daily);     dN = r.added; dU = r.updated; }
  } else {
    // Push direction: local wins, remote only fills gaps.
    // Now routed through Repository.gapFill* (closes CF-01 / last two
    // direct MONTHLY/DAILY writes that lived outside Repository).
    if (data.monthly) { const r = Repository.gapFillMonthly(data.monthly); mN = r.added; }
    if (data.daily)   { const r = Repository.gapFillDaily(data.daily);     dN = r.added; }
  }

  if (data.staff && data.staff.length) {
    // Direction-aware, per-record merge — matches Daily/Monthly's existing
    // pattern (Repository.mergePulledDaily/gapFillDaily etc). Previously
    // this ran the SAME "remote list wins wholesale" merge on both push
    // and pull, with no per-record conflict check — meaning an unsynced
    // local edit (e.g. deactivating an employee, which also clears their
    // Sr#) got silently discarded and replaced by stale remote data on
    // the very next sync, including push (mergeIncomingData(..., false)
    // runs to merge remote into local BEFORE every push). That was the
    // exact mechanism behind "inactive member becomes active again with
    // the same Sr# on next sync."
    if (isPull) Repository.mergePulledStaff(data.staff);
    else        Repository.gapFillStaff(data.staff);
  }

  if (data.manager) {
    const cur = JSON.parse(Repository.getItem(MGR_KEY) || '{}');
    const merged = JSON.parse(JSON.stringify(cur || {}));
    ['salary', 'generic', 'expense', 'credit'].forEach(sec => {
      if (data.manager[sec] && typeof data.manager[sec] === 'object') {
        if (!merged[sec]) merged[sec] = {};
        Object.keys(data.manager[sec]).forEach(month => {
          // Per-month merge, not per-section: a section key always exists
          // locally once that tab has been opened, so overwriting the whole
          // section object (instead of just the months that conflict) would
          // silently drop any month-only-on-the-other-side.
          if (isPull) merged[sec][month] = data.manager[sec][month];          // remote wins on pull
          else if (!(month in merged[sec])) merged[sec][month] = data.manager[sec][month]; // local wins on push — only fill gaps
        });
      }
    });
    Actions.saveFeatureData(MGR_KEY, JSON.stringify(merged));
  }

  if (data.petty) {
    Object.entries(data.petty).forEach(([k, v]) => {
      if (v == null) return;
      if (isPull)                        Actions.saveFeatureData(k, JSON.stringify(v));
      else if (!Repository.getItem(k)) Actions.saveFeatureData(k, JSON.stringify(v));
    });
  }

  if (data.incentive) {
    Object.entries(data.incentive).forEach(([k, v]) => {
      if (v == null) return;
      if (isPull)                        Actions.saveFeatureData(k, JSON.stringify(v));
      else if (!Repository.getItem(k)) Actions.saveFeatureData(k, JSON.stringify(v));
    });
  }

  if (data.custom) {
    const local  = JSON.parse(Repository.getItem(CSEC_KEY) || '{}');
    const merged = JSON.parse(JSON.stringify(local || {}));
    Object.keys(data.custom).forEach(sectionId => {
      const remoteSec = data.custom[sectionId];
      if (!remoteSec || typeof remoteSec !== 'object') return;
      if (!merged[sectionId]) merged[sectionId] = { name: remoteSec.name, emoji: remoteSec.emoji, months: {} };
      if (!merged[sectionId].months) merged[sectionId].months = {};
      // Keep name/emoji in sync — remote wins on pull, local wins on push
      if (isPull) {
        if (remoteSec.name)  merged[sectionId].name  = remoteSec.name;
        if (remoteSec.emoji) merged[sectionId].emoji = remoteSec.emoji;
        if (remoteSec.aiConfig) merged[sectionId].aiConfig = remoteSec.aiConfig;
      } else if (!merged[sectionId].aiConfig && remoteSec.aiConfig) {
        merged[sectionId].aiConfig = remoteSec.aiConfig; // local wins on push — fill gap only
      }
      // Actual rows live at sectionId.months[monthKey] — merge at that level.
      // A shallow per-section overwrite would drop any month that only
      // exists on the other side (and would also wrongly treat the
      // section's own name/emoji fields as if they were month keys).
      const remoteMonths = remoteSec.months || {};
      Object.keys(remoteMonths).forEach(month => {
        if (isPull) merged[sectionId].months[month] = remoteMonths[month];          // remote wins on pull
        else if (!(month in merged[sectionId].months)) merged[sectionId].months[month] = remoteMonths[month]; // local wins on push — only fill gaps
      });
    });
    Actions.saveFeatureData(CSEC_KEY, JSON.stringify(merged));
  }

  if (data.targets) {
    const local  = JSON.parse(Repository.getItem(TGT_K) || '{}');
    const merged = JSON.parse(JSON.stringify(local || {}));
    Object.keys(data.targets).forEach(month => {
      if (isPull) merged[month] = data.targets[month];          // remote wins on pull
      else if (!(month in merged)) merged[month] = data.targets[month]; // local wins on push — only fill gaps
    });
    Actions.saveFeatureData(TGT_K, JSON.stringify(merged));
  }

  if (data.assistant && typeof aimMergeAssistantIncoming === 'function') {
    aimMergeAssistantIncoming(data.assistant, isPull);
  }

  // ── JazzCash ledger — entries merged by id, openingBalance follows the
  // same local-wins-on-push / remote-wins-on-pull convention as the rest ──
  if (data.jazzcash) {
    const local  = JSON.parse(Repository.getItem(JC_KEY) || 'null') || { openingBalance: 0, entries: [] };
    const remote = data.jazzcash;
    const byId = {};
    (local.entries || []).forEach(e => { byId[e.id] = e; });
    (remote.entries || []).forEach(e => {
      if (!e || !e.id) return;
      if (isPull) byId[e.id] = e;              // remote wins on pull
      else if (!byId[e.id]) byId[e.id] = e;     // local wins on push — fill gaps only
    });
    const merged = {
      openingBalance: isPull ? (remote.openingBalance ?? local.openingBalance ?? 0) : (local.openingBalance ?? remote.openingBalance ?? 0),
      entries: Object.values(byId)
    };
    Actions.saveFeatureData(JC_KEY, JSON.stringify(merged));
  }

  // ── JazzCash tally — accounts merged by id, snapshots merged by date ──
  if (data.jcTally) {
    const local  = JSON.parse(Repository.getItem(JC_TALLY_KEY) || 'null') || { accounts: [], snapshots: [] };
    const remote = data.jcTally;
    const acctById = {};
    (local.accounts || []).forEach(a => { acctById[a.id] = a; });
    (remote.accounts || []).forEach(a => {
      if (!a || !a.id) return;
      if (isPull) acctById[a.id] = a;              // remote wins on pull
      else if (!acctById[a.id]) acctById[a.id] = a; // local wins on push — fill gaps only
    });
    const snapByDate = {};
    (local.snapshots || []).forEach(s => { snapByDate[s.date] = s; });
    (remote.snapshots || []).forEach(s => {
      if (!s || !s.date) return;
      if (isPull) snapByDate[s.date] = s;               // remote wins on pull
      else if (!snapByDate[s.date]) snapByDate[s.date] = s; // local wins on push — fill gaps only
    });
    const merged = { accounts: Object.values(acctById), snapshots: Object.values(snapByDate) };
    Actions.saveFeatureData(JC_TALLY_KEY, JSON.stringify(merged));
  }

  // ── Generalized Ledger — entries merged by id, openingBalances merged
  // per ledgerType, same local-wins-on-push / remote-wins-on-pull
  // convention as JazzCash above (was missing from sync entirely until
  // now — a real gap, since this is where live financial data now lives) ──
  if (data.ledger) {
    const local  = JSON.parse(Repository.getItem(LEDGER_KEY) || 'null') || { entries: [], openingBalances: {} };
    const remote = data.ledger;
    const byId = {};
    (local.entries || []).forEach(e => { byId[e.id] = e; });
    (remote.entries || []).forEach(e => {
      if (!e || !e.id) return;
      if (isPull) byId[e.id] = e;
      else if (!byId[e.id]) byId[e.id] = e;
    });
    const localOB = local.openingBalances || {}, remoteOB = remote.openingBalances || {};
    const mergedOB = Object.assign({}, localOB);
    Object.keys(remoteOB).forEach(t => {
      if (isPull) mergedOB[t] = remoteOB[t];
      else if (!(t in mergedOB)) mergedOB[t] = remoteOB[t];
    });
    Actions.saveFeatureData(LEDGER_KEY, JSON.stringify({ entries: Object.values(byId), openingBalances: mergedOB }));
  }

  // ── Unmatched entries from Closing App — merged by id, same
  // convention as the generalized ledger above. `resolved` entries are
  // kept (not deleted) so history/audit stays intact; the Unmatched
  // tab just filters them out of the active review list. ──
  if (data.unmatched) {
    const local  = JSON.parse(Repository.getItem('bt_unmatched_v1') || 'null') || { entries: [] };
    const remote = data.unmatched;
    const byId = {};
    (local.entries || []).forEach(e => { byId[e.id] = e; });
    (remote.entries || []).forEach(e => {
      if (!e || !e.id) return;
      if (isPull) { if (!byId[e.id] || !byId[e.id].resolved) byId[e.id] = e; }
      else if (!byId[e.id]) byId[e.id] = e;
    });
    Actions.saveFeatureData('bt_unmatched_v1', JSON.stringify({ entries: Object.values(byId) }));
  }

  // ── Custom "Other Sections" ledger-type definitions — merged by key,
  // same convention ──
  if (data.ledgerCustomTypes) {
    const local  = JSON.parse(Repository.getItem(LEDGER_CUSTOM_TYPES_KEY) || 'null') || {};
    const remote = data.ledgerCustomTypes;
    const merged = Object.assign({}, local);
    Object.keys(remote).forEach(t => {
      if (isPull) merged[t] = remote[t];
      else if (!(t in merged)) merged[t] = remote[t];
    });
    Actions.saveFeatureData(LEDGER_CUSTOM_TYPES_KEY, JSON.stringify(merged));
  }

  // ── Column / field manager config — small list, remote wins on pull,
  // local wins on push (kept whole since there's no natural per-item key
  // worth reconciling beyond "newest edit wins") ──
  if (data.colConfig) {
    if (isPull) {
      if (Array.isArray(data.colConfig.hidden)) Actions.saveFeatureData('bt_col_config',  JSON.stringify(data.colConfig.hidden));
      if (Array.isArray(data.colConfig.custom)) Actions.saveFeatureData('bt_custom_cols', JSON.stringify(data.colConfig.custom));
      if (typeof fmLoad === 'function') fmLoad();
    } else {
      // local wins on push — only adopt remote values if nothing exists locally yet
      if (!Repository.getItem('bt_col_config')  && Array.isArray(data.colConfig.hidden)) Actions.saveFeatureData('bt_col_config',  JSON.stringify(data.colConfig.hidden));
      if (!Repository.getItem('bt_custom_cols') && Array.isArray(data.colConfig.custom)) Actions.saveFeatureData('bt_custom_cols', JSON.stringify(data.colConfig.custom));
    }
  }

  // ── Notes (Notes & Sheets workspace) — merged by id, same convention
  // as JazzCash entries. Re-renders the panel live if it's open during a pull. ──
  if (data.notes && data.notes.length) {
    const local = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    const byId  = {};
    local.forEach(n => { if (n && n.id) byId[n.id] = n; });
    data.notes.forEach(n => {
      if (!n || !n.id) return;
      if (isPull) byId[n.id] = n;              // remote wins on pull
      else if (!byId[n.id]) byId[n.id] = n;     // local wins on push — fill gaps only
    });
    Actions.saveFeatureData('bt_notes_v1', JSON.stringify(Object.values(byId)));
    if (isPull && typeof renderNotesSheets === 'function' && document.getElementById('mgr-sheets')) {
      renderNotesSheets();
    }
  }

  // ── Staff Card Notes (V2 plan §4) — merged by id, same convention as
  // the Notes & Sheets `notes` key above. Re-renders live if the Notes
  // tab on a staff card happens to be open during a pull. ──
  if (data.staffNotes && data.staffNotes.length) {
    const local = JSON.parse(Repository.getItem('bt_staff_notes_v1') || '[]');
    const byId  = {};
    local.forEach(n => { if (n && n.id) byId[n.id] = n; });
    data.staffNotes.forEach(n => {
      if (!n || !n.id) return;
      if (isPull) byId[n.id] = n;
      else if (!byId[n.id]) byId[n.id] = n;
    });
    Actions.saveFeatureData('bt_staff_notes_v1', JSON.stringify(Object.values(byId)));
    if (isPull && typeof renderStaffNotesPanel === 'function') {
      const key = document.getElementById('sc-notes-key')?.value;
      const panel = document.getElementById('sc-panel-notes');
      if (key && panel && panel.style.display !== 'none') renderStaffNotesPanel(key);
    }
  }

  return { mN, dN, mU, dU };
}

// ══════════════════════════════════════════════════════════════════
// PUSH TO SUPABASE
// Debounced (300 ms) + lock-guarded so rapid saves (e.g. manager
// "Save All" calls pushToSupabase 8+ times in quick succession)
// collapse into a single network round-trip.
// ══════════════════════════════════════════════════════════════════
function pushToSupabase() {
  // Debounce: reset the timer on every call; fire after 300 ms of silence
  clearTimeout(_pushDebounce);
  _pushDebounce = setTimeout(_doPush, 300);
}

async function _doPush() {
  // ── Write-lock check: only ACTIVE device may push ───────────────────────
  if (typeof scCanWrite === 'function' && !scCanWrite()) {
    sbLog('⚠ Push blocked — this device is PASSIVE. Take control in Sync Center first.', 'err');
    toast('⚠ Read-only mode — open Sync Center → Take Control', 'w');
    setSyncBadge('err');
    return;
  }

  // Lock: if a push is already in flight, note that another is wanted
  if (_pushInFlight) { _pushQueued = true; return; }
  _pushInFlight = true;

  setSyncBadge('syncing');
  sbLog('Pushing to Supabase…');
  try {
    const db = _sb();

    const { data: remote } = await db
      .from(SB_TABLE).select('payload').eq('id', SB_ID).single();
    if (remote && remote.payload) {
      mergeIncomingData(remote.payload, false);
      recomputeAllMonths();
    }

    const { error } = await db.from(SB_TABLE).upsert(
      { id: SB_ID, payload: _buildPayload(), updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);

    _clearPending();
    idbSaveData();
    rebuildAll();
    sbLog('✓ Pushed successfully', 'ok');
    setSyncBadge('ok');
    toast('✓ Saved to Supabase');
    _recordHistory({ type: 'push', status: 'ok', monthly: MONTHLY.length, daily: DAILY.length, msg: 'Push complete' });
    _updateLastPollDisplay();
    document.dispatchEvent(new CustomEvent('bt:synced', { detail: { type: 'push' } }));
  } catch (e) {
    sbLog('✕ Push failed: ' + e.message, 'err');
    _markPending();
    _recordHistory({ type: 'push', status: 'err', msg: e.message.slice(0, 60) });
    if (!navigator.onLine) {
      setSyncBadge('queue');
      toast('📶 Offline — queued, will sync on reconnect', 'w');
    } else {
      setSyncBadge('err');
      toast('✕ Sync error — will retry', 'e');
    }
  } finally {
    _pushInFlight = false;
    // If another push was requested while this one was running, fire it now
    if (_pushQueued) { _pushQueued = false; setTimeout(_doPush, 100); }
  }
}

// ══════════════════════════════════════════════════════════════════
// PULL FROM SUPABASE
// FIX 3: pull-in-flight guard + 2s minimum gap between pulls
// ══════════════════════════════════════════════════════════════════
async function pullFromSupabase(silent = false) {
  // Guard: skip if a pull is already running
  if (_pullInFlight) {
    if (!silent) sbLog('⏭ Pull skipped — already in progress', 'info');
    return;
  }
  // Guard: enforce a 2s minimum gap between pulls to prevent rapid-fire duplicates
  const now = Date.now();
  if (now - _lastPullTime < 2000) {
    if (!silent) sbLog('⏭ Pull skipped — too soon after last pull', 'info');
    return;
  }
  _pullInFlight = true;
  _lastPullTime = now;
  setSyncBadge('syncing');
  if (!silent) sbLog('Fetching from Supabase…');
  try {
    const db = _sb();
    const { data, error } = await db
      .from(SB_TABLE).select('payload').eq('id', SB_ID).single();

    if (error && error.code === 'PGRST116') {
      sbLog('No data in Supabase yet — push first.', 'info');
      setSyncBadge('ok');
      return;
    }
    if (error) throw new Error(error.message);

    const { mN, dN, mU, dU } = mergeIncomingData(data.payload, true);
    sbLog('  [checkpoint A: after merge] MONTHLY=' + MONTHLY.length + ' DAILY=' + DAILY.length, 'mu');
    recomputeAllMonths();
    sbLog('  [checkpoint B: after recomputeAllMonths] MONTHLY=' + MONTHLY.length + ' DAILY=' + DAILY.length, 'mu');
    rebuildAll();
    sbLog('  [checkpoint C: after rebuildAll] MONTHLY=' + MONTHLY.length + ' DAILY=' + DAILY.length, 'mu');
    idbSaveData();
    Repository.markSynced();
    sbLog('  [checkpoint D: after idbSaveData/markSynced] MONTHLY=' + MONTHLY.length + ' DAILY=' + DAILY.length, 'mu');

    const pendingConflicts = Repository.getPendingConflicts().length;
    const summary = `+${mN} new months / ${mU} updated · +${dN} new daily / ${dU} updated`
      + ` · [in-memory: MONTHLY=${MONTHLY.length} DAILY=${DAILY.length}]`
      + (pendingConflicts ? ` · ⚠ ${pendingConflicts} conflict(s) need your review` : '');
    if (!silent) {
      sbLog('✓ Pulled. ' + summary, pendingConflicts ? 'w' : 'ok');
      toast(pendingConflicts ? `⚠ Synced — ${pendingConflicts} record(s) need your review` : '✓ Synced from Supabase');
    } else if (pendingConflicts) {
      // Even on a silent/auto pull, conflicts must not be silent — these are
      // genuine double-edits where data could be lost if ignored.
      toast(`⚠ ${pendingConflicts} record(s) edited on two devices — review needed`, 'w');
    }
    setSyncBadge('ok');
    _recordHistory({ type: 'pull', status: 'ok', monthly: mN + mU, daily: dN + dU, msg: silent ? 'Auto-pull on unlock' : 'Manual pull' });
    _updateLastPollDisplay();
    document.dispatchEvent(new CustomEvent('bt:synced', { detail: { type: 'pull' } }));
  } catch (e) {
    sbLog('✕ Pull failed: ' + e.message, 'err');
    setSyncBadge('err');
    _recordHistory({ type: 'pull', status: 'err', msg: e.message.slice(0, 60) });
    if (!silent) toast('✕ Pull failed: ' + e.message.slice(0, 50), 'e');
  } finally {
    _pullInFlight = false;   // FIX 3: always release the lock, even on early returns above
  }
}


// ══════════════════════════════════════════════════════════════════
// REAL-TIME SUBSCRIPTION
// FIX 1: skip pull when the event was caused by THIS device's own push
// ══════════════════════════════════════════════════════════════════
function _startRealtime() {
  const db = _sb();
  if (_sbChannel) { try { db.removeChannel(_sbChannel); } catch(_) {} }
  _sbChannel = db
    .channel('bt-sync')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: SB_TABLE }, (payload) => {
      // FIX 1: Ignore events that were triggered by our own push.
      // The payload row stores device_id inside the JSON payload column.
      const remoteDeviceId = payload?.new?.payload?.device_id;
      const ownUDID = (typeof _sc_getUDID === 'function') ? _sc_getUDID()
                    : Repository.getItem('bt_device_udid');
      if (remoteDeviceId && ownUDID && remoteDeviceId === ownUDID) {
        sbLog('⏭ Real-time: own push — skipping self-pull', 'info');
        return;
      }
      sbLog('⚡ Remote update from another device — syncing…', 'info');
      pullFromSupabase(true).then(() => {
        toast('⚡ Synced from another device');
        _recordHistory({ type: 'realtime', status: 'ok', msg: 'Received update from another device' });
        _updateLastPollDisplay();
      });
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        _updateRealtimeStatus(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        sbLog('⚠ Real-time channel ' + status + (err ? ': ' + err.message : '') + ' — reconnecting in 5s', 'err');
        _updateRealtimeStatus(false);
        setTimeout(_startRealtime, 5000);
      }
    });
}

function _updateRealtimeStatus(ok) {
  const el = document.getElementById('ar-status');
  if (!el) return;
  el.textContent = ok ? 'Active' : 'Reconnecting…';
  el.style.color  = ok ? 'var(--green)' : 'var(--amber, #f59e0b)';
}

function _updateLastPollDisplay() {
  const el = document.getElementById('ar-last-poll');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ══════════════════════════════════════════════════════════════════
// OFFLINE ↔ ONLINE
// FIX 5: delay the direct pull so RT has time to reconnect first;
// if RT fires within that window the _pullInFlight guard blocks the
// redundant second pull automatically.
// ══════════════════════════════════════════════════════════════════
window.addEventListener('online', () => {
  if (!window._appInited) return;
  sbLog('↑ Back online' + (_hasPending() ? ' — flushing queue…' : ''), 'info');
  // Reconnect real-time channel if it dropped while offline
  const chState = _sbChannel ? _sbChannel.state : '';
  if (!_sbChannel || (chState !== 'joined' && chState !== 'joining')) {
    _startRealtime();
  }
  if (_hasPending()) {
    _recordHistory({ type: 'offline', status: 'ok', msg: 'Back online — flushing queued changes' });
    pushToSupabase();
  } else {
    // FIX 5: wait 3s for RT to re-establish and possibly fire its own pull.
    // The _pullInFlight guard will suppress this one if RT already ran.
    setTimeout(() => pullFromSupabase(true), 3000);
  }
});
window.addEventListener('offline', () => {
  sbLog('↓ Offline — changes saved locally, sync on reconnect', 'info');
  setSyncBadge('queue');
  _updateRealtimeStatus(false);
});

// ── PWA / mobile: reconnect real-time when tab becomes visible again ──
// FIX 2: Only pull on foreground if the RT channel actually dropped.
// If RT is live it will deliver any missed updates itself — an extra
// unconditional pull creates the double-sync the plan prohibits.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !window._appInited) return;
  const chState = _sbChannel ? _sbChannel.state : '';
  const rtDropped = !_sbChannel || (chState !== 'joined' && chState !== 'joining');
  if (rtDropped) {
    sbLog('↩ App foregrounded — RT dropped, reconnecting…', 'info');
    _startRealtime();
    // RT was down — pull once so we catch anything we missed while backgrounded.
    // Delay slightly so the new channel subscribe completes first.
    if (navigator.onLine) setTimeout(() => pullFromSupabase(true).catch(() => {}), 1500);
  }
  // Also reconnect sessions channel if it dropped
  if (typeof _sc_startSessionRealtime === 'function') {
    const sessState = (typeof _sc_channel !== 'undefined' && _sc_channel) ? _sc_channel.state : '';
    const sessDropped = !_sc_channel || (sessState !== 'joined' && sessState !== 'joining');
    if (sessDropped) {
      _sc_startSessionRealtime();
    }
  }
  // RT is alive — no pull needed; real-time events carry all updates.
});

// ══════════════════════════════════════════════════════════════════
// TEST CONNECTION
// Checks reachability, RLS, and real-time in one tap
// ══════════════════════════════════════════════════════════════════
async function testSupabaseConnection() {
  const btn    = document.getElementById('test-conn-btn');
  const result = document.getElementById('test-conn-result');
  if (btn)    { btn.disabled = true; btn.textContent = 'Testing…'; }
  if (result) result.innerHTML = '';

  const row = (icon, label, ok, detail = '') => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
      <span style="font-size:15px">${icon}</span>
      <span style="font-weight:600;color:var(--text);min-width:130px">${label}</span>
      <span style="color:${ok ? 'var(--green)' : 'var(--red)'};font-weight:700">${ok ? '✓ OK' : '✕ FAIL'}</span>
      ${detail ? `<span style="color:var(--muted);font-size:11px">${detail}</span>` : ''}
    </div>`;

  let checks = '';
  let allOk  = true;

  sbLog('Running connection test…', 'info');

  // 1. Network reachability
  const online = navigator.onLine;
  checks += row('🌐', 'Internet', online, online ? 'Connected' : 'You are offline');
  if (!online) {
    if (result) result.innerHTML = checks;
    if (btn)    { btn.disabled = false; btn.textContent = '🔍 Test Connection'; }
    return;
  }

  // 2. Supabase read (SELECT — also tests RLS)
  let canRead = false, readDetail = '';
  try {
    const { data, error } = await _sb().from(SB_TABLE).select('id').eq('id', SB_ID).maybeSingle();
    if (error) throw error;
    canRead    = true;
    readDetail = data ? 'Row found ✓' : 'No data yet — push first';
  } catch (e) {
    readDetail = e.message.includes('42501') || e.message.includes('permission')
      ? 'RLS is blocking reads — run: alter table bt_salesdata disable row level security'
      : e.message.slice(0, 60);
    allOk = false;
  }
  checks += row('📖', 'Read (RLS check)', canRead, readDetail);

  // 3. Supabase write (UPSERT with no-op — tests write permission)
  let canWrite = false, writeDetail = '';
  try {
    const { error } = await _sb().from(SB_TABLE).upsert(
      { id: SB_ID + '_test_ping', payload: { ping: true }, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    if (error) throw error;
    // Clean up test row
    await _sb().from(SB_TABLE).delete().eq('id', SB_ID + '_test_ping');
    canWrite    = true;
    writeDetail = 'Write + delete succeeded';
  } catch (e) {
    writeDetail = e.message.includes('42501') || e.message.includes('permission')
      ? 'RLS is blocking writes — run the SQL from the audit'
      : e.message.slice(0, 60);
    allOk = false;
  }
  checks += row('✏️', 'Write (RLS check)', canWrite, writeDetail);

  // 4. Real-time channel status
  const rtState = _sbChannel ? (_sbChannel.state || '') : '';
  const rtOk    = rtState === 'joined' || rtState === 'joining';
  const rtStat  = _sbChannel ? (rtState || 'unknown') : 'not started';
  if (!rtOk) allOk = false;
  checks += row('⚡', 'Real-time', rtOk, rtOk ? `Channel: ${rtStat}` : `Channel: ${rtStat} — reconnecting`);

  // 5. Offline queue
  const pending  = _hasPending();
  const queueOk  = !pending;
  checks += row('⏳', 'Offline queue', queueOk, pending ? 'Pending changes — push when ready' : 'No queued changes');

  // Summary line
  const summaryColor = allOk ? 'var(--green)' : 'var(--amber)';
  const summaryText  = allOk ? '✓ All checks passed — Supabase is fully connected' : '⚠ Some checks failed — see details above';
  checks += `<div style="margin-top:10px;font-size:12px;font-weight:700;color:${summaryColor}">${summaryText}</div>`;

  if (result) result.innerHTML = checks;
  if (btn)    { btn.disabled = false; btn.textContent = '🔍 Test Connection'; }
  sbLog(allOk ? '✓ Connection test passed' : '⚠ Connection test — some issues found', allOk ? 'ok' : 'err');
}

// ══════════════════════════════════════════════════════════════════
// COMPATIBILITY SHIMS  (other files call these — unchanged)
// ══════════════════════════════════════════════════════════════════
const pushToGitHub = pushToSupabase;
const manualSync   = (silent = false) => pullFromSupabase(silent);
const ghCfg        = () => true;

function updateGhBadge() {
  const b = document.getElementById('gh-badge');
  if (b) { b.className = 'badge bg-green'; b.textContent = 'Connected ✓'; }
  setSyncBadge('idle');
  const si = document.getElementById('sync-icon');
  if (si) si.textContent = '☁';
}

function saveAutoSettings() {
  const autoLoad = document.getElementById('auto-load')?.checked;
  const autoSave = document.getElementById('auto-save')?.checked;
  Actions.saveFeatureData('bt_auto_load', autoLoad ? '1' : '0');
  Actions.saveFeatureData('bt_auto_save', autoSave ? '1' : '0');
  toast('✓ Auto-sync settings saved — load:' + (autoLoad?'on':'off') + ' save:' + (autoSave?'on':'off'));
}

function startAutoInterval() { /* replaced by real-time subscription */ }

// ══════════════════════════════════════════════════════════════════
// INIT — UI shell on load; sync starts only after auth unlock
// ══════════════════════════════════════════════════════════════════
let _supabaseStarted = false;

function resetSupabaseSync() {
  _supabaseStarted = false;
}

async function startSupabaseSync() {
  if (_supabaseStarted) return;
  _supabaseStarted = true;

  _updateRealtimeStatus(false);
  _updateLastPollDisplay();
  _startRealtime();

  if (typeof initSyncCenter === 'function') await initSyncCenter();

  if (navigator.onLine) {
    sbLog('🔄 Startup pull — loading latest data…', 'info');
    pullFromSupabase(true);
  }

  if (_hasPending() && navigator.onLine) {
    sbLog('⚡ Offline changes pending — syncing…', 'info');
    setTimeout(() => pushToSupabase(), 1200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateGhBadge();

  const synci = document.getElementById('synci');
  if (synci) synci.title = 'Supabase sync';

  const logEl = document.getElementById('ghlog');
  if (logEl) logEl.innerHTML = '<div style="color:var(--t2)">Supabase sync ready…</div>';

  renderSyncHistory();
  _updateRealtimeStatus(false);
  _updateLastPollDisplay();
});

// ══════════════════════════════════════════════════════════════════
// HARD REFRESH — clear all caches then reload
// ══════════════════════════════════════════════════════════════════
async function hardRefreshCache() {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Hard Refresh'));
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Clearing…'; }

  try {
    // 1. Unregister all service workers
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // 2. Clear all Cache Storage caches
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // 3. Reload bypassing browser cache
    location.reload(true);
  } catch (e) {
    console.error('Hard refresh failed:', e);
    location.reload(true);
  }
}
