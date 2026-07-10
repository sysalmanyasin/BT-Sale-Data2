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

// ── Other Sections manager (list + create/edit/delete) ─────────────────
let _osOpenSection = null;  // which custom section, if any, is currently being viewed
let _osEditingSection = null; // which custom section, if any, is being renamed/re-categorized ('__new__' for the create form)

// Renders one row of the category editor (used by both the "create new
// section" form and the "edit section" form — same shape, so a bug fix
// or a look-and-feel change to one applies to both automatically).
function _catRowHtml(cat) {
  const name = cat ? _esc(cat.label) : '';
  const sign = cat ? cat.sign : -1;
  return `<div class="os-cat-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
    <input type="text" placeholder="Category name" class="os-cat-name" value="${name}" style="flex:1">
    <select class="os-cat-sign">
      <option value="-1"${sign === -1 ? ' selected' : ''}>Outflow (−)</option>
      <option value="1"${sign === 1 ? ' selected' : ''}>Inflow (+)</option>
    </select>
    <button type="button" class="btn-icon os-cat-remove" title="Remove category">🗑</button>
  </div>`;
}

// Shared read-back: turns the current rows in `rowsWrap` into a
// categories array, preserving each category's original `id` when one
// was supplied (editing) and minting a fresh one otherwise (creating) —
// preserving ids matters because existing entries reference categoryId,
// and renaming a category shouldn't orphan the entries already posted
// against it.
function _readCatRows(rowsWrap, existingCats) {
  return Array.from(rowsWrap.children).map((row, i) => {
    const name = row.querySelector('.os-cat-name').value.trim();
    const sign = parseInt(row.querySelector('.os-cat-sign').value, 10);
    if (!name) return null;
    const preservedId = row.dataset.catId || (existingCats && existingCats[i] && existingCats[i].id);
    return {
      id: preservedId || ('cat' + i + '_' + Date.now().toString(36)),
      label: name, sign,
      color: sign > 0 ? 'var(--green)' : 'var(--red)',
      icon: sign > 0 ? '⬆' : '⬇',
    };
  }).filter(Boolean);
}

function _wireCatRowsEditor(rowsWrap, addBtn) {
  function addRow(cat) {
    const row = document.createElement('div');
    row.innerHTML = _catRowHtml(cat);
    const inner = row.firstElementChild;
    if (cat && cat.id) inner.dataset.catId = cat.id;
    rowsWrap.appendChild(inner);
    inner.querySelector('.os-cat-remove').addEventListener('click', () => inner.remove());
  }
  addBtn.addEventListener('click', () => addRow(null));
  return addRow;
}

// One shared form builder for both "Create New Section" and "Edit
// Section" — `existing` is null for create, or {id, label, categories}
// for edit. Returns the form's outer HTML; caller wires up buttons.
function _sectionFormHtml(existing) {
  const label = existing ? _esc(existing.label) : '';
  return `
    <input type="text" class="os-form-label" placeholder="Section name (e.g. Fuel Station)" value="${label}" style="width:100%;margin-bottom:8px">
    <div class="os-cat-rows"></div>
    <button type="button" class="btn os-add-cat-row" style="margin:8px 0">+ Add category</button><br>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button type="button" class="btn os-form-save">${existing ? 'Save Changes' : 'Create Section'}</button>
      <button type="button" class="btn os-form-cancel">Cancel</button>
    </div>`;
}

function _wireSectionForm(formEl, existing, containerId, onSaved) {
  const rowsWrap = formEl.querySelector('.os-cat-rows');
  const addBtn = formEl.querySelector('.os-add-cat-row');
  const addRow = _wireCatRowsEditor(rowsWrap, addBtn);

  const existingCats = existing ? LedgerStore.getCategoryList(existing.id) : [];
  if (existingCats.length) existingCats.forEach(c => addRow(c));
  else addRow(null);

  formEl.querySelector('.os-form-cancel').addEventListener('click', () => {
    _osEditingSection = null;
    renderOtherSectionsManager(containerId);
  });

  formEl.querySelector('.os-form-save').addEventListener('click', () => {
    const labelInput = formEl.querySelector('.os-form-label').value.trim();
    if (!labelInput) { if (typeof toast === 'function') toast('⚠ Section name required', 'w'); return; }
    const categories = _readCatRows(rowsWrap, existingCats);
    if (!categories.length) { if (typeof toast === 'function') toast('⚠ At least one category required', 'w'); return; }
    try {
      if (existing) {
        LedgerActions.updateSection(existing.id, { label: labelInput, categories });
        if (typeof toast === 'function') toast('✓ Section updated', 's');
      } else {
        const sectionId = labelInput.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('section' + Date.now());
        LedgerActions.createSection(sectionId, labelInput, categories);
        if (typeof toast === 'function') toast('✓ Section created', 's');
      }
      _osEditingSection = null;
      onSaved();
    } catch (err) {
      if (typeof toast === 'function') toast('⚠ ' + err.message, 'e');
    }
  });
}

