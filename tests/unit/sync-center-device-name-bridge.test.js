import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// activity-log.js reads window._sc_detectDeviceName. sync-center.js is an ES module, so the
// function is no longer an implicit global — it must be bridged onto window explicitly.
test('sync-center.js bridges _sc_detectDeviceName onto window for activity-log.js', () => {
  const sc = readFileSync(new URL('../../js/platform/sync-center.js', import.meta.url), 'utf8');
  const al = readFileSync(new URL('../../js/platform/activity-log.js', import.meta.url), 'utf8');
  assert.match(al, /window\._sc_detectDeviceName/);
  assert.match(sc, /window\._sc_detectDeviceName\s*=\s*_sc_detectDeviceName/);
});
