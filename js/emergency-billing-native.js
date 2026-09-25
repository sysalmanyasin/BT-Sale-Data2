// ══════════════════════════════════════════════════════════════════════
// EMERGENCY BILLING NATIVE — page logic (Architecture doc, Phase 3 / §5, §6).
//
// Ported from POS's js/billing.js — cart building, qty/price display,
// discount, held bills, F9 quick-edit-row mode, payment capture, and
// receipt print are the same *ideas*; none of POS's own infrastructure
// (StorageModule/IndexedDB, sync queue, devices, BYOS) is used here.
//
// Same "native.js" convention as inventory-native.js/audit-native.js:
// a real ES module, imported functions from the bridge rather than the
// window.emergencyBilling* globals (those exist for classic-script
// consumers; this file doesn't need them). Never touches Repository/
// Actions/EventBus, bt_salesdata, or inventory_products directly — same
// reasoning as attendance-native.js. Fires no EventBus notifications of
// its own (the bridge already does that on a successful sale); this
// file just renders.
//
// Held bills + the in-progress cart are a per-device convenience, not
// data of record — they live in localStorage only (mirrors POS's own
// "restore unfinished bill" behavior), never in Supabase. Losing them
// on a cleared browser is an acceptable tradeoff for a break-glass tool.
//
// onShowEmergencyBilling() is called from ui.js's showPage() on-show
// hook, same pattern as invOnShowInventory(). Safe to call on every
// visit (it just re-wires + re-renders) rather than one-time-only,
// since the cart/held-bills state must reflect whatever changed while
// the user was on another page (or in another tab, for held bills).
// ══════════════════════════════════════════════════════════════════════

import * as EBBridge from './emergency-billing-bridge.js';
import { BTDate } from './bt-date.js';

