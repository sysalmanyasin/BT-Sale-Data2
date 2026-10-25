// Summary / Detailed Cover — drives the REAL cover-dashboard.js against the REAL index.html markup in jsdom.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let mod, d;
const VIEW_KEY = 'bt_cover_view_v1';

describe('Cover Summary / Detailed view', () => {
  before(async () => {
    installDomEnv(html);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
    window.fetch = globalThis.fetch;
    d = document;
    // closing-bridge.js starts real setIntervals at import time (polling); unref them so the test process can exit.
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = (...a) => { const t = realSetInterval(...a); if (t && t.unref) t.unref(); return t; };
    try { mod = await import('../../js/cover/cover-dashboard.js'); } finally { globalThis.setInterval = realSetInterval; }
  });
  after(() => { window.close(); });

  test('defaults to Summary with one tile per rendered group', () => {
    resetStorage();
    mod.renderCoverDashboard();
    assert.equal(d.getElementById('page-cover').dataset.view, 'summary');
    const groups = [...d.querySelectorAll('#cover-container > .cover-group')].map((g) => g.dataset.group).sort();
    const tiles = [...d.querySelectorAll('.cover-deck-tile')].map((t) => t.dataset.group).sort();
    assert.equal(groups.length, 8);
    assert.deepEqual(tiles, groups);
    assert.equal(d.getElementById('cover-deck').getAttribute('aria-busy'), null);
    assert.equal(d.querySelectorAll('.cover-skel-tile').length, 0, 'skeleton tiles must be replaced');
  });

  test('tapping a tile opens that section as a sheet, and close / Escape / backdrop dismiss it', () => {
    d.querySelector('[data-deck-open="manager"]').click();
    const open = d.querySelectorAll('.cover-group.deck-open');
    assert.equal(open.length, 1);
    assert.equal(open[0].dataset.group, 'manager');
    assert.ok(d.getElementById('cover-sheet-backdrop').classList.contains('on'));

    d.querySelector('.deck-open [data-sheet-close]').click();
    assert.equal(d.querySelectorAll('.cover-group.deck-open').length, 0);
    assert.ok(!d.getElementById('cover-sheet-backdrop').classList.contains('on'));

    d.querySelector('[data-deck-open="sales"]').click();
    d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(d.querySelectorAll('.cover-group.deck-open').length, 0);

    d.querySelector('[data-deck-open="audit"]').click();
    d.getElementById('cover-sheet-backdrop').click();
    assert.equal(d.querySelectorAll('.cover-group.deck-open').length, 0);
  });

  test('opening a second tile replaces the first sheet (never two at once)', () => {
    d.querySelector('[data-deck-open="sales"]').click();
    d.querySelector('[data-deck-open="notes"]').click();
    const open = [...d.querySelectorAll('.cover-group.deck-open')].map((g) => g.dataset.group);
    assert.deepEqual(open, ['notes']);
    d.querySelector('.deck-open [data-sheet-close]').click();
  });

  test('an open sheet survives a re-render (bridge refresh / refresh button)', () => {
    d.querySelector('[data-deck-open="closing"]').click();
    mod.renderCoverDashboard();
    const open = [...d.querySelectorAll('.cover-group.deck-open')].map((g) => g.dataset.group);
    assert.deepEqual(open, ['closing']);
    d.querySelector('.deck-open [data-sheet-close]').click();
  });

  test('in Summary a group header does not change the saved collapse state', () => {
    const before = localStorage.getItem('bt_cover_collapsed_v1');
    d.querySelector('[data-deck-open="reports"]').click();
    d.querySelector('.deck-open .cover-group-header').click();
    assert.equal(localStorage.getItem('bt_cover_collapsed_v1'), before);
    d.querySelector('.deck-open [data-sheet-close]').click();
  });

  test('Detailed toggle switches view, closes any sheet, and persists across a re-render', () => {
    d.querySelector('[data-deck-open="sales"]').click();
    d.querySelector('[data-cover-view="detailed"]').click();
    assert.equal(d.getElementById('page-cover').dataset.view, 'detailed');
    assert.equal(d.querySelectorAll('.cover-group.deck-open').length, 0);
    assert.equal(localStorage.getItem(VIEW_KEY), 'detailed');
    assert.equal(d.querySelector('[data-cover-view="detailed"]').getAttribute('aria-pressed'), 'true');
    mod.renderCoverDashboard();
    assert.equal(d.getElementById('page-cover').dataset.view, 'detailed');
    assert.equal(d.querySelectorAll('#cover-container > .cover-group').length, 8, 'Detailed keeps every group');
  });

  test('Summary toggle returns to the short view', () => {
    d.querySelector('[data-cover-view="summary"]').click();
    assert.equal(d.getElementById('page-cover').dataset.view, 'summary');
    assert.equal(localStorage.getItem(VIEW_KEY), 'summary');
  });
});
