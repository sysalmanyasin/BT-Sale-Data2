// ══════════════════════════════════════════════════════════════════════
// AGENT SHARED — pure functions, no DOM / window / fetch / Deno.
// ONE file used by the browser (indexer, streaming client) and by the bt-agent Edge Function
// (supabase/functions/bt-agent/agent-shared.js is a byte-identical copy; a test enforces it),
// so redaction, chunking, hashing and stream parsing can never drift between the two.
// ══════════════════════════════════════════════════════════════════════

export const EMBED_DIM = 768;
export const KNOWLEDGE_SOURCES = Object.freeze(['note', 'sheet', 'staff_note']);
export const SENSITIVE_SOURCES = Object.freeze(['staff_note']); // only ever embedded by a non-training provider
export const MAX_CHUNK_CHARS = 2000;
export const MAX_CHUNKS_PER_CALL = 40;

// ── Redaction ───────────────────────────────────────────────────────
// Applied BEFORE text leaves the browser for an embedding provider and again on the server.
// Idempotent. Conservative: it removes identifiers (CNIC, phone, IBAN-like and long digit runs, emails)
// but keeps ordinary amounts so "Rs 5,000" in a note stays searchable.
export function redactSensitive(text) {
  return String(text == null ? '' : text)
    .replace(/\bPK\d{2}[A-Z]{4}\d{16}\b/gi, '[IBAN]') // first: the phone/number rules below would eat its digits
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[CNIC]')
    .replace(/\b\d{13}\b/g, '[CNIC]')
    .replace(/(?:\+?92|0)[\s-]?3\d{2}[\s-]?\d{7}\b/g, '[PHONE]')
    .replace(/(?:\+?92|0)[\s-]?\d{2,3}[\s-]?\d{7}\b/g, '[PHONE]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(/\b\d{9,}\b/g, '[NUMBER]');
}

// ── Hashing (change detection only; not security) ───────────────────
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ── Chunking ────────────────────────────────────────────────────────
/** Split prose into chunks of at most `max` chars, preferring paragraph, then sentence, then hard breaks. */
export function chunkText(text, max = 1200) {
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out = []; let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  const pieces = t.split(/\n{2,}/).flatMap(p => p.length <= max ? [p] : (p.match(/[^.!?\n]+[.!?]*\s*/g) || [p]).flatMap(s => s.length <= max ? [s] : s.match(new RegExp('[\\s\\S]{1,' + max + '}', 'g'))));
  for (const p of pieces) { if ((cur + '\n\n' + p).length > max) flush(); cur = cur ? cur + '\n\n' + p : p; }
  flush();
  return out;
}

/** A sheet tab (2-D array of cells) → chunks of whole rows, header row repeated on each chunk. */
export function chunkSheetRows(values, max = 1500) {
  if (!Array.isArray(values) || !values.length) return [];
  const line = r => (Array.isArray(r) ? r : [r]).map(c => String(c == null ? '' : c).replace(/\s+/g, ' ').trim()).join(' | ').replace(/(\s\|)+\s*$/, '');
  const rows = values.map(line).filter(l => l.replace(/\|/g, '').trim());
  if (!rows.length) return [];
  const header = rows[0].length < 300 ? rows[0] : '';
  const out = []; let cur = header;
  for (let i = header ? 1 : 0; i < rows.length; i++) {
    const r = rows[i].slice(0, max - header.length - 2);
    if (cur && (cur + '\n' + r).length > max) { out.push(cur); cur = header; }
    cur = cur ? cur + '\n' + r : r;
  }
  if (cur && cur !== header) out.push(cur);
  return out.length ? out : (header ? [header] : []);
}

// ── Validation of chunks sent to the server ─────────────────────────
/** @returns {{ok:true, chunks:Array}|{ok:false, error:string}} */
export function validateChunks(raw) {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'chunks required' };
  if (raw.length > MAX_CHUNKS_PER_CALL) return { ok: false, error: 'Too many chunks in one call (max ' + MAX_CHUNKS_PER_CALL + ').' };
  const chunks = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'bad chunk' };
    if (!KNOWLEDGE_SOURCES.includes(c.source)) return { ok: false, error: 'bad source' };
    const source_id = String(c.source_id == null ? '' : c.source_id).slice(0, 120);
    const idx = Number(c.chunk_index);
    if (!source_id || !Number.isInteger(idx) || idx < 0 || idx > 500) return { ok: false, error: 'bad chunk id' };
    const content = redactSensitive(String(c.content == null ? '' : c.content)).slice(0, MAX_CHUNK_CHARS).trim();
    if (!content) continue;
    chunks.push({ source: c.source, source_id, chunk_index: idx, title: redactSensitive(String(c.title || '')).slice(0, 160), content, content_hash: hashText(content), sensitive: SENSITIVE_SOURCES.includes(c.source) });
  }
  return chunks.length ? { ok: true, chunks } : { ok: false, error: 'no usable content' };
}

// ── Server-sent events ──────────────────────────────────────────────
/** Pull complete SSE events out of a text buffer. @returns {{data:string[], rest:string}} */
export function parseSSE(buffer) {
  const parts = String(buffer).replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop();
  const data = [];
  for (const p of parts) {
    const lines = p.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, ''));
    if (lines.length) data.push(lines.join('\n'));
  }
  return { data, rest };
}

/** Accumulates OpenAI-style streaming chunks into {content, tool_calls}. */
export function createDeltaAccumulator() {
  let content = ''; const calls = []; let usage = {}; let finish = null;
  return {
    /** @returns {string} the text delta carried by this chunk ('' if none) */
    push(chunk) {
      if (chunk && chunk.usage) usage = chunk.usage;
      const ch = chunk && chunk.choices && chunk.choices[0];
      if (!ch) return '';
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta || {};
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const i = Number.isInteger(tc.index) ? tc.index : calls.length;
          const cur = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) cur.id = tc.id;
          if (tc.function) { if (tc.function.name) cur.function.name += tc.function.name; if (tc.function.arguments) cur.function.arguments += tc.function.arguments; }
        }
      }
      if (typeof d.content === 'string' && d.content) { content += d.content; return d.content; }
      return '';
    },
    result() {
      const tool_calls = calls.filter(c => c && c.function.name).map((c, i) => ({ ...c, id: c.id || 'call_' + i }));
      return { message: { role: 'assistant', content: content || null, ...(tool_calls.length ? { tool_calls } : {}) }, usage, finish_reason: finish };
    },
  };
}
