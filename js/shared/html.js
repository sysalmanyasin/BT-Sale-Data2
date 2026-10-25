// ══════════════════════════════════════════════════════════════════════
// SHARED HTML HELPERS — the ONE HTML-escape implementation.
//
// Before: ~25 private copies (esc / _esc / escHtml / _mgrEsc ...). Two of them
// (excess-working, reorder-report) used the div.textContent trick, which does NOT
// escape quotes — unsafe when the result lands inside an HTML attribute.
//
// escapeHtml() escapes & < > " ' so it is safe in text nodes AND quoted attributes.
// Leaf module: no imports, cannot join an import cycle.
// ══════════════════════════════════════════════════════════════════════
const _MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => _MAP[ch]);
}
