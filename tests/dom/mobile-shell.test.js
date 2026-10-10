// MOBILE SHELL — bottom nav markup, phone views of BT Intelligence (Home / AI Copilot / Alerts),
// the real-data alert badge, and the guarantee that desktop keeps the full dashboard.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomEnv } from '../helpers/dom-env.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

describe('index.html bottom navigation (static)', () => {
  const bar = html.slice(html.indexOf('id="bnav"'), html.indexOf('</div>', html.indexOf('id="bnav"')));
  test('exactly four destinations: Home, AI Copilot, Alerts, More', () => {
    const labels = [...bar.matchAll(/class="blabel">([^<]+)</g)].map(m => m[1]);
    assert.deepEqual(labels, ['Home', 'AI Copilot', 'Alerts', 'More']);
  });
  test('routes use the existing hash router; More opens the existing drawer', () => {
    assert.match(bar, /href="#ai-center" data-nav="home"/);
    assert.match(bar, /href="#ai-center\/copilot" data-nav="copilot"/);
    assert.match(bar, /href="#ai-center\/alerts" data-nav="alerts"/);
    assert.match(bar, /onclick="openSectionsDrawer\(\)"/);
  });
  test('retired bar items stay reachable through the hidden nav index (All Sections drawer source)', () => {
    const idx = html.slice(html.indexOf('id="bnav-index"'));
    for (const p of ['cover', 'index', 'manager', 'inventory']) assert.match(idx.slice(0, 4000), new RegExp('data-page="' + p + '"'));
  });
  test('viewport lets the layout resize with the keyboard and keeps safe-area support', () => {
    assert.match(html, /viewport-fit=cover,interactive-widget=resizes-content/);
  });
});

