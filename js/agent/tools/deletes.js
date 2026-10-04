// DELETE tools. The riskiest thing the assistant can do, so:
//   - every delete is `critical` (strong confirm) AND needs the person to TYPE "DELETE"
//     (enforced in runTool: a bare tap/true is rejected),
//   - the model must name the exact record it read first (id / date + expected value);
//     a stale or wrong target is caught in preview(), before any card is shown,
//   - nothing is bulk: one record per call; no staff, month, ledger-section or credit-row deletes,
//   - each delete is undoable for the session by restoring the saved copy.
import { registerTool } from '../core/tool-registry.js';
import { rsFmt, isoToApp } from '../core/guard.js';
import { afterWrite } from '../core/after-write.js';
import { Repository } from '../../repository.js';
import { Actions } from '../../actions.js';
import { LedgerActions } from '../../ledger-actions.js';
import * as LedgerStore from '../../ledger-store.js';
import { getNotes, keyForStaff } from '../../staff-notes.js';
import { DAILY, MONTHLY } from '../../config.js';
import { num, normDay, sameMonth, normMonth } from './_util.js';
import { staffCandidates, findCreditRow, normName } from './_names.js';

const CONFIRM = 'DELETE';
const lc = s => String(s || '').trim().toLowerCase();
const ni = v => Math.round(Number(v) || 0);
const clone = o => JSON.parse(JSON.stringify(o));
const NOTES_KEY = 'bt_staff_notes_v1';
const MGR_KEY = 'BT_ManagerWork_v1';

// ── Ledger entry ─────────────────────────────────────────────────────
function findLedgerEntry(id) {
  for (const t of LedgerStore.getAllLedgerTypes()) {
    const e = LedgerStore.getEntries(t.id).find(x => x.id === id);
    if (e) return { t, e };
  }
  throw new Error('No ledger entry with id "' + id + '". Read it first with get_ledger_entries (each entry has an id).');
}

registerTool({
  name: 'delete_ledger_entry', domain: 'manager', risk: 'critical', sensitive: true,
  description: 'Permanently delete ONE ledger entry by its id (get the id from get_ledger_entries). The user must type DELETE to confirm. Cannot delete several at once.',
  parameters: { type: 'object', required: ['entry_id'], properties: { entry_id: { type: 'string' } } },
  preview: ({ entry_id }) => {
    const { t, e } = findLedgerEntry(entry_id);
    const c = LedgerStore.getCategory(t.id, e.categoryId);
    const before = LedgerStore.getCurrentBalance(t.id);
    const after = before - (c && c.sign ? c.sign : 0) * num(e.amount);
    return { title: 'Delete ledger entry', confirmWord: CONFIRM,
      lines: ['Ledger: ' + t.label, 'Date: ' + (/^\d{4}-\d{2}-\d{2}$/.test(e.date) ? isoToApp(e.date) : e.date), 'Category: ' + (c ? c.label : e.categoryId), 'Amount: ' + rsFmt(e.amount), e.desc ? 'Note: ' + e.desc : null, 'Balance: ' + rsFmt(before) + ' → ' + rsFmt(after)].filter(Boolean),
      warnings: ['This permanently removes the entry.'] };
  },
  run: ({ entry_id }) => {
    const { t, e } = findLedgerEntry(entry_id);
    const saved = clone(e);
    LedgerActions.removeEntry(entry_id);
    afterWrite();
    return { summary: 'Deleted ' + rsFmt(saved.amount) + ' entry from ' + t.label, ledger: t.id, saved };
  },
  makeUndo: (args, out) => ({ label: 'Restore ledger entry (' + rsFmt(out.saved.amount) + ')', fn: () => {
    LedgerActions.addEntry(out.ledger, { date: out.saved.date, categoryId: out.saved.categoryId, amount: out.saved.amount, desc: out.saved.desc, groupLabel: out.saved.groupLabel, shift: out.saved.shift, source: out.saved.source });
    afterWrite();
  } }),
});

