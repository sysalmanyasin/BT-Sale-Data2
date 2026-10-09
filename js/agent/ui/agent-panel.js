// ══════════════════════════════════════════════════════════════════════
// AGENT PANEL — floating button + chat sheet (mobile-first).
// Pure presentation: delegates everything to runAgent().
// ══════════════════════════════════════════════════════════════════════
import { runAgent, AgentError } from '../core/agent-client.js';
import { planInvestigation, runInvestigation } from '../core/orchestrator.js';
import { callServer, callAction } from '../core/server.js';
import { createConversation, appendTurn, listConversations, loadConversation, deleteConversation, deleteAllConversations, pruneOld } from '../core/history.js';
import { syncKnowledge, getPrefs as getKnowPrefs, setPrefs as setKnowPrefs, clearManifest } from '../core/knowledge.js';
import { logToolCall } from '../core/audit.js';
import { renderMarkdown } from '../core/markdown-lite.js';
import { getPageContext } from '../tools/app.js';
import { getWritesEnabled, setWritesEnabled, getBriefingSeen, setBriefingSeen } from '../core/prefs.js';
import { buildBriefing } from '../tools/briefing.js';
import { badgeState, cardItems } from '../core/briefing-badge.js';
import { pushUndo, runUndo, clearUndo } from '../core/undo.js';
import { clearSession } from '../core/auditor.js';
import { listFacts, addFact, deleteFact, getRules, saveRules, MAX_RULES, MAX_FACT } from '../core/memory.js';
import { tryInstant } from '../core/instant.js';
import { getKillState, setKillState } from '../core/kill-switch.js';
import { loadPendingUndos, markUndone } from '../core/undo-store.js';
import { emit as emitTelemetry } from '../core/telemetry.js';
import { summarizeUsage, summarizeAudit, fetchUsage, fetchAudit } from '../core/usage-stats.js';

const getSb = () => (typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null);

const SUGGESTIONS = [
  'What needs my attention today?',
  "How are today's sales?",
  'Target pace this month',
  'What is low on stock?',
];
const TOOL_LABELS = {
  get_sales_summary: 'Checking monthly sales', get_daily_sales: 'Reading daily sales', top_sales_days: 'Ranking sale days',
  compare_sales_months: 'Comparing months', get_target_pace: 'Checking target pace', get_year_overview: 'Reading year overview',
  list_sales_months: 'Listing months', list_staff: 'Reading staff list', find_staff: 'Finding staff',
  list_ledger_types: 'Listing ledgers', get_ledger_entries: 'Reading ledger', get_ledger_month_totals: 'Totalling ledger',
  inventory_overview: 'Checking inventory', search_inventory: 'Searching inventory', low_stock_items: 'Finding low stock',
  low_cover_items: 'Checking stock cover', slow_moving_stock: 'Finding slow stock', navigate_to: 'Opening page',
  str_overview: 'Checking transfers', list_pending_strs: 'Finding pending transfers', get_str_detail: 'Reading transfer', closing_status: 'Checking closing', closing_recent_days: 'Checking recent closings',
  billing_overview: 'Checking emergency billing', list_emergency_invoices: 'Listing invoices', get_emergency_invoice: 'Reading invoice',
  search_notes: 'Searching notes', get_note: 'Reading note', list_sheets: 'Listing sheets', read_sheet: 'Reading sheet', search_knowledge: 'Searching your notes and sheets', remember_fact: 'Preparing memory',
  get_app_context: 'Checking date', list_pages: 'Listing pages',
  add_staff_note: 'Preparing note', add_ledger_entry: 'Preparing ledger entry', set_monthly_target: 'Preparing target change',
  edit_daily_sales_field: 'Preparing sales edit', add_daily_sales_entry: 'Preparing sales entry', get_staff_notes: 'Reading staff notes', delete_ledger_entry: 'Preparing delete', delete_staff_note: 'Preparing delete', delete_staff_credit_entry: 'Preparing delete', delete_daily_sales_entry: 'Preparing delete', daily_briefing: 'Preparing your briefing', get_staff_credit: 'Reading staff credit', add_staff_credit_entry: 'Preparing credit entry',
};

