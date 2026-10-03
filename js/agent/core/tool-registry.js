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

const RESULT_CHAR_CAP = 6000;
const _tools = new Map();

export const RISKS = Object.freeze(['read', 'ui', 'write', 'critical']);

export function registerTool(def) {
  if (!def || !/^[a-zA-Z0-9_-]{1,64}$/.test(def.name || '')) throw new Error('registerTool: invalid name');
  if (typeof def.run !== 'function') throw new Error('registerTool: run() required for ' + def.name);
  if (!def.description) throw new Error('registerTool: description required for ' + def.name);
  const risk = def.risk || 'read';
  if (!RISKS.includes(risk)) throw new Error('registerTool: bad risk for ' + def.name);
  _tools.set(def.name, {
    name: def.name,
    description: def.description,
    parameters: def.parameters || { type: 'object', properties: {} },
    risk,
    domain: def.domain || 'app',
    sensitive: !!def.sensitive,
    run: def.run,
  });
}

export function getTool(name) { return _tools.get(name) || null; }
export function listTools() { return [..._tools.values()]; }
export function clearTools() { _tools.clear(); }

/** OpenAI-format tool schemas for the server. */
export function getToolSchemas() {
  return listTools().map(t => ({
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
 * Execute a tool. Never throws. `allow` decides which risk levels may run
 * (Phase 1 passes ['read','ui']).
 * @returns {{ok:boolean, text:string, tool:object|null, error?:string}}
 */
export async function runTool(name, rawArgs, { allow = ['read', 'ui'] } = {}) {
  const tool = getTool(name);
  if (!tool) return { ok: false, tool: null, error: 'unknown tool', text: JSON.stringify({ error: 'Unknown tool: ' + name }) };
  if (!allow.includes(tool.risk)) {
    return { ok: false, tool, error: 'blocked', text: JSON.stringify({ error: 'Writing/changing data is not enabled yet. Tell the user and offer to open the relevant page.' }) };
  }
  let args = rawArgs;
  if (typeof args === 'string') {
    try { args = args.trim() ? JSON.parse(args) : {}; } catch (e) {
      return { ok: false, tool, error: 'bad json', text: JSON.stringify({ error: 'Arguments were not valid JSON. Retry with a valid JSON object.' }) };
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  args = { ...args };
  const bad = _validateArgs(tool.parameters, args);
  if (bad) return { ok: false, tool, error: bad, text: JSON.stringify({ error: bad }) };
  try {
    const out = await tool.run(args);
    const { text } = _cap(out);
    return { ok: true, tool, text };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, tool, error: msg, text: JSON.stringify({ error: msg }) };
  }
}
