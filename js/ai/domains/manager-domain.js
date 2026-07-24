// ══════════════════════════════════════════════════════════════════════
// MANAGER DOMAIN — credit / salary / generic / expense / petty / staff
// handlers, extracted verbatim from ai-bridge.js during the Phase 5
// domain-registry split (AI + CommandHub Build Plan v2, step 5.2).
//
// "Move verbatim first, no behavior change" — every function below is
// byte-identical to its old ai-bridge.js body except for the added
// `export` keyword. ai-bridge.js imports these back by name, so its
// existing switch statement in aiBridgeExecuteIntent() and every call
// site keeps working unchanged.
//
// Not covered by this pass (still in ai-bridge.js, future domain
// candidates per the plan's "additive, not edits-in-place" rule):
// Jazz Cash, Notes & Sheets, AI Memory/Rules, Field Manager, Sync.
// The `tabs` synonym table inside _aiParseNavCommand also stays put —
// it's a two-tier lookup (pages, then tabs) that isn't safe to split
// without touching _aiParseNavCommand itself, which is out of scope
// here.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from '../../repository.js';
import * as LedgerStore from '../../ledger-store.js';
import { LedgerActions } from '../../ledger-actions.js';
import { STAFF } from '../../config.js';
import { _aiTodayStr, _aiCurrentMonthYear, _aiResolveMonth, _aiToIsoDate, _aiIsoMonthOf } from '../core/ai-datetime.js';
import { registerDomain } from '../core/registry.js';

export function _aiFuzzyStaff(rawName) {
  try {
    if (typeof STAFF === 'undefined' || !STAFF.length) return rawName;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(rawName);
    const hit  = STAFF.filter(s => s.active !== false).find(s => {
      const n = norm(s.name);
      return n === t || n.includes(t) || t.includes(n);
    });
    return hit ? hit.name : rawName;
  } catch (_) { return rawName; }
}

export function _aiFuzzyStaffIndex(rawName) {
  try {
    if (typeof STAFF === 'undefined' || !STAFF.length) return -1;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(rawName);
    return STAFF.findIndex(s => {
      const n = norm(s.name);
      return n === t || n.includes(t) || t.includes(n);
    });
  } catch (_) { return -1; }
}

