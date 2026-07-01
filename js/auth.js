// ══════════════════════════════════════════
// AUTH GATE — Google Sign-In + PIN fallback
// ══════════════════════════════════════════
const PIN_K        = 'bt_pin_hash';
const GAUTH_CID_K  = 'bt_gauth_cid';        // Google OAuth Client ID
const GAUTH_MAIL_K = 'bt_gauth_emails';      // comma-separated allowed emails
const GAUTH_SESS_K = 'bt_gauth_session';     // {email,name,picture,exp}
// ── Baked-in Client ID (no manual setup required) ─────────────
// NOTE: stays on direct localStorage, not Repository — this IIFE runs at
// script-parse time, and auth.js loads BEFORE repository.js. Routing it
// through Repository here would throw "Repository is not defined" and
// crash the entire app's startup. (Caught during the Floor-1 storage
// migration, before it shipped.)
(function(){var _k='bt_gauth_cid',_v='36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';if(!localStorage.getItem(_k))localStorage.setItem(_k,_v);})();
// ── Baked-in allowed emails (same list on every device, every load) ──
// Editing who can sign in means editing this list in the source and redeploying.
// Same load-order constraint as above — must stay on direct localStorage.
(function(){
  var _k='bt_gauth_emails';
  var _v='sy.salmanyasin@gmail.com,sy.salmanmughal@gmail.com,bahria.cat@fdpp.pk';
  localStorage.setItem(_k,_v); // always re-seed — overrides any local edit/clear, so it can't be bypassed per-device
})();
let _pinBuf = '', _pinBusy = false;

// ── PIN helpers (kept for fallback) ──────────────────────────────
function hashPIN(pin) {
  const s = 'BT_SALT_2025_' + pin;
  let h1=0x811c9dc5, h2=5381;
  for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); h1^=c; h1=Math.imul(h1,0x01000193); h2=Math.imul(h2,33)^c; }
  return ((h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0')).repeat(2);
}
// ── Password strength helpers ─────────────────────────────────────
const _PW_LEVELS = [
  {label:'',            color:'transparent'},
  {label:'Very weak',   color:'#dc2626'},
  {label:'Weak',        color:'#f97316'},
  {label:'Fair',        color:'#eab308'},
  {label:'Strong',      color:'#22c55e'},
  {label:'Very strong', color:'#15803d'},
];
function _pwStrengthScore(pw) {
  let s=0;
  if(pw.length>=8)  s++;
  if(pw.length>=12) s++;
  if(/[A-Z]/.test(pw)) s++;
  if(/[0-9]/.test(pw)) s++;
  if(/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
function pwStrengthUpdate() {
  const pw  = document.getElementById('pw-input')?.value||'';
  const score = _pwStrengthScore(pw);
  const bar  = document.getElementById('pw-strength-bar');
  const hint = document.getElementById('pw-hint');
  if(bar){ bar.style.width=(score/5*100)+'%'; bar.style.background=_PW_LEVELS[score].color; bar.style.height='3px'; }
  if(hint){
    if(!pw){ hint.textContent='8–20 characters'; hint.style.color='rgba(255,255,255,.35)'; return; }
    hint.textContent=_PW_LEVELS[score].label+(pw.length<8?' · too short ('+pw.length+'/8)':'');
    hint.style.color=_PW_LEVELS[score].color||'rgba(255,255,255,.35)';
  }
}
function pwToggleShow() {
  const inp=document.getElementById('pw-input');
  if(inp) inp.type = inp.type==='password'?'text':'password';
}
function pwSubmit() {
  // PIN/password offline fallback removed — Google Sign-In with an authorised
  // email is now the only way to unlock the app.
  const msg = document.getElementById('pmsg');
  if(msg) msg.textContent='Password sign-in is disabled. Please use Google Sign-In.';
  gauthShowMain();
}
// Legacy stubs — kept to avoid reference errors
function pk(k){}
function pb(){}
function ps(){}
function pinDots(){}

// ── Forgot-password / reset flow ─────────────────────────────────
let _resetVerifiedEmail = '';

function pwShowEnter() {
  document.getElementById('pw-view-enter').style.display='';
  document.getElementById('pw-view-verify').style.display='none';
  document.getElementById('pw-view-newpw').style.display='none';
  _resetVerifiedEmail = '';
  setTimeout(()=>{ const i=document.getElementById('pw-input'); if(i) i.focus(); }, 80);
}
function pwShowForgot() {
  document.getElementById('pw-view-enter').style.display='none';
  document.getElementById('pw-view-verify').style.display='';
  document.getElementById('pw-view-newpw').style.display='none';
  document.getElementById('pw-reset-error').style.display='none';
  _resetVerifiedEmail = '';
  _gauthRenderResetBtn();
}
function pwShowNewPw(email, name) {
  _resetVerifiedEmail = email;
  document.getElementById('pw-view-enter').style.display='none';
  document.getElementById('pw-view-verify').style.display='none';
  document.getElementById('pw-view-newpw').style.display='';
  document.getElementById('pw-reset-who').textContent = 'Verified as ' + (name||email);
  document.getElementById('pw-new1').value='';
  document.getElementById('pw-new2').value='';
  document.getElementById('pw-reset-msg').textContent='';
  document.getElementById('pw-reset-strength-bar').style.width='0';
  setTimeout(()=>document.getElementById('pw-new1').focus(), 80);
}

function pwResetStrength() {
  const pw = document.getElementById('pw-new1')?.value||'';
  const score = _pwStrengthScore(pw);
  const bar   = document.getElementById('pw-reset-strength-bar');
  if(bar){ bar.style.width=(score/5*100)+'%'; bar.style.background=_PW_LEVELS[score].color; bar.style.height='3px'; }
}
function pwResetToggle(id) {
  const inp=document.getElementById(id);
  if(inp) inp.type = inp.type==='password'?'text':'password';
}
function pwResetSubmit() {
  // PIN/password offline fallback removed — nothing to reset, nothing to unlock.
  toast('⚠ Password sign-in has been disabled. Use Google Sign-In.','w');
  gauthShowMain();
}

// ── Google reset-verification button ─────────────────────────────
function _gauthRenderResetBtn() {
  const clientId = Repository.getItem(GAUTH_CID_K);
  const wrap = document.getElementById('google-reset-btn-wrap');
  if(!clientId||!window.google){
    if(wrap) wrap.innerHTML='<div style="color:rgba(255,255,255,.4);font-size:12px;text-align:center">Google Sign-in not configured.<br>Contact the administrator.</div>';
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: _gauthResetCallback,
      auto_select: false
    });
    google.accounts.id.renderButton(
      document.getElementById('google-reset-btn'),
      { theme:'outline', size:'large', width:260, text:'continue_with' }
    );
  } catch(e) {
    const errEl=document.getElementById('pw-reset-error');
    if(errEl){ errEl.textContent='Google Sign-in error: '+e.message; errEl.style.display='block'; }
  }
}

function _gauthResetCallback(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const email   = payload.email;
    const errEl   = document.getElementById('pw-reset-error');
    if(!gauthIsAllowed(email)){
      errEl.textContent='⛔ '+email+' is not authorised. Use an authorised Google account.';
      errEl.style.display='block'; return;
    }
    errEl.style.display='none';
    pwShowNewPw(email, payload.name);
  } catch(e) {
    const errEl=document.getElementById('pw-reset-error');
    if(errEl){ errEl.textContent='Sign-in failed: '+e.message; errEl.style.display='block'; }
  }
}

