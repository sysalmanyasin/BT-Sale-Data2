/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CommandHub — Universal Search & Command Palette                    ║
 * ║  BT Sales App  ·  Version 1.2                                       ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  HOW TO ADD:                                                         ║
 * ║  In index.html, after all other <script> tags, add:                 ║
 * ║    <script src="js/commandhub.js"></script>                         ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  KEYBOARD SHORTCUTS:                                                 ║
 * ║    Ctrl + K   → Open palette                                        ║
 * ║    ↑ / ↓      → Navigate results                                   ║
 * ║    Enter      → Run selected                                         ║
 * ║    Escape     → Close                                                ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  MOBILE:                                                             ║
 * ║    Floating 🔍 button at bottom-right opens the palette             ║
 * ║    Swipe down the overlay to close                                  ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  PUBLIC API:                                                         ║
 * ║    CommandHub.open()        — open the palette                      ║
 * ║    CommandHub.close()       — close the palette                     ║
 * ║    CommandHub.clearRecent() — wipe recent history                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * v1.2 — Full bug-fix pass against live app source:
 *   - openDayModal(r.Date, r.Month_Year)  — was passing full record object
 *   - openMonthModal(m.Month_Year)        — was passing full record object
 *   - Daily total uses r['TOTAL']         — was using nonexistent r.Cash/Credit/Voucher
 *   - Monthly total uses m['TOTAL']       — was using nonexistent m.Total_Cash/Credit/Voucher
 *   - Daily note uses r['Low Sale Reason']— was using nonexistent r.Notes
 *   - STAFF fields: s.name/id/designation — was using s.Name/ID/Role (wrong case)
 *   - printMonthReport(currentMonthYear())— was called with no argument
 *   - printYearlyReport(currentYear())    — was called with no argument
 *   - DOM guard in openPalette before _isOpen flag
 *   - Body scroll lock on mobile
 *   - type="text" to suppress native search-clear button
 *   - Fuzzy subsequence only for queries ≥ 3 chars
 *   - loadManagerPage() called before switchMgrTab()
 */
