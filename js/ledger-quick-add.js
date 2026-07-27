// ══════════════════════════════════════════════════════════════════════
// LEDGER QUICK ADD
//
// A one-tap-to-open add-entry modal, launched from a Closing Credit
// Ledger row (closing-native.js). Date, shift, amount, and description
// arrive pre-filled from the row that opened it — every one of those is
// an objective fact about the row, so pre-filling it just saves retyping.
//
// Ledger and Category are DELIBERATELY left blank every time. Which real
// BT account a Closing row belongs to is a judgment call, not a fact —
// guessing that automatically is exactly the old auto-sync/inbox model
// that was removed on request (see bt-bridge.js's header). So this modal
// never pre-selects a ledger, never pre-selects a category, and never
// writes anything until Save is tapped. Cancel writes nothing at all.
//
// On Save:
//   1. LedgerActions.addEntry() — same door every other manual entry in
//      the app uses, tagged source:'closing_app' so it carries the
//      existing 📱 Closing badge (ledger-page.js already renders this
//      for any entry with that source — no change needed there).
//   2. A receipt row is upserted into bt_closing_ledger_marks (see
//      closing-ledger-marks.js) so the Closing row this came from shows
//      a ✓ Added badge instead of "+ Ledger" next time.
// ══════════════════════════════════════════════════════════════════════

import { LedgerActions } from './ledger-actions.js';
import { getAllLedgerTypes, getCategoryList, ledgerUsesShift } from './ledger-store.js';
import { saveMark } from './closing-ledger-marks.js';

