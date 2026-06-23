// ══════════════════════════════════════════
// DAILY TABLE
// ══════════════════════════════════════════
function renderDataTable() {
  const q=(document.getElementById('data-search')?.value||'').toLowerCase();
  const mon=document.getElementById('data-month')?.value||'';
  const col=document.getElementById('data-col')?.value||'TOTAL';
  const extraCol=col!=='TOTAL'?col:null;
  const titleEl=document.getElementById('data-htitle');
  const subEl=document.getElementById('data-hsub');

  const filtered=DAILY.filter(d=>
    (!mon||d.Month_Year===mon)&&
    (!q||(d.Date||'').toLowerCase().includes(q)||(d.Month_Year||'').toLowerCase().includes(q))
  ).filter(d=>n(d.TOTAL)!==0||d['Low Sale Reason']);

  if(mon){
    // Single month selected — flat table
    const rows=filtered.slice().sort((a,b)=>_dateVal(b.Date)-_dateVal(a.Date));
    const oldEl2=document.getElementById('tbl-daily');
    const tbl=document.createElement('table');
    tbl.id='tbl-daily';
    tbl.innerHTML=`<thead><tr><th style="text-align:left">Date</th>
      ${extraCol?'<th>'+extraCol+'</th>':''}<th>Total</th><th>Customers</th>
    </tr></thead>`;
    const tbody=document.createElement('tbody');
    rows.forEach(d=>{
      const tr=document.createElement('tr');
      tr.className='cl'; tr.title='Click for full breakdown';
      tr.onclick=()=>openDayModal(d.Date,d.Month_Year);
      const ev=extraCol?'<td>'+(n(d[extraCol])?'&#8360;'+fc(n(d[extraCol])):'&#8212;')+'</td>':'';
      tr.innerHTML=`<td>${d.Date||''}</td>${ev}<td>${n(d.TOTAL)?'&#8360;'+fc(n(d.TOTAL)):'&#8212;'}</td><td>${n(d.Customers)?fc(n(d.Customers)):'&#8212;'}</td>`;
      tbody.appendChild(tr);
    });
    if(!rows.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">No records</td>'; tbody.appendChild(tr); }
    tbl.appendChild(tbody);
    if(oldEl2) oldEl2.replaceWith(tbl);
    if(titleEl) titleEl.textContent=mon;
    if(subEl) subEl.textContent=rows.length+' records — '+mon;
    return;
  }

  // All months — group by month, collapsible cards
  const byMon={};
  filtered.forEach(d=>{ const k=d.Month_Year||'Unknown'; (byMon[k]=byMon[k]||[]).push(d); });

  const MONTH_ORDER=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const sortedMons=Object.keys(byMon).sort((a,b)=>{
    const[am,ay]=a.split(' '); const[bm,by_]=b.split(' ');
    if(ay!==by_) return parseInt(by_)-parseInt(ay);
    return MONTH_ORDER.indexOf(bm)-MONTH_ORDER.indexOf(am);
  });

  const oldEl=document.getElementById('tbl-daily');
  const wrapper=document.createElement('div');
  wrapper.id='tbl-daily';

  let totalRecords=0;
  sortedMons.forEach((monKey,mi)=>{
    const rows=byMon[monKey].slice().sort((a,b)=>_dateVal(b.Date)-_dateVal(a.Date));
    totalRecords+=rows.length;
    const monTotal=rows.reduce((s,d)=>s+n(d.TOTAL),0);
    const monCust=rows.reduce((s,d)=>s+n(d.Customers),0);
    const isLatest=mi===0;

    const grp=document.createElement('div');
    grp.className='mon-group';

    const hdr=document.createElement('div');
    hdr.className='mon-hdr';
    hdr.innerHTML=`<div class="mon-hdr-left"><span class="mon-chevron${isLatest?' open':''}">&#9654;</span><span class="mon-hdr-label">${monKey}</span><span class="mon-hdr-meta">${rows.length} days</span></div><div style="display:flex;align-items:center;gap:12px"><span class="mon-hdr-total">&#8360; ${ff(monTotal)}</span><span class="mon-hdr-meta">&#128101; ${fc(monCust)}</span></div>`;
    hdr.onclick=()=>toggleMonGroup(hdr);

    const body=document.createElement('div');
    body.className='mon-body'+(isLatest?' open':'');

    const tblWrap=document.createElement('div');
    tblWrap.className='mon-tbl-wrap';
    const tbl=document.createElement('table');
    const thead=document.createElement('thead');
    thead.innerHTML=`<tr><th style="text-align:left">Date</th>${extraCol?'<th>'+extraCol+'</th>':''}<th>Total</th><th>Customers</th></tr>`;
    tbl.appendChild(thead);
    const tbody=document.createElement('tbody');
    rows.forEach(d=>{
      const tr=document.createElement('tr');
      tr.className='cl'; tr.title='Click for full breakdown';
      tr.onclick=()=>openDayModal(d.Date,d.Month_Year);
      const ev=extraCol?`<td>${n(d[extraCol])?'&#8360;'+fc(n(d[extraCol])):'&#8212;'}</td>`:'';
      tr.innerHTML=`<td>${d.Date||''}</td>${ev}<td>${n(d.TOTAL)?'&#8360;'+fc(n(d.TOTAL)):'&#8212;'}</td><td>${n(d.Customers)?fc(n(d.Customers)):'&#8212;'}</td>`;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tblWrap.appendChild(tbl);
    body.appendChild(tblWrap);
    grp.appendChild(hdr); grp.appendChild(body);
    wrapper.appendChild(grp);
  });

  if(!sortedMons.length){
    const empty=document.createElement('div');
    empty.style.cssText='text-align:center;padding:32px;color:var(--muted);font-size:13px';
    empty.textContent='No records found';
    wrapper.appendChild(empty);
  }

  if(oldEl) oldEl.replaceWith(wrapper);
  if(titleEl) titleEl.textContent='All Entries';
  if(subEl) subEl.textContent=totalRecords+' records across '+sortedMons.length+' months';
  // Store in render cache
  _rc.data = { key: _rcKey('data'), html: wrapper.innerHTML };
}

function toggleMonGroup(hdr) {
  const body=hdr.nextElementSibling;
  const chev=hdr.querySelector('.mon-chevron');
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  if(chev) chev.classList.toggle('open',!isOpen);
}

// ══════════════════════════════════════════
// ENTRY FORM
// ══════════════════════════════════════════
const ADD_IDS=['Cash_Sale','HBL','MCB','Alfala_Bank','Bank_Al_Habib','Meezan_Bank','Askari_Bank',
  'PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda_Hospital','BTH','Berger_Paints',
  'Ecolean_PK','Style_Textile','Syed_Babar_Ali','Rahnuma_NGO','Health_Pass','Nisar_Spinning','Food_Panda','F_Issue'];
const SUB_IDS=['Cash_Returns','Askari_Bank_Returns','PSO_Returns','NESPAK_Returns','PARCO_Returns','TEPA_Returns','LDA_Returns'];

function calcTotal() {
  let t=0;
  ADD_IDS.forEach(id=>{ const el=document.getElementById('e-'+id); if(el) t+=n(el.value); });
  SUB_IDS.forEach(id=>{ const el=document.getElementById('e-'+id); if(el) t-=Math.abs(n(el.value)); });
  const out=document.getElementById('e-TOTAL'); if(out) out.value=Math.round(t)||'';
}

const FM={'Cash Sale':'Cash_Sale','Cash Returns':'Cash_Returns','HBL':'HBL','MCB':'MCB',
  'Alfala Bank':'Alfala_Bank','Bank Al Habib':'Bank_Al_Habib','Meezan Bank (Paysa)':'Meezan_Bank',
  'Askari Bank':'Askari_Bank','Askari Bank Returns':'Askari_Bank_Returns',
  'PSO':'PSO','PSO Returns':'PSO_Returns','NESPAK':'NESPAK','NESPAK Returns':'NESPAK_Returns',
  'PARCO':'PARCO','PARCO Returns':'PARCO_Returns','TEPA':'TEPA','TEPA Returns':'TEPA_Returns',
  'LDA':'LDA','LDA Returns':'LDA_Returns','Gourmet':'Gourmet','Wapda Hospital':'Wapda_Hospital',
  'BTH':'BTH','Berger Paints':'Berger_Paints','Ecolean PK':'Ecolean_PK','Style Textile':'Style_Textile',
  'Syed Babar Ali Foundation':'Syed_Babar_Ali','Rahnuma NGO':'Rahnuma_NGO','Health Pass':'Health_Pass',
  'Nisar Spinning Mills':'Nisar_Spinning','Food Panda':'Food_Panda','F/Issue':'F_Issue',
  'COMP SALE':'COMP_SALE','Customers':'Customers','FDPP':'FDPP','FDPP Con':'FDPP_Con',
  'Amount Received':'Amount_Received','Load Sale':'Load_Sale','Cash to be Deposited':'Cash_to_Deposit',
  'Low Sale Reason':'Low_Sale_Reason'};

async function saveEntry() {
  const month=document.getElementById('e-month').value;
  const dateRaw=document.getElementById('e-date').value;
  if(!month||!dateRaw){ toast('⚠ Select a month and date','w'); return; }
  // Convert ISO date (2026-06-22) to DD/Mon/YYYY format used by DAILY
  const _months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [_y,_m,_d]=dateRaw.split('-');
  const date=`${_d}/${_months[parseInt(_m,10)-1]}/${_y}`;
  const entry={Month_Year:month,Date:date};
  for(const[col,id] of Object.entries(FM)){
    const el=document.getElementById('e-'+id); if(!el) continue;
    entry[col]=el.type==='text'?(el.value||null):(el.value?parseFloat(el.value):null);
  }
  entry['TOTAL']=String(n(document.getElementById('e-TOTAL').value));
  entry['Sale Plus']=null; entry['DIFF']=null;
  // Remove any existing entry for the same date (overwrite)
  const existDailyIdx=DAILY.findIndex(d=>d.Date===date&&d.Month_Year===month);
  if(existDailyIdx!==-1) DAILY.splice(existDailyIdx,1);
  const existNewIdx=newEntries.findIndex(d=>d.Date===date&&d.Month_Year===month);
  if(existNewIdx!==-1) newEntries.splice(existNewIdx,1);
  newEntries.push(entry); DAILY.push(entry);
  localStorage.setItem('bt_entries',JSON.stringify(newEntries));
  renderEntryList();
  rebuildAll();
  toast('✓ Entry saved');
  if(localStorage.getItem('bt_auto_save')==='1') pushToGitHub();
}

function renderEntryList() {
  const el=document.getElementById('entry-list');
  if(!newEntries.length){ el.textContent='No entries this session.'; return; }
  el.innerHTML=newEntries.map((e,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span class="badge bg-blue">${e.Date}</span>
      <span style="font-size:12px">${e.Month_Year}</span>
      <span style="font-family:var(--mono);font-size:12px">₨${fc(n(e.TOTAL))}</span>
      <span style="color:var(--muted);font-size:12px">👥${fc(n(e.Customers))}</span>
      <button class="btn btn-d" style="padding:2px 8px;font-size:10px;margin-left:auto" onclick="delEntry(${i})">✕</button>
    </div>`).join('');
}

function delEntry(i){ newEntries.splice(i,1); localStorage.setItem('bt_entries',JSON.stringify(newEntries)); renderEntryList(); }
function clearEntryForm(){ document.querySelectorAll('#page-entry input,#page-entry select').forEach(el=>{ if(el.type!=='submit') el.value=''; }); autoFillEntryDate(); }
function autoFillEntryDate() {
  // Find the latest date that does NOT yet have an entry in DAILY
  // Collect all recorded dates from DAILY (base + new entries)
  const recorded=new Set(DAILY.map(d=>d.Date));
  // Walk backwards from today until we find an unrecorded weekday (or just today)
  const today=new Date();
  let target=today;
  // Try today first; if already recorded, keep today (user may want to overwrite)
  // Always pre-fill with today's date — user can change if needed
  const yyyy=target.getFullYear();
  const mm=String(target.getMonth()+1).padStart(2,'0');
  const dd=String(target.getDate()).padStart(2,'0');
  const isoDate=`${yyyy}-${mm}-${dd}`;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr=`${dd}/${months[target.getMonth()]}/${yyyy}`;

  // Set the date field
  const dateEl=document.getElementById('e-date');
  if(dateEl && !dateEl.value) dateEl.value=isoDate;

  // Auto-select the month in the month dropdown if not already set
  const monthEl=document.getElementById('e-month');
  if(monthEl && (!monthEl.value || monthEl.value==='')) {
    const monthYear=`${months[target.getMonth()]} ${yyyy}`;
    // Find the matching option
    for(let i=0;i<monthEl.options.length;i++){
      if(monthEl.options[i].value===monthYear || monthEl.options[i].text===monthYear){
        monthEl.value=monthEl.options[i].value;
        break;
      }
    }
  }

  // Show a badge if today is already recorded
  const alreadyDone=recorded.has(dateStr);
  const hero=document.querySelector('#page-entry .hero .hsub');
  if(hero){
    if(alreadyDone){
      hero.innerHTML='⚠️ <strong>'+dateStr+'</strong> already has an entry. Saving will overwrite it.';
    } else {
      hero.innerHTML='📅 Auto-selected <strong>'+dateStr+'</strong> — next unrecorded date. Total auto-calculates.';
    }
  }
}

