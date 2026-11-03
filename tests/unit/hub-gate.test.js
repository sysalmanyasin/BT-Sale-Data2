// Audit Hub pause gate: starts paused, manual resume only, idle auto-pause, and every
// Audit Hub reader consults it (static guard so a new bridge can't silently bypass the pause).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as gate from '../../js/platform/hub-gate.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const src = (f) => readFileSync(ROOT + f, 'utf8');

test('every launch starts paused', () => {
  assert.equal(gate.isPaused(), true);
});

test('resume is explicit, pause returns to paused', () => {
  assert.equal(gate.resume(), true);          // was paused
  assert.equal(gate.isPaused(), false);
  assert.equal(gate.resume(), false);         // already live: no-op
  gate.pause('manual');
  assert.equal(gate.isPaused(), true);
});

test('touch() never resumes a paused gate', () => {
  gate.touch();
  assert.equal(gate.isPaused(), true);
});

test('idle window is 10 min, hidden window 2 min', () => {
  assert.equal(gate.IDLE_MS, 10 * 60 * 1000);
  assert.equal(gate.HIDDEN_MS, 2 * 60 * 1000);
});

test('every Audit Hub bridge refresh checks the gate', () => {
  for (const f of ['js/audit/audit-bridge.js', 'js/inventory/inventory-bridge.js', 'js/str/str-bridge.js', 'js/sales/sale-payments-bridge.js']) {
    const s = src(f);
    assert.match(s, /from '\.\.\/platform\/hub-gate\.js'/, f + ' imports the gate');
    assert.match(s, /if \(isPaused\(\)/, f + ' checks isPaused()');
  }
  const sl = src('js/inventory/stockledger.js');
  assert.match(sl, /hubPaused\(\)/);
  assert.match(src('js/ai-center/forecast-game.js'), /isPaused\(\)/);
});

test('only Emergency Billing bypasses the pause, and only for inventory', () => {
  const eb = src('js/emergency-billing/emergency-billing-native.js');
  assert.match(eb, /inventoryBridgeRefresh\(!!force, \{ bypassPause: true \}\)/);
  for (const f of ['js/audit/audit-bridge.js', 'js/str/str-bridge.js', 'js/sales/sale-payments-bridge.js']) {
    assert.doesNotMatch(src(f), /bypassPause/, f + ' has no bypass');
  }
});
