/* ═══════════════════════════════════════════════════════════════
   GOOGLE DRIVE BACKUP — Edge Function
   Deploy with: supabase functions deploy google-drive
   Requires secrets: supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
   the Edge Function runtime — do not set those yourself.)

   The refresh token never leaves this function. The browser only
   ever calls this endpoint with an { action, ... } body and gets
   back status info — never a token. See google_drive_backup.sql
   for why that's safe even if someone reads the anon key.

   Actions (every one requires either { pin } matching db.settings.
   adminPin, or — 'backup' only — { autoKey } matching this row's
   stored auto_key, see requireBackupAuth()):
     status         → { connected, email, lastBackupAt }
     oauth_callback → exchanges a Google `code` for tokens, stores them
     backup_pdf_stored → { autoKey, fileKey } — copies a PDF already in the
                       closing-pdfs bucket to Drive (server-side, no staff session)
     backup         → pulls current data from Supabase, uploads a NEW
                       timestamped JSON file to the visible Closing Backups
                       folder, prunes anything past MAX_VERSIONS_KEPT
     list_versions  → { versions: [{id, name, createdTime, size}] }
     restore        → { fileId } — downloads that version and replaces
                       ALL current data with it (sheets, credit ledger,
                       settings, activity log, deleted-record tombstones)
     set_auto_key   → { autoKey } — manually overrides the auto_key
                       (rotation utility; normally generated automatically
                       by oauth_callback and read by the Postgres trigger
                       that actually calls 'backup' on every shift save)
     disconnect     → revokes the token with Google and clears the row
═══════════════════════════════════════════════════════════════ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

/* Every action below is gated on the SAME Admin PIN already used
   in-app for Settings / Final Closing (db.settings.adminPin, in the
   `settings` table's row id=1 `data` column — see sync.js). Reading
   it live off the DB (rather than baking it in as a separate Edge
   Function secret) means there's one source of truth: whatever the
   owner sets as their Admin PIN in Settings is immediately what
   authorizes Drive Backup too, with nothing extra to keep in sync.
   This is the REAL boundary — the client-side lock in drive-backup.js
   is only there to keep the UI tidy for everyone else; without this
   check here, anyone who found the public anon key (shipped in every
   page load, same as before) could call backup/disconnect directly. */
async function getAdminPin(): Promise<string | null> {
  const { data } = await admin().from('settings').select('data').eq('id', 1).maybeSingle();
  return data?.data?.adminPin || null;
}

// CORS: browser calls are limited to the production site. Override with ALLOWED_ORIGINS (comma list) for local dev.
// Applied to EVERY response by the wrapper at the bottom of this file, so error paths are covered too.
const DEFAULT_ORIGIN = 'https://bt.duapharma.com';
const DEFAULT_ORIGINS = 'https://bt.duapharma.com,https://closing.duapharma.com';
const allowedOrigins = [...new Set([
  ...DEFAULT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean),
])];
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = allowedOrigins.includes('*') ? '*' : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || DEFAULT_ORIGIN);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function unauthorized(): never {
  throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireActiveStaff(req: Request) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) unauthorized();
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) unauthorized();
  const { data: active, error } = await userClient.rpc('is_active_staff', { p_uid: userData.user.id });
  if (error || active !== true) unauthorized();
  return userData.user.id;
}

async function requireAdmin(pin: unknown) {
  const adminPin = await getAdminPin();
  if (!adminPin || typeof pin !== 'string' || pin !== adminPin) unauthorized();
}

/* 'backup' alone gets a second door: the per-install auto-backup key
   (google_drive_backup.auto_key), generated server-side the moment
   Drive is connected (see handleOauthCallback below) and read directly
   off this row by a Postgres trigger on the `sheets` table
   (drive_backup_on_shift_save() in google_drive_backup.sql) — that's
   what lets an ordinary shift-closing save, from ANY device, trigger
   a backup with no Admin PIN and nothing stored in any browser. It
   only ever authorizes 'backup' — status/oauth_callback/disconnect/
   list_versions/restore still need the real Admin PIN below. */
