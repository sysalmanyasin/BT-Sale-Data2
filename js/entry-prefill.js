// ══════════════════════════════════════════════════════════════════════
// ENTRY PREFILL — Add Entry (js/data-page.js, #page-entry) auto-fill from
// Closing's own Supabase data.
//
// Closing (closing.duapharma.com) already pushes every shift to the SAME
// Supabase project this app uses (js/sync.js there, table `sheets`, no
// separate credentials needed) — so instead of retyping numbers a
// cashier already entered in Closing, we read them straight back.
//
// What this DOES prefill, and why it's safe to:
//   - Cash Sale, Bank Alfalah, Bank Alfalah 2 (Keenu) — Closing's
//     inSysCash/inAlfalah/inKeenu are cumulative POS-counter readings
//     that reset once per calendar day, not per shift. That means the
//     LAST shift of the day (Evening — see Closing's README, shift order
//     is Night → Morning → Evening) already holds the full day's total.
//     Verified against two real days (16 & 17 Aug 2026): Evening's raw
//     readings matched the saved Sale Report's Cash Sale / Alfala Bank /
//     custom_Bank_Alfalah_2 exactly, to the rupee.
//   - Cash Returns — unlike the counters above, System Return
//     (posRetSys) is entered per-shift as it happens, so this sums it
//     across every shift synced for that date rather than taking Evening
//     alone (verified: 17 Aug's 50,906 came entirely from the Morning
//     shift, 0 on Evening).
//
// What this deliberately does NOT prefill:
//   - Customers, FDPP, FDPP Con — checked Closing's per-shift `outCust`
//     (sum doesn't match the saved report on either sample day) and the
//     bt-sale-data-rebuild project's daily_sales table (stale, stopped
//     syncing 7 Aug 2026) — no live source currently exists for these.
//     Left fully manual; see the toast this fires.
//   - Every named credit-client column (PSO/LDA/Askari/etc.) — by
//     request, left to manual entry / Sale Payments cross-check rather
//     than guessing a customer-name-to-column match here.
//
// Total Sale (→ COMP SALE) and Credit Customers come from a second,
// separate source: Sale Payments' own bridge (js/sale-payments-bridge.js,
// project vtcrdkqhuvxatclobsby — same live source the Sale Payments tab
// itself reads, NOT the bt-sale-data-rebuild project used only to spot-
// check numbers during development). Reused directly via that bridge's
// existing window.salePaymentsBridge* functions rather than opening a
// second client — one cache, one source of truth. Per that bridge's own
// header note, it's a fixed "today + last 3 days" snapshot, so dates
// older than that will simply come back empty (handled the same way as
// no-Closing-data-yet: silently skipped, not an error).
//
// Credit customer name → this app's fixed column mapping is a plain
// substring match against every customer name Sale Payments has ever
// sent (checked live: only "Askari General Insurance Company Ltd.",
// "Lahore Development Authority ( LDA )" and "PARCO" so far) plus the
// rest of DAILY_ADD_KEYS' named clients for when new ones show up.
// Amounts are rounded to the nearest rupee (Sale Payments' credit_amount
// is a real decimal, e.g. 15306.54) to match this app's whole-rupee
// fields. Any customer name that doesn't match anything is left out and
// named in the toast so it's never silently dropped.
// ══════════════════════════════════════════════════════════════════════
(function() {
'use strict';

const CREDIT_NAME_MAP = [
  [/askari/i,            'Askari_Bank'],
  [/\bpso\b/i,            'PSO'],
  [/nespak/i,            'NESPAK'],
  [/\bparco\b/i,          'PARCO'],
  [/\btepa\b/i,           'TEPA'],
  [/lahore development|\blda\b/i, 'LDA'],
  [/gourmet/i,           'Gourmet'],
  [/wapda/i,             'Wapda_Hospital'],
  [/\bbth\b/i,            'BTH'],
  [/berger/i,            'Berger_Paints'],
  [/ecolean/i,           'Ecolean_PK'],
  [/style textile/i,     'Style_Textile'],
  [/babar ali/i,         'Syed_Babar_Ali'],
  [/rahnuma/i,           'Rahnuma_NGO'],
  [/health pass/i,       'Health_Pass'],
  [/nisar/i,             'Nisar_Spinning'],
  [/food panda/i,        'Food_Panda']
];

function _matchCreditField(customerName) {
  const hit = CREDIT_NAME_MAP.find(([re]) => re.test(customerName || ''));
  return hit ? hit[1] : null;
}

async function fetchSalePaymentsDay(dateIso) {
  if (typeof window.salePaymentsBridgeRefresh !== 'function') return null;
  try { await window.salePaymentsBridgeRefresh(false); } catch (e) { /* fall back to cache below */ }
  const full = typeof window.salePaymentsBridgeGetFullData === 'function' ? window.salePaymentsBridgeGetFullData() : null;
  if (!full) return null;

  const summary = (full.paymentSummary || []).find(r => r.saleDay === dateIso);
  const creditRows = (full.creditByCustomer || []).filter(r => r.saleDay === dateIso);
  if (!summary && !creditRows.length) return null;

  const matched = [];
  const unmatched = [];
  creditRows.forEach(r => {
    const fieldId = _matchCreditField(r.customerName);
    if (fieldId) matched.push({ fieldId, amount: Math.round(r.creditAmount) });
    else unmatched.push(r.customerName);
  });

  return {
    totalSale: summary ? Math.round(summary.totalSale) : null,
    matchedCredits: matched,
    unmatchedCredits: unmatched
  };
}

// Ownership tracking: fields prefill sets are marked data-prefill-owned="1"
// so a later prefill run (different date picked) can safely overwrite them
// again. The moment a person actually types into one of these fields, that
// mark is removed — from then on it's treated as manual input and never
// touched by prefill again, even across date changes. This is the fix for
// a real bug: on page load Add Entry auto-selects TODAY's date (see
// autoFillEntryDate in data-page.js) and fires a prefill for it, which can
// fill COMP SALE/credit fields from partial same-day Sale Payments data —
// then picking a different (earlier, complete) date without this tracking
// would leave those two fields stuck showing today's stale numbers, since
// "only fill empty fields" can't tell "prefill set this for the wrong day"
// apart from "the person typed this on purpose".
const PREFILL_FIELD_IDS = [
  'e-Cash_Sale', 'e-Alfala_Bank', 'e-custom_Bank_Alfalah_2', 'e-Cash_Returns', 'e-COMP_SALE',
  'e-Askari_Bank', 'e-PSO', 'e-NESPAK', 'e-PARCO', 'e-TEPA', 'e-LDA', 'e-Gourmet', 'e-Wapda_Hospital',
  'e-BTH', 'e-Berger_Paints', 'e-Ecolean_PK', 'e-Style_Textile', 'e-Syed_Babar_Ali', 'e-Rahnuma_NGO',
  'e-Health_Pass', 'e-Nisar_Spinning', 'e-Food_Panda'
];

let _releaseListenersBound = false;
function _bindReleaseListeners() {
  if (_releaseListenersBound) return;
  _releaseListenersBound = true;
  PREFILL_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return; // custom fields (e.g. custom_Bank_Alfalah_2) may not exist in every install
    el.addEventListener('input', () => { delete el.dataset.prefillOwned; }, { passive: true });
  });
}

