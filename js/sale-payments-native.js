// ══════════════════════════════════════════════════════════════════════
// SALE PAYMENTS NATIVE  —  Sale Data › Payments tab
//
// Read-only view over sale-payments-bridge.js's two tables: a day-level
// Cash/Card/Credit split (sales_payment_summary) and a per-customer
// credit breakdown (sales_credit_by_customer), for whatever "today +
// last 3 days" window the Candela → Dropbox → Supabase sync last ran
// with. Same "view only, no write path" principle as inventory-native.js.
// ══════════════════════════════════════════════════════════════════════

import * as SalePaymentsBridge from './sale-payments-bridge.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtMoney(v) { return 'Rs ' + (Number(v) || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' });
}

const spState = { customerSearch: '' };
let _searchDebounce = null;

// ── Summary table (one row per day + a totals footer) ───────────────
function _renderSummary(paymentSummary) {
  const tbody = document.getElementById('sp-summary-tbody');
  const tfoot = document.getElementById('sp-summary-tfoot');
  if (!tbody) return;

  if (!paymentSummary.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No synced data yet — tap Refresh, or check Tools for the last Dropbox sync.</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  // Latest day on top, same convention as Cash Deposit / Daily Data.
  const sorted = paymentSummary.slice().sort((a, b) => (a.saleDay < b.saleDay ? 1 : -1));
  tbody.innerHTML = sorted.map(r => `
    <tr>
      <td style="text-align:left">${esc(fmtDate(r.saleDay))}</td>
      <td class="sp-num">${fmtMoney(r.cashSale)}</td>
      <td class="sp-num">${fmtMoney(r.cardSale)}</td>
      <td class="sp-num">${fmtMoney(r.creditSale)}</td>
      <td class="sp-num sp-total-cell">${fmtMoney(r.totalSale)}</td>
    </tr>
  `).join('');

  const totals = sorted.reduce((acc, r) => ({
    cash: acc.cash + (Number(r.cashSale) || 0),
    card: acc.card + (Number(r.cardSale) || 0),
    credit: acc.credit + (Number(r.creditSale) || 0),
    total: acc.total + (Number(r.totalSale) || 0),
  }), { cash: 0, card: 0, credit: 0, total: 0 });

  if (tfoot) {
    tfoot.innerHTML = `
      <tr class="sp-totals-row">
        <td style="text-align:left">All ${sorted.length} day${sorted.length === 1 ? '' : 's'}</td>
        <td class="sp-num">${fmtMoney(totals.cash)}</td>
        <td class="sp-num">${fmtMoney(totals.card)}</td>
        <td class="sp-num">${fmtMoney(totals.credit)}</td>
        <td class="sp-num sp-total-cell">${fmtMoney(totals.total)}</td>
      </tr>
    `;
  }
}

// ── Credit-by-customer table, grouped by day, filtered by search ────
function _renderCreditByCustomer(creditByCustomer) {
  const tbody = document.getElementById('sp-credit-tbody');
  if (!tbody) return;

  const q = spState.customerSearch.trim().toLowerCase();
  const filtered = q
    ? creditByCustomer.filter(r => (r.customerName || '').toLowerCase().includes(q))
    : creditByCustomer;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px">${q ? 'No matching customers.' : 'No credit sales in the synced window.'}</td></tr>`;
    return;
  }

  // Already sale_day DESC, credit_amount DESC from the bridge query —
  // just group-header by day as we walk the already-sorted list.
  let curDay = null;
  let html = '';
  filtered.forEach(r => {
    if (r.saleDay !== curDay) {
      curDay = r.saleDay;
      const dayTotal = filtered.filter(x => x.saleDay === curDay).reduce((s, x) => s + (Number(x.creditAmount) || 0), 0);
      html += `<tr class="sp-group-row"><td colspan="3" style="text-align:left">${esc(fmtDate(curDay))}</td><td class="sp-num">${fmtMoney(dayTotal)}</td></tr>`;
    }
    html += `
      <tr>
        <td style="text-align:left;padding-left:20px">${esc(r.customerName || 'Unnamed')}</td>
        <td class="sp-num">${fmtMoney(r.creditAmount)}</td>
        <td class="sp-num">${r.receiptCount || 0}</td>
        <td></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function _renderAll() {
  const data = SalePaymentsBridge.getFullData();
  const statusEl = document.getElementById('sp-status');
  if (data) {
    _renderSummary(data.paymentSummary || []);
    _renderCreditByCustomer(data.creditByCustomer || []);
    if (statusEl) {
      const mins = Math.max(0, Math.round((Date.now() - data.fetchedAt) / 60000));
      statusEl.textContent = mins === 0 ? '✓ Synced just now' : `✓ Synced ${mins} min ago`;
    }
  } else {
    _renderSummary([]);
    _renderCreditByCustomer([]);
    if (statusEl) statusEl.textContent = '⏳ Loading…';
  }
}

function spSetCustomerSearch(value) {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    spState.customerSearch = value;
    const data = SalePaymentsBridge.getFullData();
    _renderCreditByCustomer(data ? (data.creditByCustomer || []) : []);
  }, 200);
}

async function spRefresh() {
  const statusEl = document.getElementById('sp-status');
  if (statusEl) statusEl.textContent = '⏳ Syncing…';
  await SalePaymentsBridge.refreshFullData(true);
  _renderAll();
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowSalePayments() {
  _renderAll();
  SalePaymentsBridge.refreshFullData(false).then(_renderAll);
}
export function onBridgeRefresh() { _renderAll(); }

window.spSetCustomerSearch = spSetCustomerSearch;
window.spRefresh = spRefresh;
window.salePaymentsBridgeOnRefresh = onBridgeRefresh;
window.spOnShowSalePayments = onShowSalePayments;
