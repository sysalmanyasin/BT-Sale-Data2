// ══════════════════════════════════════════════════════════════════════
// AUDIT NATIVE  —  Assignments Overview + Live Snapshot popup
//
// Read-only, ported from Pharmacy Audit Hub's own dashboard-actions.js /
// dashboard-components.js / assignment-components.js — every engagement
// (open AND closed), each round's Auditor Progress + Company Coverage,
// and the same "peek at their live counts" popup the Main Auditor uses,
// all off data already reachable through Supabase's RLS-scoped anon key
// (see audit-bridge.js's getFullData()).
//
// Deliberately left out of this port: every WRITE action Random's own
// version of these screens has — Force Submit, Move to…, Revoke,
// resolving cross-round conflicts. This app only ever runs SELECTs
// against Random's Supabase project; adding writes here would mean two
// independent app instances mutating the same rows with no
// coordination between them, which is a real correctness risk, not
// just a scope question. Use the real app (the Audit Cover tile still
// links to random.duapharma.com) for anything that needs to change
// state. "Refresh" on the Live Snapshot popup is safe to keep — it's
// just a re-fetch, not a write.
// ══════════════════════════════════════════════════════════════════════

import * as AuditBridge from './audit-bridge.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ── Ported from dashboard-actions.js's mainAuditorDashboard() (pure) ──
function buildEngagementDashboard(data, engagement, focusRoundId) {
  const engRounds = data.rounds.filter(r => r.engagement_id === engagement.id).sort((a, b) => a.round_number - b.round_number);
  const focusRound = (focusRoundId && engRounds.find(r => r.id === focusRoundId)) || null;
  const latestRound = focusRound || engRounds[engRounds.length - 1] || null;
  const roundAssignments = latestRound ? data.assignments.filter(a => a.round_id === latestRound.id && a.status !== 'revoked') : [];
  const compiled = latestRound ? data.compiledRounds.filter(c => c.round_id === latestRound.id).pop() : null;

  const auditorProgress = roundAssignments.map(a => {
    const total = (a.items || []).length;
    const counted = Math.min(a.progress_count || 0, total);
    return {
      auditorName: a.auditor_name, assignmentId: a.id, itemCount: total, counted,
      pct: total > 0 ? Math.round((counted / total) * 100) : 0,
      status: a.status, submitted: a.status === 'submitted',
    };
  });

  const companiesInFocus = latestRound
    ? [...new Set((latestRound.item_snapshot || []).map(it => it.company))].sort((a, b) => a.localeCompare(b))
    : (engagement.scope_companies || []);
  const companyStatus = companiesInFocus.map(company => ({
    company,
    assigned: roundAssignments.some(a => (a.companies || []).includes(company)),
    auditor: (roundAssignments.find(a => (a.companies || []).includes(company)) || {}).auditor_name || '—',
  }));

  const lastFinal = data.finalSnapshots.filter(s => s.engagement_id === engagement.id)[0] || null;

  return {
    engRounds, latestRound,
    engagementStatus: engagement.status,
    roundStatus: latestRound ? { number: latestRound.round_number, suffix: latestRound.round_suffix || '', state: latestRound.state } : null,
    companyStatus, auditorProgress,
    compileStatus: compiled ? { compiledAt: compiled.compiled_at, variances: (compiled.variances || []).length } : 'not compiled',
    lastFinal,
  };
}