(function (global) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════
     CSS — all classes prefixed .cmdhub-* so they never clash with the app
  ═══════════════════════════════════════════════════════════════════════ */
  const STYLE = `
.cmdhub-overlay {
  position: fixed; inset: 0; z-index: 99998;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 10vh 16px 0;
  opacity: 0; visibility: hidden;
  transition: opacity 0.18s ease, visibility 0.18s ease;
  overscroll-behavior: contain;
}
.cmdhub-overlay.cmdhub-open { opacity: 1; visibility: visible; }

.cmdhub-panel {
  width: 100%; max-width: 640px;
  background: #fff; border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.1);
  overflow: hidden; display: flex; flex-direction: column; max-height: 75vh;
  transform: translateY(-10px) scale(0.98);
  transition: transform 0.18s cubic-bezier(.34,1.56,.64,1);
}
.cmdhub-overlay.cmdhub-open .cmdhub-panel { transform: translateY(0) scale(1); }

.cmdhub-searchbar {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 18px; border-bottom: 1.5px solid #e2e8f0;
  background: #fff; flex-shrink: 0;
}
.cmdhub-searchbar svg { flex-shrink: 0; color: #64748b; }

.cmdhub-input {
  flex: 1; border: none; outline: none;
  font-size: 17px; font-family: 'Inter', system-ui, sans-serif;
  color: #0f172a; background: transparent; caret-color: #2563eb;
  -webkit-appearance: none; appearance: none;
}
.cmdhub-input::placeholder { color: #94a3b8; }
.cmdhub-input::-webkit-search-cancel-button,
.cmdhub-input::-webkit-search-decoration { display: none; }

.cmdhub-clear {
  cursor: pointer; color: #94a3b8; background: none; border: none;
  padding: 2px 4px; border-radius: 6px; display: flex;
  align-items: center; font-size: 18px; line-height: 1; transition: color 0.1s;
}
.cmdhub-clear:hover { color: #0f172a; }
.cmdhub-clear.cmdhub-hidden { visibility: hidden; }

.cmdhub-results {
  overflow-y: auto; flex: 1;
  overscroll-behavior: contain; scroll-behavior: smooth;
}

.cmdhub-group-header {
  padding: 10px 18px 4px; font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: #94a3b8;
  background: #f8fafc; border-top: 1px solid #f1f5f9;
  position: sticky; top: 0; z-index: 1; user-select: none;
}
.cmdhub-group-header:first-child { border-top: none; }

.cmdhub-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; cursor: pointer; transition: background 0.08s;
  border-bottom: 1px solid transparent; border-left: 3px solid transparent;
  user-select: none; -webkit-tap-highlight-color: transparent;
}
.cmdhub-item:hover, .cmdhub-item.cmdhub-active { background: #eff6ff; }
.cmdhub-item.cmdhub-active { border-left-color: #2563eb; padding-left: 15px; }

.cmdhub-icon {
  width: 34px; height: 34px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0; line-height: 1;
}
.cmdhub-icon-cmd    { background: #eff6ff; }
.cmdhub-icon-daily  { background: #ecfdf5; }
.cmdhub-icon-month  { background: #f0f9ff; }
.cmdhub-icon-year   { background: #faf5ff; }
.cmdhub-icon-staff  { background: #fff7ed; }
.cmdhub-icon-recent { background: #f8fafc; }

.cmdhub-item-body { flex: 1; min-width: 0; }
.cmdhub-item-title {
  font-size: 14px; font-weight: 500; color: #0f172a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cmdhub-item-sub {
  font-size: 12px; color: #64748b; margin-top: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.cmdhub-item-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.cmdhub-badge {
  font-size: 11px; font-weight: 600;
  font-family: 'IBM Plex Mono', monospace;
  color: #334155; background: #f1f5f9;
  border-radius: 5px; padding: 2px 7px; white-space: nowrap;
}
.cmdhub-badge-green { background: #d1fae5; color: #065f46; }
.cmdhub-badge-blue  { background: #dbeafe; color: #1e40af; }
.cmdhub-badge-amber { background: #fef3c7; color: #92400e; }
.cmdhub-badge-red   { background: #fee2e2; color: #991b1b; }

.cmdhub-qactions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.12s; }
.cmdhub-item:hover .cmdhub-qactions,
.cmdhub-item.cmdhub-active .cmdhub-qactions { opacity: 1; }
.cmdhub-qa {
  font-size: 10px; font-weight: 600; padding: 3px 7px;
  border-radius: 5px; border: 1px solid #e2e8f0;
  background: #fff; color: #334155; cursor: pointer;
  white-space: nowrap; transition: background 0.1s, border-color 0.1s;
}
.cmdhub-qa:hover { background: #f1f5f9; border-color: #cbd5e1; }

.cmdhub-footer {
  padding: 8px 18px; border-top: 1px solid #f1f5f9;
  display: flex; gap: 16px; align-items: center;
  background: #f8fafc; flex-shrink: 0;
}
.cmdhub-hint { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #94a3b8; }
.cmdhub-kbd {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 1px 5px; border: 1px solid #e2e8f0; border-radius: 4px;
  background: #fff; font-size: 10px; font-weight: 600;
  color: #64748b; font-family: monospace; min-width: 20px; line-height: 1.6;
}

.cmdhub-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 40px 20px; gap: 8px; color: #94a3b8;
}
.cmdhub-empty-icon { font-size: 28px; }
.cmdhub-empty-text { font-size: 13px; }

/* Mobile FAB — z-index 99997, above bnav (z-index 400) — small, floating, left side */
.cmdhub-fab {
  position: fixed; bottom: 80px; left: 12px; z-index: 99997;
  width: 38px; height: 38px; border-radius: 50%;
  background: #2563eb; color: #fff; border: none;
  box-shadow: 0 4px 20px rgba(37,99,235,0.45);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  opacity: 0.85;
}
.cmdhub-fab svg { width: 16px; height: 16px; }
.cmdhub-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(37,99,235,0.55); }
.cmdhub-fab:active { transform: scale(0.95); }
.cmdhub-fab svg { pointer-events: none; }

/* bnav shows at ≤860px — match the app's own breakpoint */
@media (min-width: 861px) {
  .cmdhub-overlay { padding-top: 12vh; }
}
@media (min-width: 861px) and (hover: hover) and (pointer: fine) {
  .cmdhub-fab { display: none; }
}
@media (max-width: 860px) {
  .cmdhub-overlay { align-items: flex-end; padding: 0; }
  .cmdhub-panel {
    border-radius: 20px 20px 0 0; max-height: 88vh;
    transform: translateY(30px) scale(1);
  }
  .cmdhub-overlay.cmdhub-open .cmdhub-panel { transform: translateY(0) scale(1); }
  .cmdhub-qactions { display: none; }
}
@media print {
  .cmdhub-overlay, .cmdhub-fab { display: none !important; }
}
`;

  /* ═══════════════════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════════════════ */
  let _isOpen    = false;
  let _activeIdx = -1;
  let _allItems  = [];
  let _debounce  = null;
  let _touchStartY = 0;

  // buildCommands() result cached per palette open — the static command list never
  // changes at runtime, so rebuilding it on every keystroke is wasteful.
  let _cachedCommands = null;

  function getCachedCommands() {
    if (!_cachedCommands) _cachedCommands = buildCommands();
    return _cachedCommands;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RECENT ITEMS  (localStorage: bt_cmdhub_recent)
  ═══════════════════════════════════════════════════════════════════════ */
  const RECENT_KEY = 'bt_cmdhub_recent';
  const MAX_RECENT = 20;

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function addRecent(item) {
    if (!item || !item.id) return;
    try {
      let list = getRecent().filter(r => r.id !== item.id);
      list.unshift({ id: item.id, title: item.title, sub: item.sub,
                     icon: item.icon, cat: item.cat, ts: Date.now() });
      if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FUZZY SEARCH ENGINE
  ═══════════════════════════════════════════════════════════════════════ */
  // Step 10: delegate to BTSearch (bt-search.js) with inline fallback
  function norm(s) {
    return (typeof BTSearch !== 'undefined') ? BTSearch.norm(s) : String(s || '').toLowerCase().trim();
  }

  function score(text, query) {
    if (typeof BTSearch !== 'undefined') return BTSearch.score(text, query);
    const t = norm(text), q = norm(query);
    if (!q) return 50;
    if (t === q) return 100;
    if (t.startsWith(q)) return 95;
    if (t.includes(q)) return 85;
    const qWords = q.split(/\s+/);
    if (qWords.length > 1 && qWords.every(w => t.includes(w))) return 80;
    if (qWords.some(w => w.length >= 2 && t.includes(w))) return 60;
    if (q.length >= 3) {
      let ti = 0;
      for (let qi = 0; qi < q.length; qi++) {
        while (ti < t.length && t[ti] !== q[qi]) ti++;
        if (ti >= t.length) return 0;
        ti++;
      }
      return 35;
    }
    return 0;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     NUMBER HELPERS
  ═══════════════════════════════════════════════════════════════════════ */
  // Step 10: delegate to BTFormat (bt-format.js) with inline fallback
  function _n(v) {
    return (typeof BTFormat !== 'undefined') ? BTFormat.num(v) :
      ((v == null || v === '' || isNaN(parseFloat(v))) ? 0 : parseFloat(v));
  }
  function fmtAmt(v) {
    if (typeof BTFormat !== 'undefined') return BTFormat.compact(v);
    const a = Math.abs(Math.round(v));
    if (a >= 1e6) return '₨ ' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1000) return '₨ ' + Math.round(v).toLocaleString('en-PK');
    return '₨ ' + String(Math.round(v));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DATE HELPERS
  ═══════════════════════════════════════════════════════════════════════ */
  // Step 10: delegate to BTDate (bt-date.js) with inline fallback arrays
  const MON_NAMES = (typeof BTDate !== 'undefined') ? BTDate.monthNames :
    ['January','February','March','April','May','June',
     'July','August','September','October','November','December'];
  const MON_SHORT = (typeof BTDate !== 'undefined') ? BTDate.monthShort :
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function todayStr() {
    if (typeof BTDate !== 'undefined') return BTDate.today();
    const d = new Date(), dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${MON_SHORT[d.getMonth()]}/${d.getFullYear()}`;
  }

  function currentMonthYear() {
    if (typeof BTDate !== 'undefined') return BTDate.currentMonthYear();
    const d = new Date();
    return `${MON_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }

  function currentYear() {
    return (typeof BTDate !== 'undefined') ? BTDate.currentYear() : String(new Date().getFullYear());
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SAFE DATA ACCESSORS
  ═══════════════════════════════════════════════════════════════════════ */
  // Step 10: delegate to getAppContext() (app-context.js) with inline fallback
  function daily()   { return (typeof getAppContext === 'function') ? getAppContext().daily   : (Array.isArray(global.DAILY)   ? global.DAILY   : []); }
  function monthly() { return (typeof getAppContext === 'function') ? getAppContext().monthly : (Array.isArray(global.MONTHLY) ? global.MONTHLY : []); }
  function staff()   { return (typeof getAppContext === 'function') ? getAppContext().staff   : (Array.isArray(global.STAFF)   ? global.STAFF   : []); }
  function tgts()    { return (typeof getAppContext === 'function') ? getAppContext().targets : ((typeof global.getTgts === 'function') ? global.getTgts() : {}); }

  /* ═══════════════════════════════════════════════════════════════════════
     COMMAND REGISTRY
  ═══════════════════════════════════════════════════════════════════════ */
  function buildCommands() {
    const go = page => () => {
      closePalette();
      if (typeof global.showPage === 'function') global.showPage(page);
      // Keep AIContext aware of the navigation so follow-up chat messages resolve correctly
      if (typeof AIContext !== 'undefined') AIContext.setPage(page);
    };

    // Navigate to manager and switch sub-tab.
    // loadManagerPage() must run before switchMgrTab() so dropdowns populate.
    const mgrTab = tab => () => {
      closePalette();
      if (typeof global.showPage === 'function') global.showPage('manager');
      // Tell AIContext which section the user is now in — palette nav is a context signal
      if (typeof AIContext !== 'undefined') {
        AIContext.setPage('manager');
        AIContext.setSection(tab, tab, 'palette');
      }
      setTimeout(() => {
        if (typeof global.loadManagerPage === 'function') global.loadManagerPage();
        if (typeof global.switchMgrTab === 'function') global.switchMgrTab(tab);
      }, 100);
    };

    return [
      // ── Navigation ──────────────────────────────────────────────
      { id:'nav-dashboard', icon:'📊', title:'Open Dashboard',
        sub:'Sales overview, KPI cards, charts',
        tags:['home','summary','kpi','dashboard'],
        action: go('dashboard') },

      { id:'nav-index', icon:'🗂️', title:'Open Sales Index',
        sub:'Browse all months and years',
        tags:['index','month list','browse','history'],
        action: go('index') },

      { id:'nav-data', icon:'📋', title:'Open Daily Data',
        sub:'View and search all daily entries',
        tags:['data','table','records','list','daily'],
        action: go('data') },

      { id:'nav-entry', icon:'➕', title:'New Sale Entry',
        sub:"Enter today's cash and credit sales",
        tags:['add','create','new','entry','sale'],
        action: go('entry') },

      { id:'nav-report', icon:'🧾', title:'Open Reports',
        sub:'Generate and print day, month, or year reports',
        tags:['report','print','generate'],
        action: go('report') },

      { id:'nav-tools', icon:'⚙️', title:'Open Tools',
        sub:'Export, import, backup, and settings',
        tags:['tools','settings','export','import','backup'],
        action: go('tools') },

      { id:'nav-manager', icon:'👔', title:'Open Manager',
        sub:'Staff, salaries, petty cash, incentives',
        tags:['manager','staff','salary'],
        action: go('manager') },

      { id:'nav-diff', icon:'📉', title:'DIFF Report',
        sub:'Total Sale vs COMP SALE — cumulative CC difference by month',
        tags:['diff','difference','comp','sale','cc','computer','report'],
        action: go('diff') },

      // ── Manager sub-tabs ────────────────────────────────────────
      { id:'mgr-staff', icon:'👥', title:'Staff Management',
        sub:'Add, edit, and manage employees',
        tags:['staff','employees','team','hr','worker'],
        action: mgrTab('staff') },

      { id:'mgr-salary', icon:'💰', title:'Salary Records',
        sub:'Monthly salary sheets and advances',
        tags:['salary','pay','wages','advance','employees'],
        action: mgrTab('salary') },

      { id:'mgr-petty', icon:'🧾', title:'Petty Cash',
        sub:'Opening balance, expenses, and closing',
        tags:['petty','cash','expenses','opening','closing'],
        action: mgrTab('petty') },

      { id:'mgr-incentive', icon:'🏆', title:'Incentives',
        sub:'Staff bonuses and performance incentives',
        tags:['incentive','bonus','performance','reward'],
        action: mgrTab('incentive') },

      { id:'mgr-expense', icon:'📑', title:'Expense Sheet',
        sub:'Monthly expense tracking and totals',
        tags:['expense','cost','spend','sheet'],
        action: mgrTab('expense') },

      { id:'mgr-credit', icon:'💳', title:'Credit Ledger',
        sub:'Employee credit and deduction tracking',
        tags:['credit','deduction','ledger','balance'],
        action: mgrTab('credit') },

      // ── Reports ─────────────────────────────────────────────────
      { id:'rpt-today', icon:'📄', title:"Today's Closing Report",
        sub:"Open today's entry in report view",
        tags:['today','daily','closing','report','print'],
        action: () => {
          closePalette();
          const today = todayStr();
          const rec   = daily().find(d => d.Date === today);
          if (typeof global.showPage === 'function') global.showPage('report');
          if (rec) {
            setTimeout(() => {
              // openDayModal(date, my) — pass strings, NOT record object
              if (typeof global.openDayModal === 'function')
                global.openDayModal(rec.Date, rec.Month_Year);
            }, 100);
          } else if (typeof global.toast === 'function') {
            setTimeout(() => global.toast("No entry found for today", 'w'), 150);
          }
        }
      },

      { id:'rpt-month', icon:'📅', title:'Current Month Report',
        sub:`Open ${currentMonthYear()} report`,
        tags:['month','monthly','report','current'],
        action: () => {
          closePalette();
          const my = currentMonthYear();
          if (typeof global.showPage === 'function') global.showPage('report');
          setTimeout(() => {
            // openMonthModal(my) — pass Month_Year string, NOT record object
            if (typeof global.openMonthModal === 'function') global.openMonthModal(my);
          }, 100);
        }
      },

      { id:'rpt-print-month', icon:'🖨️', title:'Print Monthly Report',
        sub:`Print ${currentMonthYear()}`,
        tags:['print','monthly','report'],
        action: () => {
          closePalette();
          // printMonthReport(my) — requires Month_Year argument
          if (typeof global.printMonthReport === 'function')
            global.printMonthReport(currentMonthYear());
        }
      },

      { id:'rpt-print-year', icon:'📆', title:'Print Yearly Report',
        sub:`Print ${currentYear()} yearly summary`,
        tags:['print','yearly','annual','report'],
        action: () => {
          closePalette();
          // printYearlyReport(yr) — requires year string argument
          if (typeof global.printYearlyReport === 'function')
            global.printYearlyReport(currentYear());
        }
      },

      // ── Export ──────────────────────────────────────────────────
      { id:'exp-csv-daily', icon:'📤', title:'Export Daily CSV',
        sub:'Download all daily records as CSV',
        tags:['export','csv','download','daily'],
        action: () => {
          closePalette();
          if (typeof global.exportCSV === 'function') global.exportCSV('daily');
        }
      },

      { id:'exp-csv-monthly', icon:'📤', title:'Export Monthly CSV',
        sub:'Download all monthly records as CSV',
        tags:['export','csv','download','monthly'],
        action: () => {
          closePalette();
          if (typeof global.exportCSV === 'function') global.exportCSV('monthly');
        }
      },

      { id:'exp-json', icon:'📦', title:'Export JSON Backup',
        sub:'Download full data as JSON',
        tags:['export','json','backup','download'],
        action: () => {
          closePalette();
          if (typeof global.exportJSON === 'function') global.exportJSON();
        }
      },

      // ── Tools ───────────────────────────────────────────────────
      { id:'tool-fields', icon:'🗃️', title:'Field Manager',
        sub:'Manage custom entry fields',
        tags:['fields','custom','settings','configure'],
        action: () => {
          closePalette();
          if (typeof global.openFieldManager === 'function') global.openFieldManager();
        }
      },

      { id:'tool-new-month', icon:'🆕', title:'Add New Month',
        sub:'Create a new monthly record',
        tags:['new','month','add','create'],
        action: () => {
          closePalette();
          if (typeof global.showPage === 'function') global.showPage('index');
          setTimeout(() => {
            if (typeof global.addNewMonth === 'function') global.addNewMonth();
          }, 100);
        }
      },

      // ── AI Assistant ─────────────────────────────────────────────
      { id:'ask-ai', icon:'🤖', title:'Ask AI Assistant',
        sub:'Groq AI — sales analytics, credit, Jazz Cash, custom entries',
        tags:['ai','ask','groq','assistant','question','chat','analytics','credit','jazzcash','jazz cash','highest','compare','total','petty','expense','load sale','diff'],
        action: () => {
          closePalette();
          setTimeout(() => {
            if (typeof global.showPage === 'function') global.showPage('commandhub');
          }, 80);
        }
      },
    ];
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DATA SEARCHES
     Field names verified against live source:
       DAILY   → d.Date, d.Month_Year, d['TOTAL'], d['Customers'],
                  d['Low Sale Reason']
       MONTHLY → m.Month_Year, m['TOTAL'], m.Customers
       STAFF   → s.name, s.id (staffId), s.designation, s.active
  ═══════════════════════════════════════════════════════════════════════ */

  function searchDaily(q) {
    const MAX = 8;
    const results = [];

    for (const r of daily()) {
      // Use the pre-computed TOTAL field (the field that exists in the data)
      const total = _n(r['TOTAL']);
      const searchText = [
        r.Date, r.Month_Year,
        String(Math.round(total)),
        String(_n(r['Customers'])),
        r['Low Sale Reason'] || ''   // actual notes field
      ].join(' ');

      const sc = score(searchText, q);
      if (sc <= 0) continue;

      results.push({ sc, item: makeDaily(r, total) });
    }

    return results.sort((a, b) => b.sc - a.sc).slice(0, MAX).map(x => x.item);
  }

  function makeDaily(r, total) {
    // Capture date/my as strings for correct openDayModal(date, my) calls
    const date = r.Date;
    const my   = r.Month_Year;
    const tStr = fmtAmt(total);
    const cust = Math.round(_n(r['Customers']));
    const hasNote = !!(r['Low Sale Reason']);

    const openReport = () => {
      addRecent({ id: 'daily-' + date + '-' + my, title: date,
                  sub: tStr, icon: '📋', cat: 'daily' });
      closePalette();
      if (typeof global.showPage === 'function') global.showPage('report');
      setTimeout(() => {
        if (typeof global.openDayModal === 'function')
          global.openDayModal(date, my); // ← strings, NOT record object
      }, 100);
    };

    const openEdit = () => {
      addRecent({ id: 'daily-' + date + '-' + my, title: date,
                  sub: tStr, icon: '📋', cat: 'daily' });
      closePalette();
      if (typeof global.showPage === 'function') global.showPage('data');
      setTimeout(() => {
        if (typeof global.openEditModal === 'function')
          global.openEditModal(date, my);
      }, 100);
    };

    return {
      id: 'daily-' + date + '-' + my,
      cat: 'daily', icon: '📋',
      title: date,
      sub: `${tStr} · ${cust} customers`,
      badge: hasNote ? '📝' : '',
      badgeClass: 'cmdhub-badge',
      action: openReport,
      qActions: [
        { label: 'Report', fn: openReport },
        { label: 'Edit',   fn: openEdit  },
      ],
    };
  }

  function searchMonthly(q) {
    const MAX = 6;
    const targets = tgts();
    const results = [];

    for (const m of monthly()) {
      const sc = score(m.Month_Year, q);
      if (sc <= 0) continue;
      results.push({ sc, item: makeMonthly(m, targets) });
    }

    return results.sort((a, b) => b.sc - a.sc).slice(0, MAX).map(x => x.item);
  }

  function makeMonthly(m, targets) {
    const my    = m.Month_Year; // string like "June 2026"
    // Use pre-computed TOTAL field (same as openMonthModal uses)
    const total = _n(m['TOTAL']);
    const tgt   = _n((targets || tgts())[my]);
    const pct   = tgt > 0 ? Math.round((total / tgt) * 100) : null;

    let badge = '', badgeClass = 'cmdhub-badge';
    if (pct !== null) {
      badge = pct + '%';
      if (pct >= 100) badgeClass = 'cmdhub-badge cmdhub-badge-green';
      else if (pct >= 80) badgeClass = 'cmdhub-badge cmdhub-badge-blue';
      else if (pct >= 60) badgeClass = 'cmdhub-badge cmdhub-badge-amber';
      else badgeClass = 'cmdhub-badge cmdhub-badge-red';
    }

    const tStr = fmtAmt(total);

    const openReport = () => {
      addRecent({ id: 'monthly-' + my, title: my,
                  sub: tStr, icon: '📅', cat: 'month' });
      closePalette();
      if (typeof global.showPage === 'function') global.showPage('report');
      setTimeout(() => {
        // openMonthModal(my) — pass Month_Year STRING, NOT record object
        if (typeof global.openMonthModal === 'function') global.openMonthModal(my);
      }, 100);
    };

    return {
      id: 'monthly-' + my,
      cat: 'month', icon: '📅',
      title: my,
      sub: `Total: ${tStr}${tgt ? ' · Target: ' + fmtAmt(tgt) : ''}`,
      badge, badgeClass,
      action: openReport,
      qActions: [
        { label: 'Report', fn: openReport },
        {
          label: 'Index',
          fn: () => {
            addRecent({ id: 'monthly-' + my, title: my,
                        sub: tStr, icon: '📅', cat: 'month' });
            closePalette();
            if (typeof global.showPage === 'function') global.showPage('index');
          }
        },
      ],
    };
  }

  function searchYearly(q) {
    const MAX = 4;
    const byYear = {};

    for (const m of monthly()) {
      const parts = String(m.Month_Year || '').split(' ');
      const yr = parts[parts.length - 1];
      if (!yr || isNaN(parseInt(yr, 10))) continue;
      if (!byYear[yr]) byYear[yr] = { total: 0, months: 0 };
      byYear[yr].total  += _n(m['TOTAL']);
      byYear[yr].months += 1;
    }

    const results = [];
    for (const [yr, data] of Object.entries(byYear)) {
      const sc = score(yr, q);
      if (sc <= 0) continue;
      results.push({
        sc,
        item: {
          id: 'yearly-' + yr,
          cat: 'year', icon: '📆',
          title: yr + ' Summary',
          sub: `${data.months} months · Total: ${fmtAmt(data.total)}`,
          badge: '', badgeClass: 'cmdhub-badge',
          action: () => {
            addRecent({ id: 'yearly-' + yr, title: yr + ' Summary',
                        sub: fmtAmt(data.total), icon: '📆', cat: 'year' });
            closePalette();
            if (typeof global.showPage === 'function') global.showPage('index');
          },
          qActions: [],
        }
      });
    }

    return results.sort((a, b) => b.sc - a.sc).slice(0, MAX).map(x => x.item);
  }

  function searchStaff(q) {
    const MAX = 6;
    const results = [];

    staff().forEach((s, i) => {
      // STAFF record shape: { name, id (staffId), designation, active, ... }
      const name  = s.name        || '';
      const sid   = s.staffId     || s.id || ('EMP-' + String(i + 1).padStart(3, '0'));
      const desg  = s.designation || '';
      const searchText = [name, sid, desg].join(' ');

      const sc = score(searchText, q);
      if (sc <= 0) return;

      const openProfile = () => {
        addRecent({ id: 'staff-' + i, title: name || sid,
                    sub: desg, icon: '👤', cat: 'staff' });
        closePalette();
        if (typeof global.openStaffCard === 'function') global.openStaffCard(i);
        else {
          if (typeof global.showPage === 'function') global.showPage('manager');
          setTimeout(() => {
            if (typeof global.loadManagerPage === 'function') global.loadManagerPage();
            if (typeof global.switchMgrTab === 'function') global.switchMgrTab('staff');
          }, 100);
        }
      };

      const openSalary = () => {
        addRecent({ id: 'staff-' + i, title: name || sid,
                    sub: desg, icon: '👤', cat: 'staff' });
        closePalette();
        if (typeof global.showPage === 'function') global.showPage('manager');
        setTimeout(() => {
          if (typeof global.loadManagerPage === 'function') global.loadManagerPage();
          if (typeof global.switchMgrTab === 'function') global.switchMgrTab('salary');
        }, 100);
      };

      results.push({
        sc,
        item: {
          id: 'staff-' + i,
          cat: 'staff', icon: '👤',
          title: name || sid,
          sub: [sid, desg].filter(Boolean).join(' · ') || 'Employee',
          badge: s.active === false ? 'Inactive' : '',
          badgeClass: 'cmdhub-badge cmdhub-badge-amber',
          action: openProfile,
          qActions: [
            { label: 'Profile', fn: openProfile },
            { label: 'Salary',  fn: openSalary  },
          ],
        }
      });
    });

    return results.sort((a, b) => b.sc - a.sc).slice(0, MAX).map(x => x.item);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SMART SUGGESTIONS (shown when palette opens empty)
  ═══════════════════════════════════════════════════════════════════════ */
  function buildSuggestions() {
    const groups = [];

    // ── Recent ────────────────────────────────────────────────────
    const recentRaw = getRecent().slice(0, 5);
    if (recentRaw.length) {
      const items = recentRaw.map(r => {
        let action = () => {};
        const dashIdx = r.id.indexOf('-');
        const type = dashIdx >= 0 ? r.id.slice(0, dashIdx) : r.id;
        const rest = dashIdx >= 0 ? r.id.slice(dashIdx + 1) : '';

        if (type === 'daily') {
          // id format: "daily-DD/Mon/YYYY-Month_Year"
          // rest = "DD/Mon/YYYY-Month_Year"
          // Find the record by checking which daily record's Date appears at start of rest
          const found = daily().find(d => rest.startsWith(d.Date));
          if (found) {
            action = () => {
              closePalette();
              if (typeof global.showPage === 'function') global.showPage('report');
              setTimeout(() => {
                if (typeof global.openDayModal === 'function')
                  global.openDayModal(found.Date, found.Month_Year);
              }, 100);
            };
          }
        } else if (type === 'monthly') {
          // id format: "monthly-Month_Year" e.g. "monthly-June 2026"
          const my = rest; // rest = "June 2026"
          action = () => {
            closePalette();
            if (typeof global.showPage === 'function') global.showPage('report');
            setTimeout(() => {
              if (typeof global.openMonthModal === 'function') global.openMonthModal(my);
            }, 100);
          };
        } else if (type === 'yearly') {
          action = () => {
            closePalette();
            if (typeof global.showPage === 'function') global.showPage('index');
          };
        } else if (type === 'staff') {
          // id format: "staff-<index>"
          const idx = parseInt(rest, 10);
          action = () => {
            closePalette();
            if (!isNaN(idx) && typeof global.openStaffCard === 'function')
              global.openStaffCard(idx);
          };
        }

        return {
          id: r.id, cat: 'recent', icon: r.icon || '🕐',
          title: r.title, sub: r.sub || '',
          badge: '', badgeClass: 'cmdhub-badge',
          action, qActions: [],
        };
      });

      if (items.length) groups.push({ label: 'Recent', items });
    }

    // ── Quick context ─────────────────────────────────────────────
    const ctx = [];

    // Today's entry (if it exists)
    const today = todayStr();
    const todayRec = daily().find(d => d.Date === today);
    if (todayRec) {
      const total = _n(todayRec['TOTAL']); // ← correct field
      ctx.push({
        id: 'ctx-today', cat: 'daily', icon: '📋',
        title: 'Today: ' + today,
        sub: `${fmtAmt(total)} · ${Math.round(_n(todayRec['Customers']))} customers`,
        badge: '', badgeClass: 'cmdhub-badge',
        action: () => {
          closePalette();
          if (typeof global.showPage === 'function') global.showPage('report');
          setTimeout(() => {
            if (typeof global.openDayModal === 'function')
              global.openDayModal(todayRec.Date, todayRec.Month_Year); // ← strings
          }, 100);
        },
        qActions: [],
      });
    }

    // Current month progress
    const curMY = currentMonthYear();
    const curMonth = monthly().find(m => m.Month_Year === curMY);
    if (curMonth) {
      const targets  = tgts();
      const total    = _n(curMonth['TOTAL']); // ← correct field
      const tgt      = _n(targets[curMY]);
      const pct      = tgt > 0 ? Math.round((total / tgt) * 100) : null;
      let badge = '', badgeClass = 'cmdhub-badge';
      if (pct !== null) {
        badge = pct + '%';
        if (pct >= 100) badgeClass = 'cmdhub-badge cmdhub-badge-green';
        else if (pct >= 80) badgeClass = 'cmdhub-badge cmdhub-badge-blue';
        else if (pct >= 60) badgeClass = 'cmdhub-badge cmdhub-badge-amber';
        else badgeClass = 'cmdhub-badge cmdhub-badge-red';
      }

      ctx.push({
        id: 'ctx-curmonth', cat: 'month', icon: '📅',
        title: curMY,
        sub: `Total: ${fmtAmt(total)}${tgt ? ' · Target: ' + fmtAmt(tgt) : ''}`,
        badge, badgeClass,
        action: () => {
          closePalette();
          if (typeof global.showPage === 'function') global.showPage('report');
          setTimeout(() => {
            // openMonthModal(my) — pass Month_Year STRING
            if (typeof global.openMonthModal === 'function') global.openMonthModal(curMY);
          }, 100);
        },
        qActions: [],
      });
    }

    if (ctx.length) groups.push({ label: 'Quick Access', items: ctx });

    // ── Suggested commands ────────────────────────────────────────
    const CMD_SUGGESTIONS = ['nav-dashboard','nav-entry','nav-report','mgr-salary','exp-csv-daily'];
    const allCmds = getCachedCommands();
    const suggestedCmds = CMD_SUGGESTIONS
      .map(id => allCmds.find(c => c.id === id)).filter(Boolean);

    if (suggestedCmds.length) {
      groups.push({
        label: 'Commands',
        items: suggestedCmds.map(cmd => ({
          id: cmd.id, cat: 'cmd', icon: cmd.icon,
          title: cmd.title, sub: cmd.sub,
          badge: '', badgeClass: 'cmdhub-badge',
          action: cmd.action, qActions: [],
        })),
      });
    }

    return groups;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MAIN SEARCH  (debounced, runs on every keystroke)
  ═══════════════════════════════════════════════════════════════════════ */
  function runSearch(q) {
    if (!q.trim()) { renderGroups(buildSuggestions()); return; }

    const allCmds = getCachedCommands();
    const cmdMatches = allCmds
      .map(c => ({ c, sc: Math.max(score(c.title, q), score(c.sub, q), score(c.tags.join(' '), q)) }))
      .filter(x => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 5)
      .map(x => ({
        id: x.c.id, cat: 'cmd', icon: x.c.icon,
        title: x.c.title, sub: x.c.sub,
        badge: '', badgeClass: 'cmdhub-badge',
        action: x.c.action, qActions: [],
      }));

    const daily_   = searchDaily(q);
    const monthly_ = searchMonthly(q);
    const yearly_  = searchYearly(q);
    const staff_   = searchStaff(q);

    const groups = [];
    if (cmdMatches.length) groups.push({ label: 'Commands',         items: cmdMatches });
    if (daily_.length)     groups.push({ label: 'Daily Records',    items: daily_ });
    if (monthly_.length)   groups.push({ label: 'Monthly Reports',  items: monthly_ });
    if (yearly_.length)    groups.push({ label: 'Yearly Summaries', items: yearly_ });
    if (staff_.length)     groups.push({ label: 'Staff',            items: staff_ });

    renderGroups(groups);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════ */
  function renderGroups(groups) {
    const list = el('cmdhub-results');
    if (!list) return;

    _allItems  = [];
    _activeIdx = -1;

    const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
    if (!totalItems) {
      list.innerHTML = `
        <div class="cmdhub-empty">
          <div class="cmdhub-empty-icon">🔍</div>
          <div class="cmdhub-empty-text">No results found</div>
          <button onclick="(function(){var q=document.getElementById('cmdhub-input')&&document.getElementById('cmdhub-input').value||'';CommandHub.close();setTimeout(function(){if(typeof showPage==='function')showPage('commandhub');},100);})()"
            style="margin-top:12px;padding:9px 20px;border-radius:20px;border:1.5px solid #dbeafe;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:600;cursor:pointer;">
            🤖 Ask AI instead
          </button>
        </div>`;
      return;
    }

    let html = '';
    for (const group of groups) {
      html += `<div class="cmdhub-group-header">${esc(group.label)}</div>`;
      for (const item of group.items) {
        _allItems.push(item);
        html += renderItem(item, _allItems.length - 1);
      }
    }
    list.innerHTML = html;

    // Bind click events (done after innerHTML so DOM nodes exist)
    list.querySelectorAll('.cmdhub-item').forEach((node, idx) => {
      node.addEventListener('click', e => {
        if (e.target.classList.contains('cmdhub-qa')) return; // handled below
        e.stopPropagation();
        const item = _allItems[idx];
        if (item && typeof item.action === 'function') item.action();
      });

      node.querySelectorAll('.cmdhub-qa').forEach((btn, qi) => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const item = _allItems[idx];
          if (item && item.qActions && item.qActions[qi])
            item.qActions[qi].fn();
        });
      });
    });
  }

  function renderItem(item, idx) {
    const iconClass = ({
      cmd:    'cmdhub-icon-cmd',
      daily:  'cmdhub-icon-daily',
      month:  'cmdhub-icon-month',
      year:   'cmdhub-icon-year',
      staff:  'cmdhub-icon-staff',
      recent: 'cmdhub-icon-recent',
    })[item.cat] || 'cmdhub-icon-cmd';

    const badge = item.badge
      ? `<span class="${esc(item.badgeClass || 'cmdhub-badge')}">${esc(item.badge)}</span>`
      : '';

    const qaButtons = (item.qActions || [])
      .map(qa => `<button class="cmdhub-qa">${esc(qa.label)}</button>`)
      .join('');

    return `
      <div class="cmdhub-item" data-idx="${idx}" role="option">
        <div class="cmdhub-icon ${iconClass}">${item.icon}</div>
        <div class="cmdhub-item-body">
          <div class="cmdhub-item-title">${esc(item.title)}</div>
          ${item.sub ? `<div class="cmdhub-item-sub">${esc(item.sub)}</div>` : ''}
        </div>
        <div class="cmdhub-item-right">
          ${badge}
          ${qaButtons ? `<div class="cmdhub-qactions">${qaButtons}</div>` : ''}
        </div>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     KEYBOARD NAVIGATION
  ═══════════════════════════════════════════════════════════════════════ */
  function setActive(idx) {
    const list = el('cmdhub-results');
    if (!list) return;
    const nodes = list.querySelectorAll('.cmdhub-item');
    nodes.forEach(nd => nd.classList.remove('cmdhub-active')); // 'nd' not 'n' to avoid shadowing
    _activeIdx = Math.max(-1, Math.min(nodes.length - 1, idx));
    if (_activeIdx >= 0) {
      nodes[_activeIdx].classList.add('cmdhub-active');
      nodes[_activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  function handleKey(e) {
    if (!_isOpen) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openPalette();
      }
      return;
    }
    switch (e.key) {
      case 'Escape':   e.preventDefault(); closePalette(); break;
      case 'ArrowDown':e.preventDefault(); setActive(_activeIdx + 1); break;
      case 'ArrowUp':  e.preventDefault(); setActive(_activeIdx > 0 ? _activeIdx - 1 : -1); break;
      case 'Enter':
        e.preventDefault();
        const target = _activeIdx >= 0 ? _allItems[_activeIdx] : _allItems[0];
        if (target && typeof target.action === 'function') target.action();
        break;
      case 'Tab':
        e.preventDefault();
        setActive(e.shiftKey
          ? (_activeIdx > 0 ? _activeIdx - 1 : _allItems.length - 1)
          : (_activeIdx + 1 < _allItems.length ? _activeIdx + 1 : 0));
        break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     OPEN / CLOSE
  ═══════════════════════════════════════════════════════════════════════ */
  function openPalette() {
    if (_isOpen) return;
    // Check DOM BEFORE flipping the flag — avoids stuck-open state if init failed
    const overlay = el('cmdhub-overlay');
    const input   = el('cmdhub-input');
    if (!overlay || !input) return;

    _cachedCommands = null; // reset so commands are always fresh on each open
    _isOpen = true;
    overlay.classList.add('cmdhub-open');
    document.body.style.overflow = 'hidden'; // lock background scroll on mobile

    requestAnimationFrame(() => {
      input.value = '';
      const clearBtn = el('cmdhub-clear');
      if (clearBtn) clearBtn.classList.add('cmdhub-hidden');
      input.focus();
      renderGroups(buildSuggestions());
    });
  }

  function closePalette() {
    if (!_isOpen) return;
    _isOpen = false;
    const overlay = el('cmdhub-overlay');
    if (overlay) overlay.classList.remove('cmdhub-open');
    document.body.style.overflow = ''; // restore scroll
    if (document.activeElement && document.activeElement !== document.body)
      document.activeElement.blur();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DOM HELPER
  ═══════════════════════════════════════════════════════════════════════ */
  function el(id) { return document.getElementById(id); }

  /* ═══════════════════════════════════════════════════════════════════════
     INIT — inject CSS + HTML once, bind all events
  ═══════════════════════════════════════════════════════════════════════ */
  function init() {
    if (document.getElementById('cmdhub-overlay')) return; // already initialised

    // CSS
    const style = document.createElement('style');
    style.id = 'cmdhub-style';
    style.textContent = STYLE;
    document.head.appendChild(style);

    // HTML — use querySelector (not firstElementChild) to get elements reliably
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="cmdhub-overlay" class="cmdhub-overlay"
           role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdhub-panel">

          <div class="cmdhub-searchbar">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input id="cmdhub-input" class="cmdhub-input"
              type="text"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              placeholder="Search records, run commands…"
              aria-label="Search" aria-autocomplete="list" aria-controls="cmdhub-results">
            <button class="cmdhub-clear cmdhub-hidden" id="cmdhub-clear"
                    title="Clear" aria-label="Clear search">✕</button>
          </div>

          <div id="cmdhub-results" class="cmdhub-results"
               role="listbox" aria-label="Search results"></div>

          <div class="cmdhub-footer" aria-hidden="true">
            <span class="cmdhub-hint">
              <span class="cmdhub-kbd">↑</span><span class="cmdhub-kbd">↓</span> navigate
            </span>
            <span class="cmdhub-hint"><span class="cmdhub-kbd">↵</span> open</span>
            <span class="cmdhub-hint"><span class="cmdhub-kbd">Esc</span> close</span>
            <span style="margin-left:auto">
              <button onclick="CommandHub.close();setTimeout(function(){if(typeof showPage==='function')showPage('commandhub');},80)"
                style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:12px;border:1px solid #dbeafe;background:#eff6ff;color:#1d4ed8;cursor:pointer;">
                🤖 Ask AI
              </button>
            </span>
          </div>
        </div>
      </div>
    `;

    // Grab by ID — immune to whitespace/comment nodes
    document.body.appendChild(wrapper.querySelector('#cmdhub-overlay'));
    // Floating search FAB removed per user request (Ctrl+K / toolbar link still open the palette)

    // ── Events ──────────────────────────────────────────────────
    document.addEventListener('keydown', handleKey);

    const input    = el('cmdhub-input');
    const clearBtn = el('cmdhub-clear');
    const overlay  = el('cmdhub-overlay');
    const fab      = null;

    input.addEventListener('input', () => {
      const q = input.value;
      clearBtn.classList.toggle('cmdhub-hidden', !q);
      clearTimeout(_debounce);
      _debounce = setTimeout(() => runSearch(q), 60);
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('cmdhub-hidden');
      input.focus();
      renderGroups(buildSuggestions());
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) closePalette(); });

    if (fab) fab.addEventListener('click', openPalette);

    // Mobile swipe-down on backdrop to close
    overlay.addEventListener('touchstart', e => {
      _touchStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchmove', e => {
      if (e.touches[0].clientY - _touchStartY > 60) closePalette();
    }, { passive: true });

    // Stop panel scroll from triggering the backdrop swipe
    const panel = overlay.querySelector('.cmdhub-panel');
    if (panel) panel.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });

    // Mouse hover → highlight item
    el('cmdhub-results').addEventListener('mouseover', e => {
      const item = e.target.closest('.cmdhub-item');
      if (!item) return;
      const idx = parseInt(item.dataset.idx, 10);
      if (!isNaN(idx)) setActive(idx);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUTO-INIT
  ═══════════════════════════════════════════════════════════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init(); // DOM already ready (script is after all other scripts)
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════════════ */
  global.CommandHub = {
    open:  openPalette,
    close: closePalette,
    clearRecent: () => { try { localStorage.removeItem(RECENT_KEY); } catch (_) {} },
  };

})(window);
