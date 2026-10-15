// ══════════════════════════════════════════════════════════════════════
// AGENT PANEL: the ONE chat assistant, "Dua". A floating button on every page opens a compact panel over the current page
// (a floating card on desktop, a bottom sheet on a phone), so nobody has to leave what they are doing. The BT Intelligence page
// has no chat of its own: its "Ask Dua" buttons call window.BTAgent, which opens this panel.
// Pure presentation: everything is delegated to runAgent(), so tools, permissions, approvals, undo, audit and the kill switch
// are unchanged. Page awareness (which page, which starter questions) lives in core/page-suggestions.js.
// ══════════════════════════════════════════════════════════════════════
import { runAgent, AgentError } from '../core/agent-client.js';
import { planInvestigation, runInvestigation } from '../core/orchestrator.js';
import { callServer, callAction } from '../core/server.js';
import { createConversation, appendTurn, listConversations, loadConversation, deleteConversation, deleteAllConversations, pruneOld } from '../core/history.js';
import { syncKnowledge, getPrefs as getKnowPrefs, setPrefs as setKnowPrefs, clearManifest } from '../core/knowledge.js';
import { logToolCall } from '../core/audit.js';
import { renderMarkdown } from '../core/markdown-lite.js';
import { getPageContext } from '../tools/app.js';
import { getStyle, setStyle, STYLES, getWritesEnabled, setWritesEnabled, getBriefingSeen, setBriefingSeen } from '../core/prefs.js';
import { buildBriefing } from '../tools/briefing.js';
import { badgeState, cardItems } from '../core/briefing-badge.js';
import { pushUndo, runUndo, clearUndo } from '../core/undo.js';
import { clearSession } from '../core/auditor.js';
import { listFacts, addFact, deleteFact, getRules, saveRules, MAX_RULES, MAX_FACT } from '../core/memory.js';
import { tryInstant } from '../core/instant.js';
import { getKillState, setKillState } from '../core/kill-switch.js';
import { loadPendingUndos, markUndone } from '../core/undo-store.js';
import { emit as emitTelemetry, subscribe as subscribeTelemetry } from '../core/telemetry.js';
import * as V from './voice.js';
import { areaOf, viewingLabel, suggestionsFor, hidesButton } from '../core/page-suggestions.js';
import { summarizeUsage, summarizeAudit, fetchUsage, fetchAudit } from '../core/usage-stats.js';

const getSb = () => (typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null);

