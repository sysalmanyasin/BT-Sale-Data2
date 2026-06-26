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

let _sbClient  = null;
let _sbChannel = null;

function _sb() {
  if (!_sbClient) _sbClient = supabase.createClient(SB_URL, SB_KEY);
  return _sbClient;
}

// ══════════════════════════════════════════════════════════════════
// SYNC HISTORY
// ══════════════════════════════════════════════════════════════════
function _recordHistory(entry) {
  // entry: { type, status, monthly, daily, msg }
  const hist = JSON.parse(localStorage.getItem(SB_HISTORY) || '[]');
  hist.unshift({ ...entry, time: new Date().toISOString() });
  if (hist.length > 10) hist.length = 10;
  localStorage.setItem(SB_HISTORY, JSON.stringify(hist));
  renderSyncHistory();
}

function renderSyncHistory() {
  const el = document.getElementById('sync-history-list');
  if (!el) return;
  const hist = JSON.parse(localStorage.getItem(SB_HISTORY) || '[]');
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
function _markPending()  { localStorage.setItem(SB_PENDING, Date.now()); }
function _clearPending() { localStorage.removeItem(SB_PENDING); }
function _hasPending()   { return !!localStorage.getItem(SB_PENDING); }

// ══════════════════════════════════════════════════════════════════
// BUILD PAYLOAD  (every section the app owns)
// ══════════════════════════════════════════════════════════════════
function _buildPayload() {
  const petty = {}, incentive = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('mw_petty_'))     petty[k]     = JSON.parse(localStorage.getItem(k) || 'null');
    if (k.startsWith('mw_incentive_')) incentive[k] = JSON.parse(localStorage.getItem(k) || 'null');
  }
  return {
    monthly:  MONTHLY,
    daily:    DAILY,
    staff:    STAFF,
    manager:  JSON.parse(localStorage.getItem(MGR_KEY)  || '{}'),
    petty,
    incentive,
    custom:   JSON.parse(localStorage.getItem(CSEC_KEY) || '{}'),
    targets:  JSON.parse(localStorage.getItem(TGT_K)    || '{}'),
    pushedAt: new Date().toISOString()
  };
}

// ══════════════════════════════════════════════════════════════════
// MERGE  (proven logic — local wins on push, remote wins on pull)
// ══════════════════════════════════════════════════════════════════
function mergeIncomingData(data, isPull = false) {
  let mN = 0, dN = 0, mU = 0, dU = 0;

  if (data.monthly) data.monthly.forEach(m => {
    const idx = MONTHLY.findIndex(x => x.Month_Year === m.Month_Year);
    if (idx === -1)  { MONTHLY.push(m); mN++; }
    else if (isPull) { Object.assign(MONTHLY[idx], m); mU++; }
  });

  if (data.daily) data.daily.forEach(d => {
    const idx = DAILY.findIndex(x => x.Date === d.Date && x.Month_Year === d.Month_Year);
    if (idx === -1)  { DAILY.push(d); dN++; }
    else if (isPull) { Object.assign(DAILY[idx], d); dU++; }
  });

  if (data.staff && data.staff.length) {
    const local  = JSON.parse(localStorage.getItem(STAFF_KEY) || '[]');
    const merged = [...data.staff];
    const norm   = s => (s || '').trim().toLowerCase();
    local.forEach(le => {
      if (!merged.find(r => r.id === le.id) && !merged.find(r => norm(r.name) === norm(le.name)))
        merged.push(le);
    });
    STAFF = merged;
    localStorage.setItem(STAFF_KEY, JSON.stringify(STAFF));
  }

  if (data.manager) {
    const cur = JSON.parse(localStorage.getItem(MGR_KEY) || '{}');
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
    localStorage.setItem(MGR_KEY, JSON.stringify(merged));
  }

  if (data.petty) {
    Object.entries(data.petty).forEach(([k, v]) => {
      if (v == null) return;
      if (isPull)                        localStorage.setItem(k, JSON.stringify(v));
      else if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v));
    });
  }

  if (data.incentive) {
    Object.entries(data.incentive).forEach(([k, v]) => {
      if (v == null) return;
      if (isPull)                        localStorage.setItem(k, JSON.stringify(v));
      else if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v));
    });
  }

  if (data.custom) {
    const local  = JSON.parse(localStorage.getItem(CSEC_KEY) || '{}');
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
    localStorage.setItem(CSEC_KEY, JSON.stringify(merged));
  }

  if (data.targets) {
    const local  = JSON.parse(localStorage.getItem(TGT_K) || '{}');
    const merged = JSON.parse(JSON.stringify(local || {}));
    Object.keys(data.targets).forEach(month => {
      if (isPull) merged[month] = data.targets[month];          // remote wins on pull
      else if (!(month in merged)) merged[month] = data.targets[month]; // local wins on push — only fill gaps
    });
    localStorage.setItem(TGT_K, JSON.stringify(merged));
  }

  return { mN, dN, mU, dU };
}

