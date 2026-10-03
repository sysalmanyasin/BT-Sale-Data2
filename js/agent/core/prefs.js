// Device-local assistant preferences (UI setting, not business data).
const KEY = 'bt_agent_prefs_v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
export const getWritesEnabled = () => read().writesEnabled === true; // default: LOCKED
export function setWritesEnabled(v) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), writesEnabled: !!v })); } catch (_) { /* blocked storage → stays locked */ }
}
