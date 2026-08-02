// ══════════════════════════════════════════════════════════════════════
// medicine-ai-info — Inventory Search PWA's "Ask AI" button
//
// POST { name, generic, company } → { info: string, cached: boolean }
//
// Same free-tier text-completion pattern as
// send-daily-whatsapp-briefing/index.ts: Groq first, Gemini as the
// fallback (both have usable free tiers). Set secrets via
// `supabase secrets set` — never hardcode keys here:
//   GROQ_API_KEY    — https://console.groq.com (free tier)
//   GEMINI_API_KEY  — https://aistudio.google.com/apikey (free tier)
// At least one of the two must be set.
//
// Results are cached in a small `medicine_ai_cache` table (see
// ../../medicine_ai_cache.sql — run that migration once) keyed by the
// generic name (falling back to product name), so the same medicine
// looked up by any device/user only calls the AI provider once every
// CACHE_DAYS days. This is what keeps a free-tier key viable across a
// whole pharmacy's worth of lookups. The cache is a pure optimization —
// if the table doesn't exist yet, this function still works, it just
// calls the AI provider every time.
//
// Deploy with `--no-verify-jwt` (or pass the anon key as this project
// already does client-side elsewhere) since Inventory Search has no
// login step of its own. See DEPLOY.md in this folder.
// ══════════════════════════════════════════════════════════════════════

const INV_SUPABASE_URL = 'https://vtcrdkqhuvxatclobsby.supabase.co';
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

// Service-role client for the cache table only (read/write past RLS).
// Falls back to null (cache disabled) if the secret isn't set.
function getServiceClient() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) return null;
  return { url: INV_SUPABASE_URL, key };
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
      max_tokens: 350,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error('Groq ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
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
        generationConfig: { maxOutputTokens: 350, temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) throw new Error('Gemini ' + res.status);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  let body: { name?: string; generic?: string; company?: string };
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

  const name = (body.name || '').trim();
  const generic = (body.generic || '').trim();
  const company = (body.company || '').trim();
  if (!name && !generic) return jsonResponse({ error: 'name or generic is required' }, 400);

  const cached = await readCache(name, generic);
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
