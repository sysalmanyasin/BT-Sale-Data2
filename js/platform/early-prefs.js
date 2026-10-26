// Runs synchronously in <head>, BEFORE first paint, so the saved view mode and theme apply without a flash.
// Kept as a tiny classic script (not a module: modules are deferred) and served from 'self' so the page CSP
// can forbid inline scripts.
// Apply saved view mode BEFORE first paint to avoid flash
(function(){
  if(localStorage.getItem('bt_view_mode')==='desktop'){
    document.getElementById('vp-meta').content='width=1280';
    document.documentElement.style.minWidth='1280px';
  }
})();
// Apply saved theme (light/dark/system) BEFORE first paint to avoid flash.
// Preference is stored as-is ('light'/'dark'/'system'); 'system' resolves
// live against the OS setting here and again on change (wired in
// js/ui/ui-extras.js's setThemePref, which owns the Tools > Appearance card).
(function(){
  var pref = localStorage.getItem('bt_theme') || 'system';
  var resolved = pref === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  if(resolved === 'dark'){
    document.documentElement.setAttribute('data-theme','dark');
  }
})();
