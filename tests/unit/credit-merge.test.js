// Staff Credit sync-merge: pure-function tests (js/shared/credit-merge.js).
// Each test reproduces a real "I saved it, synced, and it vanished" path.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withEntryIds, mergeCreditMonth, mergeManagerSections, rowKey, hasCreditData } from '../../js/shared/credit-merge.js';

const M = 'October 2026';
const row = (over = {}) => ({ staffId: 'EMP-001', name: 'Salman Yasin', prevBal: 0, salary: 0, lessGeneric: 0, entries: [], ...over });
const ent = (over = {}) => ({ date: '30-Oct-2026', desc: 'advance', amount: 500, ...over });
const amounts = rows => rows.flatMap(r => r.entries.map(e => e.amount)).sort((a, b) => a - b);

describe('entry ids', () => {
  test('legacy entries get deterministic ids; identical entries are disambiguated', () => {
    const a = withEntryIds([ent(), ent(), ent({ amount: 7 })]);
    const b = withEntryIds([ent(), ent(), ent({ amount: 7 })]);
    assert.deepEqual(a.map(e => e.id), b.map(e => e.id), 'same content → same ids on every device');
    assert.equal(new Set(a.map(e => e.id)).size, 3, 'two identical entries must not collapse');
  });
  test('existing ids are never changed', () => {
    assert.equal(withEntryIds([ent({ id: 'keepme' })])[0].id, 'keepme');
  });
});

describe('push direction (local wins, remote only adds)', () => {
  test('server-folded Closing-App entry survives our push (was overwritten before)', () => {
    const local = [row({ entries: withEntryIds([ent({ amount: 100 })]) })];
    // the DB trigger added an id-less entry with an ISO date straight into the payload
    const remote = [row({ entries: [ent({ amount: 100 }), { date: '2026-10-30', desc: 'closing', amount: 900, source: 'closing_app' }] })];
    const out = mergeCreditMonth(local, remote, { isPull: false, month: M });
    assert.deepEqual(amounts(out), [100, 900]);
  });
  test('local scalar edits win on push', () => {
    const out = mergeCreditMonth([row({ prevBal: 50 })], [row({ prevBal: 10 })], { isPull: false, month: M });
    assert.equal(out[0].prevBal, 50);
  });
});

describe('pull direction', () => {
  test('clean month: remote value wins', () => {
    const out = mergeCreditMonth([row({ salary: 1 })], [row({ salary: 9 })], { isPull: true, dirty: false, month: M });
    assert.equal(out[0].salary, 9);
  });
  test('DIRTY month: pull cannot overwrite an unpushed local edit, but still adds remote entries', () => {
    const e1 = { id: 'e1', date: 'd', desc: 'x', amount: 700 };
    const local = [row({ salary: 5, entries: [e1] })];
    const remote = [row({ salary: 999, entries: [{ ...e1, amount: 1 }, { id: 'e2', date: 'd', desc: 'other device', amount: 40 }] })];
    const out = mergeCreditMonth(local, remote, { isPull: true, dirty: true, month: M });
    assert.equal(out[0].salary, 5);
    assert.deepEqual(amounts(out), [40, 700]);
  });
  test('a row only the remote has is added; a row only local has is kept', () => {
    const local = [row({ staffId: 'EMP-001', name: 'A', entries: [{ id: 'a', amount: 1 }] })];
    const remote = [row({ staffId: 'EMP-002', name: 'B', entries: [{ id: 'b', amount: 2 }] })];
    const out = mergeCreditMonth(local, remote, { isPull: true, month: M });
    assert.deepEqual(out.map(r => r.name), ['A', 'B']);
  });
  test('rows match by staffId even after a rename, and by name when ids are missing', () => {
    const out = mergeCreditMonth([row({ name: 'Old Name' })], [row({ name: 'New Name', entries: [{ id: 'z', amount: 3 }] })], { isPull: false, month: M });
    assert.equal(out.length, 1);
    const byName = mergeCreditMonth([{ name: 'bilal', entries: [] }], [{ name: ' Bilal ', entries: [{ id: 'q', amount: 4 }] }], { isPull: false, month: M });
    assert.equal(byName.length, 1);
    assert.equal(byName[0].entries.length, 1);
  });
});

