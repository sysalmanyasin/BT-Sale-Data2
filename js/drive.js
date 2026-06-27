// ══════════════════════════════════════════════════════════════════
// GOOGLE DRIVE DAILY BACKUP
// ══════════════════════════════════════════════════════════════════
const DRIVE_LAST_K = 'bt_drive_last_backup';
const DRIVE_FOLDER = 'BT-SALE-DATA';
const DRIVE_FOLDER_ID = '1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn'; // your existing Drive folder
let _driveTokenClient = null;
let _driveAccessToken = '';

// ── Persist the Drive access token across page refreshes ──────────────
// Google access tokens are short-lived (~1hr), but there's no reason to
// force a fresh sign-in/consent on every reload within that window.
// sessionStorage (not localStorage) is used deliberately: it survives
// refreshes but clears when the tab/browser closes, so we never hold on
// to a token longer than the session it was issued for.
const DRIVE_TOKEN_K = 'bt_drive_token_cache';
function _driveSaveToken(token, expiresInSec) {
  if (!token) return;
  const exp = Date.now() + (Math.max(60, (expiresInSec||3300)) * 1000) - 60000; // 1min safety margin
  try { sessionStorage.setItem(DRIVE_TOKEN_K, JSON.stringify({ token, exp })); } catch(e) {}
}
function _driveLoadCachedToken() {
  try {
    const raw = sessionStorage.getItem(DRIVE_TOKEN_K);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (token && exp > Date.now()) return token;
    sessionStorage.removeItem(DRIVE_TOKEN_K);
  } catch(e) {}
  return null;
}
// Restore a still-valid token immediately on script load, before any
// silent-reauth network round-trip is even attempted.
(function(){
  const cached = _driveLoadCachedToken();
  if (cached) {
    _driveAccessToken = cached;
    // Badge element may not exist yet if Tools page hasn't been opened —
    // _driveUpdateBadge() already no-ops safely via its own null check.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => _driveUpdateBadge('ok'));
    } else {
      _driveUpdateBadge('ok');
    }
  }
})();

function driveLog(msg, cls) {
  const el = document.getElementById('drive-log');
  if (!el) return;
  const t = new Date().toLocaleTimeString('en-PK', {hour:'2-digit',minute:'2-digit'});
  el.innerHTML += `<div><span style="color:var(--muted)">[${t}]</span> <span style="color:${cls==='ok'?'var(--green)':cls==='err'?'var(--red)':'var(--t2)'}">${msg}</span></div>`;
  el.scrollTop = el.scrollHeight;
}

function _driveUpdateBadge(state) {
  const b = document.getElementById('drive-badge');
  if (!b) return;
  if (state==='ok')   { b.className='badge bg-green'; b.textContent='Connected'; }
  else if (state==='err') { b.className='badge bg-red'; b.textContent='Error'; }
  else { b.className='badge bg-amber'; b.textContent='Not set up'; }
}

async function driveAuthorize() {
  // If sign-in already granted a drive.file token, reuse it — no popup needed
  if (_driveAccessToken) {
    _driveUpdateBadge('ok');
    driveLog('✓ Drive authorized via Google Sign-In. Ready to backup.','ok');
    toast('✓ Google Drive ready');
    return;
  }
  // Token expired or missing — first try a silent renewal (no UI at all);
  // this succeeds whenever the browser still has an active Google session
  // and previously granted the scope, which covers the common case of
  // reopening the app after the access token (but not the app session) expired.
  driveLog('Checking for an existing Google session…');
  const token = await _driveSilentReauth();
  if (token) {
    _driveUpdateBadge('ok');
    driveLog('✓ Drive reconnected silently. Ready to backup.','ok');
    toast('✓ Google Drive ready');
    return;
  }
  // Silent renewal not possible — fall back to the redirect OAuth flow
  // (it already requests drive.file scope, so sign-in + Drive are granted together)
  driveLog('Redirecting to Google for Drive authorization…');
  toast('Redirecting to Google…','w');
  _gauthOAuthSignIn();
}

async function driveBackupNow() {
  if (!_driveAccessToken) { driveLog('⚠ Not authorized. Click Authorize Drive first.','err'); return; }
  driveLog('Starting backup…');
  try {
    // 1. Find or create the BT Sale Data folder
    const folderId = await _driveFindOrCreateFolder();
    // 2. Build payload
    const today = new Date().toISOString().slice(0,10);
    const fname = 'BT-Sales-Backup-' + today + '.json';
    const payload = {
      monthly: MONTHLY, daily: DAILY,
      manager: JSON.parse(localStorage.getItem(MGR_KEY)||'{}'),
      petty:   _driveGetAllPetty(),
      custom:  JSON.parse(localStorage.getItem(CSEC_KEY)||'{}'),
      backedUpAt: new Date().toISOString()
    };
    const content = JSON.stringify(payload, null, 2);
    // 3. Check if today's file already exists
    const qr = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${fname}' and '${folderId}' in parents and trashed=false&fields=files(id)`,
      { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
    );
    const qd = await qr.json();
    const existingId = qd.files && qd.files[0] && qd.files[0].id;
    // 4. Upload (create or update)
    const meta = JSON.stringify({ name: fname, parents: existingId ? undefined : [folderId] });
    const form = new FormData();
    form.append('metadata', new Blob([meta], {type:'application/json'}));
    form.append('file',     new Blob([content], {type:'application/json'}));
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const method = existingId ? 'PATCH' : 'POST';
    const ur = await fetch(url, { method, headers:{Authorization:'Bearer '+_driveAccessToken}, body: form });
    if (!ur.ok) { const e=await ur.json(); throw new Error(e.error?.message||'HTTP '+ur.status); }
    localStorage.setItem(DRIVE_LAST_K, today);
    driveLog('✓ Backed up: <a href="https://drive.google.com/drive/folders/1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn" target="_blank" style="color:var(--accent)">BT-SALE-DATA</a> → ' + fname,'ok');
    _driveUpdateBadge('ok');
    toast('✓ Drive backup complete');
  } catch(e) { driveLog('✕ Backup failed: ' + e.message,'err'); _driveUpdateBadge('err'); }
}

