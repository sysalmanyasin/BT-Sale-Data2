// ══════════════════════════════════════════════════════════════════════
// SMOKE TEST — js/config.js: the pure number/formatting helpers that
// every report, dashboard tile, and print engine downstream depends on.
// Not exhaustive unit coverage — just enough to catch "the module
// doesn't even load" and "a formatter silently returns garbage" classes
// of regression.
// ══════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv();
const config = await import('../../js/config.js');

describe('config.js module (smoke)', () => {
  test('module loads and exposes the expected helper exports', () => {
    for (const name of ['n', 'ff', 'fc', 'fv', 'pct', 'MONTHLY', 'DAILY', 'STAFF']) {
      assert.ok(name in config, `config.js is missing expected export "${name}"`);
    }
  });

  test('window bridge is installed (classic-script consumers depend on this)', () => {
    assert.equal(typeof window.n, 'function', 'window.n should be bridged by config.js');
    assert.equal(typeof window.ff, 'function', 'window.ff should be bridged by config.js');
  });
});

describe('n() — safe numeric coercion', () => {
  test('parses numeric strings', () => {
    assert.equal(config.n('42'), 42);
    assert.equal(config.n('3.5'), 3.5);
  });

  test('treats null/undefined/empty-string/NaN as 0', () => {
    assert.equal(config.n(null), 0);
    assert.equal(config.n(undefined), 0);
    assert.equal(config.n(''), 0);
    assert.equal(config.n('not a number'), 0);
  });

  test('passes through real numbers unchanged', () => {
    assert.equal(config.n(150000), 150000);
    assert.equal(config.n(-12.3), -12.3);
  });
});

describe('fc() — comma-grouped currency formatting (en-PK)', () => {
  test('formats large numbers with thousands separators', () => {
    assert.equal(config.fc(150000), (150000).toLocaleString('en-PK'));
  });

  test('rounds fractional values', () => {
    assert.equal(config.fc(1000.6), Math.round(1000.6).toLocaleString('en-PK'));
  });
});

describe('fv() — signed value formatting', () => {
  test('renders exact zero as the string "0" (not "-0" or "0.00")', () => {
    assert.equal(config.fv(0), '0');
    assert.equal(config.fv(-0.2), '0');
  });

  test('preserves a leading minus sign for negative values', () => {
    const out = config.fv(-5000);
    assert.ok(out.startsWith('-'), `expected a leading "-", got "${out}"`);
  });
});

describe('ff() — compact ("1.2M"-style) formatting', () => {
  test('abbreviates values at or above one million', () => {
    assert.equal(config.ff(2500000), '2.50M');
  });

  test('adds thousands separators below one million', () => {
    assert.equal(config.ff(15000), (15000).toLocaleString('en-PK'));
  });
});

describe('pct() — percentage-change helper', () => {
  test('computes percent change between two values', () => {
    assert.equal(config.pct(110, 100), '10.0%');
    assert.equal(config.pct(90, 100), '-10.0%');
  });

  test('guards against division by zero', () => {
    assert.equal(config.pct(50, 0), '—');
  });
});
