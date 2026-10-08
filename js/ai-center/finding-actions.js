// Finding lifecycle only. Financial/inventory changes remain inside BT Agent approval/audit/VERIFY.
import { emit } from '../agent/core/telemetry.js';

export async function loadFindingActions(sb, ids) {
  if (!sb || !ids.length) return {};
  try {
    const { data, error } = await sb.from('agent_finding_actions').select('finding_id,action,created_at,snoozed_until').in('finding_id', ids).order('created_at', { ascending: false });
    if (error) throw error;
    const out = {};
    for (const r of data || []) if (!out[r.finding_id]) out[r.finding_id] = r;
    return out;
  } catch (_) { return {}; }
}

export async function setFindingAction(sb, finding, action) {
  if (!sb || !finding) return { ok: false, error: 'Supabase is unavailable.' };
  const row = { finding_id: finding.id, action, note: finding.title, ...(action === 'snoozed' ? { snoozed_until: new Date(Date.now() + 7 * 86400000).toISOString() } : {}) };
  try {
    const { error } = await sb.from('agent_finding_actions').upsert(row, { onConflict: 'user_id,finding_id,action' });
    if (error) throw error;
    emit({ type: 'finding_action', source: 'ai-center', entity_reference: finding.id, domain: String(finding.system || '').toLowerCase(), severity: 'info', metadata: { action, title: finding.title } });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || 'Could not save finding action.' }; }
}

export function isSuppressed(state) {
  if (!state) return false;
  if (state.action === 'resolved') return true;
  return state.action === 'snoozed' && state.snoozed_until && Date.parse(state.snoozed_until) > Date.now();
}