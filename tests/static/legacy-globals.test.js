// Ratchet for implicit globals. Unknown globals are a lint ERROR; the known ones are listed in
// config/legacy-globals.mjs and that list may only shrink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_GLOBALS, LEGACY_GROUPS } from '../../config/legacy-globals.mjs';
import eslintConfig from '../../eslint.config.js';

const ROOT = new URL('../../', import.meta.url).pathname;
// Lower this number whenever you retire a legacy global. Never raise it.
// (166 = the 165 left after the explicit-import pass + _fmCustom, which analytics.js must read lazily because
// importing fields.js would pull DOM side effects into that pure-calculation module.)
const LEGACY_GLOBAL_BUDGET = 166;

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('no-undef is an error, not a warning', () => {
  const rules = eslintConfig.find((c) => c.rules && 'no-undef' in c.rules).rules;
  assert.equal(rules['no-undef'], 'error');
});

test('legacy global registry only shrinks', () => {
  const n = Object.keys(LEGACY_GLOBALS).length;
  assert.ok(n <= LEGACY_GLOBAL_BUDGET, `registry has ${n} names, budget is ${LEGACY_GLOBAL_BUDGET}: new implicit globals are not allowed; import explicitly`);
  const all = Object.values(LEGACY_GROUPS).flat();
  assert.equal(new Set(all).size, all.length, 'a name is listed twice');
});

test('every registered legacy global is still referenced somewhere (the list cannot rot)', () => {
  const src = walk('js').map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const stale = Object.keys(LEGACY_GLOBALS).filter((name) => !new RegExp('(^|[^\\w$.])' + name.replace(/\$/g, '\\$') + '(?![\\w$])').test(src));
  assert.deepEqual(stale, [], 'remove these from config/legacy-globals.mjs and lower LEGACY_GLOBAL_BUDGET');
});
