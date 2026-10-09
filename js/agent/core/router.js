// Cheap, deterministic tool routing: offer the model only the tool groups the
// question is about. Sending all ~30 tool schemas on every step cost ~3-4k
// tokens per call and blew through free-tier tokens-per-minute limits.
// Unknown / vague questions fall back to the previous turn's groups, then to ALL
// groups, so routing can narrow the choice but never remove a capability.
// Keywords are deliberately SPECIFIC. Generic words ("month", "entry", "cash", "today",
// "medicine") appear in questions about every area and used to drag a second group in,
// sending simple staff questions to the Analyst. A 4-digit year counts as a sales cue.
const RULES = {
  sales: /\b(sale|sales|sold|selling|revenue|target|targets|pace|daily|comp|customers?|best|worst|top|highest|lowest|total|totals|compare|comparison|diff|bikri|forecast|forecasts|projection|projected|weekday|weekdays)\b/i,
  manager: /\b(staff|employee|employees|salary|payslip|ledger|jazz|jazzcash|petty|expense|expenses|credit|owe|owes|owed|note|notes|payment|paid|pay|balance|salesman|cashier|incentive|attendance|advance|udhar|udhaar)\b/i,
  inventory: /\b(stock|inventory|product|products|reorder|expiry|supplier|item|items|cover|slow|dead|panadol)\b/i,
  str: /\b(str|strs|transfer|transfers|awaited|dispatch|dispatched|dispatching|in transit|zero.?dispatch|fill.?rate|short.?dispatch|shortfall)\b/i,
  closing: /\b(closing|closed|closings|shift|shifts|closing book)\b/i,
  billing: /\b(emergency|invoice|invoices|billing|bills?|refunds?|refunded|reconciled|unreconciled)\b/i,
  documents: /\b(sheets?|spreadsheets?|documents?|knowledge|policy|policies|sop|my notes|the notes|all notes|saved notes|notes?\s*(?:and|&)\s*sheets?)\b/i,
};
// Vague questions get the three core groups only; STR and Closing tools are offered when the
// question mentions them (keeps the tool list, and so the tokens per request, small).
export const ALL_DOMAINS = ['sales', 'manager', 'inventory'];

/** Groups whose keywords appear in the text (empty when nothing matches). */
// A bare year ("September 2026") is a sales cue ONLY when nothing else matched; with other
// cues it is just a date ("Mian Usman credit detail for September 2026" is a staff question).
const YEAR = /\b20(1[5-9]|2\d|3[0-5])\b/;

// "my notes", "saved notes" and "notes and sheets" mean the owner's Notes app (documents), not staff notes (manager).
const OWNER_NOTES = /\b(?:(?:my|the|all|saved) notes?|notes?\s*(?:and|&)\s*sheets?)\b/gi;

export function matchDomains(userText) {
  const t = String(userText || '');
  const hit = Object.entries(RULES).filter(([d, re]) => {
    if (d === 'manager' && RULES.documents.test(t)) return re.test(t.replace(OWNER_NOTES, ' '));
    return re.test(t);
  }).map(([d]) => d);
  return hit.length === 0 && YEAR.test(t) ? ['sales'] : hit;
}

/** @returns {string[]} domains to offer (always combined with 'app' by the caller) */
export function selectDomains(userText, prevDomains = null) {
  const hit = matchDomains(userText);
  if (hit.length) return hit;
  if (prevDomains && prevDomains.length) return prevDomains;
  return ALL_DOMAINS;
}
