import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "v8-2026-11-11";
const FOLDER_NAME = "Manager Dashboard Archives";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CSS: string = String.raw`:root{--bg:#f1f5f9;--card:#fff;--ink:#0f1b2d;--muted:#64748b;--line:#e2e8f0;--pos:#087f5b;--neg:#c2413b;--accent:#0b6b8a;--shadow:0 2px 10px rgba(15,27,45,.06)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1220;--card:#121c2e;--ink:#e6edf7;--muted:#94a3b8;--line:#22314a;--pos:#34d399;--neg:#f87171;--accent:#38bdf8;--shadow:none}}
:root[data-theme="dark"]{--bg:#0b1220;--card:#121c2e;--ink:#e6edf7;--muted:#94a3b8;--line:#22314a;--pos:#34d399;--neg:#f87171;--accent:#38bdf8;--shadow:none}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.hero{background:linear-gradient(115deg,#0f1b2d 0%,#0a4766 60%,#0b6b8a 100%);color:#fff;padding:22px 18px 20px}
.hero h1{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}
.hero p{margin:0;opacity:.8;font-size:13px}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;background:var(--card);border-bottom:1px solid var(--line)}
.bar select,.bar input[type=search],.filters input{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 10px;min-width:0}
.bar input[type=search]{flex:1 1 140px}
.btn,.chip{font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer}
.btn:hover,.chip:hover{border-color:var(--accent)}
.btn.primary,.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
main{max-width:1180px;margin:0 auto;padding:14px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow)}
.kpi small{display:block;color:var(--muted);font-size:12px}
.kpi strong{display:block;font-size:19px;font-variant-numeric:tabular-nums}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px;align-items:start}
.misc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:12px;align-items:start}
h3.sec{margin:20px 2px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.card{background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:14px;box-shadow:var(--shadow)}
.card.staff{border-color:#34d399}.card.jazz{border-color:#22b8cf}.card.patty{border-color:#fbbf24}.card.misc{border-color:#a78bfa}.card.work{border-color:var(--line);margin-top:12px}
.card header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.ico{width:34px;height:34px;border-radius:10px;background:var(--bg);display:grid;place-items:center;font-size:17px;flex:none}
.card h2{flex:1;margin:0;font-size:14.5px;line-height:1.25;min-width:0}
.card h2 small{display:block;font-weight:400;color:var(--muted);font-size:11.5px;margin-top:2px}
.tot{font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap;border:1.5px solid var(--line);border-radius:12px;padding:5px 10px}
.pos{color:var(--pos)}.neg{color:var(--neg)}
.num{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
details{border-top:1px solid var(--line);padding:7px 0}
summary{cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"\25B8";color:var(--muted);margin-right:6px;transition:transform .15s}
details[open]>summary::before{transform:rotate(90deg)}
summary>span:first-child{flex:1;min-width:0}
summary i,.line i{font-style:normal;color:var(--muted);font-weight:400;font-size:12px}
.sub{padding:4px 0 2px 16px}
.line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--line);font-size:13px}
.line:last-child{border-bottom:0}
.card>.line{border-top:1px solid var(--line);border-bottom:0;padding:8px 0;font-weight:600}
.muted{color:var(--muted);margin:8px 0 0}
.filters{display:flex;align-items:center;gap:8px;margin:2px 0 8px}
.filters input{flex:1;padding:6px 8px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{padding:4px 10px;font-size:12px}
.band{margin-top:14px;background:linear-gradient(110deg,#0f3d3a,#0a5c4f);color:#d1fae5;border-radius:14px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.band b{display:block;font-size:12px;letter-spacing:.06em}
.band small{opacity:.75}
.band strong{font-size:28px;color:#6ee7b7;font-variant-numeric:tabular-nums}
.verify{margin:6px 4px 0;font-size:12px}.verify.ok{color:var(--pos)}.verify.bad{color:var(--neg);font-weight:700}
.kpis .kpi strong{font-size:17px}
footer{margin:18px 2px 30px;color:var(--muted);font-size:12px}
.warn{margin:6px 0 0;padding-left:18px;color:var(--neg)}
noscript{display:block;padding:14px;background:#fef3c7;color:#78350f;margin:12px}
@media (max-width:520px){.hero{padding:16px 14px}.hero h1{font-size:19px}main{padding:10px}.band strong{font-size:24px}}
@media print{.bar,.btn,.chips,.filters{display:none!important}body{background:#fff}.card,.kpi{box-shadow:none;break-inside:avoid}.hero,.band{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sticky{position:static}}`;
const CLIENT_JS: string = String.raw`(function(){
var D=JSON.parse(document.getElementById('data').textContent);
var REG=[];
var S={month:D.month,from:'',to:'',q:'',preset:''};
function $(s){return document.querySelector(s)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function money(n){n=Math.round(Number(n)||0);return (n<0?'\u2212':'')+'\u20A8'+Math.abs(n).toLocaleString('en-PK')}
function dash(n){return n?money(n):'\u2014'}
function sgn(n){return n<0?'neg':(n>0?'pos':'')}
function reg(x){REG.push(x);return REG.length-1}
function line(label,val,c){return '<div class="line"><span>'+label+'</span><span class="num '+(c==null?sgn(val):c)+'">'+money(val)+'</span></div>'}
function card(k,ico,title,total,body,note,id){
  return '<article class="card '+k+'"'+(id?' id="'+id+'"':'')+'><header><div class="ico">'+ico+'</div><h2>'+esc(title)+(note?'<small>'+esc(note)+'</small>':'')+'</h2><b class="tot '+sgn(total)+'">'+money(total)+'</b></header>'+body+'</article>';
}
function calc(L,from,to){
  var filtered=!!(from||to),sums={},by={};
  L.entries.forEach(function(e){
    if(from&&e.d<from)return;
    if(to&&e.d>to)return;
    sums[e.c]=(sums[e.c]||0)+e.a;
    (by[e.c]=by[e.c]||[]).push(e);
  });
  var rows=[];
  if(L.opening&&!filtered)rows.push({label:'\uD83C\uDFE6 Opening Balance',net:L.opening});
  L.cats.forEach(function(c){
    var s=sums[c.id]||0;
    if(s)rows.push({label:(c.icon?c.icon+' ':'')+c.label,net:c.sign*s,entries:by[c.id],sign:c.sign});
  });
  return {rows:rows,total:rows.reduce(function(a,r){return a+r.net},0),filtered:filtered};
}
function ledgerBody(r){
  if(!r.rows.length)return '<p class="muted">No activity yet</p>';
  return r.rows.map(function(x){
    if(!x.entries)return line(esc(x.label),x.net);
    return '<details data-r="'+reg({e:x.entries,s:x.sign})+'"><summary><span>'+esc(x.label)+' <i>('+x.entries.length+')</i></span><span class="num '+sgn(x.net)+'">'+money(x.net)+'</span></summary><div class="sub"></div></details>';
  }).join('');
}
function staffRows(){return D.credit[S.month]||[]}
function staffTotal(){return staffRows().reduce(function(a,r){return a+r.net},0)}
function staffCard(){
  var rows=staffRows(),q=S.q.toLowerCase();
  var shown=rows.filter(function(r){return !q||r.n.toLowerCase().indexOf(q)>-1});
  var body=shown.length?shown.map(function(r){
    var h=r.prev?line('Previous balance',r.prev,''):'';
    h+=r.entries.map(function(e){return line(esc(e.d+' \u00B7 '+e.t),e.a,'')}).join('');
    if(r.sal)h+=line('Salary deduction',-r.sal,'');
    if(r.less)h+=line('Less Generic',-r.less,'');
    return '<details><summary><span>'+esc(r.n)+'</span><span class="num pos">'+money(r.net)+'</span></summary><div class="sub">'+h+'</div></details>';
  }).join(''):'<p class="muted">'+(rows.length?'No staff match your search':'No staff credit recorded for this month')+'</p>';
  return card('staff','\uD83D\uDC65','Staff Credit \u2014 '+S.month,staffTotal(),body,rows.length+' staff with a balance','staff');
}
function jazzCard(){
  var r=calc(D.jazz,'','');
  return card('jazz','\uD83D\uDCB8','Jazz Cash (all-time)',r.total,ledgerBody(r),'Opening '+money(D.jazz.opening),'jazz');
}
function pattyCard(){
  var r=calc(D.expense,S.from,S.to);
  var chips=[['month','This Month'],['wk1','Wk1 (01\u201307)'],['wk2','Wk2 (08\u201314)'],['wk3','Wk3 (15\u201322)'],['wk4','Wk4 (23\u2013End)']].map(function(p){
    return '<button class="chip'+(S.preset===p[0]?' on':'')+'" data-p="'+p[0]+'">'+p[1]+'</button>';
  }).join('');
  var ctl='<div class="filters"><input type="date" id="pf" value="'+esc(S.from)+'" aria-label="From date"><span>to</span><input type="date" id="pt" value="'+esc(S.to)+'" aria-label="To date"></div><div class="chips">'+chips+'<button class="chip reset" data-p="reset">Reset</button></div>';
  return card('patty','\uD83E\uDDFE','Patty / Expenses'+(r.filtered?' (filtered)':' (all-time)'),r.total,ctl+ledgerBody(r),r.filtered?'Net of the rows in range':'Running balance','patty');
}
function miscCards(){
  return D.custom.map(function(L){
    var r=calc(L,'','');
    return card('misc','\uD83D\uDCCB',L.label,r.total,ledgerBody(r));
  }).join('');
}
function miscTotal(){return D.custom.reduce(function(a,L){return a+calc(L,'','').total},0)}
function grand(){return staffTotal()+calc(D.jazz,'','').total+calc(D.expense,'','').total+miscTotal()}
function workBlock(){
  var w=D.work[S.month]||{salary:0,generic:0,petty:0,incentive:0,salaryRows:[],genericRows:[],pettyRows:[]};
  var tiles=[['Salary',w.salary],['Generic',w.generic],['Patty Detail',w.petty],['Incentives',w.incentive]].map(function(t){
    return '<div class="kpi"><strong>'+dash(t[1])+'</strong><small>'+t[0]+'</small></div>';
  }).join('');
  function list(title,rows,total){
    if(!rows.length)return '';
    return '<details><summary><span>'+title+'</span><span class="num">'+money(total)+'</span></summary><div class="sub">'+rows.map(function(r){return '<div class="line"><span>'+esc(r.n)+(r.x?' <i>'+esc(r.x)+'</i>':'')+'</span><span class="num">'+money(r.v)+'</span></div>'}).join('')+'</div></details>';
  }
  return '<section class="card work"><header><div class="ico">\uD83D\uDCD1</div><h2>Working Summary<small>'+esc(S.month)+'</small></h2></header><div class="kpis">'+tiles+'</div>'+list('Salary details',w.salaryRows,w.salary)+list('Generic details',w.genericRows,w.generic)+list('Patty Detail',w.pettyRows,w.petty)+'</section>';
}
function kpiRow(){
  var items=[['Staff Credit',staffTotal()],['Jazz Cash',calc(D.jazz,'','').total],['Patty / Expenses',calc(D.expense,'','').total],['Misc Sections',miscTotal()]];
  return items.map(function(i){return '<div class="kpi"><small>'+i[0]+'</small><strong class="'+sgn(i[1])+'">'+money(i[1])+'</strong></div>'}).join('');
}
function band(){
  var g=grand();
  var ok=(S.month===D.month)?(Math.round(g)===D.check.grand):null;
  return '<section class="band"><div><b>\uD83D\uDCB0 TOTAL OUTSTANDING CREDITS</b><small>Staff ('+esc(S.month)+') + Jazz Cash + Patty/Expenses + Misc Sections, all-time</small></div><strong>'+money(g)+'</strong></section>'+(ok===null?'':'<p class="verify '+(ok?'ok':'bad')+'">'+(ok?'\u2713 Totals re-computed in your browser match the server figure':'\u26A0 Browser total differs from server total ('+money(D.check.grand)+')')+'</p>');
}
function fmtDate(iso){try{return new Date(iso).toLocaleString('en-PK',{timeZone:'Asia/Karachi',dateStyle:'medium',timeStyle:'short'})}catch(e){return iso}}
function foot(){
  var m=D.meta,w=(m.warnings||[]).map(function(x){return '<li>'+esc(x)+'</li>'}).join('');
  return '<footer><p>Generated '+esc(fmtDate(D.generatedAt))+' PKT \u00B7 source: '+esc(m.source)+' \u00B7 '+m.ledgerEntries+' ledger entries \u00B7 '+m.staleRows+' stale rows ignored \u00B7 '+m.sheets+' shift sheets \u00B7 '+m.staff+' staff \u00B7 build '+esc(m.version)+'</p>'+(w?'<ul class="warn">'+w+'</ul>':'')+'</footer>';
}
function renderTop(){
  $('#kpis').innerHTML=kpiRow();
  $('#band').innerHTML=band();
}
function renderAll(){
  REG=[];
  renderTop();
  $('#grid').innerHTML=staffCard()+jazzCard()+pattyCard();
  $('#misc').innerHTML=miscCards();
  $('#work').innerHTML=workBlock();
  $('#foot').innerHTML=foot();
}
function renderPatty(){
  var el=$('#patty');
  var tmp=document.createElement('div');
  tmp.innerHTML=pattyCard();
  el.parentNode.replaceChild(tmp.firstChild,el);
}
function range(p){
  var t=D.today.split('-'),y=+t[0],m=+t[1];
  function iso(d){return y+'-'+(m<10?'0':'')+m+'-'+(d<10?'0':'')+d}
  var last=new Date(y,m,0).getDate();
  if(p==='month')return [iso(1),iso(last)];
  if(p==='wk1')return [iso(1),iso(7)];
  if(p==='wk2')return [iso(8),iso(14)];
  if(p==='wk3')return [iso(15),iso(22)];
  if(p==='wk4')return [iso(23),iso(last)];
  return ['',''];
}
function fillDetails(d){
  var x=REG[+d.getAttribute('data-r')];
  if(!x||d.getAttribute('data-f'))return;
  d.setAttribute('data-f','1');
  var rows=x.e.slice().sort(function(a,b){return a.d<b.d?1:(a.d>b.d?-1:0)});
  d.querySelector('.sub').innerHTML=rows.map(function(e){
    var v=x.s*e.a;
    return line(esc(e.d+(e.t?' \u00B7 '+e.t:'')),v);
  }).join('');
}
document.addEventListener('toggle',function(ev){
  var d=ev.target;
  if(d&&d.tagName==='DETAILS'&&d.open&&d.hasAttribute('data-r'))fillDetails(d);
},true);
document.addEventListener('click',function(ev){
  var b=ev.target.closest?ev.target.closest('[data-p]'):null;
  if(b){
    var p=b.getAttribute('data-p');
    var r=range(p);S.from=r[0];S.to=r[1];S.preset=(p==='reset'?'':p);
    renderPatty();return;
  }
  var a=ev.target.closest?ev.target.closest('[data-act]'):null;
  if(!a)return;
  var act=a.getAttribute('data-act');
  if(act==='print')window.print();
  if(act==='csv')exportCsv();
  if(act==='expand'||act==='collapse'){
    document.querySelectorAll('details').forEach(function(d){
      if(act==='expand'&&d.hasAttribute('data-r')&&REG[+d.getAttribute('data-r')].e.length>60)return;
      d.open=(act==='expand');
    });
  }
  if(act==='theme'){
    var h=document.documentElement;
    h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'light':'dark');
  }
});
document.addEventListener('change',function(ev){
  var t=ev.target;
  if(t.id==='pf'||t.id==='pt'){S.from=$('#pf').value;S.to=$('#pt').value;S.preset='';renderPatty();}
  if(t.id==='month'){S.month=t.value;renderAll();}
});
document.addEventListener('input',function(ev){
  if(ev.target.id==='q'){S.q=ev.target.value;var el=$('#staff');var tmp=document.createElement('div');tmp.innerHTML=staffCard();el.parentNode.replaceChild(tmp.firstChild,el);}
});
window.addEventListener('beforeprint',function(){
  document.querySelectorAll('details').forEach(function(d){
    if(d.hasAttribute('data-r')&&REG[+d.getAttribute('data-r')].e.length>60)return;
    d.open=true;
  });
});
function exportCsv(){
  var NL=String.fromCharCode(10),Q=String.fromCharCode(34);
  function c(v){return Q+String(v==null?'':v).split(Q).join(Q+Q)+Q}
  var out=[['section','category','date','amount','signed_amount','description'].join(',')];
  [['Jazz Cash',D.jazz],['Patty / Expenses',D.expense]].concat(D.custom.map(function(L){return [L.label,L]})).forEach(function(p){
    var L=p[1],cat={};
    L.cats.forEach(function(k){cat[k.id]=k});
    L.entries.slice().sort(function(a,b){return a.d<b.d?-1:1}).forEach(function(e){
      var k=cat[e.c]||{label:e.c,sign:-1};
      out.push([c(p[0]),c(k.label),c(e.d),e.a,k.sign*e.a,c(e.t)].join(','));
    });
  });
  var blob=new Blob([String.fromCharCode(65279)+out.join(NL)],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='ledger-entries-'+D.today+'.csv';
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
}
var sel=$('#month');
sel.innerHTML=D.months.map(function(m){return '<option'+(m===S.month?' selected':'')+'>'+esc(m)+'</option>'}).join('');
renderAll();
})();`;

