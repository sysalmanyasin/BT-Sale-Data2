// Web-security guardrails that are cheap to keep true: no inline scripts (so a strict script CSP is possible),
// a CSP that covers every script host, and no wildcard CORS on edge functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const scriptSrc = (csp.match(/script-src([^;]*)/) || [, ''])[1].trim().split(/\s+/);

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

test('index.html has no inline <script> bodies', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim());
  assert.equal(inline.length, 0, 'move inline scripts to files under js/ (CSP forbids them)');
});

test('CSP meta exists, forbids unsafe-inline/unsafe-eval for scripts and plugins', () => {
  assert.ok(csp, 'Content-Security-Policy meta tag missing');
  assert.ok(scriptSrc.includes("'self'"));
  assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"));
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
});

test('every external script host used by index.html or loaded at runtime is allowed by the CSP', () => {
  const hosts = new Set();
  for (const m of html.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"/]+)/g)) hosts.add(m[1]);
  for (const f of walk('js').filter((x) => x.endsWith('.js'))) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    for (const m of s.matchAll(/(?:\.src\s*=\s*|script\.src\s*=\s*)['"](https?:\/\/[^'"/]+)/g)) hosts.add(m[1]);
  }
  const missing = [...hosts].filter((h) => !scriptSrc.includes(h));
  assert.deepEqual(missing, [], 'add these hosts to script-src in index.html');
});

test('edge functions never answer with Access-Control-Allow-Origin: *', () => {
  const bad = walk('supabase/functions').filter((f) => /\.(ts|js)$/.test(f))
    .filter((f) => /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(bad, [], 'use the origin allowlist (see supabase/functions/bt-agent) instead of *');
});
