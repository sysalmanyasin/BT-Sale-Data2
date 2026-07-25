// ══════════════════════════════════════════════════════════════════════
// MANAGER — PETTY CASH  (ES module, split from manager.js)
//
// Per-month grouped petty-cash entries (multiple named groups, each
// with its own rows) plus a printable report. Independent of the
// Staff/Salary/Generic/Credit sheets — no cross-module state needed.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { Actions } from './actions.js';
import { _ni, _fc2 } from './manager-shared.js';
import { _mgrPrint } from './manager-reports.js';

const PETTY_PFX = 'mw_petty_';
let _pettyData = { groups: [] };  // current working copy
let _pettyMonth = '';

function _pettyKey(my) { return PETTY_PFX + my; }

function loadPettyMonth(my) {
  _pettyMonth = my;
  try {
    const raw = Repository.getItem(_pettyKey(my));
    _pettyData = raw ? JSON.parse(raw) : { groups: [] };
  } catch(e) { _pettyData = { groups: [] }; }
  if (!_pettyData.groups) _pettyData.groups = [];
  // Keep the window bridge live — ai-bridge.js's AI assistant and
  // custom-sections.js's "copy petty to next month" both read
  // window._pettyData/_pettyMonth as bare globals directly. A one-time
  // bridge (the old pattern) would go stale after this first reassignment.
  window._pettyData = _pettyData;
  window._pettyMonth = _pettyMonth;
  renderPettyGroups();
}

function savePettyData() {
  if (!_pettyMonth) { toast('⚠ Select a month first','w'); return; }
  Actions.saveFeatureData(_pettyKey(_pettyMonth), JSON.stringify(_pettyData));
  toast('✓ Petty Detail saved');
  if (Repository.getItem('bt_auto_save')==='1') pushToSupabase();
}

function _pettyTotalForMonth(my) {
  try {
    const raw = Repository.getItem(_pettyKey(my));
    const data = raw ? JSON.parse(raw) : null;
    const groups = data && Array.isArray(data.groups) ? data.groups : [];
    return groups.reduce((s, g) => s + (Array.isArray(g.rows) ? g.rows.reduce((a, r) => a + _ni(r.amount), 0) : 0), 0);
  } catch(e) { return 0; }
}

