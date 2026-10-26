// Every module entry in index.html must bundle cleanly: catches missing exports, bad paths and writes to imports
// that jsdom-based tests cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleCheck } from '../../scripts/bundle-check.mjs';

test('all <script type="module"> entries resolve and bundle with esbuild', async () => {
  const r = await bundleCheck();
  assert.deepEqual(r.errors, []);
  assert.ok(r.entries > 50, 'expected the full module list, got ' + r.entries);
});
