// ══════════════════════════════════════════════════════════════════════
// STAFF NOTES  —  V2 plan §4, staff card's 3rd tab
//
// Simple timestamped notes log per staff member — a personal record
// ("met about attendance on 3 July"), not staff-facing, no messaging/
// external API. Supabase-backed via the same generic feature-data sync
// path as Notes & Sheets (see supabase.js's `staffNotes` payload key).
//
// Real ES module from day one — imports Repository/Actions directly,
// no window-bridge for its own data path. Only the render entry point
// is bridged to `window.renderStaffNotesPanel` at the bottom, since
// manager.js's openStaffCard()/switchStaffCardTab() (still classic
// scripts) need to call it — same low-risk bridge pattern already used
// by ledger-page.js's renderLedgerView.
// ══════════════════════════════════════════════════════════════════════

import { Repository } from './repository.js';
import { Actions } from './actions.js';

const STAFF_NOTES_KEY = 'bt_staff_notes_v1';

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _load() {
  try { return JSON.parse(Repository.getItem(STAFF_NOTES_KEY) || '[]'); } catch (e) { return []; }
}
function _save(arr) { Actions.saveStaffNotes(JSON.stringify(arr)); }

function _fmtTs(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
       + ' · ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

// staffKey is emp.id ('emp_<timestamp>', stable since Actions.addEmployee
// creation) — falls back to staffId/name for any older record created
// before the `id` field existed.
export function keyForStaff(emp) {
  return (emp && (emp.id || emp.staffId || emp.name)) || '';
}

export function getNotes(staffKey) {
  return _load()
    .filter(n => n.staffKey === staffKey)
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
}

export function addNote(staffKey, text) {
  const t = (text || '').trim();
  if (!staffKey || !t) return null;
  const note = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    staffKey, text: t, ts: new Date().toISOString(),
  };
  const all = _load();
  all.push(note);
  _save(all);
  return note;
}

export function deleteNote(id) {
  _save(_load().filter(n => n.id !== id));
}

export function renderStaffNotesPanel(staffKey) {
  const panel = document.getElementById('sc-panel-notes');
  if (!panel) return;
  const notes = getNotes(staffKey);

  panel.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px;align-items:flex-end">
      <div class="sc-fg" style="flex:1;margin-bottom:0">
        <label>New note</label>
        <textarea id="sc-note-input" class="mgr-inp" rows="2"
          placeholder="e.g. &quot;met about attendance on 3 July&quot;"
          style="resize:vertical"></textarea>
      </div>
      <button class="btn btn-p" id="sc-note-add-btn">+ Add</button>
    </div>
    <div id="sc-notes-list">
      ${notes.length ? notes.map(n => `
        <div class="card" style="padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div style="white-space:pre-wrap;font-size:13px;flex:1;line-height:1.4">${_esc(n.text)}</div>
            <button data-del-id="${n.id}" title="Delete note"
              style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;flex-shrink:0">✕</button>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px">${_fmtTs(n.ts)}</div>
        </div>`).join('')
        : '<p style="text-align:center;color:var(--muted);padding:24px">No notes yet.</p>'}
    </div>`;

  const addBtn = panel.querySelector('#sc-note-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const ta = panel.querySelector('#sc-note-input');
      if (!ta || !ta.value.trim()) return;
      addNote(staffKey, ta.value);
      renderStaffNotesPanel(staffKey);
      if (typeof window.toast === 'function') window.toast('✓ Note added');
    });
  }
  panel.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!window.confirm('Delete this note?')) return;
      deleteNote(btn.dataset.delId);
      renderStaffNotesPanel(staffKey);
    });
  });
}

// Bridged — see header note.
window.renderStaffNotesPanel = renderStaffNotesPanel;
window.staffNotesKeyFor = keyForStaff;
