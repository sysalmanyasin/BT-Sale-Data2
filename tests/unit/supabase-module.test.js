// ══════════════════════════════════════════════════════════════════════
// SUPABASE MODULE SMOKE TEST
// Guards the module conversion's most important seam: the sync entry points
// stay available to legacy callers, and payload construction still reads
// every storage section without contacting the network.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv();

// supabase.js intentionally installs a browser safety-net interval. Do not
// keep a real Node timer alive just because this test imports the module.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;

const { MONTHLY, DAILY, STAFF } = await import('../../js/config.js');
await import('../../js/repository.js');
await import('../../js/actions.js');

const keys = {
  MGR_KEY: 'BT_ManagerWork_v1',
  CSEC_KEY: 'mw_custom_sections_v1',
  JC_KEY: 'bt_jazzcash_v2',
  JC_TALLY_KEY: 'bt_jc_tally_v1',
  LEDGER_KEY: 'bt_ledger_v1',
  LEDGER_CUSTOM_TYPES_KEY: 'bt_ledger_custom_types_v1',
};
Object.assign(globalThis, keys);
Object.assign(window, keys);
window.SyncTombstones = { getAllTombstones: () => ({}) };

// The module must be importable without opening a connection. Any unexpected
// attempt to create a client during import is a test failure.
globalThis.supabase = {
  createClient() { throw new Error('Supabase client must not be created during module import'); },
};
window.supabase = globalThis.supabase;

await import('../../js/supabase.js');
globalThis.setInterval = realSetInterval;

describe('Supabase module conversion', () => {
  test('keeps the legacy sync API bridged to window', () => {
    for (const name of [
      '_sbGetChannel', '_buildPayload', 'mergeIncomingData',
      'pushToSupabase', 'pullFromSupabase', 'manualSync',
      'testSupabaseConnection', 'startSupabaseSync',
    ]) {
      assert.equal(typeof window[name], 'function', name + ' must remain callable');
    }
    assert.equal(window._sbGetChannel(), null);
  });

  test('builds the full sync payload from the established storage keys', () => {
    resetStorage();
    const manager = { credit: { '2026-10': [{ name: 'Example', amount: 1200 }] } };
    const custom = { sectionA: [{ id: 'a1', amount: 12 }] };
    const jazzcash = { openingBalance: 500, entries: [{ id: 'j1', amount: 20 }] };
    const tally = { accounts: [{ id: 't1', name: 'Wallet' }], snapshots: [] };
    const ledger = { entries: [{ id: 'l1', amount: 40 }], openingBalances: {} };
    const ledgerTypes = { misc: { label: 'Misc' } };

    for (const [key, value] of Object.entries({
      [keys.MGR_KEY]: manager,
      [keys.CSEC_KEY]: custom,
      [keys.JC_KEY]: jazzcash,
      [keys.JC_TALLY_KEY]: tally,
      [keys.LEDGER_KEY]: ledger,
      [keys.LEDGER_CUSTOM_TYPES_KEY]: ledgerTypes,
    })) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    const payload = window._buildPayload();
    assert.equal(payload.monthly, MONTHLY);
    assert.equal(payload.daily, DAILY);
    assert.equal(payload.staff, STAFF);
    assert.deepEqual(payload.manager, manager);
    assert.deepEqual(payload.custom, custom);
    assert.deepEqual(payload.jazzcash, jazzcash);
    assert.deepEqual(payload.jcTally, tally);
    assert.deepEqual(payload.ledger, ledger);
    assert.deepEqual(payload.ledgerCustomTypes, ledgerTypes);
    assert.deepEqual(payload.tombstones, {});
    assert.equal(payload.payloadVersion, 1);
    assert.equal(window._nextPayloadVersion(), 2);
  });
});
