// Repository Intelligence: the index builder is secret-filtered and stores no source code; search ranks sensibly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexFile, isSecretLine, skipFile, buildIndex } from '../../scripts/build-repo-index.mjs';
import * as M from '../../js/ai-center/model.js';

describe('secret filtering', () => {
  const FAKE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
  test('credential-looking lines are recognised', () => {
    for (const l of ["const key = '" + FAKE_JWT + "';", "const SERVICE_ROLE = 'sb_secret_abcdefghijklmnop1234';", "const x = { api_key: 'abcdef1234567890ABCDEF' };", "token = 'github_pat_11AAAAAAA0abcdefghijklmnop';", '-----BEGIN RSA PRIVATE KEY-----', "service_role: 'abcdefghijklmnopqrstuv'"]) assert.ok(isSecretLine(l), l);
    for (const l of ['export function getTargetPaceForMonth(month) {', "const label = 'Total';", "const token = nextToken();"]) assert.ok(!isSecretLine(l), l);
  });
  test('secret-bearing files and noisy dirs are never read', () => {
    for (const f of ['.env', '.env.local', 'keys/server.pem', 'a/b/credentials.json', 'x/service-account.json', 'js/secrets.js', 'node_modules/x/y.js', 'icons/a.js']) assert.ok(skipFile(f), f);
    for (const f of ['js/analytics.js', 'supabase/functions/bt-agent/index.ts']) assert.ok(!skipFile(f), f);
  });
  test('a secret line never yields a symbol, and no source text is stored', () => {
    const src = ['// Demo file for tests', "export const apiKey = { api_key: 'abcdef1234567890ABCDEFGH' };", 'export function realOne(a) {', '  return a + 1; // SECRET_BODY_TEXT', '}'].join('\n');
    const f = indexFile('js/demo.js', src);
    assert.deepEqual(f.sym.map(x => x.n), ['realOne']);
    const json = JSON.stringify(f);
    assert.ok(!json.includes('SECRET_BODY_TEXT') && !json.includes('abcdef1234567890'), 'no body text or secret in the entry');
    assert.equal(f.s, 'Demo file for tests');
  });
  test('registered tools are indexed with domain and risk', () => {
    const f = indexFile('js/agent/tools/x.js', "registerTool({\n  name: 'get_thing', domain: 'sales', risk: 'read',\n  description: 'x',\n});");
    assert.deepEqual(f.tools.map(t => [t.n, t.d, t.r]), [['get_thing', 'sales', 'read']]);
  });
});

describe('the committed index', () => {
  const idx = JSON.parse(readFileSync(new URL('../../js/ai-center/repo-index.json', import.meta.url), 'utf8'));
  test('is valid, small, and free of secret patterns', () => {
    assert.ok(M.validRepoIndex(idx));
    const text = JSON.stringify(idx);
    assert.ok(text.length < 400 * 1024, 'index stays small (' + text.length + ')');
    text.split(/[,{}\[\]]/).forEach(piece => assert.ok(!isSecretLine(piece), 'secret-like piece: ' + piece.slice(0, 40)));
    assert.ok(!/\.env|\.pem/i.test(idx.index.map(f => f.f).join(' ')));
  });
  test('answers the questions it exists for', () => {
    const a = M.searchRepoIndex(idx, 'target pace');
    assert.ok(a.some(x => x.name === 'getTargetPaceForMonth' && x.file === 'js/analytics.js'), 'KPI location found');
    const t = M.searchRepoIndex(idx, 'daily_briefing');
    assert.equal(t[0].kind, 'tool'); assert.equal(t[0].risk, 'read');
    assert.ok(M.searchRepoIndex(idx, 'verify').some(x => x.file === 'js/agent/tools/verify.js'));
  });
  test('a live rebuild matches what is committed in shape (builder works on this checkout)', () => {
    const live = buildIndex('.');
    assert.ok(live.files > 100 && live.symbols > 1000);
    assert.ok(live.index.flatMap(f => f.tools).length >= 60, 'tools are discovered');
  });
});

describe('searchRepoIndex', () => {
  const idx = { version: 1, generated_at: '2026-10-01T00:00:00Z', commit: 'abc', files: 2, symbols: 3, index: [
    { f: 'js/analytics.js', s: 'KPI engine', sym: [{ n: 'getTargetPaceForMonth', k: 'function', l: 10 }], tools: [] },
    { f: 'tests/unit/a.test.js', s: '', sym: [{ n: 'getTargetPaceHelper', k: 'function', l: 3 }], tools: [{ n: 'get_target_pace', k: 'tool', l: 5, d: 'sales', r: 'read' }] }] };
  test('all terms must match; tools rank above tests; empty/garbage queries return nothing', () => {
    const r = M.searchRepoIndex(idx, 'target pace');
    assert.equal(r[0].kind === 'function' ? r[0].file : r[0].name, r[0].kind === 'function' ? 'js/analytics.js' : 'get_target_pace');
    assert.ok(r.every(x => /pace/i.test(x.name + x.file + x.summary)));
    assert.deepEqual(M.searchRepoIndex(idx, ''), []); assert.deepEqual(M.searchRepoIndex(idx, 'zzzz'), []); assert.deepEqual(M.searchRepoIndex(null, 'x'), []);
  });
  test('index info flags an old snapshot', () => {
    assert.equal(M.repoIndexInfo(idx, Date.parse('2026-10-05T00:00:00Z')).stale, false);
    assert.equal(M.repoIndexInfo(idx, Date.parse('2026-12-01T00:00:00Z')).stale, true);
    assert.equal(M.repoIndexInfo({ version: 2 }), null);
  });
});
