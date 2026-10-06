import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { blockedByName, blockedByArgs } from '../../js/agent/core/hard-blocks.js';
import { registerTool, runTool, clearTools } from '../../js/agent/core/tool-registry.js';

describe('hard blocks: names', () => {
  for (const n of ['finalise_salary', 'finalize_payroll', 'lock_salary_month', 'salary_finalisation', 'release_payslips', 'refund_bill', 'process_refund', 'bulk_delete_entries', 'delete_all_notes', 'clear_all_ledger', 'purge_history'])
    test(n + ' is blocked', () => assert.ok(blockedByName(n)));
  for (const n of ['add_ledger_entry', 'delete_ledger_entry', 'get_staff_credit', 'add_staff_note', 'delete_daily_sales_entry', 'get_salary_summary'])
    test(n + ' is allowed', () => assert.equal(blockedByName(n), null));
});
describe('hard blocks: arguments', () => {
  test('delete with several ids / wildcard is bulk', () => {
    assert.ok(blockedByArgs('delete_ledger_entry', { ids: ['a', 'b'] }));
    assert.ok(blockedByArgs('delete_ledger_entry', { all: true }));
    assert.ok(blockedByArgs('delete_staff_note', { id: '*' }));
    assert.ok(blockedByArgs('remove_things', { id: 'all' }));
  });
  test('single-record delete and non-delete tools pass', () => {
    assert.equal(blockedByArgs('delete_ledger_entry', { ledger: 'jazz', id: 'x1' }), null);
    assert.equal(blockedByArgs('get_ledger_entries', { ids: ['a', 'b'] }), null);
  });
});
describe('hard blocks: enforced by the registry', () => {
  beforeEach(() => clearTools());
  test('cannot register a refund / salary-finalise / bulk tool', () => {
    for (const name of ['refund_bill', 'finalise_salary', 'delete_all_entries'])
      assert.throws(() => registerTool({ name, description: 'x', risk: 'critical', preview: () => ({}), run: async () => ({}) }), /hard-blocked/);
  });
  test('a multi-id delete is refused even when writes are on and the human would approve', async () => {
    let ran = false;
    registerTool({ name: 'delete_widget', description: 'd', risk: 'critical', parameters: { type: 'object', properties: { ids: { type: 'string' } } },
      preview: () => ({ title: 't', lines: [] }), run: async () => { ran = true; return {}; } });
    const r = await runTool('delete_widget', { all: true }, { writesEnabled: true, approve: async () => true });
    assert.equal(r.ok, false); assert.equal(r.error, 'hard_blocked'); assert.equal(ran, false);
    assert.match(r.text, /Bulk deletes/);
  });
});
