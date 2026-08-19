// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — js/print.js: "the one and only print engine" per its own
// header comment. Every report in the app funnels through Print.render()
// or Print.renderNewTab(). Actually invoking a render is out of scope
// for a smoke test (it drives jsPDF/html2canvas against a live DOM
// capture, which needs a real browser canvas) — what we verify here is
// that the module loads cleanly and still exposes the exact API surface
// every calling page depends on.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const { Print } = await import('../../js/print.js');

describe('Print engine (smoke)', () => {
  test('module loads without throwing and exports Print', () => {
    assert.ok(Print, 'Print export should exist');
  });

  test('exposes the full API surface every report page calls', () => {
    for (const fn of ['render', 'renderNewTab', 'renderThermal', 'renderThermalTable']) {
      assert.equal(typeof Print[fn], 'function', `Print.${fn} should be a function`);
    }
  });

  test('bridges onto window (classic-script report pages call window.Print / bare Print)', () => {
    assert.equal(window.Print, Print, 'window.Print must be the same instance exported by the module');
  });
});
