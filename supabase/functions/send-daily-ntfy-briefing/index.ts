// BT Sale Data - twice-daily (11:00 and 23:00 PKT) business briefing -> ntfy push (styled plain-text newsletter).
// App: bt.duapharma.com (repo BT-Sale-Data2). One function, ntfy only (no WhatsApp).
// Auth: requires header x-cron-secret === CRON_SECRET (verify_jwt is off).
// Use ?dry=1 to return the messages without sending them.
//
// v20: "Sale" is now the day's TOTAL (the official figure, same as the app and the AI assistant).
//      Before v20 it was COMP SALE with TOTAL as a fallback, which made the push and the app disagree.
//
// v19: ntfy limits a message to 4096 BYTES (not characters). Emoji = 4 bytes, box/bullet chars = 3 bytes,
// so the old slice(0, 3900) could overshoot and get clipped. Now:
//   - every message is capped by BYTES
//   - the "at a glance" block is sent as its own short notification (always fits the drawer)
//   - the full detail is sent as 1..N chunks (each <= 3800 bytes, split on section boundaries)
//   - detail chunks are sent first and the glance last, so the glance sits on top in the ntfy app
//
// Data sources:
//   This project  : Sales (manual bt_daily = official), Manager (last available data)
//   Audit project (BTpharmacyAudit@2026, read with its publishable key):
//     inventory_products          -> Inventory (computed here with summary-calc.js)
//     sales_payment_summary,
//     sales_credit_by_customer    -> Candela sales (last day + today)
//     str_headers, str_line_items -> STR awaited / in transit with value
//
// Secrets (Edge Function secrets):
//   CRON_SECRET, NTFY_TOPIC (required)
//   NTFY_SERVER (default https://ntfy.sh), NTFY_TOKEN, CLICK_URL (default https://bt.duapharma.com)
//   INVENTORY_URL / INVENTORY_KEY  optional overrides for the Audit project
//   GROQ_API_KEY / GROQ_MODEL      optional, AI insight section

import { computeInventoryBuckets, normalizeInventoryRow, computeInventoryHealth } from "./summary-calc.js";
import { creditAlertMessages } from "./credit-alerts.js"; // byte-identical copy of js/shared/credit-alerts.js (same rules as the in-app briefing)

const PKT_MS = 5 * 3600 * 1000;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONFULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INV_URL_DEFAULT = "https://vtcrdkqhuvxatclobsby.supabase.co";
const INV_KEY_DEFAULT = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy";

const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const M = (x: number) => (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + "M" : n0(x));
// compact figure: 596156 -> 596K, 17100000 -> 17.1M
const K = (x: number) => (Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : Math.round(x / 1000) + "K");
const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "n/a");
const arrow = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) / b) * 100))}%` : "n/a");
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const monthName = (y: number, m: number) => `${MONFULL[((m % 12) + 12) % 12]} ${y + Math.floor(m / 12)}`;
const lbl = (d: Date) => `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86400000;
const shortName = (s: unknown) => String(s || "?").trim().split(/\s+/).slice(0, 2).join(" ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- byte-safe helpers (ntfy limit is 4096 BYTES) ----------
const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;
function capBytes(s: string, max: number): string {
  if (byteLen(s) <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLen(s.slice(0, mid)) <= max - 3) lo = mid; else hi = mid - 1;
  }
  let out = s.slice(0, lo);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1); // don't leave half an emoji
  return out + "…";
}
const SEP = "\n\n────────\n\n";
function chunkBlocks(blocks: string[], max = 3800): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const raw of blocks) {
    const b = capBytes(raw, max);
    const next = cur ? cur + SEP + b : b;
    if (byteLen(next) <= max) cur = next;
    else { if (cur) chunks.push(cur); cur = b; }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function parseDate(s: string): Date | null {
  const m = /^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const mi = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  return mi < 0 ? null : new Date(Date.UTC(+m[3], mi, +m[1]));
}

// Sections are written in light Markdown, then converted to styled plain text before sending.
function toPlain(md: string): string {
  return md
    .replace(/^## (.*)$/gm, "▌$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\*(.*)\*$/gm, "$1")
    .replace(/^> - /gm, "• ")
    .replace(/^> /gm, "")
    .replace(/^- /gm, "• ");
}

async function rest(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}`);
  return r.json();
}

// Audit project (Candela sales, STR, inventory)
async function auditRest(path: string) {
  const url = (Deno.env.get("INVENTORY_URL") || INV_URL_DEFAULT).replace(/\/$/, "");
  const key = Deno.env.get("INVENTORY_KEY") || INV_KEY_DEFAULT;
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}`);
  return r.json();
}

