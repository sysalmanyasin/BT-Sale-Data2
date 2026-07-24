// ══════════════════════════════════════════════════════════════════════
// SALES DOMAIN — entry / dashboard / index / diff / report handlers,
// extracted verbatim from ai-bridge.js during the Phase 5
// domain-registry split (AI + CommandHub Build Plan v2, step 5.2).
//
// Same verbatim-move contract as manager-domain.js — see its header.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from '../../repository.js';
import { BTDate } from '../../bt-date.js';
import { _aiTodayStr, _aiCurrentMonthYear } from '../core/ai-datetime.js';
import { registerDomain } from '../core/registry.js';
import { _AI_FIELD_ALIASES } from '../../ai-bridge.js';

export function _aiParseDailyFieldCommand(text) {
  for (const [alias, fieldId] of Object.entries(_AI_FIELD_ALIASES)) {
    const patterns = [
      new RegExp('(?:set|enter|add|note|fill)?\\s*' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?:of\\s+)?(\\d[\\d,]*)', 'i'),
      new RegExp('(\\d[\\d,]*)\\s+(?:in\\s+|for\\s+)?' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (!m) continue;
      const amount = Number(String(m[1] || 0).replace(/,/g, ''));
      if (isNaN(amount)) continue;
      return {
        text: '\u2705 Going to Daily Entry \u2014 setting <b>' + alias + '</b> to <b>\u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
        intent: { action: 'setDailyField', params: [fieldId, Math.round(amount)] },
      };
    }
  }
  return null;
}

export function _aiParseDateReport(text) {
  const t = text.toLowerCase().trim();

  // Must have a report/print/load/show intent trigger
  if (!/print|report|load|open|show|chalao|nikalo|dekhao|dikhao|bata/.test(t)) return null;

  const _SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const _FULL  = ['january','february','march','april','may','june','july','august',
                  'september','october','november','december'];
  const _CAPS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _FNAME = ['January','February','March','April','May','June','July','August',
                  'September','October','November','December'];

  const isPrint = /print|nikalo|chalao/.test(t);
  const label   = isPrint ? 'Printing' : 'Loading';
  const icon    = isPrint ? '🖨️' : '📅';

  // Helper: index from short OR full month string
  function monIdx(raw) {
    const s = raw.toLowerCase();
    let i = _FULL.indexOf(s);
    if (i < 0) i = _SHORT.indexOf(s.slice(0, 3));
    return i;
  }

  // ── 1. Specific day  "21 Oct 2021" / "21/Oct/2021" / "21 October 2021"
  const dayM = text.match(/\b(\d{1,2})[\/\-\s]+([a-z]+)[\/\-\s]+(\d{4})\b/i);
  if (dayM) {
    const mi = monIdx(dayM[2]);
    if (mi >= 0) {
      const dd        = String(parseInt(dayM[1], 10)).padStart(2, '0');
      const yyyy      = dayM[3];
      const dateStr   = dd + '/' + _CAPS[mi] + '/' + yyyy;
      const monthYear = _FNAME[mi] + ' ' + yyyy;
      return {
        text: icon + ' ' + label + ' day report: <b>' + dateStr + '</b>',
        intent: { action: isPrint ? 'printDayReport' : 'openDayModal',
                  params: [dateStr, monthYear] },
      };
    }
  }

  // ── 2. Today / aaj
  if (/\btoday\b|\baaj\b|\baj\b/.test(t)) {
    const dateStr   = (typeof BTDate !== 'undefined') ? BTDate.today()           : _aiTodayStr();
    const monthYear = (typeof BTDate !== 'undefined') ? BTDate.currentMonthYear(): _aiCurrentMonthYear();
    return {
      text: icon + " Today's report: <b>" + dateStr + '</b>',
      intent: { action: isPrint ? 'printDayReport' : 'openDayModal',
                params: [dateStr, monthYear] },
    };
  }

  // ── 3. "This month" / "is mahine" / "current month"
  if (/\bthis month\b|\bis mahine\b|\bcurrent month\b/.test(t)) {
    const monthYear = (typeof BTDate !== 'undefined') ? BTDate.currentMonthYear() : _aiCurrentMonthYear();
    return {
      text: icon + ' ' + label + ' this month: <b>' + monthYear + '</b>',
      intent: { action: isPrint ? 'printMonthReport' : 'openMonthModal',
                params: [monthYear] },
    };
  }

  // ── 4. "Last month" / "pichle mahine"
  if (/\blast month\b|\bpichle mahine\b|\bpichla mahine\b/.test(t)) {
    const d    = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const monthYear = _FNAME[last.getMonth()] + ' ' + last.getFullYear();
    return {
      text: icon + ' ' + label + ' last month: <b>' + monthYear + '</b>',
      intent: { action: isPrint ? 'printMonthReport' : 'openMonthModal',
                params: [monthYear] },
    };
  }

  // ── 5. Month + Year  "October 2021" / "Oct 2021"
  const monYearM = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})\b/i);
  if (monYearM) {
    const mi = monIdx(monYearM[1]);
    if (mi >= 0) {
      const monthYear = _FNAME[mi] + ' ' + monYearM[2];
      return {
        text: icon + ' ' + label + ' report: <b>' + monthYear + '</b>',
        intent: { action: isPrint ? 'printMonthReport' : 'openMonthModal',
                  params: [monthYear] },
      };
    }
  }

  // ── 6. Standalone year  "2022 report" / "yearly 2023" / "yearly report" (no year → current year)
  const yrM = text.match(/\b(20\d{2})\b/);
  if (/year|annual|saal|yearly/.test(t)) {
    const yr = yrM ? yrM[1] : String(new Date().getFullYear());
    return {
      text: '🖨️ Printing yearly report: <b>' + yr + '</b>',
      intent: { action: 'printYearlyReport', params: [yr] },
    };
  }

  return null;
}

