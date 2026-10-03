// CHANGE tools (Phase 2). Every one of them:
//   - validates + resolves names in preview() BEFORE the user sees a card,
//   - is executed only after explicit human approval (enforced in runTool),
//   - writes through the app's own Actions / LedgerActions (EventBus,
//     Activity Log and sync all keep working),
//   - returns an undo that reverses exactly what it did.
import { registerTool } from '../core/tool-registry.js';
import { amountChecks, dateChecks, isoToday, isoToApp, rsFmt } from '../core/guard.js';
import { Repository } from '../../repository.js';
import { Actions } from '../../actions.js';
import { LedgerActions } from '../../ledger-actions.js';
import * as LedgerStore from '../../ledger-store.js';
import { addNote, deleteNote, keyForStaff } from '../../staff-notes.js';
import { DAILY, DAILY_ADD_KEYS, DAILY_SUB_KEYS } from '../../config.js';
import { num, normDay, normMonth, sameMonth, MON } from './_util.js';

const lc = s => String(s || '').toLowerCase().trim();
// Read the stored targets exactly as the app does. If they cannot be parsed we
// THROW rather than return {}: saving on top of an unreadable value would wipe
// every existing target.
const targets = () => {
  const raw = Repository.getItem('bt_targets');
  if (!raw) return {};
  let v;
  try { v = JSON.parse(raw); } catch (_) { throw new Error('Stored targets could not be read, so nothing was changed.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Stored targets have an unexpected format, so nothing was changed.');
  return v;
};

function toIso(input) {
  if (!input) return isoToday();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input).trim())) return String(input).trim();
  const app = normDay(input);
  if (!app) throw new Error('Could not understand date "' + input + '". Use e.g. 2026-10-03.');
  const [d, m, y] = app.split('/');
  return y + '-' + String(MON.indexOf(m) + 1).padStart(2, '0') + '-' + d;
}

function oneStaff(query) {
  const q = lc(query);
  const all = Repository.getStaff();
  const exact = all.filter(e => lc(e.name) === q || lc(e.staffId) === q);
  const hits = exact.length ? exact : all.filter(e => lc(e.name).includes(q));
  if (!hits.length) throw new Error('No staff member matches "' + query + '". Use find_staff first.');
  if (hits.length > 1) throw new Error('"' + query + '" matches several staff: ' + hits.slice(0, 5).map(e => e.name + ' (' + e.staffId + ')').join(', ') + '. Ask the user which one.');
  return hits[0];
}

// ── Staff note ───────────────────────────────────────────────────────
registerTool({
  name: 'add_staff_note', domain: 'manager', risk: 'write', sensitive: true,
  description: 'Add a private timestamped note to one staff member\'s card (e.g. "spoke about late arrivals"). Needs the staff name and the note text.',
  parameters: { type: 'object', required: ['staff', 'text'], properties: {
    staff: { type: 'string', description: 'staff name or id like EMP-003' },
    text: { type: 'string', description: 'the note, max ~400 characters' },
  } },
  preview: ({ staff, text }) => {
    const emp = oneStaff(staff);
    const t = String(text || '').trim();
    if (!t) throw new Error('Note text is empty.');
    return { title: 'Add staff note', lines: ['Staff: ' + emp.name + ' (' + emp.staffId + ')', 'Note: ' + t.slice(0, 400)], warnings: t.length > 400 ? ['Note will be cut to 400 characters.'] : [] };
  },
  run: ({ staff, text }) => {
    const emp = oneStaff(staff);
    const note = addNote(keyForStaff(emp), String(text).trim().slice(0, 400));
    if (!note) throw new Error('Note was not saved.');
    return { summary: 'Note added to ' + emp.name, note_id: note.id };
  },
  makeUndo: (args, out) => ({ label: 'Remove note from ' + String(out.summary).replace('Note added to ', ''), fn: () => deleteNote(out.note_id) }),
});

