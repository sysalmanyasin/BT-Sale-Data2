// BT AI CENTER — cards are collapsed by default; tapping a title opens/closes the card, the choice survives a repaint,
// and cards that must never be hidden (summary, status core, Action Center, latest response) stay open.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};

const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);

describe('AI Center collapsible cards', () => {
  before(async () => { ui.onShow(); await wait(80); });

  test('foldable cards start collapsed with a labelled toggle', () => {
    const att = q('#aic-att');
    assert.ok(att.classList.contains('aic-folded'), 'attention card should start collapsed');
    assert.equal(q('#aic-b-att').hidden, true);
    const head = att.querySelector('.aic-sh');
    assert.equal(head.getAttribute('role'), 'button');
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.equal(head.getAttribute('aria-controls'), 'aic-b-att');
  });

  test('summary and status core are never collapsed', () => {
    for (const id of ['#aic-sum', '#aic-core']) {
      const el = q(id); if (!el) continue;
      assert.ok(!el.classList.contains('aic-fold'), id + ' must stay open');
    }
  });

  test('clicking the title opens the card, and Enter closes it again', () => {
    const head = q('#aic-att .aic-sh');
    head.click();
    assert.equal(q('#aic-b-att').hidden, false);
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.ok(!q('#aic-att').classList.contains('aic-folded'));
    head.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(q('#aic-b-att').hidden, true);
  });

  test('an opened card stays open after the page repaints', async () => {
    q('#aic-att .aic-sh').click();
    assert.equal(q('#aic-b-att').hidden, false);
    document.getElementById('aic-root').replaceChildren();
    ui.onShow(); await wait(80);
    assert.equal(q('#aic-b-att').hidden, false, 'open state must persist across repaint');
  });
});

describe('AI Center chat assistant button', () => {
  test('the command bar has an Open chat assistant button that calls BTAgent.open', async () => {
    let opened = 0;
    window.BTAgent = { open: () => { opened++; } };
    const b = q('.aic-chatbtn');
    assert.ok(b, 'chat button missing');
    assert.equal(b.getAttribute('aria-label'), 'Open chat assistant');
    b.click();
    assert.equal(opened, 1);
  });
});
