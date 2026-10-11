// Audit tab: view-model panels + the three read tools. Missing data => null / clear error, never invented numbers.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../js/ai-center/deck-model.js';

const OV = {
  generated_at: '2026-10-11T16:29:54Z', fetchedAt: Date.now(),
  engagements: [{ name: 'Individual Assignments \u2014 October 2026', scope_type: 'individual', rounds_total: 24, latest_round: { number: 24, state: 'compiled' },
    assigned: 24, submitted: 24, counting: 0, variance_items: 230, shortage_value: 102821.65, excess_value: 81646.55,
    top_items: [{ item: 'Gluta Glime Tab 30s 1s', company: 'Nutrifactor', system_qty: 6, counted_qty: 3, variance: -3, value: -13500 }] }],
  last_final: { engagement: 'Individual Assignments \u2014 September 2026', generated_at: '2026-10-02T11:44:38Z', variance_value: '4287.4963' },
  suggestions: { pending: 3, latest: [{ item: 'X', created_at: '2026-09-16T12:00:00Z' }] },
  expiry: { near_entries: 15, near_qty: 106, earliest_month: '2027-01', within_90_days_entries: 3, by_month: [{ month: '2027-01', entries: 3, qty: 84 }], by_status: { 'Near Expiry': 15 } },
  barcodes: { conflict: 4, verified: 314 }, staff: { total: 11, access_expiring_7d: 0, access_expired: 0 },
};
const PAY = { paymentSummary: [{ saleDay: '2026-10-10', cashSale: 300570, cardSale: 273078, creditSale: 29443, totalSale: 603092 }, { saleDay: '2026-10-11', cashSale: 204854, cardSale: 214189, creditSale: 0, totalSale: 419043 }],
  creditByCustomer: [{ saleDay: '2026-10-10', customerName: 'A', creditAmount: 20000, receiptCount: 1 }, { saleDay: '2026-10-10', customerName: 'B', creditAmount: 9443, receiptCount: 1 }] };

describe('audit view-model', () => {
  test('auditPanel shows progress, shortage, excess, net and flags work waiting', () => {
    const P = D.auditPanel(OV), all = [...P.left, ...P.right];
    assert.equal(all.find(i => i.label === 'Counting progress').value, '24 / 24');
    assert.equal(all.find(i => i.label === 'Shortage').value, 'Rs 102,822');
    assert.equal(all.find(i => i.label === 'Net variance').value, '-Rs 21,175');
    assert.equal(all.find(i => i.label === 'Variance edits waiting').tone, 'wn');
    assert.equal(all.find(i => i.label === 'Barcode conflicts').value, '4');
    assert.equal(P.top[0].value, '-Rs 13,500');
  });
  test('missing data gives null, not zeros', () => {
    assert.equal(D.auditPanel(null), null); assert.equal(D.expiryPanel(null), null); assert.equal(D.paymentPanel(null), null);
    assert.equal(D.paymentPanel({ paymentSummary: [] }), null);
  });
  test('expiryPanel and paymentPanel use the newest day', () => {
    assert.equal(D.expiryPanel(OV).right[0].value, '3');
    const P = D.paymentPanel(PAY);
    assert.equal(P.day, '2026-10-11'); assert.equal(P.left[0].value, 'Rs 419,043'); assert.match(P.left[1].note, /49%/);
    assert.equal(P.days.length, 2);
  });
});

describe('audit tools', () => {
  beforeEach(() => { globalThis.window = { auditBridgeGetAiOverview: () => OV, salePaymentsBridgeGetFullData: () => PAY }; });
  test('audit_overview / audit_expiry / payment_breakdown are read-only and return real numbers', async () => {
    await import('../../js/agent/tools/audit.js');
    const { getTool } = await import('../../js/agent/core/tool-registry.js');
    for (const n of ['audit_overview', 'audit_expiry', 'payment_breakdown']) assert.equal(getTool(n).risk, 'read', n);
    const a = await getTool('audit_overview').run({});
    assert.equal(a.open_audits[0].net_rs, -21175); assert.equal(a.pending_variance_suggestions.count, 3);
    const e = await getTool('audit_expiry').run({}); assert.equal(e.expiring_within_90_days_entries, 3);
    const p = await getTool('payment_breakdown').run({ days: 1 });
    assert.equal(p.days.length, 1); assert.equal(p.days[0].card_pct, 51.1);
  });
  test('says so plainly when the audit data is not loaded', async () => {
    globalThis.window = {};
    const { getTool } = await import('../../js/agent/core/tool-registry.js');
    await assert.rejects(getTool('audit_overview').run({}), /not loaded yet/);
  });
});
