import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// These are browser ES modules. Supply only the browser globals their
// data-only paths require; no DOM or network behavior is involved.
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.invalidateRenderCache = () => {};

const config = await import('../js/config.js');
const { Repository } = await import('../js/repository.js');
const { Analytics } = await import('../js/analytics.js');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const monthYear = (date) => MONTHS[date.getMonth()] + ' ' + date.getFullYear();
const dailyDate = (day, date) =>
  String(day).padStart(2, '0') + '/' +
  date.toLocaleString('en-US', { month: 'short' }) + '/' + date.getFullYear();

function resetData(monthly, daily, customFields) {
  Repository._beginInternalWrite();
  try {
    config.MONTHLY.splice(0, config.MONTHLY.length);
    config.DAILY.splice(0, config.DAILY.length);
    monthly.forEach((row) => config.MONTHLY.push({ ...row }));
    daily.forEach((row) => config.DAILY.push({ ...row }));
  } finally {
    Repository._endInternalWrite();
  }
  globalThis._fmCustom = customFields;
}

before(() => {
  // Keep fixtures deterministic while still exercising the actual current
  // month logic used by the production dashboard.
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const future = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const curMY = monthYear(current);
  const prevMY = monthYear(previous);
  const futureMY = monthYear(future);

  resetData(
    [
      { Month_Year: prevMY, TOTAL: '312', Customers: '10' },
      { Month_Year: futureMY, TOTAL: '99999', Customers: '99' },
      { Month_Year: curMY, TOTAL: '100', Customers: '1' },
    ],
    [
      {
        Month_Year: prevMY, Date: dailyDate(1, previous), TOTAL: '230',
        'Cash Sale': '100', HBL: '20', 'Cash Returns': '5',
        PSO: '100', 'PSO Returns': '10', customBank: '10', customCredit: '15',
      },
      {
        Month_Year: prevMY, Date: dailyDate(2, previous), TOTAL: '82',
        'Cash Sale': '50', HBL: '10', 'Cash Returns': '0',
        PSO: '20', 'PSO Returns': '5', customBank: '4', customCredit: '3',
      },
      {
        Month_Year: curMY, Date: dailyDate(2, current), TOTAL: '100',
        'Cash Sale': '100', Customers: '1',
      },
    ],
    [
      { id: 'customBank', label: 'Custom Bank', section: 'Banks', calcType: 'add' },
      { id: 'customCredit', label: 'Custom Credit', section: 'Credit Clients', calcType: 'add' },
    ],
  );
});

test('MTD cash and credit comparisons include custom fields and subtract raw return inputs', () => {
  const result = Analytics.getDashboardKPIs();
  assert.ok(result, 'dashboard KPIs should be available with two completed month rows');
  assert.equal(result.prvCash, 189, 'cash MTD = cash + bank + custom bank − cash returns');
  assert.equal(result.prvCredit, 123, 'credit MTD subtracts positive raw return values and includes custom credit');
});

test('dashboard KPI month selection ignores future rows and uses chronological order', () => {
  const result = Analytics.getDashboardKPIs();
  const now = new Date();
  assert.equal(result.lat.Month_Year, monthYear(new Date(now.getFullYear(), now.getMonth(), 1)));
  assert.equal(result.prv.Month_Year, monthYear(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  assert.notEqual(result.lat.TOTAL, '99999', 'future placeholder must not become the latest month');
});