// ───────────────────────── helpers ─────────────────────────
const ni = (v: any) => Math.round(Number(v) || 0);
const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthRank = (m: string) => { const [n, y] = String(m).split(" "); const i = MONTHS.indexOf(n); return i < 0 || !y ? 0 : Number(y) * 12 + i; };
const pkDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

type Cat = { id: string; label: string; sign: number; icon?: string };

// Built-in ledger categories — mirror js/ledger/ledger-store.js (LEDGER_CATEGORIES) exactly.
const JAZZ_CATS: Cat[] = [
  { id: "credit", label: "Received (+)", sign: 1, icon: "⬆" },
  { id: "debit", label: "Patty Incentive (−)", sign: -1, icon: "⬇" },
  { id: "withdrawal", label: "Generic Incentive (−)", sign: -1, icon: "💸" },
  { id: "commission", label: "Strips / Adjustments (−)", sign: -1, icon: "🏅" },
  { id: "transfer", label: "Transfer (−)", sign: -1, icon: "↔" },
];
const EXPENSE_CATS: Cat[] = [
  { id: "bill", label: "Bill Amount", sign: 1, icon: "🧾" },
  { id: "fuel", label: "Fuel/HO", sign: 1, icon: "⛽" },
  { id: "soap", label: "Soap/Tissue", sign: 1, icon: "🧼" },
  { id: "refresh", label: "Refreshment", sign: 1, icon: "☕" },
  { id: "extra", label: "Extra", sign: 1, icon: "➕" },
  { id: "guardIncentive", label: "Guard Incentive", sign: 1, icon: "🛡" },
  { id: "pattyHO", label: "Patty H/O (received)", sign: -1, icon: "⬆" },
];
// Display order of Misc Sections on the live dashboard; unknown/new sections are appended A→Z.
const CUSTOM_ORDER = ["custom:pharmacy", "custom:less-amount", "custom:less-amounts", "custom:extra-credits", "custom:adjustments-strips", "custom:patty-cash-cheque-details"];

