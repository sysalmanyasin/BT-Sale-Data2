// ══════════════════════════════════════════════════════════════════════
// AGENT PANEL — floating button + chat sheet (mobile-first).
// Pure presentation: delegates everything to runAgent().
// ══════════════════════════════════════════════════════════════════════
import { runAgent, AgentError } from '../core/agent-client.js';
import { callServer } from '../core/server.js';
import { logToolCall } from '../core/audit.js';
import { renderMarkdown } from '../core/markdown-lite.js';
import { getPageContext } from '../tools/app.js';

const SUGGESTIONS = [
  "How are today's sales?",
  'Target pace this month',
  'What is low on stock?',
  'Compare this month with last month',
];
const TOOL_LABELS = {
  get_sales_summary: 'Checking monthly sales', get_daily_sales: 'Reading daily sales', top_sales_days: 'Ranking sale days',
  compare_sales_months: 'Comparing months', get_target_pace: 'Checking target pace', get_year_overview: 'Reading year overview',
  list_sales_months: 'Listing months', list_staff: 'Reading staff list', find_staff: 'Finding staff',
  list_ledger_types: 'Listing ledgers', get_ledger_entries: 'Reading ledger', get_ledger_month_totals: 'Totalling ledger',
  inventory_overview: 'Checking inventory', search_inventory: 'Searching inventory', low_stock_items: 'Finding low stock',
  low_cover_items: 'Checking stock cover', slow_moving_stock: 'Finding slow stock', navigate_to: 'Opening page',
  get_app_context: 'Checking date', list_pages: 'Listing pages',
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
      <div><strong>BT Assistant</strong><span class="ag-sub">Read-only · asks your live data</span></div>
      <div class="ag-head-btns">
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

  function renderChips() {
    chips.innerHTML = '';
    if (history.length) return;
    SUGGESTIONS.forEach(s => { const b = el('button', { class: 'ag-chip' }, s); b.onclick = () => ask(s); chips.append(b); });
  }
  function welcome() {
    log.innerHTML = '';
    addBubble('assistant', "Hi! I can read your sales, staff, ledgers and inventory, and open pages for you. I can't change data yet. What would you like to know?");
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
        onEvent: ev => { if (ev.type === 'tool_start') status.textContent = (TOOL_LABELS[ev.name] || 'Working') + '…'; },
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
  function close() { sheet.hidden = true; fab.classList.remove('ag-hide'); if (abort) abort.abort(); }

  fab.onclick = open;
  sheet.querySelector('#ag-close').onclick = close;
  sheet.querySelector('#ag-clear').onclick = () => { if (abort) abort.abort(); history = []; sensitive = false; welcome(); };
  send.onclick = () => ask(text.value);
  text.addEventListener('input', autosize);
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text.value); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) close(); });
}

function el(tag, attrs = {}, content) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (content != null) e.textContent = content;
  return e;
}
