// HARD BLOCKS — things the assistant may never do, whatever the model asks for, whatever the
// user approves, and even if someone later registers a matching tool by mistake. Enforced in
// code (registerTool refuses the registration, runTool refuses the call); the prompt is not relied on.
//   1. salary finalisation / closing / locking / paying out
//   2. refunds (they only ever go through the Emergency Billing screen and its DB function)
//   3. bulk or wildcard deletes
const SALARY_FINAL = /(finali[sz]e|finali[sz]ation|lock|close|release|disburse|pay_?out|payout|approve)[_-]?(the[_-]?)?(salary|salaries|payroll|payslip)|(salary|salaries|payroll|payslip)[_-]?(finali[sz]e|finali[sz]ation|lock|close|release|disburse|pay_?out|payout|approve)/i;
const REFUND = /refund/i;
const BULK = /(bulk|delete[_-]?all|clear[_-]?all|remove[_-]?all|purge|wipe|truncate|drop[_-]?table|reset[_-]?all)/i;
const IS_DELETE = /^(delete|remove|clear|erase)/i;

export const BLOCK_REASONS = Object.freeze({
  salary: 'Salary finalisation is never done by the assistant. Do it yourself on the Salary screen.',
  refund: 'Refunds are never done by the assistant. Use the Emergency Billing screen.',
  bulk: 'Bulk deletes are never done by the assistant. Delete records one at a time.',
});

/** Name-level rule (used at registration and again at call time). @returns {string|null} reason */
export function blockedByName(name) {
  const n = String(name || '');
  if (SALARY_FINAL.test(n)) return BLOCK_REASONS.salary;
  if (REFUND.test(n)) return BLOCK_REASONS.refund;
  if (BULK.test(n)) return BLOCK_REASONS.bulk;
  return null;
}

const WILD_KEYS = /^(all|everything|delete_all|wipe|purge|bulk)$/i;
/** Argument-level rule: delete-like tools must target exactly one record. @returns {string|null} reason */
export function blockedByArgs(name, args) {
  if (!IS_DELETE.test(String(name || ''))) return null;
  const a = args && typeof args === 'object' ? args : {};
  for (const [k, v] of Object.entries(a)) {
    if (Array.isArray(v) && v.length > 1) return BLOCK_REASONS.bulk;
    if (WILD_KEYS.test(k) && v && v !== 'false') return BLOCK_REASONS.bulk;
    if (typeof v === 'string' && /^(\*|all|everything)$/i.test(v.trim())) return BLOCK_REASONS.bulk;
  }
  return null;
}
