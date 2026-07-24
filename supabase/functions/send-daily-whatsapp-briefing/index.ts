// ══════════════════════════════════════════════════════════════════════
// send-daily-whatsapp-briefing — Phase 4.2/4.3 (AI + CommandHub Build Plan v2)
//
// Scheduled once daily at closing time (set up as a Supabase Cron job —
// see DEPLOY.md in this folder; this file does not schedule itself).
//
// Steps: read live Sales (Closing project) + Inventory (Audit Hub
// project) → js/shared/summary-calc.js (the SAME pure functions Cover
// Dashboard's Phase 3 doughnut uses) → one text-completion call for a
// paragraph → POST to WhatsApp Cloud API.
//
// SECRETS (set via `supabase secrets set`, never in this file):
//   GROQ_API_KEY            — text completion (see ai-providers.config.js;
//                              same model, server-side key instead of the
//                              browser's localStorage one)
//   CEREBRAS_API_KEY        — optional second text provider, same fallback
//                              order as ai-client.js
//   WHATSAPP_TOKEN          — Meta permanent access token
//   WHATSAPP_PHONE_NUMBER_ID — Meta phone number ID (the sender)
//   WHATSAPP_RECIPIENT       — E.164 number to send to (e.g. 923001234567)
//   WHATSAPP_TEMPLATE_NAME   — see the WhatsApp template note below
//
// The two Supabase projects read here (Closing's, Audit Hub's) use the
// same anon/publishable keys already hardcoded client-side in
// closing-bridge.js / inventory-bridge.js / stockledger.js — RLS, not
// key secrecy, is what scopes access (see those files' own header
// notes), so duplicating them here is not a new exposure.
//
// ── WHATSAPP TEMPLATE REQUIREMENT — READ BEFORE DEPLOYING ──────────────
// This is a business-initiated message (the branch didn't message you
// first in the last 24h), so Meta requires a pre-approved Message
// Template — free-form text via /messages will be REJECTED outside an
// open 24h customer-service window. You need to:
//   1. Create a template in Meta Business Manager > WhatsApp Manager
//      (category: Utility), with one {{1}} body variable for the
//      generated paragraph.
//   2. Wait for Meta's approval (usually minutes to ~1 day).
//   3. Set WHATSAPP_TEMPLATE_NAME to its exact name.
// The send call below is written for the template-message shape
// (`type: "template"`). If you'd rather test with a free-form message
// first (only works within 24h of the recipient messaging your
// business number), swap _sendWhatsApp's body for the commented
// "session message" variant lower in this file.
// ══════════════════════════════════════════════════════════════════════

import {
  computeInventoryBuckets,
  normalizeInventoryRow,
  computeInventoryHealth,
  computeClosingTotal,
  inventoryHealthLine,
} from '../../../js/shared/summary-calc.js';

const CLOSING_SUPABASE_URL      = 'https://wetbugzzchkghpzmowod.supabase.co';
const CLOSING_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

const INVENTORY_SUPABASE_URL      = 'https://vtcrdkqhuvxatclobsby.supabase.co';
const INVENTORY_SUPABASE_ANON_KEY = 'sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy';

const SHIFT_ORDER = ['Night', 'Morning', 'Evening']; // same convention as closing-bridge.js

function _todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _fmt(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-PK');
}

// ── 1. Sales — read today's 3 shift rows from Closing's `sheets` table.
// Mirrors closing-bridge.js's _summarize() exactly (same status/netSale
// derivation), just a direct REST read instead of the supabase-js client.
async function _fetchTodaysShifts(): Promise<Array<{ shift: string; status: string; netSale?: number }>> {
  const today = _todayISO();
  const keys = SHIFT_ORDER.map(s => today + '_' + s);
  const url = CLOSING_SUPABASE_URL + '/rest/v1/sheets?key=in.(' + keys.map(k => '"' + k + '"').join(',') + ')&select=key,data';
  const res = await fetch(url, {
    headers: { apikey: CLOSING_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CLOSING_SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new Error('Closing sheets fetch failed: ' + res.status);
  const rows: Array<{ key: string; data: any }> = await res.json();
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.data]));

  return SHIFT_ORDER.map(shift => {
    const rec = byKey[today + '_' + shift];
    if (!rec) return { shift, status: 'pending' };
    if (rec.draft && !rec.locked) return { shift, status: 'draft' };
    const netSale = rec.profileMode === 'final' ? rec.finalNetSale : rec.outNetSale;
    return { shift, status: 'closed', netSale: netSale || 0 };
  });
}

