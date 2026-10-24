// ══════════════════════════════════════════════════════════════════
// GOOGLE DRIVE DAILY BACKUP
// ══════════════════════════════════════════════════════════════════
// This file is an ES module. _driveAccessToken is deliberately a PROPERTY OF
// window, not a module-local `let`: auth.js reassigns it (bare `_driveAccessToken
// = token`) and sheets-api/app/picker read it, so all of them must share one
// value. A module-local binding would silently desync those writes (same
// reasoning as storage.js's _curPage).
if (typeof window._driveAccessToken === 'undefined') window._driveAccessToken = '';

(function() {
'use strict';

const DRIVE_LAST_K = 'bt_drive_last_backup';
const DRIVE_FOLDER_ID = '1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn'; // your existing Drive folder

// ── Persist the Drive access token across page refreshes AND new tabs ──
// Google access tokens are short-lived (~1hr), but there's no reason to
// force a fresh sign-in/consent every time a new tab or app session
// starts within that window. Uses localStorage (not sessionStorage) so
// the cache is shared across tabs and survives closing/reopening the
// browser — the token itself still expires on its own (1min safety
// margin below) and is cleared on sign-out (gauthClearSession), so this
// only widens the window from "this one tab" to "however long the token
// is actually still valid for," never beyond that.
const DRIVE_TOKEN_K = 'bt_drive_token_cache';
function _driveSaveToken(token, expiresInSec) {
  if (!token) return;
  const exp = Date.now() + (Math.max(60, (expiresInSec||3300)) * 1000) - 60000; // 1min safety margin
  try { localStorage.setItem(DRIVE_TOKEN_K, JSON.stringify({ token, exp })); } catch(e) {}
}
function _driveLoadCachedToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_K);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    if (token && exp > Date.now()) return token;
    localStorage.removeItem(DRIVE_TOKEN_K);
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
    // Always defer/module now — readyState is never 'loading' here.
    document.addEventListener('DOMContentLoaded', () => _driveUpdateBadge('ok'));
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

// ══════════════════════════════════════════════════════════════════
// BACKUP VERIFICATION  (freshness · read-back · restore preview · weekly drill)
// ══════════════════════════════════════════════════════════════════
// Why this exists: a backup you have never read back is only a hope. Every
// backup is now downloaded again right after upload and compared with what
// was sent; every restore starts with a read-only PREVIEW; and once a week
// the newest backup is pulled and dry-run restored (nothing is written) so
// a silent failure shows up as a red/amber line in Tools instead of on the
// day you need the file.
const DRIVE_VERIFY_K = 'bt_drive_verify_v1';   // result of the last backup + read-back
const DRIVE_DRILL_K  = 'bt_drive_drill_v1';    // result of the last weekly restore drill
const DRIVE_FRESH_MS = 26 * 3600 * 1000;       // newest backup must be younger than this
const DRIVE_STALE_BAD_MS = 72 * 3600 * 1000;   // older than this → red
const DRIVE_DRILL_EVERY_MS = 7 * 24 * 3600 * 1000;
const DRIVE_DRILL_OVERDUE_MS = 8 * 24 * 3600 * 1000;
const DRIVE_FORMAT = 2;                        // 1 = original payload, 2 = adds staff/targets/notes/sheets…

const _SHEET_KEYS = { sheetWorkbooks: 'bt_sheet_workbooks_v1', sheetFiles: 'bt_sheet_files_v1', sheets: 'bt_sheets_v2' };

// ── pure helpers (no DOM, no network — unit-tested) ───────────────────────
function _driveToday() { // Pakistan-local calendar date; the old UTC date rolled over at 5 AM
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) { return new Date().toISOString().slice(0, 10); }
}
const _MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function _driveDateKey(s) { // 'DD/Mon/YYYY' or ISO → sortable 'YYYYMMDD' ('' if unparsable)
  const str = String(s == null ? '' : s).trim();
  const m = /^(\d{1,2})[\/\-]([A-Za-z]{3})[A-Za-z]*[\/\-](\d{4})$/.exec(str);
  if (m && _MON[m[2].toLowerCase()]) return m[3] + String(_MON[m[2].toLowerCase()]).padStart(2, '0') + m[1].padStart(2, '0');
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  return iso ? iso[1] + iso[2] + iso[3] : '';
}
const _arr = x => Array.isArray(x) ? x : [];
function _driveSize(x) {
  if (Array.isArray(x)) return x.length;
  if (x && typeof x === 'object') return Object.keys(x).length;
  return 0;
}
function _driveSummarize(p) {
  p = p || {};
  let latestKey = '', latest = '';
  _arr(p.daily).forEach(d => { const k = _driveDateKey(d && d.Date); if (k > latestKey) { latestKey = k; latest = d.Date; } });
  return {
    months: _arr(p.monthly).length,
    days: _arr(p.daily).length,
    latest,
    staff: _arr(p.staff).length,
    ledger: p.ledger ? _arr(p.ledger.entries).length : 0,
    jazzcash: p.jazzcash ? _arr(p.jazzcash.entries).length : 0,
    pettyMonths: _driveSize(p.petty),
    notes: _arr(p.notes).length + _arr(p.staffNotes).length,
    workbooks: _driveSize(p.sheetWorkbooks)
  };
}
function _driveValidate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['File is not a valid backup'];
  const pr = [];
  if (!Array.isArray(data.daily)) pr.push('Daily sales list is missing');
  if (!Array.isArray(data.monthly)) pr.push('Monthly list is missing');
  if (Array.isArray(data.daily)) {
    const bad = data.daily.filter(d => !d || !d.Date || !d.Month_Year).length;
    if (bad) pr.push(bad + ' daily row(s) have no Date/Month');
    if (!data.daily.length && !_arr(data.monthly).length) pr.push('Backup holds no sales data at all');
  }
  if (!data.backedUpAt) pr.push('Backup timestamp is missing');
  if (data.formatVersion >= 2 && !Array.isArray(data.staff)) pr.push('Staff list is missing');
  return pr;
}
function _driveShrunk(prev, next) { // would this upload replace a bigger file with a much smaller one?
  if (!prev) return false;
  if (prev.days > 0 && next.days === 0) return true;
  if (prev.days >= 10 && next.days < prev.days * 0.9) return true;
  if (prev.months >= 3 && next.months < prev.months * 0.9) return true;
  return false;
}
function _driveCompareSent(sent, got) { // read-back must match what was uploaded
  const pr = [];
  ['months','days','staff','ledger','jazzcash','pettyMonths','notes','workbooks'].forEach(k => {
    if (sent[k] !== got[k]) pr.push(`${k}: sent ${sent[k]}, read back ${got[k]}`);
  });
  if (sent.latest !== got.latest) pr.push(`latest sale date: sent ${sent.latest || '—'}, read back ${got.latest || '—'}`);
  return pr;
}
function _driveMissing(incoming, existing, keyFn) { // how many distinct incoming rows are not already present
  const have = new Set(_arr(existing).map(keyFn)); let n = 0;
  _arr(incoming).forEach(r => { if (r == null) return; const k = keyFn(r); if (!have.has(k)) { have.add(k); n++; } });
  return n;
}
// Dry run of what a restore would add. Mirrors the gap-fill rules in _driveRestoreFile.
function _driveRestorePlan(data, live) {
  data = data || {}; live = live || {};
  const byId = r => r && r.id;
  const ledgerOf = x => (x && x.entries) || [];
  const objKeysMissing = (inc, cur) => Object.keys(inc && typeof inc === 'object' ? inc : {}).filter(k => !cur || !(k in cur)).length;
  return {
    months:   _driveMissing(data.monthly, live.monthly, m => m && m.Month_Year),
    days:     _driveMissing(data.daily, live.daily, d => d && d.Date + '|' + d.Month_Year),
    staff:    _driveMissing(data.staff, live.staff, byId),
    ledger:   _driveMissing(ledgerOf(data.ledger), ledgerOf(live.ledger), byId),
    jazzcash: _driveMissing(ledgerOf(data.jazzcash), ledgerOf(live.jazzcash), byId),
    pettyMonths: Object.keys(data.petty && typeof data.petty === 'object' ? data.petty : {}).filter(k => !_arr(live.pettyKeys).includes(k)).length,
    notes:    _driveMissing(data.notes, live.notes, byId) + _driveMissing(data.staffNotes, live.staffNotes, byId),
    targets:  objKeysMissing(data.targets, live.targets)
  };
}
function _driveAgo(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  const h = Math.round(m / 60);
  return h < 48 ? h + ' h' : Math.round(h / 24) + ' days';
}
// Traffic light for the Tools card. verify = last backup record, drill = last weekly drill record.
function _driveEvaluateHealth(verify, drill, now) {
  now = now || Date.now();
  if (!verify) return { level: 'warn', text: 'No verified backup yet — press Backup Now.' };
  const age = now - Date.parse(verify.at);
  if (verify.ok === false) return { level: 'bad', text: 'Last backup FAILED verification: ' + ((verify.problems || [])[0] || 'unknown problem') };
  if (isNaN(age) || age > DRIVE_STALE_BAD_MS) return { level: 'bad', text: 'No verified backup for ' + (isNaN(age) ? 'a long time' : _driveAgo(age)) + ' — open Tools and press Backup Now.' };
  if (age > DRIVE_FRESH_MS) return { level: 'warn', text: 'Last verified backup is ' + _driveAgo(age) + ' old.' };
  if (drill && drill.ok === false) return { level: 'bad', text: 'Weekly restore drill FAILED: ' + ((drill.problems || [])[0] || 'unknown problem') };
  const dAge = drill ? now - Date.parse(drill.at) : Infinity;
  if (!drill || isNaN(dAge) || dAge > DRIVE_DRILL_OVERDUE_MS) return { level: 'warn', text: 'Backup verified ' + _driveAgo(age) + ' ago. Weekly restore drill is overdue.' };
  return { level: 'ok', text: 'Backup verified ' + _driveAgo(age) + ' ago · restore drill passed ' + _driveAgo(dAge) + ' ago.' };
}
function _driveEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── data access (reads only) ──────────────────────────────────────────────
function _driveJSON(key, fallback) {
  try { const raw = Repository.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
function _driveGetPrefixed(prefix) {
  const result = {};
  Repository.getKeysByPrefix(prefix).forEach(k => { result[k] = _driveJSON(k, null); });
  return result;
}

function _driveBuildPayload() {
  const payload = {
    formatVersion: DRIVE_FORMAT,
    monthly: MONTHLY, daily: DAILY,
    staff: (typeof STAFF !== 'undefined') ? STAFF : [],
    manager: _driveJSON(MGR_KEY, {}),
    petty:   _driveGetPrefixed('mw_petty_'),
    incentive: _driveGetPrefixed('mw_incentive_'),
    custom:  _driveJSON(CSEC_KEY, {}),
    targets: _driveJSON('bt_targets', {}),
    jazzcash: _driveJSON(JC_KEY, null),
    jcTally:  _driveJSON(JC_TALLY_KEY, null),
    // Generalized Ledger (Expense, Jazz Cash's Daily Ledger, any custom "Other Section")
    ledger:            _driveJSON(LEDGER_KEY, null),
    ledgerCustomTypes: _driveJSON(LEDGER_CUSTOM_TYPES_KEY, null),
    notes:      _driveJSON('bt_notes_v1', []),
    staffNotes: _driveJSON('bt_staff_notes_v1', []),
    excessRetain: _driveJSON('bt_excess_retain_v1', []),
    colConfig: { hidden: _driveJSON('bt_col_config', []), custom: _driveJSON('bt_custom_cols', []) },
    backedUpAt: new Date().toISOString()
  };
  Object.keys(_SHEET_KEYS).forEach(f => { payload[f] = _driveJSON(_SHEET_KEYS[f], null); });
  payload.counts = _driveSummarize(payload);
  return payload;
}
function _driveLiveSnapshot() {
  return {
    daily: DAILY, monthly: MONTHLY,
    staff: (typeof STAFF !== 'undefined') ? STAFF : [],
    ledger: _driveJSON(LEDGER_KEY, null), jazzcash: _driveJSON(JC_KEY, null),
    notes: _driveJSON('bt_notes_v1', []), staffNotes: _driveJSON('bt_staff_notes_v1', []),
    targets: _driveJSON('bt_targets', {}), pettyKeys: Repository.getKeysByPrefix('mw_petty_')
  };
}

// ── Drive I/O ─────────────────────────────────────────────────────────────
const _driveHdr = () => ({ Authorization: 'Bearer ' + _driveAccessToken });
async function _driveFindOrCreateFolder() {
  // Using the pre-existing BT-SALE-DATA folder directly
  return DRIVE_FOLDER_ID;
}
async function _driveDownload(fileId) { // throws on HTTP error or truncated/invalid JSON
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: _driveHdr() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}
async function _driveListFiles(pageSize) {
  const q = encodeURIComponent(`'${DRIVE_FOLDER_ID}' in parents and name contains 'BT-Sales-Backup' and trashed=false`);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name desc&fields=files(id,name,size,modifiedTime)&pageSize=${pageSize || 30}`,
    { headers: _driveHdr() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).files || [];
}
function _driveSaveRec(key, rec) { try { Actions.saveFeatureData(key, JSON.stringify(rec)); } catch (e) {} }

// ── health line in Tools ──────────────────────────────────────────────────
function driveRefreshHealth() {
  const el = document.getElementById('drive-health');
  if (!el) return _driveEvaluateHealth(_driveJSON(DRIVE_VERIFY_K, null), _driveJSON(DRIVE_DRILL_K, null));
  const h = _driveEvaluateHealth(_driveJSON(DRIVE_VERIFY_K, null), _driveJSON(DRIVE_DRILL_K, null));
  const col = h.level === 'ok' ? 'var(--green)' : h.level === 'bad' ? 'var(--red)' : 'var(--amber)';
  const dot = h.level === 'ok' ? '🟢' : h.level === 'bad' ? '🔴' : '🟡';
  el.innerHTML = `<span style="color:${col};font-weight:600">${dot} ${_driveEsc(h.text)}</span>`;
  return h;
}

// ── Backup (with read-back verification) ──────────────────────────────────
// auto=true when called from the daily auto-run: never prompts, refuses to shrink a good file.
async function driveBackupNow(auto) {
  auto = auto === true;
  if (!_driveAccessToken) { driveLog('⚠ Not authorized. Click Authorize Drive first.', 'err'); return false; }
  driveLog('Starting backup…');
  try {
    const folderId = await _driveFindOrCreateFolder();
    const today = _driveToday();
    const fname = 'BT-Sales-Backup-' + today + '.json';
    const payload = _driveBuildPayload();
    const sent = payload.counts;
    if (!sent.days && !sent.months) throw new Error('No sales data is loaded — backup aborted so a good backup is not replaced by an empty one');
    const content = JSON.stringify(payload, null, 2);

    // Is today's file already there? If so, never let a much smaller payload silently replace it.
    const qr = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${fname}' and '${folderId}' in parents and trashed=false`)}&fields=files(id)`,
      { headers: _driveHdr() });
    const qd = await qr.json();
    const existingId = qd.files && qd.files[0] && qd.files[0].id;
    if (existingId) {
      let prev = null;
      try { prev = _driveSummarize(await _driveDownload(existingId)); } catch (e) { /* unreadable old file: safe to replace */ }
      if (_driveShrunk(prev, sent)) {
        const msg = `Today's backup has ${prev.days} days / ${prev.months} months, but live data has only ${sent.days} days / ${sent.months} months.`;
        if (auto) throw new Error(msg + ' Auto-backup did not overwrite it. Check your data, then use Backup Now.');
        if (!confirm(msg + '\n\nOverwrite the existing backup with the smaller data?')) { driveLog('Backup cancelled — existing file kept.', 'err'); return false; }
      }
    }

    const meta = JSON.stringify({ name: fname, parents: existingId ? undefined : [folderId] });
    const form = new FormData();
    form.append('metadata', new Blob([meta], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'application/json' }));
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const ur = await fetch(url, { method: existingId ? 'PATCH' : 'POST', headers: _driveHdr(), body: form });
    if (!ur.ok) { const e = await ur.json().catch(() => ({})); throw new Error((e.error && e.error.message) || 'HTTP ' + ur.status); }
    const up = await ur.json().catch(() => ({}));
    const fileId = up.id || existingId;

    // Read it back: this is what proves the backup is real and complete, not just "upload returned 200".
    let problems = [];
    try {
      const back = await _driveDownload(fileId);
      problems = _driveValidate(back).concat(_driveCompareSent(sent, _driveSummarize(back)));
    } catch (e) { problems = ['Could not read the file back: ' + e.message]; }

    const ok = problems.length === 0;
    _driveSaveRec(DRIVE_VERIFY_K, { at: new Date().toISOString(), file: fname, ok, counts: sent, problems });
    if (ok) {
      Actions.saveFeatureData(DRIVE_LAST_K, today);
      driveLog('✓ Backed up &amp; verified: <a href="https://drive.google.com/drive/folders/1qDSFSlrcUA7EoaMx43bG3mxkpS1ESHGn" target="_blank" style="color:var(--accent)">BT-SALE-DATA</a> → ' + _driveEsc(fname) +
        ` (${sent.days} days, ${sent.months} months, ${sent.staff} staff, latest sale ${_driveEsc(sent.latest || '—')})`, 'ok');
      _driveUpdateBadge('ok');
      toast('✓ Drive backup verified');
    } else {
      driveLog('✕ Backup uploaded but FAILED verification: ' + _driveEsc(problems.join('; ')), 'err');
      _driveUpdateBadge('err');
      toast('✕ Drive backup failed verification', 'e');
    }
    driveRefreshHealth();
    return ok;
  } catch (e) {
    driveLog('✕ Backup failed: ' + _driveEsc(e.message), 'err');
    _driveSaveRec(DRIVE_VERIFY_K, { at: new Date().toISOString(), file: '', ok: false, counts: null, problems: [e.message] });
    _driveUpdateBadge('err'); driveRefreshHealth();
    return false;
  }
}

