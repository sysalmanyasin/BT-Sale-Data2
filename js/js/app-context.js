// ══════════════════════════════════════════════════════════════════════
// AppContext — Unified read-only snapshot of application state
// Consumed by: AI Bridge, Command Hub, Assistant Engine
// Gives the AI full visibility into EVERY page: Dashboard, Index, Data,
// Diff, and every tab inside Manager (Credit, Salary, Generic, Expense,
// Petty Cash, Custom Sections) — not just the last few months.
//
// Module-migration Stage B: converted from classic <script defer> to a
// real ES module. This conversion required fixing three things first,
// not just adding imports — see sw.js's changelog and this session's
// notes for full detail:
//   1. getTgts (targets.js) was never bridged to window at all. Also
//      fixed a real pre-existing bug in the process: this file used to
//      check `window.getTgts` specifically, which was NEVER assigned
//      anywhere in the repo, so ctx.targets silently was always {}.
//   2. _curPage (storage.js) is deliberately never bridged to window
//      (ui.js reassigns it directly — bridging would desync that write).
//      Added a read-only getCurrentPage() getter instead, bridged to
//      window, which doesn't touch that reassignment concern at all.
//   3. _nsSFLoad (notes-sheets.js) was never bridged to window either —
//      fixing this also fixes the same silent-fallback bug that was
//      already live in cover-dashboard.js (already a module before this
//      session), which has the identical `typeof _nsSFLoad` check.
// getTgts, getCurrentPage, and _nsSFLoad are still classic-script-only
// functions (targets.js, storage.js, notes-sheets.js aren't converted
// yet), so they're referenced as bare identifiers below, resolving via
// their new window bridges — not real imports, since there's nothing to
// import yet. Everything else below IS a real import.
// ══════════════════════════════════════════════════════════════════════
import { MONTHLY, DAILY, STAFF, CLIENT_COLS, BANK_COLS, RETURN_FIELDS,
         yearlyCAGR, branchScore, cashSales, creditSales } from './config.js';
import { BTFormat } from './bt-format.js';
import { Repository } from './repository.js';
import { getAllLedgerTypes, getEntries, getCategoryList, getCurrentBalance } from './ledger-store.js';
import { InventoryDomain } from './ai/domains/inventory-domain.js';

const MGR_STORAGE_KEY = 'BT_ManagerWork_v1';

function getAppContext() {
  return Object.freeze({
    monthly:      Array.isArray(MONTHLY)      ? MONTHLY      : [],
    daily:        Array.isArray(DAILY)        ? DAILY        : [],
    staff:        Array.isArray(STAFF)        ? STAFF        : [],
    // getTgts is still classic-script-only (targets.js) — see header note.
    targets:      typeof getTgts === 'function' ? getTgts()  : {},
    // CLIENT_COLS / BANK_COLS / RETURN_FIELDS ARE real exports of config.js
    // and ARE bridged to window (confirmed via grep — this comment used to
    // claim otherwise). currentPage now goes through storage.js's
    // getCurrentPage() getter instead of the bare `_curPage` global, since
    // _curPage itself is deliberately never bridged to window (see
    // storage.js's comment — ui.js reassigns it directly).
    clientCols:   typeof CLIENT_COLS   !== 'undefined' ? CLIENT_COLS   : [],
    bankCols:     typeof BANK_COLS     !== 'undefined' ? BANK_COLS     : [],
    returnFields: typeof RETURN_FIELDS !== 'undefined' ? RETURN_FIELDS : new Set(),
    currentPage:  typeof getCurrentPage === 'function'  ? getCurrentPage() : '',
  });
}

function _acNum(v) {
  return BTFormat.num(v);
}
function _acFc(v) {
  return BTFormat.plain(v);
}
function _acMgrLoad() {
  try { return JSON.parse(Repository.getItem(MGR_STORAGE_KEY) || '{}'); } catch (_) { return {}; }
}
function _acPettyTotalForMonth(my) {
  try {
    const raw = Repository.getItem('mw_petty_' + my);
    if (!raw) return { total: 0, count: 0 };
    const data = JSON.parse(raw);
    const groups = data.groups || [];
    let total = 0, count = 0;
    groups.forEach(function (g) {
      (g.rows || []).forEach(function (r) { total += _acNum(r.amount); count++; });
    });
    return { total: total, count: count };
  } catch (_) { return { total: 0, count: 0 }; }
}

