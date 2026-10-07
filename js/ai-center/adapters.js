// ══════════════════════════════════════════════════════════════════════
// AI CENTER — ADAPTERS (thin read layer over what BT already has)
//
// Every read goes through the EXISTING tool registry (runTool, read-only
// allow-list), the EXISTING bridges, or the EXISTING agent tables
// (agent_audit, agent_usage, agent_settings). No business maths here, no
// second Supabase data layer, no AI calls, no writes.
//
// Reads made for monitoring are recorded as real telemetry events with
// source 'ai-center' so the Activity timeline shows exactly what was read.
// ══════════════════════════════════════════════════════════════════════
import { runTool, listTools, getTool } from '../agent/core/tool-registry.js';
import { emit, redact, toolStats, recent } from '../agent/core/telemetry.js';
import { fetchUsage, summarizeUsage } from '../agent/core/usage-stats.js';
import { getKillState } from '../agent/core/kill-switch.js';
import { loadPendingUndos } from '../agent/core/undo-store.js';
import { SPECIALISTS } from '../agent/core/specialists.js';
import { buildFindings, systemStatus, buildForecast, freshness, providerHealth, specialistStats, specialistsHealth, realtimeHealth, SYSTEMS, fmtNum } from './model.js';

export const getSb = () => (typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null);

/** Run one READ tool through the registry (so hard blocks / allow-list still apply) and parse its JSON. */
export async function readTool(name, args = {}) {
  const t0 = Date.now(), def = getTool(name), ref = 'aic:' + name + ':' + t0;
  emit({ type: 'tool_start', source: 'ai-center', tool: name, domain: def ? def.domain : null, entity_reference: ref, metadata: { risk: def ? def.risk : 'unknown', args } });
  const res = await runTool(name, args, { allow: ['read'] });
  let data = null, err = null;
  if (!res.ok) { try { err = (JSON.parse(res.text).error) || res.error; } catch (_) { err = res.error || 'failed'; } }
  else { try { data = JSON.parse(res.text); } catch (_) { err = 'Result was too large to read safely.'; } }
  if (data && data.error && !err) err = data.error;
  emit({ type: 'tool_end', source: 'ai-center', tool: name, domain: def ? def.domain : null, entity_reference: ref, status: err ? 'failed' : 'ok', duration: Date.now() - t0, severity: err ? 'warning' : 'info', metadata: { risk: def ? def.risk : 'unknown', error: err || undefined } });
  if (err) throw new Error(err);
  return data;
}

const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e: (e && e.message) || String(e) }));

/** One consistent read of everything the Home screen needs. Cheap: a handful of in-memory tool calls, no network. */
export async function collectSnapshot(now = Date.now()) {
  const [bR, paceR, clR, strR] = await Promise.all([
    settle(readTool('daily_briefing')),
    settle(readTool('get_target_pace')),
    settle(readTool('closing_recent_days', { days: 7 })),
    settle(readTool('str_overview')),
  ]);
  const briefing = bR.ok ? bR.v : null;
  const lastDate = briefing && briefing.last_sales_entry && briefing.last_sales_entry.date;
  const [dayR, pendR] = await Promise.all([
    lastDate ? settle(readTool('get_daily_sales', { date: lastDate })) : Promise.resolve({ ok: false, e: 'No sales entry found.' }),
    strR.ok ? settle(readTool('list_pending_strs', { direction: 'in', min_age_days: 3, limit: 5 })) : Promise.resolve({ ok: false, e: strR.e }),
  ]);
  const errors = { briefing: bR.e, pace: paceR.e, closing: clR.e, str: strR.e, day: dayR.e, strPending: pendR.e };
  const raw = { briefing, pace: paceR.ok ? paceR.v : null, closing: clR.ok ? clR.v : null, str: strR.ok ? strR.v : null, strPending: pendR.ok ? pendR.v : null, day: dayR.ok ? dayR.v : null };
  const findings = buildFindings({ briefing, closing: raw.closing, strPending: raw.strPending, now });

  const avail = {
    SALES: bR.ok ? { state: 'ready' } : { state: 'error', reason: bR.e },
    CASH: bR.ok ? (raw.day ? { state: 'ready' } : { state: 'error', reason: dayR.e }) : { state: 'error', reason: bR.e },
    INVENTORY: bR.ok ? (briefing.inventory ? { state: 'ready' } : { state: 'empty', reason: 'Inventory data not loaded. Open the Inventory page once.' }) : { state: 'error', reason: bR.e },
    STAFF: bR.ok ? (briefing.credit ? { state: 'ready' } : { state: 'empty', reason: 'No staff credit data found.' }) : { state: 'error', reason: bR.e },
    STR: strR.ok ? { state: 'ready' } : { state: 'error', reason: strR.e },
    CLOSING: clR.ok ? { state: 'ready' } : { state: 'error', reason: clR.e },
  };
  const systems = {};
  for (const s of SYSTEMS) systems[s] = { ...systemStatus(s, findings, avail[s]), availability: avail[s], metrics: metricsFor(s, raw), fresh: freshnessFor(s, raw, now) };
  return { at: now, raw, findings, systems, errors, forecast: buildForecast(raw.pace, briefing && briefing.target), tableReadyErrors: Object.values(errors).filter(Boolean).length };
}

