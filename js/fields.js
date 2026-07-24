// NOTE: _fmCustom stays a true bare global (declared here, before the
// IIFE below) because it's reassigned internally in this file 3 times
// (not just mutated) AND read externally by config.js/data-page.js as a
// bare identifier — wrapping it would mean those external reads only
// ever see the very first array this file happened to have, not later
// reassignments (fmLoad() replacing it entirely, fmResetAll() clearing
// it, etc.).
let _fmCustom  = [];   // [{id, label, section, calcType}]

(function() {
'use strict';

// ── Built-in field definitions ───────────────────────────────────────────────
const FM_BUILTIN = [
  // Cash
  {id:'Cash_Sale',      label:'Cash Sale',           section:'Cash',           calcType:'add'},
  {id:'Cash_Returns',   label:'Cash Returns',         section:'Cash',           calcType:'sub'},
  // Banks
  {id:'HBL',            label:'HBL',                  section:'Banks',          calcType:'add'},
  {id:'MCB',            label:'MCB',                  section:'Banks',          calcType:'add'},
  {id:'Alfala_Bank',    label:'Bank Alfalah',         section:'Banks',          calcType:'add'},
  {id:'Bank_Al_Habib',  label:'Bank Al Habib',        section:'Banks',          calcType:'add'},
  {id:'Meezan_Bank',    label:'Meezan Bank',          section:'Banks',          calcType:'add'},
  {id:'Askari_Bank',    label:'Askari',               section:'Credit Clients', calcType:'add'},
  {id:'Askari_Bank_Returns', label:'Askari Returns',  section:'Credit Clients', calcType:'sub'},
  // Credit Clients
  {id:'PSO',            label:'PSO',                  section:'Credit Clients', calcType:'add'},
  {id:'PSO_Returns',    label:'PSO Returns',          section:'Credit Clients', calcType:'sub'},
  {id:'NESPAK',         label:'NESPAK',               section:'Credit Clients', calcType:'add'},
  {id:'NESPAK_Returns', label:'NESPAK Returns',       section:'Credit Clients', calcType:'sub'},
  {id:'PARCO',          label:'PARCO',                section:'Credit Clients', calcType:'add'},
  {id:'PARCO_Returns',  label:'PARCO Returns',        section:'Credit Clients', calcType:'sub'},
  {id:'TEPA',           label:'TEPA',                 section:'Credit Clients', calcType:'add'},
  {id:'TEPA_Returns',   label:'TEPA Returns',         section:'Credit Clients', calcType:'sub'},
  {id:'LDA',            label:'LDA',                  section:'Credit Clients', calcType:'add'},
  {id:'LDA_Returns',    label:'LDA Returns',          section:'Credit Clients', calcType:'sub'},
  {id:'Gourmet',        label:'Gourmet',              section:'Credit Clients', calcType:'add'},
  {id:'Wapda_Hospital', label:'Wapda Hospital',       section:'Credit Clients', calcType:'add'},
  {id:'BTH',            label:'BTH',                  section:'Credit Clients', calcType:'add'},
  {id:'Berger_Paints',  label:'Berger Paints',        section:'Credit Clients', calcType:'add'},
  {id:'Ecolean_PK',     label:'Ecolean PK',           section:'Credit Clients', calcType:'add'},
  {id:'Style_Textile',  label:'Style Textile',        section:'Credit Clients', calcType:'add'},
  {id:'Syed_Babar_Ali', label:'Syed Babar Ali Fdn',  section:'Credit Clients', calcType:'add'},
  {id:'Rahnuma_NGO',    label:'Rahnuma NGO',          section:'Credit Clients', calcType:'add'},
  {id:'Health_Pass',    label:'Health Pass',          section:'Credit Clients', calcType:'add'},
  {id:'Nisar_Spinning', label:'Nisar Spinning',       section:'Credit Clients', calcType:'add'},
  {id:'Food_Panda',     label:'Food Panda',           section:'Credit Clients', calcType:'add'},
  {id:'F_Issue',        label:'F/Issue',              section:'Credit Clients', calcType:'add'},
  // Summary (non-calc)
  {id:'COMP_SALE',        label:'COMP SALE',            section:'Summary', calcType:'none'},
  {id:'Customers',        label:'Customers',            section:'Summary', calcType:'none'},
  {id:'FDPP',             label:'FDPP POS',             section:'Summary', calcType:'none'},
  {id:'FDPP_Con',         label:'FDPP Consumer',        section:'Summary', calcType:'none'},
  {id:'Amount_Received',  label:'Amount Received',      section:'Summary', calcType:'none'},
  {id:'Load_Sale',        label:'Load Sale',            section:'Summary', calcType:'none'},
  {id:'Cash_to_Deposit',  label:'Cash to be Deposited', section:'Summary', calcType:'none'},
  {id:'Low_Sale_Reason',  label:'Low Sale Reason',      section:'Summary', calcType:'none'},
];

// ── State ─────────────────────────────────────────────────────────────────────
let _fmHidden  = [];   // array of field IDs that are hidden
let _fmTabSec  = 'Cash';

function fmLoad() {
  try {
    const h = Repository.getItem('bt_col_config');
    _fmHidden = h ? JSON.parse(h) : [];
  } catch(e) { _fmHidden = []; }
  try {
    const c = Repository.getItem('bt_custom_cols');
    _fmCustom = c ? JSON.parse(c) : [];
  } catch(e) { _fmCustom = []; }
}

function fmSave() {
  Actions.saveFieldConfig('bt_col_config', JSON.stringify(_fmHidden));
  Actions.saveFieldConfig('bt_custom_cols', JSON.stringify(_fmCustom));
  // If auto-save is enabled, trigger a sync
  try {
    const autoSave = Repository.getItem('bt_auto_save') === '1'
                  || document.getElementById('auto-save')?.checked;
    if (autoSave && typeof pushToSupabase === 'function') pushToSupabase();
  } catch(e) {}
}

// ── Apply visibility to the Entry form ───────────────────────────────────────
function fmApply() {
  FM_BUILTIN.forEach(f => {
    const el = document.querySelector(`[data-field-id="${f.id}"]`);
    if (!el) return;
    el.style.display = _fmHidden.includes(f.id) ? 'none' : '';
  });
  // Remove stale custom field elements then re-render
  document.querySelectorAll('.fg.fm-custom-field').forEach(el => el.remove());
  _fmCustom.forEach(f => {
    const secId = 'fgrid-' + f.section.replace(/ /g, '-');
    const grid  = document.getElementById(secId);
    if (!grid) return;
    const div = document.createElement('div');
    div.className = 'fg fm-custom-field';
    div.dataset.fieldId = f.id;
    div.innerHTML = `<label>${f.label}</label>`
      + `<input type="number" id="e-${f.id}" placeholder="0" oninput="calcTotal()">`;
    grid.appendChild(div);
  });
  // Re-run calcTotal so hidden fields don't break the sum
  if (typeof calcTotal === 'function') calcTotal();
}

// ── Patch calcTotal to include custom add/sub fields ─────────────────────────
function _patchCalcTotal() {
  if (typeof calcTotal !== 'function') return;
  const _orig = calcTotal;
  window.calcTotal = function() {
    _orig();
    // Add/subtract custom field values on top of what the original computed
    const totEl = document.getElementById('e-TOTAL');
    if (!totEl) return;
    let base = parseFloat(totEl.value) || 0;
    _fmCustom.forEach(f => {
      if (f.calcType === 'none') return;
      const v = parseFloat(document.getElementById('e-' + f.id)?.value) || 0;
      if (f.calcType === 'add') base += v;
      else if (f.calcType === 'sub') base -= v;
    });
    totEl.value = base;
  };
}

// Custom field values are persisted directly inside saveEntry() and
// saveEditModal() (data-page.js) — see _fmCustom handling there.

// ── Modal open / close ────────────────────────────────────────────────────────
function openFieldManager() {
  fmLoad();
  _fmTabSec = 'Cash';
  // Reset tab UI
  document.querySelectorAll('.fm-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.sec === _fmTabSec);
  });
  fmRenderBody();
  const modal = document.getElementById('fmbg');
  // Ensure modal is direct child of body — fixes desktop stacking context issues
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  if (modal) modal.classList.add('on');
}

function closeFieldManager() {
  document.getElementById('fmbg').classList.remove('on');
}

function fmApplyAndClose() {
  fmSave();
  fmApply();
  closeFieldManager();
  // Show toast
  const t = document.getElementById('toast');
  if (t) {
    t.textContent = '✓ Field layout saved';
    t.className = 'on';
    setTimeout(() => t.className = '', 2200);
  }
}

function fmResetAll() {
  if (!confirm('Reset all field visibility and remove all custom columns?')) return;
  _fmHidden = [];
  _fmCustom = [];
  fmSave();
  fmApply();
  fmRenderBody();
}

// ── Tab switch ────────────────────────────────────────────────────────────────
function fmSwitchTab(btn) {
  _fmTabSec = btn.dataset.sec;
  document.querySelectorAll('.fm-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  fmRenderBody();
}

// ── Render modal body for current tab ────────────────────────────────────────
function fmRenderBody() {
  const body = document.getElementById('fm-body');
  if (!body) return;

  if (_fmTabSec === 'Custom') {
    body.innerHTML = _renderCustomTab();
    return;
  }

  const fields = FM_BUILTIN.filter(f => f.section === _fmTabSec);
  let html = `<div class="fm-section">
    <div class="fm-section-title">${_fmTabSec} Fields</div>`;

  fields.forEach(f => {
    const vis   = !_fmHidden.includes(f.id);
    const badge = f.calcType === 'add' ? '+ adds to total'
                : f.calcType === 'sub' ? '− subtracts from total'
                : 'info only';
    html += `
    <div class="fm-field-row${vis ? '' : ' hidden-field'}" id="fmrow-${f.id}">
      <div class="fm-field-info">
        <div class="fm-field-label">${f.label}</div>
        <div class="fm-field-meta">${badge}</div>
      </div>
      <label class="fm-toggle">
        <input type="checkbox" ${vis ? 'checked' : ''}
          onchange="fmToggleField('${f.id}', this.checked)">
        <span class="fm-slider"></span>
      </label>
    </div>`;
  });

  html += `</div>`;
  body.innerHTML = html;
}

function _renderCustomTab() {
  const sections = ['Cash','Banks','Credit Clients','Summary'];
  let list = '';
  if (_fmCustom.length === 0) {
    list = `<div style="font-size:12px;color:var(--muted);text-align:center;padding:12px 0">
              No custom fields yet. Add one below.
            </div>`;
  } else {
    _fmCustom.forEach((f, i) => {
      const badge = f.calcType === 'add' ? '+ adds to total'
                  : f.calcType === 'sub' ? '− subtracts'
                  : 'info only';
      list += `
      <div class="fm-custom-item">
        <div>
          <div class="fm-custom-item-info">${f.label}
            <span class="badge bg-blue" style="margin-left:6px">${f.section}</span>
          </div>
          <div class="fm-custom-item-meta">${badge} · id: ${f.id}</div>
        </div>
        <button class="fm-del-btn" onclick="fmDeleteCustom(${i})" title="Remove">✕</button>
      </div>`;
    });
  }

  const secOptions = sections.map(s => `<option>${s}</option>`).join('');

  return `<div class="fm-section">
    <div class="fm-section-title">Custom Fields</div>
    <div class="fm-custom-list">${list}</div>

    <div class="fm-add-form">
      <div class="fm-add-title">Add New Column</div>
      <div class="fm-add-grid">
        <div class="fg">
          <label>Field Label</label>
          <input type="text" id="fm-new-label" placeholder="e.g. My Client">
        </div>
        <div class="fg">
          <label>Section</label>
          <select id="fm-new-section">${secOptions}</select>
        </div>
        <div class="fg fm-add-full">
          <label>Calc Type</label>
          <select id="fm-new-calc">
            <option value="add">Add to Total</option>
            <option value="sub">Subtract from Total</option>
            <option value="none">Info Only (no calc)</option>
          </select>
        </div>
      </div>
      <button class="btn btn-p" onclick="fmAddCustom()">+ Add Column</button>
    </div>
  </div>`;
}

// ── Toggle a built-in field visible/hidden ────────────────────────────────────
function fmToggleField(id, visible) {
  if (visible) {
    _fmHidden = _fmHidden.filter(h => h !== id);
  } else {
    if (!_fmHidden.includes(id)) _fmHidden.push(id);
  }
  // Update row style live
  const row = document.getElementById('fmrow-' + id);
  if (row) row.classList.toggle('hidden-field', !visible);
}

// ── Add a new custom field ────────────────────────────────────────────────────
function fmAddCustom() {
  const labelEl   = document.getElementById('fm-new-label');
  const sectionEl = document.getElementById('fm-new-section');
  const calcEl    = document.getElementById('fm-new-calc');
  const label     = (labelEl?.value || '').trim();

  if (!label) {
    labelEl?.focus();
    return;
  }
  // Build a safe ID: "custom_" + sanitised label
  const safeId = 'custom_' + label.replace(/[^a-zA-Z0-9]/g, '_');

  // Prevent duplicates
  if (_fmCustom.some(f => f.id === safeId)) {
    alert('A custom field with a similar name already exists.');
    return;
  }

  _fmCustom.push({
    id:       safeId,
    label:    label,
    section:  sectionEl?.value || 'Summary',
    calcType: calcEl?.value    || 'add'
  });

  if (labelEl) labelEl.value = '';
  fmRenderBody();
}

// ── Delete a custom field ─────────────────────────────────────────────────────
function fmDeleteCustom(idx) {
  _fmCustom.splice(idx, 1);
  fmRenderBody();
}


// ── Collapsible tool cards ────────────────────────────────────────────────────
function toggleTcard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
}
// ── Bootstrap on load ─────────────────────────────────────────────────────────
window.addEventListener('load', function() {
  fmLoad();
  fmApply();
  // Patch the original calcTotal once it exists (custom field saving is
  // handled directly in data-page.js, not via a patch here)
  _patchCalcTotal();
});

// Bridge what's used externally, from index.html, or via a same-file
// onclick/onchange attribute.
window.fmLoad = fmLoad;
window.fmApply = fmApply;
window.openFieldManager = openFieldManager;
window.closeFieldManager = closeFieldManager;
window.fmApplyAndClose = fmApplyAndClose;
window.fmResetAll = fmResetAll;
window.fmSwitchTab = fmSwitchTab;
window.fmToggleField = fmToggleField;
window.fmAddCustom = fmAddCustom;
window.fmDeleteCustom = fmDeleteCustom;
window.toggleTcard = toggleTcard;

})();

