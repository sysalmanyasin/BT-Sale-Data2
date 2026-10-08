// ═══════════════════════════════════════════════════════════════════
// AI CENTER -- REPOSITORY INTELLIGENCE (the service between the UI and js/ai-center/repo-index.json)
//
// Answers "where is X implemented / how does Y connect to Z / which tool provides W" from the REAL index.
//
// What is static configuration: CONCEPTS below -- a curated explanation per architecture topic and the places it points to.
// What is NOT trusted: every pointer is resolved against the live index at answer time. A pointer whose file or symbol is not in the
// index is returned as `verified:false` and shown as such: the map can never silently claim a location that does not exist
// (and a unit test fails if any pointer stops resolving).
//
// What it never does: return source code. The index holds names, line numbers and one-line file summaries only, so this module can say
// WHERE something is implemented, never show the code; `githubUrl()` links to the file at the indexed commit for that.
// Pure: no DOM, no fetch, no storage.
// ═══════════════════════════════════════════════════════════════════
import { validRepoIndex, searchRepoIndex, repoIndexInfo } from './model.js';

export const REPO_URL = 'https://github.com/sysalmanyasin/BT-Sale-Data2';
const SAFE_PATH = /^[A-Za-z0-9_.\-/]+$/;

/** Link to a file/line at the commit the index was built from (so line numbers match). Null for an unsafe path. */
export function githubUrl(idx, file, line) {
  const f = String(file || '');
  if (!SAFE_PATH.test(f) || f.includes('..') || f.startsWith('/')) return null;
  const commit = idx && /^[0-9a-f]{7,40}$/.test(String(idx.commit || '')) ? idx.commit : 'main';
  const l = Number.isInteger(line) && line > 0 ? '#L' + line : '';
  return REPO_URL + '/blob/' + commit + '/' + f.split('/').map(encodeURIComponent).join('/') + l;
}

