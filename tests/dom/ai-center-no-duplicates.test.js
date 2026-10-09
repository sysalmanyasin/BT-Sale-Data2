// BT INTELLIGENCE — every card is rendered exactly once in every mode (a phone screenshot showed Since your last
// visit / Agent network / System health twice on Investigate).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};

const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe('BT Intelligence: no duplicated cards', () => {
  before(async () => { ui.onShow(); await wait(80); });

  for (const mode of ['Monitor', 'Investigate', 'Act']) {
    test(mode + ' mode renders each card id once', async () => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === mode);
      assert.ok(btn, mode + ' tab missing');
      btn.click(); await wait(60);
      const ids = [...document.querySelectorAll('.aic-main > section')].map(s => s.id);
      assert.ok(ids.length > 0);
      assert.deepEqual(ids, [...new Set(ids)], 'duplicate card ids: ' + ids.join(','));
      for (const id of ids) assert.equal(document.querySelectorAll('#' + id).length, 1, id);
    });
  }
});
