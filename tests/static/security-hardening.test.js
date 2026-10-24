// Security hardening guards (2026-10-24). Static checks that keep the safe shapes from regressing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sql = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

test('attendance-bridge uses the signed-in client, never an anon-key client', () => {
  const js = read('js/attendance-bridge.js');
  assert.match(js, /window\.btGetSupabaseClient/);
  assert.doesNotMatch(js, /createClient\(/);
  assert.doesNotMatch(js, /persistSession/);
});

test('pdf-library opens files via short-lived signed URLs, never public URLs', () => {
  const js = read('js/pdf-library.js');
  assert.match(js, /createSignedUrl\(/);
  assert.doesNotMatch(js, /getPublicUrl\(/);
  assert.doesNotMatch(js, /_publicUrl/);
});

test('batch 1 migration: widget summaries are guarded, PIN is throttled, bt_sessions anon policies dropped', () => {
  const s = sql(read('supabase/migrations/20261024150000_security_hardening_batch1.sql'));
  assert.equal((s.match(/is_authorized_user\(\) or public\.is_widget_service\(\)/g) || []).length, 2);
  assert.match(s, /revoke all on function public\.widget_summary\(\) from public, anon/);
  assert.match(s, /revoke all on function public\.get_widget_summary\(\) from public, anon/);
  assert.match(s, /revoke truncate, references, trigger on all tables in schema public from anon, authenticated/);
  for (const p of ['bt_sessions read all', 'bt_sessions insert', 'bt_sessions update', 'bt_sessions delete'])
    assert.match(s, new RegExp(`drop policy if exists "${p}"\\s+on public\\.bt_sessions`));
  assert.match(s, />= 5 then\s+return false/);
  assert.match(s, /grant execute on function public\.attendance_verify_manager_pin\(text\) to anon, authenticated/);
  assert.doesNotMatch(s, /grant execute[^;]*widget_summary[^;]*to anon/i);
});
