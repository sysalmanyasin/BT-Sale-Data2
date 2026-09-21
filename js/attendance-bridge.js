// ══════════════════════════════════════════════════════════════════════
// ATTENDANCE BRIDGE  —  reads/writes attendance_events + attendance_devices
// + attendance_locations from the main Supabase project.
//
// Same shape as inventory-bridge.js/audit-bridge.js: a small, isolated
// read (mostly) bridge that never touches Repository/STAFF state
// directly. Unlike those two, this ISN'T fully read-only — the
// Manager > Attendance page needs to write 'manual' correction events
// and edit the pharmacy location/radius, so this file exposes a couple
// of writes explicitly, clearly separated from the read functions, and
// every write is tagged source:'manual' / created_by so it's never
// confused with a real automatic punch from the staff app.
//
// Deliberately does NOT go through Repository/Actions/EventBus for the
// attendance data itself (attendance_events isn't part of the
// DAILY/MONTHLY/STAFF Proxy-guarded state) — it's a separate concern
// read straight from Supabase into its own small in-memory cache, same
// as inventory-bridge.js's FULLDATA_CACHE pattern. STAFF itself is
// still only ever read (via Repository.getStaff()), never mutated,
// from this file.
// ══════════════════════════════════════════════════════════════════════

// Same project as the main app's own data (js/supabase.js's SB_URL/
// SB_KEY) — NOT the separate Pharmacy Audit Hub project inventory-
// bridge.js/audit-bridge.js use. Attendance is coupled to STAFF
// records, which belong to this project's world.
const ATT_SUPABASE_URL = 'https://wetbugzzchkghpzmowod.supabase.co';
const ATT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';