function addPettyGroup() {
  _pettyData.groups.push({ period: '', rows: [{ desc: '', amount: 0 }] });
  renderPettyGroups();
  // Scroll to the new group
  setTimeout(() => {
    const gs = document.querySelectorAll('.petty-group');
    if (gs.length) gs[gs.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function deletePettyGroup(gi) {
  if (!confirm('Delete this group?')) return;
  _pettyData.groups.splice(gi, 1);
  renderPettyGroups();
}

function addPettyRow(gi) {
  _pettyData.groups[gi].rows.push({ desc: '', amount: 0 });
  renderPettyGroups();
}

function deletePettyRow(gi, ri) {
  _pettyData.groups[gi].rows.splice(ri, 1);
  renderPettyGroups();
}

function pettyRowChange(gi, ri, field, val) {
  _pettyData.groups[gi].rows[ri][field] = field === 'desc' ? val : _ni(val);
  // Update sub-total live
  const sub = _pettyData.groups[gi].rows.reduce((s, r) => s + _ni(r.amount), 0);
  const el = document.getElementById('petty-sub-' + gi);
  if (el) el.textContent = '₨' + _fc2(sub);
  recalcPettyKpis();
}

function _pettyGroupTotal(g) {
  return g.rows.reduce((s, r) => s + _ni(r.amount), 0);
}

function recalcPettyKpis() {
  const gs = _pettyData.groups;
  const grand = gs.reduce((s, g) => s + _pettyGroupTotal(g), 0);
  const items = gs.reduce((s, g) => s + g.rows.length, 0);
  const kGroups = document.getElementById('petty-k-groups');
  const kItems  = document.getElementById('petty-k-items');
  const kTotal  = document.getElementById('petty-k-total');
  if (kGroups) kGroups.textContent = gs.length;
  if (kItems)  kItems.textContent  = items;
  if (kTotal)  kTotal.textContent  = '₨' + _fc2(grand);
}

function renderPettyGroups() {
  const cont = document.getElementById('petty-groups');
  if (!cont) return;
  const gs = _pettyData.groups;
  if (!gs.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;border:2px dashed var(--border);border-radius:10px">No groups yet — click <strong>＋ Add New Group</strong> to create the first sub-voucher.</div>';
    recalcPettyKpis(); return;
  }
  cont.innerHTML = gs.map((g, gi) => {
    const sub = _pettyGroupTotal(g);
    const rows = g.rows.map((r, ri) => `
      <tr class="mgr-tr">
        <td class="mgr-td" style="color:var(--muted);font-size:11px">${ri + 1}</td>
        <td class="mgr-td"><input class="mgr-inp" type="text" value="${(r.desc||'').replace(/"/g,'&quot;')}" placeholder="Description / item"
          oninput="pettyRowChange(${gi},${ri},'desc',this.value)"></td>
        <td class="mgr-td" style="width:130px"><input class="mgr-inp" type="number" value="${r.amount||''}" placeholder="0"
          oninput="pettyRowChange(${gi},${ri},'amount',this.value)" style="text-align:right"></td>
        <td class="mgr-td" style="text-align:center"><button class="mgr-del" onclick="deletePettyRow(${gi},${ri})">🗑</button></td>
      </tr>`).join('');
    return `
    <div class="petty-group" id="petty-grp-${gi}">
      <div class="petty-group-hd">
        <span style="font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.05em">GROUP ${gi + 1}</span>
        <input class="mgr-inp" type="text" value="${(g.period||'').replace(/"/g,'&quot;')}" placeholder="Period / Date range (e.g. 1–7 June 2026)"
          oninput="pettyRowChange_period(${gi},this.value)"
          style="flex:1;max-width:320px">
        <button class="mgr-del" onclick="deletePettyGroup(${gi})" title="Delete group" style="margin-left:auto">🗑 Group</button>
      </div>
      <div class="petty-group-body">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--s2)">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">#</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Description</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Amount (₨)</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;color:var(--muted);border-bottom:2px solid var(--border)">Del</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="petty-group-foot">
        <button class="btn btn-p" style="font-size:11px;padding:5px 12px" onclick="addPettyRow(${gi})">＋ Add Item</button>
        <button class="btn" style="font-size:11px;padding:5px 12px;background:var(--accent);color:#fff" onclick="printPettyGroup(${gi})">🖨 Print Group</button>
        <div style="font-family:var(--mono);font-weight:700;font-size:13px">
          Total: <span id="petty-sub-${gi}" style="color:var(--accent)">₨${_fc2(sub)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  recalcPettyKpis();
}

function pettyRowChange_period(gi, val) {
  _pettyData.groups[gi].period = val;
}

// Shared per-group print block — used by both the full-month report
// (printPettyReport) and the single-group print (printPettyGroup), so
// the two never drift apart in formatting.
function _pettyGroupBlockHTML(g, gi) {
  const sub = _pettyGroupTotal(g);
  const rows = g.rows.map((r,ri) => `<tr>
    <td style="padding:4px 8px;border-bottom:1px solid #eee">${ri+1}</td>
    <td style="padding:4px 8px;border-bottom:1px solid #eee">${r.desc||'—'}</td>
    <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">₨${_fc2(r.amount)}</td>
  </tr>`).join('');
  return `
  <div style="margin-bottom:18px;border:1px solid #d1d5db;border-radius:8px;overflow:hidden">
    <div style="background:#eff6ff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center">
      <strong style="font-size:12px;color:#1e40af">Group ${gi+1} — ${g.period||'No period'}</strong>
      <span style="font-size:11px;color:#6b7280">Sub-total: <strong style="color:#1e40af">₨${_fc2(sub)}</strong></span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f8fafc">
        <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #d1d5db;font-size:10px">#</th>
        <th style="padding:5px 8px;text-align:left;border-bottom:1px solid #d1d5db;font-size:10px">Description</th>
        <th style="padding:5px 8px;text-align:right;border-bottom:1px solid #d1d5db;font-size:10px">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="background:#eff6ff">
        <td colspan="2" style="padding:6px 8px;font-weight:700;font-size:11px">Total Petty Detail:</td>
        <td style="padding:6px 8px;text-align:right;font-weight:700;font-family:monospace;color:#1e40af">₨${_fc2(sub)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

function printPettyReport() {
  const my = document.getElementById('petty-month-sel').value;
  const gs = _pettyData.groups;
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  const grand = gs.reduce((s,g) => s + _pettyGroupTotal(g), 0);
  const groupBlocks = gs.map((g, gi) => _pettyGroupBlockHTML(g, gi)).join('');
  _mgrPrint(`<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:16px">
      <h2 style="margin:0;font-size:16px">PETTY CASH DETAIL — ${my}</h2>
      <p style="margin:4px 0 0;font-size:11px;opacity:.7">Bahria Town Fazal Din Pharma Plus · Printed: ${today}</p>
    </div>
    ${groupBlocks}
    <div style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <strong>Grand Total — All Groups</strong>
      <strong style="font-family:monospace;font-size:15px">₨${_fc2(grand)}</strong>
    </div>
  </div>`);
}

// Print a single group's voucher — reuses the exact same block markup
// as the full report (see _pettyGroupBlockHTML above). Called from the
// "🖨 Print Group" button rendered in every group's footer, so any group
// added later via addPettyGroup() gets this for free — no per-group
// wiring needed.
function printPettyGroup(gi) {
  const my = document.getElementById('petty-month-sel').value || _pettyMonth;
  const g = _pettyData.groups[gi];
  if (!g) { toast('⚠ Group not found','w'); return; }
  const today = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});
  _mgrPrint(`<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif">
    <div style="background:#1e40af;color:#fff;padding:14px 20px;border-radius:8px;margin-bottom:16px">
      <h2 style="margin:0;font-size:16px">PETTY CASH DETAIL — ${my}</h2>
      <p style="margin:4px 0 0;font-size:11px;opacity:.7">Bahria Town Fazal Din Pharma Plus · Printed: ${today}</p>
    </div>
    ${_pettyGroupBlockHTML(g, gi)}
  </div>`);
}

Object.assign(window, {
  _pettyKey, _pettyData, _pettyMonth, loadPettyMonth, savePettyData, _pettyTotalForMonth,
  addPettyGroup, deletePettyGroup, addPettyRow, deletePettyRow, pettyRowChange,
  pettyRowChange_period, recalcPettyKpis, renderPettyGroups, printPettyReport,
  _pettyGroupBlockHTML, printPettyGroup,
});

export {
  _pettyKey, _pettyData, _pettyMonth, loadPettyMonth, savePettyData, _pettyTotalForMonth,
  addPettyGroup, deletePettyGroup, addPettyRow, deletePettyRow, pettyRowChange,
  pettyRowChange_period, recalcPettyKpis, renderPettyGroups, printPettyReport,
  _pettyGroupBlockHTML, printPettyGroup,
};
