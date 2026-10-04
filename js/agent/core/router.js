// Cheap, deterministic tool routing: offer the model only the tool groups the
// question is about. Sending all ~30 tool schemas on every step cost ~3-4k
// tokens per call and blew through free-tier tokens-per-minute limits.
// Unknown / vague questions fall back to the previous turn's groups, then to ALL
// groups, so routing can narrow the choice but never remove a capability.
const RULES = {
  sales: /\b(sale|sales|sold|selling|revenue|target|pace|daily|today|yesterday|month|year|cash|hbl|comp|customers?|best|worst|top|highest|lowest|total|compare|diff|entry|entries|day|days|bikri|\d{4})\b/i,
  manager: /\b(staff|employee|employees|salary|payslip|ledger|jazz|jazzcash|petty|expense|expenses|credit|owe|owes|owed|note|notes|payment|paid|pay|balance|salesman|cashier|incentive|attendance|advance|udhar|udhaar)\b/i,
  inventory: /\b(stock|inventory|medicine|medicines|product|products|reorder|expiry|supplier|item|items|cover|slow|dead|low|panadol|tablet|syrup)\b/i,
};
export const ALL_DOMAINS = ['sales', 'manager', 'inventory'];

/** @returns {string[]} domains to offer (always combined with 'app' by the caller) */
export function selectDomains(userText, prevDomains = null) {
  const t = String(userText || '');
  const hit = Object.entries(RULES).filter(([, re]) => re.test(t)).map(([d]) => d);
  if (hit.length) return hit;
  if (prevDomains && prevDomains.length) return prevDomains;
  return ALL_DOMAINS;
}
