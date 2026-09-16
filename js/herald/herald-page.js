// ══════════════════════════════════════════════════════════════════════
// IC HERALD — PAGE RENDERER  (js/herald/herald-page.js)
//
// Floor 5 only: turns herald-engine.js's plain edition object into HTML
// inside #cover-herald (index.html, Cover page — replaces the old
// #cover-attention-strip chip row). Two states:
//   collapsed (default) — masthead bar + one-line teaser, tap to expand
//   expanded            — full front page, one section per desk, plus
//                          Print Edition (routes through Print.render(),
//                          same engine every other report already uses)
//                          and a manual "Later Edition" refresh.
//
// Collapse state is pure UI-local state (Repository.getItem/setItem,
// same door cover-dashboard.js's own COLLAPSE_KEY already uses) — not
// business data, never synced.
// ══════════════════════════════════════════════════════════════════════

import { buildTodaysEdition, refreshEdition } from './herald-engine.js';
import { Repository } from '../repository.js';

const COLLAPSE_KEY = 'bt_herald_collapsed';

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _isCollapsed() {
  const raw = Repository.getItem(COLLAPSE_KEY);
  return raw == null ? true : raw === '1'; // default collapsed on first-ever load
}
function _setCollapsed(v) { try { Repository.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch (e) {} }

function _printEditionHtml(edition) {
  const parts = [
    `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;padding:24px;color:#111">`,
    `<h1 style="margin:0 0 4px;font-size:26px;letter-spacing:.02em">The IC Herald</h1>`,
    `<div style="font-size:12px;color:#555;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px;font-family:Arial,sans-serif">${_esc(edition.dateLabel)} Edition</div>`,
    `<div style="font-size:17px;font-weight:700;margin-bottom:16px;font-family:Arial,sans-serif">${_esc(edition.lead.headline)}${edition.lead.detail ? `<div style="font-size:12px;font-weight:400;color:#666;margin-top:3px">${_esc(edition.lead.detail)}</div>` : ''}</div>`,
  ];
  edition.desks.forEach(d => {
    parts.push(`<div style="margin-top:16px;font-family:Arial,sans-serif">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #ccc;padding-bottom:5px;margin-bottom:8px">${d.icon} ${_esc(d.label)}</div>
      ${d.items.map(it => `<div style="font-size:13px;margin-bottom:7px;line-height:1.4"><b>${_esc(it.headline)}</b>${it.detail ? ` <span style="color:#777">— ${_esc(it.detail)}</span>` : ''}</div>`).join('')}
    </div>`);
  });
  parts.push('</div>');
  return parts.join('');
}

function _printEdition(edition) {
  if (!window.Print || typeof window.Print.render !== 'function') return;
  window.Print.render(_printEditionHtml(edition));
}

export function renderICHerald() {
  const el = document.getElementById('cover-herald');
  if (!el) return;

  let edition = null;
  try { edition = buildTodaysEdition(); } catch (e) {}
  if (!edition) { el.innerHTML = ''; return; }

  const storyCount = 1 + edition.desks.reduce((s, d) => s + d.items.length, 0);
  const collapsed = _isCollapsed();

  if (collapsed) {
    el.innerHTML = `
      <div class="herald-masthead" id="herald-masthead" role="button" tabindex="0">
        <div class="herald-top-row">
          <span class="herald-brand">📰 The IC Herald</span>
          <span class="herald-date">${_esc(edition.dateLabel)}</span>
        </div>
        <div class="herald-teaser">${_esc(edition.lead.headline)}</div>
        ${!edition.empty && storyCount > 1
          ? `<div class="herald-more">${storyCount - 1} more ${storyCount - 1 === 1 ? 'story' : 'stories'} inside ▾</div>`
          : `<div class="herald-more">Tap to open ▾</div>`}
      </div>`;
    const mh = document.getElementById('herald-masthead');
    if (mh) {
      const open = () => { _setCollapsed(false); renderICHerald(); };
      mh.addEventListener('click', open);
      mh.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    }
    return;
  }

  const desksHtml = edition.desks.map(d => `
    <div class="herald-desk">
      <div class="herald-desk-header">${d.icon} ${_esc(d.label)}</div>
      ${d.items.map(it => `
        <div class="herald-item" data-herald-page="${_esc(it.page)}" role="button" tabindex="0">
          <div class="herald-item-headline">${_esc(it.headline)}</div>
          ${it.detail ? `<div class="herald-item-detail">${_esc(it.detail)}</div>` : ''}
        </div>`).join('')}
    </div>`).join('');

  el.innerHTML = `
    <div class="herald-front-page">
      <div class="herald-top-row" id="herald-collapse-btn" role="button" tabindex="0">
        <span class="herald-brand">📰 The IC Herald</span>
        <span class="herald-date">${_esc(edition.dateLabel)} ▴</span>
      </div>
      <div class="herald-lead" data-herald-page="${_esc(edition.lead.page)}" role="button" tabindex="0">
        ${_esc(edition.lead.headline)}
        ${edition.lead.detail ? `<div class="herald-lead-detail">${_esc(edition.lead.detail)}</div>` : ''}
      </div>
      ${desksHtml || '<div class="herald-empty">No other stories today — check back tomorrow.</div>'}
      <div class="herald-actions">
        <button class="herald-btn" id="herald-print-btn" type="button">🖨️ Print Edition</button>
        <button class="herald-btn" id="herald-refresh-btn" type="button">🔄 Later Edition</button>
      </div>
    </div>`;

  const collapseBtn = document.getElementById('herald-collapse-btn');
  if (collapseBtn) {
    const close = () => { _setCollapsed(true); renderICHerald(); };
    collapseBtn.addEventListener('click', close);
    collapseBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') close(); });
  }

  el.querySelectorAll('[data-herald-page]').forEach(node => {
    const go = () => { const page = node.dataset.heraldPage; if (page && typeof window.showPage === 'function') window.showPage(page); };
    node.addEventListener('click', go);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
  });

  const printBtn = document.getElementById('herald-print-btn');
  if (printBtn) printBtn.addEventListener('click', ev => { ev.stopPropagation(); _printEdition(edition); });

  const refreshBtn = document.getElementById('herald-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    try { edition = refreshEdition(); } catch (e) {}
    renderICHerald();
  });
}

window.renderICHerald = renderICHerald;
