import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomEnv } from '../helpers/dom-env.js';
import { creditNet, findDuplicateCreditEntries, findAgedCredit, creditAlertMessages, AGED_CREDIT_MIN } from '../../js/shared/credit-alerts.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const e = (date, desc, amount) => ({ date, desc, amount });

describe('credit alert rules', () => {
  test('net owed = opening + entries - salary - generic', () => {
    assert.equal(creditNet({ prevBal: 2000, entries: [e('a', 'x', 1500), e('b', 'y', -500)], salary: 1000, lessGeneric: 100 }), 1900);
    assert.equal(creditNet(null), 0);
  });
  test('duplicates: same person, date, amount and description (case/space-insensitive)', () => {
    const rows = [{ name: 'Ali Khan', entries: [e('02-Oct-2026', 'Medicine', 800), e('02-Oct-2026', ' medicine ', 800), e('02-Oct-2026', 'medicine', 900), e('03-Oct-2026', 'medicine', 800)] },
      { name: 'Sara', entries: [e('02-Oct-2026', 'Medicine', 800)] }];
    const d = findDuplicateCreditEntries(rows);
    assert.equal(d.length, 1); assert.equal(d[0].name, 'Ali Khan'); assert.equal(d[0].times, 2); assert.equal(d[0].amount, 800);
  });
  test('zero amounts and different people are never duplicates', () => {
    assert.equal(findDuplicateCreditEntries([{ name: 'A', entries: [e('d', 'x', 0), e('d', 'x', 0)] }]).length, 0);
    assert.equal(findDuplicateCreditEntries([{ name: 'A', entries: [e('d', 'x', 5)] }, { name: 'B', entries: [e('d', 'x', 5)] }]).length, 0);
  });
  test('aged: carried balance >= threshold AND still owing', () => {
    const rows = [
      { name: 'Big', prevBal: 8000, entries: [], salary: 0, lessGeneric: 0 },
      { name: 'Cleared', prevBal: 8000, entries: [], salary: 8000, lessGeneric: 0 },
      { name: 'Small', prevBal: AGED_CREDIT_MIN - 1, entries: [], salary: 0, lessGeneric: 0 },
      { name: 'NewThisMonth', prevBal: 0, entries: [e('d', 'x', 20000)], salary: 0, lessGeneric: 0 },
    ];
    assert.deepEqual(findAgedCredit(rows).map(a => a.name), ['Big']);
  });
  test('messages: stable wording, capped list, null when nothing aged', () => {
    const m = creditAlertMessages([{ name: 'Mian Muhammad Usman', prevBal: 9000, entries: [e('05-Sep-2026', 'lunch', 100), e('05-Sep-2026', 'lunch', 100)], salary: 0, lessGeneric: 0 }]);
    assert.match(m.aged, /^1 staff still owe credit carried over from earlier months \(total Rs 9,200\): Mian Muhammad Rs 9,200$/);
    assert.match(m.duplicates[0], /Possible duplicate credit entry: Mian Muhammad Usman Rs 100 on 05-Sep-2026 \(lunch\) entered 2 times/);
    assert.equal(creditAlertMessages([]).aged, null);
    assert.deepEqual(creditAlertMessages(undefined).duplicates, []);
  });
});

describe('the push mirrors the app', () => {
  const app = fs.readFileSync(path.join(root, 'js/shared/credit-alerts.js'), 'utf8');
  const copy = fs.readFileSync(path.join(root, 'supabase/functions/send-daily-ntfy-briefing/credit-alerts.js'), 'utf8');
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/send-daily-ntfy-briefing/index.ts'), 'utf8');
  test('the Edge Function copy is byte-identical to the app file', () => assert.equal(copy, app));
  test('the push imports and uses the shared rules and raises them as alerts', () => {
    assert.match(fn, /from "\.\/credit-alerts\.js"/);
    assert.match(fn, /creditAlertMessages\(credit\.data\)/);
    assert.match(fn, /alerts\.push\(\.\.\.ca\.duplicates\)/);
    assert.match(fn, /return \{ text: L\.join\("\\n"\), alerts, facts \};/);
  });
  test('the app briefing uses the same module', () => {
    assert.match(fs.readFileSync(path.join(root, 'js/agent/tools/briefing.js'), 'utf8'), /creditAlertMessages\(mgr\.credit\[months\[0\]\]\)/);
  });
});

describe('in-app briefing raises the credit alerts', () => {
  test('duplicate + carried-over credit show up as warnings', async () => {
    installDomEnv();
    globalThis.invalidateRenderCache = () => {};
    const cfg = await import('../../js/config.js'); globalThis.recomputeMonthly = cfg.recomputeMonthly;
    const { Repository } = await import('../../js/repository.js'); globalThis.Repository = Repository;
    const { buildBriefing } = await import('../../js/agent/tools/briefing.js');
    Repository.setItem('BT_ManagerWork_v1', JSON.stringify({ credit: {
      'September 2026': [{ name: 'Old', prevBal: 1, entries: [], salary: 0, lessGeneric: 0 }],
      'October 2026': [{ name: 'Ali Khan', prevBal: 7000, entries: [e('02-Oct-2026', 'medicine', 800), e('02-Oct-2026', 'medicine', 800)], salary: 0, lessGeneric: 0 }] } }));
    const b = buildBriefing(new Date(2026, 9, 6));
    const msgs = b.attention.filter(a => a.area === 'credit').map(a => a.message);
    assert.equal(b.credit.month, 'October 2026');
    assert.ok(msgs.some(m => /Possible duplicate credit entry: Ali Khan Rs 800/.test(m)), msgs.join(' | '));
    assert.ok(msgs.some(m => /still owe credit carried over/.test(m)));
    assert.ok(b.attention.filter(a => a.area === 'credit').every(a => a.level === 'warn'));
  });
});

describe('agent_schedules migration', () => {
  const mig = fs.readFileSync(path.join(root, 'supabase/migrations/20261005130000_agent_schedules.sql'), 'utf8');
  test('RLS on, anon out, owner-only, constrained columns', () => {
    assert.match(mig, /alter table public\.agent_schedules enable row level security/);
    assert.match(mig, /revoke all on public\.agent_schedules from anon/);
    assert.match(mig, /user_id = auth\.uid\(\) and public\.agent_is_authorized\(\)/);
    assert.match(mig, /check \(cron ~/); assert.match(mig, /check \(agent in/); assert.match(mig, /char_length\(instructions\) <= 500/);
  });
  test('users cannot forge run state (UPDATE granted per column, not table-wide)', () => {
    assert.match(mig, /revoke update on public\.agent_schedules from authenticated/);
    const g = /grant update \(([^)]+)\) on public\.agent_schedules/.exec(mig)[1];
    assert.ok(!/last_run_at|last_status|last_error/.test(g));
    assert.ok(!/grant select, insert, update/.test(mig));
  });
});
