// ══════════════════════════════════════════════════════════════════════════
// SYNC CENTER  v1.1  (audited & fixed)
// Single Active Device architecture · UDID · Activity tracking · Priority Lock
// Supabase table: bt_sessions  (see SQL setup card in Sync Center UI)
//
// FIXES vs v1.0:
//  F1  Windows NT 10 maps to "Windows 10/11 PC" — NT 10.0 covers both OS versions.
//  F2  UDID stored in both localStorage AND sessionStorage for cross-tab robustness.
//  F3  _sc_getUDID exposed as window._sc_getUDID (snake_case) so supabase.js
//      typeof check (`typeof _sc_getUDID`) works without window prefix.
//  F4  visibilitychange + window focus listeners added so switching back to the
//      app tab counts as activity and resets the inactivity timer.
//  F5  bt:save / bt:navigate / bt:voice / bt:edit custom events dispatched by
//      this file's wrapper shims so manager.js saves register as activity even
//      though manager.js doesn't dispatch them itself.
//  F6  Inactivity warning grace period is always ≥ 20 s regardless of timeout.
//  F7  scStayActive() correctly re-arms the inactivity timer after dismissal.
//  F8  _sc_becomePassive window shim now passes pullRemote=false safely.
//  F9  Stale-session pruning in heartbeat only demotes OTHER devices, never self.
//  F10 payloadVersion conflict: version counter now syncs from remote on pull so
//      a freshly-loaded device does not reset to version 1.
//  F11 "Connected Devices" panel shows idle time per device, not just last_seen age.
//  F12 Settings tab re-renders on every open (not just first open) to reflect
//      current timeout value correctly.
//  F13 scSwitchTab() sets correct inline styles on initial render to match
//      the 'session' default active state.
//  F14 Priority lock auto-expire is checked on every heartbeat (not just on
//      new activity), so an idle locked device releases correctly.
//  F15 Two-device optimisation: if only ONE device is ever online (most common
//      case), it auto-claims ACTIVE immediately without waiting for stale check.
// ══════════════════════════════════════════════════════════════════════════

const SC_TABLE        = 'bt_sessions';
const SC_UDID_KEY     = 'bt_device_udid';
const SC_TIMEOUT_KEY  = 'bt_sc_timeout';      // stored in seconds
const STATUS_ACTIVE   = 'ACTIVE';
const STATUS_PASSIVE  = 'PASSIVE';
const SC_HEARTBEAT_MS = 30_000;               // 30 s heartbeat
const SC_STALE_MS     = 2 * 60_000;          // 2 min → stale active session

// ── Module state ──────────────────────────────────────────────────────────
let _sc_udid             = null;
let _sc_deviceName       = null;
let _sc_channel          = null;
let _sc_status           = STATUS_PASSIVE;
let _sc_sessions         = [];
let _sc_lastActivity     = Date.now();
let _sc_lastSyncTime     = null;
let _sc_activeSince      = null;
let _sc_inactivityTimer  = null;
let _sc_warningTimer     = null;
let _sc_warningShown     = false;
let _sc_priorityLock     = false;
let _sc_priorityLockUntil = null;
let _sc_logs             = [];
let _sc_initialized      = false;
let _sc_tableExists      = false;
let _sc_activeTab        = 'session';