// ── Rich, FULL context summary for Groq — covers every page in the app ────
// opts.fullMonths: 'all' (default) sends every daily record; pass a number
// to cap it for unusually large datasets.
function getAppContextSummary(opts) {
  opts = opts || {};
  const fullMonths = opts.fullMonths !== undefined ? opts.fullMonths : 'all';
  const ctx = getAppContext();
  const M   = ctx.monthly;
  const D   = ctx.daily;

  if (!M.length && !D.length) return 'No data loaded yet. User has not entered any sales records.';

  const n  = _acNum;
  const fc = _acFc;
  const lines = [];

  // ── 1. SUMMARY HEADER (Dashboard hero) ────────────────────────────
  if (M.length) {
    const grand       = M.reduce(function (s, m) { return s + n(m.TOTAL); }, 0);
    const dateRange   = M[0].Month_Year + ' to ' + M[M.length - 1].Month_Year;
    const last        = M[M.length - 1];
    const prev        = M.length > 1 ? M[M.length - 2] : null;
    const activeStaff = ctx.staff.filter(function (s) { return s.active !== false; }).length;
    const cagr        = yearlyCAGR();
    const tgts        = ctx.targets || {};
    const latTgt       = n(tgts[last.Month_Year]);
    const cumDiff      = M.reduce(function (s, m) { return s + Math.round(n(m.TOTAL) - n(m['COMP SALE'] || m['COMP_SALE'])); }, 0);
    const bScore       = prev ? branchScore(last, prev, latTgt, n(last.TOTAL)) : null;

    lines.push('=== DASHBOARD OVERVIEW (all-time, every page) ===');
    lines.push('Total months recorded: ' + M.length + ' | Total daily records: ' + D.length + ' | Date range: ' + dateRange);
    lines.push('Grand total sales (all time, cumulative since start): \u20a8' + fc(grand));
    lines.push('Latest month: ' + last.Month_Year + ' \u2014 \u20a8' + fc(n(last.TOTAL)) + ' | Customers: ' + Math.round(n(last.Customers || last['Customers'])));
    if (latTgt) lines.push('Latest month target: \u20a8' + fc(latTgt) + ' (' + Math.round(n(last.TOTAL) / latTgt * 100) + '% achieved so far)');
    if (cagr != null) lines.push('CAGR since first 12 months: ' + cagr.toFixed(1) + '%');
    if (bScore != null) lines.push('Branch Performance Score (latest): ' + bScore + '/100');
    lines.push('Cumulative CC Difference (Total \u2212 Comp Sale, all months): ' + (cumDiff >= 0 ? '+' : '') + '\u20a8' + fc(cumDiff) + ' (' + (cumDiff >= 0 ? 'physical ahead of system' : 'system ahead of physical') + ')');
    lines.push('Active staff: ' + activeStaff);
    lines.push('');
  }

  // ── 2. ALL TARGETS (every month, not just latest) ─────────────────
  if (ctx.targets && Object.keys(ctx.targets).length) {
    lines.push('=== TARGETS (all months set) ===');
    Object.entries(ctx.targets).forEach(function (e) {
      lines.push('  ' + e[0] + ': \u20a8' + fc(n(e[1])));
    });
    lines.push('');
  }

  // ── 3. EVERY MONTH on record (Index / Month Index page) ───────────
  if (M.length) {
    lines.push('=== MONTHLY BREAKDOWN \u2014 ALL ' + M.length + ' MONTHS (Index page) ===');
    lines.push('Format: Month: Total | Cash | Credit | Cust | LoadSale | CompSale | DIFF');
    M.forEach(function (m) {
      const tot   = n(m.TOTAL);
      const cash  = cashSales(m);
      const load  = n(m['Load_Sale'] || m['Load Sale'] || 0);
      const comp  = n(m['COMP_SALE'] || m['COMP SALE'] || 0);
      const diff  = tot - comp;
      const cust  = Math.round(n(m.Customers || m['Customers'] || 0));
      const creditTotal = creditSales(m);
      let line = m.Month_Year + ': \u20a8' + fc(tot) + ' | Cash \u20a8' + fc(cash) + ' | Credit \u20a8' + fc(creditTotal) + ' | Cust ' + cust;
      if (load > 0) line += ' | Load \u20a8' + fc(load);
      if (comp > 0) line += ' | Comp \u20a8' + fc(comp) + ' | DIFF ' + (diff >= 0 ? '+' : '') + fc(diff);
      lines.push('  ' + line);
    });
    lines.push('');

    // Credit clients — full history, every month they had activity
    const activeClients = (ctx.clientCols || []).filter(function (c) {
      return M.some(function (m) { return n(m[c]) > 0; });
    });
    if (activeClients.length) {
      lines.push('=== CREDIT CLIENTS \u2014 monthly totals, all months (Manager > Credit / Dashboard) ===');
      activeClients.forEach(function (c) {
        const clientTotal = M.reduce(function (s, m) { return s + n(m[c]); }, 0);
        lines.push('  ' + c + ': all-time total \u20a8' + fc(clientTotal));
      });
      lines.push('');
    }
  }

  // ── 4. EVERY DAILY RECORD (Daily Data page) ────────────────────────
  if (D.length) {
    const useAll = fullMonths === 'all' || fullMonths >= M.length;
    const monthNames = useAll ? null : M.slice(-fullMonths).map(function (m) { return m.Month_Year; });
    const dailySet = monthNames ? D.filter(function (d) { return monthNames.includes(d.Month_Year); }) : D;

    lines.push('=== DAILY RECORDS \u2014 ' + (useAll ? 'ALL ' + dailySet.length + ' DAYS ON RECORD' : 'last ' + fullMonths + ' months') + ' (Data page) ===');
    lines.push('Format: Date [Month]: Total | Cash | Credit | DIFF | Customers');
    dailySet.forEach(function (d) {
      const tot   = n(d.TOTAL);
      // Daily records use underscore keys (Cash_Sale, Alfala_Bank…) not the space keys
      // that cashSales()/mBanks() read from MONTHLY — compute directly from both formats.
      const _dv   = function(k) { return n(d[k] !== undefined ? d[k] : d[k.replace(/ /g,'_')]); };
      const cash  = _dv('Cash_Sale') + _dv('HBL') + _dv('MCB') +
                    _dv('Alfala_Bank') + _dv('Bank_Al_Habib') + _dv('Meezan_Bank') + _dv('Askari_Bank') -
                    Math.abs(_dv('Cash_Returns'));
      const comp  = n(d['COMP SALE'] || d['COMP_SALE'] || 0);
      const diff  = comp ? (tot - comp) : null;
      // creditSales() reads CLIENT_COLS with space keys — also fails on daily underscore keys.
      // Read both key formats so multi-word clients (Wapda Hospital → Wapda_Hospital) resolve.
      const credit = (typeof CLIENT_COLS !== 'undefined' ? CLIENT_COLS : []).reduce(function(s, c) {
        return s + n(d[c] !== undefined ? d[c] : d[c.replace(/ /g,'_')]);
      }, 0);
      const cust  = Math.round(n(d.Customers || d['Customers'] || 0));
      const reason = d['Low Sale Reason'] ? ' [NOTE: ' + d['Low Sale Reason'] + ']' : '';
      let line = d.Date + ' [' + d.Month_Year + ']: \u20a8' + fc(tot);
      if (cash)   line += ' | Cash \u20a8' + fc(cash);
      if (credit) line += ' | Credit \u20a8' + fc(credit);
      if (diff != null) line += ' | DIFF ' + (diff >= 0 ? '+' : '') + fc(diff);
      line += ' | ' + cust + ' cust' + reason;
      lines.push('  ' + line);
    });
    lines.push('');
  }

  // ── 5. MANAGER DATA — Credit Ledger, Salary, Generic, Expense, ALL months ──
  const mgr = _acMgrLoad();

  if (mgr.credit && Object.keys(mgr.credit).length) {
    lines.push('=== MANAGER > STAFF CREDIT LEDGER (every month, every staff entry) ===');
    Object.entries(mgr.credit).forEach(function (e) {
      const my = e[0], emps = e[1] || [];
      emps.forEach(function (emp) {
        const entryTotal = (emp.entries || []).reduce(function (s, en) { return s + n(en.amount); }, 0);
        const net = n(emp.prevBal) + entryTotal - n(emp.salary) - n(emp.lessGeneric);
        let line = my + ' \u2014 ' + emp.name + ': net balance \u20a8' + fc(net);
        if ((emp.entries || []).length) {
          line += ' [' + emp.entries.map(function (en) { return en.date + ' ' + (en.desc || '') + ' \u20a8' + fc(n(en.amount)); }).join('; ') + ']';
        }
        lines.push('  ' + line);
      });
    });
    lines.push('');
  }

  if (mgr.salary && Object.keys(mgr.salary).length) {
    lines.push('=== MANAGER > SALARY SHEET (every month) ===');
    Object.entries(mgr.salary).forEach(function (e) {
      const my = e[0], rows = e[1] || [];
      rows.forEach(function (r) {
        const net = n(r.hoSal) - n(r.advance) + n(r.generic);
        lines.push('  ' + my + ' \u2014 ' + r.name + ' (' + (r.desig || '') + '): HO Salary \u20a8' + fc(r.hoSal) + ', Advance \u20a8' + fc(r.advance) + ', Generic \u20a8' + fc(r.generic) + ', Net \u20a8' + fc(net));
      });
    });
    lines.push('');
  }

  if (mgr.generic && Object.keys(mgr.generic).length) {
    lines.push('=== MANAGER > GENERIC WORKING (every month) ===');
    Object.entries(mgr.generic).forEach(function (e) {
      const my = e[0], rows = e[1] || [];
      rows.forEach(function (r) {
        const incentive = Math.round(n(r.genericSale) * 0.04);
        lines.push('  ' + my + ' \u2014 ' + r.name + ': Generic Sale \u20a8' + fc(r.genericSale) + ', Incentive \u20a8' + fc(incentive) + ', Extra \u20a8' + fc(r.extra));
      });
    });
    lines.push('');
  }

  // ── 5b. LEDGER ─ Expense, Jazz Cash Daily Ledger, Other Sections.
  // Replaces the old separate "EXPENSE SHEET" (mgr.expense, month-keyed)
  // and "CUSTOM SECTIONS" (mw_custom_sections_v1) blocks that used to be
  // here — both retired storage locations the live UI stopped writing
  // to once Expense/Jazz Cash/Other Sections moved onto the generalized
  // Ledger; those blocks always reported empty/stale data after that.
  // Jazz Cash never had a block here at all before this — it does now.
  //
  // Was `LedgerStore.getAllLedgerTypes()` etc against the window-only
  // grouped object (ledger-store.js never exports a `LedgerStore`
  // namespace via ES export, only individual named functions) — now
  // imports those functions directly. ──
  try {
    const types = getAllLedgerTypes();
    const withEntries = types.filter(t => getEntries(t.id).length);
    if (withEntries.length) {
      lines.push('=== MANAGER > LEDGER (Expense / Jazz Cash / Other Sections) ===');
      withEntries.forEach(function (t) {
        const cats = getCategoryList(t.id);
        const entries = getEntries(t.id);
        const bal = getCurrentBalance(t.id);
        lines.push('  ' + t.label + ' — current balance: ₨' + fc(bal) + ' (' + entries.length + ' entries)');
        entries.forEach(function (e) {
          const cat = cats.find(function (c) { return c.id === e.categoryId; });
          const signed = (cat && cat.sign < 0 ? '-' : '') + '₨' + fc(e.amount);
          const shiftTxt = e.shift ? ' [' + e.shift + ']' : '';
          lines.push('    ' + e.date + shiftTxt + ' ' + (cat ? cat.label : e.categoryId) + (e.desc ? ' (' + e.desc + ')' : '') + ': ' + signed);
        });
      });
      lines.push('');
    }
  } catch (_) {}

  // ── 6. PETTY CASH (every month, scanning via Repository) ─────────────
  try {
    const pettyMonths = Repository.getKeysByPrefix('mw_petty_')
      .map(function (k) { return k.replace('mw_petty_', ''); });
    if (pettyMonths.length) {
      lines.push('=== MANAGER > PETTY CASH (every month) ===');
      pettyMonths.forEach(function (my) {
        const p = _acPettyTotalForMonth(my);
        if (p.count) lines.push('  ' + my + ': ₨' + fc(p.total) + ' (' + p.count + ' items)');
      });
      lines.push('');
    }
  } catch (_) {}

  // ── 7. INVENTORY (V2 plan §2.3) — Cover Dashboard / Stock Ledger /
  // Excess Working / Reorder Report live stats, via the domain file so
  // this stays the single source of truth rather than a duplicate calc.
  try {
    const invSummary = InventoryDomain.getContextSummary();
    if (invSummary) { lines.push(invSummary); lines.push(''); }
  } catch (_) {}

  // ── 8. NOTES — titles, pinned, today's notes ──────────────────────
  try {
    const notes = JSON.parse(Repository.getItem('bt_notes_v1') || '[]');
    if (notes.length) {
      const today = new Date().toISOString().slice(0, 10);
      const pinned = notes.filter(function (n) { return n.pinned; });
      const todayNotes = notes.filter(function (n) {
        return n.updatedAt && n.updatedAt.startsWith(today);
      });
      lines.push('=== NOTES & SHEETS ===');
      lines.push('Total notes: ' + notes.length + ' | Pinned: ' + pinned.length + ' | Updated today: ' + todayNotes.length);
      if (pinned.length) {
        lines.push('Pinned notes:');
        pinned.forEach(function (n) {
          lines.push('  📌 [' + (n.title || 'Untitled') + ']' + (n.tags ? ' tags:' + n.tags : '') + ' — ' + (n.body || '').replace(/<[^>]+>/g,'').slice(0, 80));
        });
      }
      if (todayNotes.length) {
        lines.push("Today's notes:");
        todayNotes.forEach(function (n) {
          lines.push('  📝 [' + (n.title || 'Untitled') + '] — ' + (n.body || '').replace(/<[^>]+>/g,'').slice(0, 120));
        });
      }
      // List all note titles so AI can reference them by name
      lines.push('All note titles: ' + notes.map(function(n){return '"'+(n.title||'Untitled')+'"';}).join(', '));
      lines.push('');
    }
  } catch (_) {}

  // ── 9. SHEET FILES — file names and categories (V2 plan §5 — multi-
  // sheet workbook model; read via _nsSFLoad() rather than the legacy
  // bt_sheet_files_v1 key directly, since that key stops updating the
  // moment the workbook migration runs) ─────────────────────────────
  try {
    const sheetFiles = (typeof _nsSFLoad === 'function') ? _nsSFLoad() : JSON.parse(Repository.getItem('bt_sheet_files_v1') || '[]');
    if (sheetFiles.length) {
      lines.push('=== SHEET FILES ===');
      const groups = {};
      sheetFiles.forEach(function (f) {
        const cat = f.category || 'General';
        (groups[cat] = groups[cat] || []).push(f.name);
      });
      Object.entries(groups).forEach(function (e) {
        lines.push('  ' + e[0] + ': ' + e[1].join(', '));
      });
      lines.push('Total files: ' + sheetFiles.length);
      lines.push('');
    }
  } catch (_) {}

  if (!lines.length) return 'Data is loading. Please try again in a moment.';
  return lines.join('\n');
}

// These two are consumed by other files still on classic <script> tags
// (ai-bridge.js, commandhub.js) — everything else above (MGR_STORAGE_KEY,
// _acNum, _acFc, _acMgrLoad, _acPettyTotalForMonth) stays private to this
// file, same as before. Bridge kept for those two classic-script
// consumers; will be removable once they're converted too.
window.getAppContext = getAppContext;
window.getAppContextSummary = getAppContextSummary;
