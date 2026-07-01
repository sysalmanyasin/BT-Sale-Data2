// ══════════════════════════════════════════
// TARGETS
// ══════════════════════════════════════════
const TGT_K = 'bt_targets';
function getTgts() { try{return JSON.parse(Repository.getItem(TGT_K)||'{}')}catch{return{}} }

function saveTarget() {
  const mon=document.getElementById('tgt-sel').value;
  const amt=parseFloat(document.getElementById('tgt-amount').value);
  if(!mon){ toast('⚠ Select a month','w'); return; }
  if(!amt||isNaN(amt)){ toast('⚠ Enter a valid amount','w'); return; }
  const t=getTgts(); t[mon]=amt;
  Actions.saveTargets(JSON.stringify(t));
  renderTargetList(); buildDashboard(); renderIndex();
  toast('✓ Target saved for '+mon);
}

function delTarget(mon) {
  const t=getTgts(); delete t[mon];
  Actions.saveTargets(JSON.stringify(t));
  renderTargetList(); buildDashboard(); renderIndex();
}

function renderTargetList() {
  const t=getTgts(), el=document.getElementById('tgt-list');
  if(!el) return;
  const keys=Object.keys(t);
  if(!keys.length){ el.innerHTML='<span style="color:var(--muted)">No targets set yet.</span>'; return; }
  el.innerHTML=keys.sort((a,b)=>{ const ia=MONTHLY.findIndex(m=>m.Month_Year===a),ib=MONTHLY.findIndex(m=>m.Month_Year===b); return ib-ia; }).map(mon=>{
    const actual=n(MONTHLY.find(m=>m.Month_Year===mon)?.TOTAL||0);
    const p=t[mon]?Math.min(100,Math.round(actual/t[mon]*100)):0;
    const c=p>=100?'var(--green)':p>=75?'var(--amber)':'var(--red)';
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="min-width:110px;font-weight:500;font-size:12px">${mon}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">₨${fc(t[mon])}</span>
      <div style="flex:1;background:var(--border);border-radius:99px;height:5px;overflow:hidden"><div style="height:100%;width:${p}%;background:${c};border-radius:99px"></div></div>
      <span style="font-size:11px;font-weight:600;color:${c}">${p}%</span>
      <button class="btn btn-d" style="padding:2px 7px;font-size:10px" onclick="delTarget('${mon}')">✕</button>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