// ---------- SALES (manually filled bt_daily = the official data) ----------
async function salesSection(today: Date) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const names = [monthName(y, m), monthName(y, m - 1)];
  const list = names.map((n) => `"${n}"`).join(",");
  const rows = await rest(`bt_daily?select=date,month_year,data&month_year=in.(${encodeURIComponent(list)})`);
  const entries = rows
    .map((r: any) => ({ d: parseDate(r.date), x: r.data || {} }))
    .filter((e: any) => e.d)
    .sort((a: any, b: any) => a.d.getTime() - b.d.getTime());
  if (!entries.length) return { text: "## 💰 Sales\n> No entries found", facts: null, alerts: [] as string[] };

  // Official sale = the day's TOTAL (same as the app's dashboard and target tracking).
  const saleOf = (x: any) => num(x["TOTAL"]);
  const latest = entries[entries.length - 1];
  const at = (d: Date) => entries.find((e: any) => e.d.getTime() === d.getTime());
  const prev = at(new Date(latest.d.getTime() - DAY));
  const wk = at(new Date(latest.d.getTime() - 7 * DAY));

  const sale = saleOf(latest.x);
  const bills = num(latest.x["Customers"]);
  const diff = num(latest.x["DIFF"]);
  const cash = num(latest.x["Cash Sale"]);

  const ly = latest.d.getUTCFullYear(), lm = latest.d.getUTCMonth(), ld = latest.d.getUTCDate();
  const monthEntries = entries.filter((e: any) => e.d.getUTCFullYear() === ly && e.d.getUTCMonth() === lm);
  const mtd = monthEntries.reduce((s: number, e: any) => s + saleOf(e.x), 0);
  const dim = new Date(Date.UTC(ly, lm + 1, 0)).getUTCDate();
  const have = new Set(monthEntries.map((e: any) => e.d.getUTCDate()));
  const missing: number[] = [];
  for (let i = 1; i <= ld; i++) if (!have.has(i)) missing.push(i);

  let target = 0;
  try {
    const t = await rest(`bt_targets?select=data&month=eq.${encodeURIComponent(monthName(ly, lm))}`);
    target = num(t?.[0]?.data);
  } catch (_) { /* target optional */ }

  const yesterday = new Date(today.getTime() - DAY);
  const pending = latest.d.getTime() < yesterday.getTime();
  const projected = (mtd / ld) * dim;
  const remaining = dim - ld;
  const needPerDay = target > mtd && remaining > 0 ? (target - mtd) / remaining : 0;

  const L: string[] = [];
  L.push(`## 💰 Sales · ${lbl(latest.d)}`);
  L.push(`**Rs ${n0(sale)}** · ${n0(bills)} bills · avg Rs ${bills ? n0(sale / bills) : "-"}`);
  L.push("");
  const cmp: string[] = [];
  if (prev) cmp.push(`${arrow(sale, saleOf(prev.x))} vs prev day`);
  if (wk) cmp.push(`${arrow(sale, saleOf(wk.x))} vs last ${DOW[wk.d.getUTCDay()]}`);
  if (cmp.length) L.push(`- 📈 ${cmp.join(" · ")}`);
  L.push(`- 💵 Cash sale Rs ${n0(cash)} · Diff **${diff > 0 ? "+" : ""}${n0(diff)}**${Math.abs(diff) >= 10000 ? " ⚠️" : ""}`);
  if (target > 0) {
    L.push(`- 🎯 MTD **Rs ${M(mtd)}** of ${M(target)} (**${Math.round((mtd / target) * 100)}%**) · day ${ld}/${dim}`);
    L.push(`- 📊 Projected **Rs ${M(projected)}** (${Math.round((projected / target) * 100)}% of target)` + (needPerDay ? ` · need Rs ${n0(needPerDay)}/day` : ""));
  } else {
    L.push(`- 🎯 MTD **Rs ${M(mtd)}** · day ${ld}/${dim} (no target set)`);
  }
  const lowReason = String(latest.x["Low Sale Reason"] || "").trim();
  if (lowReason) L.push(`- 📝 Low sale reason: ${lowReason}`);
  if (pending) L.push("", `> ⏳ ${lbl(yesterday)} not entered yet`);
  if (missing.length) L.push("", `> 🕳️ Missing entries: ${missing.join(", ")} ${MON[lm]}`);

  const alerts: string[] = [];
  if (Math.abs(diff) >= 10000) alerts.push(`Cash DIFF Rs ${n0(diff)} on ${lbl(latest.d)}`);
  if (wk && sale < saleOf(wk.x) * 0.7) alerts.push(`Sale ${pct(sale, saleOf(wk.x))} vs last ${DOW[wk.d.getUTCDay()]} (${lbl(latest.d)})`);
  if (target > 0 && ld >= 10 && projected < target * 0.9) alerts.push(`Projected ${Math.round((projected / target) * 100)}% of monthly target`);

  return {
    text: L.join("\n"),
    alerts,
    facts: { date: lbl(latest.d), sale, bills, diff, vs_prev: prev ? pct(sale, saleOf(prev.x)) : null, vs_last_week: wk ? pct(sale, saleOf(wk.x)) : null, mtd, target, projected: Math.round(projected), need_per_day: Math.round(needPerDay), missing_days: missing, low_sale_reason: lowReason || null },
  };
}

