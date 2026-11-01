// ══════════════════════════════════════════════════════════════════════
// AI CENTER — UI
//
// Presentation only. Everything shown comes from:
//   • adapters.js  (existing tools / bridges / agent tables)
//   • telemetry    (real agent events)
//   • model.js     (pure mapping + rules)
// "Ask Dua" buttons open the global assistant panel (js/agent/ui/agent-panel.js) through window.BTAgent; approval
// cards, the lock, the kill switch, undo and audit all stay in that one system. This page has no chat of its own.
// All text is inserted with textContent (never innerHTML) except the
// assistant's own markdown, which goes through its existing escaping renderer.
// ══════════════════════════════════════════════════════════════════════
import * as V from '../agent/ui/voice.js';
import * as AV from './avatar.js';
import * as DK from './deck-model.js';
import * as FG from './forecast-game.js';
import { listTools } from '../agent/core/tool-registry.js';
import * as T from '../agent/core/telemetry.js';
import { pushUndo, runUndo } from '../agent/core/undo.js';
import { markUndone } from '../agent/core/undo-store.js';
import { fetchAudit, summarizeAudit } from '../agent/core/usage-stats.js';
import { collectSnapshot, collectHealth, collectActions, getSb } from './adapters.js';
import * as M from './model.js';
import * as C from './copilot.js';
import * as RI from './repo-intel.js';
import { $, LS_DISMISS, LS_VISIT, PAGE_ID, REFRESH_MS, S, SCROLL_QUIET_MS, STALE_MS, ask, card, clock, closeModal, coreInfo, dkCard, dkWait, empty, h, ic, investigate, kvList, lsGet, lsSet, modalEl, openModal, openPage, pageOn, pill, root, scrollingNow, sectionHeader, skeleton, toast, tone, trapTab, visibleFindings, watchScrolling } from './ui-base.js';
import { deepViews, draftsNode, eventList, openDraft, outcomeChip, secDkAudit, secDkExpiry, secDkGame, secDkPay, secHealth, secObs, secTools, tagEl } from './ui-detail.js';
import { RUN_LABEL, RUN_TONE, allRuns, assessmentNode, openRun, ringGauge, runsBlock, secFleet, secForecast, secInvStr, secMoney, secNetwork, secRuns, weekdayBars } from './ui-panels.js';

// ───────────────────────── data refresh ─────────────────────────
async function refresh({ force = false } = {}) {
  if (S.loading) return;
  if (!force && S.snap && Date.now() - S.lastRefreshAt < REFRESH_MS) return;
  S.loading = true; S.error = null; render();
  try {
    const prev = S.snap && S.snap.findings, prevPartial = M.isPartialSnapshot(S.snap);
    const snap = await collectSnapshot();
    S.snap = snap; S.lastRefreshAt = Date.now();
    // Sales data can still be loading right after the page opens: re-read a few times instead of showing false alarms.
    const pending = snap.raw && snap.raw.briefing && snap.raw.briefing.sales_data_ready === false;
    S.pendingTries = pending ? (S.pendingTries || 0) + 1 : 0;
    if (pending && S.pendingTries <= 6) setTimeout(() => { S.lastRefreshAt = 0; refresh({ force: true }); }, 2500);
    const d = M.diffFindings(prev, snap.findings);
    if (prev && !prevPartial && !M.isPartialSnapshot(snap)) { // while sales is still loading the findings are incomplete: do not log false new/cleared events
      d.added.forEach(f => T.emit({ type: 'finding_new', source: 'ai-center', severity: f.severity, domain: f.system.toLowerCase(), entity_reference: f.id, metadata: { title: f.title } }));
      d.cleared.forEach(f => T.emit({ type: 'finding_cleared', source: 'ai-center', domain: f.system.toLowerCase(), entity_reference: f.id, metadata: { title: f.title } }));
    }
    T.emit({ type: 'snapshot', source: 'ai-center', status: snap.tableReadyErrors ? 'partial' : 'ok', metadata: { reads: 6, findings: snap.findings.length, failed: snap.tableReadyErrors } });
    if (!S.baseline) S.baseline = lsGet(LS_VISIT);
    render();
    const [health, actions, hist] = await Promise.all([collectHealth(snap), collectActions(), fetchAudit(getSb(), 8)]);
    S.health = health; S.actions = actions; S.history = summarizeAudit(hist);
  } catch (e) { S.error = (e && e.message) || 'Could not read business data.'; console.error('[ai-center]', e); }
  S.loading = false; render();
}
function persistVisit() {
  if (!S.snap || M.isPartialSnapshot(S.snap)) return;
  lsSet(LS_VISIT, { at: Date.now(), findings: S.snap.findings.map(f => ({ id: f.id, title: f.title })) });
}

// ───────────────────────── render scheduling ─────────────────────────
export function render() {
  if (!S.mounted || S.rafId) return;
  // Never repaint under a moving finger either: replaceChildren() cancels touch/momentum scrolling.
  if (scrollingNow()) { clearTimeout(S.scrollT); S.scrollT = setTimeout(render, SCROLL_QUIET_MS + 50); return; }
  S.rafId = requestAnimationFrame(() => { S.rafId = 0; if (scrollingNow()) { clearTimeout(S.scrollT); S.scrollT = setTimeout(render, SCROLL_QUIET_MS + 50); return; } paint(); });
}

function secHeaderBar(core) {
  const stale = S.snap && Date.now() - S.snap.at > STALE_MS;
  const cls = core.state === 'OFFLINE' || core.state === 'ERROR' ? 'cr' : core.state === 'READY' || core.state === 'IDLE' ? 'ok' : 'cy';
  const fresh = S.snap ? 'Data as of ' + clock(S.snap.at) + ' (' + M.ageLabel(S.snap.at) + ')' + (stale ? ' · stale, refresh to update' : '') : (S.loading ? 'Reading business data…' : 'Waiting for data');
  // One authoritative status (the pill) and one freshness line. Counts live in the snapshot and in Needs attention, not here.
  return h('header', { class: 'aic-hdr' },
    h('div', { class: 'aic-hr1' },
      h('h1', { text: 'BT INTELLIGENCE' }),
      h('span', { class: 'aic-live aic-' + cls, 'aria-live': 'polite' }, h('i', { class: 'aic-dot' }), core.state.replace(/_/g, ' '))),
    h('div', { class: 'aic-hr2' },
      h('span', { class: 'aic-fresh2' + (stale ? ' aic-wn' : ''), text: fresh }),
      h('div', { class: 'aic-seg' },
        h('button', { text: S.loading ? 'Reading…' : 'Refresh', disabled: S.loading, onclick: () => refresh({ force: true }) }),
        h('button', { text: '⌘K', 'aria-label': 'Open command palette', onclick: openPalette }))));
}




// Personal avatar: the person's own photo is kept ON THIS DEVICE only (localStorage) and never committed to the repo.
// Storage + preferences live in avatar.js; the avatar settings sheet (openAvatarSettings) is opened by tapping the avatar.
function setAvatarPhoto(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      // A square image is treated as finished art (e.g. a stylised avatar) and used whole; anything else is a photo and gets auto-framed.
      const art = Math.abs(img.width / img.height - 1) < 0.1, px = art ? 480 : 320;
      const side = art ? Math.min(img.width, img.height) : Math.min(img.width * 0.6, img.height);
      const cx = img.width / 2, cy = art ? img.height / 2 : Math.min(img.height - side / 2, Math.max(side / 2, img.height * 0.46));
      const cv = document.createElement('canvas'); cv.width = cv.height = px;
      cv.getContext('2d').drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, px, px);
      try { localStorage.setItem(AV.KEYS.photo, cv.toDataURL('image/jpeg', 0.88)); localStorage.setItem(AV.KEYS.mode, art ? 'art' : 'photo'); } catch (e) { toast('Could not save the photo on this device'); return; }
      render(); if (modalEl) openAvatarSettings();
    };
    img.src = String(rd.result);
  };
  rd.readAsDataURL(file);
}
function clearAvatarPhoto() { AV.clearPhoto(); render(); if (modalEl) openAvatarSettings(); }

if (typeof window !== 'undefined' && !window.__btJarvisTalk) {
  window.__btJarvisTalk = true;
  let poll = null;
  const apply = on => {
    S.voice.talking = !!on; AV.setTalking(on);
    document.querySelectorAll('.aic-stage').forEach(el => el.setAttribute('data-talk', on ? '1' : '0'));
    const pill = document.querySelector('.aic-hpill');
    if (pill) { pill.classList.toggle('talk', !!on); pill.textContent = on ? 'Dua speaking' : (pill.classList.contains('off') ? 'Dua offline' : 'Dua online'); }
    clearInterval(poll); poll = null;
    if (on) poll = setInterval(() => { try { if (!window.speechSynthesis.speaking) apply(false); } catch (_) { apply(false); } }, 700); // some mobile browsers never fire "end"
  };
  window.addEventListener('bt-voice-state', e => apply(e.detail && e.detail.speaking));
}

