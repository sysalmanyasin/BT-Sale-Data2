/* ════════════════════════════════════════════════════════════════════
   daily-checklist.js — Sales domain › Daily Check List
   Port of Fazal Din's Pharma Plus "Daily Check List" (reports.duapharma.com)
   as a native page, sitting beside Sale Report in the Sale Data sub-nav.

   • Classic IIFE + window bridge (same pattern as the other classic files).
   • Every section / item / default / report layout is carried over unchanged.
   • Stocks Report + sale figures are PRE-FILLED from DAILY (read-only access).
   • Drafts are stored per date under ONE key (bt_daily_checklist_v1) — a
     UI-local draft store, same category as stockledger.js / excess-working.js
     (listed under "Known gaps" in the README). Not business data.

   ASSUMPTIONS TO VERIFY (all isolated in the CONFIG block below):
     1. DAILY is imported from ./config.js (array of day rows).
     2. Day rows use the same keys as the Daily Data column picker
        ("Cash Sale", "HBL", "PSO Returns", "Customers", "TOTAL" …).
     3. The row's date lives in Date / date / DATE (ISO, dd-mm-yyyy or Date).
     4. Print.renderNewTab(html,opts) exists; otherwise a Blob-tab fallback is used.
     5. Sale figures come from window.dayData (reports.js) when present, so they match the Sale Report.
   ════════════════════════════════════════════════════════════════════ */
import { DAILY } from './config.js';

