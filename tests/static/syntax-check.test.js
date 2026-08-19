// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — every shipped JS file is at least syntactically valid.
//
// This is the cheapest possible smoke test and deliberately the widest:
// it won't catch logic bugs, but it guarantees nothing in js/, the
// Supabase Edge Function, or sw.js/index.html-adjacent scripts has a
// stray bracket, leftover merge-conflict marker, or copy-paste typo
// that would 500/white-screen the whole app.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const jsFiles = collectJsFiles(path.join(REPO_ROOT, 'js'));
jsFiles.push(path.join(REPO_ROOT, 'sw.js'));

describe('JS syntax validity (smoke)', () => {
  test('sanity check: found a substantial number of JS files to check', () => {
    assert.ok(jsFiles.length > 50, `expected 50+ js files under js/, found ${jsFiles.length}`);
  });

  for (const file of jsFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    test(`${relPath} parses without a syntax error`, () => {
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      }, `node --check failed for ${relPath}`);
    });
  }
});
