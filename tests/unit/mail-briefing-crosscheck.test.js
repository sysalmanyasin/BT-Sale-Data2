// Regression test built from a real day of the Bahria Town mailbox (21 Oct 2026), after cross-checking the AI brief against Gmail.
// Each test pins one mistake the old brief made: wrong owner, "no responses yet", mixed attendance dates, sent reports shown as
// "waiting", automatic notices, "()" leftovers, and a brief that silently went stale when new mail arrived.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
document.body.innerHTML = '<div id="mail-root"></div>';
const ME = 'bahria.cat@fdpp.pk';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(15); } };

globalThis.google = window.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: 'tok' }) }), revoke() {} } } };
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } });
localStorage.setItem('bt_mail_cid', 'x.apps.googleusercontent.com'); localStorage.setItem('bt_mail_auto', '1'); localStorage.setItem('bt_mail_email', ME);

const T0 = Date.parse('2026-10-21T05:00:00Z');
const SHOPS = 'shops@fazaldins.org, warehouse2@fdpp.pk';
const m = (from, to, subject, snippet, text, min, extra = {}) => ({ from, to, cc: extra.cc || '', subject, snippet, text, html: extra.html, at: T0 + min * 60000, labels: extra.labels || ['INBOX'] });
const NEG_HTML = '<table><tr><td>Branch</td><td>20-10-2026</td><td>21-10-2026</td><td>Stock Position</td><td>Percentage</td></tr>'
  + '<tr><td>Bahria town</td><td>-7736</td><td>-5528</td><td>23,329,394</td><td>-0.02%</td></tr>'
  + '<tr><td>Shalimar</td><td>-39120</td><td>-24252</td><td>86,783,489</td><td>-0.03%</td></tr></table>';
const HR20_HTML = '<table><tr><td>Sr.</td><td>Branch</td><td>Bio Metric Machine Status</td></tr><tr><td>1</td><td>Main Market</td><td>Yes</td></tr>'
  + '<tr><td>5</td><td>Model Town</td><td>No</td></tr><tr><td>7</td><td>Bahria Town</td><td>Yes</td></tr></table>';
