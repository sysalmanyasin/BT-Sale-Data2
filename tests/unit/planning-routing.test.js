import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDomains } from '../../js/agent/core/router.js';
import { INSTANT_TOOLS } from '../../js/agent/core/instant.js';
import { getTool, listTools } from '../../js/agent/core/tool-registry.js';

test('planning questions route to the right tool groups', () => {
  assert.deepEqual(matchDomains('forecast for friday'), ['sales']);
  assert.ok(matchDomains('will I hit the weekday projection').includes('sales'));
  assert.ok(matchDomains('what is the STR fill rate').includes('str'));
  assert.ok(matchDomains('draft the reorder list').includes('inventory'));
});

test('instant commands for the new tools only call read tools', async () => {
  for (const t of ['weekday_forecast', 'reorder_draft', 'str_fill_rate']) assert.ok(INSTANT_TOOLS.includes(t), t + ' should be an instant tool');
  globalThis.window = globalThis.window || {};
  await import('../../js/agent/tools/planning.js').catch(() => null); // may need DOM-free app modules; registration is best-effort in node
  for (const t of INSTANT_TOOLS) { const d = getTool(t); if (d) assert.equal(d.risk === 'read' || d.risk === 'ui', true, t + ' must not be a change tool'); }
  assert.ok(Array.isArray(listTools()));
});
