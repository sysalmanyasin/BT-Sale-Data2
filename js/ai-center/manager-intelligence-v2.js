// Manager Intelligence v2 — deterministic extensions over existing BT data.
// No new AI, scheduler, notification service, or business-write path.

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const money = v => Math.round(n(v));
const ceil = v => Math.max(0, Math.ceil(n(v)));

export function opportunityScore(f) {
  const impact = Math.max(0, n(f.money_impact ?? f.estimated_lost_sales_7d ?? f.value));
  const sev = f.severity === 'error' ? 3 : f.severity === 'warning' ? 2 : 1;
  return impact * 10 + sev * 1000;
}

export function rankOpportunities(findings = [], limit = 10) {
  return [...findings].sort((a, b) => opportunityScore(b) - opportunityScore(a)).slice(0, limit);
}

export function forecastSales(rows = [], days = 7) {
  const vals = rows.map(r => n(r.sale ?? r.TOTAL ?? r.total)).filter(v => v >= 0);
  if (!vals.length) return { days, average_daily: 0, projected: 0, confidence: 'unknown' };
  const recent = vals.slice(-Math.min(7, vals.length));
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const baseline30 = vals.reduce((a, b) => a + b, 0) / vals.length;
  const confidence = vals.length >= 30 ? 'high' : vals.length >= 14 ? 'medium' : 'low';
  return { days, average_daily: money(avg), baseline_30d: money(baseline30), projected: money(avg * days), confidence };
}

export function anomalySignals(rows = [], threshold = 0.3) {
  const vals = rows.map(r => ({ ...r, sale: n(r.sale ?? r.TOTAL ?? r.total) })).filter(r => r.sale > 0);
  if (vals.length < 5) return [];
  const base = vals.slice(0, -1).map(r => r.sale);
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  if (!avg) return [];
  return vals.slice(-1).filter(r => Math.abs(r.sale - avg) / avg >= threshold).map(r => ({
    kind: r.sale < avg ? 'below_baseline' : 'above_baseline',
    date: r.date || r.Date || null,
    actual: money(r.sale), baseline: money(avg), pct: Math.round(((r.sale - avg) / avg) * 100),
  }));
}

export function staffSignals(rows = []) {
  return rows.map(r => ({
    name: String(r.name || r.staff || '?'),
    amount: money(r.amount ?? r.total ?? r.credit),
    aged: !!r.aged,
    duplicate: !!r.duplicate,
  })).filter(r => r.amount || r.aged || r.duplicate).sort((a, b) => b.amount - a.amount);
}

export function reorderRecommendation(product, { targetDays = 14, leadDays = 3, safetyDays = 2 } = {}) {
  const sold30 = n(product?.netQty30Days ?? product?.net_qty_30_days);
  const stock = n(product?.qty ?? product?.stock);
  const daily = sold30 / 30;
  if (!(daily > 0)) return null;
  const demand = daily * (n(leadDays) + n(targetDays) + n(safetyDays));
  const qty = ceil(demand - stock);
  return { item: product?.name || product?.product_name || 'Unknown', current_qty: money(stock), daily_velocity: Math.round(daily * 100) / 100, suggested_qty: qty, horizon_days: n(leadDays) + n(targetDays) + n(safetyDays) };
}

export function reorderList(products = [], opts = {}) {
  return products.map(p => reorderRecommendation(p, opts)).filter(Boolean).filter(x => x.suggested_qty > 0).sort((a, b) => b.suggested_qty - a.suggested_qty);
}

export function evidenceBundle(finding, snap = {}) {
  const evidence = Array.isArray(finding?.evidence) ? finding.evidence : [];
  const sources = [...new Set(evidence.map(e => e.kind).filter(Boolean))];
  return {
    finding_id: finding?.id || null,
    title: finding?.title || null,
    observed_at: finding?.detected_at || null,
    source: finding?.source || null,
    evidence,
    evidence_kinds: sources,
    source_count: evidence.length,
    data_as_of: snap.data_as_of || snap.now || null,
  };
}

export function learningSummary(actions = [], findings = []) {
  const by = new Map(findings.map(f => [f.id, f]));
  const reviewed = actions.filter(a => a.action === 'reviewed').length;
  const resolved = actions.filter(a => a.action === 'resolved').length;
  const snoozed = actions.filter(a => a.action === 'snoozed').length;
  const actionable = actions.filter(a => by.has(a.finding_id)).length;
  return { reviewed, resolved, snoozed, actionable, resolution_rate: reviewed ? Math.round((resolved / reviewed) * 100) : null };
}

export function verificationSummary(events = []) {
  const ends = events.filter(e => e.type === 'verify_end');
  const ok = ends.filter(e => e.status === 'ok').length;
  return { checks: ends.length, passed: ok, failed: ends.length - ok, pass_rate: ends.length ? Math.round(ok / ends.length * 100) : null };
}