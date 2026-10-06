// ══════════════════════════════════════════════════════════════════════
// AGENT TOOL REGISTRY
//
// Every capability the AI can use is a registered tool:
//   { name, description, parameters (JSON schema), risk, domain,
//     sensitive, run(args) }
// risk:  'read'     – returns data, changes nothing (Phase 1)
//        'ui'       – changes only what the user is looking at (navigate)
//        'write'    – changes business data (Phase 2, approval-gated)
//        'critical' – money/delete/refund (Phase 2+, typed confirmation)
// sensitive: result contains staff-identity / pay / credit data, so the
//            conversation is routed only to non-training providers.
// Pure module: no DOM, no app imports. Safe to unit test.
// ══════════════════════════════════════════════════════════════════════

import { blockedByName, blockedByArgs } from './hard-blocks.js';

const RESULT_CHAR_CAP = 6000;
const _tools = new Map();

export const RISKS = Object.freeze(['read', 'ui', 'write', 'critical']);

export function registerTool(def) {
  if (!def || !/^[a-zA-Z0-9_-]{1,64}$/.test(def.name || '')) throw new Error('registerTool: invalid name');
  if (typeof def.run !== 'function') throw new Error('registerTool: run() required for ' + def.name);
  if (!def.description) throw new Error('registerTool: description required for ' + def.name);
  const hard = blockedByName(def.name);
  if (hard) throw new Error('registerTool: "' + def.name + '" is hard-blocked. ' + hard);
  const risk = def.risk || 'read';
  if (!RISKS.includes(risk)) throw new Error('registerTool: bad risk for ' + def.name);
  const changes = risk === 'write' || risk === 'critical';
  if (changes && typeof def.preview !== 'function') throw new Error('registerTool: write tools need preview() — ' + def.name);
  _tools.set(def.name, {
    name: def.name,
    description: def.description,
    parameters: def.parameters || { type: 'object', properties: {} },
    risk,
    domain: def.domain || 'app',
    sensitive: !!def.sensitive,
    run: def.run,
    preview: def.preview || null,   // (args) → {title, lines[], warnings[], strong}; throws on invalid args
    makeUndo: def.makeUndo || null, // (args, result) → {label, fn} | null
  });
}

export function getTool(name) { return _tools.get(name) || null; }
export function listTools() { return [..._tools.values()]; }
export function clearTools() { _tools.clear(); }

export const isChange = tool => !!tool && (tool.risk === 'write' || tool.risk === 'critical');

/** OpenAI-format tool schemas for the server. Change tools are only offered when writes are unlocked. */
export function getToolSchemas({ includeWrites = false, domains = null } = {}) {
  const want = domains ? new Set([...domains, 'app']) : null;
  return listTools().filter(t => (includeWrites || !isChange(t)) && (!want || want.has(t.domain))).map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function _validateArgs(schema, args) {
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];
  for (const k of required) {
    if (args[k] === undefined || args[k] === null || args[k] === '') return 'missing required argument "' + k + '"';
  }
  for (const [k, v] of Object.entries(args)) {
    const def = props[k];
    if (!def) { delete args[k]; continue; } // drop unknown args instead of passing them through
    if (v === null || v === undefined) { delete args[k]; continue; }
    if (def.type === 'number' || def.type === 'integer') {
      const num = Number(v);
      if (!Number.isFinite(num)) return 'argument "' + k + '" must be a number';
      args[k] = num;
    } else if (def.type === 'boolean') {
      if (typeof v === 'string') args[k] = v === 'true';
    } else if (def.type === 'string') {
      args[k] = String(v).slice(0, 500);
    }
    if (def.enum && !def.enum.includes(args[k])) return 'argument "' + k + '" must be one of ' + def.enum.join(', ');
  }
  return null;
}

function _cap(value) {
  let s;
  try { s = JSON.stringify(value === undefined ? null : value); } catch (e) { s = JSON.stringify({ error: 'result not serialisable' }); }
  if (s.length <= RESULT_CHAR_CAP) return { text: s, truncated: false };
  return { text: s.slice(0, RESULT_CHAR_CAP) + '…[truncated: narrow your query with filters or a smaller limit]', truncated: true };
}

/**
 * Execute a tool. Never throws.
 *
 * Read/ui tools run directly. CHANGE tools (write/critical) are enforced here,
 * in code, not in the prompt:
 *   1. writes must be unlocked (writesEnabled),
 *   2. an approve() callback must exist,
 *   3. preview() validates the arguments and describes the change,
 *   4. the human must approve — rejection means run() is never called.
 * @returns {{ok:boolean, text:string, tool:object|null, error?:string, rejected?:boolean, undo?:object, preview?:object}}
 */
