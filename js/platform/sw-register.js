// Service-worker registration + safe auto-refresh (was an inline <script> in index.html).
// Classic script: `toast` is the global from js/ui/ui.js, looked up lazily at call time.
(function () {
  if ('serviceWorker' in navigator) {
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) return;
      swRefreshing = true;
      // Safety: don't yank the page out from under someone mid-entry.
      // If no input/textarea is focused, it's safe to reload immediately.
      // If something IS focused (they're typing a sale entry), wait until
      // they finish (blur) or up to 5 minutes, whichever comes first —
      // never force a reload while a form field is actively focused.
      const isTyping = () => {
        const el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      };
      if (!isTyping()) {
        window.location.reload();
        return;
      }
      if (typeof toast === 'function') toast('⬆ New version ready — will apply once you finish this entry', 'info');
      const safeReload = () => { window.location.reload(); };
      document.addEventListener('focusout', function onBlur() {
        document.removeEventListener('focusout', onBlur);
        setTimeout(() => { if (!isTyping()) safeReload(); }, 300);
      });
      setTimeout(safeReload, 5 * 60 * 1000); // hard ceiling: 5 minutes
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('[SW] Registered, scope:', reg.scope);
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                nw.postMessage('SKIP_WAITING');
                console.log('[SW] New version available — will activate on next reload');
              }
            });
          });
        })
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  }
})();
