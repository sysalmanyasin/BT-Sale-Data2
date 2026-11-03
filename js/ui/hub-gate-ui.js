// ══════════════════════════════════════════════════════════════════════
// HUB GATE UI — the Pause / Resume button in the persistent top status bar
// (#sb-hub in index.html) and its "data as of" label.
//
// Core-layer file: it reaches the feature bridges only through their
// existing window.* bridges, never by importing a domain module.
//
// Resume = flip the gate, then ONE catch-up refresh per bridge with
// force=false. The bridges check the 1-row sync log first, so an unchanged
// Audit Hub costs a tiny query instead of a full inventory/STR download.
// ══════════════════════════════════════════════════════════════════════
import { isPaused, pause, resume } from '../platform/hub-gate.js';

const BRIDGE_REFRESH = [
  'auditBridgeRefresh',
  'salePaymentsBridgeRefresh',
  'inventoryBridgeRefresh',
  'strBridgeRefresh',
];
const FULLDATA_GETTERS = ['inventoryBridgeGetFullData', 'strBridgeGetFullData', 'salePaymentsBridgeGetFullData'];

function _asOf() {
  // Oldest fetchedAt across the three full-data caches = what is safe to claim.
  let oldest = 0;
  for (const g of FULLDATA_GETTERS) {
    try {
      const d = typeof window[g] === 'function' ? window[g]() : null;
      const t = d && d.fetchedAt ? Number(d.fetchedAt) : 0;
      if (!t) return 0;
      if (!oldest || t < oldest) oldest = t;
    } catch (_) { return 0; }
  }
  return oldest;
}

function _fmt(ms) {
  return new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

export function renderHubButton() {
  const btn = document.getElementById('sb-hub');
  if (!btn) return;
  const paused = isPaused();
  btn.dataset.state = paused ? 'paused' : 'live';
  const lbl = document.getElementById('sb-hub-label');
  if (lbl) lbl.textContent = paused ? 'Resume' : 'Pause';
  const ic = document.getElementById('sb-hub-ic');
  if (ic) ic.textContent = paused ? '▶' : '⏸';
  const note = document.getElementById('sb-hub-note');
  if (note) {
    const t = _asOf();
    note.textContent = paused ? (t ? 'Hub paused · data as of ' + _fmt(t) : 'Hub paused · no saved data') : 'Hub live';
  }
  btn.title = paused
    ? 'Audit Hub is paused to save data. Inventory, STR, payments and audit show saved data. Tap to resume.'
    : 'Audit Hub is live. Pauses by itself after 10 minutes without activity. Tap to pause now.';
  btn.setAttribute('aria-pressed', paused ? 'false' : 'true');
}

async function _catchUp() {
  await Promise.allSettled(BRIDGE_REFRESH.map((n) => {
    try { return typeof window[n] === 'function' ? Promise.resolve(window[n](false)) : null; } catch (e) { return null; }
  }));
  renderHubButton();
  try { if (typeof window.renderCoverDashboard === 'function') window.renderCoverDashboard(); } catch (_) { /* ignore */ }
  try { if (typeof window.refreshStatusBar === 'function') window.refreshStatusBar(); } catch (_) { /* ignore */ }
}

function _onClick() {
  if (isPaused()) { resume(); } else { pause('manual'); }
  renderHubButton();
}

function _wire() {
  const btn = document.getElementById('sb-hub');
  if (btn && !btn.dataset.wired) { btn.dataset.wired = '1'; btn.addEventListener('click', _onClick); }
  renderHubButton();
}

window.addEventListener('bt-hub-state', renderHubButton);
// Catch-up fetch runs only after a manual Resume (the gate fires this event exactly then).
window.addEventListener('bt-hub-resume', () => { _catchUp(); });
window.setInterval(renderHubButton, 30000); // keeps the "as of" label honest; touches only text, never the network
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire); else _wire();

window.btHubRenderButton = renderHubButton;
