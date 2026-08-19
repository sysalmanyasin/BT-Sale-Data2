// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — js/event-bus.js: Floor 3's single notification channel.
// Every Repository write announces itself here; every Page subscribes
// here to know when to re-render. If this is broken, the whole app's
// reactivity silently stops working without throwing anywhere obvious
// — worth a dedicated smoke test on its own.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const { EventBus } = await import('../../js/event-bus.js');

describe('EventBus (smoke)', () => {
  test('module loads and bridges onto window (classic-script consumers depend on this)', () => {
    assert.equal(typeof EventBus.notify, 'function');
    assert.equal(typeof EventBus.onChange, 'function');
    assert.equal(window.EventBus, EventBus, 'window.EventBus must be the same instance');
  });

  test('a subscribed listener receives the event name and payload', () => {
    const received = [];
    const unsubscribe = EventBus.onChange((eventName, payload) => received.push({ eventName, payload }));
    EventBus.notify('daily:added', { Date: '2026-08-19' });
    unsubscribe();
    assert.equal(received.length, 1);
    assert.equal(received[0].eventName, 'daily:added');
    assert.deepEqual(received[0].payload, { Date: '2026-08-19' });
  });

  test('multiple listeners all get notified, independent of registration order', () => {
    const calls = [];
    const un1 = EventBus.onChange(() => calls.push('a'));
    const un2 = EventBus.onChange(() => calls.push('b'));
    EventBus.notify('staff:changed');
    un1();
    un2();
    assert.deepEqual(calls.sort(), ['a', 'b']);
  });

  test('unsubscribe actually stops further notifications', () => {
    let count = 0;
    const unsubscribe = EventBus.onChange(() => { count++; });
    EventBus.notify('x');
    unsubscribe();
    EventBus.notify('x');
    EventBus.notify('x');
    assert.equal(count, 1, 'listener should not fire again after unsubscribing');
  });

  test('one listener throwing does not stop other listeners from being notified', () => {
    let goodListenerCalled = false;
    const unThrower = EventBus.onChange(() => { throw new Error('boom'); });
    const unGood = EventBus.onChange(() => { goodListenerCalled = true; });
    assert.doesNotThrow(() => EventBus.notify('anything'));
    assert.equal(goodListenerCalled, true, 'a throwing listener must not prevent later listeners from running');
    unThrower();
    unGood();
  });
});
