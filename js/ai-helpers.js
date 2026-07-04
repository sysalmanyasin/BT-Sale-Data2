/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  AI HELPERS  —  BT Sales App  ·  Phase 6                           ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Extracted from ai-page.js (now retired). Provides:                ║
 * ║   · Scan / OCR pipeline  (chpHandleScanFile upgrade)               ║
 * ║   · Sale-report import helpers                                      ║
 * ║   · Generic scan entry import                                       ║
 * ║  aimBriefingGenerate() stays in ai-memory.js (unchanged).          ║
 * ║                                                                      ║
 * ║  Public API:                                                         ║
 * ║    aihScanFile(file, modalHostId, historyArr, renderFn)             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/* ══════════════════════════════════════════════════════════════════════
   SHARED FIELD MAP (sale report column names → display labels)
══════════════════════════════════════════════════════════════════════ */
(function() {
'use strict';

var AIH_FIELD_NAMES = {
  Cash_Sale:'Cash Sale', Cash_Returns:'Cash Returns', Meezan_Bank:'Meezan Bank',
  Alfala_Bank:'Bank Alfalah', Bank_Al_Habib:'Bank Al Habib', HBL:'HBL', MCB:'MCB',
  PSO:'PSO', PSO_Returns:'PSO Returns', NESPAK:'NESPAK', NESPAK_Returns:'NESPAK Returns',
  PARCO:'PARCO', PARCO_Returns:'PARCO Returns', TEPA:'TEPA', TEPA_Returns:'TEPA Returns',
  LDA:'LDA', LDA_Returns:'LDA Returns', Askari_Bank:'Askari', Askari_Bank_Returns:'Askari Returns',
  F_Issue:'Free Issue', Customers:'Customers', FDPP:'FDPP POS', FDPP_Con:'FDPP Consumer',
  Load_Sale:'Load Sale', Amount_Received:'Amount Received', Cash_to_Deposit:'Cash to Deposit',
  COMP_SALE:'Comp Sale',
};

function _aihEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════════════════
   MODAL HOST — shared overlay for scan results
   Uses 'chp-scan-modal' in CommandHub (created on demand)
══════════════════════════════════════════════════════════════════════ */
function _aihGetModal() {
  var el = document.getElementById('chp-scan-modal-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chp-scan-modal-overlay';
    document.body.appendChild(el);
  }
  return el;
}

/* ══════════════════════════════════════════════════════════════════════
   SALE REPORT RESULTS DISPLAY
══════════════════════════════════════════════════════════════════════ */
function _aihShowSaleReportResults(result, historyArr, renderFn) {
  var modal    = _aihGetModal();
  var fields   = result.fields   || {};
  var expenses = result.expenses || [];
  var petty    = result.petty    || [];
  var date     = result.date;
  var dateLabel = date || 'Today (date not detected)';
  var fieldCount = Object.keys(fields).length;
  var extraCount = expenses.length + petty.length;

  var rows = Object.keys(fields).map(function(fid) {
    var val   = fields[fid];
    var label = AIH_FIELD_NAMES[fid] || fid.replace(/_/g,' ');
    var isNeg = val < 0;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px">' +
      '<span style="color:#475569">' + _aihEsc(label) + '</span>' +
      '<span style="font-family:monospace;font-weight:700;color:' + (isNeg?'#dc2626':'#1e293b') + '">' +
        (isNeg?'-':'') + '₨' + Math.abs(Math.round(val)).toLocaleString('en-PK') +
      '</span></div>';
  }).join('');

  var extraRows = '';
  expenses.forEach(function(e) {
    extraRows += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12px">' +
      '<span style="color:#d97706">⚠ ' + _aihEsc(e.name) + ' (Expense)</span>' +
      '<span style="font-family:monospace;font-weight:700">₨' + Math.round(e.amount).toLocaleString('en-PK') + '</span></div>';
  });
  petty.forEach(function(e) {
    extraRows += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:12px">' +
      '<span style="color:#16a34a">⚠ ' + _aihEsc(e.name) + ' (Petty Cash)</span>' +
      '<span style="font-family:monospace;font-weight:700">₨' + Math.round(e.amount).toLocaleString('en-PK') + '</span></div>';
  });

  var safeResult = JSON.stringify(result).replace(/"/g,'&quot;');

  modal.innerHTML =
    '<div style="position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);z-index:22000;display:flex;align-items:flex-end;justify-content:center" ' +
    'onclick="if(event.target===this)_aihCloseModal()">' +
    '<div style="width:100%;max-width:480px;background:#fff;border-radius:18px 18px 0 0;padding:20px 18px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.18)">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
        '<span style="font-size:22px">📊</span>' +
        '<div>' +
          '<div style="font-size:14px;font-weight:700;color:#1e293b">Sale Report Detected</div>' +
          '<div style="font-size:11.5px;color:#64748b">Date: <strong>' + _aihEsc(dateLabel) + '</strong> · ' + fieldCount + ' fields' + (extraCount?' + '+extraCount+' extras':'') + '</div>' +
        '</div>' +
        '<button onclick="_aihCloseModal()" style="margin-left:auto;background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;line-height:1">✕</button>' +
      '</div>' +
      '<div style="max-height:300px;overflow-y:auto;margin:12px 0;padding:0 2px">' + rows + extraRows + '</div>' +
      (extraCount ? '<div style="font-size:11.5px;color:#d97706;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:10px">' +
        '⚠ Till Short / Petty Cash detected — use the buttons below to also import those.' +
      '</div>' : '') +
      '<div style="font-size:12px;color:#64748b;margin-bottom:10px">Tap <strong>→ Daily Entry</strong> to fill the entry form for ' + _aihEsc(dateLabel) + '.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button onclick="_aihCloseModal()" style="padding:7px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:12px;cursor:pointer">Cancel</button>' +
        (expenses.length ? '<button onclick="_aihImportExtras(' + safeResult + ',\'expense\')" style="padding:7px 14px;border-radius:20px;border:1.5px solid #fde68a;background:#fffbeb;color:#d97706;font-size:12px;cursor:pointer">+ Expenses</button>' : '') +
        (petty.length    ? '<button onclick="_aihImportExtras(' + safeResult + ',\'petty\')" style="padding:7px 14px;border-radius:20px;border:1.5px solid #bbf7d0;background:#f0fdf4;color:#16a34a;font-size:12px;cursor:pointer">+ Petty Cash</button>' : '') +
        '<button onclick="_aihImportSaleReport(' + safeResult + ')" style="padding:9px 18px;border-radius:20px;border:none;background:#22c55e;color:#fff;font-size:13px;font-weight:700;cursor:pointer">→ Daily Entry</button>' +
      '</div>' +
    '</div></div>';
}

function _aihCloseModal() {
  var el = document.getElementById('chp-scan-modal-overlay');
  if (el) el.innerHTML = '';
}

function _aihImportSaleReport(result) {
  _aihCloseModal();
  if (!result || !result.fields || !Object.keys(result.fields).length) {
    if (typeof toast === 'function') toast('⚠ No fields to import.', 'w'); return;
  }
  var isoDate = result.date;
  var entryDate = isoDate;
  if (isoDate) {
    var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var parts = isoDate.split('-');
    if (parts.length === 3) entryDate = parts[2]+'-'+MN[parseInt(parts[1],10)-1]+'-'+parts[0];
  }
  if (!entryDate) {
    var d = new Date();
    var MN2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    entryDate = String(d.getDate()).padStart(2,'0')+'-'+MN2[d.getMonth()]+'-'+d.getFullYear();
  }
  if (typeof _aiSaveNewDailyEntry === 'function') {
    _aiSaveNewDailyEntry(entryDate, result.fields);
    var count = Object.keys(result.fields).length;
    if (typeof toast === 'function') toast('✅ ' + count + ' fields imported to Daily Entry for ' + entryDate + '.');
    // Confirm in CommandHub thread
    if (typeof _chHistory !== 'undefined' && typeof _chRenderThread === 'function') {
      _chHistory.push({ role:'bot', text: '✅ Sale report imported: <b>' + count + ' fields</b> filled in Daily Entry for <b>' + _aihEsc(entryDate) + '</b>.' });
      _chRenderThread();
    }
  } else {
    if (typeof toast === 'function') toast('⚠ Daily entry function not available.', 'w');
  }
}

function _aihImportExtras(result, dest) {
  var items = dest === 'expense' ? (result.expenses||[]) : (result.petty||[]);
  if (!items.length) return;
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = new Date();
  var today = String(d.getDate()).padStart(2,'0')+'-'+MN[d.getMonth()]+'-'+d.getFullYear();
  items.forEach(function(e) {
    if (dest === 'expense' && typeof _aiAddExpenseRow === 'function') {
      _aiAddExpenseRow(today, e.description||e.name||'Scanned expense', 0,0,0,0, Math.round(e.amount), 0);
    } else if (dest === 'petty' && typeof _aiAddPettyItem === 'function') {
      _aiAddPettyItem(e.description||e.name||'Scanned petty', Math.round(e.amount), '');
    }
  });
  _aihCloseModal();
  if (typeof toast === 'function') toast('✅ ' + items.length + ' item(s) added to ' + dest + '.');
  if (typeof _chHistory !== 'undefined' && typeof _chRenderThread === 'function') {
    _chHistory.push({ role:'bot', text: '✅ <b>'+items.length+'</b> extra item(s) saved to <b>'+dest+'</b>.' });
    _chRenderThread();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   GENERIC SCAN RESULTS
══════════════════════════════════════════════════════════════════════ */
function _aihShowScanResults(entries) {
  var modal = _aihGetModal();
  var typeColor = { credit:'#eff6ff', expense:'#fef3c7', petty:'#f0fdf4', cash:'#f5f3ff', other:'#f8fafc' };

  var rows = entries.map(function(e, i) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      '<input type="checkbox" id="aih-r-'+i+'" checked style="width:16px;height:16px;accent-color:#2563eb;flex-shrink:0">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12.5px;font-weight:600;color:#0f172a">' + _aihEsc(e.name || e.description || 'Entry') + '</div>' +
        (e.description && e.description !== e.name ? '<div style="font-size:11px;color:#64748b">' + _aihEsc(e.description) + '</div>' : '') +
      '</div>' +
      '<div style="font-size:13px;font-weight:700;color:#1e293b;flex-shrink:0">₨' + Math.round(e.amount).toLocaleString('en-PK') + '</div>' +
      '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;background:'+(typeColor[e.type]||'#f8fafc')+';color:#334155">'+_aihEsc(e.type||'other')+'</span>' +
    '</div>';
  }).join('');

  var safeEntries = JSON.stringify(entries).replace(/"/g,'&quot;');

  modal.innerHTML =
    '<div style="position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);z-index:22000;display:flex;align-items:flex-end;justify-content:center" ' +
    'onclick="if(event.target===this)_aihCloseModal()">' +
    '<div style="width:100%;max-width:480px;background:#fff;border-radius:18px 18px 0 0;padding:20px 18px 32px;box-shadow:0 -8px 40px rgba(0,0,0,.18)">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
        '<span style="font-size:22px">📷</span>' +
        '<div style="font-size:14px;font-weight:700;color:#1e293b">Scan Results — ' + entries.length + ' entries</div>' +
        '<button onclick="_aihCloseModal()" style="margin-left:auto;background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;line-height:1">✕</button>' +
      '</div>' +
      '<div style="max-height:320px;overflow-y:auto;margin-bottom:12px">' + rows + '</div>' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:12px">Select entries to import, then choose a destination.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
        '<button onclick="_aihCloseModal()" style="padding:7px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:12px;cursor:pointer">Cancel</button>' +
        '<button onclick="_aihImportChecked(' + safeEntries + ',\'credit\')" style="padding:7px 14px;border-radius:20px;border:1.5px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font-size:12px;cursor:pointer">→ Credit</button>' +
        '<button onclick="_aihImportChecked(' + safeEntries + ',\'expense\')" style="padding:7px 14px;border-radius:20px;border:1.5px solid #fde68a;background:#fffbeb;color:#d97706;font-size:12px;cursor:pointer">→ Expenses</button>' +
        '<button onclick="_aihImportChecked(' + safeEntries + ',\'petty\')" style="padding:7px 14px;border-radius:20px;border:1.5px solid #bbf7d0;background:#f0fdf4;color:#16a34a;font-size:12px;cursor:pointer">→ Petty Cash</button>' +
      '</div>' +
    '</div></div>';
}

function _aihImportChecked(entries, dest) {
  var checked = entries.filter(function(e, i) {
    var cb = document.getElementById('aih-r-'+i); return cb && cb.checked;
  });
  if (!checked.length) { if (typeof toast === 'function') toast('⚠ No entries selected.', 'w'); return; }
  _aihCloseModal();
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var d = new Date();
  var today = String(d.getDate()).padStart(2,'0')+'-'+MN[d.getMonth()]+'-'+d.getFullYear();
  checked.forEach(function(e) {
    if (dest === 'credit' && typeof _aiAddCreditEntry === 'function') {
      _aiAddCreditEntry(e.name || 'Unknown', e.amount, e.description, today);
    } else if (dest === 'expense' && typeof _aiAddExpenseRow === 'function') {
      _aiAddExpenseRow(today, e.description||e.name||'Scanned expense', 0,0,0,0, Math.round(e.amount), 0);
    } else if (dest === 'petty' && typeof _aiAddPettyItem === 'function') {
      _aiAddPettyItem(e.description||e.name||'Scanned item', Math.round(e.amount), '');
    }
  });
  if (typeof toast === 'function') toast('✅ ' + checked.length + ' entr'+(checked.length===1?'y':'ies')+' imported to '+dest+'.');
  if (typeof _chHistory !== 'undefined' && typeof _chRenderThread === 'function') {
    _chHistory.push({ role:'bot', text: '✅ <b>'+checked.length+'</b> scanned entr'+(checked.length===1?'y':'ies')+' imported to <b>'+dest+'</b>.' });
    _chRenderThread();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN ENTRY POINT — upgraded chpHandleScanFile hook
   Drop-in replacement for commandhub-page.js's chpHandleScanFile
══════════════════════════════════════════════════════════════════════ */
async function aihScanFile(file) {
  if (!file) return;

  // Reset input
  var fi = document.getElementById('chp-scan-file');
  if (fi) fi.value = '';

  if (typeof _callGroqVision !== 'function') {
    if (typeof toast === 'function') toast('⚠ Vision requires a Groq API key — tap ⚙ AI to add one.', 'w');
    return;
  }

  // Show in CommandHub thread
  if (typeof _chHistory !== 'undefined') {
    _chHistory.push({ role: 'user', text: '📷 <em>Image scan submitted…</em>' });
    var thinkId = '_aih_scan_' + Date.now();
    _chHistory.push({ role: 'bot', text: '<div class="chp-typing"><span></span><span></span><span></span></div>', _id: thinkId });
    if (typeof _chRenderThread === 'function') _chRenderThread();
  }

  function clearThinking() {
    if (typeof _chHistory !== 'undefined') {
      var idx = _chHistory.findIndex(function(m){ return m._id === thinkId; });
      if (idx !== -1) _chHistory.splice(idx, 1);
    }
  }

  try {
    var reader = new FileReader();
    var dataUrl = await new Promise(function(res, rej) {
      reader.onload = function(e){ res(e.target.result); };
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    var result = await _callGroqVision(dataUrl, '');

    clearThinking();
    if (typeof _chRenderThread === 'function') _chRenderThread();

    if (result && result._isSaleReport) {
      _aihShowSaleReportResults(result);
    } else {
      var entries = Array.isArray(result) ? result : [];
      if (!entries.length) {
        if (typeof toast === 'function') toast('⚠ No entries found in image.', 'w');
        return;
      }
      _aihShowScanResults(entries);
    }
  } catch(err) {
    clearThinking();
    if (typeof _chHistory !== 'undefined') {
      _chHistory.push({ role: 'bot', text: '⚠️ Scan failed: ' + String(err.message || err) });
    }
    if (typeof _chRenderThread === 'function') _chRenderThread();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 7 — ATTACH PICKER (camera / gallery / file)
   Ported from the retired ai-page.js (aipOpenAttach/aipAttachPick).
   Overrides the plain chpOpenScan() defined in commandhub-page.js —
   this file loads after it, so this definition wins.
══════════════════════════════════════════════════════════════════════ */
(function _aihInjectAttachStyles() {
  if (document.getElementById('aih-attach-styles')) return;
  var el = document.createElement('style');
  el.id = 'aih-attach-styles';
  el.textContent = `
.aih-attach-sheet {
  position: fixed; inset: 0; z-index: 22000;
  background: rgba(15,23,42,.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity .18s ease;
}
.aih-attach-sheet.open { opacity: 1; pointer-events: auto; }
.aih-attach-inner {
  width: 100%; max-width: 480px; background: #fff; border-radius: 22px 22px 0 0;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom,0));
  box-shadow: 0 -8px 40px rgba(0,0,0,.18);
  transform: translateY(20px); transition: transform .22s cubic-bezier(.34,1.2,.64,1);
}
.aih-attach-sheet.open .aih-attach-inner { transform: translateY(0); }
.aih-attach-title { font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 14px; text-align: center; }
.aih-attach-grid { display: flex; gap: 10px; }
.aih-attach-opt {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 14px;
  padding: 16px 8px; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #334155;
}
.aih-attach-opt:hover, .aih-attach-opt:active { background: #eff6ff; border-color: #93c5fd; color: #1e40af; }
.aih-attach-opt-icon { font-size: 26px; }
.aih-attach-cancel {
  width: 100%; margin-top: 14px; padding: 11px; border-radius: 10px; border: none;
  background: #f1f5f9; color: #475569; font-weight: 700; font-size: 13px; cursor: pointer;
}
  `;
  document.head.appendChild(el);
}());

function chpOpenScan() {
  var existing = document.getElementById('chp-attach-sheet');
  if (existing) { existing.classList.add('open'); return; }

  var sheet = document.createElement('div');
  sheet.id = 'chp-attach-sheet';
  sheet.className = 'aih-attach-sheet';
  sheet.innerHTML =
    '<div class="aih-attach-inner">' +
      '<div class="aih-attach-title">📎 Attach Image</div>' +
      '<div class="aih-attach-grid">' +
        '<button class="aih-attach-opt" onclick="_chpAttachPick(\'camera\')">' +
          '<span class="aih-attach-opt-icon">📷</span>Camera' +
        '</button>' +
        '<button class="aih-attach-opt" onclick="_chpAttachPick(\'gallery\')">' +
          '<span class="aih-attach-opt-icon">🖼️</span>Gallery' +
        '</button>' +
        '<button class="aih-attach-opt" onclick="_chpAttachPick(\'file\')">' +
          '<span class="aih-attach-opt-icon">📁</span>File' +
        '</button>' +
      '</div>' +
      '<button class="aih-attach-cancel" onclick="_chpCloseAttach()">Cancel</button>' +
    '</div>';

  sheet.addEventListener('click', function(e) { if (e.target === sheet) _chpCloseAttach(); });
  document.body.appendChild(sheet);
  requestAnimationFrame(function() { sheet.classList.add('open'); });
}

function _chpCloseAttach() {
  var sheet = document.getElementById('chp-attach-sheet');
  if (sheet) sheet.classList.remove('open');
}

function _chpAttachPick(source) {
  _chpCloseAttach();
  var inp = document.getElementById('chp-scan-file');
  if (!inp) return;
  if (source === 'camera') {
    inp.setAttribute('capture', 'environment');
    inp.setAttribute('accept', 'image/*');
  } else if (source === 'gallery') {
    inp.removeAttribute('capture');
    inp.setAttribute('accept', 'image/*');
  } else {
    inp.removeAttribute('capture');
    inp.setAttribute('accept', 'image/*,application/pdf,.pdf');
  }
  setTimeout(function() { inp.click(); }, 120);
}

// Bridge only what's used externally or referenced via a same-file
// onclick/onchange attribute (which always resolves against window,
// never an IIFE's local scope).
window.aihScanFile = aihScanFile;
window.chpOpenScan = chpOpenScan;
window._aihCloseModal = _aihCloseModal;
window._aihImportSaleReport = _aihImportSaleReport;
window._aihImportExtras = _aihImportExtras;
window._aihImportChecked = _aihImportChecked;
window._chpCloseAttach = _chpCloseAttach;
window._chpAttachPick = _chpAttachPick;

})();
