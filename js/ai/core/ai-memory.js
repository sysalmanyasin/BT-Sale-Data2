// ══════════════════════════════════════════════════════════════════════
// AI MEMORY — Phase 1 rebuild (AI + CommandHub Build Plan v2)
//
// Scope, per the build plan: a feedback mirror on Candela, not an
// operator. This file only does two things:
//   1. aimBriefingGenerate(force) — a one-paragraph, plain-language
//      narration of getAppContextSummary(), cached and regenerated via
//      one callAI({kind:'text'}) call.
//   2. aimOpenPanel() — a read-only sheet showing the last briefing text
//      and the saved AIInstructions list.
//
// No facts/rules/corrections/voice-log system here — that was the old
// (pre-stub) ai-memory.js's feature set, and is out of scope for this
// rebuild. knowledge-sheet.js's "Memory" tile copy still advertises that
// older feature set; flagged separately, not changed here since it isn't
// part of this file.
//
// SYNC CONTRACT — this is the important bit: every call site in the app
// (ai-bridge.js, commandhub-page.js, dashboard-insights.js, index.html)
// calls `aimBriefingGenerate()` synchronously and expects a string (or
// null) back immediately — none of them awaits a Promise. But the only
// way to produce the narration is one async callAI() network call. So:
//   - aimBriefingGenerate() ALWAYS returns synchronously, from a
//     localStorage cache — it never returns a Promise.
//   - When the cache is missing, stale (>6h), or `force` is passed, it
//     kicks off an async regeneration in the background (fire-and-
//     forget) that updates the cache for the NEXT read. It does not
//     block, and does not retry the return value of THIS call.
//   - Net effect: a `force`-ed "give me briefing" ask may still show the
//     previous (stale) text once, with the fresh paragraph appearing on
//     the following read (next dashboard load / next panel open / next
//     ask). That's a deliberate trade-off to keep every existing call
//     site's synchronous contract intact with zero call-site changes.
// ══════════════════════════════════════════════════════════════════════

import { callAI } from './ai-client.js';

const _BRIEF_KEY       = 'BT_AI_Briefing_v1';
const _BRIEF_STALE_MS  = 6 * 60 * 60 * 1000; // 6 hours
let   _briefRegenBusy  = false;

