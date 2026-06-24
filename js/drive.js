// ══════════════════════════════════════════════════════════════════
// GOOGLE DRIVE DAILY BACKUP
// ══════════════════════════════════════════════════════════════════
const DRIVE_LAST_K = 'bt_drive_last_backup';
const DRIVE_FOLDER = 'BT-SALE-DATA';
const DRIVE_FOLDER_ID = '1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn'; // your existing Drive folder
let _driveTokenClient = null;
let _driveAccessToken = '';

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

function driveAuthorize() {
  // If sign-in already granted a drive.file token, reuse it — no popup needed
  if (_driveAccessToken) {
    _driveUpdateBadge('ok');
    driveLog('✓ Drive authorized via Google Sign-In. Ready to backup.','ok');
    toast('✓ Google Drive ready');
    return;
  }
  // Already granted before? Try a silent refresh first — no redirect needed
  if (localStorage.getItem(DRIVE_GRANT_K) === '1') {
    driveLog('Reconnecting to Drive…');
    const _check = setInterval(function(){
      if (_driveAccessToken) { clearInterval(_check); }
    }, 300);
    setTimeout(function(){ clearInterval(_check); }, 4000);
    _driveSilentReauth();
    setTimeout(function(){
      if (!_driveAccessToken) {
        driveLog('Redirecting to Google for Drive authorization…');
        toast('Redirecting to Google…','w');
        _gauthOAuthSignIn();
      }
    }, 2500);
    return;
  }
  // Never granted before — go straight to the redirect OAuth flow
  // (it already requests drive.file scope, so sign-in + Drive are granted together)
  driveLog('Redirecting to Google for Drive authorization…');
  toast('Redirecting to Google…','w');
  _gauthOAuthSignIn();
}

// ── Silent Drive token refresh ──────────────────────────────────────────
// Drive access tokens (implicit grant) only last ~1hr and are never persisted,
// so on every hard refresh / fresh app load _driveAccessToken starts out empty.
// If the user previously granted the Drive scope (DRIVE_GRANT_K flag) and is
// still signed into the same Google account in this browser, Google Identity
// Services can silently re-issue a token with no visible prompt at all —
// no redirect, no account picker.
let _driveTokenClient = null;
function _driveSilentReauth(retries) {
  retries = retries === undefined ? 10 : retries;
  if (_driveAccessToken) return; // already have a live token (e.g. just came back from redirect)
  if (localStorage.getItem(DRIVE_GRANT_K) !== '1') return; // never granted Drive before — nothing to refresh
  const sess = (typeof gauthGetSession === 'function') ? gauthGetSession() : null;
  if (!sess || !sess.email) return; // not signed in — manual Authorize will be needed

  // The GIS script loads async; wait for it if it isn't ready yet
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    if (retries > 0) { setTimeout(() => _driveSilentReauth(retries - 1), 300); }
    return;
  }

  try {
    if (!_driveTokenClient) {
      _driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '36704237826-6lg0o3u0voqhdkvdj3kd331jsft62uun.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/drive.file',
        hint: sess.email,
        callback: function(resp) {
          if (resp && resp.access_token) {
            _driveAccessToken = resp.access_token;
            localStorage.setItem(DRIVE_GRANT_K, '1');
            _driveUpdateBadge('ok');
            driveLog('✓ Drive silently reauthorized for ' + sess.email, 'ok');
            _driveAutoBackup();
          } else {
            driveLog('Drive silent reauth returned no token — click Authorize Drive.', 'err');
          }
        },
        error_callback: function() {
          // Silent attempt failed (e.g. third-party cookies blocked, consent revoked) —
          // badge stays "Not set up"; user can fall back to the visible Authorize Drive button.
          driveLog('Drive silent reauth failed — click Authorize Drive to reconnect.', 'err');
        }
      });
    }
    _driveTokenClient.requestAccessToken({ prompt: '', hint: sess.email });
  } catch (e) {
    driveLog('Drive silent reauth error: ' + e.message, 'err');
  }
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

// Hook unlockApp to trigger Drive silent reauth + auto-backup after initialization
// Deferred to window load so unlockApp is guaranteed to be defined
window.addEventListener('load', function(){
  var _origUnlock = unlockApp;
  unlockApp = function() {
    _origUnlock.apply(this, arguments);
    setTimeout(function(){
      if (_driveAccessToken) { _driveAutoBackup(); }
      else { _driveSilentReauth(); } // callback runs _driveAutoBackup itself once a token lands
    }, 1500);
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

