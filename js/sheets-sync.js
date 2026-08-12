// ══════════════════════════════════════════════════════════════════
// SHEETS ↔ SUPABASE SYNC
// ══════════════════════════════════════════════════════════════════
// bt_sheets / bt_sheets_cache / bt_sheets_pushes — see the migration
// applied directly via Supabase MCP (create_bt_sheets_tables).
// Uses window.btGetSupabaseClient(), the same door closing-ledger-marks.js
// uses, rather than duplicating SB_URL/SB_KEY here (see js/supabase.js).
//
// These three tables are plain normalized tables (not the single-blob
// bt_salesdata pattern) because each sheet/tab/push is its own row —
// that's what makes "every device sees the list instantly" and
// "snapshot per tab" possible without re-shipping the whole app payload
// on every poll.
// ══════════════════════════════════════════════════════════════════
(function () {
'use strict';

function sb() { return window.btGetSupabaseClient(); }

// ── bt_sheets (metadata) ────────────────────────────────────────────
async function sbSheetsList() {
  const { data, error } = await sb().from('bt_sheets').select('*').eq('deleted', false).order('pinned', { ascending: false }).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function sbSheetsInsert(spreadsheetId, title) {
  const { data, error } = await sb().from('bt_sheets').insert({ spreadsheet_id: spreadsheetId, title }).select().single();
  if (error) throw error;
  return data;
}

async function sbSheetsTouch(spreadsheetId, patch) {
  const { error } = await sb().from('bt_sheets').update({ ...patch, updated_at: new Date().toISOString() }).eq('spreadsheet_id', spreadsheetId);
  if (error) throw error;
}

async function sbSheetsSetPinned(spreadsheetId, pinned) {
  return sbSheetsTouch(spreadsheetId, { pinned });
}

async function sbSheetsSoftDelete(spreadsheetId) {
  return sbSheetsTouch(spreadsheetId, { deleted: true });
}

// ── bt_sheets_cache (per-tab snapshot) ──────────────────────────────
async function sbCacheGet(spreadsheetId) {
  const { data, error } = await sb().from('bt_sheets_cache').select('*').eq('spreadsheet_id', spreadsheetId).order('tab_index', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Overwrite the full snapshot for a spreadsheet (called after every pull).
async function sbCacheWrite(spreadsheetId, tabs) {
  const now = new Date().toISOString();
  const rows = tabs.map(t => ({
    spreadsheet_id: spreadsheetId,
    tab_name: t.tab_name,
    tab_index: t.tab_index,
    values_json: t.values_json,
    snapshot_at: now
  }));
  if (rows.length) {
    const { error } = await sb().from('bt_sheets_cache').upsert(rows, { onConflict: 'spreadsheet_id,tab_name' });
    if (error) throw error;
  }
  await sbSheetsTouch(spreadsheetId, { last_synced_at: now });
}

// ── bt_sheets_pushes (timestamped history of "Send to Sheets" exports) ─
async function sbPushRecord(spreadsheetId, tabName, source, rowCount) {
  const { error } = await sb().from('bt_sheets_pushes').insert({
    spreadsheet_id: spreadsheetId, tab_name: tabName, source, row_count: rowCount
  });
  if (error) throw error;
}

async function sbPushHistory(spreadsheetId) {
  const { data, error } = await sb().from('bt_sheets_pushes').select('*').eq('spreadsheet_id', spreadsheetId).order('pushed_at', { ascending: false }).limit(20);
  if (error) throw error;
  return data || [];
}

window.sbSheetsList       = sbSheetsList;
window.sbSheetsInsert     = sbSheetsInsert;
window.sbSheetsTouch      = sbSheetsTouch;
window.sbSheetsSetPinned  = sbSheetsSetPinned;
window.sbSheetsSoftDelete = sbSheetsSoftDelete;
window.sbCacheGet         = sbCacheGet;
window.sbCacheWrite       = sbCacheWrite;
window.sbPushRecord       = sbPushRecord;
window.sbPushHistory      = sbPushHistory;

})();
