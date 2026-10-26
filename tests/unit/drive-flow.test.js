// Drive backup FLOW tests against an in-memory fake Google Drive (no network):
// backup + read-back verification, corruption detection, shrink guard, weekly drill (writes nothing live).
import { test, beforeEach, after } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
import { loadClassicScript } from '../helpers/load-classic-script.js';

let drive, store, logs;
const windows = []; // every jsdom window created (one per test) — all must be closed or their timers keep Node alive
const ISO = n => new Date(Date.now() - n * 3600e3).toISOString();
const mkDays = n => Array.from({ length: n }, (_, i) => ({ Date: `${String(i % 28 + 1).padStart(2, '0')}/Oct/2026`, Month_Year: `M${Math.floor(i / 28)}` }));

function setup({ liveDays = 40, token = true } = {}) {
  installDomEnv();
  const w = window; windows.push(w);
  store = new Map(); logs = [];
  if (token) w.localStorage.setItem('bt_drive_token_cache', JSON.stringify({ token: 'tok', exp: Date.now() + 1e7 }));
  const DAILY = mkDays(liveDays), MONTHLY = [{ Month_Year: 'M0' }, { Month_Year: 'M1' }, { Month_Year: 'M2' }];
  Object.assign(w, {
    DAILY, MONTHLY, STAFF: [{ id: 's1' }], MGR_KEY: 'mgr', CSEC_KEY: 'csec', JC_KEY: 'jc', JC_TALLY_KEY: 'jct',
    LEDGER_KEY: 'led', LEDGER_CUSTOM_TYPES_KEY: 'ledt', toast: () => {}, unlockApp() {},
    idbSaveData: async () => {}, confirm: () => true,
    Repository: {
      getItem: k => w.localStorage.getItem(k), setItem: (k, v) => w.localStorage.setItem(k, v),
      getKeysByPrefix: p => Object.keys(w.localStorage).filter(k => k.startsWith(p)),
      gapFillDaily: () => ({ added: 0 }), gapFillMonthly: () => ({ added: 0 }), gapFillStaff: () => ({ added: 0 })
    },
    Actions: { saveFeatureData: (k, v) => w.localStorage.setItem(k, v) }
  });
  w.document.body.innerHTML = '<div id="drive-log"></div><div id="drive-health"></div>';
  // fake Drive
  const files = new Map(); let nextId = 1; drive = { files, corruptDownloads: false, uploads: 0 };
  const res = (body, ok = true, status = 200) => ({ ok, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
  w.fetch = async (url, opt = {}) => {
    url = String(url);
    if (url.includes('/upload/drive/v3/files')) {
      drive.uploads++;
      const text = await opt.body.get('file').text();
      const id = (url.match(/files\/([^?]+)\?/) || [])[1] || 'f' + nextId++;
      const name = JSON.parse(await opt.body.get('metadata').text()).name || (files.get(id) || {}).name;
      files.set(id, { id, name, text, modifiedTime: new Date().toISOString() });
      return res({ id });
    }
    if (url.includes('alt=media')) {
      const f = files.get(url.match(/files\/([^?]+)\?/)[1]);
      if (!f) return res({}, false, 404);
      return { ok: true, status: 200, json: async () => JSON.parse(drive.corruptDownloads ? f.text.slice(0, f.text.length / 2) : f.text) };
    }
    const q = decodeURIComponent(url);
    const nm = /name='([^']+)'/.exec(q);
    const list = [...files.values()].filter(f => nm ? f.name === nm[1] : f.name.startsWith('BT-Sales-Backup'))
      .sort((a, b) => b.name.localeCompare(a.name));
    return res({ files: list.map(f => ({ id: f.id, name: f.name, size: f.text.length, modifiedTime: f.modifiedTime })) });
  };
  loadClassicScript('js/platform/drive.js', w);
  const origLog = w.driveLog; w.driveLog = (m, c) => { logs.push([c || '', m]); origLog(m, c); };
  return w;
}
const rec = k => JSON.parse(window.localStorage.getItem(k));
after(() => { windows.forEach(w => { try { w.close(); } catch (e) {} }); });

beforeEach(() => setup());

test('backup uploads, reads the file back and records a verified result', async () => {
  const ok = await window.driveBackupNow(false);
  assert.equal(ok, true);
  const v = rec('bt_drive_verify_v1');
  assert.equal(v.ok, true);
  assert.equal(v.counts.days, 40);
  assert.equal(window.localStorage.getItem('bt_drive_last_backup'), window.DriveVerify.today());
  const saved = JSON.parse([...drive.files.values()][0].text);
  assert.equal(saved.formatVersion, 2);
  assert.equal(saved.staff.length, 1, 'staff registry is now part of the backup');
  assert.match(window.document.getElementById('drive-health').textContent, /Backup verified/);
});

test('a backup that cannot be read back intact is NOT marked good', async () => {
  drive.corruptDownloads = true;
  const ok = await window.driveBackupNow(false);
  assert.equal(ok, false);
  assert.equal(rec('bt_drive_verify_v1').ok, false);
  assert.equal(window.localStorage.getItem('bt_drive_last_backup'), null, 'auto-backup will retry');
  assert.match(window.document.getElementById('drive-health').textContent, /FAILED/);
});

test('auto-backup refuses to overwrite a bigger same-day backup with much smaller data', async () => {
  assert.equal(await window.driveBackupNow(false), true);        // 40 days stored
  const before = [...drive.files.values()][0].text;
  window.DAILY.length = 5;                                       // live data suddenly tiny (e.g. failed load)
  const ok = await window.driveBackupNow(true);
  assert.equal(ok, false);
  assert.equal([...drive.files.values()][0].text, before, 'good file untouched');
  assert.match(rec('bt_drive_verify_v1').problems[0], /did not overwrite/);
});

test('empty app state never produces a backup', async () => {
  window.DAILY.length = 0; window.MONTHLY.length = 0;
  assert.equal(await window.driveBackupNow(true), false);
  assert.equal(drive.uploads, 0);
});

test('weekly drill passes on a fresh good backup and writes nothing to live data', async () => {
  await window.driveBackupNow(false);
  const liveBefore = JSON.stringify([window.DAILY, window.MONTHLY, window.STAFF]);
  assert.equal(await window.driveRunDrill(true), true);
  const d = rec('bt_drive_drill_v1');
  assert.equal(d.ok, true); assert.equal(d.counts.days, 40); assert.equal(d.wouldAdd.days, 0);
  assert.equal(JSON.stringify([window.DAILY, window.MONTHLY, window.STAFF]), liveBefore);
});

test('drill FAILS when the newest backup is stale, truncated, or missing data', async () => {
  await window.driveBackupNow(false);
  const f = [...drive.files.values()][0];
  f.modifiedTime = ISO(50);                                      // 50 h old
  assert.equal(await window.driveRunDrill(true), false);
  assert.match(rec('bt_drive_drill_v1').problems.join(' '), /old/);
  f.modifiedTime = ISO(1); drive.corruptDownloads = true;
  assert.equal(await window.driveRunDrill(true), false);
  assert.match(rec('bt_drive_drill_v1').problems.join(' '), /could not complete/i);
  drive.corruptDownloads = false;
  window.DAILY.push(...mkDays(200));                             // live grew far beyond the backup
  assert.equal(await window.driveRunDrill(true), false);
  assert.match(rec('bt_drive_drill_v1').problems.join(' '), /missing data/);
});

test('drill reports a clear failure when the folder has no backups', async () => {
  assert.equal(await window.driveRunDrill(true), false);
  assert.match(rec('bt_drive_drill_v1').problems[0], /No backups found/);
});
