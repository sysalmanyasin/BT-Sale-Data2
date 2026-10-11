// BT AI CENTER — rendered for real in jsdom against the REAL tool registry (with stub tool bodies),
// the real telemetry layer and the real model. Checks the promises in the spec: real data only,
// honest unavailable/error states, no invented activity, escaped HTML, mode filtering.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {};

const reg = await import('../../js/agent/core/tool-registry.js');
const T = await import('../../js/agent/core/telemetry.js');

const world = { fail: false, msg: 'Cash DIFF Rs 12,000 on 06/Oct/2026.', str: true };
const rd = (name, domain, run) => reg.registerTool({ name, domain, risk: 'read', description: name, parameters: { type: 'object', properties: {} }, run });
rd('daily_briefing', 'app', () => {
  if (world.fail) throw new Error('Sales data is not loaded.');
  return { date: '07/Oct/2026', last_sales_entry: { date: '06/Oct/2026', total_sale: 410000, days_ago: 1 }, missing_sales_days: 0,
    attention: [{ level: 'warn', area: 'sales', message: world.msg }, { level: 'good', area: 'target', message: 'On pace for the October 2026 target.' }],
    inventory: null, credit: { month: 'October 2026', carried_over_total: 5000, possible_duplicates: 0 }, needs_action: 1 };
});
rd('get_target_pace', 'sales', () => ({ month: 'October 2026', target: 1000000, sold_so_far: 300000, pct_done: 30, remaining: 700000, days_left: 20, needed_per_day: 35000, actual_per_day: 38000, on_track: true }));
rd('closing_recent_days', 'closing', () => ({ days: [{ date: '2026-10-07', shifts: [], closed: 2, net_sale_total: 300000 }], incomplete_days: [] }));
rd('str_overview', 'str', () => { if (!world.str) throw new Error('STR data is not loaded yet. Open the STR page once, then ask again.'); return { total: 5, awaited: { all: 1 }, dispatched_not_received: { all: 2 }, received: 2, oldest_open: { str: 'STR-1', age_days: 4, stage: 'awaited' } }; });
rd('list_pending_strs', 'str', () => ({ matching: 0, showing: 0, items: [] }));
rd('get_daily_sales', 'sales', () => ({ date: '06/Oct/2026', total_sale: 410000, diff: 12000, cash_sale: 200000, bank_total: 150000, credit_total: 60000 }));

const ui = await import('../../js/ai-center/ui.js');
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
const text = () => document.getElementById('aic-root').textContent;
const q = s => document.querySelector(s);