export function _aiParseCreditCommand(text) {
  const t = text.trim();
  const pats = [
    /(?:note|add|record|enter|log|do)?\s*(?:credit|advance|loan|qarz)\s+(?:of\s+)?(\d[\d,]*)\s+(?:for|to|ko)\s+(.+)/i,
    /(?:note|add|record|enter|log|do)?\s*(?:credit|advance|loan|qarz)\s+(?:for|to|ko)\s+(.+?)\s+(?:of\s+)?(\d[\d,]*)/i,
    /^([a-zA-Z\u0600-\u06FF ]+?)\s+(?:ko|ka)?\s*(?:credit|advance|loan|qarz)\s+(?:of\s+)?(\d[\d,]*)/i,
    /^(\d[\d,]*)\s+(?:credit|advance|loan)\s+(?:for|to|ko)\s+(.+)/i,
    /(.+?)\s+(?:ko)\s+(\d[\d,]*)\s+(?:credit|advance|loan|qarz)/i,
  ];
  for (let pi = 0; pi < pats.length; pi++) {
    const m = t.match(pats[pi]);
    if (!m) continue;
    let rawName, rawAmt;
    if (pi === 0 || pi === 3) { rawAmt = m[1]; rawName = m[2]; }
    else if (pi === 1)         { rawName = m[1]; rawAmt = m[2]; }
    else if (pi === 2)         { rawName = m[1]; rawAmt = m[2]; }
    else                       { rawName = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    const name   = (rawName || '').trim();
    if (!name || isNaN(amount) || amount <= 0) continue;
    const matchedName = _aiFuzzyStaff(name);
    const amtFmt = Math.round(amount).toLocaleString('en-PK');
    return {
      text: '\u2705 Adding credit \u20a8' + amtFmt + ' for <b>' + matchedName + '</b> today (' + _aiTodayStr() + ').',
      intent: { action: 'addCredit', params: [matchedName, Math.round(amount), 'credit', _aiTodayStr()] },
    };
  }
  return null;
}

export function _aiParseCreditQuery(text) {
  const pats = [
    /(.+?)(?:'s|ka|ki)?\s+(?:credit|advance|balance|baqi|kitna|kya|udhaar)(?:\s+kitna|\s+kya|\s+hai|\s+check|\s+batao|\s+dekho)?/i,
    /(?:what(?:'s|\s+is)|check|show|batao|dekho|tell me)\s+(.+?)(?:'s|ka|ki)?\s+(?:credit|balance|advance|udhaar)/i,
    /(?:credit|balance|advance|udhaar)\s+(?:of|for|ka)\s+(.+)/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const matchedName = _aiFuzzyStaff(name);
    const result = _aiReadCreditBalance(matchedName);
    if (result) return { text: result, intent: null };
  }
  return null;
}

export function _aiReadStaffInfo(rawName) {
  try {
    if (typeof STAFF === 'undefined' || !STAFF.length) return null;
    const idx = _aiFuzzyStaffIndex(rawName);
    if (idx === -1) return null;
    const e = STAFF[idx];
    const sid = e.staffId || ('EMP-' + String(idx + 1).padStart(3, '0'));
    const status = e.active !== false ? 'Active' : 'Inactive';
    let out = '<b>' + (e.name || '(unnamed)') + '</b> (' + sid + ')<br>';
    out += '\u2022 Designation: ' + (e.designation || '\u2014') + '<br>';
    out += '\u2022 Status: ' + status + '<br>';
    if (e.fatherName) out += '\u2022 Father Name: ' + e.fatherName + '<br>';
    if (e.cnic)       out += '\u2022 CNIC: ' + e.cnic + '<br>';
    if (e.phone)      out += '\u2022 Phone: ' + e.phone + '<br>';
    if (e.bloodGroup) out += '\u2022 Blood Group: ' + e.bloodGroup;
    return out;
  } catch (_) { return null; }
}

export function _aiParseStaffQuery(text) {
  const pats = [
    /(?:who is|details? of|info(?:rmation)? (?:on|of|about))\s+(.+)/i,
    /(.+?)(?:'s|ka|ki)?\s+(?:phone|number|cnic|designation|details?|info)(?:\s+number)?(?:\s+hai|\s+batao|\s+dekho)?$/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const result = _aiReadStaffInfo(name);
    if (result) return { text: result, intent: null };
  }
  return null;
}

export function _aiReadCreditBalance(name) {
  try {
    let crdData = (typeof _crdData_cur !== 'undefined' && _crdData_cur && _crdData_cur.length)
      ? _crdData_cur : null;
    if (!crdData && typeof mgrLoad === 'function') {
      const d = mgrLoad();
      if (d && d.credit) {
        const months = Object.keys(d.credit);
        if (months.length) crdData = d.credit[months[months.length - 1]];
      }
    }
    if (!crdData || !crdData.length) return null;
    const norm = s => (s || '').trim().toLowerCase();
    const t    = norm(name);
    const emp  = crdData.find(e => { const n = norm(e.name); return n === t || n.includes(t) || t.includes(n); });
    if (!emp) return null;
    const nv     = v => Math.round(Number(v) || 0);
    const total  = emp.entries.reduce((s, e) => s + nv(e.amount), 0);
    const net    = nv(emp.prevBal) + total - nv(emp.salary) - nv(emp.lessGeneric);
    const absAmt = Math.abs(net).toLocaleString('en-PK');
    let status;
    if (net > 0)      status = '<b>' + emp.name + '</b> owes <b>\u20a8' + absAmt + '</b> (credit outstanding).';
    else if (net < 0) status = '<b>' + emp.name + '</b> has <b>\u20a8' + absAmt + '</b> over-settled.';
    else              status = '<b>' + emp.name + '</b> is fully settled \u2014 zero balance.';
    const recent = emp.entries.slice(-3).map(e => '\u2022 ' + e.date + ': ' + (e.desc || '?') + ' \u20a8' + Math.abs(nv(e.amount)).toLocaleString('en-PK')).join('<br>');
    return status + (recent ? '<br><em style="font-size:11px;color:var(--muted)">Recent:</em><br>' + recent : '');
  } catch (_) { return null; }
}

export function _aiParseExpenseCommand(text) {
  const expPats = [
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(?:for\s+)?(.+?)\s+(?:of\s+)?(\d[\d,]*)/i,
    /(?:add|note|record|enter|log)?\s*(?:expense|kharcha|kharch)\s+(\d[\d,]*)\s+(?:for\s+)?(.+)/i,
  ];
  for (let pi = 0; pi < expPats.length; pi++) {
    const m = text.match(expPats[pi]);
    if (!m) continue;
    let desc, rawAmt;
    if (pi === 1) { rawAmt = m[1]; desc = m[2]; }
    else          { desc = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    desc = (desc || '').trim();
    if (!desc || isNaN(amount) || amount <= 0) continue;
    const dl = desc.toLowerCase();
    let bill = 0, fuel = 0, soap = 0, refresh = 0, extra = 0;
    if (/bill|bijli|electric|water|gas|utility/.test(dl))        bill    = Math.round(amount);
    else if (/fuel|petrol|diesel|oil/.test(dl))                  fuel    = Math.round(amount);
    else if (/soap|tissue|clean|washing/.test(dl))               soap    = Math.round(amount);
    else if (/tea|chai|refresh|lunch|food|khana|snack/.test(dl)) refresh = Math.round(amount);
    else                                                          extra   = Math.round(amount);
    return {
      text: '\u2705 Adding expense: <b>' + desc + ' \u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'addExpense', params: [_aiTodayStr(), desc, bill, fuel, soap, refresh, extra, 0] },
    };
  }
  return null;
}

export function _aiParsePettyCommand(text) {
  const pats = [
    /(?:add|note|record|enter)?\s*(?:patty|petty)\s+(?:detail|item|cash)?\s+(?:item\s+)?(.+?)\s+(\d[\d,]*)/i,
    /(?:add|note|record|enter)?\s*(?:patty|petty)\s+(\d[\d,]*)\s+(?:for\s+)?(.+)/i,
  ];
  for (let pi = 0; pi < pats.length; pi++) {
    const m = text.match(pats[pi]);
    if (!m) continue;
    let desc, rawAmt;
    if (pi === 1) { rawAmt = m[1]; desc = m[2]; }
    else          { desc = m[1]; rawAmt = m[2]; }
    const amount = Number(String(rawAmt || 0).replace(/,/g, ''));
    desc = (desc || '').trim();
    if (!desc || isNaN(amount) || amount <= 0) continue;
    return {
      text: '\u2705 Adding petty item: <b>' + desc + ' \u20a8' + Math.round(amount).toLocaleString('en-PK') + '</b>.',
      intent: { action: 'addPettyItem', params: [desc, Math.round(amount), ''] },
    };
  }
  return null;
}

export function _aiReadExpenseSummary(monthStr) {
  try {
    if (typeof LedgerStore === 'undefined') return null;
    const opening = LedgerStore.getOpeningBalance('expense');
    const all = LedgerStore.getEntries('expense');
    const rows = all.filter(e => _aiIsoMonthOf(e.date) === monthStr);
    if (!rows.length) return '<b>' + monthStr + ':</b> No expense data found.';
    const cats = LedgerStore.getCategoryList('expense');
    const sumCat = id => rows.filter(r => r.categoryId === id).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const totBill = sumCat('bill'), totFuel = sumCat('fuel'), totSoap = sumCat('soap'),
          totRef  = sumCat('refresh'), totExt = sumCat('extra'), totHO = sumCat('pattyHO'),
          totGuard = sumCat('guardIncentive');
    const totalExp = totBill + totFuel + totSoap + totRef + totExt + totGuard;
    // Sign convention (flipped per explicit request): expenses ADD to
    // the balance, HO Received SUBTRACTS from it — matches
    // LEDGER_CATEGORIES.expense in ledger-store.js.
    const balance = opening + totalExp - totHO;
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    let out = '<b>Expenses \u2014 ' + monthStr + '</b><br>';
    out += '\u2022 Opening Patty: ' + fmt(opening) + '<br>';
    out += '\u2022 HO Received: ' + fmt(totHO) + '<br>';
    out += '\u2022 Total Expenses: ' + (totalExp < 0 ? '-' : '') + fmt(totalExp) + '<br>';
    out += '\u2022 Current Balance: ' + (balance < 0 ? '-' : '') + fmt(balance);
    return out;
  } catch (_) { return null; }
}

export function _aiParseExpenseQuery(text) {
  const pats = [
    /(?:total\s+)?expenses?\s+(?:summary\s+)?(?:for\s+|of\s+|in\s+)?(this month|last month|[a-z]+(?:\s+\d{4})?)/i,
    /(?:what(?:'s|\s+is)|show|check|batao|dekho)\s+(?:our\s+|the\s+)?(?:total\s+)?expenses?/i,
    /expense\s+balance/i,
    /current\s+(?:patty\s+)?balance/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const month = _aiResolveMonth(text);
    const result = _aiReadExpenseSummary(month);
    if (result) return { text: result, intent: null };
  }
  return null;
}

export function _aiReadNetSalary(rawName, monthStr) {
  try {
    const data = mgrLoad();
    const rows = (data.salary && data.salary[monthStr]) || [];
    if (!rows.length) return null;
    const norm = s => (s || '').trim().toLowerCase();
    const t = norm(rawName);
    const r = rows.find(x => { const n = norm(x.name); return n === t || n.includes(t) || t.includes(n); });
    if (!r) return null;
    const net = _ni(r.hoSal) - _ni(r.advance) + _ni(r.generic);
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    let out = '<b>' + r.name + '</b> \u2014 ' + monthStr + '<br>';
    out += '\u2022 HO Salary: ' + fmt(r.hoSal) + '<br>';
    out += '\u2022 Advance: ' + fmt(r.advance) + '<br>';
    out += '\u2022 Generic: ' + fmt(r.generic) + '<br>';
    out += '\u2022 <b>Net Salary: ' + (net < 0 ? '-' : '') + fmt(net) + '</b>';
    return out;
  } catch (_) { return null; }
}

export function _aiReadTotalSalaryPayout(monthStr) {
  try {
    const data = mgrLoad();
    const rows = (data.salary && data.salary[monthStr]) || [];
    if (!rows.length) return '<b>' + monthStr + ':</b> No salary data found.';
    const totNet = rows.reduce((s, r) => s + (_ni(r.hoSal) - _ni(r.advance) + _ni(r.generic)), 0);
    const totAdv = rows.reduce((s, r) => s + _ni(r.advance), 0);
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    return '<b>Salary \u2014 ' + monthStr + '</b><br>\u2022 Total Advance: ' + fmt(totAdv) + '<br>\u2022 <b>Total Net Payout: ' + (totNet < 0 ? '-' : '') + fmt(totNet) + '</b>';
  } catch (_) { return null; }
}

export function _aiParseSalaryQuery(text) {
  if (/total\s+(?:salary|payout)/i.test(text)) {
    const month = _aiResolveMonth(text);
    const result = _aiReadTotalSalaryPayout(month);
    if (result) return { text: result, intent: null };
  }
  const pats = [
    /(.+?)(?:'s|ka|ki)?\s+(?:net\s+)?salary(?:\s+kitna|\s+kya|\s+hai|\s+batao|\s+dekho)?/i,
    /(?:what(?:'s|\s+is)|check|show|batao|dekho)\s+(.+?)(?:'s|ka|ki)?\s+(?:net\s+)?salary/i,
    /salary\s+(?:of|for|ka)\s+(.+)/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const matchedName = _aiFuzzyStaff(name);
    const month = _aiResolveMonth(text);
    const result = _aiReadNetSalary(matchedName, month);
    if (result) return { text: result, intent: null };
  }
  return null;
}

export function _aiReadGenericDetail(rawName, monthStr) {
  try {
    const data = mgrLoad();
    const rows = (data.generic && data.generic[monthStr]) || [];
    if (!rows.length) return null;
    const norm = s => (s || '').trim().toLowerCase();
    const t = norm(rawName);
    const r = rows.find(x => { const n = norm(x.name); return n === t || n.includes(t) || t.includes(n); });
    if (!r) return null;
    const inc = Math.round(_ni(r.genericSale) * 0.04);
    const fin = inc + _ni(r.extra);
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    let out = '<b>' + r.name + '</b> \u2014 ' + monthStr + '<br>';
    out += '\u2022 Generic Sale: ' + fmt(r.genericSale) + '<br>';
    out += '\u2022 Incentive (4%): ' + fmt(inc) + '<br>';
    out += '\u2022 Extra: ' + fmt(r.extra) + '<br>';
    out += '\u2022 <b>Final: ' + fmt(fin) + '</b>';
    return out;
  } catch (_) { return null; }
}

export function _aiReadTotalIncentive(monthStr) {
  try {
    const data = mgrLoad();
    const rows = (data.generic && data.generic[monthStr]) || [];
    if (!rows.length) return '<b>' + monthStr + ':</b> No generic working data found.';
    const totSale = rows.reduce((s, r) => s + _ni(r.genericSale), 0);
    const totInc  = rows.reduce((s, r) => s + Math.round(_ni(r.genericSale) * 0.04), 0);
    const totFin  = rows.reduce((s, r) => s + Math.round(_ni(r.genericSale) * 0.04) + _ni(r.extra), 0);
    const fmt = v => '\u20a8' + Math.abs(Math.round(v)).toLocaleString('en-PK');
    return '<b>Generic Working \u2014 ' + monthStr + '</b><br>\u2022 Total Generic Sale: ' + fmt(totSale) + '<br>\u2022 Total Incentive: ' + fmt(totInc) + '<br>\u2022 <b>Total Final: ' + fmt(totFin) + '</b>';
  } catch (_) { return null; }
}

export function _aiParseGenericQuery(text) {
  if (/total\s+(?:incentive|generic)/i.test(text)) {
    const month = _aiResolveMonth(text);
    const result = _aiReadTotalIncentive(month);
    if (result) return { text: result, intent: null };
  }
  const pats = [
    /(.+?)(?:'s|ka|ki)?\s+(?:generic\s+sale|generic|incentive)(?:\s+kitna|\s+kya|\s+hai|\s+batao|\s+dekho)?/i,
    /(?:what(?:'s|\s+is)|check|show|batao|dekho)\s+(.+?)(?:'s|ka|ki)?\s+(?:generic|incentive)/i,
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m) continue;
    const name = (m[1] || '').trim();
    if (!name || name.length < 2) continue;
    const matchedName = _aiFuzzyStaff(name);
    const month = _aiResolveMonth(text);
    const result = _aiReadGenericDetail(matchedName, month);
    if (result) return { text: result, intent: null };
  }
  return null;
}

export function _aiAddCreditEntry(rawName, rawAmount, rawDesc, rawDate) {
  const amount  = Math.round(Number(rawAmount) || 0);
  const desc    = rawDesc  || 'credit';
  const dateStr = rawDate  || _aiTodayStr();
  const norm    = s => (s || '').trim().toLowerCase();
  const target  = norm(rawName);
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined' || !_crdData_cur) {
        if (typeof toast === 'function') toast('\u26a0 Credit data not loaded — try again.', 'w'); return;
      }
      const ei = _crdData_cur.findIndex(function (e) {
        const n = norm(e.name); return n === target || n.includes(target) || target.includes(n);
      });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + rawName + '" not found in Credit sheet.', 'w'); return; }
      _crdData_cur[ei].entries.push({ date: dateStr, desc: desc, amount: amount });
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      setTimeout(function () {
        const body = document.getElementById('crd-body-' + ei);
        const chev = document.getElementById('crd-chev-' + ei);
        if (body) body.style.display = '';
        if (chev) chev.style.transform = 'rotate(90deg)';
        const el = document.getElementById('crd-emp-' + ei);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.style.transition = 'box-shadow .4s'; el.style.boxShadow = '0 0 0 3px var(--green)'; setTimeout(function () { el.style.boxShadow = ''; }, 2200); }
        // Closed-loop: read back the new net balance
        const emp = _crdData_cur[ei];
        const nv = v => Math.round(Number(v) || 0);
        const newTotal = emp.entries.reduce((s, e) => s + nv(e.amount), 0);
        const newNet = nv(emp.prevBal) + newTotal - nv(emp.salary) - nv(emp.lessGeneric);
        if (typeof toast === 'function') toast('\u2705 Credit \u20a8' + amount.toLocaleString('en-PK') + ' added for ' + emp.name + ' \u2014 balance now \u20a8' + Math.abs(newNet).toLocaleString('en-PK') + (newNet > 0 ? ' owed' : ' settled') + '.');
      }, 120);
    }, 280);
  }, 280);
}

export function _aiAddExpenseRow(date, desc, bill, fuel, soap, refresh, extra, pattyHO, guardIncentive) {
  if (typeof LedgerActions === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Ledger not available.', 'w'); return; }
  const d = _aiToIsoDate(date);
  const fields = [
    ['bill', bill], ['fuel', fuel], ['soap', soap],
    ['refresh', refresh], ['extra', extra], ['pattyHO', pattyHO],
    ['guardIncentive', guardIncentive],
  ];
  let total = 0, added = 0;
  fields.forEach(([categoryId, val]) => {
    const amount = Math.round(Number(val) || 0);
    if (!amount) return;
    LedgerActions.addEntry('expense', { date: d, categoryId, amount, desc: desc || '' });
    total += (categoryId === 'pattyHO') ? 0 : amount; // pattyHO is an inflow, not part of the expense total
    added++;
  });
  if (!added) { if (typeof toast === 'function') toast('\u26a0 No nonzero expense amounts given.', 'w'); return; }
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('expense');
    if (typeof toast === 'function') toast('\u2705 Expense added: ' + (desc || 'entry') + ' \u20a8' + total.toLocaleString('en-PK') + ' \u2014 saved.');
  }, 250);
}

export function _aiAddPettyItem(desc, amount, period) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined') {
        if (typeof toast === 'function') toast('\u26a0 Petty data not loaded — try again.', 'w'); return;
      }
      if (!_pettyData.groups) _pettyData.groups = [];
      if (!_pettyData.groups.length) _pettyData.groups.push({ period: period || _aiCurrentMonthYear(), rows: [] });
      const gi = _pettyData.groups.length - 1;
      _pettyData.groups[gi].rows.push({ desc: desc || '', amount: Math.round(Number(amount)||0) });
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData    === 'function') savePettyData();
      setTimeout(function () {
        const grp = document.getElementById('petty-grp-'+gi);
        if (grp) { grp.scrollIntoView({behavior:'smooth',block:'start'}); grp.style.transition='box-shadow .4s'; grp.style.boxShadow='0 0 0 3px var(--accent)'; setTimeout(function(){grp.style.boxShadow='';},2200); }
        if (typeof toast === 'function') toast('\u2705 Petty item: '+(desc||'item')+' \u20a8'+Math.round(Number(amount)||0).toLocaleString('en-PK')+' \u2014 saved.');
      }, 120);
    }, 280);
  }, 280);
}

