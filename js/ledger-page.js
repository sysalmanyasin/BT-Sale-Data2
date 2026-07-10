// ══════════════════════════════════════════════════════════════════════
// LEDGER PAGE  —  Floor 4/5 of the architecture
//
// Generalized UI for any ledger type — Expense, Jazz Cash (eventually),
// or any user-created "Other Section". One render function, reused for
// every ledger, instead of a bespoke build per feature. Pages only call
// into LedgerActions/LedgerStore, never touch Repository/localStorage
// directly — same rule as the rest of this app.
// ══════════════════════════════════════════════════════════════════════

import * as LedgerStore from './ledger-store.js';
import { LedgerActions } from './ledger-actions.js';

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _fmt(n) {
  return Math.round(Math.abs(n)).toLocaleString('en-PK');
}

// ── Ledger entry view (Expense, Jazz Cash, any custom section) ─────────
// `editingId`, if set, renders that one row as an inline edit form
// instead of a static row — same component drives Expense, Jazz Cash's
// Daily Ledger, and every custom "Other Section", so this one addition
// covers inline editing everywhere at once.
export function renderLedgerView(containerId, ledgerType, label, editingId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const categories = LedgerStore.getCategoryList(ledgerType);
  const entries = LedgerStore.getEntriesWithBalance(ledgerType);
  const balance = LedgerStore.getCurrentBalance(ledgerType);
  const opening = LedgerStore.getOpeningBalance(ledgerType);
  const showShift = LedgerStore.ledgerUsesShift(ledgerType);

  const catOptions = (selected) => categories.map(c =>
    `<option value="${_esc(c.id)}"${c.id === selected ? ' selected' : ''}>${c.icon || ''} ${_esc(c.label)}</option>`).join('');
  const shiftOptionsFor = (selected) => LedgerStore.SHIFTS.map(s =>
    `<option${s === selected ? ' selected' : ''}>${_esc(s)}</option>`).join('');

  const rows = entries.slice().reverse().map(e => {
    if (e.id === editingId) {
      return `<tr data-entry-id="${_esc(e.id)}" class="ledger-edit-row">
        <td><input type="date" class="ledger-edit-date" value="${_esc(e.date)}"></td>
        ${showShift ? `<td><select class="ledger-edit-shift">${shiftOptionsFor(e.shift)}</select></td>` : ''}
        <td><select class="ledger-edit-category">${catOptions(e.categoryId)}</select></td>
        <td><input type="text" class="ledger-edit-desc" value="${_esc(e.desc)}"></td>
        <td><input type="number" class="ledger-edit-amount" value="${e.amount}" min="0" step="0.01" style="width:90px"></td>
        <td>₨${_fmt(e._balance)}</td>
        <td style="white-space:nowrap">
          <button type="button" class="btn-icon ledger-save-btn" data-id="${_esc(e.id)}" title="Save">✓</button>
          <button type="button" class="btn-icon ledger-cancel-btn" title="Cancel">✕</button>
        </td>
      </tr>`;
    }
    const cat = categories.find(c => c.id === e.categoryId);
    const sign = cat ? cat.sign : -1;
    const signedLabel = (sign > 0 ? '+' : '−') + '₨' + _fmt(e.amount);
    const color = sign > 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
    return `<tr data-entry-id="${_esc(e.id)}" class="ledger-row-clickable">
      <td>${_esc(e.date)}</td>
      ${showShift ? `<td>${_esc(e.shift || '—')}</td>` : ''}
      <td>${cat ? _esc(cat.icon || '') + ' ' + _esc(cat.label) : '<em>unknown</em>'}</td>
      <td>${_esc(e.desc)}</td>
      <td style="color:${color};font-weight:600">${signedLabel}</td>
      <td>₨${_fmt(e._balance)}</td>
      <td style="white-space:nowrap">
        <button type="button" class="btn-icon ledger-edit-btn" data-id="${_esc(e.id)}" title="Edit">✎</button>
        <button type="button" class="btn-icon ledger-del-btn" data-id="${_esc(e.id)}" title="Delete">🗑</button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="ledger-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:10px;flex-wrap:wrap">
      <div><strong>${_esc(label || ledgerType)}</strong></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:var(--muted)">Opening ₨${_fmt(opening)}</span>
        <button type="button" class="btn ledger-opening-btn" style="font-size:11px;padding:4px 9px">⚙ Set Opening</button>
        <div style="font-size:18px;font-weight:700">₨${_fmt(balance)}</div>
      </div>
    </div>
    <form class="ledger-add-form" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <input type="date" class="ledger-date" required>
      ${showShift ? `<select class="ledger-shift">${shiftOptionsFor(null)}</select>` : ''}
      <select class="ledger-category" required>${catOptions(null)}</select>
      <input type="number" class="ledger-amount" placeholder="Amount" min="0" step="0.01" required style="width:110px">
      <input type="text" class="ledger-desc" placeholder="Description">
      <button type="submit" class="btn">+ Add</button>
    </form>
    <div class="ledger-table-wrap" style="max-height:420px;overflow:auto">
      <table class="ledger-table" style="width:100%">
        <thead><tr><th>Date</th>${showShift ? '<th>Shift</th>' : ''}<th>Category</th><th>Description</th><th>Amount</th><th>Balance</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${showShift ? 7 : 6}" style="text-align:center;color:var(--muted)">No entries yet</td></tr>`}</tbody>
      </table>
    </div>
  `;

  const openingBtn = container.querySelector('.ledger-opening-btn');
  openingBtn.addEventListener('click', () => {
    const v = prompt('Opening balance (current: ₨' + _fmt(opening) + '):', opening);
    if (v === null) return;
    const p = parseFloat(v);
    if (isNaN(p)) { if (typeof toast === 'function') toast('⚠ Invalid amount', 'w'); return; }
    LedgerStore.setOpeningBalance(ledgerType, p);
    renderLedgerView(containerId, ledgerType, label, editingId);
  });

  const form = container.querySelector('.ledger-add-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = form.querySelector('.ledger-date').value;
    const categoryId = form.querySelector('.ledger-category').value;
    const amount = form.querySelector('.ledger-amount').value;
    const desc = form.querySelector('.ledger-desc').value;
    const shiftEl = form.querySelector('.ledger-shift');
    const shift = shiftEl ? shiftEl.value : null;
    if (!date || !categoryId || !amount) return;
    try {
      LedgerActions.addEntry(ledgerType, { date, categoryId, amount, desc, shift });
      renderLedgerView(containerId, ledgerType, label); // re-render to show the new entry + updated balance
    } catch (err) {
      if (typeof toast === 'function') toast('⚠ ' + err.message, 'e');
    }
  });

  container.querySelectorAll('.ledger-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      LedgerActions.removeEntry(btn.dataset.id);
      renderLedgerView(containerId, ledgerType, label);
    });
  });

  container.querySelectorAll('.ledger-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderLedgerView(containerId, ledgerType, label, btn.dataset.id);
    });
  });

  const cancelBtn = container.querySelector('.ledger-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    renderLedgerView(containerId, ledgerType, label); // discard edits, re-render clean
  });

  const saveBtn = container.querySelector('.ledger-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const row = saveBtn.closest('tr');
    const date = row.querySelector('.ledger-edit-date').value;
    const categoryId = row.querySelector('.ledger-edit-category').value;
    const amount = row.querySelector('.ledger-edit-amount').value;
    const desc = row.querySelector('.ledger-edit-desc').value;
    const shiftEl = row.querySelector('.ledger-edit-shift');
    const shift = shiftEl ? shiftEl.value : undefined;
    if (!date || !categoryId || !amount) { if (typeof toast === 'function') toast('⚠ Date, category, and amount are required', 'w'); return; }
    try {
      const changes = { date, categoryId, amount, desc };
      if (shift !== undefined) changes.shift = shift;
      LedgerActions.updateEntry(saveBtn.dataset.id, changes);
      if (typeof toast === 'function') toast('✓ Entry updated', 's');
      renderLedgerView(containerId, ledgerType, label);
    } catch (err) {
      if (typeof toast === 'function') toast('⚠ ' + err.message, 'e');
    }
  });
}

// ── Other Sections manager (list + create new) ─────────────────────────
let _osOpenSection = null; // which custom section, if any, is currently being viewed

export function renderOtherSectionsManager(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (_osOpenSection) {
    const type = _osOpenSection;
    const allTypes = LedgerStore.getAllLedgerTypes();
    const meta = allTypes.find(t => t.id === type);
    container.innerHTML = `<button type="button" class="btn" id="os-back-btn" style="margin-bottom:10px">← Back to Sections</button><div id="os-ledger-view"></div>`;
    container.querySelector('#os-back-btn').addEventListener('click', () => {
      _osOpenSection = null;
      renderOtherSectionsManager(containerId);
    });
    renderLedgerView('os-ledger-view', type, meta ? meta.label : type);
    return;
  }

  const sections = LedgerStore.getAllLedgerTypes().filter(t => t.isCustom);
  const cards = sections.map(s => {
    const bal = LedgerStore.getCurrentBalance(s.id);
    return `<div class="ledger-section-card" data-type="${_esc(s.id)}" style="border:1px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <strong>${_esc(s.label)}</strong><span>₨${_fmt(bal)}</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="margin-bottom:14px">${cards || '<p style="color:var(--muted)">No sections yet — create one below.</p>'}</div>
    <button type="button" class="btn" id="os-create-btn">+ Create New Section</button>
    <div id="os-create-form" style="display:none;margin-top:14px;border:1px dashed var(--border);border-radius:10px;padding:14px">
      <input type="text" id="os-new-label" placeholder="Section name (e.g. Fuel Station)" style="width:100%;margin-bottom:8px">
      <div id="os-cat-rows"></div>
      <button type="button" class="btn" id="os-add-cat-row" style="margin:8px 0">+ Add category</button><br>
      <button type="button" class="btn" id="os-create-confirm">Create Section</button>
    </div>
  `;

  container.querySelectorAll('.ledger-section-card').forEach(card => {
    card.addEventListener('click', () => {
      _osOpenSection = card.dataset.type;
      renderOtherSectionsManager(containerId);
    });
  });

  const createBtn = container.querySelector('#os-create-btn');
  const form = container.querySelector('#os-create-form');
  const rowsWrap = container.querySelector('#os-cat-rows');

  function addCatRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    row.innerHTML = `<input type="text" placeholder="Category name" class="os-cat-name" style="flex:1">
      <select class="os-cat-sign"><option value="-1">Outflow (−)</option><option value="1">Inflow (+)</option></select>`;
    rowsWrap.appendChild(row);
  }

  createBtn.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (rowsWrap.children.length === 0) addCatRow();
  });
  container.querySelector('#os-add-cat-row').addEventListener('click', addCatRow);

  container.querySelector('#os-create-confirm').addEventListener('click', () => {
    const label = container.querySelector('#os-new-label').value.trim();
    if (!label) { if (typeof toast === 'function') toast('⚠ Section name required', 'w'); return; }
    const categories = Array.from(rowsWrap.children).map((row, i) => {
      const name = row.querySelector('.os-cat-name').value.trim();
      const sign = parseInt(row.querySelector('.os-cat-sign').value, 10);
      return name ? { id: 'cat' + i, label: name, sign, color: sign > 0 ? 'var(--green)' : 'var(--red)', icon: sign > 0 ? '⬆' : '⬇' } : null;
    }).filter(Boolean);
    if (!categories.length) { if (typeof toast === 'function') toast('⚠ At least one category required', 'w'); return; }
    const sectionId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('section' + Date.now());
    try {
      LedgerStore.createCustomLedgerType(sectionId, label, categories);
      if (typeof toast === 'function') toast('✓ Section created', 's');
      renderOtherSectionsManager(containerId);
    } catch (err) {
      if (typeof toast === 'function') toast('⚠ ' + err.message, 'e');
    }
  });
}

// Bridged, since these are called from manager.js's switchMgrTab (still
// a classic script) — not from generated onclick strings, so this is a
// plain, low-risk bridge, same reasoning as every other Floor 4/5 file
// this session.
window.renderLedgerView = renderLedgerView;
window.renderOtherSectionsManager = renderOtherSectionsManager;