// ── Ledger entry ─────────────────────────────────────────────────────
function resolveLedger(type, category) {
  const types = LedgerStore.getAllLedgerTypes();
  const t = types.find(x => lc(x.id) === lc(type)) || types.find(x => lc(x.label) === lc(type));
  if (!t) throw new Error('Unknown ledger "' + type + '". Available: ' + types.map(x => x.id).join(', ') + '. Use list_ledger_types.');
  const cats = LedgerStore.getCategoryList(t.id);
  const c = cats.find(x => lc(x.id) === lc(category)) || cats.find(x => lc(x.label) === lc(category));
  if (!c) throw new Error('Unknown category "' + category + '" for ledger ' + t.id + '. Valid: ' + cats.map(x => x.id + ' (' + x.label + ')').join(', '));
  return { t, c };
}

registerTool({
  name: 'add_ledger_entry', domain: 'manager', risk: 'write', sensitive: true,
  description: 'Add one entry to a ledger (e.g. petty expense, JazzCash). Call list_ledger_types first for valid ledger and category ids. Amount is always a positive number; the category decides whether it adds or subtracts.',
  parameters: { type: 'object', required: ['ledger_type', 'category_id', 'amount'], properties: {
    ledger_type: { type: 'string' }, category_id: { type: 'string' },
    amount: { type: 'number', description: 'positive rupees' },
    date: { type: 'string', description: 'YYYY-MM-DD, default today' },
    desc: { type: 'string', description: 'short description' },
  } },
  preview: ({ ledger_type, category_id, amount, date, desc }) => {
    const { t, c } = resolveLedger(ledger_type, category_id);
    const amt = Math.abs(num(amount));
    if (!(amt > 0) || amt > 100000000) throw new Error('Amount must be a positive number.');
    const iso = toIso(date);
    const before = LedgerStore.getCurrentBalance(t.id);
    const after = before + (c.sign || 0) * amt;
    const w = [...amountChecks(amt).warnings, ...dateChecks(iso).warnings];
    const dup = LedgerStore.getEntries(t.id).some(e => e.date === iso && e.categoryId === c.id && Math.abs(num(e.amount) - amt) < 0.5 && lc(e.desc) === lc(desc));
    if (dup) w.push('An identical entry already exists for this date. This may be a duplicate.');
    return {
      title: 'Add ledger entry',
      lines: ['Ledger: ' + t.label, 'Category: ' + c.label, 'Amount: ' + rsFmt(amt) + (c.sign > 0 ? '  (adds)' : c.sign < 0 ? '  (subtracts)' : ''),
        'Date: ' + isoToApp(iso), desc ? 'Note: ' + desc : null, 'Balance: ' + rsFmt(before) + ' → ' + rsFmt(after)].filter(Boolean),
      warnings: w, strong: amountChecks(amt).strong || dup,
    };
  },
  run: ({ ledger_type, category_id, amount, date, desc }) => {
    const { t, c } = resolveLedger(ledger_type, category_id);
    const entry = LedgerActions.addEntry(t.id, { date: toIso(date), categoryId: c.id, amount: Math.abs(num(amount)), desc: desc || '', source: 'ai_assistant' });
    return { summary: 'Added ' + rsFmt(entry.amount) + ' to ' + t.label + ' (' + c.label + ')', entry_id: entry.id, new_balance: Math.round(LedgerStore.getCurrentBalance(t.id)) };
  },
  makeUndo: (args, out) => ({ label: 'Remove ledger entry', fn: () => LedgerActions.removeEntry(out.entry_id) }),
});

