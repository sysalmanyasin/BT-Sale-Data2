// Guardrail: the Supabase URL + public anon key live in exactly ONE client module
// (js/shared/backend-config.js). Pasting them into new files re-creates the 8-copy
// drift problem, so fail fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const ALLOWED = new Set(['js/shared/backend-config.js']);

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('js/ has no hardcoded Supabase anon JWT outside backend-config.js', () => {
  const offenders = walk('js')
    .filter((f) => !ALLOWED.has(f))
    .filter((f) => /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, [], 'import SUPABASE_ANON_KEY from js/shared/backend-config.js instead');
});

test('js/ has no hardcoded Supabase project URL outside backend-config.js', () => {
  const offenders = walk('js')
    .filter((f) => !ALLOWED.has(f))
    .filter((f) => /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, [], 'import SUPABASE_URL from js/shared/backend-config.js instead');
});

test('js/ has no hardcoded Audit Hub publishable key outside backend-config.js', () => {
  const offenders = walk('js')
    .filter((f) => !ALLOWED.has(f))
    .filter((f) => /sb_publishable_[A-Za-z0-9_-]{20,}/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('backend-config.js is a leaf module (cannot join an import cycle)', () => {
  const s = readFileSync(join(ROOT, 'js/shared/backend-config.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(s));
  assert.ok(!/service_role|sb_secret_/i.test(s.replace(/\/\/.*$/gm, '')), 'no secret keys allowed');
});

test('backend-config.js is precached in the service worker app shell', () => {
  assert.ok(readFileSync(join(ROOT, 'sw.js'), 'utf8').includes('js/shared/backend-config.js'));
});
