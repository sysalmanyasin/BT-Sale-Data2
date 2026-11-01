// COVER DASHBOARD — KPI header row.

import { n, fc } from '../platform/config.js';
import { computeInventoryHealth } from '../shared/summary-calc.js';
import { escapeHtml as _esc } from '../shared/html.js';
import { _targetPace, _totalOutstandingCredits } from './cover-sales-manager.js';
import { _inventoryHeroStats, _reorderUrgentStats } from './cover-inventory.js';

// ── KPI header row ─────────────────────────────────────────────────────
// The four numbers that actually drive today's decisions, in one glance
// row above everything else: are we on pace, is cash/credit under
// control, is inventory healthy, does anything need reordering. Each
// tile is tappable straight through to the page that explains it. Reuses
// the exact same helpers the hero cards below already call — no second
// derivation of any figure, so this row can never disagree with the
// detail underneath it.
function _kpiTiles() {
  const out = [];

  try {
    const pace = _targetPace();
    const m = /^(-?\d+)% of target$/.exec(pace.value || '');
    const pct = m ? parseInt(m[1], 10) : null;
    out.push({
      icon: '📊', label: 'Sales vs Target',
      value: pct == null ? '—' : pct + '%',
      cls: pct == null ? 'neutral' : (pace.cls || 'neutral'),
      page: 'dashboard',
    });
  } catch (e) { out.push({ icon: '📊', label: 'Sales vs Target', value: '—', cls: 'neutral', page: 'dashboard' }); }

  try {
    const credits = _totalOutstandingCredits();
    const v = parseFloat(String(credits.value || '').replace(/[^0-9.-]/g, ''));
    out.push({
      icon: '💳', label: 'Outstanding Credit',
      value: isNaN(v) ? '—' : '₨ ' + fc(v),
      cls: isNaN(v) ? 'neutral' : (v <= 0 ? 'green' : v < 50000 ? 'amber' : 'red'),
      page: 'manager',
    });
  } catch (e) { out.push({ icon: '💳', label: 'Outstanding Credit', value: '—', cls: 'neutral', page: 'manager' }); }

  try {
    const { slStats, ewSummary } = _inventoryHeroStats();
    if (slStats && slStats.dataReady) {
      const health = computeInventoryHealth({
        totalInventoryValue:  slStats.totalInventoryValue,
        neverSold60Value:     slStats.neverSold60Value,
        deadStock60Value:     slStats.deadStock60Value,
        correctedExcessValue: ewSummary ? ewSummary.correctedExcessValue : 0,
      });
      out.push({
        icon: '📦', label: 'Inventory Health',
        value: health.pctHealthy + '%',
        cls: health.pctHealthy >= 90 ? 'green' : health.pctHealthy >= 75 ? 'amber' : 'red',
        page: 'inventory',
      });
    } else {
      out.push({ icon: '📦', label: 'Inventory Health', value: '—', cls: 'neutral', page: 'inventory' });
    }
  } catch (e) { out.push({ icon: '📦', label: 'Inventory Health', value: '—', cls: 'neutral', page: 'inventory' }); }

  try {
    const { rrSummary } = _inventoryHeroStats();
    const items = rrSummary ? n(rrSummary.itemsShown) : null;
    const urgent = rrSummary ? _reorderUrgentStats() : null;
    out.push({
      icon: '🛒', label: 'Items to Reorder',
      value: items == null ? '—' : String(items),
      sub: urgent && urgent.urgentCount > 0 ? `${urgent.urgentCount} <7d cover (${urgent.zeroStock} stockout)` : '',
      cls: items == null ? 'neutral' : (items === 0 ? 'green' : items < 100 ? 'amber' : 'red'),
      page: 'reorder',
    });
  } catch (e) { out.push({ icon: '🛒', label: 'Items to Reorder', value: '—', cls: 'neutral', page: 'reorder' }); }

  return out;
}

export function _renderKpiRow() {
  const el = document.getElementById('cover-kpi-row');
  if (!el) return;
  const tiles = _kpiTiles();
  el.innerHTML = tiles.map((t, i) => `
    <div class="cover-kpi-tile cls-${t.cls}" data-kpi-idx="${i}" role="button" tabindex="0">
      <div class="cover-kpi-icon">${t.icon}</div>
      <div class="cover-kpi-value">${_esc(t.value)}</div>
      <div class="cover-kpi-label">${_esc(t.label)}</div>
      ${t.sub ? `<div class="cover-kpi-sub">${_esc(t.sub)}</div>` : ''}
    </div>`).join('');
  el.querySelectorAll('[data-kpi-idx]').forEach(tile => {
    const goTo = () => {
      const t = tiles[+tile.dataset.kpiIdx];
      if (t && t.page && typeof window.showPage === 'function') window.showPage(t.page);
    };
    tile.addEventListener('click', goTo);
    tile.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(); } });
  });
}
