// SALE BOOK PDF — builds the Monthly / Yearly / All-Time Sale Book as a real vector PDF
// (A4 landscape, jsPDF + jspdf-autotable text — not an html2canvas picture), so it stays
// crisp, searchable and small. Pure of the app: callers pass the jsPDF constructor and rows
// from js/shared/sale-book-calc.js; delivery (View / Download / Save to Library) is done by
// Print.renderDoc() in js/lib/print.js.
//
// Book layout
//   Monthly : cover summary  +  that month's daily register (one page)
//   Yearly  : cover summary  +  month-by-month summary  +  12 monthly registers
//   All Time: cover summary  +  year-by-year summary  +  per year: month summary + monthly registers
import {
  MONTH_NAMES, MONTH_SHORT, DAY_SHORT, fmtAmt, fmtShort, niceScale, summarize, weekdayAverages,
  monthCalendar, monthsInScope, rowsInScope, scopeTitle,
} from '../shared/sale-book-calc.js';

const PW = 297, PH = 210, M = 10, CW = PW - 2 * M;
const C = {
  navy: [16, 27, 45], teal: [24, 169, 153], tealDk: [14, 122, 110], amber: [242, 184, 75],
  slate: [70, 81, 102], ink: [30, 41, 59], line: [221, 227, 234], zebra: [247, 249, 251],
  soft: [240, 244, 248], green: [21, 128, 84], red: [196, 48, 48], white: [255, 255, 255],
  tealTint: [225, 244, 241], greenTint: [214, 240, 226], redTint: [252, 226, 226], grey: [140, 150, 165],
};
// Column widths sum to CW (277 mm).
const WIDTHS = [22, 12, 26, 22, 26, 26, 30, 28, 25, 18, 20, 22];
const HEAD = ['Date', 'Day', 'Cash', 'Cash\nReturns', 'Banks\n(incl. custom)', 'Credit Clients\n(incl. custom)',
  'Total\nSale', 'Computer\nSale', 'Sale\nDifference', 'Customers', 'FDPP POS\nSale', 'FDPP Consumer\nPOS Sale'];
const KEYS = ['cash', 'cashReturns', 'banks', 'credit', 'total', 'comp', 'diff', 'customers', 'fdpp', 'fdppCon'];
const SCOPE_NAME = { month: 'Monthly Sale Book', year: 'Yearly Sale Book', all: 'All-Time Sale Book' };

const rs = (v) => 'Rs ' + fmtAmt(v, { dash: false });
const signed = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + fmtAmt(v, { dash: true }));
const fill = (d, c) => d.setFillColor(c[0], c[1], c[2]);
const ink = (d, c) => d.setTextColor(c[0], c[1], c[2]);
const stroke = (d, c) => d.setDrawColor(c[0], c[1], c[2]);
const fmtDay = (r) => `${String(r.d).padStart(2, '0')}/${MONTH_SHORT[r.m]}/${r.y}`;
const fmtLong = (r) => `${String(r.d).padStart(2, '0')} ${MONTH_SHORT[r.m]} ${r.y}`;

function header(doc, scope) {
  fill(doc, C.navy); doc.rect(0, 0, PW, 15, 'F');
  fill(doc, C.teal); doc.rect(0, 15, PW, 0.8, 'F');
  fill(doc, C.teal); doc.rect(M + 1.6, 3.6, 1.8, 6, 'F'); doc.rect(M - 0.5, 5.7, 5.8, 1.8, 'F'); // pharmacy cross
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); ink(doc, C.white);
  doc.text('BAHRIA TOWN SALES IC', M + 9, 8.2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); ink(doc, [170, 200, 196]);
  doc.text('Pharmacy Sale Book', M + 9, 12.2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink(doc, C.white);
  doc.text(scopeTitle(scope), PW - M, 8, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); ink(doc, [170, 200, 196]);
  doc.text(SCOPE_NAME[scope.type], PW - M, 12.2, { align: 'right' });
}

function footers(doc, generated) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    stroke(doc, C.line); doc.setLineWidth(0.2); doc.line(M, PH - 8, PW - M, PH - 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); ink(doc, C.grey);
    doc.text(`Generated ${generated}  |  All amounts in Rs  |  Returns shown in (brackets)`, M, PH - 4.6);
    doc.text('Cash + Cash Returns + Banks + Credit Clients = Total Sale', PW / 2, PH - 4.6, { align: 'center' });
    doc.text(`Page ${i} of ${n}`, PW - M, PH - 4.6, { align: 'right' });
  }
}

