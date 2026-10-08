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
import './tools/str.js';
import './tools/closing.js';
import './tools/billing.js';
import './tools/documents.js';
import './tools/memory-tool.js';
import './tools/verify.js';
import './tools/manager-intelligence-v2.js'; // read-only verifiers for the change tools (must come after the tools register)
import { mountAgentPanel } from './ui/agent-panel.js';
import * as Telemetry from './core/telemetry.js';
import { startPersistence } from './core/telemetry-store.js';

function start() {
  // Earlier sessions' (redacted, device-local) events first, then keep saving real events as they happen.
  try { const store = startPersistence({ storage: window.localStorage, telemetry: Telemetry }); window.addEventListener('pagehide', () => store.flush()); } catch (e) { console.error('[agent] telemetry store', e); }
  try { mountAgentPanel(); } catch (e) { console.error('[agent] failed to mount', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
