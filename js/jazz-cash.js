// ══════════════════════════════════════════════════════════════════
// JAZZ CASH MODULE — Balance Tally
// (The Daily Ledger sub-tab now runs on the generalized Ledger —
// see ledger-store.js/ledger-actions.js/ledger-page.js. This file keeps
// only the Balance Tally feature, which has no equivalent there — it's
// a wallet-reconciliation/snapshot tool, not a transaction ledger.)
// ══════════════════════════════════════════════════════════════════

// ─── LEDGER constants — kept only because drive.js/supabase.js still
// back up the frozen legacy blob under this key, and the one-time
// migration button below reads it. Nothing writes through here anymore. ───
const JC_KEY     = 'bt_jazzcash_v2';
const JC_MIGRATED_FLAG = 'bt_jazzcash_ledger_migrated_v1';

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
let _jcActiveTab  = 'ledger';  // 'ledger' | 'tally'
let _jcTallyData  = null;
let _jcTallyDate  = '';

// ══════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════
function _jcFmt(v)   { return Math.abs(Math.round(Number(v)||0)).toLocaleString('en-PK'); }
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
// LEDGER — current balance (reads the generalized Ledger now; the old
// jcLoad()/jcSave() pair that read/wrote JC_KEY directly is gone along
// with the rest of the old ledger UI — see header comment)
// ══════════════════════════════════════════════════════════════════
function _jcCurrentBalance() {
  return (typeof LedgerStore !== 'undefined' && LedgerStore.getCurrentBalance)
    ? LedgerStore.getCurrentBalance('jazzcash')
    : 0;
}

// ══════════════════════════════════════════════════════════════════
// TALLY — Persistence
// ══════════════════════════════════════════════════════════════════
function _tallyLoad() {
  try { const r=Repository.getItem(JC_TALLY_KEY); if(r) return JSON.parse(r); } catch(e){}
  return { accounts: JSON.parse(JSON.stringify(JC_TALLY_DEFAULTS)), snapshots:[] };
}
function _tallySave(data) {
  Actions.saveFeatureData(JC_TALLY_KEY, JSON.stringify(data));
  if (Repository.getItem('bt_auto_save')==='1' && typeof pushToSupabase==='function') pushToSupabase();
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
// LEDGER PANEL — thin wrapper around the generalized Ledger
// (renderLedgerView, from ledger-page.js). Shows a one-time migration
// banner if old bt_jazzcash_v2 data exists and hasn't been moved over
// yet; the move itself is explicit/confirmed, never automatic — see
// ledger-migration.js's header comment.
// ══════════════════════════════════════════════════════════════════
function _renderLedger() {
  const panel = document.getElementById('jc-panel-ledger');
  if (!panel) return;

  const alreadyMigrated = Repository.getItem(JC_MIGRATED_FLAG) === '1';
  let legacyHasData = false;
  if (!alreadyMigrated) {
    try {
      const raw = Repository.getItem(JC_KEY);
      const d = raw ? JSON.parse(raw) : null;
      legacyHasData = !!(d && Array.isArray(d.entries) && d.entries.length);
    } catch (e) {}
  }

  panel.innerHTML = `
    ${legacyHasData ? `
    <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;margin-bottom:6px">⚠ Old Jazz Cash data found</div>
      <div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:10px">This ledger now runs on the app's unified Ledger. Your previous Jazz Cash entries haven't been moved over yet — migrate them once below. Nothing is deleted; your old data stays backed up either way.</div>
      <button id="jc-migrate-btn" style="background:#d97706;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer">Migrate old Jazz Cash entries →</button>
    </div>` : ''}
    <div id="jc-ledger-inner"></div>
  `;

  const btn = document.getElementById('jc-migrate-btn');
  if (btn) btn.onclick = function () {
    if (!confirm('Migrate your existing Jazz Cash ledger entries into the new Ledger? This only needs to run once.')) return;
    const result = (typeof migrateJazzCashToLedger === 'function') ? migrateJazzCashToLedger() : { migrated: 0 };
    Actions.saveFeatureData(JC_MIGRATED_FLAG, '1');
    toast(`✓ Migrated ${result.migrated} Jazz Cash entries`);
    _renderLedger();
  };

  if (typeof renderLedgerView === 'function') {
    renderLedgerView('jc-ledger-inner', 'jazzcash', '📒 Jazz Cash');
  }
}


// ══════════════════════════════════════════════════════════════════
function _renderTally() {
  const panel=document.getElementById('jc-panel-tally'); if(!panel)return;
  _jcTallyData=_tallyLoad();
  if (!_jcTallyDate) _jcTallyDate=_jcTodayStr();

  // Pull live Jazz Cash ledger balance for the locked row (sign reversed: negative ledger = positive tally)
  const jcBal=0-_jcCurrentBalance();

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
        ${a.id==='jc_balance'?'📒 ':''}${a.name}
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
