// ══════════════════════════════════════════
// DAY DETAIL MODAL
// ══════════════════════════════════════════
// Helper: returns are always stored as positive but must deduct — normalise to negative
(function() {
'use strict';

function _neg(v) { const x=n(v); return x>0?-x:x; }

function dayData(d) {
  const cashSale=n(d['Cash Sale']),meezan=n(d['Meezan Bank (Paysa)']),alfalah=n(d['Alfala Bank']),alHabib=n(d['Bank Al Habib']),hbl=n(d['HBL']),mcb=n(d['MCB']);
  const cashRet=_neg(d['Cash Returns']);                   // always negative
  const askari=n(d['Askari Bank']),askariRet=_neg(d['Askari Bank Returns']);
  const pso=n(d['PSO']),psoRet=_neg(d['PSO Returns']),nespak=n(d['NESPAK']),nespakRet=_neg(d['NESPAK Returns']);
  const parco=n(d['PARCO']),parcoRet=_neg(d['PARCO Returns']),tepa=n(d['TEPA']),tepaRet=_neg(d['TEPA Returns']);
  const lda=n(d['LDA']),ldaRet=_neg(d['LDA Returns']),fissue=n(d['F/Issue']);
  const gourmet=n(d['Gourmet']),wapda=n(d['Wapda Hospital']),bth=n(d['BTH']),berger=n(d['Berger Paints']);
  const ecolean=n(d['Ecolean PK']),style_t=n(d['Style Textile']),babar=n(d['Syed Babar Ali Foundation']);
  const rahnuma=n(d['Rahnuma NGO']),healthP=n(d['Health Pass']),nisar=n(d['Nisar Spinning Mills']),foodP=n(d['Food Panda']);

  // Custom fields added via Manage Fields (fields.js's _fmCustom, e.g. "Bank
  // Alfalah 2") are NOT in this file's hardcoded column list above — they
  // were silently excluded from every report/print view built from this
  // function, even though config.js's computeDailyTotals already folds them
  // into the stored TOTAL. That mismatch is exactly the bug: Daily Data /
  // Index showed the correct total (includes custom fields), every report
  // built from dayData() showed a different, lower one (didn't). Folding
  // them in dynamically here, once, fixes every caller of dayData() at once
  // instead of needing a fix per report function.
  const customRows = [];
  let customCash = 0, customCredit = 0;
  if (typeof _fmCustom !== 'undefined' && _fmCustom) {
    _fmCustom.forEach(f => {
      if (f.calcType === 'none') return;
      const raw = n(d[f.id]);
      if (!raw) return; // skip zero/unused custom fields so reports don't clutter
      const signed = f.calcType === 'sub' ? -Math.abs(raw) : raw;
      const isCash = f.section !== 'Credit Clients'; // 'Cash'/'Banks' → cash side
      if (isCash) customCash += signed; else customCredit += signed;
      customRows.push({ label: f.label, value: signed, cash: isCash });
    });
  }

  const netCash=cashSale+meezan+alfalah+alHabib+hbl+mcb+cashRet+customCash;   // cashRet is negative → subtracts
  const netCredit=pso+nespak+parco+askari+askariRet+lda+tepa+fissue+gourmet+wapda+bth+berger+ecolean+style_t+babar+rahnuma+healthP+nisar+foodP+psoRet+nespakRet+parcoRet+tepaRet+ldaRet+customCredit;
  const grand=netCash+netCredit;
  return {cashSale,meezan,alfalah,alHabib,hbl,mcb,cashRet,askari,askariRet,pso,psoRet,nespak,nespakRet,parco,parcoRet,tepa,tepaRet,lda,ldaRet,fissue,gourmet,wapda,bth,berger,ecolean,style_t,babar,rahnuma,healthP,nisar,foodP,netCash,netCredit,grand,customRows,
    fdpp:n(d['FDPP']),fdppCon:n(d['FDPP Con']),customers:n(d['Customers']),
    amtRec:n(d['Amount Received']),loadSale:n(d['Load Sale']),cashDepo:n(d['Cash to be Deposited']),compSale:n(d['COMP SALE']),
    diff:Math.round(n(d['TOTAL'])-n(d['COMP SALE'])),
    note:d['Low Sale Reason']||''};
}

function dmRowHTML(lbl,val,sub='') {
  const cls=val>0?'p':val<0?'n':'z';
  return `<div class="dmrow"><span class="dml">${lbl}${sub?'<sub>'+sub+'</sub>':''}</span><span class="dmv ${cls}">${fv(val)}</span></div>`;
}

function dmOptRow(lbl,val,sub='') { return val!==0?dmRowHTML(lbl,val,sub):''; }

function buildDayHTML(r) {
  return `
    <div class="dmsec"><div class="dmsh">💵 Cash Sale</div>
      ${dmRowHTML('Cash Sale',r.cashSale,'Sales Only')}
      ${dmRowHTML('Meezan Bank',r.meezan)}
      ${dmRowHTML('Bank Alfalah',r.alfalah)}
      ${dmRowHTML('Bank Al Habib',r.alHabib)}
      ${dmOptRow('HBL',r.hbl)}
      ${dmOptRow('MCB',r.mcb)}
      ${dmRowHTML('Cash Returns',r.cashRet,'Returns Only')}
      ${r.customRows.filter(c=>c.cash).map(c=>dmRowHTML(c.label,c.value)).join('')}
    </div>
    <div class="dmnet"><span>Net Cash Sale</span><span style="font-family:var(--mono)">${fv(r.netCash)}</span></div>
    <div class="dmsec"><div class="dmsh">📋 Credit Sale</div>
      ${dmRowHTML('PSO',r.pso,'Sales Only')}
      ${dmRowHTML('Nespak',r.nespak,'Sales Only')}
      ${dmRowHTML('Parco',r.parco,'Sales Only')}
      ${dmRowHTML('LDA',r.lda,'Sales Only')}
      ${dmRowHTML('Tepa',r.tepa)}
      ${dmRowHTML('Free Issue',r.fissue)}
      ${dmOptRow('Gourmet',r.gourmet)}
      ${dmOptRow('Wapda Hospital',r.wapda)}
      ${dmOptRow('BTH',r.bth)}
      ${dmOptRow('Berger Paints',r.berger)}
      ${dmOptRow('Ecolean PK',r.ecolean)}
      ${dmOptRow('Style Textile',r.style_t)}
      ${dmOptRow('Syed Babar Ali Fdn',r.babar)}
      ${dmOptRow('Rahnuma NGO',r.rahnuma)}
      ${dmOptRow('Health Pass',r.healthP)}
      ${dmOptRow('Nisar Spinning',r.nisar)}
      ${dmOptRow('Food Panda',r.foodP)}
      ${dmRowHTML('Credit Return PSO',r.psoRet,'Returns Only')}
      ${dmRowHTML('Credit Return Nespak',r.nespakRet,'Returns Only')}
      ${dmRowHTML('Credit Return Parco',r.parcoRet,'Returns Only')}
      ${dmRowHTML('Credit Return Tepa',r.tepaRet,'Returns Only')}
      ${dmRowHTML('Credit Return LDA',r.ldaRet,'Returns Only')}
      ${dmRowHTML('Askari',r.askari)}
      ${dmOptRow('Askari Returns',r.askariRet)}
      ${r.customRows.filter(c=>!c.cash).map(c=>dmRowHTML(c.label,c.value)).join('')}
    </div>
    <div class="dmnet"><span>Net Credit Sale</span><span style="font-family:var(--mono)">${fv(r.netCredit)}</span></div>
    <div class="dmgrand"><span>Grand Total</span><span style="font-family:var(--mono)">₨${fv(r.grand)}</span></div>
    <div class="dmmisc"><span>FDPP POS Sale</span><span class="dmv">${fv(r.fdpp)}</span></div>
    <div class="dmmisc"><span>FDPP Consumer POS Sale</span><span class="dmv">${fv(r.fdppCon)}</span></div>
    <div class="dmmisc"><span>Customers</span><span class="dmv">${fv(r.customers)}</span></div>
    ${r.compSale?`<div class="dmmisc"><span>COMP SALE</span><span class="dmv">${fv(r.compSale)}</span></div>`:''}
    ${(r.compSale||r.diff!==0)?`<div class="dmmisc" style="font-weight:700;border-top:1px dashed var(--border);padding-top:4px"><span style="color:${r.diff>0?'var(--green)':r.diff<0?'var(--red)':'var(--muted)'}">Difference (Total − COMP)</span><span class="dmv" style="color:${r.diff>0?'var(--green)':r.diff<0?'var(--red)':'var(--muted)'}">${fv(r.diff)}</span></div>`:''}
    ${r.amtRec?`<div class="dmmisc"><span>Amount Received</span><span class="dmv">${fv(r.amtRec)}</span></div>`:''}
    ${r.cashDepo?`<div class="dmmisc"><span>Cash to be Deposited</span><span class="dmv">${fv(r.cashDepo)}</span></div>`:''}
    ${r.loadSale?`<div class="dmmisc"><span>Load Sale</span><span class="dmv">${fv(r.loadSale)}</span></div>`:''}
    ${r.note?`<div class="dmnote">📝 ${r.note}</div>`:''}
  `;
}

function openDayModal(date, my) {
  const d=Repository.getDailyEntry(date, my);
  if(!d){ toast('Record not found for '+date,'w'); return; }
  _printDay={d,date,my};
  const r=dayData(d);
  const titleEl=document.getElementById('dm-title');
  const subEl=document.getElementById('dm-sub');
  const bodyEl=document.getElementById('dm-body');
  const bgEl=document.getElementById('dmbg');
  if(!titleEl||!subEl||!bodyEl||!bgEl) return; // DOM not ready yet
  titleEl.textContent=date;
  subEl.textContent=my;
  bodyEl.innerHTML=buildDayHTML(r);
  bgEl.classList.add('on');
}

function closeDay() { document.getElementById('dmbg').classList.remove('on'); _printDay=null; }

// ══════════════════════════════════════════
// MONTH MODAL
// ══════════════════════════════════════════
function openMonthModal(my) {
  const m=MONTHLY.find(x=>x.Month_Year===my); if(!m) return;
  _curMon = my;
  const days=DAILY.filter(d=>d.Month_Year===my&&n(d.TOTAL)>0)
    .sort((a,b)=>_dateVal(b.Date)-_dateVal(a.Date));
  const fields=[['Cash Sale',m['Cash Sale']],['Cash Returns',negR(m['Cash Returns'])],['HBL',m.HBL],['MCB',m.MCB],
    ['Bank Alfalah',m['Alfala Bank']],['Bank Al Habib',m['Bank Al Habib']],['Meezan Bank',m['Meezan Bank (Paysa)']],
    ['Askari',m['Askari Bank']],['Askari Returns',negR(m['Askari Bank Returns'])],
    ['PSO',m.PSO],['NESPAK',m.NESPAK],['PARCO',m.PARCO],['LDA',m.LDA],
    ['Gourmet',m.Gourmet],['F/Issue',m['F/Issue']],['COMP SALE',m['COMP SALE']],
    ['Difference',n(m.TOTAL)-n(m['COMP SALE'])],['TOTAL',m.TOTAL],['Customers',m.Customers],
    // Custom fields (Manage Fields, fields.js's _fmCustom — e.g. "Bank
    // Alfalah 2") were entirely absent from this tile list, same class of
    // bug as dayData()/reports-print.js: a hardcoded field list that never
    // knew custom fields exist. Appended dynamically so any custom field
    // added now or later shows up here without another code change.
    ...((typeof _fmCustom !== 'undefined' && _fmCustom) ? _fmCustom
      .filter(f => f.calcType !== 'none')
      .map(f => [f.label, f.calcType === 'sub' ? negR(m[f.id]) : m[f.id]]) : [])
  ].filter(([,v])=>v!=null&&n(v)!==0);

  const tgts=getTgts(), tgt=tgts[my];
  const tgtHTML=tgt?`<div style="margin-bottom:14px;padding:10px 12px;background:var(--alt);border-radius:8px;font-size:12px">
    🎯 Target: <strong>₨${fc(tgt)}</strong> · Achieved: <strong>₨${fc(n(m.TOTAL))}</strong> (${Math.min(100,Math.round(n(m.TOTAL)/tgt*100))}%)
    <div style="background:var(--border);border-radius:99px;height:5px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100,Math.round(n(m.TOTAL)/tgt*100))}%;background:var(--accent);border-radius:99px"></div></div>
  </div>`:'';

  document.getElementById('mon-title').textContent=my;
  document.getElementById('mon-body').innerHTML=tgtHTML+
    `<div class="statrow">${fields.map(([l,v])=>`<div class="stati"><div class="statil">${l}</div><div class="stativ">₨${fc(n(v))}</div></div>`).join('')}</div>
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Daily Breakdown — click any row for full detail</div>
    <div class="twrap tscroll" style="max-height:320px">
      <table><thead><tr><th style="text-align:left">Date</th><th>Total</th><th>Customers</th><th>F/Issue</th><th style="text-align:left">Note</th><th class="no-print" style="width:32px"></th></tr></thead>
      <tbody>${days.map(d=>`<tr class="cl" onclick="openDayFromMonth('${d.Date}','${my}')">
        <td>${d.Date}</td><td>₨${fc(n(d.TOTAL))}</td><td>${fc(n(d.Customers))}</td>
        <td>${n(d['F/Issue'])?'₨'+fc(n(d['F/Issue'])):'—'}</td>
        <td style="text-align:left;font-size:10px;color:var(--muted)">${d['Low Sale Reason']||''}</td>
        <td class="no-print"><button onclick="event.stopPropagation();closeMon();setTimeout(()=>openEditModal('${d.Date}','${my}'),220)" title="Edit ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(217,119,6,.3);background:var(--alt);color:#d97706;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✏️</button></td>
      </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px">No daily data</td></tr>'}
      </tbody></table>
    </div>`;
  document.getElementById('mbg').classList.add('on');
}

function openDayFromMonth(date, my) {
  closeMon();
  // Use 220ms — enough for modal close animation on slow phones
  setTimeout(()=>openDayModal(date, my), 220);
}

// Direct print from table row — no modal needed, reliable on all devices
function printDayDirectly(date, my) {
  const d=Repository.getDailyEntry(date, my);
  if(!d){ toast('Record not found for '+date,'w'); return; }
  _printDay={d,date,my};
  printCurrentDay();
}

function closeMon() { document.getElementById('mbg').classList.remove('on'); }


// ══════════════════════════════════════════
// SALE REPORT + DATE SEARCH
// ══════════════════════════════════════════
let _allDates=[], _selDate=null, _selMy=null;

const _MON_NUM={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function _dateVal(s) {
  // Converts "DD/Mon/YYYY" → numeric YYYYMMDD for correct chronological sorting
  const p=s?s.split('/'):[];
  if(p.length!==3) return 0;
  return parseInt(p[2])*10000+(_MON_NUM[p[1]]||0)*100+parseInt(p[0]);
}

function buildDateList() {
  _allDates=DAILY.filter(d=>n(d.TOTAL)!==0).sort((a,b)=>_dateVal(b.Date)-_dateVal(a.Date));
}

function dsInit() {
  buildDateList();
  // Set date picker max to today
  const el=document.getElementById('ds-input');
  if(el){ const t=new Date(); el.max=t.toISOString().split('T')[0]; }
}

function dsDateChange(val) {
  if(!val) return;
  // Convert YYYY-MM-DD to DD/Mon/YYYY to match DAILY_BASE date format
  const d=new Date(val+'T00:00:00');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd=String(d.getDate()).padStart(2,'0');
  const mon=months[d.getMonth()];
  const yyyy=d.getFullYear();
  const dateStr=`${dd}/${mon}/${yyyy}`;
  const rec=_allDates.find(r=>r.Date===dateStr);
  if(rec){ dsSelectRecord(dateStr, rec.Month_Year); }
  else {
    // Date not in data yet — show a notice
    _selDate=dateStr; _selMy=null;
    const card=document.getElementById('rpt-card');
    if(card) card.innerHTML=`<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">No data found for <strong>${dateStr}</strong><br><span style="font-size:11px">This date has no recorded entry yet.</span></div>`;
  }
}

function dsSelectRecord(date, my) {
  _selDate=date; _selMy=my;
  renderReport();
  showRptTarget(my);
}

function showRptTarget(my) {
  const tgts=getTgts(), tgt=tgts[my];
  const actual=my?n(MONTHLY.find(m=>m.Month_Year===my)?.TOTAL||0):0;
  const el=document.getElementById('rpt-tgt-info');
  if(tgt&&my){
    const p=Math.min(100,Math.round(actual/tgt*100));
    const c=p>=100?'var(--green)':p>=75?'var(--amber)':'var(--red)';
    el.innerHTML=`<div style="font-size:12px;margin-bottom:6px">Target: <strong>₨${fc(tgt)}</strong></div>
      <div style="font-size:12px;margin-bottom:6px">Collected: <strong>₨${fc(actual)}</strong></div>
      <div style="font-size:12px;font-weight:600;color:${c};margin-bottom:5px">${p}% achieved</div>
      <div class="kpbar"><div class="kpfill ${p>=100?'g':p>=75?'a':'r'}" style="width:${p}%"></div></div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Remaining: ₨${fc(Math.max(0,tgt-actual))}</div>`;
  } else {
    el.innerHTML='<span style="color:var(--muted)">No target set for this month.</span>';
  }
}

function renderReport() {
  if(!_selDate||!_selMy){ return; }
  const d=Repository.getDailyEntry(_selDate, _selMy);
  if(!d){ document.getElementById('rpt-card').innerHTML='<div style="color:var(--red);padding:20px">Record not found</div>'; return; }
  const r=dayData(d);
  const till=n(document.getElementById('rpt-till')?.value);
  const patty=n(document.getElementById('rpt-patty')?.value);
  const rrow=(lbl,val,cls='')=>`<div class="rrow ${cls}"><span>${lbl}</span><span class="rv">${fv(val)}</span></div>`;
  const ropt=(lbl,val)=>val!==0?rrow(lbl,val):'';
  document.getElementById('rpt-card').innerHTML=`
    <div style="border:1px solid #000;max-width:500px;margin:0 auto" id="rpt-printable">
      <div class="rheader">BAHRIA TOWN SALE REPORT</div>
      <div class="rdate-row"><span>Date:</span><span style="color:#c00">${_selDate}</span></div>
      <div class="rsec">Cash Sale:</div>
      ${rrow('Cash Sale <small style="font-size:10px;color:#888">(Sales Only)</small>',r.cashSale)}
      ${rrow('Meezan Bank',r.meezan)}
      ${rrow('Bank Alfalah',r.alfalah)}
      ${rrow('Bank Al Habib',r.alHabib)}
      ${ropt('HBL',r.hbl)}${ropt('MCB',r.mcb)}
      ${rrow('Cash Returns <small style="font-size:10px;color:#888">(Returns Only)</small>',r.cashRet)}
      ${r.customRows.filter(c=>c.cash).map(c=>rrow(c.label,c.value)).join('')}
      <div class="rnet"><span>Net Cash Sale:</span><span class="rv">${fv(r.netCash)}</span></div>
      <div class="rsec">Credit Sale:</div>
      ${rrow('PSO <small style="font-size:10px;color:#888">(Sales Only)</small>',r.pso)}
      ${rrow('Nespak <small style="font-size:10px;color:#888">(Sales Only)</small>',r.nespak)}
      ${rrow('Parco <small style="font-size:10px;color:#888">(Sales Only)</small>',r.parco)}
      ${rrow('Askari',r.askari)}
      ${rrow('LDA <small style="font-size:10px;color:#888">(Sales Only)</small>',r.lda)}
      ${rrow('Tepa',r.tepa)}
      ${rrow('Free Issue',r.fissue)}
      ${ropt('Gourmet',r.gourmet)}${ropt('Wapda Hospital',r.wapda)}${ropt('BTH',r.bth)}
      ${ropt('Berger Paints',r.berger)}${ropt('Ecolean PK',r.ecolean)}${ropt('Style Textile',r.style_t)}
      ${ropt('Syed Babar Ali Foundation',r.babar)}${ropt('Rahnuma NGO',r.rahnuma)}${ropt('Health Pass',r.healthP)}
      ${ropt('Nisar Spinning Mills',r.nisar)}${ropt('Food Panda',r.foodP)}
      ${rrow('Credit Return PSO <small style="font-size:10px;color:#888">(Returns Only)</small>',r.psoRet)}
      ${rrow('Credit Return Nespak <small style="font-size:10px;color:#888">(Returns Only)</small>',r.nespakRet)}
      ${rrow('Credit Return Parco <small style="font-size:10px;color:#888">(Returns Only)</small>',r.parcoRet)}
      ${rrow('Credit Return Tepa <small style="font-size:10px;color:#888">(Returns Only)</small>',r.tepaRet)}
      ${rrow('Credit Return LDA <small style="font-size:10px;color:#888">(Returns Only)</small>',r.ldaRet)}
      ${ropt('Askari Returns',r.askariRet)}
      ${r.customRows.filter(c=>!c.cash).map(c=>rrow(c.label,c.value)).join('')}
      <div class="rnet"><span>Net Credit Sale:</span><span class="rv">${fv(r.netCredit)}</span></div>
      <div class="rgrand"><span>Grand Total:</span><span class="rv">₨${fv(r.grand)}</span></div>
      ${(r.compSale||r.diff!==0)?`<div class="rmisc"><span>COMP SALE</span><span class="rv">${fv(r.compSale)}</span></div>`:''}
      ${(r.compSale||r.diff!==0)?`<div class="rmisc" style="font-weight:700;color:${r.diff>0?'#15803d':r.diff<0?'#c00':'#64748b'}"><span>Difference (Total − COMP)</span><span class="rv">${fv(r.diff)}</span></div>`:''}
      <div class="rmisc"><span style="color:#c00;font-weight:600">FDPP POS Sale:</span><span class="rv">${fv(r.fdpp)}</span></div>
      <div class="rmisc"><span style="color:#c00;font-weight:600">FDPP Consumer POS Sale:</span><span class="rv">${fv(r.fdppCon)}</span></div>
      <div class="rmisc"><span style="font-weight:600">Customers</span><span class="rv">${fv(r.customers)}</span></div>
      <div class="rmisc"><span>Till Short</span><span class="rv">${fv(till)}</span></div>
      <div class="rmisc"><span>Patty Cash</span><span class="rv">${fv(patty)}</span></div>
    </div>`;
}

// ══════════════════════════════════════════
// PRINT
// ══════════════════════════════════════════
function buildPrintHTML(date, my, till, patty) {
  const d=Repository.getDailyEntry(date, my);
  if(!d) return null;
  const r=dayData(d);
  const row=(lbl,val)=>`<tr><td style="padding:5px 12px;font-size:13px;border-bottom:1px solid #eee">${lbl}</td><td style="padding:5px 12px;font-size:13px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fv(val)}</td></tr>`;
  const orow=(lbl,val)=>val!==0?row(lbl,val):'';
  return `<div style="max-width:520px;margin:0 auto;font-family:Arial,sans-serif">
    <table style="width:100%;border-collapse:collapse;border:1px solid #000">
      <tr><td colspan="2" style="background:#000;color:#fff;text-align:center;font-size:14px;font-weight:700;padding:7px;letter-spacing:.04em">BAHRIA TOWN SALE REPORT</td></tr>
      <tr><td style="padding:5px 12px;font-size:13px;font-weight:600;border-bottom:1px solid #eee">Date:</td><td style="padding:5px 12px;font-size:13px;text-align:right;color:#c00;font-weight:700;border-bottom:1px solid #eee">${date}</td></tr>
      <tr><td colspan="2" style="text-align:center;font-size:13px;font-weight:700;padding:5px;background:#f8fafc;border-bottom:1px solid #eee">Cash Sale:</td></tr>
      ${row('Cash Sale (Sales Only)',r.cashSale)}
      ${row('Meezan Bank',r.meezan)}
      ${row('Bank Alfalah',r.alfalah)}
      ${row('Bank Al Habib',r.alHabib)}
      ${orow('HBL',r.hbl)}${orow('MCB',r.mcb)}
      ${row('Cash Returns (Returns Only)',r.cashRet)}
      ${r.customRows.filter(c=>c.cash).map(c=>row(c.label,c.value)).join('')}
      <tr><td style="padding:6px 12px;font-size:13px;font-weight:700;color:#c00;background:#fff5f5;border-top:1px solid #fecaca">Net Cash Sale:</td><td style="padding:6px 12px;font-size:13px;font-weight:700;color:#c00;text-align:right;font-family:monospace;background:#fff5f5;border-top:1px solid #fecaca">${fv(r.netCash)}</td></tr>
      <tr><td colspan="2" style="text-align:center;font-size:13px;font-weight:700;padding:5px;background:#f8fafc;border-top:1px solid #eee;border-bottom:1px solid #eee">Credit Sale:</td></tr>
      ${row('PSO (Sales Only)',r.pso)}${row('Nespak (Sales Only)',r.nespak)}${row('Parco (Sales Only)',r.parco)}
      ${row('Askari',r.askari)}${row('LDA (Sales Only)',r.lda)}${row('Tepa',r.tepa)}${row('Free Issue',r.fissue)}
      ${orow('Gourmet',r.gourmet)}${orow('Wapda Hospital',r.wapda)}${orow('BTH',r.bth)}
      ${orow('Berger Paints',r.berger)}${orow('Ecolean PK',r.ecolean)}${orow('Style Textile',r.style_t)}
      ${orow('Syed Babar Ali Foundation',r.babar)}${orow('Rahnuma NGO',r.rahnuma)}${orow('Health Pass',r.healthP)}
      ${orow('Nisar Spinning Mills',r.nisar)}${orow('Food Panda',r.foodP)}
      ${row('Credit Return PSO (Returns Only)',r.psoRet)}${row('Credit Return Nespak (Returns Only)',r.nespakRet)}
      ${row('Credit Return Parco (Returns Only)',r.parcoRet)}${row('Credit Return Tepa (Returns Only)',r.tepaRet)}
      ${row('Credit Return LDA (Returns Only)',r.ldaRet)}${orow('Askari Returns',r.askariRet)}
      ${r.customRows.filter(c=>!c.cash).map(c=>row(c.label,c.value)).join('')}
      <tr><td style="padding:6px 12px;font-size:13px;font-weight:700;color:#c00;background:#fff5f5;border-top:1px solid #fecaca">Net Credit Sale:</td><td style="padding:6px 12px;font-size:13px;font-weight:700;color:#c00;text-align:right;font-family:monospace;background:#fff5f5;border-top:1px solid #fecaca">${fv(r.netCredit)}</td></tr>
      <tr><td style="padding:10px 12px;font-size:16px;font-weight:700;color:#1e40af;background:#eff6ff;border-top:2px solid #bfdbfe">Grand Total:</td><td style="padding:10px 12px;font-size:16px;font-weight:700;color:#1e40af;text-align:right;font-family:monospace;background:#eff6ff;border-top:2px solid #bfdbfe">₨${fv(r.grand)}</td></tr>
      ${(r.compSale||r.diff!==0)?`<tr><td style="padding:5px 12px;font-size:12px;font-weight:600;border-bottom:1px solid #eee">COMP SALE</td><td style="padding:5px 12px;font-size:12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fv(r.compSale)}</td></tr>`:''}
      ${(r.compSale||r.diff!==0)?`<tr><td style="padding:5px 12px;font-size:13px;font-weight:700;border-bottom:2px solid #000;color:${r.diff>0?'#15803d':r.diff<0?'#c00':'#64748b'}">Difference (Total − COMP)</td><td style="padding:5px 12px;font-size:13px;font-weight:700;text-align:right;font-family:monospace;border-bottom:2px solid #000;color:${r.diff>0?'#15803d':r.diff<0?'#c00':'#64748b'}">${fv(r.diff)}</td></tr>`:''}
      <tr><td style="padding:5px 12px;font-size:12px;color:#c00;font-weight:600;border-bottom:1px solid #eee">FDPP POS Sale:</td><td style="padding:5px 12px;font-size:12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fv(r.fdpp)}</td></tr>
      <tr><td style="padding:5px 12px;font-size:12px;color:#c00;font-weight:600;border-bottom:1px solid #eee">FDPP Consumer POS Sale:</td><td style="padding:5px 12px;font-size:12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fv(r.fdppCon)}</td></tr>
      <tr><td style="padding:5px 12px;font-size:12px;font-weight:600;border-bottom:1px solid #eee">Customers</td><td style="padding:5px 12px;font-size:12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fv(r.customers)}</td></tr>
      ${row('Till Short',till)}${row('Patty Cash',patty)}
    </table>
  </div>`;
}

function printDayReport() {
  if(!_selDate){ toast('⚠ Select a date first','w'); return; }
  const till=n(document.getElementById('rpt-till')?.value);
  const patty=n(document.getElementById('rpt-patty')?.value);
  const html=buildPrintHTML(_selDate,_selMy,till,patty);
  if(!html){ toast('⚠ Record not found','e'); return; }
  Print.render(html);
}

function printCurrentDay() {
  if(!_printDay){ toast('⚠ No day open','w'); return; }
  const html=buildPrintHTML(_printDay.date,_printDay.my,0,0);
  if(!html){ toast('⚠ Record not found','e'); return; }
  closeDay();
  Print.render(html);
}

function copyReportText() {
  if(!_selDate){ toast('⚠ Select a date first','w'); return; }
  const d=Repository.getDailyEntry(_selDate, _selMy);
  if(!d){ toast('⚠ Record not found','e'); return; }
  const r=dayData(d);
  const till=n(document.getElementById('rpt-till')?.value);
  const patty=n(document.getElementById('rpt-patty')?.value);
  const line=(l,v)=>l.padEnd(35)+fv(v);
  const txt=[`BAHRIA TOWN SALE REPORT`,`Date: ${_selDate}`,
    '','Cash Sale:',line('Cash Sale (Sales Only)',r.cashSale),line('Meezan Bank',r.meezan),
    line('Bank Alfalah',r.alfalah),line('Bank Al Habib',r.alHabib),
    ...(r.hbl?[line('HBL',r.hbl)]:[]),...(r.mcb?[line('MCB',r.mcb)]:[]),
    line('Cash Returns',r.cashRet),
    ...r.customRows.filter(c=>c.cash).map(c=>line(c.label,c.value)),
    'Net Cash Sale: '+fv(r.netCash),
    '','Credit Sale:',line('PSO',r.pso),line('Nespak',r.nespak),line('Parco',r.parco),
    line('Askari',r.askari),line('LDA',r.lda),line('Tepa',r.tepa),line('Free Issue',r.fissue),
    line('Credit Return PSO',r.psoRet),line('Credit Return Nespak',r.nespakRet),
    line('Credit Return Parco',r.parcoRet),line('Credit Return Tepa',r.tepaRet),line('Credit Return LDA',r.ldaRet),
    ...r.customRows.filter(c=>!c.cash).map(c=>line(c.label,c.value)),
    'Net Credit Sale: '+fv(r.netCredit),'','Grand Total: ₨'+fv(r.grand),
    ...(r.compSale||r.diff!==0?[line('COMP SALE',r.compSale),'Difference (Total − COMP): '+fv(r.diff)]:[]),
    line('FDPP POS Sale',r.fdpp),line('FDPP Consumer POS Sale',r.fdppCon),
    line('Customers',r.customers),line('Till Short',till),line('Patty Cash',patty)
  ].join('\n');
  navigator.clipboard.writeText(txt).then(()=>toast('✓ Copied')).catch(()=>toast('⚠ Copy failed','w'));
}

// ══════════════════════════════════════════

// Bridge what's used externally or from index.html.
window.openDayModal = openDayModal;
window.closeDay = closeDay;
window.openMonthModal = openMonthModal;
window.printDayDirectly = printDayDirectly;
window.closeMon = closeMon;
window._dateVal = _dateVal;
window.buildDateList = buildDateList;
window.dsInit = dsInit;
window.dsDateChange = dsDateChange;
window.renderReport = renderReport;
window.buildPrintHTML = buildPrintHTML;
window.printDayReport = printDayReport;
window.printCurrentDay = printCurrentDay;
window.copyReportText = copyReportText;

})();