function jarvisAvatar() { return AV.buildFace(); }

// The avatar is the whole top of the page: tap it for its settings. The state stays available to screen readers only; the visible
// status is the one pill in secHero. Mission / lifecycle detail lives in Operations & Diagnostics and in the chat itself.
function secCore(info) {
  const { core } = info;
  const open = () => openAvatarSettings();
  return h('div', { class: 'aic-corerow', id: 'aic-core' },
    h('div', { class: 'aic-stage', 'data-s': core.state.toLowerCase(), 'data-talk': S.voice.talking ? '1' : '0' },
      h('div', { class: 'aic-orb', role: 'button', tabindex: '0', 'aria-label': 'Dua avatar and voice settings', title: 'Tap to change the avatar and voice', onclick: open, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } } },
        jarvisAvatar(), h('span', { class: 'aic-avgear', 'aria-hidden': 'true', text: '\u2699' }))),
    h('div', { class: 'aic-cs aic-sr' }, h('h2', { text: core.state.replace(/_/g, ' ') }), h('p', { text: core.detail })));
}

// ── avatar settings (opened by tapping the avatar) ──
function openAvatarSettings() {
  const P = AV.getPrefs(), sup = V.voiceSupport(window);
  const row = (label, ...ctl) => h('div', { class: 'jv-set-row' }, h('span', { class: 'jv-set-l', text: label }), h('span', { class: 'jv-set-c' }, ...ctl));
  const check = (checked, on) => h('input', { type: 'checkbox', checked: checked ? true : null, onchange: ev => on(ev.target.checked) });
  const speed = V.getVoiceRate();
  const voices = (() => { try { return (window.speechSynthesis.getVoices() || []).filter(v => v.lang && v.lang.slice(0, 2) === V.voiceLang(window).slice(0, 2)); } catch (_) { return []; } })();
  const pick = V.getVoiceName();
  const body = h('div', { class: 'jv-set' },
    h('div', { class: 'jv-set-prev' }, jarvisAvatar()),
    h('div', { class: 'jv-set-g' },
      h('h4', { text: 'Face' }),
      h('div', { class: 'jv-set-btns' },
        h('label', { class: 'aic-avbtn' }, P.photo ? 'Change photo' : 'Use my photo', h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: ev => setAvatarPhoto(ev.target.files && ev.target.files[0]) })),
        P.photo ? h('button', { class: 'aic-g', text: 'Remove photo', onclick: clearAvatarPhoto }) : null),
      P.photo ? row('Mouth height', h('input', { type: 'range', min: AV.MOUTH_MIN, max: AV.MOUTH_MAX, value: P.mouthY, 'aria-label': 'Mouth height', oninput: ev => { AV.setMouthY(ev.target.value); render(); const pv = document.querySelector('.jv-set-prev'); if (pv) pv.replaceChildren(jarvisAvatar()); } })) : null,
      P.photo ? h('p', { class: 'aic-sub', text: 'Slide until the moving jaw starts just under your lips. Your picture stays on this device only.' }) : h('p', { class: 'aic-sub', text: 'Add a clear, front-facing photo and Dua will talk with your face. It stays on this device only.' }),
      row('Move while talking', check(P.live, on => { AV.setLive(on); render(); }))),
    h('div', { class: 'jv-set-g' },
      h('h4', { text: 'Voice' }),
      sup.output ? [
        row('Dua speaks answers', check(V.getVoiceOut(), on => { V.setVoiceOut(on); if (!on) V.stopSpeaking(window); })),
        row('Speed', h('select', { 'aria-label': 'Speech speed', onchange: ev => V.setVoiceRate(ev.target.value) }, [['0.85', 'Slower'], ['1', 'Normal'], ['1.15', 'Faster']].map(([v, l]) => h('option', { value: v, selected: Math.abs(speed - Number(v)) < 0.05 ? true : null, text: l })))),
        voices.length ? row('Voice', h('select', { 'aria-label': 'Voice', onchange: ev => V.setVoiceName(ev.target.value) }, [h('option', { value: '', text: 'Device default' }), ...voices.map(v => h('option', { value: v.name, selected: v.name === pick ? true : null, text: v.name }))])) : null,
        h('div', { class: 'jv-set-btns' }, h('button', { class: 'aic-p', text: 'Test voice', onclick: () => V.speak(window, 'Hello. I am Dua. Here is how I sound.', V.voiceLang(window)) })),
      ] : h('p', { class: 'aic-sub', text: 'This browser cannot speak answers aloud.' }),
      h('p', { class: 'aic-sub', text: 'The mouth moves with a speech rhythm while the browser speaks. It is not exact lip-sync, and the voice is a device voice, not a copy of yours.' })));
  openModal('Dua avatar', body, { sub: 'Face and voice' });
}
// Mission + lifecycle of the latest request: kept (it is the verify/read-back evidence) but moved out from under the avatar into Diagnostics.
function secMission(info) {
  const { live } = info, m = live.open;
  const mission = m
    ? h('div', { class: 'aic-mission' },
      h('div', { class: 'aic-k', text: 'CURRENT MISSION' }),
      h('div', { class: 'aic-mq', text: (m.metadata && m.metadata.question) || 'Working on a request' }),
      h('div', { class: 'aic-mg' },
        h('span', {}, 'Agent ', h('b', { text: m.agent || 'BT' })),
        h('span', {}, 'Step ', h('b', { text: live.steps ? live.steps + ' of max ' + (T.recent(60).find(e => e.type === 'step' && e.request_id === m.request_id) || { metadata: {} }).metadata.max : 'starting' })),
        h('span', {}, 'Elapsed ', h('b', { 'data-aic-elapsed': '', text: Math.round(live.elapsedMs / 1000) + 's' }))),
      live.activeTool ? h('div', { class: 'aic-mcur' }, 'Now: ', h('b', { text: live.activeTool.tool })) : h('div', { class: 'aic-mcur', text: 'Now: model is reasoning over the results so far' }),
      live.tools.length ? h('ul', { class: 'aic-mtools' }, live.tools.map(t => h('li', {}, h('span', { class: 'aic-pill aic-' + (t.status === 'ok' ? 'ok' : t.status === 'rejected' ? 'wn' : 'cr'), text: t.status }), ' ', t.tool, t.duration != null ? ' · ' + t.duration + ' ms' : ''))) : null,
      live.pendingApproval ? h('div', { class: 'aic-appr' }, h('b', { text: 'Waiting for you. ' }), (live.pendingApproval.metadata && live.pendingApproval.metadata.title) || live.pendingApproval.tool, ' ', h('button', { class: 'aic-p', text: 'Review', onclick: reviewApproval })) : null)
    : lastMissionNode();
  const life = M.deriveLifecycle(requestEvents(m || lastRequestStart()), !!S.snap);
  return h('div', { class: 'aic-missionbox' },
    mission,
    h('details', { class: 'aic-lifed' }, h('summary', { text: 'Lifecycle of the last request' }), h('ol', { class: 'aic-life', 'aria-label': 'Intelligence lifecycle' }, life.map(s => h('li', { class: (s.reached ? (s.failed ? 'on fail ' : 'on ') : '') + (s.available ? '' : 'na'), title: s.available ? (s.reached ? 'Happened in the latest request' : 'Not reached in the latest request') : 'BT has no automated verification step yet', text: s.label })))));
}
function reviewApproval() { if (window.BTAgent && typeof window.BTAgent.approvals === 'function') goMode('act', 'aic-actc'); else if (window.BTAgent) window.BTAgent.open(); }

const lastRequestStart = () => T.recent(400).find(e => e.type === 'request_start') || null;
const requestEvents = start => start ? T.recent(400, e => e.request_id === start.request_id) : [];
function lastMissionNode() {
  const s = lastRequestStart();
  if (!s) return h('div', { class: 'aic-mission' }, h('div', { class: 'aic-k', text: 'CURRENT MISSION' }), empty('No active mission. Ask BT something, or open a finding and choose Investigate.'));
  const evs = requestEvents(s), end = evs.find(e => e.type === 'answer' || e.type === 'error' || e.type === 'cancelled');
  const tools = evs.filter(e => e.type === 'tool_end');
  return h('div', { class: 'aic-mission' }, h('div', { class: 'aic-k', text: 'LAST MISSION · ' + (end ? end.type === 'answer' ? 'COMPLETE' : 'ENDED: ' + end.type.toUpperCase() : 'UNFINISHED') }),
    h('div', { class: 'aic-mq', text: (s.metadata && s.metadata.question) || '' }),
    h('div', { class: 'aic-mg' }, h('span', {}, 'Agent ', h('b', { text: s.agent || 'BT' })), h('span', {}, 'Tools ', h('b', { text: String(tools.length) })), end ? h('span', {}, 'Took ', h('b', { text: Math.round((end.timestamp - s.timestamp) / 1000) + 's' })) : null, h('span', { text: M.ageLabel(s.timestamp) })));
}

