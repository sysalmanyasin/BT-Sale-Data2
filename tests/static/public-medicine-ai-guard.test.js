import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../supabase/functions/medicine-ai-info/index.ts', import.meta.url), 'utf8');

test('public medicine AI endpoint bounds request size and field lengths', () => {
  assert.match(source, /const MAX_BODY_CHARS = 4_000/);
  assert.match(source, /const MAX_FIELD_CHARS = 200/);
  assert.match(source, /if \(raw\.length > MAX_BODY_CHARS\) return jsonResponse\(\{ error: 'Request too large' \}, 413\)/);
  assert.match(source, /function boundedText\(value: unknown\): string/);
});

test('public medicine AI endpoint throttles requests before cache/provider work', () => {
  assert.match(source, /const RATE_LIMIT = 20/);
  assert.match(source, /const RATE_WINDOW_MS = 60_000/);
  assert.match(source, /if \(rateLimited\(ip\)\) return jsonResponse\(\{ error: 'Too many requests\. Wait a minute and try again\.' \}, 429\)/);
  assert.ok(source.indexOf('if (rateLimited(ip))') < source.indexOf('const cached = body.force === true'));
});

test('medicine AI force-cache bypass requires an explicit boolean true', () => {
  assert.match(source, /body\.force === true \? null : await readCache/);
});