async function requireBackupAuth(pin: unknown, autoKey: unknown) {
  if (typeof autoKey === 'string' && autoKey.length > 0) {
    const row = await getRow();
    if (row?.auto_key && autoKey === row.auto_key) return;
  }
  await requireAdmin(pin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function getRow() {
  const { data } = await admin().from('google_drive_backup').select('*').eq('id', 1).maybeSingle();
  return data;
}

/* Returns a live access token, refreshing it first if it's expired
   or about to expire. Persists the refreshed token + new expiry. */
async function getAccessToken(row: Record<string, unknown>) {
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at as string).getTime() : 0;
  if (row.access_token && expiresAt - Date.now() > 60_000) {
    return row.access_token as string;
  }
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token as string,
      grant_type:    'refresh_token',
    }),
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error(tok.error_description || tok.error || 'Token refresh failed');

  const expiresAtIso = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await admin().from('google_drive_backup').update({
    access_token: tok.access_token,
    access_token_expires_at: expiresAtIso,
  }).eq('id', 1);

  return tok.access_token as string;
}

async function handleOauthCallback(code: string, redirectUri: string) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error(tok.error_description || tok.error || 'Code exchange failed');
  if (!tok.refresh_token) {
    /* Happens if the user had already granted consent before without
       revoking it — Google only issues a refresh_token on the FIRST
       consent unless prompt=consent is forced (which the client
       always sends — see drive-backup.js). Surfacing this clearly
       beats silently storing no refresh token at all. */
    throw new Error('Google did not return a refresh token — revoke access at myaccount.google.com/permissions and try connecting again.');
  }

  let email: string | null = null;
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then(r => r.json());
    email = ui.email || null;
  } catch (_e) { /* non-fatal — email is cosmetic only */ }

  const existing = await getRow();
  await admin().from('google_drive_backup').upsert({
    id: 1,
    refresh_token: tok.refresh_token,
    access_token: tok.access_token,
    access_token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    connected_email: email,
    /* Generated once per connection — see requireBackupAuth() and the
       drive_backup_on_shift_save() Postgres trigger (google_drive_backup.sql),
       which is what actually calls 'backup' using this value on every
       completed shift save, from any device. */
    auto_key: existing?.auto_key || crypto.randomUUID(),
    updated_at: new Date().toISOString(),
  });

  return { connected: true, email };
}

/* Prefixes keep JSON snapshots and shift PDFs separate in the visible
   Closing Backups folder, with independent retention limits. */
const BACKUP_FILE_PREFIX = 'closing-backup-';
const MAX_VERSIONS_KEPT = 30;

const DRIVE_FOLDER_NAME = 'Closing Backups';
const PDF_FILE_PREFIX = 'closing-pdf-';

