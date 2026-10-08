// Pure manager-facing helpers. Inputs are existing BT Agent/tool results.
export const money = v => Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0;
export function topMoneyFindings(findings, limit = 10) {
  return [...(findings || [])].sort((a, b) => money(b.money_impact || b.estimated_lost_sales_7d) - money(a.money_impact || a.estimated_lost_sales_7d)).slice(0, limit);
}
export function deterministicFallback(question, snap) {
  const q = String(question || '').toLowerCase();
  const b = snap && snap.raw && snap.raw.briefing;
  if (!b) return 'BT could not read the current business briefing. No change was made.';
  if (/inventory|stock|reorder/.test(q) && b.inventory) {
    const rows = b.inventory.money_ranked_top10 || [];
    return rows.length ? 'Top estimated lost-sales risks (7d):\n' + rows.map((x, i) => `${i + 1}. ${x.name} — Rs ${money(x.estimated_lost_sales_7d).toLocaleString('en-PK')}`).join('\n') : 'No selling out-of-stock items are currently ranked.';
  }
  if (/attention|briefing|risk/.test(q)) {
    const a = (b.attention || []).filter(x => x.level === 'warn').slice(0, 5);
    return a.length ? a.map(x => '• ' + x.message).join('\n') : 'Nothing critical is flagged by the current deterministic checks.';
  }
  if (/str|transfer/.test(q) && snap.raw.str) return `STR: ${snap.raw.str.awaited.all} awaited, ${snap.raw.str.dispatched_not_received.all} dispatched but not received.`;
  if (/clos|shift/.test(q) && snap.raw.closing) return `Closing: ${(snap.raw.closing.incomplete_days || []).length} incomplete day(s) in the monitored period.`;
  if (/cash|diff/.test(q) && snap.raw.day) return `Latest cash DIFF: Rs ${money(snap.raw.day.diff).toLocaleString('en-PK')}.`;
  return 'The AI model is unavailable. I can still answer from deterministic BT data. Ask about sales, cash, inventory, STR or closing.';
}