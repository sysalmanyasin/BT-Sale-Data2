// Desktop sidebar (>=1100px). Renders the same tree the All Sections drawer uses
// (BTNavSections.getTree) as a persistent left rail. Below 1100px it stays hidden
// and the bottom bar / drawer behave exactly as before.
(function () {
  'use strict';
  var MQ = window.matchMedia('(min-width:1100px)');
  var SECTION = { core: 'Core', data: 'Data', utility: 'Utility' };
  var openKeys = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hash() { return location.hash || '#cover'; }
  function hasActive(n) { return (n.href && n.href === hash()) || (n.kids || []).some(hasActive); }
  function icon(n) {
    var svg = n.svgKey && window.BT_ICONS && window.BT_ICONS[n.svgKey];
    return '<span class="bts-ic">' + (svg || esc(n.icon || '')) + '</span>';
  }
  function node(n, d) {
    var kids = n.kids || [];
    var key = n.label;
    var act = hasActive(n);
    if (!kids.length) {
      var ext = n.external ? ' target="_blank" rel="noopener"' : '';
      return '<a class="bts-item d' + d + (n.href === hash() ? ' on' : '') + '" href="' + esc(n.href || '#') + '"' + ext + '>' + icon(n) + '<span class="bts-lb">' + esc(n.label) + '</span></a>';
    }
    var open = openKeys[key] === true || (openKeys[key] === undefined && act);
    var head = n.href
      ? '<a class="bts-item bts-grp d' + d + (n.href === hash() ? ' on' : '') + '" href="' + esc(n.href) + '">' + icon(n) + '<span class="bts-lb">' + esc(n.label) + '</span></a>'
      : '<button type="button" class="bts-item bts-grp d' + d + (act ? ' has' : '') + '" data-k="' + esc(key) + '">' + icon(n) + '<span class="bts-lb">' + esc(n.label) + '</span></button>';
    return '<div class="bts-group' + (open ? ' open' : '') + '">' + head +
      '<button type="button" class="bts-chev" data-k="' + esc(key) + '" aria-label="Toggle ' + esc(n.label) + '" aria-expanded="' + open + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg></button>' +
      '<div class="bts-subs">' + kids.map(function (k) { return node(k, d + 1); }).join('') + '</div></div>';
  }
  function render() {
    var el = document.getElementById('bt-side');
    if (!el || !MQ.matches || !window.BTNavSections) return;
    var tree;
    try { tree = window.BTNavSections.getTree(); } catch (e) { return; }
    var last = null, html = '';
    tree.forEach(function (g) {
      if (g._section && g._section !== last) { html += '<div class="bts-head">' + esc(SECTION[g._section] || g._section) + '</div>'; last = g._section; }
      html += node(g, 0);
    });
    el.querySelector('.bts-scroll').innerHTML = html;
  }
  function setTop() {
    var h = 0, sb = document.querySelector('.status-bar'), nv = document.getElementById('nav');
    if (sb && sb.offsetHeight) h += sb.offsetHeight;
    if (nv && nv.offsetHeight) h += nv.offsetHeight;
    document.documentElement.style.setProperty('--bt-chrome-top', (h || 0) + 'px');
  }
  function apply() {
    document.body.classList.toggle('bt-side-on', MQ.matches);
    if (MQ.matches) { setTop(); render(); }
  }
  function init() {
    if (document.getElementById('bt-side')) return;
    var el = document.createElement('aside');
    el.id = 'bt-side'; el.className = 'no-print'; el.setAttribute('aria-label', 'Sections');
    el.innerHTML = '<button type="button" class="bts-search" onclick="openSectionsDrawer()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg><span>Search sections</span></button><div class="bts-scroll"></div>';
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]');
      if (!b) return;
      var k = b.getAttribute('data-k'), g = b.closest('.bts-group');
      var now = !g.classList.contains('open');
      openKeys[k] = now; g.classList.toggle('open', now);
      var c = g.querySelector('.bts-chev'); if (c) c.setAttribute('aria-expanded', now);
    });
    document.body.appendChild(el);
    window.addEventListener('hashchange', function () { openKeys = {}; render(); });
    window.addEventListener('resize', function () { if (MQ.matches) setTop(); });
    MQ.addEventListener('change', apply);
    apply();
    setTimeout(apply, 600); setTimeout(apply, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