describe('deletes (tombstones)', () => {
  test('a deleted entry is not resurrected from the remote copy, in either direction', () => {
    const dead = { id: 'gone', date: 'd', desc: 'oops', amount: 123 };
    const live = { id: 'live', date: 'd', desc: 'ok', amount: 5 };
    const isDeleted = k => k === 'crde:gone';
    const local = [row({ entries: [live] })];
    const remote = [row({ entries: [dead, live] })];
    for (const isPull of [true, false]) {
      assert.deepEqual(amounts(mergeCreditMonth(local, remote, { isPull, month: M, isDeleted })), [5]);
    }
  });
  test('a removed employee row is not re-added from remote', () => {
    const remote = [row({ staffId: 'EMP-009', name: 'Gone' })];
    const out = mergeCreditMonth([row()], remote, { isPull: true, month: M, isDeleted: k => k === 'crdr:' + M + '|id:EMP-009' });
    assert.deepEqual(out.map(r => r.name), ['Salman Yasin']);
  });
});

describe('safety properties', () => {
  test('idempotent and never mutates its inputs', () => {
    const local = [row({ entries: withEntryIds([ent()]) })];
    const remote = [row({ entries: [ent(), ent({ amount: 2 })] })];
    const snapL = JSON.stringify(local), snapR = JSON.stringify(remote);
    const once = mergeCreditMonth(local, remote, { isPull: false, month: M });
    const twice = mergeCreditMonth(once, remote, { isPull: false, month: M });
    assert.deepEqual(twice, once);
    assert.equal(JSON.stringify(local), snapL);
    assert.equal(JSON.stringify(remote), snapR);
  });
  test('never drops money: merged entry count >= each side (no tombstones)', () => {
    const local = [row({ entries: withEntryIds([ent({ amount: 1 }), ent({ amount: 2 })]) })];
    const remote = [row({ entries: withEntryIds([ent({ amount: 2 }), ent({ amount: 3 })]) })];
    for (const isPull of [true, false]) for (const dirty of [true, false]) {
      const out = mergeCreditMonth(local, remote, { isPull, dirty, month: M });
      assert.deepEqual(amounts(out), [1, 2, 3]);
    }
  });
  test('missing/invalid sides degrade gracefully', () => {
    assert.deepEqual(mergeCreditMonth(undefined, [row()], { month: M }).length, 1);
    assert.deepEqual(mergeCreditMonth([row()], undefined, { month: M }).length, 1);
    assert.equal(mergeCreditMonth(undefined, undefined, { month: M }), undefined);
  });
  test('rowKey / hasCreditData', () => {
    assert.equal(rowKey({ staffId: 'EMP-1', name: 'x' }), 'id:EMP-1');
    assert.equal(rowKey({ name: ' Ali ' }), 'n:ali');
    assert.equal(hasCreditData(row()), false);
    assert.equal(hasCreditData(row({ entries: [{ amount: 0 }] })), true);
  });
});

describe('mergeManagerSections', () => {
  test('pull keeps a dirty salary month but takes a clean one', () => {
    const local = { salary: { [M]: [{ v: 'local' }], 'September 2026': [{ v: 'old' }] } };
    const remote = { salary: { [M]: [{ v: 'remote' }], 'September 2026': [{ v: 'new' }] } };
    const out = mergeManagerSections(local, remote, { isPull: true, isDirty: (s, m) => s === 'salary' && m === M });
    assert.equal(out.salary[M][0].v, 'local');
    assert.equal(out.salary['September 2026'][0].v, 'new');
  });
  test('push never overwrites an existing local month, only fills gaps', () => {
    const out = mergeManagerSections({ generic: { [M]: [{ v: 'L' }] } }, { generic: { [M]: [{ v: 'R' }], 'August 2026': [{ v: 'R2' }] } }, { isPull: false });
    assert.equal(out.generic[M][0].v, 'L');
    assert.equal(out.generic['August 2026'][0].v, 'R2');
  });
  test('inbox-fold scenario end to end: edit here + fold there → both survive push AND pull', () => {
    const local = { credit: { [M]: [row({ entries: withEntryIds([ent({ amount: 250 })]) })] } };
    const remote = { credit: { [M]: [row({ entries: [ent({ amount: 250 }), { date: '2026-10-30', desc: 'fold', amount: 800, source: 'closing_app' }] })] } };
    for (const isPull of [true, false]) {
      const out = mergeManagerSections(local, remote, { isPull, isDirty: () => true });
      assert.deepEqual(amounts(out.credit[M]), [250, 800]);
    }
  });
});
