// ══════════════════════════════════════════════════════════════════
// PETTY — Copy to Next Month
// ══════════════════════════════════════════════════════════════════
function pettyNextMonth() {
  if (!_pettyMonth) { toast('⚠ Select a month first','w'); return; }
  // 1. Save current month first
  localStorage.setItem(_pettyKey(_pettyMonth), JSON.stringify(_pettyData));
  // 2. Compute the next month label (same "Month Year" format as mgrMonths)
  const MNAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const parts = _pettyMonth.split(' ');  // ["April", "2026"]
  const mIdx  = MNAMES.indexOf(parts[0]);
  const yr    = parseInt(parts[1]);
  let nIdx = mIdx + 1, nYr = yr;
  if (nIdx > 11) { nIdx = 0; nYr++; }
  const nextMon = MNAMES[nIdx] + ' ' + nYr;
  // 3. Clone current data (all groups + amounts carried forward)
  const existingRaw = localStorage.getItem(_pettyKey(nextMon));
  if (existingRaw) {
    if (!confirm(`${nextMon} already has petty data. Overwrite it with a copy of ${_pettyMonth}?`)) return;
  }
  const clone = JSON.parse(JSON.stringify(_pettyData));
  localStorage.setItem(_pettyKey(nextMon), JSON.stringify(clone));
  // 4. Switch selector to next month (add if not present)
  const sel = document.getElementById('petty-month-sel');
  if (sel) {
    const exists = Array.from(sel.options).some(o => o.value === nextMon);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = nextMon;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = nextMon;
    loadPettyMonth(nextMon);
  }
  toast('✓ Copied to ' + nextMon + ' — edit amounts as needed');
}

// ══════════════════════════════════════════════════════════════════
// CUSTOM SPREADSHEET SECTIONS (Manager)
// ══════════════════════════════════════════════════════════════════
const CSEC_KEY = 'mw_custom_sections_v1';
let _csecMonth = '';
let _csecData  = {};   // { sectionId: { name, emoji, rows: [{desc,amount,notes},...] } }

function _csecLoad() {
  try { return JSON.parse(localStorage.getItem(CSEC_KEY)) || {}; } catch(e) { return {}; }
}
function _csecSave(data) { localStorage.setItem(CSEC_KEY, JSON.stringify(data)); }

function loadCustomSections(mon) {
  _csecMonth = mon;
  const all = _csecLoad();
  // Per-section data is stored as all[sectionId][monthKey]
  renderAllCustomSections();
}

function saveAllCustomSections() {
  if (!_csecMonth) _csecMonth = (document.getElementById('csec-month-sel')||{}).value || '';
  if (!_csecMonth) { toast('⚠ Select a month first','w'); return; }
  const all = _csecLoad();
  // Persist current in-memory rows for each section
  const container = document.getElementById('csec-container');
  if (!container) return;
  container.querySelectorAll('.csec-block').forEach(block => {
    const sid  = block.dataset.sid;
    const rows = [];
    block.querySelectorAll('.csec-row').forEach(row => {
      rows.push({
        desc:   row.querySelector('.csec-desc')?.value  || '',
        amount: parseFloat(row.querySelector('.csec-amt')?.value  || 0) || 0,
        notes:  row.querySelector('.csec-notes')?.value || ''
      });
    });
    if (!all[sid]) all[sid] = { name: block.dataset.name, emoji: block.dataset.emoji, months: {} };
    all[sid].months[_csecMonth] = rows;
  });
  _csecSave(all);
  toast('✓ Custom sections saved');
  if (localStorage.getItem('bt_auto_save') === '1' && typeof pushToGitHub === 'function') pushToGitHub();
}

function promptAddCustomSection() {
  const name  = prompt('Section name (e.g. Fuel Log, Maintenance, Stock):');
  if (!name || !name.trim()) return;
  const emoji = prompt('Choose an emoji for the section (e.g. ⛽ 🔧 📦):', '📋') || '📋';
  const sid   = 'cs_' + Date.now();
  const all   = _csecLoad();
  all[sid]    = { name: name.trim(), emoji: emoji.trim(), months: {} };
  _csecSave(all);
  renderAllCustomSections();
  toast('✓ Section "' + name.trim() + '" created');
}

function deleteCustomSection(sid) {
  if (!confirm('Delete this entire section and all its data?')) return;
  const all = _csecLoad();
  delete all[sid];
  _csecSave(all);
  renderAllCustomSections();
  toast('✓ Section deleted');
}

