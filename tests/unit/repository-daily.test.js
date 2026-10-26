import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
globalThis.invalidateRenderCache = () => {};

const { Repository } = await import('../../js/platform/repository.js');
const { Actions } = await import('../../js/platform/actions.js');

const date = '01/Jan/2099';
const monthYear = 'January 2099';

beforeEach(() => {
  Repository.deleteDaily(date, monthYear);
});
afterEach(() => {
  Repository.deleteDaily(date, monthYear);
});

function seedDay() {
  Actions.addDailyEntry({
    Date: date,
    Month_Year: monthYear,
    'Cash Sale': '100',
    'COMP SALE': '80',
  });
}

test('daily read APIs return snapshots that cannot mutate committed records', () => {
  seedDay();

  const entry = Repository.getDailyEntry(date, monthYear);
  entry['Cash Sale'] = '999';
  assert.equal(Repository.getDailyEntry(date, monthYear)['Cash Sale'], '100');

  const byDate = Repository.findDailyByDate(date);
  byDate['Cash Sale'] = '888';
  assert.equal(Repository.getDailyEntry(date, monthYear)['Cash Sale'], '100');

  const list = Repository.getDaily();
  list[0]['Cash Sale'] = '777';
  list.push({ Date: '02/Jan/2099', Month_Year: monthYear });
  assert.equal(Repository.getDaily().length, 1);
  assert.equal(Repository.getDailyEntry(date, monthYear)['Cash Sale'], '100');
});

test('failed daily edit leaves the committed record unchanged', () => {
  seedDay();
  const changes = {
    get ['Cash Sale']() {
      throw new Error('invalid edit payload');
    },
  };

  assert.throws(() => Actions.editDailyEntry(date, monthYear, changes), /invalid edit payload/);
  assert.equal(Repository.getDailyEntry(date, monthYear)['Cash Sale'], '100');
});

test('successful daily edit recalculates totals before committing', () => {
  seedDay();

  Actions.editDailyEntry(date, monthYear, { 'Cash Sale': '125' });
  const saved = Repository.getDailyEntry(date, monthYear);
  assert.equal(saved['Cash Sale'], '125');
  assert.equal(saved.TOTAL, '125');
  assert.equal(saved.DIFF, '45');
});
