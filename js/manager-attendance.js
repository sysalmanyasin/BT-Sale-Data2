// ══════════════════════════════════════════════════════════════════════
// MANAGER — ATTENDANCE  (new tab, sibling to manager-staff.js etc.)
//
// Three views (Today / Monthly / Raw Log) over attendance-bridge.js's
// data, plus a manual-entry form for corrections. Deliberately reads
// staff names via Repository.getStaff() (matching attendance_events'
// staff_id to STAFF[i].id) rather than duplicating name/role data into
// the attendance tables — Staff Registry stays the single source of
// truth for who staff members are; this file only owns *when they were
// here*.
// ══════════════════════════════════════════════════════════════════════
import { Repository } from './repository.js';
import { _mgrEsc } from './manager-shared.js';
import * as AttendanceBridge from './attendance-bridge.js';

let _attToday = [];
let _attMonth = [];
let _attLog = [];
let _attCurDate = _todayStr();
let _attCurMonth = _todayStr().slice(0, 7);

function _todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}
// The Android attendance app only ever knows the human-readable staff
// number (e.g. 'EMP-001') — it has no way to read this app's internal
// STAFF[i].id ('emp_...'), so it posts that number as staff_id (see
// android-attendance's MainActivity.kt / README "Known limitations").
// Resolve against both: internal id first (future-proof, e.g. manual
// entries which do use it), then staffId/staff_number match.
function _resolveStaff(id, staffNumber) {
  const list = Repository.getStaff();
  return list.find(e => e.id === id)
      || (staffNumber && list.find(e => e.staffId === staffNumber))
      || (id && list.find(e => e.staffId === id))
      || null;
}
function _staffName(id, fallbackNumber) {
  const s = _resolveStaff(id, fallbackNumber);
  return s ? s.name : (fallbackNumber || id || 'Unknown');
}
function _expectedStart(staff) {
  // Optional per-employee field, add to Staff Registry if you want real
  // late-flagging (e.g. staff.shiftStart = '09:00'); until then this
  // just returns null and lateness flagging is skipped, never guessed.
  return staff && staff.shiftStart ? staff.shiftStart : null;
}
function _isLate(inIso, staff) {
  const expected = _expectedStart(staff);
  if (!expected || !inIso) return false;
  const d = new Date(inIso);
  const [h, m] = expected.split(':').map(Number);
  const expectedMinutes = h * 60 + m;
  const actualMinutes = d.getHours() * 60 + d.getMinutes();
  return actualMinutes > expectedMinutes + 5; // 5-minute grace
}

// ── Tab entry point, called from manager-page.js's switchMgrTab ────────
export async function renderAttendanceTab() {
  const cont = document.getElementById('mgr-attendance');
  if (!cont) return;
  cont.innerHTML = `
    <div class="att-subtabs">
      <button class="btn att-subtab active" data-atab="today" onclick="AttendanceUI.switchSub('today')">📅 Today</button>
      <button class="btn att-subtab" data-atab="month" onclick="AttendanceUI.switchSub('month')">🗓️ Monthly</button>
      <button class="btn att-subtab" data-atab="log" onclick="AttendanceUI.switchSub('log')">📜 Raw Log</button>
      <button class="btn att-subtab" data-atab="manual" onclick="AttendanceUI.switchSub('manual')">✏️ Manual Entry</button>
      <button class="btn att-subtab" data-atab="location" onclick="AttendanceUI.switchSub('location')">📍 Location</button>
      <button class="btn att-subtab" data-atab="notify" onclick="AttendanceUI.switchSub('notify')">🔔 Notifications</button>
      <button class="btn att-subtab" data-atab="iphone" onclick="AttendanceUI.switchSub('iphone')">🍎 iPhone Setup</button>
    </div>
    <div id="att-sub-today" class="att-sub"></div>
    <div id="att-sub-month" class="att-sub" style="display:none"></div>
    <div id="att-sub-log" class="att-sub" style="display:none"></div>
    <div id="att-sub-manual" class="att-sub" style="display:none"></div>
    <div id="att-sub-location" class="att-sub" style="display:none"></div>
    <div id="att-sub-notify" class="att-sub" style="display:none"></div>
    <div id="att-sub-iphone" class="att-sub" style="display:none"></div>
  `;
  await renderTodayView();
}