export async function runTool(name, rawArgs, { allow = ['read', 'ui'], writesEnabled = false, approve = null, review = null, onChanged = null } = {}) {
  const tool = getTool(name);
  if (!tool) return { ok: false, tool: null, error: 'unknown tool', text: JSON.stringify({ error: 'Unknown tool: ' + name }) };
  const changing = isChange(tool);
  { // Hard blocks come first: no unlock, approval or typed word can override them.
    const hard = blockedByName(name);
    if (hard) return { ok: false, tool, error: 'hard_blocked', text: JSON.stringify({ error: hard, hard_blocked: true, note: 'Tell the user this is never done by the assistant.' }) };
  }
  if (changing) {
    if (!writesEnabled) return { ok: false, tool, error: 'writes_disabled', text: JSON.stringify({ error: 'Changes are switched off. Tell the user to unlock changes with the lock button in the assistant header, then ask again.' }) };
    if (typeof approve !== 'function') return { ok: false, tool, error: 'blocked', text: JSON.stringify({ error: 'No approval channel available. Nothing was changed.' }) };
  } else if (!allow.includes(tool.risk)) {
    return { ok: false, tool, error: 'blocked', text: JSON.stringify({ error: 'This kind of tool is not allowed here.' }) };
  }
  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = args.trim() ? JSON.parse(args) : {}; } catch (e) {
      return { ok: false, tool, error: 'bad json', text: JSON.stringify({ error: 'Arguments were not valid JSON. Retry with a valid JSON object.' }) };
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  args = { ...args };
  { const hard = blockedByArgs(name, args);
    if (hard) return { ok: false, tool, error: 'hard_blocked', text: JSON.stringify({ error: hard, hard_blocked: true, note: 'Tell the user this is never done by the assistant.' }) }; }
  const bad = _validateArgs(tool.parameters, args);
  if (bad) return { ok: false, tool, error: bad, text: JSON.stringify({ error: bad }) };

  let preview = null;
  if (changing) {
    try {
      preview = await tool.preview(args);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      return { ok: false, tool, error: msg, text: JSON.stringify({ error: msg, hint: 'Nothing was changed. Fix the arguments or ask the user.' }) };
    }
    preview = { title: preview.title || tool.name, lines: preview.lines || [], warnings: preview.warnings || [], strong: !!preview.strong || tool.risk === 'critical', confirmWord: preview.confirmWord || null,
      amount: Number(preview.amount) || 0 }; // the auditor's hourly-total rule and the reviewer both need the rupee amount
    if (typeof review === 'function') {
      // Second line of defence: the auditor looks at the proposal in the context of the whole session.
      try {
        const r = await review({ tool: tool.name, risk: tool.risk, args, preview }) || {};
        if (r.warnings && r.warnings.length) preview.warnings = [...preview.warnings, ...r.warnings];
        if (r.strong) preview.strong = true;
      } catch (_) { preview.warnings = [...preview.warnings, 'Auditor check could not run.']; preview.strong = true; }
    }
    let approved = false;
    try {
      const verdict = await approve({ tool: tool.name, risk: tool.risk, args, preview });
      if (preview.confirmWord) {
        // Typed confirmation (deletes): a bare "true" is NOT enough. The approver must hand back
        // the word the person actually typed, and it must match exactly (case-insensitive).
        approved = !!(verdict && verdict.approved === true && String(verdict.typed || '').trim().toLowerCase() === String(preview.confirmWord).toLowerCase());
      } else {
        approved = verdict === true || !!(verdict && verdict.approved === true);
      }
    } catch (_) { approved = false; }
    if (!approved) {
      return { ok: false, tool, preview, rejected: true, error: 'rejected', text: JSON.stringify({ rejected: true, message: 'The user did NOT approve this change. Nothing was changed. Do not retry the same change; ask what they would like instead.' }) };
    }
  }
  try {
    const out = await tool.run(args);
    let undo = null;
    if (changing && tool.makeUndo) { try { undo = tool.makeUndo(args, out); } catch (_) { undo = null; } }
    if (changing && typeof onChanged === 'function') { try { onChanged({ tool: tool.name, args, preview }); } catch (_) { /* log only */ } }
    const payload = changing ? { done: true, can_undo: !!undo, ...(out && typeof out === 'object' ? out : { result: out }) } : out;
    const { text } = _cap(payload);
    return { ok: true, tool, text, undo, undoData: undo ? { args, out } : null, preview };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, tool, error: msg, preview, text: JSON.stringify({ error: msg, note: changing ? 'The change failed; nothing was saved.' : undefined }) };
  }
}