function metricsFor(s, r) {
  const b = r.briefing, M = (label, value, src) => ({ label, value: String(value), src });
  try {
    if (s === 'SALES' && b) return [
      b.last_sales_entry && M('Latest entry', 'Rs ' + fmtNum(b.last_sales_entry.total_sale) + ' · ' + b.last_sales_entry.date, 'daily_briefing'),
      r.pace && M('Target done', r.pace.pct_done + '%', 'get_target_pace'),
      b.yesterday && b.yesterday.vs_recent_avg_pct != null && M('Yesterday vs avg', b.yesterday.vs_recent_avg_pct + '%', 'daily_briefing'),
      M('Missing entry days', b.missing_sales_days, 'daily_briefing'),
    ].filter(Boolean);
    if (s === 'CASH' && r.day) return [M('DIFF (' + r.day.date + ')', 'Rs ' + fmtNum(r.day.diff), 'get_daily_sales'), M('Cash sale', 'Rs ' + fmtNum(r.day.cash_sale), 'get_daily_sales'), M('Bank total', 'Rs ' + fmtNum(r.day.bank_total), 'get_daily_sales'), M('Credit total', 'Rs ' + fmtNum(r.day.credit_total), 'get_daily_sales')];
    if (s === 'INVENTORY' && b && b.inventory) { const i = b.inventory; return [M('Out of stock, selling', i.out_of_stock_but_selling, 'daily_briefing'), M('Run out ≤ 7 days', i.running_out_within_7_days, 'daily_briefing'), M('Not sold 90d+', i.slow_moving_90d_items + ' items', 'daily_briefing'), M('Slow stock value', 'Rs ' + fmtNum(i.slow_moving_stock_value), 'daily_briefing')]; }
    if (s === 'STAFF' && b && b.credit) return [M('Carried-over credit', 'Rs ' + fmtNum(b.credit.carried_over_total), 'daily_briefing'), M('Possible duplicates', b.credit.possible_duplicates, 'daily_briefing'), M('Month', b.credit.month, 'daily_briefing')];
    if (s === 'STR' && r.str) return [M('Awaited', r.str.awaited.all, 'str_overview'), M('Dispatched, not received', r.str.dispatched_not_received.all, 'str_overview'), M('Received', r.str.received, 'str_overview'), r.str.oldest_open && M('Oldest open', r.str.oldest_open.str + ' · ' + r.str.oldest_open.age_days + 'd', 'str_overview')].filter(Boolean);
    if (s === 'CLOSING' && r.closing) {
      const today = r.closing.days && r.closing.days[0];
      return [today && M('Today', today.closed + '/3 shifts closed', 'closing_recent_days'), M('Incomplete days (7d)', (r.closing.incomplete_days || []).length, 'closing_recent_days'), today && M('Net sale today', 'Rs ' + fmtNum(today.net_sale_total), 'closing_recent_days')].filter(Boolean);
    }
  } catch (_) { /* a malformed tool result must never break the screen */ }
  return [];
}

