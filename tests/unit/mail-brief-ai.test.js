// AI brief: pages through ALL threads (archived mail too), reads the real message text, cleans and redacts it,
// tells the assistant who the reader is, chunks big mailboxes, and merges the sectioned answers.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
import { retry } from '../../js/agent/core/server.js';
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
const SUBJ = {}, WHEN = {}, SENDER = {}, BODY = {}, SNIP = {};
const metaOf = (id) => ({ id, messages: [{ id: id + 'm', internalDate: String(WHEN[id] || NOW), labelIds: ['INBOX'], snippet: SNIP[id] || 'preview', payload: { headers: H(SENDER[id] || 'Taimur I. Mumtaz <taimur@fdpp.pk>', SUBJ[id] || ('Pending STR ' + id)) } }] });
const resetMocks = () => [SUBJ, WHEN, SENDER, BODY, SNIP].forEach((o) => Object.keys(o).forEach((k) => delete o[k]));
const TABLE_HTML = '<div>Hello</div><table><tr><td colspan="9">Over 60 Days Dead and 60 Days Excess report</td></tr><tr><td colspan="9">20 October, 2026</td></tr>'
  + '<tr><td rowspan="2">Branch</td><td colspan="8">Stock not ever sold and 60 days dead stock</td></tr>'
  + '<tr><td> Not Ever\r\n Sold 60 Days </td><td>Percentage Notever</td><td> 60 Days Dead </td><td>Percentage Dead</td><td>90 Days Excess</td><td>Percentage Excess</td><td>Stock Position</td><td>Number of days stock</td></tr>'
  + '<tr><td>Awaisia</td><td>243,072</td><td>1.04%</td><td>1,136,973</td><td>4.87%</td><td>530,622</td><td>2.27%</td><td>23,370,445</td><td>48</td></tr>'
  + '<tr><td>Bahria town</td><td>814,325</td><td>3.48%</td><td>1,251,358</td><td>5.36%</td><td>593,580</td><td>2.54%</td><td>23,367,141</td><td>41</td></tr>'
  + '<tr><td>Defence-1</td><td>944,525</td><td>2.99%</td><td>1,810,703</td><td>5.74%</td><td>1,051,545</td><td>3.33%</td><td>31,554,008</td><td>54</td></tr>'
  + '<tr><td>Mainmarket</td><td>811,000</td><td>1.55%</td><td>1,434,719</td><td>2.75%</td><td>1,055,993</td><td>2.02%</td><td>52,195,090</td><td>33</td></tr>'
  + '<tr><td>Ait</td><td>578,994</td><td>2.33%</td><td>1,254,410</td><td>5.04%</td><td>917,217</td><td>3.69%</td><td>24,881,643</td><td>43</td></tr></table>'
  + '<div class="gmail_quote">QUOTED-TABLE-SECRET</div>';
const tableThread = (id) => ({ id, messages: [{ id: id + '1', internalDate: String(NOW), payload: { headers: H('Sarfraz Rathore <purchase3@fazaldins.org>', 'Over 60 Days Dead and 60 Days Excess report'), mimeType: 'multipart/alternative', parts: [
  { mimeType: 'text/plain', body: { data: b64u('Branch Stock 814,325 3.48% 1,251,358\n5.36% 593,580 flattened garbage') } },
  { mimeType: 'text/html', body: { data: b64u(TABLE_HTML) } }] } }] });
