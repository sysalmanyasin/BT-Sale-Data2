// AI brief: pages through ALL threads (archived mail too), reads the real message text, cleans and redacts it,
// tells the assistant who the reader is, chunks big mailboxes, and merges the sectioned answers.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
document.body.innerHTML = '<div id="mail-root"></div>';
const ME = 'bahria.cat@fdpp.pk';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(15); } };

// ── mocks: Google sign-in, Supabase session, Gmail REST, bt-agent ────
globalThis.google = window.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: 'tok' }) }), revoke() {} } } };
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } });
localStorage.setItem('bt_mail_cid', 'x.apps.googleusercontent.com'); localStorage.setItem('bt_mail_auto', '1'); localStorage.setItem('bt_mail_email', ME);

const NOW = Date.now();
const H = (from, subject) => [{ name: 'From', value: from }, { name: 'To', value: ME }, { name: 'Subject', value: subject }];
const metaOf = (id) => ({ id, messages: [{ id: id + 'm', internalDate: String(NOW), labelIds: ['INBOX'], snippet: 'preview', payload: { headers: H('Taimur I. Mumtaz <taimur@fdpp.pk>', 'Pending STR ' + id) } }] });
const fullOf = (id) => ({ id, messages: [
  { id: id + '1', internalDate: String(NOW - 5000), payload: { headers: H('Taimur I. Mumtaz <taimur@fdpp.pk>', 'Pending STR ' + id), mimeType: 'text/plain', body: { data: b64u('Dear all,\nSTR 917761 qty 270 Rs 18,420 not received, dated 20-10-2026. Call 0300-1234567 or mail x@y.com.\nKind regards\nTaimur') } } },
  { id: id + '3', internalDate: String(NOW - 3000), payload: { headers: H('Usman Razzaq <bahria.exp@fdpp.pk>', 'Re: Pending STR ' + id), mimeType: 'text/plain', body: { data: b64u('Please arrange the less than zero items within 2 days at Bahria Town branch.') } } },
  { id: id + '4', internalDate: String(NOW - 2000), payload: { headers: H('Dr Ammar Younis <defence.cat@fdpp.pk>', 'Re: Pending STR ' + id), mimeType: 'text/plain', body: { data: b64u('Biometric status:\nBranch      Submitted\nDefence     Yes\nModel Town    No\nBahria     Yes') } } },
  { id: id + '2', internalDate: String(NOW), payload: { headers: H('Bahria <' + ME + '>', 'Re: Pending STR ' + id), mimeType: 'text/plain', body: { data: b64u('Noted\n\nOn Tue, 20 Oct 2026 at 2:50 PM Taimur wrote:\n> QUOTED-SECRET old text') } } }] });

let calls = [], agent = [];
const respond = (reply) => { agent = reply; };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o });
  calls.push(u);
  if (u.includes('/functions/v1/bt-agent')) {
    const content = JSON.parse(init.body).messages[0].content; agent.requests.push(content);
    const r = agent.replies.shift(); if (r === 500) return json({ error: 'boom' }, 500);
    return json({ message: { content: r } });
  }
  if (/threads\?/.test(u)) { const page = agent.pages.shift() || {}; return json(page); }
  const m = /threads\/(\w+)\?format=(\w+)/.exec(u);
  if (m) return json(m[2] === 'full' ? fullOf(m[1]) : metaOf(m[1]));
  return json({});
};
const setup = (pages, replies) => { calls = []; agent = { pages, replies, requests: [] }; };
const ids = (a, b) => Array.from({ length: b - a }, (_, k) => ({ id: 't' + (a + k) }));

const { MailBriefing } = await import('../../js/mail-briefing.js');
const brief = async () => { document.getElementById('mail-ai').click(); await waitFor(() => document.querySelector('.mail-ai, .mail-err')); return document.getElementById('mail-aiout'); };

test('reads every page of threads (archived mail included) and keeps counting', async () => {
  setup([{ threads: ids(0, 2), nextPageToken: 'P2' }, { threads: ids(2, 3) }], []);
  MailBriefing.onShow();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 3);
  const listCalls = calls.filter((c) => /threads\?/.test(c));
  assert.equal(listCalls.length, 2);
  assert.ok(!decodeURIComponent(listCalls[0]).includes('in:inbox'), 'archived/labelled mail must not be excluded');
  assert.ok(listCalls[1].includes('pageToken=P2'));
});

test('brief sends cleaned full text, identity and figures; renders sections', async () => {
  respond({ pages: [], replies: ['## Needs your action\nTaimur — STR 917761 not received (Rs 18,420)\n## Stock & operations\nWarehouse — 3 STRs pending'], requests: [] });
  const out = await brief();
  const prompt = agent.requests[0];
  assert.match(prompt, /Salman Yasin/); assert.ok(prompt.includes(ME));
  assert.ok(prompt.includes('917761') && prompt.includes('Rs 18,420') && prompt.includes('20-10-2026'), 'figures and dates survive');
  assert.ok(!prompt.includes('QUOTED-SECRET'), 'quoted history is stripped');
  assert.ok(!prompt.includes('0300-1234567') && !prompt.includes('x@y.com'), 'contact details are redacted');
  assert.match(prompt, /short replies: you \(Salman, Bahria Town\): Noted/);
  // senders are tagged so the AI can tell your branch from other branches
  assert.ok(prompt.includes('[your branch: Mian Usman Razzaq, Co-Branch Manager]'), 'own-branch mailbox tagged');
  assert.ok(prompt.includes('Dr Ammar Younis [other branch]'), 'other branch tagged');
  // table rows stay on their own lines with column separators (no merged cells)
  assert.match(prompt, /Defence \| Yes\n\s+Model Town \| No\n\s+Bahria \| Yes/);
  // accuracy rules and roles are in the prompt
  assert.ok(prompt.includes('never call money "units"') && prompt.includes('Sales Manager (sales1@)') && prompt.includes('9 AM-5 PM and 4 PM-12 AM'));
  const heads = [...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent);
  assert.deepEqual(heads, ['Needs your action · 1', 'Stock & operations · 1']);
  assert.match(out.querySelector('.mail-foot').textContent, /Briefed 3 of 3 threads/);
});

test('big mailboxes are chunked and the sectioned answers are merged', async () => {
  setup([{ threads: ids(0, 30) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 30);
  agent.replies = ['## Needs your action\nA — first', '## Needs your action\nB — second\n## Insurance\nC — third'];
  const out = await brief();
  assert.equal(agent.requests.length, 2);
  assert.match(agent.requests[1], /part 2 of 2/);
  assert.deepEqual([...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent), ['Needs your action · 2', 'Insurance · 1']);
});

test('one failed chunk still shows the rest and says so', async () => {
  setup([{ threads: ids(0, 30) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 30);
  agent.replies = ['## Other\nOnly — part one', 500];
  const out = await brief();
  assert.match(out.querySelector('.mail-foot').textContent, /1 of 2 parts failed/);
  assert.equal(out.querySelectorAll('.mail-ai-l').length, 1);
});

test('an expired app login is caught before any email is downloaded, with a clear message', async () => {
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  const good = window.btGetSupabaseClient;
  window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: null }, error: null }) } });
  calls = [];
  const out = await brief();
  window.btGetSupabaseClient = good;
  assert.match(out.querySelector('.mail-err').textContent, /app login has expired.*Sign Out.*sign in with Google again/);
  assert.equal(calls.filter((c) => /format=full/.test(c)).length, 0, 'no full emails downloaded');
  assert.equal(agent.requests.length, 0, 'no AI request sent');
});