function card(doc, x, y, w, h, label, value, sub, valueColor) {
  fill(doc, C.soft); doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  fill(doc, C.teal); doc.rect(x, y + 2, 1.1, h - 4, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); ink(doc, C.slate);
  doc.text(label.toUpperCase(), x + 4, y + 5);
  doc.setFontSize(13.5); ink(doc, valueColor || C.navy);
  doc.text(value, x + 4, y + 11.8);
  if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); ink(doc, C.slate); doc.text(sub, x + 4, y + 16.2); }
}

function barChart(doc, { x, y, w, h, title, items, labelEvery = 1, valueLabels = false }) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(doc, C.slate);
  doc.text(title.toUpperCase(), x, y + 3);
  const px = x + 15, py = y + 7, pw = w - 16, ph = h - 7 - 6;
  const { max, step } = niceScale(Math.max(1, ...items.map((i) => i.value || 0)));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3);
  for (let v = 0; v <= max + 1e-6; v += step) {
    const gy = py + ph - (v / max) * ph;
    stroke(doc, v === 0 ? C.grey : C.line); doc.setLineWidth(v === 0 ? 0.3 : 0.15);
    doc.line(px, gy, px + pw, gy);
    ink(doc, C.grey); doc.text(fmtShort(v), px - 1.5, gy + 0.8, { align: 'right' });
  }
  const slot = pw / items.length, bw = slot * 0.68;
  items.forEach((it, i) => {
    const cx = px + slot * i + slot / 2;
    if (it.value > 0) {
      const bh = (it.value / max) * ph;
      fill(doc, it.color || C.teal); doc.rect(cx - bw / 2, py + ph - bh, bw, bh, 'F');
      if (valueLabels) { doc.setFontSize(6.2); ink(doc, C.ink); doc.text(fmtShort(it.value), cx, py + ph - bh - 1, { align: 'center' }); }
    }
    if (it.label && i % labelEvery === 0) { doc.setFontSize(6.3); ink(doc, C.slate); doc.text(String(it.label), cx, py + ph + 3.6, { align: 'center' }); }
  });
}

