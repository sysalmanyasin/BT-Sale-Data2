// Thin transport to the bt-agent Edge Function. Uses the app's real
// Supabase session JWT (Google sign-in) — never an API key.
import { AgentError } from './agent-client.js';

const FN_URL = 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/bt-agent';

export async function getAccessToken() {
  const sb = typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null;
  if (!sb) throw new AgentError('App is still loading. Try again in a moment.', { code: 'no-client' });
  const { data, error } = await sb.auth.getSession();
  if (error || !data || !data.session) throw new AgentError('Please sign in first.', { status: 401, code: 'no-session' });
  return data.session.access_token;
}

export async function callServer({ messages, tools, context, sensitivity, signal }) {
  const token = await getAccessToken();
  let res;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ messages, tools, context, sensitivity }),
      signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new AgentError('Cancelled', { code: 'aborted' });
    throw new AgentError('Network problem. Check your connection.', { code: 'network' });
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON */ }
  if (!res.ok) {
    const map = { 401: 'Session expired. Please sign in again.', 403: 'This account is not authorised for AI.', 429: (data && data.error) || 'Rate limit reached.', 503: (data && data.error) || 'AI providers are busy.' };
    throw new AgentError(map[res.status] || (data && data.error) || ('AI error ' + res.status), { status: res.status });
  }
  return data;
}