export function _aiParseTargetCommand(text) {
  const t = text.toLowerCase().trim();
  // Set target: "set target for June 2026 to 5000000" / "target June 2026 50 lakh"
  const setMatch = text.match(/(?:set|add|update)?\s*target\s+(?:for\s+)?([a-z]+ \d{4})\s+(?:to\s+|=\s*|:?\s*)(\d[\d,.]*\s*(?:lakh|lac)?)/i);
  if (setMatch) {
    let rawAmt = setMatch[2].trim().toLowerCase();
    let amount = parseFloat(rawAmt.replace(/,/g,''));
    if (/lakh|lac/.test(rawAmt)) amount *= 100000;
    if (isNaN(amount) || amount <= 0) return null;
    const mon = setMatch[1].trim();
    return {
      text: '\u2705 Setting monthly target for <b>' + mon + '</b> to <b>\u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'setMonthTarget', params: [mon, Math.round(amount)] },
    };
  }
  // Delete target
  const delMatch = text.match(/(?:delete|remove|clear)\s+target\s+(?:for\s+)?([a-z]+ \d{4})/i);
  if (delMatch) {
    const mon = delMatch[1].trim();
    return {
      text: '\u26a0\ufe0f Delete target for <b>' + mon + '</b>?',
      intent: { action: 'deleteMonthTarget', params: [mon] },
      requiresConfirm: true,
    };
  }
  return null;
}

export function _aiSetDailyField(fieldId, amount) {
  if (typeof showPage === 'function') showPage('entry');
  setTimeout(function () {
    const inp = document.getElementById('e-' + fieldId);
    if (!inp) { if (typeof toast === 'function') toast('\u26a0 Field "'+fieldId+'" not found.', 'w'); return; }
    inp.value = Math.round(Number(amount)||0);
    if (typeof calcTotal === 'function') calcTotal();
    inp.focus(); inp.select();
    inp.style.transition = 'background .4s'; inp.style.background = '#dbeafe';
    setTimeout(function(){inp.style.background='';},2500);
    if (typeof toast === 'function') toast('\u2705 '+fieldId+' set to \u20a8'+Math.round(Number(amount)||0).toLocaleString('en-PK')+'.');
  }, 350);
}

export function _aiSaveNewDailyEntry(isoDate, fields) {
  if (typeof showPage === 'function') showPage('entry');
  setTimeout(function () {
    // Fill date
    const dateEl = document.getElementById('e-date');
    if (dateEl) { dateEl.value = isoDate; if (typeof syncEntryMonthFromDate === 'function') syncEntryMonthFromDate(); }
    // Fill each field
    if (fields && typeof fields === 'object') {
      Object.entries(fields).forEach(function([fid, val]) {
        const inp = document.getElementById('e-' + fid);
        if (inp) {
          inp.value = Math.round(Number(val) || 0);
          inp.style.transition = 'background .3s';
          inp.style.background = '#dbeafe';
          setTimeout(function(){ inp.style.background = ''; }, 2000);
        }
      });
    }
    if (typeof calcTotal === 'function') calcTotal();
    setTimeout(function () {
      if (typeof saveEntry === 'function') saveEntry();
    }, 300);
  }, 350);
}