function mixBar(doc, x, y, w, t) {
  const parts = [
    { name: 'Cash (net of returns)', v: t.cash + t.cashReturns, c: C.teal },
    { name: 'Banks', v: t.banks, c: C.navy },
    { name: 'Credit Clients', v: t.credit, c: C.amber },
  ];
  const sum = parts.reduce((s, p) => s + Math.max(0, p.v), 0) || 1;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(doc, C.slate); doc.text('PAYMENT MIX', x, y + 3);
  let cx = x;
  parts.forEach((p) => { const pw = (Math.max(0, p.v) / sum) * w; fill(doc, p.c); doc.rect(cx, y + 5.5, pw, 6, 'F'); cx += pw; });
  const colW = w / 3;
  parts.forEach((p, i) => {
    const lx = x + colW * i;
    fill(doc, p.c); doc.rect(lx, y + 14.2, 2.6, 2.6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(doc, C.ink);
    doc.text(`${p.name}  ${(Math.max(0, p.v) / sum * 100).toFixed(1)}%`, lx + 4, y + 16.4);
    doc.setFont('helvetica', 'normal'); ink(doc, C.slate); doc.text(rs(p.v), lx + 4, y + 20.4);
  });
}

function weekdayStrip(doc, x, y, w, rows) {
  const avg = weekdayAverages(rows), mx = Math.max(...avg), order = [1, 2, 3, 4, 5, 6, 0];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(doc, C.slate); doc.text('AVERAGE TOTAL SALE BY WEEKDAY', x, y + 3);
  const gw = 2.5, cw = (w - gw * 6) / 7;
  order.forEach((d, i) => {
    const cx = x + i * (cw + gw), top = avg[d] === mx && mx > 0;
    fill(doc, top ? C.tealTint : C.soft); doc.roundedRect(cx, y + 5, cw, 12, 1.2, 1.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(doc, top ? C.tealDk : C.slate); doc.text(DAY_SHORT[d], cx + cw / 2, y + 9.2, { align: 'center' });
    doc.setFontSize(8.4); ink(doc, C.navy); doc.text(avg[d] ? fmtAmt(avg[d]) : '-', cx + cw / 2, y + 14.6, { align: 'center' });
  });
}

function cover(doc, scope, rows) {
  const t = summarize(rows);
  header(doc, scope);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); ink(doc, C.navy);
  doc.text(scopeTitle(scope), M, 31);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); ink(doc, C.slate);
  const range = t.days ? `${fmtLong(rows[0])} to ${fmtLong(rows[rows.length - 1])}` : '';
  doc.text(`${SCOPE_NAME[scope.type]}  |  ${t.days} days recorded  |  ${range}`, M, 37.5);
  const cw = (CW - 12) / 4, ch = 19.5, y1 = 43, y2 = y1 + ch + 4;
  const x = (i) => M + i * (cw + 4);
  card(doc, x(0), y1, cw, ch, 'Total Sale', rs(t.total), `Cash ${fmtShort(t.cash + t.cashReturns)}  Banks ${fmtShort(t.banks)}  Credit ${fmtShort(t.credit)}`);
  card(doc, x(1), y1, cw, ch, 'Computer Sale', rs(t.comp), 'Candela POS figure');
  card(doc, x(2), y1, cw, ch, 'Sale Difference', (t.diff < 0 ? '-' : t.diff > 0 ? '+' : '') + 'Rs ' + fmtAmt(Math.abs(t.diff), { dash: false }), 'Total Sale minus Computer Sale', t.diff < 0 ? C.red : C.green);
  card(doc, x(3), y1, cw, ch, 'Customers', fmtAmt(t.customers, { dash: false }), `FDPP POS ${fmtAmt(t.fdpp, { dash: false })}  |  Consumer ${fmtAmt(t.fdppCon, { dash: false })}`);
  card(doc, x(0), y2, cw, ch, 'Best Day', t.best ? rs(t.best.total) : '-', t.best ? `${DAY_SHORT[t.best.dow]} ${fmtDay(t.best)}` : '', C.green);
  card(doc, x(1), y2, cw, ch, 'Lowest Day', t.low ? rs(t.low.total) : '-', t.low ? `${DAY_SHORT[t.low.dow]} ${fmtDay(t.low)}` : '', C.red);
  card(doc, x(2), y2, cw, ch, 'Average Daily Sale', rs(t.avgDay), `over ${t.days} days`);
  card(doc, x(3), y2, cw, ch, 'Average Bill', rs(t.avgBill), 'Total Sale / Customers');
  mixBar(doc, M, 94, CW, t);

  let items, title, labelEvery = 1, valueLabels = false;
  if (scope.type === 'month') {
    const cal = monthCalendar(rows, scope.y, scope.m, rows[rows.length - 1]?.ts);
    title = 'Daily Total Sale'; labelEvery = 1;
    items = cal.map((r) => ({ label: r.d, value: r.missing ? 0 : r.total,
      color: r.missing ? C.line : r === t.best ? C.navy : r === t.low ? C.amber : C.teal }));
  } else if (scope.type === 'year') {
    title = 'Monthly Total Sale'; valueLabels = true;
    items = monthsInScope(rows, scope).map((mm) => ({ label: MONTH_SHORT[mm.m],
      value: summarize(rows.filter((r) => r.y === mm.y && r.m === mm.m)).total, color: C.teal }));
  } else {
    title = 'Monthly Total Sale (all months)';
    const ms = monthsInScope(rows, scope);
    items = ms.map((mm, i) => ({ label: mm.m === 0 || i === 0 ? mm.y : '', value: summarize(rows.filter((r) => r.y === mm.y && r.m === mm.m)).total,
      color: mm.y % 2 ? C.teal : C.tealDk }));
  }
  barChart(doc, { x: M, y: 122, w: CW, h: 56, title, items, labelEvery, valueLabels });
  weekdayStrip(doc, M, 180, CW, rows);
}

// Shared autoTable look for every register / summary table.
function tableStyles(rowH, fs) {
  const pv = Math.max(0.5, (rowH - fs * 0.3528 * 1.15) / 2);
  return {
    styles: { font: 'helvetica', fontSize: fs, cellPadding: { top: pv, bottom: pv, left: 1.5, right: 1.8 }, lineWidth: 0.1,
      lineColor: C.line, textColor: C.ink, valign: 'middle', minCellHeight: rowH },
    headStyles: { fillColor: C.navy, textColor: C.white, fontSize: 6.6, fontStyle: 'bold', halign: 'right', valign: 'middle',
      minCellHeight: 9, lineColor: C.navy, cellPadding: { top: 1, bottom: 1, left: 1.2, right: 1.8 } },
    columnStyles: WIDTHS.reduce((o, w, i) => { o[i] = { cellWidth: w, halign: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }; return o; }, {}),
  };
}