// ── Google Auth helpers ───────────────────────────────────────────
function gauthGetSession() {
  try { const s=JSON.parse(Repository.getItem(GAUTH_SESS_K)); if(s&&s.exp>Date.now()) return s; } catch(e){}
  return null;
}
function gauthSetSession(payload) {
  const s={email:payload.email, name:payload.name, picture:payload.picture, exp:Date.now()+31536000000}; // 1 year
  Repository.setItem(GAUTH_SESS_K, JSON.stringify(s));
  return s;
}
function gauthClearSession() {
  Repository.removeItem(GAUTH_SESS_K);
  _driveAccessToken = '';
  try { sessionStorage.removeItem('bt_drive_token_cache'); } catch(e) {}
}

function gauthAllowedEmails() {
  const raw = Repository.getItem(GAUTH_MAIL_K)||'';
  return raw.split(/[\n,]+/).map(e=>e.trim().toLowerCase()).filter(Boolean);
}
function gauthIsAllowed(email) {
  const list = gauthAllowedEmails();
  if(!email) return false;
  if(list.length===0) return false; // fail-closed: no list = allow no one
  return list.includes(email.toLowerCase());
}

// ── Panel routing ─────────────────────────────────────────────────
function gauthShowSetup() {
  gauthShowMain(); // setup screen removed — go directly to sign-in
}
function gauthShowMain() {
  document.getElementById('gauth-setup').style.display='none';
  document.getElementById('gauth-main').style.display='';
  document.getElementById('gauth-pin').style.display='none';
  _gauthRenderBtn();
}
function gauthShowPin() {
  // PIN/password offline fallback has been removed. Always route back to
  // the Google Sign-In panel — this function is kept only so any stray
  // references in older cached code don't throw errors.
  gauthShowMain();
}