// ───────────────────────── Google Drive ─────────────────────────
async function accessToken(row: any) {
  const exp = row.access_token_expires_at ? Date.parse(row.access_token_expires_at) : 0;
  if (row.access_token && exp - Date.now() > 60000) return row.access_token as string;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token: row.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || "Google token refresh failed");
  await db.from("google_drive_backup").update({ access_token: j.access_token, access_token_expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString() }).eq("id", 1);
  return j.access_token as string;
}
const qLit = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
async function ensureFolder(t: string) {
  const q = encodeURIComponent(`name=${qLit(FOLDER_NAME)} and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)&pageSize=10", { headers: { Authorization: "Bearer " + t } });
  const j = await r.json();
  if (!r.ok) throw new Error("Drive folder lookup failed: " + (j.error?.message || r.status));
  if (j.files?.length) return j.files[0].id as string;
  const c = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) });
  const f = await c.json();
  if (!c.ok) throw new Error("Drive folder creation failed: " + (f.error?.message || c.status));
  return f.id as string;
}
async function uploadHtml(t: string, folderId: string, name: string, html: string) {
  const q = encodeURIComponent(`name=${qLit(name)} and '${folderId}' in parents and trashed=false`);
  const l = await fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)", { headers: { Authorization: "Bearer " + t } });
  const lj = await l.json();
  if (!l.ok) throw new Error("Drive file lookup failed: " + (lj.error?.message || l.status));
  const existing = lj.files?.[0]?.id as string | undefined;
  const boundary = "btDashboardHtml";
  const meta = JSON.stringify(existing ? { name, mimeType: "text/html" } : { name, mimeType: "text/html", parents: [folderId] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n`, html, `\r\n--${boundary}--`], { type: "multipart/related; boundary=" + boundary });
  const base = "https://www.googleapis.com/upload/drive/v3/files";
  const url = (existing ? `${base}/${existing}` : base) + "?uploadType=multipart&fields=id,name,webViewLink,modifiedTime,size";
  const r = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "multipart/related; boundary=" + boundary }, body });
  const saved = await r.json();
  if (!r.ok) throw new Error("Drive upload failed: " + (saved.error?.message || r.status));
  return { id: saved.id as string, link: (saved.webViewLink as string) || `https://drive.google.com/file/d/${saved.id}/view`, replaced: !!existing, size: saved.size };
}

