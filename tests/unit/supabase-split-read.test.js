// bt_salesdata READ-SIDE SPLIT (2026-11 egress cleanup).
// Drives the real pullFromSupabase / _doPush against an in-memory fake of the
// Supabase tables, and asserts WHAT gets downloaded: the 2.5 MB row must only be
// read whole on a manual pull / cold start / after 6 h — never on a routine pull or push.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv, resetStorage } from '../helpers/dom-env.js';

installDomEnv();
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;

// Controllable clock: pullFromSupabase refuses to run twice within 2 s, and the 6 h full-resync rule is time-based.
let fakeNow = Date.now();
Date.now = () => fakeNow;
const tick = (ms) => { fakeNow += ms; };

// ── fake PostgREST ───────────────────────────────────────────────
let clock = 0;
const serverNow = () => {                       // monotonic, microsecond-style like Postgres
  clock += 1;
  return new Date(Date.UTC(2026, 10, 4, 10, 0, 0) + clock * 600 * 1000).toISOString().replace('Z', '123+00:00').replace(/\.(\d{3})123/, '.$1123');
};
const db = { bt_salesdata: [], bt_daily: [] };
const reqLog = [];                              // { table, kind, bytes, rows }
let beforeUpdateHook = null;

function proj(row, cols) {
  if (cols === '*' || !cols) return row;
  const o = {};
  cols.split(',').map(c => c.trim()).forEach(c => { o[c] = row[c]; });
  return o;
}
function tableRows(name) {
  if (name === 'bt_salesdata_core') {
    return db.bt_salesdata.map(r => { const { daily, ...rest } = r.payload; return { id: r.id, updated_at: r.updated_at, payload: rest }; });
  }
  return db[name];
}
function fanoutDaily(oldP, newP) {
  const oldMap = new Map(((oldP && oldP.daily) || []).map(d => [d.Date, JSON.stringify(d)]));
  const t = serverNow();
  (newP.daily || []).forEach(d => {
    if (oldMap.get(d.Date) === JSON.stringify(d)) return;
    const i = db.bt_daily.findIndex(x => x.date === d.Date);
    const row = { date: d.Date, month_year: d.Month_Year, data: d, updated_at: t };
    if (i === -1) db.bt_daily.push(row); else db.bt_daily[i] = row;
  });
}
class Q {
  constructor(table) { this.t = table; this.f = []; this.ord = []; this.cols = '*'; this.mode = 'select'; }
  select(c) { this.cols = c || '*'; return this; }
  eq(k, v) { this.f.push(r => String(r[k]) === String(v)); return this; }
  gte(k, v) { this.f.push(r => Date.parse(String(r[k]).replace(/(\.\d{3})\d+/, '$1')) >= Date.parse(String(v).replace(/(\.\d{3})\d+/, '$1'))); return this; }
  order(k, o = {}) { this.ord.push([k, o.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rg = [a, b]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  update(v) { this.mode = 'update'; this.patch = v; return this; }
  upsert(v) { this.mode = 'upsert'; this.patch = v; return this; }
  then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }
  exec() {
    if (this.mode === 'update') {
      if (beforeUpdateHook) { const h = beforeUpdateHook; beforeUpdateHook = null; h(); }
      const hit = db.bt_salesdata.filter(r => this.f.every(fn => fn(r)));
      hit.forEach(r => { const old = r.payload; r.payload = this.patch.payload; r.updated_at = serverNow(); fanoutDaily(old, r.payload); });
      const out = hit.map(r => proj(r, this.cols));
      reqLog.push({ table: this.t, kind: 'update', bytes: JSON.stringify(out).length, rows: out.length });
      return { data: out, error: null };
    }
    if (this.mode === 'upsert') {
      const row = { ...this.patch, updated_at: serverNow() };
      db.bt_salesdata.push(row); fanoutDaily(null, row.payload);
      reqLog.push({ table: this.t, kind: 'upsert', bytes: 0, rows: 1 });
      return { data: null, error: null };
    }
    let rows = tableRows(this.t).filter(r => this.f.every(fn => fn(r)));
    this.ord.slice().reverse().forEach(([k, asc]) => {
      rows = rows.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
    });
    if (this.rg) rows = rows.slice(this.rg[0], this.rg[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const out = rows.map(r => proj(r, this.cols));
    reqLog.push({ table: this.t, kind: 'select:' + this.cols, bytes: JSON.stringify(out).length, rows: out.length });
    if (this.one) {
      if (!out.length) return this.one === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      return { data: out[0], error: null };
    }
    return { data: out, error: null };
  }
}
const fakeClient = { from: t => new Q(t), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
globalThis.supabase = { createClient: () => fakeClient };
window.supabase = globalThis.supabase;

// ── app globals the sync module expects ──────────────────────────
const { MONTHLY, DAILY, STAFF } = await import('../../js/platform/config.js');
await import('../../js/platform/repository.js');
await import('../../js/platform/actions.js');
globalThis.Repository = window.Repository;   // legacy modules reach it as a bare global
Object.assign(globalThis, { MGR_KEY: 'BT_ManagerWork_v1', CSEC_KEY: 'mw_custom_sections_v1', JC_KEY: 'bt_jazzcash_v2',
  JC_TALLY_KEY: 'bt_jc_tally_v1', LEDGER_KEY: 'bt_ledger_v1', LEDGER_CUSTOM_TYPES_KEY: 'bt_ledger_custom_types_v1',
  recomputeAllMonths() {}, rebuildAll() {}, idbSaveData() {}, toast() {}, invalidateRenderCache() {} });
Object.assign(window, { MGR_KEY: 'BT_ManagerWork_v1', CSEC_KEY: 'mw_custom_sections_v1', JC_KEY: 'bt_jazzcash_v2',
  JC_TALLY_KEY: 'bt_jc_tally_v1', LEDGER_KEY: 'bt_ledger_v1', LEDGER_CUSTOM_TYPES_KEY: 'bt_ledger_custom_types_v1' });
window.SyncTombstones = { getAllTombstones: () => ({}), mergeTombstones: () => {}, isDeleted: () => false };

await import('../../js/platform/supabase.js');
const sb = await import('../../js/platform/supabase-split-read.js');
globalThis.setInterval = realSetInterval;

// ── helpers ──────────────────────────────────────────────────────
const day = (n, extra = {}) => ({ Date: `2026-10-${String(n).padStart(2, '0')}`, Month_Year: 'October 2026', Total: n * 100, _updatedAt: 1000 + n, Note: 'x'.repeat(300), ...extra });
const serverPush = (mutate) => {            // "another device / a server writer" changes the row
  const row = db.bt_salesdata[0];
  const old = row.payload;
  row.payload = mutate(JSON.parse(JSON.stringify(old)));
  row.updated_at = serverNow();
  fanoutDaily(old, row.payload);
};
const reads = (table) => reqLog.filter(r => r.table === table && r.kind.startsWith('select'));
const bytesOf = (table) => reads(table).reduce((a, r) => a + r.bytes, 0);

function seed(n = 40) {
  DAILY.length = 0; MONTHLY.length = 0; STAFF.length = 0;
  db.bt_salesdata = []; db.bt_daily = []; reqLog.length = 0; clock = 0; beforeUpdateHook = null;
  const payload = {
    monthly: [{ Month_Year: 'October 2026', Total: 1 }],
    daily: Array.from({ length: n }, (_, i) => day(i + 1)),
    staff: [], manager: {}, ledger: { entries: [], openingBalances: {} },
    pushedAt: 'x', payloadVersion: 1, device_id: 'OTHER-DEVICE',
  };
  db.bt_salesdata.push({ id: 'main', payload, updated_at: serverNow() });
  fanoutDaily(null, payload);
  // A later, small push (one day edited) — in production the newest bt_daily timestamp belongs to a
  // small recent push, not to the initial bulk load, and that newest row is what a cursor re-reads once.
  serverPush(p => { p.daily[0].Total += 1; p.daily[0]._updatedAt += 1; return p; });
}

beforeEach(() => { resetStorage(); seed(); tick(5000); });

describe('pull', () => {
  test('cold start reads the whole row once, then a no-change pull downloads almost nothing', async () => {
    await window.pullFromSupabase(true);
    assert.equal(DAILY.length, 40);
    assert.equal(reads('bt_salesdata').filter(r => r.kind === 'select:payload, updated_at').length, 1, 'first pull is a full read');
    const fullBytes = bytesOf('bt_salesdata');
    reqLog.length = 0;
    tick(2100);            // pullFromSupabase enforces a 2 s gap
    await window.pullFromSupabase(true);
    assert.equal(bytesOf('bt_salesdata_core'), 0);
    assert.equal(bytesOf('bt_daily'), 0);
    assert.ok(bytesOf('bt_salesdata') < 120, 'only the ~100 B probe');
    assert.ok(fullBytes > 100 * bytesOf('bt_salesdata'));
  });

  test('after a remote change, only the core view + the changed days are fetched', async () => {
    await window.pullFromSupabase(true);
    reqLog.length = 0;
    serverPush(p => { p.daily[3].Total = 9999; p.daily[3]._updatedAt = 99999; p.daily.push(day(41)); p.payloadVersion = 2; return p; });
    tick(2100);
    await window.pullFromSupabase(true);
    assert.equal(reads('bt_salesdata').filter(r => r.kind.includes('payload')).length, 0, 'the big row must not be read');
    assert.equal(reads('bt_salesdata_core').length, 1);
    const dailyReads = reads('bt_daily');
    assert.equal(dailyReads.length, 1);
    assert.equal(dailyReads[0].rows, 3, 'the two changed days + the newest previously-seen day (cursor boundary, re-read once)');
    assert.equal(DAILY.length, 41);
    assert.equal(DAILY.find(d => d.Date === '2026-10-04').Total, 9999);
  });

  test('a manual pull (silent=false) is always a full read', async () => {
    await window.pullFromSupabase(true);
    reqLog.length = 0;
    tick(2100);
    await window.pullFromSupabase(false);
    assert.equal(reads('bt_salesdata').filter(r => r.kind === 'select:payload, updated_at').length, 1);
    assert.equal(reads('bt_salesdata_core').length, 0);
  });

  test('after 6 hours the next routine pull is a full read again (safety net)', async () => {
    await window.pullFromSupabase(true);
    reqLog.length = 0;
    tick(6 * 3600 * 1000 + 1000);
    await window.pullFromSupabase(true);
    assert.equal(reads('bt_salesdata').filter(r => r.kind === 'select:payload, updated_at').length, 1);
  });

  test('a wiped local store forces a full read even with a saved cursor', async () => {
    await window.pullFromSupabase(true);
    DAILY.length = 0;
    reqLog.length = 0;
    tick(2100);
    await window.pullFromSupabase(true);
    assert.equal(reads('bt_salesdata').filter(r => r.kind === 'select:payload, updated_at').length, 1);
    assert.equal(DAILY.length, 40);
  });

  test('more than one page of changed days is fully fetched (PostgREST caps at 1000 rows)', async () => {
    await window.pullFromSupabase(true);
    reqLog.length = 0;
    serverPush(p => { for (let i = 100; i < 2600; i++) p.daily.push({ Date: `2027-01-${i}`, Month_Year: 'January 2027', Total: i, _updatedAt: i }); return p; });
    tick(2100);
    await window.pullFromSupabase(true);
    assert.equal(reads('bt_daily').length, 3, '2500 rows → 3 pages');
    assert.equal(DAILY.length, 40 + 2500);
  });
});

describe('push', () => {
  test('with an unchanged remote it probes (~100 B) instead of re-reading the row, and the compare-and-swap still guards the write', async () => {
    await window.pullFromSupabase(true);
    reqLog.length = 0;
    const before = db.bt_salesdata[0].updated_at;
    await window._doPush();
    assert.equal(reads('bt_salesdata').filter(r => r.kind.includes('payload')).length, 0, 'no pre-push download of the payload');
    assert.equal(reads('bt_salesdata_core').length, 0);
    const upd = reqLog.find(r => r.kind === 'update');
    assert.ok(upd && upd.rows === 1, 'write landed');
    assert.notEqual(db.bt_salesdata[0].updated_at, before);
    // and the next routine pull after our own push is still a no-download probe
    reqLog.length = 0;
    tick(2100);
    await window.pullFromSupabase(true);
    assert.equal(bytesOf('bt_salesdata_core') + bytesOf('bt_daily'), 0);
  });

  test('if the row changed since our last merge, the push first merges the remote change (delta read) before writing', async () => {
    await window.pullFromSupabase(true);
    serverPush(p => { p.daily.push(day(50, { Total: 5000 })); p.payloadVersion = 2; return p; });
    reqLog.length = 0;
    await window._doPush();
    assert.equal(reads('bt_salesdata').filter(r => r.kind.includes('payload')).length, 0);
    assert.equal(reads('bt_salesdata_core').length, 1);
    assert.equal(reads('bt_daily')[0].rows, 2, 'the new day + the cursor-boundary day');
    const saved = db.bt_salesdata[0].payload.daily.find(d => d.Date === '2026-10-50');
    assert.ok(saved && saved.Total === 5000, "the other device's day survives our push");
  });

  test('a lost compare-and-swap re-reads, re-merges and retries — nothing is overwritten', async () => {
    await window.pullFromSupabase(true);
    beforeUpdateHook = () => serverPush(p => { p.daily.push(day(60, { Total: 6000 })); p.payloadVersion = 3; return p; });
    reqLog.length = 0;
    await window._doPush();
    const updates = reqLog.filter(r => r.kind === 'update');
    assert.equal(updates.length, 2, 'first CAS lost, second landed');
    assert.equal(updates[0].rows, 0);
    assert.equal(updates[1].rows, 1);
    assert.ok(db.bt_salesdata[0].payload.daily.some(d => d.Date === '2026-10-60'), 'concurrent write preserved');
  });

  test('first ever push (no row yet) still creates it', async () => {
    db.bt_salesdata = []; db.bt_daily = [];
    DAILY.push(day(1));
    await window._doPush();
    assert.equal(db.bt_salesdata.length, 1);
    assert.equal(db.bt_daily.length, 1);
  });
});

describe('pure helpers', () => {
  test('_sbMaxIso only moves forward and understands microsecond timestamps', () => {
    assert.equal(sb._sbMaxIso([{ t: '2026-11-04T10:00:05.123456+00:00' }], 't', '2026-11-04T10:00:04.000000+00:00'), '2026-11-04T10:00:05.123456+00:00');
    assert.equal(sb._sbMaxIso([{ t: '2026-11-04T09:00:00.000000+00:00' }], 't', '2026-11-04T10:00:00.000000+00:00'), '2026-11-04T10:00:00.000000+00:00');
    assert.equal(sb._sbMaxIso([], 't', null), null);
  });
  const c = { stamp: 's', daily: 'd', fullAt: 1_000_000, n: 50 };
  test('_sbCursorUsable needs a complete, fresh cursor and local data that has not shrunk', () => {
    assert.equal(sb._sbCursorUsable(c, 50, 1_000_100), true);
    assert.equal(sb._sbCursorUsable(c, 49, 1_000_100), false);
    assert.equal(sb._sbCursorUsable(c, 0, 1_000_100), false);
    assert.equal(sb._sbCursorUsable({ ...c, daily: null }, 50, 1_000_100), false);
    assert.equal(sb._sbCursorUsable(c, 50, 1_000_000 + 7 * 3600 * 1000), false, 'older than 6 h');
    assert.equal(sb._sbCursorUsable(null, 50), false);
  });
  test('_sbPickMode: manual is always full', () => {
    assert.equal(sb._sbPickMode(c, true, 50, 1_000_100), 'full');
    assert.equal(sb._sbPickMode(c, false, 50, 1_000_100), 'delta');
  });
});
