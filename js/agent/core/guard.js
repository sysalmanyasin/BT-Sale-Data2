// Shared deterministic safety checks used by change-tool previews.
// (An LLM "auditor" agent can be layered on later; these rules always apply.)
import { MON } from '../tools/_util.js';

export const STRONG_AMOUNT = 50000;   // Rs — at/above this, approval needs a second confirming tap
export const WARN_AMOUNT = 20000;

export const rsFmt = v => 'Rs ' + Math.round(Number(v) || 0).toLocaleString('en-PK');

export function amountChecks(amount) {
  const warnings = []; let strong = false;
  if (amount >= STRONG_AMOUNT) { strong = true; warnings.push('Large amount (' + rsFmt(amount) + '). Please double-check.'); }
  else if (amount >= WARN_AMOUNT) warnings.push('Above-usual amount (' + rsFmt(amount) + ').');
  return { warnings, strong };
}

/** iso = YYYY-MM-DD. Warns for future or far-past dates. */
export function dateChecks(iso, now = new Date()) {
  const warnings = [];
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return { warnings: ['Date looks invalid.'], strong: true };
  const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days > 1) warnings.push('Date is ' + days + ' days in the future.');
  if (days < -45) warnings.push('Date is ' + (-days) + ' days in the past.');
  return { warnings, strong: false };
}

export const isoToday = (now = new Date()) =>
  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

export const isoToApp = iso => { const [y, m, d] = iso.split('-'); return d + '/' + MON[+m - 1] + '/' + y; };