export function _aiPrintMgrReport(type) {
  if (typeof showPage === 'function') showPage('manager');
  const fnMap = {
    credit:    function(){if(typeof switchMgrTab==='function')switchMgrTab('credit');setTimeout(function(){if(typeof printCreditReport==='function')printCreditReport();},300);},
    salary:    function(){if(typeof switchMgrTab==='function')switchMgrTab('salary');setTimeout(function(){if(typeof printSalaryReport==='function')printSalaryReport();},300);},
    generic:   function(){if(typeof switchMgrTab==='function')switchMgrTab('generic');setTimeout(function(){if(typeof printGenericReport==='function')printGenericReport();},300);},
    // FOUND IN DEEP AUDIT: this called printExpenseReport(), a function
    // that never existed anywhere in this codebase — the typeof guard
    // meant it silently did nothing (tab switched, nothing printed, no
    // error). hubPrintExpenseSummary (hub-actions.js) is the real,
    // now-fixed Ledger-backed expense report — same one the CommandHub
    // "Expense Summary" quick chip uses.
    expense:   function(){if(typeof switchMgrTab==='function')switchMgrTab('expense');setTimeout(function(){if(typeof hubPrintExpenseSummary==='function')hubPrintExpenseSummary();},300);},
    petty:     function(){if(typeof switchMgrTab==='function')switchMgrTab('petty');setTimeout(function(){if(typeof printPettyReport==='function')printPettyReport();},300);},
    incentive: function(){if(typeof switchMgrTab==='function')switchMgrTab('incentive');setTimeout(function(){if(typeof printIncentiveReport==='function')printIncentiveReport();},300);},
    month:     function(){if(typeof printMonthReport==='function')printMonthReport();},
    year:      function(){if(typeof printYearlyReport==='function')printYearlyReport();},
  };
  setTimeout(function(){const fn=fnMap[type];if(fn)fn();},300);
}

