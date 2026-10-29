// ══════════════════════════════════════════════════════════════════════
// GMAIL SEND — "Send via Gmail" for the Daily Check List and the Sale Report (js/lib/gmail-send.js)
//
//  - One dialog for both pages: subject, To, Cc and an optional signature, then Send.
//    The report goes out as the same HTML the Copy button puts on the clipboard (plus a
//    plain-text copy), so it looks like a paste into Gmail.
//  - To / Cc (kept separately for each report) and the signature are saved under
//    SEND_LISTS_KEY and travel in the Supabase sync payload (see js/platform/supabase.js).
//  - One Google account for everything: the one Email briefing connected with (bt_mail_email). Send refuses to run until
//    that is saved, hints that account to Google, then checks who actually signed in and refuses a different one.
//  - Access: Google Identity Services with the send-only scope gmail.send. The token lives in
//    memory only. The Google client ID is the one already saved by Utility > Mail (bt_mail_cid).
//    The token request runs straight from the Send tap, because browsers block the Google
//    pop-up when it is opened after a delay.
//  - Never auto-retried: after a timeout or a lost connection the mail may already be sent,
//    so the dialog says so and asks before sending again. Nothing here logs addresses or text.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from '../platform/repository.js';
import { Actions } from '../platform/actions.js';
import { SEND_LISTS_KEY, MAX_RECIPIENTS, normalizeLists, withKindLists, parseAddresses, buildMime, composeBodies, toBase64Url } from '../shared/mail-compose.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';   // lets us confirm WHICH Google account signed in
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SILENT_TIMEOUT_MS = 8000;
const CID_KEY = 'bt_mail_cid';
const EMAIL_KEY = 'bt_mail_email';
const SENT_KEY = 'bt_mail_sent_v1';          // device-local: which reports were already sent (to warn before a repeat)
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TIMEOUT_MS = 30000;

/** `code` tells the dialog how to behave: 'uncertain' = may have been sent, everything else = definitely not sent. */
export class GmailError extends Error {
  constructor(code, message) { super(message); this.name = 'GmailError'; this.code = code; }
}

// ── storage ────────────────────────────────────────────────────────────
export function loadSendLists() {
  try { return normalizeLists(JSON.parse(Repository.getItem(SEND_LISTS_KEY) || 'null')); } catch (_) { return normalizeLists(null); }
}
function saveSendLists(lists) {
  Actions.saveFeatureData(SEND_LISTS_KEY, JSON.stringify(lists));
  // Same rule every other feature follows: push right away when auto-save is on; the 30 s timer covers the rest.
  if (Repository.getItem('bt_auto_save') === '1' && typeof window.pushToSupabase === 'function') window.pushToSupabase();
}
const readSent = () => { try { return JSON.parse(Repository.getItem(SENT_KEY) || '{}') || {}; } catch (_) { return {}; } };
function recordSent(kind, dateKey, id) {
  const all = readSent();
  all[kind + ':' + dateKey] = { at: new Date().toISOString(), id: id || '' };
  const keep = Object.entries(all).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 60);
  Repository.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(keep)));
}

// ── Google token (in memory only) ──────────────────────────────────────
// The send button must use the SAME Google account as the Email briefing (bt_mail_email, saved by Utility > Mail).
// A login hint only suggests that account, so after sign-in we read the account's address (userinfo.email scope)
// and refuse to go on if it is a different one.
let tokenCache = null;                         // { value, exp, email }
/** Forget the in-memory token (also used by tests). The next send asks Google again. */
export function clearGmailToken() { tokenCache = null; }
const expectedAccount = () => String(Repository.getItem(EMAIL_KEY) || '').trim().toLowerCase();

/** The Google account behind a token, or '' when it cannot be read. */
async function whoIs(token) {
  try {
    const res = await globalThis.fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return '';
    const j = await res.json();
    return String((j && j.email) || '').trim().toLowerCase();
  } catch (_) { return ''; }
}

