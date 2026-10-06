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
import { getToolSchemas, runTool, getTool, isChange } from './tool-registry.js';
import { pickSpecialist } from './specialists.js';
import { reviewChange, recordChange } from './auditor.js';
import { newUndoKey, makeRecipe } from './undo-store.js';

export const MAX_STEPS = 8;
export const MAX_HISTORY = 30;
export const MAX_CHANGES_PER_TURN = 5;

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
export async function runAgent({ history = [], userText, context = {}, callServer, onEvent = () => {}, onAudit = () => {}, signal, sensitive = false, allow, writesEnabled = false, approve = null, onUndoable = () => {}, prevSpecialist = null, writesKilled = false }) {
  if (typeof callServer !== 'function') throw new AgentError('callServer is required');
  const messages = [...history, { role: 'user', content: String(userText || '').slice(0, 4000) }];
  const specialist = pickSpecialist(userText, prevSpecialist);
  const domains = specialist.domains;
  // Server kill switch: when on, change tools are neither offered nor executed, whatever the local lock says.
  let killed = !!writesKilled;
  const canWrite = () => !!writesEnabled && !killed;
  let tools = getToolSchemas({ includeWrites: canWrite(), domains });
  let changeAttempts = 0;
  let sawSensitive = !!sensitive;
  let repeatGuard = '';

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (signal && signal.aborted) throw new AgentError('Cancelled', { code: 'aborted' });
    onEvent({ type: 'step', step });
    const res = await callServer({
      messages: messages.slice(-MAX_HISTORY),
      tools,
      context: { ...context, writes_enabled: canWrite(), focus: specialist.id },
      sensitivity: sawSensitive ? 'high' : 'normal',
      signal,
    });
    const msg = res && res.message;
    if (!msg) throw new AgentError('Empty response from AI');
    if (res.settings && res.settings.writes_killed === true && !killed) { killed = true; tools = getToolSchemas({ includeWrites: false, domains }); onEvent({ type: 'writes_killed' }); }

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const assistantMsg = { role: 'assistant', content: msg.content || null };
    if (calls.length) assistantMsg.tool_calls = calls;
    messages.push(assistantMsg);

    if (!calls.length) {
      const text = (msg.content || '').trim();
      return { text: text || 'I could not produce an answer. Please rephrase.', messages: compactHistory(messages), steps: step, sensitive: sawSensitive, domains, specialist };
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
      } else if (isChange(getTool(name)) && ++changeAttempts > MAX_CHANGES_PER_TURN) {
        result = { ok: false, tool: getTool(name), error: 'cap', text: JSON.stringify({ error: 'Too many changes proposed in one request. Stop and summarise what is done.' }) };
      } else {
        result = await runTool(name, rawArgs, { ...(allow ? { allow } : {}), writesEnabled: canWrite(), approve, review: reviewChange, onChanged: recordChange });
      }
      if (result.tool && result.tool.sensitive) sawSensitive = true;
      onEvent({ type: 'tool_end', name, ok: result.ok, error: result.error, rejected: !!result.rejected });
      const undoKey = result.undo ? newUndoKey() : null;
      if (result.undo) { try { onUndoable({ tool: name, key: undoKey, ...result.undo }); } catch (_) { /* ui only */ } }
      try {
        const risk = result.tool ? result.tool.risk : 'unknown';
        const a = safeParse(rawArgs);
        if (risk === 'write' || risk === 'critical') a._approval = result.ok ? 'approved' : (result.rejected ? 'rejected' : 'not_applied');
        const undo = undoKey && result.undoData ? makeRecipe({ key: undoKey, tool: name, label: result.undo.label, args: result.undoData.args, out: result.undoData.out }) : null;
        onAudit({ tool: name, risk, args: a, ok: result.ok, resultChars: result.text.length, error: result.error || null, ...(undo ? { undo } : {}) });
      } catch (_) { /* audit is best-effort */ }
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: result.text });
    }
  }
  const text = 'I took too many steps without finishing. Try asking a narrower question.';
  messages.push({ role: 'assistant', content: text });
  return { text, messages: compactHistory(messages), steps: MAX_STEPS, sensitive: sawSensitive, domains, specialist };
}

/**
 * Keep only what later turns need: the user's questions and the assistant's final
 * text answers. Old tool calls/results are dropped (the model re-reads data when
 * it needs it), which keeps every later request small.
 */
export function compactHistory(messages) {
  return messages.filter(m => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls && typeof m.content === 'string' && m.content.trim());
}

function safeParse(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch (_) { return { _raw: String(s).slice(0, 200) }; } }