function renderAllCustomSections() {
  const container = document.getElementById('csec-container');
  if (!container) return;
  const all = _csecLoad();
  const sids = Object.keys(all);
  if (sids.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px">
      No custom sections yet.<br>Click <strong>＋ Add Section</strong> to create one.
    </div>`;
    return;
  }
  container.innerHTML = sids.map(sid => {
    const sec  = all[sid];
    const rows = (sec.months && sec.months[_csecMonth]) || [{ desc:'', amount:0, notes:'' }];
    const total= rows.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
    const rowsHtml = rows.map((r,ri) => `
      <tr class="csec-row mgr-tr">
        <td class="mgr-td" style="color:var(--muted);font-size:11px;width:30px">${ri+1}</td>
        <td class="mgr-td"><input class="mgr-inp csec-desc" type="text" value="${(r.desc||'').replace(/"/g,'&quot;')}" placeholder="Description" oninput="csecLiveTotal('${sid}')"></td>
        <td class="mgr-td" style="width:120px"><input class="mgr-inp csec-amt" type="number" value="${r.amount||''}" placeholder="0" style="text-align:right;font-family:var(--mono)" oninput="csecLiveTotal('${sid}')"></td>
        <td class="mgr-td"><input class="mgr-inp csec-notes" type="text" value="${(r.notes||'').replace(/"/g,'&quot;')}" placeholder="Notes"></td>
        <td class="mgr-td" style="width:32px"><button class="mgr-del" onclick="csecDelRow('${sid}',${ri})">✕</button></td>
      </tr>`).join('');
    return `<div class="csec-block" data-sid="${sid}" data-name="${sec.name}" data-emoji="${sec.emoji}" style="border:1px solid var(--border);border-radius:12px;margin-bottom:18px;overflow:hidden">
      <div style="background:var(--s2);padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)">
        <span style="font-size:20px">${sec.emoji}</span>
        <span style="font-weight:700;font-size:14px;flex:1">${sec.name}</span>
        <span style="font-family:var(--mono);font-size:13px;color:var(--accent);font-weight:700" id="csec-total-${sid}">₨${_fc2(total)}</span>
        <button class="btn btn-s" style="font-size:11px;padding:4px 10px" onclick="csecAddRow('${sid}')">+ Row</button>
        <button class="mgr-del" onclick="deleteCustomSection('${sid}')" title="Delete section">🗑</button>
      </div>
      <div style="overflow-x:auto;padding:8px 14px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:500px">
          <thead><tr style="background:var(--s2)">
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border)">#</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border)">Description</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border)">Amount (₨)</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border)">Notes</th>
            <th style="padding:6px 8px;border-bottom:2px solid var(--border)"></th>
          </tr></thead>
          <tbody id="csec-tbody-${sid}">${rowsHtml}</tbody>
          <tfoot><tr style="background:var(--s2)">
            <td colspan="2" style="padding:7px 10px;font-weight:700;font-size:12px;border-top:2px solid var(--border)">Total</td>
            <td style="padding:7px 10px;text-align:right;font-weight:700;font-family:var(--mono);color:var(--accent);border-top:2px solid var(--border)" id="csec-foot-${sid}">₨${_fc2(total)}</td>
            <td colspan="2" style="border-top:2px solid var(--border)"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
  }).join('');
}

function csecAddRow(sid) {
  const all = _csecLoad();
  if (!all[sid].months) all[sid].months = {};
  if (!all[sid].months[_csecMonth]) all[sid].months[_csecMonth] = [];
  all[sid].months[_csecMonth].push({ desc:'', amount:0, notes:'' });
  _csecSave(all);
  renderAllCustomSections();
}

function csecDelRow(sid, ri) {
  const all = _csecLoad();
  if (all[sid]?.months?.[_csecMonth]) {
    all[sid].months[_csecMonth].splice(ri, 1);
    _csecSave(all);
    renderAllCustomSections();
  }
}

function csecLiveTotal(sid) {
  const block = document.querySelector(`.csec-block[data-sid="${sid}"]`);
  if (!block) return;
  let total = 0;
  block.querySelectorAll('.csec-amt').forEach(inp => { total += parseFloat(inp.value)||0; });
  const fmt = '₨' + _fc2(total);
  const t1 = document.getElementById('csec-total-' + sid);
  const t2 = document.getElementById('csec-foot-' + sid);
  if (t1) t1.textContent = fmt;
  if (t2) t2.textContent = fmt;
}

// Hook into loadManagerPage to also populate custom section month selector
// Deferred to window load so the real loadManagerPage is defined first
window.addEventListener('load', function() {
  const _realLoadManagerPage = loadManagerPage;
  loadManagerPage = function() {
    _realLoadManagerPage();
    const mons = mgrMonths();
    const cur = mons[0] || '';
    _mgrPopSel('csec-month-sel', cur);
    _csecMonth = cur;
    if (cur) loadCustomSections(cur);
    else renderAllCustomSections();
