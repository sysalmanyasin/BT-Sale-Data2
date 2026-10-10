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
  assert.doesNotMatch(css, /^(body|html|:root)\b/m, 'must not restyle the rest of the app');
});