// ───────────────────────── data (mirrors the live app) ─────────────────────────
// The live app's state is bt_salesdata.payload (id='main'). bt_ledger_entries is only a fan-out copy that
// is upserted but never pruned, so it keeps rows the app has already deleted. Always prefer the payload.
async function loadLedger() {
  const warnings: string[] = [];
  const { count: tableCount } = await db.from("bt_ledger_entries").select("id", { count: "exact", head: true });
  const p = await db.from("bt_salesdata").select("ledger:payload->ledger").eq("id", "main").maybeSingle();
  const led: any = (p.data as any)?.ledger;
  if (!p.error && led && Array.isArray(led.entries)) {
    return { entries: led.entries as any[], opening: (led.openingBalances || {}) as Record<string, number>, source: "bt_salesdata (live app state)", stale: Math.max(0, (tableCount || 0) - led.entries.length), warnings };
  }
  warnings.push("bt_salesdata payload unavailable — fell back to bt_ledger_entries; opening balances are NOT included and deleted entries may appear.");
  const out: any[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const pg = await db.from("bt_ledger_entries").select("data").range(off, off + 999);
    if (pg.error) throw pg.error;
    out.push(...(pg.data || []).map((x: any) => x.data));
    if ((pg.data || []).length < 1000) break;
  }
  return { entries: out, opening: {} as Record<string, number>, source: "bt_ledger_entries (fallback)", stale: 0, warnings };
}

