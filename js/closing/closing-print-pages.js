// CLOSING (native) — printable pages: shift closing, final aggregation, cover and placeholder.

import { escapeHtml as esc } from '../shared/html.js';
import { findLastFinal, getRealSheet, n, srLabel, timelineStep } from './closing-engine.js';

// ═══════════════════════════════════════════════════════════════════
// PRINT-SHEET ENGINE — ported from Closing's components.js buildPrintSheet()
// + actions.js calc()/aggregateSinceLastFinal(), but data-driven off the
// already-saved rec fields instead of a live edit form (see header note).
// ═══════════════════════════════════════════════════════════════════

const DENOMS = [
  { label: 'Rs. 5,000 notes', mult: 5000 },
  { label: 'Rs. 1,000 notes', mult: 1000 },
  { label: 'Rs. 500 notes', mult: 500 },
  { label: 'Rs. 100 notes', mult: 100 },
  { label: 'Rs. 50 notes', mult: 50 },
  { label: 'Rs. 20 notes', mult: 20 },
  { label: 'Rs. 10 notes', mult: 10 },
  { label: 'Coins / loose change', mult: 1 }
];

function psRow(label, value, cls = '') { return `<div class="ps-row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`; }
function psRowOrEmpty(label, raw, cls = '') {
  const v = n(raw);
  return v !== 0 ? psRow(label, v.toLocaleString('en-PK'), cls) : psRow(label, '—', cls + ' ps-empty');
}
function psGenStamp() { return new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

// Full port of Closing's aggregateSinceLastFinal() (actions.js) — unlike
// aggregateBooksAndReturnsSinceLastFinal() above (trimmed to the 2 fields
// the summary card needs), this keeps every field the Final Aggregation
// print page displays. Deliberately excludes the CURRENT shift's own
// contribution, same as the original — callers add that back in
// themselves (see buildFinalPrintPage below), mirroring how Closing's
// own calc() adds shiftSaleVal/book1/book2/custVal/ret1-3/retSys on top.
function aggregateSinceLastFinalFull(cdb, ds, shift) {
  const lastFinal = findLastFinal(cdb, ds, shift);
  let totalManualReturns = 0, totalBookBills = 0, totalExtraCash = 0, shiftCount = 0;
  let sameDateShiftSale = 0, preDateShiftSale = 0;
  let sameDateCustomers = 0, preDateCustomers = 0;
  let sameDateSysReturns = 0, preDateSysReturns = 0;
  const labels = [];
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
    if (lastFinal && cur.key === lastFinal.key) break;
    const rec = getRealSheet(cdb, cur.key);
    if (!rec) { if (!lastFinal) break; else continue; }
    if (rec.profileMode === 'final') break;
    const shiftSale = n(rec.outShiftSale), customers = n(rec.outCust), sysRet = n(rec.posRetSys);
    const manRet = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
    const books = n(rec.inBook1) + n(rec.inBook2);
    const isToday = (cur.date === ds);
    totalManualReturns += manRet; totalExtraCash += n(rec.extraCash); totalBookBills += books; shiftCount++;
    labels.unshift(srLabel(cur.shift).replace('Closing', 'C') + ' ' + cur.date);
    if (isToday) { sameDateShiftSale += shiftSale; sameDateCustomers += customers; sameDateSysReturns += sysRet; }
    else { preDateShiftSale += shiftSale; preDateCustomers += customers; preDateSysReturns += sysRet; }
  }
  let lfSameDateSale = 0, lfPreDateSale = 0, lfSameDateCust = 0, lfPreDateCust = 0, lfSameDateSysRet = 0, lfPreDateSysRet = 0;
  if (lastFinal) {
    const lf = lastFinal.rec, lfDate = lastFinal.key.split('_')[0];
    const lfSale = n(lf.outShiftSale), lfCust = n(lf.outCust), lfSysR = n(lf.posRetSys);
    if (lfDate === ds) { lfSameDateSale = lfSale; lfSameDateCust = lfCust; lfSameDateSysRet = lfSysR; }
    else { lfPreDateSale = lfSale; lfPreDateCust = lfCust; lfPreDateSysRet = lfSysR; }
    totalManualReturns += n(lf.posRet1) + n(lf.posRet2) + n(lf.posRet3);
    totalBookBills += n(lf.inBook1) + n(lf.inBook2);
    totalExtraCash += n(lf.extraCash);
  }
  return {
    lastFinal, totalManualReturns, totalBookBills, totalExtraCash, shiftCount, labels,
    sameDateShiftSale, preDateShiftSale, sameDateCustomers, preDateCustomers, sameDateSysReturns, preDateSysReturns,
    lfSameDateSale, lfPreDateSale, lfSameDateCust, lfPreDateCust, lfSameDateSysRet, lfPreDateSysRet
  };
}

