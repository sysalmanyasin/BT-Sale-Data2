// ══════════════════════════════════════════════════════════════════════
// MAIL COMPOSE — pure helpers behind "Send via Gmail" (js/lib/gmail-send.js)
//
//  - No DOM, no network, no storage: everything here is a pure function so it
//    can be unit-tested and so js/platform/supabase.js (core) can import the
//    merge without reaching into a feature domain.
//  - Recipient lists (To / Cc per report, plus an optional signature) live in
//    ONE small object under SEND_LISTS_KEY. It syncs through the normal
//    Supabase payload (`mailSend`); the copy with the newer `updatedAt` wins,
//    so removing an address on one device sticks instead of being re-added.
//  - buildMime() makes a multipart/alternative message (plain text + HTML,
//    UTF-8, base64) for the Gmail API. Every address is re-validated there
//    and header text is stripped of CR/LF, so a pasted value can never inject
//    a header (for example a hidden Bcc).
// ══════════════════════════════════════════════════════════════════════

import { escapeHtml } from './html.js';

export const SEND_LISTS_KEY = 'bt_mail_send_lists_v1';
export const KINDS = ['checklist', 'salereport'];
export const MAX_RECIPIENTS = 40;          // per field; keeps header size and accidents bounded
const MAX_SIGNATURE = 400;

const ADDR_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidAddress(a) {
  return typeof a === 'string' && a.length <= 254 && ADDR_RE.test(a);
}

/** Split free text ("a@x.com, b@y.com; c@z.com" or one per line) into { valid, invalid }. Valid is de-duplicated, case-insensitively. */
export function parseAddresses(input) {
  const tokens = (Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\s,;]+/))
    .map((t) => String(t).trim().replace(/^<|>$/g, ''))
    .filter(Boolean);
  const seen = new Set(), valid = [], invalid = [];
  for (const t of tokens) {
    if (!isValidAddress(t)) { invalid.push(t); continue; }
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); valid.push(t);
  }
  return { valid, invalid };
}

const cleanSignature = (s) => String(s == null ? '' : s)
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
  .split('\n').map((l) => l.trimEnd()).join('\n').trim().slice(0, MAX_SIGNATURE);

const validIso = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : '');

/** Coerce anything (null, old data, a hostile remote payload) into the one shape the app uses. */
export function normalizeLists(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const one = (k) => {
    const x = r[k] && typeof r[k] === 'object' ? r[k] : {};
    const to = parseAddresses(x.to).valid.slice(0, MAX_RECIPIENTS);
    const lower = new Set(to.map((a) => a.toLowerCase()));
    const cc = parseAddresses(x.cc).valid.filter((a) => !lower.has(a.toLowerCase())).slice(0, MAX_RECIPIENTS);
    return { to, cc };
  };
  return { checklist: one('checklist'), salereport: one('salereport'), signature: cleanSignature(r.signature), updatedAt: validIso(r.updatedAt) };
}

/** Newer updatedAt wins; a tie (or no timestamps at all) keeps the local copy. */
export function mergeSendLists(local, remote) {
  const a = normalizeLists(local), b = normalizeLists(remote);
  if (!b.updatedAt) return a;
  if (!a.updatedAt) return b;
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}

/** Return a new lists object with one report's To/Cc (and the shared signature) replaced. */
export function withKindLists(lists, kind, to, cc, signature, nowIso) {
  if (!KINDS.includes(kind)) throw new Error('Unknown report kind: ' + kind);
  const base = normalizeLists(lists);
  return normalizeLists({ ...base, [kind]: { to, cc }, signature, updatedAt: nowIso || new Date().toISOString() });
}

// ── MIME ───────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const base64Utf8 = (str) => bytesToBase64(enc.encode(String(str)));
const wrap76 = (b64) => (b64.match(/.{1,76}/g) || ['']).join('\r\n');

/** Gmail's "raw" field wants URL-safe base64 without padding. */
export const toBase64Url = (str) => base64Utf8(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 2047 header text. Plain ASCII passes through; anything else becomes UTF-8 encoded-words (<=75 chars each). */
export function encodeHeader(value) {
  const v = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const words = [];
  let cur = '', bytes = 0;
  for (const ch of v) {                       // iterates by code point, never splits a surrogate pair
    const n = enc.encode(ch).length;
    if (bytes + n > 45) { words.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  if (cur) words.push(cur);
  return words.map((w) => '=?UTF-8?B?' + base64Utf8(w) + '?=').join('\r\n ');
}

function makeBoundary() {
  const a = new Uint8Array(16);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return 'bt_' + Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

const toCrlf = (s) => String(s == null ? '' : s).replace(/\r\n?|\n/g, '\r\n');

/**
 * Plain text and HTML bodies for the message. `html` is the report fragment exactly as Copy puts it on the clipboard;
 * the signature (if any) is appended as escaped text, because mail sent through the API does not get Gmail's own signature.
 */
export function composeBodies({ html, text, signature }) {
  const sig = cleanSignature(signature);
  const sigHtml = sig
    ? '<div style="font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#000;margin-top:18px;">--<br>' +
      sig.split('\n').map((l) => escapeHtml(l)).join('<br>') + '</div>'
    : '';
  return {
    html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + String(html || '') + sigHtml + '</body></html>',
    text: String(text || '') + (sig ? '\n\n-- \n' + sig : '') + '\n',
  };
}

/** Build the full RFC 822 message. Throws on any invalid address so nothing odd can reach a header. */
export function buildMime({ to, cc = [], subject, text, html, boundary }) {
  const T = Array.isArray(to) ? to : [], C = Array.isArray(cc) ? cc : [];
  if (!T.length) throw new Error('Add at least one To address.');
  for (const a of [...T, ...C]) if (!isValidAddress(a)) throw new Error('Not a valid email address: ' + String(a).slice(0, 60));
  const b = boundary || makeBoundary();
  const head = [
    'MIME-Version: 1.0',
    'To: ' + T.join(',\r\n '),
    C.length ? 'Cc: ' + C.join(',\r\n ') : null,
    'Subject: ' + encodeHeader(subject),
    'Content-Type: multipart/alternative; boundary="' + b + '"',
  ].filter(Boolean).join('\r\n');
  const part = (type, body) => '--' + b + '\r\nContent-Type: ' + type + '; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    wrap76(base64Utf8(toCrlf(body))) + '\r\n';
  return head + '\r\n\r\n' + part('text/plain', text) + part('text/html', html) + '--' + b + '--\r\n';
}