// ── Weekly restore drill: read newest backup, validate, dry-run restore (writes nothing) ──
async function driveRunDrill(manual) {
  manual = manual === true;
  if (!_driveAccessToken && typeof _driveSilentReauth === 'function') await _driveSilentReauth();
  if (!_driveAccessToken) { if (manual) { driveLog('⚠ Not authorized. Click Authorize Drive first.', 'err'); toast('⚠ Authorize Drive first', 'w'); } return false; }
  driveLog('Restore drill: reading the newest backup…');
  const rec = { at: new Date().toISOString(), ok: false, file: '', problems: [], counts: null, wouldAdd: null };
  try {
    const files = await _driveListFiles(5);
    if (!files.length) throw new Error('No backups found in the Drive folder');
    const f = files[0]; rec.file = f.name;
    const age = Date.now() - Date.parse(f.modifiedTime);
    if (isNaN(age) || age > DRIVE_FRESH_MS) rec.problems.push('Newest backup (' + f.name + ') is ' + (isNaN(age) ? 'of unknown age' : _driveAgo(age) + ' old'));
    const data = await _driveDownload(f.id);                 // readable + parseable?
    rec.problems = rec.problems.concat(_driveValidate(data)); // structurally sound?
    const sum = _driveSummarize(data); rec.counts = sum;
    const liveSum = _driveSummarize({ daily: DAILY, monthly: MONTHLY });
    if (liveSum.days >= 10 && sum.days < liveSum.days * 0.9) rec.problems.push(`Backup has ${sum.days} days but live data has ${liveSum.days} — backup is missing data`);
    rec.wouldAdd = _driveRestorePlan(data, _driveLiveSnapshot()); // dry run — pure function, no writes
    rec.ok = rec.problems.length === 0;
  } catch (e) { rec.problems.push('Drill could not complete: ' + e.message); }
  _driveSaveRec(DRIVE_DRILL_K, rec);
  if (rec.ok) driveLog(`✓ Restore drill passed: ${_driveEsc(rec.file)} is readable and complete (${rec.counts.days} days, latest sale ${_driveEsc(rec.counts.latest || '—')}). A restore would add ${rec.wouldAdd.days} days / ${rec.wouldAdd.months} months.`, 'ok');
  else driveLog('✕ Restore drill FAILED: ' + _driveEsc(rec.problems.join('; ')), 'err');
  if (manual) toast(rec.ok ? '✓ Restore drill passed' : '✕ Restore drill failed', rec.ok ? undefined : 'e');
  driveRefreshHealth();
  return rec.ok;
}

