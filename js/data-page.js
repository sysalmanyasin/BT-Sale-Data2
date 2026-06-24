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
    const tbl=document.createElement('table');
    tbl.id='tbl-daily';
    const oldEl2=document.getElementById('tbl-daily');
    const tbl2=document.createElement('table');
    tbl2.id='tbl-daily';
    tbl2.innerHTML=`<thead><tr><th style="text-align:left">Date</th>
      ${extraCol?'<th>'+extraCol+'</th>':''}<th>Total</th><th>Customers</th><th class="no-print" style="width:70px"></th>
    </tr></thead>`;
    const tbody=document.createElement('tbody');
    rows.forEach(d=>{
      const tr=document.createElement('tr');
      tr.className='cl'; tr.title='Click for full breakdown';
      tr.onclick=()=>openDayModal(d.Date,d.Month_Year);
      const ev=extraCol?'<td>'+(n(d[extraCol])?'&#8360;'+fc(n(d[extraCol])):'&#8212;')+'</td>':'';
      tr.innerHTML=`<td>${d.Date||''}</td>${ev}<td>${n(d.TOTAL)?'&#8360;'+fc(n(d.TOTAL)):'&#8212;'}</td><td>${n(d.Customers)?fc(n(d.Customers)):'&#8212;'}</td><td class="no-print" style="display:flex;gap:4px"><button onclick="event.stopPropagation();printDayDirectly('${d.Date}','${d.Month_Year}')" title="Print ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(37,99,235,.25);background:var(--alt);color:var(--accent);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">🖨</button><button onclick="event.stopPropagation();openEditModal('${d.Date}','${d.Month_Year}')" title="Edit ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(217,119,6,.3);background:var(--alt);color:#d97706;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✏️</button></td>`;
      tbody.appendChild(tr);
    });
    if(!rows.length){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">No records</td>'; tbody.appendChild(tr); }
    tbl2.appendChild(tbody);
    if(oldEl2) oldEl2.replaceWith(tbl2);
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
    thead.innerHTML=`<tr><th style="text-align:left">Date</th>${extraCol?'<th>'+extraCol+'</th>':''}<th>Total</th><th>Customers</th><th class="no-print" style="width:70px"></th></tr>`;
    tbl.appendChild(thead);
    const tbody=document.createElement('tbody');
    rows.forEach(d=>{
      const tr=document.createElement('tr');
      tr.className='cl'; tr.title='Click for full breakdown';
      tr.onclick=()=>openDayModal(d.Date,d.Month_Year);
      const ev=extraCol?`<td>${n(d[extraCol])?'&#8360;'+fc(n(d[extraCol])):'&#8212;'}</td>`:'';
      tr.innerHTML=`<td>${d.Date||''}</td>${ev}<td>${n(d.TOTAL)?'&#8360;'+fc(n(d.TOTAL)):'&#8212;'}</td><td>${n(d.Customers)?fc(n(d.Customers)):'&#8212;'}</td><td class="no-print" style="display:flex;gap:4px"><button onclick="event.stopPropagation();printDayDirectly('${d.Date}','${d.Month_Year}')" title="Print ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(37,99,235,.25);background:var(--alt);color:var(--accent);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">🖨</button><button onclick="event.stopPropagation();openEditModal('${d.Date}','${d.Month_Year}')" title="Edit ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(217,119,6,.3);background:var(--alt);color:#d97706;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✏️</button></td>`;
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

const _ENTRY_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

function entryMonthYearFromIso(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const mi = parseInt(m, 10) - 1;
  if (!y || mi < 0 || mi > 11) return '';
  return _ENTRY_MONTHS[mi] + ' ' + y;
}

function ensureEntryMonthOption(monthYear) {
  const monthEl = document.getElementById('e-month');
  if (!monthEl || !monthYear) return;
  if (![...monthEl.options].some(o => o.value === monthYear)) {
    const opt = document.createElement('option');
    opt.value = monthYear;
    opt.textContent = monthYear;
    monthEl.appendChild(opt);
  }
  monthEl.value = monthYear;
}

function syncEntryMonthFromDate() {
  const monthYear = entryMonthYearFromIso(document.getElementById('e-date')?.value);
  if (monthYear) ensureEntryMonthOption(monthYear);
}

async function saveEntry() {
  const dateRaw=document.getElementById('e-date').value;
  if(!dateRaw){ toast('⚠ Select a date','w'); return; }
  let month=document.getElementById('e-month').value;
  if(!month) month=entryMonthYearFromIso(dateRaw);
  if(!month){ toast('⚠ Could not determine month from date','w'); return; }
  ensureEntryMonthOption(month);
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
  // Auto-compute MONTHLY totals from DAILY so dashboard/index/reports all reflect this entry
  recomputeMonthly(month);
  renderEntryList();
  rebuildAll();
  toast('✓ Entry saved — dashboard & monthly totals updated');
  if(localStorage.getItem('bt_auto_save')==='1') pushToSupabase();
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

  // Keep month in sync with the selected date
  syncEntryMonthFromDate();

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


// ══════════════════════════════════════════
// EDIT MODAL
// ══════════════════════════════════════════
let _editDate=null, _editMy=null;

// Field definitions for edit modal (label → data key)
const EDIT_FIELDS=[
  {label:'Cash Sale',          key:'Cash Sale',              section:'Cash Sale', sub:'sub'},
  {label:'Meezan Bank',        key:'Meezan Bank (Paysa)',    section:'Cash Sale'},
  {label:'Bank Alfalah',       key:'Alfala Bank',            section:'Cash Sale'},
  {label:'Bank Al Habib',      key:'Bank Al Habib',          section:'Cash Sale'},
  {label:'HBL',                key:'HBL',                    section:'Cash Sale', opt:true},
  {label:'MCB',                key:'MCB',                    section:'Cash Sale', opt:true},
  {label:'Cash Returns',       key:'Cash Returns',           section:'Cash Sale', ret:true},
  {label:'PSO',                key:'PSO',                    section:'Credit Sale'},
  {label:'NESPAK',             key:'NESPAK',                 section:'Credit Sale'},
  {label:'PARCO',              key:'PARCO',                  section:'Credit Sale'},
  {label:'Askari',             key:'Askari Bank',            section:'Credit Sale'},
  {label:'LDA',                key:'LDA',                    section:'Credit Sale'},
  {label:'TEPA',               key:'TEPA',                   section:'Credit Sale'},
  {label:'F/Issue',            key:'F/Issue',                section:'Credit Sale'},
  {label:'Gourmet',            key:'Gourmet',                section:'Credit Sale', opt:true},
  {label:'Wapda Hospital',     key:'Wapda Hospital',         section:'Credit Sale', opt:true},
  {label:'BTH',                key:'BTH',                    section:'Credit Sale', opt:true},
  {label:'Berger Paints',      key:'Berger Paints',          section:'Credit Sale', opt:true},
  {label:'Ecolean PK',         key:'Ecolean PK',             section:'Credit Sale', opt:true},
  {label:'Style Textile',      key:'Style Textile',          section:'Credit Sale', opt:true},
  {label:'Syed Babar Ali Fdn', key:'Syed Babar Ali Foundation', section:'Credit Sale', opt:true},
  {label:'Rahnuma NGO',        key:'Rahnuma NGO',            section:'Credit Sale', opt:true},
  {label:'Health Pass',        key:'Health Pass',            section:'Credit Sale', opt:true},
  {label:'Nisar Spinning',     key:'Nisar Spinning Mills',   section:'Credit Sale', opt:true},
  {label:'Food Panda',         key:'Food Panda',             section:'Credit Sale', opt:true},
  {label:'Credit Return PSO',  key:'PSO Returns',            section:'Credit Sale', ret:true},
  {label:'Credit Return NESPAK', key:'NESPAK Returns',       section:'Credit Sale', ret:true},
  {label:'Credit Return PARCO',  key:'PARCO Returns',        section:'Credit Sale', ret:true},
  {label:'Credit Return TEPA',   key:'TEPA Returns',         section:'Credit Sale', ret:true},
  {label:'Credit Return LDA',    key:'LDA Returns',          section:'Credit Sale', ret:true},
  {label:'Askari Returns',       key:'Askari Bank Returns',  section:'Credit Sale', ret:true},
  {label:'FDPP POS Sale',      key:'FDPP',                   section:'Info'},
  {label:'FDPP Consumer POS',  key:'FDPP Con',               section:'Info'},
  {label:'Customers',          key:'Customers',              section:'Info'},
  {label:'Load Sale',          key:'Load Sale',              section:'Info', opt:true},
  {label:'Amount Received',    key:'Amount Received',        section:'Info', opt:true},
  {label:'Cash to Deposit',    key:'Cash to be Deposited',   section:'Info', opt:true},
  {label:'COMP SALE',          key:'COMP SALE',              section:'Info', opt:true},
  {label:'Low Sale Reason',    key:'Low Sale Reason',        section:'Info', text:true},
];

function openEditModal(date, my) {
  const rec = DAILY.find(x=>x.Date===date && x.Month_Year===my);
  if(!rec){ toast('⚠ Record not found','e'); return; }
  _editDate=date; _editMy=my;

  const sections={};
  EDIT_FIELDS.forEach(f=>{
    if(!sections[f.section]) sections[f.section]=[];
    sections[f.section].push(f);
  });

  let html='';
  for(const [sec, fields] of Object.entries(sections)){
    html+=`<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 6px">${sec}</div>`;
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
    fields.forEach(f=>{
      const val = rec[f.key];
      const raw = (val==null||val==='')?'':(f.ret?Math.abs(Number(val)||0):Number(val)||0);
      const inputType = f.text?'text':'number';
      const inputMode = f.text?'text':'decimal';
      const hint = f.ret?' (enter positive)':'';
      if(f.text){
        html+=`<div style="grid-column:1/-1"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:3px">${f.label}</label>
          <input type="text" inputmode="text" id="em-${f.key.replace(/[^a-z0-9]/gi,'_')}" value="${String(val||'').replace(/"/g,'&quot;')}"
            style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
      } else {
        html+=`<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:3px">${f.label}${hint}</label>
          <input type="${inputType}" inputmode="${inputMode}" id="em-${f.key.replace(/[^a-z0-9]/gi,'_')}" value="${raw}"
            oninput="editCalcTotal()"
            style="width:100%;padding:8px 10px;border:1px solid ${f.ret?'rgba(220,38,38,.35)':'var(--border)'};border-radius:8px;font-size:14px;background:var(--s2);color:var(--text);box-sizing:border-box;${f.ret?'color:#dc2626':''}"></div>`;
      }
    });
    html+=`</div>`;
  }

  html+=`<div style="margin-top:14px;padding:10px 12px;background:var(--alt);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:13px;font-weight:600">Grand Total</span>
    <span style="font-family:var(--mono);font-size:15px;font-weight:700;color:var(--accent)" id="em-total-preview">₨0</span>
  </div>`;

  document.getElementById('edit-modal-title').textContent='Edit — '+date;
  document.getElementById('edit-modal-body').innerHTML=html;
  document.getElementById('edit-modal-bg').style.display='flex';
  editCalcTotal();
}

function openEditFromDay() {
  if(!_printDay){ toast('⚠ No day open','w'); return; }
  const date=_printDay.date, my=_printDay.my;
  closeDay();
  setTimeout(()=>openEditModal(date, my), 220);
}

function editCalcTotal() {
  const ADD_KEYS=['Cash Sale','Meezan Bank (Paysa)','Alfala Bank','Bank Al Habib','HBL','MCB',
    'Askari Bank','PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints',
    'Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','F/Issue'];
  const SUB_KEYS=['Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns'];
  let t=0;
  ADD_KEYS.forEach(k=>{ const el=document.getElementById('em-'+k.replace(/[^a-z0-9]/gi,'_')); if(el) t+=Math.abs(parseFloat(el.value)||0); });
  SUB_KEYS.forEach(k=>{ const el=document.getElementById('em-'+k.replace(/[^a-z0-9]/gi,'_')); if(el) t-=Math.abs(parseFloat(el.value)||0); });
  const prev=document.getElementById('em-total-preview');
  if(prev) prev.textContent='₨'+Math.round(t).toLocaleString('en-PK');
}

function closeEditModal() {
  document.getElementById('edit-modal-bg').style.display='none';
  _editDate=null; _editMy=null;
}

async function saveEditModal() {
  if(!_editDate||!_editMy){ toast('⚠ Nothing to save','w'); return; }
  const rec = DAILY.find(x=>x.Date===_editDate && x.Month_Year===_editMy);
  if(!rec){ toast('⚠ Record not found','e'); return; }

  const SUB_KEYS_SET=new Set(['Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns']);

  EDIT_FIELDS.forEach(f=>{
    const el=document.getElementById('em-'+f.key.replace(/[^a-z0-9]/gi,'_'));
    if(!el) return;
    if(f.text){ rec[f.key]=el.value||null; }
    else {
      const v=parseFloat(el.value)||0;
      // Returns always stored as positive (calcTotal subtracts them by convention)
      rec[f.key]=v===0?null:(SUB_KEYS_SET.has(f.key)?Math.abs(v):v);
    }
  });

  // Recompute TOTAL
  const ADD_KEYS=['Cash Sale','Meezan Bank (Paysa)','Alfala Bank','Bank Al Habib','HBL','MCB',
    'Askari Bank','PSO','NESPAK','PARCO','TEPA','LDA','Gourmet','Wapda Hospital','BTH','Berger Paints',
    'Ecolean PK','Style Textile','Syed Babar Ali Foundation','Rahnuma NGO','Health Pass','Nisar Spinning Mills','Food Panda','F/Issue'];
  const SUB_KEYS=['Cash Returns','Askari Bank Returns','PSO Returns','NESPAK Returns','PARCO Returns','TEPA Returns','LDA Returns'];
  let t=0;
  ADD_KEYS.forEach(k=>{ t+=Math.abs(n(rec[k])); });
  SUB_KEYS.forEach(k=>{ t-=Math.abs(n(rec[k])); });
  rec['TOTAL']=String(Math.round(t));

  // Sync to newEntries (for push) — overwrite or add
  const ni=newEntries.findIndex(d=>d.Date===_editDate&&d.Month_Year===_editMy);
  if(ni!==-1) newEntries[ni]=rec; else newEntries.push(rec);
  localStorage.setItem('bt_entries',JSON.stringify(newEntries));

  recomputeMonthly(_editMy);
  renderEntryList();
  rebuildAll();
  closeEditModal();
  toast('✓ Entry updated — dashboard & monthly totals refreshed');
  if(localStorage.getItem('bt_auto_save')==='1') pushToSupabase();
}
