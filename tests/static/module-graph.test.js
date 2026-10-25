// Architecture guardrails for a codebase meant to grow ~100x:
//  1. No static import cycles under js/ (a cycle makes load order — and bugs — order-dependent).
//  2. One HTML-escape implementation (js/shared/html.js); no private copies.
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

// Static edges only (import/export ... from, side-effect import). Lazy import() is not a load-time cycle.
const EDGE = /^\s*(?:import|export)[^'";]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm;
const graph = new Map(files.map((f) => {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const deps = new Set();
  for (const m of src.matchAll(EDGE)) {
    const target = normalize(join(dirname(f), m[1] || m[2])).replace(/\\/g, '/');
    if (known.has(target)) deps.add(target);
  }
  return [f, [...deps]];
}));

function stronglyConnected() {
  let idx = 0; const I = new Map(), L = new Map(), on = new Set(), stack = [], out = [];
  const visit = (v) => {
    I.set(v, idx); L.set(v, idx); idx++; stack.push(v); on.add(v);
    for (const w of graph.get(v) || []) {
      if (!I.has(w)) { visit(w); L.set(v, Math.min(L.get(v), L.get(w))); }
      else if (on.has(w)) L.set(v, Math.min(L.get(v), I.get(w)));
    }
    if (L.get(v) === I.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp.sort());
    }
  };
  for (const f of files) if (!I.has(f)) visit(f);
  return out;
}

test('js/ has no static import cycles', () => {
  assert.deepEqual(stronglyConnected(), [], 'break the cycle: move shared pieces into a leaf module or use a hook/event');
});

test('HTML escaping has a single implementation (js/shared/html.js)', () => {
  const DEF = /(?:function\s+(?:esc|_esc|escHtml|escapeHtml|escapeHTML|_mgrEsc)\s*\(|(?:const|let|var)\s+(?:esc|_esc|escHtml|escapeHtml|escapeHTML|_mgrEsc)\s*=\s*(?:\(?\s*[a-z_]+\s*\)?\s*=>|function))/;
  const offenders = files.filter((f) => f !== 'js/shared/html.js' && DEF.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, [], "import { escapeHtml } from 'shared/html.js' instead of redefining it");
});

test('shared/html.js is a leaf and escapes quotes (safe for attributes)', async () => {
  const src = readFileSync(join(ROOT, 'js/shared/html.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src));
  const { escapeHtml } = await import('../../js/shared/html.js');
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('shared/html.js is precached by the service worker', () => {
  assert.ok(readFileSync(join(ROOT, 'sw.js'), 'utf8').includes('js/shared/html.js'));
});
