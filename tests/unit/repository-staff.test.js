// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — Repository + Actions, exercised through the Staff
// Registry vertical slice (config.js → event-bus.js → repository.js →
// actions.js). This is the one place in the app's core data layer that
// doesn't reach out to unrelated classic-script globals (unlike the
// DAILY/MONTHLY helpers, which call things like `invalidateRenderCache`
// that only exist once dashboard.js has also loaded) — which makes it
// the right slice for an isolated smoke test of "does a write actually
// go Action → Repository → localStorage → EventBus notification".
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv();
const { Repository } = await import('../../js/repository.js');
const { Actions } = await import('../../js/actions.js');
const { EventBus } = await import('../../js/event-bus.js');

beforeEach(() => {
  resetStorage();
  Repository.setStaff([]);
});

describe('Staff Registry — Repository + Actions (smoke)', () => {
  test('addEmployee adds a staff member with sane defaults and persists it', () => {
    const emp = Actions.addEmployee({ name: 'Kashif' });
    assert.equal(emp.name, 'Kashif');
    assert.equal(emp.active, true, 'new employees should default to active');
    assert.equal(emp.srNum, 1, 'first active employee should get Sr# 1');
    assert.equal(Repository.getStaff().length, 1);

    const persisted = JSON.parse(localStorage.getItem('BT_Staff_v1'));
    assert.equal(persisted.length, 1, 'staff list should be persisted to localStorage');
    assert.equal(persisted[0].name, 'Kashif');
  });

  test('addEmployee assigns increasing Sr# to successive active employees', () => {
    Actions.addEmployee({ name: 'A' });
    Actions.addEmployee({ name: 'B' });
    const c = Actions.addEmployee({ name: 'C' });
    assert.equal(c.srNum, 3);
  });

  test('addEmployee fires a staff:added EventBus notification', () => {
    const events = [];
    const unsubscribe = EventBus.onChange((name, payload) => events.push({ name, payload }));
    const emp = Actions.addEmployee({ name: 'Notify Test' });
    unsubscribe();
    assert.ok(events.some((e) => e.name === 'staff:added' && e.payload.id === emp.id));
  });

  test('updateEmployee clears srNum when deactivating an employee', () => {
    Actions.addEmployee({ name: 'Bilal' });
    const updated = Actions.updateEmployee(0, { active: false });
    assert.equal(updated.active, false);
    assert.equal(updated.srNum, null, 'deactivating should clear srNum so it can be reused');
  });

  test('updateEmployee hands out a fresh srNum on reactivation, never the old one', () => {
    Actions.addEmployee({ name: 'Bilal' });     // srNum 1
    Actions.addEmployee({ name: 'Kashif' });    // srNum 2
    Actions.updateEmployee(0, { active: false }); // Bilal deactivated, srNum -> null
    const reactivated = Actions.updateEmployee(0, { active: true });
    assert.equal(reactivated.srNum, 3, 'reactivation should get the next free Sr#, not the old 1');
  });

  test('updateEmployee silently reassigns a Sr# that collides with another active employee', () => {
    Actions.addEmployee({ name: 'A' }); // srNum 1
    Actions.addEmployee({ name: 'B' }); // srNum 2
    const updated = Actions.updateEmployee(1, { srNum: 1 }); // B tries to steal A's Sr#
    assert.notEqual(updated.srNum, 1, 'a duplicate active Sr# must never be allowed through');
  });

  // Regression test for a real bug this suite found: Actions.addEmployee's
  // id used to be 'emp_' + Date.now() alone, which collided when two
  // employees were added inside the same millisecond — and because
  // _nextSrNum() excludes "the record itself" by matching on id, a
  // collision made it wrongly exclude BOTH records, corrupting the two
  // tests above (they only passed by accident, depending on which side
  // of a millisecond boundary the calls landed on). Fixed in actions.js
  // by suffixing the id with a random component; this test locks that in.
  test('addEmployee never produces two staff records with the same id, even called back-to-back', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const emp = Actions.addEmployee({ name: 'Bulk ' + i });
      assert.ok(!seen.has(emp.id), `duplicate id generated: ${emp.id}`);
      seen.add(emp.id);
    }
  });

  test('removeEmployee removes the staff member and fires staff:removed', () => {
    Actions.addEmployee({ name: 'Temp' });
    const events = [];
    const unsubscribe = EventBus.onChange((name, payload) => events.push({ name, payload }));
    const removed = Actions.removeEmployee(0);
    unsubscribe();
    assert.equal(removed.name, 'Temp');
    assert.equal(Repository.getStaff().length, 0);
    assert.ok(events.some((e) => e.name === 'staff:removed'));
  });

  test('updateEmployee throws a clear error for an out-of-range index', () => {
    assert.throws(() => Actions.updateEmployee(5, { name: 'Ghost' }), /no employee at index 5/);
  });
});
