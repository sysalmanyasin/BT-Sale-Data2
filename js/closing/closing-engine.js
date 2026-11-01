// CLOSING (native) — pure logic ported from Closing: shift sequencing, snapshots, ledger engine and format helpers.

export function n(v) { return parseFloat(v) || 0; }

// ── Ported from Closing's state.js (pure, no DOM) ───────────────────
const SHIFT_SR = { Night: 1, Morning: 2, Evening: 3 };
export function srLabel(shift) { return `Closing ${SHIFT_SR[shift] || '?'} — ${shift}`; }
function baseSeq(shift) {
  if (shift === 'Night') return 10;
  if (shift === 'Evening') return 9999;
  return 20;
}
function getSeq(cdb, ds, shift) {
  const rec = cdb.sheets[`${ds}_${shift}`];
  if (rec && typeof rec.seq === 'number') return rec.seq;
  return baseSeq(shift);
}
export function daySlots(cdb, ds) {
  const prefix = ds + '_';
  const found = new Set(
    Object.keys(cdb.sheets)
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length))
  );
  found.add('Night'); found.add('Morning'); found.add('Evening');
  return Array.from(found)
    .map(shift => ({ shift, seq: getSeq(cdb, ds, shift) }))
    .sort((a, b) => a.seq - b.seq);
}
export function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Ported from Closing's components.js (pure) ──────────────────────
export function isRealSheet(rec) { return !!rec && rec.draft !== true; }
export function getRealSheet(cdb, key) { const rec = cdb.sheets[key]; return isRealSheet(rec) ? rec : null; }
function stepOneSlot(cdb, ds, shift, dir) {
  const slots = daySlots(cdb, ds);
  const idx = slots.findIndex(s => s.shift === shift);
  const curIdx = idx === -1 ? (dir > 0 ? -1 : slots.length) : idx;
  const nextIdx = curIdx + dir;
  if (nextIdx >= 0 && nextIdx < slots.length) return { date: ds, shift: slots[nextIdx].shift };
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + dir);
  return dir > 0 ? { date: localDateStr(d), shift: 'Night' } : { date: localDateStr(d), shift: 'Evening' };
}
export function timelineStep(cdb, ds, shift, steps) {
  const dir = steps >= 0 ? 1 : -1;
  let cur = { date: ds, shift };
  for (let i = 0; i < Math.abs(steps); i++) cur = stepOneSlot(cdb, cur.date, cur.shift, dir);
  return { key: `${cur.date}_${cur.shift}`, date: cur.date, shift: cur.shift };
}
export function sheetSortKey(cdb, k) {
  const parts = k.split('_');
  return parts[0] + '_' + String(getSeq(cdb, parts[0], parts[1])).padStart(6, '0');
}

// ── Ported from Closing's actions.js (pure) ─────────────────────────
export function findLastFinal(cdb, ds, shift) {
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
    const rec = getRealSheet(cdb, cur.key || `${cur.date}_${cur.shift}`);
    if (rec && rec.profileMode === 'final') return { key: `${cur.date}_${cur.shift}`, rec };
    if (!rec && i > 200) break;
  }
  return null;
}
// Trimmed to the two fields the Closing Book summary card needs — full
// aggregateSinceLastFinal() in Closing also tracks customers/shift
// sale/system returns/net cash for the sheet's own working card, which
// this read-only report has no use for.
export function aggregateBooksAndReturnsSinceLastFinal(cdb, ds, shift) {
  const lastFinal = findLastFinal(cdb, ds, shift);
  let totalBookBills = 0, totalManualReturns = 0;
  let cur = { date: ds, shift };
  for (let i = 0; i < 400; i++) {
    const key = `${cur.date}_${cur.shift}`;
    if (lastFinal && key === lastFinal.key) break;
    const rec = getRealSheet(cdb, key);
    if (!rec) { if (!lastFinal) break; else { cur = timelineStep(cdb, cur.date, cur.shift, -1); continue; } }
    if (rec.profileMode === 'final') break;
    totalManualReturns += n(rec.posRet1) + n(rec.posRet2) + n(rec.posRet3);
    totalBookBills += n(rec.inBook1) + n(rec.inBook2);
    cur = timelineStep(cdb, cur.date, cur.shift, -1);
  }
  return { totalBookBills, totalManualReturns };
}

// ── Ported from Closing's ledger-engine.js (pure) ───────────────────
function clBuildSnapshot(key, rec) {
  const parts = key.split('_');
  const lines = [];
  (rec.namedCredits || []).forEach(o => { const v = n(o.val); if (v !== 0) lines.push({ category: 'named', lbl: o.lbl || 'Named Account', desc: o.desc || '', val: v }); });
  (rec.tierCredits || []).forEach(o => { const v = n(o.val); if (v !== 0 && o.name) lines.push({ category: 'tier', lbl: o.name, val: v }); });
  (rec.auxCredits || []).forEach(o => { const v = n(o.val); if (v !== 0) lines.push({ category: 'aux', lbl: o.lbl || 'Credit Entry', val: v }); });
  return {
    key, date: parts[0] || '', shift: parts[1] || '',
    mode: rec.profileMode || 'shift', savedAt: rec.savedAt || Date.now(),
    openingCredit: n(rec.outPrevCredit), creditAdj: n(rec.creditAdj), totalCredit: n(rec.outTotalE),
    lines
  };
}
// Live-derived every render rather than trusting cdb.creditLedger as
// persisted — a pure map over cdb.sheets is simpler and can't go stale
// relative to whatever's actually in the synced file, same reasoning
// mlAllSnapshots() below already uses for Misc/Ongoing.
export function clAllSnapshotsLive(cdb) {
  return Object.entries(cdb.sheets || {}).filter(([, rec]) => isRealSheet(rec)).map(([key, rec]) => clBuildSnapshot(key, rec));
}
export function clAllLabels(snapshots) {
  const seen = new Set();
  snapshots.forEach(s => s.lines.forEach(l => seen.add(l.lbl)));
  return Array.from(seen).sort();
}
export function clGroupByDate(cdb, snapshots) {
  const sorted = [...snapshots].sort((a, b) => b.date !== a.date ? b.date.localeCompare(a.date) : getSeq(cdb, b.date, b.shift) - getSeq(cdb, a.date, a.shift));
  const groups = [], seen = {};
  sorted.forEach(s => { if (!seen[s.date]) { seen[s.date] = { date: s.date, snaps: [] }; groups.push(seen[s.date]); } seen[s.date].snaps.push(s); });
  return groups;
}
export function mlAllSnapshots(cdb) {
  const out = [];
  Object.entries(cdb.sheets || {}).forEach(([key, rec]) => {
    if (!rec || rec.draft) return;
    const rows = (rec.miscRows || []).filter(r => n(r.val) !== 0 || (r.label || '').trim());
    if (!rows.length) return;
    const parts = key.split('_');
    out.push({ key, date: parts[0] || '', shift: parts[1] || '', mode: rec.profileMode || 'shift',
      lines: rows.map(r => ({ lbl: (r.label || '').trim() || 'Untitled', val: n(r.val) })),
      total: rows.reduce((s, r) => s + n(r.val), 0) });
  });
  return out;
}

// ── Format helpers (ported) ──────────────────────────────────────────
export function clFmt(v) { return '₨ ' + Math.round(Math.abs(v)).toLocaleString(); }
export function clFmtSigned(v) { return (v >= 0 ? '+' : '−') + ' Rs. ' + Math.round(Math.abs(v)).toLocaleString(); }
export function clFmtDate(ds) { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ds; } }
