// ══════════════════════════════════════════
(function() {
'use strict';
// INDEX  —  Floor 5 pure renderer
//
// All filtering/sorting/grouping/aggregation now lives in
// Analytics.buildIndexViewModel() (Floor 3). This function only maps
// the resulting view-model to HTML (closes the last CF-03-style gap).
// ══════════════════════════════════════════
function renderIndex() {
  const q=(document.getElementById('idx-search')?.value||'');
  const yr=document.getElementById('idx-year')?.value||'';
  const sort=document.getElementById('idx-sort')?.value||'date';
  const container=document.getElementById('idx-container');

  const vm = Analytics.buildIndexViewModel(q, yr, sort);

  if (vm.mode === 'grouped') {
    container.innerHTML = vm.groups.map(g => `<div class="yr-group">
        <div class="yr-hdr" onclick="toggleYrGroup(this)">
          <div class="yr-hdr-left">
            <span class="yr-chevron${g.isLatest?' open':''}">▶</span>
            <span class="yr-hdr-label">${g.year}</span>
            <span class="yr-hdr-meta">${g.months.length} months</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="yr-hdr-total">₨ ${ff(g.yrTotal)}</span>
            <span class="yr-hdr-meta">👥 ${fc(g.yrCust)}</span>
            <button onclick="event.stopPropagation();printYearlyReport('${g.year}')" title="Print ${g.year} Report" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(37,99,235,.25);background:var(--alt);color:var(--accent);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">🖨</button>
          </div>
        </div>
        <div class="yr-body${g.isLatest?' open':''}">
          <div class="yr-grid">${g.months.map(m=>iCard(m,vm.maxT,vm.tgts)).join('')}</div>
        </div>
      </div>`).join('');
  } else {
    container.innerHTML='<div class="igrid">'+vm.months.map(m=>iCard(m,vm.maxT,vm.tgts)).join('')+'</div>';
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


// renderIndex is consumed externally (ai-bridge.js, ui.js, targets.js,
// manager.js, index.html). toggleYrGroup is called via a generated
// onclick="toggleYrGroup(this)" attribute in the HTML this file builds —
// onclick handlers always resolve against the global scope, so this MUST
// stay on window even though no other .js file references it directly.
// iCard is only ever called from within this file's own JS, so it's the
// one genuinely private helper here.
window.renderIndex = renderIndex;
window.toggleYrGroup = toggleYrGroup;

})();
