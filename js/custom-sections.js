// ══════════════════════════════════════════════════════════════════
// SALARY — Copy to Next Month
// Carries employee names, designations, and HO Salary to the next
// month. Clears Advance and Generic (they vary each month) so the
// user fills them fresh. Days is reset to 0 as well.
// ══════════════════════════════════════════════════════════════════
(function() {
'use strict';

function salaryNextMonth() {
  const sel = document.getElementById('sal-month-sel');
  const curMon = sel ? sel.value : '';
  if (!curMon) { toast('⚠ Select a month first','w'); return; }

  const MNAMES = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
  const parts = curMon.split(' ');
  const mIdx  = MNAMES.indexOf(parts[0]);
  const yr    = parseInt(parts[1]);
  if (mIdx < 0 || isNaN(yr)) { toast('⚠ Invalid month format','w'); return; }
  let nIdx = mIdx + 1, nYr = yr;
  if (nIdx > 11) { nIdx = 0; nYr++; }
  const nextMon = MNAMES[nIdx] + ' ' + nYr;

  // Load full manager data
  let data;
  try { data = JSON.parse(Repository.getItem('BT_ManagerWork_v1') || '{}'); } catch(e) { data = {}; }

  const curRows = (data.salary && data.salary[curMon]) || [];
  if (!curRows.length) { toast('⚠ No salary data for ' + curMon,'w'); return; }

  if (data.salary && data.salary[nextMon] && data.salary[nextMon].length) {
    if (!confirm(nextMon + ' already has salary data. Overwrite with carry-forward from ' + curMon + '?')) return;
  }

  // Clone rows — carry name, designation, hoSal; reset days/advance/generic
  const carried = curRows.map(r => ({
    name:        r.name        || '',
    designation: r.designation || '',
    days:        0,
    hoSal:       r.hoSal       || 0,
    advance:     0,
    generic:     0,
  }));

  if (!data.salary) data.salary = {};
  data.salary[nextMon] = carried;
  Actions.saveManagerWork(data);

  // Switch selector to next month (add option if not present)
  if (sel) {
    const exists = Array.from(sel.options).some(o => o.value === nextMon);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = nextMon;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = nextMon;
    if (typeof loadSalaryMonth === 'function') loadSalaryMonth(nextMon);
  }
  toast('✓ Salary carried to ' + nextMon + ' — fill in Days, Advance & Generic for ' + nextMon);
}

// ══════════════════════════════════════════════════════════════════
// PETTY — Copy to Next Month
// ══════════════════════════════════════════════════════════════════
// Kept only for drive.js/supabase.js, which still directly back up and
// sync whatever old data may exist under this key — the feature that
// used to write to it (Custom Sections) is retired in favor of the
// Ledger's "Other Sections" (see ledger-page.js), but the key itself
// isn't deleted, so anything already backed up stays backed up.
const CSEC_KEY = 'mw_custom_sections_v1';

function pettyNextMonth() {
  if (!_pettyMonth) { toast('⚠ Select a month first','w'); return; }
  // 1. Save current month first
  Actions.saveFeatureData(_pettyKey(_pettyMonth), JSON.stringify(_pettyData));
  // 2. Compute the next month label (same "Month Year" format as mgrMonths)
  const MNAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const parts = _pettyMonth.split(' ');  // ["April", "2026"]
  const mIdx  = MNAMES.indexOf(parts[0]);
  const yr    = parseInt(parts[1]);
  let nIdx = mIdx + 1, nYr = yr;
  if (nIdx > 11) { nIdx = 0; nYr++; }
  const nextMon = MNAMES[nIdx] + ' ' + nYr;
  // 3. Clone current data (all groups + amounts carried forward)
  const existingRaw = Repository.getItem(_pettyKey(nextMon));
  if (existingRaw) {
    if (!confirm(`${nextMon} already has petty data. Overwrite it with a copy of ${_pettyMonth}?`)) return;
  }
  const clone = JSON.parse(JSON.stringify(_pettyData));
  Actions.saveFeatureData(_pettyKey(nextMon), JSON.stringify(clone));
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

// Bridge what's used externally, from index.html, or via a same-file
// onclick attribute. The Custom Sections feature itself (_csecLoad,
// loadCustomSections, csecAddRow, etc.) was retired in favor of the
// generalized Ledger's "Other Sections" (ledger-page.js,
// renderOtherSectionsManager) — this file now only owns the two
// Copy-to-Next-Month helpers, which are unrelated to Custom Sections
// and still needed by the Salary/Petty tabs.
window.salaryNextMonth = salaryNextMonth;
window.pettyNextMonth = pettyNextMonth;
window.CSEC_KEY = CSEC_KEY;

})();
