// Domain boundaries for a codebase meant to scale ~100x in modules.
//
// Layers (low -> high):   shared/  <  core (js/*.js)  <  domains (js/<domain>/)
//   1. shared/ imports only shared/.
//   2. core imports only core + shared/ — never a feature domain.
//   3. Domain -> domain imports are a deliberate, reviewed list (ALLOWED_DOMAIN_LINKS).
//      A NEW link fails this test: either route the dependency through shared/ or core, or add the
//      pair below in the same PR so the coupling is visible in review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
}
const files = walk('js');
const known = new Set(files);
const domainOf = (f) => { const p = f.split('/'); return p.length === 2 ? 'core' : p[1]; };
const EDGE = /^\s*(?:import|export)[^'";]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm;

const edges = []; // { from, to, a, b }
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(EDGE)) {
    const to = normalize(join(dirname(f), m[1] || m[2])).replace(/\\/g, '/');
    if (known.has(to)) edges.push({ from: f, to, a: domainOf(f), b: domainOf(to) });
  }
}

// Reviewed domain->domain links as of the Phase 3 restructure. Shrink this list over time; do not grow it casually.
const ALLOWED_DOMAIN_LINKS = new Set([
  'agent->ai-center', 'agent->ledger', 'agent->manager', 'agent->str',
  'ai-center->agent',
  'closing->ledger',
  'cover->audit', 'cover->closing', 'cover->inventory', 'cover->ledger', 'cover->sales', 'cover->str',
  'herald->audit', 'herald->closing', 'herald->inventory', 'herald->manager',
  'ledger->closing', 'ledger->manager',
  'mail->agent',
  'sheets->inventory', 'sheets->manager',
]);

test('shared/ depends only on shared/', () => {
  const bad = edges.filter((e) => e.a === 'shared' && e.b !== 'shared').map((e) => `${e.from} -> ${e.to}`);
  assert.deepEqual(bad, []);
});

test('core (js/*.js) never imports a feature domain', () => {
  const bad = edges.filter((e) => e.a === 'core' && e.b !== 'core' && e.b !== 'shared').map((e) => `${e.from} -> ${e.to}`);
  assert.deepEqual(bad, [], 'core must stay below the domains; invert with a hook/event or move the shared piece to shared/');
});

test('domain -> domain imports stay within the reviewed list', () => {
  const bad = new Set();
  for (const e of edges) {
    if (e.a === e.b || e.b === 'core' || e.b === 'shared' || e.a === 'core' || e.a === 'shared') continue;
    if (!ALLOWED_DOMAIN_LINKS.has(`${e.a}->${e.b}`)) bad.add(`${e.a}->${e.b}  (${e.from} -> ${e.to})`);
  }
  assert.deepEqual([...bad], [], 'new cross-domain coupling: route via shared/core, or add the pair to ALLOWED_DOMAIN_LINKS deliberately');
});

test('every domain folder is documented (js/<domain>/README.md)', () => {
  const domains = [...new Set(files.map(domainOf))].filter((d) => d !== 'core' && d !== 'shared');
  const missing = domains.filter((d) => { try { statSync(join(ROOT, 'js', d, 'README.md')); return false; } catch { return true; } });
  assert.deepEqual(missing, [], 'add a short README.md describing the domain and its public entry points');
});
