// ══════════════════════════════════════════════════════════════════════
// RECORD DAY — a small "wonder": the moment a Sale Data save produces a
// new all-time daily sales record, this fires a confetti burst + toast,
// wherever the user currently is in the app (not tied to any one page).
//
// Real ES module, no <script> tag consumers of its own — it just
// subscribes to EventBus at load time and reacts. Listens for
// 'daily:added'/'daily:updated', the two events repository.js's
// upsertDaily() already fires on every single Sale Data save (Floor 1's
// one true write path — see repository.js's own header), so this can
// never miss a save or fire on some parallel/stale copy of the data.
//
// Reads the saved entry's own TOTAL field rather than recomputing sales
// math itself — that field is already populated by config.js's
// computeDailyTotals() before the save reaches Repository, so this is
// guaranteed to match whatever Dashboard/Reports would show for the
// same day, never its own drifted calculation.
//
// Deliberately conservative about false positives: won't fire at all
// until there are at least MIN_HISTORY_DAYS other days on record, so a
// brand-new install's first few entries (necessarily each a "record"
// against an almost-empty history) don't celebrate an empty baseline.
// Fires at most once per calendar date per session (sessionStorage —
// same ephemeral-per-session convention nav-recents.js already uses).
// ══════════════════════════════════════════════════════════════════════

import { EventBus } from './event-bus.js';
import { Repository } from './repository.js';
import { BTFormat } from './bt-format.js';
import { n } from './config.js';

const MIN_HISTORY_DAYS = 5;
const SHOWN_KEY = 'bt_record_day_shown';

function _alreadyShown(dateStr) {
  try { return sessionStorage.getItem(SHOWN_KEY) === dateStr; } catch (_) { return false; }
}
function _markShown(dateStr) {
  try { sessionStorage.setItem(SHOWN_KEY, dateStr); } catch (_) { /* best-effort only */ }
}

function _checkRecord(entry) {
  if (!entry || !entry.Date) return;
  if (_alreadyShown(entry.Date)) return;

  const today = n(entry.TOTAL);
  if (!today || today <= 0) return;

  const others = Repository.getDaily().filter(d => d.Date !== entry.Date);
  if (others.length < MIN_HISTORY_DAYS) return;

  let best = null;
  others.forEach(d => { if (!best || n(d.TOTAL) > n(best.TOTAL)) best = d; });
  if (!best || today <= n(best.TOTAL)) return;

  _markShown(entry.Date);
  _celebrate(today, n(best.TOTAL), best.Date);
}

function _celebrate(today, prevBest, prevDate) {
  _confetti();
  const msg = '🎉 New Daily Sales Record! ' + BTFormat.currency(today) +
    ' — beats ' + BTFormat.currency(prevBest) + ' (' + prevDate + ')';
  // toast() (ui.js) is a bare global read here the same way every other
  // classic-script consumer already reads it (see auth.js/conflict-ui.js
  // etc for the identical typeof-guard convention).
  if (typeof toast === 'function') toast(msg, 'record');
}

// ── Confetti — plain CSS keyframes, no external library, matching this
// app's zero-extra-dependency stance for a one-off visual flourish. ──
let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent =
    '.bt-confetti-layer{position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;}' +
    '.bt-confetti-piece{position:absolute;top:-20px;width:8px;height:14px;opacity:.9;' +
    'animation:btConfettiFall linear forwards;border-radius:2px;}' +
    '@keyframes btConfettiFall{to{transform:translateY(110vh) rotate(720deg);opacity:.15;}}';
  document.head.appendChild(style);
}

const _COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4'];

function _confetti() {
  _injectStyles();
  const layer = document.createElement('div');
  layer.className = 'bt-confetti-layer';
  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'bt-confetti-piece';
    p.style.left = (Math.random() * 100) + 'vw';
    p.style.background = _COLORS[i % _COLORS.length];
    p.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
    p.style.animationDelay = (Math.random() * 0.4) + 's';
    p.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

EventBus.onChange((eventName, payload) => {
  if (eventName === 'daily:added' || eventName === 'daily:updated') _checkRecord(payload);
});
