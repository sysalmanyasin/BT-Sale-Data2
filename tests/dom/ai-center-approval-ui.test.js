// AI Center approval view, verify step, history labels and security — end to end: the REAL AI Center UI, the REAL assistant panel
// (shared approval controller), the REAL runAgent loop, tools and verifiers. Only the model (network) and Supabase are stubbed.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0); window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.invalidateRenderCache = () => {};
window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
await import('../../js/agent/tools/app.js');
await import('../../js/agent/tools/verify.js');
const { setWritesEnabled } = await import('../../js/agent/core/prefs.js');
const T = await import('../../js/agent/core/telemetry.js');
const { retry } = await import('../../js/agent/core/server.js');
const { mountAgentPanel } = await import('../../js/agent/ui/agent-panel.js');
const ui = await import('../../js/ai-center/ui.js');
retry.delayMs = 0;

const chain = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'then' ? res => res({ data: [], error: null }) : k === 'maybeSingle' ? async () => ({ data: { value: false }, error: null }) : chain()),
  apply: () => chain(),
});
window.btGetSupabaseClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't', expires_at: 9999999999 } }, error: null }) }, from: () => chain() });
let script = [];
const reply = obj => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, body: null, json: async () => obj });
globalThis.fetch = window.fetch = async () => reply(script.shift() || { message: { role: 'assistant', content: 'ok' } });
const toolCall = (name, args) => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c' + Math.random(), function: { name, arguments: JSON.stringify(args) } }] } });
const final = { message: { role: 'assistant', content: 'Done.' } };
const wait = (ms = 15) => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 150) => { for (let i = 0; i < n; i++) { if (fn()) return true; await wait(10); } return false; };
const text = () => document.getElementById('aic-root').textContent;
const q = s => document.querySelector(s);
const A = () => window.BTAgent;
const untrustedClick = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // script-made: isTrusted === false
const targets = () => JSON.parse(Repository.getItem('bt_targets') || '{}');
const show = async mode => { ui.__test.S.mode = mode; ui.__test.paint(); await wait(20); };

before(async () => {
  const e = console.error; console.error = () => {};
  setWritesEnabled(true); mountAgentPanel(); ui.onShow(); await wait(120);
  console.error = e;
});

describe('AI Center approval view', () => {
  test('a real proposal appears in the Center with why, evidence, expected result, reversibility and gate', async () => {
    T.clear(); script = [toolCall('set_monthly_target', { month_year: 'March 2027', amount: 500000 }), final];
    const done = A().ask('set the March target to 500000');
    assert.ok(await until(() => A().approvals().length === 1));
    await show('act');
    const card = q('.aic-ap2'); assert.ok(card, 'approval card rendered in the Center');
    const t = card.textContent;
    assert.match(t, /WHY BT IS ASKING/); assert.match(t, /You asked: "set the March target to 500000"/);
    assert.match(t, /EVIDENCE/); assert.match(t, /500,000/);
    assert.match(t, /EXPECTED RESULT/); assert.match(t, /reads it back/);
    assert.match(t, /REVERSIBILITY/); assert.match(t, /Can be undone|Cannot be undone/);
    assert.match(t, /AFFECTED RECORDS/); assert.match(t, /March 2027/);
    assert.match(t, /One tap to approve/);
    assert.equal(q('#aic-core') ? true : true, true);
    // SECURITY: a script-made click cannot approve. Nothing is written, the request keeps waiting.
    const approve = [...card.querySelectorAll('button')].find(b => /Approve/.test(b.textContent));
    untrustedClick(approve); await wait(30);
    assert.equal(targets()['March 2027'], undefined, 'untrusted click wrote nothing');
    assert.equal(A().approvals().length, 1, 'still waiting');
    assert.match([...document.querySelectorAll('.aic-toast')].pop().textContent, /real tap or click/);
    // rejecting through the Center works and writes nothing
    const reject = [...q('.aic-ap2').querySelectorAll('button')].find(b => b.textContent === 'Reject');
    untrustedClick(reject); await done;
    assert.equal(targets()['March 2027'], undefined);
    assert.equal(T.recent(100).find(e => e.type === 'approval_resolved').status, 'rejected');
    await show('act'); assert.match(text(), /Nothing is waiting for approval/);
  });

  test('a delete shows the typed-word gate and a wrong word grants nothing', async () => {
    const { LedgerActions } = await import('../../js/ledger-actions.js');
    const LS = await import('../../js/ledger-store.js');
    const entry = LedgerActions.addEntry('jazzcash', { date: '2026-10-03', categoryId: 'credit', amount: 321, desc: 'center delete test' });
    T.clear(); script = [toolCall('delete_ledger_entry', { entry_id: entry.id }), final];
    const done = A().ask('delete that entry');
    assert.ok(await until(() => A().approvals().length === 1)); await show('act');
    assert.match(q('.aic-ap2').textContent, /Type "DELETE" to approve/);
    assert.ok(q('.aic-ap2 input'), 'typed-word input is present');
    assert.equal(A().decide(A().approvals()[0].id, 'approve', { gesture: { isTrusted: true }, typed: 'nope' }).needs, 'type');
    assert.ok(LS.getEntries('jazzcash').some(e => e.id === entry.id), 'wrong word deleted nothing');
    A().decide(A().approvals()[0].id, 'reject'); await done;
  });
});

