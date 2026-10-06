import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
const { Repository } = await import('../../js/repository.js'); globalThis.Repository = Repository;
const H = await import('../../js/agent/core/history.js');
const K = await import('../../js/agent/core/knowledge.js');

const memStore = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };

describe('conversation history', () => {
  test('titles are short single lines', () => {
    assert.equal(H.titleFrom('  hello\n  world '), 'hello world');
    assert.ok(H.titleFrom('x'.repeat(200)).length <= 60);
  });
  test('createConversation / appendTurn write the right rows and fail soft', async () => {
    const calls = [];
    const sb = { from: t => ({
      insert: v => { calls.push([t, 'insert', v]); return { select: async () => ({ data: [{ id: 'conv-1' }], error: null }), then: undefined, ...{} }; },
      update: v => ({ eq: async () => { calls.push([t, 'update']); return { error: null }; } }),
    }) };
    assert.equal(await H.createConversation(sb, 'How are sales?', 'sales'), 'conv-1');
    const sb2 = { from: t => ({ insert: async v => { calls.push([t, 'insert', v]); return { error: null }; }, update: () => ({ eq: async () => ({ error: null }) }) }) };
    assert.equal(await H.appendTurn(sb2, 'conv-1', 'Q', 'A'), true);
    const rows = calls.find(c => c[0] === 'agent_messages')[2];
    assert.deepEqual(rows.map(r => r.role), ['user', 'assistant']);
    assert.equal(await H.appendTurn(sb2, null, 'Q', 'A'), false);
    assert.equal(await H.appendTurn({ from: () => { throw new Error('x'); } }, 'c', 'Q', 'A'), false);
    assert.equal(await H.createConversation(null, 'x'), null);
  });
  test('loadConversation returns oldest-first user/assistant text only', async () => {
    const sb = { from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [{ role: 'assistant', content: 'A2' }, { role: 'user', content: 'Q2' }, { role: 'tool', content: 'x' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q1' }], error: null }) }; return q; } };
    assert.deepEqual((await H.loadConversation(sb, 'c')).map(m => m.content), ['Q1', 'A1', 'Q2', 'A2']);
  });
  test('prune only touches rows older than the keep window', async () => {
    let cutoff; const sb = { from: () => ({ delete: () => ({ lt: async (c, v) => { cutoff = v; return { error: null }; } }) }) };
    const now = Date.parse('2026-10-06T00:00:00Z'); await H.pruneOld(sb, now);
    assert.equal(cutoff, new Date(now - 90 * 86400000).toISOString());
  });
});

describe('knowledge items', () => {
  test('notes become redacted-ready chunks; empty notes are skipped', () => {
    const items = K.noteItems([{ id: 'n1', title: 'Closing', body: 'Closing is at 10pm.', tags: ['routine'] }, { id: 'n2', title: '', body: '' }, { title: 'no id', body: 'x' }]);
    assert.equal(items.length, 1); assert.equal(items[0].source_id, 'n1'); assert.match(items[0].chunks[0], /Tags: routine/);
  });
  test('sheet tabs get stable ids and header-repeating chunks', () => {
    const items = K.sheetItems([{ spreadsheet_id: 's1', tab_name: 'Jan', values_json: [['Item', 'Qty'], ['A', 1]] }, { spreadsheet_id: 's1', tab_name: 'Gone', values_json: 'bad' }], { s1: 'Budget' });
    assert.equal(items.length, 1); assert.equal(items[0].source_id, 's1:Jan'); assert.equal(items[0].title, 'Budget / Jan');
  });
  test('a long note is capped at MAX_ITEM_CHUNKS', () => assert.equal(K.noteItems([{ id: 'n', title: 't', body: ('word '.repeat(300) + '\n\n').repeat(60) }])[0].chunks.length, K.MAX_ITEM_CHUNKS));
});

describe('sync planning', () => {
  const a = { source: 'note', source_id: 'a', title: 'A', chunks: ['one'] }, b = { source: 'note', source_id: 'b', title: 'B', chunks: ['two'] };
  test('first run sends everything; later runs send only what changed or was removed', () => {
    let p = K.planSync([a, b], {}); assert.equal(p.changed.length, 2);
    const m = { 'note|a': K.itemDigest(a), 'note|b': K.itemDigest(b), 'note|gone': 'x' };
    p = K.planSync([a, { ...b, chunks: ['two!'] }], m);
    assert.deepEqual(p.changed.map(i => i.source_id), ['b']); assert.deepEqual(p.removed, [{ source: 'note', source_id: 'gone' }]); assert.equal(p.unchanged, 1);
  });
  test('batches keep items whole, respect the per-call limit, and never mix staff notes with ordinary content', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ source: 'note', source_id: 'n' + i, title: 'T', chunks: Array(12).fill('c') }));
    const staff = { source: 'staff_note', source_id: 's1', title: 'Staff note', chunks: ['x'] };
    const bs = K.toBatches([...many, staff]);
    assert.ok(bs.every(b => b.chunks.length <= 40));
    for (const b of bs) for (const it of b.items) assert.equal(b.chunks.filter(c => c.source_id === it.source_id).length, it.chunks.length);
    assert.equal(bs.filter(b => b.sensitive).length, 1); assert.ok(bs.filter(b => !b.sensitive).every(b => b.items.every(i => i.source !== 'staff_note')));
  });
  test('chunk text is redacted before it leaves the browser', () => {
    const [b] = K.toBatches([{ source: 'note', source_id: 'n', title: 'Call 0300-1234567', chunks: ['CNIC 35202-1234567-1'] }]);
    assert.ok(!/1234567/.test(JSON.stringify(b.chunks)));
  });
});

