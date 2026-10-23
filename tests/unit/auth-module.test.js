// auth.js is an ES module. drive.js reassigns the global `unlockApp` to add auto-backup after
// unlock, so auth.js must (a) put unlockApp on window and (b) only ever call window.unlockApp()
// — a direct call to the module-local binding would silently bypass drive.js's patch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const auth = read('js/auth.js');
const html = read('index.html');
const code = auth.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('auth.js is loaded as an ES module', () => {
  assert.match(html, /<script type="module" src="js\/auth\.js\?v=[0-9a-f]{8}"><\/script>/);
});
test('unlockApp and initAutoRefresh are bridged onto window', () => {
  assert.match(code, /window\.unlockApp\s*=\s*unlockApp;/);
  assert.match(code, /window\.initAutoRefresh\s*=\s*initAutoRefresh;/);
});
test('every unlockApp() call goes through window so drive.js patch applies', () => {
  const calls = [...code.matchAll(/(?<![\w$.])unlockApp\s*\(/g)];
  assert.equal(calls.length, 1, 'only the function declaration may mention bare unlockApp(');
  assert.match(code, /function unlockApp\(\)/);
});
test('drive.js still patches the global unlockApp', () => {
  assert.match(read('js/drive.js'), /unlockApp\s*=\s*function/);
});
test('previously-bridged auth globals still exposed', () => {
  for (const n of ['gauthShowMain', '_gauthOAuthSignIn', '_driveSilentReauth', 'gauthConfirmUser', 'gauthSignOut',
    'gauthSignOutAllDevices', 'tcSaveGAuthSettings', 'tcClearGAuthSession', 'tcClearGAuthAll', '_tcLoadGAuthStatus', 'lockApp', 'btEstablishSupabaseSessions'])
    assert.match(code, new RegExp(`window\\.${n}\\s*=`), n);
});