describe('AI Center page', () => {
  before(async () => { ui.onShow(); await wait(80); });

  test('shows real values from the tools, in all six systems', () => {
    assert.match(text(), /BT INTELLIGENCE/);
    ['SALES', 'CASH', 'INVENTORY', 'STAFF', 'STR', 'CLOSING'].forEach(s => assert.ok(text().includes(s), s + ' card missing'));
    assert.match(text(), /Cash DIFF Rs 12,000/);
    assert.match(text(), /Rs 12,000/); // CASH metric from get_daily_sales
    assert.match(text(), /410,000/);
  });
  test('hero: just the avatar and one live status pill (nothing else under the avatar)', async () => {
    const hero = q('#aic-hero');
    assert.ok(hero, 'hero card missing');
    assert.ok(hero.querySelector('#aic-core svg.aic-avatar'), 'avatar lives in the hero');
    assert.equal(document.querySelectorAll('svg.aic-avatar').length, 1, 'exactly one avatar on the page');
    assert.match(hero.querySelector('.aic-hpill').textContent, /^Jarvis (online|offline)$/);
    assert.equal(hero.querySelectorAll('.aic-hbtn, .aic-hbub p, .aic-avset, .aic-mission, .aic-lifed').length, 0, 'greeting, quick buttons, avatar buttons, mission and lifecycle are gone from under the avatar');
    assert.ok(hero.querySelector('.aic-cs.aic-sr h2'), 'the state is still available to screen readers');
  });
  test('Command Deck: six tabs, Overview shows the key cards and other tabs hide them', async () => {
    const tabs = [...document.querySelectorAll('#aic-tabs [role=tab]')];
    assert.deepEqual(tabs.map(b => b.getAttribute('data-tab')), ['overview', 'sales', 'inventory', 'operations', 'audit', 'more']);
    assert.equal(tabs.filter(b => b.getAttribute('aria-selected') === 'true').length, 1);
    const visible = () => [...document.querySelectorAll('.aic-main > [data-tabs]:not([data-off])')].map(n => n.id);
    ui.__test.setTab('overview');
    for (const id of ['aic-dktiles', 'aic-dkatt', 'aic-dksales', 'aic-dkinv', 'aic-dkmoney', 'aic-dkappr', 'aic-dkops']) assert.ok(visible().includes(id), id + ' on Overview');
    assert.ok(!visible().includes('aic-fc'));
    ui.__test.setTab('inventory'); assert.ok(visible().includes('aic-invstr') && !visible().includes('aic-dktiles'));
    ui.__test.setTab('operations'); assert.ok(visible().includes('aic-ops') && visible().includes('aic-actc'));
    ui.__test.setTab('sales'); assert.ok(visible().includes('aic-dkgame'), 'Forecast Game card on Sales'); assert.match(document.querySelector('#aic-dkgame').textContent, /AI Forecast Game/);
    ui.__test.setTab('audit'); for (const id of ['aic-dkaudit', 'aic-dkexp', 'aic-dkpay']) assert.ok(visible().includes(id), id + ' on Audit');
    assert.ok(!visible().includes('aic-dktiles'));
    ui.__test.setTab('nonsense'); assert.equal(ui.__test.S.tab, 'overview');
  });
  test('Command Deck cards render real snapshot numbers', async () => {
    const S0 = ui.__test.S, keep = S0.snap;
    S0.snap = { at: Date.now(), findings: [], systems: {}, forecast: { available: false, reason: 'x' }, errors: {}, raw: {
      briefing: { last_sales_entry: { total_sale: 509669, date: '2026-10-11' }, inventory: { out_of_stock_but_selling: 7, running_out_within_7_days: 3 } }, pace: { pct_done: 32 },
      planning: { weekday: { weekday_baseline: [{ weekday: 'Monday', avg: 200000 }], today: { weekday: 'Monday' } }, fill: { fill_rate_pct: 90.1, line_fill_pct: 80, zero_dispatch_lines: 1, short_lines: 2, receipt_accuracy_pct: null, awaiting_dispatch: { count: 0, oldest_age_days: null }, by_source: [], worst_products: [], note: 'n' } }, deck: { inv: { totalSkus: 10, inStock: 6, outOfStock: 4, stockValue: 1, avgCoverDays: 5, notSold90: { count: 0, value: 0 } } } } };
    ui.__test.paint();
    assert.equal(document.querySelectorAll('#aic-dktiles .dk-tile').length, 6);
    assert.match(document.querySelector('#aic-dktiles [data-tile=sales]').textContent, /Rs 509,669/);
    assert.equal(document.querySelectorAll('#aic-dksales .dk-bars li').length, 1);
    assert.match(document.querySelector('#aic-dkinv').textContent, /Stock-Out Items/);
    document.querySelector('#aic-dktiles [data-tile=risk]').click();
    assert.equal(ui.__test.S.tab, 'inventory');
    ui.__test.setTab('overview'); S0.snap = keep; ui.__test.paint();
  });
  test('tapping the avatar opens its settings: photo, face and voice controls', async () => {
    const orb = q('#aic-hero .aic-orb');
    assert.equal(orb.getAttribute('role'), 'button');
    orb.click();
    const m = q('.aic-modal');
    assert.ok(m, 'settings sheet opens');
    assert.match(m.getAttribute('aria-label'), /avatar/i);
    assert.ok(m.querySelector('input[type=file]'), 'photo upload');
    assert.ok(m.querySelector('.jv-set-prev svg.aic-avatar'), 'live preview');
    assert.ok([...m.querySelectorAll('.jv-set-l')].some(e => /Move while talking/.test(e.textContent)), 'animation toggle');
    q('.aic-x').click();
    assert.equal(q('.aic-modal'), null);
  });
  test('Ask Jarvis is a collapsed card that opens when a question is asked', async () => {
    const chat = q('#aic-chat');
    assert.ok(chat.classList.contains('aic-fold') && chat.classList.contains('aic-folded'), 'collapsed by default');
    assert.equal(chat.querySelector('.aic-sh h2').textContent, 'ASK JARVIS');
    assert.equal(chat.querySelector('.aic-sh').getAttribute('aria-expanded'), 'false');
    window.BTAgent = { ask: () => Promise.resolve(), isBusy: () => false, open() {}, writesAllowed: () => false, killed: () => false };
    ui.__test.ask('What needs my attention?');
    assert.equal(ui.__test.S.open.chat, true, 'asking opens the chat');
    ui.__test.paint();
    assert.equal(q('#aic-chat .aic-sh').getAttribute('aria-expanded'), 'true');
    delete window.BTAgent;
    ui.__test.S.open.chat = false; ui.__test.paint();
  });

  test('Jarvis speaking: the voice-state event animates the avatar and the status pill, and clears again', async () => {
    window.dispatchEvent(new window.CustomEvent('bt-voice-state', { detail: { speaking: true } }));
    assert.equal(q('#aic-hero .aic-stage').getAttribute('data-talk'), '1');
    assert.equal(q('.aic-hpill').textContent, 'Jarvis speaking');
    window.dispatchEvent(new window.CustomEvent('bt-voice-state', { detail: { speaking: false } }));
    assert.equal(q('#aic-hero .aic-stage').getAttribute('data-talk'), '0');
    assert.match(q('.aic-hpill').textContent, /^Jarvis (online|offline)$/);
    assert.ok(q('#aic-chat'), 'the chat card is under Jarvis');
  });

  test('JARVIS layer: page is themed, SVG avatar is decorative, state text stays real DOM text', async () => {
    assert.ok(q('#page-ai-center').classList.contains('aic-jarvis'));
    const av = q('#aic-core .aic-orb svg.aic-avatar');
    assert.ok(av, 'avatar svg missing');
    assert.equal(av.getAttribute('aria-hidden'), 'true');
    assert.ok(av.querySelector('.jv-head .jv-skin') && av.querySelector('.jv-eye') && av.querySelector('.jv-mouth'), 'drawn face with eyes and a mouth');
    assert.equal(av.querySelectorAll('image').length, 0, 'no photo unless the person set one on this device');
    assert.equal(av.querySelectorAll('.jv-r').length, 0, 'no sci-fi HUD rings');
    const ids = [...av.querySelectorAll('[id]')].map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, 'avatar defs have unique ids');
    assert.ok(ids.every(id => document.querySelectorAll('[id="' + id + '"]').length === 1), 'ids unique in the whole document');
    assert.equal(document.querySelectorAll('#aic-core .aic-avatar').length, 1, 'no duplicate avatar after repaint');
    assert.ok(q('#aic-core .aic-cs h2').textContent.trim().length > 0, 'lifecycle label must be real text');
    assert.equal(q('#aic-core .aic-stage').getAttribute('data-s'), q('#aic-core .aic-cs h2').textContent.trim().toLowerCase().replace(/ /g, '_'));
  });
  test('Agent Fleet: one tile per registered specialist, no invented activity', () => {
    const tiles = [...document.querySelectorAll('#aic-fleet .aic-ftile')];
    assert.equal(tiles.length, 8); // sales, manager, inventory, str, closing, billing, documents, analyst
    assert.ok(tiles.every(t => t.getAttribute('aria-label') && t.dataset.agent));
    assert.ok(tiles.every(t => !t.classList.contains('on')), 'nothing is ACTIVE while no request is running');
    assert.equal(document.querySelectorAll('[id="aic-fleet"]').length, 1, 'no duplicate ids');
  });
  test('Agent Fleet: folded with a real summary; each tile says what it is for and offers a one-tap question', async () => {
    const fleet = document.getElementById('aic-fleet');
    assert.ok(fleet.classList.contains('aic-folded'), 'fleet is collapsed by default');
    assert.match(fleet.querySelector('.aic-fsum').textContent, /ready · none running|running now/);
    const tiles = [...document.querySelectorAll('#aic-fleet .aic-ftile')];
    assert.ok(tiles.every(t => t.querySelector('.aic-fjob') && t.querySelector('.aic-fjob').textContent.trim().length > 3), 'plain-language job line');
    assert.ok(tiles.every(t => t.querySelector('.aic-fask') && /^Ask: /.test(t.querySelector('.aic-fask').textContent)), 'quick question button');
    assert.ok(tiles.some(t => t.classList.contains('idle')), 'tiles with no runs are visually quieter');
    const asked = [];
    window.BTAgent = { ask: s2 => { asked.push(s2); return Promise.resolve(); }, isBusy: () => false, open() {}, writesAllowed: () => false, killed: () => false };
    document.querySelector('#aic-fleet .aic-ftile[data-agent="closing"] .aic-fask').click();
    assert.deepEqual(asked, ['What is blocking closing?']);
    delete window.BTAgent;
  });
  test('Recent Runs is its own always-open card, separate from the fleet', () => {
    const runs = document.getElementById('aic-runs');
    assert.ok(runs && !runs.classList.contains('aic-fold'));
    assert.equal(runs.querySelector('.aic-sh h2').textContent, 'RECENT RUNS');
    assert.equal(document.querySelectorAll('#aic-fleet .aic-runs').length, 0);
  });
  test('unavailable data is DATA_UNAVAILABLE with its real reason, not "healthy"', () => {
    const inv = [...document.querySelectorAll('.aic-snap-tile')].find(e => e.textContent.includes('INVENTORY'));
    assert.match(inv.textContent, /DATA_UNAVAILABLE/); assert.match(inv.textContent, /Open the Inventory page/);
  });
  test('no invented activity: only the AI Center\'s own reads exist, and they are labelled as such', () => {
    const evs = T.recent(500);
    assert.ok(evs.length > 0);
    assert.ok(evs.every(e => e.source === 'ai-center'), 'no agent events may exist before BT is asked anything');
    assert.equal(T.liveState().open, null);
    ui.__test.S.mode = 'investigate'; ui.__test.paint(); // mission + lifecycle now live under Operations & Diagnostics
    assert.match(q('#aic-ops').textContent, /No active mission/);
    assert.match(q('.aic-cs h2').textContent, /READY/);
  });
  test('repository intelligence says it is not connected', () => {
    ui.__test.S.mode = 'investigate'; ui.__test.paint();
    assert.match(q('#aic-repo').textContent, /NOT CONNECTED/);
  });
  test('verify lifecycle step is real but not lit without a real verify event', () => {
    const v = [...document.querySelectorAll('.aic-life li')].find(li => li.textContent === 'Verify');
    assert.ok(!v.classList.contains('na')); assert.ok(!v.classList.contains('on'));
  });
  test('health rows are measured; unmeasured subsystems stay NOT MEASURED', () => {
    ui.__test.S.mode = 'investigate'; ui.__test.paint(); // system health lives on the Investigate tab
    const t = q('#aic-health').textContent;
    assert.match(t, /Realtime/); assert.match(t, /not available in this view|not started|channel/i);
    assert.match(t, /not claimed|cannot be measured|Not guessed/); // Edge Functions have no heartbeat: stated, not invented
  });
  test('one front page: essentials always open, secondary cards fold', async () => {
    const open = ['aic-sys', 'aic-core', 'aic-runs', 'aic-actc'], folded = ['aic-health', 'aic-repo', 'aic-fleet'];
    open.forEach(id => { const el = document.getElementById(id); assert.ok(el, id); assert.ok(!el.classList.contains('aic-fold'), id + ' must not collapse'); });
    folded.forEach(id => { const el = document.getElementById(id); assert.ok(el, id + ' must be on the same page'); assert.ok(el.classList.contains('aic-folded'), id + ' should be collapsed'); });
  });
  test('Ask BT goes to the existing assistant, and nothing happens if it is not loaded', async () => {
    const asked = [];
    window.BTAgent = { ask: s => { asked.push(s); return Promise.resolve(); }, isBusy: () => false, open() {}, writesAllowed: () => false, killed: () => false };
    ui.__test.S.mode = 'monitor'; ui.__test.paint();
    ui.__test.ask('What needs my attention?');
    assert.equal(asked.length, 1);
    assert.equal(asked[0], 'What needs my attention?', 'a question goes to the one assistant');
    delete window.BTAgent;
  });
  test('finding detail: evidence is labelled by kind, no AI assessment is invented', () => {
    ui.__test.openFinding(ui.__test.S.snap.findings.find(f => f.system === 'CASH'));
    const m = q('.aic-modal').textContent;
    ['FINDING', 'IMPACT', 'EVIDENCE', 'CONFIDENCE & LIMITATIONS', 'RECOMMENDATION', 'AVAILABLE ACTIONS'].forEach(h => assert.ok(m.includes(h), h + ' section missing')); assert.match(m, /DETECTION/); assert.match(m, /Verified/);
    assert.match(m, /BT has not been asked about this yet/);
    assert.match(m, /Investigate with BT/);
    q('.aic-x').click(); assert.equal(q('.aic-modal'), null);
  });
  test('HTML in tool text is never interpreted', async () => {
    world.msg = 'Cash DIFF <img src=x onerror=alert(1)>'; await ui.__test.refresh({ force: true }); await wait(60);
    assert.equal(document.querySelectorAll('#aic-root img').length, 0);
    assert.match(text(), /<img src=x onerror=alert\(1\)>/);
  });
  test('palette opens and filters', async () => {
    ui.__test.openPalette();
    const inp = q('.aic-pin'); inp.value = 'repository'; inp.dispatchEvent(new window.Event('input'));
    assert.match(q('.aic-plist').textContent, /Search repository/); assert.match(q('.aic-plist').textContent, /Investigate/);
    q('.aic-x').click();
  });
  test('tool failure: the page keeps working and says what is unavailable', async () => {
    ui.__test.S.mode = 'monitor';
    world.str = false; await ui.__test.refresh({ force: true }); await wait(60);
    const strCard = [...document.querySelectorAll('.aic-snap-tile')].find(e => e.textContent.includes('STR'));
    assert.match(strCard.textContent, /DATA_UNAVAILABLE/); assert.match(strCard.textContent, /not loaded yet/);
    assert.match(text(), /SALES/);
  });
  test('total failure: friendly error, nothing fabricated', async () => {
    ui.__test.S.mode = 'monitor';
    world.fail = true; world.str = true; ui.__test.S.snap = null; await ui.__test.refresh({ force: true }); await wait(60);
    assert.match(text(), /Could not read business data|UNKNOWN|not loaded/i);
    assert.equal(ui.__test.S.snap && ui.__test.S.snap.findings.length ? 'has-findings' : 'none', 'none', 'no findings may be invented when the briefing cannot be read');
  });
});
