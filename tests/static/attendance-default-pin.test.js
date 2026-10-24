import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20261025090000_remove_default_attendance_manager_pin.sql', import.meta.url), 'utf8');
const seedMigration = readFileSync(new URL('../../supabase/migrations/20260918120500_attendance_manager_pin.sql', import.meta.url), 'utf8');

test('follow-up migration invalidates the known temporary manager PIN', () => {
  assert.match(migration, /delete from public\.attendance_manager_pin/i);
  assert.match(migration, /extensions\.crypt\('CHANGE-ME-0000',\s*pin_hash\)/i);
  assert.match(migration, /where id = true/i);
});

test('temporary manager PIN is explicitly documented as unsafe', () => {
  assert.match(seedMigration, /CHANGE-ME-0000/);
  assert.match(seedMigration, /CHANGE THIS before relying on it/i);
});
