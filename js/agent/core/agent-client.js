// ══════════════════════════════════════════════════════════════════════
// AGENT CLIENT — drives the tool loop in the browser.
//
// The server performs one model step per call. When the model asks for
// tools we run them locally (against the live app data), append the
// results, and call the server again, up to MAX_STEPS.
//
// Dependencies are injected so the loop is unit-testable without a
// network, DOM, or Supabase.
// ══════════════════════════════════════════════════════════════════════
import { getToolSchemas, runTool } from './tool-registry.js';

export const MAX_STEPS = 8;
export const MAX_HISTORY = 30;

export class AgentError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'AgentError'; this.status = status; this.code = code; }
}

/**
 * @param {object} o
 * @param {Array}  o.history        prior OpenAI-format messages (user/assistant/tool)
 * @param {string} o.userText
 * @param {object} o.context        small context object (page, date…)
 * @param {Function} o.callServer   async ({messages,tools,context,sensitivity}) => {message}
 * @param {Function} [o.onEvent]    ({type:'tool_start'|'tool_end'|'step', ...})
 * @param {Function} [o.onAudit]    ({tool,risk,args,ok,resultChars,error})
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{text:string, messages:Array, steps:number, sensitive:boolean}>}
 */
export async function runAgent({ history = [], userText, context = {}, callServer, onEvent = () => {}, onAudit = () => {}, signal, sensitive = false, allow }) {
  if (typeof callServer !== 'function') throw new AgentError('callServer is required');
  const messages = [...history, { role: 'user', content: String(userText || '').slice(0, 4000) }];
  const tools = getToolSchemas();
  let sawSensitive = !!sensitive;
  let repeatGuard = '';

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (signal && signal.aborted) throw new AgentError('Cancelled', { code: 'aborted' });
    onEvent({ type: 'step', step });
    const res = await callServer({
      messages: messages.slice(-MAX_HISTORY),
      tools,
      context,
      sensitivity: sawSensitive ? 'high' : 'normal',
      signal,
    });
    const msg = res && res.message;
    if (!msg) throw new AgentError('Empty response from AI');

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const assistantMsg = { role: 'assistant', content: msg.content || null };
    if (calls.length) assistantMsg.tool_calls = calls;
    messages.push(assistantMsg);

    if (!calls.length) {
      const text = (msg.content || '').trim();
      return { text: text || 'I could not produce an answer. Please rephrase.', messages, steps: step, sensitive: sawSensitive };
    }

    // Guard against the model looping on the exact same call set.
    const sig = JSON.stringify(calls.map(c => [c.function && c.function.name, c.function && c.function.arguments]));
    const looping = sig === repeatGuard;
    repeatGuard = sig;

    for (const call of calls.slice(0, 6)) {
      const name = call.function && call.function.name;
      const rawArgs = call.function && call.function.arguments;
      onEvent({ type: 'tool_start', name, args: rawArgs });
      let result;
      if (looping) {
        result = { ok: false, tool: null, error: 'repeat', text: JSON.stringify({ error: 'You already made this exact call. Answer using the data you have.' }) };
      } else {
        result = await runTool(name, rawArgs, allow ? { allow } : undefined);
      }
      if (result.tool && result.tool.sensitive) sawSensitive = true;
      onEvent({ type: 'tool_end', name, ok: result.ok, error: result.error });
      try {
        onAudit({ tool: name, risk: result.tool ? result.tool.risk : 'unknown', args: safeParse(rawArgs), ok: result.ok, resultChars: result.text.length, error: result.error || null });
      } catch (_) { /* audit is best-effort */ }
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: result.text });
    }
  }
  const text = 'I took too many steps without finishing. Try asking a narrower question.';
  messages.push({ role: 'assistant', content: text });
  return { text, messages, steps: MAX_STEPS, sensitive: sawSensitive };
}

function safeParse(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch (_) { return { _raw: String(s).slice(0, 200) }; } }
