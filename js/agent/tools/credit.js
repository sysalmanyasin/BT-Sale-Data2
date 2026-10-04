// Staff credit (the Manager → Credit Ledger sheet).
// Data lives in the manager blob BT_ManagerWork_v1 → credit[<Month Year>] =
//   [{ name, prevBal, entries:[{date:'DD-Mon-YYYY', desc, amount}], salary, lessGeneric }]
// net = prevBal + Σ entries − salary − lessGeneric  (positive = staff owes the shop)
// Reads are sensitive (per-person balances). The write mirrors Quick Add:
// bucket by the entry date's month, same entry shape, same save path.
import { registerTool } from '../core/tool-registry.js';
import { amountChecks, dateChecks, isoToday, rsFmt } from '../core/guard.js';
import { afterWrite } from '../core/after-write.js';
import { Repository } from '../../repository.js';
import { Actions } from '../../actions.js';
import { num, rs, normDay, normMonth, currentMonthYear, FULL, MON, clampInt } from './_util.js';

const MGR_KEY = 'BT_ManagerWork_v1';
const lc = s => String(s || '').trim().toLowerCase();
const ni = v => Math.round(Number(v) || 0);
const netOf = emp => ni(emp.prevBal) + (emp.entries || []).reduce((s, e) => s + ni(e.amount), 0) - ni(emp.salary) - ni(emp.lessGeneric);

