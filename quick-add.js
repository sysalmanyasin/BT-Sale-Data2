// ══════════════════════════════════════════════════════════════════
// QUICK ADD — one widget, four destinations (Jazz Cash / Staff Credit /
// Expenses / New Sections), reusable across pages.
//
// renderQuickAdd(containerId) can be called once per container, so the
// same widget can live in more than one place (Manager page, Cover's
// Manager group, ...) without element-ID collisions — same containerId
// pattern ledger-page.js's renderLedgerView() already uses elsewhere in
// this app. Every field is looked up with container.querySelector(...),
// never a fixed document-wide id.
//
// This never introduces a new data store. Jazz Cash / Expenses / New
// Sections all already run on the shared Ledger (LedgerActions.addEntry,
// from ledger-actions.js) — this widget just calls that same door.
// Staff Credit predates the Ledger and still lives in manager.js's
// _crdData_cur array; this widget writes into that same array through
// manager.js's own bridged functions (renderCreditLedger, saveCreditData),
// never by touching storage directly.
//
// Loaded (defer) after manager.js, jazz-cash.js and ledger-page.js, so
// everything it calls already exists on window by the time a person can
// interact with it.
// ══════════════════════════════════════════════════════════════════

function _qaToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Staff Credit's own entries use "15-Jul-2026", not the <input type=date>
// value ("2026-07-15") — convert so a Quick-Add credit entry looks the
// same as one typed directly into the Staff Credits tab.
function _qaCrdDate(isoVal) {
  const d = isoVal ? new Date(isoVal + 'T00:00:00') : new Date();
  const ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + ms[d.getMonth()] + '-' + d.getFullYear();
}

function _qaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Staff Credit's data only loads once the Manager page has run
// loadManagerPage() at least once this session. If this widget is used
// from somewhere else (e.g. Cover) before that's happened, prime it
// quietly first — loadManagerPage() only touches Manager's own DOM
// elements, which exist in the page regardless of which page is
// currently visible, so this is safe to call from anywhere.
let _qaCreditPrimed = false;
function _qaEnsureCreditLoaded() {
  if (_qaCreditPrimed) return;
  if (window._crdData_cur && window._crdData_cur.length) { _qaCreditPrimed = true; return; }
  if (typeof loadManagerPage === 'function') { loadManagerPage(); }
  _qaCreditPrimed = true;
}

function renderQuickAdd(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="background:var(--surface,#fff);border:1.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:18px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px;white-space:nowrap">⚡ Quick Add</div>
        <select class="qa-type mgr-inp" style="max-width:220px">
          <option value="jazzcash">📒 Jazz Cash</option>
          <option value="credit">👥 Staff Credit</option>
          <option value="expense">🧾 Expenses / Patty</option>
          <option value="custom">＋ New Section</option>
        </select>
      </div>
      <div class="qa-fields"></div>
    </div>`;

  const typeSel = container.querySelector('.qa-type');
  const fieldsWrap = container.querySelector('.qa-fields');

  function renderFields() {
    const type = typeSel.value;

    // Jazz Cash and Expenses are both plain Ledger entries — same fields.
    if (type === 'jazzcash' || type === 'expense') {
      const ledgerType = type;
      const label = type === 'jazzcash' ? '📒 Jazz Cash' : '🧾 Expenses';
      const cats = (typeof LedgerStore !== 'undefined') ? LedgerStore.getCategoryList(ledgerType) : [];
      const showShift = (typeof LedgerStore !== 'undefined') && LedgerStore.ledgerUsesShift(ledgerType);
      fieldsWrap.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="date" class="qa-date mgr-inp" style="width:150px" value="${_qaToday()}">
          ${showShift ? `<select class="qa-shift mgr-inp" style="width:110px">
            ${LedgerStore.SHIFTS.map(s => `<option>${_qaEsc(s)}</option>`).join('')}
          </select>` : ''}
          <select class="qa-cat mgr-inp" style="width:170px">
            ${cats.map(c => `<option value="${_qaEsc(c.id)}">${c.icon || ''} ${_qaEsc(c.label)}</option>`).join('')}
          </select>
          <input type="number" class="qa-amount mgr-inp" style="width:110px" placeholder="Amount" min="0" step="0.01">
          <input type="text" class="qa-desc mgr-inp" style="width:170px" placeholder="Description">
          <button type="button" class="btn btn-p qa-submit" style="font-size:12px;padding:7px 16px">+ Add</button>
        </div>`;
      fieldsWrap.querySelector('.qa-submit').addEventListener('click', () => qaSubmitLedger(container, ledgerType, label));
      return;
    }

    if (type === 'credit') {
      _qaEnsureCreditLoaded();
      const staff = (window._crdData_cur || []).map((e, i) => `<option value="${i}">${_qaEsc(e.name)}</option>`);
      fieldsWrap.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="qa-crd-emp mgr-inp" style="width:170px">
            ${staff.length ? staff.join('') : '<option value="">No staff yet</option>'}
          </select>
          <input type="date" class="qa-date mgr-inp" style="width:150px" value="${_qaToday()}">
          <input type="text" class="qa-desc mgr-inp" style="width:170px" placeholder="Description (credit/deduction/…)">
          <input type="number" class="qa-amount mgr-inp" style="width:130px" placeholder="Amount (−ve = deduction)">
          <button type="button" class="btn btn-p qa-submit" style="font-size:12px;padding:7px 16px">+ Add</button>
        </div>`;
      fieldsWrap.querySelector('.qa-submit').addEventListener('click', () => qaSubmitCredit(container));
      return;
    }

    if (type === 'custom') {
      const all = (typeof LedgerStore !== 'undefined') ? LedgerStore.getAllLedgerTypes() : [];
      const sections = all.filter(t => t.isCustom);
      if (!sections.length) {
        fieldsWrap.innerHTML = `
          <div style="font-size:12px;color:var(--muted)">
            No custom sections yet — <a href="#manager/custom" style="color:var(--accent);font-weight:600">create one in "＋ C. New Sections"</a> first, then it'll show up here.
          </div>`;
        return;
      }
      fieldsWrap.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="qa-custom-section mgr-inp" style="width:170px">
            ${sections.map(s => `<option value="${_qaEsc(s.id)}">${_qaEsc(s.label)}</option>`).join('')}
          </select>
          <input type="date" class="qa-date mgr-inp" style="width:150px" value="${_qaToday()}">
          <select class="qa-cat mgr-inp" style="width:170px"></select>
          <input type="number" class="qa-amount mgr-inp" style="width:110px" placeholder="Amount" min="0" step="0.01">
          <input type="text" class="qa-desc mgr-inp" style="width:170px" placeholder="Description">
          <button type="button" class="btn btn-p qa-submit" style="font-size:12px;padding:7px 16px">+ Add</button>
        </div>`;
      const sectionSel = fieldsWrap.querySelector('.qa-custom-section');
      const catSel = fieldsWrap.querySelector('.qa-cat');
      const fillCats = () => {
        const cats = LedgerStore.getCategoryList(sectionSel.value);
        catSel.innerHTML = cats.map(c => `<option value="${_qaEsc(c.id)}">${c.icon || ''} ${_qaEsc(c.label)}</option>`).join('');
      };
      sectionSel.addEventListener('change', fillCats);
      fillCats();
      fieldsWrap.querySelector('.qa-submit').addEventListener('click', () => qaSubmitCustom(container));
      return;
    }
  }

  typeSel.addEventListener('change', renderFields);
  renderFields();
}

