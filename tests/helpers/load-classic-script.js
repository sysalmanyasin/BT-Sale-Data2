// ══════════════════════════════════════════════════════════════════════
// SMOKE-TEST HELPER — runs one of the app's classic (non-module)
// <script defer src="js/...js"> files inside a real jsdom window via
// Node's vm module, so top-level `function foo(){}` / `var x` become
// genuine globals on that window — exactly like a browser would do for
// a classic script. This is what lets us call things like ui.js's
// bare-global `showPage()` from a test without rewriting the app code.
// ══════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export function loadClassicScript(relativePath, window) {
  const fullPath = path.join(REPO_ROOT, relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const context = window; // jsdom's window is usable directly as a vm context
  vm.createContext(context);
  vm.runInContext(source, context, { filename: fullPath });
  return window;
}
