// ══════════════════════════════════════════════════════════════════════
// BTSearch — Step 10 extraction: Fuzzy search engine
// Extracted from CommandHub. Standalone, no external dependencies.
// Consumed by (verified via grep): commandhub.js.
//
// Module-migration Stage B: now a real ES module. Window bridge below
// stays until commandhub.js is converted too.
// ══════════════════════════════════════════════════════════════════════

export const BTSearch = Object.freeze({
  norm(s) {
    return String(s || '').toLowerCase().trim();
  },

  score(text, query) {
    const t = BTSearch.norm(text);
    const q = BTSearch.norm(query);
    if (!q) return 50;
    if (t === q) return 100;
    if (t.startsWith(q)) return 95;
    if (t.includes(q)) return 85;
    const qWords = q.split(/\s+/);
    if (qWords.length > 1 && qWords.every(w => t.includes(w))) return 80;
    if (qWords.some(w => w.length >= 2 && t.includes(w))) return 60;
    // Fuzzy subsequence only for queries ≥3 chars to avoid noise
    if (q.length >= 3) {
      let ti = 0;
      for (let qi = 0; qi < q.length; qi++) {
        while (ti < t.length && t[ti] !== q[qi]) ti++;
        if (ti >= t.length) return 0;
        ti++;
      }
      return 35;
    }
    return 0;
  },

  filterAndRank(items, query, fields) {
    if (!query) return items;
    const scored = (items || []).map(item => {
      const best = (fields || ['title']).reduce((max, f) => {
        const s = BTSearch.score(item[f] || '', query);
        return s > max ? s : max;
      }, 0);
      return { item, score: best };
    });
    return scored
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);
  },
});

// TEMPORARY WINDOW BRIDGE — remove once commandhub.js (the only consumer,
// verified via grep) is converted to `import { BTSearch } from './bt-search.js'`.
window.BTSearch = BTSearch;
