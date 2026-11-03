// inventory-search/app.js — the standalone search page must not re-download the
// whole inventory_products table when inventory_sync_log.synced_at is unchanged
// since its cached copy (2026-11 egress cleanup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv(); // the lib modules register themselves on `window` at import time
const { BTFormat } = await import('../../js/lib/bt-format.js');
const { BTSearch } = await import('../../js/lib/bt-search.js');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'inventory-search', 'index.html'), 'utf8');
// app.js is an ES module; the test runs it as a plain script, so its two imports
// are stripped and the real modules are exposed as same-named globals instead.
const source = fs.readFileSync(path.join(ROOT, 'inventory-search', 'app.js'), 'utf8')
  .replace(/^import .*$/gm, '');
const CACHE_KEY = 'inv_search_products_v1';

const row = (i) => ({ code: 'c' + i, name: 'Item ' + i, qty: 5, net_qty_30_days: 1 });

function boot({ cache, serverSyncedAt, serverRows = [row(1), row(2), row(3)], probeFails = false }) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://bt.duapharma.com/inventory-search/', pretendToBeVisual: true });
  const { window } = dom;
  if (cache) window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  const calls = { products: 0, syncLog: 0 };
  window.supabase = {
    createClient: () => ({
      from(table) {
        const b = {
          select() { return b; }, order() { return b; }, limit() { return b; },
          maybeSingle() {
            calls.syncLog += 1;
            return Promise.resolve(probeFails ? { data: null, error: new Error('probe down') } : { data: { synced_at: serverSyncedAt }, error: null });
          },
          range(from) {
            if (table === 'inventory_products') calls.products += 1;
            return Promise.resolve({ data: from === 0 ? serverRows : [], error: null });
          },
        };
        return b;
      },
    }),
  };
  window.BTFormat = BTFormat; window.BTSearch = BTSearch;
  window.eval(source);
  return { window, calls };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const cachedProducts = [{ code: 'c1', name: 'Item 1', qty: 5 }, { code: 'c2', name: 'Item 2', qty: 5 }];

test('unchanged synced_at -> cached copy kept, inventory_products NOT downloaded', async () => {
  const { window, calls } = boot({ cache: { products: cachedProducts, fetchedAt: 1, syncedAt: 'T1' }, serverSyncedAt: 'T1' });
  await wait(400);
  assert.equal(calls.products, 0, 'no full-table download');
  assert.ok(calls.syncLog >= 1);
  const saved = JSON.parse(window.localStorage.getItem(CACHE_KEY));
  assert.equal(saved.products.length, 2);
  assert.equal(saved.syncedAt, 'T1');
  assert.ok(saved.fetchedAt > 1, 'freshness timestamp bumped so the 60s throttle works');
});

test('newer synced_at -> full download and the new version is remembered', async () => {
  const { window, calls } = boot({ cache: { products: cachedProducts, fetchedAt: 1, syncedAt: 'T1' }, serverSyncedAt: 'T2' });
  await wait(400);
  assert.ok(calls.products >= 1);
  const saved = JSON.parse(window.localStorage.getItem(CACHE_KEY));
  assert.equal(saved.products.length, 3);
  assert.equal(saved.syncedAt, 'T2');
});

test('old cache without syncedAt, or a failing probe -> falls back to the full download', async () => {
  const legacy = boot({ cache: { products: cachedProducts, fetchedAt: 1 }, serverSyncedAt: 'T1' });
  await wait(400);
  assert.ok(legacy.calls.products >= 1);

  const failing = boot({ cache: { products: cachedProducts, fetchedAt: 1, syncedAt: 'T1' }, serverSyncedAt: 'T1', probeFails: true });
  await wait(400);
  assert.ok(failing.calls.products >= 1, 'probe failure must not block the refresh');
});