function findingCard(f) {
  const area = f.system ? f.system.charAt(0) + f.system.slice(1).toLowerCase() : '';
  return h('button', { class: 'aic-f aic-sev-' + f.severity, onclick: () => openFinding(f), 'aria-label': f.system + ': ' + f.title },
    h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
    h('span', { class: 'aic-fb' }, h('span', { class: 'aic-ft', text: f.title }), h('span', { class: 'aic-fs', text: area + '  ' + M.ageLabel(f.detected_at) })),
    h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '\u203a' }));
}
// One-line answer to "do I need to do anything?" (replaces the big orb on the Monitor view).
function summaryLine() {
  if (!S.snap) return null;
  // Same rule as the chat briefing ("N things need attention" counts warnings/errors only);
  // info-level notes are counted separately so the two screens never disagree.
  const all = visibleFindings().filter(x => x.severity !== 'good');
  const open = all.filter(x => x.severity !== 'info');
  const notes = all.length - open.length;
  const tn = open.some(x => x.severity === 'error') ? 'cr' : open.length ? 'wn' : 'ok';
  const noteTxt = notes ? ' (+' + notes + ' note' + (notes === 1 ? '' : 's') + ')' : '';
  const partial = M.isPartialSnapshot(S.snap);
  const text = partial ? 'Sales data is still loading. Counts may change.'
    : open.length ? (open.length === 1 ? '1 thing needs you today' : open.length + ' things need you today') + noteTxt
      : notes ? 'Nothing urgent. ' + notes + ' note' + (notes === 1 ? '' : 's') + ' to review.' : 'All clear. Nothing needs you right now.';
  return h('div', { class: 'aic-sumrow', id: 'aic-sum' }, h('i', { class: 'aic-dot2 aic-d-' + tn, 'aria-hidden': 'true' }),
    h('div', {}, h('div', { class: 'aic-sumt', text }), h('div', { class: 'aic-sub', text: 'Ranked by severity, then by the Rs amount involved. Data as of ' + clock(S.snap.at) + '.' })));
}
// One actionable row: severity, area, Rs involved, the first evidence line, the next action, and one-tap Investigate.
function attentionRow(e) {
  const f = e.primary;
  const ev = e.evidence[0];
  return h('div', { class: 'aic-att-row' },
    h('button', { class: 'aic-f aic-sev-' + f.severity, onclick: () => openFinding(f, e), 'aria-label': e.area + ': ' + f.title + '. ' + e.impactText },
      h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
      h('span', { class: 'aic-fb' },
        h('span', { class: 'aic-ft', text: f.title }),
        h('span', { class: 'aic-fs' }, h('b', { text: e.area }), ' · ', e.impactText, ' · ', M.ageLabel(f.detected_at)),
        ev ? h('span', { class: 'aic-fe', text: ev.label + ': ' + ev.value }) : null,
        e.next ? h('span', { class: 'aic-fn' }, h('b', { text: 'Next: ' }), e.next) : null,
        e.related.length ? h('span', { class: 'aic-fr', text: '+' + e.related.length + ' related ' + (e.related.length === 1 ? 'issue' : 'issues') + ' in ' + e.area.toLowerCase() }) : null,
        ...e.linked.map(l => h('span', { class: 'aic-fl', text: 'Seen together with: ' + l.systems.filter(x => C.areaLabel(x) !== e.area).map(C.areaLabel).join(', ') + ' (co-occurrence, not proven)' }))),
      h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '›' })),
    h('button', { class: 'aic-inv', text: 'Investigate', 'aria-label': 'Investigate: ' + f.title, onclick: () => investigate(f) }));
}
function secAttention() {
  let body;
  if (S.error && !S.snap) body = failureNode(S.error, () => refresh({ force: true }));
  else if (!S.snap) body = skeleton();
  else {
    const f = visibleFindings(), good = f.filter(x => x.severity === 'good');
    const P = C.prioritizeFindings(f, { limit: S.attAll ? 10 : 5 });
    body = h('div', {}, summaryLine(),
      P.entries.length ? P.entries.map(attentionRow) : empty('Nothing needs attention right now. All monitored rules are clear.'),
      P.total > 5 ? h('button', { class: 'aic-showall', 'aria-expanded': String(!!S.attAll), text: S.attAll ? 'Show fewer' : 'Show ' + Math.min(P.total - 5, 5) + ' more', onclick: () => { S.attAll = !S.attAll; render(); } }) : null,
      S.attAll && P.hidden ? h('div', { class: 'aic-more', text: '+ ' + P.hidden + ' more. Ask BT "What needs my attention?"' }) : null,
      good.map(g => h('div', { class: 'aic-good' }, '✓ ', g.title)));
  }
  return card('att', 'monitor', sectionHeader('NEEDS ATTENTION', S.snap ? h('span', { class: 'aic-sub', text: 'top 5 by severity and amount' }) : null), body);
}

// Failure / empty-state wording: one place, honest about timeout, permission, offline and partial data.
function failureNode(err, retry) {
  const d = C.describeFailure(err);
  return h('div', { class: 'aic-err aic-fail-' + d.kind, role: 'alert' }, h('b', { text: d.title + '. ' }), d.text, d.detail && d.detail !== d.text ? h('div', { class: 'aic-sub', text: d.detail }) : null,
    d.retry && retry ? h('div', { class: 'aic-row' }, h('button', { text: 'Retry', onclick: retry })) : null);
}

function sinceNode() {
  if (!S.snap) return null;
  const b = S.baseline;
  if (!b) return null; // first visit: nothing to compare, no card
  const d = M.diffFindings(b.findings, S.snap.findings);
  if (!d.added.length && !d.cleared.length) return null; // nothing changed: no empty panel
  return h('div', { class: 'aic-since' }, h('div', { class: 'aic-k', text: 'SINCE YOUR LAST VISIT' }), h('div', {}, h('b', { text: '+' + d.added.length }), ' new'), h('div', {}, h('b', { text: String(d.cleared.length) }), ' no longer present'),
    d.added.length ? h('ul', { class: 'aic-list' }, d.added.slice(0, 4).map(f => h('li', { text: f.title }))) : null);
}