/**
 * Get a token. silent:true asks Google quietly in the background (no pop-up; fails if Google needs a tap).
 * The interactive form must be called synchronously from a tap/click handler (no await before it).
 */
function requestToken({ silent = false } = {}) {
  let timer = 0;
  return new Promise((resolve, reject) => {
    if (tokenCache && tokenCache.exp - Date.now() > 60000) { resolve(tokenCache.value); return; }
    const cid = Repository.getItem(CID_KEY) || '';
    if (!/\.apps\.googleusercontent\.com$/.test(cid)) { reject(new GmailError('no-client', 'Connect Gmail once in Utility \u203A Mail first. That saves the Google client ID.')); return; }
    const g = window.google;
    if (!g || !g.accounts || !g.accounts.oauth2) { reject(new GmailError('gis', 'Google sign-in is still loading. Try again in a moment.')); return; }
    const expected = expectedAccount();
    const client = g.accounts.oauth2.initTokenClient({
      client_id: cid, scope: SCOPE + ' ' + EMAIL_SCOPE, hint: expected || undefined, login_hint: expected || undefined,
      callback: (r) => {
        if (!r || r.error || !r.access_token) { reject(new GmailError('auth', 'Google said: ' + ((r && r.error) || 'no token') + '. Try again.')); return; }
        if (typeof g.accounts.oauth2.hasGrantedAllScopes === 'function' && !g.accounts.oauth2.hasGrantedAllScopes(r, SCOPE, EMAIL_SCOPE)) {
          reject(new GmailError('scope', 'A permission was not ticked. Tap Send again and allow sending email and seeing your email address.')); return;
        }
        whoIs(r.access_token).then((email) => {
          if (expected && !email) { reject(new GmailError('identity', 'I could not confirm which Google account signed in. Tap Send again.')); return; }
          if (expected && email !== expected) {
            reject(new GmailError('wrong-account', 'You signed in as ' + email + ', but Email briefing uses ' + expected + '. Tap Send and choose ' + expected + '. Nothing was sent.')); return;
          }
          tokenCache = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, email };
          resolve(r.access_token);
        });
      },
      error_callback: () => reject(new GmailError('popup', 'Google sign-in was closed or blocked. Allow pop-ups for this site and try again.')),
    });
    client.requestAccessToken({ prompt: silent ? 'none' : '' });
    if (silent) timer = setTimeout(() => reject(new GmailError('silent', 'Quiet sign-in timed out.')), SILENT_TIMEOUT_MS);
  }).finally(() => clearTimeout(timer));
}

// ── Gmail API ──────────────────────────────────────────────────────────
/**
 * POST the message. Resolves with Gmail's reply ({ id, threadId, ... }).
 * Rejects with GmailError: code 'uncertain' means the request may have reached Gmail; other codes mean it did not send.
 */
export async function sendGmailMessage(token, { to, cc, subject, text, html }, fetchImpl) {
  const raw = toBase64Url(buildMime({ to, cc, subject, text, html }));
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await doFetch(SEND_URL, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }), signal: ctl.signal,
    });
  } catch (_) {
    throw new GmailError('uncertain', 'The connection dropped, so I can\u2019t tell whether it was sent. Check Gmail › Sent before sending again.');
  } finally { clearTimeout(timer); }
  if (res.ok) {
    try { return await res.json(); } catch (_) { throw new GmailError('uncertain', 'Gmail answered, but I could not read the reply. Check Gmail › Sent before sending again.'); }
  }
  let detail = '';
  try { const j = await res.json(); detail = (j && j.error && (j.error.message || j.error.status)) || ''; } catch (_) { /* no body */ }
  if (res.status === 401) { clearGmailToken(); throw new GmailError('auth', 'Google sign-in expired. Tap Send again.'); }
  if (res.status === 403) {
    clearGmailToken();
    throw new GmailError('forbidden', 'Google blocked sending. The consent screen needs the gmail.send permission, and a Workspace admin may need to allow this app.' + (detail ? ' (' + detail + ')' : ''));
  }
  if (res.status === 400) throw new GmailError('rejected', 'Gmail rejected the message' + (detail ? ': ' + detail : '.'));
  if (res.status === 429) throw new GmailError('rate', 'Gmail says too many requests. Wait a minute, then send again. Nothing was sent.');
  throw new GmailError('uncertain', 'Gmail had a problem (' + res.status + '), so I can\u2019t tell whether it was sent. Check Gmail › Sent before sending again.');
}