function bridgeStamp(kind) {
  try {
    if (kind === 'inventory') { const d = typeof window.inventoryBridgeGetFullData === 'function' ? window.inventoryBridgeGetFullData() : null; const s = d && d.lastSync && d.lastSync.syncedAt; return s ? Date.parse(s) : null; }
    if (kind === 'str') { const d = typeof window.strBridgeGetFullData === 'function' ? window.strBridgeGetFullData() : null; const s = d && d.lastSyncedAt; return s ? Date.parse(s) : null; }
  } catch (_) { /* ignore */ }
  return null;
}
const DAY = 86400000, H = 3600000;
function freshnessFor(s, r, now) {
  const b = r.briefing;
  if ((s === 'SALES' || s === 'CASH') && b && b.last_sales_entry) { const d = b.last_sales_entry.days_ago; return { status: d >= 2 ? 'WARNING' : 'HEALTHY', label: d === 0 ? 'entry for today' : d + ' day(s) since last sales entry' }; }
  if (s === 'INVENTORY') return freshness(bridgeStamp('inventory'), { warnMs: 26 * H, errMs: 3 * DAY }, now);
  if (s === 'STR') return freshness(bridgeStamp('str'), { warnMs: 26 * H, errMs: 3 * DAY }, now);
  if (s === 'STAFF' && b && b.credit) return { status: 'HEALTHY', label: 'from local ledgers' };
  if (s === 'CLOSING') return { status: 'UNKNOWN', label: 'no sync stamp exposed' };
  return { status: 'UNKNOWN', label: 'no timestamp' };
}

