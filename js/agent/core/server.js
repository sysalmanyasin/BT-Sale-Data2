// Thin transport to the bt-agent Edge Function. Uses the app's real
// Supabase session JWT (Google sign-in) — never an API key.
import { AgentError } from './agent-client.js';
import { emit as telEmit } from './telemetry.js';
import { parseSSE } from '../../shared/agent-shared.js';

const FN_URL = 'https://wetbugzzchkghpzmowod.supabase.co/functions/v1/bt-agent';

export async function getAccessToken() {
  const sb = typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null;
  if (!sb) throw new AgentError('App is still loading. Try again in a moment.', { code: 'no-client' });
  const { data, error } = await sb.auth.getSession();
  if (error || !data || !data.session) throw new AgentError('Please sign in first.', { status: 401, code: 'no-session' });
  return data.session.access_token;
}

export const retry = { delayMs: 4000 }; // tests set this to 0

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new AgentError('Cancelled', { code: 'aborted' })); }, { once: true });
});

const ERR_MAP = (data) => ({ 401: 'Session expired. Please sign in again.', 403: 'This account is not authorised for AI.', 429: (data && data.error) || 'Rate limit reached.', 503: (data && data.error) || 'AI providers are busy.' });

/** One automatic retry when providers are busy / rate-limited (free-tier limits reset quickly). */
export async function callServer(args) {
  try { return await callServerOnce(args); }
  catch (e) {
    if (e instanceof AgentError && (e.status === 503 || e.status === 429) && !/Daily AI request limit/.test(e.message)) {
      if (typeof args.onReset === 'function') args.onReset();
      // A REAL retry (busy / rate-limited provider): recorded so the AI Center can show retries honestly.
      telEmit({ type: 'retry', source: 'server', status: String(e.status), severity: 'warning', metadata: { http_status: e.status, delay_ms: retry.delayMs } });
      await sleep(retry.delayMs, args.signal);
      return callServerOnce(args);
    }
    throw e;
  }
}

async function post(payload, signal) {
  const token = await getAccessToken();
  try {
    return await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload), signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new AgentError('Cancelled', { code: 'aborted' });
    throw new AgentError('Network problem. Check your connection.', { code: 'network' });
  }
}

async function failFrom(res) {
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON */ }
  throw new AgentError(ERR_MAP(data)[res.status] || (data && data.error) || ('AI error ' + res.status), { status: res.status });
}

async function callServerOnce({ messages, tools, context, sensitivity, signal, onToken, onReset }) {
  const streaming = typeof onToken === 'function';
  const res = await post({ messages, tools, context, sensitivity, ...(streaming ? { stream: true } : {}) }, signal);
  if (!res.ok) return failFrom(res);
  const ctype = res.headers && typeof res.headers.get === 'function' ? (res.headers.get('content-type') || '') : '';
  const isSSE = /text\/event-stream/.test(ctype);
  if (!isSSE || !res.body) { // older server, or streaming not used: plain JSON
    let data = null; try { data = await res.json(); } catch (_) { /* fallthrough */ }
    if (!data) throw new AgentError('Empty response from AI');
    return data;
  }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseSSE(buf + dec.decode(value, { stream: true })); buf = parsed.rest;
      for (const d of parsed.data) {
        let ev; try { ev = JSON.parse(d); } catch (_) { continue; }
        if (ev.t === 'delta' && typeof ev.c === 'string') onToken(ev.c);
        else if (ev.t === 'reset' && typeof onReset === 'function') onReset();
        else if (ev.t === 'error') throw new AgentError(ERR_MAP(ev)[ev.status] || ev.error || 'AI error', { status: ev.status });
        else if (ev.t === 'done') { const { t, ...rest } = ev; return rest; }
      }
    }
  } catch (e) {
    if (e instanceof AgentError) throw e;
    if (e && e.name === 'AbortError') throw new AgentError('Cancelled', { code: 'aborted' });
    throw new AgentError('Connection lost while the answer was streaming.', { code: 'network' });
  }
  throw new AgentError('Connection lost while the answer was streaming.', { code: 'network' });
}

/** One-shot JSON actions on the same function: 'route', 'review', 'index', 'search'. */
export async function callAction(action, payload = {}, { signal } = {}) {
  const res = await post({ action, ...payload }, signal);
  if (!res.ok) return failFrom(res);
  let data = null; try { data = await res.json(); } catch (_) { /* fallthrough */ }
  if (!data) throw new AgentError('Empty response from AI');
  return data;
}