async function _driveFindOrCreateFolder() {
  // Using the pre-existing BT-SALE-DATA folder directly
  return DRIVE_FOLDER_ID;
}

function _driveGetAllPetty() {
  const result = {};
  for (let i=0; i<localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mw_petty_')) result[k] = JSON.parse(localStorage.getItem(k)||'null');
  }
  return result;
}

// Hook unlockApp to trigger Drive auto-backup after initialization
// Deferred to window load so unlockApp is guaranteed to be defined
window.addEventListener('load', function(){
  var _origUnlock = unlockApp;
  unlockApp = function() {
    _origUnlock.apply(this, arguments);
    setTimeout(function(){ _driveAutoBackup(); }, 6000); // run 6s after app loads
  };
});

// Auto-backup once per day after unlock if Drive is authorized

// ── Drive: Restore from backup ────────────────────────────────────────────
function driveOpenRestoreModal() {
  if (!_driveAccessToken) {
    toast('⚠ Authorize Drive first, then try Restore','w'); return;
  }
  const modal = document.getElementById('drive-restore-modal');
  modal.style.display = 'flex';
  document.getElementById('drm-list').innerHTML = '';
  document.getElementById('drm-status').textContent = 'Loading backups…';
  _driveListBackups();
}
function driveCloseRestoreModal() {
  document.getElementById('drive-restore-modal').style.display = 'none';
}
async function _driveListBackups() {
  try {
    const folderId = DRIVE_FOLDER_ID;
    const q = encodeURIComponent(`'${folderId}' in parents and name contains 'BT-Sales-Backup' and trashed=false`);
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name desc&fields=files(id,name,size,modifiedTime)&pageSize=30`,
      { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
    );
    const d = await r.json();
    const files = d.files || [];
    const statusEl = document.getElementById('drm-status');
    const listEl  = document.getElementById('drm-list');
    if (!files.length) {
      statusEl.textContent = 'No backups found in BT-SALE-DATA folder.'; return;
    }
    statusEl.textContent = `${files.length} backup${files.length>1?'s':''} found — pick one to restore:`;
    listEl.innerHTML = files.map(f => {
      const date = f.name.replace('BT-Sales-Backup-','').replace('.json','');
      const kb   = f.size ? Math.round(f.size/1024)+'KB' : '';
      const mod  = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'}) : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:var(--s2);border:1px solid var(--border);border-radius:10px;gap:10px">
        <div>
          <div style="font-weight:600;font-size:13px">📅 ${date}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${mod}${kb?' · '+kb:''}</div>
        </div>
        <button class="btn btn-p" style="flex-shrink:0;font-size:12px;padding:6px 14px"
          onclick="_driveRestoreFile('${f.id}','${date}')">Restore</button>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('drm-status').textContent = '✕ Failed to list backups: ' + e.message;
  }
}
async function _driveRestoreFile(fileId, label) {
  if (!confirm(`Restore backup from ${label}?\n\nThis will merge the backup with your current data.`)) return;
  driveCloseRestoreModal();
  driveLog(`Restoring backup: ${label}…`);
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: 'Bearer ' + _driveAccessToken } });
    if (!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    let mN=0, dN=0;
    // Restore monthly + daily
    if (Array.isArray(data.monthly)) data.monthly.forEach(m => {
      if (!MONTHLY.find(x=>x.Month_Year===m.Month_Year)) { MONTHLY.push(m); mN++; }
    });
    if (Array.isArray(data.daily)) data.daily.forEach(d => {
      if (!DAILY.find(x=>x.Date===d.Date&&x.Month_Year===d.Month_Year)) { DAILY.push(d); dN++; }
    });
    saveMonthly(); saveDaily();
    // Restore manager
    if (data.manager && typeof data.manager==='object') {
      const cur = JSON.parse(localStorage.getItem(MGR_KEY)||'{}');
      Object.keys(data.manager).forEach(k => { if (!cur[k]) cur[k]=data.manager[k]; });
      localStorage.setItem(MGR_KEY, JSON.stringify(cur));
    }
    // Restore petty months
    if (data.petty && typeof data.petty==='object') {
      Object.keys(data.petty).forEach(k => {
        if (k.startsWith('mw_petty_') && !localStorage.getItem(k))
          localStorage.setItem(k, JSON.stringify(data.petty[k]));
      });
    }
    // Restore custom sections
    if (data.custom && typeof data.custom==='object') {
      const cur = JSON.parse(localStorage.getItem(CSEC_KEY)||'{}');
      Object.keys(data.custom).forEach(k => { if (!cur[k]) cur[k]=data.custom[k]; });
      localStorage.setItem(CSEC_KEY, JSON.stringify(cur));
    }
    driveLog(`✓ Restored from ${label}: +${mN} months, +${dN} days of sales data. Manager/Petty/Custom merged.`,'ok');
    toast(`✓ Restored from ${label}`);
    if (typeof showPage==='function') showPage(_curPage||'dashboard');
  } catch(e) {
    driveLog('✕ Restore failed: '+e.message,'err');
    toast('✕ Restore failed: '+e.message,'e');
  }
}

function _driveAutoBackup() {
  const last = localStorage.getItem(DRIVE_LAST_K);
  const today = new Date().toISOString().slice(0,10);
  if (last !== today && _driveAccessToken) driveBackupNow();
}

