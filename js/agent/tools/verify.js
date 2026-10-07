// ══════════════════════════════════════════════════════════════════════
// VERIFIERS for the change tools.
//
// After a change tool succeeds, runTool() calls its verifier. A verifier READS the result back from the
// same store the tool wrote to (never from the tool's own return value alone) and says whether the
// change is really there. Nothing here writes. Nothing here is a second business calculation: the numbers
// compared are the ones the tool itself reported, re-read from the store.
//
// Scope, stated plainly: this verifies the change in THIS device's app data. Whether the cloud copy has
// been pushed depends on the app's own auto-save/sync (the Data Sync health row), which is not awaited here.
// ══════════════════════════════════════════════════════════════════════
import { setVerifier } from '../core/tool-registry.js';
import './writes.js';
import './credit.js';
import './deletes.js';
import './memory-tool.js'; // registers remember_fact (its verifier lives in that file)
import { Repository } from '../../repository.js';
import * as LedgerStore from '../../ledger-store.js';
import { DAILY, MONTHLY } from '../../config.js';
import { num, sameMonth } from './_util.js';
import { normName } from './_names.js';

const ni = v => Math.round(Number(v) || 0);
const chk = (label, ok, detail) => ({ label, ok: !!ok, detail: detail == null ? '' : String(detail) });
const done = checks => ({ ok: checks.every(c => c.ok), checks });
const json = (key, fallback) => { try { const v = JSON.parse(Repository.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return undefined; } };
const NOTES_KEY = 'bt_staff_notes_v1', MGR_KEY = 'BT_ManagerWork_v1';

function ledgerEntry(id) {
  for (const t of LedgerStore.getAllLedgerTypes()) { const e = LedgerStore.getEntries(t.id).find(x => x.id === id); if (e) return { t, e }; }
  return null;
}
const dayRec = (day, my) => DAILY.find(d => d.Date === day && (!my || d.Month_Year === my)) || null;
const creditRow = (my, name) => { const m = json(MGR_KEY, {}); const rows = (m && m.credit && m.credit[my]) || []; return { rows, row: rows.find(r => normName(r.name) === normName(name)) || null, readable: m !== undefined }; };

setVerifier('add_staff_note', (a, out) => {
  const notes = json(NOTES_KEY, []);
  const n = Array.isArray(notes) ? notes.find(x => x.id === out.note_id) : null;
  return done([chk('Note exists in the staff notes store', !!n), chk('Text matches what you approved', !!n && String(n.text) === String(a.text).trim().slice(0, 400))]);
});

setVerifier('add_ledger_entry', (a, out) => {
  const f = ledgerEntry(out.entry_id);
  return done([
    chk('Entry exists in the ledger', !!f),
    chk('Amount matches', !!f && Math.abs(num(f.e.amount) - Math.abs(num(a.amount))) < 0.5, f ? 'Rs ' + ni(f.e.amount) : 'missing'),
    chk('Ledger balance matches the reported balance', !!f && ni(LedgerStore.getCurrentBalance(f.t.id)) === ni(out.new_balance), f ? 'Rs ' + ni(LedgerStore.getCurrentBalance(f.t.id)) : 'missing'),
  ]);
});

setVerifier('set_monthly_target', (a, out) => {
  const t = json('bt_targets', {});
  return done([chk('Target is stored for ' + out.month, !!t && ni(t[out.month]) === ni(a.amount), t && t[out.month] != null ? 'Rs ' + ni(t[out.month]) : 'missing')]);
});

setVerifier('edit_daily_sales_field', (a, out) => {
  const r = dayRec(out.day, out.month);
  return done([
    chk('Day still exists', !!r),
    chk('Field holds the new value', !!r && ni(r[out.field]) === ni(a.value), r ? out.field + ' = ' + ni(r[out.field]) : 'missing'),
    chk('TOTAL matches the recalculated total', !!r && ni(r.TOTAL) === ni(out.new_total), r ? 'TOTAL ' + ni(r.TOTAL) : 'missing'),
  ]);
});

setVerifier('add_daily_sales_entry', (a, out) => {
  const r = dayRec(out.day, out.month), m = MONTHLY.find(x => sameMonth(x.Month_Year, out.month));
  return done([
    chk('Day exists in the sales data', !!r),
    chk('TOTAL matches', !!r && ni(r.TOTAL) === ni(out.day_total), r ? 'TOTAL ' + ni(r.TOTAL) : 'missing'),
    chk('Month total was recomputed', !!m && (out.month_total_now == null || ni(m.TOTAL) === ni(out.month_total_now)), m ? 'Rs ' + ni(m.TOTAL) : 'month missing'),
  ]);
});

setVerifier('add_staff_credit_entry', (a, out) => {
  const { row, readable } = creditRow(out.month, out.staff);
  const has = !!row && (row.entries || []).some(e => e.date === out.entry.date && ni(e.amount) === ni(out.entry.amount) && String(e.desc || '') === String(out.entry.desc || ''));
  const net = row ? ni(row.prevBal) + (row.entries || []).reduce((s, e) => s + ni(e.amount), 0) - ni(row.salary) - ni(row.lessGeneric) : null;
  return done([chk('Credit sheet is readable', readable), chk('Entry is on the staff credit row', has), chk('Net owed matches the reported figure', net !== null && net === ni(out.net_owed_now), net !== null ? 'Rs ' + net : 'missing')]);
});

setVerifier('delete_ledger_entry', (a) => done([chk('Entry is gone from every ledger', !ledgerEntry(a.entry_id))]));

setVerifier('delete_staff_note', (a) => {
  const notes = json(NOTES_KEY, []);
  return done([chk('Notes store is readable', Array.isArray(notes)), chk('Note is gone', Array.isArray(notes) && !notes.some(x => x.id === a.note_id))]);
});

setVerifier('delete_staff_credit_entry', (a, out) => {
  const { row, readable } = creditRow(out.month, out.staff);
  const still = !!row && (row.entries || []).some(e => e.date === out.saved.date && ni(e.amount) === ni(out.saved.amount) && String(e.desc || '') === String(out.saved.desc || ''));
  const net = row ? ni(row.prevBal) + (row.entries || []).reduce((s, e) => s + ni(e.amount), 0) - ni(row.salary) - ni(row.lessGeneric) : null;
  return done([chk('Credit sheet is readable', readable), chk('Entry is gone', !still), chk('Net owed matches the reported figure', net !== null && net === ni(out.net_owed_now), net !== null ? 'Rs ' + net : 'row missing')]);
});

setVerifier('delete_daily_sales_entry', (a, out) => {
  const m = MONTHLY.find(x => sameMonth(x.Month_Year, out.month));
  return done([chk('Day is gone from the sales data', !dayRec(out.day, out.month)), chk('Month total still exists', !!m)]);
});

// remember_fact's verifier lives in memory-tool.js: only that file is allowed to touch the memory table.
