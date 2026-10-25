// Mail briefing layout: chips, collapsed routine, merged related threads, swipe-free "Done" path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
document.body.innerHTML = '<div id="mail-root"></div>';
const { Repository } = await import('../../js/repository.js');
const { MailBriefing } = await import('../../js/mail/mail-briefing.js');

const hdrs = (from, subject) => [{ name: 'From', value: from }, { name: 'To', value: 'me@x.com' }, { name: 'Cc', value: '' }, { name: 'Subject', value: subject }];
const thread = (id, from, subject, snippet, t) => ({ id, messages: [{ id, internalDate: String(t), snippet, labelIds: ['UNREAD', 'INBOX'], payload: { headers: hdrs(from, subject) } }] });
const now = Date.now();
const T = {
  a1: thread('a1', 'Nadeem <sales1@fazaldins.org>', 'Bio Metric Machine Status', 'Kindly note the fine Rs.1000', now - 1000),
  h1: thread('h1', 'Shumair <hrm@fazaldins.org>', 'Job Timing (Corrected)', 'Kindly note the Pharmacy Manager job timings', now - 2000),
  h2: thread('h2', 'Shumair <hrm@fazaldins.org>', 'Job Timing Issues', 'Kindly note the Pharmacy Manager job timings', now - 3000),
  r1: thread('r1', 'Branch <x@fdpp.pk>', 'Pending STR report', 'FYI', now - 4000),
};

test('renders chips, merges related threads, collapses routine, Done hides', async () => {
  Repository.setItem('bt_mail_cid', 'x.apps.googleusercontent.com');
  Repository.setItem('bt_mail_email', 'me@x.com');
  globalThis.google = window.google = { accounts: { oauth2: { initTokenClient: (c) => ({ requestAccessToken: () => c.callback({ access_token: 'tok' }) }), revoke() {} } } };
  globalThis.fetch = async (url) => {
    const u = String(url);
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.endsWith('/profile')) return ok({ emailAddress: 'me@x.com' });
    if (u.includes('/threads?')) return ok({ threads: Object.keys(T).map((id) => ({ id })) });
    const m = /threads\/(\w+)/.exec(u); if (m && T[m[1]]) return ok(T[m[1]]);
    return ok({});
  };
  MailBriefing.onShow();
  document.getElementById('mail-go').click();
  for (let i = 0; i < 50 && !document.querySelector('.mail-chip'); i++) await new Promise((r) => setTimeout(r, 20));

  const chips = [...document.querySelectorAll('.mail-chip')].map((c) => c.textContent);
  assert.ok(chips.some((c) => /Action.*3/.test(c)), 'Action chip counts all 3 action threads: ' + chips.join('|'));
  const titles = [...document.querySelectorAll('.mail-t')].map((t) => t.textContent);
  assert.equal(titles.filter((t) => /Job Timing/.test(t)).length, 1, 'Job Timing threads merged into one row');
  assert.ok(document.querySelector('.mail-tag').textContent.length > 0);
  assert.ok(!titles.includes('Pending STR report'), 'routine is collapsed by default');
  assert.ok(document.querySelector('.mail-fold'), 'routine fold toggle exists');

  document.querySelector('.mail-fold').click();
  assert.ok([...document.querySelectorAll('.mail-t')].some((t) => t.textContent === 'Pending STR report'), 'routine opens on tap');

  const doneBtn = [...document.querySelectorAll('.mail-body .btn')].find((b) => b.textContent === 'Done');
  const before = document.querySelectorAll('.mail-sw').length;
  doneBtn.click();
  assert.equal(document.querySelectorAll('.mail-sw').length, before - 1, 'Done removes the row');
  assert.equal(MailBriefing.snapshot().counts.act, 3, 'assistant snapshot still sees every thread');
});
