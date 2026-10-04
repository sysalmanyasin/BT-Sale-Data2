// Name resolution shared by every tool that takes a person's name.
// Real data is messy: the credit sheet says "Mian Muhammad Usman" while people
// say "Mian Usman"; some stored names carry stray tabs/spaces ("\tMian Waqas",
// "Shamshair Ali "). Exact matching silently found nothing, and for WRITES a
// miss would have created a duplicate credit row. So matching is by words:
//   4 = staff id, 3 = identical name, 2 = all words of one name appear in the other,
//   1 = substring (3+ letters). Only the best tier is returned; identical names
//   (after cleaning) count once.
import { Repository } from '../../repository.js';

export const normName = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const words = s => normName(s).split(' ').filter(Boolean);

export function nameScore(name, query) {
  const n = normName(name), q = normName(query);
  if (!n || !q) return 0;
  if (n === q) return 3;
  const nw = words(n), qw = words(q);
  if (qw.every(w => nw.includes(w)) || nw.every(w => qw.includes(w))) return 2;
  if (q.length >= 3 && n.includes(q)) return 1;
  return 0;
}

/** Best-scoring items for `query` (deduplicated by cleaned name). */
export function bestByName(items, query, getName = x => x) {
  let best = 0, hits = [];
  for (const it of items) {
    const s = nameScore(getName(it), query);
    if (s > best) { best = s; hits = [it]; } else if (s === best && s > 0) hits.push(it);
  }
  const seen = new Set();
  return hits.filter(it => { const k = normName(getName(it)); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Staff-registry candidates for a typed name or staff id. */
export function staffCandidates(query) {
  const all = Repository.getStaff();
  const q = normName(query);
  const byId = all.filter(e => normName(e.staffId) === q);
  if (byId.length) return byId.slice(0, 1);
  return bestByName(all, query, e => e.name);
}

/** One staff member or a helpful error (ambiguity lists the real names). */
export function resolveStaff(query) {
  const hits = staffCandidates(query);
  if (!hits.length) throw new Error('No staff member matches "' + query + '". Use find_staff first.');
  if (hits.length > 1) throw new Error('"' + query + '" matches several staff: ' + hits.slice(0, 6).map(e => String(e.name).trim() + ' (' + e.staffId + ')').join(', ') + '. Ask the user which one.');
  return hits[0];
}

/**
 * The credit-sheet row for a person: tries the typed name, then the registry name.
 * @returns {{row:object|null, ambiguous:string[]|null}}
 */
export function findCreditRow(rows, query) {
  const tries = [query];
  try { const emp = staffCandidates(query); if (emp.length === 1) tries.push(emp[0].name); } catch (_) { /* registry optional */ }
  for (const t of tries) {
    const hits = bestByName(rows, t, r => r.name);
    if (hits.length === 1) return { row: hits[0], ambiguous: null };
    if (hits.length > 1) return { row: null, ambiguous: hits.slice(0, 6).map(r => String(r.name).trim()) };
  }
  return { row: null, ambiguous: null };
}