// ---------- CANDELA (POS payments: last day + today, from the Audit project) ----------
async function candelaSection(today: Date) {
  const yesterday = new Date(today.getTime() - DAY);
  const from = ymd(yesterday);
  const [pay, credit] = await Promise.all([
    auditRest(`sales_payment_summary?select=sale_day,cash_sale,card_sale,credit_sale,total_sale&sale_day=gte.${from}&order=sale_day.asc`),
    auditRest(`sales_credit_by_customer?select=sale_day,customer_name,credit_amount&sale_day=gte.${from}&order=credit_amount.desc`),
  ]);

  const L: string[] = ["## 🧾 Candela POS"];
  const facts: any = {};
  for (const [d, isToday] of [[yesterday, false], [today, true]] as [Date, boolean][]) {
    const key = ymd(d);
    const row = pay.find((p: any) => p.sale_day === key);
    const head = `${lbl(d)}${isToday ? " (so far)" : ""}`;
    if (!row) { L.push("", `**${head}** — no data yet`); continue; }
    L.push("", `**${head} — Rs ${n0(num(row.total_sale))}**`);
    L.push(`- 💵 Cash ${n0(num(row.cash_sale))} · 💳 Card ${n0(num(row.card_sale))} · 🧾 Credit ${n0(num(row.credit_sale))}`);
    const cr = credit.filter((c: any) => c.sale_day === key && num(c.credit_amount) > 0);
    if (cr.length) L.push(`- On credit: ${cr.slice(0, 4).map((c: any) => `${shortName(c.customer_name)} **${n0(num(c.credit_amount))}**`).join(" · ")}${cr.length > 4 ? ` · +${cr.length - 4} more` : ""}`);
    facts[key] = { total: Math.round(num(row.total_sale)), cash: Math.round(num(row.cash_sale)), card: Math.round(num(row.card_sale)), credit: Math.round(num(row.credit_sale)) };
  }
  return { text: L.join("\n"), alerts: [] as string[], facts };
}

