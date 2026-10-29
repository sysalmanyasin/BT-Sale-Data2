// One Google account for Email briefing AND Send via Gmail: the briefing saves the account on first connect,
// refuses a different account afterwards, and Disconnect forgets it so a new account can be chosen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
document.body.innerHTML = '<div id="mail-root"></div>';
localStorage.setItem('bt_mail_cid', 'x.apps.googleusercontent.com');
localStorage.setItem('bt_mail_email', 'bahria.cat@fdpp.pk');
const { MailBriefing } = await import('../../js/mail/mail-briefing.js');

let profile = 'other@gmail.com', calls = [], revoked = 0, n = 0;
globalThis.google = window.google = { accounts: { oauth2: {
  initTokenClient: (c) => ({ requestAccessToken: () => c.callback({ access_token: 'tok' + (++n) }) }),
  revoke() { revoked++; },
} } };
globalThis.fetch = async (url) => {
  const u = String(url), ok = (o) => ({ ok: true, status: 200, json: async () => o });
  calls.push(u);
  if (u.endsWith('/profile')) return ok({ emailAddress: profile });
  if (u.includes('/threads?')) return ok({ threads: [] });
  return ok({});
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn) => { for (let i = 0; i < 150; i++) { if (fn()) return; await sleep(20); } throw new Error('timeout'); };
const go = () => document.getElementById('mail-go');
const idle = () => waitFor(() => !go().disabled);
const saved = () => localStorage.getItem('bt_mail_email');

test('refuses a different account, accepts the saved one, forgets it on Disconnect, then takes a new one', async () => {
  MailBriefing.onShow();

  // 1) a different Google account signs in: refused, access revoked, saved account untouched, no mail read
  go().click();
  await waitFor(() => /Tap Disconnect, then connect again/.test(document.getElementById('mail-st').textContent));
  await idle();
  assert.match(document.getElementById('mail-st').textContent, /That is other@gmail\.com, but Email briefing and Send via Gmail use bahria\.cat@fdpp\.pk/);
  assert.equal(revoked, 1);
  assert.equal(saved(), 'bahria.cat@fdpp.pk');
  assert.ok(!calls.some((u) => u.includes('/threads?')), 'no mail was read with the wrong account');

  // 2) the saved account (any letter case) works
  profile = 'Bahria.Cat@fdpp.pk';
  go().click();
  await waitFor(() => calls.some((u) => u.includes('/threads?')));
  await idle();
  assert.equal(saved(), 'bahria.cat@fdpp.pk');

  // 3) Disconnect forgets the saved account
  document.getElementById('mail-out').click();
  assert.equal(saved(), null);

  // 4) now a different account can be chosen, and becomes the one account for briefing and send
  profile = 'Other@Gmail.com';
  go().click();
  await waitFor(() => saved() === 'other@gmail.com');
  await idle();
});
