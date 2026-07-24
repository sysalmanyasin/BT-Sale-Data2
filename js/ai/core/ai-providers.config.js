// ══════════════════════════════════════════════════════════════════════
// AI PROVIDERS CONFIG — the one place to change a model ID, ever again.
//
// Data only, no logic. ai-client.js reads this and tries each entry for
// a given `kind` in order, falling through to the next on a retryable
// failure (see ai-client.js for what counts as retryable).
// ══════════════════════════════════════════════════════════════════════

export const AI_PROVIDERS = {
  text: [
    { provider: 'groq',     model: 'openai/gpt-oss-120b', endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
    { provider: 'cerebras', model: 'gpt-oss-120b',         endpoint: 'https://api.cerebras.ai/v1/chat/completions' },
  ],
  vision: [
    { provider: 'groq', model: 'qwen/qwen3.6-27b', endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
    // No second vision provider yet — Cerebras' only vision model (gemma-4-31b) is
    // Private Preview (waitlist), not GA. Do not wire it as a silent fallback; if/when
    // it goes GA, add one line here. Until then, vision has a single provider — a
    // failed vision call surfaces a clear "temporarily unavailable" message instead
    // of silently falling through to a text-only model (see _callGroqVision).
  ],
};
