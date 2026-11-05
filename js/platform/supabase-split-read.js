// bt_salesdata READ-SIDE SPLIT — split out of supabase.js (file-size budget).
// See the block comment below for the design; supabase.js owns the write path and merge rules.
import { Repository } from './repository.js';
import { Actions } from './actions.js';

// ══════════════════════════════════════════════════════════════════
// READ-SIDE SPLIT  (2026-11 egress cleanup)
// The bt_salesdata row is ~2.5 MB of JSON, 82% of it `daily`. It used to be
// downloaded WHOLE by every pull, by the pre-push compare-and-swap read, and
// (via Realtime) pushed to every device on every update. Now, in 'delta' mode:
//   • a ~100 B probe says whether the row changed at all since we last merged it;
//   • if it did: the `bt_salesdata_core` view (the same row WITHOUT `daily`,
//     ~460 kB) plus only the bt_daily rows changed since a server-side cursor
//     (trg_bt_fanout mirrors `daily` row-for-row into bt_daily);
//   • Realtime listens to the tiny bt_sync_signal table, not the big row.
// 'full' mode (the original whole-row read) still runs on a manual pull, with no
// valid cursor, or after 6 h — the safety net. The write path is unchanged.
// Merging stays correct with a partial `daily`: mergePulledDaily/gapFillDaily only
// ever add or update the rows they are given (see repository.js).
// ══════════════════════════════════════════════════════════════════
export const SB_CORE_VIEW    = 'bt_salesdata_core';
const SB_DAILY_TABLE  = 'bt_daily';
export const SB_SIGNAL_TABLE = 'bt_sync_signal';
const SB_CURSOR_KEY   = 'bt_sb_cursor_v1';
const SB_FULL_RESYNC_MS   = 6 * 60 * 60 * 1000;
const SB_DAILY_OVERLAP_MS = 90 * 1000;   // commits can land slightly out of order
const SB_DAILY_PAGE   = 1000;            // PostgREST caps a response at 1000 rows
export const SB_EPOCH_ISO    = '1970-01-01T00:00:00.000Z';

// Timestamps arrive with microseconds ("…:16.802426+00:00"); trim to ms so every browser parses them.
function _sbParseIso(iso) { return Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1')); }

export function _sbMaxIso(rows, field, prev) {
  let best = prev || null, bestMs = best ? _sbParseIso(best) : -Infinity;
  (rows || []).forEach(r => {
    const ms = r && r[field] ? _sbParseIso(r[field]) : NaN;
    if (!isNaN(ms) && ms > bestMs) { best = r[field]; bestMs = ms; }
  });
  return best;
}

export function _sbLoadCursor() {
  try {
    const c = JSON.parse(Repository.getItem(SB_CURSOR_KEY) || 'null');
    return (c && typeof c === 'object') ? c : null;
  } catch (_) { return null; }
}
export function _sbSaveCursor(c) {
  try {
    if (c) Actions.saveFeatureData(SB_CURSOR_KEY, JSON.stringify(c));
    else   Actions.clearFeatureData(SB_CURSOR_KEY);
  } catch (_) { /* best-effort — no cursor just means the next read is a full one */ }
}

// A cursor is only trusted if it is complete, fresh, and the local data hasn't
// SHRUNK since it was written (a wiped/restored local store must re-read everything).
export function _sbCursorUsable(c, localDailyCount, now = Date.now()) {
  return !!(c && c.stamp && c.daily && c.fullAt > 0 &&
            (now - c.fullAt) < SB_FULL_RESYNC_MS &&
            localDailyCount > 0 && localDailyCount >= (c.n || 0));
}
export function _sbPickMode(c, manual, localDailyCount, now = Date.now()) {
  return (!manual && _sbCursorUsable(c, localDailyCount, now)) ? 'delta' : 'full';
}

// Tiny read: just the row's updated_at. undefined = the probe failed, null = no row yet.
export async function _sbProbeStamp(db, table, id) {
  try {
    const { data, error } = await db.from(table).select('updated_at').eq('id', id).maybeSingle();
    if (error) return undefined;
    return data ? data.updated_at : null;
  } catch (_) { return undefined; }
}

// → { data: {payload, updated_at} | null, error, dailyCursor }
export async function _sbFetchRemote(db, table, id, mode, cursor) {
  if (mode !== 'delta') {
    // Note where bt_daily stands BEFORE the big read, so a row written meanwhile
    // is re-fetched by the next delta rather than missed.
    let dailyCursor = null;
    try {
      const { data: top } = await db.from(SB_DAILY_TABLE).select('updated_at').order('updated_at', { ascending: false }).limit(1);
      dailyCursor = (top && top[0] && top[0].updated_at) || null;
    } catch (_) { /* leave null → cursor falls back to epoch, i.e. next delta is just a bit larger */ }
    const { data, error } = await db.from(table).select('payload, updated_at').eq('id', id).single();
    return { data, error, dailyCursor: dailyCursor || SB_EPOCH_ISO };
  }
  const { data: core, error } = await db.from(SB_CORE_VIEW).select('payload, updated_at').eq('id', id).single();
  if (error || !core) return { data: null, error: error || new Error('empty core read'), dailyCursor: cursor.daily };
  const since = new Date(_sbParseIso(cursor.daily) - SB_DAILY_OVERLAP_MS).toISOString();
  const rows = [];
  let maxSeen = cursor.daily;
  for (let from = 0; ; from += SB_DAILY_PAGE) {
    const { data: page, error: e2 } = await db.from(SB_DAILY_TABLE).select('data, updated_at')
      .gte('updated_at', since)
      .order('updated_at', { ascending: true }).order('date', { ascending: true })
      .range(from, from + SB_DAILY_PAGE - 1);
    if (e2) return { data: null, error: e2, dailyCursor: cursor.daily };
    (page || []).forEach(r => rows.push(r.data));
    maxSeen = _sbMaxIso(page, 'updated_at', maxSeen);
    if (!page || page.length < SB_DAILY_PAGE) break;
  }
  return { data: { payload: { ...core.payload, daily: rows }, updated_at: core.updated_at }, error: null, dailyCursor: maxSeen };
}

// Persist the cursor after a successful merge/push. A null stamp (e.g. the very first insert) clears it,
// so the next read is a full one.
export function _sbCommitCursor(stamp, dailyCursor, prev, didFull, localDailyCount) {
  _sbSaveCursor(stamp ? {
    stamp, daily: dailyCursor || SB_EPOCH_ISO,
    fullAt: (didFull || !prev) ? Date.now() : prev.fullAt, n: localDailyCount,
  } : null);
}
