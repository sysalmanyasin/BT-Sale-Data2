// Weekday bar chart uses ONLY the tool's weekday_baseline; dialogs keep Tab focus inside.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};
const reg = await import('../../js/agent/core/tool-registry.js');
const rd = (name, domain, run) => reg.registerTool({ name, domain, risk: 'read', description: name, parameters: { type: 'object', properties: {} }, run });
rd('daily_briefing', 'app', () => ({ date: '07/Oct/2026', last_sales_entry: { date: '06/Oct/2026', total_sale: 410000, days_ago: 1 }, missing_sales_days: 0, attention: [], inventory: null, credit: null, needs_action: 0 }));
rd('get_target_pace', 'sales', () => ({ month: 'October 2026', target: 1000000, sold_so_far: 300000, pct_done: 30, remaining: 700000, days_left: 20, needed_per_day: 35000, actual_per_day: 38000, on_track: true }));
rd('closing_recent_days', 'closing', () => ({ days: [], incomplete_days: [] }));
rd('str_overview', 'str', () => ({ total: 0, awaited: { all: 0 } }));
rd('list_pending_strs', 'str', () => ({ matching: 0, showing: 0, items: [] }));
rd('get_daily_sales', 'sales', () => ({ date: '06/Oct/2026', total_sale: 410000 }));
const T = await import('../../js/agent/core/telemetry.js');
const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);

describe('weekday chart and dialog focus', () => {
  before(async () => { ui.onShow(); await wait(80); });
  test('weekday chart: one bar per real weekday, tallest is the max, today marked, accessible name lists values', () => {
    const W = { weekday_baseline: [{ weekday: 'Monday', avg: 100 }, { weekday: 'Tuesday', avg: 200 }, { weekday: 'Wednesday', avg: 50 }], today: { weekday: 'Tuesday' } };
    const node = ui.__test.weekdayBars(W);
    const bars = [...node.querySelectorAll('.aic-bar')];
    assert.equal(bars.length, 3);
    assert.equal(bars[1].querySelector('.aic-bf').getAttribute('style'), 'height:100%');
    assert.equal(bars[0].querySelector('.aic-bf').getAttribute('style'), 'height:50%');
    assert.ok(bars[1].classList.contains('today') && !bars[0].classList.contains('today'));
    assert.match(node.querySelector('ul').getAttribute('aria-label'), /Monday Rs 100, Tuesday Rs 200, Wednesday Rs 50/);
    assert.equal(ui.__test.weekdayBars({ weekday_baseline: [] }), null, 'no data, no chart');
  });
  test('instrument tiles: only real values, "—" when unavailable, rings carry the real percentage', async () => {
    const tiles = [...document.querySelectorAll('#aic-inst .aic-it')];
    assert.equal(tiles.length, 8);
    assert.ok(tiles.every(t => t.getAttribute('aria-label')), 'every tile has an accessible name');
    const target = tiles.find(t => t.textContent.includes('TARGET'));
    assert.match(target.textContent, /30%/);                       // pct_done from get_target_pace, not recomputed
    const ring = target.querySelector('.rg-val');
    assert.equal(ring.getAttribute('stroke-dasharray').split(' ')[0], (0.30 * 2 * Math.PI * 20).toFixed(1));
    assert.match(tiles.find(t => t.textContent.includes('APPROVALS')).textContent, /—|0/);
    assert.match(tiles.find(t => t.textContent.includes('STR FILL')).textContent, /—|%/);
    assert.equal(document.querySelectorAll('[id="aic-inst"]').length, 1);
  });
  test('Agent Fleet shows a run timeline built only from real telemetry events', async () => {
    assert.match(ui.__test.runsBlock().textContent, /No agent runs recorded|RECENT RUNS/);
    const rid = 'req_test_1';
    T.emit({ type: 'request_start', request_id: rid, metadata: { question: 'What is blocking closing?' } });
    T.emit({ type: 'routed', request_id: rid, agent: 'Closing', metadata: { domains: ['closing'] } });
    T.emit({ type: 'tool_end', request_id: rid, agent: 'Closing', tool: 'closing_recent_days', status: 'ok', duration: 90 });
    T.emit({ type: 'answer', request_id: rid, metadata: { steps: 1 } });
    await wait(30);
    const row = [...document.querySelectorAll('#aic-fleet .aic-run')].find(r => r.textContent.includes('What is blocking closing?'));
    assert.ok(row, 'run row rendered inside the Agent Fleet card');
    assert.match(row.textContent, /COMPLETE/); assert.match(row.textContent, /Closing/); assert.match(row.textContent, /1 tool/);
    row.querySelector('button').click(); await wait(20);
    const stages = [...document.querySelectorAll('.aic-modal .aic-tls b')].map(b => b.textContent);
    assert.deepEqual(stages, ['Received', 'Routed', 'Answer'], 'only stages that happened');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  test('Tab wraps inside an open dialog and Escape closes it', async () => {
    ui.__test.openModal('Test dialog', (() => { const d = document.createElement('div'); d.innerHTML = '<button id="m1">one</button><button id="m2">two</button>'; return d; })());
    const m1 = document.getElementById('m1'), m2 = document.getElementById('m2');
    m2.focus();
    const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(q('.aic-modal'), null);
  });
});
