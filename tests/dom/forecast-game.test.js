// Controller end to end: locks one call, tracks live sales, celebrates ONCE when reached, settles + celebrates a good call next day.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
window.matchMedia = () => ({ matches: true });  // reduced motion: banner only, no confetti

describe('Forecast Game controller', () => {
  let FG, CFG, store;
  before(async () => {
    store = {}; const mem = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true }); Object.defineProperty(window, 'localStorage', { value: mem, configurable: true });
    CFG = await import('../../js/platform/config.js'); FG = await import('../../js/ai-center/forecast-game.js');
    // 8 earlier Sundays-in-October-style history: every Sunday sold 500,000 (Mon..Sat filler irrelevant)
    for (const d of ['04/Oct/2026', '27/Sep/2026', '20/Sep/2026', '13/Sep/2026']) CFG.DAILY.push({ Date: d, TOTAL: 500000, Month_Year: 'x' });
  });
  const pay = (day, total, extra = []) => ({ paymentSummary: [{ saleDay: day, totalSale: total, cashSale: 0, cardSale: total, creditSale: 0 }, ...extra], creditByCustomer: [] });
  const banners = () => document.querySelectorAll('.fg-banner').length;

  test('locks the call, tracks, and celebrates exactly once when the sale reaches it', async () => {
    const sun = new Date(2026, 9, 11, 15, 0);                       // Sunday 11 Oct 2026, 3 pm local
    let v = await FG.tick(sun, { pay: pay('2026-10-11', 200000) });
    assert.ok(v && v.locked && v.locked.expected === 500000, 'call locked from the Sunday history');
    assert.equal(v.status === 'ahead' || v.status === 'on_track' || v.status === 'behind', true); assert.equal(banners(), 0);
    v = await FG.tick(new Date(2026, 9, 11, 21, 0), { pay: pay('2026-10-11', 505000) });
    assert.equal(v.status, 'reached'); assert.equal(banners(), 1);
    await FG.tick(new Date(2026, 9, 11, 21, 30), { pay: pay('2026-10-11', 520000) });
    assert.equal(banners(), 1, 'no second celebration for the same day');
    assert.equal(JSON.parse(store.bt_forecast_game_v1).days['2026-10-11'].expected, 500000, 'the call is never changed after the fact');
  });
  test('next day: settles against the final total and celebrates a call within 5%', async () => {
    const before = banners();
    const v = await FG.tick(new Date(2026, 9, 12, 10, 0), { pay: pay('2026-10-12', 0, [{ saleDay: '2026-10-11', totalSale: 512000, cashSale: 0, cardSale: 0, creditSale: 0 }]) });
    assert.equal(v.score.played, 1); assert.equal(v.score.recent[0].grade, 'hit');
    assert.equal(banners(), before + 1);
  });
});
