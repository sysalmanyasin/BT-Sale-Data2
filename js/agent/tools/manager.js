// Manager domain — READ tools: staff registry (safe fields only) and ledgers.
// CNIC, phone, address, blood group and father's name are NEVER returned.
import { registerTool } from '../core/tool-registry.js';
import { Repository } from '../../repository.js';
import * as LedgerStore from '../../ledger-store.js';
import { num, rs, clampInt, normDay, normMonth, monthIndex, MON } from './_util.js';

const safeStaff = e => ({
  staff_id: e.staffId, name: e.name, designation: e.designation, active: e.active !== false,
  sr_no: e.srNum ?? null, joined: e.doj || null, shift_start: e.shiftStart || null,
});
const lc = s => String(s || '').toLowerCase().trim();

registerTool({
  name: 'list_staff', domain: 'manager', risk: 'read',
  description: 'List staff (name, designation, active, joining date). No private identity data. Filter by active status or designation.',
  parameters: { type: 'object', properties: {
    active: { type: 'string', enum: ['active', 'inactive', 'all'], description: 'default active' },
    designation: { type: 'string' },
  } },
  run: ({ active, designation }) => {
    const mode = active || 'active';
    let rows = Repository.getStaff().filter(e => mode === 'all' || (mode === 'active') === (e.active !== false));
    if (designation) rows = rows.filter(e => lc(e.designation).includes(lc(designation)));
    return { count: rows.length, staff: rows.slice(0, 60).map(safeStaff) };
  },
});

registerTool({
  name: 'find_staff', domain: 'manager', risk: 'read',
  description: 'Find one staff member by (part of) name or staff id such as EMP-003.',
  parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  run: ({ query }) => {
    const q = lc(query);
    const hits = Repository.getStaff().filter(e => lc(e.name).includes(q) || lc(e.staffId) === q);
    return { count: hits.length, matches: hits.slice(0, 8).map(safeStaff) };
  },
});

registerTool({
  name: 'list_ledger_types', domain: 'manager', risk: 'read', sensitive: true,
  description: 'List available ledgers (e.g. jazzcash, petty, and custom sections) with their category ids and current balance.',
  parameters: { type: 'object', properties: {} },
  run: () => LedgerStore.getAllLedgerTypes().map(t => {
    let balance = null;
    try { balance = rs(LedgerStore.getCurrentBalance(t.id)); } catch (_) { /* ignore */ }
    return { id: t.id, label: t.label, custom: t.isCustom, current_balance: balance,
      categories: LedgerStore.getCategoryList(t.id).map(c => ({ id: c.id, label: c.label, sign: c.sign })) };
  }),
});

registerTool({
  name: 'get_ledger_entries', domain: 'manager', risk: 'read', sensitive: true,
  description: 'Entries of one ledger with running balance, newest first. Optional date range and category filter. Use list_ledger_types for valid ids.',
  parameters: { type: 'object', required: ['ledger_type'], properties: {
    ledger_type: { type: 'string' }, category_id: { type: 'string' },
    from: { type: 'string', description: 'start date, e.g. 2026-09-01' }, to: { type: 'string', description: 'end date' },
    limit: { type: 'integer', description: 'default 20, max 50' },
  } },
  run: ({ ledger_type, category_id, from, to, limit }) => {
    if (!LedgerStore.getAllLedgerTypes().some(t => t.id === ledger_type)) return { error: 'Unknown ledger "' + ledger_type + '". Call list_ledger_types.' };
    const iso = s => { if (!s) return null; const d = normDay(s); if (!d) return null; const [dd, mm, yy] = d.split('/'); return yy + '-' + String(MON.indexOf(mm) + 1).padStart(2, '0') + '-' + dd; };
    const f = iso(from), t = iso(to);
    let rows = LedgerStore.getEntriesWithBalance(ledger_type);
    if (category_id) rows = rows.filter(r => r.categoryId === category_id);
    if (f) rows = rows.filter(r => (r.date || '') >= f);
    if (t) rows = rows.filter(r => (r.date || '') <= t);
    const total = rows.length;
    const signOf = r => { const c = LedgerStore.getCategory(ledger_type, r.categoryId); return c && c.sign ? c.sign : 1; };
    const net = rows.reduce((s, r) => s + signOf(r) * num(r.amount), 0);
    rows = rows.slice().reverse().slice(0, clampInt(limit, 1, 50, 20));
    return { ledger: ledger_type, matching_entries: total, net_effect_on_balance: rs(net), shown: rows.length,
      entries: rows.map(r => ({ id: r.id, date: r.date, category: r.categoryId, amount: rs(r.amount), effect: signOf(r) > 0 ? '+' : '-', desc: r.desc || '', balance_after: rs(r._balance) })) };
  },
});

registerTool({
  name: 'get_ledger_month_totals', domain: 'manager', risk: 'read', sensitive: true,
  description: 'Per-category totals of one ledger for a month (e.g. petty cash expenses in September 2026).',
  parameters: { type: 'object', required: ['ledger_type', 'month_year'], properties: { ledger_type: { type: 'string' }, month_year: { type: 'string' } } },
  run: ({ ledger_type, month_year }) => {
    const my = normMonth(month_year);
    if (!my) return { error: 'Use month like "September 2026"' };
    if (!LedgerStore.getAllLedgerTypes().some(t => t.id === ledger_type)) return { error: 'Unknown ledger "' + ledger_type + '"' };
    const [mn, yr] = my.split(' ');
    const prefix = yr + '-' + String(monthIndex(mn) + 1).padStart(2, '0');
    const by = {};
    let count = 0, net = 0;
    LedgerStore.getEntries(ledger_type).filter(e => String(e.date || '').startsWith(prefix)).forEach(e => {
      by[e.categoryId] = (by[e.categoryId] || 0) + num(e.amount); count++;
      const c = LedgerStore.getCategory(ledger_type, e.categoryId); net += (c && c.sign ? c.sign : 1) * num(e.amount);
    });
    return { ledger: ledger_type, month: my, entries: count, by_category: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, rs(v)])), gross_total: rs(Object.values(by).reduce((a, b) => a + b, 0)), net_effect_on_balance: rs(net) };
  },
});
