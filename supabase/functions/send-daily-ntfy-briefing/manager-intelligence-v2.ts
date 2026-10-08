// v2 deterministic manager layer for the existing ntfy briefing.
// Uses the same REST helpers/data source; it only returns blocks/facts for index.ts.

type AnyRow = Record<string, any>;
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const n0 = (v: unknown) => Math.round(num(v)).toLocaleString('en-PK');
const moneyImpact = (r: AnyRow) => num(r.money_impact ?? r.estimated_lost_sales_7d ?? r.value);

export async function managerIntelligenceV2(rest: (path: string) => Promise<any[]>, auditRest: (path: string) => Promise<any[]>) {
  const blocks: string[] = [];
  const facts: AnyRow = {};
  const alerts: string[] = [];

  try {
    const rows = await auditRest('inventory_products?select=*&limit=1000');
    const ranked = rows.map((p: AnyRow) => {
      const sold30 = num(p.net_qty_30_days ?? p.netQty30Days);
      const stock = num(p.qty ?? p.stock);
      const price = num(p.price ?? p.sale_price);
      const daily = sold30 / 30;
      const lost = stock <= 0 && daily > 0 ? daily * price * 7 : Math.max(0, daily * 7 - stock) * price;
      const reorder = daily > 0 ? Math.max(0, Math.ceil(daily * 19 - stock)) : 0;
      return { name: p.name ?? p.product_name ?? '?', stock, sold30, daily, price, money_impact: lost, reorder };
    }).filter(x => x.money_impact > 0).sort((a, b) => b.money_impact - a.money_impact).slice(0, 10);
    const total = ranked.reduce((s, x) => s + x.money_impact, 0);
    facts.opportunities = ranked.map(x => ({ item: x.name, money_impact: Math.round(x.money_impact), suggested_qty: x.reorder }));
    if (ranked.length) {
      blocks.push('## 💡 Opportunities\n' + ranked.slice(0, 5).map((x, i) => `${i + 1}. ${x.name} · Rs ${n0(x.money_impact)} impact · reorder ${x.reorder}`).join('\n'));
      if (total >= 10000) alerts.push(`Top inventory opportunities represent about Rs ${n0(total)} of 7-day money impact.`);
    }
  } catch (_) { blocks.push('## ⚠️ Opportunities\n> Inventory opportunity layer unavailable'); }

  try {
    const rows = await rest('bt_daily?select=date,data&order=date.desc&limit=30');
    const vals = rows.map(r => num(r?.data?.TOTAL)).filter(v => v >= 0);
    const avg7 = vals.slice(0, 7).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(7, vals.length));
    const avg30 = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    facts.forecast = { avg7: Math.round(avg7), avg30: Math.round(avg30), next7: Math.round(avg7 * 7), confidence: vals.length >= 30 ? 'high' : vals.length >= 14 ? 'medium' : 'low' };
    blocks.push(`## 📈 Forecast\n- 7-day average: Rs ${n0(avg7)} / day\n- 30-day average: Rs ${n0(avg30)} / day\n- Next 7 days at recent pace: Rs ${n0(avg7 * 7)}\n- Confidence: ${facts.forecast.confidence}`);
  } catch (_) { blocks.push('## ⚠️ Forecast\n> Sales history unavailable'); }

  try {
    const rows = await rest('agent_audit?select=created_at,tool,risk,ok&order=created_at.desc&limit=100');
    const writes = rows.filter(r => r.risk === 'write' || r.risk === 'critical');
    const failed = rows.filter(r => r.ok === false);
    facts.reliability = { recent_calls: rows.length, failed: failed.length, writes: writes.length };
    if (failed.length) alerts.push(`${failed.length} recent Agent audit event(s) failed; review Agent health.`);
  } catch (_) { facts.reliability = null; }

  return { blocks, alerts, facts };
}