// ── Ported from dashboard-actions.js's Live Snapshot helpers (pure) ──
function buildLiveSnapshotRows(assignment) {
  const snap = (assignment && assignment.live_snapshot) || {};
  const counts = snap.counts || {};
  return (assignment ? assignment.items || [] : []).map(item => {
    const counted = counts[item.itemKey];
    const hasCount = counted !== undefined;
    const variance = hasCount ? counted - item.qty : null;
    let status;
    if (!hasCount) status = 'unverified';
    else if (variance < 0) status = 'short';
    else if (variance > 0) status = 'over';
    else status = 'match';
    return { itemKey: item.itemKey, name: item.name, company: item.company, qty: item.qty, counted, hasCount, variance, status };
  });
}
function filterLiveSnapshotRows(rows, filterMode) {
  if (!filterMode || filterMode === 'all') return rows;
  if (filterMode === 'shorts') return rows.filter(r => r.status === 'short');
  if (filterMode === 'overs') return rows.filter(r => r.status === 'over');
  if (filterMode === 'unverified') return rows.filter(r => r.status === 'unverified');
  return rows;
}
function sortLiveSnapshotRows(rows, sortMode) {
  const sorted = rows.slice();
  if (sortMode === 'name-desc') sorted.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortMode === 'variance-desc' || sortMode === 'variance-asc') {
    sorted.sort((a, b) => {
      if (a.hasCount !== b.hasCount) return a.hasCount ? -1 : 1;
      if (!a.hasCount) return 0;
      const av = Math.abs(a.variance), bv = Math.abs(b.variance);
      return sortMode === 'variance-desc' ? bv - av : av - bv;
    });
  } else sorted.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

// ── Page state ────────────────────────────────────────────────────────
const anState = { openEngagements: new Set(), openSections: new Map(), snapshotAssignmentId: null, snapshotFilter: 'all', snapshotSort: 'name-asc' };

// ── Render: Assignments Overview page ───────────────────────────────
function renderAssignmentsPage() {
  const container = document.getElementById('an-list');
  const statusEl = document.getElementById('an-status');
  if (!container) return;
  const data = AuditBridge.getFullData();
  if (!data) { container.innerHTML = `<div class="cln-empty">⏳ Loading from Audit…</div>`; return; }
  if (statusEl) statusEl.textContent = `Synced ${new Date(data.fetchedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} · ${data.engagements.length} engagement(s)`;

  const sorted = data.engagements.slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1; // open first
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (!sorted.length) { container.innerHTML = `<div class="cln-empty">📭 No engagements yet.</div>`; return; }

  container.innerHTML = sorted.map(e => {
    const dash = buildEngagementDashboard(data, e);
    const isOpenCard = anState.openEngagements.has(e.id);
    const openSections = anState.openSections.get(e.id) || new Set();
    const isSectionOpen = k => openSections.has(k);

    const auditorRows = dash.auditorProgress.map(a => {
      const clickable = !a.submitted && a.status !== 'assigned';
      return `<div class="an-movable-row" style="flex-direction:column;align-items:stretch;gap:4px;${clickable ? 'cursor:pointer' : ''}" ${clickable ? `onclick="anOpenSnapshot('${esc(a.assignmentId)}')"` : ''}>
        <div style="display:flex;justify-content:space-between">
          <span>${esc(a.auditorName)} · ${a.itemCount} lines</span>
          <span class="an-val-badge ${a.submitted ? 'an-val-green' : 'an-val-grey'}">${a.submitted ? 'Submitted' : esc(a.status)}</span>
        </div>
        ${clickable ? `<div class="an-progress-track"><div class="an-progress-fill" style="width:${a.pct}%"></div></div><div style="font-size:10px;color:var(--muted);text-align:right">${a.counted}/${a.itemCount} · tap to peek at live counts →</div>` : ''}
      </div>`;
    }).join('') || `<div style="font-size:12px;color:var(--muted);padding:6px 0">No assignments yet.</div>`;

    const companyRows = dash.companyStatus.map(c => `<div class="an-movable-row"><span>${esc(c.company)}</span><span style="font-size:11px;color:${c.assigned ? '#047857' : 'var(--muted)'}">${c.assigned ? esc(c.auditor) : 'Unassigned'}</span></div>`).join('');

    const assignedCount = dash.companyStatus.filter(c => c.assigned).length;
    const submittedCount = dash.auditorProgress.filter(a => a.submitted).length;
    const compileSummary = typeof dash.compileStatus === 'string' ? esc(dash.compileStatus) : `${dash.compileStatus.variances} variance(s) as of ${new Date(dash.compileStatus.compiledAt).toLocaleString('en-PK')}`;
    const compileBadge = typeof dash.compileStatus === 'string' ? '' : `${dash.compileStatus.variances} variance(s)`;

    const lastFinalHtml = dash.lastFinal ? `<div class="an-movable-row"><span>Last completed audit</span><span style="font-weight:800;color:${dash.lastFinal.report.totalVarianceValue < 0 ? '#DC2626' : '#047857'}">₨${Math.abs(Math.round(dash.lastFinal.report.totalVarianceValue)).toLocaleString()} ${dash.lastFinal.report.totalVarianceValue < 0 ? 'short' : 'over'} · ${dash.lastFinal.report.totalItems} items</span></div>` : '';

    const section = (key, title, summary, bodyHtml) => `
      <div class="an-history-item${isSectionOpen(key) ? ' an-open' : ''}">
        <div class="an-history-header" onclick="anToggleSection('${esc(e.id)}','${key}')">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden"><span class="an-arrow">▶</span><strong style="color:var(--text);font-size:12.5px">${title}</strong></div>
          <span style="font-size:11px;color:var(--muted);flex-shrink:0;margin-left:8px">${summary}</span>
        </div>
        <div class="an-history-body">${bodyHtml}</div>
      </div>`;

    return `<div class="an-engagement-card">
      <div class="an-engagement-head" onclick="anToggleEngagement('${esc(e.id)}')">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:var(--text);font-size:14px">${esc(e.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${dash.roundStatus ? `Round ${dash.roundStatus.number}${esc(dash.roundStatus.suffix || '')} · ${esc(dash.roundStatus.state)}` : 'No rounds yet'}</div>
        </div>
        <span class="an-val-badge ${e.status === 'open' ? 'an-val-gold' : 'an-val-navy'}">${esc(e.status)}</span>
        <span class="an-chevron">▶</span>
      </div>
      <div class="an-engagement-body">
        ${lastFinalHtml}
        ${section('auditor-progress', 'Auditor Progress', `${submittedCount}/${dash.auditorProgress.length} submitted`, auditorRows)}
        ${section('company-coverage', 'Company Coverage', `${assignedCount}/${dash.companyStatus.length} assigned`, companyRows)}
        ${section('compile-status', 'Compile Status', compileBadge, compileSummary)}
      </div>
    </div>`;
  }).join('');

  // Re-apply "open" class to cards that were open before this rebuild
  anState.openEngagements.forEach(id => document.querySelector(`.an-engagement-card[data-eid="${CSS.escape(id)}"]`)?.classList.add('an-open'));
}

