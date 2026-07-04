// ══════════════════════════════════════════
// DAILY TABLE
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// FLOOR 4 — COMPONENT: Daily Row
// Pure function: given a record, returns an HTML string. No DOM access,
// no global state mutation, no business logic beyond formatting. This
// replaces two near-identical copies of this same row markup that
// previously lived inline in renderDataTable()'s two branches (single
// month view vs. grouped-by-month view) — any field change had to be
// made in both places by hand, and they could silently drift apart.
// ══════════════════════════════════════════
function DailyRowComponent(d, extraCol) {
  const ev = extraCol ? '<td>' + (n(d[extraCol]) ? '&#8360;' + fc(n(d[extraCol])) : '&#8212;') + '</td>' : '';
  return `<td>${d.Date||''}</td>${ev}<td>${n(d.TOTAL)?'&#8360;'+fc(n(d.TOTAL)):'&#8212;'}</td><td>${n(d.Customers)?fc(n(d.Customers)):'&#8212;'}</td><td class="no-print" style="display:flex;gap:4px"><button onclick="event.stopPropagation();printDayDirectly('${d.Date}','${d.Month_Year}')" title="Print ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(37,99,235,.25);background:var(--alt);color:var(--accent);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">🖨</button><button onclick="event.stopPropagation();openEditModal('${d.Date}','${d.Month_Year}')" title="Edit ${d.Date}" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(217,119,6,.3);background:var(--alt);color:#d97706;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">✏️</button></td>`;
}

