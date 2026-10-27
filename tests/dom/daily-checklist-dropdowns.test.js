// Daily Check List — items 25 B, 29A, 29B, 29C are dropdowns whose option lists are stored in localStorage.
// Renders the REAL page (js/sales/daily-checklist.js) in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

const dom = installDomEnv('<!doctype html><html><body><div id="page-dailychecklist"></div></body></html>');
const w = globalThis.window;
await import('../../js/sales/daily-checklist.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById('dcl-' + id);
const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const KEYS = { mkt: '25 B', rpos: '29 A', rpor: '29 B', rpoa: '29 C' };
const OPT_KEY = 'bt_daily_checklist_opts_v1', DAY_KEY = 'bt_daily_checklist_v1';

function fresh() { resetStorage(); w.loadDailyChecklistPage(); }

test('25 B, 29A, 29B, 29C render as dropdowns with 3+ real options each', () => {
  fresh();
  for (const k of Object.keys(KEYS)) {
    const sel = $('dd_' + k);
    assert.ok(sel && sel.tagName === 'SELECT', k + ' is a select');
    assert.ok([...sel.options].filter((o) => o.value).length >= 3, k + ' has 3+ options');
  }
  assert.equal($('dd_mkt').value, 'Dr Saira Taj (Dermatologist)');   // old default still preselected
  assert.equal($('dd_rpor').value, '');                              // no more fake "Yes/No" answer
});

test('the answer is saved per day and restored', async () => {
  fresh();
  $('dd_rpor').value = 'No'; change($('dd_rpor'));
  await wait(650);
  const iso = $('m_date').value;
  assert.equal(JSON.parse(localStorage.getItem(DAY_KEY)).days[iso].f['dcl-dd_rpor'], 'No');
  $('dd_rpor').value = '';
  w.loadDailyChecklistPage();
  assert.equal($('dd_rpor').value, 'No');
});

test('the answer reaches the report model (copy / print / email)', () => {
  fresh();
  $('dd_rpoa').value = 'Yes - amended';
  const rows = w.DailyChecklist.collectModel().extra.flatMap((s) => s.rows);
  assert.equal(rows.find((r) => r.no === '29 C').val, 'Yes - amended');
  assert.deepEqual(rows.map((r) => r.no).filter((n) => /^2[89]/.test(n)), ['28', '29 A', '29 B', '29 C']);   // renumbered: no 28 A / 28 B left
  assert.equal(rows.find((r) => r.no === '25 B').val, 'Dr Saira Taj (Dermatologist)');
  // item 25 is split into Marketing sub-items 25 A / 25 B / 25 C
  assert.deepEqual(rows.map((r) => r.no).filter((n) => /^25/.test(n)), ['25 A', '25 B', '25 C']);
  assert.deepEqual(rows.filter((r) => /^25/.test(r.no)).map((r) => r.label),
    ['Marketing: Flyer distribution', 'Doctor Visits', 'Doctor sales potential']);
});

test('option list is editable, stored locally, min 3, and keeps an answer that was removed', () => {
  fresh();
  const panel = document.querySelector('.dcl-ddpanel[data-ddp="rpor"]');
  const btn = (act) => document.querySelector('[data-act="' + act + '"][data-dd="rpor"]');
  click(btn('ddedit')); assert.equal(panel.hidden, false);
  panel.querySelector('textarea').value = 'Yes\nNo';                 // only 2 -> rejected
  click(btn('ddsave'));
  assert.equal(localStorage.getItem(OPT_KEY), null);
  panel.querySelector('textarea').value = 'Yes\nNo\nPartially\nNot applicable\nyes';   // dup (case-insens.) dropped
  click(btn('ddsave'));
  assert.deepEqual(JSON.parse(localStorage.getItem(OPT_KEY)).rpor, ['Yes', 'No', 'Partially', 'Not applicable']);
  assert.deepEqual([...$('dd_rpor').options].map((o) => o.value), ['', 'Yes', 'No', 'Partially', 'Not applicable']);
  assert.equal(panel.hidden, true);
  // a later list change must not wipe today's answer
  $('dd_rpor').value = 'Partially';
  panel.querySelector('textarea').value = 'Yes\nNo\nMaybe'; click(btn('ddedit')); panel.querySelector('textarea').value = 'Yes\nNo\nMaybe';
  click(btn('ddsave'));
  assert.equal($('dd_rpor').value, 'Partially');
  // list survives a "reload" of the page
  w.loadDailyChecklistPage();
  assert.ok([...$('dd_rpor').options].some((o) => o.value === 'Maybe'));
  // default list button
  click(btn('ddedit')); click(btn('ddreset'));
  assert.equal(localStorage.getItem(OPT_KEY) && JSON.parse(localStorage.getItem(OPT_KEY)).rpor, undefined);
});

test('dropdowns count toward section progress (28-31 is incomplete until 29B / 29C are chosen)', () => {
  fresh();
  const head = document.getElementById('dcl-sec-rpo').querySelector('.dcl-sec-head');
  assert.equal(head.classList.contains('done'), false);
  $('dd_rpor').value = 'Yes'; change($('dd_rpor'));
  assert.equal(head.classList.contains('done'), false);   // 29C still empty
  $('dd_rpoa').value = 'No amendment'; change($('dd_rpoa'));
  assert.equal(head.classList.contains('done'), true);    // 29A is optional
});
