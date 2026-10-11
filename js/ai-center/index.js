// AI Center entry point. Loaded as a module from index.html AFTER js/agent/index.js
// (so the tool registry is populated and window.BTAgent exists by the time the page is shown).
// Registers one hook that ui.js's showPage() calls when #ai-center opens. Purely additive.
import { onShow } from './ui.js';
import { start as startForecastGame } from './forecast-game.js';

window.AICenter = Object.freeze({ onShow });
// If the app was opened directly on #ai-center, showPage() ran before this module loaded.
if (/^#ai-center/.test(window.location.hash)) {
  const go = () => { const p = document.getElementById('page-ai-center'); if (p && p.classList.contains('on')) onShow(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(go, 0)); else setTimeout(go, 0);
}

// The AI tracks today's sale and plays the Forecast Game while the app is open (any page), so it can celebrate anywhere.
try { startForecastGame(); } catch (_) { /* never block the page */ }