function _deleteSection(type, label, containerId, afterDelete) {
  const entryCount = LedgerStore.getEntries(type).length;
  const warn = entryCount > 0
    ? `Delete "${label}"? It still has ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} — deleting the section will permanently delete ${entryCount === 1 ? 'that entry' : 'all of them'} too. This cannot be undone.`
    : `Delete "${label}"? This cannot be undone.`;
  if (!confirm(warn)) return;
  try {
    LedgerActions.deleteSection(type, entryCount > 0);
    if (typeof toast === 'function') toast('✓ Section deleted', 's');
    afterDelete();
  } catch (err) {
    if (typeof toast === 'function') toast('⚠ ' + err.message, 'e');
  }
}

export function renderOtherSectionsManager(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // ── Editing a section's name/categories (create or edit) ─────────────
  if (_osEditingSection) {
    const type = _osEditingSection;
    const existing = type === '__new__' ? null : { id: type, label: (LedgerStore.getAllLedgerTypes().find(t => t.id === type) || {}).label || type };
    container.innerHTML = `<div style="border:1px dashed var(--border);border-radius:10px;padding:14px">${_sectionFormHtml(existing)}</div>`;
    _wireSectionForm(container.querySelector('div'), existing, containerId, () => renderOtherSectionsManager(containerId));
    return;
  }

  // ── Viewing one section's ledger ──────────────────────────────────────
  if (_osOpenSection) {
    const type = _osOpenSection;
    const allTypes = LedgerStore.getAllLedgerTypes();
    const meta = allTypes.find(t => t.id === type);
    const label = meta ? meta.label : type;
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <button type="button" class="btn" id="os-back-btn">← Back to Sections</button>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn" id="os-edit-open-btn">✎ Edit Section</button>
          <button type="button" class="btn" id="os-del-open-btn">🗑 Delete Section</button>
        </div>
      </div>
      <div id="os-ledger-view"></div>`;
    container.querySelector('#os-back-btn').addEventListener('click', () => {
      _osOpenSection = null;
      renderOtherSectionsManager(containerId);
    });
    container.querySelector('#os-edit-open-btn').addEventListener('click', () => {
      _osEditingSection = type;
      _osOpenSection = null;
      renderOtherSectionsManager(containerId);
    });
    container.querySelector('#os-del-open-btn').addEventListener('click', () => {
      _deleteSection(type, label, containerId, () => { _osOpenSection = null; renderOtherSectionsManager(containerId); });
    });
    renderLedgerView('os-ledger-view', type, label);
    return;
  }

  // ── Section list ───────────────────────────────────────────────────────
  const sections = LedgerStore.getAllLedgerTypes().filter(t => t.isCustom);
  const cards = sections.map(s => {
    const bal = LedgerStore.getCurrentBalance(s.id);
    return `<div class="ledger-section-card" data-type="${_esc(s.id)}" style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <strong class="os-card-open" data-type="${_esc(s.id)}" style="cursor:pointer;flex:1">${_esc(s.label)}</strong>
      <span>₨${_fmt(bal)}</span>
      <span style="display:flex;gap:4px">
        <button type="button" class="btn-icon os-card-edit" data-type="${_esc(s.id)}" title="Edit section">✎</button>
        <button type="button" class="btn-icon os-card-delete" data-type="${_esc(s.id)}" data-label="${_esc(s.label)}" title="Delete section">🗑</button>
      </span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="margin-bottom:14px">${cards || '<p style="color:var(--muted)">No sections yet — create one below.</p>'}</div>
    <button type="button" class="btn" id="os-create-btn">+ Create New Section</button>
  `;

  container.querySelectorAll('.os-card-open').forEach(el => {
    el.addEventListener('click', () => {
      _osOpenSection = el.dataset.type;
      renderOtherSectionsManager(containerId);
    });
  });
  container.querySelectorAll('.os-card-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _osEditingSection = btn.dataset.type;
      renderOtherSectionsManager(containerId);
    });
  });
  container.querySelectorAll('.os-card-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _deleteSection(btn.dataset.type, btn.dataset.label, containerId, () => renderOtherSectionsManager(containerId));
    });
  });

  container.querySelector('#os-create-btn').addEventListener('click', () => {
    _osEditingSection = '__new__';
    renderOtherSectionsManager(containerId);
  });
}

// Bridged, since these are called from manager.js's switchMgrTab (still
// a classic script) — not from generated onclick strings, so this is a
// plain, low-risk bridge, same reasoning as every other Floor 4/5 file
// this session.
window.renderLedgerView = renderLedgerView;
window.renderOtherSectionsManager = renderOtherSectionsManager;