function anToggleEngagement(id) {
  if (anState.openEngagements.has(id)) anState.openEngagements.delete(id); else anState.openEngagements.add(id);
  renderAssignmentsPage();
}
function anToggleSection(eid, key) {
  const set = anState.openSections.get(eid) || new Set();
  if (set.has(key)) set.delete(key); else set.add(key);
  anState.openSections.set(eid, set);
  renderAssignmentsPage();
}

// ── Render: Live Snapshot popup ─────────────────────────────────────
function anOpenSnapshot(assignmentId) {
  anState.snapshotAssignmentId = assignmentId;
  anState.snapshotFilter = 'all';
  anState.snapshotSort = 'name-asc';
  document.getElementById('an-snapshot-overlay')?.classList.add('an-open');
  renderSnapshotModal();
}
function anCloseSnapshot() {
  document.getElementById('an-snapshot-overlay')?.classList.remove('an-open');
  anState.snapshotAssignmentId = null;
}
function anSetSnapshotFilter(mode) { anState.snapshotFilter = mode; renderSnapshotModal(); }
function anCycleSnapshotSort() {
  const order = ['name-asc', 'name-desc', 'variance-desc', 'variance-asc'];
  anState.snapshotSort = order[(order.indexOf(anState.snapshotSort) + 1) % order.length];
  renderSnapshotModal();
}
async function anRefreshSnapshot() {
  await AuditBridge.refreshFullData(true);
  renderSnapshotModal();
  renderAssignmentsPage();
}

