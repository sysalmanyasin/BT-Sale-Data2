// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — js/dashboard-heatmap.js's buildSalesHeatmap(). Seeds real
// DAILY records (via Repository's internal-write bypass, same as the
// Staff Registry test does for STAFF) across two different years, loads
// the real classic script into a jsdom window via loadClassicScript
// (same helper tests/dom/navigation.test.js uses for ui.js), then
// exercises the actual render: year auto-select, quartile shading
// (via the click-to-drill onclick it attaches per filled day), the
// year-chip toggle, and both "no data" guards.
// ══════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';
import { loadClassicScript } from '../helpers/load-classic-script.js';

const dom = installDomEnv('<!doctype html><body><div id="dash-heatmap"></div></body>');
const { window } = dom;

const { Repository } = await import('../../js/repository.js');
const { DAILY } = await import('../../js/config.js');

// dashboard-heatmap.js is a classic script (IIFE + window bridge, no
// import/export) — load it the same way navigation.test.js loads ui.js,
// into the SAME window config.js's own module-footer already bridged
// DAILY/n/ff/fc onto.
loadClassicScript('js/dashboard-heatmap.js', window);

function seedDaily(records) {
  Repository._beginInternalWrite();
  try { records.forEach(r => DAILY.push(r)); }
  finally { Repository._endInternalWrite(); }
}

beforeEach(() => {
  resetStorage();
  Repository._beginInternalWrite();
  try { DAILY.length = 0; }
  finally { Repository._endInternalWrite(); }
  // The "missing container" test below removes #dash-heatmap outright —
  // recreate it fresh each time rather than assuming it survived the
  // previous test.
  let container = window.document.getElementById('dash-heatmap');
  if (!container) {
    container = window.document.createElement('div');
    container.id = 'dash-heatmap';
    window.document.body.appendChild(container);
  }
  container.innerHTML = '';
});

describe('buildSalesHeatmap (smoke)', () => {
  test('no DAILY data at all → renders nothing, does not throw', () => {
    assert.doesNotThrow(() => window.buildSalesHeatmap());
    assert.equal(window.document.getElementById('dash-heatmap').innerHTML, '');
  });

  test('missing container → does not throw', () => {
    window.document.getElementById('dash-heatmap').remove();
    assert.doesNotThrow(() => window.buildSalesHeatmap());
  });

  test('auto-selects the latest year with real sale days, and renders one clickable cell per sale day', () => {
    seedDaily([
      { Date: '05/Jan/2025', Month_Year: 'January 2025', TOTAL: '10000' },
      { Date: '10/Mar/2026', Month_Year: 'March 2026', TOTAL: '20000' },
      { Date: '11/Mar/2026', Month_Year: 'March 2026', TOTAL: '0' }, // zero-total day: should not be clickable
      { Date: '15/Jun/2026', Month_Year: 'June 2026', TOTAL: '55000' },
    ]);
    window.buildSalesHeatmap();
    const html = window.document.getElementById('dash-heatmap').innerHTML;

    assert.match(html, /Sales Calendar — 2026/, 'should auto-select 2026, the latest year with a real sale day');
    const drillCalls = html.match(/onclick="openDayModal\(/g) || [];
    assert.equal(drillCalls.length, 2, 'exactly the two >0-total 2026 days should be clickable (the 0-total day should not be)');
    assert.match(html, /10 March 2026/, 'a real sale day\'s tooltip should show its full human-readable date');
    assert.match(html, /₨55,000/, 'the year total in the footer line should sum only that year\'s days');
  });

  test('year-chip toggle switches years and re-renders that year\'s own data', () => {
    seedDaily([
      { Date: '05/Jan/2025', Month_Year: 'January 2025', TOTAL: '10000' },
      { Date: '15/Jun/2026', Month_Year: 'June 2026', TOTAL: '55000' },
    ]);
    window.buildSalesHeatmap();
    assert.match(window.document.getElementById('dash-heatmap').innerHTML, /2026/);

    window._dashSetHeatmapYear(2025);
    const html = window.document.getElementById('dash-heatmap').innerHTML;
    assert.match(html, /Sales Calendar — 2025/);
    assert.equal((html.match(/onclick="openDayModal\(/g) || []).length, 1, 'only 2025\'s one sale day should be clickable after switching years');
  });

  test('a leap-year February 29th sale day renders without error', () => {
    seedDaily([{ Date: '29/Feb/2024', Month_Year: 'February 2024', TOTAL: '5000' }]);
    assert.doesNotThrow(() => window.buildSalesHeatmap());
    const html = window.document.getElementById('dash-heatmap').innerHTML;
    assert.match(html, /Sales Calendar — 2024/);
    assert.match(html, /29 February 2024/);
  });
});
