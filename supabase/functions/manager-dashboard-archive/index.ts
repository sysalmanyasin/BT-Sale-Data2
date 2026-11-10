import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const esc=(v:any)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const num=(v:any)=>Math.round(Number(v)||0);
const fmt=(v:any)=> (num(v)<0?"−":"")+"₨"+Math.abs(num(v)).toLocaleString("en-PK");
const datePK=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
async function token(row:any){
 const exp=row.access_token_expires_at?Date.parse(row.access_token_expires_at):0;
 if(row.access_token&&exp-Date.now()>60000)return row.access_token;
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:Deno.env.get("GOOGLE_CLIENT_ID")!,client_secret:Deno.env.get("GOOGLE_CLIENT_SECRET")!,refresh_token:row.refresh_token,grant_type:"refresh_token"})});
 const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.error||"Google token refresh failed");
 await db.from("google_drive_backup").update({access_token:j.access_token,access_token_expires_at:new Date(Date.now()+j.expires_in*1000).toISOString()}).eq("id",1);return j.access_token;
}
async function folder(t:string){
 const q=encodeURIComponent("name='Manager Dashboard Archives' and mimeType='application/vnd.google-apps.folder' and trashed=false");
 const r=await fetch("https://www.googleapis.com/drive/v3/files?q="+q+"&fields=files(id)&pageSize=100",{headers:{Authorization:"Bearer "+t}});
 const j=await r.json();if(!r.ok)throw new Error("Drive folder lookup failed");if(j.files?.length)return j.files[0].id;
 const c=await fetch("https://www.googleapis.com/drive/v3/files",{method:"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},body:JSON.stringify({name:"Manager Dashboard Archives",mimeType:"application/vnd.google-apps.folder"})});
 const f=await c.json();if(!c.ok)throw new Error("Drive folder creation failed");return f.id;
}
async function upload(t:string,f:string,name:string,html:string){
 const q=encodeURIComponent("name='"+name+"' and '"+f+"' in parents and trashed=false");
 const l=await fetch("https://www.googleapis.com/drive/v3/files?q="+q+"&fields=files(id)",{headers:{Authorization:"Bearer "+t}});
 const j=await l.json();if(!l.ok)throw new Error("Drive file lookup failed");const old=j.files?.[0]?.id;
 const b="btDashboardHtml";const meta=JSON.stringify({name,mimeType:"text/html",parents:old?undefined:[f]});
 const body=new Blob(["--"+b+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+"\r\n--"+b+"\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n",html,"\r\n--"+b+"--"],{type:"multipart/related; boundary="+b});
 const url=old?"https://www.googleapis.com/upload/drive/v3/files/"+old+"?uploadType=multipart":"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
 const r=await fetch(url,{method:old?"PATCH":"POST",headers:{Authorization:"Bearer "+t,"Content-Type":"multipart/related; boundary="+b},body});const saved=await r.json();if(!r.ok)throw new Error("Drive upload failed: "+(saved.error?.message||r.status));return saved.id;
}
function html(D:any){
 const esc=(v:any)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
 const money=(v:any)=>{const n=Math.round(Number(v)||0);return (n<0?"−":"")+"₨"+Math.abs(n).toLocaleString("en-PK")};
 const section=(title:string,total:number,rows:any[])=>'<article class="card"><h2>'+esc(title)+' <b>'+money(total)+'</b></h2>'+(rows.length?rows.map(r=>'<details><summary><span>'+esc(r.label)+'</span><strong>'+money(r.value)+'</strong></summary>'+(r.children?.length?'<div class="sub">'+r.children.map((x:any)=>'<div class="line"><span>'+esc(x.label)+'</span><span>'+money(x.value)+'</span></div>').join("")+'</div>':'')+'</details>').join(""):'<p class="muted">No activity recorded</p>')+'</article>';
 const M:Record<string,any>={};(D.manager||[]).forEach((x:any)=>(M[x.section]??={})[x.month]=x.data);
 const months=Object.keys(M.credit||{}).sort((x,y)=>Date.parse("1 "+y)-Date.parse("1 "+x));
 const month=months.includes(D.month)?D.month:(months[0]||D.month||"");
 const creditRows=Array.isArray(M.credit?.[month])?M.credit[month]:[];
 const staff=creditRows.map((e:any)=>{const entries=Array.isArray(e.entries)?e.entries:[];const prev=Number(e.prevBal)||0,salary=Number(e.salary)||0,less=Number(e.lessGeneric)||0;const net=prev+entries.reduce((s:number,x:any)=>s+(Number(x.amount)||0),0)-salary-less;return {name:e.name||"Staff",net,rows:[{label:"Previous balance",value:prev},...entries.map((x:any)=>({label:(x.date||"")+" · "+(x.desc||"Credit entry"),value:Number(x.amount)||0})),{label:"Salary deduction",value:-salary},{label:"Less Generic",value:-less}]};});
 const staffTotal=staff.reduce((s:number,x:any)=>s+x.net,0);
 const L=Array.isArray(D.ledger)?D.ledger:[];
 const types=Array.isArray(D.types)?D.types:[];
 const signFor=(type:string,id:string)=>{const def=types.find((x:any)=>x.type===type)?.data||{};const c=(def.categories||[]).find((x:any)=>x.id===id);if(c&&Number(c.sign)!==0)return Number(c.sign);const defaults:any={jazzcash:{credit:1,debit:-1,withdrawal:-1,commission:-1,transfer:-1},expense:{bill:1,fuel:1,soap:1,refresh:1,extra:1,guardIncentive:1,pattyHO:-1}};return defaults[type]?.[id]??1;};
 const grouped=(type:string)=>{const rows=L.filter((x:any)=>x.ledgerType===type).map((x:any)=>({label:(x.date||"")+" · "+(x.desc||x.groupLabel||x.categoryId||x.shift||"Entry"),value:(Number(x.amount)||0)*signFor(type,x.categoryId)}));return {rows,total:rows.reduce((s:number,x:any)=>s+x.value,0)};};
 const jazz=grouped("jazzcash"),expense=grouped("expense");
 const custom=types.map((t:any)=>{const cats=t.data?.categories||[];const rows=cats.map((c:any)=>{const items=L.filter((x:any)=>x.ledgerType===t.type&&x.categoryId===c.id);const sign=Number(c.sign)||1;return {label:c.label||c.id,value:items.reduce((s:number,x:any)=>s+(Number(x.amount)||0)*sign,0),children:items.map((x:any)=>({label:(x.date||"")+" · "+(x.desc||x.shift||"Entry"),value:(Number(x.amount)||0)*sign}))};});return {title:t.data?.label||t.type,rows,total:rows.reduce((s:number,x:any)=>s+x.value,0)};});
 const customTotal=custom.reduce((s:number,x:any)=>s+x.total,0),grand=staffTotal+jazz.total+expense.total+customTotal;
 const salary=Array.isArray(M.salary?.[month])?M.salary[month]:[];
 const generic=Array.isArray(M.generic?.[month])?M.generic[month]:[];
 const salaryTotal=salary.reduce((s:number,r:any)=>s+(Number(r.hoSal)||0)-(Number(r.advance)||0)+(Number(r.generic)||0)+(Array.isArray(r.extras)?r.extras.reduce((z:number,e:any)=>z+(e.sign==="-"?-1:1)*(Number(e.amount)||0),0):0),0);
 const genericTotal=generic.reduce((s:number,r:any)=>s+Math.round((Number(r.genericSale)||0)*.04)+(Number(r.extra)||0),0);
 const monthIndex=["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(month.split(" ")[0]);
 const ym=month.split(" ")[1]+"-"+String(monthIndex+1).padStart(2,"0");
 const expenseSigns:any={bill:1,fuel:1,soap:1,refresh:1,extra:1,guardIncentive:1,pattyHO:-1};
 const pettyRows=L.filter((x:any)=>x.ledgerType==="expense"&&String(x.date||"").startsWith(ym));
 const pettyTotal=pettyRows.reduce((s:number,x:any)=>s+(Number(x.amount)||0)*(expenseSigns[x.categoryId]??1),0);
 const incentive=(D.incentives||[]).find((x:any)=>x.key==="mw_incentive_"+month)?.data||{};
 let incentiveTotal=incentive.netInc;
 if(incentiveTotal==null)incentiveTotal=Math.round((Number(incentive.saleVal)||0)*.005)-(Number(incentive.pilferage)||0)-(Number(incentive.tillShort)||0)+(Number(incentive.cashTarget)||0)+Math.round((Number(incentive.genSale)||0)*.045)-(Number(incentive.excessFine)||0)-(Number(incentive.plusFine)||0)-(Number(incentive.paperFine)||0)-(Number(incentive.panelFine)||0);
 const work=[["Salary",salaryTotal],["Generic",genericTotal],["Patty Detail",pettyTotal],["Incentives",Number(incentiveTotal)||0]];
 const workRows=work.map(x=>'<div class="kpi"><small>'+esc(x[0])+'</small><strong>'+money(x[1])+'</strong></div>').join("");
 const creditCard=section("Staff Credit · "+month,staffTotal,staff.map((x:any)=>({label:x.name+" · outstanding",value:x.net,children:x.rows})));
 const jazzCard=section("Jazz Cash · all-time",jazz.total,jazz.rows);
 const expenseCard=section("Patty / Expenses · all-time",expense.total,expense.rows);
 const miscCards=custom.map((x:any)=>section(x.title,x.total,x.rows)).join("");
 const generated=new Date(D.generatedAt).toLocaleString("en-PK",{timeZone:"Asia/Karachi"});
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BT Sale Data · Manager Dashboard</title><style>'+
 ':root{--ink:#142033;--muted:#64748b;--line:#dce5ee;--green:#087f5b;--red:#c2413b}*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:var(--ink);font:14px/1.5 system-ui,Arial}header{background:linear-gradient(110deg,#101c30,#075b76);color:white;padding:24px}header h1{margin:0 0 6px;font-size:25px}main{max-width:1200px;margin:auto;padding:20px}.meta{color:var(--muted);margin:0 0 15px}.kpis,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.kpi,.card{background:white;border:1px solid var(--line);border-radius:13px;padding:15px;box-shadow:0 3px 12px #172b4408}.kpi small{display:block;color:var(--muted)}.kpi strong{font-size:21px}.card h2{font-size:16px;margin:0 0 10px;display:flex;justify-content:space-between;gap:8px}.card h2 b{white-space:nowrap}.grid{margin-top:14px}.wide{margin-top:14px}.muted{color:var(--muted)}details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer;display:flex;justify-content:space-between;gap:8px;font-weight:600}summary strong{white-space:nowrap}.sub{padding:5px 0 0 12px}.line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #e8edf2}.line span:last-child{white-space:nowrap}.pos{color:var(--green)}.neg{color:var(--red)}@media print{body{background:white}.card,.kpi{box-shadow:none;break-inside:avoid}details:not([open]) .sub{display:block}header{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header><h1>BT Sale Data · Manager Dashboard</h1><div>Staff Credit · Jazz Cash · Patty / Expenses · Miscellaneous · Working Summary</div></header><main><p class="meta">Generated '+esc(generated)+' · Staff Credit: '+esc(month)+'</p><section class="kpis">'+[["Staff Credit",staffTotal],["Jazz Cash",jazz.total],["Patty / Expenses",expense.total],["Miscellaneous",customTotal],["Total Outstanding Credits",grand]].map(x=>'<div class="kpi"><small>'+esc(x[0])+'</small><strong>'+money(x[1])+'</strong></div>').join("")+'</section><section class="grid">'+creditCard+jazzCard+expenseCard+miscCards+'</section><section class="card wide"><h2>Working Summary</h2><div class="kpis">'+workRows+'</div>'+section("Salary details",salaryTotal,salary.map((x:any)=>({label:x.name||"Staff",value:(Number(x.hoSal)||0)-(Number(x.advance)||0)+(Number(x.generic)||0)})))+section("Generic details",genericTotal,generic.map((x:any)=>({label:x.name||"Staff",value:Math.round((Number(x.genericSale)||0)*.04)+(Number(x.extra)||0)})))+'</section><section class="card wide"><h2>Archive inventory</h2><div class="line"><span>Manager sections</span><b>'+Object.keys(M).length+'</b></div><div class="line"><span>Shift sheets</span><b>'+Number(D.sheetCount||0)+'</b></div><div class="line"><span>Ledger entries</span><b>'+L.length+'</b></div><div class="line"><span>Custom sections</span><b>'+types.length+'</b></div><div class="line"><span>Staff registry</span><b>'+Number(D.staffCount||0)+'</b></div></section></main></body></html>';
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok");
 try{
  const b=await req.json().catch(()=>({}));if(typeof b.autoKey!=="string"||!b.autoKey)return Response.json({error:"Unauthorized"},{status:401});
  const {data:drive,error:de}=await db.from("google_drive_backup").select("refresh_token,access_token,access_token_expires_at,auto_key").eq("id",1).maybeSingle();
  if(de||!drive?.refresh_token||!drive.auto_key||b.autoKey!==drive.auto_key)return Response.json({error:"Unauthorized"},{status:401});
  async function allLedgerRows(){const out:any[]=[];for(let offset=0;offset<50000;offset+=1000){const page=await db.from("bt_ledger_entries").select("id,data").range(offset,offset+999);if(page.error)throw page.error;out.push(...(page.data||[]));if((page.data||[]).length<1000)break;}return out;}
  const [m,l,t,s,st,inc]=await Promise.all([db.from("bt_manager").select("section,month,data"),allLedgerRows(),db.from("bt_ledger_custom_types").select("type,data"),db.from("sheets").select("key").eq("draft",false),db.from("bt_staff").select("id"),db.from("bt_incentives").select("key,data")]);
  for(const x of [m,t,s,st,inc])if(x.error)throw x.error;
  const months=(m.data||[]).filter(x=>x.section==="credit").map(x=>x.month);const now=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"Asia/Karachi"}).format(new Date());const month=months.includes(now)?now:months.sort((a,b)=>Date.parse("1 "+b)-Date.parse("1 "+a))[0]||now;
  const data={generatedAt:new Date().toISOString(),month,manager:m.data||[],ledger:l.map(x=>x.data),types:t.data||[],incentives:inc.data||[],sheetCount:(s.data||[]).length,staffCount:(st.data||[]).length};
  const htmlDoc=html(data);const tk=await token(drive);const folderId=await folder(tk);const filename="manager-dashboard-"+datePK(new Date())+".html";const fileId=await upload(tk,folderId,filename,htmlDoc);
  const {error:logErr}=await db.from("manager_dashboard_archive_runs").insert({file_name:filename,drive_file_id:fileId,generated_at:new Date().toISOString(),status:"success",record_counts:{manager:data.manager.length,ledger:data.ledger.length,sheets:data.sheetCount,staff:data.staffCount}});
  if(logErr)console.error("archive audit insert failed",logErr.message);
  return Response.json({ok:true,fileName:filename,fileId,folder:"Manager Dashboard Archives",counts:{manager:data.manager.length,ledger:data.ledger.length,sheets:data.sheetCount,staff:data.staffCount}});
 }catch(e){console.error(e);return Response.json({error:String((e as Error)?.message||e)},{status:500})}
});