const THREADS = {
  loadshed: [
    m('Ishfaq ahmed <receivables@fazaldins.org>', SHOPS, 'Load shedding and generator report', 'Dear Branch Managers, kindly send LOAD SHEDDING &amp; GENERATOR HOURS REPORT.', 'Dear Branch Managers, kindly send LOAD SHEDDING & GENERATOR HOURS REPORT.', 0, { labels: ['INBOX', 'IMPORTANT'] }),
    m('Dr Ammar Younis <defence.cat@fdpp.pk>', 'receivables@fazaldins.org', 'Re: Load shedding and generator report', 'NILL Best Regards, Dr Ammar Younis', 'NILL\n\nBest Regards,\nDr Ammar Younis', 1),
    m('Atta Qadri <shalamar.exp@fdpp.pk>', 'defence.cat@fdpp.pk', 'Re: Load shedding and generator report', 'nill Best Regards, ATTA QADRI', 'nill\n\nBest Regards,\nATTA QADRI', 4),
    m('Dr Ali Raza <modeltown.cat@fdpp.pk>', 'shalamar.exp@fdpp.pk', 'Re: Load shedding and generator report', 'NILL Best Regards, Dr Ali Raza', 'NILL\n\nBest Regards,\nDr Ali Raza', 7)],
  negs: [
    m('Sarfraz Rathore <purchase3@fazaldins.org>', 'taimur@fazaldins.org', 'Branches Negative Values', 'Branches Negative Values Branch 20-10-2026 21-10-2026', '', 0, { html: NEG_HTML, cc: SHOPS }),
    m('Muhammad Nadeem Abbasi <sales1@fazaldins.org>', 'purchase3@fazaldins.org', 'Re: Branches Negative Values', 'Dear Mr, Hamid &amp; Mr, Atta , Explain the reason for below stocks negative value . Branch 21-10-2026 Shalamar -24252', 'Dear Mr, Hamid & Mr, Atta ,\nExplain the reason for below stocks negative value .\nBranch 21-10-2026\nShalimar -24252', 22, { labels: ['INBOX', 'IMPORTANT'] })],
  hr21: [m('Shumair Ejaz <hrm@fazaldins.org>', SHOPS, 'Bio Metric Attendance Status DTD:21-10-2026', 'DTD:21-10-2026 Sr. Branch Bio Metric Attendance Status Remarks 1 Main Market Okay',
    'DTD:21-10-2026\nSr. Branch Bio Metric Attendance Status Remarks\n1 Main Market Okay\n2 Shalamar No\n3 Defence Okay\n4 Iqbal Town No\n5 Model Town Okay\n6 Johar Town Okay\n7 Bahria Town Okay\n8 Awaisia Colony Okay\n9 Warehouse No\n\n--\nRegards,\nShumair Ejaz', 14, { labels: ['INBOX', 'IMPORTANT'] })],
  hr20: [
    m('Shumair Ejaz <hrm@fazaldins.org>', SHOPS, 'Bio Metric Machine Status DTD:20-10-2026', 'DTD:20-10-2026 Sr. Branch Bio Metric Machine Status', '', -1440, { html: HR20_HTML }),
    m('Muhammad Nadeem Abbasi <sales1@fazaldins.org>', 'hrm@fazaldins.org, modeltown.cat@fdpp.pk', 'Re: Bio Metric Machine Status DTD:20-10-2026', 'Dear Shumair , Please note the fine Rs.1000/- to Dr Ali Raza for failure to submission the biotric attendance sheet with head office timly',
      'Dear Shumair ,\nPlease note the fine Rs.1000/- to Dr Ali Raza for failure to submission the biotric attendance sheet with head office timly', -1400, { labels: ['INBOX', 'IMPORTANT'] })],
  lessthan: [
    m('Usman Razzaq <bahria.exp@fdpp.pk>', 'warehouse2@fdpp.pk', 'Less Than O item', 'Respected Sir We attached Sheet less than Zero item these product still not receive at bahria town', 'Respected Sir\nWe attached Sheet less than Zero item. Please arrange within 2 days.', -2000),
    m('Muhammad Nadeem Abbasi <sales1@fazaldins.org>', 'bahria.exp@fdpp.pk', 'Re: Less Than O item', 'Dear Procurement Team, Status of the order items for bahria town On Tue, 20 Oct 2026', 'Dear Procurement Team,\nStatus of the order items for bahria town', -1900, { labels: ['INBOX', 'IMPORTANT'] })],
  salerep: [m('Usman Razzaq <bahria.exp@fdpp.pk>', 'sales1@fazaldins.org', 'BAHRIA TOWN SALE REPORT', 'BAHRIA TOWN SALE REPORT Date: 20/Oct/2026 Cash Sale: 296403', 'BAHRIA TOWN SALE REPORT\nDate: 20/Oct/2026\nNet Cash Sale: 483497\nNet Credit Sale: 18068\nGrand Total: Rs501565\nTill Short 5,420\nPatty Cash 9,850', 0)],
  checklist: [m('Usman Razzaq <bahria.exp@fdpp.pk>', 'hrm@fazaldins.org', 'Daily Checklist BT', 'Bahria Town Checklist No. Checklist item Remarks 1 Branch: Bahria Town', 'Bahria Town Checklist\n1 Branch: Bahria Town', 2)],
  strict: [
    m('Muhammad Nadeem Abbasi <sales1@fazaldins.org>', SHOPS, 'Strict Instructions Regarding Punctuality and Timely Reporting', 'Branch Managers, It has been observed that branch managers are not arrived', 'Branch Managers, strictly follow timings.', -1500),
    m('Usman Razzaq <bahria.exp@fdpp.pk>', 'sales1@fazaldins.org', 'Re: Strict Instructions Regarding Punctuality and Timely Reporting', 'Acknowledged Sir.', 'Acknowledged Sir.', -1450)],
  geo: [m('Google <noreply-location-sharing@google.com>', ME, "You're sharing your real-time location with 4 people.", 'Salman, To protect your privacy, this is a reminder that you are sharing your real-time location', 'Reminder', -500, { labels: ['INBOX', 'CATEGORY_UPDATES'] })],
};
let live = Object.keys(THREADS);
const hdrs = (x) => [{ name: 'From', value: x.from }, { name: 'To', value: x.to }, { name: 'Cc', value: x.cc }, { name: 'Subject', value: x.subject }];
const meta = (id) => ({ id, messages: THREADS[id].map((x, i) => ({ id: id + i, internalDate: String(x.at), labelIds: x.labels, snippet: x.snippet, payload: { headers: hdrs(x) } })) });
const full = (id) => ({ id, messages: THREADS[id].map((x, i) => ({ id: id + i, internalDate: String(x.at), labelIds: x.labels, snippet: x.snippet, payload: x.html
  ? { headers: hdrs(x), mimeType: 'text/html', body: { data: b64u(x.html) } }
  : { headers: hdrs(x), mimeType: 'text/plain', body: { data: b64u(x.text) } } })) });

