// REPOSITORY INTELLIGENCE index builder (read-only, secret-filtered).
//
// Produces js/ai-center/repo-index.json: a SYMBOL MAP of the BT source (file, line, kind, one-line summary),
// so the AI Center can answer "where is X calculated / which tool powers it / what lives in this file".
//
// What it NEVER does:
//   - store source code text (only names, line numbers and the first header-comment line of a file)
//   - read secret-bearing files (.env*, keys, certificates, credentials) at all
//   - keep any line that looks like a credential (JWTs, sb_secret/service_role keys, long key assignments, private keys)
//   - write anywhere except the one output file; make network calls; run any repository code
// Run:  node scripts/build-repo-index.mjs     (also: npm run index:repo)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOTS = ['js', 'css', 'supabase/functions', 'supabase/migrations', 'scripts', 'tests'];
const EXT = new Set(['.js', '.mjs', '.css', '.sql', '.ts']);
const SKIP_DIR = /(^|\/)(node_modules|\.git|icons|android-attendance|android-widget|inventory-search\/data)(\/|$)/;
const SKIP_FILE = /(^\.env|\.pem$|\.key$|\.p12$|\.pfx$|\.keystore$|credentials|secret|service[-_]?account|repo-index\.json$)/i;
const SECRET_LINE = /(eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|sb_secret_|sbp_[A-Za-z0-9]{10,}|github_pat_|ghp_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|service_role['"]?\s*[:=]\s*['"][^'"]{12,}|(api[_-]?key|secret|token|password|passwd)['"]?\s*[:=]\s*['"][A-Za-z0-9_\-./+=]{16,}['"])/i;
export const isSecretLine = l => SECRET_LINE.test(l);
export const skipFile = path => SKIP_FILE.test(basename(path)) || SKIP_DIR.test(path);

function* walk(dir, root) {
  let names; try { names = readdirSync(dir); } catch (_) { return; }
  for (const n of names.sort()) {
    const p = join(dir, n), rel = relative(root, p).replace(/\\/g, '/');
    if (skipFile(rel)) continue;
    let st; try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) yield* walk(p, root);
    else if (EXT.has(extname(n)) && st.size < 600000) yield { p, rel, size: st.size };
  }
}

const FN = [
  [/^\s*export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function', 2],
  [/^\s*(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, 'function', 2],
  [/^\s*export\s+(const|let)\s+([A-Za-z_$][\w$]*)\s*=/, 'const', 2],
  [/^(const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?(\(|[A-Za-z_$][\w$]*\s*=>)/, 'function', 2],
  [/^\s*export\s+class\s+([A-Za-z_$][\w$]*)/, 'class', 1],
  [/^\s*class\s+([A-Za-z_$][\w$]*)/, 'class', 1],
];
const METHOD = /^ {2}(async\s+)?(get[A-Z]\w+|compute\w+|calc\w+|build\w+)\s*\([^)]*\)\s*\{/; // object/class methods in KPI engines (e.g. Analytics)
const TOOL = /registerTool\(\s*\{\s*$|registerTool\(\s*\{\s*name:/;

/** Pure: index ONE file's text. Exported for tests. Never returns source text beyond a clipped header-comment line. */
export function indexFile(rel, text) {
  const lines = text.split(/\r?\n/), symbols = [], tools = [];
  let summary = '';
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const m = lines[i].match(/^\s*(?:\/\/|\/\*+|\*)\s?(.*)$/);
    if (m && /[A-Za-z]{4}/.test(m[1]) && !/^[\s=\-_*]+$/.test(m[1]) && !isSecretLine(m[1])) { summary = m[1].replace(/[=\-_*]{3,}/g, '').trim().slice(0, 140); if (summary) break; }
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (isSecretLine(ln)) continue;
    if (rel.endsWith('.js') || rel.endsWith('.mjs') || rel.endsWith('.ts')) {
      for (const [re, kind, g] of FN) { const m = ln.match(re); if (m) { symbols.push({ n: m[g], k: kind, l: i + 1 }); break; } }
      const mm = ln.match(METHOD); if (mm) symbols.push({ n: mm[2], k: 'method', l: i + 1 });
      if (TOOL.test(ln)) {
        const blob = lines.slice(i, i + 4).join(' '), nm = blob.match(/name:\s*'([a-z0-9_]+)'/), dm = blob.match(/domain:\s*'([a-z]+)'/), rm = blob.match(/risk:\s*'([a-z]+)'/);
        if (nm) tools.push({ n: nm[1], k: 'tool', l: i + 1, d: dm ? dm[1] : '', r: rm ? rm[1] : '' });
      }
    } else if (rel.endsWith('.sql')) {
      const m = ln.match(/^\s*create\s+(?:or\s+replace\s+)?(table|function|view|policy)\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)/i);
      if (m) symbols.push({ n: m[2].replace(/"/g, ''), k: m[1].toLowerCase(), l: i + 1 });
    } else if (rel.endsWith('.css')) {
      const m = ln.match(/^\/\*\s*(.{6,80}?)\s*\*\/\s*$/); if (m && !isSecretLine(m[1])) symbols.push({ n: m[1], k: 'section', l: i + 1 });
    }
  }
  return { f: rel, lines: lines.length, s: summary, sym: symbols.slice(0, 400), tools };
}

export function buildIndex(root = '.') {
  const files = [];
  for (const r of ROOTS) for (const f of walk(join(root, r), root)) files.push(indexFile(f.rel, readFileSync(f.p, 'utf8')));
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) { /* not a git checkout */ }
  const symbols = files.reduce((a, f) => a + f.sym.length + f.tools.length, 0);
  return { version: 1, generated_at: new Date().toISOString(), commit, note: 'Names, locations and one-line file summaries only. No source code. Secret-bearing files and lines are excluded.', files: files.length, symbols, index: files.filter(f => f.sym.length || f.tools.length || f.s) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = buildIndex('.');
  const text = JSON.stringify(out);
  if (SECRET_LINE.test(text)) { console.error('Refusing to write: the index itself matched a secret pattern.'); process.exit(1); }
  writeFileSync('js/ai-center/repo-index.json', text);
  console.log('repo-index.json: ' + out.files + ' files, ' + out.symbols + ' symbols, ' + Math.round(text.length / 1024) + ' KB, commit ' + (out.commit || 'n/a'));
}