// ───────────────────────────────────────── system health ─────────────────────────────────────────
export async function collectHealth(snapshot, now = Date.now()) {
  const sb = getSb(), rows = [];
  const add = (id, label, status, detail) => rows.push({ id, label, status, detail });
  if (!sb) { ['Supabase', 'Authentication', 'Agent', 'Audit', 'Approvals'].forEach(l => add(l.toLowerCase(), l, 'OFFLINE', 'App is still loading or Supabase client is unavailable.')); }
  else {
    const t0 = Date.now(); const kill = await getKillState(sb); const ms = Date.now() - t0;
    add('supabase', 'Supabase', kill.known ? 'HEALTHY' : 'ERROR', kill.known ? 'Database reachable (' + ms + ' ms)' : 'agent_settings could not be read');
    try {
      const { data, error } = await sb.auth.getSession(); const s = data && data.session;
      add('auth', 'Authentication', error || !s ? 'UNAUTHORIZED' : 'HEALTHY', s ? 'Signed in · session valid until ' + new Date(s.expires_at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'No active session');
    } catch (_) { add('auth', 'Authentication', 'UNKNOWN', 'Session check failed'); }
    const usage = await fetchUsage(sb, 24); const ph = providerHealth(summarizeUsage(usage));
    add('agent', 'Agent (bt-agent function)', ph.status, ph.detail);
    try {
      const { error } = await sb.from('agent_audit').select('id', { head: true, count: 'exact' }).limit(1);
      add('audit', 'Audit log', error ? 'ERROR' : 'HEALTHY', error ? 'agent_audit is not readable' : 'agent_audit readable');
    } catch (_) { add('audit', 'Audit log', 'UNKNOWN', 'Check failed'); }
    add('approvals', 'Approvals / changes', kill.known ? (kill.killed ? 'WARNING' : 'HEALTHY') : 'UNKNOWN', !kill.known ? 'Kill-switch state unknown (changes treated as stopped)' : kill.killed ? 'Kill switch ON: all AI changes are stopped' : 'Gate active: every change needs your approval');
  }
  const stats = toolStats(), tcalls = Object.values(stats).reduce((a, s) => a + s.calls, 0), tfail = Object.values(stats).reduce((a, s) => a + s.failed, 0);
  add('tools', 'Tools', tcalls >= 5 && tfail / tcalls >= 0.15 ? 'DEGRADED' : 'HEALTHY', listTools().length + ' registered · ' + (tcalls ? tfail + ' failed of ' + tcalls + ' runs this session' : 'no runs yet this session'));
  // Specialists: measured from real request_start / error events (this session + the 7-day device history).
  const sh = specialistsHealth(specialistStats(recent(400).reverse()), Object.keys(SPECIALISTS).length - 1);
  add('specialists', 'Specialists', sh.status, sh.detail);
  add('edge', 'Other Edge Functions', 'UNKNOWN', 'No heartbeat exists for the push briefing, closing push or Drive backup, so their health cannot be measured from the app. Not guessed.');
  // Realtime: the app's own bt-sync channel state (window._sbGetChannel is the existing getter used by Sync Center).
  let rtState = null;
  try { const ch = typeof window._sbGetChannel === 'function' ? window._sbGetChannel() : undefined; rtState = ch === undefined ? null : (ch ? (ch.state || '') : ''); } catch (_) { rtState = null; }
  const rt = realtimeHealth(rtState);
  add('realtime', 'Realtime', rt.status, rt.detail);
  const fs = snapshot ? ['INVENTORY', 'STR', 'SALES'].map(s => snapshot.systems[s].fresh) : [];
  const worst = fs.some(f => f.status === 'ERROR') ? 'ERROR' : fs.some(f => f.status === 'WARNING') ? 'WARNING' : fs.some(f => f.status === 'HEALTHY') ? 'HEALTHY' : 'UNKNOWN';
  add('sync', 'Data sync', worst, snapshot ? ['Inventory ' + snapshot.systems.INVENTORY.fresh.label, 'STR ' + snapshot.systems.STR.fresh.label, 'Sales ' + snapshot.systems.SALES.fresh.label].join(' · ') : 'No snapshot');
  add('forecast', 'Forecasting', snapshot && snapshot.forecast.available ? 'HEALTHY' : 'WARNING', snapshot && snapshot.forecast.available ? 'Analytics.getTargetPaceForMonth returned a result' : (snapshot ? snapshot.forecast.reason : 'No snapshot'));
  add('str', 'STR data', snapshot ? (snapshot.systems.STR.availability.state === 'ready' ? 'HEALTHY' : 'WARNING') : 'UNKNOWN', snapshot && snapshot.systems.STR.availability.state === 'ready' ? 'Loaded' : (snapshot && snapshot.systems.STR.availability.reason) || 'No snapshot');
  add('closing', 'Closing data', snapshot ? (snapshot.systems.CLOSING.availability.state === 'ready' ? 'HEALTHY' : 'WARNING') : 'UNKNOWN', snapshot && snapshot.systems.CLOSING.availability.state === 'ready' ? 'Loaded' : (snapshot && snapshot.systems.CLOSING.availability.reason) || 'No snapshot');
  return rows;
}

// ───────────────────────────────────────── actions ─────────────────────────────────────────
export async function collectActions() {
  const sb = getSb();
  if (!sb) return { state: 'offline', recent: [], undos: [] };
  try {
    const [{ data, error }, undos] = await Promise.all([
      sb.from('agent_audit').select('tool, risk, ok, args, error, undone_at, created_at').in('risk', ['write', 'critical']).order('created_at', { ascending: false }).limit(10),
      loadPendingUndos(sb),
    ]);
    if (error) return { state: 'error', error: error.message, recent: [], undos: [] };
    const recent = (data || []).map(r => {
      const a = r.args || {};
      let status = r.ok ? 'applied' : 'not applied';
      if (a._approval === 'rejected') status = 'rejected';
      if (r.undone_at) status = 'undone';
      return { tool: r.tool, risk: r.risk, status, at: r.created_at, error: r.error || null, ref: 'agent_audit · ' + r.created_at };
    });
    return { state: recent.length ? 'ready' : 'empty', recent, undos };
  } catch (e) { return { state: 'error', error: (e && e.message) || 'failed', recent: [], undos: [] }; }
}

export { redact };