// ── curated architecture map ───────────────────────────────────────
// pointer: { file, symbol?, role }.  keys: lower-case words/phrases that mean this topic in a question.
export const CONCEPTS = Object.freeze([
  { id: 'approval', title: 'Approval', keys: ['approval', 'approvals', 'approve', 'approved', 'approving', 'permission'],
    explanation: 'A change tool never runs by itself. runTool is the single gate every tool call passes through: it refuses hard-blocked actions, refuses changes while writes are off, and refuses a change when there is no approval channel. The approval card and its controller are the `approve` function in the assistant panel; the AI Center decides the SAME pending request through BTAgent.decide() (approving needs a real tap). The auditor adds a second, deterministic review of every proposal.',
    pointers: [
      { file: 'js/agent/core/tool-registry.js', symbol: 'runTool', role: 'single gate: hard blocks, writes-off check, approval channel required' },
      { file: 'js/agent/ui/agent-panel.js', symbol: 'approve', role: 'approval card and controller' },
      { file: 'js/agent/core/auditor.js', symbol: 'reviewChange', role: 'second, deterministic review of each change proposal' },
      { file: 'js/ai-center/ui.js', symbol: 'approvalCard', role: 'AI Center approval view (decides through BTAgent.decide)' },
      { file: 'tests/dom/agent-approval-controller.test.js', role: 'tests for the shared approval controller' },
    ] },
  { id: 'verify', title: 'VERIFY (read-back after a change)', keys: ['verify', 'verifies', 'verified', 'verification', 'read-back', 'readback', 'read back'],
    explanation: 'After a change tool succeeds, runTool calls the verifier registered for that tool (setVerifier). The verifiers read the record back from the app\'s own data and compare it with what was expected. agent-client.js turns that into verify_start / verify_end telemetry events, which the AI Center shows. Note: it reads this device\'s app data back; it does not wait for the cloud sync.',
    pointers: [
      { file: 'js/agent/core/tool-registry.js', symbol: 'setVerifier', role: 'registers a verifier per change tool' },
      { file: 'js/agent/core/tool-registry.js', symbol: 'runTool', role: 'calls the verifier after a successful write' },
      { file: 'js/agent/tools/verify.js', role: 'the per-tool verifiers (read back and compare)' },
      { file: 'js/agent/core/agent-client.js', symbol: 'runAgent', role: 'emits verify_start / verify_end telemetry' },
    ] },
  { id: 'undo', title: 'Undo', keys: ['undo', 'undone', 'revert', 'reversible', 'rollback'],
    explanation: 'A reversible change registers an undo function when it is made. undo.js holds the in-session stack; undo-store.js persists a recipe so undo survives a reload, inside a 48-hour window. The Undo button in the assistant panel runs it and marks it done; the AI Center records an undo telemetry event.',
    pointers: [
      { file: 'js/agent/core/undo.js', symbol: 'runUndo', role: 'runs an undo in this session' },
      { file: 'js/agent/core/undo-store.js', symbol: 'loadPendingUndos', role: 'reload-proof undo recipes (time-limited)' },
      { file: 'js/agent/ui/agent-panel.js', symbol: 'addUndoRow', role: 'Undo button and its telemetry event' },
    ] },
  { id: 'audit', title: 'Audit trail', keys: ['audit', 'audited', 'audit trail', 'agent_audit'],
    explanation: 'Every tool call is recorded by logToolCall: a bounded ring buffer on this device plus a row in the Supabase agent_audit table (owner-only access). It now returns what really happened (cloud, local only, or failed), and agent-client.js emits an audit telemetry event only after that write resolves.',
    pointers: [
      { file: 'js/agent/core/audit.js', symbol: 'logToolCall', role: 'writes the local buffer and the agent_audit row' },
      { file: 'supabase/migrations/20261003100000_agent_foundation.sql', symbol: 'public.agent_audit', role: 'the agent_audit table' },
    ] },
  { id: 'telemetry', title: 'Telemetry and where it is persisted', keys: ['telemetry', 'persist', 'persisted', 'persistence', 'activity history', 'events stored'],
    explanation: 'Real events are emitted through emit() in telemetry.js: an in-memory ring buffer that redacts secret-looking keys. telemetry-store.js persists a slim, allow-listed copy to this browser\'s local storage, bounded to 300 events and 7 days; restored events are history, not live activity. History is per device. Change audits additionally go to the Supabase agent_audit table.',
    pointers: [
      { file: 'js/agent/core/telemetry.js', symbol: 'emit', role: 'emits an event: redaction, ring buffer, subscribers' },
      { file: 'js/agent/core/telemetry-store.js', symbol: 'toStored', role: 'allow-list: which fields of which event types are kept' },
      { file: 'js/agent/core/telemetry-store.js', symbol: 'startPersistence', role: 'saves to and restores from local storage (7 days, 300 events)' },
      { file: 'js/agent/index.js', role: 'starts persistence with window.localStorage' },
    ] },
  { id: 'safety', title: 'Write gates, hard blocks and the kill switch', keys: ['kill switch', 'killswitch', 'kill', 'write gate', 'write gates', 'hard block', 'hard blocks', 'blocked', 'safety', 'writes'],
    explanation: 'Three layers stop a change. hard-blocks.js names things the assistant may never do. The kill switch (agent_settings key writes_killed, read by kill-switch.js and re-checked by the Edge Function) disables changes on every device. The per-device unlock decides writesEnabled, and runTool refuses a change without it. These run before any approval exists.',
    pointers: [
      { file: 'js/agent/core/hard-blocks.js', symbol: 'blockedByName', role: 'actions that are never allowed' },
      { file: 'js/agent/core/kill-switch.js', symbol: 'getKillState', role: 'reads the server-side kill switch' },
      { file: 'js/agent/core/tool-registry.js', symbol: 'runTool', role: 'enforces blocks and the writes-off gate' },
      { file: 'supabase/functions/bt-agent/index.ts', symbol: 'handleChat', role: 'server re-checks writes_killed on every request' },
    ] },
  { id: 'specialists', title: 'Specialist agents', keys: ['specialist', 'specialists', 'agent network', 'which agent', 'hats'],
    explanation: 'There is one conversation with several focused "hats". specialists.js defines them (Sales, Staff & money, Inventory, Stock transfers, Closing, Emergency billing, Notes & sheets, Analyst); router.js picks tool groups by keyword; the Edge Function holds each specialist\'s domain briefing and selects it by id. For multi-area "why" questions the orchestrator runs the relevant specialists as independent read-only conversations.',
    pointers: [
      { file: 'js/agent/core/specialists.js', symbol: 'SPECIALISTS', role: 'the specialist definitions' },
      { file: 'js/agent/core/specialists.js', symbol: 'pickSpecialist', role: 'chooses the specialist for a question' },
      { file: 'js/agent/core/router.js', symbol: 'matchDomains', role: 'keyword routing to tool groups' },
      { file: 'supabase/functions/bt-agent/index.ts', symbol: 'buildSystemPrompt', role: 'server side: briefing chosen by specialist id' },
    ] },
  { id: 'investigation', title: 'Multi-specialist investigation', keys: ['investigation', 'investigate', 'orchestrator', 'orchestration', 'multi-agent', 'multi agent', 'synthesis', 'evidence bundle'],
    explanation: 'Investigate with BT in the AI Center calls BTAgent.investigate(), which runs the orchestrator: planInvestigation picks the relevant specialists, runInvestigation runs each as an independent read-only conversation, bundles what their tools returned, and makes one Analyst synthesis call. Agreement, conflict and correlation are the Analyst\'s reading and are labelled so; a recommendation is kept only if it cites a specialist that returned data.',
    pointers: [
      { file: 'js/agent/core/orchestrator.js', symbol: 'planInvestigation', role: 'which specialists, and why each' },
      { file: 'js/agent/core/orchestrator.js', symbol: 'runInvestigation', role: 'independent runs, evidence bundle, synthesis' },
      { file: 'js/agent/core/agent-client.js', symbol: 'runAgent', role: 'each member run (forceSpecialist + member mode)' },
      { file: 'js/ai-center/ui.js', symbol: 'investigate', role: 'the Investigate with BT button' },
    ] },
  { id: 'ai-center-bridge', title: 'How the AI Center connects to the BT Agent', keys: ['ai center', 'command center', 'btagent', 'bt agent', 'ask bt', 'connect', 'connects', 'bridge'],
    explanation: 'The AI Center has no brain of its own. Ask BT and Investigate call window.BTAgent (created in the assistant panel), which runs the existing runAgent loop (or the orchestrator) against the Edge Function via callServer. The dashboards read the same registered tools directly through readTool, which calls runTool read-only and records tool telemetry. Everything on the page is then drawn from tool results and telemetry events.',
    pointers: [
      { file: 'js/ai-center/ui.js', symbol: 'ask', role: 'Ask BT: hands the question to window.BTAgent' },
      { file: 'js/ai-center/ui.js', symbol: 'investigate', role: 'starts a real investigation through BTAgent.investigate' },
      { file: 'js/agent/ui/agent-panel.js', symbol: 'ask', role: 'the assistant\'s ask(); BTAgent is created here' },
      { file: 'js/agent/core/agent-client.js', symbol: 'runAgent', role: 'the tool loop (the one reasoning engine)' },
      { file: 'js/agent/core/server.js', symbol: 'callServer', role: 'transport to the bt-agent Edge Function' },
      { file: 'js/ai-center/adapters.js', symbol: 'readTool', role: 'dashboards read the registered tools read-only' },
    ] },
  { id: 'findings', title: 'Findings and evidence', keys: ['finding', 'findings', 'evidence', 'detect', 'detection', 'anomaly'],
    explanation: 'Findings are built from real tool results: collectSnapshot reads the briefing, closing and STR tools, and buildFindings turns them into findings with typed evidence (evidenceFor). correlate() only reports that findings in different systems appear together; it never claims a cause.',
    pointers: [
      { file: 'js/ai-center/adapters.js', symbol: 'collectSnapshot', role: 'reads the real tools' },
      { file: 'js/ai-center/model.js', symbol: 'buildFindings', role: 'findings with evidence, entities and audit reference' },
      { file: 'js/ai-center/model.js', symbol: 'evidenceFor', role: 'typed evidence rows (FACT, CALCULATION, DETECTION, ...)' },
      { file: 'js/ai-center/model.js', symbol: 'correlate', role: 'co-occurrence of findings, never causation' },
    ] },
  { id: 'forecast', title: 'Forecast and target pace', keys: ['forecast', 'forecasting', 'projection', 'projected', 'target pace', 'pace', 'prediction'],
    explanation: 'No second formula exists. The target-pace tool reads the app\'s own Analytics module; the AI Center\'s buildForecast only shows that pace next to the briefing\'s month-end projection and flags it when they disagree.',
    pointers: [
      { file: 'js/analytics.js', symbol: 'getTargetPaceForMonth', role: 'authoritative target-pace calculation' },
      { file: 'js/agent/tools/sales.js', symbol: 'get_target_pace', role: 'the tool that exposes it to BT' },
      { file: 'js/ai-center/model.js', symbol: 'buildForecast', role: 'shows pace and projection side by side' },
    ] },
  { id: 'repo-index', title: 'Repository intelligence', keys: ['repository', 'repo', 'index', 'code index', 'repo-index'],
    explanation: 'scripts/build-repo-index.mjs scans the source and writes js/ai-center/repo-index.json: file, line, symbol kind, registered tools and a one-line summary, never source code, with secret-bearing files and lines excluded. This module answers questions from it; a test fails if the committed index no longer matches the code.',
    pointers: [
      { file: 'scripts/build-repo-index.mjs', symbol: 'buildIndex', role: 'builds the index (npm run index:repo)' },
      { file: 'js/ai-center/repo-intel.js', symbol: 'answerRepoQuestion', role: 'answers questions from the index' },
      { file: 'js/ai-center/model.js', symbol: 'searchRepoIndex', role: 'symbol / tool / file search' },
    ] },
]);