const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ICON = {
  chat: svg('<path d="M5 6h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M8.5 11h7"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  send: svg('<path d="M4 20l17-8L4 4v6l10 2-10 2z"/>'),
  spk: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>'),
  spkoff: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  exp: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  col: svg('<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
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
  let micBtn = null, spkBtn = null, recog = null, listening = false;
  let abort = null;
  let sensitive = false;
  let lastSpecialist = null;

  const fab = el('button', { id: 'ag-fab', class: 'ag-fab', type: 'button', 'aria-label': 'Ask Dua', title: 'Ask Dua' });
  fab.innerHTML = ICON.chat + '<span class="ag-fab-l">Ask Dua</span>';
  const sheet = el('section', { id: 'ag-sheet', class: 'ag-sheet', hidden: '', role: 'dialog', 'aria-label': 'Dua assistant' });
  sheet.innerHTML = `
    <button class="ag-grip" id="ag-grip" type="button" aria-label="Resize chat"><i></i></button>
    <header class="ag-head">
      <div class="ag-title"><strong>Dua</strong></div>
      <div class="ag-head-btns">
        <button class="ag-ico" id="ag-exp" type="button"></button>
        <button class="ag-ico" id="ag-more" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false" title="More">${ICON.more}</button>
        <button class="ag-ico" id="ag-close" type="button" aria-label="Close Dua" title="Close">${ICON.x}</button>
      </div>
    </header>
    <div class="ag-menu" id="ag-menu" role="menu" hidden>
      <button class="ag-mi" id="ag-hist" type="button" role="menuitem">Past conversations</button>
      <button class="ag-mi" id="ag-mem" type="button" role="menuitem">Memory and house rules</button>
      <button class="ag-mi" id="ag-stats" type="button" role="menuitem">Usage and activity</button>
      <button class="ag-mi" id="ag-vox" type="button" role="menuitem">Voice settings</button>
      <button class="ag-mi" id="ag-style" type="button" role="menuitem"></button>
      <hr>
      <button class="ag-mi" id="ag-lock" type="button" role="menuitem"></button>
      <button class="ag-mi ag-dng" id="ag-kill" type="button" role="menuitem"></button>
      <hr>
      <button class="ag-mi" id="ag-clear" type="button" role="menuitem">New chat</button>
    </div>
    <div class="ag-ctx" id="ag-ctx"></div>
    <div class="ag-log" id="ag-log" aria-live="polite"></div>
    <div class="ag-chips" id="ag-chips"></div>
    <div class="ag-speaking" id="ag-speaking" hidden><span>Speaking\u2026</span><button type="button" id="ag-spkstop">Stop</button></div>
    <div class="ag-input">
      <textarea id="ag-text" rows="1" maxlength="2000" placeholder="Ask about this page\u2026" enterkeyhint="send"></textarea>
      <div class="ag-listen" id="ag-listen" aria-live="polite"><span class="ag-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span id="ag-interim">Listening\u2026</span></div>
      <button id="ag-send" class="ag-send" type="button" aria-label="Send">${ICON.send}</button>
    </div>`;
  document.body.append(fab, sheet);

  const log = sheet.querySelector('#ag-log');
  const text = sheet.querySelector('#ag-text');
  const send = sheet.querySelector('#ag-send');
  const chips = sheet.querySelector('#ag-chips');
  const lockBtn = sheet.querySelector('#ag-lock');
  const ctx = sheet.querySelector('#ag-ctx');
  const menu = sheet.querySelector('#ag-menu');
  const moreBtn = sheet.querySelector('#ag-more');
  const expBtn = sheet.querySelector('#ag-exp');
  const speakingBar = sheet.querySelector('#ag-speaking');
  const interim = sheet.querySelector('#ag-interim');
  const pending = new Set(); // resolvers of open approval cards

  let killed = true; // fail safe until the server state is known
  const killBtn = sheet.querySelector('#ag-kill');
  async function refreshKill() {
    const k = await getKillState(getSb());
    killed = k.killed; paintLock();
    return k;
  }
  function paintLock() {
    killBtn.innerHTML = '<span>' + (killed ? 'Resume AI changes' : 'Stop all AI changes') + '</span>' + (killed ? '<small>Stopped</small>' : '');
    killBtn.title = killed ? 'AI changes are STOPPED on all devices. Tap to resume.' : 'Tap to stop all AI changes on every device.';
    killBtn.classList.toggle('ag-on', killed);
    const on = getWritesEnabled() && !killed;
    lockBtn.innerHTML = '<span>Allow changes</span><small>' + (on ? 'On' : 'Off') + '</small>';
    lockBtn.title = on ? 'Changes allowed (you approve each one). Tap to lock.' : 'Read-only. Tap to allow changes.';
    lockBtn.classList.toggle('ag-on', on);
    moreBtn.classList.toggle('ag-flag', killed);
  }
  // ── proactive briefing: badge on the ✨ button + a "Today" card (no AI call, no tokens) ──
  let briefing = null;
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const badge = el('span', { class: 'ag-badge', hidden: '' });
  fab.append(badge);
  // The badge shows what needs a decision first (approvals still waiting), otherwise today's briefing count.
  function paintBadge() {
    const n = approvals.size;
    if (n) { badge.textContent = String(n); badge.hidden = false; badge.classList.add('ag-appr'); badge.title = n + (n === 1 ? ' change is' : ' changes are') + ' waiting for your approval'; return; }
    badge.classList.remove('ag-appr'); badge.title = '';
    const b = badgeState(briefing, getBriefingSeen(), todayStr());
    badge.textContent = b.label; badge.hidden = !b.show;
  }
  function refreshBriefing() {
    try { briefing = buildBriefing(new Date()); } catch (e) { console.error('[agent] briefing', e); briefing = null; }
    paintBadge();
  }
  function markSeen() {
    if (!briefing) return;
    setBriefingSeen(todayStr(), badgeState(briefing, null, todayStr()).count);
    paintBadge();
  }
  function addBriefingCard() {
    if (!briefing) return;
    const { items, more, clear } = cardItems(briefing);
    if (clear) return; // nothing urgent: say nothing
    const total = items.length + more;
    const card = el('div', { class: 'ag-today' });
    const head = el('button', { class: 'ag-today-h', type: 'button', 'aria-expanded': 'false' });
    head.innerHTML = '<i></i><span>' + total + (total === 1 ? ' item needs' : ' items need') + ' attention</span><b aria-hidden="true">\u203A</b>';
    const body = el('div', { class: 'ag-today-body', hidden: '' });
    body.innerHTML = '<ul>' + items.map(i => '<li>' + escHtml(i.message) + '</li>').join('') + (more ? '<li>\u2026and ' + more + ' more</li>' : '') + '</ul>';
    const b = el('button', { class: 'ag-today-b', type: 'button' }, 'Review with Dua');
    b.onclick = () => ask('What needs my attention today?');
    body.append(b);
    head.onclick = () => { const open = body.hidden; body.hidden = !open; card.classList.toggle('ag-open', open); head.setAttribute('aria-expanded', String(open)); log.scrollTop = log.scrollHeight; };
    card.append(head, body);
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
      const done = (ok, label, value) => { pending.delete(finish); approvals.delete(id); paintBadge(); card.classList.add('ag-done'); card.querySelector('.ag-card-b').innerHTML = '<span class="ag-card-r">' + label + '</span>'; const t = card.querySelector('.ag-type'); if (t) t.remove(); resolve(ok ? (preview.confirmWord ? { approved: true, typed: value } : true) : false); };
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
      paintBadge();
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
    suggestionsFor(curPage()).forEach(s => { const b = el('button', { class: 'ag-chip', type: 'button' }, s); b.onclick = () => ask(s); chips.append(b); });
  }
  function welcome() {
    log.innerHTML = '';
    addBubble('assistant', 'How can I help?');
    refreshBriefing(); addBriefingCard(); markSeen(); showPendingUndos();
    renderChips();
  }
  function addBubble(role, content, { html = false } = {}) {
    const b = el('div', { class: 'ag-msg ag-' + role });
    if (html) b.innerHTML = content; else if (role === 'assistant') b.innerHTML = renderMarkdown(content); else b.textContent = content;
    log.append(b); log.scrollTop = log.scrollHeight;
    return b;
  }
  function setBusy(v) { busy = v; send.disabled = v; text.disabled = v; if (micBtn) micBtn.disabled = v; sheet.classList.toggle('ag-busy', v); }

  // Structured results of orchestrated investigations (in memory only, last 10): the AI Center reads them to show typed
  // evidence, confidence and the recommendation. Never persisted: they can contain business figures.
  const investigationResults = [];
  const keepInvestigation = r => { investigationResults.unshift(r); investigationResults.length = Math.min(investigationResults.length, 10); };

  /** @param {{investigate?:{domains?:string[], finding?:object}}} [opts]  investigate: run the orchestrator even for a plain-worded question (used by "Investigate with BT"). */
  async function ask(q, opts = {}) {
    q = String(q || '').trim();
    if (!q || busy) return;
    if (!isOpen()) openPanel({ focus: false }); // a question from anywhere (a chip, the voice, an AI Center button) shows its answer here
    const hadFocus = document.activeElement === text; // give the keyboard back afterwards only if the person was typing here
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
      const r = plan.orchestrate ? await runInvestigation({ question: q, plan, callServer, context: withStyle(getPageContext()), signal: abort.signal, sensitive, onEvent, finding: opts.investigate ? opts.investigate.finding || null : null, onResult: keepInvestigation }) : await runAgent({
        history, userText: q, context: withStyle(getPageContext()), callServer, signal: abort.signal, sensitive, stream: true,
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
      abort = null; setBusy(false); if (hadFocus) text.focus({ preventScroll: true });
    }
  }

  function autoIndex() {
    const kp = getKnowPrefs();
    if (!kp.auto || Date.now() - (kp.lastSync || 0) < 12 * 3600 * 1000) return;
    syncKnowledge({ sb: getSb(), callAction, includeStaffNotes: kp.staffNotes }).catch(() => {});
  }
  function autosize() { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; }
  // ── open / close / page awareness ──
  const isOpen = () => !sheet.hidden;
  // Personality: the id rides along in the context; the server maps it to the actual wording.
  const withStyle = (c) => ({ ...c, style: getStyle() });
  const styleBtn = sheet.querySelector('#ag-style');
  const styleName = () => (STYLES.find(x => x[0] === getStyle()) || STYLES[0])[1];
  const paintStyle = () => { styleBtn.innerHTML = '<span>Personality</span><small>' + styleName() + '</small>'; };
  styleBtn.onclick = () => { const i = STYLES.findIndex(x => x[0] === getStyle()); setStyle(STYLES[(i + 1) % STYLES.length][0]); paintStyle(); };
  paintStyle();
  const curPage = () => { try { return getPageContext().current_page; } catch (_) { return null; } };
  let expanded = false, lastPage = curPage();
  function paintCtx() { ctx.innerHTML = '<i></i><span>Viewing <b>' + escHtml(viewingLabel(curPage())) + '</b></span>'; }
  function paintFab() { const hide = isOpen() || hidesButton(curPage()); fab.classList.toggle('ag-hide', hide); fab.setAttribute('aria-hidden', hide ? 'true' : 'false'); }
  function paintExpand() {
    sheet.classList.toggle('ag-exp', expanded && isOpen());
    expBtn.innerHTML = expanded ? ICON.col : ICON.exp;
    const l = expanded ? 'Make smaller' : 'Expand'; expBtn.setAttribute('aria-label', l); expBtn.title = l;
  }
  function closeMenu() { menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
  function toggleMenu() { menu.hidden = !menu.hidden; moreBtn.setAttribute('aria-expanded', String(!menu.hidden)); }
  function openPanel({ focus = true } = {}) {
    if (isOpen()) { if (focus) text.focus({ preventScroll: true }); return; }
    const first = !log.children.length;
    sheet.hidden = false; paintFab(); paintCtx(); paintExpand(); paintVoice(); refreshKill(); autoIndex();
    if (first) welcome(); else { renderChips(); markSeen(); }
    if (focus) setTimeout(() => { if (isOpen()) text.focus({ preventScroll: true }); }, 40);
  }
  /** Close the panel. A running request keeps going and an approval that is waiting stays waiting (the button shows an amber badge). */
  function closePanel() { voiceStop(); V.stopSpeaking(window); closeMenu(); sheet.hidden = true; expanded = false; paintExpand(); paintFab(); paintBadge(); }
  function open() { openPanel(); }
  /** The person moved to another page: update the context line, the starter questions and the button, and mark the switch in the chat. */
  function onPage() {
    const p = curPage(); if (p === lastPage) return;
    lastPage = p; paintFab(); paintCtx();
    if (!history.length) renderChips();
  }
  window.addEventListener('hashchange', () => setTimeout(onPage, 150));
  try { if (window.MutationObserver) new window.MutationObserver(ms => { if (ms.some(m => m.target && m.target.classList && m.target.classList.contains('page'))) onPage(); }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true }); } catch (_) { /* pages still update on hashchange */ }
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && !moreBtn.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen() || document.querySelector('.aic-backdrop, .modal-overlay.open')) return;
    if (!menu.hidden) { closeMenu(); moreBtn.focus(); } else closePanel();
  });
  sheet.querySelector('#ag-close').onclick = closePanel;
  moreBtn.onclick = e => { e.stopPropagation(); toggleMenu(); };
  menu.addEventListener('click', e => { if (e.target.closest('.ag-mi')) closeMenu(); });
  expBtn.onclick = () => { expanded = !expanded; paintExpand(); };
  sheet.querySelector('#ag-grip').onclick = () => { expanded = !expanded; paintExpand(); };
  paintExpand(); paintFab();
  { const t0 = setTimeout(refreshBriefing, 2500); if (t0 && typeof t0.unref === 'function') t0.unref(); } // so the button can show today's count before the panel is first opened

  fab.onclick = open;
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
    ask: q => ask(q), open, close: closePanel, isOpen,
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

  // ── DUA voice in the chat sheet: browser speech only; text goes through the SAME ask() as typing, so approvals,
  //    hard blocks, the kill switch and audit are unchanged (and voice can never approve: approvals need a real tap). ──
  function voiceStop() { if (recog) recog.stop(); }
  function paintVoice() {
    sheet.classList.toggle('ag-lis', listening);
    if (micBtn) { micBtn.classList.toggle('on', listening); micBtn.setAttribute('aria-pressed', String(listening)); micBtn.innerHTML = listening ? ICON.stop : ICON.mic; micBtn.title = listening ? 'Listening. Tap to stop' : 'Speak to Dua'; micBtn.setAttribute('aria-label', listening ? 'Stop listening' : 'Speak to Dua'); }
    if (spkBtn) { const on = V.getVoiceOut(); spkBtn.classList.toggle('on', on); spkBtn.setAttribute('aria-pressed', String(on)); spkBtn.innerHTML = on ? ICON.spk : ICON.spkoff; spkBtn.title = on ? 'Spoken answers on' : 'Spoken answers off'; }
  }
  function voiceToggle() {
    if (listening) { voiceStop(); return; }
    if (busy) return;
    V.stopSpeaking(window);
    let noticed = false; try { noticed = localStorage.getItem('bt_voice_notice_v1') === '1'; localStorage.setItem('bt_voice_notice_v1', '1'); } catch (_) { /* ignore */ }
    if (!noticed) addBubble('status', 'Voice uses your browser\u2019s speech service. Audio may be processed by the browser vendor.');
    recog = V.createRecognizer(window, {
      lang: V.voiceLang(window),
      onInterim: t => { text.value = t; interim.textContent = t; autosize(); },
      onFinal: t => { addBubble('status', 'Heard: \u201C' + t.slice(0, 120) + '\u201D'); ask(t); },
      onEnd: () => { listening = false; paintVoice(); },
      onError: code => addBubble('status', code === 'not-allowed' || code === 'service-not-allowed' ? 'Microphone permission was denied. Allow it in the browser site settings.' : code === 'no-speech' ? 'I did not hear anything. Try again.' : code === 'network' ? 'Voice needs an internet connection.' : 'Voice input failed (' + code + ').'),
    });
    if (!recog) return;
    try { interim.textContent = 'Listening\u2026'; recog.start(); listening = true; paintVoice(); } catch (err) { addBubble('status', 'Could not start the microphone: ' + (err && err.message ? err.message : 'unknown error')); }
  }
  const vs = V.voiceSupport(window);
  if (vs.input) { micBtn = document.createElement('button'); micBtn.id = 'ag-mic'; micBtn.className = 'ag-mic'; micBtn.type = 'button'; micBtn.addEventListener('click', voiceToggle); send.before(micBtn); }
  if (vs.output) { spkBtn = document.createElement('button'); spkBtn.id = 'ag-spk'; spkBtn.className = 'ag-spk'; spkBtn.type = 'button'; spkBtn.setAttribute('aria-label', 'Read answers aloud'); spkBtn.addEventListener('click', () => { const on = !V.getVoiceOut(); V.setVoiceOut(on); if (!on) V.stopSpeaking(window); paintVoice(); }); sheet.querySelector('.ag-head-btns').prepend(spkBtn); }
  paintVoice();
  // the ONE place answers are spoken (model answers and instant local answers), whichever page the question came from
  subscribeTelemetry(e => { if ((e.type === 'answer' || e.type === 'instant') && V.getVoiceOut() && e.metadata && e.metadata.text) V.speak(window, e.metadata.text, V.voiceLang(window)); });

  // the "Speaking... Stop" strip follows the browser's own speech state (voice.js announces it)
  window.addEventListener('bt-voice-state', e => { speakingBar.hidden = !(e.detail && e.detail.speaking); });
  sheet.querySelector('#ag-spkstop').onclick = () => V.stopSpeaking(window);
  // ── voice settings: spoken answers, speed and voice (all stored on this device by voice.js) ──
  function showVoiceSettings() {
    const sup = V.voiceSupport(window);
    const card = el('div', { class: 'ag-card' });
    card.append(el('div', { class: 'ag-card-t' }, 'Voice settings'));
    const row = (label, ctl) => { const r = el('label', { class: 'ag-set-row' }); r.append(el('span', {}, label), ctl); return r; };
    if (sup.output) {
      const on = el('input', { type: 'checkbox', 'aria-label': 'Speak answers aloud' }); on.checked = V.getVoiceOut();
      on.onchange = () => { V.setVoiceOut(on.checked); if (!on.checked) V.stopSpeaking(window); paintVoice(); };
      const speed = el('select', { 'aria-label': 'Speech speed' }); const cur = V.getVoiceRate();
      [['0.85', 'Slower'], ['1', 'Normal'], ['1.15', 'Faster']].forEach(([v, l]) => { const o = el('option', { value: v }, l); if (Math.abs(cur - Number(v)) < 0.05) o.selected = true; speed.append(o); });
      speed.onchange = () => V.setVoiceRate(speed.value);
      card.append(row('Speak answers aloud', on), row('Speed', speed));
      let voices = []; try { voices = (window.speechSynthesis.getVoices() || []).filter(v => v.lang && v.lang.slice(0, 2) === V.voiceLang(window).slice(0, 2)); } catch (_) { /* device default */ }
      if (voices.length) {
        const sel = el('select', { 'aria-label': 'Voice' }); sel.append(el('option', { value: '' }, 'Device default')); const pick = V.getVoiceName();
        voices.forEach(v => { const o = el('option', { value: v.name }, v.name); if (v.name === pick) o.selected = true; sel.append(o); });
        sel.onchange = () => V.setVoiceName(sel.value); card.append(row('Voice', sel));
      }
      const test = el('button', { class: 'ag-undo-btn', type: 'button' }, 'Test voice'); test.onclick = () => V.speak(window, 'Hello. I am Dua. Here is how I sound.', V.voiceLang(window));
      card.append(test);
    } else card.append(el('div', { class: 'ag-warn' }, 'This browser cannot speak answers aloud.'));
    card.append(el('div', { class: 'ag-warn' }, 'Voice uses your browser\u2019s speech service. Audio may be processed by the browser vendor. Voice can never approve a change.'));
    log.append(card); log.scrollTop = log.scrollHeight;
  }
  sheet.querySelector('#ag-vox').onclick = showVoiceSettings;

  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text.value); } });
}

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function el(tag, attrs = {}, content) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (content != null) e.textContent = content;
  return e;
}