describe('syncKnowledge', () => {
  beforeEach(() => { Repository.setItem('bt_notes_v1', JSON.stringify([{ id: 'n1', title: 'Closing', body: 'Closing is at 10pm' }])); Repository.setItem('bt_staff_notes_v1', JSON.stringify([{ id: 'sn1', staffKey: 'e1', text: 'Often late', ts: 'x' }])); });
  test('sends changed items once, then nothing; records the manifest and last sync', async () => {
    const storage = memStore(); const sent = [];
    const callAction = async (a, p) => { sent.push([a, p]); return { embedded: (p.chunks || []).length, removed: 0 }; };
    let r = await K.syncKnowledge({ sb: null, callAction, storage, now: 5 });
    assert.equal(r.ok, true); assert.equal(r.indexedItems, 1); assert.equal(sent.length, 1);
    assert.ok(!sent[0][1].chunks.some(c => c.source === 'staff_note'), 'staff notes are off by default');
    r = await K.syncKnowledge({ sb: null, callAction, storage, now: 5 }); assert.equal(sent.length, 1); assert.equal(r.unchanged, 1);
    assert.equal(K.getPrefs(storage).lastSync, 5);
  });
  test('a note deleted locally is removed from the index', async () => {
    const storage = memStore(); const sent = [];
    const callAction = async (a, p) => { sent.push([a, p]); return { embedded: 0, removed: (p.remove || []).length }; };
    await K.syncKnowledge({ sb: null, callAction, storage });
    Repository.setItem('bt_notes_v1', '[]');
    const r = await K.syncKnowledge({ sb: null, callAction, storage });
    assert.deepEqual(sent.at(-1)[1].remove, [{ source: 'note', source_id: 'n1' }]); assert.equal(r.removed, 1);
  });
  test('staff notes skipped by the server are reported and retried, not marked done', async () => {
    const storage = memStore();
    const callAction = async (a, p) => ((p.chunks || [])[0] && p.chunks[0].source === 'staff_note' ? { embedded: 0, skipped_sensitive: 1 } : { embedded: 1 });
    const r = await K.syncKnowledge({ sb: null, callAction, storage, includeStaffNotes: true });
    assert.equal(r.skippedStaff, 1); assert.ok(!JSON.parse(storage.getItem(K.MANIFEST_KEY))['staff_note|sn1']);
  });
  test('a failed batch stops the run, keeps earlier progress, and reports the error', async () => {
    const storage = memStore(); let n = 0;
    Repository.setItem('bt_notes_v1', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, title: 't', body: ('word '.repeat(200) + '\n\n').repeat(8) }))));
    const callAction = async () => { if (++n === 2) throw new Error('Daily limit reached for this feature.'); return { embedded: 1 }; };
    const r = await K.syncKnowledge({ sb: null, callAction, storage });
    assert.equal(r.ok, false); assert.match(r.error, /Daily limit/); assert.ok(r.indexedItems >= 1);
    assert.equal(K.getPrefs(storage).lastSync, 0);
  });
});
