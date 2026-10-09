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
  test('loads the repository index and keeps the architecture map usable for the current checkout', () => {
    assert.ok(Array.isArray(idx.index), 'repo-index.json must contain an index array');
    assert.ok(idx.index.length > 0, 'repo-index.json must not be empty');
    const live = buildIndex('.');
    assert.ok(Array.isArray(live.index), 'live repo index must be valid');
    assert.ok(live.index.length > 0, 'live repo index must not be empty');
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
    const r = loc(a, 'js/agent/core/tool-registry.js', 'runTool'), p = loc(a, 'js/ai-center/ui.js', 'approvalCard');
    assert.ok(r && Number.isInteger(r.line) && r.line > 1 && r.summary.length > 0 && r.role); assert.ok(p && p.line > 1);
    assert.ok(sourceLine(r.file, r.line).includes('runTool')); assert.ok(sourceLine(p.file, p.line).includes('approvalCard'));
  });
});

describe('honesty', () => {
  test('answers contain only index fields: no source text, no secrets, summaries stay one clipped line', () => {
    for (const q of [...RI.SAMPLE_QUESTIONS, 'target pace', 'logToolCall']) {
      const a = ask(q); const text = JSON.stringify(a);
      assert.equal(isSecretLine(text), false, q);
      for (const l of a.locations) { assert.ok(l.summary.length <= 140, q); assert.deepEqual(Object.keys(l).sort(), ['file', 'github', 'kind', 'line', 'note', 'related', 'role', 'summary', 'symbol', 'verified', ...(l.kind === 'tool' ? ['domain', 'risk'] : [])].sort(), q); }
    }
  });
});
