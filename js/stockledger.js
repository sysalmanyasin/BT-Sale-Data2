window.StockLedgerApp = (function(){
  "use strict";
  let initialized = false;

  function init(options){
    if(initialized){ console.warn('StockLedgerApp.init() called again — skipping (already initialized).'); return; }
    if(!document.getElementById('page-stockledger')){
      console.error('StockLedgerApp.init(): #page-stockledger not found in the DOM yet.');
      return;
    }
    initialized = true;
    options = options || {};

      const sbConfig = {
        client: options.supabaseClient || window.supabaseClient || null,
        table: options.table || 'inventory',
        autoLoad: options.autoLoad !== false
      };

      const state = {
        raw: [],
        today: new Date(),
        neverSoldDays: 90,
        deadDays: 60,
        sort: {
          neverSold:{key:'value',dir:-1},
          deadStock:{key:'value',dir:-1},
          excess:{key:'excessValue',dir:-1},
          packIssues:{key:'stockValue',dir:-1},
          zeroStock:{key:'recDays',dir:-1}
        },
        search: { neverSold:'', deadStock:'', excess:'', packIssues:'', zeroStock:'' }
      };
    
      const $ = (sel,ctx)=> (ctx||document).querySelector(sel);
      const $$ = (sel,ctx)=> Array.from((ctx||document).querySelectorAll(sel));
    
      function esc(s){
        return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      }
      function fmtMoney(n){
        if(n==null||isNaN(n)) return '—';
        return 'Rs ' + Math.round(n).toLocaleString('en-PK');
      }
      function fmtNum(n){
        if(n==null||isNaN(n)) return '—';
        return Number(n).toLocaleString('en-PK');
      }
      function fmtDate(str){
        if(!str) return '—';
        const d = parseDate(str);
        if(!d) return '—';
        return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      }
      function parseDate(str){
        if(!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
      }
      function daysSince(str){
        const d = parseDate(str);
        if(!d) return null;
        return Math.floor((state.today - d) / 86400000);
      }
      function downRound(stock, pack){
        const p = (pack && pack > 0) ? pack : 1;
        const packs = Math.floor(stock / p);
        return { packs, qty: packs * p, loose: stock - (packs * p) };
      }
      function isPackValid(raw){
        const n = Number(raw);
        return raw !== '' && raw != null && Number.isFinite(n) && n > 0;
      }
    
      // ---------- File loading ----------
      const dropzone = $('#sl-dropzone');
      const fileInput = $('#sl-fileInput');
      const browseBtn = $('#sl-browseBtn');
      const loadErr = $('#sl-loadErr');
    
      browseBtn.addEventListener('click', ()=> fileInput.click());
      fileInput.addEventListener('change', e=>{
        if(e.target.files[0]) handleFile(e.target.files[0]);
      });
      ['dragenter','dragover'].forEach(ev=>{
        dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.add('drag'); });
      });
      ['dragleave','drop'].forEach(ev=>{
        dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); });
      });
      dropzone.addEventListener('drop', e=>{
        const f = e.dataTransfer.files[0];
        if(f) handleFile(f);
      });
    
      function loadRawArray(data, label){
        loadErr.style.display='none';
        try{
          if(!Array.isArray(data)) throw new Error('Expected an array of stock items.');
          state.raw = data;
          $('#sl-filename').textContent = label + ' · ' + data.length.toLocaleString() + ' SKUs';
          render();
          return true;
        }catch(err){
          loadErr.textContent = 'Could not load data: ' + err.message;
          loadErr.style.display='block';
          return false;
        }
      }

      function loadRawJSON(text, label){
        loadErr.style.display='none';
        try{
          const data = JSON.parse(text);
          return loadRawArray(data, label);
        }catch(err){
          loadErr.textContent = 'Could not read file: ' + err.message;
          loadErr.style.display='block';
          return false;
        }
      }
    
      function handleFile(file){
        loadErr.style.display='none';
        const reader = new FileReader();
        reader.onload = evt=> loadRawJSON(evt.target.result, file.name);
        reader.onerror = ()=>{
          loadErr.textContent = 'Could not read file.';
          loadErr.style.display='block';
        };
        reader.readAsText(file);
      }
    
      // ---------- Computation ----------
      function computeAll(){
        const items = state.raw;
        const neverSold = [];
        const deadStock = [];
        const excess = [];
        const packIssues = [];
        const zeroStock = [];
    
        items.forEach((it, i)=>{
          const _row = i + 2; // matching Data-sheet row (1 header row) used by the XLSX export
          const stock = Number(it.stock)||0;
          const unitPrice = Number(it.unitPrice)||0;
          const recDays = daysSince(it.lastReceiveDate);
          const saleDays = daysSince(it.lastSaleDate);
          const hasSale = !!it.lastSaleDate;
          const net100 = Number(it.netQty100Days)||0;
    
          // Zero stock: nothing to value, pulled out entirely, reference only.
          if(stock === 0){
            zeroStock.push({ ...it, unitPrice, recDays, saleDays, net100, _row });
            return;
          }
    
          const packValid = isPackValid(it.conversionFactor);
          const pack = packValid ? Number(it.conversionFactor) : null;
    
          if(!packValid){
            // Pack size unreliable: can't down-round, so keep out of Never Sold / Dead Stock.
            // Still eligible for Excess below, since that calc doesn't use pack size.
            packIssues.push({
              ...it, stock, unitPrice, recDays, saleDays, net100, _row,
              stockValue: stock * unitPrice
            });
          } else {
            // 1. Never sold: no sale record at all, received > selected window ago
            if(!hasSale && recDays!=null && recDays > state.neverSoldDays){
              const dr = downRound(stock, pack);
              if(dr.qty > 0){
                neverSold.push({
                  ...it, stock, pack, unitPrice, _row,
                  recDays, packs:dr.packs, roundedQty:dr.qty, loose:dr.loose,
                  value: dr.qty * unitPrice
                });
              }
            }
    
            // 2. Dead stock: HAS a sale history, but not within the window, AND received
            // more than that same window ago. Requiring hasSale keeps this mutually
            // exclusive with Never Sold — no overlap.
            const win = state.deadDays;
            if(hasSale && saleDays!=null && saleDays > win && recDays!=null && recDays > win){
              const dr = downRound(stock, pack);
              if(dr.qty > 0){
                deadStock.push({
                  ...it, stock, pack, unitPrice, _row,
                  recDays, saleDays, packs:dr.packs, roundedQty:dr.qty, loose:dr.loose,
                  value: dr.qty * unitPrice
                });
              }
            }
          }
    
          // 3. 100-day excess: netQty100Days is actually a 90-day net sold quantity
          // (confirmed from the source SQL: DATEADD(DAY,-90,...)). Scale it to a
          // 100-day target stock level, then flag stock held beyond that target.
          // No pack rounding applied. Only items with an inventory (stock) unit
          // quantity of 4 or more are eligible — smaller-quantity stock is skipped.
          const dailyRate = net100 / 90;
          const target100 = dailyRate * 100;
          const excessQty = stock - target100;
          if(net100 > 0 && excessQty > 0 && stock >= 4){
            excess.push({
              ...it, stock, unitPrice, net100, target100, _row,
              excessQty, excessValue: excessQty * unitPrice
            });
          }
        });
    
        return { neverSold, deadStock, excess, packIssues, zeroStock };
      }
    
      // ---------- Rendering ----------
      const TABLE_DEFS = {
        neverSold: {
          cols:[
            {key:'code', label:'Code'},
            {key:'name', label:'Item', cls:'name-cell'},
            {key:'company', label:'Company'},
            {key:'stock', label:'Stock', num:true},
            {key:'pack', label:'Pack', num:true},
            {key:'roundedQty', label:'Down-rnd Qty', num:true},
            {key:'unitPrice', label:'Unit Price', num:true, money:true},
            {key:'value', label:'Value', num:true, money:true, strong:true},
            {key:'lastReceiveDate', label:'Received', date:true},
            {key:'recDays', label:'Days Rcvd', num:true},
          ],
          sub:(it)=> it.generic || it.supplier || ''
        },
        deadStock: {
          cols:[
            {key:'code', label:'Code'},
            {key:'name', label:'Item', cls:'name-cell'},
            {key:'company', label:'Company'},
            {key:'stock', label:'Stock', num:true},
            {key:'pack', label:'Pack', num:true},
            {key:'roundedQty', label:'Down-rnd Qty', num:true},
            {key:'unitPrice', label:'Unit Price', num:true, money:true},
            {key:'value', label:'Value', num:true, money:true, strong:true},
            {key:'lastSaleDate', label:'Last Sale', date:true},
            {key:'saleDays', label:'Days Since Sale', num:true},
            {key:'lastReceiveDate', label:'Received', date:true},
            {key:'recDays', label:'Days Rcvd', num:true},
          ],
          sub:(it)=> it.generic || it.supplier || ''
        },
        excess: {
          cols:[
            {key:'code', label:'Code'},
            {key:'name', label:'Item', cls:'name-cell'},
            {key:'company', label:'Company'},
            {key:'stock', label:'Stock', num:true},
            {key:'net100', label:'Sold /90d', num:true},
            {key:'target100', label:'Target 100d Stock', num:true},
            {key:'excessQty', label:'Excess Qty', num:true},
            {key:'unitPrice', label:'Unit Price', num:true, money:true},
            {key:'excessValue', label:'Excess Value', num:true, money:true, strong:true},
          ],
          sub:(it)=> it.generic || it.supplier || ''
        },
        packIssues: {
          cols:[
            {key:'code', label:'Code'},
            {key:'name', label:'Item', cls:'name-cell'},
            {key:'company', label:'Company'},
            {key:'conversionFactor', label:'Pack Size (raw)'},
            {key:'stock', label:'Stock', num:true},
            {key:'unitPrice', label:'Unit Price', num:true, money:true},
            {key:'stockValue', label:'Stock Value', num:true, money:true, strong:true},
            {key:'lastReceiveDate', label:'Received', date:true},
            {key:'lastSaleDate', label:'Last Sale', date:true},
            {key:'net100', label:'Sold /90d', num:true},
          ],
          sub:(it)=> it.generic || it.supplier || ''
        },
        zeroStock: {
          cols:[
            {key:'code', label:'Code'},
            {key:'name', label:'Item', cls:'name-cell'},
            {key:'company', label:'Company'},
            {key:'conversionFactor', label:'Pack Size'},
            {key:'unitPrice', label:'Unit Price', num:true, money:true},
            {key:'lastReceiveDate', label:'Received', date:true},
            {key:'recDays', label:'Days Rcvd', num:true},
            {key:'lastSaleDate', label:'Last Sale', date:true},
            {key:'saleDays', label:'Days Since Sale', num:true},
            {key:'net100', label:'Sold /90d', num:true},
          ],
          sub:(it)=> it.generic || it.supplier || ''
        }
      };
    
      let computed = { neverSold:[], deadStock:[], excess:[], packIssues:[], zeroStock:[] };
    
      function applyFilterSort(panelKey){
        const def = TABLE_DEFS[panelKey];
        let rows = computed[panelKey].slice();
        const q = state.search[panelKey].trim().toLowerCase();
        if(q){
          rows = rows.filter(it=>{
            return ['code','name','generic','company','supplier'].some(f=>
              String(it[f]||'').toLowerCase().includes(q)
            );
          });
        }
        const s = state.sort[panelKey];
        rows.sort((a,b)=>{
          let av=a[s.key], bv=b[s.key];
          if(typeof av==='string' || typeof bv==='string'){
            av = String(av||''); bv=String(bv||'');
            return av.localeCompare(bv) * s.dir;
          }
          av = Number(av)||0; bv = Number(bv)||0;
          return (av-bv) * s.dir;
        });
        return rows;
      }
    
      function renderTable(panelKey){
        const def = TABLE_DEFS[panelKey];
        const rows = applyFilterSort(panelKey);
        const table = $('#sl-table-'+panelKey);
        const s = state.sort[panelKey];
    
        let thead = '<thead><tr>' + def.cols.map(c=>{
          const arrow = s.key===c.key ? (s.dir===1?'▲':'▼') : '';
          return `<th class="${c.num?'num':''}" data-key="${c.key}" data-panel="${panelKey}">${esc(c.label)}<span class="arrow">${arrow}</span></th>`;
        }).join('') + '</tr></thead>';
    
        let body;
        if(rows.length===0){
          body = `<tbody><tr><td colspan="${def.cols.length}"><div class="noresults">No items match this view.</div></td></tr></tbody>`;
        }else{
          body = '<tbody>' + rows.map(it=>{
            return '<tr>' + def.cols.map(c=>{
              let v = it[c.key];
              let content;
              if(c.date) content = esc(fmtDate(v));
              else if(c.money) content = esc(fmtMoney(v));
              else if(c.num) content = esc(fmtNum(v));
              else content = esc(v);
              if(c.key==='name'){
                content = `${esc(v)}<div class="sub">${esc(def.sub(it))}</div>`;
              }
              const cls = (c.num?'num ':'') + (c.strong?'val ':'') + (c.cls||'');
              return `<td class="${cls.trim()}">${content}</td>`;
            }).join('') + '</tr>';
          }).join('') + '</tbody>';
        }
    
        const totalIdx = def.cols.findIndex(c=>c.strong);
        const valueCol = totalIdx>=0 ? def.cols[totalIdx].key : null;
        const totalValue = valueCol ? rows.reduce((sum,it)=> sum + (Number(it[valueCol])||0), 0) : 0;
        let footCells = def.cols.map((c,i)=>{
          if(i===0) return `<td>${rows.length} item${rows.length===1?'':'s'}</td>`;
          if(i===totalIdx) return `<td class="num">${esc(fmtMoney(totalValue))}</td>`;
          return '<td></td>';
        }).join('');
        const tfoot = `<tfoot><tr>${footCells}</tr></tfoot>`;
    
        table.innerHTML = thead + body + tfoot;
    
        $$('th', table).forEach(th=>{
          th.addEventListener('click', ()=>{
            const key = th.dataset.key;
            const s2 = state.sort[panelKey];
            if(s2.key===key) s2.dir *= -1; else { s2.key=key; s2.dir = -1; }
            renderTable(panelKey);
          });
        });
      }
    
      function renderSummary(){
        const nsVal = computed.neverSold.reduce((s,it)=>s+it.value,0);
        const dsVal = computed.deadStock.reduce((s,it)=>s+it.value,0);
        const exVal = computed.excess.reduce((s,it)=>s+it.excessValue,0);
        const piVal = computed.packIssues.reduce((s,it)=>s+it.stockValue,0);
        $('#sl-summaryCards').innerHTML = `
          <div class="card rust"><span class="stamp">idle</span><span class="tag">Never Sold (${state.neverSoldDays}d)</span>
            <div class="num">${fmtMoney(nsVal)}</div>
            <div class="lbl">${computed.neverSold.length} SKUs · &gt;${state.neverSoldDays} days received, zero sales</div></div>
          <div class="card amber"><span class="stamp">flag</span><span class="tag">Dead Stock (${state.deadDays}d)</span>
            <div class="num">${fmtMoney(dsVal)}</div>
            <div class="lbl">${computed.deadStock.length} SKUs · quiet ${state.deadDays}+ days</div></div>
          <div class="card indigo"><span class="stamp">watch</span><span class="tag">100-Day Excess</span>
            <div class="num">${fmtMoney(exVal)}</div>
            <div class="lbl">${computed.excess.length} SKUs · above 100-day run rate</div></div>
          <div class="card slate"><span class="stamp">check</span><span class="tag">Pack Size Issues</span>
            <div class="num">${fmtMoney(piVal)}</div>
            <div class="lbl">${computed.packIssues.length} SKUs · stock value, unranked</div></div>
          <div class="card stone"><span class="stamp">ref</span><span class="tag">Zero Stock</span>
            <div class="num">${computed.zeroStock.length}</div>
            <div class="lbl">SKUs at zero · reference only</div></div>
        `;
        $('#sl-cnt-neverSold').textContent = computed.neverSold.length;
        $('#sl-cnt-deadStock').textContent = computed.deadStock.length;
        $('#sl-cnt-excess').textContent = computed.excess.length;
        $('#sl-cnt-packIssues').textContent = computed.packIssues.length;
        $('#sl-cnt-zeroStock').textContent = computed.zeroStock.length;
      }
    
      function render(){
        computed = computeAll();
        renderSummary();
        ['neverSold','deadStock','excess','packIssues','zeroStock'].forEach(renderTable);
        $('#sl-main').style.display = 'block';
        $('#sl-emptyState').style.display = 'none';
        $('#sl-footerNote').textContent = 'Calculated client-side in your browser as of ' + state.today.toLocaleString('en-GB') + '. Nothing is uploaded anywhere.';
      }
    
      // ---------- Tabs ----------
      $$('.tab').forEach(tab=>{
        tab.addEventListener('click', ()=>{
          $$('.tab').forEach(t=>t.classList.remove('active'));
          tab.classList.add('active');
          const key = tab.dataset.panel;
          $$('.panel').forEach(p=>p.classList.remove('active'));
          $('#sl-panel-'+key).classList.add('active');
        });
      });
    
      // ---------- Threshold toggles (independent) ----------
      $('#sl-neverSoldThreshold').addEventListener('click', e=>{
        const btn = e.target.closest('button');
        if(!btn) return;
        $$('#neverSoldThreshold button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.neverSoldDays = Number(btn.dataset.days);
        render();
      });
      $('#sl-deadThreshold').addEventListener('click', e=>{
        const btn = e.target.closest('button');
        if(!btn) return;
        $$('#deadThreshold button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        state.deadDays = Number(btn.dataset.days);
        render();
      });
    
      // ---------- Search ----------
      ['neverSold','deadStock','excess','packIssues','zeroStock'].forEach(key=>{
        const input = $('#sl-search-'+key);
        if(input){
          input.addEventListener('input', ()=>{
            state.search[key] = input.value;
            renderTable(key);
          });
        }
      });
    
      // ---------- CSV export ----------
      $$('[data-export]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const key = btn.dataset.export;
          const def = TABLE_DEFS[key];
          const rows = applyFilterSort(key);
          const headers = def.cols.map(c=>c.label);
          const lines = [headers.join(',')];
          rows.forEach(it=>{
            const line = def.cols.map(c=>{
              let v = it[c.key];
              if(c.date) v = fmtDate(v);
              if(typeof v === 'string' && (v.includes(',')||v.includes('"'))){
                v = '"' + v.replace(/"/g,'""') + '"';
              }
              return v==null ? '' : v;
            });
            lines.push(line.join(','));
          });
          const blob = new Blob([lines.join('\n')], {type:'text/csv'});
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = key + '-report.csv';
          a.click();
        });
      });
    
      // ---------- XLSX export (all sheets, with live formulas) ----------
      function colLetter(n){
        let s='';
        while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); }
        return s;
      }
      function excelSerial(d){
        if(!d) return null;
        const epoch = Date.UTC(1899,11,30);
        return Math.round((d.getTime()-epoch) / 86400000);
      }
      function fcell(formula){ return { t:'n', f: formula }; }
    
      function buildWorkbook(){
        const wb = XLSX.utils.book_new();
        const items = state.raw;
        const n = items.length;
        const DATE_FMT = 'dd-mmm-yyyy';
        const MONEY_FMT = '#,##0;(#,##0);"-"';
    
        // ---- Settings ----
        const setAOA = [
          ['Stock Ledger — Settings'],
          [],
          ['Never Sold threshold (days)', state.neverSoldDays],
          ['Dead Stock threshold (days)', state.deadDays],
          ['Sales window used (days)', 90, 'The source field is named netQty100Days but the SQL actually sums a trailing 90-day window. Target 100d stock = that 90-day quantity scaled to a 100-day equivalent.'],
          ['Report snapshot date', new Date()],
          [],
          ['How this workbook works'],
          ['Data sheet holds every SKU with live formulas (days since receive/sale, down-rounded pack quantities, values, and TRUE/FALSE category flags).'],
          ['Summary is fully dynamic — it recalculates from the Data sheet flags any time you edit stock, price, or the threshold cells above (B3/B4).'],
          ['The five report tabs link back to specific Data rows with formulas, so cell VALUES stay live if you edit Data. Their ROW MEMBERSHIP was fixed when this file was exported — re-export from the app after changing thresholds or loading new data to refresh which SKUs appear on each tab.'],
          ['Never Sold: no sale on record at all, received more than the threshold days ago.'],
          ['Dead Stock: HAS a sale on record, but not within the threshold window, and received more than that same window ago. Requiring a sale history keeps this mutually exclusive with Never Sold.'],
          ['100-Day Excess: netQty100Days is actually a 90-day net sold quantity (see source SQL). Target 100d Stock = that 90-day quantity × (100/90) — the amount needed to cover 100 days at the current rate. Excess = stock beyond that target, only for items that sold something in the last 90 days AND have a stock quantity of 4 or more. No pack rounding.'],
          ['Pack Size Issues: stock > 0 but conversionFactor is missing, zero, or invalid — excluded from Never Sold / Dead Stock, but still eligible for Excess.'],
          ['Zero Stock: stock = 0, reference only, excluded from all three calculated reports.'],
          ['Never Sold / Dead Stock quantities are down-rounded to full packs: INT(stock / pack) * pack.'],
        ];
        const wsSettings = XLSX.utils.aoa_to_sheet(setAOA);
        wsSettings['B6'] && (wsSettings['B6'].z = DATE_FMT);
        wsSettings['!cols'] = [{wch:70}];
        XLSX.utils.book_append_sheet(wb, wsSettings, 'Settings');
    
        // ---- Data (master, all formulas) ----
        const headers = ['Code','Item','Company','Supplier','Generic','Stock','UnitPrice','PackSizeRaw',
          'LastReceiveDate','LastSaleDate','NetQty90Days','DaysSinceReceive','DaysSinceSale',
          'HasSale','PackValid','DownRoundQty','DownRoundValue','StockValue','ExcessQty',
          'ExcessValue','IsNeverSold','IsDeadStock','IsExcess','IsPackIssue','IsZeroStock','Target100dStock'];
        const dataAOA = [headers];
        items.forEach(it=>{
          const recD = parseDate(it.lastReceiveDate);
          const saleD = parseDate(it.lastSaleDate);
          dataAOA.push([
            it.code||'', it.name||'', it.company||'', it.supplier||'', it.generic||'',
            Number(it.stock)||0, Number(it.unitPrice)||0,
            (it.conversionFactor===undefined||it.conversionFactor===null||it.conversionFactor==='') ? '' : Number(it.conversionFactor),
            recD ? excelSerial(recD) : '', saleD ? excelSerial(saleD) : '',
            Number(it.netQty100Days)||0,
            '','','','','','','','','','','','','','',''
          ]);
        });
        const wsData = XLSX.utils.aoa_to_sheet(dataAOA);
        for(let i=0;i<n;i++){
          const r = i+2;
          if(wsData['I'+r]) wsData['I'+r].z = DATE_FMT;
          if(wsData['J'+r]) wsData['J'+r].z = DATE_FMT;
          if(wsData['G'+r]) wsData['G'+r].z = MONEY_FMT;
          wsData['L'+r] = fcell(`IF(I${r}="","",TODAY()-I${r})`);
          wsData['M'+r] = fcell(`IF(J${r}="","",TODAY()-J${r})`);
          wsData['N'+r] = fcell(`IF(J${r}="",FALSE,TRUE)`);
          wsData['O'+r] = fcell(`IF(AND(ISNUMBER(H${r}),H${r}>0),TRUE,FALSE)`);
          wsData['P'+r] = fcell(`IF(O${r},INT(F${r}/H${r})*H${r},"")`);
          wsData['Q'+r] = Object.assign(fcell(`IF(O${r},P${r}*G${r},"")`), {z:MONEY_FMT});
          wsData['R'+r] = Object.assign(fcell(`F${r}*G${r}`), {z:MONEY_FMT});
          wsData['Z'+r] = fcell(`K${r}*(100/90)`);
          wsData['S'+r] = fcell(`IF(K${r}>0,MAX(F${r}-Z${r},0),0)`);
          wsData['T'+r] = Object.assign(fcell(`S${r}*G${r}`), {z:MONEY_FMT});
          wsData['U'+r] = fcell(`IF(AND(NOT(N${r}),L${r}<>"",L${r}>Settings!$B$3),TRUE,FALSE)`);
          wsData['V'+r] = fcell(`IF(AND(N${r},M${r}<>"",M${r}>Settings!$B$4,L${r}<>"",L${r}>Settings!$B$4),TRUE,FALSE)`);
          wsData['W'+r] = fcell(`IF(AND(K${r}>0,S${r}>0,F${r}>=4),TRUE,FALSE)`);
          wsData['X'+r] = fcell(`IF(AND(F${r}>0,NOT(O${r})),TRUE,FALSE)`);
          wsData['Y'+r] = fcell(`IF(F${r}=0,TRUE,FALSE)`);
        }
        wsData['!cols'] = [14,34,22,22,24,9,11,11,13,13,12,13,12,9,9,13,12,11,10,11,11,10,9,10,10,14].map(w=>({wch:w}));
        wsData['!autofilter'] = { ref: `A1:Z${n+1}` };
        XLSX.utils.book_append_sheet(wb, wsData, 'Data');
    
        // ---- Summary (fully dynamic) ----
        const summaryDefs = [
          ['Never Sold','U','Q', `No sale ever, received >${state.neverSoldDays}d ago`],
          ['Dead Stock','V','Q', `Sold before, quiet >${state.deadDays}d, received >${state.deadDays}d ago`],
          ['100-Day Excess','W','T', 'Stock beyond a 100-day target derived from the 90-day sale rate (stock qty ≥ 4 only)'],
          ['Pack Size Issues','X','R', 'Invalid/missing pack size (reference)'],
          ['Zero Stock','Y',null, 'Stock = 0 (reference)'],
        ];
        const smAOA = [
          ['Stock Ledger — Summary'],
          [`Snapshot date: ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} · ${n.toLocaleString()} SKUs loaded`],
          [],
          ['Report','SKUs','Total Value','Notes'],
        ];
        summaryDefs.forEach(d=> smAOA.push([d[0], '', '', d[3]]));
        const wsSummary = XLSX.utils.aoa_to_sheet(smAOA);
        summaryDefs.forEach((d,i)=>{
          const r = 5+i;
          wsSummary['B'+r] = fcell(`COUNTIF(Data!${d[1]}:${d[1]},TRUE)`);
          if(d[2]){
            wsSummary['C'+r] = Object.assign(fcell(`SUMIF(Data!${d[1]}:${d[1]},TRUE,Data!${d[2]}:${d[2]})`), {z:MONEY_FMT});
          } else {
            wsSummary['C'+r] = { t:'s', v:'—' };
          }
        });
        wsSummary['!cols'] = [{wch:20},{wch:10},{wch:15},{wch:55}];
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    
        // ---- Report sheets (formula-linked to Data rows) ----
        function reportSheet(name, list, cols, note, valueColLetter, colWidths){
          const aoa = [[note], cols.map(c=>c[0])];
          const wsx = XLSX.utils.aoa_to_sheet(aoa);
          wsx['!merges'] = [{ s:{r:0,c:0}, e:{r:0,c:cols.length-1} }];
          list.forEach((it,i)=>{
            const r = 3+i; // 1-based row: row1 note, row2 header, data from row3
            cols.forEach((c,ci)=>{
              const addr = colLetter(ci+1) + r;
              const cell = fcell(`Data!${c[1]}${it._row}`);
              if(c[2]) cell.z = c[2];
              wsx[addr] = cell;
            });
          });
          const totalRow = 3 + list.length;
          wsx['A'+totalRow] = { t:'s', v: `${list.length} item${list.length===1?'':'s'}` };
          if(valueColLetter){
            cols.forEach((c,ci)=>{
              if(c[1]===valueColLetter){
                const cl = colLetter(ci+1);
                wsx[cl+totalRow] = list.length>0
                  ? Object.assign(fcell(`SUM(${cl}3:${cl}${totalRow-1})`), {z:MONEY_FMT})
                  : { t:'n', v:0, z:MONEY_FMT };
              }
            });
          }
          const range = { s:{r:0,c:0}, e:{r:totalRow-1, c:cols.length-1} };
          wsx['!ref'] = XLSX.utils.encode_range(range);
          wsx['!cols'] = colWidths.map(w=>({wch:w}));
          XLSX.utils.book_append_sheet(wb, wsx, name);
        }
    
        reportSheet('Never Sold', computed.neverSold, [
          ['Code','A'], ['Item','B'], ['Company','C'], ['Stock','F'], ['Pack','H'],
          ['Down-round Qty','P'], ['Unit Price','G',MONEY_FMT], ['Value','Q',MONEY_FMT],
          ['Received','I',DATE_FMT], ['Days Received','L'],
        ], `No sale on record at all, received more than ${state.neverSoldDays} days ago (Settings!B3). Quantities down-rounded to full packs.`,
        'Q', [13,34,22,8,7,13,10,11,12,12]);
    
        reportSheet('Dead Stock', computed.deadStock, [
          ['Code','A'], ['Item','B'], ['Company','C'], ['Stock','F'], ['Pack','H'],
          ['Down-round Qty','P'], ['Unit Price','G',MONEY_FMT], ['Value','Q',MONEY_FMT],
          ['Last Sale','J',DATE_FMT], ['Days Since Sale','M'],
          ['Received','I',DATE_FMT], ['Days Received','L'],
        ], `Has a sale on record, but nothing sold in the last ${state.deadDays} days (Settings!B4), and received more than ${state.deadDays} days ago. Mutually exclusive with Never Sold.`,
        'Q', [13,34,22,8,7,13,10,11,12,13,12,12]);
    
        reportSheet('100-Day Excess', computed.excess, [
          ['Code','A'], ['Item','B'], ['Company','C'], ['Stock','F'],
          ['Sold /90d','K'], ['Target 100d Stock','Z'], ['Excess Qty','S'],
          ['Unit Price','G',MONEY_FMT], ['Excess Value','T',MONEY_FMT],
        ], 'netQty100Days is actually a 90-day net sold quantity (per the source SQL). Target 100d Stock = Sold/90d × (100/90). Excess = stock beyond that target, for items that sold something in the last 90 days and have a stock quantity of 4 or more. No pack rounding applied.',
        'T', [13,34,22,8,11,15,11,10,12]);
    
        reportSheet('Pack Size Issues', computed.packIssues, [
          ['Code','A'], ['Item','B'], ['Company','C'], ['Pack Size (raw)','H'], ['Stock','F'],
          ['Unit Price','G',MONEY_FMT], ['Stock Value','R',MONEY_FMT],
          ['Received','I',DATE_FMT], ['Last Sale','J',DATE_FMT], ['Sold /90d','K'],
        ], 'Stock > 0 but pack size (conversionFactor) is missing, zero, or invalid — excluded from Never Sold / Dead Stock. Reference only.',
        'R', [13,34,22,14,8,10,11,12,12,11]);
    
        reportSheet('Zero Stock', computed.zeroStock, [
          ['Code','A'], ['Item','B'], ['Company','C'], ['Pack Size','H'], ['Unit Price','G',MONEY_FMT],
          ['Received','I',DATE_FMT], ['Days Received','L'], ['Last Sale','J',DATE_FMT],
          ['Days Since Sale','M'], ['Sold /90d','K'],
        ], 'Stock = 0 — nothing to value. Reference only, excluded from all three calculated reports.',
        null, [13,34,22,10,10,12,12,12,13,11]);
    
        return wb;
      }
    
      $('#sl-exportAllBtn').addEventListener('click', ()=>{
        if(!state.raw.length){
          $('#sl-exportStatus').textContent = 'Load inventory.json first.';
          return;
        }
        $('#sl-exportStatus').textContent = 'Building workbook…';
        setTimeout(()=>{
          try{
            const wb = buildWorkbook();
            XLSX.writeFile(wb, 'stock-ledger-report.xlsx');
            $('#sl-exportStatus').textContent = 'Downloaded ✓ (open in Excel/LibreOffice — formulas recalculate on open)';
          }catch(err){
            $('#sl-exportStatus').textContent = 'Export failed: ' + err.message;
          }
        }, 30);
      });
    
      // ---------- Supabase integration (primary source) ----------
      // Resolution order for the client: an instance passed to init({supabaseClient}),
      // then a global `window.supabaseClient` your host app may already expose,
      // then — only if neither exists — one built here from a pasted URL/anon key.
      // The anon key is safe to use client-side (that's its purpose with RLS enabled);
      // this is not a secret like the Dropbox token.
      function sbSetStatus(msg, cls){
        const el = $('#sl-sbStatus');
        el.textContent = msg;
        el.className = 'dbxstatus' + (cls ? ' '+cls : '');
      }

      $('#sl-sbToggle').addEventListener('click', ()=>{
        $('#sl-sbToggle').classList.toggle('open');
        $('#sl-sbBody').classList.toggle('open');
      });

      if(sbConfig.client){
        $('#sl-sbSharedNote').style.display = 'block';
        $('#sl-sbManualFields').style.display = 'none';
        $('#sl-sbManualFields2').style.display = 'none';
      }
      $('#sl-sbTable').value = sbConfig.table;

      function getSupabaseClient(){
        if(sbConfig.client) return sbConfig.client;
        const url = $('#sl-sbUrl').value.trim();
        const key = $('#sl-sbKey').value.trim();
        if(!url || !key) throw new Error('enter your Supabase project URL and anon key first');
        if(!window.supabase || !window.supabase.createClient){
          throw new Error('supabase-js not loaded — add the Supabase CDN script tag to your page');
        }
        sbConfig.client = window.supabase.createClient(url, key);
        return sbConfig.client;
      }

      async function fetchFromSupabase(silent){
        const table = ($('#sl-sbTable').value || sbConfig.table || 'inventory').trim();
        try{
          const client = getSupabaseClient();
          if(!silent) sbSetStatus('Loading from Supabase…');
          const { data, error } = await client.from(table).select('*');
          if(error) throw new Error(error.message);
          if(!data || data.length === 0) throw new Error('table "' + table + '" returned no rows');
          if(loadRawArray(data, table + ' (Supabase)')){
            sbSetStatus('Loaded ' + data.length.toLocaleString() + ' rows from Supabase ✓', 'ok');
          }
          return true;
        }catch(err){
          sbSetStatus((silent ? 'Supabase unavailable (' : 'Load failed: ') + err.message + (silent ? ') — use Dropbox or upload a file below.' : ''), 'err');
          return false;
        }
      }

      $('#sl-sbFetchBtn').addEventListener('click', ()=> fetchFromSupabase(false));

      // ---------- Dropbox integration ----------
      // PKCE, no-redirect ("copy the code") flow — works from a plain local HTML file
      // with no backend and no client secret. Refresh token doesn't expire on its own;
      // it's saved to localStorage (never written into this source file) so it survives
      // a page refresh and the file can auto-load again without re-entering anything.
      const dbx = { appKey:'', verifier:'', accessToken:'', refreshToken:'', expiresAt:0 };

      const DBX_STORE_KEY = 'bt_sl_dbx_v1';
      function dbxLoadPersisted(){
        try{
          const raw = window.Repository ? window.Repository.getItem(DBX_STORE_KEY) : localStorage.getItem(DBX_STORE_KEY);
          return raw ? JSON.parse(raw) : {};
        }catch(e){ return {}; }
      }
      function dbxSavePersisted(){
        try{
          const payload = {
            appKey: dbx.appKey || '',
            refreshToken: dbx.refreshToken || '',
            path: ($('#sl-dbxPath').value || '').trim() || '/inventory.json'
          };
          const raw = JSON.stringify(payload);
          if(window.Repository) window.Repository.setItem(DBX_STORE_KEY, raw);
          else localStorage.setItem(DBX_STORE_KEY, raw);
        }catch(e){ /* storage unavailable — non-fatal */ }
      }
      (function dbxRestore(){
        const saved = dbxLoadPersisted();
        if(saved.appKey){ dbx.appKey = saved.appKey; $('#sl-dbxAppKey').value = saved.appKey; }
        if(saved.refreshToken){ dbx.refreshToken = saved.refreshToken; $('#sl-dbxRefreshInput').value = saved.refreshToken; }
        if(saved.path){ $('#sl-dbxPath').value = saved.path; }
      })();

      function dbxSetStatus(msg, cls){
        const el = $('#sl-dbxStatus');
        el.textContent = msg;
        el.className = 'dbxstatus' + (cls ? ' '+cls : '');
      }
    
      function b64url(buf){
        let str = '';
        const bytes = new Uint8Array(buf);
        for(let i=0;i<bytes.byteLength;i++) str += String.fromCharCode(bytes[i]);
        return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      }
      function randomVerifier(){
        const arr = new Uint8Array(64);
        crypto.getRandomValues(arr);
        return b64url(arr.buffer).slice(0,128);
      }
      async function pkceChallenge(verifier){
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return b64url(digest);
      }
    
      $('#sl-dbxToggle').addEventListener('click', ()=>{
        $('#sl-dbxToggle').classList.toggle('open');
        $('#sl-dbxBody').classList.toggle('open');
      });
    
      $('#sl-dbxAuthorizeBtn').addEventListener('click', async ()=>{
        const key = $('#sl-dbxAppKey').value.trim();
        if(!key){ dbxSetStatus('Enter your Dropbox app key first.', 'err'); return; }
        if(!window.isSecureContext && location.protocol !== 'file:'){
          dbxSetStatus('This needs a secure context (https or a local file) for the browser\'s crypto — try opening the file directly rather than through an unsecured page.', 'err');
          return;
        }
        dbx.appKey = key;
        dbx.verifier = randomVerifier();
        const challenge = await pkceChallenge(dbx.verifier);
        const url = 'https://www.dropbox.com/oauth2/authorize'
          + '?client_id=' + encodeURIComponent(key)
          + '&response_type=code'
          + '&code_challenge=' + encodeURIComponent(challenge)
          + '&code_challenge_method=S256'
          + '&token_access_type=offline';
        window.open(url, '_blank');
        dbxSetStatus('Approve access in the tab that just opened, then copy the code it shows you back here.');
      });
    
      $('#sl-dbxExchangeBtn').addEventListener('click', async ()=>{
        const code = $('#sl-dbxCode').value.trim();
        if(!dbx.appKey || !dbx.verifier){ dbxSetStatus('Click "Open Dropbox approval" first.', 'err'); return; }
        if(!code){ dbxSetStatus('Paste the code Dropbox showed you.', 'err'); return; }
        dbxSetStatus('Exchanging code for tokens…');
        try{
          const body = new URLSearchParams({
            code, grant_type:'authorization_code',
            client_id: dbx.appKey, code_verifier: dbx.verifier
          });
          const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method:'POST',
            headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body
          });
          const json = await res.json();
          if(!res.ok) throw new Error(json.error_description || json.error || 'token exchange failed');
          dbx.accessToken = json.access_token;
          dbx.refreshToken = json.refresh_token;
          dbx.expiresAt = Date.now() + (json.expires_in*1000) - 60000;
          $('#sl-dbxRefreshOut').value = dbx.refreshToken;
          $('#sl-dbxTokenOut').style.display = 'block';
          dbxSavePersisted();
          dbxSetStatus('Connected. Saved locally — this file will auto-load next time you open Stock Ledger.', 'ok');
        }catch(err){
          dbxSetStatus('Exchange failed: ' + err.message, 'err');
        }
      });
    
      $('#sl-dbxUseRefreshBtn').addEventListener('click', ()=>{
        const key = $('#sl-dbxAppKey').value.trim();
        const rt = $('#sl-dbxRefreshInput').value.trim();
        if(!key){ dbxSetStatus('Enter your Dropbox app key first.', 'err'); return; }
        if(!rt){ dbxSetStatus('Paste your saved refresh token first.', 'err'); return; }
        dbx.appKey = key;
        dbx.refreshToken = rt;
        dbx.accessToken = '';
        dbx.expiresAt = 0;
        dbxSavePersisted();
        dbxSetStatus('Refresh token loaded and saved locally. Click "Fetch from Dropbox" to pull the file.', 'ok');
      });
    
      $('#sl-dbxCopyBtn').addEventListener('click', async ()=>{
        try{
          await navigator.clipboard.writeText($('#sl-dbxRefreshOut').value);
          dbxSetStatus('Refresh token copied.', 'ok');
        }catch(err){
          $('#sl-dbxRefreshOut').select();
          dbxSetStatus('Select-and-copy manually (clipboard access was blocked).', 'err');
        }
      });
    
      async function dbxEnsureAccessToken(){
        if(dbx.accessToken && Date.now() < dbx.expiresAt) return dbx.accessToken;
        if(!dbx.refreshToken || !dbx.appKey) throw new Error('not connected — connect Dropbox first');
        const body = new URLSearchParams({
          grant_type:'refresh_token', refresh_token: dbx.refreshToken, client_id: dbx.appKey
        });
        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body
        });
        const json = await res.json();
        if(!res.ok) throw new Error(json.error_description || json.error || 'refresh failed');
        dbx.accessToken = json.access_token;
        dbx.expiresAt = Date.now() + (json.expires_in*1000) - 60000;
        return dbx.accessToken;
      }
    
      async function dbxFetchFile(silent){
        const path = $('#sl-dbxPath').value.trim() || '/inventory.json';
        if(!silent) dbxSetStatus('Refreshing access token…');
        try{
          const token = await dbxEnsureAccessToken();
          if(!silent) dbxSetStatus('Downloading ' + path + ' from Dropbox…');
          const res = await fetch('https://content.dropboxapi.com/2/files/download', {
            method:'POST',
            headers:{
              'Authorization':'Bearer ' + token,
              'Dropbox-API-Arg': JSON.stringify({ path })
            }
          });
          if(!res.ok){
            const errText = await res.text();
            throw new Error('Dropbox returned ' + res.status + ': ' + errText.slice(0,200));
          }
          const text = await res.text();
          if(loadRawJSON(text, path.split('/').pop() + ' (Dropbox)' + (silent ? ', auto' : ''))){
            dbxSetStatus('Loaded from Dropbox ✓' + (silent ? ' (auto)' : ''), 'ok');
            dbxSavePersisted();
            return true;
          }
          return false;
        }catch(err){
          dbxSetStatus((silent ? 'Dropbox auto-load unavailable (' : 'Fetch failed: ') + err.message + (silent ? ')' : ''), 'err');
          return false;
        }
      }

      $('#sl-dbxFetchBtn').addEventListener('click', ()=> dbxFetchFile(false));

      // ---------- Auto-load on open ----------
      // Supabase (primary) first; if that's unavailable, fall back to a saved
      // Dropbox refresh token so a fresh file is already loaded without any clicks.
      (async function autoLoadInventory(){
        let loaded = false;
        if(sbConfig.autoLoad && sbConfig.client){
          loaded = await fetchFromSupabase(true);
        }
        if(!loaded && dbx.appKey && dbx.refreshToken){
          await dbxFetchFile(true);
        }
      })();

      // ---------- Init ----------
      $('#sl-asofLine').textContent = 'Reference date: ' + state.today.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}) + ' — all "days since" figures are measured against this.';

      // ---------- Read-only bridge for other pages (e.g. Excess Working) ----------
      // Excess Working reuses the exact same "100-Day Excess" rows this page
      // computes (see computeAll(), section 3) instead of re-loading or
      // re-deriving them — one inventory load, one source of truth. These
      // closures capture `computed`/`state` by reference, so they always
      // return whatever this page most recently computed, live.
      window.StockLedgerApp.getExcessRows = function(){ return (computed.excess || []).slice(); };
      window.StockLedgerApp.hasData = function(){ return state.raw.length > 0; };
      window.StockLedgerApp.getRawCount = function(){ return state.raw.length; };
      window.StockLedgerApp.getAsOfLabel = function(){
        return state.today.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
      };

  }

  return { init: init };
})();
