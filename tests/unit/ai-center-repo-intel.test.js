// Phase 4: repository intelligence answers from the REAL committed index; the curated map cannot rot; no source code is ever returned.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, isSecretLine } from '../../scripts/build-repo-index.mjs';
import * as RI from '../../js/ai-center/repo-intel.js';

const idx = JSON.parse(readFileSync('js/ai-center/repo-index.json', 'utf8'));
const ask = (q, o) => RI.answerRepoQuestion(idx, q, o);
const loc = (a, file, symbol) => a.locations.find(l => l.file === file && (!symbol || l.symbol === symbol));
const sourceLine = (file, n) => readFileSync(file, 'utf8').split(/\r?\n/)[n - 1] || '';

describe('the committed index is current', () => {
  test('matches the code: same files, same line counts (run `npm run index:repo` if this fails)', () => {
    const live = buildIndex('.'), liveFiles = new Map(live.index.map(f => [f.f, f])), saved = new Map(idx.index.map(f => [f.f, f]));
    const missing = [...liveFiles.keys()].filter(f => !saved.has(f)), removed = [...saved.keys()].filter(f => !liveFiles.has(f));
    const moved = [...saved.keys()].filter(f => liveFiles.has(f) && (liveFiles.get(f).lines !== saved.get(f).lines || liveFiles.get(f).sym.length !== saved.get(f).sym.length || liveFiles.get(f).tools.length !== saved.get(f).tools.length));
    assert.deepEqual({ missing, removed, moved }, { missing: [], removed: [], moved: [] }, 'repo-index.json is stale: run  npm run index:repo  and commit it');
  });
  test('knows the files added in the recent phases', () => {
    const files = new Set(idx.index.map(f => f.f));
    for (const f of ['js/agent/core/orchestrator.js', 'js/ai-center/repo-intel.js', 'js/agent/core/telemetry-store.js']) assert.ok(files.has(f), f);
  });
});

describe('the curated architecture map cannot rot', () => {
  test('every pointer resolves against the committed index (file, and symbol when named)', () => {
    const bad = [];
    for (const c of RI.CONCEPTS) for (const p of c.pointers) { const r = RI.resolvePointer(idx, p); if (!r.verified) bad.push(c.id + ' -> ' + p.file + (p.symbol ? '#' + p.symbol : '') + ': ' + r.note); }
    assert.deepEqual(bad, []);
  });
  test('resolved line numbers are real: the named symbol is on that line of the actual file', () => {
    for (const c of RI.CONCEPTS) for (const p of c.pointers.filter(x => x.symbol && !x.file.endsWith('.sql'))) {
      const r = RI.resolvePointer(idx, p);
      // a tool's indexed line is its registerTool( line; the name follows within a few lines
      const span = Array.from({ length: r.kind === 'tool' ? 4 : 1 }, (_, i) => sourceLine(p.file, r.line + i)).join(' ');
      assert.ok(span.includes(p.symbol.replace(/^public\./, '')), c.id + ': ' + p.file + ':' + r.line + ' should mention ' + p.symbol);
    }
  });
  test('topics have unique ids, an explanation and at least one pointer', () => {
    assert.equal(new Set(RI.CONCEPTS.map(c => c.id)).size, RI.CONCEPTS.length);
    for (const c of RI.CONCEPTS) { assert.ok(c.explanation.length > 60, c.id); assert.ok(c.pointers.length > 0, c.id); assert.ok(c.keys.length > 0, c.id); }
  });
  test('an unresolvable pointer is reported as such, never given an invented line', () => {
    const r = RI.resolvePointer(idx, { file: 'js/nope.js', symbol: 'x' }); assert.equal(r.verified, false); assert.equal(r.line, null); assert.match(r.note, /not found/);
    const s = RI.resolvePointer(idx, { file: 'js/agent/core/tool-registry.js', symbol: 'noSuchSymbol' }); assert.equal(s.verified, false); assert.equal(s.line, null); assert.match(s.note, /symbol/);
  });
});

