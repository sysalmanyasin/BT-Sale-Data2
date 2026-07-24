// ══════════════════════════════════════════════════════════════════════
// DOMAIN REGISTRY — AI + CommandHub Build Plan v2, Phase 5.1
//
// The extensibility point: a future feature is "one new domain file,
// one registerDomain() call, nothing else touched" — this file is what
// makes that true.
//
// A domain is any object shaped like js/ai/domains/inventory-domain.js:
//   { id, pageSynonyms?, quickActions?, getContextSummary?() }
// All fields except `id` are optional — a domain that only adds intent
// handlers (no nav synonyms, no quick actions, no context) is valid too.
// ══════════════════════════════════════════════════════════════════════

const _domains = [];

export function registerDomain(domain) {
  if (!domain || !domain.id) {
    console.warn('[registry] registerDomain() called without a domain.id — ignored.', domain);
    return;
  }
  if (_domains.some(d => d.id === domain.id)) {
    console.warn('[registry] domain "' + domain.id + '" already registered — ignoring duplicate.');
    return;
  }
  _domains.push(domain);
}

// Array of each domain's pageSynonyms object (undefined ones filtered
// out) — callers spread these into their own synonym table, e.g.:
//   const pages = { dashboard: [...], ...Object.assign({}, ...allPageSynonyms()) };
export function allPageSynonyms() {
  return _domains.map(d => d.pageSynonyms).filter(Boolean);
}

export function allQuickActions() {
  return _domains.flatMap(d => d.quickActions || []);
}

export function allContextSummaries() {
  return _domains
    .map(d => { try { return d.getContextSummary ? (d.getContextSummary() || '') : ''; } catch (e) { console.warn('[registry] getContextSummary failed for "' + d.id + '"', e); return ''; } })
    .filter(Boolean)
    .join('\n\n');
}

// Mostly for debugging / the Memory panel later.
export function listDomains() {
  return _domains.map(d => d.id);
}