// ── Auto-run after unlock ─────────────────────────────────────────────────
// auth.js dispatches 'bt:app-unlocked' once, right after a verified Google
// sign-in opens the app (unlockApp itself is private to auth.js and is never
// patched). Registered at script time so it also catches an unlock that
// happens before window 'load' (saved-session resume).
window.addEventListener('bt:app-unlocked', function(){
  setTimeout(function(){ _driveAutoBackup(); }, 6000); // run 6s after app loads
});
window.addEventListener('load', function(){
  driveRefreshHealth();
  setInterval(driveRefreshHealth, 5 * 60 * 1000);
});

async function _driveAutoBackup() {
  try {
    // Previously a missing/expired token made this a silent no-op for days. Try a silent renewal first.
    if (!_driveAccessToken && typeof _driveSilentReauth === 'function') await _driveSilentReauth();
    if (!_driveAccessToken) {
      driveLog('⚠ Daily backup skipped: Google Drive is not authorized on this device. Open Tools → Authorize Drive.', 'err');
    } else {
      if (Repository.getItem(DRIVE_LAST_K) !== _driveToday()) await driveBackupNow(true);
      const dr = _driveJSON(DRIVE_DRILL_K, null);
      if (!dr || isNaN(Date.parse(dr.at)) || Date.now() - Date.parse(dr.at) > DRIVE_DRILL_EVERY_MS) await driveRunDrill(false);
    }
  } catch (e) { driveLog('✕ Auto-backup error: ' + _driveEsc(e.message), 'err'); }
  const h = driveRefreshHealth();
  if (h && h.level === 'bad') toast('⚠ ' + h.text, 'e');
}

