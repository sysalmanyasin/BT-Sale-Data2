// Specialist agents: one conversation, several focused "hats". Each turn the
// router picks the specialist whose domain the question is about; that decides
//   (a) which tools are offered (smaller prompt, fewer wrong tool picks) and
//   (b) a short domain briefing the server adds to the system prompt (by id only,
//       so the client can never inject arbitrary prompt text).
// 2+ matching domains → the Analyst, who gets all of them. Vague follow-ups stay
// with the previous specialist; a first vague message gets everything.
import { matchDomains, ALL_DOMAINS } from './router.js';

export const SPECIALISTS = Object.freeze({
  sales:     { id: 'sales',     label: 'Sales' },
  manager:   { id: 'manager',   label: 'Staff & money' },
  inventory: { id: 'inventory', label: 'Inventory' },
  str:       { id: 'str',       label: 'Stock transfers' },
  closing:   { id: 'closing',   label: 'Closing' },
  billing:   { id: 'billing',   label: 'Emergency billing' },
  documents: { id: 'documents', label: 'Notes & sheets' },
  analyst:   { id: 'analyst',   label: 'Analyst' },
  general:   { id: 'general',   label: 'Assistant' },
});

// "What needs my attention / morning briefing": one tool answers it, so offer only the app tools.
const BRIEFING = /\b(attention|briefing|brief me|morning|anything (i should|else|new)|what needs|need to know|catch me up|what.?s happening|status update)\b/i;

// Pure app questions (date, opening a page): only the app tools are needed.
const APP_ONLY = /\b(what('s| is) (the |today'?s )?(date|time|day)|today'?s date|current date|what day|(open|go to|take me to|navigate to|switch to) (the )?\w+ (page|screen|tab)|what pages)\b/i;

/** @returns {{id:string,label:string,domains:string[]}} */
export function pickSpecialist(userText, prev = null) {
  const text = String(userText || '');
  if (BRIEFING.test(text) || APP_ONLY.test(text)) return { ...SPECIALISTS.general, domains: [] };
  const hits = matchDomains(text);
  if (hits.length === 1) return { ...SPECIALISTS[hits[0]], domains: hits };
  if (hits.length > 1) return { ...SPECIALISTS.analyst, domains: hits };
  if (prev && prev.id && prev.id !== 'general' && Array.isArray(prev.domains) && prev.domains.length) return { ...prev };
  return { ...SPECIALISTS.general, domains: ALL_DOMAINS };
}

/**
 * True when the keyword router has nothing to go on: no domain words, no usable previous specialist, not a pure
 * app/briefing question. Only then is it worth one cheap model call to classify the message.
 */
export function needsModelRoute(userText, prev = null) {
  const text = String(userText || '').trim();
  if (text.length < 8 || BRIEFING.test(text) || APP_ONLY.test(text)) return false;
  if (matchDomains(text).length) return false;
  return !(prev && prev.id && prev.id !== 'general' && Array.isArray(prev.domains) && prev.domains.length);
}

export const ROUTABLE = Object.freeze(['sales', 'manager', 'inventory', 'str', 'closing', 'billing', 'documents']);

/** Specialist for a model-chosen domain list (validated against ROUTABLE). Null if nothing usable. */
export function specialistForDomains(domains) {
  const d = (Array.isArray(domains) ? domains : []).filter(x => ROUTABLE.includes(x)).slice(0, 2);
  if (!d.length) return null;
  return d.length === 1 ? { ...SPECIALISTS[d[0]], domains: d } : { ...SPECIALISTS.analyst, domains: d };
}
