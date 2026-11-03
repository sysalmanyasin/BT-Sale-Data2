// ======================================================================
// HUB SYNC PROBE -- the 1-row "has the Dropbox inventory sync moved?" read of
// inventory_sync_log, shared by the inventory, STR and sale-payments bridges
// (2026-11 egress cleanup).
//
// Each of those bridges used to carry its own copy of this query. The manual
// Resume catch-up fires all of them within the same second, so one resume cost
// three identical requests. Now concurrent callers share one in-flight request,
// and a successful result is reused for MEMO_MS.
//
//   o Only a real (non-null) answer is remembered -- a failure or an empty
//     answer is never cached, so every caller still gets to retry and "unsure"
//     keeps meaning "refetch" exactly as before.
//   o Leaf module (no imports), like hub-gate.js.
// ======================================================================

export const MEMO_MS = 15 * 1000;

let _memo = null;     // { at, value }
let _inflight = null;

export function fetchLatestSyncedAt(client) {
  if (_memo && Date.now() - _memo.at < MEMO_MS) return Promise.resolve(_memo.value);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { data, error } = await client
        .from('inventory_sync_log')
        .select('synced_at')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const value = data ? data.synced_at : null;
      if (value) _memo = { at: Date.now(), value };
      return value;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Test hook only. */
export function _reset() { _memo = null; _inflight = null; }
