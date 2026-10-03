// Guards the push→Supabase pipeline: JWT settings can't silently flip, the
// workflow gates on tests, and it never runs the whole migration history.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const cfg = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const wf = fs.readFileSync(path.join(root, '.github/workflows/supabase-deploy.yml'), 'utf8');
const fnDirs = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

describe('supabase/config.toml', () => {
  test('every function directory has an explicit verify_jwt setting', () => {
    for (const fn of fnDirs) assert.match(cfg, new RegExp('\\[functions\\.' + fn + '\\]\\s*\\nverify_jwt = (true|false)'), fn + ' is not pinned');
  });
  test('bt-agent requires JWT', () => {
    assert.match(cfg, /\[functions\.bt-agent\]\s*\nverify_jwt = true/);
  });
  test('legacy public functions stay public (so a redeploy cannot break Inventory Search)', () => {
    for (const fn of ['inventory-chat', 'medicine-ai-info']) assert.match(cfg, new RegExp('\\[functions\\.' + fn + '\\]\\s*\\nverify_jwt = false'));
  });
});

describe('supabase-deploy workflow', () => {
  test('deploy job needs the test job', () => assert.match(wf, /deploy:\s*\n\s*needs: test/));
  test('triggers only on main and only for supabase paths', () => {
    assert.match(wf, /branches: \[main\]/); assert.match(wf, /supabase\/functions\/\*\*/); assert.match(wf, /supabase\/migrations\/\*\*/);
  });
  test('never uses db push / reset (would replay or wipe history)', () => {
    assert.ok(!/db push|db reset|migration repair/.test(wf));
  });
  test('secrets are referenced, never literal', () => {
    assert.match(wf, /secrets\.SUPABASE_ACCESS_TOKEN/); assert.match(wf, /secrets\.SUPABASE_DB_URL/);
    assert.ok(!/sbp_[A-Za-z0-9]{20,}|postgres(ql)?:\/\/[^$\s]+:[^$\s]+@/.test(wf));
  });
});