let requests = [], answer = null;
globalThis.fetch = async (url, init) => {
  const u = String(url), json = (o, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => o });
  if (u.includes('/functions/v1/bt-agent')) { const content = JSON.parse(init.body).messages[0].content; requests.push(content); return json({ message: { content: answer(content) } }); }
  if (/threads\?/.test(u)) return json({ threads: live.map((id) => ({ id })) });
  const mm = /threads\/(\w+)\?format=(\w+)/.exec(u);
  if (mm) return json(mm[2] === 'full' ? full(mm[1]) : meta(mm[1]));
  return json({});
};
// The AI is stubbed: it files EVERY thread under "Other" (and, like the old brief did, puts the negative-values reply under
// "Needs your action" in Salman's name), so what the test sees is what the app itself guarantees.
const tidOf = (req, subject) => (new RegExp('^(T\\d+) \\| [^\\n]*' + subject, 'm').exec(req) || [])[1];
answer = (req) => {
  const all = [...req.matchAll(/^(T\d+) \| /gm)].map((x) => x[1]), neg = tidOf(req, 'Branches Negative Values');
  const rest = all.filter((t) => t !== neg);
  return (neg ? '## Needs your action\nSalman Yasin — Explain reason for Shalimar’s negative stock value of -24252 {' + neg + '}\n' : '') + (rest.length ? '## Other\nStatus (' + rest[0] + ') noted {' + rest.join(',') + '}' : '');
};

const { MailBriefing } = await import('../../js/mail-briefing.js');
const brief = async () => { document.getElementById('mail-ai').click(); await waitFor(() => document.querySelector('.mail-ai, .mail-err')); return document.getElementById('mail-aiout'); };
const subjectsOf = (arr) => arr.map((x) => x.subject);

test('sections follow who the mail is really for, and sent reports are not "waiting"', async () => {
  MailBriefing.onShow();
  await waitFor(() => MailBriefing.snapshot().counts.threads === live.length);
  const s = MailBriefing.snapshot();
  assert.deepEqual(subjectsOf(s.needs_action), ['Load shedding and generator report'], 'Bahria Town has not answered the branch-wide request; nothing else is yours');
  assert.deepEqual(subjectsOf(s.waiting_on_others), ['Less Than O item'], 'only your own open request to procurement is waiting');
  assert.equal(s.counts.act, 1); assert.equal(s.counts.wait, 1);
  // not yours: the Shalamar explanation request, the Model Town fine, other people\'s reports; not waiting: sale report, checklist, acknowledgement
  for (const sub of ['Branches Negative Values', 'Bio Metric Machine Status DTD:20-10-2026', 'BAHRIA TOWN SALE REPORT', 'Daily Checklist BT', 'Strict Instructions Regarding Punctuality and Timely Reporting']) {
    assert.ok(!subjectsOf(s.needs_action).includes(sub) && !subjectsOf(s.waiting_on_others).includes(sub), sub + ' is routine');
  }
});

