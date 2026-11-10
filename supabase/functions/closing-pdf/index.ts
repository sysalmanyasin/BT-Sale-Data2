// supabase/functions/closing-pdf/index.ts
//
// Opens the PDF of a saved closing from the PRIVATE `closing-pdfs` bucket.
// The ntfy notification links here: GET ?key=2026-11-10_Morning&sig=<hmac>
// The link is signed (HMAC-SHA256 of the key with NOTIFY_SHARED_SECRET), so it cannot be
// guessed or edited to open other closings. On every click it creates a fresh 5-minute
// signed storage URL for the LATEST uploaded PDF and redirects to it, so the link keeps
// working even though the PDF is uploaded a few seconds after the notification is sent.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET = Deno.env.get("NOTIFY_SHARED_SECRET") ?? "";
const BUCKET = "closing-pdfs";

async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  if (!SECRET) return text("Not configured", 500);
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const sig = u.searchParams.get("sig") ?? "";
  if (!/^[A-Za-z0-9_.-]{3,80}$/.test(key) || !sig) return text("Bad request", 400);

  const expected = await hmacHex(SECRET, key);
  if (!safeEqual(expected, sig.toLowerCase())) return text("Forbidden", 403);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(`${key}.pdf`, 300);
  if (error || !data?.signedUrl) {
    return text("PDF is not uploaded yet. Please open this link again in a minute.", 404);
  }
  return Response.redirect(data.signedUrl, 302);
});
