// ══════════════════════════════════════════════════════════════════════
// AGENT PANEL — floating button + chat sheet (mobile-first).
// Pure presentation: delegates everything to runAgent().
// ══════════════════════════════════════════════════════════════════════
import { runAgent, AgentError } from '../core/agent-client.js';
import { callServer } from '../core/server.js';
import { logToolCall } from '../core/audit.js';
import { renderMarkdown } from '../core/markdown-lite.js';
import { getPageContext } from '../tools/app.js';
import { getWritesEnabled, setWritesEnabled } from '../core/prefs.js';
import { pushUndo, runUndo, clearUndo } from '../core/undo.js';

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
  get_app_context: 'Checking date', list_pages: 'Listing pages',
  add_staff_note: 'Preparing note', add_ledger_entry: 'Preparing ledger entry', set_monthly_target: 'Preparing target change',
  edit_daily_sales_field: 'Preparing sales edit', add_daily_sales_entry: 'Preparing sales entry', daily_briefing: 'Preparing your briefing',
};

export function mountAgentPanel() {
  if (document.getElementById('ag-fab')) return;
  const conversationId = 'c_' + Date.now().toString(36);
  let history = [];
  let busy = false;
  let abort = null;
  let sensitive = false;

  const fab = el('button', { id: 'ag-fab', class: 'ag-fab', 'aria-label': 'Open AI assistant', title: 'AI assistant' }, '✨');
  const sheet = el('section', { id: 'ag-sheet', class: 'ag-sheet', hidden: '', role: 'dialog', 'aria-label': 'AI assistant' });
  sheet.innerHTML = `
    <header class="ag-head">
      <div><strong>BT Assistant</strong><span class="ag-sub" id="ag-sub"></span></div>
      <div class="ag-head-btns">
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

  function paintLock() {
    const on = getWritesEnabled();
    lockBtn.textContent = on ? '🔓' : '🔒';
    lockBtn.title = on ? 'Changes allowed (you approve each one). Tap to lock.' : 'Read-only. Tap to allow changes.';
    lockBtn.classList.toggle('ag-on', on);
    sub.textContent = on ? 'Can propose changes · you approve each' : 'Read-only · asks your live data';
  }
  function rejectAllPending() { pending.forEach(r => r(false)); pending.clear(); }

  // ── approval card ──────────────────────────────────────────────────
  function approve({ preview }) {
    return new Promise(resolve => {
      const card = el('div', { class: 'ag-card' });
      const warn = (preview.warnings || []).map(w => '<div class="ag-warn">⚠ ' + escHtml(w) + '</div>').join('');
      card.innerHTML = '<div class="ag-card-t">' + escHtml(preview.title) + '</div>'
        + '<ul class="ag-card-l">' + preview.lines.map(l => '<li>' + escHtml(l) + '</li>').join('') + '</ul>' + warn
        + '<div class="ag-card-b"><button class="ag-no">Reject</button><button class="ag-yes">' + (preview.strong ? 'Approve…' : 'Approve') + '</button></div>';
      log.append(card); log.scrollTop = log.scrollHeight;
      const yes = card.querySelector('.ag-yes'), no = card.querySelector('.ag-no');
      let armed = !preview.strong;
      const done = (ok, label) => { pending.delete(finish); card.classList.add('ag-done'); card.querySelector('.ag-card-b').innerHTML = '<span class="ag-card-r">' + label + '</span>'; resolve(ok); };
      const finish = ok => done(ok, ok ? '✓ Approved' : '✕ Rejected');
      pending.add(finish);
      no.onclick = () => finish(false);
      yes.onclick = () => {
        if (!armed) { armed = true; yes.textContent = 'Yes, I am sure'; yes.classList.add('ag-warn-btn'); return; }
        finish(true);
      };
    });
  }

  function addUndoRow({ tool, label, fn }) {
    const item = pushUndo({ tool, label, fn });
    const row = el('div', { class: 'ag-undo' });
    row.innerHTML = '<span>✓ Saved</span>';
    const b = el('button', { class: 'ag-undo-btn' }, '↶ Undo: ' + label);
    b.onclick = async () => {
      b.disabled = true;
      const r = await runUndo(item.id);
      row.innerHTML = r.ok ? '<span>↶ Undone: ' + escHtml(r.label) + '</span>' : '<span class="ag-warn">⚠ ' + escHtml(r.error) + '</span>';
    };
    row.append(b); log.append(row); log.scrollTop = log.scrollHeight;
  }

  function renderChips() {
    chips.innerHTML = '';
    if (history.length) return;
    SUGGESTIONS.forEach(s => { const b = el('button', { class: 'ag-chip' }, s); b.onclick = () => ask(s); chips.append(b); });
  }
  function welcome() {
    log.innerHTML = '';
    addBubble('assistant', getWritesEnabled()
      ? "Hi! I can read your data and, with your approval on each one, add ledger entries and staff notes, set targets and correct a day's sales. What do you need?"
      : "Hi! I can read your sales, staff, ledgers and inventory, and open pages for you. Tap 🔒 above if you want me to be able to propose changes (you'd still approve each one). What would you like to know?");
    renderChips();
  }
  function addBubble(role, content, { html = false } = {}) {
    const b = el('div', { class: 'ag-msg ag-' + role });
    if (html) b.innerHTML = content; else if (role === 'assistant') b.innerHTML = renderMarkdown(content); else b.textContent = content;
    log.append(b); log.scrollTop = log.scrollHeight;
    return b;
  }
  function setBusy(v) { busy = v; send.disabled = v; text.disabled = v; sheet.classList.toggle('ag-busy', v); }

  async function ask(q) {
    q = String(q || '').trim();
    if (!q || busy) return;
    text.value = ''; autosize();
    chips.innerHTML = '';
    addBubble('user', q);
    const status = addBubble('status', 'Thinking…');
    setBusy(true);
    abort = new AbortController();
    try {
      const r = await runAgent({
        history, userText: q, context: getPageContext(), callServer, signal: abort.signal, sensitive,
        writesEnabled: getWritesEnabled(), approve, onUndoable: addUndoRow,
        onEvent: ev => {
          if (ev.type === 'tool_start') status.textContent = (TOOL_LABELS[ev.name] || 'Working') + '…';
          if (ev.type === 'tool_end' && !ev.ok && !ev.rejected && ev.error && /writes_disabled/.test(ev.error)) paintLock();
        },
        onAudit: e => logToolCall(e, { conversationId }),
      });
      history = r.messages; sensitive = r.sensitive;
      status.remove();
      addBubble('assistant', r.text);
    } catch (e) {
      status.remove();
      const msg = e instanceof AgentError ? e.message : 'Something went wrong. Please try again.';
      if (!(e instanceof AgentError) || e.code !== 'aborted') addBubble('error', msg);
      if (!(e instanceof AgentError)) console.error('[agent]', e);
    } finally {
      abort = null; setBusy(false); text.focus();
    }
  }

  function autosize() { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 120) + 'px'; }
  function open() { sheet.hidden = false; fab.classList.add('ag-hide'); if (!log.children.length) welcome(); setTimeout(() => text.focus(), 50); }
  function close() { rejectAllPending(); sheet.hidden = true; fab.classList.remove('ag-hide'); if (abort) abort.abort(); }

  fab.onclick = open;
  sheet.querySelector('#ag-close').onclick = close;
  sheet.querySelector('#ag-clear').onclick = () => { rejectAllPending(); if (abort) abort.abort(); history = []; sensitive = false; clearUndo(); welcome(); };
  lockBtn.onclick = () => {
    if (getWritesEnabled()) { setWritesEnabled(false); }
    else if (window.confirm('Allow the assistant to propose changes?\n\nIt can add ledger entries and staff notes, set targets and correct a day\'s sales. Nothing is saved until you tap Approve on each change, and most can be undone.')) setWritesEnabled(true);
    paintLock(); if (!history.length) welcome();
  };
  paintLock();
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
