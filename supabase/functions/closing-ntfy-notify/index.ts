// supabase/functions/closing-ntfy-notify/index.ts
//
// Closing app (closing.duapharma.com) - ntfy only (WhatsApp removed).
// Called by the `trg_notify_admin_shift_saved_ins` / `_upd` DB triggers
// (via public.notify_admin_shift_saved) whenever a closing shift is saved.
// Sends the closing summary to a public ntfy.sh topic.
//
// Secrets (Project Settings -> Edge Functions -> Secrets):
//   NOTIFY_SHARED_SECRET  required, must match the Bearer token used by the trigger
//   NTFY_CLOSING_TOPIC    REQUIRED. Never commit the topic to the public repository.
//   NTFY_TOKEN            optional ntfy.sh access token (tk_...). When set, messages are sent as
//                         that account, so the daily quota counts against the account instead of
//                         the shared Supabase egress IP (avoids HTTP 429 quota errors).
//   NTFY_VARIANCE_ALERT   optional, variance (Rs.) at/above which priority = high (default 500)

const SHARED_SECRET = Deno.env.get("NOTIFY_SHARED_SECRET") ?? "";

const NTFY_URL       = "https://ntfy.sh/";
const NTFY_TOPIC     = Deno.env.get("NTFY_CLOSING_TOPIC") ?? "";
const NTFY_ALERT_AT  = parseFloat(Deno.env.get("NTFY_VARIANCE_ALERT") ?? "500") || 500;

/* Read per request and normalise: strips whitespace, surrounding quotes and an
   accidental leading "Bearer " so a pasted secret still works. */
