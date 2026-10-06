import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { redactSensitive, hashText, chunkText, chunkSheetRows, validateChunks, parseSSE, createDeltaAccumulator, MAX_CHUNKS_PER_CALL } from '../../js/shared/agent-shared.js';

const root = path.resolve(import.meta.dirname, '..', '..');

describe('redaction', () => {
  test('removes CNIC, phone, IBAN, email and long digit runs', () => {
    const r = redactSensitive('CNIC 35202-1234567-1 or 3520212345671, call 0300-1234567 / +92 321 7654321, PK36SCBL0000001123456702, a@b.com, acct 123456789012');
    for (const leak of ['35202', '1234567', '0300', '7654321', 'SCBL', 'a@b.com', '123456789012']) assert.ok(!r.includes(leak), leak + ' leaked: ' + r);
    assert.match(r, /\[CNIC\]/); assert.match(r, /\[PHONE\]/); assert.match(r, /\[EMAIL\]/);
  });
  test('keeps ordinary amounts and is idempotent', () => {
    const t = 'Paid Rs 5,000 on 12/Sep/2026 for 300 packs';
    assert.equal(redactSensitive(t), t);
    const once = redactSensitive('0300-1234567'); assert.equal(redactSensitive(once), once);
    assert.equal(redactSensitive(null), '');
  });
});

describe('hash + chunking', () => {
  test('hash is stable and sensitive to change', () => {
    assert.equal(hashText('abc'), hashText('abc')); assert.notEqual(hashText('abc'), hashText('abd'));
    assert.match(hashText('x'), /^[0-9a-f]{14}$/);
  });
  test('chunkText respects the limit and loses no words', () => {
    const para = Array.from({ length: 12 }, (_, i) => 'Sentence number ' + i + ' about the closing routine and cash handling.').join(' ');
    const text = para + '\n\n' + para;
    const chunks = chunkText(text, 400);
    assert.ok(chunks.length > 2); assert.ok(chunks.every(c => c.length <= 400));
    assert.equal(chunks.join(' ').replace(/\s+/g, ' ').split(' ').length, text.replace(/\s+/g, ' ').split(' ').length);
    assert.deepEqual(chunkText('short'), ['short']); assert.deepEqual(chunkText('  '), []);
  });
  test('an unbroken long string is hard-split', () => assert.ok(chunkText('x'.repeat(5000), 1000).every(c => c.length <= 1000)));
  test('sheet rows repeat the header on every chunk', () => {
    const vals = [['Name', 'Amount'], ...Array.from({ length: 80 }, (_, i) => ['Item ' + i, i * 10])];
    const chunks = chunkSheetRows(vals, 300);
    assert.ok(chunks.length > 1); assert.ok(chunks.every(c => c.startsWith('Name | Amount') && c.length <= 300));
    assert.ok(chunks.join('\n').includes('Item 79 | 790'));
    assert.deepEqual(chunkSheetRows([]), []); assert.deepEqual(chunkSheetRows([['', ''], ['', '']]), []);
  });
});

describe('validateChunks', () => {
  const ok = { source: 'note', source_id: 'n1', chunk_index: 0, title: 'T', content: 'Call 0300-1234567 about stock' };
  test('redacts, hashes and flags sensitivity', () => {
    const r = validateChunks([ok, { ...ok, source: 'staff_note', chunk_index: 1 }]);
    assert.equal(r.ok, true); assert.ok(!r.chunks[0].content.includes('1234567')); assert.match(r.chunks[0].content_hash, /^[0-9a-f]{14}$/);
    assert.deepEqual(r.chunks.map(c => c.sensitive), [false, true]);
  });
  test('rejects bad sources, ids, too many chunks and empty content', () => {
    assert.equal(validateChunks([{ ...ok, source: 'ledger' }]).ok, false);
    assert.equal(validateChunks([{ ...ok, source_id: '' }]).ok, false);
    assert.equal(validateChunks([{ ...ok, chunk_index: -1 }]).ok, false);
    assert.equal(validateChunks(Array(MAX_CHUNKS_PER_CALL + 1).fill(ok)).ok, false);
    assert.equal(validateChunks([{ ...ok, content: '   ' }]).ok, false);
    assert.equal(validateChunks('x').ok, false);
  });
  test('content is capped at 2000 chars', () => assert.equal(validateChunks([{ ...ok, content: 'a'.repeat(5000) }]).chunks[0].content.length, 2000));
});

describe('SSE + delta accumulation', () => {
  test('parseSSE returns whole events and keeps the partial tail', () => {
    const a = parseSSE('data: {"a":1}\n\ndata: {"b"');
    assert.deepEqual(a.data, ['{"a":1}']); assert.equal(a.rest, 'data: {"b"');
    const b = parseSSE(a.rest + ':2}\r\n\r\ndata: [DONE]\n\n');
    assert.deepEqual(b.data, ['{"b":2}', '[DONE]']);
  });
  test('text deltas are returned and joined', () => {
    const acc = createDeltaAccumulator(); const seen = [];
    for (const t of ['Hel', 'lo ', 'world']) seen.push(acc.push({ choices: [{ delta: { content: t } }] }));
    acc.push({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 9 } });
    assert.deepEqual(seen, ['Hel', 'lo ', 'world']);
    const r = acc.result(); assert.equal(r.message.content, 'Hello world'); assert.equal(r.usage.total_tokens, 9); assert.equal(r.message.tool_calls, undefined);
  });
  test('tool call fragments are assembled by index, with ids filled in', () => {
    const acc = createDeltaAccumulator();
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_daily', arguments: '{"da' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'te":"today"}' } }, { index: 1, function: { name: 'second', arguments: '{}' } }] } }] });
    const r = acc.result().message;
    assert.equal(r.content, null); assert.equal(r.tool_calls.length, 2);
    assert.equal(r.tool_calls[0].id, 'c1'); assert.deepEqual(JSON.parse(r.tool_calls[0].function.arguments), { date: 'today' });
    assert.equal(r.tool_calls[1].id, 'call_1');
  });
  test('garbage chunks are ignored', () => { const a = createDeltaAccumulator(); assert.equal(a.push(null), ''); assert.equal(a.push({}), ''); });
});

describe('the Edge Function copy matches', () => {
  test('byte-identical', () => assert.equal(fs.readFileSync(path.join(root, 'supabase/functions/bt-agent/agent-shared.js'), 'utf8'), fs.readFileSync(path.join(root, 'js/shared/agent-shared.js'), 'utf8')));
});
