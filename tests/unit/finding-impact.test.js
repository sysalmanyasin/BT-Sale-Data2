import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingImpact } from '../../js/ai-center/model.js';

test('findingImpact reads the largest Rs figure, or an explicit impact', () => {
  assert.equal(findingImpact({ title: 'expense Rs 50 entered 2 times' }), 50);
  assert.equal(findingImpact({ title: 'closed with Rs 163,664 still owed' }), 163664);
  assert.equal(findingImpact({ title: 'no money here' }), 0);
  assert.equal(findingImpact({ title: 'Rs 5', impact: 900 }), 900);
});