// ---------- MANAGER (last available data per part) ----------
async function managerSection() {
  const rows = await rest(`bt_manager?select=section,month,data&section=in.(credit,salary,generic)`);
  const idx = (mn: string) => {
    const [name, yr] = String(mn).trim().split(/\s+/);
    const mi = MONFULL.findIndex((x) => x.toLowerCase() === String(name).toLowerCase());
    return mi < 0 || !Number(yr) ? -1 : Number(yr) * 12 + mi;
  };
  const byMonthDesc = (section: string) =>
    rows
      .filter((r: any) => r.section === section && Array.isArray(r.data) && idx(r.month) >= 0)
      .sort((a: any, b: any) => idx(b.month) - idx(a.month));
  const sumField = (arr: any[], f: string) => arr.reduce((s: number, p: any) => s + num(p?.[f]), 0);

  const L: string[] = ["## 👔 Manager"];
  const facts: any = {};
  const alerts: string[] = [];

  const credit = byMonthDesc("credit")[0];
  if (credit) {
    const per = credit.data
      .map((p: any) => ({ name: shortName(p.name), amt: (Array.isArray(p.entries) ? p.entries : []).reduce((s: number, e: any) => s + num(e.amount), 0) }))
      .filter((p: any) => p.amt !== 0)
      .sort((a: any, b: any) => b.amt - a.amt);
    const tot = per.reduce((s: number, p: any) => s + p.amt, 0);
    L.push("", `**Staff credit · ${credit.month} — Rs ${n0(tot)}** (${per.length} staff)`);
    per.slice(0, 5).forEach((p: any) => L.push(`- ${p.name} **${n0(p.amt)}**`));
    if (per.length > 5) L.push(`- Others: ${per.slice(5).map((p: any) => `${p.name} ${n0(p.amt)}`).join(" · ")}`);
    facts.credit = { month: credit.month, total: tot, staff: per.length };
    // Duplicate-entry and carried-over (aged) credit: same rules and wording as the in-app briefing.
    const ca = creditAlertMessages(credit.data);
    alerts.push(...ca.duplicates);
    if (ca.aged) { alerts.push(ca.aged); L.push(`- ⏳ Carried-over credit: Rs ${n0(ca.agedTotal)}`); }
    if (ca.duplicates.length) L.push(`- ♊ ${ca.duplicates.length} possible duplicate credit entr${ca.duplicates.length === 1 ? "y" : "ies"}`);
    facts.credit.aged_total = Math.round(ca.agedTotal); facts.credit.duplicates = ca.duplicates.length;
  } else {
    L.push("", "> No staff credit data");
  }

  const sal = byMonthDesc("salary").find((r: any) => sumField(r.data, "advance") || sumField(r.data, "generic") || sumField(r.data, "hoSal"));
  if (sal) {
    const adv = sumField(sal.data, "advance"), gen = sumField(sal.data, "generic"), ho = sumField(sal.data, "hoSal");
    const bits = [adv ? `Advances **Rs ${n0(adv)}**` : "", gen ? `Generic **Rs ${n0(gen)}**` : "", ho ? `HO salary **Rs ${n0(ho)}**` : ""].filter(Boolean);
    L.push("", `**Salary · ${sal.month}**`, `- ${bits.join(" · ")}`);
    facts.salary = { month: sal.month, advances: adv, generic: gen, ho };
  }

  const gs = byMonthDesc("generic").find((r: any) => sumField(r.data, "genericSale") || sumField(r.data, "extra"));
  if (gs) {
    const tot = sumField(gs.data, "genericSale");
    const top = gs.data
      .map((p: any) => ({ name: shortName(p.name), v: num(p.genericSale) }))
      .filter((p: any) => p.v > 0)
      .sort((a: any, b: any) => b.v - a.v)
      .slice(0, 3);
    L.push("", `**Generic sale · ${gs.month} — Rs ${n0(tot)}**`);
    if (top.length) L.push(`- Top: ${top.map((p: any) => `${p.name} **${n0(p.v)}**`).join(" · ")}`);
    facts.generic = { month: gs.month, total: tot };
  }

  if (credit) {
    try {
      const inc = await rest(`bt_incentives?select=data&key=eq.${encodeURIComponent("mw_incentive_" + credit.month)}`);
      const d = inc?.[0]?.data;
      if (d) {
        const bits = [
          num(d.tillShort) ? `Till short **${n0(num(d.tillShort))}**` : "",
          num(d.pilferage) ? `Pilferage **${n0(num(d.pilferage))}**` : "",
        ].filter(Boolean);
        if (bits.length) L.push("", `**Incentive · ${credit.month}**`, `- ${bits.join(" · ")}`);
      }
    } catch (_) { /* optional */ }
  }

  return { text: L.join("\n"), alerts, facts };
}

