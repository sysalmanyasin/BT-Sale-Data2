# V2 Plan — §12: Audit Domain (Pharmacy Audit Hub embed)

*Status: SUPERSEDED. The iframe embed described below (§12.2–12.5) was
built, then deliberately removed at the user's request, for both Audit
and this same-shaped Closing embed (§6) — the embedded pages, their nav
tabs, and their domain routing are gone. What remains, for both: the
Cover Dashboard tile + its read-only bridge module
(`audit-bridge.js` / `closing-bridge.js`), which still shows a live
status line on the tile. Tapping the tile now opens the real app
(`random.duapharma.com` / `closing.duapharma.com`) in a new tab instead
of framing it in-app. Closing's tile also carries a small "🔗 Data
Bridge" button — the one-time Dropbox pairing step that used to live on
the now-removed embedded page. The sections below are kept for
reference/history, not as the current implementation.*

## 12.0 Decision

Pharmacy Audit Hub (`random.duapharma.com`) becomes a new peer
dashboard — domain key `audit` — using the **same pattern already live
for Closing**: the standalone app is framed live inside its own page,
lazy-loaded, with a separate read-only bridge for the Cover tile.
Nothing of its code, business logic, or data is duplicated into this
repo. This is a UI-shell merge, not a code merge — consistent with §8's
Golden Rule that new domains get their own Floor 1–5 stack rather than
reusing another domain's internals directly.

**Why this over a native rebuilt-in-this-repo domain:** Pharmacy Audit
Hub's Floor 1–3 (`repository/supabase.js`, `store/`, `actions/`) are
already a real, proven, independently-tested ES-module stack with its
own RLS-backed multi-auditor security model. Reimplementing that inside
this repo would re-risk the same class of business logic the rewrite-
vs-evolve decision in §0 already ruled out re-risking for Sales. Framing
the real thing costs a page, a nav entry, and a bridge module — the
Closing precedent proves this is enough to feel native.

**Why this is better than Closing's bridge, specifically:** Closing had
no queryable backend, so its bridge reads a Dropbox-exported blob
(§6, `closing-bridge.js`) — a manual "Export Connection" token has to
be pasted once. Pharmacy Audit Hub already runs on Supabase with RLS as
the actual isolation mechanism, and per the standing instruction that
baking in a Supabase anon key is acceptable here (single-user, personal,
security not a constraint), the bridge can query Supabase **directly**
— live, no manual export step.

---

## 12.1 What stays separate vs. what integrates

| | Stays fully separate | Integrates |
|---|---|---|
| Repo | ✅ own repo, own CNAME (`random.duapharma.com`) | |
| Service worker / manifest / PWA install | ✅ | |
| Business logic (Engagement/Round/Assignment/Compile/Difference engines) | ✅ never re-implemented here | |
| IndexedDB (legacy local cache, offline counting checkpoint) | ✅ | |
| Supabase project (Staff/Engagements/Assignments/Submissions/Compiled Rounds/Final Snapshots/Audit Log) | ✅ same project, same RLS | |
| Auth (Supabase phone+PIN) | ✅ runs inside the iframe, independent of BT's Google Sign-In | |
| Navigation shell / nav tab / brand theming | | ✅ new `audit` domain in `showPage()` + `nav.css` |
| Cover Dashboard summary tile | | ✅ new `audit-bridge.js`, direct Supabase read |
| App icon on the phone | | ✅ one installed icon (BT Sales) is the "native app" |

---

## 12.2 Navigation wiring — `js/ui.js` (`showPage`)

Mirrors the existing `closing` branch exactly:

```js
// showPage(), where the domain arrays are declared:
const _auditDomainPages = ['audit'];
const _domain = _salesDomainPages.indexOf(id) !== -1 ? 'sales'
              : _managerDomainPages.indexOf(id) !== -1 ? 'manager'
              : _notesheetsDomainPages.indexOf(id) !== -1 ? 'notesheets'
              : _closingDomainPages.indexOf(id) !== -1 ? 'closing'
              : _auditDomainPages.indexOf(id) !== -1 ? 'audit'
              : '';
document.body.dataset.domain = _domain;

if (_brandSub) {
  _brandSub.textContent = _domain === 'sales'      ? 'Sales Dashboard'
                         : _domain === 'manager'    ? 'Manager Dashboard'
                         : _domain === 'notesheets' ? 'Notes & Sheets'
                         : _domain === 'closing'    ? 'Closing'
                         : _domain === 'audit'      ? 'Audit'
                         : 'Intelligence Centre';
}

if (id === 'audit') {
  // Lazy-load — only fetch random.duapharma.com once you actually
  // navigate here, not on every app boot (same as Closing).
  const _aIframe = document.getElementById('audit-iframe');
  if (_aIframe && !_aIframe.getAttribute('src')) _aIframe.setAttribute('src', _aIframe.dataset.src);
  if (typeof auditBridgeRefresh === 'function') auditBridgeRefresh();
}
```

