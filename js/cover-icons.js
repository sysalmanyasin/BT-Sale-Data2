// COVER ICONS — line-art SVG replacements for the emoji glyphs the cover
// dashboard used to render inline (group headers, KPI tiles, section
// tiles, attention chips, pins, closing-summary stats). Kept as a single
// small module so the icon *style* (24x24 viewBox, 1.75 stroke, round
// caps/joins, currentColor — no fill, so every icon automatically
// inherits whatever --g-accent the surrounding card/group has already
// set) lives in one place instead of being redrawn per call site.
//
// ICON_SVG is keyed by the emoji character cover-dashboard.js already
// uses as `icon:` values, so swapping emoji -> SVG needed zero changes
// to the data tables in cover-dashboard.js — only the render sites that
// interpolate `${x.icon}` were changed to call iconHtml(x.icon) instead.
// Any emoji not in this map falls back to being printed as-is, so a
// future icon: '🆕' added to a data table degrades gracefully instead
// of rendering blank.

const S = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

export const ICON_SVG = {
  // generic bullet / unmapped-group fallback
  '•': `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/></svg>`,

  // Sales / dashboard — bar chart
  '📊': `<svg viewBox="0 0 24 24" ${S}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  // declining trend (behind target)
  '📉': `<svg viewBox="0 0 24 24" ${S}><path d="M3 7l7 7 4-4 7 7"/><path d="M15 17h6v-6"/></svg>`,

  // Manager — necktie / person
  '👔': `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="5.5" r="2.5"/><path d="M9.5 8h5l-1 3.5-1.8 8.5h-1.4L8.5 11.5z"/></svg>`,

  // Credit / card
  '💳': `<svg viewBox="0 0 24 24" ${S}><rect x="2.5" y="5.5" width="19" height="13" rx="2.2"/><path d="M2.5 10h19"/><path d="M6 14.5h4"/></svg>`,

  // Bank / deposits
  '🏦': `<svg viewBox="0 0 24 24" ${S}><path d="M3 10l9-6 9 6"/><path d="M5 10v9M10 10v9M14 10v9M19 10v9"/><path d="M3 19h18"/></svg>`,

  // Manual returns
  '↩️': `<svg viewBox="0 0 24 24" ${S}><path d="M9 14l-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,

  // Closing / lock
  '🔒': `<svg viewBox="0 0 24 24" ${S}><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`,
  // Closing book / open ledger
  '📖': `<svg viewBox="0 0 24 24" ${S}><path d="M12 6.5c-1.6-1.2-4-1.8-6.5-1.5v13c2.5-.3 4.9.3 6.5 1.5 1.6-1.2 4-1.8 6.5-1.5v-13c-2.5-.3-4.9.3-6.5 1.5z"/><path d="M12 6.5v13"/></svg>`,

  // Notes & sheets / document
  '📑': `<svg viewBox="0 0 24 24" ${S}><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>`,

  // Stock ledger / bound book
  '📒': `<svg viewBox="0 0 24 24" ${S}><rect x="4.5" y="3.5" width="15" height="17" rx="1.6"/><path d="M8 3.5v17"/><path d="M12 8h5M12 12h5M12 16h3"/></svg>`,

  // Reports / stacked books
  '📚': `<svg viewBox="0 0 24 24" ${S}><path d="M4 5.5c0-1.1.9-2 2-2h2.5v17H6a2 2 0 0 1-2-2z"/><path d="M8.5 3.5H13v17H8.5z"/><path d="M13 4.2l5.3-1 2.2 16.6-5.3 1z"/></svg>`,

  // Inventory / package
  '📦': `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4.5 7.5L12 12l7.5-4.5"/><path d="M12 12v9"/></svg>`,

  // Reorder / cart
  '🛒': `<svg viewBox="0 0 24 24" ${S}><path d="M3 4h2.2l2.4 12.2A2 2 0 0 0 9.5 18H18a2 2 0 0 0 2-1.6l1.4-7.4H6.4"/><circle cx="10" cy="21" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="21" r="1.3" fill="currentColor" stroke="none"/></svg>`,

  // STR / clipboard, assignments
  '📋': `<svg viewBox="0 0 24 24" ${S}><rect x="5" y="4.5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="M8.5 12h7M8.5 16h7"/></svg>`,

  // STR zero-dispatch / no-entry
  '🚫': `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8.5"/><path d="M6.2 6.2l11.6 11.6"/></svg>`,

  // Audit / receipt
  '🧾': `<svg viewBox="0 0 24 24" ${S}><path d="M6 3h12v18l-2.2-1.5L13.6 21l-1.6-1.5L10.4 21 8.2 19.5 6 21z"/><path d="M9 8h6M9 11.5h6M9 15h4"/></svg>`,

  // Invoice desk / calculator-abacus
  '🧮': `<svg viewBox="0 0 24 24" ${S}><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9h16"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>`,

  // Checklist / daily check list
  '✅': `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.4"/></svg>`,

  // Warning
  '⚠️': `<svg viewBox="0 0 24 24" ${S}><path d="M12 4l9.2 16H2.8z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></svg>`,
};

/**
 * Returns markup for an icon. `key` is either an emoji already present in
 * ICON_SVG (the common case — every call site today passes a data table's
 * existing `icon:` value straight through) or any other string, which is
 * echoed back unchanged so nothing regresses for an icon this module
 * doesn't know about yet.
 */
export function iconHtml(key) {
  return ICON_SVG[key] || key || '';
}
