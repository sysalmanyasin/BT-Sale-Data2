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