// ---------- STR (open transfers touching Bahria Town, from the Audit project) ----------
// direction "out" = dispatched BY Bahria Town, "in" = sent TO Bahria Town.
// Value = dispatched qty (falls back to requested qty) x cost price.
async function strSection(today: Date) {
  const headers = await auditRest("str_headers?select=str_id,str_number,direction,dispatch_status,receive_status,receive_branch,dispatch_branch,str_date&str_status=eq.Open&order=str_date.asc&limit=1000");

  const outNotDispatched = headers.filter((h: any) => h.direction === "out" && h.dispatch_status === "Awaited");
  const outInTransit = headers.filter((h: any) => h.direction === "out" && h.dispatch_status === "Dispatched" && h.receive_status !== "Received");
  const inTransit = headers.filter((h: any) => h.direction === "in" && h.dispatch_status === "Dispatched" && h.receive_status !== "Received");

  const wanted = [...outNotDispatched, ...outInTransit, ...inTransit].map((h: any) => h.str_id);
  const valueById = new Map<number, number>();
  for (let i = 0; i < wanted.length; i += 20) {
    const ids = wanted.slice(i, i + 20).join(",");
    const lines = await auditRest(`str_line_items?select=str_id,str_qty,dispatch_qty,cost_price&str_id=in.(${ids})&limit=1000`);
    for (const l of lines) {
      const qty = l.dispatch_qty === null || l.dispatch_qty === undefined ? num(l.str_qty) : num(l.dispatch_qty);
      valueById.set(l.str_id, (valueById.get(l.str_id) || 0) + qty * num(l.cost_price));
    }
  }
  const total = (arr: any[]) => arr.reduce((s: number, h: any) => s + (valueById.get(h.str_id) || 0), 0);
  const row = (icon: string, label: string, arr: any[], extra = "") =>
    `- ${icon} ${label}: **${arr.length} STR**${arr.length ? ` · Rs ${n0(total(arr))}${extra}` : ""}`;

  const oldest = inTransit.length ? new Date(String(inTransit[0].str_date) + "T00:00:00Z") : null;
  const oldestTxt = oldest && !isNaN(oldest.getTime()) ? ` · oldest ${lbl(oldest)}` : "";

  const L = [
    "## 🚚 STR Transfers",
    row("📤", "From Bahria Town, not dispatched yet", outNotDispatched),
    row("🚛", "From Bahria Town, dispatched, not received", outInTransit),
    row("📥", "From Warehouse, dispatched, not received", inTransit, oldestTxt),
  ];

  const alerts: string[] = [];
  const stale = inTransit.filter((h: any) => {
    const d = new Date(String(h.str_date) + "T00:00:00Z");
    return !isNaN(d.getTime()) && today.getTime() - d.getTime() >= 3 * DAY;
  });
  if (stale.length) alerts.push(`${stale.length} incoming STR not received for 3+ days`);

  return {
    text: L.join("\n"),
    alerts,
    facts: { bt_not_dispatched: outNotDispatched.length, bt_dispatched_not_received: outInTransit.length, warehouse_in_transit: inTransit.length, warehouse_in_transit_value: Math.round(total(inTransit)) },
  };
}

