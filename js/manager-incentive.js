// ══════════════════════════════════════════════════════════════════════
// MANAGER — INCENTIVE CALCULATOR  (ES module, split from manager.js)
//
// Per-month incentive computation (commission, generic %, fines,
// panel/tax splits) plus a printable report. Independent of the other
// Manager sub-tabs — no cross-module state needed.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { _ni, _fc2 } from './manager-shared.js';
import { _mgrPrint } from './manager-reports.js';

const INCEN_PFX = 'mw_incentive_';
let _incData = {};
let _incMonth = '';

const _INC_FIELDS = ['saleVal','genSale','pilferage','unapproved','tillShort',
                     'cashTarget','excessFine','plusFine','paperFine','panelFine','tax'];

function _incKey(my) { return INCEN_PFX + my; }

function loadIncentiveMonth(my) {
  _incMonth = my;
  try {
    const raw = Repository.getItem(_incKey(my));
    _incData = raw ? JSON.parse(raw) : {};
  } catch(e) { _incData = {}; }
  // Populate inputs
  _INC_FIELDS.forEach(f => {
    const el = document.getElementById('inc-' + f);
    if (el) el.value = _incData[f] || '';
  });
  recalcIncentive();
}

function saveIncentiveData() {
  if (!_incMonth) { toast('⚠ Select a month first','w'); return; }
  _INC_FIELDS.forEach(f => {
    const el = document.getElementById('inc-' + f);
    if (el) _incData[f] = _ni(el.value);
  });
  Actions.saveFeatureData(_incKey(_incMonth), JSON.stringify(_incData));
  toast('✓ Incentive data saved');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function recalcIncentive() {
  const g = id => _ni(document.getElementById(id)?.value);
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent='₨'+_fc2(val); };
  const setRed = (id, val) => { const el=document.getElementById(id); if(el){ el.textContent='₨'+_fc2(Math.abs(val)); el.classList.toggle('red', val>0); } };

  const saleVal    = g('inc-saleVal');
  const genSale    = g('inc-genSale');
  const pilferage  = g('inc-pilferage');
  const tillShort  = g('inc-tillShort');
  const cashTarget = g('inc-cashTarget');
  const excessFine = g('inc-excessFine');
  const plusFine   = g('inc-plusFine');
  const paperFine  = g('inc-paperFine');
  const panelFine  = g('inc-panelFine');
  const tax        = g('inc-tax');

  const saleComm   = Math.round(saleVal * 0.005);      // 0.5%
  const genInc     = Math.round(genSale * 0.045);       // 4.5%
  const totalComm  = saleComm - pilferage - tillShort;
  const totalBonus = cashTarget;
  const totalGen   = genInc - excessFine;
  const grandTotal = totalComm + totalBonus + totalGen;
  const totalLess  = plusFine + paperFine;
  const prePanel   = grandTotal - totalLess;
  const netInc     = prePanel - panelFine;
  const salmanNet  = Math.round(netInc / 2) - tax;

  set('ic-saleComm',    saleComm);
  setRed('ic-lessPilf', pilferage);
  setRed('ic-tillCheque', tillShort);
  set('ic-totalComm',   totalComm);
  set('ic-totalBonus',  totalBonus);
  set('ic-genInc',      genInc);
  setRed('ic-lessExcess', excessFine);
  set('ic-totalGen',    totalGen);
  set('ic-grandTotal',  grandTotal);
  setRed('ic-totalLess', totalLess);
  set('ic-prePanel',    prePanel);
  setRed('ic-lessPanelFine', panelFine);
  set('ic-netInc',      netInc);
  setRed('ic-taxAmt',   tax);
  set('ic-salmanNet',   salmanNet);
}

