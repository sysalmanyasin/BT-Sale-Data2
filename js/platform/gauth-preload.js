// Baked-in Google OAuth client id + reveal of the sign-in panel (was an inline <script> in index.html).
/* ── Baked-in Client ID: force Google Sign-In screen immediately ── */
(function(){
  var CID='36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com';
  try{localStorage.setItem('bt_gauth_cid',CID);}catch(e){ /* storage unavailable (private mode or quota): best-effort */ }
  function _skipToSignIn(){
    var m=document.getElementById('gauth-main');
    if(m)m.style.display='';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_skipToSignIn);
  else _skipToSignIn();
})();
