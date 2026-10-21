// ══════════════════════════════════════════════════════════════════════
// COVER MAIL STRIP (js/cover-mail-strip.js)
//
// A collapsible "Mail Briefing" strip on Cover. Collapsed: day chips (Today/3d/7d) + counts.
// Expanded: Summary (top action items + due follow-ups, rules-based, no AI) or Full brief
// (the AI brief from the Mail page, run only on tap). All data comes from window.MailBriefing
// (read-only Gmail). Nothing is fetched on Cover load; the first expand or day-chip tap loads mail.
// Mail text is only inserted with textContent, never innerHTML.
// ══════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const root = document.getElementById('cover-mail-strip');
  if (!root) return;
  const OPEN_KEY = 'bt_cover_mail_open'; // UI-local only
  const st = { open: false, tab: 's', busy: false, briefing: false, err: '' };
  try { st.open = localStorage.getItem(OPEN_KEY) === '1'; } catch (_) { /* ignore */ }
  const MB = () => window.MailBriefing;
  const DAYS = [[1, 'Today'], [3, '3 days'], [7, '7 days']];

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text, fn) { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); return b; }
  function openMail() { if (typeof window.showPage === 'function') window.showPage('mail'); else location.hash = '#mail'; }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()); }
  function item(main, sub) { const d = el('div', 'cms-it', main); if (sub) d.append(el('small', null, sub)); return d; }

  async function load(days) {
    st.busy = true; st.err = ''; draw();
    try { await MB().setDays(days); } catch (e) { st.err = (e && e.message) || String(e); }
    st.busy = false; draw();
  }
  function toggle() {
    st.open = !st.open;
    try { localStorage.setItem(OPEN_KEY, st.open ? '1' : '0'); } catch (_) { /* ignore */ }
    draw();
    if (st.open && MB() && !MB().isConnected()) load(MB().getDays());
  }
  async function brief() {
    st.briefing = true; st.err = ''; draw();
    try { if (!(await MB().runBrief())) st.err = 'Load your mail first, then run the brief.'; } catch (e) { st.err = (e && e.message) || String(e); }
    st.briefing = false; draw();
  }

  function draw() {
    const mb = MB(); root.replaceChildren();
    const wrap = el('div', 'cms' + (st.open ? ' open' : '')); root.append(wrap);
    if (!mb) { wrap.append(el('div', 'cms-h', '✉️ Mail Briefing unavailable')); return; }
    const snap = mb.snapshot(), days = mb.getDays(), connected = mb.isConnected(), t = today();
    const fus = mb.followUps().filter((f) => f.overdue || f.due === t || f.reply_received);

    const head = el('div', 'cms-h'); head.setAttribute('role', 'button'); head.tabIndex = 0;
    head.setAttribute('aria-expanded', String(st.open));
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    head.append(el('span', 'cms-ic', '✉️'));
    const tt = el('div', 'cms-t'); tt.append(el('div', 'cms-tt', 'Mail Briefing'),
      el('div', 'cms-sub', st.busy ? 'Reading mail…' : connected && snap.loaded ? 'Read-only Gmail · ' + (days === 1 ? 'Today' : 'last ' + days + ' days') : 'Tap to load · read-only Gmail'));
    head.append(tt);
    if (snap.loaded) {
      const c = el('div', 'cms-c');
      c.append(el('span', 'a', snap.counts.act + ' action'), el('span', 'w', snap.counts.wait + ' waiting'), el('span', 'f', fus.length + ' follow-up'));
      head.append(c);
    }
    head.append(el('span', 'cms-chev', '▾'));
    wrap.append(head);

    const dr = el('div', 'cms-days');
    DAYS.forEach(([n, label]) => { const b = btn('cms-chip' + (n === days ? ' on' : ''), label, () => load(n)); b.disabled = st.busy; dr.append(b); });
    wrap.append(dr);
    if (!st.open) return;

    const body = el('div', 'cms-b'); wrap.append(body);
    if (st.err) body.append(el('p', 'cms-err', st.err));
    if (!connected) {
      body.append(el('p', 'cms-mute', 'Gmail is not connected on this device yet.'), btn('cms-btn p', 'Open Mail to connect', openMail));
      return;
    }
    const tabs = el('div', 'cms-tabs');
    [['s', 'Summary'], ['f', 'Full brief']].forEach(([k, label]) => tabs.append(btn('cms-chip' + (st.tab === k ? ' on' : ''), label, () => { st.tab = k; draw(); })));
    body.append(tabs);

    if (st.tab === 's') {
      body.append(el('div', 'cms-sec a', 'Needs your action'));
      const acts = snap.needs_action.slice(0, 3);
      if (!acts.length) body.append(el('p', 'cms-mute', snap.loaded ? 'Nothing needs action in this window.' : 'No mail loaded yet.'));
      acts.forEach((x) => body.append(item(x.subject, x.from + ' · ' + x.when)));
      if (fus.length) {
        body.append(el('div', 'cms-sec', 'Follow-ups due'));
        fus.slice(0, 3).forEach((f) => body.append(item(f.subject, (f.reply_received ? 'reply received · ' : '') + (f.overdue ? 'overdue · ' : '') + 'due ' + f.due)));
      }
    } else {
      const node = mb.briefNode();
      if (st.briefing) body.append(el('p', 'cms-mute', '✨ Briefing your mail… this can take a minute.'));
      else if (node) body.append(node);
      else body.append(el('p', 'cms-mute', 'The full brief reads each thread and sends redacted text to the app’s AI (non-training providers only). It runs only when you tap.'));
      const b = btn('cms-btn p', node ? 'Refresh brief' : '✨ Run AI brief', brief); b.disabled = st.briefing || !snap.loaded; body.append(b);
    }
    body.append(btn('cms-btn', 'Open Mail page', openMail));
  }

  draw();
  if (MB() && MB().onChange) MB().onChange(draw);
})();