// ══════════════════════════════════════════════════════════════════
// PUSH TO SUPABASE
// ══════════════════════════════════════════════════════════════════
async function pushToSupabase() {
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
  }
}

// ══════════════════════════════════════════════════════════════════
// PULL FROM SUPABASE
// ══════════════════════════════════════════════════════════════════
async function pullFromSupabase(silent = false) {
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
    recomputeAllMonths();
    rebuildAll();
    idbSaveData();

    const summary = `+${mN} new months / ${mU} updated · +${dN} new daily / ${dU} updated`;
    if (!silent) {
      sbLog('✓ Pulled. ' + summary, 'ok');
      toast('✓ Synced from Supabase');
    }
    setSyncBadge('ok');
    _recordHistory({ type: 'pull', status: 'ok', monthly: mN + mU, daily: dN + dU, msg: silent ? 'Auto-pull on unlock' : 'Manual pull' });
  } catch (e) {
    sbLog('✕ Pull failed: ' + e.message, 'err');
    setSyncBadge('err');
    _recordHistory({ type: 'pull', status: 'err', msg: e.message.slice(0, 60) });
    if (!silent) toast('✕ Pull failed: ' + e.message.slice(0, 50), 'e');
  }
}


// ══════════════════════════════════════════════════════════════════
// REAL-TIME SUBSCRIPTION
// ══════════════════════════════════════════════════════════════════
function _startRealtime() {
  const db = _sb();
  if (_sbChannel) db.removeChannel(_sbChannel);
  _sbChannel = db
    .channel('bt-sync')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: SB_TABLE }, () => {
      sbLog('⚡ Remote update — syncing…', 'info');
      pullFromSupabase(true).then(() => {
        toast('⚡ Synced from another device');
        _recordHistory({ type: 'realtime', status: 'ok', msg: 'Received update from another device' });
      });
    })
    .subscribe();
}

// ══════════════════════════════════════════════════════════════════
// OFFLINE ↔ ONLINE
// ══════════════════════════════════════════════════════════════════
window.addEventListener('online', () => {
  sbLog('↑ Back online' + (_hasPending() ? ' — flushing queue…' : ''), 'info');
  if (_hasPending()) {
    _recordHistory({ type: 'offline', status: 'ok', msg: 'Back online — flushing queued changes' });
    pushToSupabase();
  } else {
    pullFromSupabase(true);
  }
});
window.addEventListener('offline', () => {
  sbLog('↓ Offline — changes saved locally, sync on reconnect', 'info');
  setSyncBadge('queue');
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
  const rtOk   = _sbChannel !== null;
  const rtStat = _sbChannel ? (_sbChannel.state || 'subscribed') : 'not started';
  if (!rtOk) allOk = false;
  checks += row('⚡', 'Real-time', rtOk, rtOk ? `Channel: ${rtStat}` : 'Channel not initialised');

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

function saveGhConfig()  {}
function clearGhConfig() {}

function updateGhBadge() {
  const b = document.getElementById('gh-badge');
  if (b) { b.className = 'badge bg-green'; b.textContent = 'Connected ✓'; }
  setSyncBadge('idle');
  const si = document.getElementById('sync-icon');
  if (si) si.textContent = '☁';
}

function saveAutoSettings() {
  localStorage.setItem('bt_auto_load', document.getElementById('auto-load')?.checked ? '1' : '0');
  localStorage.setItem('bt_auto_save', document.getElementById('auto-save')?.checked ? '1' : '0');
  toast('✓ Auto-sync settings saved');
}

function startAutoInterval() { /* replaced by real-time subscription */ }

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  updateGhBadge();

  const synci = document.getElementById('synci');
  if (synci) synci.title = 'Supabase sync';

  const logEl = document.getElementById('ghlog');
  if (logEl) logEl.innerHTML = '<div style="color:var(--t2)">Supabase sync ready…</div>';

  // Render history immediately from localStorage
  renderSyncHistory();

  // Start real-time listener
  _startRealtime();

  // Auto-load on unlock
  if (localStorage.getItem('bt_auto_load') === '1') pullFromSupabase(true);

  // Flush any offline queue from a previous session
  if (_hasPending() && navigator.onLine) {
    sbLog('⚡ Offline changes pending — syncing…', 'info');
    pushToSupabase();
  }
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
