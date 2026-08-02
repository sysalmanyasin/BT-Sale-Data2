// ══════════════════════════════════════════════════════════════════════
// medicine-ai-info — Inventory Search PWA's "Ask AI" button
//
// POST { name, generic, company } → { info: string, cached: boolean }
//
// DEPLOYED at: BT SALE DATA / Closing project (wetbugzzchkghpzmowod) —
// NOT the inventory project (vtcrdkqhuvxatclobsby). That's deliberate:
// this Claude session only had MCP access to wetbugzzchkghpzmowod and
// DuaPharmaPos, not the inventory project, and the cache table below
// doesn't need to live next to inventory_products anyway — it's just
// AI text keyed by medicine name. inventory-search/app.js's
// AI_FUNCTION_URL points here accordingly.
//
// Same free-tier text-completion pattern as
// send-daily-whatsapp-briefing/index.ts: Groq first, Gemini as the
// fallback (both have usable free tiers). Set secrets via
// `supabase secrets set` — never hardcode keys here:
//   GROQ_API_KEY    — https://console.groq.com (free tier)
//   GEMINI_API_KEY  — https://aistudio.google.com/apikey (free tier)
// At least one of the two must be set, or every call 502s. Neither is
// set yet as of this deploy — see DEPLOY.md, only the secrets step
// remains.
//
// Results are cached in a `medicine_ai_cache` table (already created
// in this project — see ../../medicine_ai_cache.sql) keyed by the
// generic name (falling back to product name), so the same medicine
// looked up by any device/user only calls the AI provider once every
// CACHE_DAYS days. This is what keeps a free-tier key viable across a
// whole pharmacy's worth of lookups. The cache is a pure optimization —
// if the table doesn't exist yet, this function still works, it just
// calls the AI provider every time.
//
// Deployed with verify_jwt=false since Inventory Search has no login
// step of its own — it calls this function with only the public anon
// key. See DEPLOY.md in this folder.
// ══════════════════════════════════════════════════════════════════════

const CACHE_DAYS = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function cacheKeyFor(name: string, generic: string): string {
  return (generic || name || '').trim().toLowerCase();
}

// Cache table lives in THIS function's own Supabase project (the one
// it's deployed into), not the inventory project — it's just AI text
// keyed by medicine name, no reason it needs to live alongside
// inventory_products. Supabase auto-injects SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY as reserved env vars for every deployed
// Edge Function, so no extra secret needs to be set for this part.
function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url, key };
}

async function readCache(name: string, generic: string): Promise<string | null> {
  const svc = getServiceClient();
  if (!svc) return null;
  const cacheKey = cacheKeyFor(name, generic);
  if (!cacheKey) return null;
  try {
    const cutoff = new Date(Date.now() - CACHE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `${svc.url}/rest/v1/medicine_ai_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&updated_at=gte.${cutoff}&select=info&limit=1`,
      { headers: { apikey: svc.key, Authorization: 'Bearer ' + svc.key } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.info || null;
  } catch (e) { return null; }
}

async function writeCache(name: string, generic: string, info: string): Promise<void> {
  const svc = getServiceClient();
  if (!svc) return;
  const cacheKey = cacheKeyFor(name, generic);
  if (!cacheKey) return;
  try {
    await fetch(`${svc.url}/rest/v1/medicine_ai_cache`, {
      method: 'POST',
      headers: {
        apikey: svc.key,
        Authorization: 'Bearer ' + svc.key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ cache_key: cacheKey, info, updated_at: new Date().toISOString() }),
    });
  } catch (e) { /* best-effort — a cache miss next time just costs one more AI call */ }
}

function buildPrompt(name: string, generic: string, company: string): string {
  return [
    'You are a concise clinical-reference assistant for a working retail pharmacist.',
    `Give a factual overview of the medicine "${name}"${generic ? ` (generic: ${generic})` : ''}${company ? `, manufactured by ${company}` : ''}.`,
    'Cover, briefly: drug class, main indications/uses, typical adult dosage form notes, common side effects, and key contraindications or interactions.',
    'Plain text only, no markdown, no headers — short paragraphs or a simple dash list, under 180 words total.',
    'This is general reference information for a pharmacist, not a prescribing recommendation for a specific patient — do not address a patient directly and do not invent brand-specific dosing you are not confident about.',
  ].join(' ');
}

async function callGroq(prompt: string): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      // openai/gpt-oss-120b is a reasoning model — its hidden
      // chain-of-thought tokens count against max_tokens too. At
      // max_tokens:350/default ('medium') reasoning effort, the budget
      // was getting eaten by reasoning before any of the actual answer
      // came out, so replies were arriving cut off mid-sentence (and
      // then getting cached that way for 30 days). Low effort leaves
      // less for reasoning to consume, and a much bigger budget gives
      // the real answer room to finish.
      reasoning_effort: 'low',
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error('Groq ' + res.status);
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim() || null;
  // Model ran out of token budget mid-answer — don't return/cache a
  // truncated fragment, treat it as a failure so the caller can fall
  // back to Gemini instead.
  if (choice?.finish_reason === 'length') throw new Error('Groq response truncated');
  return content;
}

async function callGemini(prompt: string): Promise<string | null> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) throw new Error('Gemini ' + res.status);
  const data = await res.json();
  const cand = data.candidates?.[0];
  const content = cand?.content?.parts?.[0]?.text?.trim() || null;
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('Gemini response truncated');
  return content;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  let body: { name?: string; generic?: string; company?: string; force?: boolean };
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

  const name = (body.name || '').trim();
  const generic = (body.generic || '').trim();
  const company = (body.company || '').trim();
  if (!name && !generic) return jsonResponse({ error: 'name or generic is required' }, 400);

  const cached = body.force ? null : await readCache(name, generic);
  if (cached) return jsonResponse({ info: cached, cached: true });

  const prompt = buildPrompt(name, generic, company);
  let info: string | null = null;
  let lastErr: unknown = null;

  try { info = await callGroq(prompt); } catch (e) { lastErr = e; }
  if (!info) {
    try { info = await callGemini(prompt); } catch (e) { lastErr = e; }
  }

  if (!info) {
    return jsonResponse(
      { error: 'AI lookup failed (' + (lastErr instanceof Error ? lastErr.message : 'no provider key set') + ')' },
      502
    );
  }

  await writeCache(name, generic, info);
  return jsonResponse({ info, cached: false });
});
