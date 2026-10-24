// Emergency Billing must not depend on the public anon key.
//  - phase 1 is additive (safe to auto-deploy); the lockdown lives in supabase/pending/ until promoted
//  - the bridge uses the signed-in client; SQL gates on the allow-list, not just "authenticated"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const P1 = 'supabase/migrations/20261024120000_emergency_billing_authenticated_access.sql';
const P2 = 'supabase/migrations/20261024130000_emergency_billing_lockdown.sql';

test('phase 1 is additive: no drop / revoke / disable', () => {
  const s = sql(read(P1));
  assert.doesNotMatch(s, /\bdrop\s+(policy|table|function)|\brevoke\b\s+(?!all on function public\.bt_is_authorized_user)|disable row level security/i);
  assert.match(s, /bt_is_authorized_user\(\)/);
  assert.match(s, /bt_authorized_users/);
  assert.match(s, /u\.active\s*=\s*true/);
});
test('every authenticated policy is gated on the allow-list, never using (true)', () => {
  const s = sql(read(P1));
  assert.doesNotMatch(s, /to authenticated\s+using\s*\(\s*true\s*\)/i);
  assert.equal((s.match(/to authenticated using \(public\.bt_is_authorized_user\(\)\)/g) || []).length, 3);
});
test('lockdown is promoted into supabase/migrations (applied in production) and nothing is left pending', () => {
  assert.ok(existsSync(new URL(`../../${P2}`, import.meta.url)));
  assert.ok(!existsSync(new URL('../../supabase/pending/20261024130000_emergency_billing_lockdown.sql', import.meta.url)));
});
test('lockdown removes anon access and guards both RPCs with the allow-list', () => {
  const s = sql(read(P2));
  assert.equal((s.match(/drop policy if exists anon_all/g) || []).length, 3);
  assert.match(s, /revoke all on table public\.emergency_invoices\s+from anon/);
  for (const fn of ['record_emergency_sale', 'record_emergency_refund']) {
    assert.match(s, new RegExp(`rename to _${fn.replace('record_', 'record_')}_impl`));
    assert.match(s, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
  }
  assert.equal((s.match(/if not public\.bt_is_authorized_user\(\) then/g) || []).length, 2);
  assert.doesNotMatch(s, /grant execute[^;]*to anon/i);
});
// Phase 1 is applied in production (2026-10-24), so the bridge uses the signed-in client.
test('emergency-billing-bridge uses the signed-in client, not an anon-key client', () => {
  const js = read('js/emergency-billing-bridge.js');
  assert.match(js, /window\.btGetSupabaseClient/);
  assert.doesNotMatch(js, /createClient|EB_SUPABASE_ANON_KEY|persistSession/);
});