## 12.3 `css/nav.css` — domain isolation rules

Add `audit` to every existing domain's hide-list, and add its own
hide-list + accent block, same shape as the four already there:

```css
body[data-domain="manager"] .ntab[data-group="audit"],
body[data-domain="manager"] .bnav-item[data-group="audit"],
body[data-domain="sales"] .ntab[data-group="audit"],
body[data-domain="sales"] .bnav-item[data-group="audit"],
body[data-domain="notesheets"] .ntab[data-group="audit"],
body[data-domain="notesheets"] .bnav-item[data-group="audit"],
body[data-domain="closing"] .ntab[data-group="audit"],
body[data-domain="closing"] .bnav-item[data-group="audit"] {
  display: none !important;
}
body[data-domain="audit"] .ntab[data-group="dashboard"],
body[data-domain="audit"] .ntab[data-group="saledata"],
body[data-domain="audit"] .ntab[data-group="manager"],
body[data-domain="audit"] .ntab[data-group="notesheets"],
body[data-domain="audit"] .ntab[data-group="closing"],
body[data-domain="audit"] .bnav-item[data-group="dashboard"],
body[data-domain="audit"] .bnav-item[data-group="saledata"],
body[data-domain="audit"] .bnav-item[data-group="manager"],
body[data-domain="audit"] .bnav-item[data-group="notesheets"],
body[data-domain="audit"] .bnav-item[data-group="closing"] {
  display: none !important;
}

/* Reuses Pharmacy Audit Hub's own PWA theme-color (#0F1F3D, deep navy)
   so the embedded page and its nav tab read as the same product —
   same reasoning as Closing reusing its own teal. */
body[data-domain="audit"] {
  --accent: #0F1F3D;
  --alt: #e8ebf3;
}
```

Also add `data-group="audit"` to every OTHER domain's existing
hide-lists (the reverse direction) — i.e. append `.ntab[data-group="audit"]`
/`.bnav-item[data-group="audit"]` to the four blocks that already exist
for `manager`/`sales`/`notesheets`/`closing`, same as shown above.

## 12.4 Nav tabs — `index.html`

```html
<button class="ntab" data-page="audit" data-group="audit">🧾 Audit</button>
...
<button class="bnav-item" data-page="audit" data-group="audit"><span class="bicon">🧾</span><span class="blabel">Audit</span></button>
```

## 12.5 Page markup — iframe embed

Same shape as the Closing page block, with the Dropbox-reconnect caveat
swapped for the equivalent Supabase one (Google/phone-PIN login screens
generally *can* be framed, unlike Dropbox's OAuth page — confirm this
during testing per §12.7; the "open in new tab" escape hatch is kept
either way, cheap insurance):

```html
<!-- AUDIT — embedded peer dashboard (V2 plan §12). Fully separate app:
     own domain (random.duapharma.com), own repo, own PWA/service
     worker, own Supabase project. This page just frames the live site
     so it feels native inside this app's shell; nothing of its code or
     data lives here. See audit-bridge.js for the read-only Supabase
     summary shown on the Cover tile. -->
<div class="page" id="page-audit" style="padding:0;display:flex;flex-direction:column">
  <div style="padding:14px 20px 10px;flex-shrink:0">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <h1 class="htitle" style="margin:0">🧾 Audit</h1>
        <p class="hsub" style="margin:2px 0 0">Pharmacy Audit Hub — live, embedded from random.duapharma.com</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span id="audit-bridge-status" style="font-size:11px;color:var(--muted)"></span>
        <a href="https://random.duapharma.com" target="_blank" rel="noopener" class="btn" style="border:1px solid var(--border);font-size:12px;text-decoration:none;color:inherit" title="Open in a new tab if login inside the frame ever misbehaves">↗ New Tab</a>
      </div>
    </div>
  </div>
  <iframe id="audit-iframe" data-src="https://random.duapharma.com"
    style="flex:1;width:100%;border:0;min-height:70vh;background:var(--surface)"
    title="Audit — Pharmacy Audit Hub"
    allow="clipboard-write"></iframe>
</div>
```

```html
<script type="module" src="js/audit-bridge.js"></script>
```

## 12.6 `js/audit-bridge.js` — Cover tile summary (direct Supabase read)

