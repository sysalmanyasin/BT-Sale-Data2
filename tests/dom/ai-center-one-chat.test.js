// ONE chat: the assistant's chat is docked inside BT Intelligence and brings every feature of the old floating "Ask JARVIS"
// sheet (history, memory + house rules, usage, kill switch, lock, new chat, briefing, chips, approvals). The page keeps no
// second thread, the chat survives the page's constant repaints, and leaving the page parks it.
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

describe('BT Intelligence has exactly one chat, with every assistant feature', () => {
  before(async () => { const e = console.error; console.error = () => {}; mountAgentPanel(); ui.onShow(); await wait(150); console.error = e; });

  test('the assistant chat is docked in the chat card; there is no floating sheet and no second input', () => {
    const sheet = q('#ag-sheet');
    assert.ok(sheet && q('#aic-chat').contains(sheet), 'chat is inside the page');
    assert.equal(sheet.hidden, false);
    assert.ok(sheet.classList.contains('ag-docked'));
    assert.equal(document.querySelectorAll('#ag-text, #aic-q').length, 1, 'exactly one chat input');
    assert.equal(document.querySelectorAll('#ag-sheet').length, 1);
    assert.equal(q('#ag-close'), null);
  });
  test('every toolbar feature of the old sheet is there', () => {
    ['#ag-hist', '#ag-mem', '#ag-stats', '#ag-kill', '#ag-lock', '#ag-clear'].forEach(id => assert.ok(q('#aic-chat ' + id), id + ' missing from the in-page chat'));
    assert.ok(q('#aic-chat #ag-send') && q('#aic-chat #ag-text') && q('#aic-chat #ag-chips'));
    assert.match(q('#aic-chat #ag-sub').textContent, /Read-only|stopped|approve/i);
  });
  test('welcome message, briefing card and suggestion chips are shown in the page chat', () => {
    assert.match(q('#aic-chat #ag-log').textContent, /read your sales, staff, ledgers and inventory/i);
    assert.ok(q('#aic-chat .ag-today'), 'briefing card');
    assert.equal(q('#aic-chat #ag-chips').querySelectorAll('.ag-chip').length, 4);
  });
  test('memory and house rules open inside the page chat', async () => {
    q('#ag-mem').click();
    assert.ok(await until(() => /How I run this pharmacy/.test(q('#aic-chat #ag-log').textContent)));
    assert.match(q('#aic-chat #ag-log').textContent, /Remembered facts/);
    assert.ok(q('#aic-chat .ag-rules') && q('#aic-chat .ag-save-rules'));
  });
  test('a typed question is answered in the same chat; asking from a hero button lands in the same thread', async () => {
    script = [{ message: { role: 'assistant', content: 'Closing is complete.' } }];
    q('#ag-text').value = 'is closing done'; q('#ag-send').click();
    assert.ok(await until(() => /Closing is complete/.test(q('#aic-chat #ag-log').textContent)));
    script = [{ message: { role: 'assistant', content: 'Three items look risky.' } }];
    await until(() => !window.BTAgent.isBusy());
    q('#aic-hero .aic-hbtn').click();
    assert.ok(await until(() => /Three items look risky/.test(q('#aic-chat #ag-log').textContent)));
    const users = [...document.querySelectorAll('#aic-chat .ag-user')].map(n => n.textContent);
    assert.equal(users.length, 2, 'both questions are in one conversation');
  });
  test('the page repaints constantly: the conversation, the typed draft and the node itself survive', async () => {
    await until(() => !window.BTAgent.isBusy());
    const sheet = q('#ag-sheet'), logBefore = q('#ag-log').innerHTML;
    q('#ag-text').value = 'half-typed draft';
    ui.__test.paint(); ui.__test.paint();
    assert.equal(q('#ag-sheet'), sheet, 'same chat element, not rebuilt');
    assert.equal(q('#ag-log').innerHTML, logBefore, 'conversation intact');
    assert.equal(q('#ag-text').value, 'half-typed draft');
    assert.ok(q('#aic-chat').contains(q('#ag-sheet')));
  });
  test('while the person is typing in the chat, the page does not repaint under their thumb; it catches up on blur', async () => {
    const t = q('#ag-text'); t.focus();
    assert.equal(document.activeElement, t);
    const sheet = q('#ag-sheet');
    ui.render(); await wait(30);
    assert.equal(ui.__test.S.paintAfterTyping, true, 'repaint is deferred, not lost');
    assert.equal(document.activeElement, t, 'focus (keyboard) kept');
    t.blur(); await wait(40);
    assert.equal(ui.__test.S.paintAfterTyping, false);
    assert.equal(q('#ag-sheet'), sheet);
  });
  test('a repaint queued BEFORE the person starts typing is also held back (no lost keystrokes)', async () => {
    const t = q('#ag-text');
    ui.render();            // queued while nobody is typing
    t.focus();              // ...then the thumb lands in the box before the frame runs
    await wait(40);
    assert.equal(document.activeElement, t, 'the queued repaint must not steal focus');
    assert.equal(ui.__test.S.paintAfterTyping, true);
    t.blur(); await wait(40);
  });
  test('new chat (↺) clears the conversation in the page chat', async () => {
    q('#ag-clear').click();
    assert.equal(document.querySelectorAll('#aic-chat .ag-user').length, 0);
    assert.match(q('#aic-chat #ag-log').textContent, /Hi! I can read/);
  });
  test('the ✨ shortcut stays for other pages but is hidden here; leaving the page parks the chat', async () => {
    assert.ok(q('#ag-fab').classList.contains('ag-hide'));
    document.body.classList.remove('aic-open');
    window.dispatchEvent(new window.Event('hashchange'));
    await wait(250);
    assert.equal(q('#ag-sheet').hidden, true);
    assert.equal(q('#ag-sheet').parentNode, document.body);
    assert.ok(!q('#ag-fab').classList.contains('ag-hide'), 'the shortcut is back on other pages');
    // coming back docks it again with the history kept
    document.body.classList.add('aic-open'); ui.__test.paint();
    assert.equal(q('#ag-sheet').hidden, false);
    assert.ok(q('#aic-chat').contains(q('#ag-sheet')));
  });
});