function numCells(r, extra = {}) {
  return KEYS.map((k) => {
    const v = r[k];
    const st = { ...extra };
    let content;
    if (k === 'cashReturns') { content = fmtAmt(v, { brackets: true }); if (v < 0 && !extra.textColor) st.textColor = C.red; }
    else if (k === 'diff') { content = signed(v); if (v != null && !extra.textColor) st.textColor = v < 0 ? C.red : v > 0 ? C.green : C.ink; }
    else content = fmtAmt(v);
    if (k === 'total') st.fontStyle = 'bold';
    return { content, styles: st };
  });
}

/** One month's daily register: every calendar day, total + average rows, fits one page. */
function ledgerPage(doc, scope, rows, y, m, lastTs) {
  const cal = monthCalendar(rows, y, m, lastTs);
  const real = cal.filter((r) => !r.missing);
  const t = summarize(real);
  header(doc, scope);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink(doc, C.navy);
  doc.text(`${MONTH_NAMES[m]} ${y}  -  Daily Sale Register`, M, 22.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); ink(doc, C.slate);
  const miss = cal.length - real.length;
  doc.text(`${real.length} day${real.length === 1 ? '' : 's'} recorded${miss ? `  |  ${miss} with no entry` : ''}`, PW - M, 22.5, { align: 'right' });
  const startY = 25, avail = PH - 9 - startY - 9 - 1, rowH = Math.min(5.8, avail / (cal.length + 2));
  const fs = rowH >= 5.2 ? 8 : rowH >= 4.6 ? 7.4 : 6.8;
  const body = cal.map((r) => {
    if (r.missing) {
      return [{ content: fmtDay(r), styles: { textColor: C.grey } }, { content: r.day, styles: { textColor: C.grey } },
        { content: 'No entry recorded', colSpan: 10, styles: { textColor: C.grey, fontStyle: 'italic', halign: 'center', fillColor: [251, 251, 252] } }];
    }
    const cells = numCells(r);
    const ti = 4; // total sale cell
    if (r === t.best && real.length > 1) Object.assign(cells[ti].styles, { fillColor: C.greenTint, textColor: C.green });
    if (r === t.low && real.length > 1) Object.assign(cells[ti].styles, { fillColor: C.redTint, textColor: C.red });
    if (r.drift) cells[ti].content += '*';
    return [{ content: fmtDay(r), styles: {} }, { content: r.day, styles: { textColor: r.dow === 0 || r.dow === 5 ? C.tealDk : C.ink, fontStyle: 'bold' } }, ...cells];
  });
  const strong = { fillColor: C.navy, textColor: C.white, fontStyle: 'bold' };
  body.push([{ content: 'TOTAL', colSpan: 2, styles: strong }, ...numCells(t, strong)]);
  const avg = { ...t, ...Object.fromEntries(KEYS.map((k) => [k, t.days ? t[k] / t.days : 0])) };
  if (t.diffDays === 0) avg.diff = null;
  else avg.diff = t.diff / t.diffDays;
  body.push([{ content: 'AVERAGE / DAY', colSpan: 2, styles: { fillColor: C.tealTint, textColor: C.navy, fontStyle: 'bold', fontSize: fs - 0.4 } }, ...numCells(avg, { fillColor: C.tealTint, textColor: C.navy, fontStyle: 'bold' })]);
  doc.autoTable({
    startY, head: [HEAD], body, theme: 'grid', margin: { left: M, right: M, top: startY, bottom: 9 }, tableWidth: CW,
    alternateRowStyles: { fillColor: C.zebra }, ...tableStyles(rowH, fs),
  });
  if (t.driftDays) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.6); ink(doc, C.slate);
    doc.text('* Stored Total Sale differs from the sum of its parts on this day (the stored Total Sale is shown).', M, PH - 10.5);
  }
}