(function () {
'use strict';

/* ── CONFIG ─────────────────────────────────────────────────────── */
var KEY = 'bt_daily_checklist_v1';
var ROOT_ID = 'page-dailychecklist';
var DATE_KEYS = ['Date', 'date', 'DATE'];
var MAP = {
  cash:      ['Cash Sale', 'Alfala Bank', 'Bank Al Habib', 'Meezan Bank (Paysa)', 'HBL', 'MCB'],
  cashRet:   ['Cash Returns'],
  credit:    ['Askari Bank', 'PSO', 'NESPAK', 'PARCO', 'TEPA', 'LDA', 'F/Issue', 'Gourmet', 'Wapda Hospital', 'BTH',
              'Berger Paints', 'Ecolean PK', 'Style Textile', 'Syed Babar Ali Foundation', 'Rahnuma NGO', 'Health Pass',
              'Nisar Spinning Mills', 'Food Panda'],
  creditRet: ['Askari Bank Returns', 'PSO Returns', 'NESPAK Returns', 'PARCO Returns', 'TEPA Returns', 'LDA Returns'],
  total: 'TOTAL', customers: 'Customers'
};

/* ── ORIGINAL CHECKLIST CONTENT (unchanged) ─────────────────────── */
var SEC = [
  { id: 's1', n: '1', t: 'Branch', it: [['1', 'Branch:', 'Bahria Town']] },
  { id: 's2', n: '2', t: 'Customer Dealing & Checking', it: [
    ['2', 'a) Customer Dealing By Officers:', 'Yes, By Co Manager & Pharmacist'],
    ['', 'b) Checking of medicines by checker before handing over to customer', 'Yes, SSO is at Packing']] },
  { id: 's3', n: '3', t: 'Staff Appearance', g: '3', it: [
    ['', 'a) Staff Shave', 'Ok'], ['', 'b) Overalls', 'Ok'], ['', 'c) Name Tags', 'Ok'],
    ['', 'd) Staff Search', 'Yes, Ok'], ['', 'e) Dusting of consumer items in customer area', 'Yes, Done']] },
  { id: 's4', n: '4', t: 'Strengths & Variants', it: [
    ['4', 'Medicine with different strengths and variants placed separately.', 'Working continues / More Shelves Required']] },
  { id: 's5', n: '5', t: 'Generics & Alternative Promotion', it: [
    ['5', 'Generics promotion by pharmacist', 'Yes (12/33)'], ['', '(ALTERNATIVE INVOICE PROMOTION)', 'Yes (03/13)']] },
  { id: 's6', n: '6', t: 'Stationery Availability', g: '6', it: [
    ['', 'a) Brown Bags / Non Woven Bags', 'Ok'], ['', 'b) Printer Paper', 'Ok'], ['', 'c) Tag guns & Rolls', 'Ok'],
    ['', 'd) N/A Register', 'Yes, Maintained']] },
  { id: 's7', n: '7–15', t: 'Daily Operations', it: [
    ['7', 'Generator Status with Codes/ Working Hours:', 'Yes, FDPP G 01 12 Hrs'],
    ['8', 'Returns are being checked / Verified by manager:', 'Yes, Entered and Verified'],
    ['9', 'Home Delivery Service Entered in Google Drive on Daily Basis:', 'Yes'],
    ['10', 'Stocks are placed as per (First in First Out) FIFO', 'Yes, Fifo followed'],
    ['11', 'Stock from Warehouse entered in computer under personal supervision:', 'Yes: Stock Entered'],
    ['12', 'All supply cartons dispatched sealed/signed', 'Yes'],
    ['13', 'Cash Deposit Slips by Webcam Emailed:', 'Yes'],
    ["14", "Customer's ID card numbers Entered for Bills of Rs.50,000 or more", 'No Bill'],
    ['15', 'Any supply issue:', 'No Major Supply Issues']] },
  { id: 's16', n: '16', t: 'Repair & Maintenance', g: '16', it: [
    ['', 'a) Lights', 'Ok'], ['', 'b) A/C Filter clean', 'Ok'], ['', 'c) Sign Board', 'Ok'],
    ['', 'd) Fire Extinguishers', 'Ok'], ['', 'e) Any repair request', 'Ok']] },
  { id: 's17', n: '17', t: 'Price Check', g: '17', it: [
    ['', 'a) Computer price verification', 'Ok'], ['', 'b) Tags on Consumer Item', 'Ok'],
    ['', 'c) Any price changes in warehouse supply.', 'Ok']] },
  { id: 's18', n: '18', t: 'Narcotics Record', g: '18', it: [
    ['', 'a) Manual Narcotics register updated.', 'Yes'],
    ['', 'b) Narcotics updated in the system at the time of sale.', 'Yes'],
    ['', 'c) Manual Schedule-D register updated.', 'Yes'],
    ['', 'd) Schedule-D updated in system at the time of sale.', 'Yes'],
    ['', 'e) Scanning of Prescription.', 'Yes']] },
  { id: 's19', n: '19–22', t: 'Daily Figures', it: [
    ['19', 'Number of prescriptions entered yesterday?', '22 Prescriptions'],
    ['20', 'Expiry / Near Expiry', '28500'], ['21', 'Night Video viewing Time', '12:30 PM'],
    ['22', 'Inspection Register Available at Pharmacy or Not', 'No']] }
];
var TBL = [
  { id: 'mc', n: '25–27', t: 'Manual cash bill and Credit sales', it: [
    ['25', 'Marketing:', 'Dr Saira Taj (Dermatologist)'],
    ['26', 'Manual cash memo entered in computer or not', 'Book Pending Value: 890'],
    ['27', 'Credit sales entered in the computer before handing medicine', 'Yes: All Bills entered at time of Handing Medicines']] },
  { id: 'rpo', n: '28–31', t: 'RPO and Short excess status', it: [
    ['28', 'Value of plus items', '-2211'], ['28 A', 'RPOs Status', '', 1], ['28 B', 'RPO Reviewed Carefully', 'Yes/No'],
    ['29 C', 'Any amendment in RPOs', 'Yes/No'], ['30', 'Short & Excess Values of Randoms', '-2211'],
    ['31', 'Number of customers discount given after approval.', '18']] }
];
var COMP_DEF = [
  ["Fazal Din's Pharma Plus", '2.1 Crore', '500-550K', '17 Million +'],
  ['Green Plus Pharmacy', '4.5 to 5 Crore', '1200-1400K', '40 Million +'],
  ['Servaid Pharmacy', '1 to 1.2 Crore', '260-300K', '8-9 Million'],
  ['Ren Pharmacy', '70 Lac to 90 Lac', '250-260K', '7-8 Million'],
  ['Waseela Pharmacy (Safari Mall)', '30-40 Lac', '100-120K', '3-4 Million']
];
var META_DEF = { branch: 'Bahria Town', preparedby: 'Salman Yasin', designation: 'Co Manager', contact: '0302-8496090' };

/* ── helpers ────────────────────────────────────────────────────── */
var root = null, built = false, saveTimer = null;
var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var $ = function (id) { return document.getElementById('dcl-' + id); };
var val = function (id) { var e = $(id); return e ? e.value : ''; };
var num = function (id) { var v = parseFloat(val(id)); return isNaN(v) ? 0 : v; };
var has = function (id) { var v = val(id).trim(); return v !== '' && !isNaN(parseFloat(v)); };
var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
var r2 = function (x) { return Math.round(x * 100) / 100; };
var todayIso = function () { var d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
var toast = function (m) { if (typeof window.toast === 'function') return window.toast(m, 'info'); var t = $('toast'); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2200); };

function fmtDateNice(iso) { if (!iso) return '—'; var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtTimeNice(t) { if (!t) return '—'; var p = t.split(':').map(Number); if (isNaN(p[0])) return t; return ((p[0] + 11) % 12 + 1) + ':' + String(p[1]).padStart(2, '0') + ' ' + (p[0] >= 12 ? 'PM' : 'AM'); }
function fmtDateShort(iso) { if (!iso) return ''; var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso; return String(d.getDate()).padStart(2, '0') + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + '-' + String(d.getFullYear()).slice(2); }

/* ── app data adapter (read-only) ───────────────────────────────── */
function rowIso(r) {
  var v; for (var i = 0; i < DATE_KEYS.length; i++) { if (r && r[DATE_KEYS[i]] != null) { v = r[DATE_KEYS[i]]; break; } }
  if (v == null) return '';
  if (v instanceof Date) return new Date(v - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  var d = new Date(s); return isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function findDay(iso) {
  var D = DAILY; if (!D || !D.length) return null;
  for (var i = D.length - 1; i >= 0; i--) if (rowIso(D[i]) === iso) return D[i];
  return null;
}
function sumKeys(r, keys) { return keys.reduce(function (a, k) { var v = parseFloat(String(r[k] == null ? 0 : r[k]).replace(/,/g, '')); return a + (isNaN(v) ? 0 : v); }, 0); }

function prefill(force) {
  var iso = val('pull_date') || val('m_date'), note = $('appnote');
  var r = findDay(iso);
  if (!r) { if (note) note.textContent = 'No sale entry in app for ' + fmtDateNice(iso); if (force) toast('No sale entry found for ' + fmtDateNice(iso)); return false; }
  // Use the Sale Report's own calculation (window.dayData, reports.js) so figures always match it —
  // including custom fields such as "Bank Alfalah 2". Falls back to the CONFIG column lists.
  var cashNet, credNet, cashRet, credRet, dd = null;
  if (typeof window.dayData === 'function') { try { dd = window.dayData(r); } catch (e) { dd = null; } }
  if (dd && typeof dd.netCash === 'number') {
    cashNet = dd.netCash; credNet = dd.netCredit;
    cashRet = Math.abs(dd.cashRet || 0);
    credRet = Math.abs((dd.askariRet || 0) + (dd.psoRet || 0) + (dd.nespakRet || 0) + (dd.parcoRet || 0) + (dd.tepaRet || 0) + (dd.ldaRet || 0));
  } else {
    cashRet = sumKeys(r, MAP.cashRet); credRet = sumKeys(r, MAP.creditRet);
    cashNet = sumKeys(r, MAP.cash) - cashRet; credNet = sumKeys(r, MAP.credit) - credRet;
  }
  // Checklist treats sale figures as NET of returns; returns are reference only.
  var set = function (id, v) { var e = $(id); if (!e) return; if (!force && e.value !== '') return; e.value = String(r2(v)); e.classList.add('dcl-fromapp'); };
  set('s_cashsale', cashNet);
  set('s_cashreturn', cashRet);
  set('s_creditsale', credNet);
  set('s_creditreturn', credRet);
  var appTotal = sumKeys(r, [MAP.total]), cust = sumKeys(r, [MAP.customers]);
  var net = num('s_cashsale') + num('s_creditsale');
  if (note) note.innerHTML = '✓ From app (' + fmtDateNice(iso) + '): TOTAL ₨ ' + fmt(appTotal) + ' · Customers ' + fmt(cust) +
    (appTotal && Math.abs(appTotal - net) > 0.5 ? ' · <b>Δ vs net ' + fmt(r2(appTotal - net)) + '</b>' : '');
  calcAll(); queueSave(); progress();
  return true;
}

/* ── page markup ────────────────────────────────────────────────── */
function item(i) {
  return '<div class="dcl-item" data-no="' + esc(i[0]) + '" data-label="' + esc(i[1]) + '"><div class="dcl-label">' +
    (i[0] ? '<span class="dcl-no">' + esc(i[0]) + '</span>' : '') + esc(i[1]) + '</div><input type="text" data-def="' + esc(i[2]) +
    '" value="' + esc(i[2]) + '" aria-label="' + esc(i[1]) + '"' + (i[3] ? ' data-optional="1"' : '') + '></div>';
}
function wrap(id, n, t, attrs, body) {
  return '<section class="dcl-sec" id="dcl-sec-' + id + '" data-title="' + esc(t) + '" ' + attrs + '><div class="dcl-sec-head"><span class="dcl-num">' + n +
    '</span><h2>' + esc(t) + '</h2></div><div class="dcl-body">' + body + '</div></section>';
}
function stat(id, label, cls, ro) { return '<div class="dcl-stat ' + (cls || '') + '"><label>' + label + '</label><input id="dcl-' + id + '" type="' + (ro ? 'text' : 'number') + '"' + (ro ? ' readonly' : '') + ' aria-label="' + esc(label) + '"></div>'; }
function plain(id, label, extra) { return '<div class="dcl-item"><div class="dcl-label">' + label + '</div><input id="dcl-' + id + '" ' + (extra || 'type="text"') + ' aria-label="' + esc(label) + '"></div>'; }

function pageHtml() {
  var h = '<div class="dcl-toolbar"><div class="dcl-tl"><span class="dcl-save" id="dcl-savepill"><i></i><span id="dcl-savetext">Saved</span></span></div><div class="dcl-tr">' +
    '<button class="dcl-btn" data-act="next">↓ <span>Next incomplete</span></button><button class="dcl-btn" data-act="reset">↺ <span>Reset day</span></button>' +
    '<button class="dcl-btn" data-act="copy">⧉ <span>Copy</span></button><button class="dcl-btn" data-act="print">🖶 <span>Print</span></button>' +
    '<button class="dcl-btn dcl-primary" data-act="email">✉ <span>Email</span></button></div></div>' +
    '<div class="dcl-progress"><div class="dcl-track"><div class="dcl-fill" id="dcl-fill"></div></div><div class="dcl-plabel" id="dcl-plabel"></div></div>' +
    '<div class="dcl-meta">' +
    [['branch', 'Branch', 'text'], ['preparedby', 'Prepared By', 'text'], ['designation', 'Designation', 'text'], ['date', 'Date', 'date'], ['time', 'Time', 'time'], ['contact', 'Contact', 'text']]
      .map(function (f) { return '<div class="dcl-mf"><label>' + f[1] + '</label><input id="dcl-m_' + f[0] + '" type="' + f[2] + '"></div>'; }).join('') + '</div>' +
    '<div class="dcl-wrap"><nav class="dcl-rail" id="dcl-rail"><div class="dcl-rail-title">Jump to</div></nav><div class="dcl-main">';
  SEC.forEach(function (s) { h += wrap(s.id, s.n, s.t, 'data-chk="1"' + (s.g ? ' data-group="' + esc(s.t) + '" data-groupno="' + s.g + '"' : ''), s.it.map(item).join('')); });

  h += wrap('stocks', '24', 'Stocks Report', '',
    '<div class="dcl-pull"><label>Pull sales from app for</label><input type="date" id="dcl-pull_date"><button class="dcl-btn" data-act="pull" type="button">↻ Re-pull</button></div><div class="dcl-appnote" id="dcl-appnote"></div>' +
    '<div class="dcl-g2">' + stat('s_opening', 'Opening stock (A) — auto', 'ro', 1) + stat('s_receive', 'Stock receive from warehouse (B)') + '</div>' +
    '<div style="margin-top:12px">' + stat('s_totalhand', 'Total stock in hand (A+B)', 'ro', 1) + '</div>' +
    '<div class="dcl-sub"><b>Daily sales (C)</b><i>Figures already net of returns</i></div>' +
    '<div class="dcl-g2">' + stat('s_cashsale', 'Cash sale') + stat('s_creditsale', 'Credit sale') + '</div>' +
    '<div class="dcl-sub"><b>Returns</b><i>Shown as negative in the report</i></div>' +
    '<div class="dcl-g2">' + stat('s_cashreturn', 'Cash sale return', 'ref') + stat('s_creditreturn', 'Credit sale return', 'ref') + '</div>' +
    '<div class="dcl-g2" style="margin-top:16px">' + stat('s_returntotal', 'Cash + credit return total', 'ref', 1) + stat('s_nettotal', 'Net total (C) = Cash + Credit', 'ro', 1) + '</div>' +
    '<div class="dcl-g2" style="margin-top:16px">' + stat('s_closing', 'Closing stock position (enter)') + stat('s_homeservice', 'Daily home service') + '</div>' +
    '<div class="dcl-g3" style="margin-top:16px">' + stat('s_homecount', 'Home service no. of customers') + stat('s_drivesales', 'Drive thru customers sales') + stat('s_drivecount', 'No. of drive thru customers') + '</div>' +
    '<div class="dcl-g3" style="margin-top:16px">' + stat('c_cash', 'Cash customers') + stat('c_panel', 'Panel customers') + stat('c_total', 'Total number of customers', 'ro', 1) + '</div>' +
    '<div style="margin-top:12px">' + plain('s_negstock', 'Current stocks negative value', 'type="number"') + '</div>');

  TBL.forEach(function (s) { h += wrap(s.id, s.n, s.t, 'data-tbl="1" data-tbltitle="' + esc(s.t) + '"', s.it.map(item).join('')); });

  h += wrap('lt7', '32', 'Less than 7 Days Stock Report', '', plain('lt7_date', 'Date', 'type="date"') +
    '<div class="dcl-g3" style="margin-top:6px">' + stat('lt7_zero', 'Zero items') + stat('lt7_days', 'Less than 7 days') + stat('lt7_total', 'Total items', 'flag', 1) + '</div>');
  h += wrap('meter', '33', 'Electricity Meter Reading', '', plain('meter_ref', 'Meter reference number', 'type="text" data-def="BTL -14426" value="BTL -14426"') + plain('meter_reading', 'Meter reading', 'type="text" placeholder="—" data-optional="1"'));
  h += wrap('comp', '34', 'Competitor Sales', '', '<div class="dcl-tscroll"><table class="dcl-table" id="dcl-compTable"><thead><tr><th>Pharmacy or medical store</th><th>Stock value</th><th>Average per day</th><th>Total monthly sales</th></tr></thead><tbody></tbody></table></div><button class="dcl-btn dcl-add" data-act="addcomp" type="button">+ Add competitor</button>');
  h += wrap('notes', '✎', 'Notes', '', '<textarea id="dcl-notes" data-optional="1" placeholder="Additional remarks…" aria-label="Notes"></textarea>');
  h += wrap('sig', '✓', 'Sign-off', '', '<div class="dcl-sig"><div><div class="dcl-item dcl-nb"><div class="dcl-label"><b>Prepared by</b></div><span id="dcl-sig_name"></span></div><div class="dcl-item dcl-nb"><div class="dcl-label"><b>Designation</b></div><span id="dcl-sig_desig"></span></div><div class="dcl-item dcl-nb"><div class="dcl-label"><b>Branch</b></div><span id="dcl-sig_branch"></span></div></div><div class="dcl-sigline" id="dcl-sig_line"></div></div>');
  h += '</div></div><div class="dcl-snap"><div><span>Net Sales</span><b id="dcl-snap_net">—</b></div><div><span>Closing Stock</span><b id="dcl-snap_closing">—</b></div><div><span>Customers</span><b id="dcl-snap_cust">—</b></div><div><span>Flagged Items &lt;7d</span><b id="dcl-snap_flag">—</b></div></div><div class="dcl-toast" id="dcl-toast"></div>';
  return h;
}

function compRows(rows) {
  var tb = root.querySelector('#dcl-compTable tbody'); tb.innerHTML = '';
  rows.forEach(function (r) { addCompRow(r); });
}
function addCompRow(r) {
  var tb = root.querySelector('#dcl-compTable tbody'), tr = document.createElement('tr'); r = r || ['', '', '', ''];
  var ph = ['Store name', 'Stock value', 'Avg / day', 'Total / month'];
  tr.innerHTML = r.map(function (c, i) { return '<td><input placeholder="' + ph[i] + '" value="' + esc(c) + '"></td>'; }).join('');
  tb.appendChild(tr);
}

/* ── calculations (unchanged logic) ─────────────────────────────── */
function calcStock() {
  var hasClosing = has('s_closing'), closing = hasClosing ? parseFloat(val('s_closing')) : 0, receive = num('s_receive');
  var net = num('s_cashsale') + num('s_creditsale'), ret = num('s_cashreturn') + num('s_creditreturn');
  $('s_returntotal').value = fmt(ret); $('s_nettotal').value = fmt(net);
  var totalHand = r2(closing + net), opening = r2(totalHand - receive);   // Closing = (A+B) − C
  $('s_totalhand').value = hasClosing ? fmt(totalHand) : ''; $('s_opening').value = hasClosing ? fmt(opening) : '';
  $('snap_net').textContent = fmt(net); $('snap_closing').textContent = hasClosing ? fmt(closing) : '—';
}
function calcCust() { var t = num('c_cash') + num('c_panel'); $('c_total').value = fmt(t); $('snap_cust').textContent = fmt(t); }
function calcLt7() { var t = num('lt7_zero') + num('lt7_days'); $('lt7_total').value = fmt(t); $('snap_flag').textContent = fmt(t); }
function calcAll() { calcStock(); calcCust(); calcLt7(); syncSig(); }
function syncSig() {
  $('sig_name').textContent = val('m_preparedby'); $('sig_desig').textContent = val('m_designation');
  $('sig_branch').textContent = val('m_branch'); $('sig_line').textContent = val('m_preparedby');
}

/* ── progress / rail ────────────────────────────────────────────── */
function secProgress(sec) {
  var ins = [].slice.call(sec.querySelectorAll('input:not([type=date]):not([type=time]):not([readonly]):not([data-optional]), textarea:not([data-optional])'));
  if (!ins.length) return 1;
  return ins.filter(function (i) { return i.value.trim() !== ''; }).length / ins.length;
}
function progress() {
  var secs = [].slice.call(root.querySelectorAll('.dcl-sec')), done = 0;
  secs.forEach(function (s) {
    var p = secProgress(s), d = p >= 1; if (d) done++;
    s.querySelector('.dcl-sec-head').classList.toggle('done', d);
    var a = root.querySelector('.dcl-rail a[href="#' + s.id + '"]');
    if (a) { a.classList.toggle('done', d); a.classList.toggle('partial', !d && p > 0); }
  });
  $('fill').style.width = Math.round(done / secs.length * 100) + '%';
  $('plabel').textContent = done + ' of ' + secs.length + ' sections complete';
}
function buildRail() {
  var rail = $('rail');
  root.querySelectorAll('.dcl-sec').forEach(function (s) {
    var a = document.createElement('a'); a.href = '#' + s.id;
    a.innerHTML = '<i class="dcl-dot"></i><span class="dcl-rn">' + s.querySelector('.dcl-num').textContent + '</span><span>' + esc(s.dataset.title) + '</span>';
    a.addEventListener('click', function (e) { e.preventDefault(); s.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    rail.appendChild(a);
  });
}
function jumpNext() {
  var t = [].slice.call(root.querySelectorAll('.dcl-sec')).filter(function (s) { return secProgress(s) < 1; })[0];
  if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('Jumped to: ' + t.dataset.title); }
  else { root.scrollIntoView({ behavior: 'smooth' }); toast('All sections complete 🎉'); }
}

/* ── persistence: one key, per-date drafts ──────────────────────── */
function store() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function put(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
function collect() {
  var f = {}, comp = [];
  root.querySelectorAll('input[id],textarea[id]').forEach(function (e) { if (e.id.indexOf('dcl-m_') !== 0) f[e.id] = e.value; });
  root.querySelectorAll('#dcl-compTable tbody tr').forEach(function (tr) { comp.push([].map.call(tr.querySelectorAll('input'), function (i) { return i.value; })); });
  return { f: f, comp: comp };
}
function save() {
  var s = store(), iso = val('m_date');
  s.meta = {}; ['branch', 'preparedby', 'designation', 'contact'].forEach(function (k) { s.meta[k] = val('m_' + k); });
  s.days = s.days || {}; if (iso) s.days[iso] = collect();
  var ok = put(s); $('savetext').textContent = ok ? 'Saved' : 'Save failed';
}
function queueSave() { $('savetext').textContent = 'Saving…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }

function loadDay(iso) {
  root.querySelectorAll('input[id],textarea[id]').forEach(function (e) {
    if (e.id.indexOf('dcl-m_') === 0) return;
    e.value = e.hasAttribute('data-def') ? e.getAttribute('data-def') : ''; e.classList.remove('dcl-fromapp');
  });
  compRows(COMP_DEF);
  var d = (store().days || {})[iso];
  if (d) {
    Object.keys(d.f).forEach(function (id) { var e = document.getElementById(id); if (e) e.value = d.f[id]; });
    if (d.comp && d.comp.length) compRows(d.comp);
  }
  if (!val('pull_date')) $('pull_date').value = iso;
  $('appnote').textContent = '';
  prefill(false);                      // fills only empty stock fields — never clobbers manual edits
  calcAll(); progress();
}

/* ── report model + builders (layout unchanged) ─────────────────── */
function collectModel() {
  var m = { branch: val('m_branch'), rows: [], extra: [], stock: [], lt7: [], meter: [], comp: [], notes: '' };
  root.querySelectorAll('.dcl-sec[data-chk]').forEach(function (sec) {
    if (sec.dataset.group) m.rows.push({ type: 'group', no: sec.dataset.groupno, title: sec.dataset.group });
    sec.querySelectorAll('.dcl-item').forEach(function (it) { m.rows.push({ type: 'item', no: it.dataset.no || '', label: it.dataset.label || '', val: it.querySelector('input').value }); });
  });
  root.querySelectorAll('.dcl-sec[data-tbl]').forEach(function (sec) {
    var rows = []; sec.querySelectorAll('.dcl-item').forEach(function (it) { rows.push({ no: it.dataset.no || '', label: it.dataset.label || '', val: it.querySelector('input').value }); });
    m.extra.push({ title: sec.dataset.tbltitle, rows: rows });
  });
  var negify = function (n) { var x = Math.abs(n); return x ? '-' + x : '0'; };
  var v = function (id) { return has(id) ? String(parseFloat(val(id))) : ''; };
  var nv = function (id) { return has(id) ? negify(num(id)) : ''; };
  var net = num('s_cashsale') + num('s_creditsale'), hasNet = has('s_cashsale') || has('s_creditsale');
  var hasRet = has('s_cashreturn') || has('s_creditreturn'), retTotal = Math.abs(num('s_cashreturn')) + Math.abs(num('s_creditreturn'));
  var hasClosing = has('s_closing'), totalHand = r2(num('s_closing') + net);
  var S = function (label, value, bold, ul) { m.stock.push({ label: label, val: String(value), bold: !!bold, underline: !!ul }); };
  S('Opening Stock Position: (A)', hasClosing ? r2(totalHand - num('s_receive')) : '', true);
  S('Stock Receive from Warehouse: (B)', v('s_receive'), true);
  S('Total Stock in Hand: (A+B)', hasClosing ? totalHand : '', true);
  m.stock.push({ type: 'group', title: 'Daily Sales (C)' });
  S('Cash Sale:', v('s_cashsale')); S('Cash Sale Return:', nv('s_cashreturn')); S('Credit Sale:', v('s_creditsale')); S('Credit Sale Return:', nv('s_creditreturn'));
  S('Cash + Credit Return Total:', hasRet ? negify(retTotal) : ''); S('Net Total:', hasNet ? net : '', true, true);
  S('Closing Stock position: (A+B) -(C)', v('s_closing'), true);
  S('Daily Home Service', v('s_homeservice')); S('Home Service No of Customers', v('s_homecount'));
  S('Drive thru customers sales', v('s_drivesales')); S('No. of drive thru customers', v('s_drivecount'));
  S('Cash Customers', v('c_cash')); S('Panel Customers', v('c_panel'));
  S('Total Number of Customers', (has('c_cash') || has('c_panel')) ? num('c_cash') + num('c_panel') : '');
  m.negStock = val('s_negstock');
  m.lt7 = [['Date', fmtDateShort(val('lt7_date'))], ['Zero items', val('lt7_zero') === '' ? '' : num('lt7_zero')], ['Less than 7 Days', val('lt7_days') === '' ? '' : num('lt7_days')],
    ['Total items', (val('lt7_zero') === '' && val('lt7_days') === '') ? '' : num('lt7_zero') + num('lt7_days')]];
  m.meter = [['Meter Reference Number', val('meter_ref')], ['Meter Reading', val('meter_reading')]];
  root.querySelectorAll('#dcl-compTable tbody tr').forEach(function (tr) { var c = [].map.call(tr.querySelectorAll('input'), function (i) { return i.value; }); if (c.some(function (x) { return x.trim(); })) m.comp.push(c); });
  m.notes = (val('notes') || '').trim();
  return m;
}

function buildHtmlReport() {
  var m = collectModel();
  var FONT = 'font-family:Arial,Helvetica,sans-serif;', GREEN = '#2e7d65', TINT = '#e3eee8', CELL = '#f4f8f6', LIGHT = '#a8d08d', LINE = '#1b1b1b', W = 680;
  var cell = FONT + 'font-size:12px;line-height:16px;border:1px solid ' + LINE + ';padding:5px 8px;vertical-align:middle;';
  var head = function (t, w, x) { return '<td width="' + w + '" style="' + cell + 'width:' + w + 'px;background-color:' + GREEN + ';color:#fff;font-weight:bold;padding:7px 8px;' + (x || '') + '">' + esc(t) + '</td>'; };
  var tbl = function (w, inner) { return '<table cellpadding="0" cellspacing="0" border="1" width="' + w + '" style="border-collapse:collapse;border:1px solid ' + LINE + ';width:' + w + 'px;table-layout:fixed;' + FONT + 'font-size:12px;">' + inner + '</table>'; };
  var h1 = function (t) { return '<div style="' + FONT + 'font-size:14px;line-height:20px;font-weight:bold;color:#000;margin:0 0 6px 0;">' + esc(t) + '</div>'; };
  var h3 = function (t) { return '<div style="' + FONT + 'font-size:13px;line-height:18px;font-weight:bold;color:#000;margin:22px 0 6px 0;">' + esc(t) + '</div>'; };
  var o = '<div style="' + FONT + 'color:#000;">' + h1(m.branch) + h1('Checklist') + '<div style="height:10px;"></div>';
  var t = '<tr>' + head('No.', 50, 'text-align:center;') + head('Checklist item', 370) + head('Remarks', 260) + '</tr>', n = 0;
  m.rows.forEach(function (r) {
    if (r.type === 'group') { t += '<tr><td colspan="3" style="' + cell + 'background-color:' + TINT + ';">' + esc(r.no) + '&nbsp;&nbsp;' + esc(r.title) + '</td></tr>'; n = 0; }
    else { var bg = (n++ % 2) ? '#fff' : CELL; t += '<tr><td style="' + cell + 'text-align:left;">' + esc(r.no) + '</td><td style="' + cell + 'background-color:' + bg + ';">' + esc(r.label) + '</td><td style="' + cell + 'background-color:' + bg + ';text-align:center;font-weight:bold;">' + esc(r.val) + '</td></tr>'; }
  });
  o += tbl(W, t);
  var s = '<tr>' + head('Particulars', 300) + head('Response or value', 220, 'text-align:center;') + '</tr>';
  m.stock.forEach(function (r) {
    if (r.type === 'group') s += '<tr><td colspan="2" style="' + cell + 'background-color:' + TINT + ';font-weight:bold;">' + esc(r.title) + '</td></tr>';
    else s += '<tr><td style="' + cell + 'background-color:' + (r.underline ? TINT : CELL) + ';' + (r.bold ? 'font-weight:bold;' : '') + '">' + esc(r.label) + '</td><td style="' + cell + (r.underline ? 'background-color:' + TINT + ';' : '') + 'text-align:center;' + (r.bold ? 'font-weight:bold;' : '') + (r.underline ? 'text-decoration:underline;font-size:14px;' : '') + '">' + esc(r.val) + '</td></tr>';
  });
  o += h3('24 Stocks Report') + tbl(520, s) + '<div style="' + FONT + 'font-size:13px;font-weight:bold;margin-top:18px;">Current Stocks negative value</div><div style="' + FONT + 'font-size:13px;font-weight:bold;margin-top:6px;">' + esc(m.negStock) + '</div>';
  m.extra.forEach(function (x) {
    var lh = 'background-color:' + LIGHT + ';color:#000;', e = '<tr>' + head('No.', 50, 'text-align:center;' + lh) + head('Checklist item', 370, lh) + head('Remarks', 260, lh) + '</tr>';
    x.rows.forEach(function (r, i) { var bg = (i % 2) ? '#fff' : CELL; e += '<tr><td style="' + cell + 'text-align:center;">' + esc(r.no) + '</td><td style="' + cell + 'background-color:' + bg + ';">' + esc(r.label) + '</td><td style="' + cell + 'background-color:' + bg + ';text-align:center;font-weight:bold;">' + esc(r.val) + '</td></tr>'; });
    o += h3(x.title) + tbl(W, e);
  });
  var kv = function (title, pairs) {
    var k = '<tr>' + head('Particulars', 300) + head('Response or value', 220, 'text-align:center;') + '</tr>';
    pairs.forEach(function (p) { k += '<tr><td style="' + cell + 'background-color:' + CELL + ';">' + esc(p[0]) + '</td><td style="' + cell + 'text-align:center;font-weight:bold;">' + esc(p[1]) + '</td></tr>'; });
    return h3(title) + tbl(520, k);
  };
  o += kv('32 Less than 7 Days Stock Report', m.lt7) + kv('33 Electricity Meter Reading', m.meter);
  var c = '<tr>' + head('Pharmacy or medical store', 220) + head('Stock value', 150, 'text-align:center;') + head('Average per day', 150, 'text-align:center;') + head('Total monthly sales', 160, 'text-align:center;') + '</tr>';
  m.comp.forEach(function (r, i) { var bg = i % 2 ? '#fff' : CELL; c += '<tr><td style="' + cell + 'background-color:' + bg + ';font-weight:bold;">' + esc(r[0]) + '</td>' + [1, 2, 3].map(function (j) { return '<td style="' + cell + 'background-color:' + bg + ';text-align:center;">' + esc(r[j] || '') + '</td>'; }).join('') + '</tr>'; });
  o += h3('34 Competitor Sales') + tbl(W, c);
  if (m.notes) o += h3('Notes') + '<div style="' + FONT + 'font-size:12px;white-space:pre-wrap;">' + esc(m.notes) + '</div>';
  return o + '</div>';
}

function buildPlainText() {
  var m = collectModel(), o = m.branch + '\nChecklist\n\nNo.\tChecklist item\tRemarks\n';
  m.rows.forEach(function (r) { o += r.type === 'group' ? r.no + '  ' + r.title + '\n' : r.no + '\t' + r.label + '\t' + r.val + '\n'; });
  o += '\n24 Stocks Report\nParticulars\tResponse or value\n';
  m.stock.forEach(function (r) { o += r.type === 'group' ? r.title + '\n' : r.label + '\t' + r.val + '\n'; });
  o += '\nCurrent Stocks negative value\n' + m.negStock + '\n';
  m.extra.forEach(function (x) { o += '\n' + x.title + '\nNo.\tChecklist item\tRemarks\n'; x.rows.forEach(function (r) { o += r.no + '\t' + r.label + '\t' + r.val + '\n'; }); });
  o += '\n32 Less than 7 Days Stock Report\nParticulars\tResponse or value\n'; m.lt7.forEach(function (p) { o += p[0] + '\t' + p[1] + '\n'; });
  o += '\n33 Electricity Meter Reading\nParticulars\tResponse or value\n'; m.meter.forEach(function (p) { o += p[0] + '\t' + p[1] + '\n'; });
  o += '\n34 Competitor Sales\nPharmacy or medical store\tStock value\tAverage per day\tTotal monthly sales\n'; m.comp.forEach(function (r) { o += r.join('\t') + '\n'; });
  if (m.notes) o += '\nNotes: ' + m.notes + '\n';
  return o;
}

/* ── actions: copy / print / email / reset ──────────────────────── */
async function copyReport() {
  var html = buildHtmlReport(), text = buildPlainText();
  if (navigator.clipboard && window.ClipboardItem) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); toast('Copied — paste into Gmail to keep formatting'); return; } catch (e) { /* fall through */ }
  }
  try {
    var hd = document.createElement('div'); hd.contentEditable = 'true'; hd.style.cssText = 'position:fixed;left:-9999px;top:0'; hd.innerHTML = html; document.body.appendChild(hd);
    var rg = document.createRange(); rg.selectNodeContents(hd); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
    var ok = document.execCommand('copy'); sel.removeAllRanges(); document.body.removeChild(hd);
    if (ok) { toast('Copied — paste into Gmail to keep formatting'); return; }
  } catch (e) { /* fall through */ }
  try { await navigator.clipboard.writeText(text); toast('Copied as plain text'); } catch (e) { toast('Copy failed — select and copy manually'); }
}
function printReport() {
  var title = 'Daily Check List — ' + val('m_branch') + ' — ' + val('m_date');
  var head = '<div style="background:#123D25;color:#F3F6F2;padding:18px;text-align:center;border-radius:0 0 14px 14px;margin-bottom:14px;font-family:Arial,sans-serif"><div style="font-size:20px;font-weight:700">Fazal Din\'s Pharma Plus</div><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#B9C9BE">Daily Operations Check List</div><div style="margin-top:8px;font-size:12px">Branch: <b>' +
    esc(val('m_branch')) + '</b> • Date: <b>' + esc(fmtDateNice(val('m_date'))) + '</b> • Time: <b>' + esc(fmtTimeNice(val('m_time'))) + '</b> • Prepared by: <b>' + esc(val('m_preparedby')) + (val('m_designation') ? ', ' + esc(val('m_designation')) : '') + '</b></div></div>';
  var body = head + buildHtmlReport();
  // README: print.js is the only place window.print()/document.write() are touched.
  if (window.Print && typeof window.Print.renderNewTab === 'function') { window.Print.renderNewTab(body, { filename: title }); return; }
  var doc = '<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title><body style="margin:12px">' + body + '<script>onload=function(){setTimeout(function(){print()},300)}<\/script>';
  var w = window.open(URL.createObjectURL(new Blob([doc], { type: 'text/html' })), '_blank'); if (!w) toast('Allow pop-ups to print');
}
function emailReport() {
  location.href = 'mailto:?subject=' + encodeURIComponent('Daily Check List — ' + val('m_branch') + ' — ' + val('m_date')) + '&body=' + encodeURIComponent(buildPlainText());
}
function resetDay() {
  if (!confirm('Clear this day\'s saved checklist and start from the defaults? This cannot be undone.')) return;
  var s = store(), iso = val('m_date'); if (s.days) delete s.days[iso]; put(s);
  $('pull_date').value = ''; loadDay(iso); toast('Day reset');
}

/* ── lifecycle ──────────────────────────────────────────────────── */
function onMeta() { syncSig(); queueSave(); }
function build() {
  root = document.getElementById(ROOT_ID); if (!root) return false;
  root.classList.add('dcl-root'); root.innerHTML = pageHtml(); buildRail();
  var s = store(), meta = Object.assign({}, META_DEF, s.meta || {});
  ['branch', 'preparedby', 'designation', 'contact'].forEach(function (k) { $('m_' + k).value = meta[k]; });
  var d = new Date(); $('m_date').value = todayIso(); $('m_time').value = d.toTimeString().slice(0, 5);

  root.addEventListener('input', function (e) {
    var id = e.target.id || '';
    if (/^dcl-(s_|c_|lt7_)/.test(id)) { e.target.classList.remove('dcl-fromapp'); calcAll(); }
    if (id.indexOf('dcl-m_') === 0 && id !== 'dcl-m_date') syncSig();
    if (id !== 'dcl-m_date') queueSave(); progress();
  });
  $('m_date').addEventListener('change', function () { save(); $('pull_date').value = ''; loadDay(this.value); });
  $('pull_date').addEventListener('change', function () { prefill(true); });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    ({ next: jumpNext, reset: resetDay, copy: copyReport, print: printReport, email: emailReport,
       pull: function () { prefill(true); }, addcomp: function () { addCompRow(); queueSave(); } })[b.dataset.act]();
  });
  built = true; return true;
}
function show() {
  if (!built && !build()) return;
  var iso = val('m_date') || todayIso(); loadDay(iso); syncSig();
}
function onHash() { if (/^#dailychecklist/.test(location.hash)) show(); }
document.addEventListener('DOMContentLoaded', onHash);

window.loadDailyChecklistPage = show;     // call this from showPage('dailychecklist')
window.DailyChecklist = { show: show, prefill: prefill, buildHtmlReport: buildHtmlReport, buildPlainText: buildPlainText, collectModel: collectModel, _rowIso: rowIso };
})();
