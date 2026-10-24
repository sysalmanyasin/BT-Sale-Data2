import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const actions = readFileSync(new URL('../../js/actions.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const moduleIndex = readFileSync(new URL('../../docs/module-index.md', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../../js/repository.js', import.meta.url), 'utf8');

test('daily edit calculates a candidate before committing through Repository', () => {
  const start = actions.indexOf('function editDailyEntry(');
  const end = actions.indexOf('\n  function removeDailyEntry(', start);
  assert.notEqual(start, -1, 'editDailyEntry exists');
  assert.notEqual(end, -1, 'editDailyEntry has a clear boundary');
  const body = actions.slice(start, end);
  assert.match(body, /const candidate = \{ \.\.\.existing, \.\.\.changes \}/);
  assert.match(body, /Object\.getPrototypeOf\(changes\) !== Object\.prototype/);
  assert.match(body, /computeDailyTotals\(candidate\)/);
  assert.match(body, /Repository\.upsertDaily\(candidate\)/);
  assert.doesNotMatch(body, /Object\.assign\(existing,\s*changes\)/);
});

test('module index describes global-search as an ES module', () => {
  assert.match(moduleIndex, /global-search\.js[^\n]*ES module loaded with `type="module"`/);
  assert.match(index, /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="[^"]*global-search\.js(?:\?[^"]*)?")[^>]*>/i);
});

test('daily and monthly record getters return snapshots, not committed object references', () => {
  assert.match(repository, /function getDaily\(\)[\s\S]*?return DAILY\.map\(record => \(\{ \.\.\.record \}\)\)/);
  assert.match(repository, /function getDailyEntry\(date, monthYear\)[\s\S]*?return idx === -1 \? null : \{ \.\.\.DAILY\[idx\] \}/);
  assert.match(repository, /function findDailyByDate\(date\)[\s\S]*?return record \? \{ \.\.\.record \} : null/);
  assert.match(repository, /function getMonthlyEntry\(monthYear\)[\s\S]*?return idx === -1 \? null : \{ \.\.\.MONTHLY\[idx\] \}/);
});
