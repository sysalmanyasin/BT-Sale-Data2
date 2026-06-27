// ══════════════════════════════════════════════════════════════════
// JAZZ CASH MODULE — Ledger + Balance Tally
// ══════════════════════════════════════════════════════════════════

// ─── LEDGER constants ────────────────────────────────────────────
const JC_KEY     = 'bt_jazzcash_v2';
const JC_SHIFTS  = ['Morning', 'Evening', 'Night', 'Both', 'Off'];
const JC_TYPES   = [
  { id:'credit',     label:'Received (+)',   sign:+1, color:'var(--green)',  icon:'⬆' },
  { id:'debit',      label:'Paid Out (−)',   sign:-1, color:'var(--red)',    icon:'⬇' },
  { id:'withdrawal', label:'Withdrawal (−)', sign:-1, color:'var(--amber)',  icon:'💸' },
  { id:'commission', label:'Commission (+)', sign:+1, color:'var(--purple)', icon:'🏅' },
  { id:'transfer',   label:'Transfer (−)',   sign:-1, color:'var(--muted)',  icon:'↔'  },
];

// ─── TALLY constants ─────────────────────────────────────────────
const JC_TALLY_KEY = 'bt_jc_tally_v1';
// Default account set (user can add/remove/rename)
const JC_TALLY_DEFAULTS = [
  { id:'jc_balance',  name:'Jazz Cash Balance (Ledger)', amount:0, locked:true  },
  { id:'jc_app',      name:'My Jazz Cash App',           amount:0 },
  { id:'abl',         name:'ABL',                        amount:0 },
  { id:'alflah',      name:'Bank Alflah',                amount:0 },
  { id:'easypaisa',   name:'Easypaisa',                  amount:0 },
  { id:'pharmacy',    name:'Pharmacy (Cash)',             amount:0 },
  { id:'cash_hand',   name:'Cash in Hand',               amount:0 },
];

// ─── State ───────────────────────────────────────────────────────
let _jcData       = null;
let _jcFilterMonth= '';
let _jcAiLoading  = false;
let _jcActiveTab  = 'ledger';  // 'ledger' | 'tally'
let _jcTallyData  = null;
let _jcTallyDate  = '';

// ══════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════
function _jcType(id) { return JC_TYPES.find(t => t.id === id) || JC_TYPES[0]; }
function _jcFmt(v)   { return Math.abs(Math.round(Number(v)||0)).toLocaleString('en-PK'); }
function _jcMonthOf(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[d.getMonth()] + ' ' + d.getFullYear();
}
function _jcTodayStr() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _jcFmtDate(ds) {
  const d = new Date(ds+'T00:00:00');
  if (isNaN(d)) return ds;
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+d.getDate()+' '+
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]+' '+d.getFullYear();
}

