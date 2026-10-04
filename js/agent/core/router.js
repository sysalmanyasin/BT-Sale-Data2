// Cheap, deterministic tool routing: offer the model only the tool groups the
// question is about. Sending all ~30 tool schemas on every step cost ~3-4k
// tokens per call and blew through free-tier tokens-per-minute limits.
// Unknown / vague questions fall back to the previous turn's groups, then to ALL
// groups, so routing can narrow the choice but never remove a capability.
// Keywords are deliberately SPECIFIC. Generic words ("month", "entry", "cash", "today",
// "medicine") appear in questions about every area and used to drag a second group in,
// sending simple staff questions to the Analyst. A 4-digit year counts as a sales cue.
const RULES = {
  sales: /\b(sale|sales|sold|selling|revenue|target|targets|pace|daily|comp|customers?|best|worst|top|highest|lowest|total|totals|compare|comparison|diff|bikri|20(1[5-9]|2\d|3[0-5]))\b/i,
  manager: /\b(staff|employee|employees|salary|payslip|ledger|jazz|jazzcash|petty|expense|expenses|credit|owe|owes|owed|note|notes|payment|paid|pay|balance|salesman|cashier|incentive|attendance|advance|udhar|udhaar)\b/i,
  inventory: /\b(stock|inventory|product|products|reorder|expiry|supplier|item|items|cover|slow|dead|panadol)\b/i,
};
export const ALL_DOMAINS = ['sales', 'manager', 'inventory'];

/** Groups whose keywords appear in the text (empty when nothing matches). */
export function matchDomains(userText) {
  const t = String(userText || '');
  return Object.entries(RULES).filter(([, re]) => re.test(t)).map(([d]) => d);
}

/** @returns {string[]} domains to offer (always combined with 'app' by the caller) */
export function selectDomains(userText, prevDomains = null) {
  const hit = matchDomains(userText);
  if (hit.length) return hit;
  if (prevDomains && prevDomains.length) return prevDomains;
  return ALL_DOMAINS;
}
