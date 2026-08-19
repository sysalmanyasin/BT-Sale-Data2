// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — js/ui.js's showPage(), the core of the "Cover is the hub"
// navigation model. This loads the REAL index.html markup into jsdom
// (not a hand-rolled stub) and runs the REAL ui.js as a classic script
// against it, then drives showPage() the same way a nav-tab click would.
// It verifies the exact domain-classification table from the README:
// each page id must set body[data-domain] to the right domain, which is
// what nav.css keys off to hide every other domain's nav and re-theme
// the accent color.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { loadClassicScript } from '../helpers/load-classic-script.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

function freshAppWindow(t) {
  const dom = new JSDOM(indexHtml, { url: 'https://bt.duapharma.com/index.html' });
  loadClassicScript('js/ui.js', dom.window);
  // ui.js starts a real setInterval(tickClock, 30000) at load time (a
  // classic-script side effect, same as it would in a browser tab) —
  // without closing the window afterwards, each test's timer keeps the
  // Node process alive and node --test never exits. t.after ties the
  // window's lifetime to the test, same as closing a browser tab.
  t.after(() => dom.window.close());
  return dom.window;
}

// Table taken directly from the README's "Navigation model" section —
// one representative page id per domain (README table + ui.js source).
const DOMAIN_TABLE = [
  ['dashboard', 'sales'],
  ['data', 'sales'],
  ['entry', 'sales'],
  ['manager', 'manager'],
  ['notesheets', 'notesheets'],
  ['closing-book', 'closing'],
  ['credit-ledger', 'closing'],
  ['assignments', 'audit'],
  ['inventory', 'inventory'],
  ['stockledger', 'inventory'],
  ['str', 'str'],
];

describe('showPage() domain classification (smoke)', () => {
  for (const [pageId, expectedDomain] of DOMAIN_TABLE) {
    test(`showPage('${pageId}') sets body[data-domain]="${expectedDomain}"`, (t) => {
      const window = freshAppWindow(t);
      assert.equal(typeof window.showPage, 'function', 'ui.js should install a global showPage()');
      assert.doesNotThrow(() => window.showPage(pageId), `showPage('${pageId}') must not throw`);
      assert.equal(
        window.document.body.dataset.domain,
        expectedDomain,
        `showPage('${pageId}') should classify into the "${expectedDomain}" domain`
      );
    });
  }

  test('Cover and Tools are cross-domain: showPage does not assign them a domain', (t) => {
    const window = freshAppWindow(t);
    window.showPage('cover');
    assert.equal(window.document.body.dataset.domain, '', 'Cover should not belong to any single domain');
  });

  test('showPage() activates the target page element and deactivates the rest', (t) => {
    const window = freshAppWindow(t);
    const { document } = window;
    window.showPage('dashboard');
    assert.ok(document.getElementById('page-dashboard').classList.contains('on'));
    window.showPage('manager');
    assert.ok(!document.getElementById('page-dashboard').classList.contains('on'), 'previous page should be deactivated');
    assert.ok(document.getElementById('page-manager').classList.contains('on'));
  });

  test('the Sale Data sub-nav is shown for sale-data pages and hidden elsewhere', (t) => {
    const window = freshAppWindow(t);
    const { document } = window;
    window.showPage('entry');
    assert.equal(document.body.classList.contains('has-bnav-sub'), true);
    window.showPage('manager');
    assert.equal(document.body.classList.contains('has-bnav-sub'), false);
  });

  test('an unknown page id does not throw and clears the domain', (t) => {
    const window = freshAppWindow(t);
    assert.doesNotThrow(() => window.showPage('this-page-does-not-exist'));
    assert.equal(window.document.body.dataset.domain, '');
  });
});