export const SAMPLE_QUESTIONS = Object.freeze([
  'Where is approval implemented?', 'Where does VERIFY happen?', 'Which tool provides closing data?',
  'Where is the Sales specialist?', 'How does AI Center call BT Agent?', 'Where is telemetry persisted?',
]);

// tool-domain words -> the domain name used by registered tools
const DOMAIN_WORDS = [
  [/\b(closing|close|shift|shifts)\b/, 'closing'], [/\b(str|strs|transfers?|stock transfers?)\b/, 'str'], [/\b(sales|sale|revenue|target)\b/, 'sales'],
  [/\b(inventory|stock|product|products|cover)\b/, 'inventory'], [/\b(staff|ledger|credit|manager|cash|money)\b/, 'manager'], [/\b(billing|invoice|invoices)\b/, 'billing'],
  [/\b(documents?|notes?|sheets?)\b/, 'documents'], [/\b(briefing|attention)\b/, 'app'],
];
const TOOL_INTENT = /\b(which|what)\b[^?]*\btools?\b|\btools?\b[^?]*\b(provide|provides|give|gives|return|returns|read|reads|expose|exposes|supply|supplies|for)\b|\b(provides?|supplies|supply)\b[^?]*\bdata\b/i;

const norm = q => String(q || '').toLowerCase().replace(/[^a-z0-9_\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
const hasKey = (text, key) => new RegExp('(^|[^a-z0-9_])' + key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '($|[^a-z0-9_])').test(text);
const entryOf = (idx, file) => (validRepoIndex(idx) ? idx.index.find(f => f.f === file) || null : null);

/** Resolve one curated pointer against the live index. Never invents a line: unresolved pointers are `verified:false`, line null. */
export function resolvePointer(idx, p) {
  const e = entryOf(idx, p.file);
  const base = { file: p.file, symbol: p.symbol || null, role: p.role || '', kind: p.symbol ? 'symbol' : 'file', line: null, summary: '', verified: false, note: '' };
  if (!e) return { ...base, note: 'File not found in the current index.' };
  base.summary = e.s || '';
  if (!p.symbol) return { ...base, line: 1, verified: true };
  const s = [...(e.sym || []), ...(e.tools || [])].find(x => x.n === p.symbol);
  if (!s) return { ...base, note: 'The file is indexed but the symbol "' + p.symbol + '" was not found in it.' };
  return { ...base, line: s.l, kind: s.k, verified: true, ...(s.k === 'tool' ? { domain: s.d || '', risk: s.r || '' } : {}) };
}

/** Tools defined in a file (from the index) and curated topics that point at it: the "related tool / feature" for any hit. */
export function relatedOf(idx, file) {
  const e = entryOf(idx, file);
  return {
    tools: e && !e.f.startsWith('tests/') ? (e.tools || []).map(t => t.n) : [],
    features: CONCEPTS.filter(c => c.pointers.some(p => p.file === file)).map(c => c.title),
  };
}

/** Tools the index knows for a domain, cross-checked against the live registry when provided (`registered`: iterable of names). */
export function toolsInIndex(idx, domain, registered = null) {
  if (!validRepoIndex(idx)) return [];
  const live = registered ? new Set(registered) : null;
  const out = [];
  for (const f of idx.index) if (!f.f.startsWith('tests/')) for (const t of f.tools || []) if (t.d === domain) out.push({ name: t.n, domain: t.d, risk: t.r || '', file: f.f, line: t.l, registered: live ? live.has(t.n) : null });
  return out;
}

const loc = (idx, r) => ({ ...(r.domain !== undefined ? { domain: r.domain, risk: r.risk || '' } : {}), file: r.file, line: r.line, symbol: r.symbol || r.name || null, kind: r.kind, role: r.role || '', summary: r.summary || '', verified: r.verified !== false, note: r.note || '', related: relatedOf(idx, r.file), github: githubUrl(idx, r.file, r.line) });

/** Plain search, enriched with the related tool / feature and a link to the code. */
export function searchRepo(idx, query, limit = 10) {
  return searchRepoIndex(idx, query, limit).map(h => loc(idx, { ...h, symbol: h.name, ...(h.kind === 'tool' ? {} : { domain: undefined }) }));
}

function domainOf(text) { for (const [re, d] of DOMAIN_WORDS) if (re.test(text)) return d; return null; }

/**
 * Answer a question about the code from the real index.
 * kind: 'tools' (which tool provides X) | 'architecture' (curated topic, pointers verified) | 'search' (symbol/file matches) | 'none'
 * @param {object} idx  the parsed repo-index.json
 * @param {string} question
 * @param {{registered?:Iterable<string>, limit?:number}} [opts]  registered: live tool names, to flag index/registry drift
 */
export function answerRepoQuestion(idx, question, { registered = null, limit = 10 } = {}) {
  const q = String(question || '').trim().slice(0, 300);
  const info = repoIndexInfo(idx);
  const unavailable = { ok: false, kind: 'none', question: q, title: '', explanation: '', locations: [], tools: [], notes: [], unresolved: [], index: null, reason: !q ? 'Ask a question about the code.' : 'The code index is not loaded, so BT cannot say where things are.' };
  if (!info || !q) return unavailable;
  const text = norm(q), domain = domainOf(text);
  const meta = { commit: info.commit, files: info.files, age: info.age, stale: info.stale };
  const notes = ['This answers WHERE something is implemented, from an index of names and line numbers. The index holds no source code; use the link to read the code on GitHub at commit ' + info.commit + '.'];
  if (info.stale) notes.push('The index is more than 14 days old, so locations may have moved.');
  const done = (r) => ({ ok: true, question: q, index: meta, notes, unresolved: [], tools: [], locations: [], explanation: '', title: '', ...r });

  // 1) "which tool provides <area> data" -> the registered tools of that area, from the index, cross-checked with the live registry
  if (domain && TOOL_INTENT.test(q)) {
    const tools = toolsInIndex(idx, domain, registered);
    if (tools.length) {
      const files = [...new Set(tools.map(t => t.file))];
      if (tools.some(t => t.registered === false)) notes.push('Some indexed tools are not registered in this running app: ' + tools.filter(t => t.registered === false).map(t => t.name).join(', ') + '.');
      return done({ kind: 'tools', title: 'Tools for ' + domain + ' data', explanation: 'These tools are defined in ' + files.join(', ') + '. Each is a registered BT tool; BT and the AI Center read this data through them rather than through separate code.',
        tools, locations: tools.map(t => loc(idx, { domain: t.domain, risk: t.risk, file: t.file, line: t.line, symbol: t.name, kind: 'tool', role: t.risk + ' tool, ' + t.domain + ' domain', summary: (entryOf(idx, t.file) || {}).s })) });
    }
  }

  // 2) curated architecture topic (best keyword score; pointers verified against the index)
  let best = null, bestScore = 0;
  for (const c of CONCEPTS) {
    const score = c.keys.reduce((a, k) => a + (hasKey(text, k) ? (k.includes(' ') ? 2 : 1) : 0), 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (best) {
    const resolved = best.pointers.map(p => resolvePointer(idx, p));
    const locations = resolved.filter(r => r.verified).map(r => loc(idx, r));
    // "Where is the Sales specialist" -> also the tools that specialist uses, from the index
    // (the read tools define what the specialist can look at; change tools are listed under their own topics)
    if (best.id === 'specialists' && domain) for (const t of (() => { const all = toolsInIndex(idx, domain, registered); return (all.filter(x => x.risk === 'read')[0] ? [all.filter(x => x.risk === 'read')[0]] : all.slice(0, 1)); })()) locations.push(loc(idx, { domain: t.domain, risk: t.risk, file: t.file, line: t.line, symbol: t.name, kind: 'tool', role: 'read tools this specialist uses (' + domain + ' domain)', summary: (entryOf(idx, t.file) || {}).s }));
    const unresolved = resolved.filter(r => !r.verified).map(r => ({ file: r.file, symbol: r.symbol, note: r.note }));
    if (unresolved.length) notes.push(unresolved.length + ' location(s) in the architecture note could not be found in the current index and are not shown as fact.');
    return done({ kind: 'architecture', title: best.title, explanation: best.explanation, locations, unresolved, source: 'Curated architecture note; every location below was checked against the index.' });
  }

  // 3) plain search over symbols, tools and files
  const hits = searchRepo(idx, q, limit);
  if (hits.length) return done({ kind: 'search', title: 'Matches in the code index', explanation: '', locations: hits });
  return done({ kind: 'none', title: '', explanation: 'Nothing in the code index matches this. Try a function, tool or file name, or one of the example questions.' });
}
