// CHANGE tools (Phase 2). Every one of them:
//   - validates + resolves names in preview() BEFORE the user sees a card,
//   - is executed only after explicit human approval (enforced in runTool),
//   - writes through the app's own Actions / LedgerActions (EventBus,
//     Activity Log and sync all keep working),
//   - returns an undo that reverses exactly what it did.
import { registerTool } from '../core/tool-registry.js';
import { amountChecks, dateChecks, isoToday, isoToApp, rsFmt } from '../core/guard.js';
import { afterWrite } from '../core/after-write.js';
import { Repository } from '../../repository.js';
import { Actions } from '../../actions.js';
import { LedgerActions } from '../../ledger-actions.js';
import * as LedgerStore from '../../ledger-store.js';
import { addNote, deleteNote, keyForStaff } from '../../staff-notes.js';
import { DAILY, MONTHLY, DAILY_ADD_KEYS, DAILY_SUB_KEYS, RETURN_FIELDS, computeDailyTotals, negR } from '../../config.js';
import { num, normDay, normMonth, sameMonth, MON, FULL } from './_util.js';
import { resolveStaff as oneStaff } from './_names.js';

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
    afterWrite();
    return { summary: 'Note added to ' + emp.name, note_id: note.id };
  },
  makeUndo: (args, out) => ({ label: 'Remove note from ' + String(out.summary).replace('Note added to ', ''), fn: () => { deleteNote(out.note_id); afterWrite(); } }),
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
      warnings: w, strong: amountChecks(amt).strong || dup, amount: amt,
    };
  },
  run: ({ ledger_type, category_id, amount, date, desc }) => {
    const { t, c } = resolveLedger(ledger_type, category_id);
    // Idempotency: a retry or double-tap must not write the same entry twice. Entry ids embed their creation time
    // ("ldg_<ms>_<rand>"), so an identical assistant entry made in the last 2 minutes is treated as this same request.
    const iso = toIso(date), amt = Math.abs(num(amount)), now = Date.now();
    const recent = LedgerStore.getEntries(t.id).find(e => e.source === 'ai_assistant' && e.date === iso && e.categoryId === c.id
      && Math.abs(num(e.amount) - amt) < 0.5 && lc(e.desc) === lc(desc)
      && now - (Number(String(e.id || '').split('_')[1]) || 0) < 120000);
    if (recent) throw new Error('The same entry was just added (id ' + recent.id + '). Nothing new was written, so it is not duplicated.');
    const entry = LedgerActions.addEntry(t.id, { date: toIso(date), categoryId: c.id, amount: Math.abs(num(amount)), desc: desc || '', source: 'ai_assistant' });
    afterWrite();
    return { summary: 'Added ' + rsFmt(entry.amount) + ' to ' + t.label + ' (' + c.label + ')', entry_id: entry.id, new_balance: Math.round(LedgerStore.getCurrentBalance(t.id)) };
  },
  makeUndo: (args, out) => ({ label: 'Remove ledger entry', fn: () => { LedgerActions.removeEntry(out.entry_id); afterWrite(); } }),
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
    afterWrite({ rebuild: true });
    return { summary: 'Target for ' + my + ' set to ' + rsFmt(cur[my]), month: my, previous: prev === undefined ? null : prev };
  },
  makeUndo: (args, out) => ({
    label: 'Restore target for ' + out.month,
    fn: () => { const cur = { ...targets() }; if (out.previous === null) delete cur[out.month]; else cur[out.month] = out.previous; Actions.saveTargets(JSON.stringify(cur)); afterWrite({ rebuild: true }); },
  }),
});

// ── Edit one field of an existing daily sales entry ──────────────────
const DAILY_EDITABLE = [...DAILY_ADD_KEYS, ...DAILY_SUB_KEYS, 'COMP SALE', 'Customers'];

function findDay(date) {
  const nd = normDay(date);
  if (!nd) throw new Error('Could not understand date "' + date + '".');
  const rec = DAILY.find(d => d.Date === nd);
  if (!rec) throw new Error('No sales entry exists for ' + nd + '. To create a new day use add_daily_sales_entry.');
  return rec;
}
function pickField(field) {
  const f = DAILY_EDITABLE.find(k => lc(k) === lc(field));
  if (!f) throw new Error('Field "' + field + '" cannot be edited. Editable: ' + DAILY_EDITABLE.join(', '));
  return f;
}

registerTool({
  name: 'edit_daily_sales_field', domain: 'sales', risk: 'critical',
  description: 'Correct ONE field of an EXISTING daily sales entry (e.g. Cash Sale, HBL, COMP SALE, Customers). TOTAL and DIFF are recalculated automatically. Cannot create new days (use add_daily_sales_entry).',
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
    afterWrite({ rebuild: true });
    return { summary: day + ': ' + f + ' set to ' + rsFmt(num(value)), day, month: my, field: f, previous: old, new_total: Math.round(num(DAILY.find(d => d.Date === day && d.Month_Year === my).TOTAL)) };
  },
  makeUndo: (args, out) => ({
    label: 'Restore ' + out.field + ' on ' + out.day,
    fn: () => { Actions.editDailyEntry(out.day, out.month, { [out.field]: out.previous === null ? '' : out.previous }); Actions.recomputeMonth(out.month); afterWrite({ rebuild: true }); },
  }),
});