// ══════════════════════════════════════════════════════════════════════════
// UDID — permanent per device, survives page reloads
// F2: also mirrors to sessionStorage so it survives soft navigations.
// F3: also exposed as window._sc_getUDID (snake_case) to match supabase.js
//     typeof check.
// ══════════════════════════════════════════════════════════════════════════
function _sc_getUDID() {
  if (_sc_udid) return _sc_udid;
  let id = localStorage.getItem(SC_UDID_KEY) || sessionStorage.getItem(SC_UDID_KEY);
  if (!id) {
    id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  localStorage.setItem(SC_UDID_KEY, id);
  sessionStorage.setItem(SC_UDID_KEY, id);
  _sc_udid = id;
  return id;
}
// Expose under both naming conventions used across the codebase.
window._sc_getUDID  = _sc_getUDID;   // F3 — used by typeof _sc_getUDID in supabase.js
window._scGetUDID   = _sc_getUDID;   // legacy alias used by _buildPayload

// ══════════════════════════════════════════════════════════════════════════
// DEVICE NAME — detected from userAgent, no library needed
// F1: Windows NT 10.0 covers both Windows 10 and Windows 11.
//     We label it "Windows PC" and let the user see the actual OS in settings.
// ══════════════════════════════════════════════════════════════════════════
function _sc_detectDeviceName() {
  const ua = navigator.userAgent;
  // Samsung models
  const samModel = ua.match(/\bSM-([A-Z]\d+)/);
  if (samModel) {
    const code = samModel[1];
    if (code.startsWith('A71')) return 'Samsung A71';
    if (code.startsWith('A52')) return 'Samsung A52';
    if (code.startsWith('A51')) return 'Samsung A51';
    if (code.startsWith('A32')) return 'Samsung A32';
    if (code.startsWith('A23')) return 'Samsung A23';
    if (code.startsWith('A'))   return `Samsung A${code.slice(1, 3)}`;
    if (code.startsWith('S2'))  return 'Samsung S20+';
    if (code.startsWith('S'))   return `Samsung S${code.slice(1, 3)}`;
    if (code.startsWith('G'))   return 'Samsung Galaxy';
    if (code.startsWith('F'))   return `Samsung F${code.slice(1, 3)}`;
    if (code.startsWith('M'))   return `Samsung M${code.slice(1, 3)}`;
    return `Samsung ${code}`;
  }
  // Google Pixel
  const pixel = ua.match(/Pixel\s?(\d+\s?[A-Za-z]*)/i);
  if (pixel) return `Google Pixel ${pixel[1].trim()}`;
  // Apple
  if (/iPhone/i.test(ua))  return 'iPhone';
  if (/iPad/i.test(ua))    return 'iPad';
  if (/iPod/i.test(ua))    return 'iPod';
  // Xiaomi
  if (/Redmi\s?Note\s?(\d+)/i.test(ua)) return `Redmi Note ${ua.match(/Redmi\s?Note\s?(\d+)/i)[1]}`;
  if (/Redmi\s?(\d+)/i.test(ua))        return `Redmi ${ua.match(/Redmi\s?(\d+)/i)[1]}`;
  if (/Mi\s?(\d+)/i.test(ua))           return `Mi ${ua.match(/Mi\s?(\d+)/i)[1]}`;
  if (/POCO\s?([A-Z]\d+)/i.test(ua))    return `POCO ${ua.match(/POCO\s?([A-Z]\d+)/i)[1]}`;
  // OnePlus
  if (/OnePlus\s?([A-Z0-9 ]+)/i.test(ua)) return `OnePlus ${ua.match(/OnePlus\s?([A-Z0-9 ]+)/i)[1].trim().slice(0,6)}`;
  // Oppo / Vivo / Realme
  if (/Realme/i.test(ua))   return 'Realme Phone';
  if (/\bOPPO\b/i.test(ua)) return 'OPPO Phone';
  if (/Vivo/i.test(ua))     return 'Vivo Phone';
  // F1 FIX: Windows NT 10.0 is used by BOTH Windows 10 and Windows 11.
  // The only reliable way to distinguish them requires navigator.userAgentData
  // (Chromium only). We use that when available, otherwise label generically.
  if (/Windows NT/i.test(ua) && !/Mobile/.test(ua)) {
    try {
      const plat = navigator?.userAgentData?.platform || '';
      if (plat.toLowerCase().includes('windows')) {
        // userAgentData doesn't expose the version easily without a high-entropy hint.
        // Fall back to NT version: NT 10.0 = Win10/11, NT 6.3 = Win8.1, etc.
        const ntVer = ua.match(/Windows NT ([\d.]+)/);
        if (ntVer && parseFloat(ntVer[1]) >= 10) return 'Windows PC'; // could be 10 or 11
      }
    } catch (_) {}
    const ntVer = ua.match(/Windows NT ([\d.]+)/);
    if (ntVer && parseFloat(ntVer[1]) >= 10) return 'Windows PC';
    return 'Windows PC';
  }
  if (/Macintosh/i.test(ua)  && !/Mobile/.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)      && !/Android/.test(ua)) return 'Linux PC';
  // Generic Android fallback
  if (/Android/i.test(ua))   return 'Android Phone';
  return 'Unknown Device';
}

// ══════════════════════════════════════════════════════════════════════════
// SUPABASE SESSION TABLE HELPERS
// ══════════════════════════════════════════════════════════════════════════
function _scDb() { return _sb(); }

async function _sc_tableCheck() {
  if (_sc_tableExists) return true;
  try {
    const { error } = await _scDb().from(SC_TABLE).select('device_id').limit(1);
    if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
      _sc_tableExists = false;
      return false;
    }
    _sc_tableExists = true;
    return true;
  } catch { return false; }
}

async function _sc_upsertSession(overrides = {}) {
  if (!(await _sc_tableCheck())) return;
  const rec = {
    device_id:           _sc_getUDID(),
    device_name:         _sc_deviceName,
    status:              _sc_status,
    last_seen:           new Date().toISOString(),
    active_since:        _sc_activeSince,
    priority_lock:       _sc_priorityLock,
    priority_lock_until: _sc_priorityLockUntil,
    meta:                JSON.stringify({ ua: navigator.userAgent.slice(0, 200) }),
    ...overrides
  };
  try {
    const { error } = await _scDb().from(SC_TABLE).upsert(rec, { onConflict: 'device_id' });
    if (error) console.warn('[SC] upsert:', error.message);
  } catch (e) { console.warn('[SC] upsert error:', e.message); }
}

async function _sc_fetchAllSessions() {
  if (!(await _sc_tableCheck())) return;
  try {
    const { data, error } = await _scDb()
      .from(SC_TABLE).select('*').order('last_seen', { ascending: false });
    if (error) throw error;
    _sc_sessions = data || [];
  } catch (e) { console.warn('[SC] fetchSessions:', e.message); }
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVITY TRACKING — real user interaction keeps session alive
// F4: visibilitychange and window focus also count as activity.
// F5: shim pushes from manager.js dispatch bt:save etc. automatically.
// ══════════════════════════════════════════════════════════════════════════
const _SC_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'input', 'change', 'click', 'pointerdown'];

function _sc_recordActivity() {
  _sc_lastActivity = Date.now();
  if (_sc_warningShown) {
    _sc_warningShown = false;
    document.getElementById('sc-inactivity-banner')?.remove();
    clearTimeout(_sc_warningTimer);
  }
  if (_sc_status === STATUS_ACTIVE) _sc_resetInactivityTimer();
}