export function _aiAddStaff(name, designation) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof STAFF === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Staff data not loaded.', 'w'); return; }
      const newEmp = Actions.addEmployee({ name: name || '', designation: designation || 'Salesman' });
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (name) setTimeout(function(){ if (typeof openStaffCard === 'function') openStaffCard(Repository.getStaff().length - 1); }, 200);
      if (typeof toast === 'function') toast('\u2705 Staff added: ' + (newEmp.name || 'New Employee') + ' \u2014 ID: ' + newEmp.staffId);
    }, 280);
  }, 280);
}

export function _aiDeactivateStaff(nameOrIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
      const staff = Repository.getStaff();
      if (i === -1 || !staff[i]) { if (typeof toast === 'function') toast('\u26a0 Staff "' + nameOrIndex + '" not found.', 'w'); return; }
      const updated = Actions.updateEmployee(i, { active: false });
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + updated.name + ' deactivated \u2014 they won\'t appear in new months.');
    }, 280);
  }, 280);
}

export function _aiReactivateStaff(nameOrIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
      const staff = Repository.getStaff();
      if (i === -1 || !staff[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
      const updated = Actions.updateEmployee(i, { active: true });
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + updated.name + ' reactivated.');
    }, 280);
  }, 280);
}

export function _aiDeleteStaff(nameOrIndex) {
  const staff = Repository.getStaff();
  const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
  if (i === -1 || !staff[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
  const removed = Actions.removeEmployee(i);
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + removed.name + ' removed from staff list.');
    }, 280);
  }, 280);
}

