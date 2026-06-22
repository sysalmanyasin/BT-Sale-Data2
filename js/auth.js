// ══════════════════════════════════════════
// AUTH GATE — Google Sign-In + PIN fallback
// ══════════════════════════════════════════
const PIN_K        = 'bt_pin_hash';
const GAUTH_CID_K  = 'bt_gauth_cid';        // Google OAuth Client ID
const GAUTH_MAIL_K = 'bt_gauth_emails';      // comma-separated allowed emails
const GAUTH_SESS_K = 'bt_gauth_session';     // {email,name,picture,exp}
// ── Baked-in Client ID (no manual setup required) ─────────────
(function(){var _k='bt_gauth_cid',_v='36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';if(!localStorage.getItem(_k))localStorage.setItem(_k,_v);})();
// ── Baked-in allowed emails (same list on every device, every load) ──
// Editing who can sign in means editing this list in the source and redeploying.
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
  if(_pinBusy) return;
  const inp = document.getElementById('pw-input');
  const pw  = inp?inp.value:'';
  const msg = document.getElementById('pmsg');
  if(pw.length<8){ if(msg) msg.textContent='At least 8 characters required.'; if(inp){inp.classList.add('err');setTimeout(()=>inp.classList.remove('err'),1000);} return; }
  if(pw.length>20){ if(msg) msg.textContent='Maximum 20 characters.'; return; }
  _pinBusy=true;
  const stored=localStorage.getItem(PIN_K);
  const hashed=hashPIN(pw);
  if(!stored){
    localStorage.setItem(PIN_K,hashed);
    _pinBusy=false; if(inp) inp.value=''; unlockApp();
  } else if(hashed===stored){
    _pinBusy=false; if(inp) inp.value=''; unlockApp();
  } else {
    if(inp){inp.classList.add('err'); inp.value=''; setTimeout(()=>{inp.classList.remove('err');inp.focus();},1000);}
    if(msg) msg.textContent='Incorrect password. Try again.';
    setTimeout(()=>{ _pinBusy=false; if(msg) msg.textContent=''; },1200);
  }
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
  if(!_resetVerifiedEmail){ toast('⚠ Identity not verified','w'); return; }
  const nw  = document.getElementById('pw-new1').value;
  const cf  = document.getElementById('pw-new2').value;
  const msg = document.getElementById('pw-reset-msg');
  if(nw.length<8||nw.length>20){ msg.textContent='Password must be 8–20 characters.'; msg.style.color='#fca5a5'; return; }
  if(nw!==cf){ msg.textContent='Passwords do not match.'; msg.style.color='#fca5a5';
    const i=document.getElementById('pw-new2'); if(i){i.classList.add('err'); setTimeout(()=>i.classList.remove('err'),800);} return; }
  localStorage.setItem(PIN_K, hashPIN(nw));
  _resetVerifiedEmail='';
  toast('✓ Password reset successfully');
  // Unlock directly — they just verified via Google
  unlockApp();
}

// ── Google reset-verification button ─────────────────────────────
function _gauthRenderResetBtn() {
  const clientId = localStorage.getItem(GAUTH_CID_K);
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
  try { const s=JSON.parse(localStorage.getItem(GAUTH_SESS_K)); if(s&&s.exp>Date.now()) return s; } catch(e){}
  return null;
}
function gauthSetSession(payload) {
  const s={email:payload.email, name:payload.name, picture:payload.picture, exp:Date.now()+31536000000}; // 1 year
  localStorage.setItem(GAUTH_SESS_K, JSON.stringify(s));
  return s;
}
function gauthClearSession() { localStorage.removeItem(GAUTH_SESS_K); }