/** Summary table: one row per month (year book) or per year (all-time). Same columns as the register. */
function summaryPage(doc, scope, rows, kind, y) {
  header(doc, scope);
  const groups = kind === 'years'
    ? [...new Set(rows.map((r) => r.y))].sort().map((yy) => ({ label: String(yy), rows: rows.filter((r) => r.y === yy) }))
    : monthsInScope(rows, { type: 'year', y }).map((mm) => ({ label: MONTH_NAMES[mm.m], rows: rows.filter((r) => r.y === y && r.m === mm.m) }));
  const all = groups.flatMap((g) => g.rows), t = summarize(all);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink(doc, C.navy);
  doc.text(kind === 'years' ? 'Year-by-Year Summary' : `${y}  -  Month-by-Month Summary`, M, 22.5);
  const head = HEAD.slice(); head[0] = kind === 'years' ? 'Year' : 'Month'; head[1] = 'Days';
  const best = Math.max(...groups.map((g) => summarize(g.rows).total));
  const body = groups.map((g) => {
    const s = summarize(g.rows);
    const cells = numCells(s);
    if (s.total === best && groups.length > 1) Object.assign(cells[4].styles, { fillColor: C.greenTint, textColor: C.green });
    return [{ content: g.label, styles: { fontStyle: 'bold' } }, { content: String(s.days), styles: { halign: 'center' } }, ...cells];
  });
  const strong = { fillColor: C.navy, textColor: C.white, fontStyle: 'bold' };
  body.push([{ content: kind === 'years' ? 'ALL TIME' : `TOTAL ${y}`, styles: strong }, { content: String(t.days), styles: { ...strong, halign: 'center' } }, ...numCells(t, strong)]);
  const n = groups.length || 1, avg = Object.fromEntries(KEYS.map((k) => [k, t[k] / n]));
  avg.diff = t.diffDays ? t.diff / n : null;
  body.push([{ content: kind === 'years' ? 'AVG / YEAR' : 'AVG / MONTH', styles: { fillColor: C.tealTint, textColor: C.navy, fontStyle: 'bold' } },
    { content: String(Math.round(t.days / n)), styles: { fillColor: C.tealTint, textColor: C.navy, fontStyle: 'bold', halign: 'center' } },
    ...numCells(avg, { fillColor: C.tealTint, textColor: C.navy, fontStyle: 'bold' })]);
  const rowH = Math.min(8, (PH - 9 - 25 - 12) / (body.length + 1));
  const st = tableStyles(rowH, 8.6);
  st.columnStyles[0].cellWidth = WIDTHS[0] + WIDTHS[1] - 12; st.columnStyles[1] = { cellWidth: 12, halign: 'center' };
  doc.autoTable({ startY: 25, head: [head], body, theme: 'grid', margin: { left: M, right: M, top: 25, bottom: 9 }, tableWidth: CW,
    alternateRowStyles: { fillColor: C.zebra }, ...st });
}

/**
 * @param {object} o  { jsPDF, rows, scope: {type:'month',y,m}|{type:'year',y}|{type:'all'}, generated }
 * @returns {{doc, title, filename}}
 */
export function buildSaleBookPdf({ jsPDF, rows, scope, generated }) {
  const scoped = rowsInScope(rows, scope);
  if (!scoped.length) throw new Error('No sale data for ' + scopeTitle(scope));
  const lastTs = rows.length ? rows[rows.length - 1].ts : null;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const title = scope.type === 'all' ? SCOPE_NAME.all : `${SCOPE_NAME[scope.type]} - ${scopeTitle(scope)}`;
  doc.setProperties({ title, subject: 'Daily sale register', author: 'BT Sales IC', creator: 'BT Sales IC' });
  let first = true;
  const next = () => { if (first) first = false; else doc.addPage('a4', 'landscape'); };
  const mark = (parent, text) => { try { return doc.outline.add(parent, text, { pageNumber: doc.getNumberOfPages() }); } catch (e) { return null; } };
  const monthPages = (yy, parent) => monthsInScope(scoped, { type: 'year', y: yy }).forEach((mm) => {
    next(); mark(parent, `${MONTH_NAMES[mm.m]} ${yy}`);
    ledgerPage(doc, scope, scoped, mm.y, mm.m, lastTs);
  });

  next(); mark(null, 'Summary'); cover(doc, scope, scoped);
  if (scope.type === 'month') {
    next(); mark(null, `${scopeTitle(scope)} register`);
    ledgerPage(doc, scope, scoped, scope.y, scope.m, lastTs);
  } else if (scope.type === 'year') {
    next(); mark(null, 'Month-by-month summary'); summaryPage(doc, scope, scoped, 'months', scope.y);
    monthPages(scope.y, null);
  } else {
    next(); mark(null, 'Year-by-year summary'); summaryPage(doc, scope, scoped, 'years');
    [...new Set(scoped.map((r) => r.y))].sort().forEach((yy) => {
      next(); const yr = mark(null, String(yy));
      summaryPage(doc, scope, scoped, 'months', yy);
      monthPages(yy, yr);
    });
  }
  footers(doc, generated);
  const safe = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return { doc, title, filename: safe };
}