// getAllLedgerTypes() labels built-ins with their raw id (e.g. "jazzcash")
// — accurate but not what you'd want to read in a picker. Purely
// cosmetic override for the known built-ins; anything else (custom
// "Other Sections") already carries a real human label from LedgerStore.
const BUILTIN_DISPLAY_NAMES = { jazzcash: 'Jazz Cash', petty: 'Patty / Expenses', expense: 'Expense' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let _onSaved = null;

export function openLedgerQuickAdd(prefill, onSaved) {
  _onSaved = onSaved || null;
  document.getElementById('lqa-overlay')?.remove();

  const types = getAllLedgerTypes(); // live — built-in + every custom "Other Section", never hardcoded here
  const typeOptions = '<option value="">Choose ledger…</option>' +
    types.map(t => `<option value="${esc(t.id)}">${esc(BUILTIN_DISPLAY_NAMES[t.id] || t.label)}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'lqa-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--s1,#fff);width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:16px;max-height:88vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:800;font-size:15px;color:var(--text,#111);">➕ Add to Ledger</div>
        <button type="button" id="lqa-close" style="border:none;background:none;font-size:20px;color:var(--muted,#888);line-height:1;">✕</button>
      </div>
      <div style="font-size:11px;color:var(--muted,#888);margin-bottom:12px;">From Closing — pick the ledger and category yourself, everything else is already filled in and editable.</div>

      <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Ledger</label>
      <select id="lqa-ledger" style="width:100%;padding:9px;margin:4px 0 10px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);">${typeOptions}</select>

      <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Category</label>
      <select id="lqa-category" style="width:100%;padding:9px;margin:4px 0 10px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);"><option value="">Choose ledger first…</option></select>

      <div style="display:flex;gap:8px;">
        <div style="flex:1;">
          <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Date</label>
          <input id="lqa-date" type="date" value="${esc(prefill.date || '')}" style="width:100%;padding:9px;margin:4px 0 10px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);">
        </div>
        <div id="lqa-shift-wrap" style="flex:1;">
          <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Shift</label>
          <select id="lqa-shift" style="width:100%;padding:9px;margin:4px 0 10px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);">
            ${['Morning', 'Evening', 'Night'].map(s => `<option value="${s}" ${s === prefill.shift ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>

      <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Amount</label>
      <input id="lqa-amount" type="number" step="0.01" value="${esc(prefill.amount ?? '')}" style="width:100%;padding:9px;margin:4px 0 10px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);">

      <label style="font-size:11px;font-weight:700;color:var(--muted,#888);">Description</label>
      <textarea id="lqa-desc" rows="2" style="width:100%;padding:9px;margin:4px 0 14px;border-radius:8px;border:1px solid var(--border,#ddd);background:var(--s2,#fff);color:var(--text,#111);">${esc(prefill.desc || '')}</textarea>

      <div style="display:flex;gap:10px;">
        <button type="button" id="lqa-cancel" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border,#ddd);background:var(--s2,#f4f4f5);color:var(--text,#111);font-weight:700;">Cancel</button>
        <button type="button" id="lqa-save" style="flex:1.4;padding:11px;border-radius:9px;border:none;background:var(--teal,#0d9488);color:#fff;font-weight:800;">💾 Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const ledgerSel = overlay.querySelector('#lqa-ledger');
  const catSel = overlay.querySelector('#lqa-category');
  const shiftWrap = overlay.querySelector('#lqa-shift-wrap');

  function refreshCategories() {
    const lt = ledgerSel.value;
    if (!lt) {
      catSel.innerHTML = '<option value="">Choose ledger first…</option>';
      shiftWrap.style.display = 'none';
      return;
    }
    const cats = getCategoryList(lt) || [];
    catSel.innerHTML = '<option value="">Choose category…</option>' +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
    shiftWrap.style.display = ledgerUsesShift(lt) ? '' : 'none';
  }
  ledgerSel.addEventListener('change', refreshCategories);
  refreshCategories();

  const close = () => overlay.remove();
  overlay.querySelector('#lqa-close').addEventListener('click', close);
  overlay.querySelector('#lqa-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#lqa-save').addEventListener('click', async () => {
    const ledgerType = ledgerSel.value;
    const categoryId = catSel.value;
    const date = overlay.querySelector('#lqa-date').value;
    const shift = shiftWrap.style.display !== 'none' ? overlay.querySelector('#lqa-shift').value : null;
    const amount = overlay.querySelector('#lqa-amount').value;
    const desc = overlay.querySelector('#lqa-desc').value;

    const fail = (msg) => { if (typeof toast === 'function') toast('⚠ ' + msg, 'e'); };
    if (!ledgerType) return fail('Pick a ledger');
    if (!categoryId) return fail('Pick a category');
    if (!date) return fail('Pick a date');
    if (!amount || Math.abs(parseFloat(amount)) <= 0) return fail('Enter an amount');

    const saveBtn = overlay.querySelector('#lqa-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const entry = LedgerActions.addEntry(ledgerType, { date, categoryId, amount, desc, shift, source: 'closing_app' });
      if (typeof window.pushToSupabase === 'function') window.pushToSupabase(); // pushes the real ledger entry, same as every other manual add in the app

      if (prefill.rowKey) {
        try {
          await saveMark({ rowKey: prefill.rowKey, ledgerType, entryId: entry.id, amount: entry.amount, description: desc });
        } catch (markErr) {
          // The real ledger entry above DID save — only the "already added"
          // receipt failed. Don't roll anything back or block the user;
          // just say so, since the row may still show "+ Ledger" elsewhere
          // until this is retried (tapping it again just adds a second
          // entry, so surfacing this clearly matters).
          console.warn('ledger-quick-add: mark save failed (entry itself saved fine) —', markErr.message);
          if (typeof toast === 'function') toast('✓ Added — but the "already added" marker failed to save, the row may still show + Ledger', 'w');
          close();
          if (typeof _onSaved === 'function') _onSaved();
          return;
        }
      }
      if (typeof toast === 'function') toast('✓ Added to Ledger');
      close();
      if (typeof _onSaved === 'function') _onSaved();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Save';
      fail(err.message);
    }
  });
}

// Bridged for consistency with the rest of the app's classic-script
// consumers, even though closing-native.js (the only current caller)
// uses the real import.
window.LedgerQuickAdd = { open: openLedgerQuickAdd };
