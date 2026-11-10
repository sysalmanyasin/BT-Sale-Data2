// Embedding providers for the knowledge index. ONE provider is active at a time (AGENT_EMBED_PROVIDER,
// default 'gemini'): vectors from different models are never comparable, so the model id is stored with
// every row and search only compares like with like.
//
// Privacy: `nonTraining` decides whether SENSITIVE sources (staff notes) may be sent. Gemini's free tier may use
// prompts for training, so with Gemini only ordinary notes and sheets are indexed. Cloudflare Workers AI is
// treated as non-training (verify against Cloudflare's current terms before relying on it).
import { EMBED_DIM } from './agent-shared.js';

export type EmbedInfo = { id: 'gemini' | 'cloudflare'; model: string; nonTraining: boolean };
type Task = 'document' | 'query';

export function embedProviderInfo(): EmbedInfo | null {
  const want = (Deno.env.get('AGENT_EMBED_PROVIDER') || 'gemini').toLowerCase();
  if (want === 'cloudflare' && Deno.env.get('CF_ACCOUNT_ID') && Deno.env.get('CF_API_TOKEN'))
    return { id: 'cloudflare', model: 'cloudflare:bge-base-en-v1.5:' + EMBED_DIM, nonTraining: true };
  if (want === 'gemini' && Deno.env.get('GEMINI_API_KEY'))
    return { id: 'gemini', model: 'gemini:gemini-embedding-001:' + EMBED_DIM, nonTraining: false };
  return null;
}

/** Embeds up to 20 texts. Throws an Error with .status on failure. */
export async function embedTexts(info: EmbedInfo, texts: string[], task: Task): Promise<number[][]> {
  if (!texts.length) return [];
  if (texts.length > 20) throw Object.assign(new Error('embed batch too large'), { status: 400 });
  if (info.id === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
      body: JSON.stringify({ requests: texts.map(t => ({
        model: 'models/gemini-embedding-001', content: { parts: [{ text: t }] },
        taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBED_DIM,
      })) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw Object.assign(new Error('gemini embed ' + res.status + ': ' + (await res.text()).slice(0, 200)), { status: res.status });
    const data = await res.json();
    const out = (data.embeddings || []).map((e: { values: number[] }) => e.values);
    return checkVectors(out, texts.length);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${Deno.env.get('CF_ACCOUNT_ID')}/ai/run/@cf/baai/bge-base-en-v1.5`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('CF_API_TOKEN') },
    body: JSON.stringify({ text: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw Object.assign(new Error('cloudflare embed ' + res.status + ': ' + (await res.text()).slice(0, 200)), { status: res.status });
  const data = await res.json();
  return checkVectors(data?.result?.data || [], texts.length);
}

function checkVectors(v: unknown, n: number): number[][] {
  const ok = Array.isArray(v) && v.length === n && v.every(x => Array.isArray(x) && x.length === EMBED_DIM && x.every(y => typeof y === 'number' && Number.isFinite(y)));
  if (!ok) throw Object.assign(new Error('embedding response had the wrong shape'), { status: 502 });
  return v as number[][];
}