test('the brief is written from the real emails: no invented owner, no "no responses", right attendance rows, fine kept', async () => {
  requests = [];
  const out = await brief(), text = out.textContent, req = requests.join('\n');
  // load shedding: three branches answered NILL, Bahria Town has not, and it sits under Needs your action
  assert.match(text, /requested from the branches: Defence \(nil\), Shalamar \(nil\), Model Town \(nil\) replied; Bahria Town has not replied yet/);
  assert.ok(!/no responses/i.test(text));
  const heads = [...out.querySelectorAll('.mail-ai-sec')].map((e) => e.textContent);
  assert.equal(heads[0], 'Needs your action · 1', 'only the load-shedding request is yours');
  // attendance: 21-10 rows are Shalamar, Iqbal Town, Warehouse (Model Town was 20-10), Bahria Town Okay
  assert.match(text, /Shumair Ejaz — Biometric attendance status DTD 21-10-2026: marked No for Shalamar, Iqbal Town, Warehouse; Bahria Town Okay\./);
  assert.match(text, /Biometric attendance status DTD 20-10-2026: marked No for Model Town; Bahria Town Yes\./);
  assert.ok(!/21-10-2026: marked No for[^.]*Model Town/.test(text), 'dates are never mixed');
  // the fine is no longer dropped
  assert.match(text, /Muhammad Nadeem Abbasi — Fine Rs\.1000\/- to Dr Ali Raza for failure to submission/);
  // the AI cannot hand the Shalamar explanation to Salman: it was told who it is written to, and the line is moved out of Needs your action
  assert.match(req, /Branches Negative Values[^\n]*written to: Mr, Hamid & Mr, Atta \(someone else, not you/);
  assert.match(req, /written to Mr, Hamid & Mr, Atta/);
  assert.ok(!/Needs your action · 2/.test(text));
  assert.match(heads.join('|'), /Other · \d/, 'the negative-values line was re-filed under its topic');
  assert.match(text, /Salman Yasin — Explain reason for Shalimar/, 'text kept, only the heading is enforced');
  // the fixed-format threads are not sent to the AI again, and the prompt knows the time
  assert.ok(!/\| Bio Metric Attendance Status DTD:21-10-2026/.test(req) && !/\| Load shedding and generator report/.test(req));
  assert.match(req, /Now: 21 Oct 2026|Now: \d{1,2} \w{3} 20\d\d/);
});

test('automatic notices and leftover "()" are handled; every thread is still accounted for', async () => {
  const out = document.getElementById('mail-aiout'), text = out.textContent, foot = out.querySelector('.mail-foot').textContent;
  assert.ok(!requests.join('\n').includes('real-time location'), 'automatic notice is not sent to the AI');
  assert.match(foot, /Briefed 8 of 8 threads/);
  assert.match(foot, /1 automatic notice skipped/);
  assert.ok(!/\(\s*\)/.test(text), 'no empty brackets where a thread id was');
  assert.ok(!/\bT\d+\b/.test(text), 'no thread ids shown');
});

test('a brief says when new mail arrived after it was written, and clears when it is rewritten', async () => {
  const out = document.getElementById('mail-aiout');
  assert.equal(out.querySelector('.mail-stale'), null, 'fresh brief');
  THREADS.overdue = [m('Sarfraz Rathore <purchase3@fazaldins.org>', 'taimur@fazaldins.org', 'Over 60 Days Dead and 60 Days Excess report', 'Over 60 Days Dead and 60 Days Excess report 21 October, 2026', 'Over 60 Days Dead and 60 Days Excess report\n21 October, 2026', 104, { cc: SHOPS })];
  live = Object.keys(THREADS);
  await MailBriefing.refresh();
  await waitFor(() => MailBriefing.snapshot().counts.threads === 10);
  assert.match(out.querySelector('.mail-stale').textContent, /New or changed mail since this brief/);
  assert.match(out.querySelector('.mail-foot').textContent, /Briefed 8 of 8/, 'the old brief keeps its honest count');
  const again = await (async () => { out.replaceChildren(); return brief(); })();
  assert.equal(again.querySelector('.mail-stale'), null);
  assert.match(again.querySelector('.mail-foot').textContent, /Briefed 9 of 9 threads/);
  assert.ok(requests.at(-1).includes('Over 60 Days Dead'), 'the new report is in the new brief');
});
