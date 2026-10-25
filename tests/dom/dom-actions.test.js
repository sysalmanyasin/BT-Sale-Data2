// Behaviour of the delegated event dispatcher that replaced inline onclick/oninput/onchange.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

let mod, win, doc, calls, errors;

before(async () => {
  installDomEnv();
  win = globalThis.window; doc = globalThis.document;
  mod = await import('../../js/shared/dom-actions.js');
  mod.installDomActions(doc);
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  // keep a handle for cleanup
  globalThis.__origErr = origErr;
});

beforeEach(() => {
  calls = []; errors = [];
  doc.body.innerHTML = '';
  mod.registerActions({
    rec: (...a) => calls.push(a),
    stopper: (...a) => calls.push(['stopper', ...a]),
  });
});

const click = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const html = (s) => { doc.body.innerHTML = s; return doc.body; };

test('click calls the named action with JSON args', () => {
  html(`<button id="b" data-on-click="rec" data-args='["home",2,true,null]'>x</button>`);
  click(doc.getElementById('b'));
  assert.deepEqual(calls, [['home', 2, true, null]]);
});

test('no data-args means the action is called with no arguments', () => {
  html(`<button id="b" data-on-click="rec">x</button>`);
  click(doc.getElementById('b'));
  assert.deepEqual(calls, [[]]);
});

test('this / value / checked / event tokens are resolved at call time', () => {
  html(`<input id="i" value="42" type="checkbox" checked
          data-on-change="rec" data-args='[{"$":"this"},{"$":"value"},{"$":"checked"},{"$":"event"}]'>`);
  const i = doc.getElementById('i');
  i.dispatchEvent(new win.Event('change', { bubbles: true }));
  const [el, value, checked, ev] = calls[0];
  assert.equal(el, i); assert.equal(value, '42'); assert.equal(checked, true); assert.equal(ev.type, 'change');
});

test('a click on a child reaches the ancestor handler (inline handlers bubbled too)', () => {
  html(`<div id="p" data-on-click="rec" data-args='["parent"]'><span id="c">x</span></div>`);
  click(doc.getElementById('c'));
  assert.deepEqual(calls, [['parent']]);
});

test('inner and outer handlers both run, inner first', () => {
  html(`<div data-on-click="rec" data-args='["outer"]'><b id="c" data-on-click="rec" data-args='["inner"]'>x</b></div>`);
  click(doc.getElementById('c'));
  assert.deepEqual(calls, [['inner'], ['outer']]);
});

test('data-stop runs the inner handler and hides the outer one (like event.stopPropagation())', () => {
  html(`<div data-on-click="rec" data-args='["outer"]'><b id="c" data-on-click="stopper" data-stop>x</b></div>`);
  click(doc.getElementById('c'));
  assert.deepEqual(calls, [['stopper']]);
});

test('data-self-only fires for the element itself, not for clicks inside it', () => {
  html(`<div id="bg" data-on-click="rec" data-self-only><div id="in">x</div></div>`);
  click(doc.getElementById('in'));
  assert.deepEqual(calls, [], 'click inside the dialog must not close it');
  click(doc.getElementById('bg'));
  assert.deepEqual(calls, [[]]);
});

test('data-key filters keydown to one key', () => {
  html(`<input id="i" data-on-keydown="rec" data-key="Enter">`);
  const i = doc.getElementById('i');
  i.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.deepEqual(calls, []);
  i.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(calls, [[]]);
});

test('data-confirm gates the action on the user answer', () => {
  html(`<button id="b" data-on-click="rec" data-confirm="Sure?">x</button>`);
  win.confirm = () => false; click(doc.getElementById('b'));
  assert.deepEqual(calls, []);
  win.confirm = () => true; click(doc.getElementById('b'));
  assert.deepEqual(calls, [[]]);
});

test('actions resolve from window globals and dotted namespaces (legacy inline-handler behaviour)', () => {
  win.legacyFn = (...a) => calls.push(['legacy', ...a]);
  win.NS = { go(x) { calls.push(['ns', x, this === win.NS]); } };
  html(`<button id="a" data-on-click="legacyFn" data-args='[1]'></button><button id="b" data-on-click="NS.go" data-args='["z"]'></button>`);
  click(doc.getElementById('a')); click(doc.getElementById('b'));
  assert.deepEqual(calls, [['legacy', 1], ['ns', 'z', true]]);
});

test('registerActions wins over a window global of the same name', () => {
  win.dup = () => calls.push('window');
  mod.registerActions({ dup: () => calls.push('registry') });
  html(`<button id="b" data-on-click="dup"></button>`);
  click(doc.getElementById('b'));
  assert.deepEqual(calls, ['registry']);
});

test('an unknown action is logged once and never throws', () => {
  html(`<button id="b" data-on-click="doesNotExist"></button>`);
  click(doc.getElementById('b')); click(doc.getElementById('b'));
  assert.equal(errors.filter((e) => e.includes('doesNotExist')).length, 1);
});

test('a throwing action is contained and logged', () => {
  mod.registerActions({ boom: () => { throw new Error('x'); } });
  html(`<button id="b" data-on-click="boom"></button>`);
  assert.doesNotThrow(() => click(doc.getElementById('b')));
  assert.ok(errors.some((e) => e.includes('boom')));
});

test('focus/blur are target-only (they do not bubble, like the inline attribute)', () => {
  html(`<div data-on-focus="rec" data-args='["div"]'><input id="i" data-on-focus="rec" data-args='["input"]'></div>`);
  doc.getElementById('i').dispatchEvent(new win.FocusEvent('focus'));
  assert.deepEqual(calls, [['input']]);
});

test('built-in clickElement clicks another element by id', () => {
  html(`<input id="file"><button id="b" data-on-click="clickElement" data-args='["file"]'></button>`);
  let hit = 0; doc.getElementById('file').addEventListener('click', () => hit++);
  click(doc.getElementById('b'));
  assert.equal(hit, 1);
});

test('act() builds safe attributes: quotes and angle brackets cannot break out', () => {
  const evil = `x" onmouseover="alert(1)' <script>`;
  const attrs = mod.act('click', 'rec', evil, 7);
  html(`<button id="b"${attrs}>x</button>`);
  const b = doc.getElementById('b');
  assert.equal(b.attributes.length, 3, 'only id + data-on-click + data-args');
  click(b);
  assert.deepEqual(calls, [[evil, 7]]);
});

test('act() options: stop / selfOnly / key / confirm and arg tokens', () => {
  const a = mod.act('keydown', { key: 'Enter', stop: true, selfOnly: true, confirm: 'ok?' }, 'rec', mod.arg.value);
  assert.match(a, /data-key="Enter"/); assert.match(a, /data-stop/); assert.match(a, /data-self-only/);
  assert.match(a, /data-confirm="ok\?"/); assert.match(a, /&quot;\$&quot;:&quot;value&quot;/);
});