export function _aiEditStaffField(nameOrIndex, field, value) {
  const i = typeof nameOrIndex === 'number' ? nameOrIndex : _aiFuzzyStaffIndex(nameOrIndex);
  const staff = Repository.getStaff();
  if (i === -1 || !staff[i]) { if (typeof toast === 'function') toast('\u26a0 Staff not found.', 'w'); return; }
  // Route through Actions (like _aiReactivateStaff/_aiDeleteStaff above) instead
  // of mutating STAFF[i][field] directly — that raw form bypassed the write-guard
  // undetected (the config.js Proxy only traps the STAFF array itself, not
  // properties on an already-referenced element) and skipped the staff:updated
  // EventBus notification that other subscribers rely on.
  const updated = Actions.updateEmployee(i, { [field]: value });
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('staff');
    setTimeout(function () {
      if (typeof renderStaffRegistry === 'function') renderStaffRegistry();
      if (typeof saveStaffRegistry === 'function') saveStaffRegistry();
      if (typeof toast === 'function') toast('\u2705 ' + updated.name + ' \u2014 ' + field + ' updated to: ' + value);
    }, 280);
  }, 280);
}

export function _aiAddSalaryRow(name, designation, hoSal, advance, generic) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const _nowD = new Date();
      const _daysInMonth = new Date(_nowD.getFullYear(), _nowD.getMonth() + 1, 0).getDate();
      _salRows_cur.push({ name: name || '', desig: designation || 'Salesman', days: _daysInMonth, hoSal: Math.round(Number(hoSal)||0), advance: Math.round(Number(advance)||0), generic: Math.round(Number(generic)||0) });
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 Salary row added for ' + (name || 'new employee') + '.');
    }, 280);
  }, 280);
}