// ── Monthly target ───────────────────────────────────────────────────
registerTool({
  name: 'set_monthly_target', domain: 'sales', risk: 'write',
  description: 'Set the sales target for a month (rupees). Replaces any existing target for that month.',
  parameters: { type: 'object', required: ['month_year', 'amount'], properties: {
    month_year: { type: 'string', description: 'e.g. "November 2026"' }, amount: { type: 'number', description: 'target in rupees' },
  } },
  preview: ({ month_year, amount }) => {
    const my = normMonth(month_year);
    if (!my) throw new Error('Use a month like "November 2026".');
    const amt = Math.round(num(amount));
    if (!(amt > 0) || amt > 10000000000) throw new Error('Target must be a positive number.');
    const prev = num(targets()[my]);
    const w = [];
    if (prev && Math.abs(amt - prev) / prev > 0.5) w.push('This changes the existing target by more than 50%.');
    return { title: 'Set sales target', lines: ['Month: ' + my, 'Target: ' + (prev ? rsFmt(prev) + ' → ' : '') + rsFmt(amt)], warnings: w, strong: w.length > 0 };
  },
  run: ({ month_year, amount }) => {
    const my = normMonth(month_year);
    const cur = { ...targets() };
    const prev = cur[my];
    cur[my] = Math.round(num(amount));
    Actions.saveTargets(JSON.stringify(cur));
    return { summary: 'Target for ' + my + ' set to ' + rsFmt(cur[my]), month: my, previous: prev === undefined ? null : prev };
  },
  makeUndo: (args, out) => ({
    label: 'Restore target for ' + out.month,
    fn: () => { const cur = { ...targets() }; if (out.previous === null) delete cur[out.month]; else cur[out.month] = out.previous; Actions.saveTargets(JSON.stringify(cur)); },
  }),
});

// ── Edit one field of an existing daily sales entry ──────────────────
const DAILY_EDITABLE = [...DAILY_ADD_KEYS, ...DAILY_SUB_KEYS, 'COMP SALE', 'Customers'];

function findDay(date) {
  const nd = normDay(date);
  if (!nd) throw new Error('Could not understand date "' + date + '".');
  const rec = DAILY.find(d => d.Date === nd);
  if (!rec) throw new Error('No sales entry exists for ' + nd + '. New days must be added on the Entry page (use navigate_to "entry").');
  return rec;
}
function pickField(field) {
  const f = DAILY_EDITABLE.find(k => lc(k) === lc(field));
  if (!f) throw new Error('Field "' + field + '" cannot be edited. Editable: ' + DAILY_EDITABLE.join(', '));
  return f;
}

registerTool({
  name: 'edit_daily_sales_field', domain: 'sales', risk: 'critical',
  description: 'Correct ONE field of an EXISTING daily sales entry (e.g. Cash Sale, HBL, COMP SALE, Customers). TOTAL and DIFF are recalculated automatically. Cannot create new days.',
  parameters: { type: 'object', required: ['date', 'field', 'value'], properties: {
    date: { type: 'string', description: 'e.g. 2026-10-02 or 02/Oct/2026' }, field: { type: 'string' }, value: { type: 'number', description: 'new value (>= 0)' },
  } },
  preview: ({ date, field, value }) => {
    const rec = findDay(date); const f = pickField(field);
    const v = num(value);
    if (!(v >= 0)) throw new Error('Value must be 0 or more.');
    const old = num(rec[f]);
    const w = [];
    if (old > 0 && Math.abs(v - old) / old > 0.5) w.push('This changes the value by more than 50%.');
    return { title: 'Edit daily sales', lines: ['Day: ' + rec.Date, 'Field: ' + f, 'Value: ' + rsFmt(old) + ' → ' + rsFmt(v), 'TOTAL is recalculated after this.'], warnings: w, strong: true };
  },
  run: ({ date, field, value }) => {
    const rec = findDay(date); const f = pickField(field);
    const old = rec[f] === undefined ? null : rec[f];
    const my = rec.Month_Year, day = rec.Date;
    Actions.editDailyEntry(day, my, { [f]: String(num(value)) });
    Actions.recomputeMonth(my);
    return { summary: day + ': ' + f + ' set to ' + rsFmt(num(value)), day, month: my, field: f, previous: old, new_total: Math.round(num(DAILY.find(d => d.Date === day && d.Month_Year === my).TOTAL)) };
  },
  makeUndo: (args, out) => ({
    label: 'Restore ' + out.field + ' on ' + out.day,
    fn: () => { Actions.editDailyEntry(out.day, out.month, { [out.field]: out.previous === null ? '' : out.previous }); Actions.recomputeMonth(out.month); },
  }),
});
