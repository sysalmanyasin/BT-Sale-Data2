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
import { pickSpecialist, needsModelRoute, specialistForDomains } from './specialists.js';
import { reviewChange, recordChange } from './auditor.js';
import { newUndoKey, makeRecipe } from './undo-store.js';
import { emit } from './telemetry.js';

export const MAX_STEPS = 8;
export const MAX_HISTORY = 30;
export const MAX_CHANGES_PER_TURN = 5;
export const ROUTE_TIMEOUT_MS = 3500, REVIEW_TIMEOUT_MS = 4500, REVIEW_MIN_AMOUNT = 20000;

function withTimeout(promise, ms) {
  let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t));
}

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
export async function runAgent({ history = [], userText, context = {}, callServer, onEvent = () => {}, onAudit = () => {}, signal, sensitive = false, allow, writesEnabled = false, approve = null, onUndoable = () => {}, prevSpecialist = null, writesKilled = false, stream = false, routeServer = null, reviewServer = null }) {
  if (typeof callServer !== 'function') throw new AgentError('callServer is required');
  const messages = [...history, { role: 'user', content: String(userText || '').slice(0, 4000) }];
  let specialist = pickSpecialist(userText, prevSpecialist);
  // Real-event telemetry for the AI Center (in-memory only; args are redacted). Never affects the loop.
  const requestId = 'rq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tel = (type, extra = {}) => emit({ type, request_id: requestId, agent: specialist.label, ...extra });
  tel('request_start', { metadata: { question: String(userText || '').slice(0, 100), specialist: specialist.id } });
  // Keyword routing first (free, instant). Only a message with no clues at all costs one small model call.
  if (typeof routeServer === 'function' && needsModelRoute(userText, prevSpecialist)) {
    try { const picked = specialistForDomains(await withTimeout(routeServer(String(userText).slice(0, 400)), ROUTE_TIMEOUT_MS)); if (picked) { specialist = picked; onEvent({ type: 'routed', specialist: picked.id }); tel('routed', { agent: picked.label, metadata: { specialist: picked.id, by: 'model' } }); } }
    catch (_) { /* keyword fallback already chosen */ }
  }
  const domains = specialist.domains;
  tel('routed', { metadata: { specialist: specialist.id, domains, by: 'rules' } });
  // Advisory model reviewer: can only ADD a warning to the approval card, never remove one or approve anything.
  const review = async (p) => {
    const base = reviewChange(p);
    if (typeof reviewServer !== 'function' || !(p.risk === 'critical' || (Number(p.preview && p.preview.amount) || 0) >= REVIEW_MIN_AMOUNT)) return base;
    try {
      const r = await withTimeout(reviewServer(p), REVIEW_TIMEOUT_MS);
      if (r && typeof r.concern === 'string' && r.concern.trim()) { base.warnings = [...base.warnings, 'AI reviewer: ' + r.concern.trim().slice(0, 200)]; if (r.severity === 'high') base.strong = true; }
    } catch (_) { /* reviewer unavailable: the rules above still apply */ }
    return base;
  };
  // Server kill switch: when on, change tools are neither offered nor executed, whatever the local lock says.
  let killed = !!writesKilled;
  const canWrite = () => !!writesEnabled && !killed;
  let approveTel = approve;
  if (typeof approve === 'function') {
    approveTel = async (p) => {
      // Everything the AI Center needs to show a proper approval view comes from the REAL proposal (tool preview),
      // never from model prose. `args` are redacted by emit(); the approval itself is still decided by the human
      // through the one approval card/controller.
      const approvalId = 'ap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const def = getTool(p.tool) || {};
      const pv = p.preview || {};
      tel('approval_requested', { tool: p.tool, domain: def.domain || null, severity: p.risk === 'critical' ? 'critical' : 'warning', entity_reference: approvalId,
        metadata: { approval_id: approvalId, risk: p.risk, title: pv.title, strong: !!pv.strong, amount: pv.amount, confirm_word: !!pv.confirmWord, reversible: typeof def.makeUndo === 'function', sensitive: !!def.sensitive,
          lines: (pv.lines || []).slice(0, 8).map(String), warnings: (pv.warnings || []).slice(0, 5).map(String), args: p.args, question: String(userText || '').slice(0, 100), specialist: specialist.id } });
      const t0 = Date.now();
      const v = await approve({ ...p, approval_id: approvalId });
      const ok = v === true || !!(v && v.approved === true);
      tel('approval_resolved', { tool: p.tool, status: ok ? 'approved' : 'rejected', entity_reference: approvalId, duration: Date.now() - t0, metadata: { risk: p.risk, approval_id: approvalId } });
      return v;
    };
  }
  let tools = getToolSchemas({ includeWrites: canWrite(), domains });
  let changeAttempts = 0;
  let sawSensitive = !!sensitive;
  let repeatGuard = '';

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (signal && signal.aborted) throw new AgentError('Cancelled', { code: 'aborted' });
    onEvent({ type: 'step', step });
    tel('step', { metadata: { step, max: MAX_STEPS } });
    let res;
    try { res = await callServer({
      messages: messages.slice(-MAX_HISTORY),
      tools,
      context: { ...context, writes_enabled: canWrite(), focus: specialist.id },
      sensitivity: sawSensitive ? 'high' : 'normal',
      signal,
      ...(stream ? { onToken: t => onEvent({ type: 'token', text: t }), onReset: () => onEvent({ type: 'reset' }) } : {}),
    }); } catch (e) {
      tel(e && e.code === 'aborted' ? 'cancelled' : 'error', { status: 'failed', severity: 'error', metadata: { message: String((e && e.message) || e).slice(0, 140), http_status: e && e.status } });
      throw e;
    }
    const msg = res && res.message;
    if (!msg) throw new AgentError('Empty response from AI');
    if (res.settings && res.settings.writes_killed === true && !killed) { tel('writes_killed', { source: 'server', severity: 'warning' }); killed = true; tools = getToolSchemas({ includeWrites: false, domains }); onEvent({ type: 'writes_killed' }); }

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const assistantMsg = { role: 'assistant', content: msg.content || null };
    if (calls.length) assistantMsg.tool_calls = calls;
    messages.push(assistantMsg);

    if (calls.length) onEvent({ type: 'reset' }); // text streamed before a tool call is narration, not the answer
    if (!calls.length) {
      const text = (msg.content || '').trim();
      tel('answer', { status: 'ok', metadata: { steps: step, chars: text.length, text: text.slice(0, 1200) } });
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
      const callRef = String(call.id || name) + ':' + step;
      const t0 = Date.now(), toolDef = getTool(name);
      tel('tool_start', { tool: name, domain: toolDef ? toolDef.domain : null, entity_reference: callRef, metadata: { risk: toolDef ? toolDef.risk : 'unknown', args: safeParse(rawArgs) } });
      let result;
      if (looping) {
        result = { ok: false, tool: null, error: 'repeat', text: JSON.stringify({ error: 'You already made this exact call. Answer using the data you have.' }) };
      } else if (isChange(getTool(name)) && ++changeAttempts > MAX_CHANGES_PER_TURN) {
        result = { ok: false, tool: getTool(name), error: 'cap', text: JSON.stringify({ error: 'Too many changes proposed in one request. Stop and summarise what is done.' }) };
      } else {
        result = await runTool(name, rawArgs, { ...(allow ? { allow } : {}), writesEnabled: canWrite(), approve: approveTel, review, onChanged: recordChange,
          // Real VERIFY step: the tool's verifier reads the change back from the app's store (see tools/verify.js).
          onVerify: ev => ev.phase === 'start'
            ? tel('verify_start', { tool: name, domain: toolDef ? toolDef.domain : null, entity_reference: callRef })
            : tel('verify_end', { tool: name, domain: toolDef ? toolDef.domain : null, entity_reference: callRef, status: ev.verified && ev.verified.ok ? 'ok' : 'failed', duration: ev.verified ? ev.verified.ms : null, severity: ev.verified && ev.verified.ok ? 'info' : 'warning', metadata: { checks: ev.verified ? ev.verified.checks : [] } }) });
      }
      if (result.tool && result.tool.sensitive) sawSensitive = true;
      onEvent({ type: 'tool_end', name, ok: result.ok, error: result.error, rejected: !!result.rejected });
      tel('tool_end', { tool: name, domain: toolDef ? toolDef.domain : null, entity_reference: callRef, status: result.ok ? 'ok' : (result.rejected ? 'rejected' : 'failed'), duration: Date.now() - t0, severity: result.ok || result.rejected ? 'info' : 'warning', metadata: { risk: toolDef ? toolDef.risk : 'unknown', error: result.ok ? undefined : result.error, verified: result.verified ? result.verified.ok : undefined, undoable: result.ok && !!result.undo } });
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
  tel('error', { status: 'failed', severity: 'warning', metadata: { message: 'step limit reached' } });
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