export function _aiEditSalaryRow(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _salRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found in salary sheet.', 'w'); return; }
      _salRows_cur[i][field] = Math.round(Number(value) || 0);
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 ' + staffName + ' \u2014 ' + field + ' updated to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

export function _aiDeleteSalaryRow(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('salary');
    setTimeout(function () {
      if (typeof _salRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Salary data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _salRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _salRows_cur[i].name;
      _salRows_cur.splice(i, 1);
      if (typeof renderSalaryTable === 'function') renderSalaryTable(_salRows_cur);
      if (typeof saveSalaryData === 'function') saveSalaryData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from salary sheet.');
    }, 280);
  }, 280);
}

export function _aiAddGenericRow(name, designation, genericSale, extra) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      _genRows_cur.push({ name: name || '', desig: designation || 'Salesman', genericSale: Math.round(Number(genericSale)||0), extra: Math.round(Number(extra)||0) });
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 Generic row added for ' + (name || 'new employee') + '.');
    }, 280);
  }, 280);
}

export function _aiEditGenericRow(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _genRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found in generic sheet.', 'w'); return; }
      _genRows_cur[i][field] = Math.round(Number(value) || 0);
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 ' + staffName + ' generic ' + field + ' updated to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

export function _aiDeleteGenericRow(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('generic');
    setTimeout(function () {
      if (typeof _genRows_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Generic data not loaded.', 'w'); return; }
      const norm = s => (s || '').trim().toLowerCase();
      const t    = norm(staffName);
      const i    = _genRows_cur.findIndex(function(r){ const n = norm(r.name); return n === t || n.includes(t) || t.includes(n); });
      if (i === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _genRows_cur[i].name;
      _genRows_cur.splice(i, 1);
      if (typeof renderGenericTable === 'function') renderGenericTable(_genRows_cur);
      if (typeof saveGenericData === 'function') saveGenericData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from generic sheet.');
    }, 280);
  }, 280);
}

export function _aiAddCreditEmployee(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      _crdData_cur.push({ name: staffName || 'New Employee', prevBal: 0, entries: [], salary: 0, lessGeneric: 0 });
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + (staffName || 'New employee') + ' added to credit ledger.');
    }, 280);
  }, 280);
}

