// Ledger edit-sync regressions: each test reproduces a real "I edited it, synced, and it reverted" path.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
import { mergeLedgerEntries, mergeOpeningBalances, mergeCustomTypes, pickNewer } from '../../js/shared/ledger-merge.js';

const e = (id, amount, at) => ({ id, ledgerType: 'expense', date: '2026-11-01', categoryId: 'bill', amount, _updatedAt: at });

describe('mergeLedgerEntries (last-write-wins)', () => {
  test('PULL: unpushed local edit (newer) is NOT erased by stale remote', () => {
    const out = mergeLedgerEntries([e('a', 900, 2000)], [e('a', 100, 1000)], { isPull: true });
    assert.equal(out[0].amount, 900);
  });
  test('PULL: newer remote edit from another device wins', () => {
    const out = mergeLedgerEntries([e('a', 100, 1000)], [e('a', 500, 3000)], { isPull: true });
    assert.equal(out[0].amount, 500);
  });
  test('PUSH: stale local copy does not overwrite newer remote edit', () => {
    const out = mergeLedgerEntries([e('a', 100, 1000)], [e('a', 500, 3000)], { isPull: false });
    assert.equal(out[0].amount, 500);
  });
  test('PUSH: newer local edit wins', () => {
    assert.equal(mergeLedgerEntries([e('a', 7, 5000)], [e('a', 1, 1000)], { isPull: false })[0].amount, 7);
  });
  test('equal / missing stamps fall back to direction (pull=remote, push=local)', () => {
    assert.equal(mergeLedgerEntries([{ id: 'a', amount: 1 }], [{ id: 'a', amount: 2 }], { isPull: true })[0].amount, 2);
    assert.equal(mergeLedgerEntries([{ id: 'a', amount: 1 }], [{ id: 'a', amount: 2 }], { isPull: false })[0].amount, 1);
  });
  test('unions ids and honours tombstones from both sides', () => {
    const dead = k => k === 'led:x';
    const out = mergeLedgerEntries([e('x', 1, 1), e('a', 1, 1)], [e('x', 1, 9), e('b', 1, 1)], { isPull: true, isDeleted: dead });
    assert.deepEqual(out.map(r => r.id).sort(), ['a', 'b']);
  });
  test('is deterministic so a no-op sync writes an identical string', () => {
    const l = [e('a', 1, 1), e('b', 2, 2)], r = [e('b', 2, 2), e('c', 3, 3)];
    assert.equal(JSON.stringify(mergeLedgerEntries(l, r, { isPull: true })), JSON.stringify(mergeLedgerEntries(l, r, { isPull: true })));
  });
});

describe('opening balances + custom types', () => {
  test('newest opening balance wins in both directions; deleted sections dropped', () => {
    const local = { openingBalances: { expense: 10, gone: 5 }, openingBalancesAt: { expense: 2000 } };
    const remote = { openingBalances: { expense: 99 }, openingBalancesAt: { expense: 1000 } };
    const out = mergeOpeningBalances(local, remote, { isPull: true, isDeleted: k => k === 'sec:gone' });
    assert.equal(out.openingBalances.expense, 10);
    assert.ok(!('gone' in out.openingBalances));
  });
  test('custom type: newer _updatedAt wins on pull and push', () => {
    const l = { 'custom:x': { label: 'New', _updatedAt: 5 } }, r = { 'custom:x': { label: 'Old', _updatedAt: 1 } };
    assert.equal(mergeCustomTypes(l, r, { isPull: true })['custom:x'].label, 'New');
    assert.equal(pickNewer(r['custom:x'], l['custom:x'], false).label, 'New');
  });
});

describe('LedgerStore cache + push', () => {
  let Store, Repo, pushes;
  before(async () => {
    installDomEnv();
    pushes = 0;
    window.pushToSupabase = () => { pushes++; };
    ({ Repository: Repo } = await import('../../js/platform/repository.js'));
    Store = await import('../../js/ledger/ledger-store.js');
  });

  test('a sync-merge write to storage is picked up (stale in-memory cache is dropped)', () => {
    Store._addEntry({ id: 'k1', ledgerType: 'expense', date: '2026-11-01', categoryId: 'bill', amount: 10 });
    // simulate mergeIncomingData writing a pulled version straight to storage
    const cur = JSON.parse(Repo.getItem(Store.LEDGER_KEY));
    cur.entries.push({ id: 'k2', ledgerType: 'expense', date: '2026-11-02', categoryId: 'bill', amount: 20, _updatedAt: Date.now() });
    Repo.setItem(Store.LEDGER_KEY, JSON.stringify(cur));
    assert.deepEqual(Store.getEntries('expense').map(x => x.id).sort(), ['k1', 'k2']);
    // the next local edit must keep the pulled row instead of reverting to the stale array
    Store._updateEntry('k1', { amount: 11 });
    const saved = JSON.parse(Repo.getItem(Store.LEDGER_KEY));
    assert.deepEqual(saved.entries.map(x => x.id).sort(), ['k1', 'k2']);
  });

  test('edits stamp _updatedAt and request a push when auto-save is on', () => {
    Repo.setItem('bt_auto_save', '1');
    const before = pushes, t0 = Date.now();
    const upd = Store._updateEntry('k1', { amount: 12 });
    assert.ok(upd._updatedAt >= t0);
    assert.equal(pushes, before + 1);
    Store._removeEntry('k2');
    assert.equal(pushes, before + 2);
  });

  test('opening balance edit is stamped so sync can merge it', () => {
    Store.setOpeningBalance('expense', 500);
    const saved = JSON.parse(Repo.getItem(Store.LEDGER_KEY));
    assert.equal(saved.openingBalances.expense, 500);
    assert.ok(saved.openingBalancesAt.expense > 0);
  });
});