function switchSub(tab) {
  document.querySelectorAll('.att-subtab').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  document.querySelectorAll('.att-sub').forEach(s => s.style.display = 'none');
  const sec = document.getElementById('att-sub-' + tab);
  if (sec) sec.style.display = '';
  if (tab === 'today') renderTodayView();
  if (tab === 'month') renderMonthView();
  if (tab === 'log') renderLogView();
  if (tab === 'manual') renderManualView();
  if (tab === 'location') renderLocationView();
  if (tab === 'notify') renderNotifyView();
  if (tab === 'iphone') renderIphoneView();
}

// ── TODAY ────────────────────────────────────────────────────────────
async function renderTodayView() {
  const cont = document.getElementById('att-sub-today');
  if (!cont) return;
  cont.innerHTML = `<div class="att-loading">Loading today's attendance…</div>`;
  _attToday = await AttendanceBridge.fetchEventsForDay(_attCurDate);
  const paired = AttendanceBridge.pairEventsByStaff(_attToday);
  const active = Repository.getStaff().filter(e => e.active !== false);

  // Show every active staff member, even ones with zero events today
  // (so absences are visible, not just silently missing rows). Keyed
  // by resolving each paired event's staff_id/staff_number against
  // Staff Registry (see _resolveStaff) rather than a raw p.staffId
  // lookup — the Android app posts the human staffId number, not the
  // internal STAFF[i].id, so a raw key match here silently marked
  // everyone absent even after a real geofence check-in landed.
  const byId = new Map();
  paired.forEach(p => {
    const s = _resolveStaff(p.staffId, p.staffNumber);
    if (s) byId.set(s.id, p);
  });
  const rows = active.map(s => {
    const p = byId.get(s.id) || { in: null, out: null, sources: [], flagged: false };
    const late = _isLate(p.in, s);
    const status = p.in ? (p.out ? 'Left' : 'Present') : 'Absent (so far)';
    return { staff: s, ...p, late, status };
  }).sort((a, b) => (Number(a.staff.srNum) || 999) - (Number(b.staff.srNum) || 999));

  cont.innerHTML = `
    <div class="att-toolbar">
      <input type="date" id="att-today-date" value="${_attCurDate}" onchange="AttendanceUI.changeDate(this.value)">
      <span class="att-count">${rows.filter(r => r.in).length}/${rows.length} checked in</span>
    </div>
    <div class="mgr-table-scroll">
      <table class="att-table">
        <thead><tr><th>Sr#</th><th>Name</th><th>In</th><th>Out</th><th>Status</th><th>Source</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${r.late ? 'att-late' : ''} ${r.status === 'Absent (so far)' ? 'att-absent' : ''}">
              <td>${r.staff.srNum ?? ''}</td>
              <td>${_mgrEsc(r.staff.name)}</td>
              <td>${_fmtTime(r.in)}${r.late ? ' <span class="att-flag">late</span>' : ''}</td>
              <td>${_fmtTime(r.out)}</td>
              <td>${r.status}</td>
              <td>${(r.sources || []).join(', ') || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function changeDate(v) { _attCurDate = v; renderTodayView(); }

// ── MONTHLY ──────────────────────────────────────────────────────────
async function renderMonthView() {
  const cont = document.getElementById('att-sub-month');
  if (!cont) return;
  cont.innerHTML = `<div class="att-loading">Loading month…</div>`;
  _attMonth = await AttendanceBridge.fetchEventsForMonth(_attCurMonth);
  const active = Repository.getStaff().filter(e => e.active !== false);

  // Group by staff, then by day within the month, to get a present/
  // absent/late count per staff member.
  const daysInMonth = new Date(Number(_attCurMonth.slice(0, 4)), Number(_attCurMonth.slice(5, 7)), 0).getDate();
  const summary = active.map(s => {
    let present = 0, late = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = _attCurMonth + '-' + String(d).padStart(2, '0');
      const dayEvents = _attMonth.filter(ev => {
        if (ev.occurred_at.slice(0, 10) !== dateStr) return false;
        const matched = _resolveStaff(ev.staff_id, ev.staff_number);
        return matched ? matched.id === s.id : ev.staff_id === s.id;
      });
      const checkIn = dayEvents.find(ev => ev.event_type === 'check_in');
      if (checkIn) {
        present++;
        if (_isLate(checkIn.occurred_at, s)) late++;
      }
    }
    return { staff: s, present, absent: daysInMonth - present, late };
  }).sort((a, b) => (Number(a.staff.srNum) || 999) - (Number(b.staff.srNum) || 999));

  cont.innerHTML = `
    <div class="att-toolbar">
      <input type="month" id="att-month-picker" value="${_attCurMonth}" onchange="AttendanceUI.changeMonth(this.value)">
    </div>
    <div class="mgr-table-scroll">
      <table class="att-table">
        <thead><tr><th>Sr#</th><th>Name</th><th>Present</th><th>Absent</th><th>Late</th></tr></thead>
        <tbody>
          ${summary.map(r => `
            <tr>
              <td>${r.staff.srNum ?? ''}</td>
              <td>${_mgrEsc(r.staff.name)}</td>
              <td>${r.present}</td>
              <td>${r.absent}</td>
              <td>${r.late}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="att-note">Feeding this into the Salary report as an auto-deduction is a follow-up step, not wired yet — see the attendance spec's build order.</div>
  `;
}

function changeMonth(v) { _attCurMonth = v; renderMonthView(); }

// ── RAW LOG ──────────────────────────────────────────────────────────
async function renderLogView() {
  const cont = document.getElementById('att-sub-log');
  if (!cont) return;
  cont.innerHTML = `<div class="att-loading">Loading log…</div>`;
  _attLog = await AttendanceBridge.fetchRecentEvents(300);
  cont.innerHTML = `
    <div class="mgr-table-scroll">
      <table class="att-table">
        <thead><tr><th>When</th><th>Staff</th><th>Type</th><th>Source</th><th>Flag</th><th>Note</th></tr></thead>
        <tbody>
          ${_attLog.map(ev => `
            <tr class="${ev.is_flagged ? 'att-flagged-row' : ''}">
              <td>${new Date(ev.occurred_at).toLocaleString('en-PK')}</td>
              <td>${_mgrEsc(_staffName(ev.staff_id, ev.staff_number))}</td>
              <td>${ev.event_type === 'check_in' ? 'IN' : 'OUT'}</td>
              <td>${ev.source}</td>
              <td>${ev.is_flagged ? '⚠' : ''}${ev.is_mock_location ? ' 🚫mock' : ''}</td>
              <td>${_mgrEsc(ev.note || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── MANUAL ENTRY ─────────────────────────────────────────────────────
function renderManualView() {
  const cont = document.getElementById('att-sub-manual');
  if (!cont) return;
  const active = Repository.getStaff().filter(e => e.active !== false)
    .sort((a, b) => (Number(a.srNum) || 999) - (Number(b.srNum) || 999));
  cont.innerHTML = `
    <div class="att-manual-form">
      <label>Staff
        <select id="att-manual-staff">
          ${active.map(s => `<option value="${s.id}" data-num="${s.staffId || ''}">${_mgrEsc(s.name)}</option>`).join('')}
        </select>
      </label>
      <label>Type
        <select id="att-manual-type"><option value="check_in">Check in</option><option value="check_out">Check out</option></select>
      </label>
      <label>Date &amp; time
        <input type="datetime-local" id="att-manual-time" value="${new Date().toISOString().slice(0, 16)}">
      </label>
      <label>Reason / note
        <input type="text" id="att-manual-note" placeholder="e.g. phone battery died">
      </label>
      <button class="btn" onclick="AttendanceUI.submitManual()">Add entry</button>
    </div>
  `;
}

async function submitManual() {
  const staffSel = document.getElementById('att-manual-staff');
  const staffId = staffSel.value;
  const staffNumber = staffSel.selectedOptions[0]?.dataset.num || null;
  const eventType = document.getElementById('att-manual-type').value;
  const timeVal = document.getElementById('att-manual-time').value;
  const note = document.getElementById('att-manual-note').value;
  if (!staffId || !timeVal) { toast('⚠ Pick a staff member and time', 'w'); return; }
  try {
    await AttendanceBridge.addManualEvent({
      staffId, staffNumber, eventType,
      occurredAt: new Date(timeVal).toISOString(),
      note, managerLabel: 'manager',
    });
    toast('✓ Manual entry added');
    renderManualView();
  } catch (e) {
    toast('✗ Failed to add entry — see console', 'e');
  }
}

// ── LOCATION ─────────────────────────────────────────────────────────
// Lets the manager stand at the pharmacy and capture GPS coordinates
// directly into attendance_locations, instead of hand-editing lat/lng
// via SQL. Reuses AttendanceBridge.upsertLocation (already existed,
// no bridge changes needed) — passing the existing row's id updates it
// in place rather than creating a second active location.
let _attCapturedLoc = null;

async function renderLocationView() {
  const cont = document.getElementById('att-sub-location');
  if (!cont) return;
  const existing = (await AttendanceBridge.fetchLocations())[0] || null;
  _attCapturedLoc = null;
  cont.innerHTML = `
    <div class="att-manual-form">
      <p class="att-note">Stand inside or right outside the pharmacy, then tap Capture. This sets the center point the staff app's geofence checks against.</p>
      ${existing ? `<p class="att-note">Current: ${_mgrEsc(existing.name)} (${existing.lat.toFixed(6)}, ${existing.lng.toFixed(6)}), radius ${existing.radius_meters}m</p>` : `<p class="att-note">No location saved yet.</p>`}
      <div class="att-loc-btn-row">
        <button class="btn" onclick="AttendanceUI.captureLocation()">📍 Capture my current location</button>
        <button class="btn" onclick="AttendanceUI.openMapPicker()">🗺️ Pick on map</button>
      </div>
      <div id="att-loc-captured"></div>
      <label>Name
        <input type="text" id="att-loc-name" value="${_mgrEsc(existing?.name || 'Bahria Town Pharmacy')}">
      </label>
      <label>Radius (meters)
        <input type="number" id="att-loc-radius" value="${existing?.radius_meters ?? 100}" min="20" max="500">
      </label>
      <button class="btn" id="att-loc-save" onclick="AttendanceUI.saveLocation('${existing?.id || ''}')" disabled>Save location</button>
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <p class="att-note">
        <strong>Printable entrance QR code</strong> — the fallback check-in method for a phone
        whose automatic geofence isn't working (dead GPS signal, permissions revoked, etc.).
        Staff tap "Scan QR to check in/out" in the app and point the camera at this.
      </p>
      ${!existing
        ? `<p class="att-note">Save a location above first — the QR code is tied to it.</p>`
        : existing.qr_secret
          ? `
            <div id="att-qr-canvas" style="text-align:center; padding:16px; background:#fff; display:inline-block;"></div>
            <div>
              <button class="btn" onclick="AttendanceUI.printQr()">🖨️ Print</button>
              <button class="btn" onclick="AttendanceUI.rotateQr('${existing.id}')">🔄 Generate a new code (invalidates the old printout)</button>
            </div>
          `
          : `
            <p class="att-note">No QR code set up for this location yet.</p>
            <button class="btn" onclick="AttendanceUI.rotateQr('${existing.id}')">➕ Generate a QR code</button>
          `
      }
    </div>
  `;
  if (existing?.qr_secret) renderQrCanvas(existing.qr_secret);
}

// Renders the QR into #att-qr-canvas using the qrcode-generator library
// (loaded in index.html — see its <script> tag's comment for the
// verified SRI hash). Type 0 = auto-pick the smallest QR version that
// fits the data; error correction 'M' is a reasonable middle ground
// for a printed sign that might get slightly scuffed or angled.
function renderQrCanvas(secret) {
  const holder = document.getElementById('att-qr-canvas');
  if (!holder || typeof qrcode !== 'function') return;
  const qr = qrcode(0, 'M');
  qr.addData(secret);
  qr.make();
  holder.innerHTML = qr.createSvgTag(6, 4);
}

function printQr() {
  const svg = document.querySelector('#att-qr-canvas svg');
  if (!svg) { toast('⚠ No QR code to print', 'w'); return; }
  const name = document.getElementById('att-loc-name')?.value || 'Attendance check-in';
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Check-in QR — ${_mgrEsc(name)}</title></head>
    <body style="text-align:center; font-family:sans-serif; padding:40px;">
      <h2>${_mgrEsc(name)}</h2>
      <p>Scan to check in / check out</p>
      ${svg.outerHTML}
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

async function rotateQr(locationId) {
  if (!confirm('This invalidates any previously printed QR code — staff will need the new printout. Continue?')) return;
  // Random secret, same shape as the one already seeded via SQL
  // migration (attendance_locations_qr_secret) — generated the same
  // way here so a rotation from the dashboard is just as strong as
  // the original.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const secret = 'BT-QR-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try {
    await AttendanceBridge.upsertLocation({ id: locationId, qr_secret: secret });
    toast('✓ New QR code generated — print it and replace the old one');
    renderLocationView();
  } catch (e) {
    toast('✗ Failed to generate a new code — see console', 'e');
  }
}

function captureLocation() {
  const out = document.getElementById('att-loc-captured');
  const saveBtn = document.getElementById('att-loc-save');
  if (!navigator.geolocation) { toast('⚠ This browser can\'t get GPS location', 'w'); return; }
  out.innerHTML = 'Getting a GPS fix…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      _attCapturedLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      out.innerHTML = `Captured: ${_attCapturedLoc.lat.toFixed(6)}, ${_attCapturedLoc.lng.toFixed(6)} (±${Math.round(_attCapturedLoc.accuracy)}m accuracy)`;
      if (saveBtn) saveBtn.disabled = false;
    },
    err => { out.innerHTML = ''; toast('⚠ Could not get location — ' + err.message, 'w'); },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

// ── MAP PICKER ───────────────────────────────────────────────────────
// Alternative to captureLocation() for setting the geofence center:
// instead of trusting whatever fix the device's GPS gives right now
// (which can drift indoors, or simply be wrong), the manager opens a
// map, drags a pin to the exact spot, and confirms. Leaflet + OSM
// tiles, loaded on demand so the location tab doesn't pay for it
// unless it's used.
let _attLeafletLoading = null;
let _attMap = null;
let _attMapMarker = null;

function _loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (_attLeafletLoading) return _attLeafletLoading;
  _attLeafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the map library'));
    document.head.appendChild(script);
  });
  return _attLeafletLoading;
}

function _ensureMapModal() {
  let bg = document.getElementById('att-map-modal-bg');
  if (bg) return bg;
  bg = document.createElement('div');
  bg.id = 'att-map-modal-bg';
  bg.className = 'mbg';
  bg.innerHTML = `
    <div class="modal att-map-modal">
      <div class="mhdr">
        <h2>Pick pharmacy location</h2>
        <button class="mclose" onclick="AttendanceUI.closeMapPicker()">✕</button>
      </div>
      <div class="mbody">
        <p class="att-note">Search an address, or drag the pin (or tap the map) to the exact spot, then tap Use this location.</p>
        <div class="att-map-search-row">
          <input type="text" id="att-map-search" placeholder="Search an address or place…">
          <button class="btn" id="att-map-search-btn" onclick="AttendanceUI._mapSearch()">Search</button>
        </div>
        <div id="att-map-search-results"></div>
        <div id="att-map-container"></div>
        <div id="att-map-coords" class="att-note"></div>
        <button class="btn" id="att-map-confirm" onclick="AttendanceUI.confirmMapPick()">📍 Use this location</button>
      </div>
    </div>
  `;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) closeMapPicker(); });
  return bg;
}

