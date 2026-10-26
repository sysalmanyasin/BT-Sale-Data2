// Regression: index.html loads dom-actions.js as `dom-actions.js?v=hash` while other modules import it bare. A browser
// treats those as two module copies. Each copy used to install its own click listener and keep its own registry, so
// window-path actions (e.g. BTNavSections._tap) fired twice and toggles opened and closed in the same tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<button id="b" data-on-click="window.hit"></button><button id="r" data-on-click="reg"></button>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const A = await import('../../js/shared/dom-actions.js?copy=a');
const B = await import('../../js/shared/dom-actions.js?copy=b');

test('two module copies install exactly one listener: a window-path action runs once per click', () => {
  let hits = 0;
  window.hit = () => { hits++; };
  document.getElementById('b').click();
  assert.equal(hits, 1);
});

test('copies share one registry: an action registered through either copy runs once', () => {
  let hits = 0;
  A.registerActions({ reg() { hits++; } });
  document.getElementById('r').click();
  assert.equal(hits, 1);
  assert.equal(B.hasAction('reg'), true);
});
