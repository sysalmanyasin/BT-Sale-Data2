// ══════════════════════════════════════════
// INDEX
// ══════════════════════════════════════════
function renderIndex() {
  const q=(document.getElementById('idx-search')?.value||'').toLowerCase();
  const yr=document.getElementById('idx-year')?.value||'';
  const sort=document.getElementById('idx-sort')?.value||'date';
  let data=MONTHLY.filter(m=>(!q||m.Month_Year.toLowerCase().includes(q))&&(!yr||m.Month_Year.endsWith(yr)));
  if(sort==='total-d') data.sort((a,b)=>n(b.TOTAL)-n(a.TOTAL));
  else if(sort==='total-a') data.sort((a,b)=>n(a.TOTAL)-n(b.TOTAL));
  const maxT=Math.max(...MONTHLY.map(m=>n(m.TOTAL)));
  const tgts=getTgts();
  const container=document.getElementById('idx-container');

  if(sort==='date'){
    // Group by year
    const byYr={};
    data.forEach(m=>{ const y=m.Month_Year.split(' ').pop(); (byYr[y]=byYr[y]||[]).push(m); });
    // Sort years descending, months within each year descending (latest first)
    const MONTH_ORDER=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const sortedYrs=Object.keys(byYr).sort((a,b)=>b-a);
    container.innerHTML=sortedYrs.map((y,yi)=>{
      const mons=byYr[y].sort((a,b)=>{
        const ai=MONTH_ORDER.indexOf(a.Month_Year.split(' ')[0]);
        const bi=MONTH_ORDER.indexOf(b.Month_Year.split(' ')[0]);
        return bi-ai;
      });
      const yrTotal=mons.reduce((s,m)=>s+n(m.TOTAL),0);
      const yrCust=mons.reduce((s,m)=>s+n(m.Customers),0);
      const isLatest=yi===0; // latest year open by default
      return `<div class="yr-group">
        <div class="yr-hdr" onclick="toggleYrGroup(this)">
          <div class="yr-hdr-left">
            <span class="yr-chevron${isLatest?' open':''}">▶</span>
            <span class="yr-hdr-label">${y}</span>
            <span class="yr-hdr-meta">${mons.length} months</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="yr-hdr-total">₨ ${ff(yrTotal)}</span>
            <span class="yr-hdr-meta">👥 ${fc(yrCust)}</span>
            <button onclick="event.stopPropagation();printYearlyReport('${y}')" title="Print ${y} Report" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(37,99,235,.25);background:var(--alt);color:var(--accent);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">🖨</button>
          </div>
        </div>
        <div class="yr-body${isLatest?' open':''}">
          <div class="yr-grid">${mons.map(m=>iCard(m,maxT,tgts)).join('')}</div>
        </div>
      </div>`;
    }).join('');
  } else {
    container.innerHTML='<div class="igrid">'+data.map(m=>iCard(m,maxT,tgts)).join('')+'</div>';
  }
  // Store in render cache
  _rc.index = { key: _rcKey('index'), html: container.innerHTML };
}

function toggleYrGroup(hdr) {
  const body=hdr.nextElementSibling;
  const chev=hdr.querySelector('.yr-chevron');
  const isOpen=body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  if(chev) chev.classList.toggle('open',!isOpen);
}

function iCard(m,maxT,tgts) {
  const t=n(m.TOTAL), bw=maxT?Math.round(t/maxT*100):0;
  const[mn,yr]=m.Month_Year.split(' ');
  const tgt=tgts[m.Month_Year];
  const tp=tgt?Math.min(100,Math.round(t/tgt*100)):0;
  const tc=tp>=100?'#059669':tp>=75?'#d97706':'#dc2626';
  return `<div class="icard" onclick="openMonthModal('${m.Month_Year}')">
    <div class="icmon">${mn}</div><div class="icyr">${yr}</div>
    <div class="ictot">₨ ${ff(t)}</div>
    <div class="icmeta"><span>👥 ${fc(n(m.Customers))}</span><span>F/Issue ₨${fc(n(m['F/Issue']))}</span></div>
    <div class="icbar"><div class="icfill" style="width:${bw}%"></div></div>
    ${tgt?`<div class="ictgt">🎯 ${tp}% of ₨${ff(tgt)} target</div><div class="ictbar"><div class="ictfill" style="width:${tp}%;background:${tc}"></div></div>`:''}
  </div>`;
}