async function openMapPicker() {
  const bg = _ensureMapModal();
  bg.classList.add('on');
  try {
    await _loadLeaflet();
  } catch (e) {
    toast('⚠ Could not load the map — check your connection', 'w');
    bg.classList.remove('on');
    return;
  }
  // Center on: whatever was just GPS-captured, else the existing saved
  // location, else a Bahria Town Lahore fallback so the map doesn't
  // open on the middle of the ocean.
  const existing = (await AttendanceBridge.fetchLocations())[0] || null;
  const start = _attCapturedLoc || existing || { lat: 31.298122, lng: 74.070445 };
  const coordsOut = document.getElementById('att-map-coords');

  requestAnimationFrame(() => {
    const el = document.getElementById('att-map-container');
    if (_attMap) { _attMap.remove(); _attMap = null; }
    _attMap = L.map(el).setView([start.lat, start.lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(_attMap);
    _attMapMarker = L.marker([start.lat, start.lng], { draggable: true }).addTo(_attMap);
    const updateCoords = latlng => {
      coordsOut.textContent = `Pin: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    };
    updateCoords(_attMapMarker.getLatLng());
    _attMapMarker.on('dragend', () => updateCoords(_attMapMarker.getLatLng()));
    _attMap.on('click', e => {
      _attMapMarker.setLatLng(e.latlng);
      updateCoords(e.latlng);
    });
    setTimeout(() => _attMap.invalidateSize(), 50);
  });
}

async function _mapSearch() {
  const q = document.getElementById('att-map-search').value.trim();
  const results = document.getElementById('att-map-search-results');
  if (!q) return;
  results.innerHTML = 'Searching…';
  try {
    // Nominatim's public search endpoint — fine for this occasional,
    // manager-initiated lookup (one request per Search click).
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
    const hits = await res.json();
    if (!hits.length) { results.innerHTML = '<p class="att-note">No matches found.</p>'; return; }
    results.innerHTML = hits.map((h, i) => `<div class="att-map-hit" data-i="${i}">${_mgrEsc(h.display_name)}</div>`).join('');
    results.querySelectorAll('.att-map-hit').forEach(row => {
      row.addEventListener('click', () => {
        const h = hits[Number(row.dataset.i)];
        const latlng = { lat: Number(h.lat), lng: Number(h.lon) };
        _attMap.setView([latlng.lat, latlng.lng], 18);
        _attMapMarker.setLatLng(latlng);
        document.getElementById('att-map-coords').textContent = `Pin: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        results.innerHTML = '';
      });
    });
  } catch (e) {
    results.innerHTML = '<p class="att-note">Search failed — check your connection.</p>';
  }
}

