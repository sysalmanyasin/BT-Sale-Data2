// Today's forecast + the Forecast Game, as a READ tool. Data comes from the same controller the Sales tab uses.
import { registerTool } from '../core/tool-registry.js';
import { view, tick } from '../../ai-center/forecast-game.js';

registerTool({
  name: 'todays_forecast', domain: 'sales', risk: 'read',
  description: 'Today\'s sale forecast and how we are tracking against it: the locked AI call (with range), the live POS sale so far, projected close, status (reached / ahead / on track / behind), plus the Forecast Game scoreboard (streak, hits, bullseyes, points, recent results). Use for "how are we doing today", "will we hit the forecast", "forecast game score".',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    let v = view(); if (!v || Date.now() - v.updatedAt > 120000) { try { v = await tick(); } catch (_) { /* fall through */ } }
    if (!v || !v.locked) throw new Error('Not enough sales history to forecast today yet (needs at least 2 earlier same-weekday entries).');
    return { date: v.day, ai_call: v.locked ? { expected: v.locked.expected, range_low: v.locked.low, range_high: v.locked.high } : null, sold_so_far: Math.round(v.live),
      projected_close: v.projected, projected_range: [v.projLow, v.projHigh], basis: v.basis, status: v.status, percent_of_call_done: v.progressPct, message: v.message,
      game: { ...v.score, scoring: 'Bullseye (within 2%) = 3 pts, Hit (within 5%) = 2, Close (within 10%) = 1' } };
  },
});