const SYSTEM_ASK = {
  SALES: 'How are sales going this month compared with last month and the target?', CASH: 'Is there any cash difference in the latest sales entry?',
  INVENTORY: 'What inventory is at risk? Which products are out of stock or about to run out?', STAFF: 'How are staff credits looking, including carried-over balances and possible duplicates?',
  STR: 'Which STRs are delayed or still pending?', CLOSING: 'What is blocking closing? Which days or shifts are not closed?',
};
const STATUS_RANK = { ERROR: 0, UNAUTHORIZED: 0, DATA_UNAVAILABLE: 1, ATTENTION: 2, STALE: 2 };
const worstStatus = names => names.map(n => S.snap.systems[n] && S.snap.systems[n].status).filter(Boolean).sort((a, b) => (STATUS_RANK[a] ?? 3) - (STATUS_RANK[b] ?? 3))[0] || 'CLEAR';
function snapTile(t) {
  const status = worstStatus(t.systems), tn2 = [tone(status), t.tone].sort((a, b) => ({ cr: 0, wn: 1, mu: 2, ok: 3 }[a] - { cr: 0, wn: 1, mu: 2, ok: 3 }[b]))[0];
  const aria = t.label + ': ' + t.value + '. ' + t.sub + (t.compare ? '. ' + t.compare : '') + (status !== 'CLEAR' ? '. Status ' + status : '');
  return h('button', { class: 'aic-it aic-snap-tile aic-edge-' + tn2, 'data-tile': t.id, 'aria-label': aria + '. Tap for details.', onclick: () => openSystem(t.system) },
    t.pct != null ? ringGauge(t.pct, tn2) : null,
    h('span', { class: 'aic-it-b' },
      h('span', { class: 'aic-it-l', text: t.label }),
      h('b', { class: 'aic-it-v aic-' + tn2, text: t.value }),
      h('small', { text: t.sub }),
      t.compare ? h('small', { class: 'aic-it-c', text: t.compare }) : null,
      h('span', { class: 'aic-it-f' }, status !== 'CLEAR' ? pill(status) : null, t.fresh ? h('small', { class: 'aic-fresh aic-' + tone(S.snap.systems[t.system] && S.snap.systems[t.system].fresh.status), text: t.fresh }) : null)));
}
function secSystems() {
  const tiles = S.snap ? C.snapshotTiles(S.snap) : [];
  return card('sys', 'monitor', sectionHeader('BUSINESS SNAPSHOT', h('span', { class: 'aic-sub', text: S.snap ? 'tap a tile for detail' : 'loading' })),
    S.snap ? h('div', { class: 'aic-snap' }, tiles.map(snapTile)) : skeleton(3));
}
function openFinding(f, entry) {
  const A = S.assess[f.id];
  const R = C.structureInvestigation(f, A, S.snap ? C.buildActionDrafts(S.snap.raw) : []);
  const sec = (label, ...kids) => [h('div', { class: 'aic-k', text: label }), ...kids];
  const evRow = e => h('li', {}, h('span', { class: 'aic-tag aic-k-' + String(e.kind).split(' ')[0].toLowerCase(), text: e.kind }), ' ', h('span', { class: 'aic-cls aic-cls-' + e.cls, text: C.CLASS_LABEL[e.cls] }), ' ', h('b', { text: e.label + ': ' }), e.value, e.source ? h('span', { class: 'aic-sub', text: '  (' + e.source + ')' }) : null);
  const act = a => a.kind === 'open' ? h('button', { text: a.label, onclick: () => openPage(a.href) })
    : a.kind === 'draft' ? h('button', { text: a.label + ' (preview)', onclick: () => { closeModal(); openDraft(a.draft); } })
      : h('button', { class: 'aic-p', text: a.label, onclick: () => investigate(f) });
  openModal(f.title.length > 60 ? f.type + ' · ' + f.system : f.title, h('div', { class: 'aic-find' },
    h('div', { class: 'aic-row' }, pill(f.severity === 'warning' ? 'WARNING' : f.severity === 'good' ? 'HEALTHY' : 'INFO', f.severity.toUpperCase()), h('span', { class: 'aic-tag', text: R.area }), h('span', { class: 'aic-tag', text: f.type }), h('span', { class: 'aic-sub', text: 'Observed ' + M.ageLabel(f.detected_at) })),
    sec('FINDING', h('p', { text: f.title }), f.description && f.description !== f.title ? h('p', { class: 'aic-sub', text: f.description }) : null,
      entry && entry.related && entry.related.length ? h('ul', { class: 'aic-list' }, entry.related.map(r => h('li', {}, h('b', { text: 'Related: ' }), r.title))) : null,
      entry && entry.linked && entry.linked.length ? entry.linked.map(l => h('div', { class: 'aic-note' }, tagEl('CORRELATION'), ' ', l.title + '. ', l.why)) : null),
    sec('IMPACT', h('p', { text: R.impact }), h('p', { class: 'aic-sub', text: f.if_act })),
    sec('EVIDENCE', R.evidence.length ? h('ul', { class: 'aic-list' }, R.evidence.map(evRow)) : empty('No evidence rows.'),
      h('div', { class: 'aic-sub', text: 'Checked with: ' + f.related_tools.join(', ') + '. Agents: ' + f.related_agents.join(', ') + '.' }),
      h('div', { class: 'aic-path' }, (f.related_entities || []).map(r => h('span', { class: 'aic-tag', text: r.kind + ': ' + r.value })))),
    sec('CONFIDENCE & LIMITATIONS', h('p', {}, h('b', { text: 'Confidence: ' + R.confidence.level }), R.confidence.reason ? ' — ' + R.confidence.reason : ''),
      R.limitations.length ? h('ul', { class: 'aic-list' }, R.limitations.map(l => h('li', { text: l }))) : null,
      h('p', { class: 'aic-sub', text: 'Rule-based check "' + f.source + '" ran on your current data. Verified: FACT, DETECTION and CALCULATION rows. Not known: the cause. That needs investigation.' })),
    sec('RECOMMENDATION', h('p', {}, tagEl('RECOMMENDATION'), ' ', R.recommendation.text),
      h('dl', { class: 'aic-met' }, [['Source', R.recommendation.source === 'ai' ? 'AI Analyst (check against the evidence)' : 'Rule-based: a fixed rule, not AI'], ['Why', R.recommendation.why || 'not stated'], ['Expected result', R.recommendation.expected], ['Risk', R.recommendation.risk], ['Approval', R.recommendation.approval_required ? 'Required for any change' : 'Not needed: advice only. BT never changes data without your approval.']].map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))),
    sec('AVAILABLE ACTIONS', h('div', { class: 'aic-row' }, R.actions.map(act), h('button', { class: 'aic-g', text: 'Dismiss for today', onclick: () => { const d = lsGet(LS_DISMISS) || {}; d[f.id] = M.isoDay(new Date()); lsSet(LS_DISMISS, d); closeModal(); render(); } }))),
    sec("BT'S ASSESSMENT", A ? assessmentNode(A) : h('p', { class: 'aic-sub', text: 'BT has not been asked about this yet. The detection above is rule-based, with no AI involved.' })),
    sec('AUDIT REFERENCE', h('p', { class: 'aic-sub', text: f.audit_reference + '. Read-only detection: nothing was changed. Changes made later through BT appear in the audit log with their own reference.' }))),
  { sub: f.source, tonec: tone(f.severity === 'warning' ? 'WARNING' : 'HEALTHY') });
}

