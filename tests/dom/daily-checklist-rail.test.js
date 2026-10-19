// Daily Check List — desktop "Jump to" side menu (sticky rail). Renders the REAL page in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div id="page-dailychecklist"></div></body></html>');
const w = globalThis.window;
await import('../../js/daily-checklist.js');

test('rail lists every section in a labelled nav', () => {
  resetStorage(); w.loadDailyChecklistPage();
  const rail = document.getElementById('dcl-rail');
  assert.equal(rail.getAttribute('aria-label'), 'Checklist sections');
  const links = rail.querySelectorAll('#dcl-rail-list a');
  const secs = document.querySelectorAll('#page-dailychecklist .dcl-sec');
  assert.ok(secs.length > 10);
  assert.equal(links.length, secs.length);
});

test('every rail link targets an existing section, and exactly one is marked current', () => {
  const links = [...document.querySelectorAll('#dcl-rail a')];
  for (const a of links) assert.ok(document.querySelector(a.getAttribute('href')), a.getAttribute('href') + ' exists');
  assert.equal(links.filter((a) => a.classList.contains('active')).length, 1);
  assert.equal(links.filter((a) => a.getAttribute('aria-current') === 'location').length, 1);
});
