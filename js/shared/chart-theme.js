// ══════════════════════════════════════════════════════════════════════
// CHART THEME — one place that turns the app's CSS design tokens
// (css/variables.css, light + dark) into the plain colour strings Chart.js
// needs. Canvas charts cannot read var(--x), so before this helper each chart
// hard-coded its own hex values (and '#fff' borders / '#334155' legend text),
// which looked wrong in dark mode and let the same inventory category use a
// different colour on different screens.
//
//   status('healthy')   -> colour for an inventory status (--st-* tokens)
//   chartTheme()        -> { text, muted, grid, surface, accent, status }
//   applyChartDefaults(Chart) -> sets Chart.defaults text/grid colours
//
// Pure DOM read, no state. Charts are rebuilt whenever their page renders, so
// a theme switch is picked up the next time the page is shown.
// ══════════════════════════════════════════════════════════════════════

// Fallbacks (light-theme values) used only if a token is missing, e.g. in tests.
const FALLBACK = {
  '--text': '#12172b', '--muted': '#646b8d', '--grid': '#c3cadb',
  '--surface': '#ffffff', '--accent': '#3a61f7',
  '--st-healthy': '#0a7c4d', '--st-reorder': '#a35a05', '--st-excess': '#3a61f7',
  '--st-dead': '#d0291f', '--st-never': '#8b5cf6', '--st-zero': '#646b8d',
};

export function cssVar(name) {
  try {
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    }
  } catch (_) { /* fall through to fallback */ }
  return FALLBACK[name] || '';
}

/** Inventory status colour: 'healthy' | 'reorder' | 'excess' | 'dead' | 'never' | 'zero'. */
export function status(key) {
  return cssVar('--st-' + key);
}

export function chartTheme() {
  return {
    text: cssVar('--text'),
    muted: cssVar('--muted'),
    grid: cssVar('--grid'),
    surface: cssVar('--surface'),
    accent: cssVar('--accent'),
    status: {
      healthy: status('healthy'), reorder: status('reorder'), excess: status('excess'),
      dead: status('dead'), never: status('never'), zero: status('zero'),
    },
  };
}

/** Make every axis, tick, legend and title in this page's Chart.js charts follow the theme. */
export function applyChartDefaults(Chart) {
  if (!Chart || !Chart.defaults) return;
  const t = chartTheme();
  Chart.defaults.color = t.muted;
  Chart.defaults.borderColor = 'color-mix(in srgb, ' + t.grid + ' 45%, transparent)';
}
