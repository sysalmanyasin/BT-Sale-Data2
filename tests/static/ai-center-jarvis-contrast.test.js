// WCAG 2.2 AA guard computed from the REAL tokens in css/ai-center-jarvis.css (text >= 4.5:1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../css/ai-center-jarvis.css', import.meta.url), 'utf8');
const tok = n => { const m = css.match(new RegExp('--' + n + ':(#[0-9A-Fa-f]{6})')); assert.ok(m, 'token --' + n + ' missing'); return m[1]; };
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every text colour meets 4.5:1 on every JARVIS surface', () => {
  const surfaces = ['j-bg', 'j-s1', 'j-s2'].map(tok), texts = ['j-tx', 'j-mu', 'j-cy', 'j-ok', 'j-wn', 'j-er', 'j-vi'];
  for (const t of texts) for (const s of surfaces) assert.ok(ratio(tok(t), s) >= 4.5, `--${t} on ${s} = ${ratio(tok(t), s).toFixed(2)}`);
});
test('text on bright cyan fills is dark, never white', () => {
  assert.ok(ratio('#041018', tok('j-cy')) >= 7, 'dark-on-cyan');
  assert.ok(ratio('#FFFFFF', tok('j-cy')) < 3, 'sanity: white on cyan really is low contrast');
  assert.match(css, /aic button\.aic-p[^{]*\{color:#041018/);
  assert.match(css, /aic-seg button\.on[^{]*\{color:#041018/);
});
test('dialogs (mounted on body) get dark tokens and a visible focus ring', () => {
  assert.match(css, /body\.aic-open \.aic-modal\{/);
  assert.match(css, /body\.aic-open \.aic-modal :focus-visible\{outline:2px solid/);
});
