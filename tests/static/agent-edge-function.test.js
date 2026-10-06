// Static guard-rails for the bt-agent Edge Function + migration. These
// can't run Deno here, so they assert the security-critical shape of the
// source: auth, allow-list, no hard-coded secrets, privacy routing, RLS.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const fn = fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/index.ts'), 'utf8');
const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261003100000_agent_foundation.sql'), 'utf8');
const mig3 = fs.readFileSync(path.join(root, 'supabase/migrations/20261005110000_agent_undo.sql'), 'utf8');
const mig2 = fs.readFileSync(path.join(root, 'supabase/migrations/20261005100000_agent_quota_and_settings.sql'), 'utf8');

describe('bt-agent Edge Function', () => {
  test('requires a session and checks the authorised-users allow-list server-side', () => {
    assert.match(fn, /auth\.getUser\(token\)/);
    assert.match(fn, /bt_authorized_users/);
    assert.match(fn, /eq\('active', true\)/);
  });
  test('provider keys come only from env, never literals', () => {
    assert.ok(!/gsk_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|sk-or-[A-Za-z0-9]{10,}|csk-[A-Za-z0-9]{10,}/.test(fn));
    for (const k of ['GROQ_API_KEY', 'CEREBRAS_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) assert.match(fn, new RegExp(k));
  });
  test('sensitive requests skip providers that train on free-tier prompts', () => {
    assert.match(fn, /sensitivity === 'high' && p\.trainsOnFreeTier/);
    assert.match(fn, /id: 'gemini'[\s\S]*?trainsOnFreeTier: true/);
    assert.match(fn, /id: 'groq'[\s\S]*?trainsOnFreeTier: false/);
  });
  test('server owns the system prompt (client system messages dropped)', () => {
    assert.match(fn, /m\.role === 'system'\) continue/);
  });
  test('rate limits and body-size cap exist', () => {
    assert.match(fn, /AGENT_PER_MIN/); assert.match(fn, /AGENT_PER_DAY/); assert.match(fn, /MAX_BODY_CHARS/);
  });
  test('is not deployed with JWT verification disabled', () => {
    const deploy = fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/DEPLOY.md'), 'utf8');
    assert.match(deploy, /do not pass `--no-verify-jwt`/);
  });
});

describe('agent migration', () => {
  test('enables RLS on both tables and keeps anon out', () => {
    assert.match(mig, /alter table public\.agent_usage enable row level security/);
    assert.match(mig, /alter table public\.agent_audit enable row level security/);
    assert.match(mig, /revoke all on public\.agent_usage from anon/);
    assert.match(mig, /revoke all on public\.agent_audit from anon/);
  });
  test('audit rows are owner-scoped and append-only', () => {
    assert.match(mig, /with check \(user_id = auth\.uid\(\)\)/);
    assert.ok(!/for (update|delete)/i.test(mig));
  });
});

describe('bt-agent prompt: change tools', () => {
  test('prompt switches on writes_enabled and requires approval-aware behaviour', () => {
    assert.match(fn, /ctx\.writes_enabled === true/);
    assert.match(fn, /approval card/);
    assert.ok(!/add_staff_note/.test(fn.slice(fn.indexOf('buildSystemPrompt'), fn.indexOf('function isValidTool'))), 'prompt must not hard-code tool names');
    assert.match(fn, /do not retry it/);
  });
  test('locked prompt tells the model changes are locked', () => assert.match(fn, /changes are locked/));
});

describe('bt-agent resilience', () => {
  test('reasoning_effort is only sent to gpt-oss models', () => {
    assert.match(fn, /model\.includes\('gpt-oss'\)/);
    assert.ok(!/extra: \{ reasoning_effort/.test(fn));
  });
  test('groq has several fallback models (each has its own free-tier bucket)', () => {
    const groq = fn.slice(fn.indexOf("id: 'groq'"), fn.indexOf("id: 'cerebras'"));
    assert.ok((groq.match(/'[a-z0-9./-]+'/g) || []).length >= 4);
  });
  test('waits out a short Retry-After once, and logs provider failures', () => {
    assert.match(fn, /retry-after/); assert.match(fn, /console\.error\('\[bt-agent\] provider failed/);
  });
  test('prompt forbids chat-typed DELETE and placeholder text', () => {
    assert.match(fn, /NEVER ask the user to type DELETE/); assert.match(fn, /Never write placeholders/);
  });
});

describe('bt-agent specialists', () => {
  test('focus text is looked up by id from a server-side table (client cannot inject prompt text)', () => {
    assert.match(fn, /const FOCUS: Record<string, string>/);
    assert.match(fn, /typeof ctx\.focus === 'string' && FOCUS\[ctx\.focus\]/);
    for (const id of ['sales', 'manager', 'inventory', 'str', 'closing', 'billing', 'documents', 'analyst']) assert.match(fn, new RegExp('\\b' + id + ': \'FOCUS ='));
  });
});

describe('bt-agent gaps A: CORS, quota tracker, kill switch', () => {
  test('CORS defaults to the production origin, never *', () => {
    assert.match(fn, /DEFAULT_ORIGIN = 'https:\/\/bt\.duapharma\.com'/);
    assert.ok(!/AGENT_ALLOWED_ORIGINS'\) \|\| '\*'/.test(fn));
  });
  test('every provider attempt is recorded and cooldowns are shared via agent_usage', () => {
    assert.match(fn, /kind: 'attempt'/); assert.match(fn, /loadProviderState/);
    assert.match(fn, /state\.cooling/); assert.match(fn, /dailyCap/);
  });
  test('per-user rate limits count only user-visible requests', () => {
    assert.match(fn, /overLimit\(c, 'request'/);
    assert.match(fn, /\.eq\('kind', kind\)/);
  });
  test('kill switch is read server-side and forces the prompt read-only', () => {
    assert.match(fn, /from\('agent_settings'\)[\s\S]*?writes_killed/);
    assert.match(fn, /if \(writesKilled\) ctx\.writes_enabled = false/);
    assert.match(fn, /settings: \{ writes_killed: writesKilled \}/);
  });
  test('agent_settings: RLS on, anon out, only the kill key updatable by authorised users', () => {
    assert.match(mig2, /alter table public\.agent_settings enable row level security/);
    assert.match(mig2, /revoke all on public\.agent_settings from anon/);
    assert.match(mig2, /key = 'writes_killed'/);
    assert.ok(!/for (insert|delete)/i.test(mig2));
    assert.match(mig2, /agent_is_authorized\(\)/);
  });
});

describe('agent undo migration', () => {
  test('audit rows stay immutable except undone_at, and only for the owner', () => {
    assert.match(mig3, /revoke update on public\.agent_audit from authenticated/);
    assert.match(mig3, /grant update \(undone_at\) on public\.agent_audit to authenticated/);
    assert.match(mig3, /user_id = auth\.uid\(\)/);
    assert.ok(!/for delete/i.test(mig3));
  });
});

describe('service worker precaches every agent file', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  test('each js/agent/** file and the shared credit-alerts module is in APP_SHELL', () => {
    const files = [...walk(path.join(root, 'js/agent')), path.join(root, 'js/shared/credit-alerts.js'), path.join(root, 'js/shared/agent-shared.js')].map(f => './' + path.relative(root, f).split(path.sep).join('/'));
    const missing = files.filter(f => !sw.includes("'" + f + "'"));
    assert.deepEqual(missing, []);
  });
  test('CACHE_NAME was bumped for this release', () => assert.match(sw, /const CACHE_NAME = 'bt-sales-v11\.(19|[2-9]\d)'/));
});

describe('bt-agent actions, streaming, knowledge', () => {
  const emb = fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/embed.ts'), 'utf8');
  const mig5 = fs.readFileSync(path.join(root, 'supabase/migrations/20261006100000_agent_history_and_knowledge.sql'), 'utf8');
  test('only the five known actions are accepted', () => {
    assert.match(fn, /\['chat', 'route', 'review', 'index', 'search'\]\.includes\(action\)/);
  });
  test('route and review (names, amounts) only ever use non-training providers', () => {
    assert.match(fn, /sensitivity: action === 'chat' \? \(body\.sensitivity === 'high' \? 'high' : 'normal'\) : 'high'/);
  });
  test('streaming: SSE response, reset on fail-over after text, errors as events', () => {
    assert.match(fn, /text\/event-stream/); assert.match(fn, /t: 'reset'/); assert.match(fn, /t: 'done'/); assert.match(fn, /t: 'error'/);
    assert.match(fn, /stream: true/);
    assert.match(fn, /body\.stream !== true/);
  });
  test('review is advisory: it only returns a concern string', () => {
    assert.match(fn, /return json\(req, \{ concern, severity/);
    assert.ok(!/settings: .*approve/i.test(fn));
  });
  test('search never queries across users and sensitive rows need a non-training embedder', () => {
    assert.match(fn, /p_user_id: c\.user\.id/);
    assert.match(fn, /const includeSensitive = !!info && info\.nonTraining && body\.include_sensitive === true/);
    assert.match(fn, /\.eq\('user_id', c\.user\.id\)\.or\(/);
  });
  test('index skips sensitive chunks unless the embedder is non-training, and redacts via the shared validator', () => {
    assert.match(fn, /!k\.sensitive \|\| info\.nonTraining/); assert.match(fn, /validateChunks\(body\.chunks\)/);
  });
  test('embedding vectors are checked for shape; provider choice is by secret', () => {
    assert.match(emb, /x\.length === EMBED_DIM/); assert.match(emb, /AGENT_EMBED_PROVIDER/);
    assert.match(emb, /nonTraining: false/); assert.match(emb, /nonTraining: true/);
  });
  test('the function dir has byte-identical shared code', () => {
    assert.equal(fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/agent-shared.js'), 'utf8'), fs.readFileSync(path.join(root, 'js/shared/agent-shared.js'), 'utf8'));
  });
  test('migration: history + knowledge are RLS-protected; vectors searchable only via the service role', () => {
    for (const t of ['agent_conversations', 'agent_messages', 'agent_knowledge']) {
      assert.match(mig5, new RegExp('alter table public\\.' + t + '\\s+enable row level security'));
      assert.match(mig5, new RegExp('revoke all on public\\.' + t + '\\s+from anon'));
    }
    assert.match(mig5, /revoke all on function public\.agent_match_knowledge[^;]*from public, anon, authenticated/);
    assert.match(mig5, /grant execute on function public\.agent_match_knowledge[^;]*to service_role/);
    assert.match(mig5, /grant select, delete on public\.agent_knowledge to authenticated/);
    assert.ok(!/grant[^;]*insert[^;]*on public\.agent_knowledge/.test(mig5), 'browsers must not write the index');
    assert.match(mig5, /vector\(768\)/); assert.match(mig5, /hnsw/);
    assert.match(mig5, /agent_memory_source_check/);
  });
});

describe('live eval is wired into CI (advisory)', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/agent-live-eval.yml'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts/agent-live-eval.mjs'), 'utf8');
  test('weekly + manual, skips without a key, uploads the report, and is not part of the deploy workflow', () => {
    assert.match(wf, /schedule:/); assert.match(wf, /workflow_dispatch:/);
    assert.match(wf, /GROQ_API_KEY secret is not set; skipping/);
    assert.match(wf, /upload-artifact/);
    assert.ok(!/live-eval/.test(fs.readFileSync(path.join(root, '.github/workflows/supabase-deploy.yml'), 'utf8')));
  });
  test('the script imports every tool domain', () => {
    for (const d of ['str', 'closing', 'billing', 'documents']) assert.ok(script.includes("'" + d + "'"), d);
  });
});

describe('least-privilege grants migration', () => {
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261006110000_agent_tighten_grants.sql'), 'utf8');
  test('browsers cannot write the knowledge index or usage, or edit messages/rules/audit history', () => {
    assert.match(mig, /revoke insert, update\s+on public\.agent_knowledge from authenticated/);
    assert.match(mig, /revoke insert, update, delete\s+on public\.agent_usage\s+from authenticated/);
    assert.match(mig, /revoke update, delete\s+on public\.agent_messages\s+from authenticated/);
    assert.match(mig, /revoke update, delete\s+on public\.agent_rules\s+from authenticated/);
    assert.match(mig, /revoke delete\s+on public\.agent_audit\s+from authenticated/);
    assert.ok(!/\bgrant\b/i.test(mig.replace(/--.*$/gm, '')), 'a tightening migration must not grant anything');
  });
});
