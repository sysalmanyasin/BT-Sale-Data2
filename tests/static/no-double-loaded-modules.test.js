// A module listed as <script type="module" src="x.js?v=hash"> in index.html AND imported bare (`./x.js`) by another module
// is loaded TWICE by the browser (different URLs = different module copies). The 35 below already behave that way and
// are written to tolerate it; any NEW entry+imported module would silently run its load-time side effects twice
// (that is how a patched calcTotal got applied twice and doubled custom-field totals).
// To depend on a module that is an index.html entry, use its window bridge, or remove it from index.html first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const ALLOWED = new Set([
  "js/audit/audit-bridge.js",
  "js/closing/closing-bridge.js",
  "js/closing/closing-ledger-marks.js",
  "js/emergency-billing/emergency-billing-bridge.js",
  "js/herald/herald-engine.js",
  "js/inventory/inventory-bridge.js",
  "js/ledger/ledger-actions.js",
  "js/ledger/ledger-quick-add.js",
  "js/ledger/ledger-store.js",
  "js/lib/bt-date.js",
  "js/lib/bt-format.js",
  "js/lib/bt-search.js",
  "js/lib/print.js",
  "js/lib/rules-engine.js",
  "js/manager/attendance-bridge.js",
  "js/manager/manager-credit.js",
  "js/manager/manager-generic.js",
  "js/manager/manager-incentive.js",
  "js/manager/manager-petty.js",
  "js/manager/manager-reports.js",
  "js/manager/manager-salary.js",
  "js/manager/manager-shared.js",
  "js/manager/manager-staff.js",
  "js/manager/manager-unmatched.js",
  "js/manager/staff-notes.js",
  "js/platform/actions.js",
  "js/platform/config.js",
  "js/platform/event-bus.js",
  "js/platform/repository.js",
  "js/platform/sync-tombstones.js",
  "js/sales/analytics.js",
  "js/sales/sale-payments-bridge.js",
  "js/sales/targets.js",
  "js/shared/dom-actions.js",
  "js/str/str-bridge.js"
]);

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const entries = new Set([...html.matchAll(/<script\s+type="module"\s+src="([^"?]+)/g)].map((m) => m[1]));
const EDGE = /^\s*(?:import|export)[^'";]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm;
const imported = new Map();
for (const f of walk('js')) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(EDGE)) {
    const t = normalize(join(dirname(f), m[1] || m[2])).replace(/\\/g, '/');
    if (!imported.has(t)) imported.set(t, new Set());
    imported.get(t).add(f);
  }
}

test('no new module is both an index.html entry and imported by another module', () => {
  const fresh = [...entries].filter((e) => imported.has(e) && !ALLOWED.has(e))
    .map((e) => `${e} (imported by ${[...imported.get(e)].join(', ')})`);
  assert.deepEqual(fresh, [], 'these would be evaluated twice in a browser; see the comment at the top of this file');
});

test('the allowlist only lists modules that still need it', () => {
  const stale = [...ALLOWED].filter((e) => !(entries.has(e) && imported.has(e)));
  assert.deepEqual(stale, [], 'remove these from ALLOWED');
});