// ── 2. Inventory — paginate `inventory_products`, same PAGE_SIZE/.range()
// pattern as stockledger.js's fetchFromSupabase(), then run it through
// the shared bucket calc.
async function _fetchInventoryHealth() {
  const PAGE_SIZE = 1000;
  let all: any[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const url = INVENTORY_SUPABASE_URL + '/rest/v1/inventory_products?select=*&order=id.asc&offset=' + from + '&limit=' + PAGE_SIZE;
    const res = await fetch(url, {
      headers: { apikey: INVENTORY_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + INVENTORY_SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error('inventory_products fetch failed: ' + res.status);
    const page = await res.json();
    if (!page.length) break;
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const normalized = all.map(normalizeInventoryRow);
  const buckets = computeInventoryBuckets(normalized, { asOf: new Date() });
  const health = computeInventoryHealth({
    totalInventoryValue: buckets.totalInventoryValue,
    neverSold60Value: buckets.neverSold60Value,
    deadStock60Value: buckets.deadStock60Value,
    correctedExcessValue: buckets.rawExcessValue, // see header note — raw, not the dashboard's corrected figure
  });
  return health;
}

// ── 3. Narration — one text-completion call, same "current state only,
// no advice, no invented numbers" instruction as ai-memory.js's prompt.
async function _generateParagraph(closingLine: string, healthLine: string): Promise<string> {
  const prompt = [
    'You are a calm, plain-language daily-briefing narrator for a retail pharmacy branch manager.',
    'Write ONE short paragraph (2-4 sentences) for a WhatsApp message narrating today\'s closing and',
    'current inventory health from the two lines below. No headers, no bullet points, no markdown.',
    'Do not invent numbers that aren\'t given. Do not recommend actions — narrate the current state only.',
    '',
    closingLine,
    healthLine,
  ].join('\n');

  const providers = [
    { key: Deno.env.get('GROQ_API_KEY'), model: 'openai/gpt-oss-120b', endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
    { key: Deno.env.get('CEREBRAS_API_KEY'), model: 'gpt-oss-120b', endpoint: 'https://api.cerebras.ai/v1/chat/completions' },
  ];

  let lastErr: unknown = null;
  for (const p of providers) {
    if (!p.key) continue;
    try {
      const res = await fetch(p.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.3 }),
      });
      if (!res.ok) { lastErr = new Error(p.model + ' ' + res.status); continue; }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) return content.trim();
    } catch (e) { lastErr = e; }
  }
  // Non-AI fallback — a plain-data line beats a failed send.
  console.warn('[send-daily-whatsapp-briefing] AI narration failed, using fallback line:', lastErr);
  return closingLine + ' ' + healthLine;
}

// ── 4. Send — WhatsApp Cloud API. Template-message shape (see header
// note). Swap for the commented "session message" body below only if
// you're testing inside a live 24h customer-service window.
async function _sendWhatsApp(paragraph: string): Promise<void> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const recipient = Deno.env.get('WHATSAPP_RECIPIENT');
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  if (!token || !phoneNumberId || !recipient || !templateName) {
    throw new Error('Missing one of WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_RECIPIENT / WHATSAPP_TEMPLATE_NAME secrets.');
  }

  const body = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: paragraph }] }],
    },
  };

  // Session-message variant (only inside a 24h open window — no template
  // approval needed, but WILL be rejected otherwise):
  // const body = { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: paragraph } };

  const res = await fetch('https://graph.facebook.com/v20.0/' + phoneNumberId + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('WhatsApp send failed: ' + res.status + ' ' + errText);
  }
}

Deno.serve(async (_req: Request) => {
  try {
    const [shifts, health] = await Promise.all([_fetchTodaysShifts(), _fetchInventoryHealth()]);
    const closing = computeClosingTotal(shifts);

    const closingLine = closing.allClosed
      ? `Today's closing total is ${_fmt(closing.total)} across ${closing.closedCount} shift(s).`
      : `Closing so far today: ${_fmt(closing.total)} across ${closing.closedCount} closed shift(s), with ${closing.pendingShifts.join(', ') || 'none'} still open.`;
    const healthLine = `Inventory is ${inventoryHealthLine(health)} of Rs. ${Math.round(health.total).toLocaleString('en-PK')} total value.`;

    const paragraph = await _generateParagraph(closingLine, healthLine);
    await _sendWhatsApp(paragraph);

    return new Response(JSON.stringify({ ok: true, sent: paragraph }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[send-daily-whatsapp-briefing] failed:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
