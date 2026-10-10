import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const read = p => {
  if (!existsSync(p)) throw new Error(`Missing expected file: ${p}`);
  return readFileSync(p, 'utf8');
};
const replaceOnce = (text, needle, replacement, file) => {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`Expected anchor not found in ${file}: ${needle}`);
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Anchor is not unique in ${file}: ${needle}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
};

// Phase 1: compute every edit in memory. Nothing is written if any anchor fails.
const indexPath = 'index.html';
const swPath = 'sw.js';
let html = read(indexPath);
let sw = read(swPath);
const htmlHad = html.includes('css/ai-center-command-deck.css');
const swHad = sw.includes("'./css/ai-center-command-deck.css'");

if (!htmlHad) {
  const linkAnchor = '<link rel="stylesheet" href="css/mobile.css?v=20260824a">';
  html = replaceOnce(html, linkAnchor,
    `${linkAnchor}\n<link rel="stylesheet" href="css/ai-center-command-deck.css?v=20261010a">`, indexPath);
}
let next = null;
if (!swHad) {
  const shellAnchor = "  './css/ai-center-jarvis.css',";
  sw = replaceOnce(sw, shellAnchor, `${shellAnchor}\n  './css/ai-center-command-deck.css',`, swPath);
  const cache = sw.match(/const CACHE_NAME = 'bt-sales-v(\d+)\.(\d+)'/);
  if (!cache) throw new Error('Could not safely identify the service-worker cache version.');
  next = `bt-sales-v${Number(cache[1])}.${Number(cache[2]) + 1}`;
  sw = sw.replace(/const CACHE_NAME = 'bt-sales-v\d+\.\d+'/, `const CACHE_NAME = '${next}'`);
}

// Phase 2: write only what changed (re-running is a no-op).
if (!htmlHad) writeFileSync(indexPath, html);
if (!swHad) writeFileSync(swPath, sw);

console.log(htmlHad && swHad
  ? 'Already applied — nothing changed.'
  : `JARVIS Command Deck stylesheet integrated.${next ? ` Service-worker cache is now ${next}.` : ''}`);
console.log('Next: run npm test and visually inspect mobile + desktop before deploying.');
