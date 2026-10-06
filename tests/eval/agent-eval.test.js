// Evaluation suite (runs in CI with `npm test`, and therefore gates the Supabase deploy).
// Deterministic by design: no model is called. It proves, for every case in cases.js:
//   1. the right specialist + tool groups are chosen,
//   2. the tools the question needs are actually offered (and change tools only when unlocked),
//   3. the canonical tool call returns the right facts from a known dataset,
// plus coverage: every registered tool is exercised by at least one case.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
import { CASES } from './cases.js';
import { seedEvalData } from './seed.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
const LedgerStore = await import('../../js/ledger-store.js');
const { LedgerActions } = await import('../../js/ledger-actions.js');
const notes = await import('../../js/staff-notes.js');
const reg = await import('../../js/agent/core/tool-registry.js');
const { pickSpecialist } = await import('../../js/agent/core/specialists.js');
for (const f of ['app', 'sales', 'manager', 'inventory', 'writes', 'credit', 'deletes', 'briefing', 'str', 'closing', 'billing', 'documents', 'memory-tool']) await import('../../js/agent/tools/' + f + '.js');

const PREV = { sales: { id: 'sales', label: 'Sales', domains: ['sales'] }, manager: { id: 'manager', label: 'Staff & money', domains: ['manager'] }, inventory: { id: 'inventory', label: 'Inventory', domains: ['inventory'] } };
const offered = (domains, writes) => reg.getToolSchemas({ includeWrites: writes, domains }).map(t => t.function.name);

// partial deep match: objects/arrays in `expected` must be present in `actual`
function matches(actual, expected, path = '$') {
  if (expected !== null && typeof expected === 'object') {
    if (Array.isArray(expected)) {
      assert.ok(Array.isArray(actual), path + ' should be an array');
      assert.ok(actual.length >= expected.length, path + ' has ' + actual.length + ' items, expected at least ' + expected.length);
      expected.forEach((e, i) => matches(actual[i], e, path + '[' + i + ']'));
    } else {
      assert.ok(actual && typeof actual === 'object', path + ' should be an object');
      for (const [k, v] of Object.entries(expected)) matches(actual[k], v, path + '.' + k);
    }
  } else assert.equal(actual, expected, path);
}

before(async () => { await seedEvalData({ cfg, Repository, LedgerStore, LedgerActions, notes }); });

describe('evaluation: routing and tool offering (' + CASES.length + ' cases)', () => {
  for (const c of CASES) {
    test('«' + c.say + '» → ' + c.specialist, () => {
      const sp = pickSpecialist(c.say, c.prev ? PREV[c.prev] : null);
      assert.equal(sp.id, c.specialist, 'specialist');
      assert.deepEqual([...sp.domains].sort(), [...c.domains].sort(), 'domains');
      const tools = offered(sp.domains, !!c.writes);
      for (const t of c.offer) assert.ok(tools.includes(t), t + ' must be offered; got ' + tools.join(', '));
      if (c.writes) {
        const locked = offered(sp.domains, false);
        for (const t of c.offer.filter(n => reg.isChange(reg.getTool(n)))) assert.ok(!locked.includes(t), t + ' must NOT be offered while locked');
      }
    });
  }
});

describe('evaluation: golden answers from a known dataset', () => {
  for (const c of CASES.filter(x => x.call)) {
    test('«' + c.say + '» → ' + c.call.tool, async () => {
      const r = await reg.runTool(c.call.tool, c.call.args);
      assert.equal(r.ok, true, r.text);
      matches(JSON.parse(r.text), c.call.expect);
    });
  }
  test('private identity data never appears in any staff answer', async () => {
    for (const [tool, args] of [['list_staff', { active: 'all' }], ['find_staff', { query: 'Ali' }]]) {
      assert.ok(!/12345-1234567|0300-0000000/.test((await reg.runTool(tool, args)).text), tool);
    }
  });
});

describe('evaluation: coverage and size', () => {
  test('every registered tool appears in at least one case (new tools need an eval case)', () => {
    const covered = new Set(CASES.flatMap(c => c.offer));
    const missing = reg.listTools().map(t => t.name).filter(n => !covered.has(n));
    assert.deepEqual(missing, [], 'tools without an evaluation case: ' + missing.join(', '));
  });
  test('the suite is large enough to mean something', () => assert.ok(CASES.length >= 60, 'only ' + CASES.length));
  test('routed prompts stay small: no specialist sees more than 60% of all tools (writes unlocked)', () => {
    const all = offered(null, true).length;
    for (const d of [['sales'], ['manager'], ['inventory']]) assert.ok(offered(d, true).length <= all * 0.6, d + ' → ' + offered(d, true).length + '/' + all);
    assert.equal(offered([], true).length, reg.listTools().filter(t => t.domain === 'app').length);
  });
  test('Roman Urdu / Urdu-English mixes are covered', () => assert.ok(CASES.filter(c => /\b(kitna|kitni|ka|ki|aaj|bikri|udhar)\b/i.test(c.say)).length >= 3));
});
