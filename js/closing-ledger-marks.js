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

let _marks = null; // rowKey -> { ledgerType, entryId, amount, description, addedAt }

function _client() {
  return (typeof window.btGetSupabaseClient === 'function') ? window.btGetSupabaseClient() : null;
}

// Fetches every mark once and caches in memory. Safe to call repeatedly —
// pass force:true (after a save) to refetch instead of using the cache.
export async function fetchMarks(force = false) {
  if (_marks && !force) return _marks;
  const db = _client();
  if (!db) { _marks = _marks || {}; return _marks; }
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
    _marks = map;
  } catch (e) {
    console.warn('closing-ledger-marks: fetch failed —', e.message);
    _marks = _marks || {}; // don't crash the Credit Ledger page over this
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
  const db = _client();
  if (!db) throw new Error('Supabase not connected — mark not saved');
  const row = {
    row_key: rowKey,
    ledger_type: ledgerType,
    entry_id: String(entryId),
    amount: amount,
    description: description || '',
    added_at: new Date().toISOString(),
  };
  const { error } = await db.from(MARKS_TABLE).upsert(row, { onConflict: 'row_key' });
  if (error) throw error;
  if (!_marks) _marks = {};
  _marks[rowKey] = { ledgerType, entryId: String(entryId), amount, description, addedAt: row.added_at };
  return _marks[rowKey];
}
