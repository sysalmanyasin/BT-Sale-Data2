// ══════════════════════════════════════════════════════════════════════
// HUB GATE — pause / resume for everything that reads the shared Pharmacy
// Audit Hub Supabase project (inventory, STR, sale payments, audit, stock
// ledger). Exists to cut egress: while paused, none of those bridges touch
// the network and callers get whatever is already cached on this device.
//
// Rules (agreed with the owner):
//   • Every launch starts PAUSED. Nothing is fetched from the Audit Hub
//     until Resume is tapped.
//   • Resume is manual only. Auto-pause returns it to paused after
//     IDLE_MS without real user input, or HIDDEN_MS with the tab hidden.
//   • No exemptions, except Emergency Billing's own inventory snapshot
//     check when its page is opened or its Refresh button is tapped
//     (it passes { bypassPause: true } to the inventory bridge).
//
// Leaf module (no imports) so any layer can use it without an import cycle.
// Does NOT touch the main project (sales, manager, closing) — only the
// bridges that point at AUDIT_HUB_URL consult it.
// ══════════════════════════════════════════════════════════════════════

export const IDLE_MS   = 10 * 60 * 1000; // no pointer/key/touch input for this long -> pause
export const HIDDEN_MS =  2 * 60 * 1000; // tab hidden for this long -> pause

let _paused = true;           // every launch starts paused
let _timer = null;
let _resumedAt = 0;

function _emit(name) {
  try { window.dispatchEvent(new CustomEvent(name, { detail: { paused: _paused } })); } catch (_) { /* no window (tests) */ }
}

function _arm(ms) {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  if (_paused) return;
  _timer = setTimeout(() => pause('idle'), ms);
  if (_timer && typeof _timer.unref === 'function') _timer.unref();
}

export function isPaused() { return _paused; }
export function getResumedAt() { return _resumedAt; }

/** Pause now (manual button, idle timer or hidden tab). */
export function pause(reason) {
  if (_paused) return;
  _paused = true;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _emit('bt-hub-state');
  try { console.info('[hub-gate] paused (' + (reason || 'manual') + ')'); } catch (_) { /* ignore */ }
}

/**
 * Resume (manual only). Fires 'bt-hub-state' first so the UI updates, then 'bt-hub-resume'
 * so each reader can do its single catch-up fetch (bridges already skip the full download when the
 * server-side sync log has not moved).
 */
export function resume() {
  const was = _paused;
  _paused = false;
  _resumedAt = Date.now();
  _arm(IDLE_MS);
  if (was) { _emit('bt-hub-state'); _emit('bt-hub-resume'); }
  return was;
}

/** Real user input only — background timers must never call this. */
export function touch() {
  if (!_paused) _arm(typeof document !== 'undefined' && document.visibilityState === 'hidden' ? HIDDEN_MS : IDLE_MS);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (_paused) return;
    _arm(document.visibilityState === 'hidden' ? HIDDEN_MS : IDLE_MS);
  });
  window.btHubGate = { isPaused, pause, resume, touch, IDLE_MS, HIDDEN_MS };
}