function closeMapPicker() {
  const bg = document.getElementById('att-map-modal-bg');
  if (bg) bg.classList.remove('on');
}

function confirmMapPick() {
  if (!_attMapMarker) return;
  const { lat, lng } = _attMapMarker.getLatLng();
  _attCapturedLoc = { lat, lng, accuracy: null };
  const out = document.getElementById('att-loc-captured');
  if (out) out.innerHTML = `Picked on map: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const saveBtn = document.getElementById('att-loc-save');
  if (saveBtn) saveBtn.disabled = false;
  closeMapPicker();
}

async function saveLocation(existingId) {
  if (!_attCapturedLoc) { toast('⚠ Capture your location first', 'w'); return; }
  const name = document.getElementById('att-loc-name').value.trim() || 'Bahria Town Pharmacy';
  const radius = Number(document.getElementById('att-loc-radius').value) || 100;
  try {
    const loc = { name, lat: _attCapturedLoc.lat, lng: _attCapturedLoc.lng, radius_meters: radius, active: true };
    if (existingId) loc.id = existingId;
    await AttendanceBridge.upsertLocation(loc);
    toast('✓ Location saved');
    renderLocationView();
  } catch (e) {
    toast('✗ Failed to save location — see console', 'e');
  }
}

// window bridge, same convention as switchMgrTab etc.
window.AttendanceUI = { switchSub, changeDate, changeMonth, submitManual, renderAttendanceTab, renderLocationView, captureLocation, openMapPicker, closeMapPicker, confirmMapPick, _mapSearch, saveLocation, copyNtfyTopic, printQr, rotateQr, changeIosStaff, copyIosField };

// ── NOTIFICATIONS (ntfy) ─────────────────────────────────────────────
// Real push notifications for check-in/check-out, via ntfy.sh — a
// free, no-signup, no-custom-app pub-sub service (see docs.ntfy.sh).
// A Supabase trigger (attendance_notify_manager, see
// supabase/migrations/20260919090000_attendance_notify_manager_ntfy.sql
// and its check-out follow-up) posts to this topic on every check-in
// AND check-out. This tab exists purely to make subscribing easy —
// there's no app-side code involved at all, ntfy is a separate,
// prebuilt app on the Play Store and App Store.
//
// The topic name below is effectively a password (ntfy has no sign-up
// or access control of its own — anyone who knows it can subscribe or
// publish to it, see docs.ntfy.sh/publish/#authentication). It's
// already alongside the anon key this whole file uses elsewhere,
// which is the same already-public tradeoff — this dashboard is meant
// for the manager's eyes, not the public. Don't paste this topic
// somewhere public (a forum post, a public chat) independent of this
// codebase.
const NTFY_TOPIC = 'bt-attendance-gWRxjNPA9m-QV6cQsm3Outf8';

function renderNotifyView() {
  const cont = document.getElementById('att-sub-notify');
  if (!cont) return;
  const androidDeepLink = `ntfy://ntfy.sh/${NTFY_TOPIC}`;
  cont.innerHTML = `
    <div class="att-manual-form">
      <p class="att-note">
        Get a real push notification the instant anyone checks in or out — works the same on
        iPhone or Android, and doesn't need this app to stay running in the background the way
        the old Android polling did.
      </p>

      <label>Your pharmacy's notification channel
        <input type="text" id="att-ntfy-topic" value="${_mgrEsc(NTFY_TOPIC)}" readonly>
      </label>
      <button class="btn" onclick="AttendanceUI.copyNtfyTopic()">📋 Copy channel name</button>

      <div class="att-note" style="margin-top:16px;">
        <strong>Setup — do this once per phone:</strong>
        <ol style="margin:8px 0 0 20px; padding:0;">
          <li>Install the free <strong>ntfy</strong> app —
            <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android (Play Store)</a>
            or
            <a href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone (App Store)</a>.
          </li>
          <li>Open the app and tap the <strong>+</strong> (add subscription) button.</li>
          <li>Paste in the channel name above (use the Copy button, then paste it into the "Topic name" field).</li>
          <li>Tap Subscribe. That's it — no account, no sign-up.</li>
        </ol>
      </div>

      <div class="att-note" style="margin-top:16px;">
        <strong>Android shortcut:</strong> if ntfy is already installed on this phone, this link
        opens the app straight to the subscribe screen with the channel pre-filled (this doesn't
        work on iPhone — Apple doesn't support this kind of link the way Android does, so use the
        manual steps above there):
        <br>
        <a href="${_mgrEsc(androidDeepLink)}">${_mgrEsc(androidDeepLink)}</a>
      </div>

      <p class="att-note" style="margin-top:16px;">
        Treat the channel name above like a password — anyone who has it can subscribe to the
        same notifications. It's fine to share it with other managers, just don't post it
        somewhere public.
      </p>
    </div>
  `;
}

