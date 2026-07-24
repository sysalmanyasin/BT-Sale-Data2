// ══════════════════════════════════════════════════════════════════════
// INVENTORY DOMAIN — Phase 2 (AI + CommandHub Build Plan v2)
//
// Scope: read-only navigation + narration for the Inventory pages (Cover
// Dashboard's inventory hero stats, Stock Ledger, Excess Working, Reorder
// Report). No PO drafting, no dead-stock actions, no expiry tracking, no
// historical/trend graphs — current-state only, per the plan's scope note.
//
// Consumed by:
//   - ai-bridge.js (real import)      → nav parser (2.2)
//   - app-context.js (real import)    → getAppContextSummary() (2.3)
//   - commandhub-page.js (classic,    → Quick Shortcuts group (2.4),
//     window bridge below)             via typeof-guarded window.InventoryDomain
// ══════════════════════════════════════════════════════════════════════
import { registerDomain } from '../core/registry.js';

export const InventoryDomain = {
  id: 'inventory',
  pageSynonyms: {
    cover:       ['cover', 'cover dashboard'],
    stockledger: ['stock ledger', 'never sold', 'dead stock'],
    excess:      ['excess working', 'excess stock'],
    reorder:     ['reorder report', 'reorder alert'],
  },
  getContextSummary() {
    const sl = window.StockLedgerApp?.getCoverStats?.();
    const rr = window.ReorderReportApp?.getSummaryFor?.(30, 7, 500);
    if (!sl) return '';
    return `=== INVENTORY (live) ===
Total value: Rs ${sl.totalInventoryValue}
Never sold (60d): Rs ${sl.neverSold60Value}
Dead stock (60d): Rs ${sl.deadStock60Value}
Reorder: ${rr?.itemsShown ?? 0} items, Rs ${rr?.totalReorderValue ?? 0}`;
  },
  // NOTE: plan v2's snippet used `fn: 'aiAsk("...")'` verbatim from v1 —
  // `aiAsk` isn't a real function anywhere in this codebase (only
  // `chpAsk`, wired via `cmd` in commandhub-page.js's _chQuickActionBtn).
  // Using `cmd` here instead so these buttons actually fire, same as
  // every other entry in _chQuickGroups (see 2.4 wiring below).
  quickActions: [
    { label: '📦 Dead Stock', cmd: 'what is my dead stock value' },
    { label: '🛒 Reorder',    cmd: 'what needs reordering' },
    { label: '📊 Excess',     cmd: 'what is my excess stock' },
  ],
};

// Bridge for classic-script consumers (commandhub-page.js's Quick
// Shortcuts group — see 2.4) — same pattern as ai-memory.js's window
// bridges. This script tag must load before commandhub-page.js's (both
// are document-order-deferred) for the bare `InventoryDomain` read there
// to see it; placed alongside the other inventory-page module tags in
// index.html, ahead of commandhub-page.js's <script defer>.
window.InventoryDomain = InventoryDomain;

// Phase 5.1 — self-register with the domain registry. Additive: existing
// direct-import consumers (ai-bridge.js, app-context.js, the window
// bridge above) are untouched; this just also makes Inventory visible
// to allPageSynonyms()/allQuickActions()/allContextSummaries().
registerDomain(InventoryDomain);
