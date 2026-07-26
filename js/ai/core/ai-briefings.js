// ══════════════════════════════════════════════════════════════════════
// AI DAILY BRIEFINGS — Cover page hero cards, one per domain.
//
// Same sync-cache / fire-and-forget-regen contract as ai-memory.js's
// aimBriefingGenerate(), so it's safe to call from a render function
// with zero awaits:
//   - aibGetBriefings() ALWAYS returns synchronously from a localStorage
//     cache (never a Promise).
//   - If today's cache is missing or `force` is passed, it kicks off ONE
//     background callAI() call (all three domains in a single request —
//     cheap on quota, and avoids three near-simultaneous calls racing
//     the same provider) that updates the cache for the NEXT read.
//   - A forced refresh may show yesterday's text once; the fresh version
//     appears on the next Cover render. Same trade-off ai-memory.js
//     already makes, for the same reason: keep every call site's
//     synchronous contract intact.
//
// Cache is keyed by calendar date (not a rolling staleness window like
// ai-memory.js's 6h) — briefings are meant to refresh once per day, not
// re-narrate the same day repeatedly.
// ══════════════════════════════════════════════════════════════════════

import { callAI } from './ai-client.js';

const _KEY = 'BT_AI_DailyBriefings_v1';
let _regenBusy = false;

function _todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _loadCache() {
  try {
    const raw = localStorage.getItem(_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function _saveCache(obj) {
  try { localStorage.setItem(_KEY, JSON.stringify(obj)); } catch (_) {}
}

// Reuses the same full-app summary ai-memory.js already narrates from —
// no separate data plumbing needed. getAppContextSummary is still
// window-bridged only (app-context.js), same bare-identifier pattern
// ai-memory.js already uses for it.
function _contextSummary() {
  return (typeof getAppContextSummary === 'function') ? getAppContextSummary() : '';
}

function _hasAppData() {
  const s = _contextSummary();
  return !!s && s.indexOf('No data loaded yet') !== 0 && s.indexOf('Data is loading') !== 0;
}

// Strip ```json fences etc. before parsing — models (incl. Gemini via
// the OpenAI-compat endpoint) sometimes wrap JSON in markdown anyway,
// even when told not to.
function _parseJsonLoose(raw) {
  try {
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (_) { return null; }
}

async function _regenerate() {
  if (_regenBusy) return;
  _regenBusy = true;
  try {
    const summary = _contextSummary();
    if (!summary) return;

    const prompt = [
      'You are a calm, plain-language briefing narrator for a retail pharmacy branch manager.',
      'From the data below, write THREE short items — one for Sales, one for Manager (staff/ledger/credit),',
      'one for Inventory. Each item is ONE sentence, mentions at most one or two concrete numbers already',
      'present in the data, and never invents figures. No recommendations, no next steps — state, don\'t advise.',
      'If a section genuinely has nothing notable today, its value should be the empty string "".',
      '',
      'Respond with ONLY raw JSON, no markdown fences, no preamble, in exactly this shape:',
      '{"sales":"...","manager":"...","inventory":"..."}',
      '',
      summary,
    ].join('\n');

    const raw = await callAI({
      kind: 'text',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.2,
    });
    const parsed = raw ? _parseJsonLoose(raw) : null;
    if (parsed) {
      _saveCache({
        date: _todayStr(),
        ts: Date.now(),
        sales: (parsed.sales || '').trim(),
        manager: (parsed.manager || '').trim(),
        inventory: (parsed.inventory || '').trim(),
      });
    }
  } catch (e) {
    // Leave any existing cache in place — yesterday's briefing beats none.
    console.warn('[ai-briefings] regeneration failed:', e);
  } finally {
    _regenBusy = false;
  }
}

/**
 * aibGetBriefings(force) — see SYNC CONTRACT above.
 * Returns { sales, manager, inventory, ts } from cache (fields may be
 * '' if the model had nothing notable, or absent entirely if there's no
 * cache yet), or null if there's no app data at all yet.
 */
export function aibGetBriefings(force) {
  if (!_hasAppData()) return null;

  const cached = _loadCache();
  const isToday = cached && cached.date === _todayStr();

  if (force || !isToday) _regenerate(); // fire-and-forget

  return isToday ? cached : null;
}

function _timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

export function aibTimeAgo(ts) { return _timeAgo(ts); }

// Bridge for classic-script consumers, same reasoning as ai-memory.js's
// footer — harmless even once every caller is a real module.
window.aibGetBriefings = aibGetBriefings;
window.aibTimeAgo = aibTimeAgo;