function renderSnapshotModal() {
  const body = document.getElementById('an-snapshot-body');
  if (!body) return;
  const data = AuditBridge.getFullData();
  const assignment = data && data.assignments.find(a => a.id === anState.snapshotAssignmentId);
  if (!assignment) { body.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:20px 0;text-align:center">Could not load this assignment.</div>`; return; }

  const rows = sortLiveSnapshotRows(filterLiveSnapshotRows(buildLiveSnapshotRows(assignment), anState.snapshotFilter), anState.snapshotSort);
  const snap = assignment.live_snapshot || {};
  const updatedLabel = snap.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }) : null;

  const shortCount = rows.filter(r => r.status === 'short').length;
  const overCount = rows.filter(r => r.status === 'over').length;
  const matchCount = rows.filter(r => r.status === 'match').length;
  const unverifiedCount = rows.filter(r => r.status === 'unverified').length;

  const rowsHtml = rows.map(r => {
    const varHtml = !r.hasCount ? `<span style="color:var(--muted)">—</span>`
      : r.variance === 0 ? `<span style="color:var(--muted)">0</span>`
      : `<span style="color:${r.variance < 0 ? '#DC2626' : '#047857'};font-weight:800">${r.variance > 0 ? '+' : ''}${r.variance}</span>`;
    return `<div class="an-movable-row">
      <span style="min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${esc(r.name)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(r.company)} · Sys ${r.qty}</div>
      </span>
      <span style="text-align:right;font-weight:700">${r.hasCount ? r.counted : '<span style="color:var(--muted);font-weight:600">not yet</span>'}</span>
      <span style="text-align:right;min-width:36px">${varHtml}</span>
    </div>`;
  }).join('');

  const chip = (mode, label) => `<button class="an-filter-btn${anState.snapshotFilter === mode ? ' an-filter-btn-active' : ''}" onclick="anSetSnapshotFilter('${mode}')">${label}</button>`;
  const sortLabel = anState.snapshotSort === 'name-desc' ? 'Z-A' : anState.snapshotSort === 'variance-desc' ? 'Variance ▼' : anState.snapshotSort === 'variance-asc' ? 'Variance ▲' : 'A-Z';

  document.getElementById('an-snapshot-title').textContent = `${assignment.auditor_name}'s live counts`;
  body.innerHTML = `
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
      ${updatedLabel ? 'Last synced ' + updatedLabel : "Nothing synced yet — they haven't entered a count on this device yet."}
      This is a refreshing snapshot, not live/real-time — tap Refresh to pull the latest.
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:8px">
      <div style="color:#DC2626">Short: ${shortCount}</div>
      <div style="color:#047857">Over: ${overCount}</div>
      <div style="color:var(--muted)">Match: ${matchCount}</div>
      <div style="color:#B45309">Unverified: ${unverifiedCount}</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${chip('all', 'All')}${chip('shorts', 'Shorts ▼')}${chip('overs', 'Overs ▲')}${chip('unverified', 'Unverified')}
      <button class="an-sort-btn" style="margin-left:auto" onclick="anCycleSnapshotSort()">↕️ ${sortLabel}</button>
    </div>
    ${snap.extraNote ? `<div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:8px;padding:8px 10px;margin-bottom:10px">
      <div style="font-size:10.5px;font-weight:800;color:#B45309;text-transform:uppercase;margin-bottom:3px">Items found — not in system</div>
      <div style="font-size:12px;color:var(--text);white-space:pre-wrap">${esc(snap.extraNote)}</div></div>` : ''}
    <div style="max-height:42vh;overflow:auto;margin-bottom:10px">${rowsHtml || `<div style="font-size:12px;color:var(--muted);padding:10px 0">No items match this filter.</div>`}</div>
    <button class="an-btn-primary" style="width:100%" onclick="anRefreshSnapshot()">🔄 Refresh</button>`;
}

// ── Page-show hook — called from ui.js's showPage() ─────────────────
export function onShowAssignments() { AuditBridge.refreshFullData(false).then(renderAssignmentsPage); renderAssignmentsPage(); }
export function onBridgeRefresh() { renderAssignmentsPage(); if (anState.snapshotAssignmentId) renderSnapshotModal(); }

window.anToggleEngagement = anToggleEngagement;
window.anToggleSection = anToggleSection;
window.anOpenSnapshot = anOpenSnapshot;
window.anCloseSnapshot = anCloseSnapshot;
window.anSetSnapshotFilter = anSetSnapshotFilter;
window.anCycleSnapshotSort = anCycleSnapshotSort;
window.anRefreshSnapshot = anRefreshSnapshot;
window.auditNativeOnRefresh = onBridgeRefresh;
window.anOnShowAssignments = onShowAssignments;
