// The daily push must actually include the manager-intelligence blocks, and must keep working if they fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', '..', 'supabase/functions/send-daily-ntfy-briefing');
const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
const mi = fs.readFileSync(path.join(dir, 'manager-intelligence.ts'), 'utf8');

test('index.ts imports and calls managerIntelligence', () => {
  assert.match(index, /import \{ managerIntelligence \} from "\.\/manager-intelligence\.ts"/);
  assert.match(index, /await managerIntelligence\(rest, auditRest\)/);
});

test('the call is wrapped so a failure cannot break the briefing', () => {
  const i = index.indexOf('await managerIntelligence(');
  const before = index.slice(Math.max(0, i - 120), i), after = index.slice(i, i + 700);
  assert.match(before, /try\s*\{/);
  assert.match(after, /catch \(e\)/);
});

test('manager intelligence is read-only and does not repeat the Sales cash DIFF alert', () => {
  assert.ok(!/method:\s*["'](POST|PATCH|PUT|DELETE)/i.test(mi));
  assert.ok(!/alerts\.push\(`Cash DIFF/.test(mi));
});

test('no dangling imports of the removed v2 module', () => {
  assert.ok(!/manager-intelligence-v2/.test(index));
});
