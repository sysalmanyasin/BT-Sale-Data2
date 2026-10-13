// Device-local assistant preferences (UI setting, not business data).
const KEY = 'bt_agent_prefs_v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
export const getWritesEnabled = () => read().writesEnabled === true; // default: LOCKED
export function setWritesEnabled(v) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), writesEnabled: !!v })); } catch (_) { /* blocked storage → stays locked */ }
}

// Assistant personality: 'concise' | 'friendly' | 'chatty'. Only the id is sent; the server owns the wording.
export const STYLES = [['concise', 'Concise'], ['friendly', 'Friendly'], ['chatty', 'Chatty']];
export const getStyle = () => { const s = read().style; return STYLES.some(x => x[0] === s) ? s : 'concise'; };
export function setStyle(v) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), style: STYLES.some(x => x[0] === v) ? v : 'concise' })); } catch (_) { /* ignore */ }
}

// Which briefing the owner has already seen today (so the ✨ badge doesn't nag).
export const getBriefingSeen = () => { const v = read().briefingSeen; return v && typeof v === 'object' ? v : null; };
export function setBriefingSeen(date, count) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), briefingSeen: { date, count } })); } catch (_) { /* ignore */ }
}
