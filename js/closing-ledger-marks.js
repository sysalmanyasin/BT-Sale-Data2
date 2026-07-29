// ══════════════════════════════════════════════════════════════════════
// CLOSING LEDGER MARKS
//
// Tracks which Closing Credit Ledger rows have already been manually
// added to BT's real Ledger via the Quick Add modal (ledger-quick-add.js).
// This is purely a receipt/audit trail — a small, standalone Supabase
// table (bt_closing_ledger_marks), separate from the real ledger data
// (bt_ledger_v1 / LedgerStore). Nothing here ever creates or edits a
// real ledger entry, and nothing that writes real financial data reads
// from this table — the only consumer is closing-native.js's row
// renderer, which shows a ✓ Added badge instead of a "+ Ledger" button
// for a row once it's marked.
//
// This is NOT the old auto-sync/inbox model (bt_inbox_ledger etc, see
// bt-bridge.js's header for why that was removed) — it doesn't feed
// anything automatically, it only remembers that a human already did.
//
// Table (create once in Supabase — SQL given alongside this file):
//   bt_closing_ledger_marks (row_key text primary key, ledger_type text,
//     entry_id text, amount numeric, description text, added_at timestamptz)
// ══════════════════════════════════════════════════════════════════════

const MARKS_TABLE = 'bt_closing_ledger_marks';
// Local fallback for a mark whose Supabase upsert failed (dropped
// connection, expired session mid-write, etc.). Kept in localStorage —
// not just memory — so a failed mark still shows "✓ Added" (and isn't
// re-added a second time by a retry tap) even across a page reload,
// until the background retry in flushPendingMarks() below gets it onto
// the server.
const PENDING_KEY = 'bt_pending_ledger_marks_v1';

let _marks = null; // rowKey -> { ledgerType, entryId, amount, description, addedAt }

function _client() {
  return (typeof window.btGetSupabaseClient === 'function') ? window.btGetSupabaseClient() : null;
}

function _readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch (_) { return {}; }
}
function _writePending(map) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)); } catch (_) {}
}
function _stashPending(rowKey, row) {
  const pending = _readPending();
  pending[rowKey] = row;
  _writePending(pending);
}
function _clearPending(rowKey) {
  const pending = _readPending();
  if (pending[rowKey]) { delete pending[rowKey]; _writePending(pending); }
}

// Fetches every mark once and caches in memory. Safe to call repeatedly —
// pass force:true (after a save) to refetch instead of using the cache.
export async function fetchMarks(force = false) {
  if (_marks && !force) return _marks;
  const db = _client();
  const pending = _readPending();
  if (!db) { _marks = { ..._marks, ...pending }; return _marks; }
  try {
    const { data, error } = await db
      .from(MARKS_TABLE)
      .select('row_key, ledger_type, entry_id, amount, description, added_at');
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => {
      map[r.row_key] = {
        ledgerType: r.ledger_type,
        entryId: r.entry_id,
        amount: r.amount,
        description: r.description,
        addedAt: r.added_at,
      };
    });
    // Any row still queued locally (last save attempt failed) hasn't
    // reached the server yet — keep showing it as Added and try again
    // in the background, rather than letting it flash back to "+ Ledger".
    Object.keys(pending).forEach(k => { if (!map[k]) map[k] = { ledgerType: pending[k].ledger_type, entryId: pending[k].entry_id, amount: pending[k].amount, description: pending[k].description, addedAt: pending[k].added_at }; });
    _marks = map;
    if (Object.keys(pending).length) flushPendingMarks();
  } catch (e) {
    console.warn('closing-ledger-marks: fetch failed —', e.message);
    _marks = { ..._marks, ...pending }; // don't crash the Credit Ledger page over this
  }
  return _marks;
}

export function getMark(rowKey) {
  return _marks ? (_marks[rowKey] || null) : null;
}

// Upsert, not insert — idempotent-safe against a double-tap or a race
// with another device marking the same row, same reasoning as every
// other write path in this app (see supabase.js's bt_salesdata upsert).
export async function saveMark({ rowKey, ledgerType, entryId, amount, description }) {
  const row = {
    row_key: rowKey,
    ledger_type: ledgerType,
    entry_id: String(entryId),
    amount: amount,
    description: description || '',
    added_at: new Date().toISOString(),
  };
  // Optimistic local update FIRST: the real ledger entry this receipt
  // is for has already been written by the time saveMark() is called
  // (see ledger-quick-add.js), so from here on the row must read as
  // Added even if the receipt write below fails — otherwise a retried
  // tap re-adds a second real entry, which is the actual harm.
  if (!_marks) _marks = {};
  _marks[rowKey] = { ledgerType, entryId: String(entryId), amount, description, addedAt: row.added_at };

  const db = _client();
  if (!db) {
    _stashPending(rowKey, row);
    throw new Error('Supabase not connected — receipt saved locally, will sync when reconnected');
  }
  try {
    const { error } = await db.from(MARKS_TABLE).upsert(row, { onConflict: 'row_key' });
    if (error) throw error;
    _clearPending(rowKey);
  } catch (e) {
    _stashPending(rowKey, row);
    throw e;
  }
  return _marks[rowKey];
}

// Retries every locally-queued mark against Supabase. Called after a
// fresh fetchMarks() finds leftovers, and on 'online' below — cheap and
// safe to call anytime since it only touches rows still in the queue.
export async function flushPendingMarks() {
  const db = _client();
  if (!db) return;
  const pending = _readPending();
  const keys = Object.keys(pending);
  if (!keys.length) return;
  for (const rowKey of keys) {
    try {
      const { error } = await db.from(MARKS_TABLE).upsert(pending[rowKey], { onConflict: 'row_key' });
      if (error) throw error;
      _clearPending(rowKey);
    } catch (e) {
      console.warn('closing-ledger-marks: retry flush failed for', rowKey, '—', e.message);
      // stays queued; next fetchMarks()/online event tries again
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushPendingMarks(); });
}