const fullOf = (id) => id === 'tbl' ? tableThread(id) : BODY[id] ? ({ id, messages: [{ id: id + '1', internalDate: String(WHEN[id] || NOW), payload: { headers: H(SENDER[id] || 'Info@agico.com.pk', SUBJ[id] || id), mimeType: 'text/plain', body: { data: b64u(BODY[id]) } } }] }) : ({ id, messages: [
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
    const r = agent.replies.shift(); if (r === 500 || r === 503) return json({ error: r === 503 ? 'AI providers are busy.' : 'boom' }, r);
    return json({ message: { content: r } });
  }
  if (/threads\?/.test(u)) { const page = agent.pages.shift() || {}; return json(page); }
  const m = /threads\/(\w+)\?format=(\w+)/.exec(u);
  if (m) return json(m[2] === 'full' ? fullOf(m[1]) : metaOf(m[1]));
  return json({});
};
const setup = (pages, replies) => { calls = []; agent = { pages, replies, requests: [] }; };
const refs = (a, b) => '{' + Array.from({ length: b - a + 1 }, (_, k) => 'T' + (a + k)).join(',') + '}';
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
  respond({ pages: [], replies: ['## Needs your action\nTaimur — STR 917761 not received (Rs 18,420) {T1,T2}\n## Stock & operations\nWarehouse — 3 STRs pending {T3}'], requests: [] });
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
  // thread ids are not dates: each thread has an explicit date, ids are T-numbers, and no bare [n] index is sent
  assert.match(prompt, /T1 \| (?:LOOKS LIKE ACTION|YOU WROTE LAST[^|]*|ROUTINE) \| last message \d{1,2} \w{3} 2026/);
  assert.ok(!/^\[\d+\] /m.test(prompt));
  assert.match(prompt, /Bahria Town already replied: yes \| suggested heading: Stock & operations/);
  assert.match(prompt, /first \(Taimur I\. Mumtaz, \d{1,2} \w{3} 2026/);
  assert.ok(!/\{T\d/.test(out.textContent), 'thread ids are removed from the displayed lines');
});

test('big mailboxes are chunked and the sectioned answers are merged', async () => {
  setup([{ threads: ids(0, 30) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 30);
  agent.replies = ['## Needs your action\nA — first ' + refs(1, 10), '## Needs your action\nB — second ' + refs(11, 20), '## Insurance\nC — third ' + refs(21, 30)];
  const out = await brief();
  assert.equal(agent.requests.length, 3);
  assert.match(agent.requests[1], /part 2 of 3/);
  assert.deepEqual([...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent), ['Needs your action · 2', 'Insurance · 1']);
});

test('one failed chunk still shows the rest and says so', async () => {
  setup([{ threads: ids(0, 30) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 30);
  agent.replies = ['## Other\nOnly — part one ' + refs(1, 10), 500, '## Other\nThird — part ' + refs(21, 30), 500, 500];
  const out = await brief();
  assert.match(out.querySelector('.mail-foot').textContent, /3 of 5 requests failed/);
  const heads = [...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent);
  assert.deepEqual(heads, ['Other · 2', 'Not summarised · 10'], 'threads of the failed request are listed, not dropped');
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

test('threads the answer skipped are asked again, and the coverage is complete', async () => {
  setup([{ threads: ids(0, 3) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 3);
  agent.replies = ['## Other\nFirst two — done {T1,T2}', '## Staff & HR\nThe third — done {T3}'];
  const out = await brief();
  assert.equal(agent.requests.length, 2);
  assert.match(agent.requests[1], /skipped in an earlier pass/);
  assert.ok(/\nT3 \|/.test('\n' + agent.requests[1]) && !/\nT1 \|/.test('\n' + agent.requests[1]), 'only the skipped thread is re-sent');
  assert.match(out.querySelector('.mail-foot').textContent, /Briefed 3 of 3 threads/);
  assert.ok(!out.querySelector('.mail-foot').textContent.includes('failed'));
});

test('threads that stay unmentioned after two extra passes are listed by subject', async () => {
  setup([{ threads: ids(0, 3) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 3);
  agent.replies = ['## Other\nOnly one {T1}', '## Other\nStill nothing new {T1}', '## Other\nStill nothing new {T1}'];
  const out = await brief();
  assert.equal(agent.requests.length, 3, 'first pass + at most two checking passes');
  assert.deepEqual([...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent), ['Other · 3', 'Not summarised · 2']);
  assert.match(out.querySelector('.mail-foot').textContent, /Briefed 1 of 3 threads/);
});

test('an answer without thread ids is shown as is and the app says coverage could not be checked', async () => {
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Other\nSomething happened'];
  const out = await brief();
  assert.equal(agent.requests.length, 1, 'no endless re-asking');
  assert.match(out.querySelector('.mail-foot').textContent, /coverage could not be checked/);
});

test('HTML tables become "Label: Column=value" rows, Bahria first, quoted history dropped', async () => {
  setup([{ threads: [{ id: 'tbl' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 1);
  agent.replies = ['## Stock & operations\nPurchase — report {T1}'];
  await brief();
  const prompt = agent.requests[0];
  assert.ok(prompt.includes('Bahria town: Not Ever Sold 60 Days=814,325; Percentage Notever=3.48%; 60 Days Dead=1,251,358; Percentage Dead=5.36%; 90 Days Excess=593,580; Percentage Excess=2.54%; Stock Position=23,367,141; Number of days stock=41'));
  assert.ok(prompt.indexOf('Bahria Town rows:') > -1 && prompt.indexOf('Bahria Town rows:') < prompt.indexOf('Awaisia:'), 'Bahria row is first');
  assert.ok(!prompt.includes('QUOTED-TABLE-SECRET') && !prompt.includes('flattened garbage'));
});

test('a same-day repeat or correction marks the older thread as replaced', async () => {
  resetMocks();
  Object.assign(SUBJ, { bio1: 'Bio Metric Attendance Status DTD:20-10-2026', bio2: 'Bio Metric Machine Status DTD:20-10-2026', jt1: 'Job Timing Issues', jt2: 'Job Timing (Corrected)' });
  Object.assign(WHEN, { bio1: NOW - 3000, bio2: NOW, jt1: NOW - 2000, jt2: NOW - 1000 });
  setup([{ threads: [{ id: 'bio1' }, { id: 'bio2' }, { id: 'jt1' }, { id: 'jt2' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 4);
  agent.replies = ['## Staff & HR\nHR — status and timings ' + refs(1, 4)];
  await brief();
  const p = agent.requests[0];
  assert.equal((p.match(/OLDER VERSION, replaced by T\d+/g) || []).length, 2);
  assert.match(p, /Bio Metric Attendance Status[^\n]*OLDER VERSION/);
  assert.match(p, /Job Timing Issues[^\n]*OLDER VERSION/);
  assert.ok(!/Bio Metric Machine Status[^\n]*OLDER VERSION/.test(p) && !/Corrected\)[^\n]*OLDER VERSION/.test(p), 'the newest version stays in full');
  resetMocks();
});

test('"Warehouse to branches" and "Branches to warehouse" are different reports, not repeats', async () => {
  resetMocks();
  Object.assign(SUBJ, { w1: 'Warehouse to branches pending Str', w2: 'Branches to warehouse pending Str' });
  Object.assign(WHEN, { w1: NOW - 2000, w2: NOW });
  setup([{ threads: [{ id: 'w1' }, { id: 'w2' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Stock & operations\nPurchase — pending STRs ' + refs(1, 2)];
  await brief();
  assert.ok(!/OLDER VERSION/.test(agent.requests[0]));
  resetMocks();
});

test('a thread whose newest message is your own branch asking something counts as waiting on others', async () => {
  resetMocks();
  SENDER.own1 = 'Usman Razzaq <bahria.exp@fdpp.pk>'; SNIP.own1 = 'Kindly arrange the pending items within 2 days.';
  setup([{ threads: [{ id: 'own1' }, { id: 'other1' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Waiting on others\nBahria — asked warehouse ' + refs(1, 2)];
  await brief();
  assert.match(agent.requests[0], /YOU WROTE LAST[^\n]*Pending STR own1/);
  assert.ok(!/YOU WROTE LAST[^\n]*Pending STR other1/.test(agent.requests[0]));
  assert.match(agent.requests[0], /Pending STR own1[^\n]*suggested heading: Waiting on others/);
  resetMocks();
});

test('an answer cut off in the middle of a line loses that half line, and its thread is asked again', async () => {
  resetMocks();
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Insurance\nAGICO notified: Maryam — slab Rs 4,532 {T1}\ninfo@agico.com.pk — E', '## Insurance\nAGICO notified: Shameela — slab Rs 7,242 {T2}'];
  const out = await brief();
  assert.equal(agent.requests.length, 2);
  assert.ok(!out.textContent.includes('info@agico.com.pk — E'));
  assert.equal(out.querySelectorAll('.mail-ai-l').length, 2);
});

test('AGICO notices are written from the email itself, never by the AI, without "approved"', async () => {
  resetMocks();
  Object.assign(SUBJ, { ins1: 'E-Health Card Facilitation - MRS. MARYAM FARHAN - 002 - 002 - 002162', ins2: 'E-Health Card Facilitation - MRS. SHAMEELA ZAFAR - 006 - 006 - 002162',
    gop1: '[ABDUL RAZZAQ MIR] GOP of SANA SAEED - 004 - MR No.  - GOP No. 202609HI218327' });
  Object.assign(WHEN, { ins1: NOW, ins2: NOW - 600000, gop1: NOW - 1000 });
  Object.assign(BODY, { ins1: 'Dear Corporate Team, referred for OPD treatment with slab PKR 4532/- at your esteemed Hospital.', ins2: 'Dear Corporate Team, referred for OPD treatment with slab PKR 7242/- at your esteemed Hospital.', gop1: 'Case approved for requested treatment as per enclosed GOP letter.' });
  setup([{ threads: [{ id: 'ins1' }, { id: 'ins2' }, { id: 'gop1' }, { id: 'norm1' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 4);
  agent.replies = ['## Stock & operations\nPurchase — pending STR ' + refs(1, 4)];
  const out = await brief();
  const prompt = agent.requests[0];
  assert.ok(!/E-Health|GOP of|MARYAM|SANA SAEED/.test(prompt.slice(prompt.lastIndexOf('<emails>'))), 'insurance notices are not sent to the AI');
  const lines = [...out.querySelectorAll('.mail-ai-l')].map((e) => e.textContent);
  assert.ok(lines.some((l) => /MRS\. MARYAM FARHAN.*slab Rs 4,532/.test(l)) && lines.some((l) => /MRS\. SHAMEELA ZAFAR.*slab Rs 7,242/.test(l)), 'both patients listed with their slab');
  assert.ok(lines.some((l) => /SANA SAEED.*GOP No\. 202609HI218327/.test(l)));
  assert.ok(!lines.some((l) => /approved/i.test(l)));
  assert.match(out.querySelector('.mail-foot').textContent, /Briefed 4 of 4 threads/);
  resetMocks();
});

test('two same-day mails that differ by names are not "replaced"', async () => {
  resetMocks();
  Object.assign(SUBJ, { n1: 'Salary slip - ALI KHAN - 001', n2: 'Salary slip - ZAID AHMED - 002' });
  Object.assign(WHEN, { n1: NOW - 5000, n2: NOW });
  setup([{ threads: [{ id: 'n1' }, { id: 'n2' }] }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Other\nHR — slips ' + refs(1, 2)];
  await brief();
  assert.ok(!/OLDER VERSION/.test(agent.requests[0]));
  resetMocks();
});

test('leaked thread ids and "No pending ..." filler lines never reach the screen', async () => {
  resetMocks();
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = ['## Waiting on others\nNo pending requests from Bahria Town or other branches.\n## Insurance\nAGICO notified: Maryam — slab Rs 4,532 (replaces T4) {T1}\nHR — see T2 for timings {T2}'];
  const out = await brief();
  assert.deepEqual([...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent), ['Insurance · 2'], 'the empty Waiting section is gone');
  assert.ok(!/\bT\d/.test(out.textContent.replace(/Briefed.*/, '')), 'no thread ids on screen');
});

test('a busy AI is waited out and asked again instead of giving up', async () => {
  resetMocks();
  const saved = retry.delayMs; retry.delayMs = 0;
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = [503, 503, '## Other\nBoth — fine ' + refs(1, 2)];
  const out = await brief();
  retry.delayMs = saved;
  assert.equal(agent.requests.length, 3, 'first try, the built-in retry, then one patient retry');
  assert.equal(out.querySelectorAll('.mail-ai-l').length, 1);
  assert.ok(!out.querySelector('.mail-foot').textContent.includes('failed'));
});

test('a request that stays busy is reported with the reason', async () => {
  resetMocks();
  const saved = retry.delayMs; retry.delayMs = 0;
  setup([{ threads: ids(0, 2) }], []);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 2);
  agent.replies = [503, 503, 503, 503, 503, 503];
  const out = await brief();
  retry.delayMs = saved;
  assert.match(out.querySelector('.mail-err').textContent, /busy/i);
});
