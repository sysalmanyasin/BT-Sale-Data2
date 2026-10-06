// Server-side kill switch for AI changes (table agent_settings, key 'writes_killed').
// One tap disables writes on EVERY device: the panel reads it before each request and the
// bt-agent function echoes it back on every response. Fails SAFE: if the state can't be read,
// writes are treated as killed. Reads/answers keep working either way.
const KEY = 'writes_killed';

/** @returns {Promise<{killed:boolean, known:boolean}>} */
export async function getKillState(sb) {
  try {
    if (!sb) return { killed: true, known: false };
    const { data, error } = await sb.from('agent_settings').select('value').eq('key', KEY).maybeSingle();
    if (error || !data) return { killed: true, known: false };
    return { killed: data.value !== false, known: true }; // anything other than a literal false counts as killed
  } catch (_) { return { killed: true, known: false }; }
}

/** @returns {Promise<{ok:boolean, killed?:boolean, error?:string}>} */
export async function setKillState(sb, killed, who = null) {
  try {
    if (!sb) return { ok: false, error: 'App is still loading.' };
    const { data, error } = await sb.from('agent_settings')
      .update({ value: !!killed, updated_by: who, updated_at: new Date().toISOString() })
      .eq('key', KEY).select('value');
    if (error) return { ok: false, error: error.message || 'Could not update.' };
    if (!data || !data.length) return { ok: false, error: 'Not allowed to change this setting.' };
    return { ok: true, killed: !!killed };
  } catch (e) { return { ok: false, error: (e && e.message) || 'Could not update.' }; }
}
