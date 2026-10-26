// ══════════════════════════════════════════════════════════════════════
// DOM ACTIONS — delegated event handling that replaces inline onclick/oninput/onchange.
//
// Markup (what the HTML now says instead of onclick="showPage('home')"):
//
//   <button data-on-click="showPage" data-args='["home"]'>Home</button>
//   <input  data-on-input="calcTotal">                       (no args -> called with no args, like fn())
//   <input  data-on-change="setValue" data-args='[{"$":"value"}]'>   (this.value)
//   <div class="mbg" data-on-click="closeDay" data-self-only>        (only when the backdrop itself is hit)
//   <input  data-on-keydown="salAddColumnFromBar" data-key="Enter">  (only for the Enter key)
//   <button data-on-click="gauthSignOutAllDevices" data-confirm="Sign out everywhere?">
//   <button data-on-click="saveRow" data-stop>                       (stopPropagation before running)
//   <input  data-on-input="setCell" data-args='[3,{"$":"value"}]' data-then='[["recalc",[3]]]'>   (a(); b())
//
// Special argument tokens (JSON objects):  {"$":"this"} the element,  {"$":"value"} el.value,
//   {"$":"checked"} el.checked,  {"$":"event"} the DOM event.
//
// Where actions come from, in order:
//   1. registerActions({...}) — the preferred, module-scoped way for new code;
//   2. window.<name> / window.<Namespace>.<name> — the legacy globals every inline handler used,
//      so converted markup keeps working until each module registers its own actions.
//
// Why: no inline JS in markup lets us ship a strict Content-Security-Policy (no 'unsafe-inline'
// scripts), removes ~490 string-eval'd handlers, and makes every handler greppable by name.
//
// Use act()/actAttrs() from JS-generated HTML so arguments are always JSON + HTML escaped
// (an id containing a quote can no longer break out of the attribute).
//
// Depends only on shared/html.js (itself a leaf), so it can load first and can never join a cycle.
// ══════════════════════════════════════════════════════════════════════

import { escapeHtml as esc } from './html.js';

// Shared across module copies: index.html loads this file as `dom-actions.js?v=<hash>` while other modules import it
// bare, and a browser treats those as two different modules. Per-copy state meant two click listeners (every
// window-path action fired twice, so toggles opened and closed in the same tap) and two separate action registries.
const _G = typeof window !== 'undefined' ? window : globalThis;
const _state = (_G.__btDomActions ||= { registry: Object.create(null), warned: new Set(), installed: false });
const registry = _state.registry;
const warned = _state.warned;

/** Register named actions: registerActions({ closeDay, openDay, ... }). Later calls override earlier ones. */
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map || {})) {
    if (typeof fn === 'function') registry[name] = fn;
  }
}

/** Test/diagnostic helper: is this action resolvable right now? */
export function hasAction(name) { return resolve(name) !== null; }

function resolve(name) {
  if (registry[name]) return { fn: registry[name], ctx: null };
  const parts = String(name).split('.');
  let ctx = null;
  let cur = typeof window !== 'undefined' ? window : globalThis;
  for (const p of parts) {
    if (cur == null) return null;
    ctx = cur;
    cur = cur[p];
  }
  return typeof cur === 'function' ? { fn: cur, ctx } : null;
}

function decode(arg, el, ev) {
  if (arg && typeof arg === 'object' && typeof arg.$ === 'string') {
    switch (arg.$) {
      case 'this': return el;
      case 'value': return el.value;
      case 'checked': return el.checked;
      case 'event': return ev;
      default: return undefined;
    }
  }
  return arg;
}

function parseArgs(el) {
  const raw = el.getAttribute('data-args');
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [v];
  } catch (e) {
    console.error('[dom-actions] bad data-args on', el, e);
    return [];
  }
}

function call(el, ev, name, rawArgs) {
  const hit = resolve(name);
  if (!hit) {
    if (!warned.has(name)) { warned.add(name); console.error('[dom-actions] no action named "' + name + '"'); }
    return false;
  }
  const args = rawArgs.map((a) => decode(a, el, ev));
  try {
    const out = hit.fn.apply(hit.ctx || el, args);
    if (out && typeof out.catch === 'function') out.catch((e) => console.error('[dom-actions] ' + name + ' rejected', e));
    return true;
  } catch (e) {
    console.error('[dom-actions] ' + name + ' threw', e);
    return false;
  }
}