function getNtfyToken(): string {
  let t = (Deno.env.get("NTFY_TOKEN") ?? "").trim();
  t = t.replace(/^["']+|["']+$/g, "").trim();
  t = t.replace(/^bearer\s+/i, "").trim();
  return t;
}

const SHIFT_LABEL: Record<string, string> = { N: "Night", M: "Morning", E: "Evening" };

function num(n: unknown): number {
  return typeof n === "number" ? n : parseFloat(String(n ?? 0)) || 0;
}
function rs(n: unknown): string {
  return "Rs. " + Math.round(num(n)).toLocaleString("en-PK");
}

/* All non-zero credit entries (named + tier + aux) as separate lines. */
function creditLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const named = Array.isArray(data.namedCredits) ? data.namedCredits : [];
  for (const o of named as any[]) {
    const v = num(o?.val);
    if (v !== 0) lines.push(`${o?.lbl || "Named Account"}: ${rs(v)}`);
  }
  const tiers = Array.isArray(data.tierCredits) ? data.tierCredits : [];
  for (const o of tiers as any[]) {
    const v = num(o?.val);
    if (v !== 0 && o?.name) lines.push(`${o.name}: ${rs(v)}`);
  }
  const aux = Array.isArray(data.auxCredits) ? data.auxCredits : [];
  for (const o of aux as any[]) {
    const v = num(o?.val);
    if (v !== 0) lines.push(`${o?.lbl || "Credit Entry"}: ${rs(v)}`);
  }
  return lines;
}

type Summary = {
  date: string; shiftLabel: string; netCash: string; shiftSale: string;
  variance: string; varianceAbs: number; bookBills: string; manualReturns: string;
  carriedCC: string; totalDeposits: string; openingCredit: string; totalCredit: string;
};

async function sendNtfy(s: Summary, d: Record<string, unknown>, key: string): Promise<string> {
  const credits = creditLines(d);
  const message = [
    `Net cash: ${s.netCash}`,
    `Target sale: ${s.shiftSale}`,
    `Variance: ${s.variance}`,
    ``,
    `Book Bills: ${s.bookBills}`,
    `Manual Returns: ${s.manualReturns}`,
    `Carried CC: ${s.carriedCC}`,
    `Total Deposits: ${s.totalDeposits}`,
    ``,
    `Opening Credit: ${s.openingCredit}`,
    ...(credits.length ? credits : ["No credit entries"]),
    `Total Credit: ${s.totalCredit}`,
  ].join("\n");

  const alert = s.varianceAbs >= NTFY_ALERT_AT;
  const token = getNtfyToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(NTFY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: `Closing - ${s.shiftLabel} ${s.date}`,
      message,
      priority: alert ? 4 : 3,
      tags: [alert ? "warning" : "white_check_mark", "moneybag"],
      // Re-saves of the same shift replace the earlier notification
      // instead of stacking duplicates (needs ntfy >= 2.14; ignored otherwise).
      sequence_id: key,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    // Log whether an access token was actually attached (never the token itself).
    console.error(`ntfy HTTP ${res.status} (auth header sent: ${token ? "yes, len " + token.length : "NO - NTFY_TOKEN empty/unset"}): ${body}`);
    throw new Error(`ntfy send failed (HTTP ${res.status}, auth ${token ? "sent" : "not sent"}): ${body}`);
  }
  return "ok";
}

/* Read-only diagnostic: reports whether NTFY_TOKEN is present and what ntfy.sh
   says about that account's tier and message quota. Sends NO notification and
   never returns the token. Reachable only with the shared secret. */
async function ntfyDiag(): Promise<Record<string, unknown>> {
  const token = getNtfyToken();
  const out: Record<string, unknown> = {
    token_present: !!token,
    token_length: token.length,
    token_prefix_ok: token.startsWith("tk_"),
    topic_set: !!NTFY_TOPIC,
  };
  if (!token) return out;
  try {
    const r = await fetch("https://ntfy.sh/v1/account", { headers: { Authorization: `Bearer ${token}` } });
    out.account_http = r.status;
    const txt = await r.text().catch(() => "");
    try {
      const a = JSON.parse(txt);
      out.account = {
        tier: a?.tier?.code ?? a?.tier ?? null,
        role: a?.role ?? null,
        messages_limit: a?.limits?.messages ?? null,
        messages_sent: a?.stats?.messages ?? null,
        messages_remaining: a?.stats?.messages_remaining ?? null,
      };
    } catch { out.account_raw = txt.substring(0, 200); }
  } catch (e) {
    out.account_error = (e as Error).message;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (!SHARED_SECRET || req.headers.get("authorization") !== `Bearer ${SHARED_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return new Response("Bad request", { status: 400 });

  if ((payload as { diag?: boolean }).diag === true) {
    return new Response(JSON.stringify(await ntfyDiag()), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // Fail closed: never fall back to a topic baked into the source.
  if (!NTFY_TOPIC) return new Response(JSON.stringify({ ntfy: "NTFY_CLOSING_TOPIC secret is not set" }), { status: 500 });

  const { key, date, shift, data } = payload as {
    key?: string; date?: string; shift?: string; data?: Record<string, unknown>;
  };
  const d = data || {};

  const isFinal = d.profileMode === "final";
  const shiftLabel = isFinal ? "Final Closing" : (SHIFT_LABEL[shift ?? ""] ?? shift ?? "-");

  const summary: Summary = {
    date: date ?? "-",
    shiftLabel,
    netCash: rs(d.outNetCash),
    shiftSale: rs(d.outNetSale),
    variance: `${rs(d.finalDiff)} (${d.finalDiffLabel || "Variance"})`,
    varianceAbs: Math.abs(num(d.finalDiff)),
    bookBills: rs(num(d.inBook1) + num(d.inBook2)),
    manualReturns: rs(num(d.posRet1) + num(d.posRet2) + num(d.posRet3)),
    carriedCC: rs(d.outPrevCC),
    totalDeposits: rs(d.outTotalF),
    openingCredit: rs(d.outPrevCredit),
    totalCredit: rs(d.outTotalE),
  };

  const seqKey = key || `${date}_${shift}`;
  try {
    await sendNtfy(summary, d, seqKey);
  } catch (e) {
    console.error((e as Error).message);
    return new Response(JSON.stringify({ ntfy: (e as Error).message }), { status: 502 });
  }
  return new Response(JSON.stringify({ ntfy: "ok" }), { status: 200 });
});
