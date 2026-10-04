// Pure helpers for the proactive in-app briefing: what the ✨ badge shows and
// which items the "Today" card lists. No DOM, no storage (callers pass both in).
export const MAX_CARD_ITEMS = 4;

/** Badge = number of warnings, hidden once the owner has seen at least that many today. */
export function badgeState(briefing, seen, todayStr) {
  const count = (briefing && briefing.attention ? briefing.attention.filter(a => a.level === 'warn').length : 0);
  const seenToday = seen && seen.date === todayStr ? Number(seen.count) || 0 : 0;
  return { count, show: count > 0 && count > seenToday, label: count > 9 ? '9+' : String(count) };
}

/** Warnings first (max 4), plus how many more were left out. */
export function cardItems(briefing) {
  const warns = (briefing && briefing.attention ? briefing.attention : []).filter(a => a.level === 'warn');
  return { items: warns.slice(0, MAX_CARD_ITEMS), more: Math.max(0, warns.length - MAX_CARD_ITEMS), clear: warns.length === 0 };
}