// ── Staff note ───────────────────────────────────────────────────────
const readNotes = () => { try { const v = JSON.parse(Repository.getItem(NOTES_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { throw new Error('Stored notes could not be read, so nothing was changed.'); } };

function staffByKey(key) { return Repository.getStaff().find(e => keyForStaff(e) === key) || null; }

registerTool({
  name: 'get_staff_notes', domain: 'manager', risk: 'read', sensitive: true,
  description: 'Read the notes on one staff member\'s card (each has an id, needed for delete_staff_note).',
  parameters: { type: 'object', required: ['staff'], properties: { staff: { type: 'string', description: 'name or id like EMP-003' } } },
  run: ({ staff }) => {
    const list = staffCandidates(staff);
    if (!list.length) return { error: 'No staff member matches "' + staff + '".' };
    if (list.length > 1) return { error: 'Several staff match: ' + list.slice(0, 5).map(e => String(e.name).trim() + ' (' + e.staffId + ')').join(', ') };
    const emp = list[0];
    return { staff: emp.name, notes: getNotes(keyForStaff(emp)).slice(0, 20).map(n => ({ id: n.id, at: n.ts, text: n.text })) };
  },
});

function findNote(id) {
  const n = readNotes().find(x => x.id === id);
  if (!n) throw new Error('No note with id "' + id + '". Read the notes first with get_staff_notes.');
  return n;
}

registerTool({
  name: 'delete_staff_note', domain: 'manager', risk: 'critical', sensitive: true,
  description: 'Permanently delete ONE staff note by id (from get_staff_notes). The user must type DELETE to confirm.',
  parameters: { type: 'object', required: ['note_id'], properties: { note_id: { type: 'string' } } },
  preview: ({ note_id }) => {
    const n = findNote(note_id); const emp = staffByKey(n.staffKey);
    return { title: 'Delete staff note', confirmWord: CONFIRM, lines: ['Staff: ' + (emp ? emp.name : n.staffKey), 'Note: ' + n.text.slice(0, 300), 'Written: ' + n.ts], warnings: ['This permanently removes the note.'] };
  },
  run: ({ note_id }) => {
    const n = findNote(note_id);
    Actions.saveStaffNotes(JSON.stringify(readNotes().filter(x => x.id !== note_id)));
    afterWrite();
    return { summary: 'Deleted a staff note', saved: clone(n) };
  },
  makeUndo: (args, out) => ({ label: 'Restore staff note', fn: () => {
    const arr = readNotes(); if (!arr.some(x => x.id === out.saved.id)) arr.push(out.saved);
    Actions.saveStaffNotes(JSON.stringify(arr)); afterWrite();
  } }),
});

// ── Staff credit entry ───────────────────────────────────────────────
const readMgr = () => { const raw = Repository.getItem(MGR_KEY); if (!raw) return {}; try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (_) { /* fall through */ } throw new Error('Stored manager data could not be read, so nothing was changed.'); };
const creditNet = r => ni(r.prevBal) + (r.entries || []).reduce((s, e) => s + ni(e.amount), 0) - ni(r.salary) - ni(r.lessGeneric);

function findCredit({ staff, month_year, entry_number, expected_amount }) {
  const my = normMonth(month_year);
  if (!my) throw new Error('Use a month like "October 2026".');
  const data = readMgr();
  const rows = (data.credit && data.credit[my]) || [];
  const { row, ambiguous } = findCreditRow(rows, staff);
  if (ambiguous) throw new Error('"' + staff + '" matches several people on the credit sheet: ' + ambiguous.join(', ') + '. Ask which one.');
  if (!row) throw new Error('No credit row for "' + staff + '" in ' + my + '.');
  const i = Math.round(num(entry_number)) - 1;
  const entry = (row.entries || [])[i];
  if (!entry) throw new Error('Entry number ' + entry_number + ' does not exist (there are ' + (row.entries || []).length + '). Read it first with get_staff_credit.');
  if (Math.abs(ni(entry.amount)) !== Math.abs(ni(expected_amount))) throw new Error('Entry ' + entry_number + ' is ' + rsFmt(Math.abs(ni(entry.amount))) + ', not ' + rsFmt(Math.abs(ni(expected_amount))) + '. The list may have changed: read it again with get_staff_credit.');
  return { data, my, row, i, entry, name: String(row.name).trim() };
}

registerTool({
  name: 'delete_staff_credit_entry', domain: 'manager', risk: 'critical', sensitive: true,
  description: 'Permanently delete ONE credit/payment entry from a staff member\'s Credit Ledger month. Needs the entry number and its amount exactly as shown by get_staff_credit (guards against deleting the wrong row). The user must type DELETE to confirm.',
  parameters: { type: 'object', required: ['staff', 'month_year', 'entry_number', 'expected_amount'], properties: {
    staff: { type: 'string' }, month_year: { type: 'string', description: 'e.g. "October 2026"' },
    entry_number: { type: 'integer', description: 'the n shown by get_staff_credit (1-based)' },
    expected_amount: { type: 'number', description: 'the amount of that entry, as read' },
  } },
  preview: a => {
    const f = findCredit(a);
    const before = creditNet(f.row);
    return { title: 'Delete credit entry', confirmWord: CONFIRM,
      lines: ['Staff: ' + f.name, 'Month: ' + f.my, 'Entry: ' + f.entry.date + ' · ' + (f.entry.desc || '(no description)') + ' · ' + rsFmt(f.entry.amount), 'Net owed: ' + rsFmt(before) + ' → ' + rsFmt(before - ni(f.entry.amount))],
      warnings: ['This permanently removes the entry.'] };
  },
  run: a => {
    const f = findCredit(a);
    const saved = clone(f.entry);
    f.row.entries.splice(f.i, 1);
    Actions.saveFeatureData(MGR_KEY, JSON.stringify(f.data));
    try { if (typeof window._scCreditSync === 'function') window._scCreditSync(f.my); } catch (_) { /* ui only */ }
    try { if (typeof window.renderStaffRegistry === 'function') window.renderStaffRegistry(); } catch (_) { /* ui only */ }
    afterWrite();
    return { summary: 'Deleted ' + rsFmt(Math.abs(ni(saved.amount))) + ' credit entry for ' + f.name, staff: f.name, month: f.my, index: f.i, saved, net_owed_now: creditNet(f.row) };
  },
  makeUndo: (args, out) => ({ label: 'Restore credit entry for ' + out.staff, fn: () => {
    const data = readMgr();
    const row = ((data.credit && data.credit[out.month]) || []).find(r => normName(r.name) === normName(out.staff));
    if (!row) throw new Error('The credit row is gone; cannot restore.');
    row.entries.splice(Math.min(out.index, row.entries.length), 0, out.saved);
    Actions.saveFeatureData(MGR_KEY, JSON.stringify(data));
    try { if (typeof window._scCreditSync === 'function') window._scCreditSync(out.month); } catch (_) { /* ui only */ }
    afterWrite();
  } }),
});

// ── Daily sales entry (mirrors the Entry page's delEntry) ────────────
function findDay(date, expectedTotal) {
  const nd = normDay(date);
  if (!nd) throw new Error('Could not understand date "' + date + '".');
  const rec = DAILY.find(d => d.Date === nd);
  if (!rec) throw new Error('No sales entry exists for ' + nd + '.');
  if (Math.round(num(rec.TOTAL)) !== Math.round(num(expectedTotal))) throw new Error('The TOTAL for ' + nd + ' is ' + rsFmt(num(rec.TOTAL)) + ', not ' + rsFmt(num(expectedTotal)) + '. Read the day again with get_daily_sales.');
  if (DAILY.filter(d => sameMonth(d.Month_Year, rec.Month_Year)).length < 2) throw new Error(nd + ' is the only day entered in ' + rec.Month_Year + '. Deleting it would leave an empty month with stale totals, so remove it from the Entry/Data page instead.');
  return rec;
}

registerTool({
  name: 'delete_daily_sales_entry', domain: 'sales', risk: 'critical',
  description: 'Permanently delete ONE existing day of sales. Needs the date and that day\'s TOTAL exactly as read from get_daily_sales (guards against the wrong day). Refuses if it is the only day in its month. The user must type DELETE to confirm.',
  parameters: { type: 'object', required: ['date', 'expected_total'], properties: {
    date: { type: 'string', description: 'e.g. 2026-10-02' }, expected_total: { type: 'number', description: 'the TOTAL of that day as read' },
  } },
  preview: ({ date, expected_total }) => {
    const rec = findDay(date, expected_total);
    const m = MONTHLY.find(x => sameMonth(x.Month_Year, rec.Month_Year));
    return { title: 'Delete sales for ' + rec.Date, confirmWord: CONFIRM,
      lines: ['Day: ' + rec.Date, 'TOTAL: ' + rsFmt(num(rec.TOTAL)), 'Cash Sale: ' + rsFmt(num(rec['Cash Sale'])), 'Customers: ' + Math.round(num(rec.Customers)), m ? rec.Month_Year + ' total: ' + rsFmt(num(m.TOTAL)) + ' → ' + rsFmt(num(m.TOTAL) - num(rec.TOTAL)) : null].filter(Boolean),
      warnings: ['This removes the whole day from reports and the dashboard.'] };
  },
  run: ({ date, expected_total }) => {
    const rec = findDay(date, expected_total);
    const saved = clone(rec); const my = rec.Month_Year;
    Actions.removeDailyEntry(rec.Date, my);
    Actions.forgetPendingEntry(saved.Date, my);
    Actions.recomputeMonth(my);
    afterWrite({ rebuild: true });
    return { summary: 'Deleted sales for ' + saved.Date + ' (' + rsFmt(num(saved.TOTAL)) + ')', day: saved.Date, month: my, saved };
  },
  makeUndo: (args, out) => ({ label: 'Restore sales for ' + out.day, fn: () => {
    Actions.addDailyEntry(out.saved);
    Actions.recomputeMonth(out.month);
    afterWrite({ rebuild: true });
  } }),
});