export function _aiDeleteCreditEntry(staffName, entryIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      if (!_crdData_cur[ei].entries[entryIndex]) { if (typeof toast === 'function') toast('\u26a0 Entry index out of range.', 'w'); return; }
      _crdData_cur[ei].entries.splice(entryIndex, 1);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 Credit entry deleted for ' + _crdData_cur[ei].name + '.');
    }, 280);
  }, 280);
}

export function _aiDeleteCreditEmployee(staffName) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      const name = _crdData_cur[ei].name;
      _crdData_cur.splice(ei, 1);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + name + ' removed from credit ledger.');
    }, 280);
  }, 280);
}

export function _aiSetCreditEmpField(staffName, field, value) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('credit');
    setTimeout(function () {
      if (typeof _crdData_cur === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Credit data not loaded.', 'w'); return; }
      const norm = s => (s||'').trim().toLowerCase();
      const t    = norm(staffName);
      const ei   = _crdData_cur.findIndex(function(e){ const n=norm(e.name); return n===t||n.includes(t)||t.includes(n); });
      if (ei === -1) { if (typeof toast === 'function') toast('\u26a0 "' + staffName + '" not found.', 'w'); return; }
      _crdData_cur[ei][field] = Math.round(Number(value) || 0);
      if (typeof renderCreditLedger === 'function') renderCreditLedger(_crdData_cur);
      if (typeof saveCreditData === 'function') saveCreditData();
      if (typeof toast === 'function') toast('\u2705 ' + _crdData_cur[ei].name + ' ' + field + ' set to \u20a8' + Math.round(Number(value)||0).toLocaleString('en-PK') + '.');
    }, 280);
  }, 280);
}