async function driveFilesList(accessToken: string, folderId: string) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
  url.searchParams.set('fields', 'files(id,name,createdTime,size,mimeType)');
  url.searchParams.set('orderBy', 'createdTime desc');
  url.searchParams.set('pageSize', '100');
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Drive list failed: ${JSON.stringify(data)}`);
  return data.files || [];
}

async function getDriveFolder(accessToken: string) {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const listed = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await listed.json();
  if (!listed.ok) throw new Error(`Drive folder lookup failed: ${JSON.stringify(data)}`);
  if (data.files?.length) return data.files[0].id as string;
  const created = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await created.json();
  if (!created.ok) throw new Error(`Drive folder creation failed: ${JSON.stringify(folder)}`);
  return folder.id as string;
}

async function uploadPdfToDrive(bytes: Uint8Array, fileKey: string) {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('PDF exceeds the 10 MiB limit.');
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF file.');
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  const accessToken = await getAccessToken(row);
  const folderId = await getDriveFolder(accessToken);
  const safeKey = fileKey.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100);
  const fileName = `${PDF_FILE_PREFIX}${safeKey}.pdf`;
  const existing = (await driveFilesList(accessToken, folderId)).filter((f: { name: string }) => f.name === fileName);
  const boundary = 'closingpdfboundary';
  /* Drive rejects `parents` on an update (PATCH); it is only valid on create. */
  const metadata = existing.length
    ? { name: fileName, mimeType: 'application/pdf' }
    : { name: fileName, mimeType: 'application/pdf', parents: [folderId] };
  const encoder = new TextEncoder();
  const header = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: binary\r\n\r\n`);
  const footer = encoder.encode(`\r\n--${boundary}--`);
  const body = new Blob([header, bytes, footer], { type: `multipart/related; boundary=${boundary}` });
  const endpoint = existing.length
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing[0].id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const resp = await fetch(endpoint, {
    method: existing.length ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const saved = await resp.json();
  if (!resp.ok) throw new Error(`Drive PDF upload failed: ${JSON.stringify(saved)}`);
  /* Two uploads of the same shift can race and both create the file —
     keep the one we just wrote and remove same-named duplicates. */
  const all = await driveFilesList(accessToken, folderId);
  for (const dup of all.filter((f: { name: string; id: string }) => f.name === fileName && f.id !== saved.id)) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${dup.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
  const pdfs = all
    .filter((f: { name: string }) => f.name.startsWith(PDF_FILE_PREFIX))
    .sort((a: { createdTime: string }, b: { createdTime: string }) => Date.parse(b.createdTime) - Date.parse(a.createdTime));
  for (const stale of pdfs.slice(10)) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${stale.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }
  return { saved: true, fileId: saved.id, fileName };
}

/* Browser path: needs a linked, active staff session. */
async function handleBackupPdf(req: Request, pdfBase64: unknown, fileKey: unknown) {
  await requireActiveStaff(req);
  if (typeof pdfBase64 !== 'string' || !pdfBase64 || typeof fileKey !== 'string' || !fileKey) {
    throw new Error('Missing PDF data or file key.');
  }
  const raw = atob(pdfBase64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return await uploadPdfToDrive(bytes, fileKey);
}

/* Server path: copies a PDF that is ALREADY in the private `closing-pdfs`
   bucket to Drive. Called by the storage.objects trigger
   (drive_pdf_on_storage_upload) with the auto key, so it works no matter
   who closed the shift or whether they had a linked staff session. */
const PDF_BUCKET = 'closing-pdfs';
async function handleBackupPdfStored(autoKey: unknown, fileKey: unknown) {
  await requireBackupAuth(null, autoKey);
  if (typeof fileKey !== 'string' || !/^[A-Za-z0-9_.-]{3,100}$/.test(fileKey)) throw new Error('Bad file key.');
  const path = `${fileKey.replace(/[^A-Za-z0-9_.-]/g, '_')}.pdf`;
  const { data, error } = await admin().storage.from(PDF_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${path}: ${error?.message || 'no data'}`);
  return await uploadPdfToDrive(new Uint8Array(await data.arrayBuffer()), fileKey);
}

async function handleBackup() {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  const accessToken = await getAccessToken(row);

  /* Same four tables sync.js's pull already reads — see sync.js
     header comment for why this is the full picture of app data. */
  const client = admin();
  const [sheets, creditLedger, settings, activityLog, deleted] = await Promise.all([
    client.from('sheets').select('key, data'),
    client.from('credit_ledger').select('key, data'),
    client.from('settings').select('data').eq('id', 1).maybeSingle(),
    client.from('activity_log').select('ts, actor, key, action, changes').order('ts', { ascending: true }),
    client.from('deleted_records').select('key, deleted_at'),
  ]);
  for (const r of [sheets, creditLedger, settings, activityLog]) {
    if (r.error) throw r.error;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    settings: settings.data?.data || null,
    sheets: Object.fromEntries((sheets.data || []).map(r => [r.key, r.data])),
    creditLedger: (creditLedger.data || []).map(r => r.data),
    activityLog: activityLog.data || [],
    deletedKeys: deleted.data || [],
  };
  const body = JSON.stringify(payload, null, 2);

  /* Versioned: every JSON backup is its OWN timestamped file in the
     visible Closing Backups folder, so restore can offer real history. */
  const fileName = `${BACKUP_FILE_PREFIX}${payload.exportedAt.replace(/[:.]/g, '-')}.json`;
  const boundary = 'closingbackupboundary';
  const folderId = await getDriveFolder(accessToken);
  const metadata = { name: fileName, parents: [folderId] };
  const multipartBody =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const created = await resp.json();
  if (!resp.ok) throw new Error(`Drive create failed: ${JSON.stringify(created)}`);

  const lastBackupAt = new Date().toISOString();
  await client.from('google_drive_backup').update({ drive_file_id: created.id, last_backup_at: lastBackupAt }).eq('id', 1);

  /* Prune anything past MAX_VERSIONS_KEPT, oldest first — best-effort,
     a failed delete here shouldn't fail the backup that just succeeded. */
  try {
    const folderId = await getDriveFolder(accessToken);
    const files = (await driveFilesList(accessToken, folderId))
      .filter((f: { name: string }) => f.name.startsWith(BACKUP_FILE_PREFIX));
    const stale = files.slice(MAX_VERSIONS_KEPT);
    for (const f of stale) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  } catch (_e) { /* pruning is best-effort */ }

  return { backedUpAt: lastBackupAt };
}

async function handleListVersions() {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  const accessToken = await getAccessToken(row);
  const folderId = await getDriveFolder(accessToken);
  const files = (await driveFilesList(accessToken, folderId))
    .filter((f: { name: string }) => f.name.startsWith(BACKUP_FILE_PREFIX));
  return {
    versions: files.map((f: { id: string; name: string; createdTime: string; size?: string }) => ({
      id: f.id, name: f.name, createdTime: f.createdTime, size: f.size ? Number(f.size) : null,
    })),
  };
}

/* Replaces ALL current data (sheets, credit ledger, settings, activity
   log, deleted-record tombstones) with the contents of one backup
   file. Deliberately wholesale, mirroring how sync.js's push/pull
   already treats these four tables as one unit — a partial restore
   would leave the app in a state that was never actually saved. */
async function handleRestore(fileId: string) {
  const row = await getRow();
  if (!row?.refresh_token) throw new Error('Google Drive is not connected.');
  if (!fileId) throw new Error('Missing fileId.');
  const accessToken = await getAccessToken(row);

  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Drive download failed: ${await resp.text()}`);
  const payload = await resp.json();

  /* Delegated to Postgres functions (google_drive_backup.sql) instead
     of JS-side delete-then-insert, for two reasons found the hard way:
     1. sheets/credit_ledger need date/shift/draft/updated_at derived
        properly (NOT NULL columns) — a naive { key, data } insert
        violates those constraints and throws a Postgrest error object,
        which isn't a JS Error instance, so it was silently reported
        as generic "Unknown error" while the preceding deletes had
        already run — a real data-loss bug.
     2. Re-inserting every row after delete fires the Drive auto-backup
        trigger once per row (a storm on every restore). A transaction-
        local GUC flag (set_config(..., true)) did NOT survive through
        the PostgREST RPC boundary in this project when tested — the
        storm still happened. Explicitly disabling/re-enabling the
        trigger via DDL (admin_set_drive_trigger) is what actually works. */
  const client = admin();
  await client.rpc('admin_set_drive_trigger', { enabled: false });
  try {
    const { data, error } = await client.rpc('admin_restore_backup', { payload });
    if (error) throw error;
    return { restoredFrom: fileId, exportedAt: payload.exportedAt, counts: data };
  } finally {
    await client.rpc('admin_set_drive_trigger', { enabled: true });
  }
}

async function handleSetAutoKey(autoKey: string) {
  if (!autoKey || typeof autoKey !== 'string') throw new Error('Missing autoKey.');
  await admin().from('google_drive_backup').update({ auto_key: autoKey }).eq('id', 1);
  return { ok: true };
}

async function handleDisconnect() {
  const row = await getRow();
  if (row?.refresh_token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: row.refresh_token as string }),
      });
    } catch (_e) { /* best-effort — clearing our row below is what actually matters locally */ }
  }
  await admin().from('google_drive_backup').delete().eq('id', 1);
  return { connected: false };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null);
  }
  try {
    const { action, code, redirectUri, pin, autoKey, fileId, pdfBase64, fileKey } = await req.json();

    if (action === 'backup_pdf') return json(await handleBackupPdf(req, pdfBase64, fileKey));
    if (action === 'backup_pdf_stored') return json(await handleBackupPdfStored(autoKey, fileKey));

    if (action === 'backup') {
      await requireBackupAuth(pin, autoKey);
      return json(await handleBackup());
    }

    /* Everything else — including 'status' — is Admin-PIN only. */
    await requireAdmin(pin);

    if (action === 'status') {
      const row = await getRow();
      return json({ connected: !!row?.refresh_token, email: row?.connected_email || null, lastBackupAt: row?.last_backup_at || null });
    }
    if (action === 'oauth_callback')  return json(await handleOauthCallback(code, redirectUri));
    if (action === 'disconnect')      return json(await handleDisconnect());
    if (action === 'list_versions')   return json(await handleListVersions());
    if (action === 'restore')         return json(await handleRestore(fileId));
    if (action === 'set_auto_key')    return json(await handleSetAutoKey(autoKey));

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    if (err instanceof Response) return err; /* thrown by requireAdmin() — already a proper 403 */
    console.error('[google-drive]', err);
    /* Postgrest errors are plain objects, not Error instances — surface
       their actual fields instead of a generic message so failures are
       diagnosable from the response alone. */
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === 'object')
        ? JSON.stringify(err)
        : String(err);
    return json({ error: message }, 500);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  let res: Response;
  try { res = await handle(req); } catch (e) { if (e instanceof Response) res = e; else throw e; }
  for (const [k, v] of Object.entries(cors(req))) res.headers.set(k, v);
  return res;
});
