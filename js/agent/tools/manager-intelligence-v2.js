// Read-only BT Agent tool helpers. The tool itself is registered by the installer
// so it participates in the existing registry, allow-list and telemetry.
import { registerTool } from '../core/tool-registry.js';
import { Repository } from '../../repository.js';

function num(v) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
function inventory() {
  try {
    const d = typeof window.inventoryBridgeGetFullData === 'function' ? window.inventoryBridgeGetFullData() : null;
    return d && Array.isArray(d.products) ? d.products : [];
  } catch (_) { return []; }
}

export function buildManagerActionPlan(products = []) {
  return products.map(p => {
    const sold30 = num(p.netQty30Days), stock = num(p.qty), daily = sold30 / 30;
    if (!(daily > 0)) return null;
    const suggested = Math.max(0, Math.ceil(daily * 19 - stock));
    if (!suggested) return null;
    return { item: p.name, current_qty: stock, sold_30d: sold30, daily_velocity: Math.round(daily * 100) / 100, suggested_qty: suggested, evidence: '30-day net sales velocity + current stock; recommendation only' };
  }).filter(Boolean).sort((a, b) => b.suggested_qty - a.suggested_qty).slice(0, 20);
}

registerTool({
  name: 'manager_action_plan', domain: 'inventory', risk: 'read',
  description: 'Build a read-only reorder/action list from existing inventory velocity and current stock. Never changes inventory. Use when the manager asks what to reorder or which inventory findings deserve action.',
  parameters: { type: 'object', properties: {} },
  run: () => {
    const rows = buildManagerActionPlan(inventory());
    return { count: rows.length, items: rows, source: 'existing inventory bridge', settings: JSON.parse(Repository.getItem('bt_targets') || '{}') ? 'existing app data' : 'existing app data' };
  },
});