// ══════════════════════════════════════════════════════════════════════
// SMOKE-TEST HELPER — installs a fresh jsdom window as the Node global
// environment so the app's real ES modules (config.js, event-bus.js,
// repository.js, actions.js, print.js, ...) can be imported UNMODIFIED
// and behave the same way they do in the browser (they reference
// `window`/`document`/`localStorage` as bare globals, exactly like
// classic <script> code would).
//
// Usage:
//   import { installDomEnv } from '../helpers/dom-env.js';
//   installDomEnv();                 // call once, before importing app modules
//   const { Repository } = await import('../../js/repository.js');
// ══════════════════════════════════════════════════════════════════════
import { JSDOM } from 'jsdom';

export function installDomEnv(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, {
    url: 'https://bt.duapharma.com/index.html',
    pretendToBeVisual: true,
  });

  const { window } = dom;

  // Bridge the handful of globals the app's modules touch as bare
  // identifiers (same set a real browser would provide).
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.CustomEvent = window.CustomEvent;
  // Node (21+) ships its own read-only `navigator` global, so a plain
  // assignment throws ("only a getter"). redefine it instead, and make
  // this safe to call more than once per process (each test file's
  // `before` hook calls installDomEnv fresh).
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: false,
  });

  // A handful of files call a global `toast(...)` for UI notifications
  // (e.g. config.js's Proxy on an architecture violation). It's always
  // called defensively (`typeof toast === 'function'`), but we provide
  // a harmless stub so any code path that does fire is still exercised
  // rather than silently skipped.
  globalThis.toast = () => {};
  window.toast = globalThis.toast;

  return dom;
}

// Clears localStorage between tests so Repository/Actions smoke tests
// don't leak staff/daily/monthly records from one test into the next.
export function resetStorage() {
  if (globalThis.localStorage) globalThis.localStorage.clear();
}