// ---------- INVENTORY (raw rows from the Audit project, computed here) ----------
async function inventorySection() {
  const PAGE = 1000;
  let all: any[] = [];
  for (let from = 0; from < 100000; from += PAGE) {
    const page = await auditRest(`inventory_products?select=*&order=id.asc&offset=${from}&limit=${PAGE}`);
    if (!page.length) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
  }
  if (!all.length) throw new Error("inventory_products is empty");

  const items = all.map(normalizeInventoryRow);
  const b = computeInventoryBuckets(items, { asOf: new Date() });
  const h = computeInventoryHealth({
    totalInventoryValue: b.totalInventoryValue,
    neverSold60Value: b.neverSold60Value,
    deadStock60Value: b.deadStock60Value,
    correctedExcessValue: b.rawExcessValue,
  });
  const negCount = items.filter((i: any) => i.stock < 0).length;
  const inStock = items.filter((i: any) => i.stock > 0).length;

  const L: string[] = ["## 📦 Inventory"];
  L.push(`**Stock Rs ${M(h.total)}** · ${n0(inStock)} items in stock`);
  L.push("");
  L.push(`- ✅ Healthy **${h.pctHealthy}%**`);
  L.push(`- 📈 Excess **${h.pctExcess}%** · Rs ${M(h.excess)}`);
  L.push(`- 💀 Dead 60d+ **${h.pctDead}%** · Rs ${M(h.dead)}`);
  L.push(`- 🕸️ Never sold 60d+ **${h.pctNever}%** · Rs ${M(h.never)}`);
  L.push(`- ⚠️ Negative stock **${n0(negCount)} items** · Rs ${M(Math.abs(b.negativeValue))}`);

  return {
    text: L.join("\n"),
    alerts: [] as string[],
    facts: { total: Math.round(h.total), healthy_pct: h.pctHealthy, excess_pct: h.pctExcess, dead_pct: h.pctDead, never_sold_pct: h.pctNever, negative_items: negCount, negative_value: Math.round(Math.abs(b.negativeValue)) },
  };
}

// ---------- AI INSIGHT (optional) ----------
async function aiInsight(facts: unknown): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: "system", content: "You are the analyst for a single pharmacy in Pakistan. From the JSON facts, write at most 3 short plain-text lines: the single most important thing, then 1-2 concrete actions for today. Use only numbers present in the facts. No greeting, no markdown, no emojis." },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
    clearTimeout(t);
    if (!r.ok) return "";
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content || "").trim();
  } catch (_) {
    return "";
  }
}

