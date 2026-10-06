// Knowledge index, browser side: gathers the owner's Notes, Sheets (and optionally staff notes), turns them into
// small redacted chunks, and sends ONLY what changed to the bt-agent function, which embeds and stores them.
// Nothing is sent until the owner taps "Index now" in the 🧠 Memory card (or turned on automatic updates).
import { chunkText, chunkSheetRows, redactSensitive, hashText, MAX_CHUNKS_PER_CALL } from '../../shared/agent-shared.js';

export const MAX_ITEM_CHUNKS = 30;       // per note / sheet tab
export const MANIFEST_KEY = 'bt_agent_knowledge_manifest_v1';
export const PREFS_KEY = 'bt_agent_knowledge_prefs_v1';
const keyOf = it => it.source + '|' + it.source_id;

// ── turning app data into items ─────────────────────────────────────
export function noteItems(notes) {
  return (Array.isArray(notes) ? notes : []).filter(n => n && n.id).map(n => {
    const text = [n.title, n.body, Array.isArray(n.tags) && n.tags.length ? 'Tags: ' + n.tags.join(', ') : ''].filter(Boolean).join('\n');
    return { source: 'note', source_id: String(n.id), title: String(n.title || 'Untitled note'), chunks: chunkText(text, 1200).slice(0, MAX_ITEM_CHUNKS) };
  }).filter(it => it.chunks.length);
}
export function staffNoteItems(notes) {
  return (Array.isArray(notes) ? notes : []).filter(n => n && n.id && String(n.text || '').trim())
    .map(n => ({ source: 'staff_note', source_id: String(n.id), title: 'Staff note', chunks: chunkText(n.text, 1200).slice(0, MAX_ITEM_CHUNKS) }));
}
export function sheetItems(tabs, titles = {}) {
  return (Array.isArray(tabs) ? tabs : []).filter(t => t && t.spreadsheet_id && Array.isArray(t.values_json)).map(t => {
    const title = (titles[t.spreadsheet_id] || 'Sheet') + ' / ' + (t.tab_name || 'Tab');
    return { source: 'sheet', source_id: t.spreadsheet_id + ':' + (t.tab_name || ''), title, chunks: chunkSheetRows(t.values_json, 1500).slice(0, MAX_ITEM_CHUNKS) };
  }).filter(it => it.chunks.length);
}

export const itemDigest = it => hashText(it.title + '\u0001' + it.chunks.join('\u0002'));

// ── planning ────────────────────────────────────────────────────────
/** @returns {{changed:Array, removed:Array<{source,source_id}>, unchanged:number}} */
export function planSync(items, manifest = {}) {
  const changed = [], seen = new Set();
  for (const it of items) { seen.add(keyOf(it)); if (manifest[keyOf(it)] !== itemDigest(it)) changed.push(it); }
  const removed = Object.keys(manifest).filter(k => !seen.has(k)).map(k => { const i = k.indexOf('|'); return { source: k.slice(0, i), source_id: k.slice(i + 1) }; });
  return { changed, removed, unchanged: items.length - changed.length };
}

/** Whole items per batch (never split across calls), at most MAX_CHUNKS_PER_CALL chunks, ordinary and staff notes never mixed. */
export function toBatches(items) {
  const batches = [];
  for (const sensitive of [false, true]) {
    let cur = null;
    for (const it of items.filter(i => (i.source === 'staff_note') === sensitive)) {
      if (!cur || cur.n + it.chunks.length > MAX_CHUNKS_PER_CALL) { cur = { sensitive, items: [], chunks: [], n: 0 }; batches.push(cur); }
      cur.items.push(it); cur.n += it.chunks.length;
      it.chunks.forEach((c, i) => cur.chunks.push({ source: it.source, source_id: it.source_id, chunk_index: i, title: redactSensitive(it.title), content: redactSensitive(c) }));
    }
  }
  return batches;
}

// ── reading the app's data ──────────────────────────────────────────
export async function loadSources(sb, { includeStaffNotes = false } = {}) {
  const parse = key => { try { const v = JSON.parse(Repository.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  let items = noteItems(parse('bt_notes_v1'));
  if (includeStaffNotes) items = items.concat(staffNoteItems(parse('bt_staff_notes_v1')));
  if (sb) {
    try {
      const [meta, cache] = await Promise.all([
        sb.from('bt_sheets').select('spreadsheet_id, title').eq('deleted', false).limit(200),
        sb.from('bt_sheets_cache').select('spreadsheet_id, tab_name, tab_index, values_json').limit(1000),
      ]);
      const live = {}; for (const m of (meta.data || [])) live[m.spreadsheet_id] = m.title;
      items = items.concat(sheetItems((cache.data || []).filter(t => live[t.spreadsheet_id] !== undefined), live));
    } catch (_) { /* sheets are optional; notes still index */ }
  }
  return items;
}

const readJSON = (storage, key, dflt) => { try { const v = JSON.parse(storage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : dflt; } catch (_) { return dflt; } };
const writeJSON = (storage, key, val) => { try { storage.setItem(key, JSON.stringify(val)); } catch (_) { /* private mode: index still works, just resends next time */ } };
export const getPrefs = (storage = globalThis.localStorage) => ({ auto: false, staffNotes: false, lastSync: 0, ...readJSON(storage, PREFS_KEY, {}) });
export const setPrefs = (patch, storage = globalThis.localStorage) => writeJSON(storage, PREFS_KEY, { ...getPrefs(storage), ...patch });
export const clearManifest = (storage = globalThis.localStorage) => { try { storage.removeItem(MANIFEST_KEY); } catch (_) { /* nothing to clear */ } };

/**
 * Indexes what changed. Stops at the first failed batch (usually a rate limit) and reports what was done, so a
 * retry later carries on where it stopped. @returns {Promise<object>} a summary for the UI
 */
export async function syncKnowledge({ sb, callAction, includeStaffNotes = false, storage = globalThis.localStorage, onProgress = () => {}, now = Date.now() }) {
  const items = await loadSources(sb, { includeStaffNotes });
  const manifest = readJSON(storage, MANIFEST_KEY, {});
  const plan = planSync(items, manifest);
  const next = { ...manifest };
  const sum = { ok: true, items: items.length, indexedItems: 0, embedded: 0, unchanged: plan.unchanged, removed: 0, skippedStaff: 0, error: null };

  if (plan.removed.length) {
    try { const r = await callAction('index', { remove: plan.removed.slice(0, 100) }); sum.removed = r.removed || 0; for (const x of plan.removed.slice(0, 100)) delete next[x.source + '|' + x.source_id]; }
    catch (e) { sum.ok = false; sum.error = (e && e.message) || 'Could not update the index.'; writeJSON(storage, MANIFEST_KEY, next); return sum; }
  }
  const batches = toBatches(plan.changed);
  for (let i = 0; i < batches.length; i++) {
    onProgress({ batch: i + 1, of: batches.length });
    try {
      const r = await callAction('index', { chunks: batches[i].chunks });
      sum.embedded += r.embedded || 0;
      if (batches[i].sensitive && (r.skipped_sensitive || 0) > 0) { sum.skippedStaff += r.skipped_sensitive; continue; } // not indexed: keep it "changed" so it is retried if the provider changes
      for (const it of batches[i].items) next[keyOf(it)] = itemDigest(it);
      sum.indexedItems += batches[i].items.length;
    } catch (e) { sum.ok = false; sum.error = (e && e.message) || 'Could not index.'; break; }
  }
  writeJSON(storage, MANIFEST_KEY, next);
  if (sum.ok) setPrefs({ lastSync: now }, storage);
  return sum;
}
