// GMAIL SEND — API call classification and the dialog flow (js/lib/gmail-send.js)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv();
await import('../../js/platform/config.js');
await import('../../js/platform/repository.js');
await import('../../js/platform/actions.js');
const { sendGmailMessage, GmailError, openGmailSend, loadSendLists, clearGmailToken } = await import('../../js/lib/gmail-send.js');
const { SEND_LISTS_KEY } = await import('../../js/shared/mail-compose.js');

const msg = { to: ['a@x.com'], cc: ['c@x.com'], subject: 'Sale Report \u2014 25/Oct/2026', text: 'plain', html: '<table><tr><td>\u20a8 1</td></tr></table>' };
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const failWith = async (fn, code) => { await assert.rejects(fn, (e) => { assert.ok(e instanceof GmailError); assert.equal(e.code, code, e.message); return true; }); };

function decodeRaw(rawB64Url) {
  const std = rawB64Url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(std + '='.repeat((4 - (std.length % 4)) % 4), 'base64').toString('utf8');
}

describe('sendGmailMessage', () => {
  test('POSTs the message with the bearer token and returns Gmail\u2019s reply', async () => {
    let seen;
    const out = await sendGmailMessage('tok123', msg, async (url, init) => { seen = { url, init }; return reply(200, { id: 'm1', threadId: 't1' })(); });
    assert.deepEqual(out, { id: 'm1', threadId: 't1' });
    assert.equal(seen.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer tok123');
    const mime = decodeRaw(JSON.parse(seen.init.body).raw);
    assert.match(mime, /^To: a@x\.com\r\n/m);
    assert.match(mime, /^Cc: c@x\.com\r\n/m);
    assert.match(mime, /multipart\/alternative/);
  });
  test('401 means sign in again, nothing sent', async () => { await failWith(() => sendGmailMessage('t', msg, reply(401, {})), 'auth'); });
  test('403 mentions the consent screen / admin and includes Google\u2019s detail', async () => {
    await assert.rejects(() => sendGmailMessage('t', msg, reply(403, { error: { message: 'Insufficient Permission' } })), (e) => {
      assert.equal(e.code, 'forbidden'); assert.match(e.message, /gmail\.send/); assert.match(e.message, /Insufficient Permission/); return true;
    });
  });
  test('400 is a definite rejection, 429 a definite "not sent"', async () => {
    await failWith(() => sendGmailMessage('t', msg, reply(400, { error: { message: 'Invalid To header' } })), 'rejected');
    await failWith(() => sendGmailMessage('t', msg, reply(429, {})), 'rate');
  });
  test('5xx, a dropped connection and an unreadable reply are all "uncertain" (it may have been sent)', async () => {
    await failWith(() => sendGmailMessage('t', msg, reply(503, {})), 'uncertain');
    await failWith(() => sendGmailMessage('t', msg, async () => { throw new TypeError('network'); }), 'uncertain');
    await failWith(() => sendGmailMessage('t', msg, reply(200, undefined)), 'uncertain');
  });
  test('a bad address is refused before any request is made', async () => {
    let called = false;
    await assert.rejects(() => sendGmailMessage('t', { ...msg, to: ['bad'] }, async () => { called = true; return reply(200, {})(); }), /valid email/);
    assert.equal(called, false);
  });
});

describe('Send via Gmail dialog', () => {
  const $ = (id) => document.getElementById(id);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const sendBtn = () => [...document.querySelectorAll('#gms-overlay .gms-foot button')].find((b) => /send|again/i.test(b.textContent));
  const opts = { kind: 'checklist', subject: 'Daily Check List \u2014 Bahria Town \u2014 2026-10-25', html: '<div>R</div>', text: 'R', dateKey: '2026-10-25' };
  let posts, tokenRequests, fetchImpl;

  function mockGoogle({ granted = true } = {}) {
    tokenRequests = 0;
    window.google = { accounts: { oauth2: {
      initTokenClient: (cfg) => ({ requestAccessToken: () => { tokenRequests++; setTimeout(() => cfg.callback({ access_token: 'tok', expires_in: 3600 }), 0); } }),
      hasGrantedAllScopes: () => granted,
    } } };
  }
  beforeEach(() => {
    clearGmailToken();
    resetStorage();
    document.body.innerHTML = '';
    window.localStorage.setItem('bt_mail_cid', '123-abc.apps.googleusercontent.com');
    posts = [];
    fetchImpl = async (url, init) => { posts.push(JSON.parse(init.body)); return reply(200, { id: 'gm-1' })(); };
    globalThis.fetch = (url, init) => fetchImpl(url, init);
    mockGoogle();
  });

  test('opens pre-filled from the saved lists of that report only', async () => {
    window.localStorage.setItem(SEND_LISTS_KEY, JSON.stringify({
      checklist: { to: ['boss@x.com'], cc: ['cc@x.com'] }, salereport: { to: ['other@x.com'], cc: [] }, signature: 'Sal', updatedAt: '2026-10-01T00:00:00.000Z' }));
    openGmailSend(opts);
    assert.equal($('gms-to').value, 'boss@x.com');
    assert.equal($('gms-cc').value, 'cc@x.com');
    assert.equal($('gms-sig').value, 'Sal');
    assert.equal($('gms-subject').value, opts.subject);
  });

  test('refuses an invalid or empty To without contacting Google or Gmail', async () => {
    openGmailSend(opts);
    click(sendBtn());
    assert.match(document.querySelector('.gms-status').textContent, /at least one To/);
    $('gms-to').value = 'ok@x.com, nope';
    click(sendBtn());
    assert.match(document.querySelector('.gms-status').textContent, /Not a valid email address: nope/);
    assert.equal(tokenRequests, 0);
    assert.equal(posts.length, 0);
  });

  test('a good send saves the lists, calls Gmail once, records it and closes', async () => {
    openGmailSend(opts);
    $('gms-to').value = 'a@x.com, b@x.com';
    $('gms-cc').value = 'c@x.com, a@x.com';          // a@x.com is already in To, so it is dropped from Cc
    $('gms-sig').value = 'Salman';
    click(sendBtn());
    await settle();
    assert.equal(tokenRequests, 1);
    assert.equal(posts.length, 1);
    const mime = decodeRaw(posts[0].raw);
    assert.match(mime, /^To: a@x\.com,\r\n b@x\.com\r\n/m);
    assert.match(mime, /^Cc: c@x\.com\r\n/m);
    assert.equal($('gms-overlay'), null, 'dialog closes after a successful send');
    const saved = loadSendLists();
    assert.deepEqual(saved.checklist, { to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'] });
    assert.equal(saved.signature, 'Salman');
    assert.ok(saved.updatedAt);
    assert.ok(JSON.parse(window.localStorage.getItem('bt_mail_sent_v1'))['checklist:2026-10-25'].id === 'gm-1');
  });

  test('sending the same report again needs a second tap', async () => {
    window.localStorage.setItem('bt_mail_sent_v1', JSON.stringify({ 'checklist:2026-10-25': { at: new Date().toISOString(), id: 'old' } }));
    openGmailSend(opts);
    assert.ok(document.querySelector('.gms-warn'), 'shows the already-sent warning');
    $('gms-to').value = 'a@x.com';
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 0, 'first tap only arms the button');
    assert.match(document.querySelector('.gms-status').textContent, /Tap again/);
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 1);
  });

  test('an uncertain failure keeps the dialog open and asks before a repeat send', async () => {
    fetchImpl = async () => { throw new TypeError('offline'); };
    openGmailSend(opts);
    $('gms-to').value = 'a@x.com';
    click(sendBtn());
    await settle();
    assert.ok($('gms-overlay'), 'stays open');
    assert.match(document.querySelector('.gms-status').textContent, /Check Gmail/);
    assert.equal(window.localStorage.getItem('bt_mail_sent_v1'), null, 'not recorded as sent');
    posts = [];
    fetchImpl = async (url, init) => { posts.push(JSON.parse(init.body)); return reply(200, { id: 'gm-2' })(); };
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 0, 'asks first');
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 1);
  });

  test('missing Google client ID or sign-in script gives a clear message and sends nothing', async () => {
    window.localStorage.removeItem('bt_mail_cid');
    openGmailSend(opts);
    $('gms-to').value = 'a@x.com';
    click(sendBtn());
    await settle();
    assert.match(document.querySelector('.gms-status').textContent, /Connect Gmail once in Utility/);
    assert.equal(posts.length, 0);
    assert.equal(sendBtn().disabled, false, 'controls are usable again');
  });

  test('refusing the send permission on the consent screen is reported', async () => {
    mockGoogle({ granted: false });
    openGmailSend(opts);
    $('gms-to').value = 'a@x.com';
    click(sendBtn());
    await settle();
    assert.match(document.querySelector('.gms-status').textContent, /permission to send email was not ticked/);
    assert.equal(posts.length, 0);
  });

  test('typed text is only ever inserted as text, never as HTML', () => {
    openGmailSend({ ...opts, subject: '<img src=x onerror=alert(1)>' });
    assert.equal(document.querySelectorAll('#gms-overlay img').length, 0);
    assert.equal($('gms-subject').value, '<img src=x onerror=alert(1)>');
  });
});