// ── Submit handlers — each takes the container so multiple instances of
// this widget (Manager page, Cover page, ...) never step on each other. ──

function qaSubmitLedger(container, ledgerType, label) {
  const date = container.querySelector('.qa-date').value;
  const shiftEl = container.querySelector('.qa-shift');
  const categoryId = container.querySelector('.qa-cat').value;
  const amount = container.querySelector('.qa-amount').value;
  const desc = container.querySelector('.qa-desc').value;
  if (!date || !categoryId || !amount) { toast('⚠ Date, category, and amount are required', 'w'); return; }
  try {
    LedgerActions.addEntry(ledgerType, { date, categoryId, amount, desc, shift: shiftEl ? shiftEl.value : null });
    toast('✓ Added to ' + label);
    container.querySelector('.qa-amount').value = '';
    container.querySelector('.qa-desc').value = '';
    // Refresh that tab's own view too, in case it's already open.
    if (ledgerType === 'jazzcash' && document.getElementById('jc-ledger-inner')) {
      renderLedgerView('jc-ledger-inner', 'jazzcash', '📒 Jazz Cash');
    }
    if (ledgerType === 'expense' && document.getElementById('ledger-expense-container')) {
      renderLedgerView('ledger-expense-container', 'expense', 'Expense');
    }
  } catch (err) {
    toast('⚠ ' + err.message, 'e');
  }
}

function qaSubmitCustom(container) {
  const ledgerType = container.querySelector('.qa-custom-section').value;
  const date = container.querySelector('.qa-date').value;
  const categoryId = container.querySelector('.qa-cat').value;
  const amount = container.querySelector('.qa-amount').value;
  const desc = container.querySelector('.qa-desc').value;
  if (!ledgerType || !date || !categoryId || !amount) { toast('⚠ Date, category, and amount are required', 'w'); return; }
  try {
    LedgerActions.addEntry(ledgerType, { date, categoryId, amount, desc });
    toast('✓ Added');
    container.querySelector('.qa-amount').value = '';
    container.querySelector('.qa-desc').value = '';
    if (document.getElementById('ledger-sections-container') && typeof renderOtherSectionsManager === 'function') {
      renderOtherSectionsManager('ledger-sections-container');
    }
  } catch (err) {
    toast('⚠ ' + err.message, 'e');
  }
}

function qaSubmitCredit(container) {
  const empSel = container.querySelector('.qa-crd-emp');
  const ei = empSel ? parseInt(empSel.value, 10) : NaN;
  const date = container.querySelector('.qa-date').value;
  const desc = container.querySelector('.qa-desc').value;
  const amount = container.querySelector('.qa-amount').value;
  if (isNaN(ei) || !window._crdData_cur || !window._crdData_cur[ei]) { toast('⚠ Pick a staff member first', 'w'); return; }
  if (!amount) { toast('⚠ Amount is required', 'w'); return; }
  window._crdData_cur[ei].entries.push({
    date: _qaCrdDate(date),
    desc: desc || 'credit',
    amount: parseFloat(amount) || 0,
  });
  if (typeof renderCreditLedger === 'function') renderCreditLedger(window._crdData_cur);
  if (typeof saveCreditData === 'function') saveCreditData(); // also toasts + syncs, same as the Credits tab's own Save
  container.querySelector('.qa-amount').value = '';
  container.querySelector('.qa-desc').value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  // Manager page's copy is static markup, present from the start.
  if (document.getElementById('qa-panel-mgr')) renderQuickAdd('qa-panel-mgr');
  // Cover page's copy lives inside cover-dashboard.js's own render cycle
  // (its container is rebuilt every time Cover is shown) — see the
  // renderQuickAdd('qa-panel-cover') call added there.
});