function openSystem(name) {
  const s = S.snap && S.snap.systems[name]; if (!s) return;
  const src = M.SYSTEM_SOURCES[name], fs = visibleFindings().filter(f => f.system === name);
  const dom = name.toLowerCase();
  const ev = T.recent(80, e => e.domain === dom || (src.tools.includes(e.tool))).slice(0, 8);
  openModal(name + ' INTELLIGENCE', h('div', {},
    h('div', { class: 'aic-row' }, pill(s.status), h('span', { class: 'aic-sub', text: s.reason }), h('span', { class: 'aic-fresh aic-' + tone(s.fresh.status), text: 'Data: ' + s.fresh.label })),
    h('div', { class: 'aic-k', text: 'CURRENT NUMBERS (from existing tools)' }), s.metrics.length ? h('dl', { class: 'aic-met aic-big' }, s.metrics.map(m => [h('dt', { text: m.label, title: m.src }), h('dd', { text: m.value })])) : empty(s.availability.reason || 'No data'),
    h('div', { class: 'aic-k', text: 'FINDINGS' }), fs.length ? fs.map(findingCard) : empty('No open findings for this system.'),
    h('div', { class: 'aic-k', text: 'RELATED AGENTS AND TOOLS' }), h('div', { class: 'aic-path' }, src.agents.map(a => h('span', { class: 'aic-tag', text: a })), h('div', { class: 'aic-sub', text: src.tools.join(', ') })),
    deepViews(name),
    h('div', { class: 'aic-k', text: 'RECENT ACTIVITY' }), ev.length ? eventList(ev) : empty('No activity for this system yet on this device.'),
    h('div', { class: 'aic-row' }, h('button', { class: 'aic-p', text: 'Investigate with BT', onclick: () => { closeModal(); ask(SYSTEM_ASK[name]); } }), h('button', { text: 'Open ' + name.toLowerCase() + ' page', onclick: () => openPage(M.SYSTEM_PAGE[name]) }))),
  { tonec: tone(s.status) });
}
function secActivity() {
  const evs = T.recent(150, e => M.eventMatches(e, S.filter)).slice(0, 40);
  return card('act', 'investigate act',
    sectionHeader('LIVE ACTIVITY', h('span', { class: 'aic-sub', text: 'real events only' })),
    h('div', { class: 'aic-filters', role: 'group', 'aria-label': 'Filter activity' }, M.FILTERS.map(([id, label]) => h('button', { class: S.filter === id ? 'on' : '', 'aria-pressed': String(S.filter === id), text: label, onclick: () => { S.filter = id; render(); } }))),
    evs.length ? eventList(evs) : empty('No ' + (S.filter === 'all' ? '' : S.filter + ' ') + 'activity yet in this session. Events appear here when BT actually runs.'),
    S.history.length && (S.filter === 'all' || S.filter === 'tools' || S.filter === 'actions') ? h('details', { class: 'aic-hist' }, h('summary', { text: 'Earlier tool activity (audit log, all devices)' }), h('ul', { class: 'aic-ev' }, S.history.filter(x => S.filter !== 'actions' || x.change).map(x => h('li', { class: 'aic-evi' }, h('time', { text: new Date(x.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }), h('span', { class: 'aic-evt', text: x.tool + ' · ' + x.status }))))) : null);
}

// ── action center ──
function secActions(info) {
  const A = S.actions;
  const A_ok = window.BTAgent ? window.BTAgent.writesAllowed() : false, killed = window.BTAgent ? window.BTAgent.killed() : true;
  const body = [];
  body.push(h('div', { class: 'aic-gate aic-' + (killed ? 'cr' : A_ok ? 'ok' : 'wn') }, killed ? '⛔ AI changes are stopped on all devices (kill switch).' : A_ok ? '🔓 Changes allowed on this device. You approve every one.' : '🔒 Read-only on this device. BT can recommend but not change anything. Unlock from the assistant header.'));
  body.push(h('div', { class: 'aic-k', text: 'PENDING APPROVAL' }));
  body.push(...approvalNodes(info));
  const dn = draftsNode(); if (dn) body.push(dn);
  const sn = sinceNode(); if (sn) body.push(sn);
  body.push(h('div', { class: 'aic-k', text: 'UNDOABLE (last 48 hours)' }));
  if (!A) body.push(skeleton(2));
  else if (A.state === 'error') body.push(h('div', { class: 'aic-err', text: 'Could not read the audit log: ' + A.error }));
  else {
    body.push(A.undos.length ? h('ul', { class: 'aic-list' }, A.undos.map(u => h('li', {}, h('b', { text: u.label }), h('div', { class: 'aic-sub', text: M.ageLabel(u.at) + ' · ' + u.tool }), h('button', { text: '↶ Undo', onclick: async ev => { ev.target.disabled = true; const it = pushUndo({ tool: u.tool, label: u.label, fn: u.fn, key: u.key }); const r = await runUndo(it.id); if (r.ok && r.key) await markUndone(getSb(), r.key); toast(r.ok ? 'Undone: ' + r.label : 'Undo failed: ' + r.error); refresh({ force: true }); } })))) : empty('No undoable changes.'));
    const logList = A.recent.length ? h('ul', { class: 'aic-ev' }, A.recent.map(r => h('li', { class: 'aic-evi' }, h('time', { text: new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }), h('span', { class: 'aic-evt', text: r.tool + (r.error ? ' (' + r.error + ')' : '') }), outcomeChip(r), h('span', { class: 'aic-sub', text: r.ref })))) : empty('No AI changes recorded.');
    body.push(h('details', { class: 'aic-log' }, h('summary', { text: 'Recent changes (audit log) · ' + A.recent.length }), logList));
  }
  return card('actc', 'act', sectionHeader('APPROVALS & RECENT ACTIVITY', h('span', { class: 'aic-sub', text: 'BT proposes \u00B7 you approve' })), body);
}
function afterDecision(r, action) {
  if (!r || r.ok !== true) {
    toast(r && r.needs === 'type' ? 'Type the confirmation word first.' : r && r.needs === 'confirm' ? 'Tap once more to confirm.' : (r && r.error) || 'Could not record that decision.');
  } else toast(action === 'approve' ? 'Approved. BT will apply the change, then read it back to verify.' : 'Rejected. Nothing was changed.');
  render();
}
function approvalNodes(info) {
  const A = window.BTAgent, list = A && typeof A.approvals === 'function' ? A.approvals() : null, pending = info.live.pendingApproval;
  if (!list) return [pending ? h('div', { class: 'aic-appr' }, h('b', { text: (pending.metadata && pending.metadata.title) || pending.tool }), h('div', { class: 'aic-row' }, h('button', { class: 'aic-p', text: 'Review and decide', onclick: () => A && A.open() }))) : empty('Nothing is waiting for approval.')];
  if (!list.length) return [empty('Nothing is waiting for approval.')];
  return list.map(approvalCard);
}
function approvalCard(p) {
  const req = T.recent(400, e => e.type === 'approval_requested' && e.entity_reference === p.id)[0] || null, v = M.approvalView(p, req), A = window.BTAgent;
  const typed = v.gate.kind === 'type' ? h('input', { class: 'aic-pin', type: 'text', placeholder: 'Type ' + v.gate.word, 'aria-label': 'Type the confirmation word', autocomplete: 'off' }) : null;
  const killed = A.killed(), decide = (action, ev) => afterDecision(A.decide(p.id, action, { typed: typed ? typed.value : undefined, gesture: ev }), action);
  const sec = (label, ...kids) => [h('div', { class: 'aic-k', text: label }), ...kids];
  return h('div', { class: 'aic-appr aic-ap2 aic-t-' + v.tone, role: 'group', 'aria-label': 'Approval request: ' + v.title },
    h('div', { class: 'aic-row' }, h('b', { text: v.title }), pill(v.risk === 'critical' ? 'ERROR' : 'WARNING', v.risk.toUpperCase())),
    sec('WHY BT IS ASKING', h('div', { class: 'aic-sub' }, tagEl(v.why.kind), ' ', v.why.text)),
    sec('EVIDENCE (the exact proposal)', v.evidence.length ? h('ul', { class: 'aic-list' }, v.evidence.map(e => h('li', {}, tagEl(e.kind), ' ', h('b', { text: e.label + ': ' }), e.value))) : h('div', { class: 'aic-sub', text: 'The tool gave no detail lines.' })),
    v.warnings.length ? sec('WARNINGS', h('ul', { class: 'aic-list' }, v.warnings.map(w => h('li', { text: w })))) : null,
    sec('EXPECTED RESULT', h('div', { class: 'aic-sub', text: v.expected + ' ' + v.verification })),
    sec('REVERSIBILITY', h('div', { class: 'aic-sub aic-' + (v.reversibility.ok ? 'ok' : 'cr'), text: v.reversibility.text })),
    v.affected.length ? sec('AFFECTED RECORDS', h('dl', { class: 'aic-met' }, v.affected.map(a => [h('dt', { text: a.label }), h('dd', { text: a.value })]))) : null,
    h('div', { class: 'aic-sub', text: v.gate.text }), typed,
    h('div', { class: 'aic-row' },
      h('button', { class: 'aic-p', text: v.gate.kind === 'twotap' && p.armed ? 'Yes, I am sure' : 'Approve', disabled: killed, onclick: ev => decide('approve', ev) }),
      h('button', { text: 'Reject', onclick: ev => decide('reject', ev) })),
    killed ? h('div', { class: 'aic-err', text: 'Kill switch is ON: changes are stopped.' }) : null);
}

// ── repository intelligence (loads the static index; shows NOT CONNECTED if it cannot) ──
function loadRepoIndex() {
  if (S.repo.state !== 'idle') return;
  S.repo.state = 'loading';
  Promise.resolve().then(() => (typeof fetch === 'function' ? fetch('js/ai-center/repo-index.json', { cache: 'no-cache' }) : Promise.reject(new Error('no fetch'))))
    .then(r => (r && r.ok ? r.json() : Promise.reject(new Error('HTTP ' + (r && r.status)))))
    .then(j => { if (!M.validRepoIndex(j)) throw new Error('bad index'); S.repo = { state: 'ready', idx: j }; })
    .catch(() => { S.repo = { state: 'error', idx: null }; })
    .then(() => render());
}
function secRepo() {
  loadRepoIndex();
  const R = S.repo, info = R.state === 'ready' ? M.repoIndexInfo(R.idx) : null;
  const head = sectionHeader('REPOSITORY INTELLIGENCE', info ? pill(info.stale ? 'WARNING' : 'HEALTHY', info.stale ? 'INDEX OLD' : 'INDEX READY') : pill(R.state === 'loading' ? 'NOT_MEASURED' : 'OFFLINE', R.state === 'loading' ? 'LOADING' : 'NOT CONNECTED'));
  if (!info) return card('repo', 'investigate', head, h('p', { class: 'aic-sub', text: R.state === 'loading' ? 'Loading the code index...' : 'The code index (js/ai-center/repo-index.json) could not be loaded, so BT cannot say where things are calculated. Nothing here pretends otherwise. Build it with: npm run index:repo' }));
  const results = h('div', { class: 'aic-rres' });
  const locNode = l => h('li', {}, tagEl(String(l.kind || 'file').toUpperCase()), ' ', h('b', { text: l.symbol || l.file }),
    l.domain ? h('span', { class: 'aic-sub', text: '  ' + l.domain + ' / ' + l.risk }) : null,
    h('div', { class: 'aic-sub', text: l.file + ':' + l.line + (l.role ? '  |  ' + l.role : '') }),
    l.summary ? h('div', { class: 'aic-sub', text: l.summary }) : null,
    l.related && (l.related.tools.length || l.related.features.length) ? h('div', { class: 'aic-path' }, l.related.tools.slice(0, 4).map(t => h('span', { class: 'aic-tag', text: 'tool: ' + t })), l.related.features.slice(0, 3).map(f => h('span', { class: 'aic-tag', text: 'feature: ' + f }))) : null,
    l.github ? h('a', { class: 'aic-sub', href: l.github, target: '_blank', rel: 'noopener noreferrer', text: 'Read the code on GitHub (indexed commit)' }) : null);
  const draw = () => {
    const q = S.repoQ.trim();
    if (!q) { results.replaceChildren(h('div', { class: 'aic-sub', text: 'Ask where something is, or pick an example or topic below. Try: target pace, cash diff, low stock, closing, approval.' })); return; }
    // the real service: curated, index-verified architecture notes + tool lookup + symbol search
    const a = RI.answerRepoQuestion(R.idx, q, { registered: listTools().map(t => t.name), limit: 10 });
    if (!a.ok || a.kind === 'none') { results.replaceChildren(empty(a.explanation || a.reason || 'No symbol, tool or file matches "' + q + '".')); return; }
    results.replaceChildren(
      h('div', { class: 'aic-k', text: a.title.toUpperCase() }),
      a.explanation ? h('div', {}, h('span', { class: 'aic-tag aic-k-ai', text: a.kind === 'tools' ? 'FROM THE INDEX' : 'ARCHITECTURE NOTE' }), ' ', h('span', { class: 'aic-sub', text: a.source || '' }), h('p', { text: a.explanation })) : null,
      h('ul', { class: 'aic-list' }, a.locations.map(locNode)),
      a.unresolved.length ? h('div', { class: 'aic-note', text: a.unresolved.length + ' location(s) in the note could not be found in the current index and are not shown: ' + a.unresolved.map(u => u.file + (u.symbol ? '#' + u.symbol : '')).join(', ') }) : null,
      h('div', { class: 'aic-sub', text: a.notes.join(' ') }));
  };
  const input = h('input', { id: 'aic-rq', class: 'aic-pin', type: 'search', placeholder: 'Where is it implemented? e.g. approval, VERIFY, target pace', 'aria-label': 'Ask the code index', autocomplete: 'off', value: S.repoQ });
  const setQ = v => { S.repoQ = v; input.value = v; draw(); };
  input.addEventListener('input', () => { S.repoQ = input.value; draw(); });
  draw();
  return card('repo', 'investigate', head,
    h('p', { class: 'aic-sub', text: info.files + ' files, ' + info.symbols + ' symbols. Built ' + info.age + ' at commit ' + info.commit + '. It tells you WHERE things are implemented (file, line, summary, related tool). It holds no source code: use the GitHub link to read it. Secret-bearing files are excluded. This is a snapshot, not live.' }),
    info.stale ? h('div', { class: 'aic-note', text: 'This index is more than 14 days old. Rebuild it with: npm run index:repo' }) : null,
    input,
    h('div', { class: 'aic-chips', 'aria-label': 'Example questions' }, RI.SAMPLE_QUESTIONS.map(x => h('button', { text: x, onclick: () => setQ(x) }))),
    h('div', { class: 'aic-chips', 'aria-label': 'Architecture topics' }, RI.CONCEPTS.map(c => h('button', { class: 'aic-g', text: c.title, onclick: () => setQ(c.title) }))),
    results);
}

// ── latest answer ──


// ── AI Business Copilot: status, latest answer (merged here), structured result, investigation history ──
function histNode() {
  const runs = allRuns(), hist = C.buildInvestigationHistory(runs, 5);
  if (!hist.length) return empty('No investigations yet. Ask a question or tap Investigate on an issue.');
  return h('ul', { class: 'aic-ihist' }, hist.map(x => h('li', {},
    h('button', { class: 'aic-ih', 'aria-label': 'Open investigation: ' + x.question, onclick: () => { const r = runs.find(y => y.id === x.id); if (r) openRun(r); } },
      h('span', { class: 'aic-iq', text: x.question.length > 90 ? x.question.slice(0, 89).trimEnd() + '…' : x.question }),
      h('span', { class: 'aic-im' }, h('span', { class: 'aic-pill aic-' + RUN_TONE[x.status], text: RUN_LABEL[x.status] }), ' ', (x.specialists.join(' + ') || 'BT') + ' · ' + x.toolCount + (x.toolCount === 1 ? ' tool' : ' tools') + (x.failedTools ? ' (' + x.failedTools + ' failed)' : '') + ' · ' + M.ageLabel(x.at)),
      h('span', { class: 'aic-im2', text: 'Evidence: ' + x.evidence + (x.confidence ? ' · confidence ' + x.confidence : '') + (x.approval ? ' · approval ' + x.approval.status : '') }),
      x.outcomeState ? h('span', { class: 'aic-pill aic-' + C.ACTION_STATES[x.outcomeState].tone, title: C.ACTION_STATES[x.outcomeState].note, text: C.ACTION_STATES[x.outcomeState].label }) : null))));
}
// Hero (Command Deck): greeting panel | avatar | product panel. The avatar is the only picture on this page; tapping it opens its settings.
// It lives here only: the Dua chat panel (a separate, global assistant) has no avatar.
function secHero(info) {
  const up = !/^(OFFLINE|ERROR)$/i.test(info.core.state);
  return card('hero', 'monitor investigate act',
    h('div', { class: 'dk-hero' },
      h('div', { class: 'dk-hp dk-hp-l' }, h('small', { text: 'Hi, I\u2019m your' }), h('b', { text: 'AI Assistant' }), h('span', { text: 'Here to help you make smarter decisions.' })),
      secCore(info),
      h('div', { class: 'dk-hp dk-hp-r' }, h('b', { text: 'BT INTELLIGENCE' }), h('small', { text: 'PHARMACY BUSINESS INSIGHTS & ANALYTICS' }),
        h('div', { class: 'aic-hbub', role: 'status' }, h('span', { class: 'aic-hpill ' + (up ? 'on' : 'off') + (S.voice.talking ? ' talk' : ''), text: S.voice.talking ? 'Dua speaking' : up ? 'Dua online' : 'Dua offline' })),
        h('button', { class: 'aic-p dk-askj', text: 'Ask Dua', 'aria-label': 'Ask Dua', onclick: () => { if (window.BTAgent) window.BTAgent.open(); else toast('The assistant is still loading. Try again in a moment.'); } }))));
}

// ───────────────────────── Command Deck: tabs + overview cards ─────────────────────────
const TABS = [['overview', 'Overview', 'home'], ['sales', 'Sales & Forecast', 'bars'], ['inventory', 'Inventory', 'box'], ['operations', 'Operations', 'gear'], ['audit', 'Audit', 'shield'], ['more', 'More', 'more']];
// which tab(s) each card belongs to ('*' = every tab). A card can live in several tabs; there is still exactly one node per card.
const TAB_OF = { hero: '*', tabs: '*', crit: '*', dktiles: 'overview', dkatt: 'overview inventory', dksales: 'overview sales', fc: 'sales', dkinv: 'overview inventory', invstr: 'inventory',
  dkmoney: 'overview', money: 'sales', dkappr: 'overview operations', actc: 'operations', dkops: 'overview', ops: 'operations', dkgame: 'sales', dkaudit: 'audit', dkexp: 'audit', dkpay: 'audit', sys: 'more', att: 'more', hist: 'operations' };
function setTab(id) { S.tab = TABS.some(t => t[0] === id) ? id : 'overview'; paint(); const el = document.getElementById('aic-tabs'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }
function secTabs() {
  return h('nav', { class: 'dk-tabs', id: 'aic-tabs', role: 'tablist', 'aria-label': 'BT Intelligence sections', 'data-tabs': '*' },
    TABS.map(([id, label, icon]) => h('button', { class: 'dk-tab' + (S.tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(S.tab === id), 'data-tab': id, onclick: () => setTab(id) }, ic(icon), h('span', { text: label }))));
}
function secDkTiles() {
  if (!S.snap) return h('section', { class: 'dk-tiles', id: 'aic-dktiles' }, dkWait());
  const go = id => (id === 'risk' || id === 'fill' ? 'inventory' : 'sales');
  return h('section', { class: 'dk-tiles', id: 'aic-dktiles', 'aria-label': 'Key numbers' }, DK.overviewTiles(S.snap).map(t =>
    h('button', { class: 'dk-tile dk-t-' + t.tone, onclick: () => setTab(go(t.id)), 'data-tile': t.id },
      h('span', { class: 'dk-tic' }, ic(t.icon)),
      h('span', { class: 'dk-tb' }, h('small', { text: t.label }), h('b', { text: t.value }),
        t.progress != null ? h('i', { class: 'dk-prog', role: 'progressbar', 'aria-valuenow': String(t.progress), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t.label }, h('s', { style: 'width:' + t.progress + '%' })) : null,
        t.delta ? h('em', { class: t.delta.up ? 'up' : 'down' }, (t.delta.up ? '\u2191 ' : '\u2193 ') + t.delta.pct + '% ', h('span', { text: t.delta.text })) : (t.sub ? h('span', { class: 'dk-sub', text: t.sub }) : null)))));
}
function secDkAttention() {
  const rows = S.snap ? DK.attentionRows(S.snap) : null;
  return dkCard('dkatt', 'alert', 'Needs Attention', ['View All', () => setTab('more')],
    !rows ? dkWait() : rows.length ? h('div', { class: 'dk-rows' }, rows.map(r => h('button', { class: 'dk-row dk-r-' + r.tone, onclick: () => setTab(r.go) },
      h('span', { class: 'dk-ric' }, ic(r.icon)), h('b', { class: 'dk-big', text: r.big }), h('span', { class: 'dk-rt' }, h('b', { text: r.label }), h('small', { text: r.sub })), ic('chevron', 'dk-chev'))))
      : empty('Nothing needs your attention right now.'));
}
function secDkSales() {
  const C0 = S.snap ? DK.salesChart(S.snap) : null;
  const P = S.snap && S.snap.raw && S.snap.raw.planning;
  return dkCard('dksales', 'bars', 'Sales & Forecast', ['View Details', () => setTab('sales')],
    !S.snap ? dkWait() : !C0 ? empty(M.isPartialSnapshot(S.snap) ? 'Loading sales data\u2026' : (P && P.errors && P.errors.weekday) || 'Weekday sales pattern is not available yet.') : h('div', { class: 'dk-chart' },
      h('ul', { class: 'dk-yax', 'aria-hidden': 'true' }, [...C0.ticks].reverse().map(k => h('li', { text: k.label }))),
      h('ul', { class: 'dk-bars', 'aria-label': 'Average sale by weekday: ' + C0.bars.map(b => b.day + ' Rs ' + M.fmtNum(b.value)).join(', ') },
        C0.bars.map(b => h('li', { class: b.today ? 'today' : '' }, h('span', { class: 'dk-bar', style: 'height:' + b.pct + '%', title: 'Rs ' + M.fmtNum(b.value) }), h('small', { text: b.day }))))),
    S.snap && C0 && C0.projected != null ? h('div', { class: 'dk-foot', text: 'Expected month-end: ' + DK.rs(C0.projected) }) : null);
}
function secDkInv() {
  const P = S.snap ? DK.inventoryPanel(S.snap) : null;
  return dkCard('dkinv', 'box', 'Inventory & STR', ['View Details', () => setTab('inventory')],
    !S.snap ? dkWait() : !P ? empty('Inventory data is not loaded. Open the Inventory page once.') : h('div', { class: 'dk-two' }, kvList(P.left, 'dk-l'), kvList(P.right, 'dk-r')));
}
function secDkMoney() {
  const P = S.snap ? DK.moneyPanel(S.snap) : null;
  return dkCard('dkmoney', 'cash', 'Closing Cash & Money', ['View Details', () => setTab('sales')],
    !S.snap ? dkWait() : !P ? empty('Closing, cash and ledger data are not available.') : h('div', {}, h('div', { class: 'dk-two' }, kvList(P.left, 'dk-l'), kvList(P.right, 'dk-r')),
      P.foot ? h('div', { class: 'dk-foot', text: P.foot + (P.month ? ' \u00B7 ' + P.month : '') }) : null));
}
if (typeof window !== 'undefined' && !window.__btFgListen) { window.__btFgListen = true; window.addEventListener('bt-forecast-game', () => { try { if (pageOn()) paint(); } catch (_) { /* page not mounted */ } }); }
function secDkApprovals() {
  const A = window.BTAgent, list = DK.approvalRows(A && typeof A.approvals === 'function' ? A.approvals() : []);
  const recent = T.recent(300).filter(e => e.type === 'request_start' && e.metadata && e.metadata.question).slice(0, 3);
  return dkCard('dkappr', 'clipboard', 'Approvals & Recent Activity', ['View All', () => setTab('operations')],
    h('div', { class: 'dk-ban ' + (list.length ? 'wn' : 'ok') }, ic(list.length ? 'alert' : 'shield', 'dk-ic'), list.length ? h('span', {}, h('b', { text: 'Action required: ' }), list.length + (list.length === 1 ? ' change needs' : ' changes need') + ' your approval') : h('span', { text: 'Nothing is waiting for your approval.' })),
    h('div', { class: 'dk-rows dk-flat' }, list.map(a => h('div', { class: 'dk-line' }, h('span', { class: 'dk-lt' }, h('b', { text: a.title }), h('small', { text: a.sub })), h('button', { class: 'dk-pill', text: 'Review', onclick: reviewApproval }))),
      recent.map(e => h('div', { class: 'dk-line' }, h('span', { class: 'dk-lt' }, h('b', { text: String(e.metadata.question).slice(0, 80) }), h('small', { text: 'Asked ' + clock(e.timestamp) })), h('button', { class: 'dk-pill', text: 'Open', onclick: () => { S.open.chat = true; paint(); } }))),
      !list.length && !recent.length ? empty('No requests yet. Ask Dua something.') : null));
}
function secDkOps() {
  const o = DK.opsStrip(S.snap, S.health);
  return h('section', { class: 'aic-card dk-card', id: 'aic-dkops' },
    h('div', { class: 'dk-h' }, h('span', { class: 'dk-hic' }, ic('pulse')), h('h2', { text: 'Operations & Diagnostics' }),
      h('button', { class: 'dk-state ' + (o.healthy ? 'ok' : 'wn'), onclick: () => setTab('operations'), 'aria-label': 'Operations: ' + o.summary }, h('i', { 'aria-hidden': 'true' }), o.summary)),
    h('div', { class: 'dk-ops' }, o.items.map(i => h('div', { class: 'dk-chip dk-' + i.tone }, h('small', { text: i.label }), h('b', { text: i.text })))));
}

// Earlier investigations stay on this page (they are business history). The chat itself is the global Dua panel.
function secHist() {
  return card('hist', 'monitor investigate act', sectionHeader('EARLIER INVESTIGATIONS'), histNode());
}

// ── Needs-you-now banner: critical findings and pending approvals are lifted above every normal section ──
function secCritical(info) {
  const A = window.BTAgent;
  const list = A && typeof A.approvals === 'function' ? A.approvals()
    : info.live.pendingApproval ? [{ id: 'live', tool: info.live.pendingApproval.tool, preview: { title: (info.live.pendingApproval.metadata && info.live.pendingApproval.metadata.title) || info.live.pendingApproval.tool } }] : [];
  const items = C.criticalItems({ findings: S.snap ? visibleFindings() : [], approvals: list });
  if (!items.length) return null;
  return card('crit', 'monitor investigate act', sectionHeader('NEEDS YOU NOW'),
    items.map(it => h('button', { class: 'aic-f aic-sev-error aic-crit-item', onclick: () => it.kind === 'approval' ? reviewApproval() : openFinding(it.finding) },
      h('i', { class: 'aic-dot2', 'aria-hidden': 'true' }),
      h('span', { class: 'aic-fb' }, h('span', { class: 'aic-ft', text: it.title }), h('span', { class: 'aic-fs', text: it.area + ' · ' + (it.kind === 'approval' ? 'waiting for your decision' : 'critical') })),
      h('span', { class: 'aic-chev', 'aria-hidden': 'true', text: '›' }))));
}

// ── Operations & Diagnostics: every technical panel, one collapsed group ──
function secOps(info) {
  return card('ops', 'investigate', sectionHeader('OPERATIONS & DIAGNOSTICS', h('span', { class: 'aic-sub', text: 'agents · tools · health · repository' })),
    h('div', { class: 'aic-ops' }, secMission(coreInfo()), secRuns(), secFleet(info), secNetwork(info), secActivity(), secObs(), secHealth(), secTools(), secRepo()));
}

// ───────────────────────── command bar + palette ─────────────────────────

// ── voice: the mic, the speaker and spoken answers live in the docked chat (js/agent/ui/agent-panel.js + voice.js) ──
function promptChips() {
  const raw = S.snap && S.snap.raw, P = raw && raw.planning, A = window.BTAgent;
  return C.suggestPrompts({
    findings: S.snap ? visibleFindings() : [], reorderLines: (P && P.reorder && P.reorder.total_lines) || 0, fillPct: P && P.fill ? P.fill.fill_rate_pct : null,
    closingIncomplete: raw && raw.closing && raw.closing.incomplete_days ? raw.closing.incomplete_days.length : 0, approvals: A && typeof A.approvals === 'function' ? A.approvals().length : 0,
  }, 4);
}

const COMMANDS = () => [
  ['Ask BT…', 'Go to the chat', () => { closeModal(); if (window.BTAgent) window.BTAgent.open(); }],
  ['What needs my attention?', 'Ask BT', () => ask('What needs my attention today?')],
  ['Investigate the biggest issue', 'Ask BT', () => { const f = visibleFindings().find(x => x.severity === 'warning'); f ? investigate(f) : toast('No warning-level findings to investigate.'); }],
  ['Prepare me for closing', 'Ask BT', () => ask('Prepare me for closing: what is not closed, and what should I check first?')],
  ['Show forecast', 'Ask BT', () => ask('Interpret my target pace for this month.')],
  ['View findings', 'Monitor', () => goMode('monitor', 'aic-att')], ['View agents', 'Investigate', () => goMode('investigate', 'aic-net')], ['View tools', 'Investigate', () => { S.toolsOpen = true; goMode('investigate', 'aic-tools'); }],
  ['View approvals / actions', 'Act', () => goMode('act', 'aic-actc')], ['View activity', 'Investigate', () => goMode('investigate', 'aic-act')], ['View system health', 'Investigate', () => goMode('investigate', 'aic-health')],
  ...M.SYSTEMS.map(s => ['View ' + s.toLowerCase(), 'System', () => openSystem(s)]),
  ['Run health check', 'System', () => refresh({ force: true })],
  ['Search repository', 'Investigate', () => { goMode('investigate', 'aic-repo'); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }], ['Explain architecture', 'Investigate', () => { goMode('investigate', 'aic-repo'); S.repoQ = RI.SAMPLE_QUESTIONS[4]; paint(); setTimeout(() => { const i = $('#aic-rq'); if (i) i.focus(); }, 60); }],
  ['Open Dashboard', 'Go to', () => openPage('#dashboard')], ['Open Closing Book', 'Go to', () => openPage('#closing-book')], ['Open STR Report', 'Go to', () => openPage('#str')], ['Open Inventory Health', 'Go to', () => openPage('#inv-health')], ['Open Cover', 'Go to', () => openPage('#cover')],
];
function goMode(mode, id) { closeModal(); S.mode = mode; S.open[String(id).replace(/^aic-/, '')] = true; paint(); const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function openPalette() {
  const input = h('input', { class: 'aic-pin', type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command', autocomplete: 'off' });
  const list = h('ul', { class: 'aic-plist', role: 'listbox' }); let idx = 0, shown = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = COMMANDS().filter(c => !q || c[0].toLowerCase().includes(q) || c[1].toLowerCase().includes(q));
    if (idx >= shown.length) idx = Math.max(0, shown.length - 1);
    list.replaceChildren(...(shown.length ? shown.map((c, i) => h('li', { role: 'option', 'aria-selected': String(i === idx), class: i === idx ? 'on' : '', onclick: () => run(c) }, h('span', { text: c[0] }), h('small', { text: c[1] }))) : [h('li', { class: 'aic-empty', text: 'No matching command. Press Enter to ask BT instead.' })]));
  };
  const run = c => { closeModal(); c[2](); };
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[idx]) run(shown[idx]); else if (input.value.trim()) { const q = input.value; closeModal(); ask(q); } }
  });
  openModal('Command palette', h('div', {}, input, list), { sub: 'Esc to close' }); draw(); input.focus();
}

// ───────────────────────── page paint ─────────────────────────
function paint() {
  const r = root(); if (!r || !pageOn()) return;
  const info = coreInfo();
  // Business-first order: critical → snapshot → needs attention → copilot → sales → inventory/STR → closing/cash/money → approvals → operations
  const keyed = [['hero', secHero(info)], ['tabs', secTabs()], ['crit', secCritical(info)], ['dktiles', secDkTiles()], ['dkatt', secDkAttention()], ['dksales', secDkSales()], ['fc', secForecast()],
    ['dkinv', secDkInv()], ['invstr', secInvStr()], ['dkmoney', secDkMoney()], ['money', secMoney()], ['dkappr', secDkApprovals()], ['actc', secActions(info)], ['hist', secHist()], ['dkops', secDkOps()], ['dkgame', secDkGame()], ['dkaudit', secDkAudit()], ['dkexp', secDkExpiry()], ['dkpay', secDkPay()], ['ops', secOps(info)], ['sys', secSystems()], ['att', secAttention()]]
    .filter(([, n]) => n);
  const cards = keyed.map(([id, n]) => { const tabs = TAB_OF[id] || 'more'; n.setAttribute('data-tabs', tabs); if (tabs !== '*' && !tabs.split(' ').includes(S.tab)) n.setAttribute('data-off', ''); return n; });
  // a genuinely pending approval outranks everything: the Action Center moves to the top (CSS keyed on data-pri)
  const main = h('main', { class: 'aic-main', 'data-tab': S.tab, 'data-mode': S.mode, 'data-pri': info.live.pendingApproval ? 'approvals' : 'normal' }, cards);
  const offline = navigator.onLine === false ? h('div', { class: 'aic-offline', role: 'alert' }, h('b', { text: 'BT OFFLINE · ' }), 'Showing last known data' + (S.snap ? ' from ' + clock(S.snap.at) : '') + '. Some intelligence may be unavailable.') : null;
  const rqHad = !!(document.activeElement && document.activeElement.id === 'aic-rq');
  const scroll = window.scrollY;
  const keepH = r.offsetHeight; if (keepH) r.style.minHeight = keepH + 'px'; // the page must not shrink mid-swap, or the browser clamps (jumps) the scroll position
  r.replaceChildren(...[secHeaderBar(info.core), offline, S.error && S.snap ? failureNode(S.error, () => refresh({ force: true })) : null, main].filter(Boolean)); // null args would render the text "null"
  r.style.minHeight = '';
  if (rqHad) { const r2 = $('#aic-rq'); if (r2) { r2.focus(); const n = r2.value.length; try { r2.setSelectionRange(n, n); } catch (_) { /* not a text input */ } } }
  if (Math.abs(window.scrollY - scroll) > 1) window.scrollTo(0, scroll);
}

// ───────────────────────── lifecycle ─────────────────────────
function onTelemetry(e) {
  if (!S.mounted) return;
  if (e.type === 'approval_requested' && window.BTAgent && pageOn()) { toast('Dua needs your approval.'); if (typeof window.BTAgent.approvals === 'function') S.mode = 'act'; }
  if (e.type === 'answer' && S.awaitingFor) { S.assess[S.awaitingFor] = { text: (e.metadata && e.metadata.text) || '', at: e.timestamp, investigation: window.BTAgent && typeof window.BTAgent.investigationFor === 'function' ? window.BTAgent.investigationFor(S.awaitingFor) : null }; S.awaitingFor = null; }
  if (e.type === 'error' || e.type === 'cancelled') S.awaitingFor = null;
  if (e.type === 'tool_end' && e.status === 'ok' && e.metadata && (e.metadata.risk === 'write' || e.metadata.risk === 'critical') && e.source !== 'ai-center') setTimeout(() => refresh({ force: true }), 800);
  if (pageOn()) render();
}

export function mount() {
  if (S.mounted) return;
  const p = document.getElementById(PAGE_ID); if (!p) return;
  p.classList.add('aic-jarvis');
  p.replaceChildren(h('div', { id: 'aic-root', class: 'aic' }));
  S.mounted = true;
  T.subscribe(onTelemetry);
  window.addEventListener('online', render); window.addEventListener('offline', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistVisit(); else if (pageOn()) refresh(); });
  window.addEventListener('pagehide', persistVisit);
  window.addEventListener('hashchange', () => { document.body.classList.toggle('aic-open', /^#ai-center/.test(window.location.hash)); if (!/^#ai-center/.test(window.location.hash)) persistVisit(); });
  document.addEventListener('keydown', e => {
    if (!pageOn()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && modalEl) closeModal();
    else if (e.key === 'Tab' && modalEl) trapTab(e);
  });
  watchScrolling();
  // Once a second only the elapsed counter is updated in place (no repaint); the full repaint is the 15 s refresh. Real changes repaint through telemetry events.
  const iv = setInterval(() => {
    if (!pageOn()) return; S.tick++;
    const live = T.liveState();
    if (live.open) { const t = Math.round(live.elapsedMs / 1000) + 's'; document.querySelectorAll('[data-aic-elapsed]').forEach(n => { if (n.textContent !== t) n.textContent = t; }); }
    if (S.tick % 15 === 0) render();
  }, 1000);
  if (iv && typeof iv.unref === 'function') iv.unref(); // Node (tests) only: never keep the process alive
}

export function onShow() {
  FG.tick().catch(() => {});
  mount();
  document.body.classList.add('aic-open');
  paint();
  refresh();
}

export const __test = { S, setTab, ask, openAvatarSettings, refresh, paint, openFinding, openSystem, openPalette, investigate, weekdayBars, openModal, allRuns, runsBlock, openDraft, promptChips };
