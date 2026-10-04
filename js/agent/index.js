// AI agent entry point (Phase 2: read + approval-gated changes).
// Loaded as a module from index.html. Registers tools, mounts the panel.
// Purely additive: touches no existing app module, state, or storage.
import './tools/app.js';
import './tools/sales.js';
import './tools/manager.js';
import './tools/inventory.js';
import './tools/writes.js';
import './tools/credit.js';
import './tools/deletes.js';
import './tools/briefing.js';
import { mountAgentPanel } from './ui/agent-panel.js';

function start() {
  try { mountAgentPanel(); } catch (e) { console.error('[agent] failed to mount', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