// ---------- NTFY (JSON publish: safe for emoji / non-Latin1 characters in the title) ----------
async function ntfy(title: string, body: string, priority: number, tags: string[]) {
  const topic = Deno.env.get("NTFY_TOPIC");
  if (!topic) throw new Error("NTFY_TOPIC not set");
  const base = (Deno.env.get("NTFY_SERVER") || "https://ntfy.sh").replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = Deno.env.get("NTFY_TOKEN");
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`${base}/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      topic,
      title,
      message: capBytes(body, 4000), // ntfy max is 4096 bytes
      priority,
      tags,
      click: Deno.env.get("CLICK_URL") || "https://bt.duapharma.com",
    }),
  });
  if (!r.ok) throw new Error(`ntfy ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("unauthorized", { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const nowPkt = new Date(Date.now() + PKT_MS);
  const today = new Date(nowPkt.getTime());
  today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - DAY);

  // Edition label from the actual PKT send time, e.g. "11:00 AM"
  const hh = nowPkt.getUTCHours(), mm = nowPkt.getUTCMinutes();
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const ampm = hh < 12 ? "AM" : "PM";
  const timeTxt = `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  const edition = hh < 17 ? "Morning edition" : "Night edition";

  const parts: string[] = [];
  const alerts: string[] = [];
  const facts: Record<string, any> = {};

  for (const [name, fn] of [
    ["sales", () => salesSection(today)],
    ["candela", () => candelaSection(today)],
    ["manager", () => managerSection()],
    ["str", () => strSection(today)],
    ["inventory", () => inventorySection()],
  ] as [string, () => Promise<any>][]) {
    try {
      const s = await fn();
      parts.push(s.text);
      if (s.alerts) alerts.push(...s.alerts);
      facts[name] = s.facts;
    } catch (e) {
      parts.push(`## ⚠️ ${name.toUpperCase()}\n> Unavailable (${(e as Error).message})`);
    }
  }

  const insight = await aiInsight(facts);

  // ----- AT A GLANCE (its own short notification, always fits the drawer) -----
  const g: string[] = [`📰 ${DOW[today.getUTCDay()]} ${today.getUTCDate()} ${MON[today.getUTCMonth()]} ${today.getUTCFullYear()} · ${edition}`];
  alerts.slice(0, 2).forEach((a) => g.push(`⚠️ ${a}`));
  if (facts.sales?.sale) g.push(`💰 Sale ${facts.sales.date}: Rs ${n0(facts.sales.sale)}`);
  const posY = facts.candela?.[ymd(yesterday)]?.total, posT = facts.candela?.[ymd(today)]?.total;
  if (posY || posT) g.push(`🧾 POS ${[posY ? `${lbl(yesterday)} ${K(posY)}` : "", posT ? `today ${K(posT)}` : ""].filter(Boolean).join(" · ")}`);
  if (facts.manager?.credit) g.push(`👔 Staff credit Rs ${n0(facts.manager.credit.total)}`);
  if (facts.str && typeof facts.str.warehouse_in_transit === "number") g.push(`🚚 STR ${facts.str.warehouse_in_transit} in transit · Rs ${K(facts.str.warehouse_in_transit_value || 0)}`);
  if (facts.inventory) g.push(`📦 Stock Rs ${M(facts.inventory.total)} · healthy ${facts.inventory.healthy_pct}%`);
  g.push("Details in the next messages ↓");
  const glance = g.join("\n");

  // ----- DETAIL (chunked by bytes on section boundaries) -----
  const detailBlocks = parts.map(toPlain);
  if (insight) detailBlocks.push(toPlain(`## 🧠 Insight\n${insight.split("\n").filter(Boolean).map((l) => `- ${l.replace(/^[-•*]\s*/, "")}`).join("\n")}`));
  detailBlocks.push(`Auto-sent ${timeTxt} PKT · bt.duapharma.com`);
  const chunks = chunkBlocks(detailBlocks, 3800);

  // Headline title
  const head: string[] = [`BT ${h12} ${ampm}`];
  if (facts.sales?.sale) head.push(`Sale ${K(facts.sales.sale)}`);
  if (posT) head.push(`Today ${K(posT)}`);
  if (facts.str && typeof facts.str.warehouse_in_transit === "number") head.push(`STR ${facts.str.warehouse_in_transit}`);
  if (alerts.length) head.push(`⚠️ ${alerts.length}`);
  const title = head.join(" · ");
  const detailTitle = (i: number) => `BT Details ${i + 1}/${chunks.length} · ${h12} ${ampm}`;

  if (dry) {
    const out = [`${title}\n\n${glance}  [${byteLen(glance)} bytes]`, ...chunks.map((c, i) => `${detailTitle(i)}  [${byteLen(c)} bytes]\n\n${c}`)];
    return new Response(out.join("\n\n==========\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  try {
    // details first (last chunk first), glance last -> glance ends up on top in the ntfy app
    for (let i = chunks.length - 1; i >= 0; i--) {
      await ntfy(detailTitle(i), chunks[i], 2, ["page_facing_up"]);
      await sleep(600);
    }
    await ntfy(title, glance, 3, ["newspaper", "pill"]);
    if (alerts.length) {
      await sleep(600);
      await ntfy("BT Alert", alerts.map((a) => `• ${a}`).join("\n"), 4, ["warning"]);
    }
  } catch (e) {
    return new Response(`ntfy failed: ${(e as Error).message}`, { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true, alerts: alerts.length, chunks: chunks.length, glance_bytes: byteLen(glance), title }), { headers: { "Content-Type": "application/json" } });
});