// Refuse to continue on unreadable data: saving over it would wipe every credit sheet.
function loadMgr() {
  const raw = Repository.getItem(MGR_KEY);
  if (!raw) return {};
  let v;
  try { v = JSON.parse(raw); } catch (_) { throw new Error('Stored manager data could not be read, so nothing was changed.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Stored manager data has an unexpected format, so nothing was changed.');
  return v;
}
const rowsFor = (data, my) => (data.credit && Array.isArray(data.credit[my]) ? data.credit[my] : []);
const findRow = (rows, name) => rows.find(e => lc(e.name) === lc(name)) || null;

function prevMonthLabel(my) {
  const [mn, yr] = my.split(' ');
  const i = FULL.indexOf(mn);
  return i === 0 ? FULL[11] + ' ' + (+yr - 1) : FULL[i - 1] + ' ' + yr;
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

function isoFromInput(input) {
  if (!input) return isoToday();
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const app = normDay(s);
  if (!app) throw new Error('Could not understand date "' + input + '". Use e.g. 2026-10-03.');
  const [d, m, y] = app.split('/');
  return y + '-' + String(MON.indexOf(m) + 1).padStart(2, '0') + '-' + d;
}
const entryDate = iso => { const [y, m, d] = iso.split('-'); return d + '-' + MON[+m - 1] + '-' + y; }; // Quick Add's format
const monthOfIso = iso => { const [y, m] = iso.split('-'); return FULL[+m - 1] + ' ' + y; };

// ── Reads ────────────────────────────────────────────────────────────
registerTool({
  name: 'get_staff_credit', domain: 'manager', risk: 'read', sensitive: true,
  description: 'Staff credit (money staff owe the shop) for a month. With `staff` → that person\'s opening balance, entries, salary deduction and net. Without → everyone with a non-zero net plus the total. Defaults to the current month.',
  parameters: { type: 'object', properties: {
    staff: { type: 'string', description: 'name or id (optional)' },
    month_year: { type: 'string', description: 'e.g. "October 2026" (default current month)' },
  } },
  run: ({ staff, month_year }) => {
    const my = month_year ? normMonth(month_year) : currentMonthYear();
    if (!my) return { error: 'Use a month like "October 2026".' };
    const rows = rowsFor(loadMgr(), my);
    if (staff) {
      let name = staff;
      try { name = oneStaff(staff).name; } catch (_) { /* fall back to the typed name against credit rows */ }
      const emp = findRow(rows, name);
      if (!emp) return { month: my, staff: name, found: false, note: 'No credit row for this person in ' + my + '.' };
      return { month: my, staff: emp.name, found: true, opening_balance: ni(emp.prevBal), salary_deduction: ni(emp.salary), less_generic: ni(emp.lessGeneric), net_owed: netOf(emp),
        entries: (emp.entries || []).map((e, i) => ({ n: i + 1, date: e.date, desc: e.desc || '', amount: ni(e.amount) })).slice(-30) };
    }
    const list = rows.map(e => ({ staff: e.name, net_owed: netOf(e) })).filter(r => r.net_owed !== 0).sort((a, b) => b.net_owed - a.net_owed);
    return { month: my, people_with_balance: list.length, total_net_owed: list.reduce((s, r) => s + r.net_owed, 0), staff: list.slice(0, 40) };
  },
});

// ── Write: add one credit / payment entry ────────────────────────────
function plan({ staff, amount, kind, desc, date }) {
  const emp = oneStaff(staff);
  const amt = Math.abs(num(amount));
  if (!(amt > 0) || amt > 100000000) throw new Error('Amount must be a positive number.');
  const k = kind === 'payment' ? 'payment' : 'credit';
  const iso = isoFromInput(date);
  const my = monthOfIso(iso);
  const text = String(desc || '').trim().slice(0, 120) || k;
  const signed = k === 'payment' ? -ni(amt) : ni(amt);
  return { emp, amt: ni(amt), kind: k, iso, my, text, signed };
}

registerTool({
  name: 'add_staff_credit_entry', domain: 'manager', risk: 'write', sensitive: true,
  description: 'Record that a staff member took goods/cash on credit (kind "credit", default) or paid some back (kind "payment") in the Credit Ledger. Amount is always positive. It goes into the month of the entry date.',
  parameters: { type: 'object', required: ['staff', 'amount'], properties: {
    staff: { type: 'string', description: 'name or id like EMP-003' },
    amount: { type: 'number', description: 'positive rupees' },
    kind: { type: 'string', enum: ['credit', 'payment'] },
    desc: { type: 'string', description: 'what it was for' },
    date: { type: 'string', description: 'YYYY-MM-DD, default today' },
  } },
  preview: args => {
    const p = plan(args);
    const data = loadMgr();
    const rows = rowsFor(data, p.my);
    const row = findRow(rows, p.emp.name);
    const before = row ? netOf(row) : 0;
    const after = before + p.signed;
    const w = [...amountChecks(p.amt).warnings, ...dateChecks(p.iso).warnings];
    let strong = amountChecks(p.amt).strong;
    if (p.emp.active === false) w.push(p.emp.name + ' is marked inactive.');
    if (p.kind === 'payment' && after < 0) w.push('This payment is more than the balance owed (' + rsFmt(before) + '); the net would go negative.');
    if (row && (row.entries || []).some(e => e.date === entryDate(p.iso) && ni(e.amount) === p.signed && lc(e.desc) === lc(p.text))) { w.push('An identical entry already exists for this date. This may be a duplicate.'); strong = true; }
    if (!row) {
      const prev = findRow(rowsFor(data, prevMonthLabel(p.my)), p.emp.name);
      w.push('No ' + p.my + ' credit row exists for ' + p.emp.name + '; one will be created with opening balance 0.');
      if (prev && netOf(prev) !== 0) w.push('Last month\'s balance (' + rsFmt(netOf(prev)) + ') is NOT carried over automatically. Use Credit Ledger → Copy → Next Month.');
    }
    return {
      title: p.kind === 'payment' ? 'Record staff payment' : 'Add staff credit',
      lines: ['Staff: ' + p.emp.name + ' (' + p.emp.staffId + ')', 'Month: ' + p.my, (p.kind === 'payment' ? 'Payment received: ' : 'Credit taken: ') + rsFmt(p.amt), 'For: ' + p.text, 'Net owed: ' + rsFmt(before) + ' → ' + rsFmt(after)],
      warnings: w, strong,
    };
  },
  run: args => {
    const p = plan(args);
    const data = loadMgr();
    if (!data.credit || typeof data.credit !== 'object') data.credit = {};
    if (!Array.isArray(data.credit[p.my])) data.credit[p.my] = [];
    let row = findRow(data.credit[p.my], p.emp.name);
    const created = !row;
    if (!row) { row = { name: p.emp.name, prevBal: 0, entries: [], salary: 0, lessGeneric: 0 }; data.credit[p.my].push(row); }
    if (!Array.isArray(row.entries)) row.entries = [];
    const entry = { date: entryDate(p.iso), desc: p.text, amount: p.signed };
    row.entries.push(entry);
    Actions.saveFeatureData(MGR_KEY, JSON.stringify(data));
    refreshCreditUi(p.my);
    afterWrite();
    return { summary: (p.kind === 'payment' ? 'Recorded payment of ' : 'Added credit of ') + rsFmt(p.amt) + ' for ' + p.emp.name + ' (' + p.my + ')',
      staff: p.emp.name, month: p.my, entry, row_created: created, net_owed_now: netOf(row) };
  },
  makeUndo: (args, out) => ({
    label: 'Remove ' + rsFmt(Math.abs(out.entry.amount)) + ' entry for ' + out.staff,
    fn: () => {
      const data = loadMgr();
      const rows = rowsFor(data, out.month);
      const row = findRow(rows, out.staff);
      if (!row) throw new Error('The credit row is gone; nothing to undo.');
      let i = -1;
      for (let k = row.entries.length - 1; k >= 0; k--) { const e = row.entries[k]; if (e.date === out.entry.date && ni(e.amount) === out.entry.amount && (e.desc || '') === out.entry.desc) { i = k; break; } }
      if (i < 0) throw new Error('That entry was already changed or removed in the Credit Ledger.');
      row.entries.splice(i, 1);
      if (out.row_created && !row.entries.length && !ni(row.prevBal) && !ni(row.salary) && !ni(row.lessGeneric)) data.credit[out.month] = rows.filter(r => r !== row);
      Actions.saveFeatureData(MGR_KEY, JSON.stringify(data));
      refreshCreditUi(out.month);
      afterWrite();
    },
  }),
});

// Same nudges the Manager screens do after a credit save, so an open Credit
// Ledger sheet reloads (otherwise its later Save could overwrite this entry).
function refreshCreditUi(my) {
  try { if (typeof window._scCreditSync === 'function') window._scCreditSync(my); } catch (e) { console.error('[agent] credit sync', e); }
  try { if (typeof window.renderStaffRegistry === 'function') window.renderStaffRegistry(); } catch (e) { console.error('[agent] registry refresh', e); }
  try {
    const n = typeof document !== 'undefined' && document.getElementById('sc-title-name');
    if (n && n.textContent && typeof window.renderStaffCreditCurrent === 'function') window.renderStaffCreditCurrent(n.textContent);
  } catch (e) { console.error('[agent] card refresh', e); }
}
