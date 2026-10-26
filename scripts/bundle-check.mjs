// Bundle-resolution check: feeds every <script type="module"> entry in index.html to esbuild and fails if any
// import/export cannot be resolved (missing file, missing export, assignment to an import, syntax error).
// jsdom tests cannot see these; a real bundler does. Nothing is written to disk and production is unchanged.
//   node scripts/bundle-check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function moduleEntries(html) {
  return [...html.matchAll(/<script\s+type="module"\s+src="([^"?]+)/g)].map((m) => m[1]).filter((s) => !/^(https?:)?\/\//.test(s));
}

export async function bundleCheck() {
  const entries = moduleEntries(readFileSync(join(ROOT, 'index.html'), 'utf8'));
  try {
    const res = await build({ entryPoints: entries.map((e) => join(ROOT, e)), bundle: true, write: false, format: 'esm', splitting: true, outdir: join(ROOT, '.bundle-check'), logLevel: 'silent' });
    return { ok: true, entries: entries.length, warnings: res.warnings.length, errors: [] };
  } catch (e) {
    return { ok: false, entries: entries.length, warnings: 0, errors: (e.errors || [e]).map((x) => `${x.location ? x.location.file + ':' + x.location.line + ' ' : ''}${x.text || x.message}`) };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await bundleCheck();
  if (!r.ok) { console.error('Bundle check FAILED:\n - ' + r.errors.join('\n - ')); process.exit(1); }
  console.log(`Bundle check OK (${r.entries} module entries, ${r.warnings} warnings).`);
}