// data-then='[["recalc",[3]],["save",[]]]' — further calls run in order after the main action,
// and are skipped if an earlier one failed (same as `a(); b()` in an inline handler).
function parseThen(el) {
  const raw = el.getAttribute('data-then');
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch (e) { console.error('[dom-actions] bad data-then on', el, e); return []; }
}

function run(el, ev, name) {
  if (!call(el, ev, name, parseArgs(el))) return;
  for (const [n, a] of parseThen(el)) if (!call(el, ev, n, Array.isArray(a) ? a : [])) return;
}

// Non-bubbling events are handled with a capture listener and fire only for the element itself,
// exactly like the inline attribute did.
const BUBBLING = ['click', 'input', 'change', 'keydown', 'keyup', 'submit'];
const TARGET_ONLY = ['focus', 'blur'];

function handler(ev) {
  const attr = 'data-on-' + ev.type;
  const t = ev.target;
  let el = t && t.nodeType === 1 ? t : (t && t.parentElement) || null;
  const targetOnly = TARGET_ONLY.includes(ev.type);
  for (; el; el = el.parentElement) {
    if (el.hasAttribute(attr)) {
      const selfOnlyBlocked = el.hasAttribute('data-self-only') && ev.target !== el;
      const keyBlocked = el.hasAttribute('data-key') && ev.key !== el.getAttribute('data-key');
      if (!selfOnlyBlocked && !keyBlocked) {
        const msg = el.getAttribute('data-confirm');
        if (!(msg && !window.confirm(msg))) {
          if (el.hasAttribute('data-stop')) ev.stopPropagation();
          run(el, ev, el.getAttribute(attr));
          // inline handlers on an inner element that called stopPropagation() hid outer ones
          if (el.hasAttribute('data-stop')) return;
        }
      }
    }
    if (targetOnly) return;
  }
}

export function installDomActions(doc = document) {
  if (_state.installed) return;
  _state.installed = true;
  BUBBLING.forEach((t) => doc.addEventListener(t, handler));
  TARGET_ONLY.forEach((t) => doc.addEventListener(t, handler, true));
}

// ── helpers for JS-generated HTML ────────────────────────────────────────
/** Marker args for use inside act()/actAttrs(): arg.value, arg.checked, arg.self, arg.event */
export const arg = Object.freeze({
  self: { $: 'this' }, value: { $: 'value' }, checked: { $: 'checked' }, event: { $: 'event' },
});

/**
 * Attribute string for template literals:
 *   `<button ${act('click', 'openDay', id)}>`  ->  data-on-click="openDay" data-args="[&quot;2026-10-25&quot;]"
 * Options object as the first arg after the event:
 *   act('click', {stop:true, selfOnly:true, key:'Enter', confirm:'Sure?', then:[['recalc', 3]]}, 'fn', ...args)
 */
export function act(event, ...rest) {
  let opts = {};
  if (rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) && typeof rest[0].$ !== 'string') opts = rest.shift();
  const [name, ...args] = rest;
  let s = ' data-on-' + event + '="' + esc(name) + '"';
  if (args.length) s += ' data-args="' + esc(JSON.stringify(args)) + '"';
  if (opts.then && opts.then.length) s += ' data-then="' + esc(JSON.stringify(opts.then.map(([n, ...a]) => [n, a]))) + '"';
  if (opts.stop) s += ' data-stop';
  if (opts.selfOnly) s += ' data-self-only';
  if (opts.key) s += ' data-key="' + esc(opts.key) + '"';
  if (opts.confirm) s += ' data-confirm="' + esc(opts.confirm) + '"';
  return s;
}

// Built-in action: click another element (replaces onclick="document.getElementById('x').click()").
registerActions({
  // for `onclick="event.stopPropagation()"`-only elements: act('click', { stop: true }, 'noop')
  noop() {},
  clickElement(id) { const el = document.getElementById(id); if (el) el.click(); },
});

// Classic (non-module) scripts such as drive.js and dashboard-heatmap.js cannot `import`; they use
// window.BTDomActions.act(...) instead. Module code should always import from this file.
if (typeof window !== 'undefined') window.BTDomActions = Object.freeze({ act, arg, registerActions });

// Install as soon as the DOM can take listeners (document always exists for module scripts).
if (typeof document !== 'undefined') installDomActions(document);