// ── Render the Google Sign-In button ─────────────────────────────
function _gauthRenderBtn() {
  // Button is a real HTML element — just make sure the wrap is visible
  const wrap = document.getElementById('gauth-btn-wrap');
  if(wrap) wrap.style.display='flex';
}

// ── OAuth2 popup sign-in (replaces GSI iframe renderButton) ──────
// ── Redirect-based Google Sign-In (works on ALL mobile browsers) ─────────
// Step 1: Tap button → redirect to Google account selector
function _gauthOAuthSignIn() {
  const CID = '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';

  // Show loading state on the button
  const btn = document.getElementById('google-signin-btn');
  if(btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-width="3" fill="none" stroke-dasharray="31" stroke-dashoffset="10"/></svg> &nbsp;Connecting to Google…';
  }
  _gauthShowError('');

  // Save current page state so we return cleanly
  sessionStorage.setItem('bt_oauth_pending','1');
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id:             CID,
    redirect_uri:          redirectUri,
    response_type:         'token',
    scope:                 'openid email profile https://www.googleapis.com/auth/drive.file',
    prompt:                'select_account',
    include_granted_scopes:'true'
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// Step 2: Called on page load — detects Google's redirect-back token in the URL hash
async function _gauthHandleRedirectToken() {
  if(!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.substring(1));

  // ── Detect Google error redirects (e.g. redirect_uri_mismatch) ──
  const oauthErr = params.get('error');
  if(oauthErr) {
    history.replaceState(null,'',window.location.pathname);
    sessionStorage.removeItem('bt_oauth_pending');
    const desc = params.get('error_description') || '';
    const friendly = {
      'redirect_uri_mismatch': 'OAuth redirect URI mismatch — please contact your administrator.',
      'access_denied':         'Access was denied. Please try again or use a different account.',
      'invalid_client':        'OAuth client configuration error — please contact your administrator.',
    };
    const msg = friendly[oauthErr] || ('Sign-in rejected by Google: ' + (desc || oauthErr).replace(/\+/g,' '));
    _gauthShowError('❌ ' + msg);
    return true;
  }

  const token  = params.get('access_token');
  if(!token) return false;
  // Clean the token out of the URL immediately (security + cleanliness)
  history.replaceState(null,'',window.location.pathname);
  sessionStorage.removeItem('bt_oauth_pending');
  _gauthShowError(''); // clear any old errors
  try {
    const r    = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
                   { headers:{ Authorization:'Bearer '+token } });
    const info = await r.json();
    if(!info.email){ _gauthShowError('Could not get account info — please try again.'); return false; }
    // Access control: only the three authorised emails may proceed
    if(!gauthIsAllowed(info.email)){
      _gauthShowError('⛔ ' + info.email + ' is not authorised to access this app.');
      return false;
    }
    // Reuse the Drive-scoped token so Drive backup works without a separate authorize step
    _driveAccessToken = token;
    if (typeof _driveSaveToken === 'function') _driveSaveToken(token, Number(params.get('expires_in')));
    _driveUpdateBadge('ok'); // reflect Drive-ready state immediately in Tools
    gauthSetSession({ email:info.email, name:info.name||info.email, picture:info.picture||'' });
    unlockApp();
    return true;
  } catch(e) {
    _gauthShowError('Sign-in error: '+e.message);
    return false;
  }
}

function _gauthShowError(msg){
  const el=document.getElementById('gauth-error');
  if(!el) return;
  if(!msg){ el.style.display='none'; el.textContent=''; return; }
  el.textContent=msg; el.style.display='block';
  const btn=document.getElementById('google-signin-btn');
  if(btn){ btn.disabled=false; btn.style.opacity='1'; }
}

// ── Callback from Google Sign-In ──────────────────────────────────
function _gauthCallback(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const email   = payload.email;
    const errEl   = document.getElementById('gauth-error');

    if(!gauthIsAllowed(email)) {
      errEl.textContent='⛔ ' + email + ' is not authorised to access this app. Contact the administrator.';
      errEl.style.display='block';
      return;
    }
    gauthSetSession(payload);
    unlockApp();
  } catch(e) {
    const errEl = document.getElementById('gauth-error');
    if(errEl){ errEl.textContent='❌ Sign-in failed: ' + e.message; errEl.style.display='block'; }
  }
}

