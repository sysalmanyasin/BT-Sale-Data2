// ══════════════════════════════════════════════════════════════════════
// PDF LIBRARY  —  in-app, cross-device library of every PDF the app
// generates, fed directly from the one central hook every report
// already funnels through: js/print.js's _generateAndDeliver().
//
// Flow:
//   1. The instant a print is requested, print.js calls
//      window.PdfLibrary.beginPrint() — this owns the ENTIRE popup for
//      the print, replacing the old blank-tab-plus-silent-download
//      combo. Shows a "Generating…" state immediately, before the
//      (CPU-bound) html2canvas/jsPDF work even starts.
//   2. Once the PDF blob exists, print.js calls
//      window.PdfLibrary.finishPrint({blob, filename, title}), which
//      swaps the same popup to show View / Download buttons plus a
//      category + expiry picker. View/Download are real clicks inside
//      an already-open popup, so they're never popup-blocked and never
//      trigger an unasked-for tab or Downloads-folder write on their
//      own — the user picks what they want.
//   3. "Save to Library" uploads the blob to the `pdf-library` Storage
//      bucket and inserts one metadata row into `bt_pdf_library` (same
//      Supabase project as everything else — see js/supabase.js for
//      SB_URL/SB_KEY). Expiry: 3d default, or 7d/30d/Keep(pinned).
//   4. If PDF generation itself throws, print.js calls
//      window.PdfLibrary.failPrint(err) so the popup doesn't get stuck
//      on "Generating…" forever.
//   5. Once per app boot (see auth.js's unlockApp()), runExpirySweep()
//      silently deletes any non-pinned row (+ its storage object) whose
//      expires_at has passed — no UI, no toast, just cleanup.
//   6. #page-pdf-library (wired by init()/onShow()) lists every row
//      across every device, with search + category filter + view +
//      download.
//
// Same lazy-client / anon-key trust model as audit-bridge.js and
// stockledger.js: RLS scopes access, not key secrecy, and the client is
// only ever created once supabase-js's UMD global is actually present.
// ══════════════════════════════════════════════════════════════════════

