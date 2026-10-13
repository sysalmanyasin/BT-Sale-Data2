// Forecast Game controller (side effects live here; the maths is js/shared/today-forecast.js).
// Every ~90 s while the app is open it: reads the live POS total, records an intraday sample, locks the AI's call for
// today (once), projects the close, settles earlier days against their final POS total, and celebrates when the live
// sale reaches the call or a finished day was called within 5%. Nothing is written to the business data.
import { DAILY } from '../config.js';
import { weekdayForecast } from '../shared/planning-metrics.js';
import * as F from '../shared/today-forecast.js';
import * as V from '../agent/ui/voice.js';
import * as AV from './avatar.js';

const LS_LOG = 'bt_sales_curve_v1', LS_GAME = 'bt_forecast_game_v1';
const ls = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode: still works this session */ } },
};
let last = null, timer = null;
export const view = () => last;

const rsF = v => 'Rs ' + Math.round(v).toLocaleString('en-PK');

// ── celebration: confetti + banner + Jarvis speaks (or his mouth moves when voice is off) ──
export function celebrate(text, { confetti = true } = {}) {
  if (typeof document === 'undefined') return;
  try {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (confetti && !reduce) {
      const box = document.createElement('div'); box.className = 'fg-confetti'; box.setAttribute('aria-hidden', 'true');
      const cols = ['#2fb4ff', '#34e8aa', '#ffb454', '#ff6b81', '#a78bfa', '#ffffff'];
      for (let i = 0; i < 70; i++) { const s = document.createElement('i'); s.style.cssText = 'left:' + Math.random() * 100 + '%;background:' + cols[i % cols.length] + ';animation-delay:' + (Math.random() * 0.8).toFixed(2) + 's;animation-duration:' + (2.2 + Math.random() * 1.8).toFixed(2) + 's;transform:rotate(' + Math.floor(Math.random() * 360) + 'deg)'; box.appendChild(s); }
      document.body.appendChild(box); setTimeout(() => box.remove(), 5200);
    }
    const b = document.createElement('div'); b.className = 'fg-banner'; b.setAttribute('role', 'status'); b.textContent = '\uD83C\uDF89 ' + text;
    document.body.appendChild(b); setTimeout(() => b.remove(), 7000);
    if (V.getVoiceOut()) V.speak(window, text, V.voiceLang());
    else { AV.setTalking(true); document.querySelectorAll('.aic-stage').forEach(el => el.setAttribute('data-talk', '1')); setTimeout(() => { AV.setTalking(false); document.querySelectorAll('.aic-stage').forEach(el => el.setAttribute('data-talk', '0')); }, 3500); }
  } catch (_) { /* a celebration must never break the page */ }
}

async function payData() {
  let d = typeof window.salePaymentsBridgeGetFullData === 'function' ? window.salePaymentsBridgeGetFullData() : null;
  if (typeof window.salePaymentsBridgeRefresh === 'function') { try { d = (await window.salePaymentsBridgeRefresh(false)) || d; } catch (_) { /* keep cached */ } }
  return d && Array.isArray(d.paymentSummary) ? d : null;
}

/** One tracking step. Safe to call any time; returns the view model (or null when there is not enough data). */
export async function tick(now = new Date(), { pay } = {}) {
  const day = F.localIso(now), minute = F.minuteOfDay(now);
  const fc = weekdayForecast({ daily: DAILY, now }), T0 = fc && fc.today;
  // Not enough same-weekday history: no call is made today, but earlier days are still settled and the scoreboard still shows.
  const T = T0 && T0.expected > 0 && T0.samples >= 2 ? T0 : { expected: 0, typical_low: 0, typical_high: 0 };
  const data = pay === undefined ? await payData() : pay;
  const row = data && data.paymentSummary.find(r => r.saleDay === day);
  const live = row ? Number(row.totalSale) || 0 : 0;

  const log = ls.get(LS_LOG, {}), game = ls.get(LS_GAME, { days: {} });
  if (live > 0 && F.recordSample(log, day, minute, live)) ls.set(LS_LOG, log);
  let dirty = F.lockPrediction(game, day, { expected: T.expected, low: T.typical_low, high: T.typical_high }, minute);

  // settle earlier days against the final POS total (the last total the sync holds for that day)
  const events = [];
  for (const r of (data ? data.paymentSummary : [])) if (r.saleDay < day) { const s = F.settleDay(game, r.saleDay, r.totalSale); if (s) { dirty = true; events.push(s); } }

  const locked = game.days[day] || null;
  const proj = F.liveProjection({ live, expected: T.expected, low: T.typical_low, high: T.typical_high, fraction: F.curveFraction(log, day, minute) });
  const status = live > 0 ? F.dayStatus({ live, locked, projected: proj.projected }) : (locked ? 'waiting_sales' : 'waiting');
  if (locked && !locked.reached && live >= locked.expected) {
    locked.reached = true; locked.reachedAtMin = minute; dirty = true;
    celebrate('Forecast reached! ' + rsF(live) + ' sold, my call was ' + rsF(locked.expected) + '.');
  }
  for (const s of events) if (s.grade === 'bullseye' || s.grade === 'hit') celebrate((s.grade === 'bullseye' ? 'Bullseye! ' : 'Nailed it! ') + 'I called ' + s.day + ' at ' + rsF(s.expected) + ' and it closed at ' + rsF(s.final) + ' (' + (s.errPct > 0 ? '+' : '') + s.errPct + '%).');
  if (dirty) ls.set(LS_GAME, game);

  const sb = F.scoreboard(game);
  last = { day, locked, live, projected: proj.projected, projLow: proj.low, projHigh: proj.high, basis: proj.basis, status,
    progressPct: locked ? Math.min(100, Math.round(live / locked.expected * 100)) : 0, hasCall: !!locked, projectedPct: locked ? Math.round(proj.projected / locked.expected * 100) : null,
    message: status === 'waiting_sales' ? 'Call locked at ' + rsF(locked.expected) + '. Waiting for today\u2019s first POS sales.' : F.coachLine(status, { live, locked, projected: proj.projected }),
    score: sb, updatedAt: now.getTime() };
  try { window.dispatchEvent(new CustomEvent('bt-forecast-game', { detail: last })); } catch (_) { /* no window */ }
  return last;
}

export function start() {
  if (timer || typeof window === 'undefined') return;
  const run = () => { tick().catch(() => {}); };
  setTimeout(run, 6000); timer = setInterval(run, 90 * 1000);
  if (timer && typeof timer.unref === 'function') timer.unref();
}
