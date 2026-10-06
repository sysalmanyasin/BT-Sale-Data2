import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateFact, validateRules, addFact, saveRules, getRules, listFacts, deleteFact, MAX_FACTS, MAX_RULES } from '../../js/agent/core/memory.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const chain = (result) => { const q = { select: () => q, order: () => q, limit: () => Promise.resolve(result), eq: () => q, then: (f, r) => Promise.resolve(result).then(f, r) }; return q; };

describe('memory validation', () => {
  test('facts are trimmed, collapsed, length-limited', () => {
    assert.equal(validateFact('  closing   is at\n10pm ').text, 'closing is at 10pm');
    assert.equal(validateFact('   ').ok, false);
    assert.equal(validateFact('x'.repeat(301)).ok, false);
  });
  test('rules limited to 4000 chars', () => {
    assert.equal(validateRules('a'.repeat(MAX_RULES)).ok, true);
    assert.equal(validateRules('a'.repeat(MAX_RULES + 1)).ok, false);
  });
});

describe('memory store', () => {
  test('addFact refuses when memory is full, and never calls the database', async () => {
    let called = false;
    const sb = { from: () => { called = true; return {}; } };
    assert.equal((await addFact(sb, 'hello', MAX_FACTS)).ok, false);
    assert.equal(called, false);
  });
  test('addFact inserts only the fact (user_id comes from the database default)', async () => {
    let row;
    const sb = { from: () => ({ insert: v => { row = v; return { select: async () => ({ data: [{ id: 1, fact: v.fact }], error: null }) }; } }) };
    const r = await addFact(sb, 'Ali is the senior salesman', 0);
    assert.equal(r.ok, true); assert.deepEqual(Object.keys(row), ['fact']);
  });
  test('saveRules writes a NEW version and reports a version clash', async () => {
    let row;
    const ok = { from: () => ({ insert: async v => { row = v; return { error: null }; } }) };
    assert.deepEqual(await saveRules(ok, 'rule', 3), { ok: true, version: 4 }); assert.equal(row.version, 4);
    const clash = { from: () => ({ insert: async () => ({ error: { code: '23505', message: 'dup' } }) }) };
    assert.match((await saveRules(clash, 'rule', 3)).error, /another device/);
  });
  test('reads fail soft (empty), never throw', async () => {
    const boom = { from: () => { throw new Error('x'); } };
    assert.deepEqual(await listFacts(boom), []); assert.deepEqual(await getRules(boom), { body: '', version: 0 });
    assert.equal((await deleteFact(boom, 1)).ok, false);
    assert.deepEqual(await getRules(null), { body: '', version: 0 });
    assert.equal((await getRules({ from: () => ({ select: () => chain({ data: [{ body: 'b', version: 2 }] }) }) })).version, 2);
  });
});

describe('memory safety (static)', () => {
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/index.ts'), 'utf8');
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261005120000_agent_memory_rules.sql'), 'utf8');
  test('server adds owner notes to the prompt, bounded, and ranked below the safety rules', () => {
    assert.match(fn, /loadOwnerNotes\(sb, user\.id\)/);
    assert.match(fn, /buildSystemPrompt\(ctx, notes\.rules, notes\.facts\)/);
    assert.match(fn, /NEVER override rules 1-8/);
    assert.match(fn, /MAX_RULES_CHARS = 4000/);
    assert.match(fn, /\.eq\('user_id', userId\)/);
  });
  test('notes come after the focus text and before CONTEXT', () => {
    const a = fn.indexOf('...ownerNotes(rules, facts)');
    assert.ok(fn.indexOf('FOCUS[ctx.focus]') < a && a < fn.indexOf('`CONTEXT:'));
  });
  test('tables: RLS on, anon out, owner-only; rules history immutable', () => {
    assert.match(mig, /alter table public\.agent_memory enable row level security/);
    assert.match(mig, /alter table public\.agent_rules\s+enable row level security/);
    assert.match(mig, /revoke all on public\.agent_memory from anon/);
    assert.ok(!/on public\.agent_rules for (update|delete)/i.test(mig));
    assert.match(mig, /grant select, insert on public\.agent_rules/);
    assert.match(mig, /user_id = auth\.uid\(\)/);
  });
  test('no registered agent tool can write memory or rules', () => {
    const dir = path.join(root, 'js/agent/tools');
    for (const f of fs.readdirSync(dir)) assert.ok(!/agent_memory|agent_rules|core\/memory\.js/.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  });
});
