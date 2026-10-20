// Mail briefing agent tools: read results are redacted/sensitive, follow-up write is previewed and undoable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const reg = await import('../../js/agent/core/tool-registry.js');
await import('../../js/agent/tools/mail.js');

let fu = {};
const item = { id: 't1', subject: 'Please send report', kind: 'act' };
globalThis.window = globalThis.window || globalThis;
window.MailBriefing = {
  isConnected: () => true,
  snapshot: () => ({ connected: true, loaded: true, counts: { act: 1 }, needs_action: [{ id: 't1', subject: 'Please send report', from: 'HR', snippet: 'x' }], waiting_on_others: [] }),
  followUps: () => Object.keys(fu).map((id) => ({ id, subject: fu[id].subject, due: fu[id].due, overdue: false, reply_received: false })),
  findItem: (id) => (id === 't1' ? item : null),
  followUpSubject: (id) => (fu[id] || {}).subject || null,
  getFollowUpRecord: (id) => fu[id] || null,
  setFollowUp: (id, v, it) => { if (v === 'done') delete fu[id]; else fu[id] = { subject: it.subject, due: v }; },
  restoreFollowUp: (id, rec) => { if (rec) fu[id] = rec; else delete fu[id]; },
  refresh: async () => {},
};

test('mail tools are registered, sensitive, and the write needs approval', () => {
  assert.equal(reg.getTool('mail_briefing').sensitive, true);
  assert.equal(reg.getTool('mail_followups').risk, 'read');
  assert.equal(reg.getTool('mail_follow_up').risk, 'write');
});

test('mail_briefing returns the redacted snapshot with follow-ups', async () => {
  const r = JSON.parse((await reg.runTool('mail_briefing', {})).text);
  assert.equal(r.needs_action[0].id, 't1');
  assert.ok(Array.isArray(r.follow_ups));
});

test('mail_follow_up previews, saves and undoes', async () => {
  const t = reg.getTool('mail_follow_up');
  assert.match(t.preview({ id: 't1', due: 'tomorrow' }).lines[0], /Please send report/);
  assert.throws(() => t.preview({ id: 'nope', due: 'today' }));
  const out = await t.run({ id: 't1', due: 'tomorrow' });
  assert.equal(fu.t1.due, 'tomorrow');
  await t.makeUndo({ id: 't1', due: 'tomorrow' }, out).fn();
  assert.equal(fu.t1, undefined);
});
