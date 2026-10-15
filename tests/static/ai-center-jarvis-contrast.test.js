// WCAG 2.2 AA guard for the Command Deck theme. The whole palette is ONE token block in css/ai-center-deck.css; contrast is computed from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const deck = read('css/ai-center-deck.css');
const block = deck.match(/\.aic-page\.aic-jarvis,body\.aic-open \.aic-modal[^{]*\{([\s\S]*?)\n\}/); assert.ok(block, 'token block missing');
const T = Object.fromEntries([...block[1].matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})\b/g)].map(x => [x[1], x[2]]));
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every text token meets 4.5:1 on the card surfaces', () => {
  for (const t of ['text', 't2', 'muted', 'accent', 'green', 'amber', 'red', 'purple'])
    for (const s of ['bg', 'surface', 's2']) assert.ok(ratio(T[t], T[s]) >= 4.5, `--${t} on --${s} = ${ratio(T[t], T[s]).toFixed(2)}`);
});
test('white text on the brand button fill and the active tab is readable', () => {
  assert.ok(ratio('#FFFFFF', T['accent-dk']) >= 4.5, 'white on --accent-dk');
  assert.ok(ratio('#FFFFFF', '#1565d8') >= 4.5, 'white on the active tab');
});
test('text on a red (destructive) fill uses --surface and stays readable', () => { assert.ok(ratio(T.surface, T.red) >= 4.5); });
test('the palette lives in ONE file: the other ai-center sheets only use tokens (no hard-coded brand hex)', () => {
  const files = readdirSync(new URL('../../css/', import.meta.url)).filter(f => /^ai-center.*\.css$/.test(f) && f !== 'ai-center-deck.css');
  assert.ok(files.length >= 6);
  for (const f of files) {
    const css = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#20DDF5|#8b9bff|#7c8cff|#c084fc|#A78BFA|#080D18|#06070d|#111B2B|#0e1018/i, f + ' still carries the old palette');
  }
});
test('the DUA token block only aliases app tokens', () => {
  const m = read('css/ai-center-jarvis.css').match(/\.aic-page\.aic-jarvis\{([\s\S]*?)\n\}/); assert.ok(m);
  assert.doesNotMatch(m[1], /--j-[\w]+:\s*#/);
  assert.match(m[1], /--j-cy:var\(--accent\)/);
});
test('dialogs (mounted on body) get the same deck tokens and a visible focus ring', () => {
  assert.match(deck, /body\.aic-open \.aic-modal/);
  assert.match(read('css/ai-center-jarvis.css'), /body\.aic-open \.aic-modal :focus-visible\{outline:2px solid var\(--accent\)/);
});