function _setField(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null) return false;
  const isPrefillOwned = el.dataset.prefillOwned === '1';
  const isEmpty = el.value === '' || el.value == null;
  if (!isEmpty && !isPrefillOwned) return false; // typed by hand — never overwrite
  el.value = val;
  el.dataset.prefillOwned = '1';
  return true;
}

async function fetchClosingDayTotals(dateIso) {
  const client = typeof window.btGetSupabaseClient === 'function' ? window.btGetSupabaseClient() : null;
  if (!client) return null;
  const { data, error } = await client
    .from('sheets')
    .select('shift, data')
    .eq('date', dateIso);
  if (error || !data || !data.length) return null;

  const evening = data.find(r => r.shift === 'Evening');
  let cashReturns = 0;
  data.forEach(r => { cashReturns += Number(r.data && r.data.posRetSys) || 0; });

  return {
    hasEvening: !!evening,
    shiftsFound: data.length,
    cashSale: evening ? Number(evening.data.inSysCash) || 0 : null,
    alfalaBank: evening ? Number(evening.data.inAlfalah) || 0 : null,
    bankAlfalah2: evening ? Number(evening.data.inKeenu) || 0 : null,
    cashReturns
  };
}

async function entryPrefillFromClosing(dateIso) {
  if (!dateIso) return;
  _bindReleaseListeners();

  const [closing, salePayments] = await Promise.all([
    fetchClosingDayTotals(dateIso).catch(e => { console.error('Entry Prefill: Closing fetch failed', e); return null; }),
    fetchSalePaymentsDay(dateIso).catch(e => { console.error('Entry Prefill: Sale Payments fetch failed', e); return null; })
  ]);

  let filled = 0;
  const notes = [];
  const warnings = [];

  // Closing → Cash Sale, card fields, Cash Returns
  if (closing) {
    if (closing.hasEvening) {
      if (_setField('e-Cash_Sale', closing.cashSale)) filled++;
      if (_setField('e-Alfala_Bank', closing.alfalaBank)) filled++;
      // Custom field — id matches the "Bank Alfalah 2" column as saved in
      // reports (custom_Bank_Alfalah_2). Only present if that custom field
      // exists in this install's Field Manager config.
      if (_setField('e-custom_Bank_Alfalah_2', closing.bankAlfalah2)) filled++;
      notes.push('Cash/Card');
    } else {
      warnings.push('Evening shift not closed in Closing yet');
    }
    if (closing.cashReturns) {
      if (_setField('e-Cash_Returns', closing.cashReturns)) filled++;
    }
  }

  // Sale Payments → COMP SALE (Total Sale) + matched credit customers
  if (salePayments) {
    if (salePayments.totalSale != null) {
      if (_setField('e-COMP_SALE', salePayments.totalSale)) filled++;
      notes.push('Total Sale');
    }
    if (salePayments.matchedCredits.length) {
      let creditFilled = 0;
      salePayments.matchedCredits.forEach(({ fieldId, amount }) => {
        if (_setField('e-' + fieldId, amount)) creditFilled++;
      });
      if (creditFilled) { filled += creditFilled; notes.push('Credit Customers'); }
    }
    if (salePayments.unmatchedCredits.length) {
      warnings.push('No column for: ' + salePayments.unmatchedCredits.join(', '));
    }
  }

  if (filled > 0) {
    if (typeof calcTotal === 'function') calcTotal();
    let msg = '✓ Pulled ' + notes.join(', ') + ' — Customers & FDPP still need manual entry';
    if (warnings.length) msg += ' (' + warnings.join('; ') + ')';
    if (typeof window.toast === 'function') window.toast(msg);
  } else if (warnings.length) {
    if (typeof window.toast === 'function') window.toast('⚠ ' + warnings.join('; '), 'w');
  }
}

window.entryPrefillFromClosing = entryPrefillFromClosing;
})();
