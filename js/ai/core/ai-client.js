// ══════════════════════════════════════════════════════════════════════
// AI CLIENT — single entry point for every AI call in the app.
//
// callAI({ kind: 'text'|'vision', messages, maxTokens, temperature })
//
// Loops AI_PROVIDERS[kind] (see ai-providers.config.js) in order. On a
// retryable failure — HTTP 400, HTTP 429, or an error body naming
// `model_decommissioned` — moves on to the next configured entry instead
// of failing the whole call. Any other failure (auth, 5xx, etc.) is
// thrown immediately rather than masked by a silent fallback. Logs which
// provider actually served each request (console only — never user-facing).
//
// Key storage: each provider's key lives at localStorage key
// `BT_AI_Key_<provider>_v1`. The 'groq' provider also reads the existing
// `BT_Groq_Key_v1` slot (the one the ⚙ AI Settings panel in
// commandhub-page.js already writes to), so existing users need to do
// nothing. There is no Settings-panel UI for a Cerebras key yet — if
// that slot is empty, the cerebras entry is skipped silently rather than
// thrown, so a lone-Groq-key setup behaves exactly as before this file
// existed.
// ══════════════════════════════════════════════════════════════════════

import { AI_PROVIDERS } from './ai-providers.config.js';

const _LEGACY_GROQ_KEY = 'BT_Groq_Key_v1';

function _keyStorageName(provider) {
  return 'BT_AI_Key_' + provider + '_v1';
}

export function getProviderKey(provider) {
  try {
    const own = localStorage.getItem(_keyStorageName(provider));
    if (own) return own;
    if (provider === 'groq') return localStorage.getItem(_LEGACY_GROQ_KEY) || '';
    return '';
  } catch (_) { return ''; }
}

export function saveProviderKey(provider, key) {
  try {
    const name = _keyStorageName(provider);
    if (key) localStorage.setItem(name, key.trim());
    else localStorage.removeItem(name);
  } catch (_) {}
}

function _isRetryable(status, errBody) {
  if (status === 400 || status === 429) return true;
  const msg  = ((errBody && errBody.error && errBody.error.message) || '').toLowerCase();
  const code = ((errBody && errBody.error && errBody.error.code) || '').toLowerCase();
  return msg.indexOf('model_decommissioned') !== -1 || code.indexOf('model_decommissioned') !== -1;
}

/**
 * callAI({ kind, messages, maxTokens, temperature })
 * Returns the assistant message content (string) from whichever
 * configured provider succeeds first for `kind`.
 * Throws if no provider has a key set, or if every provider with a key
 * fails (last error wins on retryable exhaustion; a non-retryable
 * failure throws immediately without trying later entries).
 */
export async function callAI({ kind, messages, maxTokens, temperature }) {
  const entries = AI_PROVIDERS[kind];
  if (!entries || !entries.length) {
    throw new Error('No AI providers configured for "' + kind + '".');
  }

  let lastErr = null;
  let triedAny = false;

  for (const entry of entries) {
    const apiKey = getProviderKey(entry.provider);
    if (!apiKey) continue; // no key configured for this provider — skip, don't fail the loop
    triedAny = true;

    let res;
    try {
      res = await fetch(entry.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: entry.model,
          messages: messages,
          max_tokens: maxTokens || 700,
          temperature: (temperature === undefined ? 0.1 : temperature),
        }),
      });
    } catch (networkErr) {
      // Connectivity-level failure — treat as retryable, try the next provider.
      console.warn('[ai-client] ' + entry.provider + '/' + entry.model + ' network error, trying next provider…', networkErr);
      lastErr = networkErr;
      continue;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = entry.provider + ' ' + res.status + ': ' + ((errBody.error && errBody.error.message) || res.statusText);
      if (_isRetryable(res.status, errBody)) {
        console.warn('[ai-client] ' + entry.provider + '/' + entry.model + ' failed (' + res.status + '), trying next provider…');
        lastErr = new Error(msg);
        continue;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      lastErr = new Error(entry.provider + ' returned an empty response.');
      continue;
    }

    console.log('[ai-client] "' + kind + '" served by ' + entry.provider + '/' + entry.model);
    return content;
  }

  if (!triedAny) {
    throw new Error('No API key set for any "' + kind + '" provider. Tap the ⚙ gear in the AI page to add one.');
  }
  throw lastErr || new Error('All "' + kind + '" providers failed.');
}