function ledgerModel(label: string, type: string, cats: Cat[], all: any[], opening: number) {
  const known = new Set(cats.map((c) => c.id));
  const entries = all.filter((e) => e && e.ledgerType === type).map((e) => ({
    d: String(e.date || ""), c: known.has(e.categoryId) ? String(e.categoryId) : "__other", a: Number(e.amount) || 0,
    t: String(e.desc || e.groupLabel || "").trim(),
  }));
  // Same behaviour as LedgerStore.getEntriesWithBalance: a category the config doesn't know counts as sign −1.
  const cs = entries.some((e) => e.c === "__other") ? [...cats, { id: "__other", label: "Uncategorised", sign: -1, icon: "❔" }] : cats;
  const sign = new Map(cs.map((c) => [c.id, c.sign]));
  const total = Math.round((Number(opening) || 0) + entries.reduce((s, e) => s + (sign.get(e.c) ?? -1) * e.a, 0));
  return { id: type, label, opening: Number(opening) || 0, cats: cs, entries, total };
}

async function buildData() {
  const [led, mgr, types, inc, petty, sheets, staff] = await Promise.all([
    loadLedger(),
    db.from("bt_manager").select("section,month,data"),
    db.from("bt_ledger_custom_types").select("type,data"),
    db.from("bt_incentives").select("key,data"),
    db.from("bt_petty_cash").select("key,data"),
    db.from("sheets").select("key", { count: "exact", head: true }).eq("draft", false),
    db.from("bt_staff").select("id", { count: "exact", head: true }),
  ]);
  for (const x of [mgr, types, inc, petty]) if ((x as any).error) throw (x as any).error;

  const M: Record<string, Record<string, any>> = {};
  (mgr.data || []).forEach((r: any) => { (M[r.section] ??= {})[r.month] = r.data; });

  // Staff Credit per month (identical maths to Analytics.getCreditSectionData; zero-balance staff hidden).
  const credit: Record<string, any[]> = {};
  for (const [month, rows] of Object.entries(M.credit || {})) {
    credit[month] = (Array.isArray(rows) ? rows : []).map((e: any) => {
      const entries = (Array.isArray(e.entries) ? e.entries : []).map((x: any) => ({ d: String(x.date || ""), t: String(x.desc || "Credit entry"), a: ni(x.amount) }));
      const prev = ni(e.prevBal), sal = ni(e.salary), less = ni(e.lessGeneric);
      return { n: String(e.name || "Staff").trim(), prev, sal, less, net: prev + entries.reduce((s: number, x: any) => s + x.a, 0) - sal - less, entries };
    }).filter((r: any) => r.net !== 0);
  }
  const months = Object.keys(M.credit || {}).sort((a, b) => monthRank(b) - monthRank(a));
  const month = months[0] || "";

  // Working Summary per month — mirrors populateDashWorking() in js/manager/manager-page.js.
  const pettyMap: Record<string, any> = {}; (petty.data || []).forEach((r: any) => (pettyMap[r.key] = r.data));
  const incMap: Record<string, any> = {}; (inc.data || []).forEach((r: any) => (incMap[r.key] = r.data));
  const allMonths = new Set<string>(months);
  ["salary", "generic"].forEach((s) => Object.keys(M[s] || {}).forEach((m) => allMonths.add(m)));
  const work: Record<string, any> = {};
  for (const m of allMonths) {
    const sal = (Array.isArray(M.salary?.[m]) ? M.salary[m] : []).map((r: any) => {
      const extras = (Array.isArray(r.extras) ? r.extras : []).reduce((a: number, e: any) => a + (e.sign === "-" ? -1 : 1) * ni(e.amount), 0);
      const v = ni(r.hoSal) - ni(r.advance) + ni(r.generic) + extras;
      return { n: String(r.name || "Staff").trim(), v, x: `HO ${ni(r.hoSal)} − Adv ${ni(r.advance)} + Gen ${ni(r.generic)}${extras ? ` ${extras > 0 ? "+" : "−"} Extras ${Math.abs(extras)}` : ""}` };
    });
    const gen = (Array.isArray(M.generic?.[m]) ? M.generic[m] : []).map((r: any) => ({ n: String(r.name || "Staff").trim(), v: Math.round(ni(r.genericSale) * 0.04) + ni(r.extra), x: `4% of ${ni(r.genericSale)}${ni(r.extra) ? ` + ${ni(r.extra)}` : ""}` }));
    const groups = Array.isArray(pettyMap["mw_petty_" + m]?.groups) ? pettyMap["mw_petty_" + m].groups : [];
    const pr = groups.flatMap((g: any) => (Array.isArray(g.rows) ? g.rows : []).map((r: any) => ({ n: String(r.desc || "Entry"), x: String(g.period || ""), v: ni(r.amount) })));
    const i = incMap["mw_incentive_" + m] || {};
    let incNet = i.netInc;
    if (incNet == null) incNet = Math.round(ni(i.saleVal) * 0.005) - ni(i.pilferage) - ni(i.tillShort) + ni(i.cashTarget) + Math.round(ni(i.genSale) * 0.045) - ni(i.excessFine) - ni(i.plusFine) - ni(i.paperFine) - ni(i.panelFine);
    work[m] = {
      salary: sal.reduce((s: number, r: any) => s + r.v, 0), generic: gen.reduce((s: number, r: any) => s + r.v, 0),
      petty: pr.reduce((s: number, r: any) => s + r.v, 0), incentive: ni(incNet),
      salaryRows: sal, genericRows: gen, pettyRows: pr,
    };
  }

  // Ledgers
  const jazz = ledgerModel("Jazz Cash (all-time)", "jazzcash", JAZZ_CATS, led.entries, led.opening["jazzcash"] || 0);
  const expense = ledgerModel("Patty / Expenses", "expense", EXPENSE_CATS, led.entries, led.opening["expense"] || 0);
  const defs = (types.data || []).slice().sort((a: any, b: any) => {
    const ia = CUSTOM_ORDER.indexOf(a.type), ib = CUSTOM_ORDER.indexOf(b.type);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || String(a.type).localeCompare(String(b.type));
  });
  const custom = defs.map((t: any) => ledgerModel(t.data?.label || t.type, t.type, (t.data?.categories || []).map((c: any) => ({ id: c.id, label: c.label || c.id, sign: Number(c.sign) || 1, icon: c.icon })), led.entries, led.opening[t.type] || 0));

  const staffTotal = (credit[month] || []).reduce((s: number, r: any) => s + r.net, 0);
  const miscTotal = custom.reduce((s: number, x: any) => s + x.total, 0);
  const grand = staffTotal + jazz.total + expense.total + miscTotal;

  const known = new Set(["jazzcash", "expense", "petty", ...defs.map((d: any) => d.type)]);
  const orphan = led.entries.filter((e: any) => e && !known.has(e.ledgerType)).length;
  if (orphan) led.warnings.push(`${orphan} ledger entries belong to an unknown section and are not shown.`);

  return {
    generatedAt: new Date().toISOString(), today: pkDate(new Date()), month, months, credit, work, jazz, expense, custom,
    check: { staff: staffTotal, jazz: jazz.total, expense: expense.total, misc: miscTotal, grand },
    meta: { version: VERSION, source: led.source, ledgerEntries: led.entries.length, staleRows: led.stale, sheets: sheets.count || 0, staff: staff.count || 0, warnings: led.warnings },
  };
}