// Deliberately a separate, non-persisted client — same reasoning
// inventory-bridge.js documents at length: mixing this read/write
// traffic into auth.js's signed-in Google session client is where that
// file hit a real, reproducible RLS-resolves-to-zero-rows bug.
//
// Access control here is anon-role RLS (USING(true)) — the same
// pattern the rest of this app uses (bt_sessions etc, per the
// 2026-08-05 security-audit migration), NOT a JWT role/staff_id claim
// — this app has no real Supabase Auth session anywhere, confirmed via
// this file's sibling js/supabase.js never calling signIn*/setSession.
// "Manager can see everything, staff app can't see others" is enforced
// client-side only (this file's callers, and the staff app only ever
// querying its own staff_id) — see supabase/migrations/
// *_attendance_rls_fix.sql for the full story and its accepted
// tradeoff for a single-user app like this one.
let _client = null;
function _getClient() {
  if (_client) return _client;
  if (typeof supabase === 'undefined') return null; // supabase-js UMD global, loaded via <script defer> in index.html
  _client = supabase.createClient(ATT_SUPABASE_URL, ATT_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _client;
}

export function isConnected() { return true; } // same always-on convention as InventoryBridge/AuditBridge

// Exposed for the manager dashboard's iPhone Shortcuts setup instructions
// (manager-attendance.js's renderIphoneView) — staff need the literal REST
// endpoint + anon key to paste into their own phone's "Get Contents of
// URL" automation, the same way the Android app already gets these two
// values baked into its own BuildConfig. Doesn't change their exposure —
// it's the same public anon key this file already ships in its own
// source above, not a new secret.
export function getRestConfig() {
  return {
    eventsUrl: `${ATT_SUPABASE_URL}/rest/v1/attendance_events`,
    anonKey: ATT_SUPABASE_ANON_KEY,
  };
}

// ── Small in-memory caches (per page load; Today/Monthly re-fetch on demand) ──
let _todayCache = [];
let _monthCache = [];
let _locationsCache = [];

// ── Reads ────────────────────────────────────────────────────────────

// Every event for the given local calendar day (YYYY-MM-DD), across
// all staff — powers the "Today" grid.
export async function fetchEventsForDay(dateStr) {
  const client = _getClient();
  if (!client) return [];
  const start = dateStr + 'T00:00:00';
  const end   = dateStr + 'T23:59:59';
  const { data, error } = await client
    .from('attendance_events')
    .select('*')
    .gte('occurred_at', start)
    .lte('occurred_at', end)
    .order('occurred_at', { ascending: true });
  if (error) { console.error('[attendance-bridge] fetchEventsForDay', error); return []; }
  _todayCache = data || [];
  return _todayCache;
}

// Every event in a month (my = 'YYYY-MM') — powers the Monthly summary.
export async function fetchEventsForMonth(my) {
  const client = _getClient();
  if (!client) return [];
  const [y, m] = my.split('-').map(Number);
  const start = new Date(y, m - 1, 1).toISOString();
  const end   = new Date(y, m, 1).toISOString(); // first day of next month, exclusive
  const { data, error } = await client
    .from('attendance_events')
    .select('*')
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .order('occurred_at', { ascending: true });
  if (error) { console.error('[attendance-bridge] fetchEventsForMonth', error); return []; }
  _monthCache = data || [];
  return _monthCache;
}

// Raw log, most recent first, for the audit view — optionally filtered
// to one staff_id.
export async function fetchRecentEvents(limit, staffId) {
  const client = _getClient();
  if (!client) return [];
  let q = client.from('attendance_events').select('*').order('occurred_at', { ascending: false }).limit(limit || 200);
  if (staffId) q = q.eq('staff_id', staffId);
  const { data, error } = await q;
  if (error) { console.error('[attendance-bridge] fetchRecentEvents', error); return []; }
  return data || [];
}

export async function fetchLocations() {
  const client = _getClient();
  if (!client) return _locationsCache;
  const { data, error } = await client.from('attendance_locations').select('*').eq('active', true);
  if (error) { console.error('[attendance-bridge] fetchLocations', error); return _locationsCache; }
  _locationsCache = data || [];
  return _locationsCache;
}

export async function fetchDevices() {
  const client = _getClient();
  if (!client) return [];
  const { data, error } = await client.from('attendance_devices').select('*').order('last_seen_at', { ascending: false });
  if (error) { console.error('[attendance-bridge] fetchDevices', error); return []; }
  return data || [];
}

// ── Derived, client-side (no extra round trip) ─────────────────────────

// Pairs check_in/check_out rows per staff_id for a day into simple
// {staffId, staffNumber, in, out, source, flagged} rows the Today grid
// renders directly — keeps the "what does a day of attendance look
// like" logic in one place instead of duplicated in the render code.
export function pairEventsByStaff(events) {
  const byStaff = new Map();
  events.forEach(ev => {
    const key = ev.staff_id;
    if (!byStaff.has(key)) {
      byStaff.set(key, { staffId: ev.staff_id, staffNumber: ev.staff_number, in: null, out: null, sources: [], flagged: false });
    }
    const row = byStaff.get(key);
    if (ev.event_type === 'check_in' && (!row.in || ev.occurred_at < row.in)) row.in = ev.occurred_at;
    if (ev.event_type === 'check_out' && (!row.out || ev.occurred_at > row.out)) row.out = ev.occurred_at;
    row.sources.push(ev.source);
    if (ev.is_flagged) row.flagged = true;
  });
  return Array.from(byStaff.values());
}

// ── Writes (manual corrections only — automatic punches come from the staff app, never from here) ──

export async function addManualEvent({ staffId, staffNumber, eventType, occurredAt, note, managerLabel }) {
  const client = _getClient();
  if (!client) throw new Error('Supabase client unavailable');
  const { data, error } = await client.from('attendance_events').insert({
    staff_id: staffId,
    staff_number: staffNumber || null,
    event_type: eventType,          // 'check_in' | 'check_out'
    source: 'manual',
    occurred_at: occurredAt,        // ISO string — defaults to now() if omitted, but for a manual backfill pass the real time
    note: note || null,
    created_by: managerLabel || 'manager',
  }).select().single();
  if (error) { console.error('[attendance-bridge] addManualEvent', error); throw error; }
  return data;
}

// NOT currently called from any UI (verified during the RLS tightening
// migration 20260919130000) -- and as of that migration, UPDATE has no
// RLS policy on attendance_events for anon/authenticated, so calling
// this now succeeds but silently affects 0 rows rather than erroring.
// If you wire this up to a real "edit an entry" UI later, add a
// narrow, purpose-specific UPDATE policy for it first.
export async function updateEvent(id, changes) {
  const client = _getClient();
  if (!client) throw new Error('Supabase client unavailable');
  const { data, error } = await client.from('attendance_events').update(changes).eq('id', id).select().single();
  if (error) { console.error('[attendance-bridge] updateEvent', error); throw error; }
  return data;
}

export async function upsertLocation(loc) {
  const client = _getClient();
  if (!client) throw new Error('Supabase client unavailable');
  const { data, error } = await client.from('attendance_locations').upsert(loc).select().single();
  if (error) { console.error('[attendance-bridge] upsertLocation', error); throw error; }
  return data;
}

// window bridge, same convention as every other bridge file (classic
// <script> callers / inline onclicks reach this via window.AttendanceBridge.*)
window.AttendanceBridge = {
  isConnected, fetchEventsForDay, fetchEventsForMonth, fetchRecentEvents,
  fetchLocations, fetchDevices, pairEventsByStaff,
  addManualEvent, updateEvent, upsertLocation, getRestConfig,
};