// ── Drive: Restore (preview first, then merge) ────────────────────────────
let _drivePreviewCache = null; // { id, data } — restore uses exactly what was previewed

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
  _drivePreviewCache = null;
}
async function _driveListBackups() {
  _drivePreviewCache = null;
  try {
    const files = await _driveListFiles(30);
    const statusEl = document.getElementById('drm-status');
    const listEl  = document.getElementById('drm-list');
    if (!files.length) {
      statusEl.textContent = 'No backups found in BT-SALE-DATA folder.'; listEl.innerHTML = ''; return;
    }
    statusEl.textContent = `${files.length} backup${files.length>1?'s':''} found — preview one before restoring:`;
    listEl.innerHTML = files.map(f => {
      const date = f.name.replace('BT-Sales-Backup-','').replace('.json','');
      const kb   = f.size ? Math.round(f.size/1024)+'KB' : '';
      const mod  = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'}) : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;margin-bottom:8px;background:var(--s2);border:1px solid var(--border);border-radius:10px;gap:10px">
        <div>
          <div style="font-weight:600;font-size:13px">📅 ${_driveEsc(date)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${_driveEsc(mod)}${kb?' · '+kb:''}</div>
        </div>
        <button class="btn btn-p" style="flex-shrink:0;font-size:12px;padding:6px 14px"
          onclick="_drivePreviewFile('${_driveEsc(f.id)}','${_driveEsc(date)}')">Preview</button>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('drm-status').textContent = '✕ Failed to list backups: ' + e.message;
  }
}
async function _drivePreviewFile(fileId, label) {
  const statusEl = document.getElementById('drm-status');
  const listEl = document.getElementById('drm-list');
  statusEl.textContent = 'Reading backup ' + label + '…'; listEl.innerHTML = '';
  try {
    const data = await _driveDownload(fileId);
    _drivePreviewCache = { id: fileId, data };
    const problems = _driveValidate(data);
    const b = _driveSummarize(data);
    const l = _driveSummarize({ daily: DAILY, monthly: MONTHLY, staff: (typeof STAFF !== 'undefined') ? STAFF : [],
      ledger: _driveJSON(LEDGER_KEY, null), jazzcash: _driveJSON(JC_KEY, null),
      petty: _driveGetPrefixed('mw_petty_'), notes: _driveJSON('bt_notes_v1', []), staffNotes: _driveJSON('bt_staff_notes_v1', []) });
    const p = _driveRestorePlan(data, _driveLiveSnapshot());
    const row = (name, bv, lv, add) => `<tr><td style="padding:5px 4px">${name}</td><td style="text-align:right;padding:5px 4px">${_driveEsc(bv)}</td><td style="text-align:right;padding:5px 4px;color:var(--muted)">${_driveEsc(lv)}</td><td style="text-align:right;padding:5px 4px;font-weight:600;color:${add>0?'var(--green)':'var(--muted)'}">${add==null?'':(add>0?'+':'')+add}</td></tr>`;
    const old = !(data && data.formatVersion >= 2);
    statusEl.textContent = '';
    listEl.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:2px">📅 ${_driveEsc(label)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Backed up ${_driveEsc(data && data.backedUpAt ? new Date(data.backedUpAt).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'}) : 'unknown time')}${old?' · older format (no staff/targets/notes)':''}</div>
      ${problems.length ? `<div style="font-size:12px;color:var(--red);margin-bottom:10px">⚠ ${problems.map(_driveEsc).join('<br>⚠ ')}</div>` : `<div style="font-size:12px;color:var(--green);margin-bottom:10px">✓ File is readable and complete</div>`}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="color:var(--muted);font-size:11px"><td></td><td style="text-align:right">Backup</td><td style="text-align:right">Live now</td><td style="text-align:right">Restore adds</td></tr>
        ${row('Months of sales', b.months, l.months, p.months)}
        ${row('Days of sales', b.days, l.days, p.days)}
        ${row('Latest sale date', b.latest || '—', l.latest || '—', null)}
        ${row('Staff', b.staff, l.staff, p.staff)}
        ${row('Ledger entries', b.ledger, l.ledger, p.ledger)}
        ${row('Jazz Cash entries', b.jazzcash, l.jazzcash, p.jazzcash)}
        ${row('Petty months', b.pettyMonths, l.pettyMonths, p.pettyMonths)}
        ${row('Notes', b.notes, l.notes, p.notes)}
      </table>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn" style="background:var(--s3);border-color:var(--border);flex:1" onclick="_driveListBackups()">← Back</button>
        <button class="btn btn-p" style="flex:1" ${problems.length?'disabled':''} onclick="_driveRestoreFile('${_driveEsc(fileId)}','${_driveEsc(label)}')">Restore (merge)</button>
      </div>`;
  } catch (e) {
    statusEl.textContent = '✕ Could not read this backup: ' + e.message;
    listEl.innerHTML = `<button class="btn" style="margin-top:10px" onclick="_driveListBackups()">← Back</button>`;
  }
}
async function _driveRestoreFile(fileId, label) {
  try {
    const data = (_drivePreviewCache && _drivePreviewCache.id === fileId) ? _drivePreviewCache.data : await _driveDownload(fileId);
    const plan = _driveRestorePlan(data, _driveLiveSnapshot());
    if (!confirm(`Restore backup from ${label}?\n\nThis will ADD (nothing is overwritten):\n• ${plan.months} months, ${plan.days} days of sales\n• ${plan.staff} staff, ${plan.ledger} ledger entries, ${plan.jazzcash} Jazz Cash entries\n• ${plan.pettyMonths} petty months, ${plan.notes} notes`)) return;
    driveCloseRestoreModal();
    driveLog(`Restoring backup: ${label}…`);
    let mN=0, dN=0, sN=0;
    // Restore monthly + daily — fill gaps only, never overwrite an existing
    // local record (this has always been Drive restore's intent: "add what's
    // missing", unlike Supabase pull which can overwrite on purpose).
    if (Array.isArray(data.monthly)) { const r = Repository.gapFillMonthly(data.monthly); mN = r.added; }
    if (Array.isArray(data.daily))   { const r = Repository.gapFillDaily(data.daily);     dN = r.added; }
    // Staff registry (format 2+) — gap-fill by stable id; never overwrites or reactivates an existing member
    if (Array.isArray(data.staff))   { const r = Repository.gapFillStaff(data.staff);     sN = r.added; }
    await idbSaveData();
    // Restore manager
    if (data.manager && typeof data.manager==='object') {
      const cur = JSON.parse(Repository.getItem(MGR_KEY)||'{}');
      Object.keys(data.manager).forEach(k => { if (!cur[k]) cur[k]=data.manager[k]; });
      Actions.saveFeatureData(MGR_KEY, JSON.stringify(cur));
    }
    // Restore petty months
    if (data.petty && typeof data.petty==='object') {
      Object.keys(data.petty).forEach(k => {
        if (k.startsWith('mw_petty_') && !Repository.getItem(k))
          Actions.saveFeatureData(k, JSON.stringify(data.petty[k]));
      });
    }
    // Restore incentive months (format 2+)
    if (data.incentive && typeof data.incentive==='object') {
      Object.keys(data.incentive).forEach(k => {
        if (k.startsWith('mw_incentive_') && !Repository.getItem(k))
          Actions.saveFeatureData(k, JSON.stringify(data.incentive[k]));
      });
    }
    // Restore custom sections
    if (data.custom && typeof data.custom==='object') {
      const cur = JSON.parse(Repository.getItem(CSEC_KEY)||'{}');
      Object.keys(data.custom).forEach(k => { if (!cur[k]) cur[k]=data.custom[k]; });
      Actions.saveFeatureData(CSEC_KEY, JSON.stringify(cur));
    }
    // Restore targets (fill missing keys only)
    if (data.targets && typeof data.targets==='object' && !Array.isArray(data.targets)) {
      const cur = _driveJSON('bt_targets', {}) || {};
      Object.keys(data.targets).forEach(k => { if (!(k in cur)) cur[k]=data.targets[k]; });
      Actions.saveFeatureData('bt_targets', JSON.stringify(cur));
    }
    // Restore Notes / Staff notes (merge by id — never drop local entries)
    [['notes','bt_notes_v1'],['staffNotes','bt_staff_notes_v1']].forEach(([f,key]) => {
      if (!Array.isArray(data[f]) || !data[f].length) return;
      const cur = _driveJSON(key, []) || [];
      const have = new Set(cur.map(e => e && e.id));
      const add = data[f].filter(e => { if (!e || !e.id || have.has(e.id)) return false; have.add(e.id); return true; });
      if (add.length) Actions.saveFeatureData(key, JSON.stringify(cur.concat(add)));
    });
    // Restore Notes & Sheets stores only when this device has none yet (fill-if-empty, never merged cell-by-cell)
    Object.keys(_SHEET_KEYS).forEach(f => {
      if (data[f] && _driveSize(data[f]) && !Repository.getItem(_SHEET_KEYS[f])) Actions.saveFeatureData(_SHEET_KEYS[f], JSON.stringify(data[f]));
    });
    // Excess Working retain list (union)
    if (Array.isArray(data.excessRetain) && data.excessRetain.length) {
      const cur = _driveJSON('bt_excess_retain_v1', []) || [];
      const u = Array.from(new Set(cur.concat(data.excessRetain)));
      if (u.length !== cur.length) Actions.saveFeatureData('bt_excess_retain_v1', JSON.stringify(u));
    }
    // Restore JazzCash ledger (fill gaps by entry id — never drop local entries)
    if (data.jazzcash && typeof data.jazzcash === 'object') {
      const cur = JSON.parse(Repository.getItem(JC_KEY)||'null') || { openingBalance:0, entries:[] };
      const byId = {}; (cur.entries||[]).forEach(e => byId[e.id]=e);
      (data.jazzcash.entries||[]).forEach(e => { if (e && e.id && !byId[e.id]) byId[e.id]=e; });
      if (!cur.entries || !cur.entries.length) cur.openingBalance = data.jazzcash.openingBalance ?? cur.openingBalance ?? 0;
      cur.entries = Object.values(byId);
      Actions.saveFeatureData(JC_KEY, JSON.stringify(cur));
    }
    // Restore JazzCash tally (accounts by id, snapshots by date — fill gaps only)
    if (data.jcTally && typeof data.jcTally === 'object') {
      const cur = JSON.parse(Repository.getItem(JC_TALLY_KEY)||'null') || { accounts:[], snapshots:[] };
      const acctById = {}; (cur.accounts||[]).forEach(a => acctById[a.id]=a);
      (data.jcTally.accounts||[]).forEach(a => { if (a && a.id && !acctById[a.id]) acctById[a.id]=a; });
      const snapByDate = {}; (cur.snapshots||[]).forEach(s => snapByDate[s.date]=s);
      (data.jcTally.snapshots||[]).forEach(s => { if (s && s.date && !snapByDate[s.date]) snapByDate[s.date]=s; });
      cur.accounts = Object.values(acctById);
      cur.snapshots = Object.values(snapByDate);
      Actions.saveFeatureData(JC_TALLY_KEY, JSON.stringify(cur));
    }
    // Restore generalized Ledger (entries merged by id — never drop local
    // entries; openingBalances merged per ledgerType, fill gaps only)
    if (data.ledger && typeof data.ledger === 'object') {
      const cur = JSON.parse(Repository.getItem(LEDGER_KEY)||'null') || { entries:[], openingBalances:{} };
      const byId = {}; (cur.entries||[]).forEach(e => byId[e.id]=e);
      (data.ledger.entries||[]).forEach(e => { if (e && e.id && !byId[e.id]) byId[e.id]=e; });
      cur.entries = Object.values(byId);
      cur.openingBalances = cur.openingBalances || {};
      Object.keys(data.ledger.openingBalances||{}).forEach(t => {
        if (!(t in cur.openingBalances)) cur.openingBalances[t] = data.ledger.openingBalances[t];
      });
      Actions.saveFeatureData(LEDGER_KEY, JSON.stringify(cur));
    }
    // Restore custom "Misc Sections" ledger-type definitions (fill gaps only)
    if (data.ledgerCustomTypes && typeof data.ledgerCustomTypes === 'object') {
      const cur = JSON.parse(Repository.getItem(LEDGER_CUSTOM_TYPES_KEY)||'null') || {};
      Object.keys(data.ledgerCustomTypes).forEach(t => { if (!cur[t]) cur[t] = data.ledgerCustomTypes[t]; });
      Actions.saveFeatureData(LEDGER_CUSTOM_TYPES_KEY, JSON.stringify(cur));
    }
    // Restore column/field config (only if nothing set locally yet)
    if (data.colConfig && typeof data.colConfig === 'object') {
      if (!Repository.getItem('bt_col_config')  && Array.isArray(data.colConfig.hidden)) Actions.saveFeatureData('bt_col_config',  JSON.stringify(data.colConfig.hidden));
      if (!Repository.getItem('bt_custom_cols') && Array.isArray(data.colConfig.custom)) Actions.saveFeatureData('bt_custom_cols', JSON.stringify(data.colConfig.custom));
      if (typeof fmLoad === 'function') fmLoad();
    }
    driveLog(`✓ Restored from ${_driveEsc(label)}: +${mN} months, +${dN} days of sales, +${sN} staff. Manager/Petty/Incentive/Custom/Targets/Notes/Sheets/JazzCash/Ledger/Fields merged.`,'ok');
    toast(`✓ Restored from ${label}`);
    if (typeof showPage==='function') showPage(_curPage||'ai');
  } catch(e) {
    driveLog('✕ Restore failed: '+_driveEsc(e.message),'err');
    toast('✕ Restore failed: '+e.message,'e');
  }
}

// Bridge only what's used externally or via same-file/HTML onclick.
window._driveSaveToken = _driveSaveToken;
window.driveLog = driveLog;
window._driveUpdateBadge = _driveUpdateBadge;
window.driveAuthorize = driveAuthorize;
window.driveBackupNow = driveBackupNow;
window.driveRunDrill = driveRunDrill;
window.driveRefreshHealth = driveRefreshHealth;
window.driveOpenRestoreModal = driveOpenRestoreModal;
window.driveCloseRestoreModal = driveCloseRestoreModal;
window._driveListBackups = _driveListBackups;
window._drivePreviewFile = _drivePreviewFile;
window._driveRestoreFile = _driveRestoreFile;
// Pure helpers, exposed for tests/drive-verify.test.js
window.DriveVerify = {
  today: _driveToday, dateKey: _driveDateKey, summarize: _driveSummarize, validate: _driveValidate,
  shrunk: _driveShrunk, compareSent: _driveCompareSent, restorePlan: _driveRestorePlan,
  evaluateHealth: _driveEvaluateHealth
};

})();