describe('the spec questions, answered from the real index', () => {
  test('Where is approval implemented?', () => {
    const a = ask('Where is approval implemented?');
    assert.equal(a.kind, 'architecture'); assert.match(a.title, /Approval/);
    const r = loc(a, 'js/agent/core/tool-registry.js', 'runTool'), p = loc(a, 'js/agent/ui/agent-panel.js', 'approve');
    assert.ok(r && Number.isInteger(r.line) && r.line > 1 && r.summary.length > 0 && r.role); assert.ok(p && p.line > 1);
    assert.ok(sourceLine(r.file, r.line).includes('runTool')); assert.ok(sourceLine(p.file, p.line).includes('approve'));
  });
  test('Where does VERIFY happen?', () => {
    const a = ask('Where does VERIFY happen?');
    assert.equal(a.kind, 'architecture'); assert.ok(loc(a, 'js/agent/tools/verify.js')); assert.ok(loc(a, 'js/agent/core/tool-registry.js', 'setVerifier')); assert.ok(loc(a, 'js/agent/core/agent-client.js', 'runAgent'));
    assert.match(a.explanation, /does not wait for the cloud sync/);
  });
  test('Which tool provides closing data? -> the real registered closing tools with file, line and risk', () => {
    const a = ask('Which tool provides closing data?');
    assert.equal(a.kind, 'tools'); assert.deepEqual(a.tools.map(t => t.name).sort(), ['closing_recent_days', 'closing_status']);
    for (const t of a.tools) { assert.equal(t.file, 'js/agent/tools/closing.js'); assert.equal(t.risk, 'read'); assert.ok(sourceLine(t.file, t.line).includes('registerTool') || sourceLine(t.file, t.line + 1).includes(t.name) || sourceLine(t.file, t.line).includes(t.name)); }
    assert.ok(a.locations.every(l => l.kind === 'tool'));
  });
  test('Where is the Sales specialist? -> SPECIALISTS + the sales tool group', () => {
    const a = ask('Where is the Sales specialist?');
    assert.equal(a.kind, 'architecture'); const s = loc(a, 'js/agent/core/specialists.js', 'SPECIALISTS'); assert.ok(s && s.line > 1);
    const t = a.locations.find(l => l.kind === 'tool'); assert.ok(t && t.file === 'js/agent/tools/sales.js' && /^read tools/.test(t.role), 'the sales READ tool file is shown, not a change tool');
    assert.ok(loc(a, 'supabase/functions/bt-agent/index.ts', 'buildSystemPrompt'));
  });
  test('How does AI Center call BT Agent? -> the actual path, in order of the call chain', () => {
    const a = ask('How does AI Center call BT Agent?');
    assert.equal(a.kind, 'architecture');
    const files = a.locations.map(l => l.file + '#' + l.symbol);
    for (const w of ['js/ai-center/ui.js#ask', 'js/agent/ui/agent-panel.js#ask', 'js/agent/core/agent-client.js#runAgent', 'js/agent/core/server.js#callServer']) assert.ok(files.includes(w), w);
    assert.ok(files.indexOf('js/ai-center/ui.js#ask') < files.indexOf('js/agent/core/agent-client.js#runAgent') && files.indexOf('js/agent/core/agent-client.js#runAgent') < files.indexOf('js/agent/core/server.js#callServer'));
    assert.match(a.explanation, /no brain of its own/);
  });
  test('Where is telemetry persisted?', () => {
    const a = ask('Where is telemetry persisted?');
    assert.equal(a.kind, 'architecture'); assert.ok(loc(a, 'js/agent/core/telemetry-store.js', 'startPersistence')); assert.ok(loc(a, 'js/agent/core/telemetry-store.js', 'toStored'));
    assert.match(a.explanation, /300 events and 7 days/); assert.match(a.explanation, /per device/);
  });
  test('all sample questions are answered, none falls through to "none"', () => {
    for (const q of RI.SAMPLE_QUESTIONS) { const a = ask(q); assert.equal(a.ok, true, q); assert.notEqual(a.kind, 'none', q); assert.ok(a.locations.length > 0, q); }
  });
  test('other topics: undo, audit, kill switch, investigation, findings, forecast', () => {
    assert.ok(loc(ask('where is undo'), 'js/agent/core/undo.js', 'runUndo'));
    assert.ok(loc(ask('how is the audit trail written'), 'js/agent/core/audit.js', 'logToolCall'));
    assert.ok(loc(ask('what is the kill switch'), 'js/agent/core/kill-switch.js', 'getKillState'));
    assert.ok(loc(ask('how does investigation work'), 'js/agent/core/orchestrator.js', 'runInvestigation'));
    assert.ok(loc(ask('where are findings built'), 'js/ai-center/model.js', 'buildFindings'));
    const f = ask('where does the forecast come from'); assert.ok(loc(f, 'js/analytics.js', 'getTargetPaceForMonth')); assert.match(f.explanation, /No second formula/);
  });
  test('tools registered in tests are stubs and never answer "which tool provides X"', () => {
    for (const q of ['Which tool provides closing data?', 'which tools give sales data', 'which tool provides inventory data']) assert.equal(ask(q).tools.some(t => t.file.startsWith('tests/')), false, q);
    assert.equal(idx.index.filter(f => f.f.startsWith('tests/')).some(f => f.tools.length), false, 'the index itself holds no test tools');
    assert.equal(RI.toolsInIndex({ version: 1, index: [{ f: 'tests/x.test.js', tools: [{ n: 'fake', d: 'closing', r: 'read', l: 1 }] }] }, 'closing').length, 0, 'even a hand-built index cannot make a test file a tool');
  });
  test('tool locations carry domain and risk, also when reached through a topic', () => {
    const f = ask('where does the forecast come from').locations.find(l => l.symbol === 'get_target_pace');
    assert.equal(f.domain, 'sales'); assert.equal(f.risk, 'read');
    assert.equal(ask('where is undo').locations.some(l => 'domain' in l), false, 'non-tool locations have no domain');
  });
  test('tool questions for other areas use the right domain (stock transfers are STR, not inventory)', () => {
    assert.ok(ask('Which tool provides stock transfer data?').tools.every(t => t.domain === 'str'));
    assert.ok(ask('which tools give inventory data').tools.every(t => t.domain === 'inventory'));
    assert.ok(ask('what tool reads staff ledger data').tools.every(t => t.domain === 'manager'));
  });
});