function _briefLoadCache() {
  try {
    const raw = localStorage.getItem(_BRIEF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function _briefSaveCache(text) {
  try { localStorage.setItem(_BRIEF_KEY, JSON.stringify({ text: text, ts: Date.now() })); } catch (_) {}
}

// getAppContextSummary (app-context.js) isn't a real ES export yet — it's
// window-bridged, same as ai-bridge.js already reads it (see that file's
// header comment). Bare identifier so it resolves via the global either way.
function _briefContextSummary() {
  return (typeof getAppContextSummary === 'function') ? getAppContextSummary() : '';
}

function _briefHasAppData() {
  const summary = _briefContextSummary();
  // Mirror getAppContextSummary's own "nothing to summarize" signals
  // rather than re-deriving MONTHLY/DAILY length checks here.
  return !!summary
    && summary.indexOf('No data loaded yet') !== 0
    && summary.indexOf('Data is loading') !== 0;
}

async function _briefRegenerate() {
  if (_briefRegenBusy) return; // one in-flight regeneration at a time
  _briefRegenBusy = true;
  try {
    const summary = _briefContextSummary();
    if (!summary) return;

    const prompt = [
      'You are a calm, plain-language daily-briefing narrator for a retail pharmacy branch manager.',
      'Write ONE short paragraph (3-5 sentences) narrating the current state of the business from the',
      'data below. No headers, no bullet points, no markdown. Mention only the one or two most notable',
      'numbers — do not list everything. Do not invent numbers that aren\'t in the data. Do not recommend',
      'actions or next steps — narrate the current state only.',
      '',
      summary,
    ].join('\n');

    const raw = await callAI({
      kind: 'text',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.3,
    });
    if (raw) _briefSaveCache(raw.trim());
  } catch (e) {
    // Leave any existing cache in place — a stale-but-present briefing
    // beats wiping it out over a transient AI/network failure.
    console.warn('[ai-memory] briefing regeneration failed:', e);
  } finally {
    _briefRegenBusy = false;
  }
}

/**
 * aimBriefingGenerate(force) — see SYNC CONTRACT above. Always
 * synchronous. Returns null if there's no app data yet at all (distinct
 * from "no AI cache yet", which instead returns the last cached text —
 * or triggers a background regen if there's none).
 */
function aimBriefingGenerate(force) {
  if (!_briefHasAppData()) return null;

  const cached  = _briefLoadCache();
  const isStale = !cached || (Date.now() - cached.ts) > _BRIEF_STALE_MS;

  if (force || isStale) _briefRegenerate(); // fire-and-forget

  return cached ? cached.text : null;
}

function _aimTimeAgo(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

// ══════════════════════════════════════════════════════════════════════
// MEMORY PANEL — read-only sheet: last briefing + saved AIInstructions
// ══════════════════════════════════════════════════════════════════════
function aimOpenPanel() {
  const existing = document.getElementById('aim-panel-sheet');
  if (existing) existing.remove();

  const cached = _briefLoadCache();
  const briefHtml = (cached && cached.text)
    ? '<div style="font-size:13px;line-height:1.6;color:#0f172a">' + cached.text.replace(/</g, '&lt;') + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:6px">Updated ' + _aimTimeAgo(cached.ts) + '</div>'
    : '<div style="font-size:12px;color:#94a3b8">No briefing generated yet. Ask "give me briefing" in the AI chat, or check back shortly.</div>';

  // AIInstructions (ai-instructions.js) is still a classic-script global —
  // bare identifier, guarded, same pattern as getAppContextSummary above.
  const instructions = (typeof AIInstructions !== 'undefined') ? AIInstructions.getActive() : [];
  const shown = instructions.slice(0, 12);
  const instrHtml = shown.length
    ? shown.map(function (i) {
        return '<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#334155">' + (i.text || '').replace(/</g, '&lt;') + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:#94a3b8">No saved instructions yet.</div>';
  const moreCount = Math.max(0, instructions.length - shown.length);

  const sheet = document.createElement('div');
  sheet.id = 'aim-panel-sheet';
  sheet.style.cssText = [
    'position:fixed;inset:0;z-index:22000;',
    'background:rgba(15,23,42,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
    'display:flex;align-items:flex-end;justify-content:center;',
    'opacity:0;transition:opacity .18s ease;',
  ].join('');

  sheet.innerHTML = [
    '<div style="width:100%;max-width:480px;background:#fff;border-radius:22px 22px 0 0;',
      'max-height:82vh;display:flex;flex-direction:column;',
      'box-shadow:0 -8px 40px rgba(0,0,0,.18);',
      'transform:translateY(20px);transition:transform .22s cubic-bezier(.34,1.2,.64,1);" id="aim-panel-inner">',

      '<div style="display:flex;justify-content:center;padding:12px 0 4px;flex-shrink:0">',
        '<div style="width:40px;height:4px;border-radius:3px;background:#e2e8f0"></div>',
      '</div>',

      '<div style="padding:8px 20px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">',
        '<div>',
          '<div style="font-size:17px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:8px"><span style="font-size:20px">\u{1F9E0}</span> Memory</div>',
          '<div style="font-size:11.5px;color:#64748b;margin-top:2px">Today\u2019s briefing &amp; what you\u2019ve taught the AI</div>',
        '</div>',
        '<button onclick="aimClosePanel()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;line-height:1">\u2715</button>',
      '</div>',

      '<div style="overflow-y:auto;padding:16px 20px 8px;flex:1">',
        '<div style="font-size:11px;font-weight:700;color:#7c3aed;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">\u{1F4CB} Daily Briefing</div>',
        briefHtml,

        '<div style="height:1px;background:#f1f5f9;margin:18px 0"></div>',

        '<div style="font-size:11px;font-weight:700;color:#1e40af;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">\u{1F916} Saved Instructions (' + instructions.length + ')</div>',
        instrHtml,
        moreCount > 0 ? ('<div style="font-size:11.5px;color:#94a3b8;margin-top:6px">+' + moreCount + ' more</div>') : '',
      '</div>',

      '<div style="padding:12px 20px calc(14px + env(safe-area-inset-bottom,0));border-top:1px solid #f1f5f9;flex-shrink:0">',
        '<button onclick="aimClosePanel();setTimeout(function(){if(typeof ainOpen===\'function\')ainOpen()},120)" style="',
          'width:100%;padding:11px;border-radius:10px;border:1.5px solid #c4b5fd;background:#f5f3ff;',
          'color:#6d28d9;font-size:13px;font-weight:700;cursor:pointer">Manage Instructions \u2192</button>',
      '</div>',

    '</div>',
  ].join('');

  sheet.addEventListener('click', function (e) { if (e.target === sheet) aimClosePanel(); });
  document.body.appendChild(sheet);

  requestAnimationFrame(function () {
    sheet.style.opacity = '1';
    const inner = document.getElementById('aim-panel-inner');
    if (inner) inner.style.transform = 'translateY(0)';
  });

  // Read-only sheet — no spinner, no blocking. But if the cache is
  // missing/stale, kick a background regen so the NEXT open is fresh.
  if (_briefHasAppData()) {
    const cachedNow = _briefLoadCache();
    const staleNow  = !cachedNow || (Date.now() - cachedNow.ts) > _BRIEF_STALE_MS;
    if (staleNow) _briefRegenerate();
  }
}

function aimClosePanel() {
  const sheet = document.getElementById('aim-panel-sheet');
  if (!sheet) return;
  sheet.style.opacity = '0';
  const inner = document.getElementById('aim-panel-inner');
  if (inner) inner.style.transform = 'translateY(20px)';
  setTimeout(function () { if (sheet.parentNode) sheet.remove(); }, 200);
}

// Bridge for classic-script consumers (ai-bridge.js's own bare-identifier
// `typeof aimBriefingGenerate` checks, commandhub-page.js, dashboard-insights.js,
// index.html's onclick, knowledge-sheet.js) — this file is now a real ES
// module (needs `import callAI`), so nothing here is implicitly global.
window.aimBriefingGenerate = aimBriefingGenerate;
window.aimOpenPanel = aimOpenPanel;
window.aimClosePanel = aimClosePanel;
