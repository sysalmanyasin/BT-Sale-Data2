// WCAG 2.2 AA guard for BT Intelligence, computed from the REAL brand tokens in css/variables.css (light AND dark theme).
// The page no longer forces its own dark/cyan palette: every colour in css/ai-center-*.css is an app token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const vars = read('css/variables.css');
const block = re => { const m = vars.match(re); assert.ok(m, 'token block missing: ' + re); return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,6})\b/g)].map(x => [x[1], x[2].length === 4 ? '#' + [...x[2].slice(1)].map(c => c + c).join('') : x[2]])); };
const light = block(/:root\{([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/) };
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [name, T] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: every text token meets 4.5:1 on the surfaces BT Intelligence uses`, () => {
    for (const t of ['text', 't2', 'muted', 'accent', 'green', 'amber', 'red'])
      for (const s of ['bg', 'surface', 's2']) assert.ok(ratio(T[t], T[s]) >= 4.5, `--${t} on --${s} (${name}) = ${ratio(T[t], T[s]).toFixed(2)}`);
  });
  test(`${name} theme: white text on the brand button fill (--accent-dk) is readable`, () => {
    assert.ok(ratio('#FFFFFF', T['accent-dk']) >= 4.5, `white on --accent-dk (${name}) = ${ratio('#FFFFFF', T['accent-dk']).toFixed(2)}`);
  });
  test(`${name} theme: text on a red (destructive) fill uses --surface and stays readable`, () => {
    assert.ok(ratio(T.surface, T.red) >= 4.5, `--surface on --red (${name}) = ${ratio(T.surface, T.red).toFixed(2)}`);
  });
}

test('BT Intelligence uses the brand theme only: no leftover cyan/violet/near-black palette in css/ai-center-*.css', () => {
  const files = readdirSync(new URL('../../css/', import.meta.url)).filter(f => /^ai-center.*\.css$/.test(f));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const css = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#20DDF5|#8b9bff|#7c8cff|#c084fc|#A78BFA|#080D18|#06070d|#111B2B|#0e1018|color-scheme:\s*dark/i, f + ' still carries the old dark/cyan palette');
  }
});
test('the JARVIS token block only aliases app tokens (so light/dark follow the app)', () => {
  const css = read('css/ai-center-jarvis.css');
  const m = css.match(/\.aic-page\.aic-jarvis\{([\s\S]*?)\n\}/); assert.ok(m);
  assert.doesNotMatch(m[1], /--j-[\w]+:\s*#/, 'a --j-* token is a hard-coded hex again');
  assert.match(m[1], /--j-cy:var\(--accent\)/);
  assert.match(m[1], /--j-bg:var\(--bg\)/);
});
test('dialogs (mounted on body) keep the app tokens and get a visible brand focus ring', () => {
  const css = read('css/ai-center-jarvis.css');
  assert.match(css, /body\.aic-open \.aic-modal :focus-visible\{outline:2px solid var\(--accent\)/);
});
