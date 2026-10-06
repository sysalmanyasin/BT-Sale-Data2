import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
globalThis.invalidateRenderCache = () => {};
const cfg = await import('../../js/config.js');
globalThis.recomputeMonthly = cfg.recomputeMonthly;
const { Repository } = await import('../../js/repository.js');
globalThis.Repository = Repository;
await import('../../js/agent/tools/app.js'); await import('../../js/agent/tools/sales.js');
await import('../../js/agent/tools/str.js'); await import('../../js/agent/tools/closing.js');
const { tryInstant } = await import('../../js/agent/core/instant.js');
const reg = await import('../../js/agent/core/tool-registry.js');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
before(() => {
  const d = new Date(), today = String(d.getDate()).padStart(2, '0') + '/' + MON[d.getMonth()] + '/' + d.getFullYear();
  cfg.DAILY.push({ Date: today, Month_Year: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear(), TOTAL: '12345', 'COMP SALE': '12000', DIFF: '345', 'Cash Sale': '12345', Customers: '40' });
  document.body.innerHTML = '<div class="page on" id="page-dashboard"></div><div class="page" id="page-closing-book"></div><div class="page" id="page-manager"></div>';
  window.Actions = { navigate: id => { window.__nav = id; } };
});

describe('instant path', () => {
  test("today's sale is answered from data with no model", async () => {
    for (const q of ["today's sale", 'What is todays sales?', 'aaj ki bikri kitni hai']) {
      const r = await tryInstant(q);
      assert.equal(r.kind, 'answer', q); assert.match(r.text, /12,345/); assert.equal(r.tool, 'get_daily_sales');
    }
  });
  test('open ledger / closing navigate', async () => {
    let r = await tryInstant('open ledger');
    assert.equal(r.kind, 'navigate'); assert.equal(window.__nav, 'manager');
    r = await tryInstant('Open the closing book page');
    assert.equal(window.__nav, 'closing-book'); assert.match(r.text, /Closing book/);
  });
  test('date question', async () => assert.match((await tryInstant("what's the date")).text, /Today is/));
  test('STR and closing one-liners use the new tools', async () => {
    window.strBridgeGetFullData = () => ({ headers: [{ strId: 1, strNumber: 'STR-1', strDate: '2026-01-01', direction: 'in', dispatchStatus: '', receiveStatus: '' }], lineItems: [] });
    assert.match((await tryInstant('pending STRs')).text, /1 awaited/);
    window.closingBridgeGetFullDb = () => ({ sheets: {} });
    assert.match((await tryInstant('closing status')).text, /Night pending/);
  });
  test('anything else falls through to the AI (null)', async () => {
    for (const q of ['why did sales drop in august', 'add sales for yesterday cash 5000', 'open the pod bay doors', '', 'x'.repeat(80), 'delete the last ledger entry'])
      assert.equal(await tryInstant(q), null, q);
  });
  test('instant path can never reach a change tool', async () => {
    const { INSTANT_TOOLS } = await import('../../js/agent/core/instant.js');
    assert.ok(INSTANT_TOOLS.length >= 6);
    for (const name of INSTANT_TOOLS) {
      const t = reg.getTool(name);
      if (t) assert.ok(t.risk === 'read' || t.risk === 'ui', name + ' is ' + t.risk);
    }
  });
});