// ── Add a NEW daily sales entry (mirrors the Entry page's saveEntry) ──
const ENTRY_FIELDS = [...DAILY_ADD_KEYS, ...DAILY_SUB_KEYS, 'COMP SALE', 'Customers'];

function appDateToTime(app) { const [d, m, y] = String(app).split('/'); const i = MON.indexOf(m); return i < 0 ? NaN : new Date(+y, i, +d).getTime(); }

function buildEntry(date, fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('"fields" must be an object like {"Cash Sale": 150000, "COMP SALE": 170000, "Customers": 140}.');
  const iso = toIso(date);
  const [y, m, d] = iso.split('-');
  const app = d + '/' + MON[+m - 1] + '/' + y;
  const my = FULL[+m - 1] + ' ' + y;
  const entry = { Month_Year: my, Date: app };
  ENTRY_FIELDS.forEach(k => { entry[k] = null; });
  const given = Object.entries(fields);
  if (!given.length) throw new Error('Give at least one field, e.g. {"Cash Sale": 150000}.');
  for (const [k, v] of given) {
    const f = ENTRY_FIELDS.find(x => lc(x) === lc(k));
    if (!f) throw new Error('Unknown field "' + k + '". Valid: ' + ENTRY_FIELDS.join(', '));
    const val = num(v);
    if (!(val >= 0) || val > 1000000000) throw new Error('Field "' + f + '" must be 0 or more.');
    entry[f] = RETURN_FIELDS.has(f) ? negR(val) : val; // returns always reduce the total, same as the Entry page
  }
  computeDailyTotals(entry);
  entry['Sale Plus'] = null;
  return { entry, iso, app, my };
}

registerTool({
  name: 'add_daily_sales_entry', domain: 'sales', risk: 'critical',
  description: 'Create a NEW day in the sales data (same as the Entry page). Fails if that date already exists (use edit_daily_sales_field instead). Pass `fields` as a map of field name to rupees, e.g. {"Cash Sale":150000,"HBL":20000,"Cash Returns":3000,"COMP SALE":170000,"Customers":140}. TOTAL and DIFF are calculated automatically. Always include COMP SALE.',
  parameters: { type: 'object', required: ['date', 'fields'], properties: {
    date: { type: 'string', description: 'YYYY-MM-DD (or "today"/"yesterday")' },
    fields: { type: 'object', description: 'field name → number. Return fields are entered as positive numbers.' },
  } },
  preview: ({ date, fields }) => {
    const { entry, iso, app } = buildEntry(date, fields);
    if (DAILY.some(d => d.Date === app)) throw new Error('A sales entry for ' + app + ' already exists. Use edit_daily_sales_field to correct it.');
    const total = num(entry.TOTAL), comp = num(entry['COMP SALE']);
    const w = [...dateChecks(iso).warnings];
    if (entry['COMP SALE'] === null) w.push('COMP SALE not given, so DIFF will equal the whole TOTAL.');
    else if (entry.DIFF) w.push('DIFF (TOTAL − COMP SALE) will be ' + rsFmt(num(entry.DIFF)) + '.');
    const t = appDateToTime(app);
    const prior = DAILY.filter(d => num(d.TOTAL) > 0 && appDateToTime(d.Date) < t).sort((a, b) => appDateToTime(b.Date) - appDateToTime(a.Date)).slice(0, 14);
    if (prior.length >= 5) {
      const avg = prior.reduce((s, d) => s + num(d.TOTAL), 0) / prior.length;
      if (avg > 0 && Math.abs(total - avg) / avg > 0.5) w.push('TOTAL ' + rsFmt(total) + ' is far from the recent daily average (' + rsFmt(avg) + ').');
    }
    const lines = ['Day: ' + app, ...Object.entries(entry).filter(([k, v]) => ENTRY_FIELDS.includes(k) && v !== null).map(([k, v]) => k + ': ' + rsFmt(v)), 'TOTAL: ' + rsFmt(total) + (comp ? '  (COMP ' + rsFmt(comp) + ')' : '')];
    return { title: 'Add sales for ' + app, lines, warnings: w, strong: true, amount: total };
  },
  run: ({ date, fields }) => {
    const { entry, app, my } = buildEntry(date, fields);
    if (DAILY.some(d => d.Date === app)) throw new Error('A sales entry for ' + app + ' already exists.');
    const monthWasNew = !MONTHLY.some(m => sameMonth(m.Month_Year, my));
    Actions.addDailyEntry(entry);
    Actions.recordPendingEntry(entry);
    Actions.recomputeMonth(my);
    afterWrite({ rebuild: true });
    const rec = MONTHLY.find(m => sameMonth(m.Month_Year, my));
    return { summary: 'Added sales for ' + app + ': TOTAL ' + rsFmt(num(entry.TOTAL)), day: app, month: my, month_was_new: monthWasNew, day_total: Math.round(num(entry.TOTAL)), month_total_now: rec ? Math.round(num(rec.TOTAL)) : null };
  },
  makeUndo: (args, out) => ({
    label: 'Remove sales entry for ' + out.day,
    fn: () => {
      Actions.removeDailyEntry(out.day, out.month);
      Actions.forgetPendingEntry(out.day, out.month);
      Actions.recomputeMonth(out.month);
      if (out.month_was_new && !DAILY.some(d => sameMonth(d.Month_Year, out.month))) Actions.removeMonth(out.month);
      afterWrite({ rebuild: true });
    },
  }),
});
