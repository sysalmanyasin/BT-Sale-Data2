// SALE BOOK — Monthly / Yearly / All-Time Sale Book as a landscape A4 PDF.
// Buttons live in Tools > Print PDF Reports (index.html #tc-print). Rows come from DAILY (the
// same records Sale Report uses); the layout is js/sales/sale-book-pdf.js; the maths is the pure
// js/shared/sale-book-calc.js. Delivery goes through Print.renderDoc() (View / Download / Save).
import { registerActions } from '../shared/dom-actions.js';
import { DAILY } from '../platform/config.js';
import { Repository } from '../platform/repository.js';
import { Print } from '../lib/print.js';
import { buildRows, MONTH_NAMES } from '../shared/sale-book-calc.js';
import { buildSaleBookPdf } from './sale-book-pdf.js';

const say = (msg, kind) => { if (typeof window.toast === 'function') window.toast(msg, kind); };

// Custom fields (Manage Fields) are what makes "Banks" and "Credit Clients" include everything.
function customCols() {
  try { return JSON.parse(Repository.getItem('bt_custom_cols') || '[]'); } catch (e) { return []; }
}

function parseMonthYear(my) {
  const [name, yr] = String(my || '').trim().split(/\s+/);
  const m = MONTH_NAMES.findIndex((x) => x.toLowerCase() === String(name).toLowerCase());
  return m < 0 || !(+yr > 1999) ? null : { type: 'month', y: +yr, m };
}

function generate(scope) {
  if (!window.jspdf || !window.jspdf.jsPDF || typeof window.jspdf.jsPDF.API.autoTable !== 'function') {
    say('⚠ PDF library failed to load — check your connection.', 'e'); return;
  }
  const rows = buildRows(DAILY, customCols());
  if (!rows.length) { say('⚠ No sale data to put in a Sale Book', 'w'); return; }
  const generated = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  Print.renderDoc(() => buildSaleBookPdf({ jsPDF: window.jspdf.jsPDF, rows, scope, generated }), {});
}

function saleBookMonth() {
  const sel = document.getElementById('pr-month-sel');
  const scope = parseMonthYear(sel && sel.value);
  if (!scope) { say('⚠ Select a month', 'w'); return; }
  generate(scope);
}
function saleBookYear() {
  const sel = document.getElementById('pr-year-sel');
  const y = parseInt(sel && sel.value, 10);
  if (!(y > 1999)) { say('⚠ Select a year', 'w'); return; }
  generate({ type: 'year', y });
}
function saleBookAll() { generate({ type: 'all' }); }

registerActions({ saleBookMonth, saleBookYear, saleBookAll });
