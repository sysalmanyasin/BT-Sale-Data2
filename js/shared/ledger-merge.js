// ══════════════════════════════════════════════════════════════════════
// LEDGER MERGE  —  pure last-write-wins merge helpers (no DOM, no storage)
//
// ROOT CAUSE of "I edited a ledger entry and the edit didn't sync / got
// reverted": mergeIncomingData() used to merge the generalized ledger with
//   • PULL: remote copy of an id ALWAYS replaced the local copy, and
//   • PUSH: local copy of an id ALWAYS beat the remote copy,
// with no look at when each copy was last edited. So an edit that had not
// been pushed yet was erased by the next background pull (realtime event,
// unlock, "online", startup), and a stale copy on one device could overwrite
// a newer edit made on another device during the push-time re-merge.
//
// Every ledger entry / custom section / opening balance already carries (or
// now carries) a millisecond `_updatedAt`. The rule here is simply: for the
// same id, the copy with the newer stamp wins — in BOTH directions. Only
// when the stamps are equal (or both missing, i.e. legacy rows) does the old
// direction rule apply: remote wins on pull, local wins on push.
//
// Tombstones still take priority: an id deleted anywhere stays deleted.
// ══════════════════════════════════════════════════════════════════════

const stampOf = (x) => (x && Number(x._updatedAt)) || 0;

/** Picks the newer of two copies of the same record; ties follow the sync direction. */
export function pickNewer(local, remote, isPull) {
  if (!local) return remote;
  if (!remote) return local;
  const l = stampOf(local), r = stampOf(remote);
  if (r > l) return remote;
  if (l > r) return local;
  return isPull ? remote : local;
}

/**
 * Entries merged by id. Order is stable: local order first, then remote-only
 * ids in remote order (so repeated no-op syncs write an identical string and
 * Repository.setItem's no-change guard keeps the Activity Log quiet).
 */
export function mergeLedgerEntries(localEntries, remoteEntries, { isPull = false, isDeleted = () => false } = {}) {
  const byId = new Map();
  (Array.isArray(localEntries) ? localEntries : []).forEach(e => {
    if (e && e.id && !isDeleted('led:' + e.id)) byId.set(e.id, e);
  });
  (Array.isArray(remoteEntries) ? remoteEntries : []).forEach(e => {
    if (!e || !e.id || isDeleted('led:' + e.id)) return;
    byId.set(e.id, pickNewer(byId.get(e.id), e, isPull));
  });
  return Array.from(byId.values());
}

/**
 * Opening balances merged per ledgerType. A balance carries its own edit time
 * in the sibling `openingBalancesAt` map (a plain number can't hold a stamp).
 * Balances of deleted sections ('sec:' tombstone) are dropped.
 */
export function mergeOpeningBalances(local, remote, { isPull = false, isDeleted = () => false } = {}) {
  const lOB = (local && local.openingBalances) || {}, rOB = (remote && remote.openingBalances) || {};
  const lAt = (local && local.openingBalancesAt) || {}, rAt = (remote && remote.openingBalancesAt) || {};
  const openingBalances = {}, openingBalancesAt = {};
  new Set([...Object.keys(lOB), ...Object.keys(rOB)]).forEach(t => {
    if (isDeleted('sec:' + t)) return;
    const hasL = t in lOB, hasR = t in rOB;
    let useRemote;
    if (!hasL) useRemote = true;
    else if (!hasR) useRemote = false;
    else {
      const l = Number(lAt[t]) || 0, r = Number(rAt[t]) || 0;
      useRemote = r > l ? true : l > r ? false : isPull;
    }
    openingBalances[t] = useRemote ? rOB[t] : lOB[t];
    const at = useRemote ? rAt[t] : lAt[t];
    if (at) openingBalancesAt[t] = at;
  });
  return { openingBalances, openingBalancesAt };
}

/** Custom "Misc Section" type definitions merged by key, newest `_updatedAt` wins. */
export function mergeCustomTypes(local, remote, { isPull = false, isDeleted = () => false } = {}) {
  const merged = {};
  const L = local && typeof local === 'object' ? local : {};
  const R = remote && typeof remote === 'object' ? remote : {};
  Object.keys(L).forEach(t => { if (!isDeleted('sec:' + t)) merged[t] = L[t]; });
  Object.keys(R).forEach(t => {
    if (isDeleted('sec:' + t)) return;
    merged[t] = pickNewer(merged[t], R[t], isPull);
  });
  return merged;
}