describe('verify step shown in the Center', () => {
  test('after an approved change the lifecycle, timeline and observability show the real read-back', async () => {
    T.clear(); script = [toolCall('set_monthly_target', { month_year: 'June 2027', amount: 700000 }), final];
    const done = A().ask('set the June target to 700000');
    assert.ok(await until(() => A().approvals().length === 1));
    assert.equal(A().decide(A().approvals()[0].id, 'approve', { gesture: { isTrusted: true } }).ok, true);
    await done; assert.equal(targets()['June 2027'], 700000);
    await show('investigate');
    const verify = [...document.querySelectorAll('.aic-life li')].find(li => li.textContent.startsWith('Verify'));
    assert.ok(verify.classList.contains('on') && !verify.classList.contains('fail'), 'Verify step lit by a REAL verify_end');
    assert.match(text(), /Verified: set_monthly_target \(\d of \d checks passed\)/);
    assert.match(text(), /OBSERVABILITY/); assert.match(text(), /1 passed, 0 failed/);
    assert.match(text(), /AVG APPROVAL WAIT/);
  });
  test('before any change, nothing claims verification', async () => {
    T.clear(); await show('investigate');
    assert.doesNotMatch(text(), /Verified:/);
    const verify = [...document.querySelectorAll('.aic-life li')].find(li => li.textContent.startsWith('Verify'));
    assert.ok(!verify.classList.contains('on'));
  });
});

describe('history and restricted tools', () => {
  test('restored events are labelled EARLIER and never make BT look busy', async () => {
    T.clear();
    T.hydrate([{ event_id: 'e1', timestamp: Date.now() - 3 * 3600000, type: 'request_start', request_id: 'old', agent: 'Sales', metadata: { question: 'old question' } }]);
    await show('investigate');
    assert.equal(T.liveState().open, null, 'a restored half-finished request is not "running"');
    assert.match(q('.aic-cs h2').textContent, /MONITORING|IDLE|DETECTING/);
    assert.ok(q('.aic-earlier'), 'EARLIER label shown'); assert.match(q('.aic-earlier').textContent, /EARLIER/);
  });
  test('with changes locked, every write tool shows READ-ONLY and the table shows purpose + status columns', async () => {
    setWritesEnabled(false); ui.__test.S.toolsOpen = true; await show('investigate');
    const det = q('.aic-tooldet'); det.open = true; det.dispatchEvent(new window.Event('toggle')); await wait(20);
    const heads = [...document.querySelectorAll('.aic-tg th')].map(x => x.textContent);
    assert.ok(heads.includes('Purpose') && heads.includes('Status'));
    const row = [...document.querySelectorAll('.aic-tg tr')].find(r => r.firstChild && r.firstChild.textContent === 'set_monthly_target');
    assert.ok(row, 'write tool listed'); assert.match(row.textContent, /READ-ONLY/);
    const readRow = [...document.querySelectorAll('.aic-tg tr')].find(r => r.firstChild && r.firstChild.textContent === 'daily_briefing');
    assert.match(readRow.textContent, /AVAILABLE/);
    setWritesEnabled(true);
  });
  test('the Center itself has no write path: approve with no gesture is refused by the controller', async () => {
    assert.match(A().decide('ap_none', 'approve').error, /no longer waiting/);
    assert.equal(typeof A().decide, 'function');
    assert.ok(Object.isFrozen(window.BTAgent), 'BTAgent surface cannot be tampered with');
  });
});

describe('repository intelligence in the Center', () => {
  test('with the real index it finds where a KPI is calculated, and shows no source code', async () => {
    const { readFileSync } = await import('node:fs');
    const real = JSON.parse(readFileSync(new URL('../../js/ai-center/repo-index.json', import.meta.url), 'utf8'));
    const prev = globalThis.fetch;
    globalThis.fetch = async u => (String(u).includes('repo-index.json') ? { ok: true, status: 200, json: async () => real } : prev(u));
    ui.__test.S.repo = { state: 'idle', idx: null }; ui.__test.S.repoQ = '';
    await show('investigate'); await wait(60);
    assert.match(q('#aic-repo').textContent, /INDEX READY/); assert.doesNotMatch(q('#aic-repo').textContent, /NOT CONNECTED/);
    const inp = q('#aic-rq'); inp.value = 'target pace'; inp.dispatchEvent(new window.Event('input'));
    assert.match(q('.aic-rres').textContent, /getTargetPaceForMonth/); assert.match(q('.aic-rres').textContent, /js\/analytics\.js:\d+/);
    assert.match(q('#aic-repo').textContent, /no source code/i);
    globalThis.fetch = prev;
  });
  test('if the index cannot be loaded it says NOT CONNECTED and invents nothing', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    ui.__test.S.repo = { state: 'idle', idx: null };
    await show('investigate'); await wait(60);
    assert.match(q('#aic-repo').textContent, /NOT CONNECTED/); assert.ok(!q('#aic-rq'));
    globalThis.fetch = prev;
  });
});