export function _aiAddPettyGroup(period) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined') { if (typeof toast === 'function') toast('\u26a0 Petty data not loaded.', 'w'); return; }
      if (!_pettyData.groups) _pettyData.groups = [];
      _pettyData.groups.push({ period: period || _aiCurrentMonthYear(), rows: [] });
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty group added for ' + (period || _aiCurrentMonthYear()) + '.');
    }, 280);
  }, 280);
}

export function _aiDeletePettyRow(groupIndex, rowIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined' || !_pettyData.groups || !_pettyData.groups[groupIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty group not found.', 'w'); return; }
      const rows = _pettyData.groups[groupIndex].rows;
      if (!rows || !rows[rowIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty row not found.', 'w'); return; }
      const desc = rows[rowIndex].desc;
      rows.splice(rowIndex, 1);
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty item deleted: ' + desc);
    }, 280);
  }, 280);
}

export function _aiDeletePettyGroup(groupIndex) {
  if (typeof showPage === 'function') showPage('manager');
  setTimeout(function () {
    if (typeof switchMgrTab === 'function') switchMgrTab('petty');
    setTimeout(function () {
      if (typeof _pettyData === 'undefined' || !_pettyData.groups || !_pettyData.groups[groupIndex]) { if (typeof toast === 'function') toast('\u26a0 Petty group not found.', 'w'); return; }
      const period = _pettyData.groups[groupIndex].period;
      _pettyData.groups.splice(groupIndex, 1);
      if (typeof renderPettyGroups === 'function') renderPettyGroups();
      if (typeof savePettyData === 'function') savePettyData();
      if (typeof toast === 'function') toast('\u2705 Petty group "' + period + '" deleted.');
    }, 280);
  }, 280);
}


// ── Domain descriptor ───────────────────────────────────────────────
// No pageSynonyms/quickActions/getContextSummary yet — Manager's nav
// synonyms are the `tabs` table still in ai-bridge.js (see header
// comment above), and it has no CommandHub quick-actions or context
// summary contribution today. Registered anyway so `listDomains()`
// accounts for it and future additions (quickActions, context) are
// additive edits to this one file, per rule 5.4.
export const ManagerDomain = {
  id: 'manager',
};
registerDomain(ManagerDomain);
