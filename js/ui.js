function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.ntab,.bnav-item').forEach(t=>t.classList.remove('active'));
  const pg = document.getElementById('page-'+id);
  if(pg) pg.classList.add('on');
  document.querySelectorAll('.ntab[data-page="'+id+'"],.bnav-item[data-page="'+id+'"]').forEach(t=>t.classList.add('active'));
  _curPage = id;
  if(id==='tools') { loadToolsPage(); }
  if(id==='manager') { loadManagerPage(); }
  if(id==='report') { dsInit(); }
  if(id==='entry') { autoFillEntryDate(); }
  if(id==='index') {
    const k = _rcKey('index');
    if (_rc.index && _rc.index.key === k) {
      document.getElementById('idx-container').innerHTML = _rc.index.html;
    } else {
      renderIndex();
    }
  }
  if(id==='data') {
    const k = _rcKey('data');
    if (_rc.data && _rc.data.key === k) {
      const old = document.getElementById('tbl-daily');
      if (old) { const d = document.createElement('div'); d.id='tbl-daily'; d.innerHTML = _rc.data.html; old.replaceWith(d); }
    } else {
      renderDataTable();
    }
  }
}

document.querySelectorAll('.ntab,.bnav-item').forEach(t=>t.addEventListener('click',()=>showPage(t.dataset.page)));

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
let _tTimer;
function toast(msg, type='') {
  clearTimeout(_tTimer);
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='on'+(type?' '+type:'');
  _tTimer=setTimeout(()=>el.className='',2800);
}

// ══════════════════════════════════════════
// CLOCK
// ══════════════════════════════════════════
function tickClock() {
  const el=document.getElementById('clock');
  if(el) el.textContent=new Date().toLocaleString('en-PK',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
setInterval(tickClock,30000); tickClock();

// ══════════════════════════════════════════
// GITHUB SYNC
// ══════════════════════════════════════════
// (GH_T/GH_R/GH_P/GH_S/_autoHandle are declared in github.js — removed duplicate here)

function rebuildDropdowns() {
  const yrs=years();
  ['dash-year','idx-year'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel) return;
    const val=sel.value;
    sel.innerHTML='<option value="">All Years</option>'+yrs.map(y=>`<option value="${y}">${y}</option>`).join('');
    sel.value=val;
  });
  const mons=[...months()].reverse();
  const dm=document.getElementById('data-month');
  if(dm){ const v=dm.value; dm.innerHTML='<option value="">All Months</option>'+mons.map(m=>`<option value="${m}">${m}</option>`).join(''); dm.value=v; }
  const em=document.getElementById('e-month');
  if(em){ const v=em.value; em.innerHTML='<option value="">Select…</option>'+mons.map(m=>`<option value="${m}">${m}</option>`).join(''); em.value=v; }
}

// ══════════════════════════════════════════
// REBUILD ALL
// ══════════════════════════════════════════
function rebuildAll() {
  normalizeDates();
  invalidateRenderCache();
  rebuildDropdowns();
  buildDashboard();
  if(_curPage==='index') renderIndex();
  if(_curPage==='data') renderDataTable();
  buildDateList();
}


// ══════════════════════════════════════════
// TOOLS PAGE
// ══════════════════════════════════════════
function loadToolsPage() {
  _populatePrintSelectors();
  _tcLoadGAuthStatus();
  // GitHub
  const cfg=ghCfg();
  updateGhBadge();
  const gt=document.getElementById('gh-token'); if(gt) gt.placeholder=cfg?'Token saved ✓ (paste new to update)':'ghp_xxxxxxxxxxxxxxxxxxxx';
  const gr=document.getElementById('gh-repo'); if(gr) gr.value=localStorage.getItem(GH_R)||'sysalmanyasin/BT-Sale-Data';
  const gp=document.getElementById('gh-path'); if(gp) gp.value=localStorage.getItem(GH_P)||'data/sales.json';
  // Auto-sync checkboxes
  const al=document.getElementById('auto-load'); if(al) al.checked=localStorage.getItem('bt_auto_load')==='1';
  const as=document.getElementById('auto-save'); if(as) as.checked=localStorage.getItem('bt_auto_save')==='1';
  const ai=document.getElementById('auto-interval'); if(ai) ai.checked=localStorage.getItem('bt_auto_interval')==='1';
  // Targets
  populateTgtSel(); renderTargetList();
  // Summary
  const ds=document.getElementById('data-summary');
  if(ds) ds.innerHTML=`
    <div><strong>Total months:</strong> ${MONTHLY.length}</div>
    <div><strong>Daily records:</strong> ${DAILY.filter(d=>n(d.TOTAL)>0).length}</div>
    <div><strong>Years covered:</strong> ${years().join(', ')}</div>
    <div><strong>Cumulative total:</strong> ₨${fc(MONTHLY.reduce((s,m)=>s+n(m.TOTAL),0))}</div>
    <div><strong>Session entries:</strong> ${newEntries.length}</div>
    <div><strong>GitHub repo:</strong> ${localStorage.getItem(GH_R)||'Not configured'}</div>
    <div><strong>Last SHA:</strong> ${(localStorage.getItem(GH_S)||'—').slice(0,14)}…</div>`;
}

