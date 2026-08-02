// ══════════════════════════════════════════════════════════════════════
// inventory-chat — Inventory Search PWA's floating chat assistant
//
// POST { messages: [{role:'user'|'assistant', content}], context: {
//   matches: [{name,generic,company,qty,price,supplier}],
//   lowStock: [...], outOfStock: [...], totalProducts: number
// } } → { reply: string }
//
// Two jobs in one assistant:
//  1. Inventory questions ("how much stock of X", "price of Y", "what's
//     low on X") — answered ONLY from the `context` block the client
//     built locally (via BTSearch against the already-synced product
//     list) and sent along with this request. The model is told never
//     to invent stock/price figures beyond what's in that block.
//  2. General medicine questions (drug class, dosing, interactions,
//     side effects) — answered from the model's own clinical knowledge,
//     same "reference only, not patient-specific advice" framing as
//     medicine-ai-info.
//
// No server-side inventory access here on purpose — the inventory
// project (vtcrdkqhuvxatclobsby) is a different Supabase project than
// this one, and there's no reason for this function to hold its own
// copy of stock data or credentials for it. The client already has the
// full synced product list in memory for its own search box; reusing
// that (as a compact per-turn context slice) is simpler and keeps
// exactly one source of truth for stock numbers.
//
// Stateless like the OpenAI/Groq chat APIs themselves — the client
// resends the whole conversation each turn, this function has no
// memory of its own and no per-user cache (unlike medicine-ai-info;
// conversations aren't cacheable/shareable across users the way a
// single medicine lookup is).
//
// Same Groq-first/Gemini-fallback pattern, same GROQ_API_KEY /
// GEMINI_API_KEY secrets as medicine-ai-info and
// send-daily-whatsapp-briefing. Deployed with verify_jwt=false, same
// reasoning as medicine-ai-info (no login step in this PWA).
// ══════════════════════════════════════════════════════════════════════

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

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type ProductSlice = { name?: string; generic?: string; company?: string; qty?: number; price?: number; supplier?: string };
type Context = { matches?: ProductSlice[]; lowStock?: ProductSlice[]; outOfStock?: ProductSlice[]; totalProducts?: number };

const MAX_HISTORY = 12; // last N messages, keeps the prompt (and cost) bounded

function buildSystemPrompt(ctx: Context): string {
  const fmt = (rows?: ProductSlice[]) =>
    (rows && rows.length)
      ? JSON.stringify(rows.map(r => ({
          name: r.name, generic: r.generic, company: r.company,
          qty: r.qty, price: r.price, supplier: r.supplier,
        })))
      : '[]';

  return [
    'You are the in-app assistant for a retail pharmacy\'s inventory search tool, talking to the pharmacy staff (not a patient).',
    'You have two jobs:',
    '(1) STOCK/PRICE QUESTIONS: answer ONLY using the JSON context blocks below, which were pulled a moment ago from this branch\'s live inventory. Never invent or estimate a quantity, price, or supplier that is not in these blocks. If the item the person is asking about is not present in MATCHING_PRODUCTS, say plainly that it did not turn up in this search and suggest they try the main search box with different wording — do not guess.',
    `MATCHING_PRODUCTS (best text matches against the latest message): ${fmt(ctx.matches)}`,
    `LOW_STOCK_SAMPLE (qty 1-5, up to 10 items, may not include the item asked about): ${fmt(ctx.lowStock)}`,
    `OUT_OF_STOCK_SAMPLE (qty 0, up to 10 items, may not include the item asked about): ${fmt(ctx.outOfStock)}`,
    `Total distinct products in this branch's inventory right now: ${ctx.totalProducts ?? 'unknown'}.`,
    '(2) GENERAL MEDICINE QUESTIONS: drug class, indications, dosing, side effects, interactions, etc. may be answered from your own clinical knowledge, same as a reference text. This is general reference information for a working pharmacist, not a prescribing recommendation for a specific patient.',
    'Keep replies short and conversational — a few sentences or a short list, plain text, no markdown headers. Ask a brief clarifying question only if the request is genuinely ambiguous.',
  ].join('\n');
}

async function callGroq(messages: unknown[]): Promise<string | null> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages,
      // Same fix as medicine-ai-info: this is a reasoning model whose
      // hidden thinking tokens count against max_tokens — low effort +
      // a generous budget so real replies don't get cut off.
      reasoning_effort: 'low',
      max_tokens: 700,
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error('Groq ' + res.status);
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim() || null;
  if (choice?.finish_reason === 'length') throw new Error('Groq response truncated');
  return content;
}

async function callGemini(messages: ChatMsg[], system: string): Promise<string | null> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
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

  let body: { messages?: ChatMsg[]; context?: Context };
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

  const messages = (body.messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  if (!messages.length) return jsonResponse({ error: 'messages is required' }, 400);

  const trimmed = messages.slice(-MAX_HISTORY);
  const system = buildSystemPrompt(body.context || {});
  const groqMessages = [{ role: 'system', content: system }, ...trimmed];

  let reply: string | null = null;
  let lastErr: unknown = null;

  try { reply = await callGroq(groqMessages); } catch (e) { lastErr = e; }
  if (!reply) {
    try { reply = await callGemini(trimmed, system); } catch (e) { lastErr = e; }
  }

  if (!reply) {
    return jsonResponse(
      { error: 'Chat failed (' + (lastErr instanceof Error ? lastErr.message : 'no provider key set') + ')' },
      502
    );
  }

  return jsonResponse({ reply });
});