(function () {
  "use strict";

  const HELD_KEY = 'eb_held_bills_v1';
  const CART_KEY = 'eb_active_cart_v1';

  // ── State ──────────────────────────────────────────────────────────
  let cart = [];            // [{ code, name, price, qty, total }]
  let heldBills = [];        // [{ tag, savedAt, items, discountAmount, customerName, customerPhone }]
  let paymentMethod = 'cash';
  let activeDropdownIndex = -1;
  let searchResults = [];
  let f9Mode = false;
  let f9Row = -1;
  let wired = false;         // guards event-listener wiring (idempotent init)
  let lastCheckoutBusy = false;

  // ── Small local helpers ───────────────────────────────────────────
  function cur() {
    return (typeof window._getCurrency === 'function') ? window._getCurrency() : 'Rs. ';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function say(msg, isError) {
    if (typeof window.toast === 'function') window.toast(msg, isError ? 'e' : '');
    else console.log((isError ? '[EmergencyBilling ERROR] ' : '[EmergencyBilling] ') + msg);
  }
  function $(id) { return document.getElementById(id); }

  function _loadLocal(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function _saveLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* best-effort */ }
  }
  function saveCart() { _saveLocal(CART_KEY, cart); }
  function saveHeld() { _saveLocal(HELD_KEY, heldBills); }

  // ── Init — called every time the page is shown ───────────────────
  function init() {
    if (!$('page-emergency-billing')) {
      console.error('emergency-billing-native: #page-emergency-billing not found in the DOM yet.');
      return;
    }
    cart = _loadLocal(CART_KEY, []);
    heldBills = _loadLocal(HELD_KEY, []);

    if (!wired) { wireEvents(); wired = true; }

    renderCart();
    renderHeldBills();
    renderReconciliation();
    setPaymentMode(paymentMethod);
  }

  // ── Product search ─────────────────────────────────────────────────
  function doSearch(query) {
    const panel = $('eb-search-results');
    const noRes = $('eb-search-no-results');
    activeDropdownIndex = -1;
    const q = (query || '').trim();
    if (!q) { panel.style.display = 'none'; panel.innerHTML = ''; if (noRes) noRes.style.display = 'none'; return; }

    searchResults = EBBridge.searchProducts(q, 12);

    if (!searchResults.length) {
      panel.style.display = 'none'; panel.innerHTML = '';
      if (noRes) { noRes.style.display = 'block'; noRes.textContent = 'No products found for "' + q + '"'; }
      return;
    }
    if (noRes) noRes.style.display = 'none';

    const c = cur();
    panel.innerHTML = '';
    searchResults.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'eb-sr-row';
      const low = Number(p.qty) <= 5;
      row.innerHTML =
        '<span class="eb-sr-num">' + (i + 1) + '</span>' +
        '<div class="eb-sr-name"><div>' + esc(p.name) + '</div><div class="eb-sr-code">' + esc(p.code) + '</div></div>' +
        '<span class="eb-sr-generic">' + esc(p.generic || '—') + '</span>' +
        '<span class="eb-sr-stock' + (low ? ' low' : '') + '">' + (Number(p.qty) || 0) + '</span>' +
        '<span class="eb-sr-price">' + c + (parseFloat(p.price) || 0).toFixed(2) + '</span>';
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', () => pickProduct(p));
      panel.appendChild(row);
    });
    panel.style.display = 'block';
  }

  async function pickProduct(product) {
    const qtyInput = $('eb-qty-input');
    const qty = Math.max(1, parseInt((qtyInput && qtyInput.value) || '1', 10) || 1);
    $('eb-search-results').style.display = 'none';
    $('eb-search-input').value = '';
    if (qtyInput) qtyInput.value = 1;
    await addToCart(product, qty);
    $('eb-search-input').focus();
  }

  // ── Cart mutation — every add/qty-bump re-checks live availability.
  // getAvailableQty() returning null means the inventory bridge hasn't
  // loaded/synced yet; that is treated as "can't verify, block the add",
  // never as unlimited stock (see bridge file header note). ──────────
  async function addToCart(product, qty) {
    const existing = cart.find(i => i.code === product.code);
    const wantTotal = (existing ? existing.qty : 0) + qty;

    const avail = await EBBridge.getAvailableQty(product.code);

    if (!avail) {
      say('⚠️ Inventory data unavailable for ' + product.code + ' — refresh BT Inventory first.', true);
      return;
    }
    if (wantTotal > avail.available) {
      say('⚠️ Only ' + avail.available + ' available for ' + esc(product.name) + ' (bridge stock, since last real sync).', true);
      return;
    }

    if (existing) {
      existing.qty = wantTotal;
      existing.total = Number((existing.qty * existing.price).toFixed(2));
    } else {
      const price = parseFloat(product.price) || 0;
      cart.push({ code: product.code, name: product.name, price, qty, total: Number((price * qty).toFixed(2)) });
    }
    renderCart();
  }

  async function bumpQty(index, delta) {
    const item = cart[index];
    if (!item) return;
    if (delta > 0) {
      const avail = await EBBridge.getAvailableQty(item.code);
      if (!avail || item.qty + delta > avail.available) {
        say('⚠️ Only ' + (avail ? avail.available : 0) + ' available for ' + esc(item.name) + '.', true);
        return;
      }
    }
    const newQty = item.qty + delta;
    if (newQty <= 0) { removeItem(index); return; }
    item.qty = newQty;
    item.total = Number((item.qty * item.price).toFixed(2));
    renderCart();
  }

  async function setQty(index, val) {
    const item = cart[index];
    if (!item) return;
    let q = parseInt(val, 10);
    if (isNaN(q) || q <= 0) { renderCart(); return; }
    const avail = await EBBridge.getAvailableQty(item.code);
    if (!avail) { say('⚠️ Inventory data unavailable — refresh BT Inventory first.', true); renderCart(); return; }
    if (q > avail.available) { q = avail.available; say('⚠️ Capped at ' + q + ' available for ' + esc(item.name) + '.', true); }
    item.qty = q;
    item.total = Number((item.qty * item.price).toFixed(2));
    renderCart();
  }

  function removeItem(index) {
    cart.splice(index, 1);
    if (f9Mode) {
      if (f9Row >= cart.length && f9Row > 0) f9Row--;
      if (cart.length === 0) { f9Mode = false; f9Row = -1; }
    }
    renderCart();
  }

  function clearCart() {
    if (cart.length === 0) return;
    if (!confirm('Clear the current bill? This cannot be undone.')) return;
    doClearCart();
  }
  function doClearCart() {
    cart = [];
    f9Mode = false; f9Row = -1;
    $('eb-discount-input').value = '0';
    $('eb-customer-name').value = '';
    $('eb-customer-phone').value = '';
    $('eb-cash-received-input').value = '';
    paymentMethod = 'cash';
    setPaymentMode('cash');
    renderCart();
  }

  // ── Totals ─────────────────────────────────────────────────────────
  function calcTotals() {
    const subtotal = cart.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
    let disc = parseFloat($('eb-discount-input').value) || 0;
    if (disc < 0) disc = 0;
    if (disc > subtotal) disc = subtotal;
    const net = Math.max(0, subtotal - disc);

    $('eb-subtotal').textContent = cur() + subtotal.toFixed(2);
    $('eb-discount-display').textContent = cur() + disc.toFixed(2);
    $('eb-net-total').textContent = cur() + net.toFixed(2);

    const cashInput = $('eb-cash-received-input');
    const changeRow = $('eb-change-row');
    if (paymentMethod === 'cash' && cashInput && cashInput.value !== '') {
      const cash = parseFloat(cashInput.value) || 0;
      const change = cash - net;
      $('eb-change-display').textContent = cur() + change.toFixed(2);
      $('eb-change-display').style.color = change < 0 ? 'var(--red)' : 'var(--teal)';
      changeRow.style.display = 'flex';
    } else if (changeRow) {
      changeRow.style.display = 'none';
    }
    return { subtotal, discount: disc, net };
  }

  function setPaymentMode(mode) {
    paymentMethod = mode;
    ['cash', 'card', 'online'].forEach(m => {
      const btn = $('eb-pay-' + m);
      if (btn) btn.classList.toggle('active', m === mode);
    });
    const cashRow = $('eb-cash-received-row');
    if (cashRow) cashRow.style.display = (mode === 'cash') ? '' : 'none';
    if (mode !== 'cash') { const inp = $('eb-cash-received-input'); if (inp) inp.value = ''; }
    calcTotals();
  }

  // ── Render cart ────────────────────────────────────────────────────
  function renderCart() {
    saveCart();
    const body = $('eb-cart-body');
    const countEl = $('eb-cart-count');
    const summary = $('eb-summary');
    const cashSection = $('eb-cash-section');
    countEl.textContent = cart.length + ' item' + (cart.length !== 1 ? 's' : '');

    const checkoutBtn = $('eb-checkout-btn');
    const holdBtn = $('eb-hold-btn');
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0 || lastCheckoutBusy;
    if (holdBtn) holdBtn.disabled = cart.length === 0;

    if (cart.length === 0) {
      body.innerHTML = '<tr><td colspan="6"><div class="eb-empty">🧾 Bill is empty — search a product above to begin</div></td></tr>';
      if (summary) summary.style.display = 'none';
      if (cashSection) cashSection.style.display = 'none';
      f9Mode = false; f9Row = -1;
      updateF9Hint();
      return;
    }

    if (summary) summary.style.display = '';
    if (cashSection) cashSection.style.display = '';

    const c = cur();
    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    cart.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'eb-cart-row' + (f9Mode && idx === f9Row ? ' f9-active' : '');
      tr.innerHTML =
        '<td class="eb-tc-sr">' + (idx + 1) + '</td>' +
        '<td class="eb-tc-name"><div class="eb-cc-name">' + esc(item.name) + '</div><div class="eb-cc-code">' + esc(item.code) + '</div></td>' +
        '<td class="eb-tc-price">' + c + item.price.toFixed(2) + '</td>' +
        '<td class="eb-tc-qty">' +
          '<div class="eb-qwrap">' +
            '<button class="eb-qbtn" data-act="dec" data-idx="' + idx + '">−</button>' +
            '<input type="number" class="eb-qinp" data-idx="' + idx + '" value="' + item.qty + '" min="1">' +
            '<button class="eb-qbtn" data-act="inc" data-idx="' + idx + '">+</button>' +
          '</div>' +
        '</td>' +
        '<td class="eb-tc-total">' + c + item.total.toFixed(2) + '</td>' +
        '<td class="eb-tc-act"><button class="eb-del" data-idx="' + idx + '">✕</button></td>';
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    calcTotals();
    updateF9Hint();
  }

  // Delegated cart-row events (rows are rebuilt on every render, so
  // listeners live once on the table body instead of being re-attached
  // per row).
  function onCartBodyClick(e) {
    const decBtn = e.target.closest('.eb-qbtn[data-act="dec"]');
    const incBtn = e.target.closest('.eb-qbtn[data-act="inc"]');
    const delBtn = e.target.closest('.eb-del');
    if (decBtn) { bumpQty(parseInt(decBtn.dataset.idx, 10), -1); return; }
    if (incBtn) { bumpQty(parseInt(incBtn.dataset.idx, 10), 1); return; }
    if (delBtn) { removeItem(parseInt(delBtn.dataset.idx, 10)); return; }
  }
  function onCartBodyChange(e) {
    const inp = e.target.closest('.eb-qinp');
    if (inp) setQty(parseInt(inp.dataset.idx, 10), inp.value);
  }

  // ── F9 quick-edit-row mode — same idea as POS's billing.js: ↑/↓
  // walks the cart rows, Del removes the active row, Esc exits. Scoped
  // to when Emergency Billing is the visible page, and never fires
  // while an input/textarea has focus (so it can't hijack typing). ──
  function updateF9Hint() {
    const hint = $('eb-f9-hint');
    if (!hint) return;
    if (f9Mode && cart.length > 0) {
      hint.textContent = '⚡ F9 EDIT MODE — Row ' + (f9Row + 1) + '/' + cart.length + ' (↑↓ navigate, Del remove, Esc exit)';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
  function highlightF9Row() {
    document.querySelectorAll('#eb-cart-body .eb-cart-row').forEach((row, i) => {
      row.classList.toggle('f9-active', f9Mode && i === f9Row);
    });
  }
  function onGlobalKeydown(e) {
    if (!document.getElementById('page-emergency-billing')?.classList.contains('on')) return;
    const isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (e.key === 'F9') {
      e.preventDefault();
      if (cart.length === 0) { say('Cart is empty — nothing to edit.', true); return; }
      f9Mode = !f9Mode;
      f9Row = f9Mode ? 0 : -1;
      say(f9Mode ? '⚡ F9 Mode ON' : 'F9 Mode OFF');
      highlightF9Row(); updateF9Hint();
      return;
    }
    if (!f9Mode || isInput) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (f9Row < cart.length - 1) { f9Row++; highlightF9Row(); updateF9Hint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (f9Row > 0) { f9Row--; highlightF9Row(); updateF9Hint(); } }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(f9Row); }
    else if (e.key === 'Escape') { f9Mode = false; f9Row = -1; highlightF9Row(); updateF9Hint(); }
  }

  // ── Held bills (localStorage only — see header note) ──────────────
  function holdBill() {
    if (cart.length === 0) { say('Cart is empty — nothing to hold.', true); return; }
    const tag = (prompt('Label this held bill (optional):', '') || '').trim() || ('Bill #' + (heldBills.length + 1));
    heldBills.push({
      tag,
      savedAt: new Date().toISOString(),
      items: JSON.parse(JSON.stringify(cart)),
      discountAmount: parseFloat($('eb-discount-input').value) || 0,
      customerName: $('eb-customer-name').value.trim(),
      customerPhone: $('eb-customer-phone').value.trim(),
    });
    saveHeld();
    doClearCart();
    renderHeldBills();
    say('📋 Bill held as "' + tag + '"');
  }

  function renderHeldBills() {
    const wrap = $('eb-held-list');
    if (!wrap) return;
    if (heldBills.length === 0) {
      wrap.innerHTML = '<div class="eb-held-empty">No held bills.</div>';
      return;
    }
    const c = cur();
    wrap.innerHTML = '';
    heldBills.forEach((bill, idx) => {
      const total = bill.items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
      const row = document.createElement('div');
      row.className = 'eb-held-row';
      row.innerHTML =
        '<div class="eb-held-info"><div class="eb-held-tag">' + esc(bill.tag) + '</div>' +
        '<div class="eb-held-meta">' + bill.items.length + ' item' + (bill.items.length !== 1 ? 's' : '') + ' · ' + c + total.toFixed(2) + '</div></div>' +
        '<div class="eb-held-actions">' +
          '<button class="eb-btn eb-btn-sm" data-recall="' + idx + '">Recall</button>' +
          '<button class="eb-btn eb-btn-sm eb-btn-danger" data-drop="' + idx + '">Delete</button>' +
        '</div>';
      wrap.appendChild(row);
    });
  }

  function onHeldListClick(e) {
    const recallBtn = e.target.closest('[data-recall]');
    const dropBtn = e.target.closest('[data-drop]');
    if (recallBtn) { recallHeld(parseInt(recallBtn.dataset.recall, 10)); return; }
    if (dropBtn) { dropHeld(parseInt(dropBtn.dataset.drop, 10)); return; }
  }

  function recallHeld(index) {
    const bill = heldBills[index];
    if (!bill) return;
    if (cart.length > 0 && !confirm('Recalling this held bill will replace your current unsaved bill. Continue?')) return;
    cart = JSON.parse(JSON.stringify(bill.items));
    $('eb-discount-input').value = bill.discountAmount || 0;
    $('eb-customer-name').value = bill.customerName || '';
    $('eb-customer-phone').value = bill.customerPhone || '';
    heldBills.splice(index, 1);
    saveHeld();
    renderHeldBills();
    renderCart();
    say('↩ Bill "' + bill.tag + '" recalled.');
  }

  function dropHeld(index) {
    const bill = heldBills[index];
    if (!bill) return;
    if (!confirm('Delete held bill "' + bill.tag + '"? This cannot be undone.')) return;
    heldBills.splice(index, 1);
    saveHeld();
    renderHeldBills();
  }

  // ── Checkout — the one write path, via the bridge's atomic RPC ────
  async function checkout() {
    if (lastCheckoutBusy) return;
    if (cart.length === 0) { say('Cart is empty.', true); return; }
    const totals = calcTotals();
    const cashInput = $('eb-cash-received-input');
    const cashReceived = paymentMethod === 'cash'
      ? (cashInput && cashInput.value !== '' ? parseFloat(cashInput.value) || 0 : totals.net)
      : totals.net;

    if (paymentMethod === 'cash' && cashReceived < totals.net) {
      if (!confirm('Cash received (' + cur() + cashReceived.toFixed(2) + ') is less than the net total (' + cur() + totals.net.toFixed(2) + '). Save anyway?')) return;
    }

    lastCheckoutBusy = true;
    renderCart();
    const btn = $('eb-checkout-btn');
    const origLabel = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Saving…';

    try {
      const result = await EBBridge.recordSale({
        staffName: $('eb-staff-name').value.trim(),
        customerName: $('eb-customer-name').value.trim(),
        customerPhone: $('eb-customer-phone').value.trim(),
        cartItems: cart.map(i => ({ code: i.code, name: i.name, price: i.price, qty: i.qty })),
        paymentMethod,
        cashReceived,
        discountAmount: totals.discount,
      });

      if (!result || !result.success) {
        say('❌ Checkout failed: ' + ((result && result.message) || 'Unknown error'), true);
        return;
      }

      showReceipt({
        invoiceNumber: result.invoiceNumber,
        items: cart.slice(),
        subtotal: totals.subtotal,
        discount: totals.discount,
        net: result.netTotal,
        change: result.change,
        paymentMethod,
        customerName: $('eb-customer-name').value.trim(),
        customerPhone: $('eb-customer-phone').value.trim(),
        staffName: $('eb-staff-name').value.trim(),
      });

      doClearCart();
      say('✅ Invoice ' + result.invoiceNumber + ' saved!');
    } catch (err) {
      say('❌ Checkout error: ' + (err && err.message ? err.message : String(err)), true);
    } finally {
      lastCheckoutBusy = false;
      if (btn) btn.textContent = origLabel || 'Checkout';
      renderCart();
    }
  }

  // ── Receipt build + print — a self-contained thermal-slip printout,
  // the same idea as POS's hidden #receipt-area + @media print (not
  // this app's shared Print.render() engine in js/print.js, which is
  // built for full-page KPI/table reports, not narrow slips). See
  // css/emergency-billing.css for the print rules that hide everything
  // else on the page except #eb-receipt-print when printing. ─────────
  function showReceipt(sale) {
    const box = $('eb-receipt-print');
    if (!box) return;
    const c = cur();
    const dt = new Date();
    let itemsHTML = '';
    sale.items.forEach(item => {
      itemsHTML += '<div class="eb-rcpt-item">' +
        '<div class="eb-rcpt-item-name">' + esc(item.name) + '</div>' +
        '<div class="eb-rcpt-item-meta"><span>' + item.qty + ' × ' + c + item.price.toFixed(2) + '</span><span>' + c + item.total.toFixed(2) + '</span></div>' +
      '</div>';
    });

    box.innerHTML =
      '<div class="eb-rcpt-head"><h3>Emergency Sale Receipt</h3><p>Invoice ' + esc(sale.invoiceNumber) + '</p><p>' + dt.toLocaleString() + '</p></div>' +
      (sale.customerName ? '<div class="eb-rcpt-row"><span>Customer</span><span>' + esc(sale.customerName) + (sale.customerPhone ? ' · ' + esc(sale.customerPhone) : '') + '</span></div>' : '') +
      (sale.staffName ? '<div class="eb-rcpt-row"><span>Staff</span><span>' + esc(sale.staffName) + '</span></div>' : '') +
      '<div class="eb-rcpt-sep"></div>' + itemsHTML + '<div class="eb-rcpt-sep"></div>' +
      '<div class="eb-rcpt-row"><span>Subtotal</span><span>' + c + sale.subtotal.toFixed(2) + '</span></div>' +
      (sale.discount > 0 ? '<div class="eb-rcpt-row"><span>Discount</span><span>−' + c + sale.discount.toFixed(2) + '</span></div>' : '') +
      '<div class="eb-rcpt-row eb-rcpt-net"><span>Net Total</span><span>' + c + sale.net.toFixed(2) + '</span></div>' +
      '<div class="eb-rcpt-row"><span>Payment</span><span>' + esc(sale.paymentMethod) + '</span></div>' +
      (sale.paymentMethod === 'cash' ? '<div class="eb-rcpt-row"><span>Change</span><span>' + c + (sale.change || 0).toFixed(2) + '</span></div>' : '') +
      '<div class="eb-rcpt-foot">Emergency Billing — counter sale, unreconciled with Daily Sale Entry until manually entered.</div>';

    const modal = $('eb-receipt-modal');
    if (modal) modal.classList.add('visible');
  }
  function closeReceiptModal() {
    const modal = $('eb-receipt-modal');
    if (modal) modal.classList.remove('visible');
  }
  function printReceipt() {
    setTimeout(() => window.print(), 50);
  }

  // ── Reconciliation (§7, Option A — fully manual) ──────────────────
  // Groups unreconciled invoices by local calendar day and shows each
  // day's total; "Mark Reconciled" only flags rows the human has
  // already, separately, typed into Add Entry — this never writes to
  // DAILY/bt_salesdata itself (see markReconciled()'s own header note
  // in the bridge file).
  function _fmtDMY(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + BTDate.monthShort[d.getMonth()] + '/' + d.getFullYear();
  }
  function _localDayKey(isoStr) {
    const d = new Date(isoStr);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function renderReconciliation() {
    const wrap = $('eb-recon-list');
    if (!wrap) return;
    wrap.innerHTML = '<div class="eb-recon-loading">Loading…</div>';

    let unreconciled = [];
    try { unreconciled = await EBBridge.fetchInvoices({ unreconciledOnly: true }); }
    catch (e) { wrap.innerHTML = '<div class="eb-recon-loading">Couldn\'t load — ' + esc(e.message || String(e)) + '</div>'; return; }

    if (!unreconciled.length) {
      wrap.innerHTML = '<div class="eb-held-empty">Nothing to reconcile — every invoice is caught up.</div>';
      return;
    }

    const byDay = {};
    unreconciled.forEach(inv => {
      const key = _localDayKey(inv.billed_at);
      if (!byDay[key]) byDay[key] = { date: new Date(inv.billed_at), net: 0, count: 0, invoiceNumbers: [] };
      byDay[key].net += parseFloat(inv.net_total) || 0;
      byDay[key].count += 1;
      byDay[key].invoiceNumbers.push(inv.invoice_number);
    });

    const c = cur();
    const days = Object.keys(byDay).sort().reverse();
    wrap.innerHTML = '';
    days.forEach(key => {
      const g = byDay[key];
      const row = document.createElement('div');
      row.className = 'eb-held-row eb-recon-row';
      row.innerHTML =
        '<div class="eb-held-info"><div class="eb-held-tag">' + esc(_fmtDMY(g.date)) + '</div>' +
        '<div class="eb-held-meta">' + g.count + ' invoice' + (g.count !== 1 ? 's' : '') + ' · ' + c + g.net.toFixed(2) + ' not yet in Daily Sale Entry</div></div>' +
        '<div class="eb-held-actions"><button class="eb-btn eb-btn-sm" data-recon="' + esc(key) + '">✅ Mark Reconciled</button></div>';
      wrap.appendChild(row);
      row.dataset.net = g.net;
      row.dataset.invoices = JSON.stringify(g.invoiceNumbers);
      row.dataset.dmy = _fmtDMY(g.date);
    });
  }

  async function onReconListClick(e) {
    const btn = e.target.closest('[data-recon]');
    if (!btn) return;
    const row = btn.closest('.eb-recon-row');
    const invoiceNumbers = JSON.parse(row.dataset.invoices || '[]');
    const net = parseFloat(row.dataset.net) || 0;
    const dmy = row.dataset.dmy;
    if (!confirm('Confirm you have already typed ' + cur() + net.toFixed(2) + ' into Sale Data → Add Entry for ' + dmy + '.\n\nThis only flags these ' + invoiceNumbers.length + ' invoice(s) as reconciled here — it does NOT write anything into Daily Sale Entry for you.')) return;
    btn.disabled = true; btn.textContent = 'Saving…';
    const ok = await EBBridge.markReconciled(invoiceNumbers, dmy);
    if (ok) { say('✅ Marked reconciled for ' + dmy); renderReconciliation(); renderCoverBanner(true); }
    else { say('❌ Failed to mark reconciled.', true); btn.disabled = false; btn.textContent = '✅ Mark Reconciled'; }
  }

  // ── Cover signal card ──────────────────────────────────────────────
  // Small banner on Cover, not a full domain group tile (see index.html's
  // #cover-emergency-billing-banner note). Throttled the same way the
  // other bridges throttle their full-table pulls — Cover re-renders
  // often (tab switches, drag-reorder, every checkout), and this isn't
  // data that needs to be second-fresh.
  const COVER_BANNER_MIN_REFRESH_MS = 60000;
  let _bannerCache = null, _bannerFetchedAt = 0, _bannerInFlight = null;

  async function renderCoverBanner(force) {
    const mount = $('cover-emergency-billing-banner');
    if (!mount) return; // Cover isn't the page currently in the DOM
    const fresh = !force && _bannerCache && (Date.now() - _bannerFetchedAt < COVER_BANNER_MIN_REFRESH_MS);
    if (fresh) { mount.innerHTML = _bannerCache; return; }
    if (_bannerInFlight) return; // a refresh is already underway
    _bannerInFlight = (async () => {
      try {
        const [today, unreconciled] = await Promise.all([
          EBBridge.fetchInvoices({ from: new Date(new Date().setHours(0,0,0,0)).toISOString(), to: new Date(new Date().setHours(23,59,59,999)).toISOString() }),
          EBBridge.fetchInvoices({ unreconciledOnly: true }),
        ]);
        if (!today.length && !unreconciled.length) { _bannerCache = ''; _bannerFetchedAt = Date.now(); mount.innerHTML = ''; return; }
        const todayNet = today.reduce((s, i) => s + (parseFloat(i.net_total) || 0), 0);
        const unreconciledDays = new Set(unreconciled.map(i => _localDayKey(i.billed_at))).size;
        const c = cur();
        const html =
          '<div class="eb-cover-banner" onclick="location.hash=\'#emergency-billing\'">' +
            '<span class="eb-cover-banner-icon">🚨</span>' +
            '<div class="eb-cover-banner-text">' +
              '<strong>Emergency Billing</strong>' +
              (today.length ? ' — ' + today.length + ' invoice' + (today.length !== 1 ? 's' : '') + ' today · ' + c + todayNet.toFixed(2) : '') +
              (unreconciledDays ? ' · ' + unreconciledDays + ' day' + (unreconciledDays !== 1 ? 's' : '') + ' not yet reconciled' : '') +
            '</div>' +
          '</div>';
        _bannerCache = html; _bannerFetchedAt = Date.now();
        mount.innerHTML = html;
      } catch (e) {
        console.error('Emergency Billing cover banner failed', e);
      } finally { _bannerInFlight = null; }
    })();
  }

  window.ebRenderCoverBanner = renderCoverBanner;

  // ── Wire DOM events once ─────────────────────────────────────────
  function wireEvents() {
    const searchInput = $('eb-search-input');
    searchInput.addEventListener('input', function () { doSearch(this.value); });
    searchInput.addEventListener('keydown', function (e) {
      const items = $('eb-search-results').querySelectorAll('.eb-sr-row');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeDropdownIndex < items.length - 1) {
          if (activeDropdownIndex >= 0) items[activeDropdownIndex].classList.remove('selected');
          activeDropdownIndex++; items[activeDropdownIndex].classList.add('selected');
          items[activeDropdownIndex].scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeDropdownIndex > 0) {
          items[activeDropdownIndex].classList.remove('selected');
          activeDropdownIndex--; items[activeDropdownIndex].classList.add('selected');
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeDropdownIndex >= 0 && items[activeDropdownIndex]) items[activeDropdownIndex].click();
        else if (searchResults.length > 0) pickProduct(searchResults[0]);
      }
    });
    $('eb-search-clear').addEventListener('click', () => { searchInput.value = ''; doSearch(''); searchInput.focus(); });

    $('eb-discount-input').addEventListener('input', calcTotals);
    $('eb-cash-received-input').addEventListener('input', calcTotals);

    $('eb-pay-cash').addEventListener('click', () => setPaymentMode('cash'));
    $('eb-pay-card').addEventListener('click', () => setPaymentMode('card'));
    $('eb-pay-online').addEventListener('click', () => setPaymentMode('online'));

    $('eb-cart-body').addEventListener('click', onCartBodyClick);
    $('eb-cart-body').addEventListener('change', onCartBodyChange);
    $('eb-held-list').addEventListener('click', onHeldListClick);
    $('eb-recon-list').addEventListener('click', onReconListClick);

    $('eb-hold-btn').addEventListener('click', holdBill);
    $('eb-clear-btn').addEventListener('click', clearCart);
    $('eb-checkout-btn').addEventListener('click', checkout);

    $('eb-receipt-close').addEventListener('click', closeReceiptModal);
    $('eb-receipt-print-btn').addEventListener('click', printReceipt);
    $('eb-receipt-modal').addEventListener('click', e => { if (e.target.id === 'eb-receipt-modal') closeReceiptModal(); });

    document.addEventListener('keydown', onGlobalKeydown);
  }

  // ── Page-show hook — called from ui.js's showPage() ─────────────────
  function onShowEmergencyBilling() { init(); }
  // Bridge's post-checkout notify hook (see emergency-billing-bridge.js's
  // recordSale) — re-render in case another device/tab's sale affected
  // anything this page is showing. Cart/held bills are per-device
  // localStorage, so this mostly just re-renders what's already there.
  function onBridgeRefresh() { renderCart(); renderHeldBills(); renderReconciliation(); renderCoverBanner(true); }

  window.ebOnShowEmergencyBilling = onShowEmergencyBilling;
  window.emergencyBillingNativeOnRefresh = onBridgeRefresh;
})();