export function mountAgentPanel() {
  if (document.getElementById('ag-fab')) return;
  const conversationId = 'c_' + Date.now().toString(36);
  let history = [];
  let convDbId = null;   // saved-conversation id (created on the first answer)
  let pruned = false;
  let busy = false;
  let abort = null;
  let sensitive = false;
  let lastSpecialist = null;

  const fab = el('button', { id: 'ag-fab', class: 'ag-fab', 'aria-label': 'Open BT Intelligence', title: 'BT Intelligence' }, '✨');
  const sheet = el('section', { id: 'ag-sheet', class: 'ag-sheet', hidden: '', role: 'dialog', 'aria-label': 'AI assistant' });
  sheet.innerHTML = `
    <header class="ag-head">
      <div><strong>BT Assistant</strong><span class="ag-sub" id="ag-sub"></span></div>
      <div class="ag-head-btns">
        <button class="ag-ico" id="ag-hist" title="Past conversations" aria-label="Past conversations">🕘</button>
        <button class="ag-ico" id="ag-mem" title="Memory and house rules" aria-label="Memory and house rules">🧠</button>
        <button class="ag-ico" id="ag-stats" title="Usage and activity" aria-label="Usage and activity">📊</button>
        <button class="ag-ico" id="ag-kill" aria-label="Stop all AI changes on every device"></button>
        <button class="ag-ico" id="ag-lock" aria-label="Allow changes"></button>
        <button class="ag-ico" id="ag-clear" title="New chat" aria-label="New chat">↺</button>
        <button class="ag-ico" id="ag-close" title="Close" aria-label="Close">✕</button>
      </div>
    </header>
    <div class="ag-log" id="ag-log" aria-live="polite"></div>
    <div class="ag-chips" id="ag-chips"></div>
    <div class="ag-input">
      <textarea id="ag-text" rows="1" maxlength="2000" placeholder="Ask about sales, staff, stock…" enterkeyhint="send"></textarea>
      <button id="ag-send" class="ag-send" aria-label="Send">➤</button>
    </div>`;
  document.body.append(fab, sheet);

  const log = sheet.querySelector('#ag-log');
  const text = sheet.querySelector('#ag-text');
  const send = sheet.querySelector('#ag-send');
  const chips = sheet.querySelector('#ag-chips');
  const lockBtn = sheet.querySelector('#ag-lock');
  const sub = sheet.querySelector('#ag-sub');
  const pending = new Set(); // resolvers of open approval cards

  let killed = true; // fail safe until the server state is known
  const killBtn = sheet.querySelector('#ag-kill');
  async function refreshKill() {
    const k = await getKillState(getSb());
    killed = k.killed; paintLock();
    return k;
  }
  function paintLock() {
    killBtn.textContent = killed ? '⛔' : '🛡';
    killBtn.title = killed ? 'AI changes are STOPPED on all devices. Tap to resume.' : 'Tap to stop all AI changes on every device.';
    killBtn.classList.toggle('ag-on', killed);
    const on = getWritesEnabled() && !killed;
    lockBtn.textContent = on ? '🔓' : '🔒';
    lockBtn.title = on ? 'Changes allowed (you approve each one). Tap to lock.' : 'Read-only. Tap to allow changes.';
    lockBtn.classList.toggle('ag-on', on);
    sub.textContent = killed ? 'Changes stopped on all devices' : on ? 'Can propose changes · you approve each' : 'Read-only · asks your live data';
  }
  // ── proactive briefing: badge on the ✨ button + a "Today" card (no AI call, no tokens) ──
  let briefing = null;
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const badge = el('span', { class: 'ag-badge', hidden: '' });
  fab.append(badge);
  function refreshBriefing() {
    try { briefing = buildBriefing(new Date()); } catch (e) { console.error('[agent] briefing', e); briefing = null; }
    const b = badgeState(briefing, getBriefingSeen(), todayStr());
    badge.textContent = b.label; badge.hidden = !b.show;
  }
  function markSeen() {
    if (!briefing) return;
    setBriefingSeen(todayStr(), badgeState(briefing, null, todayStr()).count);
    badge.hidden = true;
  }
  function addBriefingCard() {
    if (!briefing) return;
    const { items, more, clear } = cardItems(briefing);
    const card = el('div', { class: 'ag-today' });
    if (clear) card.innerHTML = '<div class="ag-today-t">✓ Nothing urgent today</div>';
    else {
      card.innerHTML = '<div class="ag-today-t">' + items.length + (more ? '+' : '') + ' thing' + (items.length + more === 1 ? '' : 's') + ' need attention</div><ul>'
        + items.map(i => '<li>' + escHtml(i.message) + '</li>').join('') + (more ? '<li>…and ' + more + ' more</li>' : '') + '</ul>';
      const b = el('button', { class: 'ag-today-b' }, 'Explain and suggest actions');
      b.onclick = () => ask('What needs my attention today?');
      card.append(b);
    }
    log.append(card);
  }
  function rejectAllPending() { pending.forEach(r => r(false)); pending.clear(); }

  // ── approval card ──────────────────────────────────────────────────
  // ONE approval system. The card below and the AI Center's approval view both drive the same controller, so the
  // typed-word check for deletes and the second "Yes, I am sure" tap for strong changes are enforced in one place.
  const approvals = new Map(); // approval id → controller (only while the human has not decided yet)
  function approve({ preview, tool, risk, approval_id }) {
    return new Promise(resolve => {
      const card = el('div', { class: 'ag-card' });
      const warn = (preview.warnings || []).map(w => '<div class="ag-warn">⚠ ' + escHtml(w) + '</div>').join('');
      card.innerHTML = '<div class="ag-card-t">' + escHtml(preview.title) + '</div>'
        + '<ul class="ag-card-l">' + preview.lines.map(l => '<li>' + escHtml(l) + '</li>').join('') + '</ul>' + warn
        + (preview.confirmWord ? '<div class="ag-type"><label>Type <b>' + escHtml(preview.confirmWord) + '</b> to confirm</label><input class="ag-type-in" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>' : '')
        + '<div class="ag-card-b"><button class="ag-no">Reject</button><button class="ag-yes">' + (preview.confirmWord ? 'Delete' : preview.strong ? 'Approve…' : 'Approve') + '</button></div>';
      log.append(card); log.scrollTop = log.scrollHeight;
      const yes = card.querySelector('.ag-yes'), no = card.querySelector('.ag-no');
      let armed = !preview.strong || !!preview.confirmWord;
      const typeIn = card.querySelector('.ag-type-in');
      const id = approval_id || ('ap_local_' + Date.now().toString(36));
      const done = (ok, label, value) => { pending.delete(finish); approvals.delete(id); card.classList.add('ag-done'); card.querySelector('.ag-card-b').innerHTML = '<span class="ag-card-r">' + label + '</span>'; const t = card.querySelector('.ag-type'); if (t) t.remove(); resolve(ok ? (preview.confirmWord ? { approved: true, typed: value } : true) : false); };
      const finish = ok => done(ok, ok ? '✓ Approved' : '✕ Rejected', typeIn ? typeIn.value : undefined);
      pending.add(finish);
      if (typeIn) {
        yes.disabled = true;
        typeIn.oninput = () => { yes.disabled = typeIn.value.trim().toLowerCase() !== String(preview.confirmWord).toLowerCase(); };
      }
      // The single place where an approval is granted. Returns { ok } or { ok:false, needs:'type'|'confirm' }.
      const grant = typed => {
        if (preview.confirmWord) {
          const t = String(typed != null ? typed : (typeIn ? typeIn.value : ''));
          if (t.trim().toLowerCase() !== String(preview.confirmWord).toLowerCase()) return { ok: false, needs: 'type', word: preview.confirmWord };
          if (typeIn) typeIn.value = t;
          finish(true); return { ok: true };
        }
        if (!armed) { armed = true; yes.textContent = 'Yes, I am sure'; yes.classList.add('ag-warn-btn'); return { ok: false, needs: 'confirm' }; }
        finish(true); return { ok: true };
      };
      approvals.set(id, { id, tool, risk, preview, armed: () => armed, grant, reject: () => { finish(false); return { ok: true }; } });
      no.onclick = () => finish(false);
      yes.onclick = () => { if (yes.disabled) return; grant(); };
    });
  }

  function addUndoRow({ tool, label, fn, key = null }) {
    const item = pushUndo({ tool, label, fn, key });
    const row = el('div', { class: 'ag-undo' });
    row.innerHTML = '<span>✓ Saved</span>';
    const b = el('button', { class: 'ag-undo-btn' }, '↶ Undo: ' + label);
    b.onclick = async () => {
      b.disabled = true;
      const t0 = Date.now();
      const r = await runUndo(item.id);
      if (r.ok && r.key) markUndone(getSb(), r.key);
      // Real event: the person pressed Undo and runUndo() reported this outcome. (Read-back verification of the undo is separate work.)
      emitTelemetry({ type: 'undo', source: 'panel', tool, status: r.ok ? 'ok' : 'failed', duration: Date.now() - t0, severity: r.ok ? 'info' : 'warning', entity_reference: key || item.id,
        metadata: { label, error: r.ok ? undefined : r.error } });
      row.innerHTML = r.ok ? '<span>↶ Undone: ' + escHtml(r.label) + '</span>' : '<span class="ag-warn">⚠ ' + escHtml(r.error) + '</span>';
    };
    row.append(b); log.append(row); log.scrollTop = log.scrollHeight;
  }

  // ── usage + activity screen (own rows only) ──
  async function showStats() {
    const card = el('div', { class: 'ag-card' });
    card.innerHTML = '<div class="ag-card-t">Usage and activity</div><div class="ag-warn">Loading…</div>';
    log.append(card); log.scrollTop = log.scrollHeight;
    const sb = getSb();
    const [u, a] = await Promise.all([fetchUsage(sb, 24), fetchAudit(sb, 12)]);
    const prov = summarizeUsage(u), acts = summarizeAudit(a);
    const pHtml = prov.length ? '<ul class="ag-card-l">' + prov.map(p => '<li><b>' + escHtml(p.provider) + '</b>: ' + p.calls + ' calls · ' + p.failed + ' failed' + (p.rateLimited ? ' (' + p.rateLimited + ' rate-limited)' : '') + (p.avgLatencyMs != null ? ' · ' + p.avgLatencyMs + ' ms' : '') + '</li>').join('') + '</ul>' : '<div class="ag-warn">No AI calls in the last 24 hours.</div>';
    const aHtml = acts.length ? '<ul class="ag-card-l">' + acts.map(x => '<li>' + escHtml(x.tool) + ' — ' + escHtml(x.status) + ' <small>' + escHtml(new Date(x.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</small></li>').join('') + '</ul>' : '<div class="ag-warn">No tool activity yet.</div>';
    card.innerHTML = '<div class="ag-card-t">AI calls, last 24h</div>' + pHtml + '<div class="ag-card-t">Recent tool activity</div>' + aHtml;
    log.scrollTop = log.scrollHeight;
  }
  // ── saved conversations ──
  async function saveTurn(q, answer, specialistId) {
    const sb = getSb(); if (!sb) return;
    if (!convDbId) convDbId = await createConversation(sb, q, specialistId || null);
    if (convDbId) appendTurn(sb, convDbId, q, answer);
    if (!pruned) { pruned = true; pruneOld(sb); }
  }
  async function showHistory() {
    const sb = getSb();
    const card = el('div', { class: 'ag-card' });
    card.innerHTML = '<div class="ag-card-t">Past conversations</div><div class="ag-warn">Loading…</div>';
    log.append(card); log.scrollTop = log.scrollHeight;
    const rows = await listConversations(sb, 15);
    const fmt = t => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    card.innerHTML = '<div class="ag-card-t">Past conversations</div>'
      + (rows.length ? '<ul class="ag-card-l">' + rows.map(r => '<li data-id="' + escHtml(r.id) + '"><button class="ag-undo-btn ag-open">' + escHtml(r.title || 'Untitled') + '</button> <small>' + escHtml(fmt(r.updated_at)) + '</small> <button class="ag-undo-btn ag-delc" aria-label="Delete">✕</button></li>').join('') + '</ul><div class="ag-card-b"><button class="ag-no ag-delall">Delete all history</button></div>' : '<div class="ag-warn">Nothing saved yet. Conversations are kept for 90 days.</div>');
    card.querySelectorAll('.ag-open').forEach(b => { b.onclick = async () => {
      const id = b.closest('li').dataset.id; const msgs = await loadConversation(sb, id);
      if (!msgs.length) return;
      rejectAllPending(); history = msgs.map(m => ({ role: m.role, content: m.content })); convDbId = id; sensitive = true; lastSpecialist = null; // restored text may hold private data: stay on non-training providers
      log.innerHTML = ''; msgs.forEach(m => addBubble(m.role, m.content)); addBubble('status', 'Conversation restored. Ask a follow-up.');
    }; });
    card.querySelectorAll('.ag-delc').forEach(b => { b.onclick = async () => { const li = b.closest('li'); if (await deleteConversation(sb, li.dataset.id)) { if (convDbId === li.dataset.id) convDbId = null; li.remove(); } }; });
    const da = card.querySelector('.ag-delall'); if (da) da.onclick = async () => { if (window.confirm('Delete ALL saved conversations?')) { if (await deleteAllConversations(sb)) { convDbId = null; card.querySelector('.ag-card-l').remove(); da.remove(); } } };
    log.scrollTop = log.scrollHeight;
  }

  // ── memory + house rules (the owner's own words; the model cannot write these) ──
  async function showMemory() {
    const sb = getSb();
    const card = el('div', { class: 'ag-card' });
    card.innerHTML = '<div class="ag-card-t">Memory</div><div class="ag-warn">Loading…</div>';
    log.append(card); log.scrollTop = log.scrollHeight;
    const [facts, rules] = await Promise.all([listFacts(sb), getRules(sb)]);
    let version = rules.version;
    const kp = getKnowPrefs();
    const paint = () => {
      card.innerHTML = '<div class="ag-card-t">How I run this pharmacy</div>'
        + '<textarea class="ag-type-in ag-rules" rows="5" maxlength="' + MAX_RULES + '" placeholder="e.g. Closing is at 10pm. Ali is the senior salesman. Call credit above Rs 5,000 \'high\'.">' + escHtml(rules.body) + '</textarea>'
        + '<div class="ag-card-b"><button class="ag-yes ag-save-rules">Save rules</button></div><div class="ag-rules-msg"></div>'
        + '<div class="ag-card-t">Remembered facts</div>'
        + '<ul class="ag-card-l">' + (facts.length ? facts.map(f => '<li data-id="' + f.id + '">' + escHtml(f.fact) + ' <button class="ag-undo-btn ag-del">✕</button></li>').join('') : '<li>Nothing yet.</li>') + '</ul>'
        + '<div class="ag-type"><input class="ag-type-in ag-new-fact" type="text" maxlength="' + MAX_FACT + '" placeholder="Add a fact, e.g. closing is at 10pm"></div>'
        + '<div class="ag-card-b"><button class="ag-yes ag-add-fact">Add fact</button></div>'
        + '<div class="ag-card-t">Search my notes and sheets</div>'
        + '<div class="ag-warn">Indexing sends the text of your Notes and Sheets (with phone numbers, CNICs and emails removed) to the free embedding service, so the assistant can search by meaning. Nothing is sent until you tap Index now.</div>'
        + '<label class="ag-warn"><input type="checkbox" class="ag-k-staff"' + (kp.staffNotes ? ' checked' : '') + '> Include staff notes (only used if a private embedding service is set up)</label>'
        + '<label class="ag-warn"><input type="checkbox" class="ag-k-auto"' + (kp.auto ? ' checked' : '') + '> Keep the index updated automatically</label>'
        + '<div class="ag-card-b"><button class="ag-yes ag-k-run">Index now</button> <button class="ag-no ag-k-clear">Delete index</button></div><div class="ag-k-msg ag-warn">' + (kp.lastSync ? 'Last indexed ' + new Date(kp.lastSync).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.' : 'Not indexed yet.') + '</div>';
      const msg = t => { card.querySelector('.ag-rules-msg').textContent = t; };
      card.querySelector('.ag-save-rules').onclick = async () => {
        const r = await saveRules(sb, card.querySelector('.ag-rules').value, version);
        if (r.ok) { version = r.version; rules.body = card.querySelector('.ag-rules').value.trim(); msg('Saved (version ' + version + '). Used from your next message.'); } else msg('⚠ ' + r.error);
      };
      card.querySelector('.ag-add-fact').onclick = async () => {
        const inp = card.querySelector('.ag-new-fact');
        const r = await addFact(sb, inp.value, facts.length);
        if (r.ok && r.row) { facts.unshift(r.row); paint(); } else if (!r.ok) msg('⚠ ' + r.error);
      };
      const kmsg = t => { card.querySelector('.ag-k-msg').textContent = t; };
      card.querySelector('.ag-k-staff').onchange = e => { kp.staffNotes = e.target.checked; setKnowPrefs({ staffNotes: kp.staffNotes }); };
      card.querySelector('.ag-k-auto').onchange = e => { kp.auto = e.target.checked; setKnowPrefs({ auto: kp.auto }); };
      card.querySelector('.ag-k-run').onclick = async () => {
        kmsg('Indexing…');
        const r = await syncKnowledge({ sb, callAction, includeStaffNotes: kp.staffNotes, onProgress: p => kmsg('Indexing… ' + p.batch + '/' + p.of) });
        kmsg((r.ok ? 'Done. ' : '⚠ ' + r.error + ' ') + r.indexedItems + ' items updated, ' + r.unchanged + ' unchanged' + (r.removed ? ', ' + r.removed + ' removed' : '') + (r.skippedStaff ? '. ' + r.skippedStaff + ' staff-note parts were not indexed (needs a private embedding service)' : '') + '.');
      };
      card.querySelector('.ag-k-clear').onclick = async () => {
        if (!window.confirm('Delete the whole search index? Your notes and sheets are not touched.')) return;
        const { error } = await sb.from('agent_knowledge').delete().not('id', 'is', null);
        if (error) kmsg('⚠ ' + error.message); else { clearManifest(); kmsg('Index deleted.'); }
      };
      card.querySelectorAll('.ag-del').forEach(b => { b.onclick = async () => {
        const id = Number(b.parentElement.dataset.id); const r = await deleteFact(sb, id);
        if (r.ok) { facts.splice(facts.findIndex(f => f.id === id), 1); paint(); } else msg('⚠ ' + r.error);
      }; });
    };
    paint(); log.scrollTop = log.scrollHeight;
  }
  async function showPendingUndos() {
    const items = await loadPendingUndos(getSb());
    items.slice(0, 5).forEach(it => addUndoRow({ tool: it.tool, label: it.label, fn: it.fn, key: it.key }));
  }

  function renderChips() {
    chips.innerHTML = '';
    if (history.length) return;
    SUGGESTIONS.forEach(s => { const b = el('button', { class: 'ag-chip' }, s); b.onclick = () => ask(s); chips.append(b); });
  }
  function welcome() {
    log.innerHTML = '';
    addBubble('assistant', getWritesEnabled()
      ? "Hi! I can read your data and, with your approval on each one, add ledger entries, staff notes and staff credit, set targets and add or correct a day's sales, and delete records (you type DELETE to confirm). What do you need?"
      : "Hi! I can read your sales, staff, ledgers and inventory, and open pages for you. Tap 🔒 above if you want me to be able to propose changes (you'd still approve each one). What would you like to know?");
    refreshBriefing(); addBriefingCard(); markSeen(); showPendingUndos();
    renderChips();
  }
  function addBubble(role, content, { html = false } = {}) {
    const b = el('div', { class: 'ag-msg ag-' + role });
    if (html) b.innerHTML = content; else if (role === 'assistant') b.innerHTML = renderMarkdown(content); else b.textContent = content;
    log.append(b); log.scrollTop = log.scrollHeight;
    return b;
  }
  function setBusy(v) { busy = v; send.disabled = v; text.disabled = v; sheet.classList.toggle('ag-busy', v); }

  // Structured results of orchestrated investigations (in memory only, last 10): the AI Center reads them to show typed
  // evidence, confidence and the recommendation. Never persisted: they can contain business figures.
  const investigationResults = [];
  const keepInvestigation = r => { investigationResults.unshift(r); investigationResults.length = Math.min(investigationResults.length, 10); };

  /** @param {{investigate?:{domains?:string[], finding?:object}}} [opts]  investigate: run the orchestrator even for a plain-worded question (used by "Investigate with BT"). */
  async function ask(q, opts = {}) {
    q = String(q || '').trim();
    if (!q || busy) return;
    text.value = ''; autosize();
    chips.innerHTML = '';
    addBubble('user', q);
    // Instant path: common one-liners are answered locally, with no AI call at all.
    try {
      const quick = opts.investigate ? null : await tryInstant(q);
      if (quick) { emitTelemetry({ type: 'instant', source: 'instant-path', tool: quick.tool, status: 'ok', metadata: { question: q.slice(0, 100), model_used: false, text: String(quick.text || '').slice(0, 1200) } }); saveTurn(q, quick.text); const b = addBubble('assistant', quick.text); b.append(el('div', { class: 'ag-by' }, 'Instant · no AI used')); logToolCall({ tool: quick.tool, risk: quick.kind === 'navigate' ? 'ui' : 'read', args: {}, ok: true, resultChars: quick.text.length }, { conversationId }); return; }
    } catch (e) { console.error('[agent] instant', e); }
    const status = addBubble('status', 'Thinking…');
    let live = null, liveText = ''; // the bubble that fills in as the answer streams
    setBusy(true);
    abort = new AbortController();
    try {
      await refreshKill(); // server-side switch: checked before every request
      // "Why ..." questions that touch several business areas are investigated by independent specialists and
      // synthesised by the Analyst (read-only). Plain look-ups keep the single cheap specialist run below.
      const plan = opts.investigate ? planInvestigation(q, { force: true, domains: opts.investigate.domains }) : planInvestigation(q);
      const onEvent = ev => {
        if (ev.type === 'phase') status.textContent = ev.text + '...';
        if (ev.type === 'tool_start') status.textContent = (TOOL_LABELS[ev.name] || 'Working') + '...';
        if (ev.type === 'token') { liveText += ev.text; if (!live) { status.remove(); live = el('div', { class: 'ag-msg ag-assistant' }); log.append(live); } live.textContent = liveText; log.scrollTop = log.scrollHeight; }
        if (ev.type === 'reset') { liveText = ''; if (live) { live.remove(); live = null; if (!status.isConnected) log.append(status); } }
        if (ev.type === 'writes_killed') { killed = true; paintLock(); }
        if (ev.type === 'tool_end' && !ev.ok && !ev.rejected && ev.error && /writes_disabled/.test(ev.error)) paintLock();
      };
      const r = plan.orchestrate ? await runInvestigation({ question: q, plan, callServer, context: getPageContext(), signal: abort.signal, sensitive, onEvent, finding: opts.investigate ? opts.investigate.finding || null : null, onResult: keepInvestigation }) : await runAgent({
        history, userText: q, context: getPageContext(), callServer, signal: abort.signal, sensitive, stream: true,
        routeServer: t => callAction('route', { text: t }).then(r => r.domains || []),
        reviewServer: p => callAction('review', { proposal: { tool: p.tool, title: p.preview && p.preview.title, lines: ((p.preview && p.preview.lines) || []).map(String), amount: p.preview && p.preview.amount, today: new Date().toISOString().slice(0, 10) } }),
        writesEnabled: getWritesEnabled(), writesKilled: killed, approve, onUndoable: addUndoRow, prevSpecialist: lastSpecialist,
        onEvent,
        onAudit: e => logToolCall(e, { conversationId }),
      });
      history = r.investigation ? [...history, ...r.messages].slice(-30) : r.messages; sensitive = r.sensitive; lastSpecialist = r.specialist;
      status.remove(); if (live) { live.remove(); live = null; }
      const ab = addBubble('assistant', r.text);
      saveTurn(q, r.text, r.specialist && r.specialist.id);
      if (r.specialist && r.specialist.id !== 'general') ab.append(el('div', { class: 'ag-by' }, r.investigation ? 'Analyst - ' + r.investigation.plan.members.map(m => m.label).join(' + ') : r.specialist.label));
    } catch (e) {
      status.remove(); if (live) { live.remove(); live = null; }
      const msg = e instanceof AgentError ? e.message : 'Something went wrong. Please try again.';
      if (!(e instanceof AgentError) || e.code !== 'aborted') addBubble('error', msg);
      if (!(e instanceof AgentError)) console.error('[agent]', e);
    } finally {
      abort = null; setBusy(false); text.focus();
    }
  }

  function autoIndex() {
    const kp = getKnowPrefs();
    if (!kp.auto || Date.now() - (kp.lastSync || 0) < 12 * 3600 * 1000) return;
    syncKnowledge({ sb: getSb(), callAction, includeStaffNotes: kp.staffNotes }).catch(() => {});
  }
  function autosize() { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; }
  // The assistant lives on the BT Intelligence page ONLY. Everywhere else the button just takes you there and opens the chat on arrival.
  const onCenter = () => document.body.classList.contains('aic-open');
  function openHere() { sheet.hidden = false; refreshKill(); autoIndex(); fab.classList.add('ag-hide'); if (!log.children.length) welcome(); setTimeout(() => text.focus(), 50); }
  function open() {
    if (onCenter()) { openHere(); return; }
    window.location.hash = '#ai-center';
    let tries = 0;
    const t = setInterval(() => { if (onCenter()) { clearInterval(t); openHere(); } else if (++tries > 40) clearInterval(t); }, 50);
  }
  function close() { rejectAllPending(); sheet.hidden = true; fab.classList.remove('ag-hide'); if (abort) abort.abort(); }
  // Leaving BT Intelligence closes the chat (pending approvals are rejected, exactly like pressing close).
  window.addEventListener('hashchange', () => setTimeout(() => { if (!sheet.hidden && !onCenter()) close(); }, 150));

  fab.onclick = open;
  sheet.querySelector('#ag-close').onclick = close;
  sheet.querySelector('#ag-clear').onclick = () => { rejectAllPending(); if (abort) abort.abort(); history = []; convDbId = null; sensitive = false; lastSpecialist = null; clearUndo(); clearSession(); welcome(); };
  lockBtn.onclick = () => {
    if (getWritesEnabled()) { setWritesEnabled(false); }
    else if (window.confirm('Allow the assistant to propose changes?\n\nIt can add ledger entries and staff notes, set targets and correct a day\'s sales. Nothing is saved until you tap Approve on each change, and most can be undone.')) setWritesEnabled(true);
    paintLock(); if (!history.length) welcome();
  };
  killBtn.onclick = async () => {
    const turningOn = !killed;
    if (turningOn && !window.confirm('Stop ALL AI changes on every device?\n\nThe assistant can still answer questions. You can resume any time.')) return;
    if (!turningOn && !window.confirm('Resume AI changes on every device?\n\n(Each device still has its own lock, and you approve every change.)')) return;
    const r = await setKillState(getSb(), turningOn, (window.currentUserEmail || null));
    if (!r.ok) { addBubble('error', 'Could not change the switch: ' + r.error); return; }
    killed = r.killed; rejectAllPending(); paintLock();
  };
  // Public hook for the AI Center command bar: the SAME agent, panel and approval cards. No second chatbot.
  window.BTAgent = Object.freeze({
    ask: q => ask(q), open,
    // Start a REAL investigation (independent specialists + Analyst synthesis) from a finding. Falls back to a single run, honestly
    // labelled in telemetry, when fewer than two areas are relevant.
    investigate: ({ question, domains, finding } = {}) => ask(question, { investigate: { domains: Array.isArray(domains) ? domains : [], finding: finding || null } }),
    investigationFor: findingId => investigationResults.find(r => r.finding_id === String(findingId)) || null, isBusy: () => busy, writesAllowed: () => getWritesEnabled() && !killed, killed: () => killed,
    // Pending approvals, for the AI Center's approval view (read-only snapshot of the real proposals).
    approvals: () => [...approvals.values()].map(c => ({ id: c.id, tool: c.tool, risk: c.risk, preview: c.preview, armed: c.armed() })),
    /**
     * Decide a pending approval through the SAME controller the card uses. Approving requires a trusted user gesture
     * (`gesture.isTrusted === true`, i.e. a real click event): script-made events cannot approve a change.
     * Rejecting never needs one. Kill switch / lock / hard blocks are enforced before any approval exists and again by runTool.
     */
    decide: (id, action, { typed, gesture } = {}) => {
      const c = approvals.get(id);
      if (!c) return { ok: false, error: 'This request is no longer waiting (it was already decided or cancelled).' };
      if (action === 'reject') return c.reject();
      if (action !== 'approve') return { ok: false, error: 'Unknown action.' };
      if (killed) return { ok: false, error: 'AI changes are stopped (kill switch).' };
      if (!gesture || gesture.isTrusted !== true) return { ok: false, error: 'Approval needs a real tap or click.' };
      return c.grant(typed);
    },
  });
  sheet.querySelector('#ag-stats').onclick = showStats;
  sheet.querySelector('#ag-mem').onclick = showMemory;
  sheet.querySelector('#ag-hist').onclick = showHistory;
  paintLock(); refreshKill();
  send.onclick = () => ask(text.value);
  text.addEventListener('input', autosize);
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text.value); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) close(); });
}

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function el(tag, attrs = {}, content) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (content != null) e.textContent = content;
  return e;
}
