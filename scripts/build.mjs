// BUILD / RELEASE STAMP  (npm run build  |  npm run build:check)
//
// The app is served straight from the repo root (GitHub Pages), as classic + module scripts that
// depend on load order, so nothing is bundled or minified. What this script automates is the manual
// release discipline from README ("bump CACHE_NAME and ?v= when shipped files change"):
//
//   1. Every local <script src> / <link rel=stylesheet href> in index.html gets ?v=<8-char content hash>.
//   2. A single content hash is computed over index.html + every file in sw.js APP_SHELL (sw.js excluded).
//   3. If that hash differs from build-manifest.json, sw.js CACHE_NAME is bumped (bt-sales-v11.N -> N+1)
//      and the manifest is rewritten, so installed PWAs drop the stale cache.
//
//   node scripts/build.mjs          apply the stamp (idempotent: a second run changes nothing)
//   node scripts/build.mjs --check  change nothing; exit 1 if a stamp or the cache bump is missing (CI)

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  index: join(ROOT, 'index.html'),
  sw: join(ROOT, 'sw.js'),
  manifest: join(ROOT, 'build-manifest.json'),
};

const sha = (buf) => createHash('sha1').update(buf).digest('hex');
const short = (buf) => sha(buf).slice(0, 8);
const stripQuery = (u) => u.split('?')[0].split('#')[0];
const isLocal = (u) => !!u && !/^(https?:)?\/\//i.test(u) && !/^(data|blob|mailto|tel|javascript):/i.test(u) && !u.startsWith('#');
const normalize = (u) => stripQuery(u).replace(/^\.\//, '');

function assetPath(rel) {
  const abs = join(ROOT, rel);
  return existsSync(abs) && statSync(abs).isFile() ? abs : null;
}

/** Stamp ?v=<hash> on local scripts / stylesheets. Returns the new html (pure). */
export function stampIndex(html) {
  const stamp = (tag, attr) =>
    tag.replace(new RegExp(`(\\s${attr}=")([^"]+)(")`), (m, a, url, c) => {
      if (!isLocal(url)) return m;
      const file = assetPath(normalize(url));
      if (!file) return m; // missing files are reported by tests/static/file-references.test.js
      return `${a}${stripQuery(url)}?v=${short(readFileSync(file))}${c}`;
    });
  return html
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/gi, (t) => stamp(t, 'src'))
    .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, (t) => stamp(t, 'href'));
}

export function appShellEntries(sw) {
  const m = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (!m) throw new Error('Could not locate APP_SHELL in sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter(isLocal);
}

/** One hash over index.html (already stamped) + every precached file. sw.js itself is excluded. */
export function contentHash(stampedHtml, sw) {
  const files = {};
  for (const entry of appShellEntries(sw)) {
    const rel = normalize(entry);
    if (!rel || rel === 'sw.js') continue;
    const abs = assetPath(rel);
    if (abs) files[rel] = short(readFileSync(abs));
  }
  files['index.html'] = short(stampedHtml);
  const keys = Object.keys(files).sort();
  const hash = sha(keys.map((k) => `${k}:${files[k]}`).join('\n')).slice(0, 12);
  return { hash, files: Object.fromEntries(keys.map((k) => [k, files[k]])) };
}

const CACHE_RE = /const CACHE_NAME = 'bt-sales-v(\d+)\.(\d+)'; \/\/ /;

function run(check) {
  const html = readFileSync(P.index, 'utf8');
  const sw = readFileSync(P.sw, 'utf8');
  const stamped = stampIndex(html);
  const { hash, files } = contentHash(stamped, sw);
  const manifest = existsSync(P.manifest) ? JSON.parse(readFileSync(P.manifest, 'utf8')) : null;

  const problems = [];
  if (stamped !== html) problems.push('index.html has missing or outdated ?v= stamps');
  if (!manifest || manifest.hash !== hash) problems.push('shipped files changed since the last build (sw.js CACHE_NAME not bumped)');

  if (check) {
    if (problems.length) {
      console.error('Build check FAILED:\n - ' + problems.join('\n - ') + '\nRun: npm run build');
      process.exit(1);
    }
    console.log(`Build check OK (hash ${hash}, ${Object.keys(files).length} files).`);
    return;
  }

  if (stamped !== html) writeFileSync(P.index, stamped);

  if (!manifest || manifest.hash !== hash) {
    const m = sw.match(CACHE_RE);
    if (!m) throw new Error("Could not find `const CACHE_NAME = 'bt-sales-vX.Y'; // ` in sw.js");
    const next = `bt-sales-v${m[1]}.${Number(m[2]) + 1}`;
    const prev = `v${m[1]}.${m[2]}`;
    const note = `v${m[1]}.${Number(m[2]) + 1}: auto-bumped by npm run build (content hash ${hash}). Previously ${prev}: `;
    writeFileSync(P.sw, sw.replace(CACHE_RE, `const CACHE_NAME = '${next}'; // ${note}`));
    writeFileSync(P.manifest, JSON.stringify({ cache: next, hash, files }, null, 2) + '\n');
    console.log(`Shipped files changed -> CACHE_NAME ${prev} -> ${next}, manifest updated.`);
  } else {
    console.log('Nothing changed (stamps and cache version already current).');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run(process.argv.includes('--check'));