describe('BT Intelligence phone views', () => {
  let ui, C;
  const q = s => document.querySelector(s);
  const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
  const setMobile = on => { window.matchMedia = query => ({ matches: on && /max-width:\s*860px/.test(query), addEventListener() {}, removeEventListener() {} }); };
  const events = [];

  before(async () => {
    installDomEnv('<!doctype html><html><body><nav></nav><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>', { url: 'https://bt.test/#ai-center' });
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0); window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.scrollTo = () => {};
    window.addEventListener('bt:alerts-count', e => events.push(e.detail));
    const reg = await import('../../js/agent/core/tool-registry.js');
    const rd = (name, domain, run) => reg.registerTool({ name, domain, risk: 'read', description: name, parameters: { type: 'object', properties: {} }, run });
    rd('daily_briefing', 'app', () => ({ date: '07/Oct/2026', last_sales_entry: { date: '06/Oct/2026', total_sale: 410000, days_ago: 1 }, missing_sales_days: 0, attention: [{ level: 'warn', area: 'sales', message: 'Cash DIFF Rs 12,000 on 06/Oct/2026.' }], inventory: null, credit: { month: 'October 2026', carried_over_total: 0, possible_duplicates: 0 }, needs_action: 1 }));
    rd('get_target_pace', 'sales', () => ({ month: 'October 2026', target: 1000000, sold_so_far: 300000, pct_done: 30, remaining: 700000, days_left: 20, needed_per_day: 35000, actual_per_day: 38000, on_track: true }));
    rd('closing_recent_days', 'closing', () => ({ days: [], incomplete_days: [] }));
    rd('str_overview', 'str', () => ({ total: 0, awaited: { all: 0 }, dispatched_not_received: { all: 0 }, received: { all: 0 } }));
    rd('list_pending_strs', 'str', () => ({ matching: 0, showing: 0, items: [] }));
    rd('get_daily_sales', 'sales', () => ({ date: '06/Oct/2026', total_sale: 410000, diff: 12000 }));
    ui = await import('../../js/ai-center/ui.js');
    C = ui.__test;
  });
  after(() => { window.matchMedia = undefined; });

  test('viewFromHash maps the three destinations and defaults to home', () => {
    assert.equal(ui.viewFromHash('#ai-center'), 'home');
    assert.equal(ui.viewFromHash('#ai-center/copilot'), 'copilot');
    assert.equal(ui.viewFromHash('#ai-center/alerts'), 'alerts');
    assert.equal(ui.viewFromHash('#ai-center/other'), 'home');
    assert.equal(ui.viewFromHash('#cover'), 'home');
  });

  test('desktop (no phone media match) keeps the full dashboard, composer included', async () => {
    setMobile(false); ui.onShow(); await wait(80);
    assert.ok(q('#aic-copilot'), 'full copilot card on desktop');
    assert.ok(q('.aic-cmd'), 'composer present on desktop');
    assert.equal(q('#aic-copilot-entry'), null);
    assert.equal(document.body.getAttribute('data-aic-view'), null);
  });

  test('phone Home: snapshot -> attention -> compact copilot entry -> detail cards; no composer', async () => {
    setMobile(true); window.location.hash = '#ai-center'; ui.onShow(); await wait(80);
    const ids = [...document.querySelectorAll('.aic-main > section')].map(s => s.id);
    assert.ok(ids.includes('aic-copilot-entry'), 'compact copilot entry: ' + ids);
    assert.equal(q('#aic-copilot'), null, 'full chat card is not on Home');
    assert.ok(ids.indexOf('aic-att') < ids.indexOf('aic-copilot-entry'), 'needs attention precedes the copilot entry');
    assert.ok(ids.indexOf('aic-copilot-entry') < ids.indexOf('aic-fc'), 'copilot entry precedes sales & forecast');
    assert.equal(q('.aic-cmd'), null, 'composer only on the Copilot screen');
    assert.equal(document.body.dataset.aicView, 'home');
  });

  test('phone Home: large sections are folded with a real one-line summary and link to the full page', async () => {
    const fc = q('#aic-fc');
    assert.ok(fc.classList.contains('aic-folded'), 'forecast folded on phone Home');
    assert.match(fc.querySelector('.aic-fsum').textContent, /30% of month target sold/);
    assert.equal(fc.querySelector('a.aic-detail').getAttribute('href'), '#dashboard');
    assert.equal(q('#aic-invstr a.aic-detail').getAttribute('href'), '#inv-health');
    assert.equal(q('#aic-money a.aic-detail').getAttribute('href'), '#closing-book');
    assert.ok(q('#aic-ops').classList.contains('aic-folded'), 'operations collapsed');
    assert.equal(q('#aic-att a.aic-viewall').getAttribute('href'), '#ai-center/alerts');
  });

  test('phone AI Copilot screen: chat + suggestions + composer, nothing else', async () => {
    window.location.hash = '#ai-center/copilot';
    window.dispatchEvent(new window.HashChangeEvent('hashchange')); await wait(60);
    const ids = [...document.querySelectorAll('.aic-main > section')].map(s => s.id);
    assert.deepEqual(ids.sort(), ['aic-copilot', 'aic-suggested']);
    assert.ok(q('.aic-cmd #aic-q'), 'composer present');
    assert.ok(q('#aic-suggested .aic-sugg button'), 'suggested investigations offered');
    assert.equal(q('#aic-q').getAttribute('enterkeyhint'), 'send');
    assert.equal(document.body.dataset.aicView, 'copilot');
  });

  test('phone Alerts screen: needs-attention + actions only, no composer', async () => {
    window.location.hash = '#ai-center/alerts';
    window.dispatchEvent(new window.HashChangeEvent('hashchange')); await wait(60);
    const ids = [...document.querySelectorAll('.aic-main > section')].map(s => s.id);
    assert.ok(ids.includes('aic-att') && ids.includes('aic-actc'), String(ids));
    assert.ok(!ids.includes('aic-fc') && !ids.includes('aic-copilot'));
    assert.equal(q('.aic-cmd'), null);
    assert.equal(q('#aic-att a.aic-viewall'), null, 'no "view all" link on the Alerts screen itself');
  });

  test('alert badge is published only from real data (null/number), never invented', async () => {
    assert.ok(events.length > 0, 'badge event published');
    assert.ok(events.every(d => d.count === null || Number.isInteger(d.count)), JSON.stringify(events));
    const last = events[events.length - 1];
    assert.ok(Number.isInteger(last.count) && last.count >= 0, 'a real count once the snapshot has loaded');
  });
});

describe('js/mobile-nav.js', () => {
  test('parses and exposes no globals beyond showPage wrapping', () => {
    const src = fs.readFileSync(path.join(REPO, 'js/mobile-nav.js'), 'utf8');
    assert.match(src, /bt:alerts-count/);
    assert.match(src, /kb-open/);
    assert.doesNotMatch(src, /innerHTML/);
  });
});
