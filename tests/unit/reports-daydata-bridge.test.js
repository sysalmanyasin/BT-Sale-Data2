// REGRESSION TEST — js/sales/reports.js must expose dayData() on window.
// js/sales/daily-checklist.js (an ES module) pulls its Cash/Credit figures from window.dayData so the
// Daily Check List always equals the Sale Report. dayData lives inside reports.js's IIFE, and when it was
// not bridged to window the checklist silently fell back to a hardcoded column list that ignored custom
// fields (e.g. "Bank Alfalah 2"), leaving the checklist 16,321 short of the report on 16 Oct 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

async function load(custom) {
  const dom = installDomEnv();
  const w = dom.window || globalThis.window || dom;
  w.n = (v) => { const x = parseFloat(String(v == null ? 0 : v).replace(/,/g, '')); return isNaN(x) ? 0 : x; };
  w._fmCustom = custom;
  w.toast = () => {};
  await import('../../js/sales/reports.js?test=' + Date.now() + Math.random());
  return w;
}

test('reports.js bridges dayData to window', async () => {
  const w = await load([]);
  assert.equal(typeof w.dayData, 'function');
});

test('dayData folds custom fields (Bank Alfalah 2) into netCash so checklist == Sale Report', async () => {
  const w = await load([{ id: 'custom_ALF2', label: 'Bank Alfalah 2', section: 'Banks', calcType: 'add' }]);
  // 16 Oct 2026 figures from the Sale Report screenshot
  const row = { 'Cash Sale': 277701, 'Alfala Bank': 190017, custom_ALF2: 16321, 'PARCO': 6730, TOTAL: 490769 };
  const d = w.dayData(row);
  assert.equal(d.netCash, 484039);
  assert.equal(d.netCredit, 6730);
  assert.equal(d.netCash + d.netCredit, 490769);
});