// ───────────────────────── HTML ─────────────────────────
const money = (v: number) => (v < 0 ? "−" : "") + "₨" + Math.abs(Math.round(v)).toLocaleString("en-PK");
function renderHtml(D: any) {
  const json = JSON.stringify(D).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const c = D.check;
  const fallback = [["Staff Credit", c.staff], ["Jazz Cash", c.jazz], ["Patty / Expenses", c.expense], ["Misc Sections", c.misc], ["Total Outstanding Credits", c.grand]]
    .map((x) => `<div class="kpi"><small>${esc(x[0])}</small><strong>${money(Number(x[1]))}</strong></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>BT Sale Data · Manager Dashboard · ${esc(D.today)}</title><style>${CSS}</style></head><body>
<header class="hero"><h1>📊 Manager Dashboard</h1><p>Staff Credit · Jazz Cash · Patty/Expenses · Misc sections · Working Summary — archive of ${esc(D.today)}</p></header>
<div class="bar"><select id="month" aria-label="Staff credit month"></select><input id="q" type="search" placeholder="Search staff…" aria-label="Search staff"><button class="btn" data-act="expand">Expand</button><button class="btn" data-act="collapse">Collapse</button><button class="btn" data-act="theme">Theme</button><button class="btn" data-act="print">Print</button><button class="btn primary" data-act="csv">Export CSV</button></div>
<main><noscript>JavaScript is needed for the interactive view. Static totals:</noscript><div id="kpis" class="kpis">${fallback}</div><div id="band"></div>
<h3 class="sec">Credit details</h3><div id="grid" class="grid"></div>
<h3 class="sec">Misc sections (all-time)</h3><div id="misc" class="misc-grid"></div>
<div id="work"></div><div id="foot"></div></main>
<script type="application/json" id="data">${json}</script><script>${CLIENT_JS}</script></body></html>`;
}

// ───────────────────────── handler ─────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  let filename = "";
  try {
    const b = await req.json().catch(() => ({}));
    if (typeof b.autoKey !== "string" || !b.autoKey) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { data: drive, error: de } = await db.from("google_drive_backup").select("refresh_token,access_token,access_token_expires_at,auto_key").eq("id", 1).maybeSingle();
    if (de || !drive?.refresh_token || !drive.auto_key || !safeEq(b.autoKey, drive.auto_key)) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const D = await buildData();
    const counts = { sections: Object.keys(D.credit).length, ledger: D.meta.ledgerEntries, staleIgnored: D.meta.staleRows, sheets: D.meta.sheets, staff: D.meta.staff, totals: D.check, month: D.month, version: VERSION };
    if (b.dryRun === true) return Response.json({ ok: true, dryRun: true, counts, warnings: D.meta.warnings });

    const html = renderHtml(D);
    filename = "manager-dashboard-" + D.today + ".html";
    const tk = await accessToken(drive);
    const folderId = await ensureFolder(tk);
    const up = await uploadHtml(tk, folderId, filename, html);
    const { error: logErr } = await db.from("manager_dashboard_archive_runs").insert({ file_name: filename, drive_file_id: up.id, generated_at: D.generatedAt, status: "success", record_counts: { ...counts, viewLink: up.link, bytes: html.length, replaced: up.replaced } });
    if (logErr) console.error("archive audit insert failed", logErr.message);
    return Response.json({ ok: true, fileName: filename, fileId: up.id, link: up.link, replaced: up.replaced, folder: FOLDER_NAME, bytes: html.length, counts, warnings: D.meta.warnings });
  } catch (e) {
    console.error(e);
    const msg = String((e as Error)?.message || e);
    try { await db.from("manager_dashboard_archive_runs").insert({ file_name: filename || "manager-dashboard-" + pkDate(new Date()) + ".html", drive_file_id: "", status: "failed", record_counts: { error: msg, version: VERSION } }); } catch (_) { /* best effort */ }
    return Response.json({ error: msg }, { status: 500 });
  }
});