// ══════════════════════════════════════════════════════════════════
// LEDGER — Persistence
// ══════════════════════════════════════════════════════════════════
function jcLoad() {
  try { const r=localStorage.getItem(JC_KEY); if(r) return JSON.parse(r); } catch(e){}
  return { openingBalance:0, entries:[] };
}
function jcSave() {
  localStorage.setItem(JC_KEY, JSON.stringify(_jcData));
  if (localStorage.getItem('bt_auto_save')==='1' && typeof pushToSupabase==='function') pushToSupabase();
}
function _jcRunningBalances(entries, openingBalance) {
  let bal = openingBalance||0;
  return entries.map(e => { const t=_jcType(e.type); bal+=t.sign*(parseFloat(e.amount)||0); return {...e,_balance:bal}; });
}
function _jcFilteredEntries() {
  const entries=(_jcData.entries||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  return _jcFilterMonth ? entries.filter(e=>_jcMonthOf(e.date)===_jcFilterMonth) : entries;
}
function _jcCurrentBalance() {
  _jcData = jcLoad();
  const sorted=(_jcData.entries||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const wb=_jcRunningBalances(sorted,_jcData.openingBalance||0);
  return wb.length ? wb[wb.length-1]._balance : (_jcData.openingBalance||0);
}

// ══════════════════════════════════════════════════════════════════
// TALLY — Persistence
// ══════════════════════════════════════════════════════════════════
function _tallyLoad() {
  try { const r=localStorage.getItem(JC_TALLY_KEY); if(r) return JSON.parse(r); } catch(e){}
  return { accounts: JSON.parse(JSON.stringify(JC_TALLY_DEFAULTS)), snapshots:[] };
}
function _tallySave(data) {
  localStorage.setItem(JC_TALLY_KEY, JSON.stringify(data));
  if (localStorage.getItem('bt_auto_save')==='1' && typeof pushToSupabase==='function') pushToSupabase();
}

// ══════════════════════════════════════════════════════════════════
// MAIN RENDER — shell with sub-tabs
// ══════════════════════════════════════════════════════════════════
function renderJazzCash() {
  const cont = document.getElementById('jc-container');
  if (!cont) return;

  cont.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:16px;border:1.5px solid var(--border);border-radius:10px;overflow:hidden;background:var(--s2)">
      <button id="jc-tab-ledger" onclick="jcSwitchTab('ledger')"
        style="flex:1;padding:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;background:${_jcActiveTab==='ledger'?'var(--accent)':'transparent'};color:${_jcActiveTab==='ledger'?'#fff':'var(--muted)'}">
        📒 Daily Ledger
      </button>
      <button id="jc-tab-tally" onclick="jcSwitchTab('tally')"
        style="flex:1;padding:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all .15s;background:${_jcActiveTab==='tally'?'#16a34a':'transparent'};color:${_jcActiveTab==='tally'?'#fff':'var(--muted)'}">
        ⚖ Balance Tally
      </button>
    </div>
    <div id="jc-panel-ledger" style="display:${_jcActiveTab==='ledger'?'':'none'}"></div>
    <div id="jc-panel-tally"  style="display:${_jcActiveTab==='tally' ?'':'none'}"></div>
  `;

  _renderLedger();
  _renderTally();
}

function jcSwitchTab(tab) {
  _jcActiveTab = tab;
  document.getElementById('jc-tab-ledger').style.background = tab==='ledger'?'var(--accent)':'transparent';
  document.getElementById('jc-tab-ledger').style.color      = tab==='ledger'?'#fff':'var(--muted)';
  document.getElementById('jc-tab-tally').style.background  = tab==='tally'?'#16a34a':'transparent';
  document.getElementById('jc-tab-tally').style.color       = tab==='tally'?'#fff':'var(--muted)';
  document.getElementById('jc-panel-ledger').style.display  = tab==='ledger'?'':'none';
  document.getElementById('jc-panel-tally').style.display   = tab==='tally' ?'':'none';
}

// ══════════════════════════════════════════════════════════════════
// LEDGER PANEL
// ══════════════════════════════════════════════════════════════════
function _renderLedger() {
  const panel = document.getElementById('jc-panel-ledger');
  if (!panel) return;
  _jcData = jcLoad();

  const allSorted=(_jcData.entries||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const allWithBal=_jcRunningBalances(allSorted,_jcData.openingBalance||0);
  const currentBal=allWithBal.length?allWithBal[allWithBal.length-1]._balance:(_jcData.openingBalance||0);
  const today=_jcTodayStr();
  const todayNet=allSorted.filter(e=>e.date===today).reduce((s,e)=>s+_jcType(e.type).sign*(parseFloat(e.amount)||0),0);

  const filtered=_jcFilteredEntries();
  const displayEntries=_jcFilterMonth
    ? _jcRunningBalances(filtered,_jcData.openingBalance||0)
    : allWithBal;
  const monthCredits=filtered.filter(e=>_jcType(e.type).sign>0).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const monthDebits =filtered.filter(e=>_jcType(e.type).sign<0).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);

  const allMonths=[...new Set(allSorted.map(e=>_jcMonthOf(e.date)).filter(Boolean))];
  const monthOptHtml=['', ...allMonths.reverse()].map(m=>
    `<option value="${m}"${m===_jcFilterMonth?' selected':''}>${m||'All Time'}</option>`).join('');

  panel.innerHTML = `
    <!-- Balance Card -->
    <div style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);border-radius:16px;padding:20px 20px 16px;margin-bottom:16px;color:#fff;position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;top:-20px;width:100px;height:100px;background:rgba(255,255,255,.08);border-radius:50%"></div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8;margin-bottom:4px">💚 Jazz Cash — Ledger Balance</div>
      <div style="font-size:36px;font-weight:800;font-family:var(--mono);letter-spacing:-1px">${currentBal<0?'−':''}₨${_jcFmt(currentBal)}</div>
      <div style="display:flex;gap:20px;margin-top:12px;font-size:12px;opacity:.9">
        <div><span style="opacity:.7">Today</span><br><span style="font-weight:700;font-family:var(--mono)">${todayNet>=0?'+':'−'}₨${_jcFmt(todayNet)}</span></div>
        <div><span style="opacity:.7">Opening</span><br><span style="font-weight:700;font-family:var(--mono)">₨${_jcFmt(_jcData.openingBalance||0)}</span></div>
        <div style="margin-left:auto;text-align:right">
          <button onclick="jcSetOpening()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:5px 11px;border-radius:7px;font-size:11px;cursor:pointer;font-weight:600">⚙ Set Opening</button>
        </div>
      </div>
    </div>

    <!-- KPI Strip -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      <div class="kpi" style="text-align:center"><div class="klbl">In (+)</div><div class="kval" style="color:var(--green);font-size:15px">₨${_jcFmt(monthCredits)}</div></div>
      <div class="kpi" style="text-align:center"><div class="klbl">Out (−)</div><div class="kval" style="color:var(--red);font-size:15px">₨${_jcFmt(monthDebits)}</div></div>
      <div class="kpi" style="text-align:center"><div class="klbl">Net</div><div class="kval" style="color:${(monthCredits-monthDebits)>=0?'var(--green)':'var(--red)'};font-size:15px">${(monthCredits-monthDebits)>=0?'+':'−'}₨${_jcFmt(Math.abs(monthCredits-monthDebits))}</div></div>
    </div>

    <!-- AI Command Bar -->
    <div style="background:linear-gradient(135deg,#eff6ff,#f0fdf4);border:1.5px solid #bfdbfe;border-radius:12px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px">
        🤖 AI Command <span style="font-weight:400;color:var(--muted)">— type naturally</span>
        <span id="jc-ai-spinner" style="display:none;margin-left:4px">⏳</span>
      </div>
      <div style="display:flex;gap:8px">
        <input id="jc-ai-inp" type="text" placeholder='e.g. "Add 3500 morning shift today" or "Paid 1200 evening 24 June"'
          style="flex:1;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;color:var(--text);outline:none;font-family:var(--sans)"
          onkeydown="if(event.key==='Enter')jcAiCommand()">
        <button onclick="jcAiCommand()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer">Ask AI</button>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${['Add 5000 morning today','Paid 2000 HO evening','Commission 500 morning','Withdrawal 10000 today'].map(c=>
          `<button onclick="document.getElementById('jc-ai-inp').value='${c}'" style="background:#fff;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--t2)">${c}</button>`
        ).join('')}
      </div>
      <div id="jc-ai-result" style="display:none;margin-top:10px;padding:10px 12px;background:#fff;border-radius:8px;border:1px solid var(--border);font-size:12px;line-height:1.6"></div>
    </div>

    <!-- Quick Add Form -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden">
      <div style="background:var(--s2);padding:11px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between">
        ➕ Add Entry
        <button onclick="jcToggleForm()" id="jc-form-toggle" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--muted)">▲</button>
      </div>
      <div id="jc-quick-form" style="padding:14px 16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">DATE</label>
            <input type="date" id="jc-f-date" value="${today}"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--s2);color:var(--text);outline:none">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">SHIFT</label>
            <select id="jc-f-shift" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--s2);color:var(--text);outline:none">
              ${JC_SHIFTS.map(s=>`<option>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">TYPE</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${JC_TYPES.map((t,i)=>`
              <label style="display:flex;align-items:center;gap:5px;padding:7px 11px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:all .15s" id="jc-type-lbl-${t.id}">
                <input type="radio" name="jc-type" value="${t.id}" ${i===0?'checked':''} onchange="jcTypeChange()" style="display:none">
                ${t.icon} ${t.label}
              </label>`).join('')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">AMOUNT (₨)</label>
            <input type="number" id="jc-f-amount" placeholder="0"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:14px;font-weight:700;font-family:var(--mono);background:var(--s2);color:var(--text);outline:none;text-align:right">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">DESCRIPTION</label>
            <input type="text" id="jc-f-desc" placeholder="Optional note"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:var(--s2);color:var(--text);outline:none">
          </div>
        </div>
        <button onclick="jcAddEntry()" style="width:100%;background:var(--green);color:#fff;border:none;border-radius:9px;padding:11px;font-size:14px;font-weight:700;cursor:pointer">
          ✅ Add to Ledger
        </button>
      </div>
    </div>

    <!-- Ledger Table -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="background:var(--s2);padding:11px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:700;font-size:13px;flex:1">📒 Ledger</div>
        <select id="jc-month-filter" onchange="_jcFilterMonth=this.value;_renderLedger()"
          style="padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:#fff;color:var(--text);outline:none">
          ${monthOptHtml}
        </select>
        <button onclick="jcClearAll()" style="background:none;border:1px solid var(--border);border-radius:7px;padding:5px 10px;font-size:11px;cursor:pointer;color:var(--muted)">🗑 Clear</button>
      </div>
      <div style="overflow-x:auto">
        ${_jcBuildLedgerTable(displayEntries.filter(e=>!_jcFilterMonth||_jcMonthOf(e.date)===_jcFilterMonth))}
      </div>
    </div>`;

  jcTypeChange();
}

function _jcBuildLedgerTable(entries) {
  if (!entries.length) return `<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">No entries yet. Use the form or AI above.</div>`;
  const rows=[...entries].reverse().map((e,i)=>{
    const t=_jcType(e.type);
    const signed=t.sign>0?`+₨${_jcFmt(e.amount)}`:`−₨${_jcFmt(e.amount)}`;
    const isToday=e.date===_jcTodayStr();
    return `<tr style="border-bottom:1px solid var(--border);${isToday?'background:#f0fdf4':i%2?'background:var(--s2)':''}">
      <td style="padding:10px 8px 10px 14px;white-space:nowrap;font-size:11px;color:var(--muted)">
        ${isToday?'<span style="background:#dcfce7;color:#166534;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;display:block;margin-bottom:2px">TODAY</span>':''}
        ${_jcFmtDate(e.date)}
      </td>
      <td style="padding:10px 6px;white-space:nowrap">
        <span style="background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600">${e.shift||'—'}</span>
      </td>
      <td style="padding:10px 6px;font-size:12px;color:var(--t2);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.icon} ${e.desc||t.label}</td>
      <td style="padding:10px 6px;font-family:var(--mono);font-weight:700;font-size:13px;text-align:right;color:${t.color};white-space:nowrap">${signed}</td>
      <td style="padding:10px 6px;font-family:var(--mono);font-weight:700;font-size:13px;text-align:right;white-space:nowrap">${e._balance<0?'−':''}₨${_jcFmt(e._balance)}</td>
      <td style="padding:10px 12px 10px 4px;text-align:right;white-space:nowrap">
        <button onclick="jcEditEntry('${e.id}')" style="background:var(--alt);border:none;border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--accent);font-weight:600;margin-right:3px">✏</button>
        <button onclick="jcDeleteEntry('${e.id}')" style="background:var(--rlt);border:none;border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--red);font-weight:600">✕</button>
      </td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;min-width:480px">
    <thead><tr style="background:var(--s2);font-size:10px;text-transform:uppercase;font-weight:700;color:var(--muted);letter-spacing:.05em">
      <th style="padding:8px 8px 8px 14px;text-align:left;border-bottom:2px solid var(--border)">Date</th>
      <th style="padding:8px 6px;text-align:left;border-bottom:2px solid var(--border)">Shift</th>
      <th style="padding:8px 6px;text-align:left;border-bottom:2px solid var(--border)">Description</th>
      <th style="padding:8px 6px;text-align:right;border-bottom:2px solid var(--border)">Amount</th>
      <th style="padding:8px 6px;text-align:right;border-bottom:2px solid var(--border)">Balance</th>
      <th style="padding:8px 12px 8px 4px;border-bottom:2px solid var(--border)"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── Ledger actions ────────────────────────────────────────────────
function jcToggleForm() {
  const f=document.getElementById('jc-quick-form'), b=document.getElementById('jc-form-toggle');
  if (!f) return;
  const hidden=f.style.display==='none';
  f.style.display=hidden?'':'none';
  if (b) b.textContent=hidden?'▲':'▼';
}
function jcTypeChange() {
  const sel=document.querySelector('input[name="jc-type"]:checked');
  JC_TYPES.forEach(t=>{
    const lbl=document.getElementById('jc-type-lbl-'+t.id); if(!lbl)return;
    const on=sel&&sel.value===t.id;
    lbl.style.borderColor=on?t.color:'var(--border)';
    lbl.style.background=on?t.color.replace('var(--green)','#f0fdf4').replace('var(--red)','#fef2f2').replace('var(--amber)','#fffbeb').replace('var(--purple)','#f5f3ff').replace('var(--muted)','var(--s2)'):'var(--surface)';
    lbl.style.color=on?t.color:'var(--t2)';
  });
}
function jcAddEntry(opts) {
  _jcData=jcLoad();
  const date  =(opts&&opts.date)  ||document.getElementById('jc-f-date')?.value  ||_jcTodayStr();
  const shift =(opts&&opts.shift) ||document.getElementById('jc-f-shift')?.value ||'Morning';
  const type  =(opts&&opts.type)  ||document.querySelector('input[name="jc-type"]:checked')?.value||'credit';
  const amount=parseFloat((opts&&opts.amount)||document.getElementById('jc-f-amount')?.value||0);
  const desc  =(opts&&opts.desc)  ||document.getElementById('jc-f-desc')?.value  ||'';
  if (!amount||isNaN(amount)||amount<=0){toast('⚠ Enter a valid amount','w');return;}
  _jcData.entries.push({id:String(Date.now()),date,shift,type,amount,desc});
  jcSave();
  const ae=document.getElementById('jc-f-amount'), de=document.getElementById('jc-f-desc');
  if (ae) ae.value=''; if (de) de.value='';
  _renderLedger();
  toast(`✓ ${_jcType(type).icon} ₨${_jcFmt(amount)} (${shift} shift) added`);
}
function jcDeleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  _jcData=jcLoad();
  _jcData.entries=_jcData.entries.filter(e=>e.id!==id);
  jcSave(); _renderLedger(); toast('✓ Entry deleted');
}
function jcEditEntry(id) {
  _jcData=jcLoad();
  const e=_jcData.entries.find(e=>e.id===id); if (!e) return;
  const a=prompt(`Amount (current: ${_jcFmt(e.amount)}):`,e.amount); if(a===null)return;
  const pa=parseFloat(a); if(isNaN(pa)||pa<=0){toast('⚠ Invalid','w');return;}
  const d=prompt('Description:',e.desc||''); if(d===null)return;
  const s=prompt(`Shift (${JC_SHIFTS.join('/')}):`,e.shift||'Morning'); if(s===null)return;
  const ns=JC_SHIFTS.find(x=>x.toLowerCase()===(s||'').toLowerCase().trim())||e.shift;
  const ty=prompt(`Type (${JC_TYPES.map(t=>t.id).join('/')}):`,e.type); if(ty===null)return;
  const nt=JC_TYPES.find(t=>t.id===(ty||'').toLowerCase().trim())?.id||e.type;
  e.amount=pa; e.desc=d; e.shift=ns; e.type=nt;
  jcSave(); _renderLedger(); toast('✓ Entry updated');
}
function jcSetOpening() {
  _jcData=jcLoad();
  const v=prompt(`Opening balance (current: ₨${_jcFmt(_jcData.openingBalance||0)}):`,_jcData.openingBalance||0);
  if (v===null)return;
  const p=parseFloat(v); if(isNaN(p)){toast('⚠ Invalid','w');return;}
  _jcData.openingBalance=p; jcSave(); _renderLedger(); toast(`✓ Opening set to ₨${_jcFmt(p)}`);
}
function jcClearAll() {
  if(!confirm('Clear ALL Jazz Cash ledger entries?'))return;
  _jcData={openingBalance:_jcData?.openingBalance||0,entries:[]};
  jcSave(); _jcFilterMonth=''; _renderLedger(); toast('✓ Ledger cleared');
}

// ── AI Command ────────────────────────────────────────────────────
async function jcAiCommand() {
  const inp=document.getElementById('jc-ai-inp'), resEl=document.getElementById('jc-ai-result'), sp=document.getElementById('jc-ai-spinner');
  if (!inp||!resEl) return;
  const text=inp.value.trim(); if (!text){toast('⚠ Type a command','w');return;}
  if (_jcAiLoading) return;
  _jcAiLoading=true; if(sp)sp.style.display='inline'; resEl.style.display='none';
  _jcData=jcLoad();
  const sorted=(_jcData.entries||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const wb=_jcRunningBalances(sorted,_jcData.openingBalance||0);
  const bal=wb.length?wb[wb.length-1]._balance:(_jcData.openingBalance||0);
  const recent=wb.slice(-5).reverse().map(e=>`${e.date}|${e.shift}|${e.type}|₨${_jcFmt(e.amount)}|bal:₨${_jcFmt(e._balance)}`).join('\n');
  const today=_jcTodayStr(); const nd=new Date();
  const M=['January','February','March','April','May','June','July','August','September','October','November','December'];
  try {
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      model:'claude-sonnet-4-6',max_tokens:1000,
      system:`You are a Jazz Cash ledger assistant for Salman in Pakistan. Today: ${today} (${M[nd.getMonth()]} ${nd.getDate()}, ${nd.getFullYear()}).
Current balance: ₨${_jcFmt(bal)}. Recent entries:\n${recent||'(none)'}
Shifts: Morning,Evening,Night,Both,Off. Types: credit(+),debit(-),withdrawal(-),commission(+),transfer(-).
Return ONLY valid JSON, no markdown.
For add entry: {"action":"add","date":"YYYY-MM-DD","shift":"Morning","type":"credit","amount":5000,"desc":"description","explanation":"..."}
For question: {"action":"info","message":"..."}
Parse amounts: 5k=5000, 1.5k=1500. Default shift=Morning, default date=today.`,
      messages:[{role:'user',content:text}]})});
    const data=await resp.json();
    const raw=(data.content||[]).map(b=>b.text||'').join('').trim();
    const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if (parsed.action==='add') {
      resEl.style.display='block';
      resEl.innerHTML=`
        <div style="color:var(--green);font-weight:700;margin-bottom:8px">✅ ${parsed.explanation||'Ready to add'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px">
          <div><span style="color:var(--muted)">Date:</span> <strong>${_jcFmtDate(parsed.date)}</strong></div>
          <div><span style="color:var(--muted)">Shift:</span> <strong>${parsed.shift}</strong></div>
          <div><span style="color:var(--muted)">Type:</span> <strong>${_jcType(parsed.type).icon} ${_jcType(parsed.type).label}</strong></div>
          <div><span style="color:var(--muted)">Amount:</span> <strong style="font-family:var(--mono)">₨${_jcFmt(parsed.amount)}</strong></div>
          ${parsed.desc?`<div style="grid-column:1/-1"><span style="color:var(--muted)">Desc:</span> <strong>${parsed.desc}</strong></div>`:''}
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="jcAddEntry({date:'${parsed.date}',shift:'${parsed.shift}',type:'${parsed.type}',amount:${parsed.amount},desc:'${(parsed.desc||'').replace(/'/g,'&#39;')}'});document.getElementById('jc-ai-inp').value='';document.getElementById('jc-ai-result').style.display='none';"
            style="background:var(--green);color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;flex:1">✅ Confirm & Add</button>
          <button onclick="document.getElementById('jc-ai-result').style.display='none'"
            style="background:var(--s2);border:1px solid var(--border);border-radius:7px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--muted)">Cancel</button>
        </div>`;
    } else {
      resEl.style.display='block';
      resEl.innerHTML=`<div style="color:var(--t2);line-height:1.6">🤖 ${parsed.message}</div>`;
    }
    inp.value='';
  } catch(err) {
    resEl.style.display='block';
    resEl.innerHTML=`<div style="color:var(--red)">⚠ ${err.message}</div>`;
  } finally { _jcAiLoading=false; if(sp)sp.style.display='none'; }
}

// ══════════════════════════════════════════════════════════════════
// BALANCE TALLY PANEL
// ══════════════════════════════════════════════════════════════════
function _renderTally() {
  const panel=document.getElementById('jc-panel-tally'); if(!panel)return;
  _jcTallyData=_tallyLoad();
  if (!_jcTallyDate) _jcTallyDate=_jcTodayStr();

  // Pull live Jazz Cash ledger balance for the locked row
  const jcBal=_jcCurrentBalance();

  // Load snapshot for selected date if exists, else use accounts template
  const snap=_jcTallyData.snapshots?.find(s=>s.date===_jcTallyDate);
  const accounts=snap
    ? snap.accounts
    : _jcTallyData.accounts.map(a=>a.id==='jc_balance'?{...a,amount:jcBal}:{...a,amount:0});

  const total=accounts.reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  const appTarget=snap?snap.appTarget:0;
  const diff=total-appTarget;

  // Snapshot history list
  const snaps=(_jcTallyData.snapshots||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));

  panel.innerHTML=`
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af,#1d4ed8);border-radius:16px;padding:18px 20px;margin-bottom:16px;color:#fff;position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;top:-20px;width:90px;height:90px;background:rgba(255,255,255,.07);border-radius:50%"></div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8;margin-bottom:4px">⚖ Balance Tally — What You Actually Have</div>
      <div style="font-size:32px;font-weight:800;font-family:var(--mono);letter-spacing:-1px">${total<0?'−':''}₨${_jcFmt(total)}</div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;opacity:.9;flex-wrap:wrap">
        <div><span style="opacity:.7">Expense App says</span><br><span style="font-weight:700;font-family:var(--mono)">₨${_jcFmt(appTarget)}</span></div>
        <div><span style="opacity:.7">Difference</span><br>
          <span style="font-weight:700;font-family:var(--mono);color:${diff>=0?'#86efac':'#fca5a5'}">${diff>=0?'+':'−'}₨${_jcFmt(Math.abs(diff))}</span>
          ${diff===0?'<span style="font-size:10px;margin-left:5px;background:rgba(255,255,255,.2);padding:1px 6px;border-radius:4px">✓ Perfect</span>':diff>0?'<span style="font-size:10px;margin-left:5px;opacity:.7">extra</span>':'<span style="font-size:10px;margin-left:5px;opacity:.7">short</span>'}
        </div>
      </div>
    </div>

    <!-- Date + App Target row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div>
        <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">TALLY DATE</label>
        <input type="date" id="tally-date" value="${_jcTallyDate}"
          onchange="_jcTallyDate=this.value;_renderTally()"
          style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);outline:none">
      </div>
      <div>
        <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:4px">📱 EXPENSE APP TOTAL (₨)</label>
        <input type="number" id="tally-app-target" value="${appTarget||''}" placeholder="Enter app's total"
          oninput="_tallyLiveCalc()"
          style="width:100%;padding:9px 10px;border:1.5px solid #bfdbfe;border-radius:8px;font-size:14px;font-weight:700;font-family:var(--mono);background:#eff6ff;color:var(--accent);outline:none;text-align:right">
      </div>
    </div>

    <!-- Accounts Table -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden">
      <div style="background:var(--s2);padding:11px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-weight:700;font-size:13px;flex:1">💰 Account Balances</span>
        <button onclick="_tallyAddAccount()" style="background:var(--accent);color:#fff;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer">＋ Add</button>
      </div>
      <div id="tally-accounts-body" style="padding:0">
        ${_tallyAccountsHtml(accounts,jcBal)}
      </div>
      <!-- Totals -->
      <div style="border-top:2px solid var(--border);padding:0">
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:0;align-items:center;padding:11px 16px;background:var(--s2)">
          <div style="font-weight:800;font-size:13px;color:var(--text)">TOTAL (Actual)</div>
          <div id="tally-total-display" style="font-family:var(--mono);font-weight:800;font-size:16px;color:var(--accent);text-align:right;padding-right:12px">${total<0?'−':''}₨${_jcFmt(total)}</div>
          <div style="width:80px"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto auto;align-items:center;padding:8px 16px;border-top:1px solid var(--border)">
          <div style="font-size:13px;color:var(--muted)">📱 Expense App Total</div>
          <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--t2);text-align:right;padding-right:12px" id="tally-app-display">₨${_jcFmt(appTarget)}</div>
          <div style="width:80px"></div>
        </div>
        <div id="tally-diff-row" style="display:grid;grid-template-columns:1fr auto auto;align-items:center;padding:10px 16px;border-top:1px solid var(--border);background:${diff===0?'#f0fdf4':diff>0?'#fffbeb':'#fef2f2'}">
          <div style="font-weight:700;font-size:13px;color:${diff===0?'var(--green)':diff>0?'var(--amber)':'var(--red)'}">
            ${diff===0?'✅ Balanced':diff>0?'⬆ Extra Cash':'⬇ Short'}
          </div>
          <div id="tally-diff-display" style="font-family:var(--mono);font-weight:800;font-size:16px;color:${diff===0?'var(--green)':diff>0?'var(--amber)':'var(--red)'};text-align:right;padding-right:12px">
            ${diff>=0?'+':'−'}₨${_jcFmt(Math.abs(diff))}
          </div>
          <div style="width:80px"></div>
        </div>
      </div>
    </div>

    <!-- Save Snapshot -->
    <button onclick="_tallySaveSnapshot()" style="width:100%;background:#1e40af;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:8px">
      📸 Save Today's Snapshot
    </button>

    <!-- Snapshot History -->
    ${snaps.length?`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
      <div style="background:var(--s2);padding:11px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">🕐 Snapshot History</div>
      ${snaps.map(s=>{
        const sd=s.total-s.appTarget;
        return `<div onclick="_jcTallyDate='${s.date}';_renderTally()" style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:12px;transition:background .1s" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''">
          <div style="flex:1">
            <div style="font-weight:700;font-size:13px">${_jcFmtDate(s.date)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.accounts?.length||0} accounts</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--mono);font-weight:700;font-size:13px">₨${_jcFmt(s.total)}</div>
            <div style="font-size:11px;font-weight:700;color:${sd===0?'var(--green)':sd>0?'var(--amber)':'var(--red)'}">Diff: ${sd>=0?'+':'−'}₨${_jcFmt(Math.abs(sd))}</div>
          </div>
          <button onclick="event.stopPropagation();_tallyDeleteSnap('${s.date}')" style="background:var(--rlt);border:none;border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--red);font-weight:600;flex-shrink:0">✕</button>
        </div>`;
      }).join('')}
    </div>`:''
    }
  `;
}

function _tallyAccountsHtml(accounts,jcBal) {
  if (!accounts||!accounts.length) return '<div style="padding:20px;text-align:center;color:var(--muted)">No accounts. Click ＋ Add above.</div>';
  return accounts.map((a,i)=>`
    <div class="tally-acc-row" data-acid="${a.id}" style="display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);${a.id==='jc_balance'?'background:#f0fdf4':''}">
      <div style="font-size:13px;font-weight:${a.id==='jc_balance'?'700':'500'};color:${a.id==='jc_balance'?'var(--green)':'var(--text)'}">
        ${a.id==='jc_balance'?'💚 ':''}${a.name}
        ${a.id==='jc_balance'?'<span style="font-size:10px;font-weight:400;color:var(--muted);margin-left:4px">(auto from ledger)</span>':''}
      </div>
      <input type="number" value="${a.id==='jc_balance'?jcBal:(a.amount||'')}"
        ${a.id==='jc_balance'?'readonly':''} placeholder="0"
        oninput="_tallyLiveCalc()"
        data-acid="${a.id}"
        class="tally-amt-inp"
        style="width:130px;padding:7px 10px;border:${a.id==='jc_balance'?'1px solid #bbf7d0;background:#f0fdf4':'1px solid var(--border);background:var(--s2)'};border-radius:7px;font-size:13px;font-weight:700;font-family:var(--mono);text-align:right;outline:none;color:${a.id==='jc_balance'?(jcBal<0?'var(--red)':'var(--green)'):'var(--text)'}">
      <div style="width:70px;display:flex;gap:4px;justify-content:flex-end">
        ${a.locked?'<span style="font-size:18px">🔒</span>':`
          <button onclick="_tallyRenameAcc('${a.id}')" style="background:var(--alt);border:none;border-radius:5px;padding:4px 7px;font-size:11px;cursor:pointer;color:var(--accent);font-weight:600">✏</button>
          <button onclick="_tallyRemoveAcc('${a.id}')" style="background:var(--rlt);border:none;border-radius:5px;padding:4px 7px;font-size:11px;cursor:pointer;color:var(--red);font-weight:600">✕</button>`}
      </div>
    </div>`).join('');
}

function _tallyLiveCalc() {
  const inputs=document.querySelectorAll('.tally-amt-inp');
  let total=0;
  inputs.forEach(inp=>{ total+=parseFloat(inp.value)||0; });
  const appT=parseFloat(document.getElementById('tally-app-target')?.value)||0;
  const diff=total-appT;
  const td=document.getElementById('tally-total-display');
  const ad=document.getElementById('tally-app-display');
  const dr=document.getElementById('tally-diff-row');
  const dd=document.getElementById('tally-diff-display');
  if (td) td.textContent=(total<0?'−':'')+'₨'+_jcFmt(total);
  if (ad) ad.textContent='₨'+_jcFmt(appT);
  if (dd) {
    dd.textContent=(diff>=0?'+':'−')+'₨'+_jcFmt(Math.abs(diff));
    dd.style.color=diff===0?'var(--green)':diff>0?'var(--amber)':'var(--red)';
  }
  if (dr) {
    dr.style.background=diff===0?'#f0fdf4':diff>0?'#fffbeb':'#fef2f2';
    dr.querySelector('div').textContent=diff===0?'✅ Balanced':diff>0?'⬆ Extra Cash':'⬇ Short';
    dr.querySelector('div').style.color=diff===0?'var(--green)':diff>0?'var(--amber)':'var(--red)';
  }
}

function _tallySaveSnapshot() {
  _jcTallyData=_tallyLoad();
  const date=document.getElementById('tally-date')?.value||_jcTodayStr();
  const appTarget=parseFloat(document.getElementById('tally-app-target')?.value)||0;
  const inputs=document.querySelectorAll('.tally-amt-inp');
  const accountsCopy=[];
  inputs.forEach(inp=>{
    const id=inp.dataset.acid;
    const base=_jcTallyData.accounts.find(a=>a.id===id)||{id,name:id,amount:0};
    accountsCopy.push({...base,amount:parseFloat(inp.value)||0});
  });
  const total=accountsCopy.reduce((s,a)=>s+(parseFloat(a.amount)||0),0);
  // Remove existing snap for this date, then push new
  _jcTallyData.snapshots=(_jcTallyData.snapshots||[]).filter(s=>s.date!==date);
  _jcTallyData.snapshots.push({date,accounts:accountsCopy,appTarget,total,diff:total-appTarget,savedAt:new Date().toISOString()});
  // Also update accounts template amounts
  _jcTallyData.accounts=accountsCopy;
  _tallySave(_jcTallyData);
  _renderTally();
  toast(`✓ Snapshot saved for ${_jcFmtDate(date)} — Diff: ${total-appTarget>=0?'+':'−'}₨${_jcFmt(Math.abs(total-appTarget))}`);
}

function _tallyAddAccount() {
  const name=prompt('Account / wallet name (e.g. Cash Hamza, Meezan, Easypaisa):');
  if (!name||!name.trim()) return;
  _jcTallyData=_tallyLoad();
  const id='acc_'+Date.now();
  _jcTallyData.accounts.push({id,name:name.trim(),amount:0});
  _tallySave(_jcTallyData);
  _renderTally();
  toast('✓ Account "'+name.trim()+'" added');
}

function _tallyRenameAcc(id) {
  _jcTallyData=_tallyLoad();
  const acc=_jcTallyData.accounts.find(a=>a.id===id); if(!acc)return;
  const n=prompt('Rename account:',acc.name); if(!n||!n.trim())return;
  acc.name=n.trim(); _tallySave(_jcTallyData); _renderTally(); toast('✓ Renamed');
}

function _tallyRemoveAcc(id) {
  if (!confirm('Remove this account from tally?')) return;
  _jcTallyData=_tallyLoad();
  _jcTallyData.accounts=_jcTallyData.accounts.filter(a=>a.id!==id);
  _tallySave(_jcTallyData); _renderTally(); toast('✓ Account removed');
}

function _tallyDeleteSnap(date) {
  if (!confirm('Delete snapshot for '+_jcFmtDate(date)+'?')) return;
  _jcTallyData=_tallyLoad();
  _jcTallyData.snapshots=(_jcTallyData.snapshots||[]).filter(s=>s.date!==date);
  _tallySave(_jcTallyData); _renderTally(); toast('✓ Snapshot deleted');
}

// ── Hook into Manager page load ───────────────────────────────────
window.addEventListener('load', function() {
  if (typeof loadManagerPage==='function') {
    const _orig=loadManagerPage;
    loadManagerPage=function() { _orig(); renderJazzCash(); };
  }
});