export function _aiEditDailyEntry(date, monthYear, fieldId, newValue) {
  // Open the edit modal for that date/month, then set the field
  if (typeof showPage === 'function') showPage('data');
  setTimeout(function () {
    if (typeof openEditModal === 'function') openEditModal(date, monthYear);
    setTimeout(function () {
      const safeId = fieldId.replace(/[^a-z0-9]/gi, '_');
      const inp = document.getElementById('em-' + safeId);
      if (inp) {
        inp.value = newValue;
        inp.style.background = '#dbeafe';
        setTimeout(function(){ inp.style.background = ''; }, 2000);
        if (typeof editCalcTotal === 'function') editCalcTotal();
      }
      if (typeof saveEditModal === 'function') saveEditModal();
    }, 400);
  }, 350);
}

export function _aiDeleteDailyEntry(date, monthYear) {
  try {
    if (typeof Repository === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Data not loaded.', 'w'); return; }
    const existed = Repository.getDailyEntry(date, monthYear);
    if (!existed) { if (typeof toast === 'function') toast('\u26a0 Entry not found: ' + date, 'w'); return; }
    Actions.removeDailyEntry(date, monthYear);
    Actions.forgetPendingEntry(date, monthYear);
    Actions.recomputeMonth(monthYear);
    if (typeof renderEntryList === 'function') renderEntryList();
    if (typeof rebuildAll === 'function') rebuildAll();
    if (typeof toast === 'function') toast('\u2705 Entry for ' + date + ' deleted.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Delete failed: ' + e.message, 'w'); }
}

export function _aiSetMonthTarget(monthYear, amount) {
  try {
    const TGT_K = 'bt_targets';
    const t = (function(){ try{return JSON.parse(Repository.getItem(TGT_K)||'{}')}catch{return{}} })();
    t[monthYear] = Math.round(Number(amount) || 0);
    Actions.saveFeatureData(TGT_K, JSON.stringify(t));
    if (typeof renderTargetList === 'function') renderTargetList();
    if (typeof buildDashboard === 'function') buildDashboard();
    if (typeof renderIndex === 'function') renderIndex();
    if (typeof toast === 'function') toast('\u2705 Target for ' + monthYear + ' set to \u20a8' + Math.round(Number(amount)||0).toLocaleString('en-PK') + '.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to set target: ' + e.message, 'w'); }
}

export function _aiDeleteMonthTarget(monthYear) {
  try {
    const TGT_K = 'bt_targets';
    const t = (function(){ try{return JSON.parse(Repository.getItem(TGT_K)||'{}')}catch{return{}} })();
    delete t[monthYear];
    Actions.saveFeatureData(TGT_K, JSON.stringify(t));
    if (typeof renderTargetList === 'function') renderTargetList();
    if (typeof buildDashboard === 'function') buildDashboard();
    if (typeof renderIndex === 'function') renderIndex();
    if (typeof toast === 'function') toast('\u2705 Target for ' + monthYear + ' deleted.');
  } catch (e) { if (typeof toast === 'function') toast('\u26a0 Failed to delete target: ' + e.message, 'w'); }
}

export function _aiSwitchMonth(monthYear) {
  // Try all known month selects
  ['e-month','sal-month-sel','gen-month-sel','exp-month-sel','crd-month-sel','petty-month-sel','inc-month-sel','csec-month-sel'].forEach(function(id) {
    const sel = document.getElementById(id);
    if (sel) { sel.value = monthYear; sel.dispatchEvent(new Event('change')); }
  });
  if (typeof toast === 'function') toast('\u2192 Switched to ' + monthYear + '.');
}


// ── Domain descriptor ───────────────────────────────────────────────
// See manager-domain.js's footer comment — same reasoning applies here.
export const SalesDomain = {
  id: 'sales',
};
registerDomain(SalesDomain);
