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
    const att = q('#aic-health');
    assert.ok(att.classList.contains('aic-folded'), 'secondary card should start collapsed');
    assert.equal(q('#aic-b-health').hidden, true);
    const head = att.querySelector('.aic-sh');
    assert.equal(head.getAttribute('role'), 'button');
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.equal(head.getAttribute('aria-controls'), 'aic-b-health');
  });

  test('collapsed cards keep a real one-line summary in the header', () => {
    const sums = [...document.querySelectorAll('.aic-folded .aic-fsum')];
    assert.ok(sums.length >= 3, 'folded cards should carry summaries, got ' + sums.length);
    assert.ok(sums.every(x => x.textContent.trim().length > 0));
    const health = q('#aic-health .aic-fsum');
    if (health) assert.match(health.textContent, /^\d+ of \d+ healthy$/); // counted from the measured rows, never assumed
    const act = q('#aic-act .aic-fsum'); assert.match(act.textContent, /^\d+ events?$/);
  });

  test('summary and status core are never collapsed', () => {
    for (const id of ['#aic-sum', '#aic-core', '#aic-att', '#aic-sys', '#aic-runs']) {
      const el = q(id); if (!el) continue;
      assert.ok(!el.classList.contains('aic-fold'), id + ' must stay open');
    }
  });

  test('clicking the title opens the card, and Enter closes it again', () => {
    const head = q('#aic-health .aic-sh');
    head.click();
    assert.equal(q('#aic-b-health').hidden, false);
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.ok(!q('#aic-health').classList.contains('aic-folded'));
    head.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(q('#aic-b-health').hidden, true);
  });

  test('an opened card stays open after the page repaints', async () => {
    q('#aic-health .aic-sh').click();
    assert.equal(q('#aic-b-health').hidden, false);
    document.getElementById('aic-root').replaceChildren();
    ui.onShow(); await wait(80);
    assert.equal(q('#aic-b-health').hidden, false, 'open state must persist across repaint');
  });
});

describe('AI Center chat lives under Jarvis', () => {
  test('there is no separate chat-assistant button; the thread and the input are inline under the avatar', async () => {
    assert.equal(q('.aic-chatbtn'), null, 'separate chat button must be gone');
    assert.equal(q('.aic-cmd'), null, 'no fixed bottom bar');
    assert.ok(q('#aic-chat .aic-chatslot'), 'the one assistant chat is docked here (BTAgent.dock)');
    assert.equal(q('#aic-chat .aic-thread'), null, 'the page keeps no second thread');
    assert.equal(q('#aic-q'), null, 'the page keeps no second input');
    assert.ok(q('#aic-hero').compareDocumentPosition(q('#aic-chat')) & 4, 'chat follows the hero');
  });
});