// ── PAGE 1 — Shift Closing (ported from buildPrintSheet()'s page1) ──
export function buildShiftPrintPage(cdb, key, rec) {
  const [ds, shift] = key.split('_');
  const settings = cdb.settings || {};
  const branchName = settings.branchName || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const mode = rec.profileMode || 'shift';
  const isLocked = rec.draft !== true;
  const num = v => n(v).toLocaleString('en-PK');

  let infoRows = '';
  infoRows += psRow('Computer Cash Sale', num(rec.inSysCash));
  infoRows += psRow('Shift Sale (POS delta)', num(rec.outShiftSale));
  infoRows += psRow('Sale Book 1', num(rec.inBook1));
  infoRows += psRow('Sale Book 2', num(rec.inBook2));
  infoRows += psRow('Customers', num(rec.outCust));
  infoRows += psRow('Last Bill #', rec.inLastBillNum || '—');
  infoRows += psRow('Last Bill Amount', num(rec.inLastBillAmt));

  const totalReturns = n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3) + n(rec.posRetSys);
  let retRows = '';
  retRows += psRowOrEmpty('Return 1', rec.posRet1);
  retRows += psRowOrEmpty('Return 2', rec.posRet2);
  retRows += psRowOrEmpty('Return 3', rec.posRet3);
  retRows += psRowOrEmpty('System Return', rec.posRetSys);
  retRows += psRow('TOTAL RETURNS', num(totalReturns), 'ps-total');
  retRows += psRow('NET SHIFT SALE', num(rec.outNetSale), 'ps-highlight');

  const ccB = n(rec.outPrevCC) + n(rec.outCurrCC);
  let ccRows = '';
  ccRows += psRow('Bank Alfalah', num(rec.inAlfalah));
  ccRows += psRow('Keenu Machine', num(rec.inKeenu));
  ccRows += psRowOrEmpty('Computer Card Sale (−)', rec.inCompSale);
  ccRows += psRow('Current CC', num(rec.outCurrCC));
  ccRows += psRow('Previous Day CC (carried)', num(rec.outPrevCC));
  ccRows += psRow('TOTAL CC', ccB.toLocaleString('en-PK'), 'ps-total');

  let tillRows = '', totalC = 0;
  (rec.tillValues || []).forEach((v, i) => {
    const d = DENOMS[i]; if (!d) return;
    totalC += n(v) * d.mult;
    if (n(v) !== 0) tillRows += psRow(d.label, n(v).toLocaleString('en-PK'));
  });
  if (!tillRows) tillRows = psRow('— no denominations counted —', '', 'ps-empty');
  tillRows += psRow('TOTAL TILL CASH', totalC.toLocaleString('en-PK'), 'ps-total');

  let drawRows = '', totalD = 0;
  (rec.vaultValues || []).forEach((v, i) => {
    const d = DENOMS[i]; if (!d) return;
    totalD += n(v) * d.mult;
    if (n(v) !== 0) drawRows += psRow(d.label, n(v).toLocaleString('en-PK'));
  });
  if (!drawRows) drawRows = psRow('— no vault cash counted —', '', 'ps-empty');
  drawRows += psRow('TOTAL DRAW CASH', totalD.toLocaleString('en-PK'), 'ps-total');

  let stripRows = '', hsTotal = 0, totalA = 0;
  (rec.hsRows || []).forEach(r => {
    const v = n(r.val); hsTotal += v;
    if (r.lbl && v !== 0) stripRows += psRow(r.lbl, v.toLocaleString('en-PK'));
  });
  (settings.strips || []).forEach((st, i) => {
    const qty = n((rec.stripQtys || [])[i]), price = n((rec.stripPrices || [])[i]), line = price * qty;
    totalA += line;
    if (qty !== 0) stripRows += psRow(`${st.name} ×${qty}`, line.toLocaleString('en-PK'));
  });
  (rec.auxStrips || []).forEach(r => {
    const qty = n(r.q), price = n(r.p), line = price * qty;
    totalA += line;
    if (qty !== 0) stripRows += psRow(`${r.label} ×${qty}`, line.toLocaleString('en-PK'));
  });
  if (!stripRows) stripRows = psRow('— no items —', '', 'ps-empty');
  stripRows += psRow('TOTAL HS + STRIPS', (hsTotal + totalA).toLocaleString('en-PK'), 'ps-total');

  let credRows = '';
  credRows += psRow('Carried from Previous', num(rec.outPrevCredit));
  if (n(rec.creditAdj) !== 0) credRows += psRow('Credit Adjustment', num(rec.creditAdj));
  (rec.namedCredits || []).forEach(o => {
    const v = n(o.val); if (v === 0) return;
    const rowLbl = o.desc ? `${o.lbl || 'Named Account'} — ${o.desc}` : (o.lbl || 'Named Account');
    credRows += psRow(rowLbl, v.toLocaleString('en-PK'));
  });
  (rec.tierCredits || []).forEach(t => {
    const v = n(t.val); if (v === 0) return;
    const grp = settings.subTiers && settings.subTiers[parseInt(t.tIdx)];
    credRows += psRow(`${grp ? grp.type : ''} — ${t.name || ''}`, v.toLocaleString('en-PK'));
  });
  (rec.auxCredits || []).forEach(o => {
    const v = n(o.val); if (v === 0) return;
    credRows += psRow(o.lbl || 'Credit Entry', v.toLocaleString('en-PK'));
  });
  credRows += psRow('TOTAL CREDIT', num(rec.outTotalE), 'ps-total');

  let depRows = '';
  depRows += psRow('Carried from Previous', num(rec.outPrevDep));
  (rec.deposits || []).forEach(o => {
    const v = n(o.val); if (!o.lbl || v === 0) return;
    depRows += psRow(o.lbl, v.toLocaleString('en-PK'));
  });
  depRows += psRow('TOTAL DEPOSITS', num(rec.outTotalF), 'ps-total');

  let miscRows = '', totalG = 0;
  (rec.miscRows || []).forEach(r => {
    const v = n(r.val); totalG += v;
    if (r.label) miscRows += psRow(r.label, v.toLocaleString('en-PK'));
  });
  if (!miscRows) miscRows = psRow('— no items —', '', 'ps-empty');
  miscRows += psRow('TOTAL MISC', totalG.toLocaleString('en-PK'), 'ps-total');

  const liquid = rec.outTotalCash !== undefined ? n(rec.outTotalCash) : (hsTotal + totalA + totalG + ccB + totalC + totalD + n(rec.outTotalE) + n(rec.outTotalF) - 45000);
  const grand = liquid + 45000;
  let sumRows = '';
  sumRows += psRow('HS + Strips', (hsTotal + totalA).toLocaleString('en-PK'));
  sumRows += psRow('Misc', totalG.toLocaleString('en-PK'));
  sumRows += psRow('CC (Card Sales)', ccB.toLocaleString('en-PK'));
  sumRows += psRow('Till Cash', totalC.toLocaleString('en-PK'));
  sumRows += psRow('Draw Cash', totalD.toLocaleString('en-PK'));
  sumRows += psRow('Credit', num(rec.outTotalE));
  sumRows += psRow('Deposits', num(rec.outTotalF));
  sumRows += psRow('GRAND TOTAL', grand.toLocaleString('en-PK'), 'ps-total');
  sumRows += psRow('Less: Cash Reserve (float)', '45,000', 'ps-minus');
  sumRows += psRow('Liquid Cash', liquid.toLocaleString('en-PK'));
  sumRows += psRow('Less: Previous Cash Position', num(rec.outPrevCash), 'ps-minus');
  if (n(rec.extraCash) !== 0) sumRows += psRow('Less: Extra Cash Added', num(rec.extraCash), 'ps-minus');
  sumRows += psRow('NET CASH AVAILABLE', num(rec.outNetCash), 'ps-highlight');

  const diff1 = n(rec.outNetCash) - n(rec.outNetSale);
  const diffLbl1 = diff1 === 0 ? 'Variance' : diff1 > 0 ? 'Plus' : 'Less';
  const isShort1 = diffLbl1 === 'Less';
  const hero1 = `
    <div class="ps-hero ${isShort1 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${diffLbl1} — Net Cash vs Net Sale</div>
        <div class="ps-hero-val">₨ ${Math.abs(diff1).toLocaleString('en-PK')}</div>
      </div>
      <div class="ps-hero-sub">Net Cash Available minus Net Shift Sale. Zero means the till matches exactly.</div>
    </div>`;

  let ticks1 = ''; for (let t = 60; t < 1100; t += 46) ticks1 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  return `
    <div class="ps-page ps-page-shift">
      <div class="ps-spine"><div class="ps-spine-ticks">${ticks1}</div><div class="ps-spine-label">${srLabel(shift)} · ${ds || ''}</div></div>
      <div class="ps-content">
        <div class="ps-letterhead">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">${mode === 'final' ? 'Final Closing' : 'Shift Closing'}</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)} · ${isLocked ? 'CLOSED' : 'DRAFT'} · Generated ${genStamp}</div>
          </div>
        </div>
        <div class="ps-main3">
          <div class="ps-col">
            <div class="ps-box"><h4>Till Cash</h4>${tillRows}</div>
            <div class="ps-box"><h4>Draw / Vault Cash</h4>${drawRows}</div>
            <div class="ps-box"><h4>Deposit Details</h4>${depRows}</div>
            <div class="ps-box ps-box-accent"><h4>Grand Summary</h4>${sumRows}</div>
          </div>
          <div class="ps-col">
            <div class="ps-box"><h4>HS Details &amp; Strips</h4>${stripRows}</div>
            <div class="ps-box"><h4>Miscellaneous Credits</h4>${miscRows}</div>
          </div>
          <div class="ps-col">
            <div class="ps-box"><h4>Sale Info</h4>${infoRows}</div>
            <div class="ps-box"><h4>Credit Card Sales (CC)</h4>${ccRows}</div>
            <div class="ps-box ps-box-accent"><h4>Returns &amp; Net Sale</h4>${retRows}</div>
            <div class="ps-box"><h4>Credit Detail</h4>${credRows}</div>
          </div>
        </div>
        ${hero1}
      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 1 of 2</span></div>
    </div>`;
}

