// ══════════════════════════════════════════════════════════════════════
// CONFLICT UI  —  Floor 4/5 (component + page glue)
//
// All DOM rendering for sync-conflict resolution. Moved out of
// actions.js (a Floor 3 business module must never touch the DOM —
// Golden Rule 3). This file subscribes to the EventBus itself and reacts
// to 'conflict:queued' by opening the modal defined in index.html.
//
// Load order requirement: after event-bus.js + repository.js + actions.js,
// alongside the other page/UI files.
// ══════════════════════════════════════════════════════════════════════

// Subscribe once: whenever Repository queues a genuine conflict, open the modal.
EventBus.onChange(function (eventName) {
  if (eventName !== 'conflict:queued') return;
  openConflictModal();
});

// Manual entry point (e.g. a "Review Conflicts" button in the UI).
function reviewConflicts() {
  const pending = Repository.getPendingConflicts();
  if (!pending.length) { if (typeof toast === 'function') toast('No pending conflicts'); return; }
  const bg = document.getElementById('conflict-modal-bg');
  if (bg) { openConflictModal(); return; }
  // Legacy fallback only if the modal markup isn't present in this build
  pending.forEach(function () {
    const c = Repository.getPendingConflicts()[0];
    if (!c) return;
    const label = c.kind === 'daily' ? 'Daily entry ' + c.key
      : c.kind === 'staff' ? 'Staff record — ' + (c.local.name || c.incoming.name || c.key)
      : 'Monthly ' + c.key;
    const msg = label + ' was edited on two devices.\n\n'
      + (c.kind === 'staff'
        ? 'This device:  active=' + c.local.active + ', Sr#=' + c.local.srNum + '\n'
          + 'Other device: active=' + c.incoming.active + ', Sr#=' + c.incoming.srNum + '\n\n'
        : 'This device:  TOTAL = ' + c.local.TOTAL + '\n'
          + 'Other device: TOTAL = ' + c.incoming.TOTAL + '\n\n')
      + 'Click OK to keep THIS device\'s version, Cancel to keep the OTHER device\'s version.';
    const keepLocal = window.confirm(msg);
    Repository.resolveConflict(0, keepLocal ? 'local' : 'incoming');
  });
  if (typeof rebuildAll === 'function') rebuildAll();
  if (typeof toast === 'function') toast('✓ Conflicts resolved');
}

// Opens the conflict-modal-bg (defined in index.html) and populates it
// with the first pending conflict. Advances through the queue after each
// resolve. Falls back gracefully if the modal hasn't been added to the DOM.
function openConflictModal() {
  const pending = Repository.getPendingConflicts();
  if (!pending.length) return;
  const bg = document.getElementById('conflict-modal-bg');
  if (!bg) { reviewConflicts(); return; } // legacy fallback

  const c = pending[0];
  const label = c.kind === 'daily'
    ? 'Daily entry — ' + c.key
    : c.kind === 'staff'
    ? 'Staff record — ' + (c.local.name || c.incoming.name || c.key)
    : 'Monthly record — ' + c.key;
  document.getElementById('conflict-label').textContent = label;

  // Show the most meaningful field differences, not the full JSON blob
  const ignore = new Set(['_updatedAt', '_source']);
  const diff = {};
  const allKeys = new Set([...Object.keys(c.local || {}), ...Object.keys(c.incoming || {})]);
  allKeys.forEach(function (k) {
    if (ignore.has(k)) return;
    const lv = c.local ? c.local[k] : undefined;
    const iv = c.incoming ? c.incoming[k] : undefined;
    if (lv !== iv) diff[k] = { local: lv, incoming: iv };
  });

  const fmtLocal = function (obj) {
    return Object.entries(obj).map(function ([k, v]) { return k + ': ' + (v.local != null ? v.local : '—'); }).join('\n');
  };
  const fmtIncoming = function (obj) {
    return Object.entries(obj).map(function ([k, v]) { return k + ': ' + (v.incoming != null ? v.incoming : '—'); }).join('\n');
  };

  document.getElementById('conflict-local').textContent = fmtLocal(diff) || '(no differing fields)';
  document.getElementById('conflict-incoming').textContent = fmtIncoming(diff) || '(no differing fields)';

  const rem = pending.length;
  document.getElementById('conflict-remaining').textContent =
    rem > 1 ? (rem - 1) + ' more conflict' + (rem > 2 ? 's' : '') + ' after this one' : '';

  bg.style.display = 'flex';
}

// Called by the modal's "Keep This Device" / "Keep Cloud Version" buttons.
function _conflictChoose(choice) {
  Repository.resolveConflict(0, choice);
  const bg = document.getElementById('conflict-modal-bg');
  if (bg) bg.style.display = 'none';
  const remaining = Repository.getPendingConflicts();
  if (remaining.length) {
    setTimeout(openConflictModal, 250);
  } else {
    if (typeof rebuildAll === 'function') rebuildAll();
    if (typeof toast === 'function') toast('✓ All conflicts resolved');
  }
}
