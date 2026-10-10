import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortSystemsByUrgency } from '../../js/ai-center/model.js';
const names = ['SALES', 'CASH', 'INVENTORY', 'STAFF', 'STR', 'CLOSING'];
test('urgency: error first, then data unavailable, then attention (more findings first), then clear; ties keep original order', () => {
  const sys = { SALES: { status: 'CLEAR' }, CASH: { status: 'ATTENTION', warnings: 1 }, INVENTORY: { status: 'ATTENTION', warnings: 3 }, STAFF: { status: 'DATA_UNAVAILABLE' }, STR: { status: 'ERROR' }, CLOSING: { status: 'CLEAR' } };
  assert.deepEqual(sortSystemsByUrgency(names, sys), ['STR', 'STAFF', 'INVENTORY', 'CASH', 'SALES', 'CLOSING']);
});
test('urgency: loading or missing data keeps the original order and never drops a system', () => {
  assert.deepEqual(sortSystemsByUrgency(names, null), names);
  assert.deepEqual(sortSystemsByUrgency(names, { SALES: { status: 'ATTENTION', warnings: 1 } }), names);
  const r = sortSystemsByUrgency(names, { SALES: { status: 'CLEAR' }, CASH: { status: 'CLEAR' }, INVENTORY: { status: 'CLEAR' }, STAFF: { status: 'CLEAR' }, STR: { status: 'CLEAR' }, CLOSING: { status: 'CLEAR' } });
  assert.equal(r.length, 6);
});
