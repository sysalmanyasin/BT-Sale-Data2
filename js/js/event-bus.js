// ══════════════════════════════════════════════════════════════════════
// EVENT BUS  —  Floor 3 of the architecture (promoted out of repository.js)
//
// The single notification channel. Every Repository write announces
// itself here; Pages subscribe here to know when to re-render.
// Load order requirement: event-bus.js → repository.js → actions.js
// ══════════════════════════════════════════════════════════════════════
export const EventBus = (function () {
  const _listeners = [];

  function notify(eventName, payload) {
    _listeners.forEach(fn => {
      try { fn(eventName, payload); } catch (e) { /* one bad listener should not break others */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
    return function unsubscribe() {
      const idx = _listeners.indexOf(fn);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }

  return { notify, onChange };
})();

// Bridge onto window — remove once every consumer imports EventBus
// directly. conflict-ui.js in particular calls EventBus.onChange(...)
// immediately at its own top level (not inside any deferred callback),
// so it needs this bridge until it's converted to a module itself.
window.EventBus = EventBus;