function populateTgtSel() {
  const sel=document.getElementById('tgt-sel'); if(!sel) return;
  sel.innerHTML='<option value="">Select month…</option>'+[...MONTHLY].reverse().map(m=>`<option value="${m.Month_Year}">${m.Month_Year}</option>`).join('');
}

function tcPwStrength(inp) {
  const score = _pwStrengthScore(inp.value);
  const wrap  = document.getElementById('tc-pw-strength-wrap');
  const bar   = document.getElementById('tc-pw-bar');
  const label = document.getElementById('tc-pw-label');
  if(!wrap) return;
  wrap.style.display = inp.value ? '' : 'none';
  if(bar){ bar.style.width=(score/5*100)+'%'; bar.style.background=_PW_LEVELS[score].color; }
  if(label){ label.textContent=_PW_LEVELS[score].label||''; label.style.color=_PW_LEVELS[score].color; }
}

function changePIN() {
  const cur=document.getElementById('pin-cur').value;
  const nw=document.getElementById('pin-new').value;
  const cf=document.getElementById('pin-confirm').value;
  if(nw.length<8||nw.length>20){ toast('⚠ Password must be 8–20 characters','w'); return; }
  if(nw!==cf){ toast('⚠ Passwords do not match','w'); return; }
  const stored=localStorage.getItem(PIN_K);
  if(stored&&hashPIN(cur)!==stored){ toast('⚠ Current password is incorrect','w'); return; }
  localStorage.setItem(PIN_K,hashPIN(nw));
  ['pin-cur','pin-new','pin-confirm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  toast('✓ Password updated');
}

function addNewMonth() {
  const mon=document.getElementById('nm-sel').value;
  const yr=document.getElementById('nm-year').value;
  const key=mon+' '+yr;
  if(MONTHLY.find(m=>m.Month_Year===key)){ toast('⚠ '+key+' already exists','w'); return; }
  const blank={Month_Year:key,TOTAL:0,Customers:0};
  MONTHLY.push(blank);
  const stored=JSON.parse(localStorage.getItem('bt_new_months')||'[]');
  stored.push(blank); localStorage.setItem('bt_new_months',JSON.stringify(stored));
  rebuildAll(); toast('✓ '+key+' created');
}

// ══════════════════════════════════════════
// EXPORT / IMPORT
// ══════════════════════════════════════════
function exportCSV(type) {
  const data=type==='monthly'?MONTHLY:DAILY; if(!data.length) return;
  const keys=Object.keys(data[0]);
  const csv=[keys.join(','),...data.map(r=>keys.map(k=>{ const v=r[k]; if(v==null)return ''; if(typeof v==='string'&&(v.includes(',')||v.includes('"')))return '"'+v.replace(/"/g,'""')+'"'; return v; }).join(','))].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download='BT_'+type+'_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); toast('✓ CSV downloaded');
}

function exportJSON() {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify({monthly:MONTHLY,daily:DAILY,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}));
  a.download='BT_backup_'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); toast('✓ JSON exported');
}

function importJSON(e) {
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=ev=>{ try{
    const data=JSON.parse(ev.target.result);
    if(data.monthly) data.monthly.forEach(m=>{ if(!MONTHLY.find(x=>x.Month_Year===m.Month_Year)) MONTHLY.push(m); });
    if(data.daily)   data.daily.forEach(d=>{ if(!DAILY.find(x=>x.Date===d.Date&&x.Month_Year===d.Month_Year)) DAILY.push(d); });
    rebuildAll(); toast('✓ Imported');
  }catch(err){toast('✕ Invalid file','e');}};
  r.readAsText(file); e.target.value='';
}

// ══════════════════════════════════════════
// DROPDOWNS  (called on rebuild)
// ══════════════════════════════════════════