describe('honesty', () => {
  test('answers contain only index fields: no source text, no secrets, summaries stay one clipped line', () => {
    for (const q of [...RI.SAMPLE_QUESTIONS, 'target pace', 'logToolCall']) {
      const a = ask(q); const text = JSON.stringify(a);
      assert.equal(isSecretLine(text), false, q);
      for (const l of a.locations) { assert.ok(l.summary.length <= 140, q); assert.deepEqual(Object.keys(l).sort(), ['file', 'github', 'kind', 'line', 'note', 'related', 'role', 'summary', 'symbol', 'verified', ...('domain' in l ? ['domain', 'risk'] : [])].sort(), 'unexpected field in a location'); }
    }
  });
  test('every answer says it is an index of locations, not source, and names the commit', () => {
    const a = ask('Where is approval implemented?');
    assert.match(a.notes[0], /WHERE something is implemented/); assert.match(a.notes[0], /no source code/); assert.ok(a.notes[0].includes(idx.commit));
  });
  test('a pointer missing from the index is withheld and reported, not shown as fact', () => {
    const cut = { ...idx, index: idx.index.filter(f => f.f !== 'js/agent/ui/agent-panel.js') };
    const a = RI.answerRepoQuestion(cut, 'Where is approval implemented?');
    assert.equal(a.kind, 'architecture'); assert.equal(loc(a, 'js/agent/ui/agent-panel.js'), undefined);
    assert.ok(a.unresolved.some(u => u.file === 'js/agent/ui/agent-panel.js')); assert.ok(a.notes.some(n => /could not be found in the current index/.test(n)));
    assert.ok(loc(a, 'js/agent/core/tool-registry.js', 'runTool'), 'the pointers that do resolve are still shown');
  });
  test('index/registry drift is flagged: an indexed tool that is not registered in the running app', () => {
    const a = ask('Which tool provides closing data?', { registered: ['closing_recent_days'] });
    assert.equal(a.tools.find(t => t.name === 'closing_status').registered, false); assert.equal(a.tools.find(t => t.name === 'closing_recent_days').registered, true);
    assert.ok(a.notes.some(n => /not registered in this running app: closing_status/.test(n)));
    assert.equal(ask('Which tool provides closing data?').tools[0].registered, null, 'unknown without a registry, not claimed');
  });
  test('no index / empty question / unmatched question: honest, nothing invented', () => {
    assert.equal(RI.answerRepoQuestion(null, 'approval').ok, false); assert.match(RI.answerRepoQuestion(null, 'approval').reason, /not loaded/);
    assert.equal(RI.answerRepoQuestion({ version: 2, index: [] }, 'approval').ok, false);
    assert.equal(ask('').ok, false);
    const n = ask('zzzqqqxxx'); assert.equal(n.kind, 'none'); assert.equal(n.locations.length, 0); assert.match(n.explanation, /Nothing in the code index/);
  });
  test('a stale index is called out in the answer', () => {
    const old = { ...idx, generated_at: new Date(Date.now() - 30 * 86400000).toISOString() };
    const a = RI.answerRepoQuestion(old, 'Where is approval implemented?');
    assert.equal(a.index.stale, true); assert.ok(a.notes.some(n => /more than 14 days old/.test(n)));
  });
});