function gauthAllowedEmails() {
  const raw = localStorage.getItem(GAUTH_MAIL_K)||'';
  return raw.split(/[\n,]+/).map(e=>e.trim().toLowerCase()).filter(Boolean);
}
function gauthIsAllowed(email) {
  const list = gauthAllowedEmails();
  if(list.length===0) return true; // no list = allow anyone who signs in
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
  document.getElementById('gauth-setup').style.display='none';
  document.getElementById('gauth-main').style.display='none';
  document.getElementById('gauth-pin').style.display='';
  // Always start at the normal enter-password sub-view
  const ev=document.getElementById('pw-view-enter');
  const vv=document.getElementById('pw-view-verify');
  const nv=document.getElementById('pw-view-newpw');
  if(ev) ev.style.display='';
  if(vv) vv.style.display='none';
  if(nv) nv.style.display='none';
  const pnote=document.getElementById('pnote');
  if(pnote) pnote.style.display=localStorage.getItem(PIN_K)?'none':'block';
  pwStrengthUpdate();
  setTimeout(()=>{ const inp=document.getElementById('pw-input'); if(inp) inp.focus(); }, 120);
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
    // Access control: first login auto-registers; others must be on the list
    if(!gauthIsAllowed(info.email)){
      const allowed = gauthAllowedEmails();
      if(allowed.length===0){
        localStorage.setItem(GAUTH_MAIL_K, info.email.toLowerCase());
      } else {
        _gauthShowError('⛔ ' + info.email + ' is not authorised to access this app.');
        return false;
      }
    }
    // Reuse the Drive-scoped token so Drive backup works without a separate authorize step
    _driveAccessToken = token;
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
      // auto-register first login if list is empty
      const allowed = gauthAllowedEmails();
      if(allowed.length===0) {
        localStorage.setItem(GAUTH_MAIL_K, email.toLowerCase());
      } else {
        errEl.textContent='⛔ ' + email + ' is not authorised to access this app. Contact the administrator.';
        errEl.style.display='block';
        return;
      }
    }
    gauthSetSession(payload);
    unlockApp();
  } catch(e) {
    const errEl = document.getElementById('gauth-error');
    if(errEl){ errEl.textContent='❌ Sign-in failed: ' + e.message; errEl.style.display='block'; }
  }
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
  localStorage.setItem(GAUTH_CID_K, id);
  errEl.style.display='none';
  gauthShowMain();
  setTimeout(_gauthRenderBtn, 400);
}

// ── Main gate init ────────────────────────────────────────────────
function initAuthGate() {
  // Always enforce the baked-in Client ID
  const BAKED_CID = '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';
  localStorage.setItem(GAUTH_CID_K, BAKED_CID);
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
  const emails = document.getElementById('tc-allowed-emails').value.trim();
  if(cid) {
    if(!cid.includes('.apps.googleusercontent.com')){ toast('⚠ Invalid Client ID format','w'); return; }
    localStorage.setItem(GAUTH_CID_K, cid);
  }
  if(emails!==null) localStorage.setItem(GAUTH_MAIL_K, emails.split(/\n/).map(e=>e.trim()).filter(Boolean).join(','));
  toast('✓ Google auth settings saved');
  _tcLoadGAuthStatus();
}
function tcClearGAuthSession() { gauthClearSession(); toast('✓ Google session cleared — you will need to sign in again next visit'); }
function tcClearGAuthAll() {
  if(!confirm('Remove Google configuration? You will need to re-enter your Client ID to use Google Sign-In again.')) return;
  localStorage.setItem(GAUTH_CID_K, '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com'); // keep baked-in CID
  localStorage.removeItem(GAUTH_MAIL_K);
  gauthClearSession();
  toast('✓ Google config removed');
  _tcLoadGAuthStatus();
}
function _tcLoadGAuthStatus() {
  const cid = localStorage.getItem(GAUTH_CID_K);
  const emails = localStorage.getItem(GAUTH_MAIL_K)||'';
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
  if(emailEl) emailEl.value = emails.split(',').filter(Boolean).join('\n');
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
  initApp();
  // Load cached data from IndexedDB first for instant startup, then sync if configured
  idbLoadData().then(loaded => {
    if (loaded) { rebuildAll(); }
    if(ghCfg()&&localStorage.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
  }).catch(() => {
    if(ghCfg()&&localStorage.getItem('bt_auto_load')==='1') manualSync(true);
    startAutoInterval();
  });
}

function lockApp() {
  _pinBuf=''; pinDots();
  const pmsg = document.getElementById('pmsg'); if(pmsg) pmsg.textContent='';
  gauthClearSession(); // clear Google session on explicit lock
  document.getElementById('pin-gate').style.display='flex';
  document.getElementById('nav').style.display='none';
  document.querySelectorAll('.page').forEach(p=>{ p.classList.remove('on'); p.style.display=''; });
  if(_autoHandle) clearInterval(_autoHandle);
  // Re-init the auth gate so the correct panel shows
  setTimeout(initAuthGate, 50);
}
