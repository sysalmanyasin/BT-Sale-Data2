// ONE assistant: the global Jarvis panel is the only chat. BT Intelligence has none of its own; its "Ask Jarvis" actions and
// the command palette go into the same panel and the same thread. The panel keeps every feature of the old docked chat
// (history, memory + house rules, usage, kill switch, lock, new chat, briefing, chips, approvals) and is unaffected by the
// Center's constant repaints.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.invalidateRenderCache = () => {};
const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
let script = [];
globalThis.fetch = window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => script.shift() || { message: { role: 'assistant', content: 'ok' } } });

const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const q = s => document.querySelector(s);

describe('one global Jarvis, used from BT Intelligence', () => {
  before(async () => { const e = console.error; console.error = () => {}; mountAgentPanel(); ui.onShow(); await wait(150); console.error = e; });

  test('the page has no chat; the one panel floats on the body and starts closed', () => {
    assert.equal(q('#aic-chat'), null); assert.equal(q('.aic-chatslot'), null);
    const sheet = q('#ag-sheet');
    assert.ok(sheet && sheet.parentNode === document.body, 'panel floats over the page');
    assert.equal(sheet.hidden, true);
    assert.equal(document.querySelectorAll('#ag-text, #aic-q').length, 1, 'exactly one chat input in the whole app');
    assert.equal(document.querySelectorAll('#ag-sheet').length, 1);
    assert.equal(typeof window.BTAgent.dock, 'undefined');
  });
  test('the Ask Jarvis button in the hero opens the panel with the welcome message, briefing card and this page\'s questions', async () => {
    q('#aic-hero .dk-askj').click(); await wait(60);
    assert.equal(q('#ag-sheet').hidden, false);
    assert.match(q('#ag-log').textContent, /read your sales, staff, ledgers and inventory/i);
    assert.ok(q('#ag-log .ag-today'), 'briefing card');
    const chips = [...document.querySelectorAll('#ag-chips .ag-chip')].map(b => b.textContent);
    assert.equal(chips.length, 4); assert.ok(chips.includes('What needs my attention today?'));
    assert.match(q('#ag-sub').textContent, /Read-only|stopped|approve/i);
  });
  test('every tool of the old header is reachable from the menu', () => {
    ['#ag-hist', '#ag-mem', '#ag-stats', '#ag-vox', '#ag-kill', '#ag-lock', '#ag-clear'].forEach(id => assert.ok(q('#ag-menu ' + id), id + ' missing'));
    assert.ok(q('#ag-send') && q('#ag-text') && q('#ag-chips') && q('#ag-more') && q('#ag-exp') && q('#ag-close'));
  });
  test('memory and house rules open inside the panel', async () => {
    q('#ag-mem').click();
    assert.ok(await until(() => /How I run this pharmacy/.test(q('#ag-log').textContent)));
    assert.match(q('#ag-log').textContent, /Remembered facts/);
    assert.ok(q('#ag-log .ag-rules') && q('#ag-log .ag-save-rules'));
  });
  test('a typed question is answered in the panel; an AI Center ask lands in the same thread', async () => {
    script = [{ message: { role: 'assistant', content: 'Closing is complete.' } }];
    q('#ag-text').value = 'is closing done'; q('#ag-send').click();
    assert.ok(await until(() => /Closing is complete/.test(q('#ag-log').textContent)));
    script = [{ message: { role: 'assistant', content: 'Three items look risky.' } }];
    await until(() => !window.BTAgent.isBusy());
    ui.__test.ask('Which inventory risks are most urgent?');
    assert.ok(await until(() => /Three items look risky/.test(q('#ag-log').textContent)));
    assert.equal([...document.querySelectorAll('#ag-log .ag-user')].length, 2, 'both questions are in one conversation');
  });
  test('a closed panel opens by itself when the Center asks a question', async () => {
    await until(() => !window.BTAgent.isBusy());
    q('#ag-close').click(); assert.equal(q('#ag-sheet').hidden, true);
    script = [{ message: { role: 'assistant', content: 'Fill rate is 88%.' } }];
    ui.__test.ask('Explain the gap on Counter 2 please');
    assert.ok(await until(() => /Fill rate is 88%/.test(q('#ag-log').textContent)));
    assert.equal(q('#ag-sheet').hidden, false);
    assert.equal([...document.querySelectorAll('#ag-log .ag-user')].length, 3, 'same thread, history kept');
  });
  test('the Center repaints constantly: the panel, its conversation and the typed draft are untouched', async () => {
    await until(() => !window.BTAgent.isBusy());
    const sheet = q('#ag-sheet'), logBefore = q('#ag-log').innerHTML;
    q('#ag-text').value = 'half-typed draft';
    ui.__test.paint(); ui.__test.paint();
    assert.equal(q('#ag-sheet'), sheet, 'same panel element, not rebuilt');
    assert.equal(q('#ag-log').innerHTML, logBefore, 'conversation intact');
    assert.equal(q('#ag-text').value, 'half-typed draft');
  });
  test('typing in the panel does not stop the Center from refreshing', async () => {
    const t = q('#ag-text'); t.focus();
    ui.render(); await wait(40);
    assert.equal(document.activeElement, t, 'focus (keyboard) kept');
    assert.equal(ui.__test.S.paintAfterTyping, undefined, 'the Center no longer holds repaints for the chat');
  });
  test('new chat clears the conversation in the panel', async () => {
    q('#ag-clear').click();
    assert.equal(document.querySelectorAll('#ag-log .ag-user').length, 0);
    assert.match(q('#ag-log').textContent, /Hi! I can read/);
  });
});
