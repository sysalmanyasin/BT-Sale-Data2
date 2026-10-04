// The AUDITOR: a deterministic second reviewer for every change proposal.
// Per-tool previews catch problems with ONE change (big amount, duplicate row,
// far date). The auditor catches patterns ACROSS changes in a session:
//   A. burst      – 3+ changes in 10 minutes
//   B. repeat     – the identical change was already made in the last 30 minutes
//   C. cumulative – rupees changed this hour would pass Rs 200,000
// It can only ADD warnings / force the strong confirmation, never relax anything.
// (Deterministic on purpose: fast, free, no tokens, testable. An LLM reviewer could
// be layered on later without replacing these rules.)
import { logChange, recentChanges, clearSessionLog } from './session-log.js';

export const BURST_COUNT = 3, BURST_MS = 10 * 60000;
export const REPEAT_MS = 30 * 60000;
export const CUMULATIVE_LIMIT = 200000, CUMULATIVE_MS = 60 * 60000;

const canon = (tool, args) => tool + '|' + JSON.stringify(Object.keys(args || {}).sort().reduce((o, k) => { o[k] = args[k]; return o; }, {}));
const rs = v => 'Rs ' + Math.round(v).toLocaleString('en-PK');

export function reviewChange({ tool, args, preview }, now = Date.now()) {
  const warnings = []; let strong = false;
  const burst = recentChanges(BURST_MS, now);
  if (burst.length >= BURST_COUNT) { warnings.push('Auditor: ' + burst.length + ' changes were already made in the last 10 minutes. Slow down and double-check.'); strong = true; }
  const key = canon(tool, args);
  const same = recentChanges(REPEAT_MS, now).filter(c => c.key === key);
  if (same.length) { const mins = Math.max(1, Math.round((now - same[same.length - 1].at) / 60000)); warnings.push('Auditor: this exact change was already made ' + mins + ' min ago. Is this a repeat?'); strong = true; }
  const total = recentChanges(CUMULATIVE_MS, now).reduce((s, c) => s + c.amount, 0) + (Number(preview && preview.amount) || 0);
  if (total >= CUMULATIVE_LIMIT) { warnings.push('Auditor: changes this hour would total ' + rs(total) + '.'); strong = true; }
  return { warnings, strong };
}

export function recordChange({ tool, args, preview }, now = Date.now()) {
  logChange({ tool, key: canon(tool, args), amount: (preview && preview.amount) || 0, at: now });
}

export const clearSession = clearSessionLog;
