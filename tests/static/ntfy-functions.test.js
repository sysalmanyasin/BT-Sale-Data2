// Guards for the ntfy functions that now live in the repo (the repo is PUBLIC).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const fnDir = path.join(root, 'supabase/functions');
const briefing = fs.readFileSync(path.join(fnDir, 'send-daily-ntfy-briefing/index.ts'), 'utf8');
const closing = fs.readFileSync(path.join(fnDir, 'closing-ntfy-notify/index.ts'), 'utf8');

function sourcesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourcesIn(p) : (/\.(ts|js|md)$/.test(e.name) ? [p] : []);
  });
}

describe('briefing: the official sale is TOTAL', () => {
  test('saleOf reads TOTAL only (COMP SALE is no longer used to compute the sale)', () => {
    assert.match(briefing, /const saleOf = \(x: any\) => num\(x\["TOTAL"\]\);/);
    assert.ok(!/num\(x\["COMP SALE"\]\)/.test(briefing));
    assert.match(briefing, /v20: "Sale" is now the day's TOTAL/);
  });
  test('alert thresholds match the in-app briefing', () => {
    assert.match(briefing, /Math\.abs\(diff\) >= 10000/);
    assert.match(briefing, /sale < saleOf\(wk\.x\) \* 0\.7/);
    assert.match(briefing, /ld >= 10 && projected < target \* 0\.9/);
    const app = fs.readFileSync(path.join(root, 'js/agent/tools/briefing.js'), 'utf8');
    assert.match(app, /Math\.abs\(diffV\) >= 10000/); assert.match(app, /\* 0\.7/); assert.match(app, /lastDay >= 10/);
  });
  test('requires the cron secret header and supports a dry run', () => {
    assert.match(briefing, /req\.headers\.get\("x-cron-secret"\) !== secret/);
    assert.match(briefing, /searchParams\.get\("dry"\) === "1"/);
  });
});

describe('closing alerts: no built-in topic in a public repo', () => {
  test('topic comes only from the NTFY_CLOSING_TOPIC secret and the function fails closed', () => {
    assert.match(closing, /const NTFY_TOPIC\s+= Deno\.env\.get\("NTFY_CLOSING_TOPIC"\) \?\? "";/);
    assert.match(closing, /if \(!NTFY_TOPIC\) return new Response/);
  });
});

describe('no secrets in function sources (the repo is public)', () => {
  const files = sourcesIn(fnDir);
  test('no ntfy topic names, cron/shared secrets or private keys', () => {
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(!/bt-closing-[A-Za-z0-9]{8,}/.test(text), 'closing topic leaked in ' + f);
      assert.ok(!/bt-attendance-[A-Za-z0-9-]{8,}/.test(text), 'attendance topic leaked in ' + f);
      assert.ok(!/(x-cron-secret|cron_secret|notify_shared_secret)['"]?\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i.test(text), 'secret literal in ' + f);
      assert.ok(!/sb_secret_[A-Za-z0-9_-]{10,}|service_role['"]?\s*[:=]\s*['"]eyJ/.test(text), 'service key in ' + f);
    }
  });
});

describe('set-staff-login requires a signed-in authorised user', () => {
  const ssl = fs.readFileSync(path.join(fnDir, 'set-staff-login/index.ts'), 'utf8');
  const cfg = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  test('rejects missing / invalid sessions and non-authorised emails before touching any account', () => {
    const authAt = ssl.indexOf('auth.getUser(token)');
    assert.ok(authAt > 0, 'must verify the session');
    assert.match(ssl, /return json\(\{ error: 'Not signed in' \}, 401\)/);
    assert.match(ssl, /return json\(\{ error: 'Invalid session' \}, 401\)/);
    assert.match(ssl, /from\('bt_authorized_users'\)[\s\S]*?\.eq\('active', true\)/);
    assert.match(ssl, /return json\(\{ error: 'Not authorised' \}, 403\)/);
    // the auth gate must come BEFORE any account is created or changed
    for (const op of ['createUser', 'updateUserById', "from('staff_auth_link')", "from('bt_staff')"]) {
      assert.ok(ssl.indexOf(op) > authAt, op + ' must come after the auth check');
    }
  });
  test('config pins it (jwt off, auth in code) and Drive backup (jwt on)', () => {
    assert.match(cfg, /\[functions\.set-staff-login\]\s*\nverify_jwt = false/);
    assert.match(cfg, /\[functions\.google-drive\]\s*\nverify_jwt = true/);
  });
});

describe('google-drive keeps every action behind the Admin PIN', () => {
  const gd = fs.readFileSync(path.join(fnDir, 'google-drive/index.ts'), 'utf8');
  test('only "backup" may use the auto key; all other actions call requireAdmin first', () => {
    const backupAt = gd.indexOf("if (action === 'backup')");
    const adminAt = gd.indexOf('await requireAdmin(pin);', backupAt);
    assert.ok(backupAt > 0 && adminAt > backupAt);
    for (const a of ['status', 'oauth_callback', 'disconnect', 'list_versions', 'restore', 'set_auto_key']) {
      assert.ok(gd.indexOf("action === '" + a + "'") > adminAt, a + ' must be behind requireAdmin');
    }
    assert.match(gd, /Deno\.env\.get\('GOOGLE_CLIENT_SECRET'\)/);
  });
});
