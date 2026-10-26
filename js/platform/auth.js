// ══════════════════════════════════════════
// AUTH GATE — Google Sign-In only.
// ══════════════════════════════════════════

// NOTE: this file is an ES module and the ONLY way into the app is a real,
// verified Google sign-in. unlockApp is deliberately module-private: it is not
// on window, so no other script (or console call) can open the app, and nothing
// can monkey-patch it. It is only reached after (a) a fresh Google id_token was
// accepted by Supabase, or (b) a saved session is re-verified against a live
// Supabase session for the same allowed email (see _gauthCheckSession).
// Other scripts that need "the app just unlocked" listen for the
// 'bt:app-unlocked' event instead of patching a function.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../shared/backend-config.js';
function unlockApp() {
  document.getElementById('pin-gate').style.display='none';
  document.getElementById('nav').style.display='flex';
  if (typeof showStatusBar === 'function') showStatusBar();
  if (window._appInited) return;
  window._appInited = true;
  window.dispatchEvent(new CustomEvent('bt:app-unlocked'));
  initApp();
  if (typeof startSupabaseSync === 'function') startSupabaseSync();
  if (window.PdfLibrary && typeof window.PdfLibrary.runExpirySweep === 'function') {
    window.PdfLibrary.runExpirySweep(); // silent — no UI, best-effort, see js/lib/pdf-library.js
  }
  idbLoadData().then(loaded => {
    if (loaded) { rebuildAll(); }
    if(ghCfg()&&Repository.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
    initAutoRefresh();
    if (typeof refreshStatusBar === 'function') refreshStatusBar();
  }).catch(() => {
    if(ghCfg()&&Repository.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
    initAutoRefresh();
    if (typeof refreshStatusBar === 'function') refreshStatusBar();
  });
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

(function() {
'use strict';

const GAUTH_CID_K  = 'bt_gauth_cid';        // Google OAuth Client ID
const GAUTH_MAIL_K = 'bt_gauth_emails';      // comma-separated allowed emails
const GAUTH_SESS_K = 'bt_gauth_session';     // {email,name,picture,exp}

// ── Offline / first-run fallback only ──────────────────────────────
// Client ID and authorized emails now live in Supabase (bt_auth_config,
// bt_authorized_users) so they can be managed from the Table Editor with
// no redeploy. These constants are ONLY used (a) to seed localStorage on
// the very first load before the sync below has ever completed, and
// (b) as a last resort if the device is offline and has never synced.
const GAUTH_CID_FALLBACK  = '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';
const GAUTH_MAIL_FALLBACK = 'sy.salmanyasin@gmail.com,sy.salmanmughal@gmail.com,bahria.cat@fdpp.pk';
// NOTE: stays on direct localStorage, not Repository — this IIFE runs at
// script-parse time, and auth.js loads BEFORE repository.js. Routing it
// through Repository here would throw "Repository is not defined" and
// crash the entire app's startup. (Caught during the Floor-1 storage
// migration, before it shipped.)
(function(){ if(!localStorage.getItem('bt_gauth_cid'))    localStorage.setItem('bt_gauth_cid', GAUTH_CID_FALLBACK); })();
(function(){ if(!localStorage.getItem('bt_gauth_emails')) localStorage.setItem('bt_gauth_emails', GAUTH_MAIL_FALLBACK); })();

// ── Live sync from Supabase (bt_auth_config + bt_authorized_users) ──
// Fire-and-forget on script load: usually resolves in well under a
// second, long before a user finishes tapping "Sign in with Google".
// On failure (offline, Supabase unreachable) it silently keeps whatever
// is already cached in localStorage — last successful sync, or the
// fallback seed above — so sign-in still works offline.
const GAUTH_SB_URL  = SUPABASE_URL;
const GAUTH_SB_ANON = SUPABASE_ANON_KEY;
async function _gauthSyncFromSupabase() {
  const headers = { apikey: GAUTH_SB_ANON, Authorization: 'Bearer ' + GAUTH_SB_ANON };
  try {
    const cfgRes = await fetch(GAUTH_SB_URL + '/rest/v1/bt_auth_config?select=value&key=eq.google_oauth_client_id', { headers });
    if (cfgRes.ok) {
      const rows = await cfgRes.json();
      if (rows && rows[0] && rows[0].value) localStorage.setItem(GAUTH_CID_K, rows[0].value);
    }
  } catch (e) { /* offline — keep cached CID */ }
  try {
    const usersRes = await fetch(GAUTH_SB_URL + '/rest/v1/bt_authorized_users?select=email&active=eq.true', { headers });
    if (usersRes.ok) {
      const rows = await usersRes.json();
      // Reachable and returned a real (possibly empty) list — trust it as
      // the source of truth, including "fail closed" if everyone was
      // deactivated. Only a network/offline failure falls back to cache.
      localStorage.setItem(GAUTH_MAIL_K, Array.isArray(rows) ? rows.map(r => r.email).join(',') : '');
    }
  } catch (e) { /* offline — keep cached email list */ }
}
_gauthSyncFromSupabase();

// ── Google Auth helpers ───────────────────────────────────────────
function gauthGetSession() {
  try { const s=JSON.parse(Repository.getItem(GAUTH_SESS_K)); if(s&&s.exp>Date.now()) return s; } catch(e){ /* storage unavailable (private mode or quota): best-effort */ }
  return null;
}
function gauthSetSession(payload) {
  const s={email:payload.email, name:payload.name, picture:payload.picture, exp:Date.now()+31536000000}; // 1 year
  Actions.saveFeatureData(GAUTH_SESS_K, JSON.stringify(s));
  return s;
}
function gauthClearSession() {
  Actions.clearFeatureData(GAUTH_SESS_K);
  _driveAccessToken = '';
  try { localStorage.removeItem('bt_drive_token_cache'); } catch(e) { /* storage unavailable (private mode or quota): best-effort */ }
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
function gauthShowMain() {
  document.getElementById('gauth-setup').style.display='none';
  document.getElementById('gauth-main').style.display='';
  _gauthRenderBtn();
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
// Nonce hashing — Google embeds our nonce verbatim into the id_token's
// nonce claim, but Supabase's signInWithIdToken hashes whatever raw nonce
// you give it and compares that hash against the token's claim (same
// pattern as native Apple/Google sign-in). So: send Google the HASH,
// keep the RAW nonce to hand to Supabase afterward.
async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _gauthOAuthSignIn() {
  const CID = Repository.getItem(GAUTH_CID_K) || GAUTH_CID_FALLBACK;

  // Show loading state on the button
  const btn = document.getElementById('google-signin-btn');
  if(btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="#4285F4" stroke-width="3" fill="none" stroke-dasharray="31" stroke-dashoffset="10"/></svg> &nbsp;Connecting to Google…';
  }
  _gauthShowError('');

  // rawNonce -> kept for Supabase later. hashedNonce -> sent to Google, ends
  // up as the id_token's nonce claim. Supabase hashes rawNonce itself and
  // compares — so the two must be a matching raw/hash pair, not identical.
  const rawNonce = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random();
  const hashedNonce = await _sha256Hex(rawNonce);
  sessionStorage.setItem('bt_oauth_nonce', rawNonce);

  // Save current page state so we return cleanly
  sessionStorage.setItem('bt_oauth_pending','1');
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id:             CID,
    redirect_uri:          redirectUri,
    // 'id_token token' (was just 'token') — id_token lets us establish a
    // REAL Supabase session (auth.uid() becomes usable server-side);
    // access token still used for Drive exactly as before.
    response_type:         'id_token token',
    scope:                 'openid email profile https://www.googleapis.com/auth/drive.file',
    prompt:                'select_account',
    include_granted_scopes:'true',
    nonce:                 hashedNonce
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// Signs the same verified Google id_token into every Supabase project the
// app talks to, so auth.uid() is real everywhere RLS checks it.
async function btEstablishSupabaseSessions(idToken, nonce) {
  try {
    const clients = [
      (typeof window.btGetSupabaseClient === 'function') ? window.btGetSupabaseClient() : null,        // wetbugzzchkghpzmowod
      (typeof window.inventoryBridgeGetClient === 'function') ? window.inventoryBridgeGetClient() : null // vtcrdkqhuvxatclobsby
    ].filter(Boolean);
    if (!clients.length) return false;
    const results = await Promise.all(
      clients.map(c => c.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce }))
    );
    return results.every(r => !r || !r.error);
  } catch (e) {
    console.error('Supabase sign-in failed', e);
    return false;
  }
}
window.btEstablishSupabaseSessions = btEstablishSupabaseSessions;

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

  const token   = params.get('access_token');
  const idToken = params.get('id_token');
  if(!token) return false;
  // Clean the token out of the URL immediately (security + cleanliness)
  history.replaceState(null,'',window.location.pathname);
  sessionStorage.removeItem('bt_oauth_pending');
  const nonce = sessionStorage.getItem('bt_oauth_nonce');
  sessionStorage.removeItem('bt_oauth_nonce');
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
    // Establish a REAL Supabase session (auth.uid() becomes usable server-side
    // for RLS) on every project the app talks to. Once the DB-side lockdown
    // migration runs, this step becomes required — surface a clear error if
    // it fails rather than silently letting the user in with no DB access.
    if (idToken) {
      const sbOk = await btEstablishSupabaseSessions(idToken, nonce);
      if (!sbOk) {
        _gauthShowError('⚠ Signed in to Google, but could not verify with the database. Please try again.');
        return false;
      }
    } else {
      _gauthShowError('⚠ Google did not return an id_token — sign-in cannot be verified. Please try again.');
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
            client_id: Repository.getItem(GAUTH_CID_K) || GAUTH_CID_FALLBACK,
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
// A saved session is only a hint about WHO signed in last. Alone it never opens
// the app: it must match a live Supabase session (created by a verified Google
// id_token) for the same, still-allowed email. Anything else -> locked.
async function _gauthHasVerifiedSupabaseSession(email) {
  try {
    const c = (typeof window.btGetSupabaseClient === 'function') ? window.btGetSupabaseClient() : null;
    if (!c || !c.auth) return false;
    const { data, error } = await c.auth.getSession();
    const u = !error && data && data.session && data.session.user;
    return !!(u && u.email && email && u.email.toLowerCase() === email.toLowerCase());
  } catch (e) { return false; }
}
function _gauthShowSignIn() {
  const bar = document.getElementById('gauth-user-bar'); if (bar) bar.style.display = 'none';
  const wrap = document.getElementById('gauth-btn-wrap'); if (wrap) wrap.style.display = 'flex';
}
async function _gauthCheckSession() {
  const s = gauthGetSession();
  if (!s || !gauthIsAllowed(s.email) || !(await _gauthHasVerifiedSupabaseSession(s.email))) {
    if (s) gauthClearSession(); // stale / forged / revoked -> discard, require real sign-in
    _gauthShowSignIn();
    return;
  }
  unlockApp();
  // If a still-valid Drive token survived this refresh/new tab (localStorage cache),
  // there's nothing to do ? Drive is already ready, no network call needed.
  if (_driveAccessToken) {
    if (typeof driveLog === 'function') driveLog('Drive session restored from this browser session', 'ok');
    return;
  }
  // Otherwise, restore the Drive token silently in the background so Drive backup/restore
  // work right away without forcing the user through a full redirect again.
  _driveSilentReauth().then(token => {
    if (token && typeof driveLog === 'function') driveLog('Drive session restored silently', 'ok');
  });
}
function gauthConfirmUser() { _gauthCheckSession(); } // re-verifies; never opens the app on its own
function gauthSignOut() {
  // Local-only sign-out (this device/tab). Also drops the Supabase session
  // on this device so it doesn't silently linger past the UI sign-out.
  // scope:'local' is REQUIRED: supabase-js defaults to 'global', which would also kill the
  // session on every other device (phone) the moment you sign out on one.
  try {
    if (typeof window.btGetSupabaseClient === 'function') window.btGetSupabaseClient().auth.signOut({ scope: 'local' });
    if (typeof window.inventoryBridgeGetClient === 'function') window.inventoryBridgeGetClient().auth.signOut({ scope: 'local' });
  } catch(e) { /* best-effort */ }
  gauthClearSession();
  document.getElementById('gauth-user-bar').style.display='none';
  document.getElementById('gauth-btn-wrap').style.display='flex';
  document.getElementById('gauth-error').style.display='none';
}

// Ends every session for this account on every device it's signed into —
// not just this one. Uses Supabase's global sign-out (scope:'global'),
// which revokes the refresh token everywhere, on both connected projects.
async function gauthSignOutAllDevices() {
  const btn = document.getElementById('logout-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing out everywhere…'; }
  try {
    const clients = [
      (typeof window.btGetSupabaseClient === 'function') ? window.btGetSupabaseClient() : null,
      (typeof window.inventoryBridgeGetClient === 'function') ? window.inventoryBridgeGetClient() : null
    ].filter(Boolean);
    await Promise.all(clients.map(c => c.auth.signOut({ scope: 'global' })));
  } catch(e) {
    console.error('Global sign-out failed', e);
  }
  gauthClearSession();
  if (typeof toast === 'function') toast('✓ Signed out on all devices', 'ok');
  setTimeout(() => window.location.reload(), 600);
}
window.gauthSignOutAllDevices = gauthSignOutAllDevices;

// ── Main gate init ────────────────────────────────────────────────
function initAuthGate() {
  // Client ID now comes from Supabase (bt_auth_config) via _gauthSyncFromSupabase();
  // only seed the fallback here if nothing has ever been synced/cached.
  if (!Repository.getItem(GAUTH_CID_K)) {
    Actions.saveFeatureData(GAUTH_CID_K, GAUTH_CID_FALLBACK);
  }
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
    Actions.saveFeatureData(GAUTH_CID_K, cid);
  }
  toast('✓ Google Client ID saved (authorised emails are fixed in app source)');
  _tcLoadGAuthStatus();
}
function tcClearGAuthSession() { gauthClearSession(); toast('✓ Google session cleared — you will need to sign in again next visit'); }
function tcClearGAuthAll() {
  if(!confirm('Reset Google Client ID to the built-in default and sign out?')) return;
  Actions.saveFeatureData(GAUTH_CID_K, GAUTH_CID_FALLBACK);
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

// Boot the auth gate on page load.
// NOTE: this file is now `defer`, which is guaranteed by spec to execute
// BEFORE DOMContentLoaded fires — so document.readyState is never
// 'loading' here anymore, and the old immediate-call fallback would
// always run too early (before actions.js/platform/repository.js have executed).
// Always registering the listener is now unconditionally correct.
document.addEventListener('DOMContentLoaded', initAuthGate);

function lockApp() {
  gauthClearSession();
  try { if (typeof window.btGetSupabaseClient === 'function') window.btGetSupabaseClient().auth.signOut({ scope: 'local' }); } catch (e) { /* best-effort: failure is intentionally non-fatal here */ }
  try { if (typeof window.inventoryBridgeGetClient === 'function') window.inventoryBridgeGetClient().auth.signOut({ scope: 'local' }); } catch (e) { /* best-effort: failure is intentionally non-fatal here */ }
  window._appInited = false;
  if (typeof resetSupabaseSync === 'function') resetSupabaseSync();
  document.getElementById('pin-gate').style.display='flex';
  document.getElementById('nav').style.display='none';
  if (typeof hideStatusBar === 'function') hideStatusBar();
  document.querySelectorAll('.page').forEach(p=>{ p.classList.remove('on'); p.style.display=''; });
  setTimeout(initAuthGate, 50);
}

// Bridge what's used externally, from index.html, or via a same-file
// event attribute. unlockApp/initAutoRefresh are deliberately NOT bridged.
window.gauthShowMain = gauthShowMain;
window._gauthOAuthSignIn = _gauthOAuthSignIn;
window._driveSilentReauth = _driveSilentReauth;
window.gauthConfirmUser = gauthConfirmUser;
window.gauthSignOut = gauthSignOut;
window.tcSaveGAuthSettings = tcSaveGAuthSettings;
window.tcClearGAuthSession = tcClearGAuthSession;
window.tcClearGAuthAll = tcClearGAuthAll;
window._tcLoadGAuthStatus = _tcLoadGAuthStatus;
window.lockApp = lockApp;

})();
