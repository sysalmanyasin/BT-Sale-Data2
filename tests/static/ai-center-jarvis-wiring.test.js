// The JARVIS layer must actually be loaded: after ai-center.css in index.html, and precached by the service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
test('jarvis stylesheet is linked after the base AI Center stylesheet', () => {
  const a = html.indexOf('css/ai-center.css'), b = html.indexOf('css/ai-center-jarvis.css');
  assert.ok(a > 0 && b > a);
});
test('jarvis stylesheet is precached and scoped to the AI Center page', () => {
  assert.match(sw, /\.\/css\/ai-center-jarvis\.css/);
  const css = readFileSync(new URL('../../css/ai-center-jarvis.css', import.meta.url), 'utf8');
  assert.match(css, /\.aic-page\.aic-jarvis\{/);
  assert.doesNotMatch(css, /^(html|:root)\b|^body(?!\.aic-open\b)/m, 'must not restyle the rest of the app (only body.aic-open, the AI page, is allowed)');
});
test('regression: long forecast values stack instead of squeezing their label to one letter per line', () => {
  const css = readFileSync(new URL('../../css/ai-center-jarvis.css', import.meta.url), 'utf8');
  assert.match(css, /\.aic-jarvis \.aic-wf \.aic-met\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.aic-jarvis \.aic-wf \.aic-met dd\{white-space:normal/);
});
test('priority: Business Systems sits directly under the summary on phone and desktop', () => {
  const css = readFileSync(new URL('../../css/ai-center-jarvis.css', import.meta.url), 'utf8');
  const tail = css.slice(css.lastIndexOf('priority: business first'));
  const order = id => Number((tail.match(new RegExp('#aic-' + id + '\\{order:(\\d+)\\}')) || [])[1]);
  assert.ok(order('sum') < order('sys') && order('sys') < order('att') && order('sys') < order('fleet') && order('sys') < order('actc'));
  assert.match(tail, /#aic-sys\{grid-column:1\/4;grid-row:2\}/);
  assert.match(tail, /#aic-att\{grid-column:1;grid-row:3\}/);
});
test('urgency: a pending approval moves the Action Center to the top on phone and desktop', () => {
  const css = readFileSync(new URL('../../css/ai-center-jarvis.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-pri=approvals\] #aic-actc\{order:0/);
  assert.match(css, /\[data-pri=approvals\] #aic-actc\{grid-column:1\/4;grid-row:1\}/);
});
