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
  const settle = () => new Promise((r) => setTimeout(r, 25));
  const sendBtn = () => [...document.querySelectorAll('#gms-overlay .gms-foot button')].find((b) => /send|again/i.test(b.textContent));
  const status = () => document.querySelector('.gms-status').textContent;
  const opts = { kind: 'checklist', subject: 'Daily Check List \u2014 Bahria Town \u2014 2026-10-25', html: '<div>R</div>', text: 'R', dateKey: '2026-10-25' };
  let posts, tokenRequests, prompts, lastCfg, fetchImpl, accountOf, toasts;

  function mockGoogle({ granted = true, silentFails = false } = {}) {
    tokenRequests = 0; prompts = [];
    window.google = { accounts: { oauth2: {
      initTokenClient: (cfg) => {
        lastCfg = cfg;
        return { requestAccessToken: (o) => {
          tokenRequests++; prompts.push(o && o.prompt);
          setTimeout(() => cfg.callback(o && o.prompt === 'none' && silentFails ? { error: 'interaction_required' } : { access_token: 'tok', expires_in: 3600 }), 0);
        } };
      },
      hasGrantedAllScopes: (r, ...scopes) => granted && scopes.length === 2,
    } } };
  }
  const openAndSettle = async (o = opts) => { openGmailSend(o); await settle(); };
  const fillAndSend = async (to = 'a@x.com') => { $('gms-to').value = to; click(sendBtn()); await settle(); };

  beforeEach(() => {
    clearGmailToken();
    resetStorage();
    document.body.innerHTML = '';
    window.localStorage.setItem('bt_mail_cid', '123-abc.apps.googleusercontent.com');
    posts = []; toasts = []; accountOf = 'me@x.com';
    window.toast = (m) => toasts.push(m);
    fetchImpl = async (url, init) => {
      if (/userinfo/.test(url)) return reply(200, { email: accountOf })();
      posts.push(JSON.parse(init.body)); return reply(200, { id: 'gm-1' })();
    };
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

  test('says which account it sends from: the Email briefing account when known', () => {
    openGmailSend(opts);
    assert.match(document.querySelector('.gms-acct').textContent, /Google account you choose/);
    document.body.innerHTML = '';
    window.localStorage.setItem('bt_mail_email', 'Bahria.Cat@fdpp.pk');
    openGmailSend(opts);
    assert.match(document.querySelector('.gms-acct').textContent, /Sends from bahria\.cat@fdpp\.pk \(your Email briefing account\)/);
  });

  test('asks Google for send + email-address permission, hinting the briefing account', async () => {
    window.localStorage.setItem('bt_mail_email', 'bahria.cat@fdpp.pk');
    await openAndSettle();
    assert.match(lastCfg.scope, /gmail\.send/);
    assert.match(lastCfg.scope, /userinfo\.email/);
    assert.equal(lastCfg.hint, 'bahria.cat@fdpp.pk');
    assert.equal(lastCfg.login_hint, 'bahria.cat@fdpp.pk');
  });

  test('asks Google quietly when the dialog opens, so Send needs no pop-up', async () => {
    await openAndSettle();
    assert.deepEqual(prompts, ['none']);
    await fillAndSend();
    assert.deepEqual(prompts, ['none'], 'Send reuses the quiet token');
    assert.equal(posts.length, 1);
  });

  test('if the quiet request fails, Send asks with a normal prompt and nothing is shown at open', async () => {
    mockGoogle({ silentFails: true });
    await openAndSettle();
    assert.equal(status(), '');
    await fillAndSend();
    assert.deepEqual(prompts, ['none', '']);
    assert.equal(posts.length, 1);
  });

  test('refuses an invalid or empty To without any pop-up or Gmail call', async () => {
    await openAndSettle();
    click(sendBtn());
    assert.match(status(), /at least one To/);
    $('gms-to').value = 'ok@x.com, nope';
    click(sendBtn());
    assert.match(status(), /Not a valid email address: nope/);
    assert.deepEqual(prompts, ['none'], 'only the quiet request, never a pop-up');
    assert.equal(posts.length, 0);
  });

  test('a good send saves the lists, calls Gmail once, records it, names the account and closes', async () => {
    await openAndSettle();
    $('gms-cc').value = 'c@x.com, a@x.com';          // a@x.com is already in To, so it is dropped from Cc
    $('gms-sig').value = 'Salman';
    await fillAndSend('a@x.com, b@x.com');
    assert.equal(posts.length, 1);
    const mime = decodeRaw(posts[0].raw);
    assert.match(mime, /^To: a@x\.com,\r\n b@x\.com\r\n/m);
    assert.match(mime, /^Cc: c@x\.com\r\n/m);
    assert.equal($('gms-overlay'), null, 'dialog closes after a successful send');
    const saved = loadSendLists();
    assert.deepEqual(saved.checklist, { to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'] });
    assert.equal(saved.signature, 'Salman');
    assert.ok(saved.updatedAt);
    assert.equal(JSON.parse(window.localStorage.getItem('bt_mail_sent_v1'))['checklist:2026-10-25'].id, 'gm-1');
    assert.match(toasts.join(' '), /Sent via Gmail from me@x\.com to 3 recipients/);
  });

  test('sends from the Email briefing account, ignoring letter case', async () => {
    window.localStorage.setItem('bt_mail_email', 'bahria.cat@fdpp.pk');
    accountOf = 'Bahria.Cat@fdpp.pk';
    await openAndSettle();
    await fillAndSend();
    assert.equal(posts.length, 1);
  });

  test('refuses to send when a different Google account signed in', async () => {
    window.localStorage.setItem('bt_mail_email', 'bahria.cat@fdpp.pk');
    accountOf = 'other@gmail.com';
    await openAndSettle();
    await fillAndSend();
    assert.match(status(), /signed in as other@gmail\.com, but Email briefing uses bahria\.cat@fdpp\.pk/);
    assert.match(status(), /Nothing was sent/);
    assert.equal(posts.length, 0);
    assert.ok($('gms-overlay'), 'dialog stays open');
    assert.equal(window.localStorage.getItem('bt_mail_sent_v1'), null);
    accountOf = 'bahria.cat@fdpp.pk';          // choosing the right account on the next try works
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 1);
  });

  test('refuses when the briefing account is known but the signed-in account cannot be confirmed', async () => {
    window.localStorage.setItem('bt_mail_email', 'bahria.cat@fdpp.pk');
    fetchImpl = async (url, init) => (/userinfo/.test(url) ? reply(500, {})() : (posts.push(JSON.parse(init.body)), reply(200, { id: 'x' })()));
    await openAndSettle();
    await fillAndSend();
    assert.match(status(), /could not confirm which Google account/);
    assert.equal(posts.length, 0);
  });

  test('sending the same report again needs a second tap', async () => {
    window.localStorage.setItem('bt_mail_sent_v1', JSON.stringify({ 'checklist:2026-10-25': { at: new Date().toISOString(), id: 'old' } }));
    await openAndSettle();
    assert.ok(document.querySelector('.gms-warn'), 'shows the already-sent warning');
    await fillAndSend();
    assert.equal(posts.length, 0, 'first tap only arms the button');
    assert.match(status(), /Tap again/);
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 1);
  });

  test('an uncertain failure keeps the dialog open and asks before a repeat send', async () => {
    fetchImpl = async (url) => { if (/userinfo/.test(url)) return reply(200, { email: 'me@x.com' })(); throw new TypeError('offline'); };
    await openAndSettle();
    await fillAndSend();
    assert.ok($('gms-overlay'), 'stays open');
    assert.match(status(), /Check Gmail/);
    assert.equal(window.localStorage.getItem('bt_mail_sent_v1'), null, 'not recorded as sent');
    fetchImpl = async (url, init) => { if (/userinfo/.test(url)) return reply(200, { email: 'me@x.com' })(); posts.push(JSON.parse(init.body)); return reply(200, { id: 'gm-2' })(); };
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 0, 'asks first');
    click(sendBtn());
    await settle();
    assert.equal(posts.length, 1);
  });

  test('missing Google client ID gives a clear message and sends nothing', async () => {
    window.localStorage.removeItem('bt_mail_cid');
    await openAndSettle();
    await fillAndSend();
    assert.match(status(), /Connect Gmail once in Utility/);
    assert.equal(posts.length, 0);
    assert.equal(sendBtn().disabled, false, 'controls are usable again');
  });

  test('a permission left unticked on the consent screen is reported', async () => {
    mockGoogle({ granted: false });
    await openAndSettle();
    await fillAndSend();
    assert.match(status(), /not ticked/);
    assert.equal(posts.length, 0);
  });

  test('typed text is only ever inserted as text, never as HTML', () => {
    openGmailSend({ ...opts, subject: '<img src=x onerror=alert(1)>' });
    assert.equal(document.querySelectorAll('#gms-overlay img').length, 0);
    assert.equal($('gms-subject').value, '<img src=x onerror=alert(1)>');
  });
});
