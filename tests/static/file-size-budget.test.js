// Size budget: new JS files stay small; the few large legacy files may not grow. Split a file, then lower its cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const DEFAULT_MAX = 1000;
// path -> current maximum line count. Only ever lower these.
const LEGACY_CAPS = {
  'js/cover/cover-dashboard.js': 1993,
  'js/emergency-billing/emergency-billing-native.js': 1460,
  'js/ai-center/ui.js': 1324,
  'js/inventory/stockledger.js': 1223,
  'js/platform/sync-center.js': 1148,
  'js/closing/closing-native.js': 1090,
  'js/inventory/reorder-report.js': 1072,
};
const lineCount = (f) => (readFileSync(join(ROOT, f), 'utf8').match(/\n/g) || []).length; // same as `wc -l`
function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('no JS file exceeds its line budget', () => {
  const over = [];
  for (const f of walk('js')) {
    const lines = lineCount(f);
    const cap = LEGACY_CAPS[f] ?? DEFAULT_MAX;
    if (lines > cap) over.push(`${f}: ${lines} lines > ${cap}`);
  }
  assert.deepEqual(over, [], 'split the file by responsibility (do not raise the cap)');
});

test('legacy caps stay honest (a cap above the real size must be lowered)', () => {
  const loose = Object.entries(LEGACY_CAPS).filter(([f, cap]) => cap - lineCount(f) > 25);
  assert.deepEqual(loose.map(([f]) => f), []);
});

test('there are no loose files directly under js/ (everything lives in a layer or a domain)', () => {
  const loose = readdirSync(join(ROOT, 'js')).filter((n) => n.endsWith('.js'));
  assert.deepEqual(loose, []);
});
