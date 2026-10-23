// auth.js is an ES module and the ONLY way into the app is a verified Google sign-in.
//  - unlockApp is private (not on window, not patchable) and announces itself via 'bt:app-unlocked'
//  - a saved session alone never opens the app: it needs a live Supabase session for the same allowed email
//  - there is no sign-in-free entry (the old #pos kiosk bypass is gone)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SESS = 'bt_gauth_session';
let n = 0, w, initCalls, unlockedEvents;

async function boot({ hash = '', session = null, sbSession = null, emails = 'owner@example.com' } = {}) {
  const dom = new JSDOM(`<div id="pin-gate" style="display:flex"></div><div id="nav" style="display:none"></div>
    <div id="gauth-setup"></div><div id="gauth-main"></div><div id="gauth-btn-wrap" style="display:none"></div>
    <div id="gauth-user-bar"></div><div id="gauth-error"></div><div id="page-emergency-billing" class="page"></div>`,
    { url: 'https://bt.example.com/' + hash, pretendToBeVisual: true });
  w = dom.window;
  w.localStorage.setItem('bt_gauth_emails', emails);
  if (session) w.localStorage.setItem(SESS, JSON.stringify({ ...session, exp: Date.now() + 1e9 }));
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true });
  globalThis.addEventListener = w.addEventListener.bind(w);
  globalThis.CustomEvent = w.CustomEvent;
  globalThis.fetch = async () => { throw new Error('offline'); };
  globalThis.Repository = { getItem: (k) => w.localStorage.getItem(k) };
  globalThis.Actions = { saveFeatureData: (k, v) => w.localStorage.setItem(k, v), clearFeatureData: (k) => w.localStorage.removeItem(k) };
  globalThis._driveAccessToken = '';
  globalThis._driveSilentReauth = async () => '';
  initCalls = 0; unlockedEvents = 0;
  globalThis.initApp = () => { initCalls++; };
  globalThis.idbLoadData = () => new Promise(() => {});
  globalThis.ghCfg = () => null;
  globalThis.showPage = (id) => w.document.getElementById('page-' + id)?.classList.add('on');
  w.addEventListener('bt:app-unlocked', () => { unlockedEvents++; });
  w.btGetSupabaseClient = () => ({ auth: {
    getSession: async () => ({ data: { session: sbSession }, error: null }),
    signOut: async () => ({}) } });
  await import(`../../js/auth.js?case=${++n}`);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 30));
}
const unlocked = () => w.document.getElementById('nav').style.display === 'flex';
beforeEach(() => { w?.close?.(); });

test('auth.js is loaded as an ES module', () => {
  assert.match(read('index.html'), /<script type="module" src="js\/auth\.js\?v=[0-9a-f]{8}"><\/script>/);
});

test('unlockApp / initAutoRefresh are private: not on window, not patchable', async () => {
  await boot();
  assert.equal(w.unlockApp, undefined);
  assert.equal(w.initAutoRefresh, undefined);
  assert.equal(typeof w.lockApp, 'function');
});

test('no sign-in, no session -> app stays locked and Google button shown', async () => {
  await boot();
  assert.equal(unlocked(), false);
  assert.equal(initCalls, 0);
  assert.equal(w.document.getElementById('gauth-btn-wrap').style.display, 'flex');
});

test('forged localStorage session without a Supabase session does NOT unlock, and is discarded', async () => {
  await boot({ session: { email: 'owner@example.com', name: 'x' }, sbSession: null });
  assert.equal(unlocked(), false);
  assert.equal(initCalls, 0);
  assert.equal(w.localStorage.getItem(SESS), null);
});

test('Supabase session for a DIFFERENT email than the saved one does not unlock', async () => {
  await boot({ session: { email: 'owner@example.com' }, sbSession: { user: { email: 'other@example.com' } } });
  assert.equal(unlocked(), false);
});

test('saved email no longer on the allow-list does not unlock', async () => {
  await boot({ session: { email: 'owner@example.com' }, sbSession: { user: { email: 'owner@example.com' } }, emails: 'someone@else.com' });
  assert.equal(unlocked(), false);
});

test('verified Supabase session for the same allowed email unlocks once and announces it', async () => {
  await boot({ session: { email: 'owner@example.com' }, sbSession: { user: { email: 'Owner@Example.com' } } });
  assert.equal(unlocked(), true);
  assert.equal(initCalls, 1);
  assert.equal(unlockedEvents, 1);
});

test('the old #pos kiosk bypass is gone: #pos shows nothing without sign-in', async () => {
  await boot({ hash: '#pos' });
  assert.equal(unlocked(), false);
  assert.equal(w.document.getElementById('pin-gate').style.display, 'flex');
  assert.equal(w.document.body.classList.contains('bt-kiosk-mode'), false);
  assert.equal(w.document.getElementById('page-emergency-billing').classList.contains('on'), false);
});

test('"Continue as this account" cannot open the app without a verified session', async () => {
  await boot();
  w.gauthConfirmUser();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(unlocked(), false);
  assert.equal(initCalls, 0);
});

test('source: no kiosk code, no unlockApp on window, drive.js listens instead of patching', () => {
  const auth = stripComments(read('js/auth.js'));
  assert.doesNotMatch(auth, /kiosk|_isKioskHash|_enterKioskMode/i);
  assert.doesNotMatch(auth, /window\.unlockApp|window\.initAutoRefresh/);
  const drive = stripComments(read('js/drive.js'));
  assert.doesNotMatch(drive, /unlockApp\s*=/);
  assert.match(drive, /addEventListener\('bt:app-unlocked'/);
  assert.doesNotMatch(read('css/emergency-billing.css') + read('css/agent.css'), /bt-kiosk-mode/);
});

test('every previously-bridged sign-in/out global still exposed', () => {
  const auth = stripComments(read('js/auth.js'));
  for (const g of ['gauthShowMain', '_gauthOAuthSignIn', '_driveSilentReauth', 'gauthConfirmUser', 'gauthSignOut',
    'gauthSignOutAllDevices', 'tcSaveGAuthSettings', 'tcClearGAuthSession', 'tcClearGAuthAll', '_tcLoadGAuthStatus', 'lockApp', 'btEstablishSupabaseSessions'])
    assert.match(auth, new RegExp(`window\\.${g}\\s*=`), g);
});
