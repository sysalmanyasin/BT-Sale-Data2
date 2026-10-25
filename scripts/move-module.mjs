#!/usr/bin/env node
// Move modules into a domain folder and fix EVERY reference in one pass.
//
//   node scripts/move-module.mjs js/sales dashboard.js reports.js ...   (files are relative to js/)
//   node scripts/move-module.mjs --dry js/sales dashboard.js
//
// What it rewrites:
//   * relative import specifiers (static `from`, side-effect `import`, dynamic `import()`) in every
//     .js/.mjs file in the repo (js/, tests/, scripts/), resolved against the OLD location of the file
//     that contains them and re-pointed at the NEW location;
//   * literal path strings `js/<name>.js` in index.html, sw.js, tests, docs, workflows, supabase notes.
// It never touches node_modules, .git, android-*, build-manifest.json or repo-index.json (regenerate those:
// `npm run index:repo && npm run readme:sync && npm run build`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args[0] === '--dry' ? (args.shift(), true) : false;
const [destDir, ...names] = args;
if (!destDir || !names.length) { console.error('usage: move-module.mjs [--dry] <js/domain> <file.js>...'); process.exit(2); }

const norm = (p) => p.split('\\').join('/');
const moves = new Map(); // old repo-relative -> new repo-relative
for (const n of names) {
  const from = `js/${n}`;
  if (!existsSync(join(ROOT, from))) { console.error(`missing: ${from}`); process.exit(1); }
  const to = `${destDir}/${posix.basename(n)}`;
  if (existsSync(join(ROOT, to))) { console.error(`target exists: ${to}`); process.exit(1); }
  moves.set(from, to);
}
const mapPath = (p) => moves.get(p) ?? p;

const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_FILES = new Set(['build-manifest.json', 'repo-index.json', 'package-lock.json']);
const TEXT_EXT = /\.(js|mjs|html|md|json|yml|yaml|toml|sql|ts|css|kt|kts|txt)$/;
function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('android-')) walk(rel, out); }
    else if (TEXT_EXT.test(e.name) && !SKIP_FILES.has(e.name)) out.push(rel);
  }
  return out;
}

const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;
const relSpec = (fromFile, toFile) => {
  let r = norm(relative(dirname(fromFile), toFile));
  return r.startsWith('.') ? r : `./${r}`;
};

const changed = [];
for (const file of walk('')) {
  let src = readFileSync(join(ROOT, file), 'utf8');
  const orig = src;
  const newLoc = mapPath(file);
  if (/\.(m?js)$/.test(file)) {
    src = src.replace(SPEC, (m, pre, q, spec) => {
      const target = norm(posix.normalize(posix.join(posix.dirname(file), spec)));       // old target (resolved from OLD file loc)
      const nt = mapPath(target);
      if (nt === target && newLoc === file) return m;
      return `${pre}${q}${relSpec(newLoc, nt)}${q}`;
    });
  }
  for (const [from, to] of moves) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    src = src.replace(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'g'), to);
  }
  if (src !== orig) { changed.push(file); if (!dry) writeFileSync(join(ROOT, file), src); }
}

if (!dry) {
  mkdirSync(join(ROOT, destDir), { recursive: true });
  for (const [from, to] of moves) execFileSync('git', ['mv', from, to], { cwd: ROOT });
}
console.log(`${dry ? '[dry] ' : ''}moved ${moves.size} file(s) -> ${destDir}; rewrote ${changed.length} file(s)`);