window.PdfLibrary = (function () {
  'use strict';

  const SB_URL = 'https://wetbugzzchkghpzmowod.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM';
  const TABLE  = 'bt_pdf_library';
  const BUCKET = 'pdf-library';

  const CATEGORIES = [
    { id: 'sales',      label: '📊 Sales' },
    { id: 'manager',    label: '👔 Manager' },
    { id: 'inventory',  label: '📦 Inventory' },
    { id: 'closing',    label: '📖 Closing' },
    { id: 'audit',      label: '🧾 Audit' },
    { id: 'notesheets', label: '📑 Notes & Sheets' },
    { id: 'other',      label: '🗂️ Other' },
  ];
  const CAT_LABEL = CATEGORIES.reduce((m, c) => (m[c.id] = c.label, m), {});

  const PRESETS = [
    { id: '3d',  label: '3 days',  days: 3 },
    { id: '7d',  label: '7 days',  days: 7 },
    { id: '30d', label: '30 days', days: 30 },
    { id: 'keep', label: '📌 Keep', days: null },
  ];
  const DEFAULT_PRESET = '3d';

  let _client = null;
  let _pageInitialized = false;
  let _pending = null;       // { blob, filename, title } awaiting the save prompt
  let _selectedPreset = DEFAULT_PRESET;
  let _rows = [];            // last fetched library rows, cached for client-side filter/search

  function _getClient() {
    // Prefer the app's real authenticated client — see closing-bridge.js's
    // _getClient() for why: bt_pdf_library now requires is_authorized_user()
    // (Stage 2 lockdown), so the plain anon key below no longer sees rows.
    if (typeof window.btGetSupabaseClient === 'function') {
      const c = window.btGetSupabaseClient();
      if (c) return c;
    }
    if (_client) return _client;
    if (typeof supabase === 'undefined' || !supabase.createClient) return null;
    _client = supabase.createClient(SB_URL, SB_KEY);
    return _client;
  }

  function _toast(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type);
  }

  // ── Category guess — best-effort only; the user can always override
  // it in the prompt. Matches on whatever's in the filename/title. ────
  function _guessCategory(text) {
    const s = (text || '').toLowerCase();
    if (/sale|daily|monthly|yearly|dashboard/.test(s) && !/manager/.test(s)) return 'sales';
    if (/manager|salary|credit|incentive|petty/.test(s)) return 'manager';
    if (/inventory|stock|excess|reorder/.test(s)) return 'inventory';
    if (/closing/.test(s)) return 'closing';
    if (/audit|assignment/.test(s)) return 'audit';
    if (/note|sheet/.test(s)) return 'notesheets';
    return 'other';
  }

  function _sanitizePathPart(s) {
    return String(s || '').replace(/[^a-z0-9\-_. ]+/gi, '').trim().replace(/\s+/g, '-') || 'file';
  }

  function _publicUrl(path) {
    const client = _getClient();
    if (!client) return null;
    const { data } = client.storage.from(BUCKET).getPublicUrl(path);
    return data && data.publicUrl;
  }

  // ══════════════════════════════════════════════════════════════════
  // PRINT POPUP  —  one popup per print, two states:
  //   "generating"  shown the instant Print.render()/renderNewTab() is
  //                 called (beginPrint) — replaces the old blank-tab
  //                 trick, since a popup we already own can't be
  //                 blocked and gives instant feedback.
  //   "ready"       shown once the PDF blob exists (finishPrint) — View
  //                 opens it in a new tab (a real click inside this
  //                 popup, so never popup-blocked), Download saves it
  //                 straight to disk, and the category/expiry controls
  //                 below optionally also save a copy to the library.
  // View/Download and the library save are independent: closing the
  // popup without hitting Save just discards the library copy, it
  // never blocks or undoes a View/Download the user already did.
  // ══════════════════════════════════════════════════════════════════
  let _blobUrl = null; // the object URL backing View/Download in the current popup, revoked on close

  function _buildPromptOnce() {
    if (document.getElementById('pl-save-bg')) return;
    const catOptions = CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
    const presetBtns = PRESETS.map(p =>
      `<div class="pl-preset${p.id === 'keep' ? ' pin' : ''}${p.id === DEFAULT_PRESET ? ' active' : ''}" data-preset="${p.id}">${p.label}</div>`
    ).join('');
    const html = `
      <div class="plbg" id="pl-save-bg">
        <div class="plbox">
          <div class="plhdr">
            <h3 id="pl-save-heading">Generating PDF…<small id="pl-save-filename"></small></h3>
            <button class="plclose" id="pl-save-close" type="button">✕</button>
          </div>
          <div class="plbody">
            <div class="pl-gen-state" id="pl-gen-state">
              <div class="pl-spinner"></div>
              <div class="pl-gen-msg">Rendering your report to PDF — this takes a moment for longer reports…</div>
            </div>
            <div class="pl-ready-state" id="pl-ready-state" style="display:none">
              <div class="pl-quick-actions">
                <button class="btn btn-s" id="pl-quick-view" type="button">👁 View PDF</button>
                <button class="btn btn-s" id="pl-quick-download" type="button">⬇ Download</button>
              </div>
              <div class="pl-fg">
                <label>Save a copy to the library? — Report category</label>
                <select id="pl-save-category">${catOptions}</select>
              </div>
              <div class="pl-fg">
                <label>Auto-expiry</label>
                <div class="pl-presets" id="pl-save-presets">${presetBtns}</div>
              </div>
            </div>
          </div>
          <div class="plftr" id="pl-save-ftr" style="display:none">
            <button class="pl-skip" id="pl-save-skip" type="button">Don't save</button>
            <button class="btn btn-p" id="pl-save-confirm" type="button">Save to Library</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('pl-save-close').addEventListener('click', _closePrompt);
    document.getElementById('pl-save-skip').addEventListener('click', _closePrompt);
    document.getElementById('pl-save-confirm').addEventListener('click', _confirmSave);
    document.getElementById('pl-quick-view').addEventListener('click', () => {
      if (_blobUrl) window.open(_blobUrl, '_blank');
    });
    document.getElementById('pl-quick-download').addEventListener('click', () => {
      if (!_pending) return;
      const a = document.createElement('a');
      a.href = _blobUrl;
      a.download = _pending.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    document.getElementById('pl-save-presets').addEventListener('click', (e) => {
      const el = e.target.closest('.pl-preset');
      if (!el) return;
      _selectedPreset = el.dataset.preset;
      document.querySelectorAll('#pl-save-presets .pl-preset').forEach(b => b.classList.toggle('active', b === el));
    });
    // No backdrop-click-to-close while generating — closing mid-build would
    // strand the popup in a state with nothing to show; once ready, a
    // backdrop click behaves like "Don't save" (View/Download already done
    // are unaffected either way).
    document.getElementById('pl-save-bg').addEventListener('click', (e) => {
      if (e.target.id === 'pl-save-bg' && document.getElementById('pl-ready-state').style.display !== 'none') _closePrompt();
    });
  }

  function _closePrompt() {
    const bg = document.getElementById('pl-save-bg');
    if (bg) bg.classList.remove('on');
    if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null; }
    _pending = null;
  }

  // Called by print.js the instant a print is requested — shows the
  // "Generating…" state immediately, before the (slow, CPU-bound)
  // html2canvas/jsPDF work even starts, so there's no dead time with no
  // feedback at all. Safe to call with no PDF yet in hand.
  function beginPrint() {
    _buildPromptOnce();
    _pending = null;
    if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null; }
    document.getElementById('pl-save-heading').firstChild.textContent = 'Generating PDF…';
    document.getElementById('pl-save-filename').textContent = '';
    document.getElementById('pl-gen-state').style.display = '';
    document.getElementById('pl-ready-state').style.display = 'none';
    document.getElementById('pl-save-ftr').style.display = 'none';
    document.getElementById('pl-save-bg').classList.add('on');
  }

  // Called by print.js once the blob exists — swaps the popup from
  // "Generating…" to the finished View/Download/Save-to-library state.
  function finishPrint(payload) {
    try {
      payload = payload || {};
      const { blob, filename, title } = payload;
      if (!blob) return;
      _buildPromptOnce(); // in case finishPrint is ever called without a prior beginPrint
      _pending = { blob, filename: filename || 'BT-Report.pdf', title: title || '' };
      _blobUrl = URL.createObjectURL(blob);
      _selectedPreset = DEFAULT_PRESET;
      document.querySelectorAll('#pl-save-presets .pl-preset').forEach(b =>
        b.classList.toggle('active', b.dataset.preset === DEFAULT_PRESET));
      document.getElementById('pl-save-heading').firstChild.textContent = 'PDF ready';
      document.getElementById('pl-save-filename').textContent = _pending.filename;
      const catSel = document.getElementById('pl-save-category');
      catSel.value = _guessCategory(_pending.title + ' ' + _pending.filename);
      document.getElementById('pl-gen-state').style.display = 'none';
      document.getElementById('pl-ready-state').style.display = '';
      document.getElementById('pl-save-ftr').style.display = '';
      document.getElementById('pl-save-bg').classList.add('on');
    } catch (e) {
      console.error('PdfLibrary.finishPrint failed:', e);
    }
  }

  // Called by print.js if PDF generation itself throws — closes the
  // popup rather than leaving it stuck on "Generating…" forever.
  function failPrint(err) {
    _closePrompt();
    _toast('⚠️ Could not generate PDF: ' + (err && err.message || err), 'e');
  }

  async function _confirmSave() {
    if (!_pending) return _closePrompt();
    const client = _getClient();
    if (!client) {
      _toast('⚠️ PDF Library unavailable — Supabase client not ready.', 'e');
      return _closePrompt();
    }
    const { blob, filename, title } = _pending;
    const category = document.getElementById('pl-save-category').value || 'other';
    const preset = PRESETS.find(p => p.id === _selectedPreset) || PRESETS[0];
    const pinned = preset.id === 'keep';
    const expiresAt = pinned ? null : new Date(Date.now() + preset.days * 86400000).toISOString();

    const confirmBtn = document.getElementById('pl-save-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving…';

    try {
      const path = `${category}/${Date.now()}_${_sanitizePathPart(filename)}`;
      const { error: upErr } = await client.storage.from(BUCKET).upload(path, blob, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: insErr } = await client.from(TABLE).insert({
        category,
        title: title || filename,
        filename,
        storage_path: path,
        size_bytes: blob.size,
        pinned,
        expires_at: expiresAt,
      });
      if (insErr) throw insErr;

      _toast('📚 Saved to PDF Library' + (pinned ? ' (pinned)' : ''), 'ok');
      _closePrompt();
      if (_pageInitialized) _fetchAndRender();
    } catch (e) {
      console.error('PdfLibrary save failed:', e);
      _toast('⚠️ Could not save to PDF Library: ' + (e && e.message || e), 'e');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Save to Library';
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SILENT EXPIRY SWEEP  —  called once on app boot (auth.js unlockApp)
  // ══════════════════════════════════════════════════════════════════
  async function runExpirySweep() {
    const client = _getClient();
    if (!client) return; // supabase-js not ready yet — harmless, next boot will catch it
    try {
      const { data: expired, error } = await client
        .from(TABLE)
        .select('id, storage_path')
        .eq('pinned', false)
        .not('expires_at', 'is', null)
        .lt('expires_at', new Date().toISOString());
      if (error || !expired || !expired.length) return;

      const paths = expired.map(r => r.storage_path).filter(Boolean);
      const ids = expired.map(r => r.id);
      if (paths.length) await client.storage.from(BUCKET).remove(paths);
      await client.from(TABLE).delete().in('id', ids);
      console.log(`PdfLibrary: swept ${ids.length} expired report(s).`);
    } catch (e) {
      console.error('PdfLibrary.runExpirySweep failed:', e);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LIBRARY PAGE  (#page-pdf-library)
  // ══════════════════════════════════════════════════════════════════
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  }

  function _fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function _renderGrid() {
    const grid = document.getElementById('pl-grid');
    if (!grid) return;
    const search = (document.getElementById('pl-search').value || '').toLowerCase().trim();
    const catFilter = document.getElementById('pl-filter-category').value;

    let rows = _rows.slice();
    if (catFilter) rows = rows.filter(r => r.category === catFilter);
    if (search) rows = rows.filter(r =>
      (r.title || '').toLowerCase().includes(search) ||
      (r.filename || '').toLowerCase().includes(search));

    if (!rows.length) {
      grid.innerHTML = `<div class="pl-empty">No saved reports ${search || catFilter ? 'match this filter' : 'yet'}. Print any report and choose "Save" to add one.</div>`;
      return;
    }

    const now = Date.now();
    grid.innerHTML = rows.map(r => {
      const expiringSoon = !r.pinned && r.expires_at && (new Date(r.expires_at).getTime() - now) < 24 * 3600000;
      const metaLine = r.pinned
        ? '📌 Pinned — kept until manually removed'
        : r.expires_at
          ? `${expiringSoon ? '<span class="warn">Expires ' : 'Expires '}${_fmtDate(r.expires_at)}${expiringSoon ? '</span>' : ''}`
          : 'No expiry set';
      return `
        <div class="pl-card${expiringSoon ? ' expiring' : ''}" data-id="${r.id}">
          <div class="pl-card-top">
            <span class="pl-cat">${_esc(CAT_LABEL[r.category] || r.category)}</span>
            ${r.pinned ? '<span class="pl-pin">📌</span>' : ''}
          </div>
          <div class="pl-title">${_esc(r.title || r.filename)}</div>
          <div class="pl-meta">
            <span>${_fmtDate(r.created_at)} · ${_fmtSize(r.size_bytes)}</span>
            <span>${metaLine}</span>
          </div>
          <div class="pl-actions">
            <button class="btn btn-s pl-view" type="button">👁 View</button>
            <button class="btn btn-p pl-download" type="button">⬇ Download</button>
          </div>
        </div>`;
    }).join('');
  }

  async function _fetchAndRender() {
    const grid = document.getElementById('pl-grid');
    const client = _getClient();
    if (!client) {
      if (grid) grid.innerHTML = '<div class="pl-empty">PDF Library unavailable — Supabase client not ready. Try reloading.</div>';
      return;
    }
    if (grid) grid.innerHTML = '<div class="pl-empty">Loading…</div>';
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      _rows = data || [];
      _renderGrid();
    } catch (e) {
      console.error('PdfLibrary fetch failed:', e);
      if (grid) grid.innerHTML = '<div class="pl-empty">Could not load the library. Check your connection and try again.</div>';
    }
  }

  function _wirePageOnce() {
    if (_pageInitialized) return;
    const page = document.getElementById('page-pdf-library');
    if (!page) return; // page shell not in the DOM yet
    _pageInitialized = true;

    document.getElementById('pl-search').addEventListener('input', _renderGrid);
    document.getElementById('pl-filter-category').addEventListener('change', _renderGrid);
    document.getElementById('pl-refresh').addEventListener('click', _fetchAndRender);

    document.getElementById('pl-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.pl-card');
      if (!card) return;
      const row = _rows.find(r => String(r.id) === card.dataset.id);
      if (!row) return;
      const url = _publicUrl(row.storage_path);
      if (!url) { _toast('⚠️ Could not resolve file URL.', 'e'); return; }
      if (e.target.closest('.pl-view')) {
        window.open(url, '_blank');
      } else if (e.target.closest('.pl-download')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = row.filename || 'report.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    });
  }

  // Called from ui.js's showPage() when the PDF Library nav tab is
  // opened — same "wire once, safe to call every visit" pattern
  // StockLedgerApp/ExcessWorkingApp already use.
  function onShow() {
    _wirePageOnce();
    if (_pageInitialized) _fetchAndRender();
  }

  return { beginPrint, finishPrint, failPrint, runExpirySweep, onShow };
})();
