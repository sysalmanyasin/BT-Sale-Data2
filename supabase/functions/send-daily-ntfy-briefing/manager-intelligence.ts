// Extension of the EXISTING ntfy briefing. No new scheduler or notification service.
type Rest = (path: string) => Promise<any>;
const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;

export async function managerIntelligence(rest: Rest, auditRest: Rest) {
  const alerts: string[] = [], blocks: string[] = [], facts: any = {};
  try {
    const products = await auditRest('inventory_products?select=code,name,qty,price,net_qty_30_days,last_sale_date&qty=lte.0&net_qty_30_days=gt.0&limit=1000');
    const ranked = (products || []).map((p: any) => ({ name: p.name, code: p.code || null, qty: n(p.qty), sold_30d: n(p.net_qty_30_days), unit_price: n(p.price), estimated_lost_sales_7d: Math.round((n(p.net_qty_30_days) / 30) * n(p.price) * 7) })).sort((a: any,b: any) => b.estimated_lost_sales_7d-a.estimated_lost_sales_7d).slice(0,10);
    facts.money_ranked_inventory = ranked;
    if (ranked.length) {
      const total = ranked.reduce((s: number,x: any)=>s+x.estimated_lost_sales_7d,0);
      blocks.push('## 💸 Money at risk · stockouts\n' + ranked.map((x: any,i: number)=>`- ${i+1}. ${x.name}: ~Rs ${x.estimated_lost_sales_7d.toLocaleString('en-PK')} lost sales / 7d`).join('\n'));
      if (total >= 10000) alerts.push(`Stockouts expose about Rs ${Math.round(total).toLocaleString('en-PK')} of estimated 7-day sales`);
    }
  } catch (_) { blocks.push('## 💸 Money at risk · stockouts\n> Inventory ranking unavailable'); }

  try {
    const lines = await auditRest('str_line_items?select=*&limit=3000');
    const received = (x:any) => n(x.receive_qty ?? x.received_qty ?? x.received_quantity ?? x.recv_qty ?? x.received);
    const dispatched = (x:any) => x.dispatch_qty == null ? n(x.str_qty ?? x.requested_qty) : n(x.dispatch_qty);
    const mismatches = (lines || []).map((x:any)=>({str_id:x.str_id,dispatched:dispatched(x),received:received(x),difference:dispatched(x)-received(x),value_at_cost:Math.abs(dispatched(x)-received(x))*n(x.cost_price)})).filter((x:any)=>x.difference!==0).sort((a:any,b:any)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,20);
    facts.str_mismatches = mismatches;
    if (mismatches.length) { alerts.push(`${mismatches.length} STR line(s) have dispatched vs received quantity differences`); blocks.push('## 🚚 STR mismatch\n' + mismatches.slice(0,10).map((x:any)=>`- STR ${x.str_id}: dispatched ${x.dispatched}, received ${x.received}, difference ${x.difference}`).join('\n')); }
  } catch (_) {}

  try {
    const daily = await rest('bt_daily?select=date,data,updated_at&order=updated_at.desc&limit=1');
    const d = daily?.[0], x = d?.data || {};
    const sale=n(x['TOTAL']), cash=n(x['Cash Sale']), diff=n(x['DIFF']), deposit=n(x['Cash to be Deposited']);
    const depositGap=deposit-cash;
    const jc=await rest('bt_jazzcash_tally_snapshots?select=date,data,updated_at&order=updated_at.desc&limit=1').catch(()=>[]);
    const jd=jc?.[0]?.data||{}; const ledger=n(jd.ledger_balance??jd.ledger??jd.balance), app=n(jd.app_balance??jd.app??jd.wallet_balance); const jcGap=(app||ledger)?app-ledger:null;
    const led=await rest('bt_ledger_entries?select=data,updated_at&order=updated_at.desc&limit=1000').catch(()=>[]);
    const aged=(led||[]).map((r:any)=>r.data||{}).filter((e:any)=>/cheque|check/i.test(`${e.desc||''} ${e.categoryId||''}`)).map((e:any)=>({...e,age_days:e.date?Math.floor((Date.now()-new Date(String(e.date)+'T00:00:00Z').getTime())/86400000):null})).filter((e:any)=>e.age_days!=null&&e.age_days>=30).sort((a:any,b:any)=>b.age_days-a.age_days).slice(0,8);
    facts.cash={date:d?.date||null,updated_at:d?.updated_at||null,sale,cash,diff,deposit,deposit_gap:depositGap,jazzcash_ledger:ledger,jazzcash_app:app,jazzcash_gap:jcGap,aged_cheques:aged};
    blocks.push(`## 💵 Cash reconciliation\n- Sale Rs ${Math.round(sale).toLocaleString('en-PK')} · Cash Rs ${Math.round(cash).toLocaleString('en-PK')} · DIFF Rs ${Math.round(diff).toLocaleString('en-PK')}\n- Cash-to-deposit gap Rs ${Math.round(depositGap).toLocaleString('en-PK')}${jcGap==null?'':`\n- JazzCash app vs ledger gap Rs ${Math.round(jcGap).toLocaleString('en-PK')}`}\n- Cheques 30+ days: ${aged.length}`);
    if(Math.abs(diff)>=10000) alerts.push(`Cash DIFF Rs ${Math.round(diff).toLocaleString('en-PK')}`);
    if(Math.abs(depositGap)>=1000) alerts.push(`Cash-to-deposit gap Rs ${Math.round(depositGap).toLocaleString('en-PK')}`);
    if(jcGap!=null&&Math.abs(jcGap)>=1000) alerts.push(`JazzCash app vs ledger gap Rs ${Math.round(jcGap).toLocaleString('en-PK')}`);
    if(aged.length) alerts.push(`${aged.length} cheque-related ledger entries are 30+ days old`);
  } catch (_) { blocks.push('## 💵 Cash reconciliation\n> Reconciliation data unavailable'); }

  try {
    const rows=await rest('bt_daily?select=date,data,updated_at&order=updated_at.desc&limit=30');
    const vals=(rows||[]).map((r:any)=>({date:r.date,sale:n((r.data||{})['TOTAL']),diff:n((r.data||{})['DIFF'])})).reverse();
    const calc=(days:number)=>{const a=vals.slice(-days);return{days,sales_per_day:Math.round(a.reduce((s:number,r:any)=>s+r.sale,0)/Math.max(1,a.length)),avg_abs_diff:Math.round(a.reduce((s:number,r:any)=>s+Math.abs(r.diff),0)/Math.max(1,a.length))};};
    facts.trends={seven_day:calc(7),thirty_day:calc(30),as_of:rows?.[0]?.updated_at||null};
    blocks.push(`## 📈 Trends\n- 7d sales/day: Rs ${facts.trends.seven_day.sales_per_day.toLocaleString('en-PK')} · avg abs DIFF Rs ${facts.trends.seven_day.avg_abs_diff.toLocaleString('en-PK')}\n- 30d sales/day: Rs ${facts.trends.thirty_day.sales_per_day.toLocaleString('en-PK')} · avg abs DIFF Rs ${facts.trends.thirty_day.avg_abs_diff.toLocaleString('en-PK')}`);
  } catch (_) {}
  return { blocks, alerts, facts, as_of: new Date().toISOString() };
}