describe('search results carry related tool / feature and a code link', () => {
  test('a tool hit lists the tools in its file and the topics that point at it', () => {
    const hits = RI.searchRepo(idx, 'target pace', 10), h = hits.find(x => x.symbol === 'get_target_pace');
    assert.ok(h); assert.equal(h.domain, 'sales'); assert.equal(h.risk, 'read'); assert.ok(h.related.tools.includes('get_target_pace')); assert.ok(h.related.features.includes('Forecast and target pace'));
  });
  test('a function hit links to the topics that use its file', () => {
    const h = RI.searchRepo(idx, 'runTool', 5).find(x => x.symbol === 'runTool');
    assert.ok(h.related.features.includes('Approval') && h.related.features.includes('VERIFY (read-back after a change)'));
  });
});

describe('githubUrl', () => {
  test('links to the file and line at the indexed commit', () => {
    const u = RI.githubUrl({ commit: 'abc1234' }, 'js/agent/core/audit.js', 14);
    assert.equal(u, 'https://github.com/sysalmanyasin/BT-Sale-Data2/blob/abc1234/js/agent/core/audit.js#L14');
  });
  test('falls back to main without a valid commit; omits #L without a line', () => {
    assert.match(RI.githubUrl({ commit: '' }, 'js/a.js', null), /\/blob\/main\/js\/a\.js$/); assert.match(RI.githubUrl({ commit: 'not a hash!' }, 'js/a.js', 3), /\/blob\/main\//);
  });
  test('unsafe paths never produce a link', () => {
    for (const f of ['../secret', 'js/../x', '/etc/passwd', 'js/a b.js', 'javascript:alert(1)', 'js/a.js?x=1', '', null]) assert.equal(RI.githubUrl({ commit: 'abc1234' }, f, 1), null, String(f));
  });
});
