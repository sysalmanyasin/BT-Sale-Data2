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
    for (const id of ['sales', 'manager', 'inventory', 'str', 'closing', 'analyst']) assert.match(fn, new RegExp('\\b' + id + ': \'FOCUS ='));
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
    assert.equal((fn.match(/\.eq\('kind', 'request'\)/g) || []).length, 2);
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
