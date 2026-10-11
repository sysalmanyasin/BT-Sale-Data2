// Today's-sale forecast + the "Forecast Game" scoring. PURE: no DOM, no storage, no clock (callers pass `now`/minutes).
// The forecast starts from how this weekday really sold (weekdayForecast().today) and, once the app has watched enough
// earlier days, tightens it using how much of a day's sale is normally done by this time of day (a learned intraday curve).
// The AI "locks" one call per day; the day is settled against the final POS total and graded.
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r0 = v => Math.round(num(v));
const p2 = n => String(n).padStart(2, '0');
export const localIso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
export const minuteOfDay = d => d.getHours() * 60 + d.getMinutes();

// ── intraday samples: log = { 'YYYY-MM-DD': [[minuteOfDay, runningTotal], ...] } ──
export function recordSample(log, day, minute, total) {
  const t = num(total); if (!(t > 0)) return false;
  const arr = (log[day] = log[day] || []), last = arr[arr.length - 1];
  if (last && t < last[1]) return false;                       // a running total never goes down; ignore a stale read
  if (last && minute - last[0] < 5) { if (t > last[1]) { last[0] = minute; last[1] = t; return true; } return false; }
  arr.push([minute, t]); if (arr.length > 200) arr.shift();
  const keys = Object.keys(log).sort(); while (keys.length > 45) delete log[keys.shift()];
  return true;
}
function cumAt(samples, minute) {
  if (!samples.length || minute < samples[0][0]) return null;
  let prev = samples[0];
  for (const s of samples) {
    if (s[0] >= minute) return s[0] === minute || s === prev ? s[1] : prev[1] + (s[1] - prev[1]) * ((minute - prev[0]) / (s[0] - prev[0]));
    prev = s;
  }
  return prev[1];
}
/** Median share of a finished day's sale that was already done at `minute`. null until `minDays` earlier days were watched through the evening. */
export function curveFraction(log, todayIso, minute, { minDays = 3, completeAfter = 1230 } = {}) {
  const fr = [];
  for (const [day, s] of Object.entries(log || {})) {
    if (day === todayIso || !s.length || s[s.length - 1][0] < completeAfter) continue;
    const fin = s[s.length - 1][1], at = cumAt(s, minute);
    if (fin > 0 && at != null) fr.push(Math.min(1, at / fin));
  }
  if (fr.length < minDays) return null;
  fr.sort((a, b) => a - b); const m = fr.length >> 1;
  return fr.length % 2 ? fr[m] : (fr[m - 1] + fr[m]) / 2;
}

/** End-of-day projection from the weekday expectation and what is already sold. */
export function liveProjection({ live, expected, low, high, fraction }) {
  const L = num(live), E = num(expected);
  let projected = E, basis = 'weekday history';
  if (fraction != null && fraction >= 0.15 && L > 0) {
    const w = Math.min(0.8, fraction); projected = w * (L / fraction) + (1 - w) * E; basis = 'weekday history + time-of-day pace';
  }
  projected = Math.max(projected, L);
  const half = Math.max(0, (num(high) - num(low)) / 2) * (1 - 0.7 * Math.min(1, fraction || 0));
  return { projected: r0(projected), low: r0(Math.max(L, projected - half)), high: r0(projected + half), basis };
}

// ── the game ──
export const GRADES = { bullseye: { pts: 3, label: 'Bullseye', max: 2 }, hit: { pts: 2, label: 'Hit', max: 5 }, close: { pts: 1, label: 'Close', max: 10 }, miss: { pts: 0, label: 'Miss', max: Infinity } };
export function grade(errPct) { const e = Math.abs(num(errPct)); return e <= 2 ? 'bullseye' : e <= 5 ? 'hit' : e <= 10 ? 'close' : 'miss'; }

/** One locked call per day. Never overwritten once made. */
export function lockPrediction(game, day, pred, minute) {
  if (!game.days) game.days = {};
  if (game.days[day] || !(num(pred.expected) > 0)) return false;
  game.days[day] = { expected: r0(pred.expected), low: r0(pred.low), high: r0(pred.high), lockedAtMin: minute, reached: false, result: null };
  const keys = Object.keys(game.days).sort(); while (keys.length > 120) delete game.days[keys.shift()];
  return true;
}
/** Grade a finished day against its final POS total. Returns the result once, null if nothing to settle. */
export function settleDay(game, day, finalTotal) {
  const d = game.days && game.days[day], fin = num(finalTotal);
  if (!d || d.result || !(fin > 0)) return null;
  const errPct = Math.round(((fin - d.expected) / d.expected) * 1000) / 10, g = grade(errPct);
  d.result = { final: r0(fin), errPct, grade: g, pts: GRADES[g].pts };
  return { day, ...d.result, expected: d.expected };
}
export function scoreboard(game, recentN = 7) {
  const settled = Object.entries((game && game.days) || {}).filter(([, d]) => d.result).sort((a, b) => b[0].localeCompare(a[0]));
  let streak = 0; for (const [, d] of settled) { if (d.result.grade === 'bullseye' || d.result.grade === 'hit') streak++; else break; }
  return { played: settled.length, hits: settled.filter(([, d]) => d.result.pts >= 2).length, bullseyes: settled.filter(([, d]) => d.result.grade === 'bullseye').length,
    points: settled.reduce((s, [, d]) => s + d.result.pts, 0), streak,
    recent: settled.slice(0, recentN).map(([day, d]) => ({ day, grade: d.result.grade, errPct: d.result.errPct, final: d.result.final, expected: d.expected })) };
}

/** Live state of today's call: reached / ahead / on_track / behind / waiting. */
export function dayStatus({ live, locked, projected }) {
  if (!locked) return 'waiting';
  const L = num(live), E = locked.expected;
  if (L >= E) return 'reached';
  if (projected >= E * 1.03) return 'ahead';
  if (projected >= E * 0.97) return 'on_track';
  return 'behind';
}
export function coachLine(status, { live, locked, projected }) {
  const rs = v => 'Rs ' + r0(v).toLocaleString('en-PK');
  switch (status) {
    case 'reached': return 'Forecast reached! ' + rs(live) + ' sold against my call of ' + rs(locked.expected) + '.';
    case 'ahead': return 'Ahead of my call. On pace to close near ' + rs(projected) + '.';
    case 'on_track': return 'Right on my call. Heading for about ' + rs(projected) + '.';
    case 'behind': return 'Running behind my call. At this pace about ' + rs(projected) + ' (' + rs(locked.expected - projected) + ' short).';
    default: return 'Waiting for enough sales history to make today\u2019s call.';
  }
}