// ── Silent Drive token renewal (GIS) ──────────────────────────────
// The 1-year app session (GAUTH_SESS_K) only remembers *who* is signed in —
// it was never able to carry a live Drive access token across reloads,
// since the old implicit-flow token isn't persisted (nor should it be).
// This uses the Google Identity Services token client with prompt:'' to
// silently re-request a Drive token, which succeeds with no UI as long as
// the browser still has an active Google session and has previously
// granted the drive.file scope — exactly the case right after a normal
// sign-in. If silent renewal isn't possible (consent revoked, no active
// Google session, GIS script blocked, etc.) it just resolves to null and
// Drive falls back to the existing "Authorize Drive" redirect flow.
const GAUTH_BAKED_CID = '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';
let _gisTokenClient = null;
function _driveSilentReauth(timeoutMs = 4000) {
  return new Promise(resolve => {
    let settled = false;
    const finish = token => { if (!settled) { settled = true; resolve(token || null); } };
    const tryNow = (attempt = 0) => {
      if (!(window.google && window.google.accounts && window.google.accounts.oauth2)) {
        // GIS script loads with `async` — it may not be ready yet on first load.
        if (attempt < 15) { setTimeout(() => tryNow(attempt + 1), 300); return; }
        finish(null); return;
      }
      try {
        if (!_gisTokenClient) {
          _gisTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GAUTH_BAKED_CID,
            scope: 'https://www.googleapis.com/auth/drive.file',
            prompt: '',
            callback: resp => {
              if (resp && resp.access_token) {
                _driveAccessToken = resp.access_token;
                if (typeof _driveSaveToken === 'function') _driveSaveToken(resp.access_token, resp.expires_in);
                if (typeof _driveUpdateBadge === 'function') _driveUpdateBadge('ok');
                finish(resp.access_token);
              } else finish(null);
            },
            error_callback: () => finish(null)
          });
        }
        _gisTokenClient.requestAccessToken();
      } catch (e) { finish(null); }
    };
    tryNow();
    setTimeout(() => finish(null), timeoutMs); // hard cap — never hang the caller
  });
}

// ── If a valid session exists, show resume bar ────────────────────
function _gauthCheckSession() {
  const s = gauthGetSession();
  if(!s) {
    document.getElementById('gauth-user-bar').style.display='none';
    document.getElementById('gauth-btn-wrap').style.display='flex';
    return;
  }
  // Valid session → auto-unlock immediately, no button click required
  unlockApp();
  // If a still-valid Drive token survived this refresh (sessionStorage cache),
  // there's nothing to do — Drive is already ready, no network call needed.
  if (_driveAccessToken) {
    if (typeof driveLog === 'function') driveLog('✓ Drive session restored from this browser session', 'ok');
    return;
  }
  // Otherwise, restore the Drive token silently in the background so Drive backup/restore
  // work right away without forcing the user through a full redirect again.
  _driveSilentReauth().then(token => {
    if (token && typeof driveLog === 'function') driveLog('✓ Drive session restored silently', 'ok');
  });
}
function gauthConfirmUser() { unlockApp(); }
function gauthSignOut() {
  gauthClearSession();
  document.getElementById('gauth-user-bar').style.display='none';
  document.getElementById('gauth-btn-wrap').style.display='flex';
  document.getElementById('gauth-error').style.display='none';
}

// ── Save Client ID from setup panel ──────────────────────────────
function gauthSaveClientId() {
  const id = document.getElementById('setup-client-id').value.trim();
  const errEl = document.getElementById('setup-error');
  if(!id||!id.includes('.apps.googleusercontent.com')) {
    errEl.textContent='⚠ Please enter a valid Client ID (must end with .apps.googleusercontent.com)';
    errEl.style.display='block'; return;
  }
  Repository.setItem(GAUTH_CID_K, id);
  errEl.style.display='none';
  gauthShowMain();
  setTimeout(_gauthRenderBtn, 400);
}

// ── Main gate init ────────────────────────────────────────────────
function initAuthGate() {
  // Always enforce the baked-in Client ID
  const BAKED_CID = '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';
  Repository.setItem(GAUTH_CID_K, BAKED_CID);
  gauthShowMain();
  _gauthRenderBtn();
  // 1. Check if Google just redirected back with an access token in the URL hash
  _gauthHandleRedirectToken().then(handled => {
    if(!handled) {
      // 2. No redirect token — check for an existing saved session
      _gauthCheckSession();
    }
  });
}

