// Long-term memory + the "how I run this pharmacy" document (tables agent_memory / agent_rules).
// Only the owner writes these, from the Memory card in the assistant panel. The model has NO tool
// that writes them, so a poisoned staff note or sheet cell can never plant instructions in memory.
// The bt-agent function reads them server-side and adds them to every prompt (ranked below safety rules).
export const MAX_FACT = 300;
export const MAX_RULES = 4000;
export const MAX_FACTS = 40;

const bad = (error) => ({ ok: false, error });

export function validateFact(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t) return bad('Write something to remember.');
  if (t.length > MAX_FACT) return bad('Keep each fact under ' + MAX_FACT + ' characters.');
  return { ok: true, text: t };
}
export function validateRules(text) {
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (t.length > MAX_RULES) return bad('The rules document is limited to ' + MAX_RULES + ' characters (now ' + t.length + ').');
  return { ok: true, text: t };
}

export async function listFacts(sb) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('agent_memory').select('id, fact, source, created_at').order('created_at', { ascending: false }).limit(MAX_FACTS);
    return error || !Array.isArray(data) ? [] : data;
  } catch (_) { return []; }
}
export async function addFact(sb, text, current = 0, source = 'user') {
  const v = validateFact(text); if (!v.ok) return v;
  if (current >= MAX_FACTS) return bad('Memory is full (' + MAX_FACTS + ' facts). Delete one first.');
  try {
    const { data, error } = await sb.from('agent_memory').insert(source === 'assistant' ? { fact: v.text, source: 'assistant' } : { fact: v.text }).select('id, fact, created_at');
    return error ? bad(error.message || 'Could not save.') : { ok: true, row: data && data[0] };
  } catch (e) { return bad((e && e.message) || 'Could not save.'); }
}
export async function updateFact(sb, id, text) {
  const v = validateFact(text); if (!v.ok) return v;
  try {
    const { data, error } = await sb.from('agent_memory').update({ fact: v.text, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    return error ? bad(error.message || 'Could not save.') : (data && data.length ? { ok: true } : bad('Not found.'));
  } catch (e) { return bad((e && e.message) || 'Could not save.'); }
}
export async function deleteFact(sb, id) {
  try {
    const { error } = await sb.from('agent_memory').delete().eq('id', id);
    return error ? bad(error.message || 'Could not delete.') : { ok: true };
  } catch (e) { return bad((e && e.message) || 'Could not delete.'); }
}

/** @returns {Promise<{body:string, version:number}>} latest rules ('' / 0 when none) */
export async function getRules(sb) {
  if (!sb) return { body: '', version: 0 };
  try {
    const { data } = await sb.from('agent_rules').select('body, version').order('version', { ascending: false }).limit(1);
    return data && data[0] ? { body: data[0].body || '', version: data[0].version || 0 } : { body: '', version: 0 };
  } catch (_) { return { body: '', version: 0 }; }
}
/** Saves a NEW version (history is never overwritten). */
export async function saveRules(sb, text, currentVersion = 0) {
  const v = validateRules(text); if (!v.ok) return v;
  try {
    const { error } = await sb.from('agent_rules').insert({ body: v.text, version: (currentVersion || 0) + 1 });
    return error ? bad(error.code === '23505' ? 'The rules changed on another device. Reopen Memory and try again.' : (error.message || 'Could not save.')) : { ok: true, version: (currentVersion || 0) + 1 };
  } catch (e) { return bad((e && e.message) || 'Could not save.'); }
}
