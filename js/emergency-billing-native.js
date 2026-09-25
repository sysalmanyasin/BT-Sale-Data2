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
  // Settings tab (Branch Identity / Business Name / Receipt Customization /
  // Billing Settings) — per-device, localStorage-only, same reasoning as
  // HELD_KEY/CART_KEY above: this is till configuration for whichever
  // device is physically printing receipts, not shared business data, so
  // it deliberately never goes through Repository/Actions/Supabase. If a
  // future need arises to keep receipt branding identical across several
  // till devices, this is the key to start syncing — not touched here.
  const SETTINGS_KEY = 'eb_settings_v1';
  const DEFAULT_SETTINGS = {
    // Branch Identity
    branchName: '', branchAddress: '', branchPhone: '',
    // Business Name
    businessName: '', taxNumber: '',
    // Receipt Customization
    receiptHeader: '', receiptFooter: 'Emergency Billing — counter sale, unreconciled with Daily Sale Entry until manually entered.',
    receiptWidth: '80', currencySymbol: 'Rs. ',
    showAddressOnReceipt: true, showPhoneOnReceipt: true,
    // Billing Settings
    defaultPaymentMethod: 'cash', lowStockThreshold: 5,
    requireStaffName: false, autoPrintReceipt: false,
    confirmClear: true, roundNet: false,
  };

  // ── State ──────────────────────────────────────────────────────────
  let cart = [];            // [{ code, name, price, qty, total }]
  let heldBills = [];        // [{ tag, savedAt, items, discountAmount, customerName, customerPhone }]
  let settings = DEFAULT_SETTINGS; // real value assigned by loadSettings() in init()
  let activeTab = 'billing';       // 'billing' | 'history' | 'settings'
  let paymentMethod = 'cash';
  let activeDropdownIndex = -1;
  let searchResults = [];
  let f9Mode = false;
  let f9Row = -1;
  let wired = false;         // guards event-listener wiring (idempotent init)
  let lastCheckoutBusy = false;
  let historyResults = [];       // last Billing History search results
  let historyDetail = null;      // { invoice, items } for the open Saved Bill modal
  let discountMode = 'flat';     // 'flat' (rupee amount) | 'percent' (of subtotal) — see setDiscountMode()

  // ── Small local helpers ───────────────────────────────────────────
  // Settings' own Currency Symbol field (default 'Rs. ') wins once the
  // person has saved anything here — falling back to the app-wide
  // window._getCurrency() hook only when Settings has never been touched,
  // same "don't override a value the person actually set" precedent as
  // the rest of this file's localStorage reads.
  function cur() {
    if (settings && settings.currencySymbol) return settings.currencySymbol;
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

  // Merges saved settings over DEFAULT_SETTINGS (not a straight overwrite)
  // so a future new setting added to DEFAULT_SETTINGS always has a real
  // value even for a device whose localStorage predates that setting —
  // same forward-compatible pattern as every migration elsewhere in this
  // app "never assume a key has every field."
  function loadSettings() {
    const saved = _loadLocal(SETTINGS_KEY, null);
    return Object.assign({}, DEFAULT_SETTINGS, saved || {});
  }
  function saveSettings() { _saveLocal(SETTINGS_KEY, settings); }

  // ── Inventory-load status ───────────────────────────────────────────
  // Root cause of the "No products found" / "Inventory data unavailable"
  // reports: window.inventoryBridgeGetFullData() (from inventory-bridge.js)
  // is a passive read of whatever's already in memory/localStorage — it
  // never fetches anything itself. Historically the ONLY things that ever
  // called InventoryBridge.refreshFullData() were the Inventory page's own
  // onShowInventory() and Cover's renderCoverDashboard() (see ui.js's
  // showPage(), which only renders Cover when id==='cover'). So a user who
  // deep-links or bookmarks straight to #emergency-billing — never passing
  // through Cover or Inventory first in that browser session — hit a page
  // whose product cache was genuinely empty, and got told "No products
  // found for 000817" for a product that exists, plus "Inventory data
  // unavailable" the moment they tried to add anything to the cart. This
  // page now proactively kicks off the same refresh Inventory's own page
  // does, every time it's shown, exactly like inventory-native.js's
  // onShowInventory() does — and shows a status line + manual "Refresh"
  // button so staff aren't left guessing why a real product isn't found.
  // 2026-09-25: matches the same fetchedAt fallback as
  // emergency-billing-bridge.js's _bridgeSnapshot() / inventory-native.js's
  // own freshness label — data.lastSync (the real Dropbox sync-log row) is
  // unreachable in this deployment, so "loaded" has to mean "we have a
  // product list and know when we fetched it", not "the sync log has a
  // row". Requiring the latter meant this badge stayed red forever, even
  // moments after a successful search against a fully fresh cache.
  function _isInventoryLoaded() {
    const data = (typeof window.inventoryBridgeGetFullData === 'function') ? window.inventoryBridgeGetFullData() : null;
    return !!(data && (data.products || []).length && (data.fetchedAt || (data.lastSync && data.lastSync.syncedAt)));
  }

  function renderInventoryStatus() {
    const el = $('eb-inv-status');
    if (!el) return;
    const data = (typeof window.inventoryBridgeGetFullData === 'function') ? window.inventoryBridgeGetFullData() : null;
    const itemCount = data && (data.products || []).length;
    if (!data || !itemCount) {
      el.innerHTML = '<span class="eb-inv-dot eb-inv-dot-bad"></span>BT Inventory not loaded yet';
      return;
    }
    const syncedAtRaw = (data.lastSync && data.lastSync.syncedAt) || data.fetchedAt;
    const syncedMs = new Date(syncedAtRaw).getTime();
    const mins = Math.max(0, Math.round((Date.now() - syncedMs) / 60000));
    const ageLabel = mins < 1 ? 'just now' : (mins + ' min' + (mins === 1 ? '' : 's') + ' ago');
    const stale = mins >= 30;
    el.innerHTML = '<span class="eb-inv-dot eb-inv-dot-' + (stale ? 'warn' : 'ok') + '"></span>' +
      'BT Inventory · ' + itemCount + ' items · synced ' + ageLabel;
  }

  // force=true bypasses the bridge's own 60s throttle (used for the manual
  // "Refresh" button); force=false (page-show) still fetches immediately
  // whenever nothing is cached yet, and is a near-free no-op when the
  // bridge is already fresh (see inventory-bridge.js's refreshFullData).
  let _invRefreshInFlight = false;
  async function refreshInventoryStatus(force) {
    const btn = $('eb-inv-refresh-btn');
    if (_invRefreshInFlight && !force) { renderInventoryStatus(); return; }
    _invRefreshInFlight = true;
    if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; }
    const el = $('eb-inv-status');
    if (el && !_isInventoryLoaded()) el.innerHTML = '<span class="eb-inv-dot eb-inv-dot-warn"></span>Loading BT Inventory…';
    try {
      if (typeof window.inventoryBridgeRefresh === 'function') {
        await window.inventoryBridgeRefresh(!!force);
      }
    } catch (e) { /* best-effort — status line below reflects whatever we ended up with */ }
    renderInventoryStatus();
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Inventory'; }
    _invRefreshInFlight = false;
    // If the person already typed a search while this was loading (or is
    // retrying after a manual refresh), re-run it now that data may exist.
    const searchInput = $('eb-search-input');
    if (searchInput && searchInput.value.trim()) doSearch(searchInput.value);
  }

  // ── Init — called every time the page is shown ───────────────────
  function init() {
    if (!$('page-emergency-billing')) {
      console.error('emergency-billing-native: #page-emergency-billing not found in the DOM yet.');
      return;
    }
    const firstLoad = !wired;
    cart = _loadLocal(CART_KEY, []);
    heldBills = _loadLocal(HELD_KEY, []);
    settings = loadSettings();
    // Only apply the settings-driven default payment method on this
    // module's very first init — after that, whatever the person picked
    // this session (or restored via a held bill) should win, same as
    // paymentMethod already behaves for every other page revisit.
    if (firstLoad) paymentMethod = settings.defaultPaymentMethod || 'cash';

    if (!wired) { wireEvents(); wired = true; }

    renderCart();
    renderHeldBills();
    renderReconciliation();
    setPaymentMode(paymentMethod);
    renderInventoryStatus();
    refreshInventoryStatus(false);
    renderSettingsForm();
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
      if (noRes) {
        noRes.style.display = 'block';
        // Distinguish "genuinely not stocked" from "BT Inventory hasn't
        // loaded in this session yet" — these used to show the same
        // confusing "No products found" message even for real products.
        noRes.textContent = _isInventoryLoaded()
          ? 'No products found for "' + q + '"'
          : '⚠️ BT Inventory hasn\'t loaded yet — tap "Refresh Inventory" above, then search again.';
      }
      return;
    }
    if (noRes) noRes.style.display = 'none';

    const c = cur();
    panel.innerHTML = '';
    searchResults.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'eb-sr-row';
      const low = Number(p.qty) <= (settings.lowStockThreshold != null ? settings.lowStockThreshold : 5);
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
    // Pre-select the top result so the ↑/↓/Enter flow is usable from the
    // very first keystroke, instead of requiring a first ArrowDown press
    // before anything is visibly selected.
    activeDropdownIndex = 0;
    panel.firstElementChild.classList.add('selected');
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
      say('⚠️ Inventory data unavailable for ' + product.code + ' — tap "Refresh Inventory" above and try again.', true);
      refreshInventoryStatus(false); // best-effort background retry, same as a manual click
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
    if (!avail) { say('⚠️ Inventory data unavailable — tap "Refresh Inventory" above and try again.', true); refreshInventoryStatus(false); renderCart(); return; }
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
    if (settings.confirmClear && !confirm('Clear the current bill? This cannot be undone.')) return;
    doClearCart();
  }
  function doClearCart() {
    cart = [];
    f9Mode = false; f9Row = -1;
    setDiscountMode('flat', true); // also zeroes the input and hides the % presets row
    $('eb-customer-name').value = '';
    $('eb-customer-phone').value = '';
    $('eb-cash-received-input').value = '';
    paymentMethod = settings.defaultPaymentMethod || 'cash';
    setPaymentMode(paymentMethod);
    renderCart();
  }

  // ── Discount mode (Flat Rs. / % of subtotal) ───────────────────────
  // resetValue: whether to zero the input when switching modes — true
  // for a manual toggle-button click (Rs.50 silently becoming "50%" on
  // a mode switch would be a dangerous unit mix-up), false when the
  // caller is about to set its own value right after (recallHeld()).
  function setDiscountMode(mode, resetValue) {
    discountMode = mode === 'percent' ? 'percent' : 'flat';
    document.querySelectorAll('.eb-discount-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === discountMode));
    const presetsRow = $('eb-discount-presets-row');
    if (presetsRow) presetsRow.style.display = discountMode === 'percent' ? 'flex' : 'none';
    if (discountMode !== 'percent') {
      document.querySelectorAll('.eb-discount-preset-btn').forEach(b => b.classList.remove('active'));
    }
    const input = $('eb-discount-input');
    if (input) {
      if (discountMode === 'percent') input.setAttribute('max', '100');
      else input.removeAttribute('max');
      if (resetValue) input.value = '0';
    }
    calcTotals();
  }

  function applyDiscountPreset(pct) {
    setDiscountMode('percent', false);
    $('eb-discount-input').value = pct;
    document.querySelectorAll('.eb-discount-preset-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.pct) === pct));
    calcTotals();
  }

  // ── Totals ─────────────────────────────────────────────────────────
  function calcTotals() {
    const subtotal = cart.reduce((s, i) => s + (parseFloat(i.total) || 0), 0);
    let discInput = parseFloat($('eb-discount-input').value) || 0;
    if (discInput < 0) discInput = 0;

    let disc;
    if (discountMode === 'percent') {
      if (discInput > 100) discInput = 100;
      disc = subtotal * (discInput / 100);
    } else {
      disc = discInput;
    }
    if (disc > subtotal) disc = subtotal;
    let net = Math.max(0, subtotal - disc);

    // Settings > Billing Settings > "Round Net Payable to the nearest
    // whole rupee". Folded into `discount` (not left as a separate
    // unaccounted delta) so subtotal - discount === net stays true for
    // every downstream consumer (the receipt, the RPC, Billing History) —
    // the rounding line on screen/receipt is just that delta surfaced for
    // transparency, not a fourth independent number.
    let rounding = 0;
    if (settings.roundNet) {
      const roundedNet = Math.round(net);
      rounding = Number((net - roundedNet).toFixed(2));
      net = roundedNet;
      disc = Number((disc + rounding).toFixed(2));
    }

    $('eb-subtotal').textContent = cur() + subtotal.toFixed(2);
    $('eb-net-total').textContent = cur() + net.toFixed(2);

    // % mode shows the rupee-equivalent underneath so the cashier sees
    // exactly what "3%" comes out to before checking out; Flat mode has
    // nothing extra to show since the input already IS the rupee amount.
    const discAmountRow = $('eb-discount-amount-row');
    if (discAmountRow) {
      if (discountMode === 'percent' && discInput > 0) {
        $('eb-discount-display').textContent = '= ' + cur() + disc.toFixed(2);
        discAmountRow.style.display = 'flex';
      } else {
        discAmountRow.style.display = 'none';
      }
    }

    const roundRow = $('eb-rounding-row');
    if (roundRow) {
      if (rounding !== 0) {
        $('eb-rounding-display').textContent = (rounding > 0 ? '−' : '+') + cur() + Math.abs(rounding).toFixed(2);
        roundRow.style.display = 'flex';
      } else {
        roundRow.style.display = 'none';
      }
    }

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
      hint.textContent = '⚡ F9 EDIT MODE — Row ' + (f9Row + 1) + '/' + cart.length + ' (↑↓ navigate, type a qty or Enter to overwrite, Del remove, Esc exit)';
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
      // Turning F9 on almost always happens right after adding a product,
      // when focus is still sitting in the search box (pickProduct()
      // re-focuses it). Since isInput blocks ↑/↓ below, F9 looked "broken"
      // — it toggled, but arrow keys did nothing until the person clicked
      // elsewhere first. Blur whatever's focused so row navigation works
      // the instant F9 is pressed.
      if (f9Mode && isInput) document.activeElement.blur();
      say(f9Mode ? '⚡ F9 Mode ON' : 'F9 Mode OFF');
      highlightF9Row(); updateF9Hint();
      return;
    }
    if (!f9Mode || isInput) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (f9Row < cart.length - 1) { f9Row++; highlightF9Row(); updateF9Hint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (f9Row > 0) { f9Row--; highlightF9Row(); updateF9Hint(); } }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(f9Row); }
    else if (e.key === 'Escape') { f9Mode = false; f9Row = -1; highlightF9Row(); updateF9Hint(); }
    else if (e.key === 'Enter' || /^[0-9]$/.test(e.key)) {
      // "F9 goes to inline quantity edit" — jump straight into the
      // highlighted row's qty field to overwrite it: Enter opens it with
      // the current value selected (so typing replaces it), a digit key
      // opens it and starts typing immediately with that digit already
      // entered — no separate "press Enter first" step needed. Either
      // way, onCartBodyKeydown() below takes over from there (its own
      // Enter commits the edit, Escape cancels and reverts).
      e.preventDefault();
      const row = document.querySelectorAll('#eb-cart-body .eb-cart-row')[f9Row];
      const qtyInput = row ? row.querySelector('.eb-qinp') : null;
      if (qtyInput) {
        if (e.key === 'Enter') { qtyInput.focus(); qtyInput.select(); }
        else { qtyInput.value = e.key; qtyInput.focus(); qtyInput.setSelectionRange(1, 1); }
      }
    }
  }

  // Enter inside the F9 inline qty edit commits it (blur → the existing
  // 'change' listener's setQty() → renderCart(), which re-applies F9's
  // row highlight from f9Row automatically). Escape reverts to the
  // pre-edit quantity and backs out without saving — cancel, not commit.
  function onCartBodyKeydown(e) {
    const inp = e.target.closest('.eb-qinp');
    if (!inp) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const idx = parseInt(inp.dataset.idx, 10);
      if (cart[idx]) inp.value = cart[idx].qty;
      inp.blur();
    }
  }

  // ── Held bills (localStorage only — see header note) ──────────────
  function holdBill() {
    if (cart.length === 0) { say('Cart is empty — nothing to hold.', true); return; }
    const tag = (prompt('Label this held bill (optional):', '') || '').trim() || ('Bill #' + (heldBills.length + 1));
    // Freeze the discount as its already-computed rupee amount regardless
    // of Flat/% mode — held bills are mode-agnostic on recall (see
    // recallHeld() below), same as this app never having stored anything
    // but a rupee figure here before % mode existed.
    const totals = calcTotals();
    heldBills.push({
      tag,
      savedAt: new Date().toISOString(),
      items: JSON.parse(JSON.stringify(cart)),
      discountAmount: totals.discount,
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
    // Held discounts are always a frozen rupee amount (see holdBill()) —
    // recall always restores Flat mode, never %.
    setDiscountMode('flat', false);
    $('eb-discount-input').value = bill.discountAmount || 0;
    $('eb-customer-name').value = bill.customerName || '';
    $('eb-customer-phone').value = bill.customerPhone || '';
    heldBills.splice(index, 1);
    saveHeld();
    renderHeldBills();
    renderCart();
    calcTotals();
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

    // Settings > Billing Settings > "Require staff name before checkout".
    if (settings.requireStaffName && !$('eb-staff-name').value.trim()) {
      say('⚠️ Staff Name is required before checkout (see Settings).', true);
      $('eb-staff-name').focus();
      return;
    }

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
      // Settings > Billing Settings > "Auto-print receipt after checkout".
      // Small delay so the receipt modal/DOM is fully painted before the
      // browser's print dialog steals focus — same 50ms print.js's own
      // printReceipt() already uses for the manual button, just triggered
      // for us instead of waiting for a click.
      if (settings.autoPrintReceipt) printReceipt();
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
  // else on the page except #eb-receipt-print when printing.
  //
  // sale.billedAt (optional ISO string) / sale.reprint (optional bool) —
  // used by the History tab's "🖨 Reprint" action so a reprinted receipt
  // shows the ORIGINAL sale's real date/time (not "now") and is clearly
  // marked as a reprint; a fresh checkout omits both and gets today's
  // date with no reprint marker, same as before this file had a History
  // tab at all. ─────────────────────────────────────────────────────
  function showReceipt(sale) {
    const box = $('eb-receipt-print');
    if (!box) return;
    const c = cur();
    const dt = sale.billedAt ? new Date(sale.billedAt) : new Date();
    // Settings > Receipt Customization > "Receipt Width" — 58mm narrow
    // slips get a smaller font/padding via this modifier class (see
    // emergency-billing.css's @media print block).
    box.className = settings.receiptWidth === '58' ? 'eb-w58' : '';

    let itemsHTML = '';
    sale.items.forEach(item => {
      itemsHTML += '<div class="eb-rcpt-item">' +
        '<div class="eb-rcpt-item-name">' + esc(item.name) + '</div>' +
        '<div class="eb-rcpt-item-meta"><span>' + item.qty + ' × ' + c + item.price.toFixed(2) + '</span><span>' + c + item.total.toFixed(2) + '</span></div>' +
      '</div>';
    });

    // Settings > Branch Identity / Business Name / Receipt Customization —
    // everything here is optional; an untouched Settings tab (every field
    // still blank) reproduces the exact receipt this page printed before
    // Settings existed, just with the fallback heading below.
    const headLines = [];
    headLines.push('<h3>' + esc(settings.businessName || 'Emergency Sale Receipt') + '</h3>');
    if (settings.branchName) headLines.push('<p class="eb-rcpt-branch">' + esc(settings.branchName) + '</p>');
    if (settings.receiptHeader) headLines.push('<p>' + esc(settings.receiptHeader) + '</p>');
    if (settings.showAddressOnReceipt && settings.branchAddress) headLines.push('<p>' + esc(settings.branchAddress) + '</p>');
    if (settings.showPhoneOnReceipt && settings.branchPhone) headLines.push('<p>' + esc(settings.branchPhone) + '</p>');
    if (settings.taxNumber) headLines.push('<p>NTN/Tax #: ' + esc(settings.taxNumber) + '</p>');
    headLines.push('<p>' + (sale.reprint ? '↻ REPRINT — ' : '') + 'Invoice ' + esc(sale.invoiceNumber) + '</p>');
    headLines.push('<p>' + dt.toLocaleString() + '</p>');

    box.innerHTML =
      '<div class="eb-rcpt-head">' + headLines.join('') + '</div>' +
      (sale.customerName ? '<div class="eb-rcpt-row"><span>Customer</span><span>' + esc(sale.customerName) + (sale.customerPhone ? ' · ' + esc(sale.customerPhone) : '') + '</span></div>' : '') +
      (sale.staffName ? '<div class="eb-rcpt-row"><span>Staff</span><span>' + esc(sale.staffName) + '</span></div>' : '') +
      '<div class="eb-rcpt-sep"></div>' + itemsHTML + '<div class="eb-rcpt-sep"></div>' +
      '<div class="eb-rcpt-row"><span>Subtotal</span><span>' + c + sale.subtotal.toFixed(2) + '</span></div>' +
      (sale.discount > 0 ? '<div class="eb-rcpt-row"><span>Discount</span><span>−' + c + sale.discount.toFixed(2) + '</span></div>' : '') +
      '<div class="eb-rcpt-row eb-rcpt-net"><span>Net Total</span><span>' + c + sale.net.toFixed(2) + '</span></div>' +
      '<div class="eb-rcpt-row"><span>Payment</span><span>' + esc(sale.paymentMethod) + '</span></div>' +
      (sale.paymentMethod === 'cash' ? '<div class="eb-rcpt-row"><span>Change</span><span>' + c + (sale.change || 0).toFixed(2) + '</span></div>' : '') +
      '<div class="eb-rcpt-foot">' + esc(settings.receiptFooter || '') + '</div>';

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
      if (!byDay[key]) byDay[key] = { date: new Date(inv.billed_at), net: 0, count: 0, refundCount: 0, invoiceNumbers: [] };
      const amt = parseFloat(inv.net_total) || 0;
      byDay[key].net += inv.is_refund ? -amt : amt;
      byDay[key].count += 1;
      if (inv.is_refund) byDay[key].refundCount += 1;
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
        '<div class="eb-held-meta">' + g.count + ' invoice' + (g.count !== 1 ? 's' : '') +
          (g.refundCount ? ' (' + g.refundCount + ' refund' + (g.refundCount !== 1 ? 's' : '') + ')' : '') +
          ' · net ' + c + g.net.toFixed(2) + ' not yet in Daily Sale Entry</div></div>' +
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

  // ── Refund / partial-refund ────────────────────────────────────────
  // Reads the original invoice + its real line items before offering
  // anything to refund — a refund line can never target a product that
  // wasn't actually on that sale. record_emergency_refund() is still
  // the real gate against over-refunding (row-locked, server-side).
  let refundOriginal = null;  // the original invoice header row
  let refundLines = [];       // [{ code, name, price, origQty, refundQty }]

  function openRefundModal() {
    refundOriginal = null; refundLines = [];
    $('eb-refund-invoice-input').value = '';
    $('eb-refund-body').innerHTML = '';
    $('eb-refund-modal').classList.add('visible');
    $('eb-refund-invoice-input').focus();
  }
  function closeRefundModal() { $('eb-refund-modal').classList.remove('visible'); }

  async function findRefundInvoice() {
    const num = $('eb-refund-invoice-input').value.trim();
    const body = $('eb-refund-body');
    if (!num) { body.innerHTML = '<div class="eb-refund-status eb-refund-error">Enter an invoice number.</div>'; return; }
    body.innerHTML = '<div class="eb-refund-status">Looking up ' + esc(num) + '…</div>';

    const [invoices, items] = await Promise.all([
      EBBridge.fetchInvoices({ invoiceNumber: num }),
      EBBridge.fetchInvoiceItems(num),
    ]);
    const invoice = invoices.find(i => !i.is_refund);
    if (!invoice) {
      body.innerHTML = '<div class="eb-refund-status eb-refund-error">No original (non-refund) invoice found with that number.</div>';
      return;
    }
    if (!items.length) {
      body.innerHTML = '<div class="eb-refund-status eb-refund-error">That invoice has no line items on record.</div>';
      return;
    }

    refundOriginal = invoice;
    refundLines = items.map(it => ({
      code: it.product_code, name: it.product_name, price: parseFloat(it.unit_price) || 0,
      origQty: it.qty, refundQty: 0,
    }));
    renderRefundBody();
  }

  function renderRefundBody() {
    const c = cur();
    const body = $('eb-refund-body');
    let rowsHTML = '';
    refundLines.forEach((line, idx) => {
      rowsHTML += '<tr>' +
        '<td>' + esc(line.name) + '<br><span class="eb-cc-code">' + esc(line.code) + '</span></td>' +
        '<td>' + line.origQty + '</td>' +
        '<td><input type="number" class="eb-refund-qty-inp" data-ridx="' + idx + '" value="' + line.refundQty + '" min="0" max="' + line.origQty + '"></td>' +
        '<td>' + c + (line.price * line.refundQty).toFixed(2) + '</td>' +
      '</tr>';
    });

    body.innerHTML =
      '<div class="eb-refund-orig-meta">Original: ' + esc(refundOriginal.invoice_number) + ' · ' + new Date(refundOriginal.billed_at).toLocaleString() +
        (refundOriginal.customer_name ? ' · ' + esc(refundOriginal.customer_name) : '') + '</div>' +
      '<table class="eb-refund-table"><thead><tr><th>Item</th><th>Sold</th><th>Refund Qty</th><th>Amount</th></tr></thead>' +
      '<tbody id="eb-refund-lines">' + rowsHTML + '</tbody></table>' +
      '<div class="eb-refund-meta-grid">' +
        '<div><label>Refund Method</label><select id="eb-refund-method"><option value="cash">Cash</option><option value="card">Card</option><option value="online">Online</option></select></div>' +
        '<div><label>Cash Given Back</label><input type="number" id="eb-refund-cash-given" min="0" placeholder="Defaults to refund total"></div>' +
      '</div>' +
      '<div class="eb-refund-total-row"><span>Refund Total</span><span id="eb-refund-total-display">' + c + '0.00</span></div>' +
      '<div class="eb-refund-actions">' +
        '<button class="eb-btn eb-btn-ghost" id="eb-refund-cancel-btn" type="button">Cancel</button>' +
        '<button class="eb-btn eb-btn-primary" id="eb-refund-submit-btn" type="button">Process Refund</button>' +
      '</div>';

    body.querySelector('#eb-refund-lines').addEventListener('change', e => {
      const inp = e.target.closest('.eb-refund-qty-inp');
      if (!inp) return;
      const idx = parseInt(inp.dataset.ridx, 10);
      let q = parseInt(inp.value, 10) || 0;
      if (q < 0) q = 0;
      if (q > refundLines[idx].origQty) q = refundLines[idx].origQty;
      refundLines[idx].refundQty = q;
      renderRefundBody();
    });
    body.querySelector('#eb-refund-cancel-btn').addEventListener('click', closeRefundModal);
    body.querySelector('#eb-refund-submit-btn').addEventListener('click', submitRefund);

    const total = refundLines.reduce((s, l) => s + l.price * l.refundQty, 0);
    body.querySelector('#eb-refund-total-display').textContent = c + total.toFixed(2);
  }

  async function submitRefund() {
    const linesToRefund = refundLines.filter(l => l.refundQty > 0);
    if (!linesToRefund.length) { say('Set a refund quantity for at least one item.', true); return; }

    const method = $('eb-refund-method').value;
    const cashInput = $('eb-refund-cash-given');
    const total = linesToRefund.reduce((s, l) => s + l.price * l.refundQty, 0);
    const cashGiven = cashInput.value !== '' ? parseFloat(cashInput.value) || 0 : total;

    const btn = $('eb-refund-submit-btn');
    btn.disabled = true; btn.textContent = 'Processing…';

    try {
      const result = await EBBridge.recordRefund({
        staffName: $('eb-staff-name').value.trim(),
        originalInvoiceNumber: refundOriginal.invoice_number,
        items: linesToRefund.map(l => ({ code: l.code, name: l.name, price: l.price, qty: l.refundQty })),
        paymentMethod: method,
        cashGiven,
      });
      if (!result || !result.success) {
        say('❌ Refund failed: ' + ((result && result.message) || 'Unknown error'), true);
        btn.disabled = false; btn.textContent = 'Process Refund';
        return;
      }
      say('✅ Refund ' + result.invoiceNumber + ' recorded — ' + cur() + result.netTotal.toFixed(2) + ' returned.');
      closeRefundModal();
      renderReconciliation();
    } catch (err) {
      say('❌ Refund error: ' + (err && err.message ? err.message : String(err)), true);
      btn.disabled = false; btn.textContent = 'Process Refund';
    }
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
        const todayNet = today.reduce((s, i) => s + (i.is_refund ? -1 : 1) * (parseFloat(i.net_total) || 0), 0);
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

  // ── Tabs (Billing / History / Settings) ─────────────────────────────
  let historyAutoLoaded = false;
  function ebSwitchTab(tab) {
    if (tab !== 'billing' && tab !== 'history' && tab !== 'settings') tab = 'billing';
    activeTab = tab;
    ['billing', 'history', 'settings'].forEach(t => {
      const panel = $('eb-tab-panel-' + t);
      const btn = $('eb-tab-btn-' + t);
      if (panel) panel.classList.toggle('on', t === tab);
      if (btn) { btn.classList.toggle('active', t === tab); btn.setAttribute('aria-selected', t === tab ? 'true' : 'false'); }
    });
    if (tab === 'history' && !historyAutoLoaded) {
      // First visit to History this page-load — run the default "Today"
      // preset so the tab isn't just an empty prompt the very first time
      // it's opened. Later visits leave whatever the person last searched
      // in place instead of re-querying every time they switch tabs.
      applyHistoryPreset('today');
    } else if (tab === 'settings') {
      renderSettingsForm();
    }
  }
  window.ebSwitchTab = ebSwitchTab;

  // ── Billing History — search ─────────────────────────────────────────
  function _dateInputValue(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function applyHistoryPreset(preset) {
    const now = new Date();
    let from = null, to = null;
    if (preset === 'today') { from = new Date(now); to = new Date(now); }
    else if (preset === 'yesterday') { from = new Date(now); from.setDate(from.getDate() - 1); to = new Date(from); }
    else if (preset === '7d') { from = new Date(now); from.setDate(from.getDate() - 6); to = new Date(now); }
    else if (preset === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now); }
    // preset === 'all' → leave from/to null (no date filter)

    const fromInput = $('eb-hist-from'), toInput = $('eb-hist-to');
    if (fromInput) fromInput.value = from ? _dateInputValue(from) : '';
    if (toInput) toInput.value = to ? _dateInputValue(to) : '';

    document.querySelectorAll('.eb-hist-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    runHistorySearch();
  }

  // Monotonic sequence number so a slow product-search lookup that
  // finishes AFTER a newer search was already kicked off can't clobber
  // the newer (already-rendered) results — the same race a fast typist
  // or a fast preset-tap could otherwise hit.
  let _historySearchSeq = 0;
  async function runHistorySearch() {
    const seq = ++_historySearchSeq;
    historyAutoLoaded = true;
    const wrap = $('eb-hist-results');
    const summary = $('eb-hist-summary');
    if (wrap) wrap.innerHTML = '<div class="eb-recon-loading">Searching…</div>';
    if (summary) summary.textContent = '';

    const fromVal = $('eb-hist-from').value;
    const toVal = $('eb-hist-to').value;
    const invoiceQ = $('eb-hist-invoice').value.trim();
    const productQ = $('eb-hist-product').value.trim();
    const paymentQ = $('eb-hist-payment').value;
    const personQ = $('eb-hist-person').value.trim().toLowerCase();
    const unreconciledOnly = $('eb-hist-unreconciled').checked;
    const refundsOnly = $('eb-hist-refunds').checked;

    const opts = {};
    if (fromVal) opts.from = new Date(fromVal + 'T00:00:00').toISOString();
    if (toVal) opts.to = new Date(toVal + 'T23:59:59.999').toISOString();
    if (invoiceQ) opts.invoiceNumberLike = invoiceQ;
    if (paymentQ) opts.paymentMethod = paymentQ;
    if (unreconciledOnly) opts.unreconciledOnly = true;

    // Product filter is a two-step lookup (see searchInvoiceNumbersByProduct's
    // header note in emergency-billing-bridge.js) — resolve it to a set of
    // invoice numbers first, then fold that into the same fetchInvoices()
    // call as every other filter.
    if (productQ) {
      let invoiceNumbers = [];
      try { invoiceNumbers = await EBBridge.searchInvoiceNumbersByProduct(productQ); }
      catch (e) { /* fall through with [] — treated as "no matches" below */ }
      if (seq !== _historySearchSeq) return; // superseded by a newer search
      if (!invoiceNumbers.length) { historyResults = []; renderHistoryResults(); return; }
      opts.invoiceNumbers = invoiceNumbers;
    }

    let rows = [];
    try { rows = await EBBridge.fetchInvoices(opts); }
    catch (e) {
      if (seq !== _historySearchSeq) return;
      if (wrap) wrap.innerHTML = '<div class="eb-refund-status eb-refund-error">Couldn\'t load Billing History — ' + esc(e && e.message ? e.message : String(e)) + '</div>';
      return;
    }
    if (seq !== _historySearchSeq) return;

    if (refundsOnly) rows = rows.filter(r => r.is_refund);
    if (personQ) rows = rows.filter(r =>
      (r.customer_name || '').toLowerCase().includes(personQ) ||
      (r.customer_phone || '').toLowerCase().includes(personQ) ||
      (r.staff_name || '').toLowerCase().includes(personQ)
    );

    historyResults = rows;
    renderHistoryResults();
  }

  function resetHistoryFilters() {
    ['eb-hist-invoice', 'eb-hist-product', 'eb-hist-person'].forEach(id => { $(id).value = ''; });
    $('eb-hist-payment').value = '';
    $('eb-hist-unreconciled').checked = false;
    $('eb-hist-refunds').checked = false;
    applyHistoryPreset('today');
  }

  function renderHistoryResults() {
    const wrap = $('eb-hist-results');
    const summary = $('eb-hist-summary');
    if (!wrap) return;
    if (!historyResults.length) {
      wrap.innerHTML = '<div class="eb-held-empty">No invoices match these filters.</div>';
      if (summary) summary.textContent = '';
      return;
    }
    const c = cur();
    const netSum = historyResults.reduce((s, r) => s + (r.is_refund ? -1 : 1) * (parseFloat(r.net_total) || 0), 0);
    if (summary) summary.textContent = historyResults.length + ' invoice' + (historyResults.length !== 1 ? 's' : '') + ' · net ' + c + netSum.toFixed(2);

    let rowsHTML = '';
    historyResults.forEach(inv => {
      const dt = new Date(inv.billed_at);
      const badges =
        (inv.is_refund ? '<span class="eb-hist-badge eb-hist-badge-refund">REFUND</span> ' : '') +
        (inv.reconciled_into_daily
          ? '<span class="eb-hist-badge eb-hist-badge-recon">Reconciled</span>'
          : '<span class="eb-hist-badge eb-hist-badge-unrecon">Unreconciled</span>');
      rowsHTML += '<tr data-invoice="' + esc(inv.invoice_number) + '">' +
        '<td class="eb-hist-num">' + esc(inv.invoice_number) + '</td>' +
        '<td>' + esc(dt.toLocaleString()) + '</td>' +
        '<td>' + esc(inv.customer_name || '—') + '</td>' +
        '<td>' + esc(inv.staff_name || '—') + '</td>' +
        '<td>' + esc(inv.payment_method || '') + '</td>' +
        '<td>' + badges + '</td>' +
        '<td class="eb-hist-total">' + (inv.is_refund ? '−' : '') + c + (parseFloat(inv.net_total) || 0).toFixed(2) + '</td>' +
      '</tr>';
    });

    wrap.innerHTML =
      '<div class="eb-hist-table-wrap"><table class="eb-hist-table">' +
      '<thead><tr><th>Invoice #</th><th>Date/Time</th><th>Customer</th><th>Staff</th><th>Payment</th><th>Status</th><th>Net Total</th></tr></thead>' +
      '<tbody id="eb-hist-tbody">' + rowsHTML + '</tbody></table></div>';

    $('eb-hist-tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-invoice]');
      if (tr) openHistoryDetail(tr.dataset.invoice);
    });
  }

  // ── Billing History — "load" a saved bill (view + reprint + refund) ──
  async function openHistoryDetail(invoiceNumber) {
    const modal = $('eb-history-detail-modal');
    const body = $('eb-history-detail-body');
    if (!modal || !body) return;
    body.innerHTML = '<div class="eb-recon-loading">Loading…</div>';
    modal.classList.add('visible');

    let invoices = [], items = [];
    try {
      [invoices, items] = await Promise.all([
        EBBridge.fetchInvoices({ invoiceNumber }),
        EBBridge.fetchInvoiceItems(invoiceNumber),
      ]);
    } catch (e) {
      body.innerHTML = '<div class="eb-refund-status eb-refund-error">Couldn\'t load this invoice — ' + esc(e && e.message ? e.message : String(e)) + '</div>';
      return;
    }
    const invoice = invoices[0];
    if (!invoice) { body.innerHTML = '<div class="eb-refund-status eb-refund-error">Invoice not found.</div>'; return; }
    historyDetail = { invoice, items };
    renderHistoryDetailBody();
  }

  function closeHistoryDetailModal() {
    const modal = $('eb-history-detail-modal');
    if (modal) modal.classList.remove('visible');
    historyDetail = null;
  }

  function renderHistoryDetailBody() {
    if (!historyDetail) return;
    const { invoice, items } = historyDetail;
    const c = cur();
    const body = $('eb-history-detail-body');
    if (!body) return;

    let rowsHTML = '';
    (items || []).forEach(it => {
      rowsHTML += '<tr>' +
        '<td>' + esc(it.product_name) + '<br><span class="eb-cc-code">' + esc(it.product_code) + '</span></td>' +
        '<td class="num">' + esc(it.qty) + '</td>' +
        '<td class="num">' + c + (parseFloat(it.unit_price) || 0).toFixed(2) + '</td>' +
        '<td class="num">' + c + (parseFloat(it.total) || 0).toFixed(2) + '</td>' +
      '</tr>';
    });

    const badges =
      (invoice.is_refund ? '<span class="eb-hist-badge eb-hist-badge-refund">REFUND</span> ' : '') +
      (invoice.reconciled_into_daily
        ? '<span class="eb-hist-badge eb-hist-badge-recon">Reconciled' + (invoice.reconciled_date ? ' ' + esc(invoice.reconciled_date) : '') + '</span>'
        : '<span class="eb-hist-badge eb-hist-badge-unrecon">Unreconciled</span>');

    body.innerHTML =
      '<div class="eb-hist-detail-meta">' +
        '<strong>' + esc(invoice.invoice_number) + '</strong> · ' + esc(new Date(invoice.billed_at).toLocaleString()) + '<br>' +
        badges + '<br>' +
        (invoice.customer_name ? 'Customer: ' + esc(invoice.customer_name) + (invoice.customer_phone ? ' · ' + esc(invoice.customer_phone) : '') + '<br>' : '') +
        (invoice.staff_name ? 'Staff: ' + esc(invoice.staff_name) : '') +
      '</div>' +
      '<table class="eb-hist-detail-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>' +
      '<tbody>' + (rowsHTML || '<tr><td colspan="4">No line items found.</td></tr>') + '</tbody></table>' +
      '<div class="eb-hist-detail-totals">' +
        '<div class="eb-summary-row"><span>Subtotal</span><span>' + c + (parseFloat(invoice.subtotal) || 0).toFixed(2) + '</span></div>' +
        (parseFloat(invoice.discount_amount) > 0 ? '<div class="eb-summary-row"><span>Discount</span><span>−' + c + (parseFloat(invoice.discount_amount) || 0).toFixed(2) + '</span></div>' : '') +
        '<div class="eb-summary-row eb-net"><span>Net Total</span><span>' + c + (parseFloat(invoice.net_total) || 0).toFixed(2) + '</span></div>' +
        '<div class="eb-summary-row"><span>Payment</span><span>' + esc(invoice.payment_method || '') + '</span></div>' +
      '</div>' +
      '<div class="eb-hist-detail-actions">' +
        '<button class="eb-btn eb-btn-ghost" id="eb-hist-detail-close-btn" type="button">Close</button>' +
        '<button class="eb-btn" id="eb-hist-detail-print-btn" type="button">🖨 Reprint</button>' +
        (!invoice.is_refund ? '<button class="eb-btn eb-btn-danger-outline" id="eb-hist-detail-refund-btn" type="button">↩ Refund This</button>' : '') +
      '</div>';

    body.querySelector('#eb-hist-detail-close-btn').addEventListener('click', closeHistoryDetailModal);
    body.querySelector('#eb-hist-detail-print-btn').addEventListener('click', printHistoryInvoice);
    const refundBtn = body.querySelector('#eb-hist-detail-refund-btn');
    if (refundBtn) refundBtn.addEventListener('click', refundFromHistory);
  }

  function printHistoryInvoice() {
    if (!historyDetail) return;
    const { invoice, items } = historyDetail;
    showReceipt({
      invoiceNumber: invoice.invoice_number,
      billedAt: invoice.billed_at,
      reprint: true,
      items: (items || []).map(it => {
        const price = parseFloat(it.unit_price) || 0;
        const total = parseFloat(it.total);
        return { name: it.product_name, code: it.product_code, price, qty: it.qty, total: isNaN(total) ? price * it.qty : total };
      }),
      subtotal: parseFloat(invoice.subtotal) || 0,
      discount: parseFloat(invoice.discount_amount) || 0,
      net: parseFloat(invoice.net_total) || 0,
      change: parseFloat(invoice.change_amount) || 0,
      paymentMethod: invoice.payment_method,
      customerName: invoice.customer_name,
      customerPhone: invoice.customer_phone,
      staffName: invoice.staff_name,
    });
    closeHistoryDetailModal();
  }

  // "↩ Refund This" on a saved bill → jumps back to the Billing tab's
  // existing Refund modal, pre-filled and pre-looked-up, rather than
  // duplicating findRefundInvoice()'s own item-lookup logic here.
  function refundFromHistory() {
    if (!historyDetail) return;
    const invoiceNumber = historyDetail.invoice.invoice_number;
    closeHistoryDetailModal();
    ebSwitchTab('billing');
    openRefundModal();
    $('eb-refund-invoice-input').value = invoiceNumber;
    findRefundInvoice();
  }

  // ── Settings tab ─────────────────────────────────────────────────────
  function renderSettingsForm() {
    if (!$('eb-set-branch-name')) return; // panel not in the DOM (shouldn't happen, but cheap to guard)
    $('eb-set-branch-name').value = settings.branchName;
    $('eb-set-branch-address').value = settings.branchAddress;
    $('eb-set-branch-phone').value = settings.branchPhone;
    $('eb-set-business-name').value = settings.businessName;
    $('eb-set-tax-number').value = settings.taxNumber;
    $('eb-set-receipt-header').value = settings.receiptHeader;
    $('eb-set-receipt-footer').value = settings.receiptFooter;
    $('eb-set-receipt-width').value = settings.receiptWidth;
    $('eb-set-currency').value = settings.currencySymbol;
    $('eb-set-show-address').checked = !!settings.showAddressOnReceipt;
    $('eb-set-show-phone').checked = !!settings.showPhoneOnReceipt;
    $('eb-set-default-payment').value = settings.defaultPaymentMethod;
    $('eb-set-low-stock').value = settings.lowStockThreshold;
    $('eb-set-require-staff').checked = !!settings.requireStaffName;
    $('eb-set-auto-print').checked = !!settings.autoPrintReceipt;
    $('eb-set-confirm-clear').checked = !!settings.confirmClear;
    $('eb-set-round-net').checked = !!settings.roundNet;
  }

  function saveSettingsFromForm() {
    settings = {
      branchName: $('eb-set-branch-name').value.trim(),
      branchAddress: $('eb-set-branch-address').value.trim(),
      branchPhone: $('eb-set-branch-phone').value.trim(),
      businessName: $('eb-set-business-name').value.trim(),
      taxNumber: $('eb-set-tax-number').value.trim(),
      receiptHeader: $('eb-set-receipt-header').value.trim(),
      receiptFooter: $('eb-set-receipt-footer').value,
      receiptWidth: $('eb-set-receipt-width').value === '58' ? '58' : '80',
      currencySymbol: $('eb-set-currency').value || 'Rs. ',
      showAddressOnReceipt: $('eb-set-show-address').checked,
      showPhoneOnReceipt: $('eb-set-show-phone').checked,
      defaultPaymentMethod: ['cash', 'card', 'online'].includes($('eb-set-default-payment').value) ? $('eb-set-default-payment').value : 'cash',
      lowStockThreshold: Math.max(0, parseInt($('eb-set-low-stock').value, 10) || 0),
      requireStaffName: $('eb-set-require-staff').checked,
      autoPrintReceipt: $('eb-set-auto-print').checked,
      confirmClear: $('eb-set-confirm-clear').checked,
      roundNet: $('eb-set-round-net').checked,
    };
    saveSettings();
    calcTotals();          // currency symbol / rounding may have changed
    renderInventoryStatus();
    const status = $('eb-set-status');
    if (status) {
      status.textContent = '✓ Settings saved';
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 2500);
    }
    say('✅ Settings saved.');
  }

  function resetSettingsToDefaults() {
    if (!confirm('Reset all Emergency Billing settings on this device to their defaults?')) return;
    settings = Object.assign({}, DEFAULT_SETTINGS);
    saveSettings();
    renderSettingsForm();
    calcTotals();
    say('Settings reset to defaults.');
  }

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

    $('eb-discount-input').addEventListener('input', () => {
      // Typing a custom % no longer matches any preset chip exactly.
      if (discountMode === 'percent') {
        const v = parseFloat($('eb-discount-input').value) || 0;
        document.querySelectorAll('.eb-discount-preset-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.pct) === v));
      }
      calcTotals();
    });
    $('eb-discount-mode-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.eb-discount-mode-btn');
      if (btn && btn.dataset.mode !== discountMode) setDiscountMode(btn.dataset.mode, true);
    });
    $('eb-discount-presets').addEventListener('click', e => {
      const btn = e.target.closest('.eb-discount-preset-btn');
      if (btn) applyDiscountPreset(Number(btn.dataset.pct));
    });
    $('eb-cash-received-input').addEventListener('input', calcTotals);

    $('eb-pay-cash').addEventListener('click', () => setPaymentMode('cash'));
    $('eb-pay-card').addEventListener('click', () => setPaymentMode('card'));
    $('eb-pay-online').addEventListener('click', () => setPaymentMode('online'));

    $('eb-cart-body').addEventListener('click', onCartBodyClick);
    $('eb-cart-body').addEventListener('change', onCartBodyChange);
    $('eb-cart-body').addEventListener('keydown', onCartBodyKeydown);
    $('eb-held-list').addEventListener('click', onHeldListClick);
    $('eb-recon-list').addEventListener('click', onReconListClick);

    $('eb-hold-btn').addEventListener('click', holdBill);
    $('eb-clear-btn').addEventListener('click', clearCart);
    $('eb-checkout-btn').addEventListener('click', checkout);

    $('eb-receipt-close').addEventListener('click', closeReceiptModal);
    $('eb-receipt-print-btn').addEventListener('click', printReceipt);
    $('eb-receipt-modal').addEventListener('click', e => { if (e.target.id === 'eb-receipt-modal') closeReceiptModal(); });

    $('eb-inv-refresh-btn').addEventListener('click', () => refreshInventoryStatus(true));

    $('eb-refund-open-btn').addEventListener('click', openRefundModal);
    $('eb-refund-close').addEventListener('click', closeRefundModal);
    $('eb-refund-find-btn').addEventListener('click', findRefundInvoice);
    $('eb-refund-invoice-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findRefundInvoice(); } });
    $('eb-refund-modal').addEventListener('click', e => { if (e.target.id === 'eb-refund-modal') closeRefundModal(); });

    // ── Tabs ──
    $('eb-tabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-eb-tab]');
      if (btn) ebSwitchTab(btn.dataset.ebTab);
    });

    // ── Billing History ──
    $('eb-hist-presets').addEventListener('click', e => {
      const btn = e.target.closest('.eb-hist-preset-btn');
      if (btn) applyHistoryPreset(btn.dataset.preset);
    });
    $('eb-hist-search-btn').addEventListener('click', () => {
      document.querySelectorAll('.eb-hist-preset-btn').forEach(b => b.classList.remove('active')); // a manual search no longer matches any preset
      runHistorySearch();
    });
    $('eb-hist-reset-btn').addEventListener('click', resetHistoryFilters);
    ['eb-hist-invoice', 'eb-hist-product', 'eb-hist-person'].forEach(id => {
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('eb-hist-search-btn').click(); } });
    });
    $('eb-history-detail-close').addEventListener('click', closeHistoryDetailModal);
    $('eb-history-detail-modal').addEventListener('click', e => { if (e.target.id === 'eb-history-detail-modal') closeHistoryDetailModal(); });

    // ── Settings ──
    $('eb-set-save-btn').addEventListener('click', saveSettingsFromForm);
    $('eb-set-reset-btn').addEventListener('click', resetSettingsToDefaults);

    document.addEventListener('keydown', onGlobalKeydown);
  }

  // ── Page-show hook — called from ui.js's showPage() ─────────────────
  function onShowEmergencyBilling() { init(); }
  // Bridge's post-checkout notify hook (see emergency-billing-bridge.js's
  // recordSale) — re-render in case another device/tab's sale affected
  // anything this page is showing. Cart/held bills are per-device
  // localStorage, so this mostly just re-renders what's already there.
  function onBridgeRefresh() { renderCart(); renderHeldBills(); renderReconciliation(); renderCoverBanner(true); renderInventoryStatus(); }

  window.ebOnShowEmergencyBilling = onShowEmergencyBilling;
  window.emergencyBillingNativeOnRefresh = onBridgeRefresh;
})();
