// Reads one former stylesheet from the merged AI Center CSS files.
// css/ai-center.css       = ai-center.css + ai-center-jarvis.css
// css/ai-center-theme.css = ai-center-command-deck / -copilot / -v2 / -avatar / -deck (.css)
// Each is kept between "/* ===== BEGIN name ===== */" and "/* ===== END name ===== */" markers.
import { readFileSync } from 'node:fs';

const FILE_OF = {
  'ai-center.css': 'css/ai-center.css',
  'ai-center-jarvis.css': 'css/ai-center.css',
  'ai-center-command-deck.css': 'css/ai-center-theme.css',
  'ai-center-copilot.css': 'css/ai-center-theme.css',
  'ai-center-v2.css': 'css/ai-center-theme.css',
  'ai-center-avatar.css': 'css/ai-center-theme.css',
  'ai-center-deck.css': 'css/ai-center-theme.css',
};

export const SECTIONS = Object.keys(FILE_OF);

export function cssSection(name) {
  const file = FILE_OF[name];
  if (!file) throw new Error('unknown AI Center stylesheet section: ' + name);
  const all = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
  const begin = `/* ===== BEGIN ${name} ===== */\n`;
  const end = `/* ===== END ${name} ===== */`;
  const i = all.indexOf(begin);
  const j = all.indexOf(end);
  if (i < 0 || j < i) throw new Error(`section ${name} not found in ${file}`);
  return all.slice(i + begin.length, j);
}