function copyNtfyTopic() {
  navigator.clipboard.writeText(NTFY_TOPIC)
    .then(() => toast('✓ Copied — now paste it into the ntfy app'))
    .catch(() => toast('⚠ Could not copy — select and copy the text manually', 'w'));
}

// ── iPhone SETUP (Shortcuts automation) ─────────────────────────────
// No native iPhone app — see android-attendance's README on the Xcode/
// signing constraints that ruled that out. Instead each iPhone runs two
// Personal Automations in Apple's own built-in Shortcuts app ("Arrive"/
// "Leave" a location -> "Get Contents of URL", POSTing straight to
// attendance_events). Conceptually the same idea as the Android app's
// 'geofence' source (Apple's own location engine doing the detection,
// not a human tapping anything), but tagged source:'ios_shortcut' so
// Raw Log can tell it apart -- this path has none of the Android app's
// protections (no mock-location flag, no 5-minute debounce). See
// supabase/migrations/20260919110000_attendance_events_ios_shortcut_source.sql.
//
// Every value below is real and copy-pasteable, not a placeholder the
// reader has to edit -- the staff picker regenerates all of it
// (including the two JSON bodies) for whichever staff member is
// selected, the same way Manual Entry's staff dropdown works.
let _attIosStaffId = null;

async function renderIphoneView() {
  const cont = document.getElementById('att-sub-iphone');
  if (!cont) return;
  cont.innerHTML = `<div class="att-loading">Loading…</div>`;

  const active = Repository.getStaff().filter(e => e.active !== false)
    .sort((a, b) => (Number(a.srNum) || 999) - (Number(b.srNum) || 999));
  if (!active.length) {
    cont.innerHTML = `<p class="att-note">Add a staff member in Staff Registry first.</p>`;
    return;
  }
  if (!_attIosStaffId || !active.find(s => s.id === _attIosStaffId)) _attIosStaffId = active[0].id;
  const staff = active.find(s => s.id === _attIosStaffId);
  const staffNumber = staff.staffId || staff.id;

  const location = (await AttendanceBridge.fetchLocations())[0] || null;
  const { eventsUrl, anonKey } = AttendanceBridge.getRestConfig();

  const body = (eventType) => JSON.stringify({
    staff_id: staffNumber, staff_number: staffNumber, event_type: eventType, source: 'ios_shortcut',
  }, null, 2);

  cont.innerHTML = `
    <div class="att-manual-form">
      <p class="att-note">
        iPhone has no dedicated app — instead, each staff member sets up two <strong>Personal
        Automations</strong> in Apple's built-in Shortcuts app: one that fires on arrival at the
        pharmacy, one on leaving. Each automation makes a single silent web request that writes
        the check-in/out directly, the same as the Android app's geofence does.
      </p>
      <label>Generate instructions for
        <select id="att-ios-staff" onchange="AttendanceUI.changeIosStaff(this.value)">
          ${active.map(s => `<option value="${s.id}" ${s.id === staff.id ? 'selected' : ''}>${_mgrEsc(s.name)} (${_mgrEsc(s.staffId || s.id)})</option>`).join('')}
        </select>
      </label>
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <strong>Step 1 — Location</strong>
      ${location
        ? `<p class="att-note">In each automation's location picker, search for or drop a pin at:
             <strong>${_mgrEsc(location.name)}</strong> (${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}).
             Under "Show More," set radius to <strong>Small</strong> — closest match to the
             ${location.radius_meters}m geofence the Android app uses.</p>`
        : `<p class="att-note">⚠ No pharmacy location is saved yet — set one on the Location tab first, staff need its coordinates for this step.</p>`
      }
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <strong>Step 2 — Shared request details</strong>
      <p class="att-note">Both automations' "Get Contents of URL" action use the same URL, method, and headers:</p>
      ${_iosCopyRow('att-ios-url', 'URL', eventsUrl)}
      <p class="att-note" style="margin:8px 0 4px;">Method: <strong>POST</strong></p>
      <p class="att-note" style="margin:4px 0;">Headers (add all four, under "Headers" — not the request body):</p>
      ${_iosCopyRow('att-ios-hdr-apikey', 'apikey', anonKey)}
      ${_iosCopyRow('att-ios-hdr-auth', 'Authorization', 'Bearer ' + anonKey)}
      ${_iosCopyRow('att-ios-hdr-ct', 'Content-Type', 'application/json')}
      ${_iosCopyRow('att-ios-hdr-prefer', 'Prefer', 'return=minimal')}
      <p class="att-note">Request Body: choose <strong>JSON</strong>, then add the fields below (one per automation).</p>
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <strong>Step 3 — "Arrive" automation body</strong> (When I Arrive → ${_mgrEsc(location?.name || 'the pharmacy')})
      <p class="att-note">Add these as JSON dictionary fields:</p>
      ${_iosCopyRow('att-ios-in-id', 'staff_id', staffNumber)}
      ${_iosCopyRow('att-ios-in-num', 'staff_number', staffNumber)}
      ${_iosCopyRow('att-ios-in-type', 'event_type', 'check_in')}
      ${_iosCopyRow('att-ios-in-src', 'source', 'ios_shortcut')}
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <strong>Step 4 — "Leave" automation body</strong> (When I Leave → ${_mgrEsc(location?.name || 'the pharmacy')})
      <p class="att-note">Same fields, only <code>event_type</code> changes:</p>
      ${_iosCopyRow('att-ios-out-id', 'staff_id', staffNumber)}
      ${_iosCopyRow('att-ios-out-num', 'staff_number', staffNumber)}
      ${_iosCopyRow('att-ios-out-type', 'event_type', 'check_out')}
      ${_iosCopyRow('att-ios-out-src', 'source', 'ios_shortcut')}
    </div>

    <div class="att-manual-form" style="margin-top:16px;">
      <strong>Step 5 — Make it silent</strong>
      <p class="att-note">
        On each automation's final confirmation screen, turn off <strong>"Ask Before Running."</strong>
        Skipped, iOS pops a confirmation banner on every arrival/departure — with it off, both
        run automatically in the background, same as the Android app.
      </p>
      <p class="att-note">
        This path has no mock-location check and no duplicate-punch debounce (unlike the Android
        app) — Raw Log tags every event this way as <code>ios_shortcut</code> so it's easy to spot
        if something looks off.
      </p>
    </div>
  `;
}

function changeIosStaff(staffId) { _attIosStaffId = staffId; renderIphoneView(); }

// One labeled, read-only, copy-button row — used for every URL/header/
// body-field value above so staff never have to hand-type anything
// (typos here are silent failures: a wrong apikey just 401s, a wrong
// staff_id posts as somebody else).
function _iosCopyRow(id, label, value) {
  return `
    <div class="att-ios-row" style="display:flex; align-items:center; gap:8px; margin:4px 0;">
      <span style="min-width:110px; font-size:13px; color:#666;">${_mgrEsc(label)}</span>
      <input type="text" id="${id}" value="${_mgrEsc(value)}" readonly style="flex:1;">
      <button class="btn" onclick="AttendanceUI.copyIosField('${id}')">📋</button>
    </div>
  `;
}

function copyIosField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.value)
    .then(() => toast('✓ Copied'))
    .catch(() => toast('⚠ Could not copy — select and copy the text manually', 'w'));
}