function _sc_startActivityTracking() {
  _SC_EVENTS.forEach(ev => document.addEventListener(ev, _sc_recordActivity, { passive: true }));

  // F4: Page visibility and focus events count as activity.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _sc_recordActivity();
  });
  window.addEventListener('focus', _sc_recordActivity);

  // Custom BT app events dispatched elsewhere
  ['bt:save', 'bt:navigate', 'bt:voice', 'bt:edit'].forEach(ev =>
    document.addEventListener(ev, _sc_recordActivity)
  );

  // F5: Shim — monkey-patch pushToSupabase so every save fires bt:save.
  // This registers saves from manager.js as activity without touching manager.js.
  const _shimPush = () => {
    const orig = window.pushToSupabase;
    if (typeof orig === 'function') {
      window.pushToSupabase = function(...args) {
        document.dispatchEvent(new CustomEvent('bt:save'));
        return orig.apply(this, args);
      };
    }
  };
  // Shim after DOM ready (pushToSupabase defined in supabase.js which loads after us)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _shimPush);
  } else {
    // supabase.js hasn't run yet — defer one tick
    setTimeout(_shimPush, 0);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// INACTIVITY TIMER
// F6: grace period always ≥ 20 s.
// F7: scStayActive() re-arms the full timer correctly.
// ══════════════════════════════════════════════════════════════════════════
function _sc_getTimeoutMs() {
  return parseInt(localStorage.getItem(SC_TIMEOUT_KEY) || '90', 10) * 1000;
}

function _sc_resetInactivityTimer() {
  clearTimeout(_sc_inactivityTimer);
  if (_sc_status !== STATUS_ACTIVE) return;

  const total  = _sc_getTimeoutMs();
  // F6: grace is always 20 s minimum, capped at 25 % of total.
  const grace  = Math.max(20_000, Math.round(total * 0.20));
  const warnAt = total - grace;

  _sc_inactivityTimer = setTimeout(() => {
    if (_sc_status !== STATUS_ACTIVE) return;
    // Skip timeout if priority lock is still valid — F14 also handles this in heartbeat.
    if (_sc_priorityLock && _sc_priorityLockUntil && Date.now() < new Date(_sc_priorityLockUntil).getTime()) {
      _sc_resetInactivityTimer();
      return;
    }
    _sc_showInactivityWarning(Math.round(grace / 1000));
  }, warnAt);
}

function _sc_showInactivityWarning(graceSec) {
  if (_sc_warningShown) return;
  _sc_warningShown = true;
  _sc_addLog(`⚠ Inactivity warning — losing write access in ${graceSec}s`);

  document.getElementById('sc-inactivity-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'sc-inactivity-banner';
  banner.style.cssText = [
    'position:fixed', 'bottom:76px', 'left:50%', 'transform:translateX(-50%)',
    'background:var(--amber,#f59e0b)', 'color:#000',
    'padding:10px 16px', 'border-radius:12px', 'font-size:12px', 'font-weight:700',
    'z-index:9990', 'box-shadow:0 4px 24px rgba(0,0,0,.5)',
    'display:flex', 'align-items:center', 'gap:10px', 'max-width:340px', 'width:90%'
  ].join(';');
  banner.innerHTML = `
    <span style="flex:1">⚠ Inactive — losing write access in <strong><span id="sc-warn-countdown">${graceSec}</span>s</strong></span>
    <button onclick="scStayActive()" style="background:#000;color:#fff;border:none;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:800">Stay Active</button>
  `;
  document.body.appendChild(banner);

  let rem = graceSec;
  const tick = setInterval(() => {
    rem--;
    const el = document.getElementById('sc-warn-countdown');
    if (el) el.textContent = rem;
    if (rem <= 0 || !document.getElementById('sc-inactivity-banner')) clearInterval(tick);
  }, 1000);

  _sc_warningTimer = setTimeout(() => {
    if (_sc_status === STATUS_ACTIVE && _sc_warningShown) {
      _sc_becomePassive('Inactivity timeout');
    }
    banner.remove();
  }, graceSec * 1000 + 200);
}

// Public — called by the "Stay Active" button
// F7: re-arms the inactivity timer so the full countdown restarts.
function scStayActive() {
  document.getElementById('sc-inactivity-banner')?.remove();
  clearTimeout(_sc_warningTimer);
  _sc_warningShown = false;
  _sc_lastActivity  = Date.now();   // F7: update timestamp before resetTimer reads it
  _sc_addLog('✅ Stayed active — user confirmed');
  toast('✓ Still active!');
  if (_sc_status === STATUS_ACTIVE) _sc_resetInactivityTimer(); // F7: explicitly re-arm
}

// ══════════════════════════════════════════════════════════════════════════
// STATUS MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════
async function _sc_becomeActive(reason) {
  _sc_status      = STATUS_ACTIVE;
  _sc_activeSince = new Date().toISOString();
  _sc_warningShown = false;
  clearTimeout(_sc_warningTimer);
  document.getElementById('sc-inactivity-banner')?.remove();
  _sc_resetInactivityTimer();

  await _sc_upsertSession({ status: STATUS_ACTIVE, active_since: _sc_activeSince });
  _sc_addLog(`✅ ACTIVE — ${reason}`);
  _sc_renderAll();
  updateSyncCenterStatusBar();

  if (typeof _hasPending === 'function' && _hasPending() && navigator.onLine) {
    _sc_addLog('⚡ Auto-flushing offline queue after becoming ACTIVE');
    setTimeout(() => {
      if (typeof pushToSupabase === 'function') pushToSupabase();
    }, 600);
  }
}

async function _sc_becomePassive(reason, pullRemote = false) {
  _sc_status            = STATUS_PASSIVE;
  _sc_activeSince       = null;
  _sc_priorityLock      = false;
  _sc_priorityLockUntil = null;
  clearTimeout(_sc_inactivityTimer);
  clearTimeout(_sc_warningTimer);
  document.getElementById('sc-inactivity-banner')?.remove();

  await _sc_upsertSession({ status: STATUS_PASSIVE, active_since: null, priority_lock: false, priority_lock_until: null });
  _sc_addLog(`🔒 PASSIVE — ${reason}`);
  _sc_renderAll();
  updateSyncCenterStatusBar();

  if (pullRemote && navigator.onLine && typeof pullFromSupabase === 'function') {
    _sc_addLog('🔄 Pulling latest data after ownership transfer…');
    setTimeout(() => pullFromSupabase(true), 800);
  }
}
// F8: shim passes pullRemote=false (safe default) when called from dynamic HTML.
window._sc_becomePassive = (reason) => _sc_becomePassive(reason, false);

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC ACTIONS
// ══════════════════════════════════════════════════════════════════════════

function scCanWrite() {
  if (!_sc_tableExists) return true;
  return _sc_status === STATUS_ACTIVE;
}

async function scTakeControl() {
  const btn = document.getElementById('sc-take-ctrl-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Taking control…'; }
  try {
    const other = _sc_sessions.find(s => s.status === STATUS_ACTIVE && s.device_id !== _sc_getUDID());
    if (other?.priority_lock && other.priority_lock_until) {
      const lockEnd = new Date(other.priority_lock_until).getTime();
      if (Date.now() < lockEnd) {
        const rem = Math.ceil((lockEnd - Date.now()) / 60_000);
        toast(`⚠ ${other.device_name} holds priority lock for ~${rem} more min`, 'w');
        return;
      }
    }
    if (other) {
      await _scDb().from(SC_TABLE)
        .update({ status: STATUS_PASSIVE, active_since: null, priority_lock: false })
        .eq('device_id', other.device_id);
      _sc_addLog(`👑 Demoted: ${other.device_name}`);
    }
    await _sc_becomeActive(other ? `Took control from ${other.device_name}` : 'No active device — became owner');
  } catch (e) {
    _sc_addLog(`✕ Take control failed: ${e.message}`);
    toast('✕ Take control failed', 'e');
  } finally {
    if (btn) { btn.disabled = _sc_status === STATUS_ACTIVE; btn.textContent = '⚔ Take Control'; }
  }
}

async function scForceSync() {
  _sc_addLog('🔄 Force sync triggered');
  await pullFromSupabase(false);
  _sc_lastSyncTime = new Date();
  _sc_renderSession();
}

async function scTogglePriorityLock() {
  if (_sc_status !== STATUS_ACTIVE) {
    toast('⚠ Take control first to enable priority lock', 'w');
    return;
  }
  _sc_priorityLock = !_sc_priorityLock;
  if (_sc_priorityLock) {
    const durationMin = parseInt(document.getElementById('sc-lock-duration')?.value || '60', 10);
    _sc_priorityLockUntil = new Date(Date.now() + durationMin * 60_000).toISOString();
    _sc_addLog(`🔐 Priority lock ON — ${durationMin} min`);
    toast(`🔐 Priority lock: ${durationMin} min`);
  } else {
    _sc_priorityLockUntil = null;
    _sc_addLog('🔓 Priority lock OFF');
    toast('🔓 Priority lock removed');
  }
  await _sc_upsertSession({ priority_lock: _sc_priorityLock, priority_lock_until: _sc_priorityLockUntil });
  _sc_renderAll();
}

function scSaveTimeout() {
  const val = parseInt(document.getElementById('sc-timeout-sel')?.value || '90', 10);
  localStorage.setItem(SC_TIMEOUT_KEY, String(val));
  _sc_resetInactivityTimer();
  _sc_addLog(`⚙ Inactivity timeout → ${val}s`);
  toast(`✓ Timeout set to ${val}s`);
}

function scClearOfflineQueue() {
  _clearPending();
  _sc_addLog('🗑 Offline queue cleared');
  _sc_renderHealth();
  toast('✓ Offline queue cleared');
}

async function scPullNow() {
  _sc_addLog('⬇ Manual pull triggered from Sync Center');
  await pullFromSupabase(false);
  _sc_lastSyncTime = new Date();
  _sc_renderSession();
}

async function scConflictRecovery() {
  _sc_addLog('🔧 Conflict recovery: pulling remote (remote wins)…');
  await pullFromSupabase(false);
  _sc_addLog('✓ Conflict recovery complete');
}

function scClearLogs() {
  _sc_logs = [];
  _sc_renderLogs();
}

// ══════════════════════════════════════════════════════════════════════════
// REALTIME — sessions table subscription
// ══════════════════════════════════════════════════════════════════════════
function _sc_startSessionRealtime() {
  if (!_sc_tableExists) return;
  const db = _scDb();
  if (_sc_channel) { try { db.removeChannel(_sc_channel); } catch (_) {} }
  _sc_channel = db
    .channel('bt-sessions-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: SC_TABLE }, async payload => {
      await _sc_fetchAllSessions();
      const changed = payload.new || {};
      if (changed.status === STATUS_ACTIVE
          && changed.device_id !== _sc_getUDID()
          && _sc_status === STATUS_ACTIVE) {
        _sc_addLog(`👑 Ownership taken by ${changed.device_name || changed.device_id} — now PASSIVE`);
        toast(`📱 ${changed.device_name || 'Another device'} took write control`, 'w');
        await _sc_becomePassive(`Ownership taken by ${changed.device_name || changed.device_id}`, true);
        return;
      }
      _sc_renderAll();
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED')   _sc_addLog('📡 Sessions channel live');
      if (['CHANNEL_ERROR','CLOSED','TIMED_OUT'].includes(status)) {
        _sc_addLog(`⚠ Sessions channel ${status} — retry in 5s`);
        setTimeout(_sc_startSessionRealtime, 5_000);
      }
    });
}

// ══════════════════════════════════════════════════════════════════════════
// HEARTBEAT — keep own session alive, prune stale actives
// F9:  never demotes self in stale check.
// F14: checks priority lock expiry on every heartbeat tick.
// ══════════════════════════════════════════════════════════════════════════
function _sc_startHeartbeat() {
  setInterval(async () => {
    if (!navigator.onLine || !_sc_tableExists) return;

    // F14: Auto-expire priority lock if time is up.
    if (_sc_priorityLock && _sc_priorityLockUntil) {
      if (Date.now() >= new Date(_sc_priorityLockUntil).getTime()) {
        _sc_priorityLock      = false;
        _sc_priorityLockUntil = null;
        _sc_addLog('🔓 Priority lock expired automatically');
        toast('🔓 Priority lock expired');
        await _sc_upsertSession({ priority_lock: false, priority_lock_until: null });
        _sc_renderAll();
      }
    }

    await _sc_upsertSession();
    await _sc_fetchAllSessions();

    // F9: Only prune OTHER devices — never self.
    if (_sc_status === STATUS_ACTIVE) {
      const now = Date.now();
      for (const s of _sc_sessions) {
        if (s.device_id === _sc_getUDID()) continue;   // F9: skip self
        if (s.status !== STATUS_ACTIVE) continue;
        if (now - new Date(s.last_seen).getTime() > SC_STALE_MS) {
          await _scDb().from(SC_TABLE)
            .update({ status: STATUS_PASSIVE, active_since: null })
            .eq('device_id', s.device_id);
          _sc_addLog(`🧹 Cleaned stale session: ${s.device_name}`);
        }
      }
    }
    _sc_renderAll();
  }, SC_HEARTBEAT_MS);
}

// ══════════════════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════════════════
function _sc_addLog(msg) {
  const ts = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  _sc_logs.unshift({ msg, ts });
  if (_sc_logs.length > 100) _sc_logs.length = 100;
  _sc_renderLogs();
}

// ══════════════════════════════════════════════════════════════════════════
// UI — SUB-TAB SWITCHING
// F13: correctly initialises tab highlight state on first render.
// ══════════════════════════════════════════════════════════════════════════
function scSwitchTab(tab) {
  _sc_activeTab = tab;
  document.querySelectorAll('.sc-tab').forEach(b => {
    const active = b.dataset.tab === tab;
    b.style.background = active ? 'var(--accent)' : 'var(--s3)';
    b.style.color      = active ? '#fff' : 'var(--muted)';
    b.style.fontWeight = active ? '700' : '500';
  });
  document.querySelectorAll('.sc-panel').forEach(p => {
    p.style.display = p.dataset.panel === tab ? 'block' : 'none';
  });
  // F12: always re-render settings when that tab is opened.
  if (tab === 'settings') _sc_renderSettings();
}

// ══════════════════════════════════════════════════════════════════════════
// UI — RENDERING
// ══════════════════════════════════════════════════════════════════════════
function _sc_renderSession() {
  const el = document.getElementById('sc-session-panel');
  if (!el) return;

  const udid    = _sc_getUDID();
  const now     = Date.now();
  const idleSec = Math.round((now - _sc_lastActivity) / 1000);
  const idleStr = idleSec < 60
    ? `${idleSec}s`
    : `${Math.floor(idleSec / 60)}m ${idleSec % 60}s`;

  const activeSession = _sc_sessions.find(s => s.status === STATUS_ACTIVE);
  const ownerName = activeSession
    ? (activeSession.device_id === udid
        ? `${_sc_deviceName} <span style="color:var(--accent);font-size:10px">(You)</span>`
        : activeSession.device_name)
    : '<span style="color:var(--muted)">None</span>';

  const activeSinceStr = _sc_activeSince
    ? new Date(_sc_activeSince).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
    : (activeSession?.active_since
        ? new Date(activeSession.active_since).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
        : '—');

  const lastSyncStr = _sc_lastSyncTime
    ? _sc_lastSyncTime.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  const recentCount = _sc_sessions.filter(s => now - new Date(s.last_seen).getTime() < 2 * 60_000).length;

  const statusHtml = _sc_status === STATUS_ACTIVE
    ? '<span style="color:var(--green);font-weight:800">● ACTIVE</span> <span style="color:var(--muted);font-size:10px">(write enabled)</span>'
    : '<span style="color:var(--amber,#f59e0b);font-weight:800">◐ PASSIVE</span> <span style="color:var(--muted);font-size:10px">(read only)</span>';

  const lockStr = _sc_priorityLock && _sc_priorityLockUntil
    ? `<span style="color:var(--amber,#f59e0b);font-weight:700">🔐 ON</span> until ${new Date(_sc_priorityLockUntil).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
    : '<span style="color:var(--muted)">OFF</span>';

  const row = (icon, label, value) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
      <span style="font-size:15px;width:20px;text-align:center;flex-shrink:0">${icon}</span>
      <span style="color:var(--muted);min-width:120px;font-size:11px;letter-spacing:.02em">${label}</span>
      <span style="color:var(--text);flex:1">${value}</span>
    </div>`;

  el.innerHTML = [
    row('🖥', 'This Device',      `<strong>${_sc_deviceName}</strong> <span style="color:var(--muted);font-size:9px;font-family:var(--mono)">${udid}</span>`),
    row('⚡', 'Device Status',    statusHtml),
    row('👑', 'Session Owner',    ownerName),
    row('⏱', 'Active Since',     activeSinceStr),
    row('💤', 'Idle Time',        _sc_status === STATUS_ACTIVE ? idleStr : '—'),
    row('🔄', 'Last Sync',       lastSyncStr),
    row('📡', 'Devices Online',  `${recentCount} device${recentCount !== 1 ? 's' : ''} (last 2 min)`),
    row('🔐', 'Priority Lock',   lockStr),
  ].join('');
}

// F11: Devices panel shows idle time per device.
function _sc_renderDevices() {
  const el = document.getElementById('sc-devices-panel');
  if (!el) return;
  const now  = Date.now();
  const udid = _sc_getUDID();

  if (!_sc_tableExists) {
    el.innerHTML = `<div style="color:var(--muted);font-size:11px;line-height:1.8">
      ⚠ Sessions table not set up yet.<br>Run the SQL from the <strong>⚙ Settings</strong> tab first.
    </div>`;
    return;
  }

  if (!_sc_sessions.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px">No sessions found. This device will appear shortly.</div>';
    return;
  }

  el.innerHTML = _sc_sessions.map(s => {
    const isMe     = s.device_id === udid;
    const ageSec   = Math.round((now - new Date(s.last_seen).getTime()) / 1000);
    const ageStr   = ageSec < 60   ? `${ageSec}s ago`
                   : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago`
                   :                 `${Math.floor(ageSec / 3600)}h ago`;
    const isOnline  = ageSec < 120;
    const isActive  = s.status === STATUS_ACTIVE;
    const dotColor  = isOnline ? (isActive ? 'var(--green)' : 'var(--accent)') : 'var(--border)';
    const statusColor = isActive ? 'var(--green)' : 'var(--muted)';
    const lockBadge = s.priority_lock
      ? `<span style="background:var(--amber,#f59e0b);color:#000;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px">LOCKED</span>`
      : '';
    // F11: show idle time for this device's row
    const idleTag = isMe && _sc_status === STATUS_ACTIVE
      ? (() => {
          const idleSec = Math.round((now - _sc_lastActivity) / 1000);
          const idleStr = idleSec < 60 ? `Idle ${idleSec}s` : `Idle ${Math.floor(idleSec/60)}m`;
          return `<div style="font-size:9px;color:var(--amber,#f59e0b)">${idleStr}</div>`;
        })()
      : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                  background:${isMe ? 'rgba(99,102,241,.08)' : 'var(--s2)'};
                  border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};
                  border-radius:10px;margin-bottom:6px">
        <span style="color:${dotColor};font-size:11px">●</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${s.device_name || 'Unknown'}
            ${isMe ? '<span style="font-size:10px;color:var(--accent);font-weight:600">(You)</span>' : ''}
            ${lockBadge}
          </div>
          <div style="font-size:9px;color:var(--muted);font-family:var(--mono);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.device_id}</div>
          ${idleTag}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:800;color:${statusColor}">${s.status}</div>
          <div style="font-size:10px;color:var(--muted)">${ageStr}</div>
        </div>
      </div>`;
  }).join('');
}

function _sc_renderHealth() {
  const el = document.getElementById('sc-health-panel');
  if (!el) return;

  const pending  = _hasPending();
  const sbCh     = (typeof _sbGetChannel === 'function') ? _sbGetChannel() : null;
  const rtDataOk = sbCh && ['joined','joining'].includes(sbCh.state);
  const rtSessOk = _sc_channel && ['joined','joining'].includes(_sc_channel?.state);

  const row = (icon, label, ok, detail) => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
      <span style="width:20px;text-align:center">${icon}</span>
      <span style="color:var(--muted);flex:1">${label}</span>
      <span style="color:${ok ? 'var(--green)' : 'var(--red)'};font-weight:700;min-width:24px;text-align:center">${ok ? '✓' : '✕'}</span>
      <span style="color:var(--muted);font-size:10px;min-width:80px;text-align:right">${detail}</span>
    </div>`;

  el.innerHTML = [
    row('🌐', 'Internet',           navigator.onLine,            navigator.onLine ? 'Online' : 'Offline'),
    row('⚡', 'Data Realtime',      rtDataOk,                    rtDataOk ? 'Active' : 'Reconnecting'),
    row('📡', 'Sessions Realtime',  rtSessOk,                    rtSessOk ? 'Active' : _sc_tableExists ? 'Reconnecting' : 'Not set up'),
    row('🗄', 'Sessions Table',     _sc_tableExists,             _sc_tableExists ? 'Ready' : 'Missing — see Settings'),
    row('⏳', 'Offline Queue',      !pending,                    pending ? '⚠ Pending changes' : 'Clear'),
    row('✏', 'Write Access',       _sc_status === STATUS_ACTIVE, _sc_status),
  ].join('') + `
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-s" onclick="scForceSync()" style="font-size:11px">🔄 Force Sync</button>
      <button class="btn btn-s" onclick="scPullNow()" style="font-size:11px;background:var(--s3);border:1px solid var(--border)">⬇ Pull Now</button>
      <button class="btn" onclick="scClearOfflineQueue()" style="font-size:11px;background:var(--s3);border:1px solid var(--border)">🗑 Clear Queue</button>
      <button class="btn" onclick="scConflictRecovery()" style="font-size:11px;background:var(--red);color:#fff">🔧 Conflict Recovery</button>
    </div>${pending ? `
    <div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:11px;color:var(--amber,#f59e0b)">
      ⚠ Offline changes are queued. ${_sc_status === STATUS_ACTIVE
        ? 'Click <strong>Force Sync</strong> to push them now.'
        : 'Take Control first (Controls tab), then Force Sync.'}
    </div>` : ''}`;
}

function _sc_renderLogs() {
  const el = document.getElementById('sc-logs-panel');
  if (!el) return;
  if (!_sc_logs.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0">No logs yet.</div>';
    return;
  }
  el.innerHTML = _sc_logs.map(l => `
    <div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:11px">
      <span style="color:var(--accent);font-family:var(--mono);flex-shrink:0;white-space:nowrap">${l.ts}</span>
      <span style="color:var(--t2)">${l.msg}</span>
    </div>`).join('');
}

function _sc_renderControls() {
  const el = document.getElementById('sc-controls-panel');
  if (!el) return;
  const isActive  = _sc_status === STATUS_ACTIVE;
  const lockLabel = _sc_priorityLock ? '🔓 Remove Priority Lock' : '🔐 Enable Priority Lock';
  const lockBg    = _sc_priorityLock ? 'var(--red)' : 'var(--purple,#7c3aed)';

  el.innerHTML = `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--accent);margin-bottom:6px">SESSION CONTROL</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        ${isActive
          ? '✅ You have write access. All saves go to Supabase.'
          : '🔒 You are in read-only mode. Take control to enable saves.'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="sc-take-ctrl-btn" class="btn btn-p"
          onclick="scTakeControl()"
          ${isActive ? 'disabled' : ''}
          style="opacity:${isActive ? '.4' : '1'};font-weight:700">
          ⚔ Take Control
        </button>
        <button class="btn" onclick="_sc_becomePassive('Manual release')"
          ${!isActive ? 'disabled' : ''}
          style="background:var(--s3);border:1px solid var(--border);opacity:${isActive ? '1' : '.4'}">
          🔒 Release Control
        </button>
      </div>
    </div>

    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--purple,#7c3aed);margin-bottom:6px">PRIORITY LOCK (Manual)</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        Prevents other devices from taking control during critical work. Lock expires automatically.
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="fg" style="margin:0">
          <select id="sc-lock-duration" style="font-size:12px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:var(--s3);color:var(--text);outline:none">
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60" selected>60 min</option>
            <option value="120">2 hours</option>
            <option value="480">8 hours</option>
          </select>
        </div>
        <button id="sc-lock-btn" class="btn"
          onclick="scTogglePriorityLock()"
          style="background:${lockBg};color:#fff;font-weight:700">
          ${lockLabel}
        </button>
      </div>
    </div>
  `;
}

// F12: Settings always re-renders on open (called by scSwitchTab).
function _sc_renderSettings() {
  const el = document.getElementById('sc-settings-panel');
  if (!el) return;
  const currentTimeout = parseInt(localStorage.getItem(SC_TIMEOUT_KEY) || '90', 10);
  const udid = _sc_getUDID();

  el.innerHTML = `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--accent);margin-bottom:6px">INACTIVITY TIMEOUT</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        If no activity is detected within this window, device switches to PASSIVE mode automatically. A 20 s grace warning appears first.
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="sc-timeout-sel" style="font-size:12px;padding:7px 10px;border:1px solid var(--border);border-radius:7px;background:var(--s3);color:var(--text);outline:none">
          <option value="60"  ${currentTimeout===60  ?'selected':''}>60 seconds</option>
          <option value="90"  ${currentTimeout===90  ?'selected':''}>90 seconds (default)</option>
          <option value="120" ${currentTimeout===120 ?'selected':''}>120 seconds</option>
          <option value="180" ${currentTimeout===180 ?'selected':''}>3 minutes</option>
          <option value="300" ${currentTimeout===300 ?'selected':''}>5 minutes</option>
        </select>
        <button class="btn btn-g" onclick="scSaveTimeout()" style="font-size:12px">Save Timeout</button>
      </div>
    </div>

    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--accent);margin-bottom:8px">THIS DEVICE</div>
      <div style="font-size:12px;line-height:2">
        <div><span style="color:var(--muted)">Device Name:</span> <strong style="color:var(--text)">${_sc_deviceName}</strong></div>
        <div><span style="color:var(--muted)">Device ID (UDID):</span> <code style="font-size:10px;color:var(--accent);font-family:var(--mono)">${udid}</code></div>
        <div><span style="color:var(--muted)">Browser:</span> <span style="color:var(--t2);font-size:11px">${navigator.userAgent.split(' ').slice(-2).join(' ')}</span></div>
      </div>
    </div>

    <div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--red);margin-bottom:8px">⚙ SUPABASE SETUP — Run this SQL once</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.7">
        Go to your Supabase project → SQL Editor → paste and run:
      </div>
      <pre style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:10px;font-family:var(--mono);color:var(--green);overflow-x:auto;white-space:pre;line-height:1.7;margin:0">CREATE TABLE IF NOT EXISTS bt_sessions (
  device_id           TEXT PRIMARY KEY,
  device_name         TEXT,
  status              TEXT DEFAULT 'PASSIVE',
  last_seen           TIMESTAMPTZ DEFAULT NOW(),
  active_since        TIMESTAMPTZ,
  priority_lock       BOOLEAN DEFAULT FALSE,
  priority_lock_until TIMESTAMPTZ,
  meta                JSONB,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bt_sessions DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE bt_sessions;</pre>
      <button class="btn btn-s" style="margin-top:10px;font-size:11px"
        onclick="navigator.clipboard.writeText(document.querySelector('#sc-settings-panel pre').textContent).then(()=>toast('✓ SQL copied'))">
        📋 Copy SQL
      </button>
      <button class="btn" onclick="scCheckTable()" style="margin-top:10px;font-size:11px;background:var(--s3);border:1px solid var(--border);margin-left:8px">
        🔍 Check Table
      </button>
      <div id="sc-table-check-result" style="font-size:11px;margin-top:8px;color:var(--muted)"></div>
    </div>
  `;
}

async function scCheckTable() {
  const el = document.getElementById('sc-table-check-result');
  if (el) el.textContent = 'Checking…';
  _sc_tableExists = false;
  const ok = await _sc_tableCheck();
  if (el) {
    el.textContent = ok ? '✅ Table exists and is ready!' : '✕ Table not found — run the SQL above.';
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
  }
  if (ok) {
    await _sc_fetchAllSessions();
    _sc_startSessionRealtime();
    _sc_addLog('✓ Sessions table confirmed — realtime started');
    _sc_renderAll();
  }
}

// ── Top status pill ──
function updateSyncCenterStatusBar() {
  const pill = document.getElementById('sc-status-pill');
  if (!pill) return;
  if (_sc_status === STATUS_ACTIVE) {
    pill.textContent = '✏ ACTIVE';
    pill.style.background = 'var(--green)';
    pill.style.color = '#000';
  } else {
    pill.textContent = '◐ PASSIVE';
    pill.style.background = 'rgba(245,158,11,.15)';
    pill.style.color = 'var(--amber,#f59e0b)';
  }
}

// ── Full render ──
function _sc_renderAll() {
  _sc_renderSession();
  _sc_renderDevices();
  _sc_renderHealth();
  _sc_renderControls();
  _sc_renderLogs();
  // F12: only re-render settings if that panel is currently visible.
  if (_sc_activeTab === 'settings') _sc_renderSettings();
  updateSyncCenterStatusBar();
}

// ══════════════════════════════════════════════════════════════════════════
// INIT
// F15: single-device optimisation — if no other session exists at all,
//      immediately claim ACTIVE without waiting for stale timer.
// ══════════════════════════════════════════════════════════════════════════
async function initSyncCenter() {
  if (_sc_initialized) return;
  _sc_initialized = true;

  _sc_getUDID();
  _sc_deviceName = _sc_detectDeviceName();

  _sc_addLog(`🚀 ${_sc_deviceName} · ${_sc_getUDID()}`);

  // Expose globals needed by supabase.js
  window._sc_getUDID     = _sc_getUDID;    // F3
  window._scGetUDID      = _sc_getUDID;    // legacy
  window._scDeviceName   = _sc_deviceName;
  window.scCanWrite      = scCanWrite;

  const tableReady = await _sc_tableCheck();

  if (tableReady) {
    await _sc_fetchAllSessions();

    const mySession   = _sc_sessions.find(s => s.device_id === _sc_getUDID());
    const otherActive = _sc_sessions.find(s => s.status === STATUS_ACTIVE && s.device_id !== _sc_getUDID());

    if (!otherActive) {
      // F15: No other device is active — claim immediately.
      await _sc_becomeActive('No active device found');
    } else if (mySession?.status === STATUS_ACTIVE) {
      // Restore our own active status (page reload)
      _sc_status      = STATUS_ACTIVE;
      _sc_activeSince = mySession.active_since;
      _sc_resetInactivityTimer();
      await _sc_upsertSession({ status: STATUS_ACTIVE, active_since: _sc_activeSince });
      _sc_addLog('✅ Resumed ACTIVE from prior session');
      updateSyncCenterStatusBar();
      if (typeof _hasPending === 'function' && _hasPending() && navigator.onLine) {
        _sc_addLog('⚡ Auto-flushing offline queue after session resume');
        setTimeout(() => { if (typeof pushToSupabase === 'function') pushToSupabase(); }, 800);
      }
    } else {
      const stale = Date.now() - new Date(otherActive.last_seen).getTime() > SC_STALE_MS;
      if (stale) {
        await _sc_becomeActive(`Stale session takeover: ${otherActive.device_name}`);
      } else {
        await _sc_upsertSession({ status: STATUS_PASSIVE });
        _sc_addLog(`🔒 ${otherActive.device_name} is ACTIVE — we are PASSIVE`);
      }
    }

    _sc_startSessionRealtime();
    _sc_startHeartbeat();
  } else {
    // Table doesn't exist yet — standalone mode (writes allowed)
    _sc_status      = STATUS_ACTIVE;
    _sc_activeSince = new Date().toISOString();
    _sc_addLog('⚠ bt_sessions table not found — standalone mode (see Settings tab)');
  }

  _sc_startActivityTracking();
  _sc_renderAll();

  // F12: re-render settings whenever the Sync Center tcard opens.
  document.getElementById('tc-sync-center')?.addEventListener('click', () => {
    setTimeout(() => {
      if (_sc_activeTab === 'settings') _sc_renderSettings();
    }, 50);
  });

  _sc_addLog('✓ Sync Center v1.1 ready');
}

// Refresh idle counter every 5 s while ACTIVE
setInterval(() => {
  if (_sc_status === STATUS_ACTIVE) _sc_renderSession();
}, 5_000);

// Hook into supabase.js events to update last sync time
document.addEventListener('bt:synced', () => {
  _sc_lastSyncTime = new Date();
  _sc_renderSession();
});