// ── Tool card helpers ──────────────────────────────────────────────
function tcSaveGAuthSettings() {
  const cid = document.getElementById('tc-client-id').value.trim();
  if(cid) {
    if(!cid.includes('.apps.googleusercontent.com')){ toast('⚠ Invalid Client ID format','w'); return; }
    Repository.setItem(GAUTH_CID_K, cid);
  }
  toast('✓ Google Client ID saved (authorised emails are fixed in app source)');
  _tcLoadGAuthStatus();
}
function tcClearGAuthSession() { gauthClearSession(); toast('✓ Google session cleared — you will need to sign in again next visit'); }
function tcClearGAuthAll() {
  if(!confirm('Reset Google Client ID to the built-in default and sign out?')) return;
  Repository.setItem(GAUTH_CID_K, '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com');
  gauthClearSession();
  toast('✓ Google settings reset to default');
  _tcLoadGAuthStatus();
}
function _tcLoadGAuthStatus() {
  const cid = Repository.getItem(GAUTH_CID_K);
  const emails = Repository.getItem(GAUTH_MAIL_K)||'';
  const sess = gauthGetSession();
  const statusEl = document.getElementById('tc-gauth-status');
  if(statusEl) {
    statusEl.innerHTML = cid
      ? '<span style="color:var(--green)">✓ Google Sign-In configured</span>' + (sess?` · Signed in as <strong>${sess.email}</strong>`:'· No active session')
      : '<span style="color:var(--amber)">⚠ Not configured yet</span>';
  }
  const cidEl = document.getElementById('tc-client-id');
  if(cidEl) cidEl.value = cid||'';
  const emailEl = document.getElementById('tc-allowed-emails');
  if(emailEl) {
    emailEl.value = emails.split(',').filter(Boolean).join('\n');
    emailEl.readOnly = true;
  }
}

// Boot the auth gate on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthGate);
} else {
  initAuthGate();
}

function unlockApp() {
  document.getElementById('pin-gate').style.display='none';
  document.getElementById('nav').style.display='flex';
  if (window._appInited) return;
  window._appInited = true;
  initApp();
  if (typeof startSupabaseSync === 'function') startSupabaseSync();
  idbLoadData().then(loaded => {
    if (loaded) { rebuildAll(); }
    if(ghCfg()&&Repository.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
    initAutoRefresh();
  }).catch(() => {
    if(ghCfg()&&Repository.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
    initAutoRefresh();
  });
}

function lockApp() {
  _pinBuf=''; pinDots();
  const pmsg = document.getElementById('pmsg'); if(pmsg) pmsg.textContent='';
  gauthClearSession();
  window._appInited = false;
  if (typeof resetSupabaseSync === 'function') resetSupabaseSync();
  document.getElementById('pin-gate').style.display='flex';
  document.getElementById('nav').style.display='none';
  document.querySelectorAll('.page').forEach(p=>{ p.classList.remove('on'); p.style.display=''; });
  if(_autoHandle) clearInterval(_autoHandle);
  setTimeout(initAuthGate, 50);
}

// ══════════════════════════════════════════════════════════════════════
// AUTO-REFRESH ON DEPLOY  (was called above in unlockApp() but never
// defined anywhere — found during the Repository migration audit.
// Without this, a new version pushed to GitHub mid-session only gets
// picked up if the user manually closes/reopens the tab or hits Hard
// Refresh; the SW update-check in index.html only fires on page load,
// not while a tab stays open.)
//
// What it does: every 15 minutes while the app is open, ask the browser
// to check sw.js for a new version. If one is found, the existing
// listener in index.html (controllerchange) takes over and reloads
// automatically — no new reload logic needed here, just triggering the
// check periodically and on tab-refocus.
// ══════════════════════════════════════════════════════════════════════
function initAutoRefresh() {
  if (!('serviceWorker' in navigator)) return;
  if (window._autoRefreshStarted) return;
  window._autoRefreshStarted = true;

  const safeReloadFromSw = () => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    if (!isTyping()) {
      window.location.reload();
      return;
    }
    if (typeof toast === 'function') toast('⬆ Update ready — will apply once you finish this entry', 'info');
    const safeReload = () => { window.location.reload(); };
    document.addEventListener('focusout', function onBlur() {
      document.removeEventListener('focusout', onBlur);
      setTimeout(() => { if (!isTyping()) safeReload(); }, 300);
    });
    setTimeout(safeReload, 5 * 60 * 1000);
  };

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data === 'SW_RELOAD') safeReloadFromSw();
    if (event.data === 'CACHE_CLEARED' && typeof toast === 'function') toast('✓ App cache cleared', 'info');
  });

  const CHECK_INTERVAL_MS = 15 * 60 * 1000;
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.update().catch(() => {}); // triggers 'updatefound' in index.html if a new sw.js exists
    });
  }, CHECK_INTERVAL_MS);
  // Also check immediately whenever the tab regains focus — covers
  // "left it open overnight, came back in the morning" cases.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.update().catch(() => {});
      });
    }
  });
}
