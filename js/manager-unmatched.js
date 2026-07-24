// ══════════════════════════════════════════════════════════════════════
// MANAGER — UNMATCHED TAB  (ES module, split from manager.js)
//
// Entries the sibling Closing app couldn't confidently match to a real
// staff member or expense category land here (via bt_inbox_unmatched)
// so the money is always accounted for immediately. Resolving an entry
// moves it into the real Staff Credit or Expense ledger through the
// same functions a manual entry would use, then removes it from here.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { STAFF } from './config.js';
import { activeStaff } from './manager-staff.js';
import { _crdData } from './manager-credit.js';

// UNMATCHED — entries Closing App couldn't confidently match to a
// real staff member or expense category. Landed here (via
// bt_inbox_unmatched → payload.unmatched) so the money is always
// accounted for immediately; resolving moves it into the real Staff
// Credit or Expense ledger through the same functions a manual entry
// would use, then removes it from this list.
// ══════════════════════════════════════════════════════════════════
const UNMATCHED_KEY = 'bt_unmatched_v1';

function unmatchedLoad() {
  try { return JSON.parse(Repository.getItem(UNMATCHED_KEY) || '{"entries":[]}'); }
  catch (_) { return { entries: [] }; }
}
function unmatchedSave(data) { return Actions.saveFeatureData(UNMATCHED_KEY, JSON.stringify(data)); }

function _monthLabelFromDate(dateStr) {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return names[d.getMonth()] + ' ' + d.getFullYear();
}

function renderUnmatchedTab() {
  const data = unmatchedLoad();
  const box = document.getElementById('unmatched-list');
  if (!box) return;
  const entries = (data.entries || []).filter(e => !e.resolved);
  if (!entries.length) {
    box.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px">Nothing waiting for review. ✅</p>';
    return;
  }
  const staffOptions = activeStaff().map(e =>
    `<option value="${e.staffId}">${e.name}</option>`).join('');
  const EXPENSE_CATS = [
    ['bill','Bill Amount'], ['fuel','Fuel/HO'], ['soap','Soap/Tissue'],
    ['refresh','Refreshment'], ['extra','Extra'], ['guardIncentive','Guard Incentive'],
    ['pattyHO','Patty H/O (received)']
  ];
  const catOptions = EXPENSE_CATS.map(([id,label]) => `<option value="${id}">${label}</option>`).join('');

  box.innerHTML = entries.map(e => `
    <div class="mgr-card" style="margin-bottom:10px;padding:12px;border:1px solid var(--border);border-radius:8px">
      <div style="display:flex;justify-content:space-between;font-weight:600">
        <span>${e.kind === 'staffCredit' ? '👤 Staff Credit' : '🧾 Expense'} — "${e.rawLabel}"</span>
        <span style="color:var(--red)">Rs ${Number(e.amount||0).toLocaleString('en-PK')}</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin:4px 0 8px">${e.date}${e.shift ? ' · ' + e.shift : ''}${e.desc ? ' · ' + e.desc : ''} · from Closing App</div>
      ${e.kind === 'staffCredit' ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select id="unm-staff-${e.id}" style="flex:1;min-width:140px">${staffOptions}</select>
          <button class="btn btn-p btn-sm" onclick="resolveUnmatchedToStaff('${e.id}')">Assign to staff</button>
        </div>` : `
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select id="unm-cat-${e.id}" style="flex:1;min-width:140px">${catOptions}</select>
          <button class="btn btn-p btn-sm" onclick="resolveUnmatchedToCategory('${e.id}')">Assign to category</button>
        </div>`}
      <div style="text-align:right;margin-top:6px">
        <button class="btn btn-sm" style="color:var(--red)" onclick="dismissUnmatched('${e.id}')">Dismiss (no ledger entry)</button>
      </div>
    </div>
  `).join('');
}

function resolveUnmatchedToStaff(id) {
  const data = unmatchedLoad();
  const entry = (data.entries || []).find(e => e.id === id);
  if (!entry) return;
  const staffId = document.getElementById('unm-staff-' + id)?.value;
  if (!staffId) { toast('⚠ Pick a staff member first', 'w'); return; }

  const my = _monthLabelFromDate(entry.date);
  const mgrData = mgrLoad();
  if (!mgrData.credit) mgrData.credit = {};
  if (!mgrData.credit[my]) mgrData.credit[my] = _crdData(my);

  const emp = STAFF.find(s => s.staffId === staffId);
  let row = mgrData.credit[my].find(r => r.staffId === staffId);
  if (!row) {
    row = { staffId, name: emp?.name || staffId, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 };
    mgrData.credit[my].push(row);
  }
  row.entries.push({ date: entry.date, desc: entry.desc || `From Closing App (${entry.rawLabel})`, amount: entry.amount, source: 'closing_app' });
  mgrSave(mgrData);

  entry.resolved = true;
  unmatchedSave(data);
  toast('✓ Assigned to ' + (emp?.name || staffId));
  renderUnmatchedTab();
  if (typeof loadCreditMonth === 'function') loadCreditMonth(document.getElementById('crd-month-sel')?.value || my);
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function resolveUnmatchedToCategory(id) {
  const data = unmatchedLoad();
  const entry = (data.entries || []).find(e => e.id === id);
  if (!entry) return;
  const categoryId = document.getElementById('unm-cat-' + id)?.value;
  if (!categoryId) { toast('⚠ Pick a category first', 'w'); return; }
  if (typeof window.LedgerActions?.addEntry !== 'function') { toast('⚠ Ledger not available.', 'w'); return; }

  window.LedgerActions.addEntry('expense', {
    date: entry.date, categoryId, amount: entry.amount,
    desc: entry.desc || '', groupLabel: entry.rawLabel, source: 'closing_app'
  });

  entry.resolved = true;
  unmatchedSave(data);
  toast('✓ Posted to Expense');
  renderUnmatchedTab();
  if (typeof renderLedgerView === 'function') renderLedgerView('ledger-expense-container', 'expense', 'Expense');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function dismissUnmatched(id) {
  if (!confirm('Dismiss this entry without adding it to any ledger?\n\nThe amount will NOT be reflected anywhere in BT Sale Data — only do this if you\'re sure it was a mistake or duplicate.')) return;
  const data = unmatchedLoad();
  const entry = (data.entries || []).find(e => e.id === id);
  if (entry) entry.resolved = true;
  unmatchedSave(data);
  toast('Dismissed.');
  renderUnmatchedTab();
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}


Object.assign(window, {
  renderUnmatchedTab, resolveUnmatchedToStaff, resolveUnmatchedToCategory, dismissUnmatched,
});

export {
  renderUnmatchedTab, resolveUnmatchedToStaff, resolveUnmatchedToCategory, dismissUnmatched,
};