// ══════════════════════════════════════════
// FLOOR 5 — PAGE: Daily Table
// Reads state (via Repository) → builds rows using the Component above →
// renders. Click handlers call existing page-level functions, which is
// the established pattern app-wide (openDayModal/openEditModal etc. are
// themselves thin wrappers, not raw state mutation).
// ══════════════════════════════════════════
function renderDataTable() {
  const q=(document.getElementById('data-search')?.value||'').toLowerCase();
  const mon=document.getElementById('data-month')?.value||'';
  const col=document.getElementById('data-col')?.value||'TOTAL';
  const extraCol=col!=='TOTAL'?col:null;
  const titleEl=document.getElementById('data-htitle');
  const subEl=document.getElementById('data-hsub');

  // Remember which months are currently expanded so a rebuild (which can
  // be triggered at any time by a background sync event — daily:added,
  // daily:pulled, daily:gapfilled, etc. — not just user navigation)
  // doesn't silently collapse whatever the user had open.
  const openMonths = new Set();
  document.querySelectorAll('#tbl-daily .mon-group').forEach(g => {
    const label = g.querySelector('.mon-hdr-label');
    const body = g.querySelector('.mon-body');
    if (label && body && body.classList.contains('open')) openMonths.add(label.textContent);
  });

  const filtered=Repository.getDaily().filter(d=>
    (!mon||d.Month_Year===mon)&&
    (!q||(d.Date||'').toLowerCase().includes(q)||(d.Month_Year||'').toLowerCase().includes(q))
  ).filter(d=>n(d.TOTAL)!==0||d['Low Sale Reason']);

  if(mon){
    // Single month selected — flat table
    const rows=filtered.slice().sort((a,b)=>_dateVal(b.Date)-_dateVal(a.Date));
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
      tr.innerHTML=DailyRowComponent(d, extraCol);
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
    // Keep whatever was open before this rebuild; only fall back to
    // "latest month open by default" on the very first render (when
    // nothing was open yet, i.e. openMonths is empty).
    const shouldBeOpen = openMonths.size ? openMonths.has(monKey) : mi===0;

    const grp=document.createElement('div');
    grp.className='mon-group';

    const hdr=document.createElement('div');
    hdr.className='mon-hdr';
    hdr.innerHTML=`<div class="mon-hdr-left"><span class="mon-chevron${shouldBeOpen?' open':''}">&#9654;</span><span class="mon-hdr-label">${monKey}</span><span class="mon-hdr-meta">${rows.length} days</span></div><div style="display:flex;align-items:center;gap:12px"><span class="mon-hdr-total">&#8360; ${ff(monTotal)}</span><span class="mon-hdr-meta">&#128101; ${fc(monCust)}</span></div>`;
    hdr.onclick=()=>toggleMonGroup(hdr);

    const body=document.createElement('div');
    body.className='mon-body'+(shouldBeOpen?' open':'');

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
      tr.innerHTML=DailyRowComponent(d, extraCol);
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
    let val=el.type==='text'?(el.value||null):(el.value?parseFloat(el.value):null);
    // Returns fields must always reduce the total — normalize to negative
    // regardless of which sign was typed, so a forgotten "-" can never
    // silently turn a deduction into an addition (see RETURN_FIELDS).
    if(val!=null && RETURN_FIELDS.has(col)) val=negR(val);
    entry[col]=val;
  }
  entry['TOTAL']=String(n(document.getElementById('e-TOTAL').value));
  // DIFF = Total Sale − COMP SALE, stored on daily entry for export consistency
  const _eDiff=Math.round(n(entry['TOTAL'])-n(entry['COMP SALE']));
  entry['Sale Plus']=null; entry['DIFF']=_eDiff!==0?String(_eDiff):null;
  // Custom fields (Field Manager → Custom tab) — store their raw value under
  // their own id so they survive reload/edit. Previously these only affected
  // the live TOTAL while filling the form and were never actually saved.
  if (typeof _fmCustom !== 'undefined') {
    _fmCustom.forEach(f => {
      const el = document.getElementById('e-' + f.id);
      if (!el) return;
      entry[f.id] = el.value !== '' ? parseFloat(el.value) : null;
    });
  }
  // Overwrite any existing entry for the same date — Repository.upsertDaily
  // handles the find-or-push logic in one place now, instead of this file
  // doing its own DAILY.findIndex/splice/push (same pattern that used to be
  // duplicated across storage.js, supabase.js, manager.js, drive.js, ui.js).
  Actions.addDailyEntry(entry);
  Actions.recordPendingEntry(entry);
  // Auto-compute MONTHLY totals from DAILY so dashboard/index/reports all reflect this entry
  Actions.recomputeMonth(month);
  renderEntryList();
  rebuildAll();
  toast('✓ Entry saved — dashboard & monthly totals updated');
  if(Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function renderEntryList() {
  const el=document.getElementById('entry-list');
  const entries=Repository.getPendingEntries();
  if(!entries.length){ el.textContent='No entries this session.'; return; }
  el.innerHTML=entries.map((e,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span class="badge bg-blue">${e.Date}</span>
      <span style="font-size:12px">${e.Month_Year}</span>
      <span style="font-family:var(--mono);font-size:12px">₨${fc(n(e.TOTAL))}</span>
      <span style="color:var(--muted);font-size:12px">👥${fc(n(e.Customers))}</span>
      <button class="btn btn-d" style="padding:2px 8px;font-size:10px;margin-left:auto" onclick="delEntry(${i})">✕</button>
    </div>`).join('');
}

function delEntry(i){
  const entries=Repository.getPendingEntries();
  const e=entries[i];
  if(!e) return;
  Actions.removeDailyEntry(e.Date, e.Month_Year);
  Actions.recomputeMonth(e.Month_Year);
  Actions.forgetPendingEntry(e.Date, e.Month_Year);
  renderEntryList();
  rebuildAll();
  if(Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}
function clearEntryForm(){ document.querySelectorAll('#page-entry input,#page-entry select').forEach(el=>{ if(el.type!=='submit') el.value=''; }); autoFillEntryDate(); }
function autoFillEntryDate() {
  // Find the latest date that does NOT yet have an entry in DAILY
  // Collect all recorded dates from DAILY (base + new entries)
  const recorded=new Set(Repository.getDaily().map(d=>d.Date));
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
  const rec = Repository.getDailyEntry(date, my);
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

  // Custom fields (Field Manager → Custom tab) — without this the Edit modal
  // had no way to show or change a custom field's value, and resaving from
  // here would silently drop its contribution to TOTAL.
  if (typeof _fmCustom !== 'undefined' && _fmCustom.length) {
    html+=`<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 6px">Custom Fields</div>`;
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
    _fmCustom.forEach(f=>{
      const val = rec[f.id];
      const raw = (val==null||val==='')?'':(Number(val)||0);
      const hint = f.calcType==='add'?' (+ adds)':f.calcType==='sub'?' (− subtracts)':'';
      html+=`<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:3px">${f.label}${hint}</label>
        <input type="number" inputmode="decimal" id="em-${f.id.replace(/[^a-z0-9]/gi,'_')}" value="${raw}"
          oninput="editCalcTotal()"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--s2);color:var(--text);box-sizing:border-box"></div>`;
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
  // Live UI preview only — reads raw form inputs, writes nothing to
  // state. Uses the same DAILY_ADD_KEYS/DAILY_SUB_KEYS as the actual
  // save path (config.js) so the preview can never drift from what
  // gets persisted.
  let t=0;
  DAILY_ADD_KEYS.forEach(k=>{ const el=document.getElementById('em-'+k.replace(/[^a-z0-9]/gi,'_')); if(el) t+=Math.abs(parseFloat(el.value)||0); });
  DAILY_SUB_KEYS.forEach(k=>{ const el=document.getElementById('em-'+k.replace(/[^a-z0-9]/gi,'_')); if(el) t-=Math.abs(parseFloat(el.value)||0); });
  if (typeof _fmCustom !== 'undefined') {
    _fmCustom.forEach(f=>{
      if (f.calcType==='none') return;
      const el=document.getElementById('em-'+f.id.replace(/[^a-z0-9]/gi,'_')); if(!el) return;
      const v=Math.abs(parseFloat(el.value)||0);
      if (f.calcType==='add') t+=v; else if (f.calcType==='sub') t-=v;
    });
  }
  const prev=document.getElementById('em-total-preview');
  if(prev) prev.textContent='₨'+Math.round(t).toLocaleString('en-PK');
}

function closeEditModal() {
  document.getElementById('edit-modal-bg').style.display='none';
  _editDate=null; _editMy=null;
}

async function saveEditModal() {
  if(!_editDate||!_editMy){ toast('⚠ Nothing to save','w'); return; }

  // Pages only collect raw field values here — they never touch the
  // live DAILY record or compute TOTAL/DIFF. That belongs to Actions
  // (Actions.editDailyEntry → config.js computeDailyTotals), the one
  // door for data changes, per the blueprint.
  const changes = {};
  const SUB_KEYS_SET = new Set(DAILY_SUB_KEYS);

  EDIT_FIELDS.forEach(f=>{
    const el=document.getElementById('em-'+f.key.replace(/[^a-z0-9]/gi,'_'));
    if(!el) return;
    if(f.text){ changes[f.key]=el.value||null; }
    else {
      const v=parseFloat(el.value)||0;
      // Returns must always reduce the total, so they're always stored as
      // negative — regardless of which sign was typed. (Previously this
      // forced Math.abs(), i.e. always positive, which is what caused
      // edited returns to silently flip sign and get added instead of
      // subtracted from the monthly total.)
      changes[f.key]=v===0?null:(SUB_KEYS_SET.has(f.key)?negR(v):v);
    }
  });

  // Custom fields (Field Manager → Custom tab) — persist their value too,
  // so it survives this edit instead of being dropped from TOTAL silently.
  if (typeof _fmCustom !== 'undefined') {
    _fmCustom.forEach(f=>{
      const el=document.getElementById('em-'+f.id.replace(/[^a-z0-9]/gi,'_'));
      if(!el) return;
      changes[f.id]=el.value!==''?(parseFloat(el.value)||0):null;
    });
  }

  let rec;
  try {
    rec = Actions.editDailyEntry(_editDate, _editMy, changes); // merges changes + recomputes TOTAL/DIFF + persists + notifies
  } catch(e) {
    toast('⚠ Record not found','e'); return;
  }

  // Sync to the pending-entries session log (for push) — overwrite or add
  Actions.recordPendingEntry(rec);

  Actions.recomputeMonth(_editMy);
  renderEntryList();
  rebuildAll();
  closeEditModal();
  toast('✓ Entry updated — dashboard & monthly totals refreshed');
  if(Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}
