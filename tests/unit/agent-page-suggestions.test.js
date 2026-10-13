// Page awareness for the global Jarvis panel: which area a page belongs to, what it is called, and which starter questions it gets.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, pageName, viewingLabel, suggestionsFor, hidesButton, GENERAL_SUGGESTIONS } from '../../js/agent/core/page-suggestions.js';

describe('page suggestions', () => {
  test('pages map to Sales, Inventory, Cash, Audit and BT Intelligence; everything else is general', () => {
    for (const id of ['dashboard', 'index', 'data', 'entry', 'report', 'diff']) assert.equal(areaOf(id), 'sales', id);
    for (const id of ['inventory', 'stockledger', 'excess', 'reorder', 'inv-health', 'str', 'str-report', 'str-zero-dispatch']) assert.equal(areaOf(id), 'inventory', id);
    for (const id of ['closing-book', 'credit-ledger', 'cashdeposit', 'sale-payments']) assert.equal(areaOf(id), 'cash', id);
    assert.equal(areaOf('assignments'), 'audit'); assert.equal(areaOf('ai-center'), 'intel');
    for (const id of ['cover', 'manager', 'tools', 'nonsense', '', null, undefined]) assert.equal(areaOf(id), 'general', String(id));
    assert.equal(areaOf('page-closing-book'), 'cash', 'a page-… element id works too');
  });
  test('every area gets 3 to 4 distinct questions; unknown pages get the general four; the arrays are copies', () => {
    for (const id of ['index', 'inventory', 'closing-book', 'assignments', 'ai-center', 'cover']) {
      const s = suggestionsFor(id); assert.ok(s.length >= 3 && s.length <= 4, id); assert.equal(new Set(s).size, s.length, id);
      assert.ok(s.every(x => typeof x === 'string' && x.length > 5 && x.length < 60), id + ' chip text fits a chip');
    }
    assert.deepEqual(suggestionsFor('cover'), [...GENERAL_SUGGESTIONS]);
    const a = suggestionsFor('index'); a.push('x'); assert.ok(!suggestionsFor('index').includes('x'));
    assert.ok(suggestionsFor('closing-book').includes('What is blocking closing?'));
  });
  test('readable names for the "Viewing" line', () => {
    assert.equal(viewingLabel('closing-book'), 'Cash · Closing Book');
    assert.equal(viewingLabel('index'), 'Sales · Sale Data');
    assert.equal(viewingLabel('ai-center'), 'BT Intelligence');
    assert.equal(viewingLabel('tools'), 'Tools');
    assert.equal(pageName('some-new-page'), 'Some New Page', 'unknown pages are title-cased, never blank');
    assert.equal(pageName(null), 'this page');
  });
  test('only the Emergency Billing counter screen hides the button', () => {
    assert.equal(hidesButton('emergency-billing'), true); assert.equal(hidesButton('page-emergency-billing'), true);
    for (const id of ['index', 'cover', 'ai-center', null]) assert.equal(hidesButton(id), false, String(id));
  });
});
