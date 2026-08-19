// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — asset wiring integrity.
//
// This app has no bundler: index.html hand-lists every <script>/<link>,
// and sw.js hand-lists a matching APP_SHELL for offline caching. The
// README explicitly calls out that letting these two drift is a real,
// previously-seen failure mode ("APP_SHELL list must stay in sync with
// every real <script>/<link> in index.html, or that file silently fails
// offline"). These tests catch exactly that class of regression, plus
// plain broken-path typos, without needing a browser.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(REPO_ROOT, 'sw.js'), 'utf8');

// Strip a trailing cache-busting query string, e.g. "js/print.js?v=20260806a".
const stripQuery = (url) => url.split('?')[0];
const isLocal = (url) => !/^https?:\/\//i.test(url) && !url.startsWith('//');

function localScriptSrcs(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    if (isLocal(m[1])) out.push(stripQuery(m[1]));
  }
  return out;
}

function localStylesheetHrefs(html) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)) {
    if (isLocal(m[1])) out.push(stripQuery(m[1]));
  }
  return out;
}

function appShellEntries(js) {
  const match = js.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(match, 'could not locate APP_SHELL array in sw.js — has its declaration changed shape?');
  const body = match[1];
  const entries = [];
  for (const m of body.matchAll(/'([^']+)'/g)) entries.push(m[1]);
  return entries;
}

describe('index.html asset references (smoke)', () => {
  test('every local <script src> file exists on disk', () => {
    const srcs = localScriptSrcs(indexHtml);
    assert.ok(srcs.length > 30, 'sanity check: expected dozens of local <script> tags in index.html');
    const missing = srcs.filter((src) => !fs.existsSync(path.join(REPO_ROOT, src)));
    assert.deepEqual(missing, [], `index.html references missing script file(s): ${missing.join(', ')}`);
  });

  test('every local <link rel=stylesheet href> file exists on disk', () => {
    const hrefs = localStylesheetHrefs(indexHtml);
    assert.ok(hrefs.length > 10, 'sanity check: expected multiple stylesheet links in index.html');
    const missing = hrefs.filter((href) => !fs.existsSync(path.join(REPO_ROOT, href)));
    assert.deepEqual(missing, [], `index.html references missing stylesheet(s): ${missing.join(', ')}`);
  });

  test('no duplicate <script src> tags (a common copy-paste bug)', () => {
    const srcs = localScriptSrcs(indexHtml);
    const seen = new Set();
    const dupes = [];
    for (const src of srcs) {
      if (seen.has(src)) dupes.push(src);
      seen.add(src);
    }
    assert.deepEqual(dupes, [], `index.html includes the same script twice: ${dupes.join(', ')}`);
  });
});

describe('sw.js APP_SHELL integrity (smoke)', () => {
  test('every local APP_SHELL entry exists on disk', () => {
    const entries = appShellEntries(swJs).filter((e) => isLocal(e) && e !== './');
    const missing = entries.filter((e) => !fs.existsSync(path.join(REPO_ROOT, e.replace(/^\.\//, ''))));
    assert.deepEqual(missing, [], `sw.js APP_SHELL references missing file(s): ${missing.join(', ')}`);
  });

  test('every local script in index.html is precached in APP_SHELL', () => {
    const htmlScripts = new Set(localScriptSrcs(indexHtml).map((s) => './' + s));
    const shellEntries = new Set(appShellEntries(swJs));
    const missingFromShell = [...htmlScripts].filter((s) => !shellEntries.has(s));
    assert.deepEqual(
      missingFromShell,
      [],
      `index.html loads script(s) not listed in sw.js's APP_SHELL (will 404 offline): ${missingFromShell.join(', ')}`
    );
  });

  test('every local stylesheet in index.html is precached in APP_SHELL', () => {
    const htmlSheets = new Set(localStylesheetHrefs(indexHtml).map((s) => './' + s));
    const shellEntries = new Set(appShellEntries(swJs));
    const missingFromShell = [...htmlSheets].filter((s) => !shellEntries.has(s));
    assert.deepEqual(
      missingFromShell,
      [],
      `index.html loads stylesheet(s) not listed in sw.js's APP_SHELL (will 404 offline): ${missingFromShell.join(', ')}`
    );
  });

  test('CACHE_NAME is declared and non-empty (bump discipline sanity check)', () => {
    const match = swJs.match(/const CACHE_NAME = '([^']+)'/);
    assert.ok(match, 'sw.js must declare a CACHE_NAME constant');
    assert.ok(match[1].length > 0, 'CACHE_NAME must not be empty');
  });
});
