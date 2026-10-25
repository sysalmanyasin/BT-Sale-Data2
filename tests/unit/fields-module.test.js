// ══════════════════════════════════════════════════════════════════════
// FIELD MANAGER MODULE SMOKE TEST
// The custom-field array is reassigned by fmLoad/fmResetAll. Consumers must
// always see the current array through window._fmCustom, not a stale copy.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv();
const fields = await import('../../js/sales/fields.js');

describe('Field Manager module conversion', () => {
  test('exports its live state and preserves the legacy window API', () => {
    assert.equal(typeof window.fmLoad, 'function');
    assert.equal(typeof window.fmApply, 'function');
    assert.ok(Array.isArray(fields._fmCustom));
    assert.equal(window._fmCustom, fields._fmCustom);
  });

  test('window._fmCustom follows each fmLoad reassignment', () => {
    resetStorage();
    const first = [{ id: 'Custom_A', label: 'Custom A', section: 'Banks', calcType: 'add' }];
    localStorage.setItem('bt_custom_cols', JSON.stringify(first));
    window.fmLoad();
    assert.deepEqual(window._fmCustom, first);
    assert.equal(window._fmCustom, fields._fmCustom);

    const second = [
      { id: 'Custom_B', label: 'Custom B', section: 'Cash', calcType: 'sub' },
      { id: 'Custom_C', label: 'Custom C', section: 'Credit Clients', calcType: 'add' },
    ];
    localStorage.setItem('bt_custom_cols', JSON.stringify(second));
    window.fmLoad();
    assert.deepEqual(window._fmCustom, second);
    assert.equal(window._fmCustom, fields._fmCustom);
  });
});