// ── PAGE 2 — Final Aggregation (ported from buildPrintSheet()'s page2) ──
export function buildFinalPrintPage(cdb, ds, shift, rec) {
  const settings = cdb.settings || {};
  const branchName = settings.branchName || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const mode = rec.profileMode || 'shift';
  const isLocked = rec.draft !== true;
  const isFinalMode = mode === 'final';
  const agg = aggregateSinceLastFinalFull(cdb, ds, shift);
  const shiftsLabel = agg.shiftCount ? `${agg.shiftCount} — ${agg.labels.join(', ')}` : '— none —';
  const chipsSrc = shiftsLabel.includes('—') ? shiftsLabel.split('—')[1] : shiftsLabel;
  const shiftChips = chipsSrc.split(',').map(s => s.trim()).filter(Boolean).map(s => `<span class="ps-chip">${esc(s)}</span>`).join('') || `<span class="ps-chip">— none yet —</span>`;

  const shiftSaleVal = n(rec.outShiftSale), book1 = n(rec.inBook1), book2 = n(rec.inBook2), custVal = n(rec.outCust);
  const ret1 = n(rec.posRet1), ret2 = n(rec.posRet2), ret3 = n(rec.posRet3), retSys = n(rec.posRetSys);
  const extraCash = n(rec.extraCash);
  const liquid = rec.outTotalCash !== undefined ? n(rec.outTotalCash) : 0;

  let totalSameDateSys, totalBooks, totalSameDateCust, totalManRet, totalSameSysRet;
  let preDateSys, preDateCust, preDateSysRet, totalExtraCashPeriod;
  if (isFinalMode) {
    totalSameDateSys = shiftSaleVal; totalBooks = book1 + book2; totalSameDateCust = custVal;
    totalManRet = ret1 + ret2 + ret3; totalSameSysRet = retSys;
    preDateSys = 0; preDateCust = 0; preDateSysRet = 0; totalExtraCashPeriod = extraCash;
  } else {
    totalSameDateSys = agg.sameDateShiftSale + agg.lfSameDateSale + shiftSaleVal;
    totalBooks = agg.totalBookBills + book1 + book2;
    totalSameDateCust = agg.sameDateCustomers + agg.lfSameDateCust + custVal;
    totalManRet = agg.totalManualReturns + ret1 + ret2 + ret3;
    totalSameSysRet = agg.sameDateSysReturns + agg.lfSameDateSysRet + retSys;
    preDateSys = agg.preDateShiftSale + agg.lfPreDateSale;
    preDateCust = agg.preDateCustomers + agg.lfPreDateCust;
    preDateSysRet = agg.preDateSysReturns + agg.lfPreDateSysRet;
    totalExtraCashPeriod = agg.totalExtraCash + extraCash;
  }
  const finalExtraRet = n(rec.finalSysReturns);
  const computedNetSale = totalSameDateSys + totalBooks + totalSameDateCust - totalManRet - totalSameSysRet - finalExtraRet;
  const finalNetSale = rec.finalNetSale !== undefined ? n(rec.finalNetSale) : computedNetSale;
  const preDateTotal = preDateSys + preDateCust - preDateSysRet;
  const computedNetCash = liquid - preDateTotal - totalExtraCashPeriod - finalNetSale;
  const finalNetCash = rec.finalNetCash !== undefined ? n(rec.finalNetCash) : computedNetCash;
  const finalDiff = rec.finalDiff !== undefined ? n(rec.finalDiff) : finalNetCash;
  const finalDiffLabel = rec.finalDiffLabel || (finalDiff === 0 ? 'Variance (Final Audit):' : finalDiff > 0 ? 'Plus (Final Audit):' : 'Less (Final Audit):');

  let part1Rows = '';
  part1Rows += psRow('POS Sale', totalSameDateSys.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Book Bills', totalBooks.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Customers', totalSameDateCust.toLocaleString('en-PK'), 'ps-plus');
  part1Rows += psRow('Manual Returns', totalManRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part1Rows += psRow('System Returns', totalSameSysRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part1Rows += psRowOrEmpty('Additional System Returns', finalExtraRet, 'ps-minus ps-red');
  part1Rows += psRow('NET FINAL SALE', finalNetSale.toLocaleString('en-PK'), 'ps-highlight');

  let part2Rows = '';
  part2Rows += psRow('Net Cash Available (after float)', liquid.toLocaleString('en-PK'));
  part2Rows += psRow('Pre-date POS Sales', preDateSys.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date Customers', preDateCust.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Pre-date System Returns', preDateSysRet.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Extra Cash Added to Pharmacy', totalExtraCashPeriod.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('Target Net Sale (Part 1 result)', finalNetSale.toLocaleString('en-PK'), 'ps-minus ps-red');
  part2Rows += psRow('NET FINAL CASH AVAILABLE', finalNetCash.toLocaleString('en-PK'), 'ps-highlight');

  let varRows = '';
  varRows += psRow('Pre-date Total (POS + Cust − SysRet)', preDateTotal.toLocaleString('en-PK'));
  const isShort2 = String(finalDiffLabel).toLowerCase().includes('less');
  varRows += psRow(finalDiffLabel, Math.abs(finalDiff).toLocaleString('en-PK'), isShort2 ? 'ps-red' : 'ps-highlight');

  const hero2 = `
    <div class="ps-hero ${isShort2 ? 'ps-hero-short' : ''}">
      <div>
        <div class="ps-hero-label">${esc(finalDiffLabel)} — Period Reconciliation</div>
        <div class="ps-hero-val">₨ ${Math.abs(finalDiff).toLocaleString('en-PK')}</div>
      </div>
      <div class="ps-hero-sub">Net Final Cash Available compared to Net Final Sale across the full period since the last Final Closing.</div>
    </div>`;

  const idStrip = `
    <div class="ps-idstrip">
      <div class="ps-idchip"><div class="ps-idchip-label">Date</div><div class="ps-idchip-val">${ds || '—'}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Closing</div><div class="ps-idchip-val">${srLabel(shift)}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Mode</div><div class="ps-idchip-val">${mode.toUpperCase()}</div></div>
      <div class="ps-idchip"><div class="ps-idchip-label">Status</div><div class="ps-idchip-val">${isLocked ? 'CLOSED' : 'DRAFT'}</div></div>
    </div>`;

  let ticks2 = ''; for (let t = 60; t < 1100; t += 46) ticks2 += `<div class="ps-tick" style="top:${t}px;"></div>`;

  return `
    <div class="ps-page ps-page-final">
      <div class="ps-spine ps-spine-final"><div class="ps-spine-ticks">${ticks2}</div><div class="ps-spine-label">Final Closing · ${ds || ''}</div></div>
      <div class="ps-content">
        <div class="ps-letterhead">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
          <div class="ps-doctype">
            <span class="ps-doctype-tag">Final Closing</span>
            <div class="ps-doctype-date">${ds || '—'} · ${srLabel(shift)}</div>
          </div>
        </div>
        ${idStrip}
        <div class="ps-box"><h4><span class="ps-box-icon">🗂️</span>Shifts Since Last Final</h4>
          <div style="padding:10px 12px;"><div class="ps-chiprow">${shiftChips}</div></div>
        </div>
        <div class="ps-grid2">
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">📊</span>Part 1 — Net Final Sale</h4>${part1Rows}</div>
          <div class="ps-box ps-box-final"><h4><span class="ps-box-icon">💵</span>Part 2 — Net Final Cash Available</h4>${part2Rows}</div>
        </div>
        <div class="ps-box"><h4><span class="ps-box-icon">⚖️</span>Variance (Final Audit)</h4>${varRows}</div>
        ${hero2}
      </div>
      <div class="ps-foot"><span>Fazal Din's Pharma Plus — Shift Register</span><span class="ps-foot-page">Page 2 of 2 · Generated ${genStamp}</span></div>
    </div>`;
}

// ── Cover & placeholder pages (ported from closing-book.js) ──
export function buildClosingBookCoverPage(cdb, entries, fromDs, fromShift, toDs, toShift) {
  const recorded = entries.filter(e => cdb.sheets[e.key]).length;
  const finals = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].profileMode === 'final').length;
  const drafts = entries.filter(e => cdb.sheets[e.key] && cdb.sheets[e.key].draft === true).length;
  const missing = entries.length - recorded;
  const branchName = (cdb.settings && cdb.settings.branchName) || 'Bahria Town Branch';
  const genStamp = psGenStamp();
  const stat = (label, val) => `<div class="cb-stat"><div class="cb-stat-val">${val}</div><div class="cb-stat-label">${esc(label)}</div></div>`;
  return `
    <div class="ps-page cb-cover-page">
      <div class="ps-content" style="margin-left:0;padding:70px 55px;">
        <div class="ps-letterhead" style="border-bottom:2px solid #1c2b2b;padding-bottom:16px;">
          <div class="ps-brand"><h1>Fazal Din's Pharma Plus</h1><p>${esc(branchName)}</p></div>
        </div>
        <div class="cb-cover-title">📖 Closing Book</div>
        <div class="cb-cover-range">${esc(fromDs)} · ${esc(srLabel(fromShift))}<br><span class="cb-cover-arrow">↓</span><br>${esc(toDs)} · ${esc(srLabel(toShift))}</div>
        <div class="cb-cover-stats">
          ${stat('Shifts in Range', entries.length)}
          ${stat('Recorded', recorded)}
          ${stat('Final Closings', finals)}
          ${stat('Still Draft', drafts)}
          ${stat('Missing', missing)}
        </div>
        <div class="cb-cover-gen">Generated ${genStamp}</div>
      </div>
    </div>`;
}
export function buildClosingBookPlaceholderPage(e) {
  return `
    <div class="ps-page cb-placeholder-page">
      <div class="ps-content" style="margin-left:0;height:100%;display:flex;align-items:center;justify-content:center;">
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:3.2rem;">🗒️</div>
          <div style="font-size:1.15rem;font-weight:700;margin-top:14px;color:#64748b;">No closing recorded</div>
          <div style="font-size:1rem;margin-top:6px;">${esc(e.date)} · ${esc(srLabel(e.shift))}</div>
        </div>
      </div>
    </div>`;
}
