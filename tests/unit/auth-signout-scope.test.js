// Signing out on one device must not end the session on the other devices.
// supabase-js signOut() defaults to scope 'global'; the app's header Sign Out must ask for 'local'.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../js/auth.js', import.meta.url), 'utf8');
const body = /function gauthSignOut\(\) \{([\s\S]*?)\n\}/.exec(src)[1];
test('gauthSignOut signs out locally on both Supabase clients', () => {
  const calls = body.match(/\.auth\.signOut\([^)]*\)/g) || [];
  assert.equal(calls.length, 2);
  calls.forEach((c) => assert.match(c, /scope:\s*'local'/));
});
test('the explicit "sign out everywhere" action is still global', () => {
  assert.match(src, /signOut\(\{ scope: 'global' \}\)/);
});