function printIncentiveReport() {
  const my = document.getElementById('inc-month-sel').value;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const g = id => _ni(document.getElementById(id)?.value);
  const fv = v => '₨'+_fc2(v);
  const saleVal=g('inc-saleVal'), genSale=g('inc-genSale'), pilferage=g('inc-pilferage'),
        tillShort=g('inc-tillShort'), cashTarget=g('inc-cashTarget'), excessFine=g('inc-excessFine'),
        plusFine=g('inc-plusFine'), paperFine=g('inc-paperFine'), panelFine=g('inc-panelFine'), tax=g('inc-tax');
  const saleComm=Math.round(saleVal*.005), genInc=Math.round(genSale*.045);
  const totalComm=saleComm-pilferage-tillShort, totalBonus=cashTarget, totalGen=genInc-excessFine;
  const grandTotal=totalComm+totalBonus+totalGen, totalLess=plusFine+paperFine;
  const prePanel=grandTotal-totalLess, netInc=prePanel-panelFine, salmanNet=Math.round(netInc/2)-tax;
  const row=(lbl,val,style='')=>`<tr><td style="padding:5px 10px;border-bottom:1px solid #f1f5f9">${lbl}</td><td style="padding:5px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:monospace;${style}">${val}</td></tr>`;
  const sec=(hd)=>`<tr style="background:#eff6ff"><td colspan="2" style="padding:6px 10px;font-weight:700;font-size:11px;color:#1e40af">${hd}</td></tr>`;
  const tot=(lbl,val,clr='#1e40af')=>`<tr style="background:#f0fdf4"><td style="padding:6px 10px;font-weight:700">${lbl}</td><td style="padding:6px 10px;text-align:right;font-family:monospace;font-weight:700;color:${clr}">${val}</td></tr>`;
  _mgrPrint(`<div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:14px">
      <h2 style="margin:0;font-size:16px">INCENTIVE DETAIL — ${my}</h2>
      <p style="margin:4px 0 0;font-size:11px;opacity:.7">Printed: ${today}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${sec('Base Figures')}
      ${row('Sale Value',fv(saleVal))}${row('Generic Sale',fv(genSale))}${row('Less Pilferage',fv(pilferage),'color:#dc2626')}${row('Till Short',fv(tillShort),'color:#dc2626')}
      ${sec('Commission')}
      ${row('Sale Commission (0.5%)',fv(saleComm))}${row('Less Pilferage','-'+fv(pilferage),'color:#dc2626')}${row('Till Cheque','-'+fv(tillShort),'color:#dc2626')}
      ${tot('Total Commission',fv(totalComm))}
      ${sec('Bonus')}${tot('Cash Target Bonus',fv(totalBonus))}
      ${sec('Generic')}${row('Generic Incentive (4.5%)',fv(genInc))}${row('Less Excess Fine','-'+fv(excessFine),'color:#dc2626')}${tot('Total Generic',fv(totalGen))}
      <tr style="background:#0f172a;color:#fff"><td style="padding:8px 10px;font-weight:700;font-size:13px">🏆 Grand Total</td><td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:#fff">${fv(grandTotal)}</td></tr>
      ${sec('Deductions / Fine')}
      ${row('Plus % Fine',fv(plusFine),'color:#dc2626')}${row('Paper Fine',fv(paperFine),'color:#dc2626')}${tot('Total Deductions',fv(totalLess),'#dc2626')}
      ${row('Pre-panel Total',fv(prePanel))}${row('Panel Fine',fv(panelFine),'color:#dc2626')}
      <tr style="background:#052e16;color:#fff"><td style="padding:8px 10px;font-weight:700;font-size:13px">✅ Net Incentive</td><td style="padding:8px 10px;text-align:right;font-family:monospace;font-weight:700;font-size:14px;color:#4ade80">${fv(netInc)}</td></tr>
      ${sec('Split (÷ 2)')}${row('Tax',fv(tax),'color:#dc2626')}${tot('Salman Net',fv(salmanNet),'#1e40af')}
    </table>
  </div>`);
}

Object.assign(window, {
  _incKey, loadIncentiveMonth, saveIncentiveData, recalcIncentive, printIncentiveReport,
});

export {
  _incKey, loadIncentiveMonth, saveIncentiveData, recalcIncentive, printIncentiveReport,
};