No export/import token step, unlike Closing — the anon key is baked in
directly and RLS is what actually protects the data (per §12.0 and the
Pharmacy Audit Hub blueprint's own security model). Reads only
already-computed rows, same non-negotiable rule as Closing's bridge:
never re-derive Audit's own compile/variance math here.

```js
// ══════════════════════════════════════════════════════════════════
// AUDIT BRIDGE — V2 plan §12, "read + re-analyze"
//
// A one-way, read-only peek into Pharmacy Audit Hub's Supabase data —
// NOT a merge, NOT a second copy of its business logic. Reads a few
// already-computed rows (open engagement, round state, submission
// counts) straight from Supabase to show on the Cover Dashboard tile.
// Compile/variance/difference logic lives entirely in Pharmacy Audit
// Hub's own actions/ and is deliberately not reproduced here.
//
// Anon key is intentionally public in client code — RLS is the real
// isolation boundary (see random-app/BLUEPRINT.md "Identity & Access").
// This bridge only ever runs SELECTs a Main-Auditor session can already
// see; it doesn't carry its own elevated credentials.
// ══════════════════════════════════════════════════════════════════

const AUDIT_SUPABASE_URL = 'https://<project-ref>.supabase.co';
const AUDIT_SUPABASE_ANON_KEY = '<anon-key>';
const MIN_REFRESH_MS = 5 * 60 * 1000; // match Closing's rate limit

let _client = null;
let _lastFetch = 0;
let _cache = null;

function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // needs the supabase-js <script> tag loaded once, globally
  _client = supabase.createClient(AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY);
  return _client;
}

async function fetchSummary(force) {
  const now = Date.now();
  if (!force && _cache && (now - _lastFetch) < MIN_REFRESH_MS) return _cache;
  const client = _getClient();
  if (!client) return null;

  const { data: engagements } = await client
    .from('engagements').select('id,name,status').eq('status', 'open');
  const { data: rounds } = await client
    .from('rounds').select('id,engagement_id,round_number,state')
    .in('state', ['draft', 'locked', 'counting', 'compiled']);
  const { data: assignments } = await client
    .from('assignments').select('id,round_id,status');

  _cache = { engagements: engagements || [], rounds: rounds || [], assignments: assignments || [] };
  _lastFetch = now;
  return _cache;
}

export async function refreshOnPageShow() {
  const el = document.getElementById('audit-bridge-status');
  if (!el) return;
  const s = await fetchSummary(false);
  el.textContent = s ? `${s.engagements.length} open engagement(s)` : 'not connected';
}

export async function getCachedSummary() { return _cache || fetchSummary(false); }

// Floor 5 bridging — same pattern as every other module's window exports.
window.auditBridgeRefresh = refreshOnPageShow;
window.auditBridgeGetCachedSummary = getCachedSummary;
```

Cover Dashboard tile then just calls `auditBridgeGetCachedSummary()` the
same way the Closing tile reads its cached blob — one line, no new
pattern.

## 12.7 Auth model

Deliberately two independent auth systems, same as Closing:

- BT Sales shell: existing Google Sign-In gate, unchanged.
- Inside the `audit-iframe`: Pharmacy Audit Hub's own Supabase phone+PIN
  login, running cross-origin, entirely on its own.

This is intentional, not a gap — it's what "own repo, own everything"
means. The only new coupling is `audit-bridge.js` reading Supabase
directly with the anon key, which is a separate, unauthenticated (RLS-
scoped) read path from the iframe's own logged-in session.

## 12.8 Known risk to test before relying on this

iOS Safari in **standalone PWA mode** partitions storage for
cross-origin iframes more aggressively than desktop/Android Chrome.
Closing hasn't hit this because its iframe doesn't depend on a *session*
persisting inside the frame — Audit's Supabase login does. Concretely:
confirm on a real installed iOS PWA that (a) the phone+PIN login inside
`audit-iframe` succeeds, and (b) the session survives a navigate-away/
navigate-back within BT Sales (not just a fresh page load). If it
doesn't persist, the "↗ New Tab" escape hatch (§12.5) is the fallback,
same role Closing's has for Dropbox's un-frameable OAuth page.

## 12.9 Delivery checklist

1. Add `data-group="audit"` nav tab + `bnav-item` (§12.4).
2. Extend `showPage()` domain classification + lazy-load branch (§12.2).
3. Extend `nav.css` hide-lists (both directions) + accent block (§12.3).
4. Add `page-audit` iframe block to `index.html` (§12.5).
5. Write `audit-bridge.js`, load `supabase-js` globally once (check
   whether it's already loaded for another feature before adding a
   second `<script>` tag for it).
6. Add Cover Dashboard tile consuming `auditBridgeGetCachedSummary()`.
7. Real-device test on iOS standalone PWA per §12.8 before treating the
   in-frame login as reliable.
8. jsdom test mirroring the one already written for domain
   classification/brand-label swap/CSS hiding — extend it to cover
   `audit` alongside `sales`/`manager`/`notesheets`/`closing`.

## 12.10 Open questions

1. Confirm the Supabase project ref + anon key to bake into
   `audit-bridge.js` (§12.6) — same project Pharmacy Audit Hub already
   uses, not a new one.
2. Does `supabase-js` need to be added as a new global `<script>` tag in
   `index.html`, or is something equivalent already loaded for another
   domain?
3. Icon/emoji for the nav tab (`🧾` used above, placeholder).
4. Whether the Cover tile should show engagement/round status only
   (§12.6) or also a lightweight progress bar (submissions received /
   assignments total) — cheap to add from the same three queries if
   wanted.
