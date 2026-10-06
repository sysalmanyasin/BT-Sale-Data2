// Usage + audit screen data. Pure aggregation (testable) and two thin fetchers.
// Reads only the signed-in user's own rows (RLS: owner-only).

/** attempt rows → per provider/model: calls, failures, avg latency, last error. */
export function summarizeUsage(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (r.kind && r.kind !== 'attempt') continue;
    if (!r.provider) continue;
    const k = r.provider;
    const o = by.get(k) || { provider: k, calls: 0, ok: 0, failed: 0, rateLimited: 0, latencySum: 0, latencyN: 0, lastError: null, lastAt: null };
    o.calls++;
    if (r.ok) o.ok++; else { o.failed++; if (Number(r.status) === 429) o.rateLimited++; if (!o.lastError || r.created_at > o.lastAt) o.lastError = r.error || ('HTTP ' + r.status); }
    if (r.latency_ms != null) { o.latencySum += Number(r.latency_ms); o.latencyN++; }
    if (!o.lastAt || r.created_at > o.lastAt) o.lastAt = r.created_at;
    by.set(k, o);
  }
  return [...by.values()].map(o => ({ provider: o.provider, calls: o.calls, ok: o.ok, failed: o.failed, rateLimited: o.rateLimited,
    avgLatencyMs: o.latencyN ? Math.round(o.latencySum / o.latencyN) : null, lastError: o.lastError, lastAt: o.lastAt }))
    .sort((a, b) => b.calls - a.calls);
}

/** audit rows → display rows with an approval status for changes. */
export function summarizeAudit(rows) {
  return (rows || []).map(r => {
    const change = r.risk === 'write' || r.risk === 'critical';
    const a = r.args || {};
    let status = r.ok ? 'done' : 'failed';
    if (change) status = a._approval === 'rejected' ? 'rejected' : (r.ok ? 'approved' : 'not applied');
    if (r.undone_at) status = 'undone';
    return { tool: r.tool, risk: r.risk, status, change, at: r.created_at, error: r.error || null };
  });
}

export async function fetchUsage(sb, hours = 24) {
  if (!sb) return [];
  try {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data } = await sb.from('agent_usage').select('provider, model, ok, status, latency_ms, error, kind, created_at')
      .eq('kind', 'attempt').gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
    return data || [];
  } catch (_) { return []; }
}
export async function fetchAudit(sb, limit = 15) {
  if (!sb) return [];
  try {
    const { data } = await sb.from('agent_audit').select('tool, risk, ok, args, error, undone_at, created_at')
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch (_) { return []; }
}