// ── dialog ─────────────────────────────────────────────────────────────
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === 'text') e.textContent = v; else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const k of kids) if (k) e.append(k);
  return e;
}
const toast = (m, t) => { if (typeof window.toast === 'function') window.toast(m, t); };
const fmtWhen = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

/**
 * Open the Send via Gmail dialog.
 * opts: { kind: 'checklist' | 'salereport', subject, html, text, dateKey }
 *   html = the report fragment exactly as Copy builds it; text = its plain-text twin.
 */
export function openGmailSend(opts) {
  const { kind, subject, html, text, dateKey } = opts || {};
  const old = document.getElementById('gms-overlay'); if (old) old.remove();
  const lists = loadSendLists();
  const mine = lists[kind] || { to: [], cc: [] };
  const prevSent = readSent()[kind + ':' + dateKey];

  const fSubject = h('input', { type: 'text', id: 'gms-subject', maxlength: '200', autocomplete: 'off' }); fSubject.value = subject || '';
  const fTo = h('textarea', { id: 'gms-to', rows: '2', placeholder: 'name@domain.com, name2@domain.com', autocapitalize: 'off', spellcheck: 'false' }); fTo.value = mine.to.join(', ');
  const fCc = h('textarea', { id: 'gms-cc', rows: '2', placeholder: 'optional', autocapitalize: 'off', spellcheck: 'false' }); fCc.value = mine.cc.join(', ');
  const fSig = h('textarea', { id: 'gms-sig', rows: '4', placeholder: 'Optional. For example your name, role and phone number.' }); fSig.value = lists.signature;
  const status = h('div', { class: 'gms-status', role: 'status', 'aria-live': 'polite' });
  const warn = prevSent ? h('div', { class: 'gms-warn', text: 'This report was already sent from this phone at ' + fmtWhen(prevSent.at) + '. Sending again emails everyone again.' }) : null;
  const btnSend = h('button', { type: 'button', class: 'btn btn-p', text: 'Send now' });
  const btnCancel = h('button', { type: 'button', class: 'btn btn-s', text: 'Cancel' });
  const btnX = h('button', { type: 'button', class: 'mclose', 'aria-label': 'Close', text: '\u2715' });
  const field = (label, ctl, hint) => h('label', { class: 'gms-f', for: ctl.id }, h('span', { text: label }), ctl, hint ? h('small', { text: hint }) : null);

  const modal = h('div', { class: 'modal gms-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send via Gmail' },
    h('div', { class: 'mhdr' }, h('h2', { text: 'Send via Gmail' }), btnX),
    h('div', { class: 'mbody' },
      warn,
      field('Subject', fSubject),
      field('To', fTo, 'Separate addresses with commas.'),
      field('Cc', fCc),
      field('Signature', fSig, 'Added under the report. Mail sent this way does not get your Gmail signature.'),
      h('p', { class: 'gms-acct', text: expectedAccount()
        ? 'Sends from ' + expectedAccount() + ' (your Email briefing account).'
        : 'Connect Email briefing first (Utility \u203A Mail). Send uses that same Google account.' }),
      h('p', { class: 'gms-note', text: 'Sent from your own Gmail with the same formatting as Copy and paste. To, Cc and the signature are saved and synced.' }),
      status),
    h('div', { class: 'gms-foot' }, btnCancel, btnSend));
  const overlay = h('div', { class: 'mbg on', id: 'gms-overlay' }, modal);

  let busy = false, needsConfirm = !!prevSent, armed = false, uncertain = false;
  const controls = [fSubject, fTo, fCc, fSig, btnSend, btnCancel, btnX];
  const lock = (on) => { busy = on; controls.forEach((c) => { c.disabled = on; }); };
  const say = (msg, bad) => { status.textContent = msg || ''; status.classList.toggle('gms-err', !!bad); };
  const close = () => { if (busy) return; overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  function send() {
    if (busy) return;
    if (!expectedAccount()) { say('Send uses the same Google account as Email briefing. Open Utility \u203A Mail, connect, and tap the brief button once. Nothing was sent.', true); return; }
    const to = parseAddresses(fTo.value), cc = parseAddresses(fCc.value);
    const bad = [...to.invalid, ...cc.invalid];
    if (bad.length) { say('Not a valid email address: ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? ' \u2026' : ''), true); return; }
    if (!to.valid.length) { say('Add at least one To address.', true); return; }
    if (to.valid.length > MAX_RECIPIENTS || cc.valid.length > MAX_RECIPIENTS) { say('Too many recipients (limit ' + MAX_RECIPIENTS + ' in each box).', true); return; }
    const ccOnly = cc.valid.filter((a) => !to.valid.some((t) => t.toLowerCase() === a.toLowerCase()));
    const subj = fSubject.value.replace(/[\r\n]+/g, ' ').trim();
    if (!subj) { say('Add a subject.', true); return; }
    // A repeat send needs a second, separate tap. (Not confirm(): a native box first can make the browser block Google's pop-up.)
    if (needsConfirm && !armed) {
      armed = true; btnSend.textContent = 'Yes, send again';
      say(uncertain ? 'The last try may already have gone through. Check Gmail \u203A Sent first, then tap again to send anyway.'
        : 'This report was already sent at ' + fmtWhen(prevSent.at) + '. Tap again to send it again.', true);
      return;
    }

    // 1) Save the lists (also syncs). 2) Ask Google for a token straight away, still inside the tap.
    const nextLists = withKindLists(loadSendLists(), kind, to.valid, ccOnly, fSig.value, new Date().toISOString());
    try { saveSendLists(nextLists); } catch (_) { /* a storage hiccup must not stop the send */ }
    lock(true); say('Signing in to Google\u2026');
    const tokenP = requestToken();
    const bodies = composeBodies({ html, text, signature: nextLists.signature });

    tokenP
      .then((token) => { say('Sending\u2026'); return sendGmailMessage(token, { to: to.valid, cc: ccOnly, subject: subj, text: bodies.text, html: bodies.html }); })
      .then((r) => {
        try { recordSent(kind, dateKey, r && r.id); } catch (_) { /* local log only */ }
        busy = false; overlay.remove(); document.removeEventListener('keydown', onKey);
        const n = to.valid.length + ccOnly.length, from = tokenCache && tokenCache.email;
        toast('\u2713 Sent via Gmail' + (from ? ' from ' + from : '') + ' to ' + n + ' recipient' + (n === 1 ? '' : 's'));
      })
      .catch((e) => {
        uncertain = !!(e && e.code === 'uncertain');
        if (uncertain) { needsConfirm = true; armed = false; btnSend.textContent = 'Send again anyway'; }
        lock(false);
        say((e && e.message) || 'Could not send.', true);
      });
  }

  btnSend.addEventListener('click', send);
  btnCancel.addEventListener('click', close);
  btnX.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  if (expectedAccount()) requestToken({ silent: true }).catch(() => { /* fine: Google will ask on Send instead */ });   // so Send usually needs no pop-up
  (mine.to.length ? btnSend : fTo).focus();
}
